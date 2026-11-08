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
    const CONFIG = {
        ZEN_SELECTORS: IS_CF ? [
            '.community-stats-box',
            '.roundbox.menu-box:not(:first-child)',
            '#header > div:first-child',
            '.news-item',
            '.footer'
        ] : [],
        PROBLEMS_FETCH_TIMEOUT_MS: 15000,
        CONTEST_STANDINGS_TIMEOUT_MS: 5000,
        TAGS_POLL_INTERVAL_MS: 300,
        TAGS_POLL_MAX_MS: 8000
    };

    // ── State ──────────────────────────────────────────
    let zenModeEnabled = false;
    let problemCachePromise = null;
    let cachedAudioCtx = null;
    let currentTheme = 'default';
    let ffPoll = null;
    let ffObs = null;
    let ffAbortCtrl = null;
    let ffTimeout = null;
    let themeGuard = null;

    // Zen relocation bookkeeping: [{ box, parent, next }] for the sideboxes
    // moved into the Zen toolbar, and the toolbar element itself.
    let zenRelocated = [];
    let zenToolbarEl = null;

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
                if (IS_CF) {
                    zenModeEnabled = !!req.enabled;
                    applyZenMode(zenModeEnabled);
                }
                break;

            case 'PLAY_TIMER_SOUND':
                playNotificationSound();
                break;
        }
    });

    // ── Storage Change Watcher (reliable theme sync) ─────
    // chrome.storage.onChanged fires in ALL extension contexts whenever
    // storage values change. This provides a more reliable path for theme
    // sync compared to chrome.runtime messaging, which can fail silently
    // (e.g., when tab queries return no results).
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.ff_theme) {
            applyThemeFromSource(changes.ff_theme.newValue);
        }
        if (area === 'local' && changes.ff_zenMode) {
            zenModeEnabled = !!changes.ff_zenMode.newValue;
            applyZenMode(zenModeEnabled);
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

    function ensureZenToolbar() {
        if (zenToolbarEl && zenToolbarEl.isConnected) return zenToolbarEl;
        zenToolbarEl = document.createElement('div');
        zenToolbarEl.id = 'ff-zen-toolbar';
        zenToolbarEl.className = 'ff-zen-toolbar';

        // Add a sleek HUD bar with mode indicator and one-click exit
        const bar = document.createElement('div');
        bar.className = 'ff-zen-bar';

        const badge = document.createElement('div');
        badge.className = 'ff-zen-badge';
        badge.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13" aria-hidden="true">
                <path d="M2.6 12S6.1 6.6 12 6.6 21.4 12 21.4 12 17.9 17.4 12 17.4 2.6 12 2.6 12Z"/>
                <circle cx="12" cy="12" r="2.5"/>
            </svg>
            <span>Zen Mode Active</span>
        `;

        const exitBtn = document.createElement('button');
        exitBtn.type = 'button';
        exitBtn.className = 'ff-zen-exit-btn';
        exitBtn.title = 'Exit Zen Mode';
        exitBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
            <span>Exit Zen</span>
        `;
        exitBtn.addEventListener('click', () => {
            zenModeEnabled = false;
            applyZenMode(false);
            try { chrome.storage.local.set({ ff_zenMode: false }); } catch (_) {}
        });

        bar.append(badge, exitBtn);
        zenToolbarEl.appendChild(bar);

        const pageContent = document.getElementById('pageContent')
            || document.querySelector('.content-with-sidebar')
            || document.getElementById('content');
        if (pageContent) {
            pageContent.insertBefore(zenToolbarEl, pageContent.firstChild);
        } else {
            document.body.appendChild(zenToolbarEl);
        }
        return zenToolbarEl;
    }

    function relocateZenBoxes(enabled) {
        if (!IS_CF) return;
        if (enabled) {
            // Only relocate boxes not already moved (idempotent; also lets the
            // Scout card, created later by initTagToggler, be picked up).
            const keepers = getZenKeepBoxes().filter(box =>
                !zenRelocated.some(r => r.box === box)
            );
            if (!keepers.length) return;
            const toolbar = ensureZenToolbar();
            keepers.forEach(box => {
                zenRelocated.push({ box, parent: box.parentNode, next: box.nextSibling });
                toolbar.appendChild(box);
            });
        } else if (zenRelocated.length) {
            zenRelocated.forEach(({ box, parent, next }) => {
                if (parent && parent.isConnected) {
                    parent.insertBefore(box, next);
                } else {
                    // The original container vanished (SPA navigation); return
                    // the box to the current sidebar so it isn't lost.
                    const sidebar = document.getElementById('sidebar');
                    (sidebar || document.body).appendChild(box);
                }
            });
            zenRelocated = [];
            if (zenToolbarEl) {
                zenToolbarEl.remove();
                zenToolbarEl = null;
            }
        }
    }

    function applyZenMode(enabled) {
        // document.body may not exist yet at document_start (storage resolves
        // before <body> parses on slow loads) — the DOMContentLoaded handler
        // re-applies Zen as soon as the DOM is ready.
        if (!document.body) return;

        document.body.classList.toggle('ff-zen-mode-active', enabled);

        CONFIG.ZEN_SELECTORS.forEach(sel => {
            document.querySelectorAll(sel).forEach(el => {
                el.classList.toggle('ff-zen-hidden', enabled);
            });
        });

        relocateZenBoxes(enabled);
    }

    (async () => {
        try {
            const { ff_zenMode } = await chrome.storage.local.get('ff_zenMode');
            zenModeEnabled = !!ff_zenMode;
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
