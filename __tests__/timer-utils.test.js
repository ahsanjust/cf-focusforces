/**
 * FocusForces - Timer Utilities Tests
 */
const {
    formatTime,
    shouldNotify10,
    shouldNotify5,
    shouldNotify1,
    isDanger,
    computeRemainingMs,
    defaultTimerState,
    tickState
} = require('../timer-utils');

describe('formatTime', () => {
    test('formats zero milliseconds as 00:00:00', () => {
        expect(formatTime(0)).toBe('00:00:00');
    });

    test('formats 25 minutes correctly', () => {
        expect(formatTime(25 * 60 * 1000)).toBe('00:25:00');
    });

    test('formats 1 hour 30 minutes correctly', () => {
        expect(formatTime(90 * 60 * 1000)).toBe('01:30:00');
    });

    test('formats mixed h:m:s correctly', () => {
        expect(formatTime((2 * 3600 + 15 * 60 + 30) * 1000)).toBe('02:15:30');
    });

    test('ceils fractional seconds upward', () => {
        expect(formatTime(1500)).toBe('00:00:02');
    });

    test('handles exactly 1 second', () => {
        expect(formatTime(1000)).toBe('00:00:01');
    });

    test('handles just under 1 second by ceiling to 1', () => {
        expect(formatTime(999)).toBe('00:00:01');
    });

    test('handles large durations (24h+)', () => {
        expect(formatTime(25 * 60 * 60 * 1000)).toBe('25:00:00');
    });

    test('handles 999 minutes', () => {
        expect(formatTime(999 * 60 * 1000)).toBe('16:39:00');
    });
});

describe('shouldNotify10', () => {
    test('returns true when msLeft <= 10min and duration >= 10min', () => {
        expect(shouldNotify10(10 * 60 * 1000, 25 * 60 * 1000)).toBe(true);
    });

    test('returns true when msLeft < 10min', () => {
        expect(shouldNotify10(5 * 60 * 1000, 25 * 60 * 1000)).toBe(true);
    });

    test('returns false when msLeft > 10min', () => {
        expect(shouldNotify10(11 * 60 * 1000, 25 * 60 * 1000)).toBe(false);
    });

    test('returns false when duration < 10min', () => {
        expect(shouldNotify10(5 * 60 * 1000, 5 * 60 * 1000)).toBe(false);
    });
});

describe('shouldNotify5', () => {
    test('returns true when msLeft <= 5min and duration >= 5min', () => {
        expect(shouldNotify5(5 * 60 * 1000, 25 * 60 * 1000)).toBe(true);
    });

    test('returns true when msLeft < 5min', () => {
        expect(shouldNotify5(3 * 60 * 1000, 25 * 60 * 1000)).toBe(true);
    });

    test('returns false when msLeft > 5min', () => {
        expect(shouldNotify5(6 * 60 * 1000, 25 * 60 * 1000)).toBe(false);
    });

    test('returns false when duration < 5min', () => {
        expect(shouldNotify5(3 * 60 * 1000, 3 * 60 * 1000)).toBe(false);
    });
});

describe('shouldNotify1', () => {
    test('returns true when msLeft <= 1min and duration >= 1min', () => {
        expect(shouldNotify1(1 * 60 * 1000, 25 * 60 * 1000)).toBe(true);
    });

    test('returns true when msLeft < 1min', () => {
        expect(shouldNotify1(30 * 1000, 25 * 60 * 1000)).toBe(true);
    });

    test('returns false when msLeft > 1min', () => {
        expect(shouldNotify1(2 * 60 * 1000, 25 * 60 * 1000)).toBe(false);
    });

    test('returns false when duration < 1min', () => {
        expect(shouldNotify1(30 * 1000, 30 * 1000)).toBe(false);
    });
});

describe('isDanger', () => {
    test('returns true when <= 300 seconds remain', () => {
        expect(isDanger(300 * 1000)).toBe(true);
    });

    test('returns true when < 300 seconds remain', () => {
        expect(isDanger(299 * 1000)).toBe(true);
    });

    test('returns false when > 300 seconds remain', () => {
        expect(isDanger(301 * 1000)).toBe(false);
    });

    test('returns true for 0 milliseconds', () => {
        expect(isDanger(0)).toBe(true);
    });
});

describe('computeRemainingMs', () => {
    test('computes 25 minutes 0 seconds', () => {
        expect(computeRemainingMs(25, 0)).toBe(25 * 60 * 1000);
    });

    test('computes 0 minutes 30 seconds', () => {
        expect(computeRemainingMs(0, 30)).toBe(30 * 1000);
    });

    test('computes mixed minutes and seconds', () => {
        expect(computeRemainingMs(10, 15)).toBe((10 * 60 + 15) * 1000);
    });

    test('clamps minutes to max 999', () => {
        expect(computeRemainingMs(999, 0)).toBe(999 * 60 * 1000);
        expect(computeRemainingMs(1500, 0)).toBe(999 * 60 * 1000);
    });

    test('clamps seconds to max 59', () => {
        expect(computeRemainingMs(0, 59)).toBe(59 * 1000);
        expect(computeRemainingMs(0, 90)).toBe(59 * 1000);
    });

    test('handles negative values by clamping to 0', () => {
        expect(computeRemainingMs(-5, -10)).toBe(0);
    });

    test('handles string input', () => {
        expect(computeRemainingMs('10', '30')).toBe((10 * 60 + 30) * 1000);
    });

    test('handles empty/NaN input', () => {
        expect(computeRemainingMs('', '')).toBe(0);
        expect(computeRemainingMs('abc', 'def')).toBe(0);
    });
});

