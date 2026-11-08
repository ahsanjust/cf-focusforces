/**
 * FocusForces — Popup
 *
 * Module map:
 *   Theme          — palette selection + sync to page content scripts
 *   Dial / Timer   — state machine, gauge rendering, presets, recovery
 *   Sessions       — completed-session ledger ("sessions today / focused today")
 *   Contests       — aggregation, caching, rendering, relative-time refresh
 *   Views / Sheet  — navigation shell
 *
 * The contest fetch/parse/cache modules are intentionally self-contained and
 * side-effect free so they stay easy to reason about and unit test.
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

const THEMES = ['default', 'dark', 'amoled', 'contrast'];
const THEME_KEY = 'ff_theme';
const THEME_BOOT_KEY = 'ff_theme_boot';
const SYSTEM_THEME_KEY = 'ff_system_theme';
const ONBOARDED_KEY = 'ff_onboarded_v2';
const TIMER_ALERTS_KEY = 'ff_timer_notifications_enabled';
const TIMER_MILESTONES_KEY = 'ff_timer_notify_milestones';
const DEFAULT_TIMER_MILESTONES = ['10min', '5min', '1min', 'finish'];
const PAWS_KEY = 'ff_zenPaws';
const AC_KEY = 'ff_acCelebrate';
const TIMER_STORAGE_KEY = 'ff_timer_state';
const REMINDER_INTERVALS_KEY = 'ff_reminder_intervals';
const SESSIONS_KEY = 'ff_sessions';

const SESSION_RETENTION_DAYS = 30;
const MIN_LOGGED_SESSION_MS = 60 * 1000;

const DIAL_RADIUS = 84;   // must match the r="" of the track/progress circles
const DIAL_CENTER = 100;
const DIAL_CIRCUMFERENCE = 2 * Math.PI * DIAL_RADIUS;
const TICK_COUNT = 60;
const TICK_OUTER = 92;
const TICK_INNER_MINOR = 88;
const TICK_INNER_MAJOR = 85;

const DANGER_THRESHOLD_MS = 5 * 60 * 1000;
const DANGER_MIN_DURATION_MS = 10 * 60 * 1000;

const SVG_NS = 'http://www.w3.org/2000/svg';

// ══════════════════════════════════════════════════════
// SMALL UTILITIES
// ══════════════════════════════════════════════════════

const $ = id => document.getElementById(id);

/** Local (not UTC) calendar day key — "today" must match the user's clock. */
function localDayKey(date = new Date()) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
    ].join('-');
}

/** Compact focus-time label: 1h 15m / 45m / 30s */
function formatFocusSpan(ms) {
    const total = Math.max(0, Math.round(ms / 1000));
    if (total === 0) return '0m';
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
    if (m > 0) return `${m}m`;
    return `${total}s`;
}

function fmtDateTime(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return 'Unknown';
    return d.toLocaleString([], {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

/** "in 3h 12m" / "Running now" / "—" */
function countdownLabel(iso) {
    const t = new Date(iso).getTime();
    if (isNaN(t)) return '—';
    if (t - Date.now() <= 0) return 'Running now';
    const left = ContestHelpers.timeUntil(iso);
    return left ? `in ${left}` : 'soon';
}

// ══════════════════════════════════════════════════════
// MODULE: Theme
// ══════════════════════════════════════════════════════

const ThemeModule = (() => {
    let currentTheme = 'default';     // the user's explicit pick
    let effectiveTheme = 'default';   // what is actually painted (system mode wins)
    let followSystem = false;

    const darkQuery = typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null;

    const systemPrefersDark = () => !!darkQuery && darkQuery.matches;
    const resolve = theme => (followSystem ? (systemPrefersDark() ? 'dark' : 'default') : theme);

    /** Paint the popup + reflect the selection on every picker (sheet + intro). */
    function paint(theme) {
        effectiveTheme = resolve(theme);
        document.documentElement.setAttribute('data-ff-theme', effectiveTheme);

        document.querySelectorAll('.theme-card').forEach(card => {
            const isActive = card.dataset.ffTheme === effectiveTheme;
            card.setAttribute('aria-checked', String(isActive));
            card.tabIndex = isActive ? 0 : -1;
        });

        const toggle = $('system-theme-toggle');
        if (toggle) toggle.checked = followSystem;

        // Keep the boot cache in sync so the next popup open paints instantly.
        try { localStorage.setItem(THEME_BOOT_KEY, effectiveTheme); } catch (_) {}
    }

    function applyTheme(theme, { persist = true } = {}) {
        currentTheme = THEMES.includes(theme) ? theme : 'default';
        paint(currentTheme);
        if (persist) {
            saveTheme();
            syncThemeToContentScript(effectiveTheme);
        }
    }

    async function saveTheme() {
        try {
            await chrome.storage.local.set({
                [THEME_KEY]: currentTheme,
                [SYSTEM_THEME_KEY]: followSystem
            });
        } catch (_) {}
    }

    async function loadTheme() {
        let theme = 'default';
        let system = false;
        try {
            const stored = await chrome.storage.local.get({
                [THEME_KEY]: 'default',
                [SYSTEM_THEME_KEY]: false
            });
            if (THEMES.includes(stored[THEME_KEY])) theme = stored[THEME_KEY];
            system = !!stored[SYSTEM_THEME_KEY];
        } catch (_) {}
        currentTheme = theme;
        followSystem = system;
        paint(theme);
    }

    /** "Match system" — follow the OS light/dark setting until switched off. */
    function setFollowSystem(on) {
        followSystem = !!on;
        paint(currentTheme);
        saveTheme();
        syncThemeToContentScript(effectiveTheme);
    }

    if (darkQuery?.addEventListener) {
        darkQuery.addEventListener('change', () => {
            if (!followSystem) return;
            paint(currentTheme);
            syncThemeToContentScript(effectiveTheme);
        });
    }

    function syncThemeToContentScript(theme) {
        // Path 1: background service worker → every contest-site tab.
        chrome.runtime.sendMessage({ type: 'THEME_CHANGED', theme }).catch(() => {});

        // Path 2: direct message to the visible tab for an instant repaint.
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            if (tabs[0]?.id) {
                chrome.tabs.sendMessage(tabs[0].id, { type: 'THEME_CHANGED', theme }).catch(() => {});
            }
        });
    }

    return {
        applyTheme,
        loadTheme,
        setFollowSystem,
        systemPrefersDark,
        getCurrentTheme: () => currentTheme,
        getEffectiveTheme: () => effectiveTheme,
        isFollowingSystem: () => followSystem
    };
})();
// ══════════════════════════════════════════════════════
// MODULE: Timer — state & formatting
// ══════════════════════════════════════════════════════

const TimerModule = (() => {
    let timerState = defaultTimerState();
    let timerIntervalId = null;
    let lastLocalWrite = 0;

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
            return stored ? { ...defaultTimerState(), ...stored } : defaultTimerState();
        } catch (_) {
            return defaultTimerState();
        }
    }

    async function saveTimerState(state) {
        lastLocalWrite = Date.now();
        try { await chrome.storage.local.set({ [TIMER_STORAGE_KEY]: state }); } catch (_) {}
    }

    /** Gauge format: MM:SS below an hour, H:MM:SS above. */
    function formatDial(ms) {
        const sec = Math.max(0, Math.ceil(ms / 1000));
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        const pad = n => String(n).padStart(2, '0');
        return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
    }

    function computeRemainingMs(mm, ss) {
        const clampedMm = Math.min(999, Math.max(0, parseInt(mm, 10) || 0));
        const clampedSs = Math.min(59, Math.max(0, parseInt(ss, 10) || 0));
        return (clampedMm * 60 + clampedSs) * 1000;
    }

    const getState = () => timerState;
    const setState = next => { timerState = next; };
    const getIntervalId = () => timerIntervalId;
    const setIntervalId = id => { timerIntervalId = id; };
    const wroteRecently = () => Date.now() - lastLocalWrite < 400;

    return {
        defaultTimerState,
        loadTimerState,
        saveTimerState,
        formatDial,
        computeRemainingMs,
        getState,
        setState,
        getIntervalId,
        setIntervalId,
        wroteRecently
    };
})();

// ═════════════════════════════════════════════════════
// MODULE: Sessions — completed-focus ledger
// ═════════════════════════════════════════════════════

const SessionModule = (() => {
    async function read() {
        try {
            const { [SESSIONS_KEY]: stored } = await chrome.storage.local.get(SESSIONS_KEY);
            return Array.isArray(stored) ? stored : [];
        } catch (_) {
            return [];
        }
    }

    async function log(ms) {
        if (!Number.isFinite(ms) || ms < MIN_LOGGED_SESSION_MS) return;
        const cutoff = Date.now() - SESSION_RETENTION_DAYS * 24 * 60 * 60 * 1000;
        const list = (await read()).filter(s => s && s.ts >= cutoff);
        list.push({ d: localDayKey(), ts: Date.now(), ms: Math.round(ms) });
        try { await chrome.storage.local.set({ [SESSIONS_KEY]: list }); } catch (_) {}
    }

    /** @returns {{count:number, ms:number, total:number}} */
    async function summary() {
        const list = await read();
        const key = localDayKey();
        const today = list.filter(s => s.d === key);
        return {
            count: today.length,
            ms: today.reduce((sum, s) => sum + (s.ms || 0), 0),
            total: list.length
        };
    }

    /**
     * Seven-day focus ledger, oldest → today. Powers the spark strip; the data
     * was already being stored (SESSION_RETENTION_DAYS), it simply had no face.
     * @returns {Array<{key:string, ms:number, label:string, isToday:boolean}>}
     */
    async function weekly() {
        const list = await read();
        const days = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const key = localDayKey(date);
            const ms = list.filter(s => s.d === key).reduce((sum, s) => sum + (s.ms || 0), 0);
            days.push({
                key,
                ms,
                label: date.toLocaleDateString([], { weekday: 'short' }),
                isToday: i === 0
            });
        }
        return days;
    }

    return { read, log, summary, weekly };
})();

// ══════════════════════════════════════════════════════
// MODULE: Feedback — transient toasts
// ══════════════════════════════════════════════════════

