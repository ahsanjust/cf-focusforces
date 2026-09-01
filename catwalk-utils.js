/**
 * FocusForces - Zen Paws Utilities
 *
 * Pure logic for the "Zen Paws" overlay: cat spawning, walking, pause/sit
 * scheduling, meeting detection & resolution, paw-print pacing, and
 * theme-aware coat palettes. Every function here is a pure function of its
 * inputs (randomness is injected via `rand`), so the animation loop in
 * catwalk.js is a thin, testable driver and the Jest suite can pin the exact
 * runtime behavior.
 *
 * A cat's state shape:
 * {
 *   index,       // 0-based, stable identity
 *   x,           // horizontal center in CSS px
 *   y,           // vertical top in CSS px (feet rest near the viewport bottom)
 *   dir,         // +1 walking right, -1 walking left
 *   speed,       // walking speed in px/second
 *   size,        // rendered height in px
 *   palette,     // { body, dark, accent } coat colors
 *   walkCycle,   // seconds per leg cycle (tied to speed so steps match pace)
 *   phase,       // 0..1 initial leg phase offset (cats don't march in lockstep)
 *   pauseUntil,  // timestamp; 0 = walking
 *   nextPauseAt, // timestamp when the cat may next sit & rest
 *   meeting,     // null | { until, resumeDir, bubble, bubbleUntil }
 *   hold,        // true while the cat is watching the cursor (driver sets it)
 *   lastPawAt,   // timestamp of the last paw print
 *   pawEvery,    // ms between paw prints
 *   cooldowns    // {} pairKey -> timestamp when that pair may meet again
 * }
 */

// ── Density & sizing ─────────────────────────────────────
const ZEN_PAWS_MIN_CATS = 2;
const ZEN_PAWS_MAX_CATS = 5;
const ZEN_PAWS_WIDTH_PER_CAT = 520;   // ~1 cat per 520px of viewport width
const ZEN_PAWS_SIZE_RATIO = 0.075;    // cat height ≈ 7.5% of viewport height
const ZEN_PAWS_MIN_SIZE = 34;
const ZEN_PAWS_MAX_SIZE = 84;

// ── Movement ─────────────────────────────────────────────
const ZEN_PAWS_MIN_SPEED = 22;        // px/s — calm, believable pace
const ZEN_PAWS_MAX_SPEED = 46;

// ── Pause (sit & rest) scheduling ────────────────────────
const ZEN_PAWS_PAUSE_EVERY_MS = [6000, 14000];
const ZEN_PAWS_PAUSE_DURATION_MS = [1800, 4200];
const ZEN_PAWS_PAUSE_CHANCE = 0.6;    // odds a scheduled pause actually happens

// ── Meetings ─────────────────────────────────────────────
const ZEN_PAWS_MEET_DISTANCE_PX = 120;   // how close before a greeting is possible
const ZEN_PAWS_MEET_DURATION_MS = 2600;  // how long they face each other
const ZEN_PAWS_MEET_COOLDOWN_MS = 18000; // per-pair cooldown (no instant re-greet)
const ZEN_PAWS_MEET_CHANCE = 0.85;       // odds a close, closing pair actually greets

// ── Paw prints ───────────────────────────────────────────
const ZEN_PAWS_PAWN_PRINT_EVERY_MS = 650;

// ── Coat palettes ────────────────────────────────────────
// Picked by cat index (deterministic for tests). `dark` themes shift the
// selection by one so lighter-coated cats are more visible on dark pages.
const ZEN_PAWS_PALETTES = [
    { body: '#f2a65a', dark: '#d97f3f', accent: '#ffd9b0' }, // ginger
    { body: '#b9b9c7', dark: '#8f8f9e', accent: '#ececf6' }, // gray
    { body: '#45454f', dark: '#2b2b33', accent: '#767685' }, // midnight
    { body: '#f2ede4', dark: '#d6cdbe', accent: '#fffdf8' }, // cream
    { body: '#8d6e63', dark: '#6b4f45', accent: '#c9a79c' }  // brown
];

const DARK_THEMES = ['dark', 'amoled'];

// ── Small helpers ────────────────────────────────────────
function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
}

function randRange(min, max, rand) {
    const r = typeof rand === 'function' ? rand() : Math.random();
    return min + r * (max - min);
}

function pairKey(i, j) {
    return `${Math.min(i, j)}:${Math.max(i, j)}`;
}

// ── Public API ───────────────────────────────────────────

/**
 * How many cats should roam this viewport? Scales with width, always at
 * least 2 (meetings need a friend) and never more than 5.
 * @param {number} viewportWidth  CSS px
 * @param {number} viewportHeight CSS px (used for the guard only)
 * @returns {number}
 */
function computeCatCount(viewportWidth, viewportHeight) {
    const w = Number(viewportWidth) || 0;
    const h = Number(viewportHeight) || 0;
    if (w <= 0 || h <= 0) return ZEN_PAWS_MIN_CATS;
    const byWidth = 1 + Math.floor(w / ZEN_PAWS_WIDTH_PER_CAT);
    const byHeight = h > 0 && h < 500 ? 0 : 0; // cats roam the bottom line only
    void byHeight;
    return clamp(byWidth, ZEN_PAWS_MIN_CATS, ZEN_PAWS_MAX_CATS);
}

