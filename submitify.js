/**
 * FocusForces — Inline Submit (Submitify)
 * Replaces the file-upload input with a textarea for direct code submission.
 */
(function () {
    'use strict';

    const input = document.querySelector('input[name="sourceFile"]');
    if (!input) return;

    // ── Replace file input with textarea ──────────────
    const textarea = document.createElement('textarea');
    input.getAttributeNames().forEach(name => {
        textarea.setAttribute(name, input.getAttribute(name));
    });
    input.replaceWith(textarea);

    // ── Update label ──────────────────────────────────
    const fields = document.querySelectorAll('.field');
    if (fields.length >= 2) {
        fields[1].textContent = 'Put Code Here:';
    }

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
})();
