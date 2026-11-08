/**
 * FocusForces - AC Celebration Utilities
 *
 * Pure logic for the "Accepted" celebration:
 *   • Parsing Codeforces problem identity from URL pathname.
 *   • Building robust deduplication keys (problem-scoped and submission-scoped).
 *   • Recognizing accepted-verdict tokens (English & Russian).
 *   • Triumphant, curated celebration copy generation.
 *   • Physics-based particle and confetti generation (ribbons, star motes, shockwaves).
 *   • Extracting runtime performance stats (time & memory).
 *
 * All functions are pure, deterministic (with injected `rand`), and unit-tested.
 */

// ── Config ───────────────────────────────────────────────
const AC_CELEBRATE_SPARK_COUNT = 9;
const AC_CELEBRATE_CONFETTI_COUNT = 36;
const AC_CELEBRATE_MIN_RADIUS_PX = 34;   // sparks travel 34-92px from center
const AC_CELEBRATE_MAX_RADIUS_PX = 92;
const AC_CELEBRATE_SPARK_MIN_SIZE = 3;
const AC_CELEBRATE_SPARK_MAX_SIZE = 7;

// Verdict tokens that count as Accepted (Codeforces EN / RU).
const AC_ACCEPTED_TOKENS = ['accepted', 'правильное решение', 'ok'];

// Celebratory headlines that feel rewarding, sophisticated, and exciting
const AC_CELEBRATE_HEADLINES = [
    'ACCEPTED!',
    'CLEAN SOLVE!',
    'ALL TESTS PASSED!',
    'FLAWLESS VICTORY!',
    'BEAUTIFULLY SOLVED!',
    '100% ACCURACY!',
    'SUBMISSION ACQUIRED!',
    'PEAK PERFORMANCE!',
    'PROBLEM CONQUERED!'
];

// Confetti palette options (Emerald & Gold celebration)
const AC_CONFETTI_COLORS = [
    '#10b981', // emerald
    '#34d399', // bright mint
    '#fbbf24', // golden amber
    '#f59e0b', // warm gold
    '#38bdf8', // sky cyan
    '#ffffff', // pure white shimmer
    '#a78bfa'  // lilac sparkle
];

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
 * Supports:
 *   • /contest|gym/<id>/problem/<index>
 *   • /problemset/problem/<id>/<index>
 *   • /group/<group>/contest/<id>/problem/<index>
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
 * Pick celebration copy tailored for the achievement.
 * @param {{ contestId?: string, index?: string } | null} problem
 * @param {() => number} [rand]
 * @returns {{ title: string, subtitle: string }}
 */
function pickCelebrationCopy(problem, rand) {
    const r = typeof rand === 'function' ? rand : Math.random;
    const title = AC_CELEBRATE_HEADLINES[Math.floor(r() * AC_CELEBRATE_HEADLINES.length)];
    let subtitle = 'Verdict: Accepted';
    if (problem && problem.index) {
        subtitle = `Problem ${problem.contestId || ''}${problem.index} · Solved in Style`;
    }
    return { title, subtitle };
}

/**
 * Calm burst geometry: N sparks distributed around a center with random
 * angle/distance/size/duration — deterministic given the injected rand.
 * @param {{ count?: number, rand?: () => number }} opts
 * @returns {Array<{ angle: number, dist: number, size: number, dur: number, delay: number }>}
 */
function pickBurstParticles(opts) {
    const rand = typeof opts?.rand === 'function' ? opts.rand : Math.random;
    const count = Math.max(1, Math.floor(opts?.count ?? AC_CELEBRATE_SPARK_COUNT));
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

/**
 * Rich festive confetti generation: colorful fluttering ribbons and star diamonds.
 * @param {{ count?: number, rand?: () => number }} [opts]
 * @returns {Array<{ x: number, y: number, vx: number, vy: number, width: number, height: number, color: string, rotX: number, rotY: number, rotZ: number, vRotX: number, vRotY: number, vRotZ: number, dur: number, delay: number, shape: string }>}
 */
function pickConfettiParticles(opts) {
    const rand = typeof opts?.rand === 'function' ? opts.rand : Math.random;
    const count = Math.max(1, Math.floor(opts?.count ?? AC_CELEBRATE_CONFETTI_COUNT));
    const confetti = [];

    for (let i = 0; i < count; i++) {
        const angle = rand() * Math.PI * 2;
        const speed = randRange(140, 420, rand);
        const color = AC_CONFETTI_COLORS[Math.floor(rand() * AC_CONFETTI_COLORS.length)];
        const shapeRoll = rand();
        const shape = shapeRoll < 0.6 ? 'ribbon' : shapeRoll < 0.85 ? 'star' : 'diamond';

        confetti.push({
            angle,
            dist: randRange(60, 240, rand),
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed * 0.7 - randRange(120, 280, rand), // upward explosion
            width: shape === 'ribbon' ? randRange(7, 13, rand) : randRange(6, 10, rand),
            height: shape === 'ribbon' ? randRange(12, 22, rand) : randRange(6, 10, rand),
            color,
            rotX: rand() * 360,
            rotY: rand() * 360,
            rotZ: rand() * 360,
            vRotX: randRange(180, 540, rand),
            vRotY: randRange(180, 720, rand),
            dur: randRange(1800, 2800, rand),
            delay: rand() * 150,
            shape
        });
    }
    return confetti;
}

/**
 * Extract time & memory stats from row text if available.
 * E.g. "124 ms" and "1800 KB"
 * @param {string} rowText
 * @returns {{ time: string|null, memory: string|null }}
 */
function parseSubmissionStats(rowText) {
    const text = String(rowText || '');
    const timeMatch = text.match(/(\d+\s*(?:ms|s))/i);
    const memMatch = text.match(/(\d+(?:\.\d+)?\s*(?:KB|MB|B))/i);
    return {
        time: timeMatch ? timeMatch[1].trim() : null,
        memory: memMatch ? memMatch[1].trim() : null
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        AC_CELEBRATE_SPARK_COUNT,
        AC_CELEBRATE_CONFETTI_COUNT,
        AC_CELEBRATE_MIN_RADIUS_PX,
        AC_CELEBRATE_MAX_RADIUS_PX,
        AC_ACCEPTED_TOKENS,
        AC_CELEBRATE_HEADLINES,
        AC_CONFETTI_COLORS,
        clamp,
        randRange,
        parseProblemKeyFromPath,
        celebrateDedupKey,
        shouldCelebrate,
        isAcceptedToken,
        pickCelebrationCopy,
        pickBurstParticles,
        pickConfettiParticles,
        parseSubmissionStats
    };
}
