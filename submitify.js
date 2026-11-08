/**
 * FocusForces — Submitify (Production-Quality Inline Code Editor & Draft Safety)
 *
 * Replaces the file-upload input with an intelligent code editor featuring:
 * - Real-time draft auto-saving & crash recovery
 * - Smart indentation (Tab & Shift+Tab)
 * - Auto-closing bracket/quote pairing
 * - Newline indentation continuation
 * - C++, Python, Java boilerplate templates
 * - Line & character statistics
 * - Compiler memory across problems
 */

(function () {
    'use strict';

    /* globals CODE_TEMPLATES, computeNewlineIndent, applyTabIndentation, handleBracketPairing, computeCodeStats, draftStorageKey */

    const DRAFT_DEBOUNCE_MS = 600;

    function getProblemIdentity() {
        const pathname = window.location.pathname;
        const contestMatch = pathname.match(/\/(?:contest|gym)\/(\d+)\/problem\/([a-zA-Z0-9]+)/i);
        if (contestMatch) return { contestId: contestMatch[1], index: contestMatch[2].toUpperCase() };

        const problemsetMatch = pathname.match(/\/problemset\/problem\/(\d+)\/([a-zA-Z0-9]+)/i);
        if (problemsetMatch) return { contestId: problemsetMatch[1], index: problemsetMatch[2].toUpperCase() };

        // Also check if we are on the dedicated submit page: /contest/123/submit or /problemset/submit
        const submitMatch = pathname.match(/\/(?:contest|gym)\/(\d+)\/submit/i);
        const problemSelect = document.querySelector('select[name="submittedProblemIndex"]');
        if (submitMatch) {
            return {
                contestId: submitMatch[1],
                index: problemSelect ? problemSelect.value.toUpperCase() : 'SUBMIT'
            };
        }

        return { contestId: 'general', index: 'main' };
    }

    async function initSubmitify() {
        const input = document.querySelector('input[name="sourceFile"]');
        if (!input) return;

        const { contestId, index } = getProblemIdentity();
        const storageKey = typeof draftStorageKey === 'function'
            ? draftStorageKey(contestId, index)
            : `ff_draft_${contestId}_${index}`;

        // Resolve wrapping label before DOM detachment
        const label = input.closest('.field')?.querySelector('label') || input.labels?.[0];
        if (label) label.textContent = 'Solution Code:';

        // ── Container Setup ─────────────────────────────
        const container = document.createElement('div');
        container.className = 'ff-submitify-container';

        // ── Top Action Toolbar ──────────────────────────
        const toolbar = document.createElement('div');
        toolbar.className = 'ff-submitify-toolbar';

        const toolLeft = document.createElement('div');
        toolLeft.className = 'ff-submitify-tool-group';

        // Template Picker
        const templateBtn = document.createElement('button');
        templateBtn.type = 'button';
        templateBtn.className = 'ff-submitify-tool-btn';
        templateBtn.textContent = '📄 Template ▾';
        templateBtn.title = 'Insert boilerplate template';

        const templateMenu = document.createElement('div');
        templateMenu.className = 'ff-submitify-dropdown';
        templateMenu.hidden = true;

        const tplCpp = document.createElement('button');
        tplCpp.type = 'button';
        tplCpp.className = 'ff-submitify-dropdown-item';
        tplCpp.textContent = 'C++ Fast I/O';
        tplCpp.addEventListener('click', () => insertTemplate('cpp'));

        const tplPy = document.createElement('button');
        tplPy.type = 'button';
        tplPy.className = 'ff-submitify-dropdown-item';
        tplPy.textContent = 'Python 3 / PyPy';
        tplPy.addEventListener('click', () => insertTemplate('python'));

        const tplJava = document.createElement('button');
        tplJava.type = 'button';
        tplJava.className = 'ff-submitify-dropdown-item';
        tplJava.textContent = 'Java Fast I/O';
        tplJava.addEventListener('click', () => insertTemplate('java'));

        templateMenu.append(tplCpp, tplPy, tplJava);
        templateBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            templateMenu.hidden = !templateMenu.hidden;
        });
        document.addEventListener('click', () => { templateMenu.hidden = true; });

        toolLeft.append(templateBtn, templateMenu);

        const toolRight = document.createElement('div');
        toolRight.className = 'ff-submitify-tool-group';

        // Draft Status Badge
        const draftBadge = document.createElement('span');
        draftBadge.className = 'ff-submitify-draft-badge';
        draftBadge.textContent = 'Draft ready';

        // Copy Code Button
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'ff-submitify-tool-btn';
        copyBtn.textContent = '📋 Copy';
        copyBtn.title = 'Copy all code to clipboard';

        // Clear Code Button
        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'ff-submitify-tool-btn';
        clearBtn.textContent = '🗑️ Clear';
        clearBtn.title = 'Clear code and discard saved draft';

        toolRight.append(draftBadge, copyBtn, clearBtn);
        toolbar.append(toolLeft, toolRight);

        // ── Textarea ───────────────────────────────────
        const textarea = document.createElement('textarea');
        textarea.className = 'ff-submitify-textarea';
        textarea.placeholder = '// Paste or write your solution here (Ctrl+Enter to submit)\n// FocusForces auto-saves your draft in real-time';
        textarea.spellcheck = false;

        // Copy attributes from original file input
        input.getAttributeNames().forEach(name => {
            if (!name.startsWith('on') && name !== 'type' && name !== 'class') {
                textarea.setAttribute(name, input.getAttribute(name));
            }
        });

        // ── Bottom Status Bar ───────────────────────────
        const statusBar = document.createElement('div');
        statusBar.className = 'ff-submitify-statusbar';

        const statsText = document.createElement('span');
        statsText.className = 'ff-submitify-stats';
        statsText.textContent = '0 lines · 0 chars';

        const shortcutHint = document.createElement('span');
        shortcutHint.className = 'ff-submitify-hint';
        shortcutHint.textContent = 'Ctrl+Enter to submit · Tab to indent';

        statusBar.append(statsText, shortcutHint);

        container.append(toolbar, textarea, statusBar);
        input.replaceWith(container);

        // ── Form Target Setup ───────────────────────────
        const form = document.querySelector('.submitForm') || container.closest('form');
        if (form) {
            form.setAttribute('target', '_blank');
        }

        const submitBtn = document.querySelector('.submit') || form?.querySelector('input[type="submit"]');

        // ── Update Code Statistics ──────────────────────
        function updateStats() {
            if (typeof computeCodeStats === 'function') {
                const { lines, chars } = computeCodeStats(textarea.value);
                statsText.textContent = `${lines} ${lines === 1 ? 'line' : 'lines'} · ${chars} ${chars === 1 ? 'char' : 'chars'}`;
            } else {
                const lines = textarea.value.split('\n').length;
                statsText.textContent = `${lines} lines · ${textarea.value.length} chars`;
            }
        }

        // ── Insert Template ─────────────────────────────
        function insertTemplate(lang) {
            const tpl = (typeof CODE_TEMPLATES !== 'undefined' && CODE_TEMPLATES[lang]) || '';
            if (!tpl) return;
            if (textarea.value.trim().length > 0) {
                if (!window.confirm('Replace current editor contents with template?')) return;
            }
            textarea.value = tpl;
            updateStats();
            triggerSaveDraft();
            textarea.focus();
        }

        // ── Copy & Clear Actions ────────────────────────
        copyBtn.addEventListener('click', async () => {
            if (!textarea.value) return;
            try {
                await navigator.clipboard.writeText(textarea.value);
                copyBtn.textContent = '✓ Copied';
                setTimeout(() => { copyBtn.textContent = '📋 Copy'; }, 1600);
            } catch (_) {}
        });

        clearBtn.addEventListener('click', async () => {
            if (!textarea.value) return;
            if (window.confirm('Clear all code and discard draft?')) {
                textarea.value = '';
                updateStats();
                draftBadge.textContent = 'Draft cleared';
                try {
                    await chrome.storage.local.remove(storageKey);
                } catch (_) {}
            }
        });

        // ── Draft Persistence ───────────────────────────
        let saveTimeout = null;
        function triggerSaveDraft() {
            draftBadge.textContent = 'Saving…';
            draftBadge.classList.add('saving');
            if (saveTimeout) clearTimeout(saveTimeout);
            saveTimeout = setTimeout(async () => {
                const code = textarea.value;
                try {
                    if (code.trim().length > 0) {
                        await chrome.storage.local.set({
                            [storageKey]: {
                                code,
                                ts: Date.now()
                            }
                        });
                        draftBadge.textContent = '✓ Saved';
                    } else {
                        await chrome.storage.local.remove(storageKey);
                        draftBadge.textContent = 'Empty';
                    }
                } catch (_) {
                    draftBadge.textContent = 'Save error';
                } finally {
                    draftBadge.classList.remove('saving');
                }
            }, DRAFT_DEBOUNCE_MS);
        }

        // Restore draft on load
        try {
            const stored = await chrome.storage.local.get(storageKey);
            const draft = stored[storageKey];
            if (draft && draft.code && !textarea.value) {
                textarea.value = draft.code;
                draftBadge.textContent = 'Draft restored';
                draftBadge.classList.add('restored');
                updateStats();
            }
        } catch (_) {}

        // ── Editor Keyboard Mechanics ───────────────────
        textarea.addEventListener('input', () => {
            updateStats();
            triggerSaveDraft();
        });

        textarea.addEventListener('keydown', (e) => {
            // Ctrl+Enter or Cmd+Enter: Submit Solution
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                if (submitBtn) submitBtn.click();
                else if (form) form.submit();
                return;
            }

            // Tab or Shift+Tab: Indentation
            if (e.key === 'Tab') {
                e.preventDefault();
                if (typeof applyTabIndentation === 'function') {
                    const res = applyTabIndentation(textarea.value, textarea.selectionStart, textarea.selectionEnd, e.shiftKey);
                    textarea.value = res.value;
                    textarea.selectionStart = res.selectionStart;
                    textarea.selectionEnd = res.selectionEnd;
                } else {
                    const start = textarea.selectionStart;
                    const end = textarea.selectionEnd;
                    textarea.value = textarea.value.substring(0, start) + '    ' + textarea.value.substring(end);
                    textarea.selectionStart = textarea.selectionEnd = start + 4;
                }
                updateStats();
                triggerSaveDraft();
                return;
            }

            // Enter Key: Auto-indentation continuation
            if (e.key === 'Enter' && typeof computeNewlineIndent === 'function') {
                const { indent, extraClose } = computeNewlineIndent(textarea.value, textarea.selectionStart);
                if (indent) {
                    e.preventDefault();
                    const start = textarea.selectionStart;
                    const end = textarea.selectionEnd;
                    const insert = '\n' + indent + (extraClose ? '\n' + indent.substring(4) : '');
                    textarea.value = textarea.value.substring(0, start) + insert + textarea.value.substring(end);
                    const newPos = start + 1 + indent.length;
                    textarea.selectionStart = textarea.selectionEnd = newPos;
                    updateStats();
                    triggerSaveDraft();
                    return;
                }
            }

            // Bracket / Quote Auto-closing
            if (typeof handleBracketPairing === 'function' && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
                const res = handleBracketPairing(e.key, textarea.value, textarea.selectionStart, textarea.selectionEnd);
                if (res.handled) {
                    e.preventDefault();
                    textarea.value = res.value;
                    textarea.selectionStart = res.selectionStart;
                    textarea.selectionEnd = res.selectionEnd;
                    updateStats();
                    triggerSaveDraft();
                    return;
                }
            }
        });

        // ── Compiler Selection Memory ───────────────────
        const select = document.querySelector("select[name='programTypeId']");
        const COMPILER_KEY = 'ff_preferred_compiler';

        if (select) {
            try {
                const { [COMPILER_KEY]: pref } = await chrome.storage.local.get(COMPILER_KEY);
                if (pref && select.querySelector(`option[value="${pref}"]`)) {
                    select.value = pref;
                }
            } catch (_) {}

            select.addEventListener('change', () => {
                try {
                    chrome.storage.local.set({ [COMPILER_KEY]: select.value });
                } catch (_) {}
            });
        }

        // ── Language-specific notices ───────────────────
        const noticeEl = document.querySelector('.programTypeNotice');
        if (noticeEl && select) {
            const pypyIds = new Set([7, 31, 70]);
            function updateNotice() {
                const id = parseInt(select.value, 10);
                noticeEl.textContent = pypyIds.has(id)
                    ? 'Almost always, if you send a solution on PyPy, it works much faster'
                    : '';
            }
            select.addEventListener('change', updateNotice);
            updateNotice();
        }

        updateStats();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSubmitify);
    } else {
        initSubmitify();
    }
})();
