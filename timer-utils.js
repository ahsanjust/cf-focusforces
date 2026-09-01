/**
 * FocusForces - Timer Utilities
 *
 * Pure timer state-machine helpers shared with the Jest test suite.
 *
 * NOTE: In the shipping extension the timer UI lives in the popup and the
 * milestone notifications are driven by the background service worker's alarm
 * system (scheduleTimerAlarms / handleTimerAlarm in background.js). That alarm
 * logic is intentionally kept in sync with the threshold semantics here
 * (strict > on durationMs), so these pure functions are a faithful reference
 * model of the runtime behavior. The functions are injected before content.js
 * via manifest.json and exposed on the global scope; the CommonJS export block
 * at the bottom is a no-op in the browser.
 */

/**
 * Format a millisecond duration as HH:MM:SS (ceil to whole seconds).
 * @param {number} ms
 * @returns {string}
 */
function formatTime(ms) {
  const sec = Math.ceil(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':');
}

/**
 * Check whether the "10 Minutes Left" notification should fire.
 * @param {number} msLeft    milliseconds remaining
 * @param {number} durationMs total timer duration
 * @returns {boolean}
 */
function shouldNotify10(msLeft, durationMs) {
  // Duration uses strict > (not >=) to match the background service worker's
  // scheduleTimerAlarms semantics: a timer whose total duration is exactly the
  // milestone threshold must NOT schedule a milestone alarm that would fire at
  // t=0 (which Chrome can delay by up to 1 minute). See background.js.
  return msLeft <= 10 * 60 * 1000 && durationMs > 10 * 60 * 1000;
}

/**
 * Check whether the "5 Minutes Left" notification should fire.
 * @param {number} msLeft    milliseconds remaining
 * @param {number} durationMs total timer duration
 * @returns {boolean}
 */
function shouldNotify5(msLeft, durationMs) {
  return msLeft <= 5 * 60 * 1000 && durationMs > 5 * 60 * 1000;
}

/**
 * Check whether the "1 Minute Left" notification should fire.
 * @param {number} msLeft    milliseconds remaining
 * @param {number} durationMs total timer duration
 * @returns {boolean}
 */
function shouldNotify1(msLeft, durationMs) {
  return msLeft <= 1 * 60 * 1000 && durationMs > 1 * 60 * 1000;
}

/**
 * Check whether the danger CSS class should be applied (<= 5 min remaining).
 * @param {number} msLeft milliseconds remaining
 * @returns {boolean}
 */
function isDanger(msLeft) {
  return Math.ceil(msLeft / 1000) <= 300;
}

/**
 * The danger rule actually used by the popup UI: pulsing red only when under
 * 5 minutes remain AND the timer's total duration was at least 10 minutes
 * (a 4-minute timer is not "dangerously short" — it was always short). This
 * is the single source of truth shared by popup.js (render/tick) and the
 * tickState state machine; previously popup duplicated it inline.
 * @param {number} msLeft      milliseconds remaining
 * @param {number} durationMs  total timer duration (may be 0/undefined)
 * @returns {boolean}
 */
function isDangerForTimer(msLeft, durationMs) {
  return msLeft <= 5 * 60 * 1000 && (durationMs || 0) >= 10 * 60 * 1000;
}

/**
 * Compute which timer milestone alarms the background service worker should
 * create for a given state. Pure function mirroring (and tested against) the
 * runtime scheduleTimerAlarms logic so the shipped behavior is the tested
 * behavior.
 *
 * Semantics (identical to the old background implementation):
 *   - only a RUNNING countdown schedules alarms;
 *   - the total duration must strictly exceed the milestone threshold (an
 *     exactly-10-minute timer does NOT get a "10 min left" alarm that would
 *     fire at t=0);
 *   - the fire time must be strictly in the future;
 *   - `timer_end` is ALWAYS scheduled (regardless of the user's milestone
 *     set) because it finalizes the timer state and clears the badge even
 *     when the "finish" notification is disabled;
 *   - the other milestones are scheduled only when present in
 *     `enabledMilestones` (the user's opt-in set from ff_timer_notify_milestones).
 *
 * @param {object} state            timer state ({status, mode, endTime, durationMs, remainingMs})
 * @param {string[]} enabledMilestones  milestone ids the user enabled
 * @param {number} now              current wall-clock time (Date.now())
 * @returns {Array<{name: string, when: number}>}
 */
