/**
 * FocusForces — Content Script
 * Zen Mode, Tag Toggler (Scout), Precision Timer, Theme Sync
 */

(function() {
    'use strict';

    // ── Early guard: if chrome APIs are unavailable (e.g. extension reloaded ──
    // while this content script is still running), bail out immediately to
    // prevent synchronous crashes on every chrome.* call.
    if (!chrome?.storage?.local) {
        console.warn('FocusForces: chrome.storage API unavailable — extension context may have been invalidated. Reload the page to re-activate.');
        return;
    }

    // ── Synchronous Theme Init ──────────────────────────
    // Prevent FOUC by reading the theme synchronously from localStorage
    // immediately as the content script runs at document_start.
    try {
        const syncTheme = localStorage.getItem('ff_theme');
        if (syncTheme && syncTheme !== 'default') {
            document.documentElement.setAttribute('data-ff-theme', syncTheme);
        }
    } catch (_) {}

    // ── Constants & Config ─────────────────────────────
    const IS_CF = window.location.hostname.includes('codeforces.com');
    const IS_ATCODER = window.location.hostname.includes('atcoder.jp');
    const IS_CODECHEF = window.location.hostname.includes('codechef.com');
    const PLATFORM = (typeof ZenUtils !== 'undefined')
        ? ZenUtils.detectPlatform(window.location.hostname)
        : (IS_CF ? 'codeforces' : IS_ATCODER ? 'atcoder' : IS_CODECHEF ? 'codechef' : 'other');

    const CONFIG = {
        ZEN_SELECTORS: PLATFORM === 'codeforces' ? [
            '#header',
            '.roundbox.menu-box',
            '.community-stats-box',
            '.news-item',
            '.footer',
            '#sidebar'
        ] : PLATFORM === 'atcoder' ? [
            '.navbar',
            '#header',
            '#footer',
            '.alert-info',
            '.alert-warning',
            '.btn-text-group'
        ] : PLATFORM === 'codechef' ? [
            '#top-bar',
            '.top-bar',
            '.sidebar-widget',
            '#sidebar',
            '.footer-container',
            '.footer'
        ] : [],
        PROBLEMS_FETCH_TIMEOUT_MS: 15000,
        CONTEST_STANDINGS_TIMEOUT_MS: 5000,
        TAGS_POLL_INTERVAL_MS: 300,
        TAGS_POLL_MAX_MS: 8000
    };

    // ── State ──────────────────────────────────────────
    let zenModeEnabled = false;
    let zenWidthMode = 'comfortable';
    let zenFontSize = 'normal';
    let zenCompanionVisible = true;
    let zenHudEl = null;
    let zenWorkspaceEl = null;
    let zenCanvasEl = null;
    let zenRailEl = null;
    let zenDrawerEl = null;
    let zenTimerInterval = null;
    let zenScrollListener = null;
    let zenKeydownListener = null;
    let zenTargetNode = null;
    let zenTargetOrigParent = null;
    let zenTargetOrigSibling = null;
    let zenRelocated = [];
    let problemCachePromise = null;
    let cachedAudioCtx = null;
    let currentTheme = 'default';
    let ffPoll = null;
    let ffObs = null;
    let ffAbortCtrl = null;
    let ffTimeout = null;
    let themeGuard = null;

    // ── Audio (for notification sounds triggered by background) ──
    const notifySound = new Audio(chrome.runtime.getURL('assets/notify.wav'));

    const getAudioContext = () => {
        if (cachedAudioCtx) return cachedAudioCtx;
        cachedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        return cachedAudioCtx;
    };

    const playNotificationSound = async () => {
        try {
            await notifySound.play();
            return;
        } catch (_) {
            try { notifySound.currentTime = 0; } catch (_) {}
        }
        try {
            const ctx = getAudioContext();
            if (ctx.state === 'suspended') await ctx.resume();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = 880;
            gain.gain.value = 0.3;
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
            osc.stop(ctx.currentTime + 0.4);
        } catch (_) {}
    };

    // ── Theme ──────────────────────────────────────────
    // Apply (or clear) the theme marker on BOTH <html> and <body> so the
    // Codeforces site theme (cf-theme.css) is active on EVERY page — not
    // just the problem page. Setting it on <html> keeps the whole viewport
    // themed even if Codeforces swaps out <body> during an AJAX / SPA-style
    // navigation.
    function applyThemeAttr(theme) {
        const targets = [document.documentElement, document.body].filter(Boolean);
        if (theme === 'default') {
            targets.forEach(t => t.removeAttribute('data-ff-theme'));
            return;
        }
        targets.forEach(t => t.setAttribute('data-ff-theme', theme));
    }

    function loadTheme() {
        try {
            chrome.storage.local.get('ff_theme').then(({ ff_theme }) => {
                applyThemeFromSource(ff_theme);
            }).catch(() => {
                applyThemeFromSource();
            });
        } catch (e) {
            console.debug('FocusForces: failed to load theme', e);
        }
    }

    function applyThemeToElements(theme) {
        const scoutCard = document.getElementById('ff-scout-card');
        if (scoutCard) scoutCard.setAttribute('data-ff-theme', theme);
    }

    // Re-apply the marker if it ever goes missing (e.g. Codeforces replaces
    // <body>, or the body wasn't ready when the script first ran).
    function ensureThemeApplied() {
        const expected = currentTheme === 'default' ? null : currentTheme;
        if (document.documentElement.getAttribute('data-ff-theme') !== expected) {
            applyThemeAttr(currentTheme);
        }
        if (document.body && document.body.getAttribute('data-ff-theme') !== expected) {
            applyThemeAttr(currentTheme);
        }

        // Clean up Codeforces' aggressive inline !important styles on table cells & rows
        if (currentTheme !== 'default' && IS_CF) {
            document.querySelectorAll('table:not(.ttypography table) tr[style*="background-color"], table:not(.ttypography table) td[style*="background-color"]').forEach(el => {
                const styleStr = el.getAttribute('style') || '';
                if (styleStr.includes('!important')) {
                    el.style.removeProperty('background-color');
                }
            });

            // Strip and eliminate jQuery LavaLamp sliding background artifacts
            document.querySelectorAll(
                '.second-level-menu-list li.back, .second-level-menu-list .back, .second-level-menu-list .left, ' +
                '.menu-list li.back, .menu-list .back, .menu-list .left'
            ).forEach(el => {
                el.style.setProperty('display', 'none', 'important');
                el.style.setProperty('background', 'none', 'important');
                el.style.setProperty('background-image', 'none', 'important');
                el.style.setProperty('opacity', '0', 'important');
            });

            document.querySelectorAll(
                '.second-level-menu-list li.selectedLava, .menu-list li.selectedLava'
            ).forEach(li => {
                [li, ...li.querySelectorAll('*')].forEach(el => {
                    el.style.setProperty('background-image', 'none', 'important');
                    if (el.tagName !== 'A') {
                        el.style.setProperty('background', 'transparent', 'important');
                        el.style.setProperty('background-color', 'transparent', 'important');
                    }
                });
            });
        }
    }

    // Programmatically inject cf-theme.css as a <style> tag at the end of <body>
    // so it has the highest cascade priority over CF's own stylesheets and any
    // SPA-injected styles.
    let ffStyleEl = null;
    let ffCachedCSS = null;

    // Synchronous injection from cache — prevents FOUC on SPA navigations.
    // Falls back to async fetch-and-inject on first call.
    function injectThemeCSS() {
        if (ffCachedCSS) {
            applyStyleTag(ffCachedCSS);
        } else {
            injectThemeCSSAsync();
        }
    }

    function applyStyleTag(css) {
        if (ffStyleEl) ffStyleEl.remove();
        ffStyleEl = document.createElement('style');
        ffStyleEl.id = 'ff-theme-css';
        ffStyleEl.textContent = css;
        (document.body || document.documentElement).appendChild(ffStyleEl);
    }

    const THEME_CSS_MAP = {
        'codeforces.com': 'cf-theme.css',
        'atcoder.jp': 'atcoder-theme.css',
        'codechef.com': 'codechef-theme.css'
    };

    async function injectThemeCSSAsync() {
        try {
            const hostname = window.location.hostname.replace('www.', '');
            const cssFile = THEME_CSS_MAP[hostname] || 'cf-theme.css';
            
            const url = chrome.runtime.getURL(cssFile);
            const res = await fetch(url);
            ffCachedCSS = await res.text();
            applyStyleTag(ffCachedCSS);
        } catch (e) {
            console.warn('FocusForces: could not inject theme CSS', e);
        }
    }

    // Inject CSS once the DOM is ready.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectThemeCSS);
    } else {
        injectThemeCSS();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            ensureThemeApplied();
            // Re-apply Zen now that <body> exists (a document_start apply may
            // have been skipped while the DOM was still being parsed).
            if (zenModeEnabled) applyZenMode(true);
        });
    }

    // Watch for <body> being replaced entirely (some CF pages re-render).
    themeGuard = new MutationObserver(ensureThemeApplied);
    themeGuard.observe(document.documentElement, { childList: true });

    // Re-apply the theme after client-side (History API) navigations so the
    // whole site stays themed when moving between Codeforces pages.
    const wrapHistory = (method) => {
        if (history[method].__ffOriginal) return;
        const original = history[method];
        history[method].__ffOriginal = original;
        history[method] = function (...args) {
            const result = original.apply(this, args);
            applyThemeAttr(currentTheme);
            injectThemeCSS();
            return result;
        };
    };
    wrapHistory('pushState');
    wrapHistory('replaceState');
    if (!window.__ffPopstateListener) {
        window.__ffPopstateListener = true;
        window.addEventListener('popstate', () => {
            applyThemeAttr(currentTheme);
            injectThemeCSS();
        });
    }

    // ── Consolidated Message Dispatcher ─────────────────
    chrome.runtime.onMessage.addListener(req => {
        switch (req.type) {
            case 'THEME_CHANGED':
                applyThemeFromSource(req.theme);
                break;

            case 'TOGGLE_ZEN':
                zenModeEnabled = !!req.enabled;
                applyZenMode(zenModeEnabled);
                break;

            case 'PLAY_TIMER_SOUND':
                playNotificationSound();
                break;
        }
    });

    // ── Storage Change Watcher (reliable theme sync) ─────
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.ff_theme) {
            applyThemeFromSource(changes.ff_theme.newValue);
        }
        if (area === 'local' && changes.ff_zenMode) {
            zenModeEnabled = !!changes.ff_zenMode.newValue;
            applyZenMode(zenModeEnabled);
        }
        if (area === 'local' && changes.ff_zen_width) {
            zenWidthMode = changes.ff_zen_width.newValue || 'comfortable';
            if (zenModeEnabled) {
                document.body.setAttribute('data-ff-zen-width', zenWidthMode);
                updateWidthButtonLabel();
            }
        }
        if (area === 'local' && changes.ff_zen_font_size) {
            zenFontSize = changes.ff_zen_font_size.newValue || 'normal';
            if (zenModeEnabled) {
                document.body.setAttribute('data-ff-zen-size', zenFontSize);
                updateFontButtonLabel();
            }
        }
        if (area === 'local' && changes.ff_zen_companion) {
            zenCompanionVisible = changes.ff_zen_companion.newValue !== false;
            if (zenModeEnabled && zenWorkspaceEl) {
                const isWide = window.innerWidth >= 1360;
                zenWorkspaceEl.classList.toggle('has-companion', isWide && zenCompanionVisible);
                zenWorkspaceEl.classList.toggle('rail-hidden', !isWide || !zenCompanionVisible);
            }
        }
        if (area === 'local' && changes.ff_timer_state) {
            if (zenModeEnabled) {
                updateZenTimerDisplay(changes.ff_timer_state.newValue);
            }
        }
    });

    // ── Unified theme apply function ────────────────────
    // Called by both the message dispatcher and storage watcher so the
    // apply logic is defined once.
    function applyThemeFromSource(theme) {
        currentTheme = theme || 'default';
        if (currentTheme !== 'default') {
            try { localStorage.setItem('ff_theme', currentTheme); } catch (_) {}
        } else {
            try { localStorage.removeItem('ff_theme'); } catch (_) {}
        }
        applyThemeToElements(currentTheme);
        applyThemeAttr(currentTheme);
        if (currentTheme !== 'default') {
            injectThemeCSS();
        } else if (ffStyleEl) {
            ffStyleEl.remove();
            ffStyleEl = null;
        }
    }

    loadTheme();
    // Backup apply in case storage resolves after the first paint.
    ensureThemeApplied();

    // Delayed cleanup to catch LavaLamp jQuery animations and other late JS
    // that Codeforces runs after DOMContentLoaded (e.g. sliding-door tab sprites).
    window.addEventListener('load', () => {
        setTimeout(ensureThemeApplied, 150);
        setTimeout(ensureThemeApplied, 600);
    });

    // ── API Layer ─────────────────────────────────────
    async function fetchProblemFromApi(contestId, index, cancelSignal) {
        const normalizedIndex = index.toUpperCase();
        const withCancel = (timeoutMs) =>
            cancelSignal
                ? AbortSignal.any([cancelSignal, AbortSignal.timeout(timeoutMs)])
                : AbortSignal.timeout(timeoutMs);

        if (contestId !== null) {
            try {
                const res = await fetch(
                    `https://codeforces.com/api/contest.standings?contestId=${contestId}&from=1&count=1`,
                    { signal: withCancel(CONFIG.CONTEST_STANDINGS_TIMEOUT_MS) }
                );
                if (res.ok) {
                    const data = await res.json();
                    if (data.status === 'OK' && Array.isArray(data.result?.problems)) {
                        const problem = data.result.problems.find(p =>
                            String(p.index).toUpperCase() === normalizedIndex
                        );
                        if (problem) return problem;
                    }
                }
            } catch (e) {
                console.debug('contest.standings API failed:', String(e));
            }
        }

        if (!problemCachePromise) {
            problemCachePromise = (async () => {
                try {
                    const res = await fetch(
                        'https://codeforces.com/api/problemset.problems',
                        { signal: withCancel(CONFIG.PROBLEMS_FETCH_TIMEOUT_MS) }
                    );
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const data = await res.json();
                    if (data.status !== 'OK' || !Array.isArray(data.result?.problems)) {
                        throw new Error(data.comment || 'Invalid API response');
                    }
                    return data.result.problems;
                } catch (e) {
                    problemCachePromise = null;
                    throw e;
                }
            })();
        }
        const problems = await problemCachePromise;
        return problems.find(p =>
            String(p.index).toUpperCase() === normalizedIndex &&
            (contestId === null || Number(p.contestId) === contestId)
        );
    }

    function getProblemIdentity() {
        const holder = document.querySelector('.problemindexholder');
        const parts = window.location.pathname.split('/').filter(Boolean);
        let contestId = null, index = holder?.getAttribute('problemindex');

        if (parts[0] === 'problemset' && parts[1] === 'problem') {
            contestId = Number(parts[2]);
            index = index || parts[3];
        } else if (parts[0] === 'contest' || parts[0] === 'gym') {
            contestId = Number(parts[1]);
            index = index || parts[3];
        } else if (parts[0] === 'group' && parts[2] === 'contest') {
            contestId = Number(parts[3]);
            index = index || parts[5];
        }

        return {
            contestId: Number.isFinite(contestId) ? contestId : null,
            index: (index || '').toUpperCase()
        };
    }

    // ── Zen Mode ─────────────────────────────────
    // Zen hides the header, nav bar and sidebar via CSS (body.ff-zen-mode-active)
    // so the problem statement gets the full width. The FocusForces Scout card
    // and the native Problem Tags box are KEPT accessible: they are moved into
    // a small toolbar above the statement while Zen is active, and moved back
    // to the sidebar when it is turned off.

    function findTagBox() {
        const sidebar = document.getElementById('sidebar');
        if (sidebar) {
            const nativeBox = [...sidebar.querySelectorAll('.sidebox')]
                .find(box => {
                    const caption = box.querySelector('.caption');
                    if (!caption) return false;
                    const text = caption.textContent || caption.innerText || '';
                    return /problem\s*tags/i.test(text);
                });
            if (nativeBox) return nativeBox;

            const tagBoxBySpans = [...sidebar.querySelectorAll('.sidebox')]
                .find(box => box.querySelectorAll('span.tag-box').length > 0);
            if (tagBoxBySpans) return tagBoxBySpans;
        }

        const firstTag = document.querySelector('span.tag-box');
        if (firstTag) {
            return firstTag.closest('.roundbox') || firstTag.parentElement;
        }
        return null;
    }

    function getZenKeepBoxes() {
        const boxes = [];
        const scoutCard = document.getElementById('ff-scout-card');
        if (scoutCard) boxes.push(scoutCard);
        const tagBox = findTagBox();
        if (tagBox && !boxes.includes(tagBox)) boxes.push(tagBox);
        return boxes;
    }

    // ── FocusForces Zen Mode 2.0: Distraction-Free Problem Workspace ──
    function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    const WIDTH_MODES = ['compact', 'comfortable', 'expansive'];
    function cycleWidthMode() {
        const nextIdx = (WIDTH_MODES.indexOf(zenWidthMode) + 1) % WIDTH_MODES.length;
        zenWidthMode = WIDTH_MODES[nextIdx];
        document.body.setAttribute('data-ff-zen-width', zenWidthMode);
        updateWidthButtonLabel();
        try { chrome.storage.local.set({ ff_zen_width: zenWidthMode }); } catch (_) {}
    }

    const FONT_MODES = ['normal', 'large', 'xlarge'];
    function cycleFontSize() {
        const nextIdx = (FONT_MODES.indexOf(zenFontSize) + 1) % FONT_MODES.length;
        zenFontSize = FONT_MODES[nextIdx];
        document.body.setAttribute('data-ff-zen-size', zenFontSize);
        updateFontButtonLabel();
        try { chrome.storage.local.set({ ff_zen_font_size: zenFontSize }); } catch (_) {}
    }

    const THEME_CYCLE = ['default', 'dark', 'amoled', 'contrast'];
    function cycleTheme() {
        const nextIdx = (THEME_CYCLE.indexOf(currentTheme) + 1) % THEME_CYCLE.length;
        const nextTheme = THEME_CYCLE[nextIdx];
        applyThemeFromSource(nextTheme);
        try { chrome.storage.local.set({ ff_theme: nextTheme }); } catch (_) {}
    }

    function updateWidthButtonLabel() {
        const labelEl = document.getElementById('ff-zen-width-label');
        if (labelEl) {
            const map = { compact: '780px', comfortable: '920px', expansive: '1080px' };
            labelEl.textContent = map[zenWidthMode] || '920px';
        }
    }

    function updateFontButtonLabel() {
        const labelEl = document.getElementById('ff-zen-font-label');
        if (labelEl) {
            const map = { normal: '100%', large: '110%', xlarge: '120%' };
            labelEl.textContent = map[zenFontSize] || '100%';
        }
    }

    function toggleCompanionRail() {
        if (window.innerWidth >= 1360) {
            zenCompanionVisible = !zenCompanionVisible;
            if (zenWorkspaceEl) {
                zenWorkspaceEl.classList.toggle('has-companion', zenCompanionVisible);
                zenWorkspaceEl.classList.toggle('rail-hidden', !zenCompanionVisible);
            }
            try { chrome.storage.local.set({ ff_zen_companion: zenCompanionVisible }); } catch (_) {}
        } else {
            toggleZenDrawer();
        }
    }

    function toggleZenDrawer() {
        if (zenDrawerEl && zenDrawerEl.isConnected) {
            zenDrawerEl.remove();
            zenDrawerEl = null;
            return;
        }
        zenDrawerEl = document.createElement('div');
        zenDrawerEl.id = 'ff-zen-drawer';
        zenDrawerEl.className = 'ff-zen-drawer';

        const head = document.createElement('div');
        head.className = 'ff-zen-rail-head';
        head.innerHTML = `
            <span class="ff-zen-rail-title">Problem Overview</span>
            <button type="button" class="ff-zen-btn" style="padding:2px 8px; font-weight:bold;">✕</button>
        `;
        head.querySelector('button')?.addEventListener('click', () => {
            zenDrawerEl?.remove();
            zenDrawerEl = null;
        });

        zenDrawerEl.appendChild(head);

        const keepers = getZenKeepBoxes();
        keepers.forEach(box => {
            zenDrawerEl.appendChild(box);
        });

        document.body.appendChild(zenDrawerEl);
    }

    function onQuickSubmitClick() {
        const submitForm = document.querySelector('form.submit-form, form[action$="/submit"]');
        if (submitForm) {
            submitForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
            const area = submitForm.querySelector('textarea, input[type="file"]');
            if (area) area.focus();
            return;
        }

        if (PLATFORM === 'codeforces') {
            const m = window.location.pathname.match(/\/contest\/(\d+)\/problem\/([A-Za-z0-9]+)/);
            if (m) {
                window.location.href = `/contest/${m[1]}/submit/${m[2]}`;
                return;
            }
            const p = window.location.pathname.match(/\/problemset\/problem\/(\d+)\/([A-Za-z0-9]+)/);
            if (p) {
                window.location.href = `/problemset/submit`;
                return;
            }
        }
    }

    async function updateZenTimerDisplay(stateOverride) {
        const timerVal = document.getElementById('ff-zen-timer-val');
        const timerDot = document.getElementById('ff-zen-timer-dot');
        if (!timerVal || !timerDot) return;

        let state = stateOverride;
        if (!state) {
            try {
                const res = await chrome.storage.local.get('ff_timer_state');
                state = res.ff_timer_state;
            } catch (_) {}
        }

        const formatted = (typeof ZenUtils !== 'undefined')
            ? ZenUtils.formatZenTimerBadge(state, Date.now())
            : { text: '25:00', isDanger: false, isRunning: false };

        timerVal.textContent = formatted.text;
        timerDot.classList.toggle('danger', formatted.isDanger);
        timerDot.style.opacity = formatted.isRunning ? '1' : '0.5';
    }

    function onZenScroll() {
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        const scrollHeight = document.documentElement.scrollHeight;
        const clientHeight = document.documentElement.clientHeight;

        const progressBar = document.getElementById('ff-zen-progress-bar');
        if (progressBar) {
            const pct = (typeof ZenUtils !== 'undefined')
                ? ZenUtils.computeScrollProgress(scrollTop, scrollHeight, clientHeight)
                : Math.min(100, Math.round((scrollTop / (scrollHeight - clientHeight)) * 100));
            progressBar.style.width = `${pct}%`;
        }

        if (zenHudEl) {
            zenHudEl.classList.toggle('is-condensed', scrollTop > 48);
        }
    }

    function onZenKeyDown(e) {
        if (!zenModeEnabled) return;
        const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
        if (activeTag === 'input' || activeTag === 'textarea' || document.activeElement?.isContentEditable) {
            return;
        }

        if (e.key === 'Escape' || e.key === 'z' || e.key === 'Z') {
            e.preventDefault();
            zenModeEnabled = false;
            applyZenMode(false);
            try { chrome.storage.local.set({ ff_zenMode: false }); } catch (_) {}
            return;
        }

        if (e.key === 'p' || e.key === 'P') {
            e.preventDefault();
            toggleCompanionRail();
            return;
        }

        if (e.key === '[' || e.key === ']') {
            e.preventDefault();
            cycleWidthMode();
        }
    }

    function attachSampleCopyButtons() {
        const inputs = document.querySelectorAll('.sample-test .input, .sample-tests .input');
        const outputs = document.querySelectorAll('.sample-test .output, .sample-tests .output');

        const attach = (container, type) => {
            if (container.querySelector('.ff-zen-copy-btn')) return;
            const titleEl = container.querySelector('.title');
            const preEl = container.querySelector('pre');
            if (!preEl) return;

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'ff-zen-copy-btn';
            btn.innerHTML = `
                <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                <span>Copy</span>
            `;
            btn.title = `Copy ${type} to clipboard`;

            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const text = (typeof ZenUtils !== 'undefined')
                    ? ZenUtils.cleanSampleText(preEl.textContent)
                    : preEl.textContent.trim();
                try {
                    await navigator.clipboard.writeText(text);
                    btn.classList.add('copied');
                    btn.querySelector('span').textContent = '✓ Copied!';
                    setTimeout(() => {
                        btn.classList.remove('copied');
                        btn.querySelector('span').textContent = 'Copy';
                    }, 1800);
                } catch (err) {
                    console.debug('Failed to copy sample test', err);
                }
            });

            if (titleEl) {
                titleEl.appendChild(btn);
            } else {
                container.insertBefore(btn, container.firstChild);
            }
        };

        inputs.forEach(el => attach(el, 'input'));
        outputs.forEach(el => attach(el, 'output'));

        // AtCoder pre blocks
        if (PLATFORM === 'atcoder') {
            document.querySelectorAll('div.part').forEach(part => {
                const h3 = part.querySelector('h3');
                const pre = part.querySelector('pre');
                if (h3 && pre && h3.textContent.toLowerCase().includes('sample')) {
                    if (part.querySelector('.ff-zen-copy-btn')) return;
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'ff-zen-copy-btn';
                    btn.style.marginLeft = 'auto';
                    btn.innerHTML = `<span>Copy</span>`;
                    btn.addEventListener('click', async () => {
                        await navigator.clipboard.writeText(pre.textContent.trim());
                        btn.classList.add('copied');
                        btn.textContent = '✓ Copied!';
                        setTimeout(() => { btn.classList.remove('copied'); btn.textContent = 'Copy'; }, 1800);
                    });
                    h3.style.display = 'flex';
                    h3.style.alignItems = 'center';
                    h3.appendChild(btn);
                }
            });
        }
    }

    function enhanceProblemHeader() {
        if (document.querySelector('.ff-zen-header-card')) return;
        const origHeader = document.querySelector('.problem-statement .header');
        if (!origHeader) return;

        const titleEl = origHeader.querySelector('.title');
        const timeEl = origHeader.querySelector('.time-limit');
        const memEl = origHeader.querySelector('.memory-limit');
        const inEl = origHeader.querySelector('.input-file');
        const outEl = origHeader.querySelector('.output-file');

        const titleText = titleEl ? titleEl.textContent.trim() : '';
        const probSnippetEl = document.getElementById('ff-zen-prob-title');
        if (probSnippetEl && titleText) probSnippetEl.textContent = titleText;

        const meta = (typeof ZenUtils !== 'undefined')
            ? ZenUtils.extractCodeforcesProblemMeta(origHeader)
            : {
                timeLimit: timeEl ? timeEl.textContent.replace(/.*test:\s*/i, '').trim() : '1.0 s',
                memoryLimit: memEl ? memEl.textContent.replace(/.*test:\s*/i, '').trim() : '256 MB',
                inputType: inEl ? inEl.textContent.replace(/.*input:\s*/i, '').trim() : 'standard input',
                outputType: outEl ? outEl.textContent.replace(/.*output:\s*/i, '').trim() : 'standard output'
            };

        let contestName = '';
        const contestLink = document.querySelector('a[href*="/contest/"]');
        if (contestLink && contestLink.textContent) contestName = contestLink.textContent.trim();

        const card = document.createElement('div');
        card.className = 'ff-zen-header-card';

        if (contestName) {
            const metaRow = document.createElement('div');
            metaRow.className = 'ff-zen-meta-row';
            const badge = document.createElement('span');
            badge.className = 'ff-zen-contest-badge';
            badge.textContent = contestName;
            metaRow.appendChild(badge);
            card.appendChild(metaRow);
        }

        const h1 = document.createElement('h1');
        h1.className = 'ff-zen-title';
        h1.textContent = titleText || 'Problem';
        card.appendChild(h1);

        const limitsRow = document.createElement('div');
        limitsRow.className = 'ff-zen-limits-row';

        if (meta.timeLimit) {
            const timePill = document.createElement('span');
            timePill.className = 'ff-zen-limit-pill';
            timePill.title = 'Time limit per test';
            timePill.textContent = `⏱️ ${meta.timeLimit}`;
            limitsRow.appendChild(timePill);
        }

        if (meta.memoryLimit) {
            const memPill = document.createElement('span');
            memPill.className = 'ff-zen-limit-pill';
            memPill.title = 'Memory limit per test';
            memPill.textContent = `💾 ${meta.memoryLimit}`;
            limitsRow.appendChild(memPill);
        }

        const ioPill = document.createElement('span');
        ioPill.className = 'ff-zen-limit-pill';
        ioPill.title = 'Input / Output stream';
        ioPill.textContent = `📥 ${meta.inputType} · ${meta.outputType}`;
        limitsRow.appendChild(ioPill);

        card.appendChild(limitsRow);

        origHeader.parentNode.insertBefore(card, origHeader);
        origHeader.style.display = 'none';
    }

    function buildTableOfContents() {
        const tocEl = document.getElementById('ff-zen-toc');
        if (!tocEl) return;
        tocEl.replaceChildren();

        const sections = [
            { id: 'ff-sec-statement', label: 'Statement', selector: '.legend, div.part:first-of-type' },
            { id: 'ff-sec-input', label: 'Input Spec', selector: '.input-specification, div.part:has(h3)' },
            { id: 'ff-sec-output', label: 'Output Spec', selector: '.output-specification' },
            { id: 'ff-sec-samples', label: 'Examples', selector: '.sample-test, .sample-tests, div.part:has(pre)' },
            { id: 'ff-sec-note', label: 'Notes', selector: '.note' }
        ];

        let foundAny = false;
        sections.forEach(({ id, label, selector }) => {
            const el = document.querySelector(selector);
            if (el) {
                el.id = id;
                const link = document.createElement('a');
                link.href = `#${id}`;
                link.className = 'ff-zen-toc-link';
                link.textContent = label;
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                });
                tocEl.appendChild(link);
                foundAny = true;
            }
        });

        const tocCard = tocEl.closest('.ff-zen-rail-card');
        if (tocCard) tocCard.style.display = foundAny ? '' : 'none';
    }

    function buildZenRail() {
        if (zenRailEl && zenRailEl.isConnected) return zenRailEl;
        zenRailEl = document.createElement('aside');
        zenRailEl.id = 'ff-zen-rail';
        zenRailEl.className = 'ff-zen-rail';
        zenRailEl.setAttribute('aria-label', 'Problem Companion');

        // 1. Table of Contents / Section Jump
        const tocCard = document.createElement('div');
        tocCard.className = 'ff-zen-rail-card';
        tocCard.innerHTML = `
            <div class="ff-zen-rail-head">
                <span class="ff-zen-rail-title">Jump to Section</span>
            </div>
            <nav class="ff-zen-toc" id="ff-zen-toc"></nav>
        `;

        // 2. Scout Card Dock
        const scoutDock = document.createElement('div');
        scoutDock.className = 'ff-zen-rail-card';
        scoutDock.id = 'ff-zen-rail-scout';
        scoutDock.style.display = 'none';

        // 3. Problem Tags Dock
        const tagsDock = document.createElement('div');
        tagsDock.className = 'ff-zen-rail-card';
        tagsDock.id = 'ff-zen-rail-tags';
        tagsDock.style.display = 'none';

        // 4. Quick Submit Button
        const submitCard = document.createElement('div');
        submitCard.className = 'ff-zen-rail-card ff-zen-rail-submit';
        submitCard.innerHTML = `
            <button type="button" class="ff-zen-submit-btn" id="ff-zen-quick-submit" title="Jump to Submission">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
                <span>Submit Solution</span>
            </button>
        `;
        submitCard.querySelector('#ff-zen-quick-submit')?.addEventListener('click', onQuickSubmitClick);

        zenRailEl.append(tocCard, scoutDock, tagsDock, submitCard);
        return zenRailEl;
    }

    function ensureZenHud() {
        if (zenHudEl && zenHudEl.isConnected) return zenHudEl;
        zenHudEl = document.createElement('header');
        zenHudEl.id = 'ff-zen-hud';
        zenHudEl.className = 'ff-zen-hud';
        zenHudEl.setAttribute('role', 'banner');
        zenHudEl.setAttribute('aria-label', 'Zen Mode Toolbar');

        const inner = document.createElement('div');
        inner.className = 'ff-zen-hud-inner';

        // Left: Zen badge + Focus timer pill
        const left = document.createElement('div');
        left.className = 'ff-zen-hud-left';
        left.innerHTML = `
            <div class="ff-zen-pill" title="Zen Mode Active: Distraction-free problem solving">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2Z"/>
                    <circle cx="12" cy="12" r="2.5"/>
                </svg>
                <span>Zen Mode</span>
            </div>
            <div class="ff-zen-timer-pill" id="ff-zen-timer-pill" title="Focus Chronometer">
                <span class="ff-zen-timer-dot" id="ff-zen-timer-dot" aria-hidden="true"></span>
                <span class="ff-zen-timer-val" id="ff-zen-timer-val">25:00</span>
            </div>
        `;

        // Center: Problem title snippet
        const center = document.createElement('div');
        center.className = 'ff-zen-hud-center';
        center.innerHTML = `<span class="ff-zen-prob-title" id="ff-zen-prob-title"></span>`;

        // Right: Width, Font, Companion toggle, Theme cycle, Exit button
        const right = document.createElement('div');
        right.className = 'ff-zen-hud-right';
        right.innerHTML = `
            <button type="button" class="ff-zen-btn" id="ff-zen-width-btn" title="Reading Canvas Width (Shortcut: [ or ])">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12H3m0 0 4-4m-4 4 4 4m14-4-4-4m4 4-4 4"/></svg>
                <span id="ff-zen-width-label">Comfortable</span>
            </button>
            <button type="button" class="ff-zen-btn" id="ff-zen-font-btn" title="Font Size Scaling">
                <span style="font-weight:700; font-size:12px;">Aa</span>
                <span id="ff-zen-font-label">100%</span>
            </button>
            <button type="button" class="ff-zen-btn" id="ff-zen-rail-btn" title="Toggle Problem Overview Rail (Shortcut: P)">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/></svg>
                <span>Overview</span>
            </button>
            <button type="button" class="ff-zen-btn" id="ff-zen-theme-btn" title="Cycle Theme (Paper · Midnight · Ink · Studio)">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
            </button>
            <button type="button" class="ff-zen-btn ff-zen-btn-exit" id="ff-zen-exit-btn" title="Exit Zen Mode (Shortcut: Esc or Z)">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
                <span>Exit</span>
                <kbd class="ff-zen-kbd">Esc</kbd>
            </button>
        `;

        const progressBar = document.createElement('div');
        progressBar.id = 'ff-zen-progress-bar';
        progressBar.className = 'ff-zen-progress-bar';
        progressBar.style.width = '0%';

        inner.append(left, center, right);
        zenHudEl.append(inner, progressBar);

        inner.querySelector('#ff-zen-width-btn')?.addEventListener('click', cycleWidthMode);
        inner.querySelector('#ff-zen-font-btn')?.addEventListener('click', cycleFontSize);
        inner.querySelector('#ff-zen-rail-btn')?.addEventListener('click', toggleCompanionRail);
        inner.querySelector('#ff-zen-theme-btn')?.addEventListener('click', cycleTheme);
        inner.querySelector('#ff-zen-exit-btn')?.addEventListener('click', () => {
            zenModeEnabled = false;
            applyZenMode(false);
            try { chrome.storage.local.set({ ff_zenMode: false }); } catch (_) {}
        });

        document.body.appendChild(zenHudEl);
        updateWidthButtonLabel();
        updateFontButtonLabel();
        return zenHudEl;
    }

    function setupZenWorkspace(enabled) {
        if (enabled) {
            if (zenWorkspaceEl && zenWorkspaceEl.isConnected) return;

            zenTargetNode = document.querySelector('.problem-statement')
                || document.getElementById('task-statement')
                || document.querySelector('.problem-description')
                || document.getElementById('content');

            if (!zenTargetNode) return;

            zenTargetOrigParent = zenTargetNode.parentNode;
            zenTargetOrigSibling = zenTargetNode.nextSibling;

            zenWorkspaceEl = document.createElement('div');
            zenWorkspaceEl.id = 'ff-zen-workspace';
            zenWorkspaceEl.className = 'ff-zen-workspace';

            zenCanvasEl = document.createElement('main');
            zenCanvasEl.id = 'ff-zen-canvas';
            zenCanvasEl.className = 'ff-zen-canvas';
            zenCanvasEl.setAttribute('role', 'main');

            zenTargetOrigParent.insertBefore(zenWorkspaceEl, zenTargetOrigSibling);
            zenCanvasEl.appendChild(zenTargetNode);
            zenWorkspaceEl.appendChild(zenCanvasEl);

            zenRailEl = buildZenRail();
            zenWorkspaceEl.appendChild(zenRailEl);

            const isWide = window.innerWidth >= 1360;
            zenWorkspaceEl.classList.toggle('has-companion', isWide && zenCompanionVisible);
            zenWorkspaceEl.classList.toggle('rail-hidden', !isWide || !zenCompanionVisible);

            buildTableOfContents();
            relocateZenBoxes(true);
            enhanceProblemHeader();
            attachSampleCopyButtons();
        } else {
            if (zenTargetNode && zenTargetOrigParent && zenTargetOrigParent.isConnected) {
                zenTargetOrigParent.insertBefore(zenTargetNode, zenWorkspaceEl);
            }
            if (zenWorkspaceEl) {
                zenWorkspaceEl.remove();
                zenWorkspaceEl = null;
                zenCanvasEl = null;
                zenRailEl = null;
            }
            zenTargetNode = null;
            zenTargetOrigParent = null;
            zenTargetOrigSibling = null;

            const headerCard = document.querySelector('.ff-zen-header-card');
            if (headerCard) headerCard.remove();
            const origHeader = document.querySelector('.problem-statement .header');
            if (origHeader) origHeader.style.display = '';

            document.querySelectorAll('.ff-zen-copy-btn').forEach(btn => btn.remove());
        }
    }

    function relocateZenBoxes(enabled) {
        if (PLATFORM !== 'codeforces') return;
        if (enabled) {
            const keepers = getZenKeepBoxes();
            keepers.forEach(box => {
                if (!zenRelocated.some(r => r.box === box)) {
                    zenRelocated.push({ box, parent: box.parentNode, next: box.nextSibling });
                }
                if (zenRailEl && zenRailEl.isConnected) {
                    if (box.id === 'ff-scout-card') {
                        const dock = document.getElementById('ff-zen-rail-scout');
                        if (dock) { dock.style.display = ''; dock.appendChild(box); }
                    } else {
                        const dock = document.getElementById('ff-zen-rail-tags');
                        if (dock) { dock.style.display = ''; dock.appendChild(box); }
                    }
                }
            });
        } else if (zenRelocated.length) {
            zenRelocated.forEach(({ box, parent, next }) => {
                if (parent && parent.isConnected) {
                    parent.insertBefore(box, next);
                } else {
                    const sidebar = document.getElementById('sidebar');
                    (sidebar || document.body).appendChild(box);
                }
            });
            zenRelocated = [];
            if (zenDrawerEl) {
                zenDrawerEl.remove();
                zenDrawerEl = null;
            }
        }
    }

    function applyZenMode(enabled) {
        if (!document.body) return;

        document.body.classList.toggle('ff-zen-mode-active', enabled);

        if (enabled) {
            document.body.setAttribute('data-ff-zen-width', zenWidthMode);
            document.body.setAttribute('data-ff-zen-size', zenFontSize);
        } else {
            document.body.removeAttribute('data-ff-zen-width');
            document.body.removeAttribute('data-ff-zen-size');
        }

        CONFIG.ZEN_SELECTORS.forEach(sel => {
            document.querySelectorAll(sel).forEach(el => {
                el.classList.toggle('ff-zen-hidden', enabled);
            });
        });

        if (enabled) {
            ensureZenHud();
            setupZenWorkspace(true);

            if (!zenScrollListener) {
                zenScrollListener = onZenScroll;
                window.addEventListener('scroll', zenScrollListener, { passive: true });
            }
            if (!zenKeydownListener) {
                zenKeydownListener = onZenKeyDown;
                window.addEventListener('keydown', zenKeydownListener);
            }
            if (!zenTimerInterval) {
                updateZenTimerDisplay();
                zenTimerInterval = setInterval(() => updateZenTimerDisplay(), 1000);
            }

            const titleEl = document.querySelector('.ff-zen-title') || document.querySelector('.title') || document.querySelector('h2');
            const snippet = document.getElementById('ff-zen-prob-title');
            if (snippet && titleEl) {
                snippet.textContent = titleEl.textContent.trim();
            }
        } else {
            setupZenWorkspace(false);
            relocateZenBoxes(false);

            if (zenHudEl) {
                zenHudEl.remove();
                zenHudEl = null;
            }
            if (zenDrawerEl) {
                zenDrawerEl.remove();
                zenDrawerEl = null;
            }
            if (zenScrollListener) {
                window.removeEventListener('scroll', zenScrollListener);
                zenScrollListener = null;
            }
            if (zenKeydownListener) {
                window.removeEventListener('keydown', zenKeydownListener);
                zenKeydownListener = null;
            }
            if (zenTimerInterval) {
                clearInterval(zenTimerInterval);
                zenTimerInterval = null;
            }
        }
    }

    (async () => {
        try {
            const stored = await chrome.storage.local.get({
                ff_zenMode: false,
                ff_zen_width: 'comfortable',
                ff_zen_font_size: 'normal',
                ff_zen_companion: true
            });
            zenModeEnabled = !!stored.ff_zenMode;
            zenWidthMode = stored.ff_zen_width || 'comfortable';
            zenFontSize = stored.ff_zen_font_size || 'normal';
            zenCompanionVisible = stored.ff_zen_companion !== false;

            if (zenModeEnabled) applyZenMode(true);
        } catch (e) {
            console.debug('FocusForces: failed to load zen mode state', e);
        }
    })();

    // ── Tag Toggler (Scout) ─────────────────────────
    function initTagToggler() {
        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return;

        let card = document.getElementById('ff-scout-card');
        if (!card) {
            card = document.createElement('div');
            card.className = 'roundbox sidebox';
            card.id = 'ff-scout-card';
            card.setAttribute('data-ff-theme', currentTheme);

            const lt = document.createElement('div');
            lt.className = 'roundbox-lt';
            lt.textContent = '\u00A0';
            const rt = document.createElement('div');
            rt.className = 'roundbox-rt';
            rt.textContent = '\u00A0';

            const caption = document.createElement('div');
            caption.className = 'caption titled';
            caption.append(document.createTextNode('\u2192 Scout'));
            const topLinks = document.createElement('div');
            topLinks.className = 'top-links';
            caption.appendChild(topLinks);

            const body = document.createElement('div');
            body.style.cssText = 'padding:1em; text-align:center;';

            const topicsDiv = document.createElement('div');
            topicsDiv.id = 'ff-scout-topics';
            topicsDiv.className = 'ff-scout-tag-container ff-hidden';

            const ratingDiv = document.createElement('div');
            ratingDiv.id = 'ff-scout-rating';
            ratingDiv.className = 'ff-scout-tag-container ff-hidden';

            const noTags = document.createElement('div');
            noTags.id = 'ff-scout-no-tags';
            noTags.className = 'ff-scout-no-tags';
            noTags.textContent = 'Analyzing problem...';

            const btns = document.createElement('div');
            btns.className = 'ff-scout-buttons';

            const btnR = document.createElement('button');
            btnR.type = 'button';
            btnR.className = 'ff-scout-btn';
            btnR.id = 'ff-scout-btn-rating';
            btnR.disabled = true;
            btnR.textContent = 'Get Rating';

            const btnT = document.createElement('button');
            btnT.type = 'button';
            btnT.className = 'ff-scout-btn';
            btnT.id = 'ff-scout-btn-topics';
            btnT.disabled = true;
            btnT.textContent = 'Get Tags';

            btns.append(btnR, btnT);
            body.append(topicsDiv, ratingDiv, noTags, btns);
            card.append(lt, rt, caption, body);
            sidebar.appendChild(card);
        }

        const topicsContainer = card.querySelector('#ff-scout-topics');
        const ratingContainer = card.querySelector('#ff-scout-rating');
        const btnTopics = card.querySelector('#ff-scout-btn-topics');
        const btnRating = card.querySelector('#ff-scout-btn-rating');
        const noTagsLabel = card.querySelector('#ff-scout-no-tags');

        let tagsProcessed = false;
        let topicsVisible = false;
        let ratingVisible = false;

        const createTagElement = (tag, isRating) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'roundbox borderTopRound borderBottomRound';
            wrapper.style.cssText = 'margin:2px; padding:4px 8px; float:left;';
            const span = document.createElement('span');
            span.className = 'tag-box';
            span.style.fontSize = '12px';
            span.textContent = isRating ? `*${tag}` : tag;
            wrapper.appendChild(span);
            return wrapper;
        };

        const clearContainers = () => {
            topicsContainer.replaceChildren();
            ratingContainer.replaceChildren();
            topicsVisible = ratingVisible = false;
            btnTopics.disabled = btnRating.disabled = true;
            btnTopics.textContent = 'Get Tags';
            btnRating.textContent = 'Get Rating';
            topicsContainer.classList.add('ff-hidden');
            ratingContainer.classList.add('ff-hidden');
        };

        const markProcessed = (hasTopics, hasRating) => {
            noTagsLabel.classList.add('ff-hidden');
            if (hasTopics) btnTopics.disabled = false;
            if (hasRating) btnRating.disabled = false;
        };

        let apiFailed = false;

        const processTagsFromDOM = () => {
            if (tagsProcessed) return true;

            const tagBox = findTagBox();
            if (!tagBox) return false;

            const tags = [...tagBox.querySelectorAll('span.tag-box')];
            if (!tags.length) return false;

            if (tagBox.classList.contains('sidebox')) {
                tagBox.style.display = 'none';
            }

            clearContainers();
            let hasTopics = false, hasRating = false;

            tags.forEach(tag => {
                const title = (tag.getAttribute('title') || '').toLowerCase();
                const text = tag.textContent.trim();
                const cloned = (tag.closest('.roundbox') || tag).cloneNode(true);
                if (title === 'difficulty' || text.startsWith('*')) {
                    ratingContainer.appendChild(cloned);
                    hasRating = true;
                } else {
                    topicsContainer.appendChild(cloned);
                    hasTopics = true;
                }
            });

            markProcessed(hasTopics, hasRating);
            tagsProcessed = true;
            return true;
        };

        // Clean up any previous polling/observer from a prior initTagToggler call.
        if (ffPoll) { clearInterval(ffPoll); ffPoll = null; }
        if (ffObs) { ffObs.disconnect(); ffObs = null; }
        if (ffAbortCtrl) { ffAbortCtrl.abort(); ffAbortCtrl = null; }
        if (ffTimeout) { clearTimeout(ffTimeout); ffTimeout = null; }

        const stopPolling = () => {
            if (ffPoll) { clearInterval(ffPoll); ffPoll = null; }
            if (ffObs) { ffObs.disconnect(); ffObs = null; }
        };

        const onTagsFoundFromDom = () => {
            ffAbortCtrl?.abort();
            stopPolling();
        };

        const loadTagsFromApi = async () => {
            if (tagsProcessed) return;

            if (processTagsFromDOM()) {
                onTagsFoundFromDom();
                return;
            }

            apiFailed = false;
            noTagsLabel.textContent = 'Fetching from API...';
            btnTopics.disabled = btnRating.disabled = true;
            btnTopics.classList.add('loading');
            btnRating.classList.add('loading');

        ffAbortCtrl = new AbortController();
        const { signal } = ffAbortCtrl;

        try {
            const { contestId, index } = getProblemIdentity();
            if (!index) throw new Error('No index');

            const problem = await fetchProblemFromApi(contestId, index, signal);
            if (!problem) throw new Error('Not found');
            if (tagsProcessed) return;

            clearContainers();
            let hasTopics = false, hasRating = false;

            (problem.tags || []).forEach(tag => {
                topicsContainer.appendChild(createTagElement(tag));
                hasTopics = true;
            });

            if (Number.isFinite(problem.rating)) {
                ratingContainer.appendChild(createTagElement(problem.rating, true));
                hasRating = true;
            }

            markProcessed(hasTopics, hasRating);
            tagsProcessed = true;
            stopPolling();
            if (!hasTopics && !hasRating) noTagsLabel.textContent = 'No data available.';
        } catch (e) {
            if (e.name === 'AbortError') return;
            console.debug(e);
            apiFailed = true;
            btnTopics.disabled = btnRating.disabled = false;
            noTagsLabel.textContent = 'Tap buttons to load.';
        } finally {
            btnTopics.classList.remove('loading');
            btnRating.classList.remove('loading');
        }
    };

    const handleTopicsClick = () => {
        if (apiFailed && !topicsContainer.childElementCount) {
            tagsProcessed = false;
            problemCachePromise = null;
            loadTagsFromApi();
            return;
        }
        if (topicsContainer.childElementCount) {
            topicsVisible = !topicsVisible;
            topicsContainer.classList.toggle('ff-hidden', !topicsVisible);
            btnTopics.textContent = topicsVisible ? 'Hide Tags' : 'Get Tags';
            return;
        }
        if (tagsProcessed && !topicsContainer.childElementCount) {
            btnTopics.disabled = true;
            btnTopics.textContent = 'No Tags';
        }
    };

    const handleRatingClick = () => {
        if (apiFailed && !ratingContainer.childElementCount) {
            tagsProcessed = false;
            problemCachePromise = null;
            loadTagsFromApi();
            return;
        }
        if (ratingContainer.childElementCount) {
            ratingVisible = !ratingVisible;
            ratingContainer.classList.toggle('ff-hidden', !ratingVisible);
            btnRating.textContent = ratingVisible ? 'Hide Rating' : 'Get Rating';
            return;
        }
        if (tagsProcessed && !ratingContainer.childElementCount) {
            btnRating.disabled = true;
            btnRating.textContent = 'No Rating';
        }
    };

    btnTopics.addEventListener('click', handleTopicsClick);
    btnRating.addEventListener('click', handleRatingClick);

    ffObs = new MutationObserver(() => {
        if (processTagsFromDOM()) onTagsFoundFromDom();
    });
    ffPoll = setInterval(() => {
        if (processTagsFromDOM()) onTagsFoundFromDom();
    }, CONFIG.TAGS_POLL_INTERVAL_MS);
    ffTimeout = setTimeout(stopPolling, CONFIG.TAGS_POLL_MAX_MS);
    ffObs.observe(document.body, { childList: true, subtree: true });
    loadTagsFromApi();
}

    // ── Init ───────────────────────────────────────
    // initTagToggler must wait for DOMContentLoaded because it queries
    // #sidebar and other DOM elements that don't exist at document_start.
    function startScout() {
        if (IS_CF && window.location.pathname.toLowerCase().includes('/problem/')) {
            initTagToggler();
        }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startScout);
    } else {
        startScout();
    }
})();