/**
 * Cat height in px for a given viewport height.
 * @param {number} viewportHeight
 * @returns {number}
 */
function computeCatSize(viewportHeight) {
    const h = Number(viewportHeight) || 0;
    return clamp(Math.round(h * ZEN_PAWS_SIZE_RATIO), ZEN_PAWS_MIN_SIZE, ZEN_PAWS_MAX_SIZE);
}

/**
 * Pick a coat palette by index. Dark themes shift one slot so lighter coats
 * appear more often (deterministic — no randomness here).
 * @param {number} index
 * @param {string} theme 'default' | 'dark' | 'amoled' | 'contrast'
 * @returns {{ body: string, dark: string, accent: string }}
 */
function pickPalette(index, theme) {
    const offset = DARK_THEMES.includes(theme) ? 1 : 0;
    const list = ZEN_PAWS_PALETTES;
    return list[(index + offset) % list.length];
}

/**
 * Create a full cast of cats, spread evenly (with jitter) along the bottom
 * of the viewport. Directions alternate so natural meetings occur.
 * @param {{ count: number, viewportWidth: number, viewportHeight: number,
 *           theme?: string, now?: number, rand?: () => number }} opts
 * @returns {object[]}
 */
function createCats(opts) {
    const count = Math.max(1, Math.floor(opts.count));
    const viewportWidth = Number(opts.viewportWidth) || 0;
    const viewportHeight = Number(opts.viewportHeight) || 0;
    const theme = opts.theme || 'default';
    const rand = typeof opts.rand === 'function' ? opts.rand : Math.random;
    const now = Number.isFinite(opts.now) ? opts.now : Date.now();

    const cats = [];
    for (let i = 0; i < count; i++) {
        const size = computeCatSize(viewportHeight);
        const margin = Math.min(size * 1.4, viewportWidth * 0.12);
        const spread = count === 1 ? 0.5 : i / (count - 1);
        const jitter = (rand() - 0.5) * Math.min(140, viewportWidth * 0.07);
        const speed = randRange(ZEN_PAWS_MIN_SPEED, ZEN_PAWS_MAX_SPEED, rand);

        cats.push({
            index: i,
            x: clamp(margin + spread * Math.max(0, viewportWidth - 2 * margin) + jitter,
                margin, Math.max(margin, viewportWidth - margin)),
            y: Math.max(0, viewportHeight - size * 0.93 - 8),
            dir: i % 2 === 0 ? 1 : -1,
            speed,
            size,
            palette: pickPalette(i, theme),
            walkCycle: clamp(1.25 - speed / 60, 0.45, 0.95),
            phase: rand(),
            pauseUntil: 0,
            nextPauseAt: now + randRange(ZEN_PAWS_PAUSE_EVERY_MS[0], ZEN_PAWS_PAUSE_EVERY_MS[1], rand),
            meeting: null,
            hold: false,
            lastPawAt: now - randRange(0, 1500, rand),
            pawEvery: ZEN_PAWS_PAWN_PRINT_EVERY_MS * (0.85 + 0.3 * rand()),
            cooldowns: {}
        });
    }
    return cats;
}

/**
 * Advance one cat by dtMs. Handles: meeting freeze & resume, pause/sit
 * freeze & start, wall turning. Returns events so the driver can react
 * (though most visuals derive from state each frame).
 *
 * @param {object} cat
 * @param {number} dtMs  elapsed time this frame (ms)
 * @param {{ now: number, viewportWidth: number, rand?: () => number }} ctx
 * @returns {{ cat: object, events: string[] }}
 */
function stepCat(cat, dtMs, ctx) {
    const now = ctx.now;
    const rand = typeof ctx.rand === 'function' ? ctx.rand : Math.random;
    const events = [];

    // Meeting: frozen until `until`, then resume the original heading.
    if (cat.meeting) {
        if (cat.meeting.until > now) return { cat, events };
        cat.dir = cat.meeting.resumeDir;
        cat.meeting = null;
        events.push('MEET_END');
    }

    // Hold (watching the cursor) or resting: no movement, no new pauses.
    if (cat.hold || cat.pauseUntil > now) return { cat, events };

    // Walking — maybe decide to sit & rest.
    if (now >= cat.nextPauseAt && rand() < ZEN_PAWS_PAUSE_CHANCE) {
        cat.pauseUntil = now + randRange(ZEN_PAWS_PAUSE_DURATION_MS[0], ZEN_PAWS_PAUSE_DURATION_MS[1], rand);
        cat.nextPauseAt = now + randRange(ZEN_PAWS_PAUSE_EVERY_MS[0], ZEN_PAWS_PAUSE_EVERY_MS[1], rand);
        events.push('PAUSE_START');
        return { cat, events };
    }

    const margin = cat.size * 0.9;
    cat.x += cat.dir * cat.speed * (dtMs / 1000);
    if (cat.x >= ctx.viewportWidth - margin) {
        cat.x = ctx.viewportWidth - margin;
        cat.dir = -1;
        events.push('TURN');
    } else if (cat.x <= margin) {
        cat.x = margin;
        cat.dir = 1;
        events.push('TURN');
    }

    return { cat, events };
}