const ToastModule = (() => {
    const MAX = 2;
    let wrap = null;

    function show(message, { tone = 'info', ttl = 2600 } = {}) {
        wrap = wrap || $('toast-wrap');
        if (!wrap || !message) return;

        while (wrap.children.length >= MAX) wrap.firstElementChild?.remove();

        const toast = document.createElement('div');
        toast.className = `toast${tone !== 'info' ? ` is-${tone}` : ''}`;
        toast.setAttribute('role', 'status');

        const lamp = document.createElement('span');
        lamp.className = 'lamp';
        lamp.setAttribute('aria-hidden', 'true');

        const text = document.createElement('span');
        text.textContent = message;

        toast.append(lamp, text);
        wrap.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('is-out');
            setTimeout(() => toast.remove(), 300);
        }, ttl);
    }

    return { show };
})();

// ══════════════════════════════════════════════════════
// MODULE: InkBar — keeps a 2px accent rule under the active tab
// ══════════════════════════════════════════════════════

const InkBar = (() => {
    /**
     * @param {HTMLElement} ink   the sliding rule
     * @param {HTMLElement} active the tab it should underline
     */
    function place(ink, active) {
        if (!ink || !active) return;
        const box = active.getBoundingClientRect();
        const parent = ink.parentElement?.getBoundingClientRect();
        if (!box.width || !parent) return;
        ink.style.width = `${box.width}px`;
        ink.style.transform = `translateX(${box.left - parent.left}px)`;
    }

    /** Wire a group of tabs (nav or radar filters) to its ink rule. */
    function track(container, inkSelector, tabSelector) {
        if (!container) return;
        const ink = container.querySelector(inkSelector);
        const tabs = Array.from(container.querySelectorAll(tabSelector));
        const sync = () => place(ink, tabs.find(t => t.classList.contains('is-active')));
        tabs.forEach(t => t.addEventListener('click', () => requestAnimationFrame(sync)));
        window.addEventListener('resize', sync);
        requestAnimationFrame(sync);
        return sync;
    }

    return { place, track };
})();

// ══════════════════════════════════════════════════════
// MODULE: Dial — the tick-marked gauge
// ═════════════════════════════════════════════════════

const DialModule = (() => {
    let progressEl = null;
    let headEl = null;

    function polar(radius, angle) {
        return {
            x: DIAL_CENTER + radius * Math.cos(angle),
            y: DIAL_CENTER + radius * Math.sin(angle)
        };
    }

    function buildTicks() {
        const frag = document.createDocumentFragment();
        for (let i = 0; i < TICK_COUNT; i++) {
            const major = i % 5 === 0;
            const angle = (i / TICK_COUNT) * Math.PI * 2;
            const outer = polar(TICK_OUTER, angle);
            const inner = polar(major ? TICK_INNER_MAJOR : TICK_INNER_MINOR, angle);
            const line = document.createElementNS(SVG_NS, 'line');
            line.setAttribute('x1', outer.x.toFixed(2));
            line.setAttribute('y1', outer.y.toFixed(2));
            line.setAttribute('x2', inner.x.toFixed(2));
            line.setAttribute('y2', inner.y.toFixed(2));
            if (major) line.setAttribute('class', 'major');
            frag.appendChild(line);
        }
        return frag;
    }

    function init() {
        progressEl = $('dial-progress');
        headEl = $('dial-head');
        const ticksEl = $('dial-ticks');

        if (ticksEl && !ticksEl.childElementCount) ticksEl.appendChild(buildTicks());

        if (progressEl) {
            progressEl.style.strokeDasharray = `${DIAL_CIRCUMFERENCE} ${DIAL_CIRCUMFERENCE}`;
            progressEl.style.strokeDashoffset = '0';
        }
    }

    /**
     * @param {number} fraction 1 = full ring (a loaded session), 0 = drained.
     *   The SVG is rotated -90° and the circle's dash runs counter-clockwise,
     *   so the head travels clockwise from 12 o'clock at −f·2π.
     */
    function render(fraction) {
        if (!progressEl || !headEl) return;
        const f = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
        progressEl.style.strokeDashoffset = String(DIAL_CIRCUMFERENCE * (1 - f));
        const head = polar(DIAL_RADIUS, -f * Math.PI * 2);
        headEl.setAttribute('cx', head.x.toFixed(2));
        headEl.setAttribute('cy', head.y.toFixed(2));
    }

    return { init, render };
})();
// ═════════════════════════════════════════════════════
// MODULE: Timer — UI
// ═════════════════════════════════════════════════════

const TimerUIModule = (() => {
    let el = {};
    let customOpen = false;

    const isActive = () => {
        const s = TimerModule.getState().status;
        return s === 'RUNNING' || s === 'PAUSED';
    };

    function cache() {
        el = {
            card: $('timer-card'),
            display: $('timer-display'),
            sub: $('dial-sub'),
            status: $('timer-status'),
            action: $('timer-action'),
            actionLabel: $('timer-action-label'),
            play: document.querySelector('.ico-play'),
            pause: document.querySelector('.ico-pause'),
            inputsRow: $('timer-inputs'),
            mm: $('timer-mm'),
            ss: $('timer-ss'),
            presetsWrap: $('presets'),
            stopwatchInfo: $('stopwatch-info'),
            presets: Array.from(document.querySelectorAll('.preset[data-min]')),
            customBtn: $('preset-custom'),
            liveChip: $('live-chip'),
            liveTime: $('live-chip-time'),
            statSessions: $('stat-sessions'),
            statFocus: $('stat-focus'),
            aboutSessions: $('about-sessions'),
            spark: $('week-spark'),
            weekLabel: $('week-label'),
            modeBtns: Array.from(document.querySelectorAll('.seg-btn'))
        };
    }

    const configuredMs = () => TimerModule.computeRemainingMs(el.mm?.value, el.ss?.value);

    function applyPreset(minutes, { render: shouldRender = true } = {}) {
        const total = Math.max(0, Math.round(minutes * 60));
        if (el.mm) el.mm.value = String(Math.floor(total / 60));
        if (el.ss) el.ss.value = String(total % 60);
        if (shouldRender) render();
    }

    function setMode(mode) {
        if (isActive()) return;
        const state = TimerModule.getState();
        TimerModule.setState({ ...state, mode });
        TimerModule.saveTimerState(TimerModule.getState());
        render();
    }

    function init() {
        cache();
        if (!el.display || !el.action) return;

        el.modeBtns.forEach(btn => {
            btn.addEventListener('click', () => setMode(btn.dataset.mode));
        });

        el.presets.forEach(btn => {
            btn.addEventListener('click', () => {
                if (isActive()) return;
                applyPreset(Number(btn.dataset.min));
            });
        });

        el.customBtn?.addEventListener('click', () => {
            if (isActive()) return;
            customOpen = !customOpen;
            el.customBtn.setAttribute('aria-expanded', String(customOpen));
            render();
            if (customOpen) {
                el.mm?.focus({ preventScroll: true });
                el.mm?.select();
            }
        });

        [el.mm, el.ss].forEach(input => {
            if (!input) return;
            input.addEventListener('input', render);
            input.addEventListener('change', () => {
                const max = input === el.mm ? 999 : 59;
                input.value = String(Math.min(max, Math.max(0, parseInt(input.value, 10) || 0)));
                render();
            });
            input.addEventListener('keydown', e => {
                if (e.key === 'Enter' && !isActive()) TimerActions.start();
            });
        });

        el.action.addEventListener('click', () => {
            if (TimerModule.getState().status === 'RUNNING') TimerActions.pause();
            else TimerActions.start();
        });

        el.liveChip?.addEventListener('click', () => ViewModule.set('focus', { focus: true }));

        applyPreset(25, { render: false });
        render();
    }
    function render() {
        if (!el.display) return;

        const state = TimerModule.getState();
        const isCountdown = state.mode === 'countdown';
        const running = state.status === 'RUNNING';
        const paused = state.status === 'PAUSED';
        const active = running || paused;
        const duration = state.durationMs || 0;

        // Mode switch
        el.modeBtns.forEach(btn => {
            const on = btn.dataset.mode === state.mode;
            btn.classList.toggle('is-active', on);
            btn.setAttribute('aria-checked', String(on));
            btn.disabled = active;
        });

        // Duration controls mirror the *effective* configured length, so a
        // running 45m session keeps its chip lit even after the inputs change.
        const configured = active ? duration : configuredMs();
        const matched = isCountdown
            ? el.presets.find(p => Number(p.dataset.min) * 60000 === configured)
            : null;

        if (el.presetsWrap) el.presetsWrap.hidden = !isCountdown;
        if (el.stopwatchInfo) el.stopwatchInfo.hidden = isCountdown;

        el.presets.forEach(p => {
            p.classList.toggle('is-active', p === matched);
            p.disabled = active || !isCountdown;
        });
        if (el.customBtn) {
            el.customBtn.classList.toggle('is-active', isCountdown && !matched);
            el.customBtn.disabled = active || !isCountdown;
        }
        if (el.inputsRow) el.inputsRow.hidden = !(isCountdown && customOpen);

        // Readout + gauge
        let shownMs;
        let fraction = 1;

        if (!isCountdown) {
            shownMs = running ? state.elapsed + (Date.now() - state.lastStarted) : state.elapsed;
            fraction = 0;
        } else if (running) {
            shownMs = Math.max(0, state.endTime - Date.now());
            fraction = duration > 0 ? shownMs / duration : 0;
        } else if (paused) {
            shownMs = Math.max(0, state.remainingMs);
            fraction = duration > 0 ? shownMs / duration : 0;
        } else {
            shownMs = configuredMs();
            fraction = 1;
        }

        const danger = isCountdown && active
            && shownMs <= DANGER_THRESHOLD_MS
            && duration >= DANGER_MIN_DURATION_MS;

        el.display.textContent = TimerModule.formatDial(shownMs);

        el.card?.classList.toggle('is-idle', !active);
        el.card?.classList.toggle('is-running', running);
        el.card?.classList.toggle('is-paused', paused);
        el.card?.classList.toggle('is-danger', danger);
        el.action?.classList.toggle('is-danger', danger);
        el.liveChip?.classList.toggle('is-danger', danger);
        el.card?.classList.toggle('is-stopwatch', !isCountdown);
        el.card?.classList.toggle('is-sweep', !isCountdown && running);

        if (!isCountdown) {
            el.status.textContent = running ? 'Tracking' : (paused ? 'Paused' : 'Ready');
            el.sub.textContent = running ? 'Elapsed' : (paused ? 'Held' : 'No target');
        } else if (danger) {
            el.status.textContent = 'Ending soon';
            el.sub.textContent = 'Wrap it up';
        } else if (running) {
            el.status.textContent = 'Focusing';
            el.sub.textContent = 'Focus session';
        } else if (paused) {
            el.status.textContent = 'Paused';
            el.sub.textContent = 'Held';
        } else {
            el.status.textContent = 'Ready';
            el.sub.textContent = `${Math.round(shownMs / 60000)} min session`;
        }

        el.actionLabel.textContent = running
            ? 'Pause'
            : (paused ? 'Resume' : (isCountdown ? 'Start focus' : 'Start tracking'));

        // NOTE: `hidden` is an HTMLElement IDL property — it does not exist on
        // SVGElement, so `svg.hidden = true` would only set a JS expando.
        // Toggle a class instead so the icon swap actually repaints.
        if (el.play) el.play.classList.toggle('is-off', running);
        if (el.pause) el.pause.classList.toggle('is-off', !running);

        DialModule.render(fraction);

        if (el.liveChip) {
            el.liveChip.hidden = !active;
            el.liveChip.classList.toggle('is-paused', paused);
            if (active && el.liveTime) el.liveTime.textContent = TimerModule.formatDial(shownMs);
        }
    }

    /** Seven-day spark strip — bars scale to the best day in the window. */
    function renderWeek(days) {
        if (!el.spark) return;
        const best = Math.max(...days.map(d => d.ms), 0);
        const frag = document.createDocumentFragment();
        days.forEach(day => {
            const bar = document.createElement('i');
            const ratio = best > 0 ? day.ms / best : 0;
            bar.style.height = `${day.ms > 0 ? 4 + Math.round(ratio * 12) : 3}px`;
            bar.classList.toggle('today', day.isToday);
            if (day.ms > 0) bar.classList.add('has');
            bar.title = `${day.label} — ${day.ms > 0 ? formatFocusSpan(day.ms) : 'no sessions'}`;
            frag.appendChild(bar);
        });
        el.spark.replaceChildren(frag);

        if (el.weekLabel) {
            const total = days.reduce((sum, d) => sum + d.ms, 0);
            el.weekLabel.textContent = total > 0 ? `${formatFocusSpan(total)} this week` : 'last 7 days';
        }
    }

    async function refreshStats() {
        const [stats, days] = await Promise.all([SessionModule.summary(), SessionModule.weekly()]);
        if (el.statSessions) el.statSessions.textContent = String(stats.count);
        if (el.statFocus) el.statFocus.textContent = formatFocusSpan(stats.ms);
        if (el.aboutSessions) {
            el.aboutSessions.textContent = stats.total === 1 ? '1 session' : `${stats.total} sessions`;
        }
        renderWeek(days);
    }

    function flashComplete() {
        if (!el.card) return;
        el.card.classList.add('just-finished');
        setTimeout(() => el.card?.classList.remove('just-finished'), 2400);
    }

    return { init, render, refreshStats, flashComplete };
})();
// ══════════════════════════════════════════════════════
// MODULE: Timer — actions
// ═════════════════════════════════════════════════════

