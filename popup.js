/**
 * FocusForces — Popup
 * Modular architecture: Theme, Timer, Contest Reminders, Contest List, Settings.
 */

// ══════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════

const FETCH_TIMEOUT_MS = 6000;
const GYM_TIMEOUT_MS = 35000;
const CACHE_TTL_MS = 2 * 60 * 1000;
const CACHE_KEY = 'ff_contests_cache';
const GYM_CACHE_TTL_MS = 30 * 60 * 1000;
const GYM_CACHE_KEY = 'ff_gym_cache';

const THEMES = ['default', 'light', 'dark', 'amoled', 'contrast'];
const THEME_KEY = 'ff_theme';
const TIMER_STORAGE_KEY = 'ff_timer_state';
const REMINDER_INTERVALS_KEY = 'ff_reminder_intervals';
const DEFAULT_REMINDER_INTERVALS = [86400, 43200, 18000, 7200, 3600, 1800, 600, 300];

// ══════════════════════════════════════════════════════
// MODULE: Theme
// ══════════════════════════════════════════════════════

const ThemeModule = (() => {
    let currentTheme = 'default';

    function applyTheme(theme) {
        currentTheme = theme;
        document.documentElement.setAttribute('data-theme', theme);
        document.querySelectorAll('.theme-dot').forEach(dot => {
            const isActive = dot.dataset.theme === theme;
            dot.classList.toggle('active', isActive);
            dot.setAttribute('aria-checked', String(isActive));
        });
        saveTheme(theme);
        syncThemeToContentScript(theme);
    }

    async function saveTheme(theme) {
        try { await chrome.storage.local.set({ [THEME_KEY]: theme }); } catch {}
    }

    async function loadTheme() {
        try {
            const { [THEME_KEY]: saved } = await chrome.storage.local.get(THEME_KEY);
            const theme = saved && THEMES.includes(saved) ? saved : 'default';
            applyTheme(theme);
        } catch {
            applyTheme('default');
        }
    }

    function syncThemeToContentScript(theme) {
        // Path 1: Send to background service worker, which broadcasts to ALL
        // Codeforces tabs. This is the most reliable path because the service
        // worker has a persistent listener and reaches every CF tab regardless
        // of which tab is currently active.
        chrome.runtime.sendMessage({ type: 'THEME_CHANGED', theme }).catch(() => {});

        // Path 2: Direct message to the active tab's content script for the
        // fastest possible theme update on the visible page.
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            if (tabs[0]?.id) {
                chrome.tabs.sendMessage(tabs[0].id, { type: 'THEME_CHANGED', theme }).catch(() => {});
            }
        });
    }

    function getCurrentTheme() {
        return currentTheme;
    }

    return { applyTheme, loadTheme, getCurrentTheme };
})();

// ══════════════════════════════════════════════════════
// MODULE: Timer — State & Helpers
// ══════════════════════════════════════════════════════

const TimerModule = (() => {
    let timerState = defaultTimerState();
    let timerIntervalId = null;

    function defaultTimerState() {
        return {
            status: 'STOPPED',
            mode: 'countdown',
            endTime: 0,
            elapsed: 0,
            lastStarted: 0,
            durationMs: 0,
            remainingMs: 0,
            notifiedMilestones: []
        };
    }

    async function loadTimerState() {
        try {
            const { [TIMER_STORAGE_KEY]: stored } = await chrome.storage.local.get(TIMER_STORAGE_KEY);
            if (!stored) return defaultTimerState();
            return { ...defaultTimerState(), ...stored };
        } catch {
            return defaultTimerState();
        }
    }

    async function saveTimerState(state) {
        try { await chrome.storage.local.set({ [TIMER_STORAGE_KEY]: state }); } catch {}
    }

    function formatTimeMs(ms) {
        const sec = Math.max(0, Math.ceil(ms / 1000));
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':');
    }

    function computeRemainingMs(mm, ss) {
        const clampedMm = Math.min(999, Math.max(0, parseInt(mm, 10) || 0));
        const clampedSs = Math.min(59, Math.max(0, parseInt(ss, 10) || 0));
        return (clampedMm * 60 + clampedSs) * 1000;
    }

    function getState() {
        return timerState;
    }

    function setState(newState) {
        timerState = newState;
    }

    function getIntervalId() {
        return timerIntervalId;
    }

    function setIntervalId(id) {
        timerIntervalId = id;
    }

    return {
        defaultTimerState,
        loadTimerState,
        saveTimerState,
        formatTimeMs,
        computeRemainingMs,
        getState,
        setState,
        getIntervalId,
        setIntervalId
    };
})();

