/**
 * FocusForces — Zen Paws (Cat Walk)
 *
 * A peaceful overlay of small SVG cats roaming the bottom of the page.
 * Pure logic (movement, meetings, paw prints, palettes) lives in
 * catwalk-utils.js (unit-tested). This file is the thin animation driver:
 *
 *   • Shadow DOM host → zero style bleed with the host page (Codeforces
 *     injects aggressive !important rules; the overlay stays untouched and
 *     never touches the page).
 *   • pointer-events: none → the overlay never blocks scrolling or clicks.
 *   • Single requestAnimationFrame loop with delta-time; all movement via
 *     transform: translate3d (GPU-composited). Loop pauses when the tab is
 *     hidden; dt is clamped so a laptop sleep never causes a teleport.
 *   • Cats react gently to the cursor (they sit and watch you), blink,
 *     pause to rest, leave fading paw prints, and stop to greet each other
 *     with a bubble ("meow~" / "♥") before passing on.
 *   • prefers-reduced-motion is respected — the feature simply stays off.
 */

(function () {
    'use strict';

    if (!chrome?.storage?.local) {
        console.warn('FocusForces: chrome.storage API unavailable — Zen Paws disabled.');
        return;
    }

    // ── Config ──────────────────────────────────────────
    const STORAGE_KEY = 'ff_zenPaws';
    const OVERLAY_Z_INDEX = 2147483646;   // just below Chrome's max, above everything
    const CURSOR_BAND_PX = 170;           // cats only notice the cursor near the bottom
    const CURSOR_NOTICE_PX = 110;         // how close the cursor must be to a cat
    const MEOW_THROTTLE_MS = 4200;        // a curious cat won't meow more often than this
    const MAX_PRINTS = 26;
    const MOTE_COUNT = 9;

    // ── State ───────────────────────────────────────────
    let enabled = false;
    let host = null;
    let shadow = null;
    let cats = [];
    let catEls = [];      // [{ root, figure, bubble, meowAt }] per cat
    let motesEl = null;
    let printsEl = null;
    let printCount = 0;
    let rafId = 0;
    let lastTs = 0;
    let viewW = 0;
    let viewH = 0;
    let mouseX = null;    // null = cursor far away / outside the band

    const reducedMotion = window.matchMedia
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;

    // ── SVG assets ──────────────────────────────────────
    // Side-view cat facing RIGHT. Legs/tail/eyes are animated via CSS inside
    // the shadow root. Coat colors come from per-cat CSS variables.
    const CAT_SVG = `
<svg class="ff-cat-svg" viewBox="0 0 120 86" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <g class="cat-tail">
    <path d="M22 44 C 4 40, 3 22, 11 14 C 15 10, 21 12, 22 17" fill="none" stroke="var(--cat-dark)" stroke-width="7" stroke-linecap="round"/>
  </g>
  <g class="cat-bob">
    <g class="leg b1"><rect x="36" y="56" width="9" height="24" rx="4.5" fill="var(--cat-dark)"/></g>
    <g class="leg b2"><rect x="48" y="56" width="9" height="24" rx="4.5" fill="var(--cat-dark)"/></g>
    <ellipse class="cat-body" cx="54" cy="46" rx="30" ry="15" fill="var(--cat-body)"/>
    <g class="leg f1"><rect x="66" y="56" width="9" height="24" rx="4.5" fill="var(--cat-body)"/></g>
    <g class="leg f2"><rect x="78" y="56" width="9" height="24" rx="4.5" fill="var(--cat-body)"/></g>
    <g class="cat-head">
      <path d="M76 30 L70 8 L90 22 Z" fill="var(--cat-body)"/>
      <path d="M74 26 L70 14 L82 22 Z" fill="var(--cat-accent)"/>
      <ellipse cx="92" cy="36" rx="16" ry="14" fill="var(--cat-body)"/>
      <path d="M97 22 L103 6 L111 19 Z" fill="var(--cat-body)"/>
      <path d="M100 20 L103 12 L108 19 Z" fill="var(--cat-accent)"/>
      <ellipse class="eye" cx="86" cy="34" rx="2.2" ry="3.1" fill="#2b2b33"/>
      <ellipse class="eye" cx="99" cy="34" rx="2.2" ry="3.1" fill="#2b2b33"/>
      <path d="M93 40 L96 40 L94.5 43 Z" fill="#e08a8a"/>
    </g>
  </g>
</svg>`;

    const PRINT_SVG = `
<svg viewBox="0 0 24 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <ellipse cx="12" cy="15" rx="5" ry="3.8" fill="var(--print-color)"/>
  <ellipse cx="5.5" cy="7" rx="1.9" ry="2.9" fill="var(--print-color)"/>
  <ellipse cx="12" cy="5.4" rx="1.9" ry="2.9" fill="var(--print-color)"/>
  <ellipse cx="18.5" cy="7" rx="1.9" ry="2.9" fill="var(--print-color)"/>
</svg>`;

    // ── Overlay styles (Shadow DOM — fully isolated) ────
    const OVERLAY_CSS = `
:host {
  all: initial;
  --paws-shadow: rgba(20, 20, 30, 0.26);
  --paws-mote: rgba(124, 108, 231, 0.55);
  --paws-bubble-bg: rgba(255, 255, 255, 0.96);
  --paws-bubble-fg: #4a4a5a;
}
:host([data-paws-theme="dark"]),
:host([data-paws-theme="amoled"]) {
  --paws-shadow: rgba(0, 0, 0, 0.5);
  --paws-mote: rgba(167, 139, 250, 0.5);
  --paws-bubble-bg: rgba(38, 38, 58, 0.96);
  --paws-bubble-fg: #dcdcf0;
}
:host([data-paws-theme="contrast"]) {
  --paws-shadow: rgba(0, 0, 0, 0.6);
  --paws-mote: rgba(250, 204, 21, 0.45);
  --paws-bubble-bg: rgba(0, 0, 0, 0.92);
  --paws-bubble-fg: #ffffff;
}

.ff-paws {
  position: fixed;
  inset: 0;
  z-index: ${OVERLAY_Z_INDEX};
  pointer-events: none;
  overflow: hidden;
}

.ff-cats,
.ff-motes,
.ff-prints {
  position: absolute;
  inset: 0;
}

/* ── Cat ─────────────────────────────────────────── */
.ff-cat {
  position: absolute;
  left: 0;
  top: 0;
  will-change: transform;
}

.ff-cat-figure {
  position: relative;
  width: calc(var(--cat-size) * 1.4);
  height: var(--cat-size);
  transform: scaleX(var(--facing, 1));
  transform-origin: 50% 100%;
}

.ff-cat-svg {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.ff-cat-shadow {
  position: absolute;
  left: 50%;
  bottom: 3px;
  width: calc(var(--cat-size) * 0.95);
  height: calc(var(--cat-size) * 0.16);
  transform: translateX(-50%);
  background: radial-gradient(ellipse at center, var(--paws-shadow) 0%, transparent 72%);
  pointer-events: none;
}

.ff-cat-bubble {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  background: var(--paws-bubble-bg);
  color: var(--paws-bubble-fg);
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.25;
  padding: 3px 10px;
  border-radius: 999px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.14);
  white-space: nowrap;
  opacity: 0;
  transition: opacity 0.35s ease, transform 0.35s ease;
  transform: translateX(-50%) translateY(4px);
  pointer-events: none;
}

.ff-cat-bubble.visible {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

/* Walk cycle — legs swing in trot pairs, whole cat bobs, tail sways */
.ff-cat .leg {
  transform-box: fill-box;
  transform-origin: 50% 8%;
  animation: paws-leg var(--walk-dur, 0.6s) ease-in-out infinite;
  will-change: transform;
}
.ff-cat .leg.b2,
.ff-cat .leg.f1 {
  animation-delay: calc(var(--walk-dur, 0.6s) / 2);
}

.ff-cat .cat-bob {
  animation: paws-bob var(--walk-dur, 0.6s) ease-in-out infinite;
}

.ff-cat .cat-tail {
  transform-box: fill-box;
  transform-origin: right center;
  animation: paws-tail var(--walk-dur, 0.6s) ease-in-out infinite;
}

.ff-cat .eye {
  transform-box: fill-box;
  transform-origin: center;
  animation: paws-blink 4.8s ease-in-out infinite;
  animation-delay: var(--blink-delay, 0s);
}

@keyframes paws-leg {
  0%, 100% { transform: rotate(-15deg); }
  50%      { transform: rotate(15deg); }
}
@keyframes paws-bob {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-2.4px); }
}
@keyframes paws-tail {
  0%, 100% { transform: rotate(-12deg); }
  50%      { transform: rotate(12deg); }
}
@keyframes paws-blink {
  0%, 92%, 100% { transform: scaleY(1); }
  95%           { transform: scaleY(0.12); }
}

/* Resting pose: legs stop, tail sways slow, head tilts gently */
.ff-cat.is-sitting .leg,
.ff-cat.is-meeting .leg {
  animation-play-state: paused;
}
.ff-cat.is-sitting .cat-bob,
.ff-cat.is-meeting .cat-bob {
  animation: none;
}
.ff-cat.is-sitting .cat-tail {
  animation: paws-tail-rest 3.4s ease-in-out infinite;
}
.ff-cat.is-sitting .cat-head {
  animation: paws-head-look 5.5s ease-in-out infinite;
}
@keyframes paws-tail-rest {
  0%, 100% { transform: rotate(-6deg); }
  50%      { transform: rotate(6deg); }
}
@keyframes paws-head-look {
  0%, 86%, 100% { transform: rotate(0deg); }
  92%           { transform: rotate(-4deg); }
}

/* Meeting: gentle greeting hop in place */
.ff-cat.is-meeting .ff-cat-figure {
  animation: paws-hop 0.9s ease-in-out infinite;
}
@keyframes paws-hop {
  0%, 100% { transform: scaleX(var(--facing, 1)) translateY(0); }
  30%      { transform: scaleX(var(--facing, 1)) translateY(-7px); }
  60%      { transform: scaleX(var(--facing, 1)) translateY(0); }
}

/* ── Paw prints ───────────────────────────────────── */
.ff-print {
  position: absolute;
  width: var(--print-size, 18px);
  animation: paws-print 9s ease-out forwards;
  pointer-events: none;
}
@keyframes paws-print {
  0%   { opacity: var(--print-opacity, 0.32); transform: scale(1); }
  100% { opacity: 0; transform: scale(0.8) translateY(-3px); }
}

/* ── Dust motes (gentle rising sparkle) ───────────── */
.ff-mote {
  position: absolute;
  bottom: -6px;
  width: var(--mote-size, 3px);
  height: var(--mote-size, 3px);
  border-radius: 50%;
  background: var(--paws-mote);
  opacity: 0;
  animation: paws-mote var(--mote-dur, 9s) linear var(--mote-delay, 0s) infinite;
  will-change: transform, opacity;
}
@keyframes paws-mote {
  0%   { transform: translate(0, 0); opacity: 0; }
  12%  { opacity: var(--mote-max, 0.5); }
  55%  { opacity: calc(var(--mote-max, 0.5) * 0.45); }
  100% { transform: translate(var(--mote-drift, 20px), -44vh); opacity: 0; }
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

    function groundY(size) {
        return Math.max(0, viewH - size * 0.93 - 8);
    }

    // ── Overlay lifecycle ───────────────────────────────
    function ensureOverlay() {
        if (host) return;
        host = document.createElement('div');
        host.id = 'ff-zen-paws';
        shadow = host.attachShadow({ mode: 'closed' });
        shadow.innerHTML = `<style>${OVERLAY_CSS}</style>
            <div class="ff-paws">
              <div class="ff-motes"></div>
              <div class="ff-prints"></div>
              <div class="ff-cats"></div>
            </div>`;
        motesEl = shadow.querySelector('.ff-motes');
        printsEl = shadow.querySelector('.ff-prints');
        buildMotes();
        (document.documentElement || document.body).appendChild(host);
    }

    function buildMotes() {
        if (!motesEl) return;
        motesEl.innerHTML = '';
        for (let i = 0; i < MOTE_COUNT; i++) {
            const mote = document.createElement('div');
            mote.className = 'ff-mote';
            mote.style.left = `${(i * 97) % 100}%`;
            mote.style.setProperty('--mote-size', `${(2 + (i % 3) * 1.1).toFixed(1)}px`);
            mote.style.setProperty('--mote-dur', `${(7 + (i * 0.9) % 7).toFixed(1)}s`);
            mote.style.setProperty('--mote-delay', `${((i * 1.7) % 8).toFixed(1)}s`);
            mote.style.setProperty('--mote-drift', `${((i % 2 === 0 ? 1 : -1) * (12 + i * 4)).toFixed(0)}px`);
            mote.style.setProperty('--mote-max', `${(0.22 + (i % 3) * 0.1).toFixed(2)}`);
            motesEl.appendChild(mote);
        }
    }

    function buildCats() {
        const catsLayer = shadow.querySelector('.ff-cats');
        catsLayer.innerHTML = '';
        catEls = cats.map(cat => {
            const root = document.createElement('div');
            root.className = 'ff-cat';

            const figure = document.createElement('div');
            figure.className = 'ff-cat-figure';
            figure.innerHTML = CAT_SVG;
            figure.style.setProperty('--facing', cat.dir === 1 ? '1' : '-1');

            const shadowEl = document.createElement('div');
            shadowEl.className = 'ff-cat-shadow';

            const bubble = document.createElement('div');
            bubble.className = 'ff-cat-bubble';

            root.style.setProperty('--cat-size', `${cat.size}px`);
            root.style.setProperty('--cat-body', cat.palette.body);
            root.style.setProperty('--cat-dark', cat.palette.dark);
            root.style.setProperty('--cat-accent', cat.palette.accent);
            root.style.setProperty('--walk-dur', `${cat.walkCycle.toFixed(2)}s`);
            root.style.setProperty('--blink-delay', `${(cat.phase * 4.8).toFixed(2)}s`);

            root.append(figure, shadowEl, bubble);
            catsLayer.appendChild(root);
            return { root, figure, bubble, meowAt: 0, meowUntil: 0, bubbleText: '', bubbleUntil: 0, bubbleTimer: null, facing: 0 };
        });
    }

    function spawnPrint(cat) {
        if (printCount >= MAX_PRINTS) {
            const first = printsEl.firstElementChild;
            if (first) first.remove();
            printCount--;
        }
        const print = document.createElement('div');
        print.className = 'ff-print';
        print.style.left = `${Math.round(cat.x - cat.size * 0.17)}px`;
        print.style.top = `${Math.round(cat.y + cat.size * 0.86)}px`;
        print.style.setProperty('--print-size', `${Math.max(10, Math.round(cat.size * 0.32))}px`);
        print.style.setProperty('--print-opacity', '0.3');
        print.style.setProperty('--print-color', cat.palette.dark);
        print.innerHTML = PRINT_SVG;
        print.addEventListener('animationend', () => {
            print.remove();
            printCount = Math.max(0, printCount - 1);
        }, { once: true });
        printsEl.appendChild(print);
        printCount++;
    }

    // ── Animation loop ──────────────────────────────────
    function frame(ts) {
        if (!enabled) return;
        rafId = requestAnimationFrame(frame);
        if (!lastTs) lastTs = ts;
        const dt = Math.min(ts - lastTs, 100); // clamp sleep/lag spikes
        lastTs = ts;
        updateCats(dt, Date.now());
    }

    function updateCats(dt, now) {
        const ctx = { now, viewportWidth: viewW, rand: Math.random };

        // Cursor awareness: a cat near the cursor holds still and watches.
        for (let i = 0; i < cats.length; i++) {
            const cat = cats[i];
            const el = catEls[i];
            const near = mouseX !== null && Math.abs(mouseX - cat.x) < CURSOR_NOTICE_PX;
            if (near && !(cat.meeting && cat.meeting.until > now)) {
                cat.hold = true;
                if (now > el.meowAt) {
                    el.meowAt = now + MEOW_THROTTLE_MS;
                    el.meowUntil = now + 1600;
                }
            } else {
                cat.hold = false;
            }
            stepCat(cat, dt, ctx);
        }

        const pair = findMeeting(cats, ctx);
        if (pair) applyMeeting(cats, pair, ctx);

        for (let i = 0; i < cats.length; i++) {
            const cat = cats[i];
            const el = catEls[i];
            const w = cat.size * 1.4;
            el.root.style.transform =
                `translate3d(${Math.round(cat.x - w / 2)}px, ${Math.round(cat.y)}px, 0)`;
            if (el.facing !== cat.dir) { // only touch the var on actual direction changes
                el.facing = cat.dir;
                el.figure.style.setProperty('--facing', cat.dir === 1 ? '1' : '-1');
            }
            el.root.classList.toggle('is-sitting', cat.pauseUntil > now);
            el.root.classList.toggle('is-meeting', !!(cat.meeting && cat.meeting.until > now));

            // Desired bubble: meeting greeting wins over the cursor meow.
            let bubbleText = '';
            let bubbleUntil = 0;
            if (cat.meeting && now < cat.meeting.bubbleUntil) {
                bubbleText = cat.meeting.bubble === 'heart' ? '♥' : 'meow~';
                bubbleUntil = cat.meeting.bubbleUntil;
            } else if (el.meowUntil && now < el.meowUntil) {
                bubbleText = 'meow~';
                bubbleUntil = el.meowUntil;
            }
            setBubble(el, bubbleText, bubbleUntil);

            if (shouldDropPawPrint(cat, now)) spawnPrint(cat);
        }
    }

    /**
     * Show (or hide) a cat's speech bubble. Only touches the DOM when the
     * desired state actually changes; a timer fades it out when it expires.
     */
    function setBubble(el, text, until) {
        // Already showing this exact bubble for at least as long — no-op.
        if (el.bubbleText === text && el.bubbleUntil >= until) return;
        if (el.bubbleTimer) {
            clearTimeout(el.bubbleTimer);
            el.bubbleTimer = null;
        }
        el.bubbleText = text;
        el.bubbleUntil = until;
        if (text) {
            el.bubble.textContent = text;
            el.bubble.classList.add('visible');
            const remaining = Math.max(0, until - Date.now());
            el.bubbleTimer = setTimeout(() => {
                el.bubble.classList.remove('visible');
                el.bubbleText = '';
                el.bubbleUntil = 0;
                el.bubbleTimer = null;
            }, remaining + 80);
        } else {
            el.bubble.classList.remove('visible');
            el.bubbleText = '';
            el.bubbleUntil = 0;
        }
    }

    // ── Cursor tracking ─────────────────────────────────
    function onMouseMove(e) {
        if (e.clientY > viewH - CURSOR_BAND_PX) {
            mouseX = e.clientX;
        } else {
            mouseX = null;
        }
    }

    function onMouseLeave() {
        mouseX = null;
    }

    // ── Lifecycle ───────────────────────────────────────
    function resetViewport() {
        viewW = window.innerWidth || document.documentElement.clientWidth || 0;
        viewH = window.innerHeight || document.documentElement.clientHeight || 0;
        cats.forEach(cat => {
            cat.y = groundY(cat.size);
            const margin = cat.size * 0.9;
            cat.x = Math.min(Math.max(cat.x, margin), Math.max(margin, viewW - margin));
        });
    }

    function applyTheme() {
        if (!host) return;
        host.setAttribute('data-paws-theme', currentTheme());
        // Re-pick coats so lighter cats stay visible after a theme flip.
        cats.forEach((cat, i) => {
            const palette = pickPalette(i, currentTheme());
            cat.palette = palette;
            const el = catEls[i];
            if (el) {
                el.root.style.setProperty('--cat-body', palette.body);
                el.root.style.setProperty('--cat-dark', palette.dark);
                el.root.style.setProperty('--cat-accent', palette.accent);
            }
        });
    }

    function start() {
        if (enabled) return;
        if (reducedMotion && reducedMotion.matches) return; // respect the OS
        enabled = true;

        ensureOverlay();
        resetViewport();
        cats = createCats({
            count: computeCatCount(viewW, viewH),
            viewportWidth: viewW,
            viewportHeight: viewH,
            theme: currentTheme(),
            now: Date.now()
        });
        buildCats();
        applyTheme();

        lastTs = 0;
        rafId = requestAnimationFrame(frame);
    }

    function stop() {
        if (!enabled) return;
        enabled = false;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = 0;
        if (host) {
            host.remove();
            host = null;
            shadow = null;
        }
        cats = [];
        catEls = [];
        printCount = 0;
        lastTs = 0;
    }

    function onVisibilityChange() {
        if (!enabled) return;
        if (document.hidden) {
            if (rafId) cancelAnimationFrame(rafId);
            rafId = 0;
            lastTs = 0;
        } else if (!rafId) {
            lastTs = 0;
            rafId = requestAnimationFrame(frame);
        }
    }

    function onResize() {
        if (!enabled) return;
        resetViewport();
    }

    // ── Wiring ──────────────────────────────────────────
    window.addEventListener('mousemove', onMouseMove, { passive: true });
    document.addEventListener('mouseleave', onMouseLeave);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('resize', onResize, { passive: true });

    chrome.runtime.onMessage.addListener(req => {
        if (req && req.type === 'ZEN_PAWS_TOGGLED') {
            if (req.enabled) start(); else stop();
        }
    });

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.ff_zenPaws) {
            if (changes.ff_zenPaws.newValue) start(); else stop();
        }
        if (changes.ff_theme && enabled) {
            applyTheme();
        }
    });

    // Boot: read the stored preference and start if enabled.
    (async () => {
        try {
            const { [STORAGE_KEY]: stored } = await chrome.storage.local.get(STORAGE_KEY);
            if (stored) start();
        } catch (e) {
            console.debug('FocusForces: failed to load Zen Paws state', e);
        }
    })();
})();