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
 * @returns {{ status: string, endTime: number, remainingMs: number, durationMs: number, notified10: boolean, notified5: boolean }}
 */
function defaultTimerState() {
  return {
    status: 'STOPPED',
    endTime: 0,
    remainingMs: 0,
    durationMs: 0,
    notified10: false,
    notified5: false,
    _dangerActive: false
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
 * @returns {{ state: object, actions: string[], notification?: { title: string, message: string } }}
 */
function tickState(state, now) {
  if (state.status !== 'RUNNING') {
    return { state, actions: [] };
  }

  const msLeft = state.endTime - now;
  const nextState = { ...state };
  const actions = [];

  // Danger styling threshold (5 min)
  const shouldBeDanger = isDanger(msLeft);
  if (shouldBeDanger !== nextState._dangerActive) {
    nextState._dangerActive = shouldBeDanger;
    actions.push(shouldBeDanger ? 'DANGER_ON' : 'DANGER_OFF');
  }

  // Milestone notifications — check BEFORE finish so backgrounded tabs
  // don't skip 10min/5min when they come back and find msLeft <= 0.
  if (!nextState.notified10 && shouldNotify10(msLeft, state.durationMs)) {
    nextState.notified10 = true;
    actions.push('NOTIFY_10');
  }
  if (!nextState.notified5 && shouldNotify5(msLeft, state.durationMs)) {
    nextState.notified5 = true;
    actions.push('NOTIFY_5');
  }

  if (msLeft <= 0) {
    nextState.status = 'STOPPED';
    nextState.remainingMs = 0;
    nextState.endTime = 0;
    actions.push('FINISHED');
    return { state: nextState, actions };
  }

  return { state: nextState, actions };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    formatTime,
    shouldNotify10,
    shouldNotify5,
    isDanger,
    computeRemainingMs,
    defaultTimerState,
    tickState
  };
}