// ══════════════════════════════════════════════════════
// MODULE: Timer — UI
// ══════════════════════════════════════════════════════

const TimerUIModule = (() => {
    function init() {
        const display = document.getElementById('timer-display');
        const mmInput = document.getElementById('timer-mm');
        const ssInput = document.getElementById('timer-ss');
        const inputsRow = document.getElementById('timer-inputs');
        const actionBtn = document.getElementById('timer-action');
        const resetBtn = document.getElementById('timer-reset');
        const modeBtns = document.querySelectorAll('.timer-mode-btn');

        if (!display || !actionBtn) return;

        modeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const state = TimerModule.getState();
                if (state.status === 'RUNNING') return;
                const mode = btn.dataset.mode;
                TimerModule.setState({ ...state, mode });
                modeBtns.forEach(b => {
                    const isActive = b.dataset.mode === mode;
                    b.classList.toggle('active', isActive);
                    b.setAttribute('aria-checked', String(isActive));
                });
                if (mode === 'stopwatch') {
                    inputsRow.style.display = 'none';
                    display.textContent = '00:00:00';
                } else {
                    inputsRow.style.display = '';
                }
                render();
                TimerModule.saveTimerState(TimerModule.getState());
            });
        });

        if (TimerModule.getState().mode === 'stopwatch') {
            modeBtns.forEach(b => {
                const isActive = b.dataset.mode === 'stopwatch';
                b.classList.toggle('active', isActive);
                b.setAttribute('aria-checked', String(isActive));
            });
            inputsRow.style.display = 'none';
        }

        actionBtn.addEventListener('click', () => {
            const state = TimerModule.getState();
            if (state.status === 'RUNNING') {
                TimerActions.pause();
            } else {
                TimerActions.start();
            }
        });

        resetBtn.addEventListener('click', () => {
            TimerActions.reset();
        });

        [mmInput, ssInput].forEach(el => {
            el.addEventListener('keydown', e => {
                if (e.key === 'Enter' && TimerModule.getState().status !== 'RUNNING') {
                    TimerActions.start();
                }
            });
        });

        render();
    }

    function render() {
        const display = document.getElementById('timer-display');
        const mmInput = document.getElementById('timer-mm');
        const ssInput = document.getElementById('timer-ss');
        const inputsRow = document.getElementById('timer-inputs');
        const actionBtn = document.getElementById('timer-action');
        const modeBtns = document.querySelectorAll('.timer-mode-btn');

        if (!display || !actionBtn) return;

        const state = TimerModule.getState();
        const isCountdown = state.mode === 'countdown';
        const isActive = state.status === 'RUNNING' || state.status === 'PAUSED';

        if (mmInput) mmInput.disabled = isActive;
        if (ssInput) ssInput.disabled = isActive;

        modeBtns.forEach(btn => {
            btn.disabled = isActive;
            btn.style.opacity = isActive ? '0.5' : '';
        });

        if (inputsRow) inputsRow.style.display = isCountdown ? '' : 'none';

        if (state.status === 'RUNNING') {
            actionBtn.textContent = 'Pause';
            if (isCountdown) {
                const msLeft = Math.max(0, state.endTime - Date.now());
                display.textContent = TimerModule.formatTimeMs(msLeft);
                display.classList.toggle('danger', msLeft <= 300000 && state.durationMs >= 600000);
            } else {
                const elapsed = state.elapsed + (Date.now() - state.lastStarted);
                display.textContent = TimerModule.formatTimeMs(elapsed);
                display.classList.remove('danger');
            }
        } else if (state.status === 'PAUSED') {
            actionBtn.textContent = 'Resume';
            if (isCountdown) {
                display.textContent = TimerModule.formatTimeMs(state.remainingMs);
                display.classList.toggle('danger', state.remainingMs <= 300000 && state.durationMs >= 600000);
            } else {
                display.textContent = TimerModule.formatTimeMs(state.elapsed);
                display.classList.remove('danger');
            }
        } else {
            actionBtn.textContent = 'Start';
            display.textContent = '00:00:00';
            display.classList.remove('danger');
        }
    }

    return { init, render };
})();

