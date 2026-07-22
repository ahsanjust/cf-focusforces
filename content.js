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
        if (scoutCard) scoutCard.setAttribute('data-theme', theme);
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

            // Strip sliding-door sprite backgrounds from active/back tabs in profile nav.
            document.querySelectorAll(
                '.second-level-menu-list li.back, .second-level-menu-list li.selectedLava, ' +
                '.menu-list li.back, .menu-list li.selectedLava'
            ).forEach(li => {
                [li, ...li.querySelectorAll('*')].forEach(el => {
                    el.style.setProperty('background-image', 'none', 'important');
                    if (el.tagName === 'A' || el.tagName === 'LI') {
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
        document.addEventListener('DOMContentLoaded', ensureThemeApplied);
    }

    // Watch for <body> being replaced entirely (some CF pages re-render).
    const themeGuard = new MutationObserver(ensureThemeApplied);
    themeGuard.observe(document.documentElement, { childList: true });

    // Re-apply the theme after client-side (History API) navigations so the
    // whole site stays themed when moving between Codeforces pages.
    const wrapHistory = (method) => {
        const original = history[method];
        history[method] = function (...args) {
            const result = original.apply(this, args);
            applyThemeAttr(currentTheme);
            injectThemeCSS();
            return result;
        };
    };
    wrapHistory('pushState');
    wrapHistory('replaceState');
    window.addEventListener('popstate', () => {
        applyThemeAttr(currentTheme);
        injectThemeCSS();
    });

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
    function applyZenMode(enabled) {
        CONFIG.ZEN_SELECTORS.forEach(sel => {
            document.querySelectorAll(sel).forEach(el => {
                el.classList.toggle('ff-zen-hidden', enabled);
            });
        });

        const sidebar = document.getElementById('sidebar');
        if (sidebar) {
            sidebar.querySelectorAll('.sidebox').forEach(box => {
                const txt = box.textContent.toLowerCase();
                const keep = txt.includes('problem tags') ||
                    txt.includes('ff scout');
                box.classList.toggle('ff-zen-hidden', enabled && !keep);
            });
        }
    }

    (async () => {
        try {
            const { zenMode } = await chrome.storage.local.get('zenMode');
            zenModeEnabled = !!zenMode;
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
            card.setAttribute('data-theme', currentTheme);
            card.innerHTML = `
                <div class="roundbox-lt">&nbsp;</div>
                <div class="roundbox-rt">&nbsp;</div>
                <div class="caption titled">&rarr; Scout
                    <div class="top-links"></div>
                </div>
                <div style="padding:1em; text-align:center;">
                    <div id="ff-scout-topics" class="ff-scout-tag-container ff-hidden"></div>
                    <div id="ff-scout-rating" class="ff-scout-tag-container ff-hidden"></div>
                    <div id="ff-scout-no-tags" style="color:#777; font-size:12px; margin-bottom:8px;">Analyzing problem...</div>
                    <div class="ff-scout-buttons">
                        <button type="button" class="ff-scout-btn" id="ff-scout-btn-rating" disabled>Get Rating</button>
                        <button type="button" class="ff-scout-btn" id="ff-scout-btn-topics" disabled>Get Tags</button>
                    </div>
                </div>
            `;
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
            topicsContainer.innerHTML = '';
            ratingContainer.innerHTML = '';
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

        const findTagBox = () => {
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
        };

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

        let apiAbortController = null;
        let poll, obs;

        const stopPolling = () => {
            clearInterval(poll);
            obs.disconnect();
        };

        const onTagsFoundFromDom = () => {
            apiAbortController?.abort();
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

            apiAbortController = new AbortController();
            const { signal } = apiAbortController;

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
            if (apiFailed && !topicsContainer.innerHTML) {
                tagsProcessed = false;
                problemCachePromise = null;
                loadTagsFromApi();
                return;
            }
            if (topicsContainer.innerHTML) {
                topicsVisible = !topicsVisible;
                topicsContainer.classList.toggle('ff-hidden', !topicsVisible);
                btnTopics.textContent = topicsVisible ? 'Hide Tags' : 'Get Tags';
                return;
            }
            if (tagsProcessed && !topicsContainer.innerHTML) {
                btnTopics.disabled = true;
                btnTopics.textContent = 'No Tags';
            }
        };

        const handleRatingClick = () => {
            if (apiFailed && !ratingContainer.innerHTML) {
                tagsProcessed = false;
                problemCachePromise = null;
                loadTagsFromApi();
                return;
            }
            if (ratingContainer.innerHTML) {
                ratingVisible = !ratingVisible;
                ratingContainer.classList.toggle('ff-hidden', !ratingVisible);
                btnRating.textContent = ratingVisible ? 'Hide Rating' : 'Get Rating';
                return;
            }
            if (tagsProcessed && !ratingContainer.innerHTML) {
                btnRating.disabled = true;
                btnRating.textContent = 'No Rating';
            }
        };

        btnTopics.addEventListener('click', handleTopicsClick);
        btnRating.addEventListener('click', handleRatingClick);

        obs = new MutationObserver(() => {
            if (processTagsFromDOM()) onTagsFoundFromDom();
        });
        poll = setInterval(() => {
            if (processTagsFromDOM()) onTagsFoundFromDom();
        }, CONFIG.TAGS_POLL_INTERVAL_MS);
        setTimeout(stopPolling, CONFIG.TAGS_POLL_MAX_MS);
        obs.observe(document.body, { childList: true, subtree: true });
        loadTagsFromApi();
    }

    // ── Init ───────────────────────────────────────
    // initTagToggler must wait for DOMContentLoaded because it queries
    // #sidebar and other DOM elements that don't exist at document_start.
    function startScout() {
        if (IS_CF) {
            initTagToggler();
        }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startScout);
    } else {
        startScout();
    }
})();
