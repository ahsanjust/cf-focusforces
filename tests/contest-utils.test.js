/**
 * FocusForces - Contest Utilities Tests
 */
const {
    getContestStatus,
    formatDuration,
    formatDateTime,
    formatContestDateTime,
    generateGoogleCalendarUrl,
    countContestsByPlatform,
    timeUntil,
    formatTimeUntil,
    contestComparator,
    filterAndSort,
    sortByTime,
    resolveReminderIntervals,
    DEFAULT_REMINDER_INTERVALS,
    DEFAULT_TIMER_NOTIFY_MILESTONES,
    TWENTY_FOUR_HOURS_MS
} = require('../contest-utils');

describe('getContestStatus', () => {
    test('returns "ongoing" for CODING status', () => {
        expect(getContestStatus({ status: 'CODING' })).toBe('ongoing');
    });

    test('returns "upcoming" for BEFORE status', () => {
        expect(getContestStatus({ status: 'BEFORE' })).toBe('upcoming');
    });

    test('returns "other" for FINISHED status', () => {
        expect(getContestStatus({ status: 'FINISHED' })).toBe('other');
    });

    test('returns "other" for unknown status', () => {
        expect(getContestStatus({ status: 'SOMETHING_ELSE' })).toBe('other');
    });
});

describe('formatDuration', () => {
    test('formats minutes only', () => {
        expect(formatDuration(45)).toBe('45m');
    });

    test('formats hours and minutes', () => {
        expect(formatDuration(120)).toBe('2h');
    });

    test('formats hours with remaining minutes', () => {
        expect(formatDuration(150)).toBe('2h 30m');
    });

    test('formats 0 minutes', () => {
        expect(formatDuration(0)).toBe('0m');
    });

    test('rounds fractional minutes', () => {
        expect(formatDuration(90.4)).toBe('1h 30m');
    });

    test('handles null/undefined gracefully', () => {
        expect(formatDuration(null)).toBe('0m');
        expect(formatDuration(undefined)).toBe('0m');
    });

    test('handles negative values by clamping to 0', () => {
        expect(formatDuration(-10)).toBe('0m');
    });
});

describe('formatDateTime', () => {
    test('formats a valid ISO date string', () => {
        const result = formatDateTime('2025-07-15T14:30:00.000Z');
        expect(result).not.toBe('Unknown');
        expect(result).toContain('Jul');
    });

    test('returns "Unknown" for invalid date', () => {
        expect(formatDateTime('not-a-date')).toBe('Unknown');
    });

    test('returns "Unknown" for empty string', () => {
        expect(formatDateTime('')).toBe('Unknown');
    });
});

describe('timeUntil', () => {
    test('returns a string for a future time', () => {
        const future = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
        const result = timeUntil(future);
        expect(result).not.toBeNull();
        expect(result).toMatch(/\d+h \d+m/);
    });

    test('returns null for a past time', () => {
        const past = new Date(Date.now() - 60 * 1000).toISOString();
        expect(timeUntil(past)).toBeNull();
    });

    test('returns null for invalid date', () => {
        expect(timeUntil('not-a-date')).toBeNull();
    });

    test('formats days for > 24h', () => {
        const future = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
        const result = timeUntil(future);
        expect(result).toMatch(/\d+d \d+h/);
    });

    test('formats minutes for < 1 hour', () => {
        const future = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        const result = timeUntil(future);
        expect(result).toMatch(/^\d+m$/);
    });

    test('formats hours and minutes for 1-24h', () => {
        const future = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
        const result = timeUntil(future);
        expect(result).toMatch(/\d+h \d+m/);
    });
});

describe('formatTimeUntil', () => {
    test('returns "soon" for non-positive durations', () => {
        expect(formatTimeUntil(0)).toBe('soon');
        expect(formatTimeUntil(-1000)).toBe('soon');
    });

    test('formats seconds-only durations', () => {
        expect(formatTimeUntil(30 * 1000)).toBe('30s');
    });

    test('formats minutes', () => {
        expect(formatTimeUntil(90 * 1000)).toBe('1m');
        expect(formatTimeUntil(2 * 60 * 1000 + 45 * 1000)).toBe('2m');
    });

    test('formats hours with and without minutes', () => {
        expect(formatTimeUntil(2 * 3600 * 1000)).toBe('2h');
        expect(formatTimeUntil(2 * 3600 * 1000 + 30 * 60 * 1000)).toBe('2h 30m');
    });
});

