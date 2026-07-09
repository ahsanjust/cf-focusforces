/**
 * FocusForces - Contest Utilities
 *
 * Pure helper functions for contest data processing.
 * Shared between popup.js and the Jest test suite via CommonJS exports.
 */

const PLATFORM_CONFIG = {
    CodeForces: { badge: 'CF', cls: 'cf', color: '#1976d2' },
    AtCoder: { badge: 'ATC', cls: 'atcoder', color: '#e65100' },
    LeetCode: { badge: 'LC', cls: 'leetcode', color: '#f9a825' },
    CodeChef: { badge: 'CC', cls: 'codechef', color: '#c62828' }
};

const CONTEST_HORIZON_MS = 15 * 24 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * Determine contest status from its status field.
 * @param {object} c  contest object with a `status` property
 * @returns {'ongoing'|'upcoming'|'other'}
 */
function getContestStatus(c) {
    return c.status === 'CODING' ? 'ongoing' : (c.status === 'BEFORE' ? 'upcoming' : 'other');
}

/**
 * Format a duration in minutes to a human-readable string.
 * @param {number} m  duration in minutes
 * @returns {string}
 */
function formatDuration(m) {
    const t = Math.max(0, Math.round(m || 0));
    const h = Math.floor(t / 60), mm = t % 60;
    return h > 0 ? `${h}h${mm > 0 ? ` ${mm}m` : ''}` : `${mm}m`;
}

/**
 * Format an ISO datetime string to a short locale string.
 * @param {string} iso  ISO 8601 datetime string
 * @returns {string}
 */
function formatDateTime(iso) {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? 'Unknown' : d.toLocaleString([], {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
}

/**
 * Compute a human-readable "time until" string.
 * @param {string} iso  ISO 8601 datetime string
 * @returns {string|null}
 */
function timeUntil(iso) {
    const target = new Date(iso);
    if (isNaN(target.getTime())) return null;
    const diff = target - Date.now();
    if (diff <= 0) return null;
    const h = Math.floor(diff / 3600000), m = Math.floor((diff % 3600000) / 60000);
    return h > 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : (h > 0 ? `${h}h ${m}m` : `${m}m`);
}

/**
 * Sort comparator for contests: ongoing first, then by start time.
 */
function contestComparator(a, b) {
    const sa = getContestStatus(a), sb = getContestStatus(b);
    if (sa !== sb) return sa === 'ongoing' ? -1 : 1;
    const ta = new Date(a.start_time).getTime();
    const tb = new Date(b.start_time).getTime();
    if (isNaN(ta) && isNaN(tb)) return 0;
    if (isNaN(ta)) return 1;
    if (isNaN(tb)) return -1;
    return ta - tb;
}

/**
 * Filter contests to within the horizon and sort them.
 * @param {object[]} contests
 * @returns {object[]}
 */
function filterAndSort(contests) {
    const now = Date.now();
    const filtered = contests.filter(c => {
        if (getContestStatus(c) === 'ongoing') return true;
        const startMs = new Date(c.start_time).getTime();
        if (isNaN(startMs)) return false;
        return startMs - now <= CONTEST_HORIZON_MS && startMs > now;
    });
    return [...filtered].sort(contestComparator);
}

/**
 * Sort an array of contests by time (ongoing first, then by start time).
 * @param {object[]} items
 * @returns {object[]}
 */
function sortByTime(items) {
    return items.slice().sort(contestComparator);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        PLATFORM_CONFIG,
        CONTEST_HORIZON_MS,
        TWENTY_FOUR_HOURS_MS,
        getContestStatus,
        formatDuration,
        formatDateTime,
        timeUntil,
        contestComparator,
        filterAndSort,
        sortByTime
    };
}
