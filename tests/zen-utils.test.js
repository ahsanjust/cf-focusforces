/**
 * FocusForces - Zen Mode Utilities Tests
 */

const {
    computeZenWidth,
    resolveZenFontSize,
    detectPlatform,
    formatZenTimerBadge,
    formatMs,
    cleanSampleText,
    extractCodeforcesProblemMeta,
    computeScrollProgress
} = require('../zen-utils');

describe('computeZenWidth', () => {
    test('computes preset width when viewport has sufficient space', () => {
        expect(computeZenWidth('compact', 1920)).toBe(780);
        expect(computeZenWidth('comfortable', 1920)).toBe(920);
        expect(computeZenWidth('expansive', 1920)).toBe(1080);
    });

    test('defaults to comfortable preset on unknown preset name', () => {
        expect(computeZenWidth('unknown', 1920)).toBe(920);
        expect(computeZenWidth(null, 1920)).toBe(920);
    });

    test('clamps width when viewport is smaller than target', () => {
        // 800px viewport - 48px gutter = 752px max
        expect(computeZenWidth('comfortable', 800)).toBe(752);
        expect(computeZenWidth('expansive', 800)).toBe(752);
        expect(computeZenWidth('compact', 800)).toBe(752);
    });

    test('never drops below 320px minimum', () => {
        expect(computeZenWidth('compact', 300)).toBe(320);
    });
});

describe('resolveZenFontSize', () => {
    test('returns correct font sizes for presets', () => {
        expect(resolveZenFontSize('normal')).toBe('15px');
        expect(resolveZenFontSize('large')).toBe('16.5px');
        expect(resolveZenFontSize('xlarge')).toBe('18px');
        expect(resolveZenFontSize('other')).toBe('15px');
    });
});

describe('detectPlatform', () => {
    test('detects Codeforces', () => {
        expect(detectPlatform('codeforces.com')).toBe('codeforces');
        expect(detectPlatform('m1.codeforces.com')).toBe('codeforces');
    });

    test('detects AtCoder', () => {
        expect(detectPlatform('atcoder.jp')).toBe('atcoder');
        expect(detectPlatform('beta.atcoder.jp')).toBe('atcoder');
    });

    test('detects CodeChef', () => {
        expect(detectPlatform('www.codechef.com')).toBe('codechef');
        expect(detectPlatform('codechef.com')).toBe('codechef');
    });

    test('returns other for unknown platforms', () => {
        expect(detectPlatform('leetcode.com')).toBe('other');
        expect(detectPlatform('')).toBe('other');
        expect(detectPlatform(null)).toBe('other');
    });
});

describe('formatMs', () => {
    test('formats MM:SS correctly', () => {
        expect(formatMs(25 * 60 * 1000)).toBe('25:00');
        expect(formatMs(45 * 1000)).toBe('00:45');
        expect(formatMs(0)).toBe('00:00');
    });

    test('formats HH:MM:SS for durations >= 1 hour', () => {
        expect(formatMs(3665 * 1000)).toBe('01:01:05');
        expect(formatMs(2 * 3600 * 1000)).toBe('02:00:00');
    });
});

describe('formatZenTimerBadge', () => {
    test('formats running countdown timer', () => {
        const now = 100000;
        const state = {
            status: 'RUNNING',
            mode: 'countdown',
            endTime: now + 120000,
            durationMs: 25 * 60 * 1000
        };
        const res = formatZenTimerBadge(state, now);
        expect(res.text).toBe('02:00');
        expect(res.isRunning).toBe(true);
        expect(res.isDanger).toBe(true); // <= 5min
    });

    test('formats running stopwatch', () => {
        const now = 200000;
        const state = {
            status: 'RUNNING',
            mode: 'stopwatch',
            lastStarted: now - 85000,
            accumulatedMs: 0
        };
        const res = formatZenTimerBadge(state, now);
        expect(res.text).toBe('01:25');
        expect(res.isRunning).toBe(true);
        expect(res.mode).toBe('stopwatch');
    });

    test('formats paused timer', () => {
        const state = {
            status: 'PAUSED',
            remainingMs: 90000
        };
        const res = formatZenTimerBadge(state, 1000);
        expect(res.text).toBe('01:30 (paused)');
        expect(res.isRunning).toBe(false);
    });

    test('formats finished timer', () => {
        const state = {
            status: 'FINISHED'
        };
        const res = formatZenTimerBadge(state, 1000);
        expect(res.text).toBe('Done! 🎉');
        expect(res.isDanger).toBe(true);
    });

    test('handles null or invalid state gracefully', () => {
        const res = formatZenTimerBadge(null, 1000);
        expect(res.text).toBe('25:00');
        expect(res.status).toBe('READY');
    });
});

describe('cleanSampleText', () => {
    test('normalizes CRLF and removes trailing blank spaces', () => {
        const input = "5\r\n1 2 3 4 5  \r\n\r\n";
        expect(cleanSampleText(input)).toBe("5\n1 2 3 4 5");
    });

    test('handles empty and null inputs safely', () => {
        expect(cleanSampleText('')).toBe('');
        expect(cleanSampleText(null)).toBe('');
    });
});

describe('extractCodeforcesProblemMeta', () => {
    test('extracts title and limits from mock DOM', () => {
        const mockDoc = {
            querySelector: (sel) => {
                if (sel.includes('.title')) return { textContent: 'B. Card Game' };
                if (sel.includes('.time-limit')) return { textContent: 'time limit per test: 2.0 s' };
                if (sel.includes('.memory-limit')) return { textContent: 'memory limit per test: 512 MB' };
                if (sel.includes('.input-file')) return { textContent: 'input: standard input' };
                if (sel.includes('.output-file')) return { textContent: 'output: standard output' };
                return null;
            }
        };

        const meta = extractCodeforcesProblemMeta(mockDoc);
        expect(meta.title).toBe('B. Card Game');
        expect(meta.timeLimit).toBe('2.0 s');
        expect(meta.memoryLimit).toBe('512 MB');
        expect(meta.inputType).toBe('standard input');
        expect(meta.outputType).toBe('standard output');
    });
});

describe('computeScrollProgress', () => {
    test('computes percentage accurately', () => {
        expect(computeScrollProgress(0, 1000, 200)).toBe(0);
        expect(computeScrollProgress(400, 1000, 200)).toBe(50);
        expect(computeScrollProgress(800, 1000, 200)).toBe(100);
    });

    test('handles non-scrollable page', () => {
        expect(computeScrollProgress(0, 500, 600)).toBe(0);
    });
});
