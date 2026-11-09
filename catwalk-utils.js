/**
 * FocusForces - Zen Paws Utilities
 *
 * Pure logic for the "Zen Paws" companion experience:
 *   • Cat spawning, walking, trotting, turning, and boundary safety.
 *   • Personality engine: Explorer, Playful, Loaf, and Sweet.
 *   • Behavioral state machine: Walk, Sit-Loaf, Stretch, Groom, Petting Bliss,
 *     Toy Stalk & Playful Pounce, and Friendly Greeting Meetings.
 *   • Interactive toy physics (yarn ball / toy drop & bounce).
 *   • Theme-aware coats, breed metadata, expressive eye colors, and paw prints.
 *
 * All functions are pure and deterministic (injecting `rand` when needed)
 * so the DOM driver in catwalk.js stays clean, lightweight, and fully testable.
 */

// ── Density & sizing ─────────────────────────────────────
const ZEN_PAWS_MIN_CATS = 2;
const ZEN_PAWS_MAX_CATS = 5;
const ZEN_PAWS_WIDTH_PER_CAT = 520;   // ~1 cat per 520px of viewport width
const ZEN_PAWS_SIZE_RATIO = 0.046;    // smaller, charming desktop-pet scale
const ZEN_PAWS_MIN_SIZE = 34;
const ZEN_PAWS_MAX_SIZE = 54;

// ── Movement & paces ─────────────────────────────────────
const ZEN_PAWS_MIN_SPEED = 22;        // px/s — calm, believable pace
const ZEN_PAWS_MAX_SPEED = 46;
const ZEN_PAWS_POUNCE_SPEED = 95;     // px/s — quick playful pounce

// ── Pause (sit & rest) scheduling ────────────────────────
const ZEN_PAWS_PAUSE_EVERY_MS = [6000, 14000];
const ZEN_PAWS_PAUSE_DURATION_MS = [1800, 4200];
const ZEN_PAWS_PAUSE_CHANCE = 0.6;    // odds a scheduled pause actually happens

// ── Stretch & Grooming scheduling ────────────────────────
const ZEN_PAWS_STRETCH_DURATION_MS = 2200;
const ZEN_PAWS_GROOM_DURATION_MS = 2800;
const ZEN_PAWS_NAP_DURATION_MS = 6000;

// ── Meetings & CP Dialogues ──────────────────────────────
const ZEN_PAWS_MEET_DISTANCE_PX = 120;   // how close before a greeting is possible
const ZEN_PAWS_MEET_DURATION_MS = 3200;  // multi-turn dialogue duration
const ZEN_PAWS_MEET_COOLDOWN_MS = 14000; // per-pair cooldown
const ZEN_PAWS_MEET_CHANCE = 0.85;       // odds a close, closing pair actually greets