/**
 * Effective walking speed right now (0 while resting, meeting, or held).
 * @param {object} cat
 * @param {number} now
 * @returns {number}
 */
function effSpeed(cat, now) {
    if (cat.meeting && cat.meeting.until > now) return 0;
    if (cat.hold || cat.pauseUntil > now) return 0;
    return cat.speed;
}

function isBusy(cat, now) {
    return !!(cat.meeting && cat.meeting.until > now);
}

/**
 * Find a pair of cats that are close enough and closing in on each other
 * (the meeting pre-condition), respecting per-pair cooldowns. Returns the
 * closest qualifying pair or null.
 * @param {object[]} cats
 * @param {{ now: number, rand?: () => number }} ctx
 * @returns {{ a: number, b: number } | null}
 */
function findMeeting(cats, ctx) {
    const now = ctx.now;
    const rand = typeof ctx.rand === 'function' ? ctx.rand : Math.random;
    let best = null;
    let bestGap = Infinity;

    for (let i = 0; i < cats.length; i++) {
        const a = cats[i];
        if (isBusy(a, now)) continue;
        for (let j = i + 1; j < cats.length; j++) {
            const b = cats[j];
            if (isBusy(b, now)) continue;
            const key = pairKey(i, j);
            if ((a.cooldowns[key] || 0) > now) continue;

            const left = a.x <= b.x ? a : b;
            const right = left === a ? b : a;
            const gap = right.x - left.x;
            if (gap > ZEN_PAWS_MEET_DISTANCE_PX) continue;

            // Closing = the gap shrinks over time (handles a stationary cat
            // being approached, or a faster cat catching up).
            const closing = (left.dir * effSpeed(left, now)) - (right.dir * effSpeed(right, now)) > 0.5;
            if (!closing) continue;

            if (gap < bestGap) {
                bestGap = gap;
                best = { a: i, b: j };
            }
        }
    }

    if (best && rand() < ZEN_PAWS_MEET_CHANCE) return best;
    return null;
}

/**
 * Begin a greeting between two cats: they freeze, face each other, get a
 * bubble ('meow' or 'heart' — deterministic by index sum), and remember
 * their original headings so they can pass each other afterwards.
 * @param {object[]} cats
 * @param {{ a: number, b: number }} pair
 * @param {{ now: number }} ctx
 */
function applyMeeting(cats, pair, ctx) {
    const now = ctx.now;
    const a = cats[pair.a];
    const b = cats[pair.b];

    const resumeA = a.dir;
    const resumeB = b.dir;

    if (a.x <= b.x) { a.dir = 1; b.dir = -1; }
    else { a.dir = -1; b.dir = 1; }

    const key = pairKey(pair.a, pair.b);
    const until = now + ZEN_PAWS_MEET_DURATION_MS;
    const bubble = (pair.a + pair.b) % 2 === 0 ? 'meow' : 'heart';

    a.meeting = { until, resumeDir: resumeA, bubble, bubbleUntil: until - 600 };
    b.meeting = { until, resumeDir: resumeB, bubble, bubbleUntil: until - 600 };
    a.cooldowns[key] = now + ZEN_PAWS_MEET_COOLDOWN_MS;
    b.cooldowns[key] = now + ZEN_PAWS_MEET_COOLDOWN_MS;
}

/**
 * Should this cat drop a paw print right now? True once per `pawEvery` ms
 * while actually walking (not resting/meeting/held). Mutates lastPawAt so
 * the driver can call this every frame without extra bookkeeping.
 * @param {object} cat
 * @param {number} now
 * @returns {boolean}
 */
function shouldDropPawPrint(cat, now) {
    if (cat.hold || cat.pauseUntil > now) return false;
    if (cat.meeting && cat.meeting.until > now) return false;
    if (now - cat.lastPawAt < cat.pawEvery) return false;
    cat.lastPawAt = now;
    return true;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        ZEN_PAWS_MIN_CATS,
        ZEN_PAWS_MAX_CATS,
        ZEN_PAWS_MIN_SPEED,
        ZEN_PAWS_MAX_SPEED,
        ZEN_PAWS_MEET_DISTANCE_PX,
        ZEN_PAWS_MEET_DURATION_MS,
        ZEN_PAWS_MEET_COOLDOWN_MS,
        ZEN_PAWS_PALETTES,
        clamp,
        randRange,
        pairKey,
        computeCatCount,
        computeCatSize,
        pickPalette,
        createCats,
        stepCat,
        effSpeed,
        isBusy,
        findMeeting,
        applyMeeting,
        shouldDropPawPrint
    };
}