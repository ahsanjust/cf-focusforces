/**
 * FocusForces - Zen Paws Utilities Tests
 *
 * Pins the pure movement/meeting logic so the animation driver in catwalk.js
 * can stay thin and bug-free. All randomness is injected deterministically.
 */
const {
    ZEN_PAWS_MIN_CATS,
    ZEN_PAWS_MAX_CATS,
    ZEN_PAWS_MEET_DISTANCE_PX,
    ZEN_PAWS_MEET_DURATION_MS,
    ZEN_PAWS_MEET_COOLDOWN_MS,
    computeCatCount,
    computeCatSize,
    pickPalette,
    createCats,
    stepCat,
    effSpeed,
    findMeeting,
    applyMeeting,
    shouldDropPawPrint
} = require('../catwalk-utils');

// rand that always returns 0.5 → jitter 0, mid-range durations/speeds
const RAND_05 = () => 0.5;
// rand that always returns 0 → always meets, earliest pauses, min values
const RAND_0 = () => 0;

describe('computeCatCount', () => {
    test('small screens get the minimum of 2', () => {
        expect(computeCatCount(800, 600)).toBe(2);
        expect(computeCatCount(500, 400)).toBe(2);
    });

    test('scales with width', () => {
        expect(computeCatCount(1366, 768)).toBe(3);
        expect(computeCatCount(1920, 1080)).toBe(4);
    });

    test('caps at the maximum', () => {
        expect(computeCatCount(2560, 1440)).toBe(ZEN_PAWS_MAX_CATS);
        expect(computeCatCount(5000, 1440)).toBe(ZEN_PAWS_MAX_CATS);
    });

    test('never drops below the minimum even on huge screens', () => {
        expect(computeCatCount(0, 0)).toBe(ZEN_PAWS_MIN_CATS);
        expect(computeCatCount(-10, 0)).toBe(ZEN_PAWS_MIN_CATS);
    });
});

describe('computeCatSize', () => {
    test('scales with viewport height', () => {
        expect(computeCatSize(1080)).toBe(50);
        expect(computeCatSize(768)).toBe(35);
    });

    test('clamps to the min size on small viewports', () => {
        expect(computeCatSize(300)).toBe(34);
    });

    test('clamps to the max size on huge viewports', () => {
        expect(computeCatSize(2000)).toBe(54);
    });
});

