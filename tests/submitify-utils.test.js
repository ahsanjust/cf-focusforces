const {
    CODE_TEMPLATES,
    computeNewlineIndent,
    applyTabIndentation,
    handleBracketPairing,
    computeCodeStats,
    draftStorageKey
} = require('../submitify-utils.js');

describe('submitify-utils', () => {
    describe('computeNewlineIndent', () => {
        test('preserves existing line indentation on enter', () => {
            const code = '    int x = 10;';
            const res = computeNewlineIndent(code, code.length);
            expect(res.indent).toBe('    ');
            expect(res.extraClose).toBe(false);
        });

        test('increases indentation by 4 spaces when line ends with {', () => {
            const code = 'void solve() {';
            const res = computeNewlineIndent(code, code.length);
            expect(res.indent).toBe('    ');
            expect(res.extraClose).toBe(false);
        });

        test('detects following } for split newline', () => {
            const code = 'void solve() {}';
            const res = computeNewlineIndent(code, code.length - 1);
            expect(res.indent).toBe('    ');
            expect(res.extraClose).toBe(true);
        });

        test('handles empty code and cursor at start', () => {
            const res = computeNewlineIndent('', 0);
            expect(res.indent).toBe('');
            expect(res.extraClose).toBe(false);
        });
    });

    describe('applyTabIndentation', () => {
        test('inserts 4 spaces at cursor when no selection', () => {
            const res = applyTabIndentation('int x = 0;', 0, 0, false);
            expect(res.value).toBe('    int x = 0;');
            expect(res.selectionStart).toBe(4);
            expect(res.selectionEnd).toBe(4);
        });

        test('indents selected block with 4 spaces per line', () => {
            const text = 'line 1\nline 2';
            const res = applyTabIndentation(text, 0, text.length, false);
            expect(res.value).toBe('    line 1\n    line 2');
        });

        test('unindents selected block on Shift+Tab', () => {
            const text = '    line 1\n    line 2';
            const res = applyTabIndentation(text, 0, text.length, true);
            expect(res.value).toBe('line 1\nline 2');
            expect(res.selectionStart).toBe(0);
        });

        test('unindents single line up to available spaces', () => {
            const text = '  line 1';
            const res = applyTabIndentation(text, 2, 2, true);
            expect(res.value).toBe('line 1');
            expect(res.selectionStart).toBe(0);
        });
    });

    describe('handleBracketPairing', () => {
        test('auto-inserts closing brace and places cursor between', () => {
            const res = handleBracketPairing('{', 'void test() ', 12, 12);
            expect(res.handled).toBe(true);
            expect(res.value).toBe('void test() {}');
            expect(res.selectionStart).toBe(13);
        });

        test('wraps selected text in parentheses', () => {
            const res = handleBracketPairing('(', 'x + y', 0, 5);
            expect(res.handled).toBe(true);
            expect(res.value).toBe('(x + y)');
            expect(res.selectionStart).toBe(1);
            expect(res.selectionEnd).toBe(6);
        });

        test('skips over already typed closing bracket', () => {
            const res = handleBracketPairing(')', 'test()', 5, 5);
            expect(res.handled).toBe(true);
            expect(res.value).toBe('test()');
            expect(res.selectionStart).toBe(6);
        });

        test('ignores non-bracket characters', () => {
            const res = handleBracketPairing('a', 'test', 4, 4);
            expect(res.handled).toBe(false);
        });
    });

    describe('computeCodeStats', () => {
        test('computes lines and character count', () => {
            const stats = computeCodeStats('int a;\nint b;\nint c;');
            expect(stats.lines).toBe(3);
            expect(stats.chars).toBe(20);
        });

        test('handles empty input', () => {
            const stats = computeCodeStats('');
            expect(stats.lines).toBe(0);
            expect(stats.chars).toBe(0);
        });
    });

    describe('draftStorageKey', () => {
        test('formats contest and problem index consistently', () => {
            expect(draftStorageKey(2024, 'a')).toBe('ff_draft_2024_A');
            expect(draftStorageKey('1900', 'B1')).toBe('ff_draft_1900_B1');
        });

        test('handles missing or general contest gracefully', () => {
            expect(draftStorageKey(null, null)).toBe('ff_draft_general_MAIN');
        });
    });

    describe('CODE_TEMPLATES', () => {
        test('provides valid C++, Python, and Java boilerplates', () => {
            expect(CODE_TEMPLATES.cpp).toContain('#include <bits/stdc++.h>');
            expect(CODE_TEMPLATES.python).toContain('def solve():');
            expect(CODE_TEMPLATES.java).toContain('public class Main');
        });
    });
});
