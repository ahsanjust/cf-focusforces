/**
 * FocusForces — AC Celebration
 *
 * A calm, tasteful burst of light when a Codeforces submission is Accepted —
 * the quiet cousin of Zen Paws. Rather than confetti, a soft expanding ring,
 * a gentle "Accepted" pill, and a few glowing sparks that drift outward and
 * fade. Implementation mirrors catwalk.js:
 *
 *   • Shadow DOM host → zero style bleed with Codeforces.
 *   • pointer-events: none → the burst never blocks clicks or scrolling.
 *   • Pure CSS keyframe animations on transform/opacity (GPU-composited);
 *     nodes are removed after the animation completes.
 *   • Dedup is problem-scoped and persisted, so a page reload after the
 *     post-submit redirect never re-fires, and old solved problems don't
 *     spam you on every revisit.
 *   • prefers-reduced-motion is respected — the burst stays fully off.
 *
 * Pure logic (URL parsing, dedup decisions, particle geometry) lives in
 * ac-utils.js (unit-tested). This file is the thin DOM/animation driver.
 */

(function () {
    'use strict';

    if (!chrome?.storage?.local) {
        console.warn('FocusForces: chrome.storage API unavailable — AC Celebration disabled.');
        return;
    }

    // ── Config ──────────────────────────────────────────
    const STORAGE_KEY = 'ff_acCelebrate';
    const DEDUP_PREFIX = 'ff_ac_celebrated_';
    const OVERLAY_Z_INDEX = 2147483645;   // just below Zen Paws, above everything else
    const DEDUP_MAX_KEYS = 300;           // above this, prune keys older than DEDUP_TTL_MS
    const DEDUP_TTL_MS = 14 * 24 * 60 * 60 * 1000;

    // ── State ───────────────────────────────────────────
    let enabled = false;
    let host = null;
    let shadow = null;
    let layer = null;
    let observer = null;
    let sessionSeen = new Set();
    let celebratedCache = {};   // dedup key -> timestamp
    let audioCtx = null;

    const reducedMotion = window.matchMedia
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;

    // ── Overlay styles (Shadow DOM — fully isolated) ────
    const OVERLAY_CSS = `
:host {
  all: initial;
  --ac-color: #34d399;
  --ac-color-soft: rgba(52, 211, 153, 0.85);
  --ac-label-bg: rgba(255, 255, 255, 0.95);
  --ac-label-fg: #15803d;
}
:host([data-ac-theme="dark"]),
:host([data-ac-theme="amoled"]) {
  --ac-color: #6ee7b7;
  --ac-color-soft: rgba(110, 231, 183, 0.9);
  --ac-label-bg: rgba(22, 40, 34, 0.96);
  --ac-label-fg: #6ee7b7;
}
:host([data-ac-theme="contrast"]) {
  --ac-color: #22c55e;
  --ac-color-soft: rgba(34, 197, 94, 0.95);
  --ac-label-bg: rgba(0, 0, 0, 0.92);
  --ac-label-fg: #4ade80;
}

.ff-ac-layer {
  position: fixed;
  inset: 0;
  z-index: ${OVERLAY_Z_INDEX};
  pointer-events: none;
  overflow: hidden;
}

/* A single burst, rooted at its center point. */
.ff-ac-burst {
  position: absolute;
  left: 0;
  top: 0;
  width: 0;
  height: 0;
}

.ff-ac-ring {
  position: absolute;
  left: 0;
  top: 0;
  width: 18px;
  height: 18px;
  border: 2.5px solid var(--ac-color);
  border-radius: 50%;
  opacity: 0;
  animation: ff-ac-ring 0.95s ease-out forwards;
}
@keyframes ff-ac-ring {
  0%   { transform: translate(-50%, -50%) scale(0.25); opacity: 0.85; }
  100% { transform: translate(-50%, -50%) scale(1.7); opacity: 0; }
}

.ff-ac-label {
  position: absolute;
  left: 0;
  top: -34px;
  transform: translateX(-50%);
  background: var(--ac-label-bg);
  color: var(--ac-label-fg);
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.25;
  padding: 3px 11px;
  border-radius: 999px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
  white-space: nowrap;
  opacity: 0;
  animation: ff-ac-label 1.4s ease-out forwards;
}
@keyframes ff-ac-label {
  0%   { opacity: 0; transform: translateX(-50%) translateY(6px) scale(0.85); }
  18%  { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
  70%  { opacity: 1; }
  100% { opacity: 0; transform: translateX(-50%) translateY(-6px) scale(0.95); }
}

.ff-ac-spark {
  position: absolute;
  left: 0;
  top: 0;
  width: var(--sz, 4px);
  height: var(--sz, 4px);
  border-radius: 50%;
  background: radial-gradient(circle, #fff 0%, var(--ac-color-soft) 45%, transparent 70%);
  box-shadow: 0 0 8px 2px var(--ac-color-soft);
  opacity: 0;
  animation: ff-ac-spark var(--dur, 1s) ease-out var(--del, 0s) forwards;
}
@keyframes ff-ac-spark {
  0%   { transform: translate(-50%, -50%) scale(0.3); opacity: 0; }
  15%  { opacity: 0.95; }
  100% { transform: translate(calc(-50% + var(--tx, 0px)), calc(-50% + var(--ty, 0px))) scale(0.6); opacity: 0; }
}
`;

    // ── Helpers ─────────────────────────────────────────
    function currentTheme() {
        try {
            return document.documentElement.getAttribute('data-ff-theme') || 'default';
        } catch (_) {
            return 'default';
        }
    }

    function applyTheme() {
        if (!host) return;
        host.setAttribute('data-ac-theme', currentTheme());
    }

    // ── Overlay lifecycle ───────────────────────────────
    function ensureOverlay() {
        if (host) return;
        host = document.createElement('div');
        host.id = 'ff-ac-burst';
        shadow = host.attachShadow({ mode: 'closed' });
        const style = document.createElement('style');
        style.textContent = OVERLAY_CSS;
        layer = document.createElement('div');
        layer.className = 'ff-ac-layer';
        shadow.append(style, layer);
        applyTheme();
        (document.documentElement || document.body).appendChild(host);
    }

    /**
     * Spawn a burst at a screen point. Pure CSS keyframes; nodes are removed
     * after the animation window closes.
     */
    function spawnBurst(x, y) {
        if (!layer) return;
        const root = document.createElement('div');
        root.className = 'ff-ac-burst';
        root.style.left = `${Math.round(x)}px`;
        root.style.top = `${Math.round(y)}px`;

        const ring = document.createElement('div');
        ring.className = 'ff-ac-ring';
        root.appendChild(ring);

        const label = document.createElement('div');
        label.className = 'ff-ac-label';
        label.textContent = 'Accepted';
        root.appendChild(label);

        pickBurstParticles({}).forEach(p => {
            const s = document.createElement('div');
            s.className = 'ff-ac-spark';
            s.style.setProperty('--tx', `${(Math.cos(p.angle) * p.dist).toFixed(1)}px`);
            s.style.setProperty('--ty', `${(Math.sin(p.angle) * p.dist).toFixed(1)}px`);
            s.style.setProperty('--sz', `${p.size.toFixed(1)}px`);
            s.style.setProperty('--dur', `${(p.dur / 1000).toFixed(2)}s`);
            s.style.setProperty('--del', `${(p.delay / 1000).toFixed(2)}s`);
            root.appendChild(s);
        });

        layer.appendChild(root);
        setTimeout(() => root.remove(), 1600);
    }

    // ── Audio — a soft two-note "ding" ──────────────────
    function playChime() {
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return;
            audioCtx = audioCtx || new Ctx();
            if (audioCtx.state === 'suspended') audioCtx.resume();
            const t = audioCtx.currentTime;
            [523.25, 659.25, 783.99].forEach((freq, i) => {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                const start = t + i * 0.09;
                osc.type = 'sine';
                osc.frequency.value = freq;
                gain.gain.setValueAtTime(0, start);
                gain.gain.linearRampToValueAtTime(0.06, start + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.7);
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.start(start);
                osc.stop(start + 0.8);
            });
        } catch (_) {}
    }

    // ── Celebration ─────────────────────────────────────
    /**
     * Resolve a verdict element to its submission id (via the closest
     * [data-submission-id] row) and, when it passes dedup, fire a celebration.
     */
    function tryCelebrateFromEl(verdictEl) {
        if (!enabled) return;
        const row = verdictEl.closest?.('[data-submission-id]') || null;
        const submissionId = row?.getAttribute('data-submission-id') || null;
        const problem = parseProblemKeyFromPath(window.location.pathname);
        const key = celebrateDedupKey(problem, submissionId);
        if (!shouldCelebrate(sessionSeen, celebratedCache, key)) return;

        sessionSeen.add(key);
        celebratedCache[key] = Date.now();
        chrome.storage.local.set({ [key]: Date.now() }).catch(() => {});
        pruneCacheIfNeeded();

        if (reducedMotion && reducedMotion.matches) return; // respect the OS
        ensureOverlay();
        applyTheme();
        const r = verdictEl.getBoundingClientRect();
        spawnBurst(r.left + r.width / 2, r.top + r.height / 2);
        playChime();
    }

    function pruneCacheIfNeeded() {
        if (Object.keys(celebratedCache).length <= DEDUP_MAX_KEYS) return;
        const cutoff = Date.now() - DEDUP_TTL_MS;
        const stale = Object.keys(celebratedCache).filter(k => celebratedCache[k] < cutoff);
        if (!stale.length) return;
        stale.forEach(k => delete celebratedCache[k]);
        chrome.storage.local.remove(stale).catch(() => {});
    }

    // ── Detection ───────────────────────────────────────
    function collectVerdictsFromNode(node) {
        const verdicts = [];
        if (node.matches?.('.verdict-accepted')) verdicts.push(node);
        if (node.querySelectorAll) {
            node.querySelectorAll('.verdict-accepted').forEach(v => verdicts.push(v));
        }
        return verdicts;
    }

    function onMutations(mutations) {
        if (!enabled) return;
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (node.nodeType !== 1) continue;
                const verdicts = collectVerdictsFromNode(node);
                for (const v of verdicts) {
                    // Sanity check: the verdict really is Accepted (class plus text).
                    if (!isAcceptedToken(v.textContent || v.innerText || '')) continue;
                    tryCelebrateFromEl(v);
                }
            }
        }
    }

    /**
     * Initial scan: the classic Codeforces submit flow reloads the page, so
     * the freshly-Accepted submission is already in the DOM at load. Only the
     * top (newest) accepted row is considered, and dedup ensures an old solved
     * problem never re-fires.
     */
    function initialScan() {
        if (!enabled) return;
        const verdicts = document.querySelectorAll('.verdict-accepted');
        for (const v of verdicts) {
            if (!isAcceptedToken(v.textContent || v.innerText || '')) continue;
            tryCelebrateFromEl(v);
            break; // just the newest row
        }
    }

    // ── Lifecycle ───────────────────────────────────────
    function start() {
        if (enabled) return;
        if (reducedMotion && reducedMotion.matches) {
            // Feature stays "on" but nothing renders; still record dedup so a
            // future session with motion enabled isn't surprised by stale pops.
            enabled = true;
            return;
        }
        enabled = true;
        ensureOverlay();

        if (observer) observer.disconnect();
        observer = new MutationObserver(onMutations);
        observer.observe(document.documentElement || document.body, { childList: true, subtree: true });

        initialScan();
    }

    function stop() {
        if (!enabled) return;
        enabled = false;
        if (observer) { observer.disconnect(); observer = null; }
        if (host) {
            host.remove();
            host = null;
            shadow = null;
            layer = null;
        }
    }

    // ── Boot ────────────────────────────────────────────
    (async () => {
        try {
            const all = await chrome.storage.local.get(null);
            for (const k of Object.keys(all)) {
                if (k.startsWith(DEDUP_PREFIX)) celebratedCache[k] = all[k];
            }
            if (all[STORAGE_KEY]) start();
        } catch (e) {
            console.debug('FocusForces: failed to load AC Celebration state', e);
        }
    })();

    chrome.runtime.onMessage.addListener(req => {
        if (req && req.type === 'AC_CELEBRATE_TOGGLED') {
            if (req.enabled) start(); else stop();
        }
    });

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.ff_acCelebrate) {
            if (changes.ff_acCelebrate.newValue) start(); else stop();
        }
        if (changes.ff_theme && enabled) {
            applyTheme();
        }
    });

    // Re-scan once the late-rendered sidebar settles (post-submit reload).
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialScan);
    } else {
        initialScan();
    }
})();