/**
 * FocusForces — Inline Submit (Submitify)
 * Replaces the file-upload input with a textarea for direct code submission.
 */
(function () {
    'use strict';

    function initSubmitify() {
        const input = document.querySelector('input[name="sourceFile"]');
        if (!input) return;

        // ── Update label ──────────────────────────────────
        // Resolve the label BEFORE detaching `input` via replaceWith below —
        // Element.closest() walks ancestors and returns null for a detached
        // node, and input.labels no longer reflects wrapping <label> ancestors
        // once the input is out of the document.
        const label = input.closest('.field')?.querySelector('label')
            || input.labels?.[0];

        // ── Replace file input with textarea ──────────────
        const textarea = document.createElement('textarea');
        input.getAttributeNames().forEach(name => {
            if (!name.startsWith('on')) {
                textarea.setAttribute(name, input.getAttribute(name));
            }
        });
        input.replaceWith(textarea);

        if (label) label.textContent = 'Put Code Here:';

        // ── Open submission in new tab ────────────────────
        const form = document.querySelector('.submitForm');
        if (form) {
            form.setAttribute('target', '_blank');
        }

        // ── Select all code on submit click ───────────────
        const submitBtn = document.querySelector('.submit');
        if (submitBtn) {
            submitBtn.addEventListener('click', () => textarea.select());
        }

        // ── Language-specific notices ─────────────────────
        const noticeEl = document.querySelector('.programTypeNotice');
        if (noticeEl) {
            const pypyIds = new Set([7, 31]);

            function updateNotice() {
                const select = document.querySelector("select[name='programTypeId']");
                if (!select) return;
                const id = parseInt(select.value, 10);
                noticeEl.textContent = pypyIds.has(id)
                    ? 'Almost always, if you send a solution on PyPy, it works much faster'
                    : '';
            }

            const select = document.querySelector("select[name='programTypeId']");
            if (select) {
                select.addEventListener('change', updateNotice);
                updateNotice();
            }
        }
    }

    // Wait for DOM to be ready — script runs at document_start
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSubmitify);
    } else {
        initSubmitify();
    }
})();
