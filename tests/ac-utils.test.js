/**
 * FocusForces - AC Celebration Utilities Tests
 *
 * Pins the pure URL parsing, dedup, verdict-token matching, and burst geometry
 * so the DOM driver in accelebrate.js can stay thin. All randomness is
 * injected deterministically.
 */
const {
    AC_CELEBRATE_SPARK_COUNT,
    parseProblemKeyFromPath,
    celebrateDedupKey,
    shouldCelebrate,
    isAcceptedToken,
    pickBurstParticles
} = require('../ac-utils');

const RAND_05 = () => 0.5;
const RAND_0 = () => 0;

describe('parseProblemKeyFromPath', () => {
    test('parses a contest problem URL', () => {
        expect(parseProblemKeyFromPath('/contest/123/problem/A')).toEqual({
            contestId: '123', index: 'A', key: '123-A'
        });
    });

    test('parses a gym problem URL', () => {
        expect(parseProblemKeyFromPath('/gym/100/problem/B')).toEqual({
            contestId: '100', index: 'B', key: '100-B'
        });
    });

    test('parses a problemset problem URL', () => {
        expect(parseProblemKeyFromPath('/problemset/problem/1/A')).toEqual({
            contestId: '1', index: 'A', key: '1-A'
        });
    });

    test('parses a group contest problem URL', () => {
        expect(parseProblemKeyFromPath('/group/xyz/contest/432/problem/C')).toEqual({
            contestId: '432', index: 'C', key: '432-C'
        });
    });

    test('normalizes the problem index to uppercase', () => {
        expect(parseProblemKeyFromPath('/contest/9/problem/a').index).toBe('A');
    });

    test('returns null for non-problem URLs', () => {
        expect(parseProblemKeyFromPath('/contest/123')).toBeNull();
        expect(parseProblemKeyFromPath('/')).toBeNull();
        expect(parseProblemKeyFromPath('')).toBeNull();
        expect(parseProblemKeyFromPath('/problemset')).toBeNull();
    });
});

describe('celebrateDedupKey', () => {
    test('is problem-scoped when a problem key is known', () => {
        const problem = { key: '123-A' };
        expect(celebrateDedupKey(problem, '98765')).toBe('ff_ac_celebrated_123-A');
    });

    test('falls back to submission-scoped when no problem key', () => {
        expect(celebrateDedupKey(null, '98765')).toBe('ff_ac_celebrated_sub_98765');
        expect(celebrateDedupKey({}, '98765')).toBe('ff_ac_celebrated_sub_98765');
    });
});

describe('shouldCelebrate', () => {
    test('celebrates when neither session nor storage has the key', () => {
        expect(shouldCelebrate(new Set(), {}, 'ff_ac_celebrated_1-A')).toBe(true);
    });

    test('does not celebrate twice in the same session', () => {
        const seen = new Set(['ff_ac_celebrated_1-A']);
        expect(shouldCelebrate(seen, {}, 'ff_ac_celebrated_1-A')).toBe(false);
    });

    test('does not celebrate if storage already recorded it', () => {
        const stored = { 'ff_ac_celebrated_1-A': 1700000000000 };
        expect(shouldCelebrate(new Set(), stored, 'ff_ac_celebrated_1-A')).toBe(false);
    });

    test('never celebrates an empty key', () => {
        expect(shouldCelebrate(new Set(), {}, '')).toBe(false);
        expect(shouldCelebrate(new Set(), {}, null)).toBe(false);
        expect(shouldCelebrate(new Set(), {}, undefined)).toBe(false);
    });
});

describe('isAcceptedToken', () => {
    test('recognizes English Accepted verdicts', () => {
        expect(isAcceptedToken('Accepted')).toBe(true);
        expect(isAcceptedToken('Verdict: Accepted')).toBe(true);
        expect(isAcceptedToken('  Accepted  ')).toBe(true);
    });

    test('recognizes the OK shorthand', () => {
        expect(isAcceptedToken('OK')).toBe(true);
        expect(isAcceptedToken('ok')).toBe(true);
    });

    test('recognizes the Russian verdict', () => {
        expect(isAcceptedToken('Правильное решение')).toBe(true);
    });

    test('rejects non-accepted verdicts and empty text', () => {
        expect(isAcceptedToken('Wrong answer')).toBe(false);
        expect(isAcceptedToken('Time limit exceeded')).toBe(false);
        expect(isAcceptedToken('Rejected')).toBe(false);
        expect(isAcceptedToken('')).toBe(false);
        expect(isAcceptedToken(null)).toBe(false);
    });
});

describe('pickBurstParticles', () => {
    test('produces the requested number of particles', () => {
        expect(pickBurstParticles({ rand: RAND_05 })).toHaveLength(AC_CELEBRATE_SPARK_COUNT);
        expect(pickBurstParticles({ count: 4, rand: RAND_05 })).toHaveLength(4);
        expect(pickBurstParticles({ count: 0, rand: RAND_05 })).toHaveLength(1);
    });

    test('angles and distances are finite and within bounds', () => {
        const parts = pickBurstParticles({ rand: RAND_05 });
        parts.forEach(p => {
            expect(Number.isFinite(p.angle)).toBe(true);
            expect(p.angle).toBeGreaterThanOrEqual(0);
            expect(p.angle).toBeLessThanOrEqual(Math.PI * 2);
            expect(p.dist).toBeGreaterThanOrEqual(34);
            expect(p.dist).toBeLessThanOrEqual(92);
            expect(p.size).toBeGreaterThanOrEqual(3);
            expect(p.size).toBeLessThanOrEqual(7);
            expect(p.dur).toBeGreaterThanOrEqual(700);
            expect(p.dur).toBeLessThanOrEqual(1200);
        });
    });

    test('is deterministic for a fixed rand', () => {
        const a = pickBurstParticles({ rand: RAND_0 });
        const b = pickBurstParticles({ rand: RAND_0 });
        expect(a).toEqual(b);
    });
});