// ══════════════════════════════════════════════════════
// MODULE: Timer — Actions
// ══════════════════════════════════════════════════════

const TimerActions = (() => {
    function start() {
        const state = TimerModule.getState();
        if (state.mode === 'countdown') {
            const mmInput = document.getElementById('timer-mm');
            const ssInput = document.getElementById('timer-ss');
            if (state.status === 'STOPPED') {
                state.remainingMs = TimerModule.computeRemainingMs(mmInput?.value, ssInput?.value);
                state.notifiedMilestones = [];
            }
            if (state.remainingMs <= 0) return;
            state.status = 'RUNNING';
            state.durationMs = state.durationMs || state.remainingMs;
            state.endTime = Date.now() + state.remainingMs;
        } else {
            if (state.status === 'STOPPED') {
                state.elapsed = 0;
            }
            state.status = 'RUNNING';
            state.lastStarted = Date.now();
        }

        TimerModule.setState(state);
        TimerModule.saveTimerState(state);
        TimerUIModule.render();
        TimerInterval.start();

        chrome.runtime.sendMessage({ type: 'TIMER_STARTED', state }).catch(() => {});
    }

    function pause() {
        const state = TimerModule.getState();
        if (state.mode === 'countdown') {
            state.remainingMs = Math.max(0, state.endTime - Date.now());
        } else {
            state.elapsed += Date.now() - state.lastStarted;
        }
        state.status = 'PAUSED';
        TimerModule.setState(state);
        TimerModule.saveTimerState(state);
        TimerInterval.stop();
        TimerUIModule.render();
        chrome.runtime.sendMessage({ type: 'TIMER_PAUSED', state }).catch(() => {});
    }

    function reset() {
        TimerInterval.stop();
        const currentMode = TimerModule.getState().mode;
        TimerModule.setState({ ...TimerModule.defaultTimerState(), mode: currentMode });
        TimerModule.saveTimerState(TimerModule.getState());
        TimerUIModule.render();
        chrome.runtime.sendMessage({ type: 'TIMER_FINISHED', state: TimerModule.getState() }).catch(() => {});
    }

    function finish() {
        TimerInterval.stop();
        const state = TimerModule.defaultTimerState();
        TimerModule.setState(state);
        TimerModule.saveTimerState(state);
        TimerUIModule.render();
        chrome.runtime.sendMessage({ type: 'TIMER_FINISHED', state }).catch(() => {});
    }

    return { start, pause, reset, finish };
})();

// ══════════════════════════════════════════════════════
// MODULE: Timer — Interval
// ══════════════════════════════════════════════════════

const TimerInterval = (() => {
    function start() {
        stop();
        // 1000ms is sufficient for a timer display; reduces UI thread pressure vs 500ms
        const id = setInterval(tickTimer, 1000);
        TimerModule.setIntervalId(id);
    }

    function stop() {
        const id = TimerModule.getIntervalId();
        if (id) {
            clearInterval(id);
            TimerModule.setIntervalId(null);
        }
    }

    function tickTimer() {
        const state = TimerModule.getState();
        if (state.status !== 'RUNNING') return;

        if (state.mode === 'countdown') {
            const msLeft = Math.max(0, state.endTime - Date.now());
            const display = document.getElementById('timer-display');
            if (display) {
                display.textContent = TimerModule.formatTimeMs(msLeft);
                display.classList.toggle('danger', msLeft <= 300000 && state.durationMs >= 600000);
            }

            if (msLeft <= 0) {
                TimerActions.finish();
                return;
            }


        } else {
            const elapsed = state.elapsed + (Date.now() - state.lastStarted);
            const display = document.getElementById('timer-display');
            if (display) {
                display.textContent = TimerModule.formatTimeMs(elapsed);
            }
        }
    }

    return { start, stop };
})();

// ══════════════════════════════════════════════════════
// MODULE: Timer — Recovery
// ══════════════════════════════════════════════════════

const TimerRecovery = (() => {
    async function recover() {
        const state = await TimerModule.loadTimerState();
        TimerModule.setState(state);
        if (state.status === 'RUNNING') {
            if (state.mode === 'countdown' && Date.now() >= state.endTime) {
                TimerActions.finish();
            } else {
                TimerInterval.start();
            }
        }
        TimerUIModule.render();
    }

    return { recover };
})();

