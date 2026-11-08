const {
    RANK_TIERS,
    resolveRankTier,
    TAG_CATEGORIES,
    categorizeTag,
    parseCodeforcesProblemPath
} = require('../scout-utils.js');

describe('scout-utils', () => {
    describe('resolveRankTier', () => {
        test('resolves Newbie for rating < 1200', () => {
            const tier = resolveRankTier(800);
            expect(tier.tier).toBe('newbie');
            expect(tier.name).toBe('Newbie');
            expect(tier.color).toBe('#808080');
        });

        test('resolves Pupil for 1200-1399', () => {
            const tier = resolveRankTier(1250);
            expect(tier.tier).toBe('pupil');
            expect(tier.name).toBe('Pupil');
        });

        test('resolves Specialist for 1400-1599', () => {
            const tier = resolveRankTier(1500);
            expect(tier.tier).toBe('specialist');
        });

        test('resolves Expert for 1600-1899', () => {
            const tier = resolveRankTier(1700);
            expect(tier.tier).toBe('expert');
            expect(tier.color).toBe('#2563eb');
        });

        test('resolves Candidate Master for 1900-2099', () => {
            const tier = resolveRankTier(1950);
            expect(tier.tier).toBe('candidate_master');
        });

        test('resolves Master for 2100-2299', () => {
            const tier = resolveRankTier(2200);
            expect(tier.tier).toBe('master');
        });

        test('resolves Grandmaster for 2400+', () => {
            const tier = resolveRankTier(2500);
            expect(tier.tier).toBe('grandmaster');
            expect(tier.color).toBe('#ef4444');
        });

        test('handles string input with * prefix', () => {
            const tier = resolveRankTier('*1600');
            expect(tier.tier).toBe('expert');
            expect(tier.rating).toBe(1600);
        });

        test('returns null for invalid or zero ratings', () => {
            expect(resolveRankTier(0)).toBeNull();
            expect(resolveRankTier(-100)).toBeNull();
            expect(resolveRankTier('invalid')).toBeNull();
        });
    });

    describe('categorizeTag', () => {
        test('categorizes dp as algorithm', () => {
            const cat = categorizeTag('dp');
            expect(cat.category).toBe('algorithm');
            expect(cat.label).toBe('Algorithm');
        });

        test('categorizes data structures as data_structure', () => {
            const cat = categorizeTag('trees');
            expect(cat.category).toBe('data_structure');
            expect(cat.label).toBe('Data Structure');
        });

        test('categorizes number theory as math', () => {
            const cat = categorizeTag('number theory');
            expect(cat.category).toBe('math');
            expect(cat.label).toBe('Math & Logic');
        });

        test('falls back to general for unclassified tags', () => {
            const cat = categorizeTag('custom tag');
            expect(cat.category).toBe('general');
        });
    });

    describe('parseCodeforcesProblemPath', () => {
        test('parses contest problem URL', () => {
            const res = parseCodeforcesProblemPath('/contest/2024/problem/A');
            expect(res.contestId).toBe('2024');
            expect(res.index).toBe('A');
            expect(res.isGym).toBe(false);
        });

        test('parses problemset problem URL', () => {
            const res = parseCodeforcesProblemPath('/problemset/problem/1900/B1');
            expect(res.contestId).toBe('1900');
            expect(res.index).toBe('B1');
        });

        test('parses gym problem URL', () => {
            const res = parseCodeforcesProblemPath('/gym/104000/problem/F');
            expect(res.contestId).toBe('104000');
            expect(res.index).toBe('F');
            expect(res.isGym).toBe(true);
        });

        test('returns nulls for non-problem URLs', () => {
            const res = parseCodeforcesProblemPath('/contests');
            expect(res.contestId).toBeNull();
            expect(res.index).toBeNull();
        });
    });
});