// ── Competitive Programming (CP) Dialogues between cats ──
const CP_DIALOGUES = [
    {
        a: "Did you use 1-based indexing? :D",
        b: "1-based... and TLE on test 42 😭 XD"
    },
    {
        a: "Segment tree beats everything! XD",
        b: "Fenwick tree is only 5 lines though~ :D"
    },
    {
        a: "Just binary search the answer! :D",
        b: "The function isn't even monotonic bro 💀"
    },
    {
        a: "Did you #define int long long? XD",
        b: "Always! WA on test 17 is pure trauma :D"
    },
    {
        a: "Tourist solved problem E in 3 mins...",
        b: "I'm still reading problem A XD 💀"
    },
    {
        a: "Greedy approach will totally pass! :D",
        b: "Narrator: It was 3D Dynamic Programming XD"
    },
    {
        a: "Proof by AC? :D",
        b: "The only rigorous math proof cats need! XD"
    },
    {
        a: "Modulo 10^9+7 or 998244353? :D",
        b: "998244353, the sacred NTT prime! ⚡ XD"
    },
    {
        a: "Why WA on test 2?! 😭",
        b: "Check N=1 and empty array corner cases :D"
    },
    {
        a: "Pretests passed! Submit & pray! :D",
        b: "System tests are lurking in the dark... 😈 XD"
    },
    {
        a: "Time limit 1.0s, N = 2·10^5...",
        b: "Fast I/O: cin.tie(NULL) goes brrrr! ⚡ :D"
    },
    {
        a: "Is `unordered_map` safe here? :D",
        b: "Codeforces anti-hash tests say NO 💀 XD"
    },
    {
        a: "Two pointers technique? :D",
        b: "Four paws technique! 🐾 XD"
    },
    {
        a: "DP state: dp[i][j] = happiness! :D",
        b: "Space complexity: O(1), max purrs! ✨"
    },
    {
        a: "Rating change: +85 today! :D",
        b: "Pupil to Specialist promotion! Fish time! 🐟 XD"
    },
    {
        a: "Rating change: -45 yesterday...",
        b: "We don't talk about yesterday's contest 😿 XD"
    },
    {
        a: "Meet me at the Lowest Common Ancestor! :D",
        b: "Binary lifting all the way up! 🌲 XD"
    },
    {
        a: "Graph was bipartite all along! :D",
        b: "Color me 2-colorable (black & white) 🐾 XD"
    },
    {
        a: "Can we coordinate compress this? :D",
        b: "My brain is already coordinate compressed XD"
    },
    {
        a: "Stack overflow on tree recursion!",
        b: "#pragma comment(linker) saves 9 lives! 🐱 XD"
    },
    {
        a: "Bitwise XOR sum = 0! :D",
        b: "Nim game won! Second player cleans paws! 🧶"
    },
    {
        a: "I found an O(1) math formula! :D",
        b: "Proof? Trust me bro XD"
    },
    {
        a: "Queue is empty, front() called...",
        b: "Undefined behavior has entered the chat 💀 XD"
    },
    {
        a: "Can we greedy this knapsack? :D",
        b: "Only if you want 0 points! XD"
    },
    {
        a: "Disjoint Set Union with path compression?",
        b: "Ackermann function is basically O(1) :D ✨"
    },
    {
        a: "Matrix exponentiation for N = 10^18! :D",
        b: "Fibonacci in O(log N), beautiful! ⚡ XD"
    },
    {
        a: "Trie data structure or Aho-Corasick? :D",
        b: "Aho-Corasick for multiple string matching! 🧶"
    },
    {
        a: "Did you clear the adjacency list? :D",
        b: "Multi-testcase memory leak avoided! Phew! XD"
    },
    {
        a: "Off-by-one error on [L, R]! 😭",
        b: "Fencepost problem claims another victim XD"
    },
    {
        a: "Is this contest rated for Div.1? :D",
        b: "I'm just a Div.4 kitten solving A & B XD (=^･ω･^=)"
    }
];

// Solo CP thoughts when strolling alone or catnapping
const CP_SOLO_THOUGHTS = [
    "thinking: dp[i] = max happiness :D",
    "what if N=1 corner case? 🤔",
    "cin.tie(NULL) goes brrr ⚡",
    "proof by AC :D ✨",
    "rating +75 today!! 🐟",
    "binary search everything XD",
    "my code is O(1) in my dreams 💭",
    "O(N log N) is basically free :D",
    "purr... Accepted on pretest 4! 🏆",
    "napping until contest starts 💤",
    "catnap complexity: O(0) :D",
    "remember to check 64-bit int! ⚠️",
    "four paws coordinate compression 🐾",
    "segment tree lazy propagation ⚡",
    "fish >> cin; fish >> cout; 🐟 XD"
];

function pickCpDialogue(idxA, idxB, seed = 0) {
    const idx = Math.abs(Math.floor(seed + idxA * 7 + idxB * 13)) % CP_DIALOGUES.length;
    return CP_DIALOGUES[idx];
}