const TimerActions = (() => {
    function start() {
        const state = { ...TimerModule.getState() };

        if (state.mode === 'countdown') {
            if (state.status === 'STOPPED') {
                state.remainingMs = TimerModule.computeRemainingMs($('timer-mm')?.value, $('timer-ss')?.value);
                state.notifiedMilestones = [];
                state.durationMs = 0;
            }
            if (state.remainingMs <= 0) return;
            state.status = 'RUNNING';
            state.durationMs = state.durationMs || state.remainingMs;
            state.endTime = Date.now() + state.remainingMs;
        } else {
            if (state.status === 'STOPPED') state.elapsed = 0;
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
        const state = { ...TimerModule.getState() };
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
        const next = { ...TimerModule.defaultTimerState(), mode: TimerModule.getState().mode };
        TimerModule.setState(next);
        TimerModule.saveTimerState(next);
        TimerUIModule.render();
        chrome.runtime.sendMessage({ type: 'TIMER_FINISHED', state: next }).catch(() => {});
    }

    /** Countdown reached zero — bank the session, then reset. */
    async function finish() {
        const previous = TimerModule.getState();
        const completedMs = previous.mode === 'countdown'
            ? (previous.durationMs || previous.remainingMs)
            : 0;

        TimerInterval.stop();
        const next = { ...TimerModule.defaultTimerState(), mode: previous.mode };
        TimerModule.setState(next);
        TimerModule.saveTimerState(next);
        TimerUIModule.render();
        chrome.runtime.sendMessage({ type: 'TIMER_FINISHED', state: next }).catch(() => {});

        if (completedMs > 0) {
            await SessionModule.log(completedMs);
            await TimerUIModule.refreshStats();
            TimerUIModule.flashComplete();
            ToastModule.show(`Session logged · ${formatFocusSpan(completedMs)}`, { tone: 'good', ttl: 3400 });
        }
    }

    return { start, pause, reset, finish };
})();

// ══════════════════════════════════════════════════════
// MODULE: Timer — interval
// ═════════════════════════════════════════════════════

const TimerInterval = (() => {
    function start() {
        stop();
        // One full re-render per second keeps readout, gauge, chip and labels
        // perfectly consistent; the 0.9s CSS dash transition smooths the arc.
        TimerModule.setIntervalId(setInterval(tick, 1000));
    }

    function stop() {
        const id = TimerModule.getIntervalId();
        if (id) {
            clearInterval(id);
            TimerModule.setIntervalId(null);
        }
    }

    function tick() {
        const state = TimerModule.getState();
        if (state.status !== 'RUNNING') return;
        if (state.mode === 'countdown' && Date.now() >= state.endTime) {
            TimerActions.finish();
            return;
        }
        TimerUIModule.render();
    }

    return { start, stop };
})();

// ═════════════════════════════════════════════════════
// MODULE: Timer — recovery
// ══════════════════════════════════════════════════════

const TimerRecovery = (() => {
    async function recover() {
        const state = await TimerModule.loadTimerState();
        TimerModule.setState(state);

        if (state.status === 'RUNNING') {
            if (state.mode === 'countdown' && Date.now() >= state.endTime) {
                await TimerActions.finish();
                return;
            }
            TimerInterval.start();
        }
        TimerUIModule.render();
    }

    return { recover };
})();
// ══════════════════════════════════════════════════════
// MODULE: Views
// ═════════════════════════════════════════════════════

const ViewModule = (() => {
    let current = 'focus';
    const VIEWS = ['focus', 'contests', 'settings'];

    function set(view, { focus = false } = {}) {
        if (!VIEWS.includes(view)) return;
        current = view;
        document.body.dataset.view = view;

        let activeTab = null;
        document.querySelectorAll('.nav-tab').forEach(tab => {
            const on = tab.dataset.view === view;
            tab.classList.toggle('is-active', on);
            tab.setAttribute('aria-selected', String(on));
            tab.tabIndex = on ? 0 : -1;
            if (on) activeTab = tab;
        });

        $('open-settings')?.classList.toggle('is-active', view === 'settings');

        // Accent rule follows the active tab (measured, so it survives zoom).
        InkBar.place(document.querySelector('.nav-ink'), activeTab);

        const faded = [];
        document.querySelectorAll('.view').forEach(section => {
            const on = section.id === `view-${view}`;
            section.classList.toggle('is-active', on);
            section.setAttribute('aria-hidden', String(!on));
            if (!on) faded.push(section);
        });
        faded.forEach(section => { section.scrollTop = 0; });

        if (focus) {
            let target = null;
            if (view === 'focus') target = $('timer-action');
            else if (view === 'contests') target = $('refresh-btn');
            else if (view === 'settings') target = $('test-sound-btn');
            target?.focus({ preventScroll: true });
        }
    }

    function init() {
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.addEventListener('click', () => set(tab.dataset.view, { focus: true }));
            tab.addEventListener('keydown', e => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                e.preventDefault();
                const idx = VIEWS.indexOf(tab.dataset.view);
                const nextIdx = e.key === 'ArrowRight'
                    ? (idx + 1) % VIEWS.length
                    : (idx - 1 + VIEWS.length) % VIEWS.length;
                set(VIEWS[nextIdx], { focus: true });
            });
        });
        $('open-settings')?.addEventListener('click', () => set('settings', { focus: true }));
        set('focus');
    }

    return { init, set, get: () => current };
})();

// ═════════════════════════════════════════════════════
// MODULE: Settings sheet / view bridge
// ═════════════════════════════════════════════════════

const SettingsSheetModule = (() => {
    function open() {
        ViewModule.set('settings', { focus: true });
    }

    function close({ restoreFocus = true } = {}) {
        ViewModule.set('focus', { focus: restoreFocus });
    }

    function init() {
        $('open-settings')?.addEventListener('click', open);
    }

    return { init, open, close, get isOpen() { return ViewModule.get() === 'settings'; } };
})();

// ═════════════════════════════════════════════════════
// MODULE: Keyboard shortcuts
// ═════════════════════════════════════════════════════

const KeyboardModule = (() => {
    function isTypingTarget(node) {
        if (!node) return false;
        const tag = node.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable;
    }

    function init() {
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && OnboardingModule.isOpen) {
                e.preventDefault();
                OnboardingModule.close();
                return;
            }

            if (e.key === 'Escape' && ViewModule.get() === 'settings') {
                e.preventDefault();
                ViewModule.set('focus');
                return;
            }

            if (e.metaKey || e.ctrlKey || e.altKey) return;
            if (isTypingTarget(e.target)) return;
            if (OnboardingModule.isOpen) return;

            // Buttons already handle Space/Enter themselves.
            if (e.target?.closest?.('button') && (e.key === ' ' || e.key === 'Enter')) return;

            if (e.key === ' ') {
                e.preventDefault();
                if (TimerModule.getState().status === 'RUNNING') TimerActions.pause();
                else TimerActions.start();
            } else if (e.key === 'r' || e.key === 'R') {
                TimerActions.reset();
            } else if (e.key === '1') {
                ViewModule.set('focus');
            } else if (e.key === '2') {
                ViewModule.set('contests');
            } else if (e.key === '3') {
                ViewModule.set('settings');
            }
        });
    }

    return { init };
})();

