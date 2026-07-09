/**
 * FocusForces - Contest Utilities Tests
 */
const {
    getContestStatus,
    formatDuration,
    formatDateTime,
    timeUntil,
    contestComparator,
    filterAndSort,
    sortByTime,
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
        expect(result).toMatch(/\dh \dm/);
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
        expect(result).toMatch(/\dd \dh/);
    });

    test('formats minutes for < 1 hour', () => {
        const future = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        const result = timeUntil(future);
        expect(result).toMatch(/^\d+m$/);
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