function computeTimerAlarmSchedules(state, enabledMilestones, now) {
  if (!state || state.status !== 'RUNNING' || state.mode !== 'countdown') return [];

  const enabled = Array.isArray(enabledMilestones) ? enabledMilestones : [];
  const msLeft = state.endTime - now;
  const durationMs = state.durationMs || state.remainingMs || msLeft;

  const milestones = [
    { name: 'timer_10min', milestoneId: '10min',  offset: 10 * 60 * 1000, minDuration: 10 * 60 * 1000 },
    { name: 'timer_5min',  milestoneId: '5min',   offset: 5 * 60 * 1000,  minDuration: 5 * 60 * 1000 },
    { name: 'timer_1min',  milestoneId: '1min',   offset: 1 * 60 * 1000,  minDuration: 1 * 60 * 1000 },
    { name: 'timer_end',   milestoneId: 'finish', offset: 0,               minDuration: 0 }
  ];

  const schedules = [];
  for (const m of milestones) {
    // timer_end always runs (state finalization); others respect the opt-in set.
    if (m.milestoneId !== 'finish' && !enabled.includes(m.milestoneId)) continue;

    const fireTimeMs = state.endTime - m.offset;
    if (msLeft > m.offset && durationMs > m.minDuration && fireTimeMs > now) {
      schedules.push({ name: m.name, when: fireTimeMs });
    }
  }
  return schedules;
}

/**
 * Compute remainingMs from user input, clamping to valid ranges.
 * @param {string|number} mm minutes (0-999)
 * @param {string|number} ss seconds (0-59)
 * @returns {number} milliseconds
 */
function computeRemainingMs(mm, ss) {
  const clampedMm = Math.min(999, Math.max(0, parseInt(mm, 10) || 0));
  const clampedSs = Math.min(59, Math.max(0, parseInt(ss, 10) || 0));
  return (clampedMm * 60 + clampedSs) * 1000;
}

/**
 * Create a fresh default timer state.
 * @returns {{ status: string, mode: string, endTime: number, elapsed: number, lastStarted: number, durationMs: number, remainingMs: number, notifiedMilestones: string[] }}
 */
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

/**
 * Tick the timer state forward by one frame and return any actions to take.
 *
 * This is the core state machine logic, implemented as a pure function.
 * Returns an actions object describing what the UI layer should do.
 *
 * @param {object} state     current timer state
 * @param {number} now       current wall-clock time (Date.now())
 * @returns {{ state: object, actions: string[] }}
 */
function tickState(state, now) {
  if (state.status !== 'RUNNING') {
    return { state, actions: [] };
  }

  const msLeft = state.endTime - now;
  const nextState = { ...state };
  const actions = [];

  const shouldBeDanger = isDangerForTimer(msLeft, state.durationMs);

  if (msLeft <= 0) {
    nextState.status = 'STOPPED';
    nextState.remainingMs = 0;
    nextState.endTime = 0;
    actions.push('FINISHED');
    return { state: nextState, actions };
  }

  if (shouldBeDanger) actions.push('DANGER_ON');
  else actions.push('DANGER_OFF');

  const milestones = [...(nextState.notifiedMilestones || [])];

  if (!milestones.includes('10min') && shouldNotify10(msLeft, state.durationMs)) {
    milestones.push('10min');
    nextState.notifiedMilestones = milestones;
    actions.push('NOTIFY_10');
  }
  if (!milestones.includes('5min') && shouldNotify5(msLeft, state.durationMs)) {
    milestones.push('5min');
    nextState.notifiedMilestones = milestones;
    actions.push('NOTIFY_5');
  }
  if (!milestones.includes('1min') && shouldNotify1(msLeft, state.durationMs)) {
    milestones.push('1min');
    nextState.notifiedMilestones = milestones;
    actions.push('NOTIFY_1');
  }

  return { state: nextState, actions };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    formatTime,
    shouldNotify10,
    shouldNotify5,
    shouldNotify1,
    isDanger,
    isDangerForTimer,
    computeRemainingMs,
    defaultTimerState,
    tickState,
    computeTimerAlarmSchedules
  };
}