// ══════════════════════════════════════════════════════
// MODULE: Contest — Helpers (imported from contest-utils.js)
// ══════════════════════════════════════════════════════

const ContestHelpers = (() => {
    /* globals getContestStatus, formatDuration, formatDateTime, timeUntil */
    return { getContestStatus, formatDuration, formatDateTime, timeUntil };
})();

// ══════════════════════════════════════════════════════
// MODULE: Contest — AtCoder Parser
// ══════════════════════════════════════════════════════

const AtCoderParser = (() => {
    function parse(html) {
        if (!html) return [];

        // Parse the HTML string into a real DOM so we can use proper selectors
        // instead of fragile regex patterns that break on HTML structure changes.
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const table = doc.querySelector('#contest-table-upcoming table');
        if (!table) return [];

        const rows = table.querySelectorAll('tbody tr');
        const contests = [];

        rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            if (cells.length < 3) return;

            // Contest name: the last <a href="/contests/..."> inside the first cell.
            // AtCoder sometimes includes extra links (rating predictors, etc.) before
            // the actual contest name; we want the last one.
            const links = cells[0].querySelectorAll('a[href^="/contests/"]');
            if (!links.length) return;
            const lastLink = links[links.length - 1];
            const contestPath = lastLink.getAttribute('href');
            const contestName = lastLink.textContent.trim();

            // Start time from <time> element (datetime attribute preferred)
            const timeEl = cells[1].querySelector('time');
            if (!timeEl) return;
            const startTimeStr = timeEl.getAttribute('datetime') || timeEl.textContent.trim();
            // AtCoder uses format "2024-06-01 12:00:00+09:00" — replace space with T for ISO
            const startTime = new Date(startTimeStr.replace(' ', 'T'));
            if (Number.isNaN(startTime.getTime())) return;

            // Duration from the third cell, e.g. "01:30"
            const durationStr = cells[2].textContent.trim();
            const [dh = 0, dm = 0] = durationStr.split(':').map(Number);
            const durationMinutes = Number.isFinite(dh) && Number.isFinite(dm) ? dh * 60 + dm : 90;

            contests.push({
                name: contestName,
                url: `https://atcoder.jp${contestPath}`,
                site: 'AtCoder',
                status: 'BEFORE',
                start_time: startTime.toISOString(),
                duration: durationMinutes
            });
        });

        return contests;
    }

    return { parse };
})();

// ══════════════════════════════════════════════════════
// MODULE: Contest — Caching
// ══════════════════════════════════════════════════════

const ContestCache = (() => {
    async function getMain() {
        try {
            const { [CACHE_KEY]: stored } = await chrome.storage.local.get(CACHE_KEY);
            if (stored && Date.now() - stored.ts < CACHE_TTL_MS) return stored.data;
        } catch {}
        return null;
    }

    async function setMain(data) {
        try { await chrome.storage.local.set({ [CACHE_KEY]: { data, ts: Date.now() } }); } catch {}
    }

    async function getGym() {
        try {
            const { [GYM_CACHE_KEY]: stored } = await chrome.storage.local.get(GYM_CACHE_KEY);
            if (stored && Date.now() - stored.ts < GYM_CACHE_TTL_MS) return stored.data;
        } catch {}
        return null;
    }

    async function setGym(data) {
        try { await chrome.storage.local.set({ [GYM_CACHE_KEY]: { data, ts: Date.now() } }); } catch {}
    }

    return { getMain, setMain, getGym, setGym };
})();

// ══════════════════════════════════════════════════════
// MODULE: Contest — Filter & Sort (imported from contest-utils.js)
// ══════════════════════════════════════════════════════

const ContestSortFilter = (() => {
    /* globals contestComparator, filterAndSort, sortByTime */
    return { filterAndSort, sortByTime };
})();

// ══════════════════════════════════════════════════════
// MODULE: Contest — Fetching
// ══════════════════════════════════════════════════════

