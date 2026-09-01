/**
 * FocusForces - AC Celebration Utilities
 *
 * Pure logic for the "Accepted" celebration: parsing a Codeforces problem
 * identity from a URL, building dedup keys, recognizing accepted-verdict
 * tokens, and generating calm particle geometry for the burst. DOM access
 * stays in accelebrate.js; everything here is a pure function of its inputs
 * (randomness is injected via `rand`), mirroring the catwalk-utils pattern so
 * the driver stays thin and the Jest suite pins exact behavior.
 */

// ── Config ───────────────────────────────────────────────
const AC_CELEBRATE_SPARK_COUNT = 9;
const AC_CELEBRATE_MIN_RADIUS_PX = 34;   // sparks travel 34-92px from center
const AC_CELEBRATE_MAX_RADIUS_PX = 92;
const AC_CELEBRATE_SPARK_MIN_SIZE = 3;
const AC_CELEBRATE_SPARK_MAX_SIZE = 7;

// Verdict tokens that count as Accepted (Codeforces EN / RU).
const AC_ACCEPTED_TOKENS = ['accepted', 'правильное решение', 'ok'];

// ── Small helpers ─────────────────────────────────────────
function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
}

function randRange(min, max, rand) {
    const r = typeof rand === 'function' ? rand() : Math.random();
    return min + r * (max - min);
}

// ── Public API ───────────────────────────────────────────

/**
 * Parse a Codeforces problem identity from a pathname.
 * Supports /contest|gym/<id>/problem/<index>,
 * /problemset/problem/<id>/<index>, and
 * /group/<group>/contest/<id>/problem/<index>.
 * @param {string} pathname
 * @returns {{ contestId: string, index: string, key: string } | null}
 */
function parseProblemKeyFromPath(pathname) {
    const parts = String(pathname || '').split('/').filter(Boolean);
    let contestId = null;
    let index = null;

    if (parts[0] === 'problemset' && parts[1] === 'problem') {
        contestId = parts[2];
        index = parts[3];
    } else if ((parts[0] === 'contest' || parts[0] === 'gym') && parts[2] === 'problem') {
        contestId = parts[1];
        index = parts[3];
    } else if (parts[0] === 'group' && parts[2] === 'contest' && parts[4] === 'problem') {
        contestId = parts[3];
        index = parts[5];
    }

    if (!contestId || !index) return null;
    index = String(index).toUpperCase();
    return { contestId: String(contestId), index, key: `${contestId}-${index}` };
}

/**
 * Dedup storage key for a celebrated submission. Problem-scoped when a
 * problem key is known (survives the post-submit page reload), otherwise
 * submission-scoped (used on submissions-list pages).
 * @param {{ key?: string } | null} problem result of parseProblemKeyFromPath
 * @param {string|number|null} submissionId
 * @returns {string}
 */
function celebrateDedupKey(problem, submissionId) {
    if (problem && problem.key) return `ff_ac_celebrated_${problem.key}`;
    return `ff_ac_celebrated_sub_${submissionId}`;
}

/**
 * Should we celebrate this (problem, submission)? Not already celebrated in
 * this session, and not already recorded in storage for that key.
 * @param {Set<string>} sessionSeen
 * @param {object} storedKeys  storage map (dedup key -> timestamp)
 * @param {string} key
 * @returns {boolean}
 */
function shouldCelebrate(sessionSeen, storedKeys, key) {
    if (!key) return false;
    if (sessionSeen.has(key)) return false;
    if (Object.prototype.hasOwnProperty.call(storedKeys, key)) return false;
    return true;
}

/**
 * Does this text represent an Accepted verdict? Lowercases and searches for
 * accepted tokens ("accepted", "ok", Russian "правильное решение").
 * @param {string} text
 * @returns {boolean}
 */
function isAcceptedToken(text) {
    const t = String(text || '').trim().toLowerCase();
    if (!t) return false;
    return AC_ACCEPTED_TOKENS.some(tok => t.includes(tok));
}

/**
 * Calm burst geometry: N sparks distributed around a center with random
 * angle/distance/size/duration — deterministic given the injected rand.
 * @param {{ count?: number, rand?: () => number }} opts
 * @returns {Array<{ angle: number, dist: number, size: number, dur: number, delay: number }>}
 */
function pickBurstParticles(opts) {
    const rand = typeof opts.rand === 'function' ? opts.rand : Math.random;
    const count = Math.max(1, Math.floor(opts.count ?? AC_CELEBRATE_SPARK_COUNT));
    const particles = [];
    for (let i = 0; i < count; i++) {
        particles.push({
            angle: rand() * Math.PI * 2,
            dist: randRange(AC_CELEBRATE_MIN_RADIUS_PX, AC_CELEBRATE_MAX_RADIUS_PX, rand),
            size: randRange(AC_CELEBRATE_SPARK_MIN_SIZE, AC_CELEBRATE_SPARK_MAX_SIZE, rand),
            dur: randRange(700, 1200, rand),
            delay: rand() * 120
        });
    }
    return particles;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        AC_CELEBRATE_SPARK_COUNT,
        AC_CELEBRATE_MIN_RADIUS_PX,
        AC_CELEBRATE_MAX_RADIUS_PX,
        AC_ACCEPTED_TOKENS,
        clamp,
        randRange,
        parseProblemKeyFromPath,
        celebrateDedupKey,
        shouldCelebrate,
        isAcceptedToken,
        pickBurstParticles
    };
}