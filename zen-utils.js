/**
 * FocusForces - Zen Mode Utilities
 * Pure logic and helpers for the distraction-free problem solving workspace.
 */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.ZenUtils = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const ZEN_WIDTH_PRESETS = {
        compact: 780,
        comfortable: 920,
        expansive: 1080
    };

    const ZEN_FONT_PRESETS = {
        normal: '15px',
        large: '16.5px',
        xlarge: '18px'
    };

    /**
     * Compute effective canvas width in pixels based on user preference and viewport width.
     * Guarantees at least 24px horizontal gutters on small viewports.
     * @param {string} preset 'compact' | 'comfortable' | 'expansive'
     * @param {number} viewportWidth
     * @returns {number} width in px
     */
    function computeZenWidth(preset, viewportWidth) {
        const target = ZEN_WIDTH_PRESETS[preset] || ZEN_WIDTH_PRESETS.comfortable;
        const maxAvailable = Math.max(320, (viewportWidth || 1200) - 48);
        return Math.min(target, maxAvailable);
    }

    /**
     * Resolve font size preset.
     * @param {string} preset 'normal' | 'large' | 'xlarge'
     * @returns {string} font size CSS string
     */
    function resolveZenFontSize(preset) {
        return ZEN_FONT_PRESETS[preset] || ZEN_FONT_PRESETS.normal;
    }

    /**
     * Detect platform from hostname.
     * @param {string} hostname
     * @returns {'codeforces' | 'atcoder' | 'codechef' | 'other'}
     */
    function detectPlatform(hostname) {
        if (!hostname || typeof hostname !== 'string') return 'other';
        const h = hostname.toLowerCase();
        if (h.includes('codeforces.com')) return 'codeforces';
        if (h.includes('atcoder.jp')) return 'atcoder';
        if (h.includes('codechef.com')) return 'codechef';
        return 'other';
    }

    /**
     * Pure formatter for the floating Zen toolbar timer badge.
     * Takes timer state object and current timestamp.
     * @param {object|null} state ff_timer_state from storage
     * @param {number} now current timestamp ms
     * @returns {{ text: string, status: string, mode: string, isDanger: boolean, isRunning: boolean }}
     */
    function formatZenTimerBadge(state, now) {
        const defaultResult = {
            text: '25:00',
            status: 'READY',
            mode: 'countdown',
            isDanger: false,
            isRunning: false
        };

        if (!state || typeof state !== 'object') return defaultResult;

        const status = state.status || 'READY';
        const mode = state.mode || 'countdown';
        const isRunning = status === 'RUNNING';

        if (status === 'FINISHED') {
            return {
                text: 'Done! 🎉',
                status: 'FINISHED',
                mode,
                isDanger: true,
                isRunning: false
            };
        }

        if (status === 'PAUSED') {
            const ms = Math.max(0, state.remainingMs || 0);
            return {
                text: `${formatMs(ms)} (paused)`,
                status: 'PAUSED',
                mode,
                isDanger: false,
                isRunning: false
            };
        }

        if (isRunning) {
            if (mode === 'stopwatch') {
                const elapsed = (state.accumulatedMs || 0) + Math.max(0, now - (state.lastStarted || now));
                return {
                    text: formatMs(elapsed),
                    status: 'RUNNING',
                    mode: 'stopwatch',
                    isDanger: false,
                    isRunning: true
                };
            }

            // Countdown mode
            const end = state.endTime || (now + (state.remainingMs || 0));
            const leftMs = Math.max(0, end - now);
            const isDanger = leftMs <= 5 * 60 * 1000 && (state.durationMs || 0) >= 10 * 60 * 1000;
            return {
                text: formatMs(leftMs),
                status: 'RUNNING',
                mode: 'countdown',
                isDanger,
                isRunning: true
            };
        }

        // Ready state
        const readyMs = state.durationMs || 25 * 60 * 1000;
        return {
            text: formatMs(readyMs),
            status: 'READY',
            mode,
            isDanger: false,
            isRunning: false
        };
    }

    /**
     * Format milliseconds to MM:SS or HH:MM:SS.
     * @param {number} ms
     * @returns {string}
     */
    function formatMs(ms) {
        const totalSec = Math.ceil(Math.max(0, ms) / 1000);
        const hours = Math.floor(totalSec / 3600);
        const minutes = Math.floor((totalSec % 3600) / 60);
        const seconds = totalSec % 60;

        const pad = (n) => String(n).padStart(2, '0');
        if (hours > 0) {
            return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
        }
        return `${pad(minutes)}:${pad(seconds)}`;
    }

    /**
     * Clean and normalize code text for clipboard copy.
     * @param {string} text
     * @returns {string}
     */
    function cleanSampleText(text) {
        if (!text || typeof text !== 'string') return '';
        // Normalize CRLF to LF, strip trailing blank lines but preserve indent
        return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\s+$/, '');
    }

    /**
     * Extract structured problem metadata (limits, contest, title) from Codeforces DOM.
     * @param {Document|Element} doc
     * @returns {{ title: string, timeLimit: string, memoryLimit: string, inputType: string, outputType: string }}
     */
    function extractCodeforcesProblemMeta(doc) {
        if (!doc) return { title: '', timeLimit: '', memoryLimit: '', inputType: '', outputType: '' };

        const titleEl = doc.querySelector('.problem-statement .header .title');
        const timeEl = doc.querySelector('.problem-statement .header .time-limit');
        const memEl = doc.querySelector('.problem-statement .header .memory-limit');
        const inEl = doc.querySelector('.problem-statement .header .input-file');
        const outEl = doc.querySelector('.problem-statement .header .output-file');

        const clean = (el, prefix) => {
            if (!el) return '';
            let text = el.textContent || '';
            if (prefix && text.toLowerCase().includes(prefix.toLowerCase())) {
                text = text.substring(text.toLowerCase().indexOf(prefix.toLowerCase()) + prefix.length);
            }
            return text.replace(/^[:\s]+/, '').trim();
        };

        return {
            title: titleEl ? titleEl.textContent.trim() : '',
            timeLimit: clean(timeEl, 'time limit per test'),
            memoryLimit: clean(memEl, 'memory limit per test'),
            inputType: clean(inEl, 'input') || 'standard input',
            outputType: clean(outEl, 'output') || 'standard output'
        };
    }

    /**
     * Compute scroll progress as a percentage between 0 and 100.
     * @param {number} scrollTop
     * @param {number} scrollHeight
     * @param {number} clientHeight
     * @returns {number} percentage 0 - 100
     */
    function computeScrollProgress(scrollTop, scrollHeight, clientHeight) {
        const total = scrollHeight - clientHeight;
        if (total <= 0) return 0;
        return Math.min(100, Math.max(0, Math.round((scrollTop / total) * 100)));
    }

    /**
     * Parse competitive programming problem context from tab URL and document title.
     * @param {string} url
     * @param {string} title
     * @returns {{platform: string, code: string, title: string, url: string}|null}
     */
    function parseProblemContext(url, title) {
        if (!url) return null;
        const normUrl = url.toLowerCase();
        const rawTitle = (title || '').replace(/ - Codeforces$/i, '').replace(/ - AtCoder$/i, '').replace(/ \| CodeChef$/i, '').trim();

        // Codeforces
        const cfMatch = normUrl.match(/codeforces\.com\/(?:contest|gym)\/(\d+)\/problem\/([a-z0-9]+)/i)
            || normUrl.match(/codeforces\.com\/problemset\/problem\/(\d+)\/([a-z0-9]+)/i);
        if (cfMatch) {
            const code = `CF ${cfMatch[1]}${cfMatch[2].toUpperCase()}`;
            return {
                platform: 'Codeforces',
                code,
                title: rawTitle || code,
                url
            };
        }

        // AtCoder
        const atcMatch = normUrl.match(/atcoder\.jp\/contests\/([^/]+)\/tasks\/([^/]+)/i);
        if (atcMatch) {
            const code = atcMatch[1].toUpperCase();
            return {
                platform: 'AtCoder',
                code,
                title: rawTitle || code,
                url
            };
        }

        // CodeChef
        const ccMatch = normUrl.match(/codechef\.com\/problems\/([^/?#]+)/i);
        if (ccMatch) {
            const code = ccMatch[1].toUpperCase();
            return {
                platform: 'CodeChef',
                code,
                title: rawTitle || code,
                url
            };
        }

        return null;
    }

    return {
        ZEN_WIDTH_PRESETS,
        ZEN_FONT_PRESETS,
        computeZenWidth,
        resolveZenFontSize,
        detectPlatform,
        formatZenTimerBadge,
        formatMs,
        cleanSampleText,
        extractCodeforcesProblemMeta,
        computeScrollProgress,
        parseProblemContext
    };
}));
