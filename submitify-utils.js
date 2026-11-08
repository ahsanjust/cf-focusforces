/**
 * FocusForces — Submitify Utilities
 *
 * Pure helper functions for the inline code editor and draft safety engine.
 * Exported for Jest testing and injected into content scripts.
 */

/**
 * Supported default boilerplate templates for common competitive programming languages.
 */
const CODE_TEMPLATES = {
    cpp: `#include <bits/stdc++.h>
using namespace std;

void solve() {
    // Write your solution here
    
}

int main() {
    ios_base::sync_with_stdio(false);
    cin.tie(NULL);
    int t = 1;
    cin >> t;
    while (t--) {
        solve();
    }
    return 0;
}
`,
    python: `import sys

def solve():
    # Write your solution here
    pass

def main():
    input = sys.stdin.read
    data = input().split()
    if not data:
        return
    # Read test cases and solve

if __name__ == '__main__':
    main()
`,
    java: `import java.io.*;
import java.util.*;

public class Main {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StringTokenizer st = null;
        // Write your solution here
    }
}
`
};

/**
 * Compute indentation for newline insertion.
 * Returns the indentation string (spaces/tabs) of the current line,
 * plus 4 spaces if the line ends with an opening brace '{'.
 *
 * @param {string} text
 * @param {number} cursorPosition
 * @returns {{indent: string, extraClose: boolean}}
 */
function computeNewlineIndent(text, cursorPosition) {
    if (!text || cursorPosition <= 0) return { indent: '', extraClose: false };

    // Find the start of the current line before cursor
    const lastNewline = text.lastIndexOf('\n', cursorPosition - 1);
    const lineStart = lastNewline === -1 ? 0 : lastNewline + 1;
    const lineBeforeCursor = text.substring(lineStart, cursorPosition);

    // Extract leading whitespace
    const match = lineBeforeCursor.match(/^[ \t]*/);
    let indent = match ? match[0] : '';

    const trimmedBefore = lineBeforeCursor.trimEnd();
    let extraClose = false;

    if (trimmedBefore.endsWith('{')) {
        indent += '    ';
        // Check if there is an immediately following closing brace
        const afterCursor = text.substring(cursorPosition);
        if (afterCursor.startsWith('}')) {
            extraClose = true;
        }
    }

    return { indent, extraClose };
}

/**
 * Handle Tab and Shift+Tab indentation on text.
 *
 * @param {string} value
 * @param {number} selectionStart
 * @param {number} selectionEnd
 * @param {boolean} isShift
 * @returns {{value: string, selectionStart: number, selectionEnd: number}}
 */
function applyTabIndentation(value, selectionStart, selectionEnd, isShift = false) {
    if (selectionStart === selectionEnd && !isShift) {
        // Simple insertion of 4 spaces at cursor
        const before = value.substring(0, selectionStart);
        const after = value.substring(selectionEnd);
        return {
            value: before + '    ' + after,
            selectionStart: selectionStart + 4,
            selectionEnd: selectionStart + 4
        };
    }

    // Multi-line or Shift+Tab indent/unindent
    const firstNewlineBefore = value.lastIndexOf('\n', selectionStart - 1);
    const blockStart = firstNewlineBefore === -1 ? 0 : firstNewlineBefore + 1;
    const blockEnd = selectionEnd;

    const blockText = value.substring(blockStart, blockEnd);
    const lines = blockText.split('\n');

    let modifiedLines;
    let deltaStart = 0;
    let deltaTotal = 0;

    if (!isShift) {
        // Indent each line by 4 spaces
        modifiedLines = lines.map((line, idx) => {
            const indented = '    ' + line;
            if (idx === 0) deltaStart = 4;
            deltaTotal += 4;
            return indented;
        });
    } else {
        // Unindent each line by up to 4 spaces
        modifiedLines = lines.map((line, idx) => {
            let removed = 0;
            if (line.startsWith('    ')) removed = 4;
            else if (line.startsWith('\t')) removed = 1;
            else {
                const spaces = line.match(/^ {1,3}/);
                if (spaces) removed = spaces[0].length;
            }
            if (idx === 0) deltaStart = -removed;
            deltaTotal -= removed;
            return line.substring(removed);
        });
    }

    const newValue = value.substring(0, blockStart) + modifiedLines.join('\n') + value.substring(blockEnd);
    return {
        value: newValue,
        selectionStart: Math.max(blockStart, selectionStart + deltaStart),
        selectionEnd: Math.max(blockStart, selectionEnd + deltaTotal)
    };
}

/**
 * Map of open-to-close bracket pairs.
 */
const BRACKET_PAIRS = {
    '(': ')',
    '[': ']',
    '{': '}',
    '"': '"',
    "'": "'",
    '`': '`'
};

const CLOSING_CHARS = new Set([')', ']', '}', '"', "'", '`']);

/**
 * Check if typing a character should auto-close a bracket/quote pair.
 *
 * @param {string} char
 * @param {string} value
 * @param {number} selectionStart
 * @param {number} selectionEnd
 * @returns {{handled: boolean, value?: string, selectionStart?: number, selectionEnd?: number}}
 */
function handleBracketPairing(char, value, selectionStart, selectionEnd) {
    // Skip over already-typed closing character
    const nextChar = value.charAt(selectionStart);
    if (CLOSING_CHARS.has(char) && nextChar === char && selectionStart === selectionEnd) {
        return {
            handled: true,
            value,
            selectionStart: selectionStart + 1,
            selectionEnd: selectionStart + 1
        };
    }

    if (!BRACKET_PAIRS[char]) return { handled: false };

    const closeChar = BRACKET_PAIRS[char];

    // If text is selected, wrap the selection in the pair
    if (selectionStart !== selectionEnd) {
        const selected = value.substring(selectionStart, selectionEnd);
        const before = value.substring(0, selectionStart);
        const after = value.substring(selectionEnd);
        return {
            handled: true,
            value: before + char + selected + closeChar + after,
            selectionStart: selectionStart + 1,
            selectionEnd: selectionEnd + 1
        };
    }

    // Auto-insert pair
    const before = value.substring(0, selectionStart);
    const after = value.substring(selectionEnd);
    return {
        handled: true,
        value: before + char + closeChar + after,
        selectionStart: selectionStart + 1,
        selectionEnd: selectionStart + 1
    };
}

/**
 * Compute statistics (line count, character count) of code.
 *
 * @param {string} code
 * @returns {{lines: number, chars: number}}
 */
function computeCodeStats(code) {
    if (!code) return { lines: 0, chars: 0 };
    const lines = code.split('\n').length;
    const chars = code.length;
    return { lines, chars };
}

/**
 * Generate storage key for solution draft per problem.
 *
 * @param {string|number} contestId
 * @param {string} index
 * @returns {string}
 */
function draftStorageKey(contestId, index) {
    const cid = String(contestId || 'general').trim();
    const idx = String(index || 'main').trim().toUpperCase();
    return `ff_draft_${cid}_${idx}`;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        CODE_TEMPLATES,
        computeNewlineIndent,
        applyTabIndentation,
        handleBracketPairing,
        computeCodeStats,
        draftStorageKey,
        BRACKET_PAIRS
    };
}