// ══════════════════════════════════════════════════════
// MODULE: Contest — shared helpers (from contest-utils.js)
// ══════════════════════════════════════════════════════

const ContestHelpers = (() => {
    /* globals getContestStatus, formatDuration, formatDateTime, timeUntil */
    return { getContestStatus, formatDuration, formatDateTime, timeUntil };
})();

// ══════════════════════════════════════════════════════
// MODULE: Contest — AtCoder parser
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
            // AtCoder upcoming table has 4 columns: Start Time | Contest Name | Duration | Rated Range
            if (cells.length < 4) return;

            // Contest name: the last <a href="/contests/..."> inside the second cell (column 1).
            // AtCoder sometimes includes extra links (rating predictors, etc.) before
            // the actual contest name; we want the last one.
            const links = cells[1].querySelectorAll('a[href^="/contests/"]');
            if (!links.length) return;
            const lastLink = links[links.length - 1];
            const contestPath = lastLink.getAttribute('href');
            const contestName = lastLink.textContent.trim();

            // Start time from <time> element in the first cell (column 0)
            const timeEl = cells[0].querySelector('time');
            if (!timeEl) return;
            const startTimeStr = timeEl.getAttribute('datetime') || timeEl.textContent.trim();
            // AtCoder uses format "2024-06-01 12:00:00+09:00" — replace space with T for ISO
            const startTime = new Date(startTimeStr.replace(' ', 'T'));
            if (Number.isNaN(startTime.getTime())) return;

            // Duration from the third cell (column 2), e.g. "01:30"
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
// MODULE: Contest — caching
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
// MODULE: Contest — filter & sort
// ══════════════════════════════════════════════════════

const ContestSortFilter = (() => {
    /* globals contestComparator, filterAndSort, sortByTime */
    return { filterAndSort, sortByTime };
})();