describe('pickPalette', () => {
    test('is deterministic and cycles through palettes', () => {
        expect(pickPalette(0, 'default')).toEqual(pickPalette(0, 'default'));
        expect(pickPalette(0, 'default')).not.toEqual(pickPalette(1, 'default'));
        // 5 palettes → index 5 wraps to index 0
        expect(pickPalette(5, 'default')).toEqual(pickPalette(0, 'default'));
    });

    test('dark themes shift the selection by one', () => {
        expect(pickPalette(0, 'dark')).toEqual(pickPalette(1, 'default'));
        expect(pickPalette(0, 'amoled')).toEqual(pickPalette(1, 'default'));
    });

    test('contrast theme behaves like the light themes', () => {
        expect(pickPalette(0, 'contrast')).toEqual(pickPalette(0, 'default'));
    });

    test('every palette has body, dark and accent colors', () => {
        for (let i = 0; i < 8; i++) {
            const p = pickPalette(i, 'default');
            expect(p.body).toMatch(/^#[0-9a-f]{6}$/i);
            expect(p.dark).toMatch(/^#[0-9a-f]{6}$/i);
            expect(p.accent).toMatch(/^#[0-9a-f]{6}$/i);
        }
    });
});

describe('createCats', () => {
    const base = { count: 3, viewportWidth: 1200, viewportHeight: 800, now: 1000, rand: RAND_05 };

    test('creates the requested number of cats', () => {
        expect(createCats(base)).toHaveLength(3);
        expect(createCats({ ...base, count: 1 })).toHaveLength(1);
    });

    test('spreads cats across the viewport within bounds', () => {
        const cats = createCats(base);
        cats.forEach(cat => {
            expect(cat.x).toBeGreaterThanOrEqual(0);
            expect(cat.x).toBeLessThanOrEqual(1200);
        });
        // even spread with rand 0.5 → slots 0, 0.5, 1 → increasing x
        expect(cats[0].x).toBeLessThan(cats[1].x);
        expect(cats[1].x).toBeLessThan(cats[2].x);
    });

    test('alternates directions so meetings can happen naturally', () => {
        const cats = createCats(base);
        expect(cats[0].dir).toBe(1);
        expect(cats[1].dir).toBe(-1);
        expect(cats[2].dir).toBe(1);
    });

    test('assigns sane size, speed and walk cycle', () => {
        const cats = createCats(base);
        cats.forEach(cat => {
            expect(cat.size).toBe(computeCatSize(800));
            expect(cat.speed).toBeGreaterThanOrEqual(22);
            expect(cat.speed).toBeLessThanOrEqual(46);
            expect(cat.walkCycle).toBeGreaterThanOrEqual(0.45);
            expect(cat.walkCycle).toBeLessThanOrEqual(0.95);
        });
    });

    test('places feet near the bottom of the viewport', () => {
        const cats = createCats(base);
        cats.forEach(cat => {
            const feetY = cat.y + cat.size * 0.93;
            expect(feetY).toBeLessThanOrEqual(800);
            expect(feetY).toBeGreaterThan(800 - cat.size);
        });
    });

    test('palette is theme-aware per cat', () => {
        const light = createCats(base);
        const dark = createCats({ ...base, theme: 'dark' });
        expect(dark[0].palette).toEqual(pickPalette(0, 'dark'));
        expect(dark[0].palette).not.toEqual(light[0].palette);
    });

    test('fresh cats never start paused or in a meeting', () => {
        const cats = createCats(base);
        cats.forEach(cat => {
            expect(cat.pauseUntil).toBe(0);
            expect(cat.meeting).toBeNull();
            expect(cat.hold).toBe(false);
        });
    });
});

describe('stepCat', () => {
    const cat = () => ({
        index: 0, x: 100, y: 500, dir: 1, speed: 40, size: 60,
        walkCycle: 0.6, phase: 0, pauseUntil: 0, nextPauseAt: Infinity,
        meeting: null, hold: false, lastPawAt: 0, pawEvery: 650, cooldowns: {}
    });

    test('walks right at speed * dt', () => {
        const c = cat();
        stepCat(c, 1000, { now: 0, viewportWidth: 1200 });
        expect(c.x).toBe(140);
    });

    test('half the time moves half the distance', () => {
        const c = cat();
        stepCat(c, 500, { now: 0, viewportWidth: 1200 });
        expect(c.x).toBe(120);
    });

    test('turns around at the right wall', () => {
        const c = cat();
        c.x = 1200 - 54 - 1; // margin = size * 0.9 = 54
        const { events } = stepCat(c, 1000, { now: 0, viewportWidth: 1200 });
        expect(c.dir).toBe(-1);
        expect(c.x).toBe(1200 - 54);
        expect(events).toContain('TURN');
    });

    test('turns around at the left wall', () => {
        const c = cat();
        c.x = 54 + 1;
        c.dir = -1;
        const { events } = stepCat(c, 1000, { now: 0, viewportWidth: 1200 });
        expect(c.dir).toBe(1);
        expect(c.x).toBe(54);
        expect(events).toContain('TURN');
    });

    test('does not move while paused', () => {
        const c = cat();
        c.pauseUntil = 5000;
        const x0 = c.x;
        stepCat(c, 1000, { now: 1000, viewportWidth: 1200 });
        expect(c.x).toBe(x0);
    });

    test('does not move while held (watching the cursor)', () => {
        const c = cat();
        c.hold = true;
        const x0 = c.x;
        stepCat(c, 1000, { now: 1000, viewportWidth: 1200 });
        expect(c.x).toBe(x0);
    });

    test('starts a pause when due (with rand under the chance)', () => {
        const c = cat();
        c.nextPauseAt = 1000;
        const { events } = stepCat(c, 100, { now: 1000, viewportWidth: 1200, rand: RAND_0 });
        expect(events).toContain('PAUSE_START');
        expect(c.pauseUntil).toBeGreaterThan(1000);
        // next pause scheduled further in the future
        expect(c.nextPauseAt).toBeGreaterThan(1000);
    });

    test('keeps walking when a pause is due but the chance roll fails', () => {
        const c = cat();
        c.nextPauseAt = 1000;
        // rand() = 1 → 1 < 0.6 is false → keeps walking
        const { events } = stepCat(c, 1000, { now: 1000, viewportWidth: 1200, rand: () => 1 });
        expect(events).not.toContain('PAUSE_START');
        expect(c.x).toBe(140);
    });

    test('is frozen during a meeting and resumes the original heading after', () => {
        const c = cat();
        c.dir = -1; // was heading left
        c.meeting = { until: 3000, resumeDir: -1, bubble: 'meow', bubbleUntil: 2400 };
        const x0 = c.x;
        stepCat(c, 1000, { now: 2000, viewportWidth: 1200 });
        expect(c.x).toBe(x0); // frozen

        const { events } = stepCat(c, 1000, { now: 3000, viewportWidth: 1200 });
        expect(events).toContain('MEET_END');
        expect(c.meeting).toBeNull();
        expect(c.dir).toBe(-1); // resumed original heading
    });
});

describe('effSpeed / isBusy', () => {
    test('returns 0 while resting, held, or meeting', () => {
        const now = 1000;
        const c = { speed: 40, hold: false, pauseUntil: 0, meeting: null };
        expect(effSpeed(c, now)).toBe(40);
        c.pauseUntil = 2000;
        expect(effSpeed(c, now)).toBe(0);
        c.pauseUntil = 0;
        c.hold = true;
        expect(effSpeed(c, now)).toBe(0);
        c.hold = false;
        c.meeting = { until: 2000 };
        expect(effSpeed(c, now)).toBe(0);
    });
});

describe('findMeeting / applyMeeting', () => {
    const cat = (x, dir, speed = 40) => ({
        index: 0, x, y: 500, dir, speed, size: 60,
        walkCycle: 0.6, phase: 0, pauseUntil: 0, nextPauseAt: Infinity,
        meeting: null, hold: false, lastPawAt: 0, pawEvery: 650, cooldowns: {}
    });

    test('detects two cats closing in on each other', () => {
        const cats = [cat(300, 1), cat(360, -1)];
        const pair = findMeeting(cats, { now: 1000, rand: RAND_0 });
        expect(pair).toEqual({ a: 0, b: 1 });
    });

    test('ignores cats moving in the same direction', () => {
        const cats = [cat(300, 1), cat(360, 1)];
        expect(findMeeting(cats, { now: 1000, rand: RAND_0 })).toBeNull();
    });

    test('ignores cats walking away from each other', () => {
        const cats = [cat(300, -1), cat(360, 1)];
        expect(findMeeting(cats, { now: 1000, rand: RAND_0 })).toBeNull();
    });

    test('a stationary cat can be approached and greeted', () => {
        // left cat paused (speed 0 via pauseUntil), right cat walking left toward it
        const cats = [cat(300, 1), cat(360, -1)];
        cats[0].pauseUntil = 5000;
        const pair = findMeeting(cats, { now: 1000, rand: RAND_0 });
        expect(pair).toEqual({ a: 0, b: 1 });
    });

    test('ignores cats beyond the meet distance', () => {
        const cats = [cat(300, 1), cat(300 + ZEN_PAWS_MEET_DISTANCE_PX + 10, -1)];
        expect(findMeeting(cats, { now: 1000, rand: RAND_0 })).toBeNull();
    });

    test('respects the per-pair cooldown', () => {
        const cats = [cat(300, 1), cat(360, -1)];
        const key = '0:1';
        cats[0].cooldowns[key] = 5000;
        cats[1].cooldowns[key] = 5000;
        expect(findMeeting(cats, { now: 1000, rand: RAND_0 })).toBeNull();
        // cooldown expires → greeting allowed again
        expect(findMeeting(cats, { now: 6000, rand: RAND_0 })).toEqual({ a: 0, b: 1 });
    });

    test('skips cats already in a meeting', () => {
        const cats = [cat(300, 1), cat(360, 1), cat(460, -1)];
        cats[0].meeting = { until: 5000 };
        const pair = findMeeting(cats, { now: 1000, rand: RAND_0 });
        // cat 0 is busy, so only cats 1 and 2 can pair (100px apart, closing)
        expect(pair).toEqual({ a: 1, b: 2 });
    });

    test('honors the meeting chance roll', () => {
        const cats = [cat(300, 1), cat(360, -1)];
        // rand() = 0.99 → 0.99 < 0.85 is false → no greeting
        expect(findMeeting(cats, { now: 1000, rand: () => 0.99 })).toBeNull();
    });

    test('applyMeeting faces the cats toward each other and records resume headings', () => {
        const cats = [cat(300, 1), cat(360, -1)];
        applyMeeting(cats, { a: 0, b: 1 }, { now: 1000 });
        expect(cats[0].dir).toBe(1);  // left cat faces right
        expect(cats[1].dir).toBe(-1); // right cat faces left
        expect(cats[0].meeting.until).toBe(1000 + ZEN_PAWS_MEET_DURATION_MS);
        expect(cats[1].meeting.resumeDir).toBe(-1);
        expect(cats[1].meeting.resumeDir).toBe(-1);
        expect(cats[0].cooldowns['0:1']).toBe(1000 + ZEN_PAWS_MEET_COOLDOWN_MS);
    });

    test('applyMeeting picks a deterministic CP dialogue per pair', () => {
        const catsA = [cat(300, 1), cat(360, -1)];
        applyMeeting(catsA, { a: 0, b: 1 }, { now: 1000 });
        expect(catsA[0].meeting.dialogue).toBeDefined();
        expect(catsA[0].meeting.dialogue.a).toBeDefined();
        expect(catsA[1].meeting.dialogue.b).toBeDefined();
        expect(catsA[0].meeting.bubble).toBe(catsA[0].meeting.dialogue.a);
        expect(catsA[1].meeting.bubble).toBe(catsA[1].meeting.dialogue.b);

        // same pair → same bubble every time
        const catsB = [cat(300, 1), cat(360, -1)];
        applyMeeting(catsB, { a: 0, b: 1 }, { now: 1000 });
        expect(catsB[0].meeting.bubble).toBe(catsA[0].meeting.bubble);
        expect(catsB[1].meeting.bubble).toBe(catsA[1].meeting.bubble);
    });

    test('end-to-end: meet, freeze, pass each other afterwards', () => {
        const cats = [cat(300, 1), cat(360, -1)];
        applyMeeting(cats, { a: 0, b: 1 }, { now: 1000 });

        // frozen while meeting
        stepCat(cats[0], 1000, { now: 2000, viewportWidth: 1200 });
        stepCat(cats[1], 1000, { now: 2000, viewportWidth: 1200 });
        expect(cats[0].x).toBe(300);
        expect(cats[1].x).toBe(360);

        // meeting ends → resume original headings and walk past each other
        stepCat(cats[0], 1000, { now: 5000, viewportWidth: 1200 });
        stepCat(cats[1], 1000, { now: 5000, viewportWidth: 1200 });
        expect(cats[0].dir).toBe(1);
        expect(cats[1].dir).toBe(-1);
        expect(cats[0].x).toBeGreaterThan(300);
        expect(cats[1].x).toBeLessThan(360);
    });
});

describe('shouldDropPawPrint', () => {
    const cat = () => ({
        hold: false, pauseUntil: 0, meeting: null, lastPawAt: 0, pawEvery: 650
    });

    test('drops a print once per interval while walking', () => {
        const c = cat();
        expect(shouldDropPawPrint(c, 1000)).toBe(true);
        expect(shouldDropPawPrint(c, 1500)).toBe(false); // too soon
        expect(shouldDropPawPrint(c, 1700)).toBe(true);  // 700ms later
    });

    test('never drops prints while paused, held, or meeting', () => {
        const c1 = cat(); c1.pauseUntil = 5000;
        expect(shouldDropPawPrint(c1, 1000)).toBe(false);

        const c2 = cat(); c2.hold = true;
        expect(shouldDropPawPrint(c2, 1000)).toBe(false);

        const c3 = cat(); c3.meeting = { until: 5000 };
        expect(shouldDropPawPrint(c3, 1000)).toBe(false);
    });
});

describe('personalities and breeds', () => {
    const { ZEN_PAWS_PERSONALITIES, pickPersonality } = require('../catwalk-utils');

    test('picks deterministic personalities cycling across indices', () => {
        expect(pickPersonality(0)).toBe('explorer');
        expect(pickPersonality(1)).toBe('playful');
        expect(pickPersonality(2)).toBe('loaf');
        expect(pickPersonality(3)).toBe('sweet');
        expect(pickPersonality(4)).toBe('explorer');
    });

    test('cats are created with personalities and breed metadata', () => {
        const cats = createCats({ count: 4, viewportWidth: 1200, viewportHeight: 800 });
        expect(cats[0].personality).toBe('explorer');
        expect(cats[1].personality).toBe('playful');
        expect(cats[2].personality).toBe('loaf');
        expect(cats[3].personality).toBe('sweet');
        expect(cats[0].palette.eye).toBeDefined();
        expect(cats[0].palette.name).toBeDefined();
    });
});

describe('petting interaction', () => {
    const { startPet, effSpeed, isBusy } = require('../catwalk-utils');

    test('petting puts cat in petted bliss with purr bubble and duration', () => {
        const c = { pettedUntil: 0, action: 'walk' };
        const res = startPet(c, 1000, () => 0);
        expect(c.pettedUntil).toBe(3400); // 1000 + 2400
        expect(c.action).toBe('petted');
        expect(res.bubble).toBeDefined();
        expect(effSpeed(c, 2000)).toBe(0);
        expect(isBusy(c, 2000)).toBe(true);
    });
});

describe('toy physics and interactions', () => {
    const { spawnToy, stepToy, findCatToChaseToy, swatToy } = require('../catwalk-utils');

    test('spawns a toy with initial upward bounce and lifetime', () => {
        const toy = spawnToy({ x: 500, y: 400, now: 1000 });
        expect(toy.x).toBe(500);
        expect(toy.y).toBe(400);
        expect(toy.vy).toBeLessThan(0);
        expect(toy.expiresAt).toBe(13000);
    });

    test('stepToy applies gravity and handles floor bouncing', () => {
        const toy = spawnToy({ x: 500, y: 400, now: 1000 });
        toy.vy = 200; // falling down
        const alive = stepToy(toy, 100, 600, 1000, 1100);
        expect(alive).toBe(true);
        expect(toy.y).toBeGreaterThan(400);
    });

    test('findCatToChaseToy picks eligible playful or explorer cat', () => {
        const cats = [
            { index: 0, x: 200, personality: 'loaf', meeting: null, pettedUntil: 0, actionUntil: 0 },
            { index: 1, x: 250, personality: 'playful', meeting: null, pettedUntil: 0, actionUntil: 0 }
        ];
        const toy = { x: 300, expiresAt: 5000 };
        const chosen = findCatToChaseToy(cats, toy, 1000);
        expect(chosen).toBe(cats[1]); // playful cat preferred
    });

    test('swatToy imparts velocity to toy and makes cat hop', () => {
        const toy = spawnToy({ x: 400, y: 600, now: 1000 });
        const cat = { x: 380, hopUntil: 0 };
        swatToy(toy, cat, 1000);
        expect(toy.vx).toBeGreaterThan(0);
        expect(cat.hopUntil).toBe(1500);
    });
});