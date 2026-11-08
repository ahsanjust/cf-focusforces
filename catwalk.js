/**
 * FocusForces — Zen Paws (Cat Walk & Companion Experience)
 *
 * An interactive, delightful companion experience of charming SVG cats
 * roaming the bottom of Codeforces, AtCoder, and CodeChef:
 *
 *   • True Living Companions: Distinct feline personalities (Explorer, Playful,
 *     Cozy Loaf, and Sweet). Each has unique behaviors, walking tempos, and
 *     expressive reaction patterns.
 *   • Expressive Natural Poses:
 *       - Trot Cycle: 4-legged trot with head bob and fluid tail swish.
 *       - Loaf & Catnap: Tucks paws under, closes eyes, drifts into naps with zZz.
 *       - Downward Stretch: Yoga stretch with front paws extended & arched back.
 *       - Grooming: Licks paw and washes ears/whiskers.
 *       - Joyful Hop: Excited bounce on greetings, swatting, or petting.
 *   • Interactive Petting: Hover or click on any cat to pet it! The cat stops,
 *     closes eyes in pure bliss (^.^), purrs with hearts, and arches happily.
 *   • Playful Mode & Toys: Drop a bouncy yarn ball (🧶) by clicking near the bottom
 *     strip. Playful cats stalk it, butt-wiggle, and pounce!
 *   • Social Greetings: Passing cats stop, turn to face each other, nuzzle/bonk heads,
 *     and exchange friendly meows and hearts.
 *   • Shadow DOM Isolation: Zero CSS bleed with Codeforces. Never blocks reading,
 *     scrolling, or problem text selection (pointer-events only active on cats/toys).
 *   • Themes & Accessibility: Adapts coats to Light/Dark/AMOLED/Studio themes.
 *     Fully respects prefers-reduced-motion.
 */