// ── Petting & Joy ────────────────────────────────────────
const ZEN_PAWS_PET_DURATION_MS = 2400;   // purr duration after being petted
const ZEN_PAWS_PURR_BUBBLES = ['purr~ :D ♥', 'prrr ♥', 'meow~ ^.^', 'mew! :D', '♥ ♥'];

// ── Paw prints ───────────────────────────────────────────
const ZEN_PAWS_PAWN_PRINT_EVERY_MS = 650;

// ── Personalities ────────────────────────────────────────
const ZEN_PAWS_PERSONALITIES = ['explorer', 'playful', 'loaf', 'sweet'];

// ── Breeds & Coat Palettes ───────────────────────────────
// Distinct feline coat patterns with expressive eye colors and names.
const ZEN_PAWS_PALETTES = [
    {
        id: 'ginger',
        name: 'Orange Tabby :D',
        body: '#f59e0b',
        dark: '#d97706',
        accent: '#fef3c7',
        eye: '#10b981', // emerald green eyes
        snout: '#e08a8a',
        outline: '#b45309',
        pattern: 'tabby'
    },
    {
        id: 'calico',
        name: 'Mochi White :D',
        body: '#fffdf5',
        dark: '#334155',
        accent: '#f97316',
        eye: '#38bdf8', // sparkling sapphire eyes
        snout: '#f43f5e',
        outline: '#94a3b8', // crisp soft outline so white cat is crisp on white pages!
        pattern: 'calico'
    },
    {
        id: 'tuxedo',
        name: 'Tuxedo Classic',
        body: '#1f2937',
        dark: '#0f172a',
        accent: '#ffffff',
        eye: '#34d399', // bright mint eyes
        snout: '#f472b6',
        outline: '#020617',
        pattern: 'tuxedo'
    },
    {
        id: 'siamese',
        name: 'Siamese Point',
        body: '#f5ebe0',
        dark: '#4a3728',
        accent: '#d5bdaf',
        eye: '#0284c7', // sapphire blue eyes
        snout: '#854d0e',
        outline: '#78350f',
        pattern: 'siamese'
    },
    {
        id: 'slate',
        name: 'Blue Shorthair',
        body: '#64748b',
        dark: '#334155',
        accent: '#cbd5e1',
        eye: '#f59e0b', // golden amber eyes
        snout: '#e08a8a',
        outline: '#1e293b',
        pattern: 'solid'
    }
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
    const byHeight = h > 0 && h < 500 ? 0 : 0;
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
 * @returns {{ id: string, name: string, body: string, dark: string, accent: string, eye: string, snout: string, pattern: string }}
 */
function pickPalette(index, theme) {
    const offset = DARK_THEMES.includes(theme) ? 1 : 0;
    const list = ZEN_PAWS_PALETTES;
    return list[(index + offset) % list.length];
}

/**
 * Pick a personality for a cat. Deterministic by index, with natural variety.
 * @param {number} index
 * @returns {string} 'explorer' | 'playful' | 'loaf' | 'sweet'
 */
function pickPersonality(index) {
    return ZEN_PAWS_PERSONALITIES[index % ZEN_PAWS_PERSONALITIES.length];
}

/**
 * Create a full cast of cats, spread evenly (with jitter) along the bottom
 * of the viewport. Directions alternate so natural meetings occur.
 * @param {{ count: number, viewportWidth: number, viewportHeight: number,
 *           theme?: string, now?: number, rand?: () => number, sizeMultiplier?: number }} opts
 * @returns {object[]}
 */
function createCats(opts) {
    const count = Math.max(1, Math.floor(opts.count));
    const viewportWidth = Number(opts.viewportWidth) || 0;
    const viewportHeight = Number(opts.viewportHeight) || 0;
    const theme = opts.theme || 'default';
    const rand = typeof opts.rand === 'function' ? opts.rand : Math.random;
    const now = Number.isFinite(opts.now) ? opts.now : Date.now();
    const sizeMultiplier = typeof opts.sizeMultiplier === 'number' ? opts.sizeMultiplier : 1;

    const cats = [];
    for (let i = 0; i < count; i++) {
        const baseSize = computeCatSize(viewportHeight);
        const size = Math.round(baseSize * sizeMultiplier);
        const margin = Math.min(size * 1.4, viewportWidth * 0.12);
        const spread = count === 1 ? 0.5 : i / (count - 1);
        const jitter = (rand() - 0.5) * Math.min(140, viewportWidth * 0.07);
        const personality = pickPersonality(i);

        // Explorer & Playful walk slightly faster; Loaf is calmer
        const speedMultiplier = personality === 'playful' ? 1.15 : personality === 'loaf' ? 0.88 : 1.0;
        const speed = randRange(ZEN_PAWS_MIN_SPEED, ZEN_PAWS_MAX_SPEED, rand) * speedMultiplier;

        const baseY = Math.max(0, viewportHeight - size * 0.93 - 8);
        const y = baseY;
        cats.push({
            index: i,
            personality,
            x: clamp(margin + spread * Math.max(0, viewportWidth - 2 * margin) + jitter,
                margin, Math.max(margin, viewportWidth - margin)),
            y,
            baseY,
            targetY: baseY,
            nextWanderYAt: now + randRange(4000, 10000, rand),
            nextThoughtAt: now + randRange(12000, 24000, rand),
            thought: null,
            thoughtUntil: 0,
            dir: i % 2 === 0 ? 1 : -1,
            speed,
            size,
            palette: pickPalette(i, theme),
            walkCycle: clamp(1.25 - speed / 60, 0.45, 0.95),
            phase: rand(),
            // State machine
            action: 'walk',           // 'walk' | 'loaf' | 'stretch' | 'groom' | 'petted' | 'toy_stalk' | 'toy_pounce'
            actionUntil: 0,
            pauseUntil: 0,            // backward-compatible with original pause tests
            nextPauseAt: now + randRange(ZEN_PAWS_PAUSE_EVERY_MS[0], ZEN_PAWS_PAUSE_EVERY_MS[1], rand),
            meeting: null,
            hold: false,
            pettedUntil: 0,
            hopUntil: 0,
            toyTarget: null,
            lastPawAt: now - randRange(0, 1500, rand),
            pawEvery: ZEN_PAWS_PAWN_PRINT_EVERY_MS * (0.85 + 0.3 * rand()),
            cooldowns: {}
        });
    }
    return cats;
}

/**
 * Advance one cat by dtMs. Handles:
 *  - Petted state (purr, blissful eyes)
 *  - Meeting greetings
 *  - Specialized actions (stretch, grooming, loaf nap)
 *  - Standard pause / sit rest
 *  - Toy stalking and pouncing
 *  - Wall collision turning
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

    // 1. Petted state: cat freezes, purrs, blissfully arches back
    if (cat.pettedUntil > now) {
        cat.action = 'petted';
        return { cat, events };
    }

    // 2. Meeting: frozen until `until`, then resume the original heading.
    if (cat.meeting) {
        if (cat.meeting.until > now) {
            cat.action = 'meeting';
            return { cat, events };
        }
        cat.dir = cat.meeting.resumeDir;
        cat.meeting = null;
        cat.action = 'walk';
        events.push('MEET_END');
    }

    // 3. Special actions (stretch, groom, loaf nap)
    if (cat.actionUntil > now) {
        return { cat, events };
    } else if (cat.action !== 'walk' && !cat.pauseUntil) {
        cat.action = 'walk';
    }

    // 4. Hold (cursor watching) or backward-compatible pauseUntil
    if (cat.hold || cat.pauseUntil > now) {
        cat.action = cat.pauseUntil > now ? 'loaf' : 'walk';
        return { cat, events };
    }

    // 5. Walking — check if scheduled to pause or do an expressive action
    if (now >= cat.nextPauseAt && rand() < ZEN_PAWS_PAUSE_CHANCE) {
        const pauseDur = randRange(ZEN_PAWS_PAUSE_DURATION_MS[0], ZEN_PAWS_PAUSE_DURATION_MS[1], rand);
        cat.pauseUntil = now + pauseDur;
        cat.nextPauseAt = now + randRange(ZEN_PAWS_PAUSE_EVERY_MS[0], ZEN_PAWS_PAUSE_EVERY_MS[1], rand);
        events.push('PAUSE_START');

        // Decide behavior based on personality
        const roll = rand();
        if (cat.personality === 'loaf' && roll < 0.45) {
            // Cozy Loaf: deep loaf nap with zZz
            cat.action = 'loaf';
            cat.actionUntil = now + Math.max(pauseDur, ZEN_PAWS_NAP_DURATION_MS * 0.7);
            events.push('NAP_START');
        } else if (roll < 0.35) {
            // Downward cat yoga stretch!
            cat.action = 'stretch';
            cat.actionUntil = now + ZEN_PAWS_STRETCH_DURATION_MS;
            events.push('STRETCH_START');
        } else if (roll < 0.65) {
            // Grooming face & whiskers
            cat.action = 'groom';
            cat.actionUntil = now + ZEN_PAWS_GROOM_DURATION_MS;
            events.push('GROOM_START');
        } else {
            cat.action = 'loaf';
        }
        return { cat, events };
    }

    // 6. Normal walking step
    cat.action = 'walk';
    const margin = cat.size * 0.9;
    cat.x += cat.dir * cat.speed * (dtMs / 1000);

    // 2D Roaming across page heights
    if (typeof cat.y === 'number' && ctx.viewportHeight) {
        if (!cat.baseY) cat.baseY = Math.max(0, ctx.viewportHeight - cat.size * 0.93 - 8);
        if (now >= (cat.nextWanderYAt || 0)) {
            // Pick new altitude target: either floor (45%) or higher up on the page (55%)
            const exploreHigher = rand() < 0.55;
            cat.targetY = exploreHigher
                ? randRange(Math.max(60, ctx.viewportHeight * 0.28), cat.baseY, rand)
                : cat.baseY;
            cat.nextWanderYAt = now + randRange(7000, 18000, rand);
        }

        const dy = (cat.targetY || cat.baseY) - cat.y;
        if (Math.abs(dy) > 1) {
            const stepY = Math.sign(dy) * Math.min(Math.abs(dy), (cat.speed * 0.36) * (dtMs / 1000));
            cat.y += stepY;
        }
        cat.y = clamp(cat.y, 40, cat.baseY);
    }

    // Solo thought check
    if (now >= (cat.nextThoughtAt || 0) && !cat.meeting && cat.action !== 'petted') {
        cat.thought = CP_SOLO_THOUGHTS[Math.floor(rand() * CP_SOLO_THOUGHTS.length)];
        cat.thoughtUntil = now + 2400;
        cat.nextThoughtAt = now + randRange(15000, 30000, rand);
        events.push('SOLO_THOUGHT');
    }

    // Wall collision handling
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
 * Effective walking speed right now (0 while resting, meeting, held, stretching, grooming, or petted).
 * @param {object} cat
 * @param {number} now
 * @returns {number}
 */
function effSpeed(cat, now) {
    if (cat.meeting && cat.meeting.until > now) return 0;
    if (cat.hold || cat.pauseUntil > now) return 0;
    if (cat.pettedUntil > now || cat.actionUntil > now) return 0;
    return cat.speed;
}

/**
 * Is this cat currently engaged in an activity that prevents new meetings or interactions?
 * @param {object} cat
 * @param {number} now
 * @returns {boolean}
 */
function isBusy(cat, now) {
    if (cat.meeting && cat.meeting.until > now) return true;
    if (cat.pettedUntil > now) return true;
    if (cat.actionUntil > now) return true;
    return false;
}

/**
 * Pet a cat! Triggered by clicking or hovering over it.
 * The cat purrs, squints eyes in contentment, and shows a heart bubble.
 * @param {object} cat
 * @param {number} now
 * @param {() => number} [rand]
 * @returns {{ bubble: string, duration: number }}
 */
function startPet(cat, now, rand) {
    const r = typeof rand === 'function' ? rand : Math.random;
    const dur = ZEN_PAWS_PET_DURATION_MS;
    cat.pettedUntil = now + dur;
    cat.action = 'petted';
    cat.hopUntil = now + 650;
    const bubble = ZEN_PAWS_PURR_BUBBLES[Math.floor(r() * ZEN_PAWS_PURR_BUBBLES.length)];
    return { bubble, duration: dur };
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

            // In 2D, check vertical proximity if Y is defined
            if (typeof a.y === 'number' && typeof b.y === 'number') {
                const dy = Math.abs(a.y - b.y);
                if (dy > 80) continue;
            }

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

    // Align vertical height smoothly if roaming in 2D
    if (typeof a.y === 'number' && typeof b.y === 'number') {
        const avgY = (a.y + b.y) / 2;
        a.y = avgY;
        b.y = avgY;
        if (a.targetY) a.targetY = avgY;
        if (b.targetY) b.targetY = avgY;
    }

    const key = pairKey(pair.a, pair.b);
    const until = now + ZEN_PAWS_MEET_DURATION_MS;

    const dialogue = pickCpDialogue(pair.a, pair.b, (pair.a + pair.b) * 3);

    a.meeting = {
        until,
        resumeDir: resumeA,
        dialogue,
        speaker: 'a',
        startedAt: now,
        bubble: dialogue.a,
        bubbleUntil: now + 1500
    };
    b.meeting = {
        until,
        resumeDir: resumeB,
        dialogue,
        speaker: 'b',
        startedAt: now,
        bubble: dialogue.b,
        bubbleStartsAt: now + 1500,
        bubbleUntil: until - 100
    };
    a.cooldowns[key] = now + ZEN_PAWS_MEET_COOLDOWN_MS;
    b.cooldowns[key] = now + ZEN_PAWS_MEET_COOLDOWN_MS;
}

/**
 * Should this cat drop a paw print right now? True once per `pawEvery` ms
 * while actually walking (not resting/meeting/held/petted/stretching).
 * @param {object} cat
 * @param {number} now
 * @returns {boolean}
 */
function shouldDropPawPrint(cat, now) {
    if (cat.hold || cat.pauseUntil > now) return false;
    if (cat.meeting && cat.meeting.until > now) return false;
    if (cat.pettedUntil > now || cat.actionUntil > now) return false;
    if (now - cat.lastPawAt < cat.pawEvery) return false;
    cat.lastPawAt = now;
    return true;
}

// ── Interactive Toy Physics (Playful Mode) ───────────────

/**
 * Create a bouncing toy (e.g. yarn ball 🧶) dropped by clicking on the playground.
 * @param {{ x: number, y: number, now: number, type?: string }} opts
 * @returns {object}
 */
function spawnToy(opts) {
    return {
        id: `toy_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        type: opts.type || 'yarn',
        x: opts.x,
        y: opts.y,
        vx: (Math.random() - 0.5) * 80,
        vy: -120, // initial upward bounce
        rotation: 0,
        vRot: (Math.random() - 0.5) * 360,
        bounces: 0,
        grounded: false,
        swattedAt: 0,
        createdAt: opts.now || Date.now(),
        expiresAt: (opts.now || Date.now()) + 12000 // stays for up to 12s
    };
}

/**
 * Step toy physics (gravity, ground bounce, roll friction, wall bounce).
 * @param {object} toy
 * @param {number} dtMs
 * @param {number} groundY
 * @param {number} viewportWidth
 * @returns {boolean} true if toy is still alive
 */
function stepToy(toy, dtMs, groundY, viewportWidth, now) {
    const currentNow = typeof now === 'number' ? now : Date.now();
    const dt = dtMs / 1000;
    const gravity = 480; // px/s^2

    toy.vy += gravity * dt;
    toy.x += toy.vx * dt;
    toy.y += toy.vy * dt;
    toy.rotation += toy.vRot * dt;

    const floor = groundY + 12; // floor level for toy
    if (toy.y >= floor) {
        toy.y = floor;
        if (Math.abs(toy.vy) > 30) {
            toy.vy = -toy.vy * 0.48; // bounce dampening
            toy.vx *= 0.75;
            toy.bounces++;
        } else {
            toy.vy = 0;
            toy.vx *= Math.pow(0.2, dt); // rolling friction
            toy.vRot = toy.vx * 3;
            toy.grounded = true;
        }
    }

    // Walls
    if (toy.x <= 20) {
        toy.x = 20;
        toy.vx = Math.abs(toy.vx) * 0.6;
    } else if (toy.x >= viewportWidth - 20) {
        toy.x = viewportWidth - 20;
        toy.vx = -Math.abs(toy.vx) * 0.6;
    }

    return currentNow < toy.expiresAt;
}

/**
 * Find the most eager cat to chase an active toy.
 * Playful & Explorer cats have highest priority.
 * @param {object[]} cats
 * @param {object} toy
 * @param {number} now
 * @returns {object|null}
 */
function findCatToChaseToy(cats, toy, now) {
    if (!toy || toy.expiresAt <= now) return null;
    let closestCat = null;
    let minScore = Infinity;

    for (const cat of cats) {
        if (isBusy(cat, now)) continue;
        const dist = Math.abs(cat.x - toy.x);
        if (dist > 600) continue; // too far
        const personalityWeight = cat.personality === 'playful' ? 0.6 : cat.personality === 'explorer' ? 0.8 : 1.2;
        const score = dist * personalityWeight;
        if (score < minScore) {
            minScore = score;
            closestCat = cat;
        }
    }
    return closestCat;
}

/**
 * Swat a toy when a cat reaches it!
 * @param {object} toy
 * @param {object} cat
 * @param {number} now
 */
function swatToy(toy, cat, now) {
    const dir = cat.x < toy.x ? 1 : -1;
    toy.vx = dir * randRange(120, 220);
    toy.vy = -randRange(90, 160);
    toy.bounces = 0;
    toy.grounded = false;
    toy.swattedAt = now;
    cat.hopUntil = now + 500;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        ZEN_PAWS_MIN_CATS,
        ZEN_PAWS_MAX_CATS,
        ZEN_PAWS_MIN_SPEED,
        ZEN_PAWS_MAX_SPEED,
        ZEN_PAWS_POUNCE_SPEED,
        ZEN_PAWS_MEET_DISTANCE_PX,
        ZEN_PAWS_MEET_DURATION_MS,
        ZEN_PAWS_MEET_COOLDOWN_MS,
        ZEN_PAWS_PET_DURATION_MS,
        ZEN_PAWS_PERSONALITIES,
        ZEN_PAWS_PALETTES,
        clamp,
        randRange,
        pairKey,
        computeCatCount,
        computeCatSize,
        pickPalette,
        pickPersonality,
        createCats,
        stepCat,
        effSpeed,
        isBusy,
        startPet,
        findMeeting,
        applyMeeting,
        shouldDropPawPrint,
        spawnToy,
        stepToy,
        findCatToChaseToy,
        swatToy,
        CP_DIALOGUES,
        CP_SOLO_THOUGHTS,
        pickCpDialogue
    };
}