// ══════════════════════════════════════════════════════
// MODULE: Contest — fetching
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
                let startTime = c.startTime;
                if (!startTime) return;
                if (startTime > 1e12) startTime = Math.floor(startTime / 1000);
                const start_time = new Date(startTime * 1000).toISOString();
                if (!start_time) return;
                lcContests.push({
                    name: c.title || 'LeetCode Contest',
                    url: c.titleSlug ? `https://leetcode.com/contest/${c.titleSlug}` : null,
                    site: 'LeetCode', status: 'BEFORE', start_time,
                    duration: c.duration ? Math.round(c.duration > 1e6 ? c.duration / 1000 / 60 : c.duration / 60) : 90
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
// MODULE: Contest — rendering
// ═════════════════════════════════════════════════════

const ContestRenderer = (() => {
    let activeTab = 'near';
    let selectedPlatform = 'all';
    let searchQuery = '';
    let cachedNear = [];
    let cachedLater = [];
    let visible = [];

    const ICON_CALENDAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="16" rx="3"/><path d="M3.5 10h17M8.5 3v4M15.5 3v4"/></svg>';
    const ICON_ALERT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 8.5v5"/><circle cx="12" cy="16.9" r="0.9" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="8.6"/></svg>';

    const platformClass = site => PLATFORM_CONFIG[site]?.cls || 'other';
    const platformBadgeText = site => PLATFORM_CONFIG[site]?.badge || site.slice(0, 3).toUpperCase();

    /** Timing label that stays honest for live contests: "ends in 42m". */
    function timingLabel(startIso, durationMin) {
        const start = new Date(startIso).getTime();
        if (isNaN(start)) return '—';
        const now = Date.now();
        if (start > now) {
            const left = ContestHelpers.timeUntil(startIso);
            return left ? `in ${left}` : 'soon';
        }
        const durationMs = (durationMin || 0) * 60000;
        if (durationMs > 0) {
            const remaining = start + durationMs - now;
            if (remaining > 0) return `ends in ${formatFocusSpan(remaining)}`;
        }
        return 'Running now';
    }

    function urgencyFor(startIso) {
        const msUntil = new Date(startIso).getTime() - Date.now();
        if (!Number.isFinite(msUntil) || msUntil <= 0) return null;
        if (msUntil <= 60 * 60 * 1000) return { cls: 'urgency-critical', label: '< 1h' };
        if (msUntil <= 4 * 60 * 60 * 1000) return { cls: 'urgency-high', label: '< 4h' };
        return null;
    }

    function spineValue(contest, status, urgency) {
        if (status === 'ongoing') return 'var(--good)';
        if (urgency?.cls === 'urgency-critical') return 'var(--bad)';
        if (urgency?.cls === 'urgency-high') return 'var(--warn)';
        return `var(--p-${platformClass(contest.site)})`;
    }

    /** Halo behind the row lamp — derived from the same signal as the spine. */
    function haloValue(status, urgency) {
        if (status === 'ongoing') return 'var(--good-soft)';
        if (urgency?.cls === 'urgency-critical') return 'var(--bad-soft)';
        if (urgency?.cls === 'urgency-high') return 'var(--warn-soft)';
        return 'transparent';
    }

    function createTag(text, className) {
        const span = document.createElement('span');
        span.className = className;
        span.textContent = text;
        return span;
    }

    function metaDot() {
        const dot = document.createElement('span');
        dot.className = 'dot';
        dot.textContent = '·';
        return dot;
    }

    function filterList(items) {
        let result = items;
        if (selectedPlatform !== 'all') {
            result = result.filter(c => c.site === selectedPlatform);
        }
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            result = result.filter(c => (c.name && c.name.toLowerCase().includes(q)) || (c.site && c.site.toLowerCase().includes(q)));
        }
        return result;
    }

    function createCard(contest) {
        if (!contest?.site) return null;

        const status = ContestHelpers.getContestStatus(contest);
        const isOngoing = status === 'ongoing';
        const urgency = isOngoing ? null : urgencyFor(contest.start_time);

        const card = document.createElement('div');
        card.className = ['contest-card', 'radar-row', isOngoing ? 'is-ongoing' : '', urgency?.cls || ''].filter(Boolean).join(' ');
        card.style.setProperty('--spine', spineValue(contest, status, urgency));
        card.style.setProperty('--lamp-halo', haloValue(status, urgency));
        card.dataset.start = contest.start_time || '';
        card.dataset.dur = String(contest.duration || 0);
        card.tabIndex = 0;

        // ── Top Bar: Badges + Countdown ──
        const top = document.createElement('div');
        top.className = 'rc-top';

        const badges = document.createElement('div');
        badges.className = 'rc-badges';

        const lamp = document.createElement('span');
        lamp.className = 'radar-lamp';
        lamp.setAttribute('aria-hidden', 'true');

        badges.appendChild(lamp);
        badges.appendChild(createTag(platformBadgeText(contest.site), `ptag ${platformClass(contest.site)}`));
        if (isOngoing) badges.appendChild(createTag('LIVE', 'tag-live'));
        if (contest.isGym) badges.appendChild(createTag('GYM', 'tag-gym'));

        const count = document.createElement('span');
        count.className = 'contest-duration radar-count';
        count.textContent = timingLabel(contest.start_time, contest.duration);

        top.append(badges, count);

        // ── Title ──
        const title = document.createElement('div');
        title.className = 'rc-title';
        if (contest.url) {
            const a = document.createElement('a');
            a.href = contest.url;
            a.target = '_blank';
            a.rel = 'noopener';
            a.textContent = contest.name || 'Untitled';
            title.appendChild(a);
        } else {
            title.textContent = contest.name || 'Untitled';
        }

        // ── Bottom Meta Row: Date/Time + Duration ──
        const bot = document.createElement('div');
        bot.className = 'rc-bot';

        const timeItem = document.createElement('span');
        timeItem.className = 'rc-meta-item';
        const start = new Date(contest.start_time);
        const dateStr = isNaN(start.getTime()) ? 'Unknown' : fmtDateTime(contest.start_time);
        const timeIco = document.createElementNS(SVG_NS, 'svg');
        timeIco.setAttribute('class', 'rc-ico');
        timeIco.setAttribute('viewBox', '0 0 24 24');
        timeIco.setAttribute('fill', 'none');
        timeIco.setAttribute('stroke', 'currentColor');
        timeIco.setAttribute('stroke-width', '2');
        timeIco.setAttribute('stroke-linecap', 'round');
        timeIco.setAttribute('stroke-linejoin', 'round');
        timeIco.setAttribute('aria-hidden', 'true');
        const r1 = document.createElementNS(SVG_NS, 'rect');
        r1.setAttribute('x', '3');
        r1.setAttribute('y', '4');
        r1.setAttribute('width', '18');
        r1.setAttribute('height', '18');
        r1.setAttribute('rx', '2');
        const p1 = document.createElementNS(SVG_NS, 'path');
        p1.setAttribute('d', 'M16 2v4M8 2v4M3 10h18');
        timeIco.append(r1, p1);
        const timeSpan = document.createElement('span');
        timeSpan.textContent = dateStr;
        timeItem.append(timeIco, timeSpan);

        const durItem = document.createElement('span');
        durItem.className = 'rc-meta-item';
        const durStr = contest.duration ? ContestHelpers.formatDuration(contest.duration) : '';
        if (durStr) {
            const durIco = document.createElementNS(SVG_NS, 'svg');
            durIco.setAttribute('class', 'rc-ico');
            durIco.setAttribute('viewBox', '0 0 24 24');
            durIco.setAttribute('fill', 'none');
            durIco.setAttribute('stroke', 'currentColor');
            durIco.setAttribute('stroke-width', '2');
            durIco.setAttribute('stroke-linecap', 'round');
            durIco.setAttribute('stroke-linejoin', 'round');
            durIco.setAttribute('aria-hidden', 'true');
            const c1 = document.createElementNS(SVG_NS, 'circle');
            c1.setAttribute('cx', '12');
            c1.setAttribute('cy', '12');
            c1.setAttribute('r', '10');
            const p2 = document.createElementNS(SVG_NS, 'path');
            p2.setAttribute('d', 'M12 6v6l4 2');
            durIco.append(c1, p2);
            const durSpan = document.createElement('span');
            durSpan.textContent = durStr;
            durItem.append(durIco, durSpan);
            bot.append(timeItem, durItem);
        } else {
            bot.append(timeItem);
        }

        card.append(top, title, bot);

        const open = () => { if (contest.url) chrome.tabs.create({ url: contest.url, active: false }); };
        card.addEventListener('click', e => { if (!e.target.closest('a')) open(); });
        card.addEventListener('keydown', e => {
            if (e.key !== 'Enter' || e.target.closest('a')) return;
            e.preventDefault();
            open();
        });

        return card;
    }

    /**
     * Empty / error / loading state.
     * @param {{icon:string,title:string,sub?:string,actionLabel?:string,onAction?:Function,
     *          secondaryLabel?:string,onSecondary?:Function,isError?:boolean}} opts
     */
    function stateBlock({ icon, title, sub, actionLabel, onAction, secondaryLabel, onSecondary, isError = false }) {
        const wrap = document.createElement('div');
        wrap.className = `state-block${isError ? ' is-error' : ''}`;

        const ico = document.createElement('div');
        ico.className = 'state-ico';
        try {
            const svgDoc = new DOMParser().parseFromString(icon, 'image/svg+xml');
            if (svgDoc.documentElement && svgDoc.documentElement.nodeName === 'svg') {
                ico.appendChild(svgDoc.documentElement);
            }
        } catch (_) {}
        const dot = document.createElement('i');
        dot.setAttribute('aria-hidden', 'true');
        ico.appendChild(dot);

        const h = document.createElement('div');
        h.className = 'state-title';
        h.textContent = title;

        wrap.append(ico, h);

        if (sub) {
            const p = document.createElement('div');
            p.className = 'state-sub';
            p.textContent = sub;
            wrap.appendChild(p);
        }

        const actions = [];
        if (actionLabel && onAction) actions.push({ label: actionLabel, run: onAction, ghost: false });
        if (secondaryLabel && onSecondary) actions.push({ label: secondaryLabel, run: onSecondary, ghost: true });

        if (actions.length) {
            const row = document.createElement('div');
            row.className = 'state-actions';
            actions.forEach(({ label, run, ghost }) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `state-action${ghost ? ' ghost' : ''}`;
                btn.textContent = label;
                btn.addEventListener('click', () => run(btn));
                row.appendChild(btn);
            });
            wrap.appendChild(row);
        }

        return wrap;
    }

    function syncTabs() {
        let active = null;
        document.querySelectorAll('.filter[data-tab]').forEach(tab => {
            const on = tab.dataset.tab === activeTab;
            tab.classList.toggle('is-active', on);
            tab.setAttribute('aria-selected', String(on));
            tab.tabIndex = on ? 0 : -1;
            if (on) active = tab;
        });
        InkBar.place(document.querySelector('.filters-ink'), active);

        const nearCount = $('tab-near-count');
        const laterCount = $('tab-later-count');
        if (nearCount) nearCount.textContent = String(cachedNear.length);
        if (laterCount) laterCount.textContent = String(cachedLater.length);
    }

    /**
     * The nav badge is a *different* signal from the radar tab counts: it only
     * appears when something is imminent (live, or starting within the hour),
     * so it never just repeats "6 contests in the next 24h".
     */
    function syncNavBadge() {
        const badge = $('nav-contest-count');
        if (!badge) return;

        const live = cachedNear.filter(c => ContestHelpers.getContestStatus(c) === 'ongoing').length;
        const soon = cachedNear.filter(c => {
            const ms = new Date(c.start_time).getTime() - Date.now();
            return ms > 0 && ms <= 60 * 60 * 1000;
        }).length;

        const count = live + soon;
        badge.classList.toggle('is-hot', soon > 0);
        badge.classList.toggle('is-live', soon === 0 && live > 0);
        badge.hidden = count === 0;
        badge.textContent = String(count);
        badge.title = live > 0
            ? `${live} contest${live === 1 ? '' : 's'} live now`
            : `${soon} contest${soon === 1 ? '' : 's'} starting within the hour`;
    }

    function setTab(tab) {
        if (tab !== 'near' && tab !== 'later') return;
        activeTab = tab;
        syncTabs();
        renderCurrentTab();
    }

    function buildItems(items, empty) {
        const frag = document.createDocumentFragment();
        const cards = ContestSortFilter.sortByTime(items).map(createCard).filter(Boolean);

        if (!cards.length) {
            frag.appendChild(stateBlock(empty));
            return frag;
        }
        cards.forEach(card => frag.appendChild(card));
        return frag;
    }

    /** The radar's own "go be productive instead" escape hatch. */
    const focusInstead = () => ViewModule.set('focus', { focus: true });

    function renderCurrentTab() {
        const list = $('contest-list');
        if (!list) return;
        const isNear = activeTab === 'near';
        const baseItems = isNear ? cachedNear : cachedLater;
        const filtered = filterList(baseItems);

        if (filtered.length === 0 && (selectedPlatform !== 'all' || searchQuery)) {
            list.replaceChildren(stateBlock({
                icon: ICON_CALENDAR,
                title: 'No matching contests',
                sub: 'No rounds match the current platform or search filters.',
                actionLabel: 'Reset filters',
                onAction: () => {
                    selectedPlatform = 'all';
                    searchQuery = '';
                    const searchInput = $('radar-search');
                    if (searchInput) searchInput.value = '';
                    const searchClear = $('search-clear');
                    if (searchClear) searchClear.hidden = true;
                    document.querySelectorAll('.pfilter').forEach(btn => {
                        btn.classList.toggle('is-active', btn.dataset.platform === 'all');
                    });
                    renderCurrentTab();
                }
            }));
            return;
        }

        list.replaceChildren(buildItems(filtered, isNear
            ? {
                icon: ICON_CALENDAR,
                title: 'Clear for 24 hours',
                sub: 'No contest starts in the next day. A good window for a practice session.',
                actionLabel: 'Start a session',
                onAction: focusInstead,
                secondaryLabel: 'Refresh',
                onSecondary: btn => ContestListModule.refresh(btn)
            }
            : {
                icon: ICON_CALENDAR,
                title: 'No contests scheduled',
                sub: 'Rounds from all four platforms land here the moment they are announced.',
                actionLabel: 'Refresh',
                onAction: btn => ContestListModule.refresh(btn)
            }));
    }
    function render(contests) {
        const list = $('contest-list');
        if (!list) return;

        const items = Array.isArray(contests) ? contests : [];

        if (!items.length) {
            cachedNear = [];
            cachedLater = [];
            syncTabs();
            syncNavBadge();
            list.replaceChildren(stateBlock({
                icon: ICON_CALENDAR,
                title: 'Radar is clear',
                sub: 'Nothing scheduled right now — a good moment for a practice session.',
                actionLabel: 'Start a session',
                onAction: focusInstead,
                secondaryLabel: 'Refresh',
                onSecondary: btn => ContestListModule.refresh(btn)
            }));
            NextUpModule.update([]);
            return;
        }

        const now = Date.now();
        cachedNear = [];
        cachedLater = [];

        items.forEach(c => {
            const isOngoing = ContestHelpers.getContestStatus(c) === 'ongoing';
            const startMs = new Date(c.start_time).getTime();
            if (!isNaN(startMs) && (isOngoing || (startMs - now <= TWENTY_FOUR_HOURS_MS && startMs > now))) {
                cachedNear.push(c);
            }
            cachedLater.push(c);
        });

        syncTabs();
        syncNavBadge();
        renderCurrentTab();
        NextUpModule.update(items);
    }

    function renderError(msg) {
        const list = $('contest-list');
        if (!list) return;
        list.replaceChildren(stateBlock({
            icon: ICON_ALERT,
            title: 'Radar offline',
            sub: msg,
            actionLabel: 'Try again',
            onAction: btn => ContestListModule.refresh(btn),
            secondaryLabel: 'Start a session',
            onSecondary: focusInstead,
            isError: true
        }));
    }

    function setLoadingState() {
        const list = $('contest-list');
        if (!list) return;
        const frag = document.createDocumentFragment();
        for (let i = 0; i < 4; i++) {
            const row = document.createElement('div');
            row.className = 'skeleton-row';
            if (i > 0) row.setAttribute('aria-hidden', 'true');
            else row.setAttribute('aria-label', 'Scanning for contests');
            row.append(document.createElement('span'), document.createElement('span'));
            frag.appendChild(row);
        }
        list.replaceChildren(frag);
    }

    /** Re-label countdowns in place so scrolling position survives a refresh. */
    function refreshTimes() {
        document.querySelectorAll('.contest-card[data-start]').forEach(card => {
            const node = card.querySelector('.contest-duration');
            if (node) node.textContent = timingLabel(card.dataset.start, Number(card.dataset.dur));
        });
        syncNavBadge();
        NextUpModule.refresh();
    }

    function init() {
        document.querySelectorAll('.filter[data-tab]').forEach(tab => {
            tab.addEventListener('click', () => setTab(tab.dataset.tab));
            tab.addEventListener('keydown', e => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                e.preventDefault();
                setTab(tab.dataset.tab === 'near' ? 'later' : 'near');
                const active = document.querySelector(`.filter[data-tab="${activeTab}"]`);
                active?.focus({ preventScroll: true });
            });
        });

        document.querySelectorAll('.pfilter').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.pfilter').forEach(b => b.classList.remove('is-active'));
                btn.classList.add('is-active');
                selectedPlatform = btn.dataset.platform;
                renderCurrentTab();
            });
        });

        const searchInput = $('radar-search');
        const searchClear = $('search-clear');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                searchQuery = searchInput.value.trim();
                if (searchClear) searchClear.hidden = !searchQuery;
                renderCurrentTab();
            });
        }
        if (searchClear) {
            searchClear.addEventListener('click', () => {
                if (searchInput) {
                    searchInput.value = '';
                    searchInput.focus();
                }
                searchQuery = '';
                searchClear.hidden = true;
                renderCurrentTab();
            });
        }

        syncTabs();
    }

    const getActive = () => [...cachedNear, ...cachedLater];

    return {
        init, render, renderCurrentTab, renderError, setLoadingState,
        refreshTimes, getActive, timingLabel, urgencyFor
    };
})();
// ══════════════════════════════════════════════════════
// MODULE: Next-up card (Focus view)
// ══════════════════════════════════════════════════════

