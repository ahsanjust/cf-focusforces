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
const TIMER_STORAGE_KEY = 'ff_timer_state';
const REMINDER_INTERVALS_KEY = 'ff_reminder_intervals';
const SESSIONS_KEY = 'ff_sessions';

const SESSION_RETENTION_DAYS = 30;
const MIN_LOGGED_SESSION_MS = 60 * 1000;

const DIAL_RADIUS = 88;
const DIAL_CENTER = 110;
const DIAL_CIRCUMFERENCE = 2 * Math.PI * DIAL_RADIUS;
const TICK_COUNT = 60;
const TICK_OUTER = 101;
const TICK_INNER_MINOR = 96.5;
const TICK_INNER_MAJOR = 94;

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
    let currentTheme = 'default';

    function applyTheme(theme, { persist = true } = {}) {
        currentTheme = THEMES.includes(theme) ? theme : 'default';
        document.documentElement.setAttribute('data-ff-theme', currentTheme);

        document.querySelectorAll('.theme-card').forEach(card => {
            const isActive = card.dataset.ffTheme === currentTheme;
            card.setAttribute('aria-checked', String(isActive));
            card.tabIndex = isActive ? 0 : -1;
        });

        // Keep the boot cache in sync so the next popup open paints instantly.
        try { localStorage.setItem(THEME_BOOT_KEY, currentTheme); } catch (_) {}

        if (persist) {
            saveTheme(currentTheme);
            syncThemeToContentScript(currentTheme);
        }
    }

    async function saveTheme(theme) {
        try { await chrome.storage.local.set({ [THEME_KEY]: theme }); } catch (_) {}
    }

    async function loadTheme() {
        let theme = 'default';
        try {
            const { [THEME_KEY]: saved } = await chrome.storage.local.get(THEME_KEY);
            if (saved && THEMES.includes(saved)) theme = saved;
        } catch (_) {}
        applyTheme(theme, { persist: false });
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

    const getCurrentTheme = () => currentTheme;

    return { applyTheme, loadTheme, getCurrentTheme };
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

    return { read, log, summary };
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
            presets: Array.from(document.querySelectorAll('.preset[data-min]')),
            customBtn: $('preset-custom'),
            liveChip: $('live-chip'),
            liveTime: $('live-chip-time'),
            statSessions: $('stat-sessions'),
            statFocus: $('stat-focus'),
            aboutSessions: $('about-sessions'),
            modeBtns: Array.from(document.querySelectorAll('.mode-btn'))
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
        el.card?.classList.toggle('is-stopwatch', !isCountdown);
        el.card?.classList.toggle('is-sweep', !isCountdown && running);

        if (!isCountdown) {
            el.status.textContent = running ? 'Tracking' : (paused ? 'Paused' : 'Ready');
            el.sub.textContent = running ? 'Tracking' : (paused ? 'Paused' : 'No target');
        } else if (danger) {
            el.status.textContent = 'Ending soon';
            el.sub.textContent = 'Wrap it up';
        } else if (running) {
            el.status.textContent = 'Focusing';
            el.sub.textContent = 'Focus session';
        } else if (paused) {
            el.status.textContent = 'Paused';
            el.sub.textContent = 'Paused';
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

    async function refreshStats() {
        const stats = await SessionModule.summary();
        if (el.statSessions) el.statSessions.textContent = String(stats.count);
        if (el.statFocus) el.statFocus.textContent = formatFocusSpan(stats.ms);
        if (el.aboutSessions) {
            el.aboutSessions.textContent = stats.total === 1 ? '1 session' : `${stats.total} sessions`;
        }
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

    function set(view, { focus = false } = {}) {
        if (view !== 'focus' && view !== 'contests') return;
        current = view;
        document.body.dataset.view = view;

        document.querySelectorAll('.nav-tab').forEach(tab => {
            const on = tab.dataset.view === view;
            tab.classList.toggle('is-active', on);
            tab.setAttribute('aria-selected', String(on));
            tab.tabIndex = on ? 0 : -1;
        });

        document.querySelectorAll('.view').forEach(section => {
            const on = section.id === `view-${view}`;
            section.classList.toggle('is-active', on);
            section.setAttribute('aria-hidden', String(!on));
        });

        if (focus) {
            const target = view === 'focus' ? $('timer-action') : $('refresh-btn');
            target?.focus({ preventScroll: true });
        }
    }

    function init() {
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.addEventListener('click', () => set(tab.dataset.view, { focus: true }));
            tab.addEventListener('keydown', e => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                e.preventDefault();
                set(tab.dataset.view === 'focus' ? 'contests' : 'focus', { focus: true });
            });
        });
        set('focus');
    }

    return { init, set, get: () => current };
})();