const ContestFetch = (() => {
    function safeFetch(input, init) {
        try {
            return fetch(input, init)
                .then(r => r.ok ? r : null)
                .catch(() => null);
        } catch {
            return Promise.resolve(null);
        }
    }

    function parseGym(data) {
        if (data?.status !== 'OK' || !Array.isArray(data.result)) return [];
        return data.result
            .filter(c => ['BEFORE', 'CODING'].includes(c.phase))
            .map(c => ({
                name: c.name,
                url: `https://codeforces.com/gym/${c.id}`,
                site: 'CodeForces',
                isGym: true,
                status: c.phase,
                start_time: new Date(c.startTimeSeconds * 1000).toISOString(),
                duration: Math.round((c.durationSeconds || 0) / 60)
            }));
    }

    async function fetchMain() {
        const [cfResp, ccResp, acResp, lcResp] = await Promise.all([
            safeFetch('https://codeforces.com/api/contest.list', { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
                .then(r => r ? r.json() : null).catch(() => null),
            safeFetch('https://www.codechef.com/api/list/contests/all', { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
                .then(r => r ? r.json() : null).catch(() => null),
            safeFetch('https://atcoder.jp/contests', { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
                .then(r => r ? r.text() : null).catch(() => null),
            safeFetch('https://leetcode.com/graphql', {
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: '{ upcomingContests { title titleSlug startTime duration } }' })
            }).then(r => r ? r.json() : null).catch(() => null)
        ]);

        const cfContests = cfResp?.status === 'OK' ? cfResp.result
            .filter(c => ['BEFORE', 'CODING'].includes(c.phase))
            .map(c => ({
                name: c.name, url: `https://codeforces.com/contest/${c.id}`, site: 'CodeForces',
                status: c.phase, start_time: new Date(c.startTimeSeconds * 1000).toISOString(),
                duration: Math.round((c.durationSeconds || 0) / 60)
            })) : [];

        const parseCCDate = (dateStr) => {
            if (!dateStr || typeof dateStr !== 'string') return null;
            const d = new Date(dateStr);
            return isNaN(d.getTime()) ? null : d.toISOString();
        };
        const ccContests = [];
        if (ccResp) {
            (ccResp.future_contests || []).forEach(c => {
                const start_time = parseCCDate(c.contest_start_date_iso);
                if (!start_time) return;
                ccContests.push({
                    name: c.contest_name || 'CodeChef Contest',
                    url: c.contest_code ? `https://www.codechef.com/${c.contest_code}` : null,
                    site: 'CodeChef', status: 'BEFORE', start_time,
                    duration: parseInt(c.contest_duration, 10) || 120
                });
            });
            (ccResp.present_contests || []).forEach(c => {
                const start_time = parseCCDate(c.contest_start_date_iso);
                if (!start_time) return;
                ccContests.push({
                    name: c.contest_name || 'CodeChef Contest',
                    url: c.contest_code ? `https://www.codechef.com/${c.contest_code}` : null,
                    site: 'CodeChef', status: 'CODING', start_time,
                    duration: parseInt(c.contest_duration, 10) || 120
                });
            });
        }

        let acContests = [];
        try { acContests = AtCoderParser.parse(acResp); } catch {}

        const lcContests = [];
        if (lcResp?.data?.upcomingContests) {
            lcResp.data.upcomingContests.forEach(c => {
                const start_time = c.startTime ? new Date(c.startTime * 1000).toISOString() : null;
                if (!start_time) return;
                lcContests.push({
                    name: c.title || 'LeetCode Contest',
                    url: c.titleSlug ? `https://leetcode.com/contest/${c.titleSlug}` : null,
                    site: 'LeetCode', status: 'BEFORE', start_time,
                    duration: c.duration ? Math.round(c.duration / 60) : 90
                });
            });
        }

        if (!cfResp && !ccResp && !acResp && !lcResp) {
            throw new Error('Could not reach contest servers. Check your network connection.');
        }

        return ContestSortFilter.filterAndSort([...cfContests, ...ccContests, ...acContests, ...lcContests]);
    }

    async function fetchGym() {
        const gymResp = await safeFetch('https://codeforces.com/api/contest.list?gym=true', { signal: AbortSignal.timeout(GYM_TIMEOUT_MS) })
            .then(r => r ? r.json() : null).catch(() => null);
        return parseGym(gymResp);
    }

    return { fetchMain, fetchGym };
})();

// ══════════════════════════════════════════════════════
// MODULE: Contest — Rendering
// ══════════════════════════════════════════════════════

const ContestRenderer = (() => {
    let activeTab = 'near';
    let cachedNear = [];
    let cachedLater = [];

    function setListMessage(list, txt) {
        const div = document.createElement('div');
        div.className = 'state-message';
        div.textContent = txt;
        list.replaceChildren(div);
    }

    function setLoadingState(list) {
        const div = document.createElement('div');
        div.className = 'state-message shimmer';
        div.setAttribute('aria-label', 'Loading');
        list.replaceChildren(div);
    }

    function createCard(contest) {
        if (!contest || !contest.site) return null;
        const status = ContestHelpers.getContestStatus(contest);
        const cfg = PLATFORM_CONFIG[contest.site] || { badge: contest.site, cls: 'other', color: '#616161' };
        const card = document.createElement('div');
        const isOngoing = status === 'ongoing';

        let urgencyClass = '';
        let urgencyLabel = '';
        if (!isOngoing) {
            const msUntil = new Date(contest.start_time).getTime() - Date.now();
            if (msUntil <= 60 * 60 * 1000) { urgencyClass = 'urgency-critical'; urgencyLabel = '< 1h'; }
            else if (msUntil <= 4 * 60 * 60 * 1000) { urgencyClass = 'urgency-high'; urgencyLabel = '< 4h'; }
        }

        card.className = ['contest-card', isOngoing ? 'is-ongoing' : '', urgencyClass].filter(Boolean).join(' ');
        if (!isOngoing && !urgencyClass) card.style.borderLeftColor = cfg.color;

        const name = document.createElement('div');
        name.className = 'contest-name';
        if (contest.url) {
            const a = document.createElement('a');
            a.href = contest.url;
            a.target = '_blank';
            a.rel = 'noopener';
            a.textContent = contest.name || 'Untitled';
            name.appendChild(a);
        } else {
            name.textContent = contest.name || 'Untitled';
        }

        const badges = document.createElement('div');
        badges.className = 'contest-card-badges';

        if (isOngoing) {
            const live = document.createElement('span');
            live.className = 'live-badge';
            live.textContent = 'LIVE';
            badges.appendChild(live);
        }

        const platform = document.createElement('span');
        platform.className = `platform-badge ${cfg.cls}`;
        platform.textContent = cfg.badge;
        badges.appendChild(platform);

        if (contest.isGym) {
            const gym = document.createElement('span');
            gym.className = 'gym-badge';
            gym.textContent = 'GYM';
            badges.appendChild(gym);
        }

        if (urgencyLabel) {
            const urg = document.createElement('span');
            urg.className = `urgency-badge ${urgencyClass === 'urgency-critical' ? 'critical' : 'high'}`;
            urg.textContent = urgencyLabel;
            badges.appendChild(urg);
        }

        const meta = document.createElement('div');
        meta.className = 'contest-meta';
        meta.appendChild(Object.assign(document.createElement('span'), {
            className: 'contest-time',
            textContent: ContestHelpers.formatDateTime(contest.start_time)
        }));
        const countdown = !isOngoing ? ContestHelpers.timeUntil(contest.start_time) : null;
        meta.appendChild(Object.assign(document.createElement('span'), {
            className: isOngoing ? 'live-text' : 'contest-duration',
            textContent: isOngoing
                ? 'Running now'
                : (countdown ? `${ContestHelpers.formatDuration(contest.duration)} · starts in ${countdown}` : ContestHelpers.formatDuration(contest.duration))
        }));

        card.append(name, badges, meta);
        card.addEventListener('click', e => {
            if (e.target.closest('a')) return;
            if (contest.url) chrome.tabs.create({ url: contest.url, active: false });
        });
        return card;
    }

    function createTabBar(nearCount, laterCount) {
        const bar = document.createElement('div');
        bar.className = 'tab-bar';

        const nearTab = document.createElement('button');
        nearTab.className = 'tab' + (activeTab === 'near' ? ' active' : '');
        nearTab.dataset.tab = 'near';
        nearTab.innerHTML = `Next 24 Hours <span class="tab-count">${nearCount}</span>`;

        const laterTab = document.createElement('button');
        laterTab.className = 'tab' + (activeTab === 'later' ? ' active' : '');
        laterTab.dataset.tab = 'later';
        laterTab.innerHTML = `All Contests <span class="tab-count">${laterCount}</span>`;

        bar.append(nearTab, laterTab);

        bar.addEventListener('click', e => {
            const btn = e.target.closest('.tab');
            if (!btn || btn.classList.contains('active')) return;
            activeTab = btn.dataset.tab;
            renderCurrentTab();
        });

        return bar;
    }

    function buildPane(items, emptyMsg) {
        const pane = document.createElement('div');
        pane.className = 'tab-pane';
        if (!items.length) {
            pane.appendChild(Object.assign(document.createElement('div'), {
                className: 'state-message', textContent: emptyMsg
            }));
            return pane;
        }
        let hasCards = false;
        ContestSortFilter.sortByTime(items).forEach(c => {
            const card = createCard(c);
            if (card) { pane.appendChild(card); hasCards = true; }
        });
        if (!hasCards) {
            pane.appendChild(Object.assign(document.createElement('div'), {
                className: 'state-message', textContent: 'No contests to display.'
            }));
        }
        return pane;
    }

    function renderCurrentTab() {
        const list = document.getElementById('contest-list');
        const tabBar = list.querySelector('.tab-bar');
        const oldPane = list.querySelector('.tab-pane');

        if (tabBar) {
            tabBar.querySelectorAll('.tab').forEach(t => {
                t.classList.toggle('active', t.dataset.tab === activeTab);
            });
        }

        const items = activeTab === 'near' ? cachedNear : cachedLater;
        const emptyMsg = activeTab === 'near' ? 'No contests in the next 24 hours.' : 'No upcoming contests.';
        const pane = buildPane(items, emptyMsg);
        if (oldPane) pane.classList.add('entering');

        if (oldPane) {
            oldPane.classList.add('exiting');
            setTimeout(() => oldPane.remove(), 250);
        }

        if (tabBar) tabBar.after(pane);
        else list.appendChild(pane);
    }

    function render(contests) {
        const list = document.getElementById('contest-list');

        if (!contests.length) {
            setListMessage(list, 'No active contests.');
            return;
        }

        const now = Date.now();
        cachedNear = [];
        cachedLater = [];

        contests.forEach(c => {
            const isOngoing = ContestHelpers.getContestStatus(c) === 'ongoing';
            const startMs = new Date(c.start_time).getTime();
            if (!isNaN(startMs) && (isOngoing || (startMs - now <= TWENTY_FOUR_HOURS_MS && startMs > now))) {
                cachedNear.push(c);
            }
            cachedLater.push(c);
        });

        const items = activeTab === 'near' ? cachedNear : cachedLater;
        const emptyMsg = activeTab === 'near' ? 'No contests in the next 24 hours.' : 'No upcoming contests.';

        const fragment = document.createDocumentFragment();
        fragment.appendChild(createTabBar(cachedNear.length, cachedLater.length));
        fragment.appendChild(buildPane(items, emptyMsg));

        list.className = 'contest-list';
        list.replaceChildren(fragment);
    }

    function renderError(msg) {
        const list = document.getElementById('contest-list');
        const wrapper = document.createElement('div');
        wrapper.className = 'error';
        const icon = document.createElement('div');
        icon.className = 'error-icon';
        icon.textContent = '!';
        const span = document.createElement('span');
        span.className = 'error-msg';
        span.textContent = msg;
        wrapper.append(icon, span);
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'retry-btn';
        retry.textContent = 'Retry';
        retry.addEventListener('click', () => {
            retry.textContent = 'Loading...';
            retry.disabled = true;
            ContestListModule.load().finally(() => {
                retry.textContent = 'Retry';
                retry.disabled = false;
            });
        });
        wrapper.appendChild(retry);
        list.replaceChildren(wrapper);
    }

    return { render, renderCurrentTab, renderError, setLoadingState, setListMessage };
})();

// ══════════════════════════════════════════════════════
// MODULE: Contest — List Controller
// ══════════════════════════════════════════════════════

const ContestListModule = (() => {
    let currentMain = [];
    let currentGym = [];
    let refreshIntervalId = null;

    async function load() {
        const list = document.getElementById('contest-list');

        const [cachedMain, cachedGym] = await Promise.all([ContestCache.getMain(), ContestCache.getGym()]);
        currentMain = cachedMain || [];
        currentGym = cachedGym || [];

        if (currentMain.length || currentGym.length) {
            ContestRenderer.render(ContestSortFilter.sortByTime([...currentMain, ...currentGym]));
        } else {
            ContestRenderer.setLoadingState(list);
        }

        ContestFetch.fetchMain().then(main => {
            currentMain = main;
            ContestCache.setMain(main);
            ContestRenderer.render(ContestSortFilter.sortByTime([...currentMain, ...currentGym]));
        }).catch(e => {
            if (!currentMain.length && !currentGym.length) {
                const msg = !navigator.onLine
                    ? 'You appear to be offline. Connect to the internet and try again.'
                    : (e.message || 'Error loading contests');
                ContestRenderer.renderError(msg);
            }
        });

        ContestFetch.fetchGym().then(gym => {
            if (gym && gym.length) {
                currentGym = gym;
                ContestCache.setGym(gym);
                ContestRenderer.render(ContestSortFilter.sortByTime([...currentMain, ...currentGym]));
            }
        }).catch(() => {});
    }

    function startAutoRefresh() {
        stopAutoRefresh();
        refreshIntervalId = setInterval(load, 60000);
    }

    function stopAutoRefresh() {
        if (refreshIntervalId) {
            clearInterval(refreshIntervalId);
            refreshIntervalId = null;
        }
    }

    return { load, startAutoRefresh, stopAutoRefresh };
})();

// ══════════════════════════════════════════════════════
// MODULE: Reminder Settings
// ══════════════════════════════════════════════════════

const ReminderSettingsModule = (() => {
    async function init() {
        const reminderToggle = document.getElementById('reminder-toggle');
        const { ff_reminders_enabled, ff_reminder_intervals } = await chrome.storage.local.get({
            ff_reminders_enabled: true,
            ff_reminder_intervals: DEFAULT_REMINDER_INTERVALS
        });
        
        const remindersEnabled = ff_reminders_enabled !== false;
        reminderToggle.checked = remindersEnabled;
        document.getElementById('reminder-section').style.display = remindersEnabled ? 'block' : 'none';
        
        reminderToggle.addEventListener('change', e => {
            const enabled = e.target.checked;
            chrome.storage.local.set({ ff_reminders_enabled: enabled });
            document.getElementById('reminder-section').style.display = enabled ? 'block' : 'none';
            chrome.runtime.sendMessage({ type: 'REMINDERS_TOGGLED', enabled }).catch(() => {});
        });

        const options = document.querySelectorAll('.reminder-item');
        options.forEach(opt => {
            const val = parseInt(opt.value, 10);
            opt.checked = ff_reminder_intervals.includes(val);
            
            opt.addEventListener('change', () => {
                const newIntervals = Array.from(options)
                    .filter(o => o.checked)
                    .map(o => parseInt(o.value, 10));
                chrome.storage.local.set({ ff_reminder_intervals: newIntervals });
                chrome.runtime.sendMessage({ type: 'REMINDERS_TOGGLED', enabled: reminderToggle.checked }).catch(() => {});
            });
        });
    }

    return { init };
})();

// ══════════════════════════════════════════════════════
// MODULE: Settings — Zen Mode
// ══════════════════════════════════════════════════════

const SettingsModule = (() => {
    async function init() {
        const zenToggle = document.getElementById('zen-toggle');
        const { zenMode } = await chrome.storage.local.get('zenMode');
        zenToggle.checked = !!zenMode;
        zenToggle.addEventListener('change', e => {
            const enabled = e.target.checked;
            chrome.storage.local.set({ zenMode: enabled });
            chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
                if (tabs[0]?.url?.includes('codeforces.com')) {
                    chrome.tabs.sendMessage(tabs[0].id, { type: 'TOGGLE_ZEN', enabled }).catch(() => {});
                }
            });
        });
    }

    return { init };
})();

// ══════════════════════════════════════════════════════
// MODULE: Notifications
// ══════════════════════════════════════════════════════



// ══════════════════════════════════════════════════════
// APP — Initialization
// ══════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
    await ThemeModule.loadTheme();

    // Theme dot picker
    const themePicker = document.getElementById('theme-picker');
    if (themePicker) {
        themePicker.addEventListener('click', e => {
            const dot = e.target.closest('.theme-dot');
            if (dot && dot.dataset.theme) {
                ThemeModule.applyTheme(dot.dataset.theme);
            }
        });
    }

    SettingsModule.init();
    ReminderSettingsModule.init();

    await TimerRecovery.recover();
    TimerUIModule.init();

    await ContestListModule.load();
    ContestListModule.startAutoRefresh();
});

window.addEventListener('beforeunload', () => {
    ContestListModule.stopAutoRefresh();
    TimerInterval.stop();
});
