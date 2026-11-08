/**
 * FocusForces — Stealth Scout Utilities
 *
 * Pure helper functions for problem rating tiers, tag categorization,
 * and spoiler-guard management.
 * Shared between content scripts and Jest test suites.
 */

/**
 * Codeforces rank tiers, rating bounds, and official display styling.
 */
const RANK_TIERS = [
    { min: 0,    max: 1199, tier: 'newbie',           name: 'Newbie',           color: '#808080', bg: 'rgba(128, 128, 128, 0.12)' },
    { min: 1200, max: 1399, tier: 'pupil',            name: 'Pupil',            color: '#00a500', bg: 'rgba(0, 165, 0, 0.12)' },
    { min: 1400, max: 1599, tier: 'specialist',       name: 'Specialist',       color: '#03a89e', bg: 'rgba(3, 168, 158, 0.12)' },
    { min: 1600, max: 1899, tier: 'expert',           name: 'Expert',           color: '#2563eb', bg: 'rgba(37, 99, 235, 0.12)' },
    { min: 1900, max: 2099, tier: 'candidate_master', name: 'Candidate Master', color: '#aa00aa', bg: 'rgba(170, 0, 170, 0.12)' },
    { min: 2100, max: 2299, tier: 'master',           name: 'Master',           color: '#ff8c00', bg: 'rgba(255, 140, 0, 0.12)' },
    { min: 2300, max: 2399, tier: 'intl_master',      name: 'Intl. Master',     color: '#ff8c00', bg: 'rgba(255, 140, 0, 0.12)' },
    { min: 2400, max: 2999, tier: 'grandmaster',      name: 'Grandmaster',      color: '#ef4444', bg: 'rgba(239, 68, 68, 0.12)' },
    { min: 3000, max: 9999, tier: 'legendary_gm',     name: 'Legendary GM',     color: '#dc2626', bg: 'rgba(220, 38, 38, 0.15)' }
];

/**
 * Resolve Codeforces rank tier metadata from problem or user rating.
 *
 * @param {number|string} rating
 * @returns {{tier: string, name: string, color: string, bg: string, rating: number}|null}
 */
function resolveRankTier(rating) {
    const num = typeof rating === 'string' ? parseInt(rating.replace(/[^0-9]/g, ''), 10) : Number(rating);
    if (!Number.isFinite(num) || num <= 0) return null;

    const matched = RANK_TIERS.find(t => num >= t.min && num <= t.max);
    if (!matched) return null;

    return {
        ...matched,
        rating: num
    };
}

/**
 * Tag category classifications.
 */
const TAG_CATEGORIES = {
    algorithm: {
        label: 'Algorithm',
        color: '#3b82f6',
        bg: 'rgba(59, 130, 246, 0.1)',
        tags: new Set([
            'dp', 'greedy', 'binary search', 'dfs and similar', 'graphs', 'two pointers',
            'brute force', 'divide and conquer', 'ternary search', 'meet-in-the-middle',
            'shortest paths', 'graph matchings', 'flows'
        ])
    },
    data_structure: {
        label: 'Data Structure',
        color: '#10b981',
        bg: 'rgba(16, 185, 129, 0.1)',
        tags: new Set([
            'data structures', 'trees', 'dsu', 'bitmasks', 'string suffix structures',
            'strings', 'hashing'
        ])
    },
    math: {
        label: 'Math & Logic',
        color: '#f59e0b',
        bg: 'rgba(245, 158, 11, 0.1)',
        tags: new Set([
            'math', 'number theory', 'combinatorics', 'geometry', 'probabilities',
            'matrices', 'chinese remainder theorem', 'fft', 'games'
        ])
    },
    general: {
        label: 'General',
        color: '#8b5cf6',
        bg: 'rgba(139, 92, 246, 0.1)',
        tags: new Set([
            'implementation', 'constructive algorithms', 'sortings', 'interactive',
            'expression parsing', 'schedules'
        ])
    }
};

/**
 * Categorize a topic tag.
 *
 * @param {string} tag
 * @returns {{category: string, label: string, color: string, bg: string}}
 */
function categorizeTag(tag) {
    const normalized = String(tag || '').trim().toLowerCase();
    for (const [key, meta] of Object.entries(TAG_CATEGORIES)) {
        if (meta.tags.has(normalized)) {
            return {
                category: key,
                label: meta.label,
                color: meta.color,
                bg: meta.bg
            };
        }
    }
    return {
        category: 'general',
        label: TAG_CATEGORIES.general.label,
        color: TAG_CATEGORIES.general.color,
        bg: TAG_CATEGORIES.general.bg
    };
}

/**
 * Parse problem identity from a Codeforces URL path.
 * Supports /contest/123/problem/A, /problemset/problem/123/A, /gym/123/problem/A.
 *
 * @param {string} pathname
 * @returns {{contestId: string|null, index: string|null, isGym: boolean}}
 */
function parseCodeforcesProblemPath(pathname) {
    if (!pathname) return { contestId: null, index: null, isGym: false };

    const norm = pathname.toLowerCase();
    const isGym = norm.includes('/gym/');

    // /contest/1234/problem/A or /gym/1234/problem/A
    const contestMatch = norm.match(/\/(?:contest|gym)\/(\d+)\/problem\/([a-z0-9]+)/i);
    if (contestMatch) {
        return {
            contestId: contestMatch[1],
            index: contestMatch[2].toUpperCase(),
            isGym
        };
    }

    // /problemset/problem/1234/A
    const problemsetMatch = norm.match(/\/problemset\/problem\/(\d+)\/([a-z0-9]+)/i);
    if (problemsetMatch) {
        return {
            contestId: problemsetMatch[1],
            index: problemsetMatch[2].toUpperCase(),
            isGym: false
        };
    }

    return { contestId: null, index: null, isGym };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        RANK_TIERS,
        resolveRankTier,
        TAG_CATEGORIES,
        categorizeTag,
        parseCodeforcesProblemPath
    };
}
