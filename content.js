/**
 * FocusForces — Content Script
 * Zen Mode, Tag Toggler (Scout), Precision Timer, Theme Sync
 */

(function() {
    'use strict';

    // ── Constants & Config ─────────────────────────────
    const CONFIG = {
        ZEN_SELECTORS: [
            '.community-stats-box',
            '.roundbox.menu-box:not(:first-child)',
            '#header > div:first-child',
            '.news-item',
            '.footer'
        ],
        PROBLEMS_FETCH_TIMEOUT_MS: 15000,
        CONTEST_STANDINGS_TIMEOUT_MS: 5000,
        TAGS_POLL_INTERVAL_MS: 300,
        TAGS_POLL_MAX_MS: 8000,
        TIMER_STORAGE_KEY: 'ff_timer_state'
    };

    // ── State ──────────────────────────────────────────
    let zenModeEnabled = false;
    let problemCachePromise = null;
    let cachedAudioCtx = null;
    let currentTheme = 'light';

    // ── Audio ──────────────────────────────────────────
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

    const safeSendNotification = async (title, message) => {
        try {
            await chrome.runtime.sendMessage({ type: 'TIMER_NOTIFY', title, message });
        } catch (e) {
            console.debug('Timer notify sendMessage failed:', e);
        }
        try {
            await playNotificationSound();
        } catch (e) {
            console.debug('Timer notify sound failed:', e);
        }
    };

    // ── Theme ──────────────────────────────────────────
    async function loadTheme() {
        try {
            const { ff_theme } = await chrome.storage.local.get('ff_theme');
            currentTheme = ff_theme || 'light';
            applyThemeToElements(currentTheme);
            if (document.body) {
                injectCFTheme(currentTheme);
            }
        } catch {}
    }

    function applyThemeToElements(theme) {
        const timerCard = document.getElementById('ff-timer-card');
        const scoutCard = document.getElementById('ff-scout-card');
        if (timerCard) timerCard.setAttribute('data-theme', theme);
        if (scoutCard) scoutCard.setAttribute('data-theme', theme);
    }

    function injectCFTheme(theme) {
        if (theme === 'default') {
            if (document.body) {
                document.body.removeAttribute('data-ff-theme');
            }
            return;
        }

        if (document.body) {
            document.body.setAttribute('data-ff-theme', theme);
        }
    }

    chrome.runtime.onMessage.addListener(req => {
        if (req.type === 'THEME_CHANGED') {
            currentTheme = req.theme;
            applyThemeToElements(currentTheme);
            injectCFTheme(currentTheme);
        }
    });

    loadTheme();

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
                    txt.includes('ff timer') ||
                    txt.includes('ff scout');
                box.classList.toggle('ff-zen-hidden', enabled && !keep);
            });
        }
    }

    (async () => {
        const { zenMode } = await chrome.storage.local.get('zenMode');
        zenModeEnabled = !!zenMode;
        if (zenModeEnabled) applyZenMode(true);
    })();

    chrome.runtime.onMessage.addListener(req => {
        if (req.type === 'TOGGLE_ZEN') {
            zenModeEnabled = !!req.enabled;
            applyZenMode(zenModeEnabled);
        }
    });

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

    // ── Timer (Content Script Sidebar) ──────────────────
    function initTimer() {
        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return;
        if (document.getElementById('cf-timer-display')) return;

        const timerCard = document.createElement('div');
        timerCard.className = 'roundbox sidebox';
        timerCard.id = 'ff-timer-card';
        timerCard.setAttribute('data-theme', currentTheme);
        timerCard.innerHTML = `
            <div class="roundbox-lt">&nbsp;</div>
            <div class="roundbox-rt">&nbsp;</div>
            <div class="caption titled">&rarr; Timer
                <div class="top-links"></div>
            </div>
            <div class="ff-timer-content">
                <div class="ff-timer-display" id="cf-timer-display">00:00:00</div>
                <div class="ff-timer-inputs">
                    <label>
                        <input type="number" id="cf-timer-mm" min="0" max="999" placeholder="MM" value="25"> m
                    </label>
                    <label>
                        <input type="number" id="cf-timer-ss" min="0" max="59" placeholder="SS" value="0"> s
                    </label>
                </div>
                <div class="ff-timer-controls">
                    <button type="button" class="ff-timer-btn primary" id="cf-timer-action">Start</button>
                    <button type="button" class="ff-timer-btn" id="cf-timer-reset">Reset</button>
                </div>
            </div>
        `;
        sidebar.appendChild(timerCard);

        const display = document.getElementById('cf-timer-display');
        const mmInput = document.getElementById('cf-timer-mm');
        const ssInput = document.getElementById('cf-timer-ss');
        const actionBtn = document.getElementById('cf-timer-action');
        const resetBtn = document.getElementById('cf-timer-reset');

        let state;
        let intervalId = null;

        const loadTimerState = async () => {
            try {
                const { [CONFIG.TIMER_STORAGE_KEY]: stored } = await chrome.storage.local.get(CONFIG.TIMER_STORAGE_KEY);
                if (!stored) return defaultTimerState();
                return { ...defaultTimerState(), ...stored };
            } catch {
                return defaultTimerState();
            }
        };

        const saveState = () => {
            chrome.storage.local.set({ [CONFIG.TIMER_STORAGE_KEY]: state });
        };

        const renderUI = () => {
            const isActive = state.status === 'RUNNING' || state.status === 'PAUSED';
            mmInput.disabled = isActive;
            ssInput.disabled = isActive;

            actionBtn.classList.remove('primary', 'pausing');

            if (state.status === 'RUNNING') {
                actionBtn.textContent = 'Pause';
                actionBtn.classList.add('pausing');
                const msLeft = Math.max(0, state.endTime - Date.now());
                display.textContent = formatTime(msLeft);
                display.classList.toggle('danger', isDanger(msLeft));
            } else if (state.status === 'PAUSED') {
                actionBtn.textContent = 'Resume';
                actionBtn.classList.add('primary');
                display.textContent = formatTime(state.remainingMs);
                display.classList.toggle('danger', isDanger(state.remainingMs));
            } else {
                actionBtn.textContent = 'Start';
                actionBtn.classList.add('primary');
                display.textContent = '00:00:00';
                display.classList.remove('danger');
            }
        };

        const finishTimer = () => {
            clearInterval(intervalId);
            intervalId = null;
            state.status = 'STOPPED';
            state.endTime = 0;
            state.remainingMs = 0;
            saveState();
            renderUI();
            safeSendNotification('Time is Up!', 'Your focus session concluded.');
        };

        const tick = () => {
            if (state.status !== 'RUNNING') return;

            const now = Date.now();
            const result = tickState(state, now);
            const prevNotified = [...(state.notifiedMilestones || [])];
            state = result.state;

            const msLeft = Math.max(0, state.endTime - now);
            display.textContent = formatTime(msLeft);

            for (const action of result.actions) {
                if (action === 'DANGER_ON') display.classList.add('danger');
                else if (action === 'DANGER_OFF') display.classList.remove('danger');
                else if (action === 'NOTIFY_10') {
                    safeSendNotification('10 Minutes Left', 'Keep pushing, you are doing great!');
                } else if (action === 'NOTIFY_5') {
                    safeSendNotification('5 Minutes Left', 'Focus in — finalize your logic.');
                } else if (action === 'FINISHED') {
                    finishTimer();
                    return;
                }
            }

            if (JSON.stringify(state.notifiedMilestones) !== JSON.stringify(prevNotified)) {
                saveState();
            }
        };

        const startTimer = () => {
            if (state.status === 'STOPPED') {
                state.remainingMs = computeRemainingMs(mmInput.value, ssInput.value);
                state.notifiedMilestones = [];
                state._dangerActive = false;
            }
            if (state.remainingMs <= 0) return;
            state.status = 'RUNNING';
            state.durationMs = state.durationMs || state.remainingMs;
            state.endTime = Date.now() + state.remainingMs;
            saveState();
            renderUI();
            if (!intervalId) intervalId = setInterval(tick, 1000);

            // Notify background to set up alarms
            chrome.runtime.sendMessage({ type: 'TIMER_STARTED', state }).catch(() => {});
        };

        const triggerAction = () => {
            if (state.status === 'RUNNING') {
                if (Date.now() >= state.endTime) {
                    finishTimer();
                    return;
                }
                state.remainingMs = Math.max(0, state.endTime - Date.now());
                state.status = 'PAUSED';
                saveState();
                clearInterval(intervalId);
                intervalId = null;
                chrome.runtime.sendMessage({ type: 'TIMER_PAUSED', state }).catch(() => {});
            } else {
                startTimer();
            }
            renderUI();
        };

        actionBtn.addEventListener('click', triggerAction);

        mmInput.addEventListener('keydown', e => { if (e.key === 'Enter') triggerAction(); });
        ssInput.addEventListener('keydown', e => { if (e.key === 'Enter') triggerAction(); });

        resetBtn.addEventListener('click', () => {
            state = { ...defaultTimerState() };
            saveState();
            renderUI();
            clearInterval(intervalId);
            intervalId = null;
            chrome.runtime.sendMessage({ type: 'TIMER_FINISHED', state }).catch(() => {});
        });

        // Listen for state updates from popup
        chrome.runtime.onMessage.addListener(req => {
            if (req.type === 'TIMER_STATE_CHANGED') {
                loadTimerState().then(newState => {
                    state = newState;
                    if (state.status === 'RUNNING') {
                        if (!intervalId) intervalId = setInterval(tick, 1000);
                    } else {
                        clearInterval(intervalId);
                        intervalId = null;
                    }
                    renderUI();
                });
            }
        });

        // Initialize
        loadTimerState().then(async loadedState => {
            state = loadedState;
            if (state.status === 'RUNNING') {
                if (Date.now() >= state.endTime) {
                    finishTimer();
                } else {
                    state.durationMs = state.durationMs || state.remainingMs;
                    intervalId = setInterval(tick, 1000);
                    tick();
                }
            } else if (state.status === 'PAUSED') {
                display.textContent = formatTime(state.remainingMs);
            }
            renderUI();
        });
    }

    // ── Init ───────────────────────────────────────
    initTagToggler();
    initTimer();
})();