describe('DEFAULT_TIMER_NOTIFY_MILESTONES', () => {
    test('includes the four milestone ids in canonical order', () => {
        expect(DEFAULT_TIMER_NOTIFY_MILESTONES).toEqual(['10min', '5min', '1min', 'finish']);
    });
});

describe('contestComparator', () => {
    test('ongoing contests come before upcoming', () => {
        const ongoing = { status: 'CODING', start_time: '2025-01-01T00:00:00Z' };
        const upcoming = { status: 'BEFORE', start_time: '2025-12-31T00:00:00Z' };
        expect(contestComparator(ongoing, upcoming)).toBe(-1);
    });

    test('upcoming contests come after ongoing', () => {
        const ongoing = { status: 'CODING', start_time: '2025-01-01T00:00:00Z' };
        const upcoming = { status: 'BEFORE', start_time: '2025-12-31T00:00:00Z' };
        expect(contestComparator(upcoming, ongoing)).toBe(1);
    });

    test('sorts upcoming contests by start time ascending', () => {
        const a = { status: 'BEFORE', start_time: '2025-01-01T00:00:00Z' };
        const b = { status: 'BEFORE', start_time: '2025-06-01T00:00:00Z' };
        expect(contestComparator(a, b)).toBeLessThan(0);
    });

    test('handles equal start times', () => {
        const a = { status: 'BEFORE', start_time: '2025-06-01T00:00:00Z' };
        const b = { status: 'BEFORE', start_time: '2025-06-01T00:00:00Z' };
        expect(contestComparator(a, b)).toBe(0);
    });

    test('handles invalid dates gracefully', () => {
        const a = { status: 'BEFORE', start_time: 'invalid' };
        const b = { status: 'BEFORE', start_time: '2025-06-01T00:00:00Z' };
        expect(contestComparator(a, b)).toBe(1);
    });
});

describe('sortByTime', () => {
    test('sorts a mixed list correctly', () => {
        const contests = [
            { status: 'BEFORE', start_time: '2025-12-01T00:00:00Z' },
            { status: 'CODING', start_time: '2025-01-01T00:00:00Z' },
            { status: 'BEFORE', start_time: '2025-06-01T00:00:00Z' }
        ];
        const sorted = sortByTime(contests);
        expect(sorted[0].status).toBe('CODING');
        expect(sorted[1].start_time).toBe('2025-06-01T00:00:00Z');
        expect(sorted[2].start_time).toBe('2025-12-01T00:00:00Z');
    });

    test('does not mutate the original array', () => {
        const contests = [
            { status: 'BEFORE', start_time: '2025-12-01T00:00:00Z' },
            { status: 'BEFORE', start_time: '2025-06-01T00:00:00Z' }
        ];
        const original = [...contests];
        sortByTime(contests);
        expect(contests).toEqual(original);
    });
});

describe('filterAndSort', () => {
    test('includes ongoing contests regardless of start time', () => {
        const contests = [
            { status: 'CODING', start_time: '2020-01-01T00:00:00Z' }
        ];
        const result = filterAndSort(contests);
        expect(result).toHaveLength(1);
    });

    test('excludes past contests', () => {
        const contests = [
            { status: 'FINISHED', start_time: '2020-01-01T00:00:00Z' }
        ];
        const result = filterAndSort(contests);
        expect(result).toHaveLength(0);
    });

    test('excludes contests beyond the horizon', () => {
        const farFuture = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString();
        const contests = [
            { status: 'BEFORE', start_time: farFuture }
        ];
        const result = filterAndSort(contests);
        expect(result).toHaveLength(0);
    });

    test('includes contests within 24 hours', () => {
        const soon = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
        const contests = [
            { status: 'BEFORE', start_time: soon }
        ];
        const result = filterAndSort(contests);
        expect(result).toHaveLength(1);
    });

    test('returns sorted results', () => {
        const soon = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
        const later = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
        const contests = [
            { status: 'BEFORE', start_time: later },
            { status: 'CODING', start_time: '2020-01-01T00:00:00Z' },
            { status: 'BEFORE', start_time: soon }
        ];
        const result = filterAndSort(contests);
        expect(result[0].status).toBe('CODING');
        expect(result[1].start_time).toBe(soon);
        expect(result[2].start_time).toBe(later);
    });
});