const NextUpModule = (() => {
    let contest = null;

    function applyHeat(btn, startIso) {
        const msUntil = new Date(startIso).getTime() - Date.now();
        const live = ContestHelpers.getContestStatus({ start_time: startIso, duration: contest?.duration }) === 'ongoing';
        btn.classList.toggle('is-live', live);
        btn.classList.toggle('is-hot', !live && msUntil > 0 && msUntil <= 60 * 60 * 1000);
        btn.classList.toggle('is-warm', !live && msUntil > 60 * 60 * 1000 && msUntil <= 4 * 60 * 60 * 1000);
    }

    function renderCard() {
        const slot = $('next-up');
        if (!slot) return;
        slot.replaceChildren();
        if (!contest?.url) return;

        const isOngoing = ContestHelpers.getContestStatus(contest) === 'ongoing';
        const cls = PLATFORM_CONFIG[contest.site]?.cls || 'other';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'nextup';
        btn.style.setProperty('--spine', isOngoing ? 'var(--good)' : `var(--p-${cls})`);
        btn.style.setProperty('--lamp-halo', isOngoing ? 'var(--good-soft)' : 'transparent');

        const top = document.createElement('span');
        top.className = 'nextup-top';

        const lamp = document.createElement('span');
        lamp.className = 'lamp';
        lamp.setAttribute('aria-hidden', 'true');

        const eyebrow = document.createElement('span');
        eyebrow.className = 'nextup-eyebrow';
        eyebrow.textContent = isOngoing ? 'Live now' : 'Next up';

        const badge = document.createElement('span');
        badge.className = `ptag ${cls}`;
        badge.textContent = PLATFORM_CONFIG[contest.site]?.badge || '—';

        top.append(lamp, eyebrow, badge);

        const name = document.createElement('span');
        name.className = 'nextup-name';
        name.textContent = contest.name || 'Untitled';

        const bot = document.createElement('span');
        bot.className = 'nextup-bot';

        const when = document.createElement('span');
        when.className = 'nextup-when';
        when.textContent = fmtDateTime(contest.start_time);

        const count = document.createElement('span');
        count.className = 'nextup-count';
        count.textContent = ContestRenderer.timingLabel(contest.start_time, contest.duration);

        bot.append(when, count);
        btn.append(top, name, bot);

        applyHeat(btn, contest.start_time);
        btn.addEventListener('click', () => chrome.tabs.create({ url: contest.url, active: true }));
        slot.appendChild(btn);
    }

    function update(list) {
        const sorted = ContestSortFilter.sortByTime(Array.isArray(list) ? list : []);
        contest = sorted[0] || null;
        renderCard();
        updateBrandSub();
    }

    function refresh() {
        const slot = $('next-up');
        if (slot) {
            const btn = slot.querySelector('.nextup');
            const count = slot.querySelector('.nextup-count');
            if (contest && btn && count) {
                count.textContent = ContestRenderer.timingLabel(contest.start_time, contest.duration);
                applyHeat(btn, contest.start_time);
            }
        }
        updateBrandSub();
    }

    /**
     * The deck ticker doubles as a live contest signal. It deliberately shows
     * *timing* rather than the contest title — titles are long enough to be
     * ellipsised on a 400px popup, and the countdown is the thing that matters.
     */
    function updateBrandSub() {
        const sub = $('brand-sub');
        if (!sub) return;

        sub.classList.remove('is-hot', 'is-warm', 'is-live');

        if (!contest) {
            sub.textContent = 'Radar standing by';
            return;
        }

        const msUntil = new Date(contest.start_time).getTime() - Date.now();
        const isOngoing = ContestHelpers.getContestStatus(contest) === 'ongoing';

        if (isOngoing) {
            sub.textContent = 'A contest is live right now';
            sub.classList.add('is-live');
            return;
        }

        const left = ContestHelpers.timeUntil(contest.start_time);
        sub.textContent = msUntil > 0 && left ? `next contest in ${left}` : 'next contest starting soon';
        if (msUntil > 0 && msUntil <= 60 * 60 * 1000) sub.classList.add('is-hot');
        else if (msUntil > 0 && msUntil <= 4 * 60 * 60 * 1000) sub.classList.add('is-warm');
    }

    return { update, refresh, updateBrandSub };
})();
// ══════════════════════════════════════════════════════
// MODULE: Contest — list controller
// ═════════════════════════════════════════════════════

const ContestListModule = (() => {
    let currentMain = [];
    let currentGym = [];
    let refreshIntervalId = null;
    let tickIntervalId = null;
    let loadGeneration = 0;
    let lastSync = 0;
    let syncing = false;

    function footText() {
        if (syncing) return lastSync ? 'Refreshing…' : 'Syncing…';
        if (!lastSync) return 'Not synced yet';
        const secs = Math.round((Date.now() - lastSync) / 1000);
        if (secs < 10) return 'Updated just now';
        if (secs < 60) return `Updated ${secs}s ago`;
        const mins = Math.round(secs / 60);
        return mins < 60 ? `Updated ${mins}m ago` : `Updated ${Math.round(mins / 60)}h ago`;
    }

    function refreshFoot() {
        const node = $('updated-ago');
        if (node) node.textContent = footText();
    }

    function showTimezone() {
        const node = $('tz-label');
        if (!node) return;
        try {
            const offset = -new Date().getTimezoneOffset();
            const sign = offset >= 0 ? '+' : '−';
            const hours = Math.floor(Math.abs(offset) / 60);
            const mins = Math.abs(offset) % 60;
            node.textContent = `times in GMT${sign}${hours}${mins ? `:${String(mins).padStart(2, '0')}` : ''}`;
        } catch (_) {
            node.textContent = 'local time';
        }
    }

    async function load({ silent = false } = {}) {
        const myGen = ++loadGeneration;
        syncing = true;
        refreshFoot();

        const [cachedMain, cachedGym] = await Promise.all([ContestCache.getMain(), ContestCache.getGym()]);
        if (myGen !== loadGeneration) return;

        currentMain = cachedMain || [];
        currentGym = cachedGym || [];

        if (currentMain.length || currentGym.length) {
            ContestRenderer.render(ContestSortFilter.sortByTime([...currentMain, ...currentGym]));
        } else if (!silent) {
            ContestRenderer.setLoadingState();
        }

        try {
            const main = await ContestFetch.fetchMain();
            if (myGen !== loadGeneration) return;
            currentMain = main;
            await ContestCache.setMain(main);
            lastSync = Date.now();
            ContestRenderer.render(ContestSortFilter.sortByTime([...currentMain, ...currentGym]));
        } catch (error) {
            if (myGen !== loadGeneration) return;
            if (!currentMain.length && !currentGym.length) {
                const message = !navigator.onLine
                    ? 'You appear to be offline. Reconnect and try again.'
                    : (error?.message || 'Could not reach the contest servers.');
                ContestRenderer.renderError(message);
            }
        } finally {
            if (myGen === loadGeneration) {
                syncing = false;
                refreshFoot();
            }
        }

        ContestFetch.fetchGym().then(gym => {
            if (myGen !== loadGeneration) return;
            if (gym?.length) {
                currentGym = gym;
                ContestCache.setGym(gym);
                ContestRenderer.render(ContestSortFilter.sortByTime([...currentMain, ...currentGym]));
            }
        }).catch(() => {});
    }

    /** Manual refresh — also drives the spinner and state-action loading text. */
    function refresh(button) {
        const isStateAction = !!button?.classList?.contains('state-action');
        const originalLabel = button?.textContent;

        if (button) {
            button.disabled = true;
            button.classList.add('is-spinning');
            if (isStateAction) button.textContent = 'Retrying…';
        }

        return load().finally(() => {
            if (!button) return;
            button.disabled = false;
            button.classList.remove('is-spinning');
            if (isStateAction && button.isConnected) button.textContent = originalLabel;
        });
    }

    function startAutoRefresh() {
        stopAutoRefresh();
        refreshIntervalId = setInterval(() => load({ silent: true }), 60000);
        tickIntervalId = setInterval(() => {
            ContestRenderer.refreshTimes();
            refreshFoot();
        }, 20000);
    }

    function stopAutoRefresh() {
        if (refreshIntervalId) { clearInterval(refreshIntervalId); refreshIntervalId = null; }
        if (tickIntervalId) { clearInterval(tickIntervalId); tickIntervalId = null; }
    }

    return { load, refresh, startAutoRefresh, stopAutoRefresh, showTimezone };
})();
// ══════════════════════════════════════════════════════
// MODULE: Settings — Zen Mode
// ═════════════════════════════════════════════════════