// ═════════════════════════════════════════════════════
// MODULE: Settings sheet
// ═════════════════════════════════════════════════════

const SettingsSheetModule = (() => {
    let sheet = null;
    let scrim = null;
    let isOpen = false;

    function open() {
        if (isOpen) return;
        isOpen = true;
        scrim.hidden = false;
        sheet.classList.add('is-open');
        sheet.setAttribute('aria-hidden', 'false');
        requestAnimationFrame(() => scrim.classList.add('is-open'));
        $('close-settings')?.focus({ preventScroll: true });
    }

    function close({ restoreFocus = true } = {}) {
        if (!isOpen) return;
        isOpen = false;
        sheet.classList.remove('is-open');
        sheet.setAttribute('aria-hidden', 'true');
        scrim.classList.remove('is-open');
        setTimeout(() => { if (!isOpen) scrim.hidden = true; }, 320);
        if (restoreFocus) $('open-settings')?.focus({ preventScroll: true });
    }

    function init() {
        sheet = $('settings-sheet');
        scrim = $('scrim');
        if (!sheet || !scrim) return;

        $('open-settings')?.addEventListener('click', open);
        $('close-settings')?.addEventListener('click', () => close());
        scrim.addEventListener('click', () => close());
    }

    return { init, open, close, get isOpen() { return isOpen; } };
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
            if (e.key === 'Escape' && SettingsSheetModule.isOpen) {
                e.preventDefault();
                SettingsSheetModule.close();
                return;
            }

            if (e.metaKey || e.ctrlKey || e.altKey) return;
            if (isTypingTarget(e.target)) return;
            if (SettingsSheetModule.isOpen) return;

            // Buttons already handle Space/Enter themselves.
            if (e.target?.closest?.('button') && (e.key === ' ' || e.key === 'Enter')) return;

            if (e.key === ' ') {
                e.preventDefault();
                if (TimerModule.getState().status === 'RUNNING') TimerActions.pause();
                else TimerActions.start();
            } else if (e.key === 'r' || e.key === 'R') {
                TimerActions.reset();
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

    function createBadge(text, className) {
        const span = document.createElement('span');
        span.className = className;
        span.textContent = text;
        return span;
    }

    function createCard(contest) {
        if (!contest?.site) return null;

        const status = ContestHelpers.getContestStatus(contest);
        const isOngoing = status === 'ongoing';
        const urgency = isOngoing ? null : urgencyFor(contest.start_time);

        const card = document.createElement('div');
        card.className = ['contest-card', isOngoing ? 'is-ongoing' : '', urgency?.cls || ''].filter(Boolean).join(' ');
        card.style.setProperty('--spine', spineValue(contest, status, urgency));
        card.dataset.start = contest.start_time || '';
        card.dataset.dur = String(contest.duration || 0);
        card.tabIndex = 0;

        // ── top row: platform · name · status badges ──
        const top = document.createElement('div');
        top.className = 'contest-top';
        top.appendChild(createBadge(platformBadgeText(contest.site), `platform-badge ${platformClass(contest.site)}`));

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
        top.appendChild(name);

        if (isOngoing) top.appendChild(createBadge('LIVE', 'chip-badge live-badge'));
        if (contest.isGym) top.appendChild(createBadge('GYM', 'chip-badge gym-badge'));

        // ── bottom row: local start time · countdown ──
        const meta = document.createElement('div');
        meta.className = 'contest-meta';

        const when = document.createElement('span');
        when.className = 'contest-time';
        when.textContent = fmtDateTime(contest.start_time);
        if (contest.duration) {
            when.textContent += ` · ${ContestHelpers.formatDuration(contest.duration)}`;
            when.title = `${ContestHelpers.formatDuration(contest.duration)} long`;
        }

        const count = document.createElement('span');
        count.className = 'contest-duration';
        count.textContent = timingLabel(contest.start_time, contest.duration);

        meta.append(when, count);
        card.append(top, meta);

        const open = () => { if (contest.url) chrome.tabs.create({ url: contest.url, active: false }); };
        card.addEventListener('click', e => { if (!e.target.closest('a')) open(); });
        card.addEventListener('keydown', e => {
            if (e.key !== 'Enter' || e.target.closest('a')) return;
            e.preventDefault();
            open();
        });

        return card;
    }
    function stateBlock({ icon, title, sub, actionLabel, onAction, isError = false }) {
        const wrap = document.createElement('div');
        wrap.className = `state-block${isError ? ' is-error' : ''}`;

        const ico = document.createElement('div');
        ico.className = 'state-ico';
        ico.innerHTML = icon;

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

        if (actionLabel && onAction) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'state-action';
            btn.textContent = actionLabel;
            btn.addEventListener('click', () => onAction(btn));
            wrap.appendChild(btn);
        }

        return wrap;
    }

    function syncTabs() {
        document.querySelectorAll('.tabs').forEach(bar => { bar.dataset.tab = activeTab; });
        document.querySelectorAll('.tab[data-tab]').forEach(tab => {
            const on = tab.dataset.tab === activeTab;
            tab.classList.toggle('is-active', on);
            tab.setAttribute('aria-selected', String(on));
        });
        const nearCount = $('tab-near-count');
        const laterCount = $('tab-later-count');
        if (nearCount) nearCount.textContent = String(cachedNear.length);
        if (laterCount) laterCount.textContent = String(cachedLater.length);
    }

    function syncNavBadge() {
        const badge = $('nav-contest-count');
        if (!badge) return;
        badge.textContent = String(cachedNear.length);
        const soonest = cachedNear.find(c => ContestHelpers.getContestStatus(c) !== 'ongoing');
        const urgent = !!soonest && (new Date(soonest.start_time).getTime() - Date.now()) <= 60 * 60 * 1000;
        badge.classList.toggle('is-hot', urgent);
        badge.classList.toggle('is-armed', !urgent && cachedNear.length > 0);
    }

    function setTab(tab) {
        if (tab !== 'near' && tab !== 'later') return;
        activeTab = tab;
        syncTabs();
        renderCurrentTab();
    }

    function buildItems(items, emptyTitle, emptySub) {
        const frag = document.createDocumentFragment();
        const cards = ContestSortFilter.sortByTime(items).map(createCard).filter(Boolean);

        if (!cards.length) {
            frag.appendChild(stateBlock({ icon: ICON_CALENDAR, title: emptyTitle, sub: emptySub }));
            return frag;
        }
        cards.forEach(card => frag.appendChild(card));
        return frag;
    }

    function renderCurrentTab() {
        const list = $('contest-list');
        if (!list) return;
        const isNear = activeTab === 'near';
        list.replaceChildren(buildItems(
            isNear ? cachedNear : cachedLater,
            isNear ? 'Nothing in the next 24 hours' : 'No upcoming contests',
            isNear
                ? 'Your next contest shows up here with a live countdown.'
                : 'Contests from all four platforms land here as soon as they are announced.'
        ));
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
                title: 'No active contests',
                sub: 'Nothing on the radar right now — a good moment for a practice session.',
                actionLabel: 'Refresh',
                onAction: btn => ContestListModule.refresh(btn)
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
            isError: true
        }));
    }

    function setLoadingState() {
        const list = $('contest-list');
        if (!list) return;
        const frag = document.createDocumentFragment();
        for (let i = 0; i < 3; i++) {
            const card = document.createElement('div');
            card.className = 'skeleton-card';
            if (i > 0) card.setAttribute('aria-hidden', 'true');
            else card.setAttribute('aria-label', 'Loading contests');
            card.append(document.createElement('span'), document.createElement('span'), document.createElement('span'));
            frag.appendChild(card);
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
        document.querySelectorAll('.tab[data-tab]').forEach(tab => {
            tab.addEventListener('click', () => setTab(tab.dataset.tab));
            tab.addEventListener('keydown', e => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                e.preventDefault();
                setTab(tab.dataset.tab === 'near' ? 'later' : 'near');
                document.querySelector(`.tab[data-tab="${activeTab}"]`)?.focus({ preventScroll: true });
            });
        });
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
        btn.classList.toggle('is-hot', msUntil > 0 && msUntil <= 60 * 60 * 1000);
        btn.classList.toggle('is-warm', msUntil > 60 * 60 * 1000 && msUntil <= 4 * 60 * 60 * 1000);
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

        const top = document.createElement('span');
        top.className = 'nextup-top';

        const badge = document.createElement('span');
        badge.className = `platform-badge ${cls}`;
        badge.textContent = PLATFORM_CONFIG[contest.site]?.badge || '—';

        const eyebrow = document.createElement('span');
        eyebrow.className = 'nextup-eyebrow';
        eyebrow.textContent = isOngoing ? 'Live now' : 'Next up';

        top.append(badge, eyebrow);

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
     * The rail subtitle doubles as a live contest signal. It deliberately shows
     * *timing* rather than the contest title — titles are long enough to be
     * ellipsised on a 400px popup, and the countdown is the thing that matters.
     */
    function updateBrandSub() {
        const sub = $('brand-sub');
        if (!sub) return;

        if (!contest) {
            sub.textContent = 'Contest radar ready';
            sub.classList.remove('is-hot');
            return;
        }

        const msUntil = new Date(contest.start_time).getTime() - Date.now();
        const isOngoing = ContestHelpers.getContestStatus(contest) === 'ongoing';

        if (isOngoing) {
            sub.textContent = 'A contest is live right now';
            sub.classList.add('is-hot');
            return;
        }

        const left = ContestHelpers.timeUntil(contest.start_time);
        sub.textContent = msUntil > 0 && left
            ? `Next contest in ${left}`
            : 'Next contest starting soon';
        sub.classList.toggle('is-hot', msUntil > 0 && msUntil <= 60 * 60 * 1000);
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
        if (!zenToggle) return;

        try {
            const { ff_zenMode } = await chrome.storage.local.get('ff_zenMode');
            zenToggle.checked = !!ff_zenMode;
        } catch (_) {}

        zenToggle.addEventListener('change', async e => {
            const enabled = e.target.checked;
            try { await chrome.storage.local.set({ ff_zenMode: enabled }); } catch (_) {}
            chrome.tabs.query({ url: 'https://codeforces.com/*' }, tabs => {
                tabs.forEach(tab => {
                    if (tab.id) chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_ZEN', enabled }).catch(() => {});
                });
            });
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

// ══════════════════════════════════════════════════════
// MODULE: Storage bridge — keep the popup honest when the
// on-page Focus Dock changes the session underneath it.
// ═════════════════════════════════════════════════════

const StorageBridge = (() => {
    function init() {
        try {
            chrome.storage.onChanged.addListener((changes, area) => {
                if (area !== 'local' || !changes[TIMER_STORAGE_KEY]) return;
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

    document.querySelectorAll('.theme-card').forEach(card => {
        card.addEventListener('click', () => ThemeModule.applyTheme(card.dataset.ffTheme));
    });

    DialModule.init();
    ViewModule.init();
    SettingsSheetModule.init();
    KeyboardModule.init();
    TimerUIModule.init();
    SettingsModule.init();
    ReminderSettingsModule.init();
    ContestRenderer.init();
    StorageBridge.init();
    ContestListModule.showTimezone();

    $('refresh-btn')?.addEventListener('click', e => ContestListModule.refresh(e.currentTarget));

    await TimerRecovery.recover();
    await TimerUIModule.refreshStats();

    await ContestListModule.load();
    ContestListModule.startAutoRefresh();

    document.body.classList.add('is-ready');
});

window.addEventListener('beforeunload', () => {
    ContestListModule.stopAutoRefresh();
    TimerInterval.stop();
});