describe('resolveReminderIntervals', () => {
    // Regression for the bug where unchecking every reminder chip stored `[]`
    // but the background fell back to DEFAULT_REMINDER_INTERVALS, silently
    // re-enabling all reminders right after the user disabled them.
    test('returns [] when stored is an empty array (all chips unchecked)', () => {
        expect(resolveReminderIntervals([], DEFAULT_REMINDER_INTERVALS)).toEqual([]);
    });

    test('returns defaults when stored is missing/undefined', () => {
        expect(resolveReminderIntervals(undefined, DEFAULT_REMINDER_INTERVALS))
            .toEqual(DEFAULT_REMINDER_INTERVALS);
    });

    test('returns defaults when stored is null', () => {
        expect(resolveReminderIntervals(null, DEFAULT_REMINDER_INTERVALS))
            .toEqual(DEFAULT_REMINDER_INTERVALS);
    });

    test('returns defaults when stored is a non-array primitive', () => {
        expect(resolveReminderIntervals(3600, DEFAULT_REMINDER_INTERVALS))
            .toEqual(DEFAULT_REMINDER_INTERVALS);
        expect(resolveReminderIntervals('3600', DEFAULT_REMINDER_INTERVALS))
            .toEqual(DEFAULT_REMINDER_INTERVALS);
        expect(resolveReminderIntervals(true, DEFAULT_REMINDER_INTERVALS))
            .toEqual(DEFAULT_REMINDER_INTERVALS);
    });

    test('returns the stored array as-is when non-empty', () => {
        const custom = [3600, 600, 300];
        expect(resolveReminderIntervals(custom, DEFAULT_REMINDER_INTERVALS)).toBe(custom);
    });

    test('empty-array result length is 0, not the default length', () => {
        const result = resolveReminderIntervals([], DEFAULT_REMINDER_INTERVALS);
        expect(result).toHaveLength(0);
        expect(result.length).not.toBe(DEFAULT_REMINDER_INTERVALS.length);
    });
});

describe('formatContestDateTime', () => {
    test('formats ISO string with weekday and time', () => {
        const str = formatContestDateTime('2026-11-14T14:35:00Z');
        expect(str).toContain('Nov');
        expect(str).not.toBe('Unknown');
    });

    test('returns Unknown for invalid dates', () => {
        expect(formatContestDateTime('invalid-date')).toBe('Unknown');
    });
});

describe('generateGoogleCalendarUrl', () => {
    test('generates valid Google Calendar render template link', () => {
        const url = generateGoogleCalendarUrl({
            name: 'Codeforces Round 999 (Div. 2)',
            site: 'CodeForces',
            start_time: '2026-11-15T14:35:00Z',
            duration: 120,
            url: 'https://codeforces.com/contest/999'
        });
        expect(url).toContain('https://calendar.google.com/calendar/render?action=TEMPLATE');
        expect(url).toContain('Codeforces');
        expect(url).toContain('dates=');
    });

    test('returns null when contest has no start_time', () => {
        expect(generateGoogleCalendarUrl(null)).toBeNull();
        expect(generateGoogleCalendarUrl({})).toBeNull();
    });
});

describe('countContestsByPlatform', () => {
    test('tallies contests accurately by platform', () => {
        const sample = [
            { site: 'CodeForces' },
            { site: 'CodeForces' },
            { site: 'AtCoder' },
            { site: 'CodeChef' },
            { site: 'LeetCode' }
        ];
        const counts = countContestsByPlatform(sample);
        expect(counts.all).toBe(5);
        expect(counts.CodeForces).toBe(2);
        expect(counts.AtCoder).toBe(1);
        expect(counts.CodeChef).toBe(1);
        expect(counts.LeetCode).toBe(1);
    });

    test('handles empty or non-array inputs safely', () => {
        const counts = countContestsByPlatform([]);
        expect(counts.all).toBe(0);
        expect(countContestsByPlatform(null).all).toBe(0);
    });
});