const SettingsModule = (() => {
    async function init() {
        const zenToggle = $('zen-toggle');
        const zenOptions = $('zen-options');
        if (!zenToggle) return;

        try {
            const stored = await chrome.storage.local.get({
                ff_zenMode: false,
                ff_zen_width: 'comfortable',
                ff_zen_font_size: 'normal',
                ff_zen_companion: true
            });
            zenToggle.checked = !!stored.ff_zenMode;
            if (zenOptions) zenOptions.hidden = !zenToggle.checked;

            // Width radios
            document.querySelectorAll('input[name="zen_width"]').forEach(radio => {
                radio.checked = radio.value === stored.ff_zen_width;
                radio.addEventListener('change', () => {
                    chrome.storage.local.set({ ff_zen_width: radio.value }).catch(() => {});
                });
            });

            // Font size radios
            document.querySelectorAll('input[name="zen_font_size"]').forEach(radio => {
                radio.checked = radio.value === stored.ff_zen_font_size;
                radio.addEventListener('change', () => {
                    chrome.storage.local.set({ ff_zen_font_size: radio.value }).catch(() => {});
                });
            });

            // Companion rail checkbox
            const companionToggle = $('zen-companion-toggle');
            if (companionToggle) {
                companionToggle.checked = stored.ff_zen_companion !== false;
                companionToggle.addEventListener('change', () => {
                    chrome.storage.local.set({ ff_zen_companion: companionToggle.checked }).catch(() => {});
                });
            }
        } catch (_) {}

        zenToggle.addEventListener('change', async e => {
            const enabled = e.target.checked;
            try { await chrome.storage.local.set({ ff_zenMode: enabled }); } catch (_) {}
            if (zenOptions) {
                zenOptions.hidden = !enabled;
                if (enabled) zenOptions.classList.add('is-animating');
            }

            // Broadcast to all supported competitive programming tabs
            try {
                const tabs = await chrome.tabs.query({});
                tabs.forEach(tab => {
                    if (tab.id && tab.url && (
                        tab.url.includes('codeforces.com') ||
                        tab.url.includes('atcoder.jp') ||
                        tab.url.includes('codechef.com')
                    )) {
                        chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_ZEN', enabled }).catch(() => {});
                    }
                });
            } catch (_) {}

            ToastModule.show(enabled ? 'Zen Mode on · Distraction-free workspace active' : 'Zen Mode off', {
                tone: enabled ? 'good' : 'info'
            });
        });
    }

    return { init };
})();

// ══════════════════════════════════════════════════════
// MODULE: Settings — focus alerts (timer milestones)
// The background worker has always supported these; until now the popup
// offered no way to reach them.
// ══════════════════════════════════════════════════════

const FocusAlertsModule = (() => {
    async function init() {
        const toggle = $('timer-alerts-toggle');
        const section = $('alert-section');
        if (!toggle || !section) return;

        const stored = await chrome.storage.local.get({
            [TIMER_ALERTS_KEY]: true,
            [TIMER_MILESTONES_KEY]: DEFAULT_TIMER_MILESTONES
        });

        const enabled = stored[TIMER_ALERTS_KEY] !== false;
        toggle.checked = enabled;
        section.hidden = !enabled;

        toggle.addEventListener('change', async e => {
            const on = e.target.checked;
            try { await chrome.storage.local.set({ [TIMER_ALERTS_KEY]: on }); } catch (_) {}
            section.hidden = !on;
            chrome.runtime.sendMessage({ type: 'TIMER_NOTIFY_TOGGLED', enabled: on }).catch(() => {});
        });

        const options = Array.from(document.querySelectorAll('.alert-item'));
        const storedMilestones = Array.isArray(stored[TIMER_MILESTONES_KEY])
            ? stored[TIMER_MILESTONES_KEY]
            : DEFAULT_TIMER_MILESTONES;

        options.forEach(opt => {
            opt.checked = storedMilestones.includes(opt.value);

            opt.addEventListener('change', async () => {
                // The "session end" ping is the payoff of a focus session — keep
                // at least one alert lit rather than silently muting everything.
                if (!opt.checked && options.filter(o => o.checked).length === 0) {
                    opt.checked = true;
                    return;
                }
                const milestones = options.filter(o => o.checked).map(o => o.value);
                try { await chrome.storage.local.set({ [TIMER_MILESTONES_KEY]: milestones }); } catch (_) {}
                chrome.runtime.sendMessage({ type: 'TIMER_NOTIFY_MILESTONES_CHANGED', milestones }).catch(() => {});
            });
        });

        const testSoundBtn = $('test-sound-btn');
        if (testSoundBtn) {
            testSoundBtn.addEventListener('click', () => {
                playAlertSound();
                ToastModule.show('Playing test alert sound', { tone: 'good' });
            });
        }
    }

    function playAlertSound() {
        try {
            const url = (typeof chrome !== 'undefined' && chrome.runtime?.getURL)
                ? chrome.runtime.getURL('assets/notify.wav')
                : 'assets/notify.wav';
            const audio = new Audio(url);
            audio.volume = 0.7;
            const p = audio.play();
            if (p && p.catch) p.catch(() => playSynthBeep());
        } catch (_) {
            playSynthBeep();
        }
    }

    function playSynthBeep() {
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            const ctx = new AudioCtx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(587.33, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12);
            gain.gain.setValueAtTime(0.15, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.25);
        } catch (_) {}
    }

    return { init };
})();

// ══════════════════════════════════════════════════════
// MODULE: Settings — on-the-page extras (Zen Paws, AC celebration)
// Both features shipped without a control surface; these switches are the
// only way a user could ever discover or turn them off.
// ══════════════════════════════════════════════════════

const PageFXModule = (() => {
    function playPreviewSound(style, volume) {
        if (style === 'none') return;
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return;
            const ctx = new Ctx();
            if (ctx.state === 'suspended') ctx.resume();
            const now = ctx.currentTime;
            const vol = Math.min(1, Math.max(0, volume));

            switch (style) {
                case 'fanfare':
                    [
                        { f: 523.25, t: 0, d: 0.16 },
                        { f: 659.25, t: 0.12, d: 0.16 },
                        { f: 783.99, t: 0.24, d: 0.22 },
                        { f: 1046.50, t: 0.40, d: 0.75 }
                    ].forEach(n => {
                        const osc = ctx.createOscillator();
                        const gain = ctx.createGain();
                        osc.type = 'triangle';
                        osc.frequency.setValueAtTime(n.f, now + n.t);
                        gain.gain.setValueAtTime(0, now + n.t);
                        gain.gain.linearRampToValueAtTime(0.22 * vol, now + n.t + 0.02);
                        gain.gain.exponentialRampToValueAtTime(0.0001, now + n.t + n.d);
                        osc.connect(gain);
                        gain.connect(ctx.destination);
                        osc.start(now + n.t);
                        osc.stop(now + n.t + n.d + 0.05);
                    });
                    break;
                case 'celestial':
                    [659.25, 830.61, 987.77, 1318.51, 1479.98].forEach((freq, i) => {
                        const osc = ctx.createOscillator();
                        const gain = ctx.createGain();
                        const start = now + i * 0.06;
                        osc.type = 'sine';
                        osc.frequency.setValueAtTime(freq, start);
                        gain.gain.setValueAtTime(0, start);
                        gain.gain.linearRampToValueAtTime(0.18 * vol, start + 0.015);
                        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.85);
                        osc.connect(gain);
                        gain.connect(ctx.destination);
                        osc.start(start);
                        osc.stop(start + 0.9);
                    });
                    break;
                case 'arcade':
                    [
                        { f: 587.33, t: 0, d: 0.07 },
                        { f: 739.99, t: 0.07, d: 0.07 },
                        { f: 880.00, t: 0.14, d: 0.07 },
                        { f: 1174.66, t: 0.21, d: 0.35 }
                    ].forEach(n => {
                        const osc = ctx.createOscillator();
                        const gain = ctx.createGain();
                        osc.type = 'square';
                        osc.frequency.setValueAtTime(n.f, now + n.t);
                        gain.gain.setValueAtTime(0, now + n.t);
                        gain.gain.linearRampToValueAtTime(0.12 * vol, now + n.t + 0.01);
                        gain.gain.exponentialRampToValueAtTime(0.0001, now + n.t + n.d);
                        osc.connect(gain);
                        gain.connect(ctx.destination);
                        osc.start(now + n.t);
                        osc.stop(now + n.t + n.d);
                    });
                    break;
                case 'zen':
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(432, now);
                    gain.gain.setValueAtTime(0, now);
                    gain.gain.linearRampToValueAtTime(0.25 * vol, now + 0.03);
                    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);
                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    osc.start(now);
                    osc.stop(now + 1.85);
                    break;
            }
        } catch (_) {}
    }

    async function init() {
        // ── 1. Zen Paws setup ──
        const pawsToggle = $('paws-toggle');
        const pawsOptions = $('paws-options');

        const pawsStored = await chrome.storage.local.get({
            [PAWS_KEY]: false,
            ff_zenPaws_mode: 'playful',
            ff_zenPaws_count: 3,
            ff_zenPaws_size: 'normal'
        });

        if (pawsToggle) {
            pawsToggle.checked = !!pawsStored[PAWS_KEY];
            if (pawsOptions) pawsOptions.hidden = !pawsToggle.checked;

            pawsToggle.addEventListener('change', async e => {
                const on = e.target.checked;
                try { await chrome.storage.local.set({ [PAWS_KEY]: on }); } catch (_) {}
                if (pawsOptions) {
                    pawsOptions.hidden = !on;
                    if (on) pawsOptions.classList.add('is-animating');
                }
                ToastModule.show(on ? 'Zen Paws on · companions on their way' : 'Zen Paws off', { tone: on ? 'good' : 'info' });
            });
        }

        // Paws radios: mode, count, size
        document.querySelectorAll('input[name="paws_mode"]').forEach(radio => {
            radio.checked = radio.value === pawsStored.ff_zenPaws_mode;
            radio.addEventListener('change', () => {
                chrome.storage.local.set({ ff_zenPaws_mode: radio.value }).catch(() => {});
            });
        });
        document.querySelectorAll('input[name="paws_count"]').forEach(radio => {
            radio.checked = Number(radio.value) === Number(pawsStored.ff_zenPaws_count);
            radio.addEventListener('change', () => {
                chrome.storage.local.set({ ff_zenPaws_count: Number(radio.value) }).catch(() => {});
            });
        });
        document.querySelectorAll('input[name="paws_size"]').forEach(radio => {
            radio.checked = radio.value === pawsStored.ff_zenPaws_size;
            radio.addEventListener('change', () => {
                chrome.storage.local.set({ ff_zenPaws_size: radio.value }).catch(() => {});
            });
        });

        // ── 2. AC Celebration setup ──
        const acToggle = $('ac-toggle');
        const acOptions = $('ac-options');

        const acStored = await chrome.storage.local.get({
            [AC_KEY]: false,
            ff_ac_style: 'full',
            ff_ac_sound: 'fanfare',
            ff_ac_volume: 0.7
        });

        if (acToggle) {
            acToggle.checked = !!acStored[AC_KEY];
            if (acOptions) acOptions.hidden = !acToggle.checked;

            acToggle.addEventListener('change', async e => {
                const on = e.target.checked;
                try { await chrome.storage.local.set({ [AC_KEY]: on }); } catch (_) {}
                if (acOptions) {
                    acOptions.hidden = !on;
                    if (on) acOptions.classList.add('is-animating');
                }
                ToastModule.show(on ? 'AC celebration on · good luck out there' : 'AC celebration off', { tone: on ? 'good' : 'info' });
            });
        }

        // AC radios: style, sound
        document.querySelectorAll('input[name="ac_style"]').forEach(radio => {
            radio.checked = radio.value === acStored.ff_ac_style;
            radio.addEventListener('change', () => {
                chrome.storage.local.set({ ff_ac_style: radio.value }).catch(() => {});
            });
        });
        document.querySelectorAll('input[name="ac_sound"]').forEach(radio => {
            radio.checked = radio.value === acStored.ff_ac_sound;
            radio.addEventListener('change', () => {
                chrome.storage.local.set({ ff_ac_sound: radio.value }).catch(() => {});
                // Play short preview when user selects a sound
                const vol = Number($('ac-volume-slider')?.value || 70) / 100;
                playPreviewSound(radio.value, vol);
            });
        });

        // AC Volume Slider
        const volSlider = $('ac-volume-slider');
        const volVal = $('ac-volume-val');
        if (volSlider && volVal) {
            const initialVol = Math.round((typeof acStored.ff_ac_volume === 'number' ? acStored.ff_ac_volume : 0.7) * 100);
            volSlider.value = initialVol;
            volVal.textContent = `${initialVol}%`;

            volSlider.addEventListener('input', () => {
                volVal.textContent = `${volSlider.value}%`;
                chrome.storage.local.set({ ff_ac_volume: Number(volSlider.value) / 100 }).catch(() => {});
            });
        }

        // Preview celebration button
        $('preview-ac-btn')?.addEventListener('click', async () => {
            const soundRadio = document.querySelector('input[name="ac_sound"]:checked');
            const sound = soundRadio ? soundRadio.value : 'fanfare';
            const vol = Number($('ac-volume-slider')?.value || 70) / 100;

            // 1. Play synthesized victory sound in popup
            playPreviewSound(sound, vol);

            // 2. Broadcast preview to active tab
            try {
                const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tabs[0]?.id) {
                    chrome.tabs.sendMessage(tabs[0].id, { type: 'AC_CELEBRATE_PREVIEW' }).catch(() => {});
                }
            } catch (_) {}

            ToastModule.show('Playing celebration preview', { tone: 'good' });
        });
    }

    return { init };
})();