describe('defaultTimerState', () => {
    test('returns a fresh default state', () => {
        const state = defaultTimerState();
        expect(state.status).toBe('STOPPED');
        expect(state.mode).toBe('countdown');
        expect(state.endTime).toBe(0);
        expect(state.elapsed).toBe(0);
        expect(state.lastStarted).toBe(0);
        expect(state.durationMs).toBe(0);
        expect(state.remainingMs).toBe(0);
        expect(state.notifiedMilestones).toEqual([]);
    });

    test('returns a new object each call (no shared references)', () => {
        const a = defaultTimerState();
        const b = defaultTimerState();
        a.notifiedMilestones.push('test');
        expect(b.notifiedMilestones).toEqual([]);
    });
});

describe('tickState', () => {
    test('does nothing if status is not RUNNING', () => {
        const state = defaultTimerState();
        const result = tickState(state, Date.now());
        expect(result.actions).toEqual([]);
        expect(result.state.status).toBe('STOPPED');
    });

    test('returns FINISHED when time has expired', () => {
        const state = {
            ...defaultTimerState(),
            status: 'RUNNING',
            endTime: Date.now() - 1000,
            durationMs: 25 * 60 * 1000,
            notifiedMilestones: []
        };
        const result = tickState(state, Date.now());
        expect(result.actions).toContain('FINISHED');
        expect(result.state.status).toBe('STOPPED');
    });

    test('emits DANGER_ON when <= 5 minutes remain', () => {
        const now = Date.now();
        const state = {
            ...defaultTimerState(),
            status: 'RUNNING',
            endTime: now + 4 * 60 * 1000,
            durationMs: 25 * 60 * 1000,
            notifiedMilestones: []
        };
        const result = tickState(state, now);
        expect(result.actions).toContain('DANGER_ON');
    });

    test('emits DANGER_OFF when > 5 minutes remain', () => {
        const now = Date.now();
        const state = {
            ...defaultTimerState(),
            status: 'RUNNING',
            endTime: now + 10 * 60 * 1000,
            durationMs: 25 * 60 * 1000,
            notifiedMilestones: []
        };
        const result = tickState(state, now);
        expect(result.actions).toContain('DANGER_OFF');
    });

    test('emits NOTIFY_10 at exactly 10 minutes', () => {
        const now = Date.now();
        const state = {
            ...defaultTimerState(),
            status: 'RUNNING',
            endTime: now + 10 * 60 * 1000,
            durationMs: 25 * 60 * 1000,
            notifiedMilestones: []
        };
        const result = tickState(state, now);
        expect(result.actions).toContain('NOTIFY_10');
        expect(result.state.notifiedMilestones).toContain('10min');
    });

    test('does not re-emit NOTIFY_10 if already notified', () => {
        const now = Date.now();
        const state = {
            ...defaultTimerState(),
            status: 'RUNNING',
            endTime: now + 10 * 60 * 1000,
            durationMs: 25 * 60 * 1000,
            notifiedMilestones: ['10min']
        };
        const result = tickState(state, now);
        expect(result.actions).not.toContain('NOTIFY_10');
    });

    test('emits NOTIFY_5 at exactly 5 minutes', () => {
        const now = Date.now();
        const state = {
            ...defaultTimerState(),
            status: 'RUNNING',
            endTime: now + 5 * 60 * 1000,
            durationMs: 25 * 60 * 1000,
            notifiedMilestones: []
        };
        const result = tickState(state, now);
        expect(result.actions).toContain('NOTIFY_5');
        expect(result.state.notifiedMilestones).toContain('5min');
    });

    test('emits NOTIFY_1 at exactly 1 minute', () => {
        const now = Date.now();
        const state = {
            ...defaultTimerState(),
            status: 'RUNNING',
            endTime: now + 1 * 60 * 1000,
            durationMs: 25 * 60 * 1000,
            notifiedMilestones: []
        };
        const result = tickState(state, now);
        expect(result.actions).toContain('NOTIFY_1');
        expect(result.state.notifiedMilestones).toContain('1min');
    });

    test('accumulates milestones across ticks', () => {
        const now = Date.now();
        const state = {
            ...defaultTimerState(),
            status: 'RUNNING',
            endTime: now + 5 * 60 * 1000,
            durationMs: 25 * 60 * 1000,
            notifiedMilestones: ['10min']
        };
        const result = tickState(state, now);
        expect(result.state.notifiedMilestones).toContain('10min');
        expect(result.state.notifiedMilestones).toContain('5min');
    });

    test('does not emit notifications for short timers', () => {
        const now = Date.now();
        const state = {
            ...defaultTimerState(),
            status: 'RUNNING',
            endTime: now + 4 * 60 * 1000,
            durationMs: 4 * 60 * 1000,
            notifiedMilestones: []
        };
        const result = tickState(state, now);
        expect(result.actions).not.toContain('NOTIFY_10');
        expect(result.actions).not.toContain('NOTIFY_5');
        expect(result.actions).not.toContain('NOTIFY_1');
    });
});