(function () {
    'use strict';

    if (!chrome?.storage?.local) {
        console.warn('FocusForces: chrome.storage API unavailable — Zen Paws disabled.');
        return;
    }

    // ── Config ──────────────────────────────────────────
    const STORAGE_KEY = 'ff_zenPaws';
    const MODE_KEY = 'ff_zenPaws_mode';       // 'ambient' | 'playful'
    const COUNT_KEY = 'ff_zenPaws_count';     // 2 | 3 | 5
    const SIZE_KEY = 'ff_zenPaws_size';       // 'normal' | 'large'
    const OVERLAY_Z_INDEX = 2147483646;       // just below Chrome's max, above page
    const CURSOR_BAND_PX = 140;               // cats notice cursor near the bottom
    const CURSOR_NOTICE_PX = 95;              // distance for cursor interest
    const MEOW_THROTTLE_MS = 5000;
    const MAX_PRINTS = 24;
    const MOTE_COUNT = 9;

    // ── State ───────────────────────────────────────────
    let enabled = false;
    let mode = 'playful';                     // 'ambient' | 'playful'
    let preferredCount = null;                // null = auto from viewport width
    let sizeMultiplier = 1.0;
    let host = null;
    let shadow = null;
    let cats = [];
    let catEls = [];                          // [{ root, figure, bubble, shadowEl, eyesNormal, eyesHappy, eyesSleepy, ... }]
    let activeToy = null;
    let toyEl = null;
    let motesEl = null;
    let printsEl = null;
    let printCount = 0;
    let rafId = 0;
    let lastTs = 0;
    let viewW = 0;
    let viewH = 0;
    let mouseX = null;
    let mouseY = null;

    const reducedMotion = window.matchMedia
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;

    // ── SVG Assets ──────────────────────────────────────
    // Expressive SVG cat facing RIGHT with articulated legs, curving tail,
    // head with whiskers, and three eye states (curious open, happy bliss, sleepy shut).
    const CAT_SVG = `
<svg class="ff-cat-svg" viewBox="0 0 130 90" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <!-- Expressive animated tail -->
  <g class="cat-tail">
    <path d="M24 48 C 6 44, 2 20, 14 12 C 19 8, 26 11, 26 17 C 26 24, 18 28, 22 42"
          fill="none" stroke="var(--cat-dark)" stroke-width="7.5" stroke-linecap="round"/>
  </g>

  <!-- Body core & legs (bobbing group) -->
  <g class="cat-bob">
    <!-- Back legs -->
    <g class="leg b1"><rect x="36" y="58" width="10" height="26" rx="5" fill="var(--cat-dark)"/></g>
    <g class="leg b2"><rect x="50" y="58" width="10" height="26" rx="5" fill="var(--cat-dark)"/></g>

    <!-- Torso -->
    <ellipse class="cat-body" cx="58" cy="48" rx="33" ry="17" fill="var(--cat-body)"/>
    <!-- Cute chest/belly bib accent -->
    <path class="cat-bib" d="M72 40 C 76 46, 76 56, 68 62 C 60 62, 54 54, 58 44 Z" fill="var(--cat-accent)" opacity="0.85"/>

    <!-- Front legs -->
    <g class="leg f1"><rect x="72" y="58" width="10" height="26" rx="5" fill="var(--cat-body)"/></g>
    <g class="leg f2"><rect x="86" y="58" width="10" height="26" rx="5" fill="var(--cat-body)"/></g>

    <!-- Head & Face -->
    <g class="cat-head">
      <!-- Back Ear -->
      <path d="M84 32 L78 8 L100 24 Z" fill="var(--cat-body)"/>
      <path d="M82 28 L78 14 L92 24 Z" fill="var(--cat-dark)" opacity="0.7"/>

      <!-- Head Base -->
      <ellipse cx="100" cy="38" rx="18" ry="16" fill="var(--cat-body)"/>

      <!-- Front Ear -->
      <path d="M106 24 L114 6 L122 22 Z" fill="var(--cat-body)"/>
      <path d="M109 22 L114 12 L119 21 Z" fill="var(--cat-accent)" opacity="0.9"/>

      <!-- Cheek tuft -->
      <path d="M116 38 C 122 39, 122 43, 116 46 Z" fill="var(--cat-body)"/>

      <!-- Whiskers -->
      <g class="cat-whiskers" stroke="var(--cat-dark)" stroke-width="1.2" opacity="0.65" stroke-linecap="round">
        <line x1="110" y1="41" x2="126" y2="39"/>
        <line x1="110" y1="43" x2="125" y2="45"/>
        <line x1="90" y1="41" x2="78" y2="40"/>
        <line x1="90" y1="43" x2="79" y2="45"/>
      </g>

      <!-- Eyes (State 1: Curious / Normal open) -->
      <g class="eye-normal">
        <ellipse cx="94" cy="35" rx="3.2" ry="4.4" fill="var(--cat-eye)"/>
        <ellipse cx="106" cy="35" rx="3.2" ry="4.4" fill="var(--cat-eye)"/>
        <!-- Pupils -->
        <ellipse cx="94" cy="35" rx="1.8" ry="3.6" fill="#18181b"/>
        <ellipse cx="106" cy="35" rx="1.8" ry="3.6" fill="#18181b"/>
        <!-- Catchlights -->
        <circle cx="93" cy="33.5" r="1.1" fill="#ffffff"/>
        <circle cx="105" cy="33.5" r="1.1" fill="#ffffff"/>
      </g>

      <!-- Eyes (State 2: Bliss / Purring happy curved ^.^) -->
      <g class="eye-happy" display="none">
        <path d="M91 37 Q 94 32, 97 37" fill="none" stroke="var(--cat-dark)" stroke-width="2.2" stroke-linecap="round"/>
        <path d="M103 37 Q 106 32, 109 37" fill="none" stroke="var(--cat-dark)" stroke-width="2.2" stroke-linecap="round"/>
      </g>

      <!-- Eyes (State 3: Sleepy / Loaf shut) -->
      <g class="eye-sleepy" display="none">
        <line x1="91" y1="36" x2="97" y2="36" stroke="var(--cat-dark)" stroke-width="2" stroke-linecap="round"/>
        <line x1="103" y1="36" x2="109" y2="36" stroke="var(--cat-dark)" stroke-width="2" stroke-linecap="round"/>
      </g>

      <!-- Nose & Sweet Mouth -->
      <path d="M100 42 L103 42 L101.5 45 Z" fill="var(--cat-snout)"/>
      <path d="M99 45 Q 101.5 47, 104 45" fill="none" stroke="var(--cat-dark)" stroke-width="1.3" stroke-linecap="round" opacity="0.75"/>
    </g>
  </g>
</svg>`;

    const YARN_TOY_SVG = `
<svg class="ff-toy-svg" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <circle cx="16" cy="16" r="14" fill="#f43f5e"/>
  <circle cx="16" cy="16" r="14" fill="none" stroke="#e11d48" stroke-width="1.8"/>
  <path d="M6 14 C 12 18, 20 10, 26 18" fill="none" stroke="#fda4af" stroke-width="2.2" stroke-linecap="round"/>
  <path d="M8 22 C 14 10, 22 24, 25 12" fill="none" stroke="#ffe4e6" stroke-width="2" stroke-linecap="round"/>
  <path d="M14 6 C 18 16, 12 26, 20 27" fill="none" stroke="#fb7185" stroke-width="2" stroke-linecap="round"/>
  <!-- Little trailing yarn string -->
  <path d="M26 19 C 29 23, 31 28, 28 31" fill="none" stroke="#f43f5e" stroke-width="2" stroke-linecap="round"/>
</svg>`;

    const PRINT_SVG = `
<svg viewBox="0 0 24 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <ellipse cx="12" cy="15" rx="5" ry="3.8" fill="var(--print-color)"/>
  <ellipse cx="5.5" cy="7" rx="1.9" ry="2.9" fill="var(--print-color)"/>
  <ellipse cx="12" cy="5.4" rx="1.9" ry="2.9" fill="var(--print-color)"/>
  <ellipse cx="18.5" cy="7" rx="1.9" ry="2.9" fill="var(--print-color)"/>
</svg>`;

    // ── Overlay Styles (Shadow DOM — fully isolated) ────
    const OVERLAY_CSS = `
:host {
  all: initial;
  --paws-shadow: rgba(20, 20, 30, 0.28);
  --paws-mote: rgba(124, 108, 231, 0.55);
  --paws-bubble-bg: rgba(255, 255, 255, 0.98);
  --paws-bubble-fg: #374151;
  --paws-heart: #ef4444;
}
:host([data-paws-theme="dark"]),
:host([data-paws-theme="amoled"]) {
  --paws-shadow: rgba(0, 0, 0, 0.55);
  --paws-mote: rgba(167, 139, 250, 0.5);
  --paws-bubble-bg: rgba(30, 30, 46, 0.98);
  --paws-bubble-fg: #f3f4f6;
  --paws-heart: #f87171;
}
:host([data-paws-theme="contrast"]) {
  --paws-shadow: rgba(0, 0, 0, 0.7);
  --paws-mote: rgba(250, 204, 21, 0.5);
  --paws-bubble-bg: #000000;
  --paws-bubble-fg: #ffffff;
  --paws-heart: #fbbf24;
}

.ff-paws {
  position: fixed;
  inset: 0;
  z-index: ${OVERLAY_Z_INDEX};
  pointer-events: none;
  overflow: hidden;
  user-select: none;
}

.ff-cats,
.ff-motes,
.ff-prints,
.ff-toys {
  position: absolute;
  inset: 0;
}

/* ── Interactive Playground click band ──────────────── */
.ff-playground {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: ${CURSOR_BAND_PX}px;
  pointer-events: auto;
  cursor: default;
}

/* ── Cat Figure & Transitions ───────────────────────── */
.ff-cat {
  position: absolute;
  left: 0;
  top: 0;
  will-change: transform;
  pointer-events: auto;
  cursor: pointer;
}

.ff-cat-figure {
  position: relative;
  width: calc(var(--cat-size) * 1.44);
  height: var(--cat-size);
  transform: scaleX(var(--facing, 1));
  transform-origin: 50% 100%;
  transition: transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
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
  width: calc(var(--cat-size) * 0.96);
  height: calc(var(--cat-size) * 0.16);
  transform: translateX(-50%);
  background: radial-gradient(ellipse at center, var(--paws-shadow) 0%, transparent 72%);
  pointer-events: none;
  transition: transform 0.2s ease, opacity 0.2s ease;
}

/* ── Floating Speech & Purr Bubbles ─────────────────── */
.ff-cat-bubble {
  position: absolute;
  bottom: calc(100% + 10px);
  left: 50%;
  transform: translateX(-50%) translateY(4px) scale(0.92);
  background: var(--paws-bubble-bg);
  color: var(--paws-bubble-fg);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  font-size: 11.5px;
  font-weight: 700;
  line-height: 1.25;
  padding: 4px 10px;
  border-radius: 999px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.16), 0 0 0 1px rgba(255, 255, 255, 0.08);
  white-space: nowrap;
  opacity: 0;
  transition: opacity 0.28s cubic-bezier(0.2, 0.8, 0.2, 1), transform 0.28s cubic-bezier(0.2, 0.8, 0.2, 1);
  pointer-events: none;
  z-index: 10;
}
.ff-cat-bubble.visible {
  opacity: 1;
  transform: translateX(-50%) translateY(0) scale(1);
}
.ff-cat-bubble .heart {
  color: var(--paws-heart);
  display: inline-block;
  margin-left: 2px;
  animation: pulse-heart 0.8s ease infinite alternate;
}
@keyframes pulse-heart {
  to { transform: scale(1.28); }
}

/* Floating Love Hearts (when petted) */
.ff-floating-heart {
  position: absolute;
  color: var(--paws-heart);
  font-size: 15px;
  pointer-events: none;
  animation: float-heart 1.6s cubic-bezier(0.2, 0.8, 0.3, 1) forwards;
}
@keyframes float-heart {
  0%   { opacity: 0; transform: translate(-50%, 0) scale(0.4); }
  25%  { opacity: 1; transform: translate(calc(-50% + var(--hx, 0px)), -18px) scale(1.2); }
  100% { opacity: 0; transform: translate(calc(-50% + var(--hx, 0px) * 1.5), -54px) scale(0.8); }
}

/* Floating zZz for Loaf Naps */
.ff-floating-zzz {
  position: absolute;
  color: var(--paws-bubble-fg);
  font-family: var(--font-mono, monospace);
  font-size: 13px;
  font-weight: 800;
  pointer-events: none;
  opacity: 0;
  animation: float-zzz 2.4s ease-out forwards;
}
@keyframes float-zzz {
  0%   { opacity: 0; transform: translate(0, 0) scale(0.6); }
  30%  { opacity: 0.85; transform: translate(6px, -14px) scale(1); }
  100% { opacity: 0; transform: translate(16px, -42px) scale(1.1); }
}

/* ── Walk Cycle Physics ─────────────────────────────── */
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

@keyframes paws-leg {
  0%, 100% { transform: rotate(-16deg); }
  50%      { transform: rotate(16deg); }
}
@keyframes paws-bob {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-2.8px); }
}
@keyframes paws-tail {
  0%, 100% { transform: rotate(-14deg); }
  50%      { transform: rotate(14deg); }
}

/* ── Poses: Sitting / Loafing ───────────────────────── */
.ff-cat.is-loaf .leg,
.ff-cat.is-sitting .leg,
.ff-cat.is-petted .leg,
.ff-cat.is-stretch .leg,
.ff-cat.is-groom .leg {
  animation-play-state: paused;
}
.ff-cat.is-loaf .cat-bob,
.ff-cat.is-sitting .cat-bob,
.ff-cat.is-petted .cat-bob {
  animation: none;
}
.ff-cat.is-loaf .cat-tail,
.ff-cat.is-sitting .cat-tail {
  animation: paws-tail-rest 3.2s ease-in-out infinite;
}
@keyframes paws-tail-rest {
  0%, 100% { transform: rotate(-6deg); }
  50%      { transform: rotate(7deg); }
}

/* ── Poses: Downward Yoga Stretch ───────────────────── */
.ff-cat.is-stretch .ff-cat-figure {
  animation: paws-stretch 2.2s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}
@keyframes paws-stretch {
  0%   { transform: scaleX(var(--facing, 1)) rotate(0deg); }
  35%  { transform: scaleX(var(--facing, 1)) rotate(-8deg) translateY(2px) scaleX(1.12); }
  75%  { transform: scaleX(var(--facing, 1)) rotate(-8deg) translateY(2px) scaleX(1.12); }
  100% { transform: scaleX(var(--facing, 1)) rotate(0deg); }
}

/* ── Poses: Grooming / Washing Face ─────────────────── */
.ff-cat.is-groom .cat-head {
  animation: paws-groom 2.8s ease-in-out infinite;
}
@keyframes paws-groom {
  0%, 100% { transform: rotate(0deg); }
  25%      { transform: rotate(-10deg) translateY(1px); }
  50%      { transform: rotate(4deg); }
  75%      { transform: rotate(-8deg); }
}

/* ── Poses: Petting Bliss ───────────────────────────── */
.ff-cat.is-petted .ff-cat-figure {
  animation: paws-purr 0.35s ease-in-out infinite alternate;
}
@keyframes paws-purr {
  from { transform: scaleX(var(--facing, 1)) translateY(0); }
  to   { transform: scaleX(var(--facing, 1)) translateY(-2.5px) scaleY(1.02); }
}

/* ── Poses: Joyful Hop / Pounce ─────────────────────── */
.ff-cat.is-hop .ff-cat-figure,
.ff-cat.is-meeting .ff-cat-figure {
  animation: paws-hop 0.85s cubic-bezier(0.34, 1.56, 0.64, 1) infinite;
}
@keyframes paws-hop {
  0%, 100% { transform: scaleX(var(--facing, 1)) translateY(0); }
  35%      { transform: scaleX(var(--facing, 1)) translateY(-10px); }
  65%      { transform: scaleX(var(--facing, 1)) translateY(0); }
}

/* ── Interactive Yarn Toy ───────────────────────────── */
.ff-toy {
  position: absolute;
  width: 26px;
  height: 26px;
  margin-left: -13px;
  margin-top: -13px;
  pointer-events: none;
  filter: drop-shadow(0 3px 6px rgba(0, 0, 0, 0.25));
  will-change: transform;
}
.ff-toy-svg {
  display: block;
  width: 100%;
  height: 100%;
}

/* ── Paw Prints ─────────────────────────────────────── */
.ff-print {
  position: absolute;
  width: var(--print-size, 18px);
  animation: paws-print 8.5s ease-out forwards;
  pointer-events: none;
}
@keyframes paws-print {
  0%   { opacity: var(--print-opacity, 0.32); transform: scale(1); }
  100% { opacity: 0; transform: scale(0.75) translateY(-3px); }
}

/* ── Floating Dust Motes ────────────────────────────── */
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

    function parseSvg(svgStr) {
        const doc = new DOMParser().parseFromString(svgStr.trim(), "image/svg+xml");
        return doc.documentElement;
    }
    let catSvgTemplate = null;
    let toySvgTemplate = null;
    let printSvgTemplate = null;

    function getCatSvgNode() {
        if (!catSvgTemplate) catSvgTemplate = parseSvg(CAT_SVG);
        return catSvgTemplate.cloneNode(true);
    }
    function getToySvgNode() {
        if (!toySvgTemplate) toySvgTemplate = parseSvg(YARN_TOY_SVG);
        return toySvgTemplate.cloneNode(true);
    }
    function getPrintSvgNode() {
        if (!printSvgTemplate) printSvgTemplate = parseSvg(PRINT_SVG);
        return printSvgTemplate.cloneNode(true);
    }

    // ── Overlay Lifecycle ───────────────────────────────
    function ensureOverlay() {
        if (host) return;
        host = document.createElement('div');
        host.id = 'ff-zen-paws';
        shadow = host.attachShadow({ mode: 'open' });

        const style = document.createElement('style');
        style.textContent = OVERLAY_CSS;

        const paws = document.createElement('div');
        paws.className = 'ff-paws';

        motesEl = document.createElement('div');
        motesEl.className = 'ff-motes';

        printsEl = document.createElement('div');
        printsEl.className = 'ff-prints';

        const toysLayer = document.createElement('div');
        toysLayer.className = 'ff-toys';

        const catsLayer = document.createElement('div');
        catsLayer.className = 'ff-cats';

        const playground = document.createElement('div');
        playground.className = 'ff-playground';
        playground.title = 'Zen Paws: Click here to drop a toy for the cats!';
        playground.addEventListener('click', onPlaygroundClick);

        paws.append(motesEl, printsEl, toysLayer, catsLayer, playground);
        shadow.append(style, paws);

        buildMotes();
        (document.documentElement || document.body).appendChild(host);
    }

    function buildMotes() {
        if (!motesEl) return;
        motesEl.replaceChildren();
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
        catsLayer.replaceChildren();

        catEls = cats.map(cat => {
            const root = document.createElement('div');
            root.className = 'ff-cat';
            root.title = `Pet ${cat.palette.name || 'Cat'} (${cat.personality})`;

            const figure = document.createElement('div');
            figure.className = 'ff-cat-figure';
            const svgNode = getCatSvgNode();
            figure.appendChild(svgNode);
            figure.style.setProperty('--facing', cat.dir === 1 ? '1' : '-1');

            const shadowEl = document.createElement('div');
            shadowEl.className = 'ff-cat-shadow';

            const bubble = document.createElement('div');
            bubble.className = 'ff-cat-bubble';

            const eyesNormal = svgNode.querySelector('.eye-normal');
            const eyesHappy = svgNode.querySelector('.eye-happy');
            const eyesSleepy = svgNode.querySelector('.eye-sleepy');

            root.style.setProperty('--cat-size', `${cat.size}px`);
            root.style.setProperty('--cat-body', cat.palette.body);
            root.style.setProperty('--cat-dark', cat.palette.dark);
            root.style.setProperty('--cat-accent', cat.palette.accent);
            root.style.setProperty('--cat-eye', cat.palette.eye || '#10b981');
            root.style.setProperty('--cat-snout', cat.palette.snout || '#e08a8a');
            root.style.setProperty('--walk-dur', `${cat.walkCycle.toFixed(2)}s`);

            // Direct petting interaction
            root.addEventListener('click', (e) => {
                e.stopPropagation();
                petCat(cat);
            });
            root.addEventListener('mouseenter', () => {
                if (mode === 'playful') petCat(cat, 1600);
            });

            root.append(figure, shadowEl, bubble);
            catsLayer.appendChild(root);

            return {
                root, figure, bubble, shadowEl,
                eyesNormal, eyesHappy, eyesSleepy,
                meowAt: 0, meowUntil: 0,
                bubbleText: '', bubbleUntil: 0, bubbleTimer: null,
                facing: cat.dir,
                curEyes: 'normal'
            };
        });
    }

    // ── Petting & Toy Interactions ──────────────────────
    function petCat(cat, duration = 2400) {
        if (!enabled) return;
        const idx = cats.indexOf(cat);
        if (idx === -1) return;
        const el = catEls[idx];

        const { bubble } = startPet(cat, Date.now());
        setBubble(el, bubble, Date.now() + duration);
        spawnFloatingHearts(cat);
    }

    function spawnFloatingHearts(cat) {
        if (!shadow) return;
        const catsLayer = shadow.querySelector('.ff-cats');
        for (let i = 0; i < 3; i++) {
            const heart = document.createElement('div');
            heart.className = 'ff-floating-heart';
            heart.textContent = '♥';
            heart.style.left = `${Math.round(cat.x)}px`;
            heart.style.top = `${Math.round(cat.y - 10)}px`;
            heart.style.setProperty('--hx', `${(i - 1) * 16}px`);
            heart.style.animationDelay = `${i * 0.16}s`;
            catsLayer.appendChild(heart);
            setTimeout(() => heart.remove(), 1800);
        }
    }

    function onPlaygroundClick(e) {
        if (!enabled || mode !== 'playful') return;
        // Don't drop toy if user clicked on a cat (handled by cat click)
        const rect = host.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;

        // If a cat is very close to the click point, pet it instead of dropping a toy
        for (const cat of cats) {
            if (Math.abs(cat.x - clickX) < 40 && Math.abs(cat.y - clickY) < 40) {
                petCat(cat);
                return;
            }
        }

        dropToy(clickX, clickY);
    }

    function dropToy(x, y) {
        if (!shadow) return;
        const toysLayer = shadow.querySelector('.ff-toys');
        if (toyEl) toyEl.remove();

        activeToy = spawnToy({ x, y, now: Date.now() });
        toyEl = document.createElement('div');
        toyEl.className = 'ff-toy';
        toyEl.appendChild(getToySvgNode());
        toysLayer.appendChild(toyEl);
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
        print.appendChild(getPrintSvgNode());
        print.addEventListener('animationend', () => {
            print.remove();
            printCount = Math.max(0, printCount - 1);
        }, { once: true });
        printsEl.appendChild(print);
        printCount++;
    }

    // ── Animation Loop ──────────────────────────────────
    function frame(ts) {
        if (!enabled) return;
        rafId = requestAnimationFrame(frame);
        if (!lastTs) lastTs = ts;
        const dt = Math.min(ts - lastTs, 100);
        lastTs = ts;
        updateCats(dt, Date.now());
    }

    function updateCats(dt, now) {
        const ctx = { now, viewportWidth: viewW, rand: Math.random };
        const ground = groundY(cats[0]?.size || 50);

        // 1. Step Active Toy (if present)
        if (activeToy) {
            const alive = stepToy(activeToy, dt, ground, viewW, now);
            if (!alive) {
                if (toyEl) toyEl.remove();
                activeToy = null;
                toyEl = null;
            } else if (toyEl) {
                toyEl.style.transform = `translate3d(${Math.round(activeToy.x)}px, ${Math.round(activeToy.y)}px, 0) rotate(${Math.round(activeToy.rotation)}deg)`;
            }
        }

        // 2. Toy chasing logic: nearest playful cat stalks and swats the toy
        if (activeToy && activeToy.grounded) {
            const chaser = findCatToChaseToy(cats, activeToy, now);
            if (chaser) {
                const distToToy = activeToy.x - chaser.x;
                if (Math.abs(distToToy) < 32) {
                    // Swat the toy!
                    swatToy(activeToy, chaser, now);
                    const chaserEl = catEls[cats.indexOf(chaser)];
                    setBubble(chaserEl, 'pounce! 🐾', now + 1200);
                } else {
                    // Turn and stalk toward toy
                    chaser.dir = distToToy > 0 ? 1 : -1;
                    chaser.action = 'toy_stalk';
                }
            }
        }

        // 3. Cursor awareness: near cursor, cat watches user
        for (let i = 0; i < cats.length; i++) {
            const cat = cats[i];
            const el = catEls[i];
            const near = mouseX !== null && Math.abs(mouseX - cat.x) < CURSOR_NOTICE_PX;
            if (near && !isBusy(cat, now)) {
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

        // 4. Social Meetings: friendly greetings
        const pair = findMeeting(cats, ctx);
        if (pair) applyMeeting(cats, pair, ctx);

        // 5. Render Cat visual states
        for (let i = 0; i < cats.length; i++) {
            const cat = cats[i];
            const el = catEls[i];
            const w = cat.size * 1.44;

            el.root.style.transform =
                `translate3d(${Math.round(cat.x - w / 2)}px, ${Math.round(cat.y)}px, 0)`;

            if (el.facing !== cat.dir) {
                el.facing = cat.dir;
                el.figure.style.setProperty('--facing', cat.dir === 1 ? '1' : '-1');
            }

            // State classes
            el.root.classList.toggle('is-sitting', cat.action === 'loaf' || cat.pauseUntil > now);
            el.root.classList.toggle('is-loaf', cat.action === 'loaf');
            el.root.classList.toggle('is-stretch', cat.action === 'stretch');
            el.root.classList.toggle('is-groom', cat.action === 'groom');
            el.root.classList.toggle('is-petted', cat.action === 'petted' || cat.pettedUntil > now);
            el.root.classList.toggle('is-meeting', !!(cat.meeting && cat.meeting.until > now));
            el.root.classList.toggle('is-hop', cat.hopUntil > now);

            // Eye state switching
            let desiredEyes = 'normal';
            if (cat.action === 'petted' || cat.pettedUntil > now) {
                desiredEyes = 'happy';
            } else if (cat.action === 'loaf' || cat.action === 'groom') {
                desiredEyes = 'sleepy';
            }

            if (el.curEyes !== desiredEyes) {
                el.curEyes = desiredEyes;
                if (el.eyesNormal) el.eyesNormal.setAttribute('display', desiredEyes === 'normal' ? 'inline' : 'none');
                if (el.eyesHappy) el.eyesHappy.setAttribute('display', desiredEyes === 'happy' ? 'inline' : 'none');
                if (el.eyesSleepy) el.eyesSleepy.setAttribute('display', desiredEyes === 'sleepy' ? 'inline' : 'none');
            }

            // Speech Bubbles: Meeting greeting vs Cursor meow vs Purr
            let bubbleText = '';
            let bubbleUntil = 0;
            if (cat.meeting && now < cat.meeting.bubbleUntil) {
                bubbleText = cat.meeting.bubble === 'heart' ? '♥' : cat.meeting.bubble;
                bubbleUntil = cat.meeting.bubbleUntil;
            } else if (cat.pettedUntil > now) {
                bubbleText = 'purr~ ♥';
                bubbleUntil = cat.pettedUntil;
            } else if (el.meowUntil && now < el.meowUntil) {
                bubbleText = cat.personality === 'playful' ? 'mew! ✨' : 'meow~';
                bubbleUntil = el.meowUntil;
            }
            setBubble(el, bubbleText, bubbleUntil);

            if (shouldDropPawPrint(cat, now)) spawnPrint(cat);
        }
    }

    function setBubble(el, text, until) {
        if (el.bubbleText === text && el.bubbleUntil >= until) return;
        if (el.bubbleTimer) {
            clearTimeout(el.bubbleTimer);
            el.bubbleTimer = null;
        }
        el.bubbleText = text;
        el.bubbleUntil = until;
        if (text) {
            el.bubble.replaceChildren();
            if (text.includes('♥')) {
                const parts = text.split('♥');
                for (let p = 0; p < parts.length; p++) {
                    if (parts[p]) el.bubble.appendChild(document.createTextNode(parts[p]));
                    if (p < parts.length - 1) {
                        const h = document.createElement('span');
                        h.className = 'heart';
                        h.textContent = '♥';
                        el.bubble.appendChild(h);
                    }
                }
            } else {
                el.bubble.textContent = text;
            }
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

    // ── Cursor Tracking ─────────────────────────────────
    function onMouseMove(e) {
        if (e.clientY > viewH - CURSOR_BAND_PX) {
            mouseX = e.clientX;
            mouseY = e.clientY;
        } else {
            mouseX = null;
            mouseY = null;
        }
    }

    function onMouseLeave() {
        mouseX = null;
        mouseY = null;
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
        cats.forEach((cat, i) => {
            const palette = pickPalette(i, currentTheme());
            cat.palette = palette;
            const el = catEls[i];
            if (el) {
                el.root.style.setProperty('--cat-body', palette.body);
                el.root.style.setProperty('--cat-dark', palette.dark);
                el.root.style.setProperty('--cat-accent', palette.accent);
                el.root.style.setProperty('--cat-eye', palette.eye || '#10b981');
                el.root.style.setProperty('--cat-snout', palette.snout || '#e08a8a');
            }
        });
    }

    function start() {
        if (enabled) return;
        if (reducedMotion && reducedMotion.matches) return;
        enabled = true;

        ensureOverlay();
        resetViewport();

        const count = preferredCount || computeCatCount(viewW, viewH);
        cats = createCats({
            count,
            viewportWidth: viewW,
            viewportHeight: viewH,
            theme: currentTheme(),
            now: Date.now(),
            sizeMultiplier
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
        activeToy = null;
        toyEl = null;
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
        if (changes.ff_zenPaws_mode) {
            mode = changes.ff_zenPaws_mode.newValue || 'playful';
        }
        if (changes.ff_zenPaws_count) {
            preferredCount = changes.ff_zenPaws_count.newValue || null;
            if (enabled) { stop(); start(); }
        }
        if (changes.ff_zenPaws_size) {
            sizeMultiplier = changes.ff_zenPaws_size.newValue === 'large' ? 1.25 : 1.0;
            if (enabled) { stop(); start(); }
        }
        if (changes.ff_theme && enabled) {
            applyTheme();
        }
    });

    // Boot: read stored preferences and start if enabled
    (async () => {
        try {
            const stored = await chrome.storage.local.get({
                [STORAGE_KEY]: false,
                [MODE_KEY]: 'playful',
                [COUNT_KEY]: null,
                [SIZE_KEY]: 'normal'
            });
            mode = stored[MODE_KEY] || 'playful';
            preferredCount = stored[COUNT_KEY] || null;
            sizeMultiplier = stored[SIZE_KEY] === 'large' ? 1.25 : 1.0;
            if (stored[STORAGE_KEY]) start();
        } catch (e) {
            console.debug('FocusForces: failed to load Zen Paws state', e);
        }
    })();
})();
