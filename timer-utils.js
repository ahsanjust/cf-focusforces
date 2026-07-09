/**
 * FocusForces - Timer Utilities
 *
 * Pure functions used by both content.js (loaded as a content script
 * via manifest.json) and the Jest test suite. The CommonJS export block
 * at the bottom is a no-op in the browser, so the functions are declared
 * in the global scope and can be used by content.js directly.
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
  return msLeft <= 10 * 60 * 1000 && durationMs >= 10 * 60 * 1000;
}

/**
 * Check whether the "5 Minutes Left" notification should fire.
 * @param {number} msLeft    milliseconds remaining
 * @param {number} durationMs total timer duration
 * @returns {boolean}
 */
function shouldNotify5(msLeft, durationMs) {
  return msLeft <= 5 * 60 * 1000 && durationMs >= 5 * 60 * 1000;
}

/**
 * Check whether the "1 Minute Left" notification should fire.
 * @param {number} msLeft    milliseconds remaining
 * @param {number} durationMs total timer duration
 * @returns {boolean}
 */
function shouldNotify1(msLeft, durationMs) {
  return msLeft <= 1 * 60 * 1000 && durationMs >= 1 * 60 * 1000;
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

  const shouldBeDanger = isDanger(msLeft);

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
    computeRemainingMs,
    defaultTimerState,
    tickState
  };
}