// ══════════════════════════════════════════════════════
// MODULE: Settings — contest reminders
// ═════════════════════════════════════════════════════

const ReminderSettingsModule = (() => {
    async function init() {
        const toggle = $('reminder-toggle');
        const section = $('reminder-section');
        if (!toggle || !section) return;

        const stored = await chrome.storage.local.get({
            ff_reminders_enabled: true,
            ff_reminder_intervals: DEFAULT_REMINDER_INTERVALS
        });

        const enabled = stored.ff_reminders_enabled !== false;
        toggle.checked = enabled;
        section.hidden = !enabled;

        toggle.addEventListener('change', async e => {
            const on = e.target.checked;
            try { await chrome.storage.local.set({ ff_reminders_enabled: on }); } catch (_) {}
            section.hidden = !on;
            chrome.runtime.sendMessage({ type: 'REMINDERS_TOGGLED', enabled: on }).catch(() => {});
        });

        const options = document.querySelectorAll('.reminder-item');
        const storedIntervals = Array.isArray(stored.ff_reminder_intervals)
            ? stored.ff_reminder_intervals
            : DEFAULT_REMINDER_INTERVALS;

        options.forEach(opt => {
            const value = parseInt(opt.value, 10);
            opt.checked = storedIntervals.includes(value);

            opt.addEventListener('change', async () => {
                // Keep at least one chip lit: the master switch above is the
                // intended way to silence everything. (The background worker
                // still treats a stored [] as "no reminders", so this is UX
                // reinforcement rather than the only guard.)
                if (!opt.checked && Array.from(options).filter(o => o.checked).length === 0) {
                    opt.checked = true;
                    return;
                }
                const intervals = Array.from(options)
                    .filter(o => o.checked)
                    .map(o => parseInt(o.value, 10));
                try { await chrome.storage.local.set({ [REMINDER_INTERVALS_KEY]: intervals }); } catch (_) {}
                chrome.runtime.sendMessage({ type: 'REMINDER_INTERVALS_CHANGED', intervals }).catch(() => {});
            });
        });
    }

    return { init };
})();
// ═════════════════════════════════════════════════════
// MODULE: Onboarding — the first-open moment
// Shown once (until ff_onboarded_v2 is set). Replayable from Settings.
// ══════════════════════════════════════════════════════

const OnboardingModule = (() => {
    let el = null;
    let isOpen = false;

    /** @param {{ force?: boolean }} opts force = "Replay the intro" */
    async function maybeShow({ force = false } = {}) {
        if (!el) el = $('onboard');
        if (!el) return;

        if (!force) {
            try {
                const { [ONBOARDED_KEY]: seen } = await chrome.storage.local.get(ONBOARDED_KEY);
                if (seen) return;
            } catch (_) {}
        }
        open();
    }

    function open() {
        if (isOpen) return;
        isOpen = true;
        el.hidden = false;
        el.setAttribute('aria-hidden', 'false');
        requestAnimationFrame(() => el.classList.add('is-open'));
        setTimeout(() => $('ob-start')?.focus({ preventScroll: true }), 340);
    }

    async function close() {
        if (!isOpen) return;
        isOpen = false;
        el.classList.remove('is-open');
        el.setAttribute('aria-hidden', 'true');
        setTimeout(() => { if (!isOpen) el.hidden = true; }, 340);
        try { await chrome.storage.local.set({ [ONBOARDED_KEY]: true }); } catch (_) {}
        $('timer-action')?.focus({ preventScroll: true });
    }

    function init() {
        el = $('onboard');
        if (!el) return;
        $('ob-start')?.addEventListener('click', close);
        $('ob-skip')?.addEventListener('click', close);
        $('replay-intro')?.addEventListener('click', () => {
            SettingsSheetModule.close({ restoreFocus: false });
            maybeShow({ force: true });
        });
    }

    return { init, open, close, maybeShow, get isOpen() { return isOpen; } };
})();

// ══════════════════════════════════════════════════════
// MODULE: Storage bridge — keep the popup honest when the
// on-page Focus Dock changes the session underneath it.
// ═════════════════════════════════════════════════════

const StorageBridge = (() => {
    /** Reflects changes made in another popup/context back onto our switches. */
    const TOGGLE_KEYS = {
        ff_zenMode: 'zen-toggle',
        [PAWS_KEY]: 'paws-toggle',
        [AC_KEY]: 'ac-toggle',
        [TIMER_ALERTS_KEY]: 'timer-alerts-toggle',
        ff_reminders_enabled: 'reminder-toggle'
    };

    function syncToggles(changes) {
        Object.entries(TOGGLE_KEYS).forEach(([key, id]) => {
            if (!changes[key]) return;
            const node = $(id);
            if (node) node.checked = changes[key].newValue !== false;
        });
        if (changes.ff_zenMode) ToastModule.show('Zen Mode updated');
    }

    function init() {
        try {
            chrome.storage.onChanged.addListener((changes, area) => {
                if (area !== 'local') return;

                syncToggles(changes);

                if (!changes[TIMER_STORAGE_KEY]) return;
                if (TimerModule.wroteRecently()) return;

                const next = changes[TIMER_STORAGE_KEY].newValue;
                if (!next) return;

                TimerModule.setState({ ...TimerModule.defaultTimerState(), ...next });
                const state = TimerModule.getState();

                if (state.status === 'RUNNING') {
                    if (state.mode === 'countdown' && Date.now() >= state.endTime) {
                        TimerActions.finish();
                        return;
                    }
                    TimerInterval.start();
                } else {
                    TimerInterval.stop();
                }
                TimerUIModule.render();
            });
        } catch (_) {}
    }

    return { init };
})();
// ══════════════════════════════════════════════════════
// APP — initialisation
// ══════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
    // Theme first — every other surface inherits its palette.
    await ThemeModule.loadTheme();

    // Every theme picker (settings grid + intro swatches) drives one module.
    document.querySelectorAll('.theme-card').forEach(card => {
        card.addEventListener('click', () => ThemeModule.applyTheme(card.dataset.ffTheme));
        card.addEventListener('keydown', e => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            ThemeModule.applyTheme(card.dataset.ffTheme);
        });
    });

    $('system-theme-toggle')?.addEventListener('change', e => ThemeModule.setFollowSystem(e.target.checked));

    DialModule.init();
    ViewModule.init();
    SettingsSheetModule.init();
    OnboardingModule.init();
    KeyboardModule.init();
    TimerUIModule.init();
    SettingsModule.init();
    FocusAlertsModule.init();
    ReminderSettingsModule.init();
    PageFXModule.init();
    ContestRenderer.init();
    StorageBridge.init();
    ContestListModule.showTimezone();
    InkBar.track(document.querySelector('.nav'), '.nav-ink', '.nav-tab');
    InkBar.track(document.querySelector('.filters'), '.filters-ink', '.filter[data-tab]');

    $('refresh-btn')?.addEventListener('click', e => ContestListModule.refresh(e.currentTarget));
    $('timer-reset')?.addEventListener('click', () => TimerActions.reset());

    await TimerRecovery.recover();
    await TimerUIModule.refreshStats();

    ContestListModule.load();
    ContestListModule.startAutoRefresh();

    await OnboardingModule.maybeShow();
    document.body.classList.add('is-ready');
});

window.addEventListener('beforeunload', () => {
    ContestListModule.stopAutoRefresh();
    TimerInterval.stop();
});
