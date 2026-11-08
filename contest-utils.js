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

const DEFAULT_REMINDER_INTERVALS = [86400, 43200, 18000, 7200, 3600, 1800, 600, 300];
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * Default set of timer milestone notifications the user is opted into
 * (mirrors the milestone chips in the popup). Shared by popup.js and the
 * background service worker via importScripts so the two contexts can never
 * drift apart.
 */
const DEFAULT_TIMER_NOTIFY_MILESTONES = ['10min', '5min', '1min', 'finish'];

/**
 * Format a "time until" duration (ms) as a compact human string.
 * @param {number} ms
 * @returns {string}
 */
function formatTimeUntil(ms) {
    if (ms <= 0) return 'soon';
    const totalSec = Math.round(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
    if (m > 0) return `${m}m`;
    return `${s}s`;
}

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
 * Format an ISO datetime string to a rich locale string with day of week.
 * @param {string} iso  ISO 8601 datetime string
 * @returns {string}
 */
function formatContestDateTime(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return 'Unknown';
    return d.toLocaleString([], {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
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
 * Generate a 1-click Google Calendar add URL for an upcoming contest.
 * @param {object} contest
 * @returns {string|null}
 */
function generateGoogleCalendarUrl(contest) {
    if (!contest || !contest.start_time) return null;
    const start = new Date(contest.start_time);
    if (isNaN(start.getTime())) return null;

    const durMin = Math.max(15, parseInt(contest.duration, 10) || 120);
    const end = new Date(start.getTime() + durMin * 60000);

    const fmtUtc = d => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const dates = `${fmtUtc(start)}/${fmtUtc(end)}`;
    const text = encodeURIComponent(contest.name || 'Competitive Programming Contest');
    const details = encodeURIComponent(`Contest URL: ${contest.url || ''}\nPlatform: ${contest.site || 'Online'}\nTracked with FocusForces.`);
    const location = encodeURIComponent(contest.site || 'Online');

    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${text}&dates=${dates}&details=${details}&location=${location}`;
}

/**
 * Tally contests by platform for tab chips.
 * @param {object[]} contests
 * @returns {{all: number, CodeForces: number, AtCoder: number, CodeChef: number, LeetCode: number}}
 */
function countContestsByPlatform(contests) {
    const counts = { all: 0, CodeForces: 0, AtCoder: 0, CodeChef: 0, LeetCode: 0 };
    if (!Array.isArray(contests)) return counts;
    counts.all = contests.length;
    for (const c of contests) {
        if (c.site && counts[c.site] !== undefined) {
            counts[c.site]++;
        }
    }
    return counts;
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

/**
 * Resolve the active reminder-interval set from stored user settings.
 *
 * Semantics (regression-tested):
 *   - missing / non-array / undefined  → defaults   (user never configured)
 *   - empty array                       → []          (user unchecked every
 *                                                       chip → NO reminders;
 *                                                       caller must NOT fall
 *                                                       back to defaults)
 *   - non-empty array                   → that array
 *
 * Returning [] for the "all unchecked" case is deliberate: previously the
 * caller fell back to defaults whenever the stored array was empty, which
 * silently re-enabled every reminder right after the user disabled them all.
 *
 * @param {*} stored   value read from `ff_reminder_intervals`
 * @param {number[]} defaults  fallback when stored is absent/non-array
 * @returns {number[]}
 */
function resolveReminderIntervals(stored, defaults) {
    if (Array.isArray(stored)) return stored;
    return defaults;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        PLATFORM_CONFIG,
        CONTEST_HORIZON_MS,
        TWENTY_FOUR_HOURS_MS,
        DEFAULT_REMINDER_INTERVALS,
        DEFAULT_TIMER_NOTIFY_MILESTONES,
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
        resolveReminderIntervals
    };
}
