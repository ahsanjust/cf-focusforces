/**
 * FocusForces — AC Celebration
 *
 * A triumphant, deeply satisfying celebration when a Codeforces submission
 * is Accepted:
 *
 *   • Multi-stage Visual Celebration:
 *       1. Screen edge vignette & radiant shockwave rings centered on the verdict.
 *       2. Floating golden trophy achievement banner with curated triumph headlines
 *          ("ACCEPTED!", "CLEAN SOLVE!", "ALL TESTS PASSED!") and problem stats.
 *       3. Cascading festive confetti ribbons, diamond stars, and sparkling embers.
 *       4. Smooth upward dissipation and zero lingering DOM elements.
 *   • Rich Web Audio Synthesizer:
 *       - Victory Fanfare: Triumphant ascending brass arpeggio with rich harmonics.
 *       - Celestial Chime: Shimmering crystal pentatonic bells with lingering warmth.
 *       - Level Up Arcade: Punchy 8-bit chip-tune power-up chirp with victory trill.
 *       - Zen Bell: Deep, resonant 432Hz singing bowl with golden overtone.
 *       - Master volume control, auto-resume on user gesture, and silent mode.
 *   • Robust Deduplication:
 *       - Problem-scoped dedup survives post-submit page reloads.
 *       - Never fires for wrong verdicts, stale submissions, or page revisits.
 *   • Full Theme Compatibility & Accessibility:
 *       - Adapts palettes to Paper, Midnight, Ink, and Studio.
 *       - Honors prefers-reduced-motion.
 */

(function () {
    'use strict';

    if (!chrome?.storage?.local) {
        console.warn('FocusForces: chrome.storage API unavailable — AC Celebration disabled.');
        return;
    }

    // ── Config ──────────────────────────────────────────
    const STORAGE_KEY = 'ff_acCelebrate';
    const STYLE_KEY = 'ff_ac_style';         // 'full' | 'compact'
    const SOUND_KEY = 'ff_ac_sound';         // 'fanfare' | 'celestial' | 'arcade' | 'zen' | 'none'
    const VOLUME_KEY = 'ff_ac_volume';       // 0.1 .. 1.0
    const DEDUP_PREFIX = 'ff_ac_celebrated_';
    const OVERLAY_Z_INDEX = 2147483645;
    const DEDUP_MAX_KEYS = 300;
    const DEDUP_TTL_MS = 14 * 24 * 60 * 60 * 1000;

    // ── State ───────────────────────────────────────────
    let enabled = false;
    let celebrationStyle = 'full';
    let soundStyle = 'fanfare';
    let masterVolume = 0.7;
    let host = null;
    let shadow = null;
    let layer = null;
    let observer = null;
    let sessionSeen = new Set();
    let celebratedCache = {};
    let audioCtx = null;

    const reducedMotion = window.matchMedia
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;

    // ── Overlay Styles (Shadow DOM — fully isolated) ────
    const OVERLAY_CSS = `
:host {
  all: initial;
  --ac-primary: #10b981;
  --ac-primary-soft: rgba(16, 185, 129, 0.85);
  --ac-gold: #fbbf24;
  --ac-gold-soft: rgba(251, 191, 36, 0.85);
  --ac-banner-bg: rgba(255, 255, 255, 0.96);
  --ac-banner-fg: #0f172a;
  --ac-sub-fg: #059669;
  --ac-shadow: rgba(16, 185, 129, 0.28);
}
:host([data-ac-theme="dark"]),
:host([data-ac-theme="amoled"]) {
  --ac-primary: #34d399;
  --ac-primary-soft: rgba(52, 211, 153, 0.9);
  --ac-gold: #fde047;
  --ac-gold-soft: rgba(253, 224, 71, 0.9);
  --ac-banner-bg: rgba(17, 24, 39, 0.96);
  --ac-banner-fg: #f9fafb;
  --ac-sub-fg: #6ee7b7;
  --ac-shadow: rgba(0, 0, 0, 0.65);
}
:host([data-ac-theme="contrast"]) {
  --ac-primary: #22c55e;
  --ac-primary-soft: rgba(34, 197, 94, 0.95);
  --ac-gold: #ffffff;
  --ac-gold-soft: #ffffff;
  --ac-banner-bg: #000000;
  --ac-banner-fg: #ffffff;
  --ac-sub-fg: #4ade80;
  --ac-shadow: rgba(0, 0, 0, 0.85);
}

.ff-ac-layer {
  position: fixed;
  inset: 0;
  z-index: ${OVERLAY_Z_INDEX};
  pointer-events: none;
  overflow: hidden;
  user-select: none;
}

/* ── Screen Edge Triumph Vignette ───────────────────── */
.ff-ac-vignette {
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at center, transparent 55%, var(--ac-primary-soft) 100%);
  opacity: 0;
  animation: ac-vignette 1.4s ease-out forwards;
}
@keyframes ac-vignette {
  0%   { opacity: 0; }
  25%  { opacity: 0.22; }
  100% { opacity: 0; }
}

/* ── Concentric Shockwave Rings ─────────────────────── */
.ff-ac-rings {
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
  width: 30px;
  height: 30px;
  border: 3px solid var(--ac-primary);
  border-radius: 50%;
  opacity: 0;
  box-shadow: 0 0 16px var(--ac-primary);
  animation: ac-ring 1.1s cubic-bezier(0.1, 0.8, 0.2, 1) forwards;
}
.ff-ac-ring.r2 {
  border-color: var(--ac-gold);
  box-shadow: 0 0 20px var(--ac-gold);
  animation-delay: 0.08s;
}
@keyframes ac-ring {
  0%   { transform: translate(-50%, -50%) scale(0.2); opacity: 0.95; }
  100% { transform: translate(-50%, -50%) scale(3.2); opacity: 0; }
}

/* ── Floating Achievement Trophy Banner ─────────────── */
.ff-ac-banner-wrap {
  position: absolute;
  left: 0;
  top: 0;
  transform: translate(-50%, -100%);
  margin-top: -18px;
  animation: ac-banner 2.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}
@keyframes ac-banner {
  0%   { opacity: 0; transform: translate(-50%, -85%) scale(0.7); }
  14%  { opacity: 1; transform: translate(-50%, -100%) scale(1.05); }
  22%  { transform: translate(-50%, -100%) scale(1); }
  78%  { opacity: 1; transform: translate(-50%, -100%) scale(1); }
  100% { opacity: 0; transform: translate(-50%, -115%) scale(0.92); }
}

.ff-ac-banner {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 8px 18px 8px 14px;
  background: var(--ac-banner-bg);
  border: 1.5px solid var(--ac-primary);
  border-radius: 999px;
  box-shadow: 0 10px 32px var(--ac-shadow), 0 0 0 1px rgba(255, 255, 255, 0.12);
  white-space: nowrap;
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  position: relative;
  overflow: hidden;
}

/* Shimmer sheen passing across banner */
.ff-ac-banner::after {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 60%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.35), transparent);
  transform: skewX(-20deg);
  animation: ac-sheen 1.8s ease-in-out infinite;
}
@keyframes ac-sheen {
  0%   { left: -100%; }
  60%  { left: 160%; }
  100% { left: 160%; }
}

.ff-ac-trophy {
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--ac-gold) 0%, #f59e0b 100%);
  display: grid;
  place-items: center;
  color: #78350f;
  box-shadow: 0 0 14px var(--ac-gold-soft);
  animation: ac-trophy-spin 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}
@keyframes ac-trophy-spin {
  0%   { transform: scale(0.4) rotate(-30deg); }
  100% { transform: scale(1) rotate(0deg); }
}
.ff-ac-trophy svg {
  width: 18px;
  height: 18px;
}

.ff-ac-content {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.ff-ac-title {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  font-size: 14.5px;
  font-weight: 800;
  letter-spacing: 0.4px;
  color: var(--ac-banner-fg);
  line-height: 1.2;
}

.ff-ac-sub {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.2px;
  color: var(--ac-sub-fg);
  line-height: 1.2;
}

/* ── Festive Confetti Ribbons & Diamonds ────────────── */
.ff-ac-confetti {
  position: absolute;
  left: 0;
  top: 0;
  will-change: transform, opacity;
  animation: ac-confetti var(--dur, 2s) cubic-bezier(0.2, 0.8, 0.3, 1) var(--del, 0s) forwards;
}
@keyframes ac-confetti {
  0% {
    opacity: 1;
    transform: translate(-50%, -50%) translate3d(0, 0, 0) rotateX(0deg) rotateY(0deg) rotateZ(0deg) scale(0.5);
  }
  35% {
    opacity: 1;
    transform: translate(-50%, -50%) translate3d(calc(var(--vx) * 0.4px), calc(var(--vy) * 0.4px), 0)
               rotateX(calc(var(--rx) * 0.4deg)) rotateY(calc(var(--ry) * 0.4deg)) rotateZ(45deg) scale(1);
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -50%) translate3d(calc(var(--vx) * 0.85px), calc(var(--vy) * 0.2px + 120px), 0)
               rotateX(var(--rx)) rotateY(var(--ry)) rotateZ(120deg) scale(0.7);
  }
}

/* ── Sparkling Starlight Particles ──────────────────── */
.ff-ac-spark {
  position: absolute;
  left: 0;
  top: 0;
  width: var(--sz, 5px);
  height: var(--sz, 5px);
  border-radius: 50%;
  background: radial-gradient(circle, #fff 0%, var(--ac-primary) 50%, transparent 80%);
  box-shadow: 0 0 10px 2px var(--ac-primary-soft);
  opacity: 0;
  animation: ac-spark var(--dur, 1.2s) ease-out var(--del, 0s) forwards;
}
@keyframes ac-spark {
  0%   { transform: translate(-50%, -50%) scale(0.3); opacity: 0; }
  18%  { opacity: 1; }
  100% { transform: translate(calc(-50% + var(--tx, 0px)), calc(-50% + var(--ty, 0px))) scale(0.4); opacity: 0; }
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

    function ensureOverlay() {
        if (host) return;
        host = document.createElement('div');
        host.id = 'ff-ac-burst';
        shadow = host.attachShadow({ mode: 'open' });

        const style = document.createElement('style');
        style.textContent = OVERLAY_CSS;

        layer = document.createElement('div');
        layer.className = 'ff-ac-layer';

        shadow.append(style, layer);
        applyTheme();
        (document.documentElement || document.body).appendChild(host);
    }

    // ── Web Audio Synthesizer ───────────────────────────
    function getAudioContext() {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        if (!audioCtx) audioCtx = new Ctx();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        return audioCtx;
    }

    /**
     * Play victory audio based on user configuration.
     * @param {string} [overrideStyle]
     */
    function playCelebrationAudio(overrideStyle) {
        const style = overrideStyle || soundStyle;
        if (style === 'none') return;

        try {
            const ctx = getAudioContext();
            if (!ctx) return;
            const now = ctx.currentTime;
            const vol = clamp(masterVolume, 0, 1);

            switch (style) {
                case 'fanfare':
                    // Triumphant ascending brass synth arpeggio: C5 -> E5 -> G5 -> C6
                    [
                        { f: 523.25, t: 0, d: 0.16 },
                        { f: 659.25, t: 0.12, d: 0.16 },
                        { f: 783.99, t: 0.24, d: 0.22 },
                        { f: 1046.50, t: 0.40, d: 0.75 }
                    ].forEach(n => {
                        const osc = ctx.createOscillator();
                        const gain = ctx.createGain();
                        osc.type = 'triangle';
                        osc.frequency.setValueAtTime(n.f, now + n.t);

                        // Warm sparkle overtone
                        const overtone = ctx.createOscillator();
                        const overGain = ctx.createGain();
                        overtone.type = 'sine';
                        overtone.frequency.setValueAtTime(n.f * 2, now + n.t);

                        gain.gain.setValueAtTime(0, now + n.t);
                        gain.gain.linearRampToValueAtTime(0.22 * vol, now + n.t + 0.02);
                        gain.gain.exponentialRampToValueAtTime(0.0001, now + n.t + n.d);

                        overGain.gain.setValueAtTime(0, now + n.t);
                        overGain.gain.linearRampToValueAtTime(0.08 * vol, now + n.t + 0.02);
                        overGain.gain.exponentialRampToValueAtTime(0.0001, now + n.t + n.d);

                        osc.connect(gain);
                        overtone.connect(overGain);
                        gain.connect(ctx.destination);
                        overGain.connect(ctx.destination);

                        osc.start(now + n.t);
                        overtone.start(now + n.t);
                        osc.stop(now + n.t + n.d + 0.05);
                        overtone.stop(now + n.t + n.d + 0.05);
                    });
                    break;

                case 'celestial':
                    // Shimmering crystal pentatonic bells (E5, G#5, B5, E6, F#6)
                    [659.25, 830.61, 987.77, 1318.51, 1479.98].forEach((freq, i) => {
                        const osc = ctx.createOscillator();
                        const gain = ctx.createGain();
                        const start = now + i * 0.06;
                        osc.type = 'sine';
                        osc.frequency.setValueAtTime(freq, start);

                        gain.gain.setValueAtTime(0, start);
                        gain.gain.linearRampToValueAtTime(0.18 * vol, start + 0.015);
                        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.85);

                        osc.connect(gain);
                        gain.connect(ctx.destination);
                        osc.start(start);
                        osc.stop(start + 0.9);
                    });
                    break;

                case 'arcade':
                    // Retro 8-bit chip-tune victory chirp with trill
                    [
                        { f: 587.33, t: 0, d: 0.07 },
                        { f: 739.99, t: 0.07, d: 0.07 },
                        { f: 880.00, t: 0.14, d: 0.07 },
                        { f: 1174.66, t: 0.21, d: 0.35 }
                    ].forEach(n => {
                        const osc = ctx.createOscillator();
                        const gain = ctx.createGain();
                        osc.type = 'square';
                        osc.frequency.setValueAtTime(n.f, now + n.t);

                        gain.gain.setValueAtTime(0, now + n.t);
                        gain.gain.linearRampToValueAtTime(0.12 * vol, now + n.t + 0.01);
                        gain.gain.exponentialRampToValueAtTime(0.0001, now + n.t + n.d);

                        osc.connect(gain);
                        gain.connect(ctx.destination);
                        osc.start(now + n.t);
                        osc.stop(now + n.t + n.d);
                    });
                    break;

                case 'zen':
                    // Resonant Tibetan singing bowl (432Hz with gentle 864Hz octave)
                    const osc = ctx.createOscillator();
                    const osc2 = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(432, now);
                    osc2.type = 'sine';
                    osc2.frequency.setValueAtTime(864, now);

                    gain.gain.setValueAtTime(0, now);
                    gain.gain.linearRampToValueAtTime(0.25 * vol, now + 0.03);
                    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);

                    osc.connect(gain);
                    osc2.connect(gain);
                    gain.connect(ctx.destination);

                    osc.start(now);
                    osc2.start(now);
                    osc.stop(now + 1.85);
                    osc2.stop(now + 1.85);
                    break;
            }
        } catch (e) {
            console.debug('FocusForces: celebration audio error', e);
        }
    }

    // ── Celebration Orchestration ───────────────────────
    function triggerCelebration(x, y, problem, stats) {
        if (!layer) return;

        // 1. Full Screen Triumph Vignette (if full style)
        if (celebrationStyle === 'full') {
            const vignette = document.createElement('div');
            vignette.className = 'ff-ac-vignette';
            layer.appendChild(vignette);
            setTimeout(() => vignette.remove(), 1600);
        }

        // 2. Concentric Shockwave Rings
        const ringsWrap = document.createElement('div');
        ringsWrap.className = 'ff-ac-rings';
        ringsWrap.style.left = `${Math.round(x)}px`;
        ringsWrap.style.top = `${Math.round(y)}px`;

        const r1 = document.createElement('div');
        r1.className = 'ff-ac-ring';
        const r2 = document.createElement('div');
        r2.className = 'ff-ac-ring r2';
        ringsWrap.append(r1, r2);
        layer.appendChild(ringsWrap);
        setTimeout(() => ringsWrap.remove(), 1200);

        // 3. Floating Achievement Trophy Banner
        const copy = pickCelebrationCopy(problem);
        let subText = copy.subtitle;
        if (stats && (stats.time || stats.memory)) {
            const details = [stats.time, stats.memory].filter(Boolean).join(' · ');
            subText = `${subText} · ${details}`;
        }

        const bannerWrap = document.createElement('div');
        bannerWrap.className = 'ff-ac-banner-wrap';
        bannerWrap.style.left = `${Math.round(x)}px`;
        bannerWrap.style.top = `${Math.round(y)}px`;

        const banner = document.createElement('div');
        banner.className = 'ff-ac-banner';

        const trophy = document.createElement('div');
        trophy.className = 'ff-ac-trophy';
        trophy.innerHTML = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/>
  <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>
  <path d="M4 22h16"/>
  <path d="M10 14.66V17c0 .55-.45 1-1 1H8c-.55 0-1 .45-1 1v1h10v-1c0-.55-.45-1-1-1h-1c-.55 0-1-.45-1-1v-2.34"/>
  <path d="M6 4h12a2 2 0 0 1 2 2v3a6 6 0 0 1-6 6h0a6 6 0 0 1-6-6V6a2 2 0 0 1 2-2Z"/>
</svg>`;

        const content = document.createElement('div');
        content.className = 'ff-ac-content';

        const title = document.createElement('span');
        title.className = 'ff-ac-title';
        title.textContent = copy.title;

        const sub = document.createElement('span');
        sub.className = 'ff-ac-sub';
        sub.textContent = subText;

        content.append(title, sub);
        banner.append(trophy, content);
        bannerWrap.appendChild(banner);
        layer.appendChild(bannerWrap);
        setTimeout(() => bannerWrap.remove(), 2700);

        // 4. Starlight Sparks
        pickBurstParticles({ count: 12 }).forEach(p => {
            const s = document.createElement('div');
            s.className = 'ff-ac-spark';
            s.style.left = `${Math.round(x)}px`;
            s.style.top = `${Math.round(y)}px`;
            s.style.setProperty('--tx', `${(Math.cos(p.angle) * p.dist).toFixed(1)}px`);
            s.style.setProperty('--ty', `${(Math.sin(p.angle) * p.dist).toFixed(1)}px`);
            s.style.setProperty('--sz', `${p.size.toFixed(1)}px`);
            s.style.setProperty('--dur', `${(p.dur / 1000).toFixed(2)}s`);
            s.style.setProperty('--del', `${(p.delay / 1000).toFixed(2)}s`);
            layer.appendChild(s);
            setTimeout(() => s.remove(), p.dur + p.delay + 100);
        });

        // 5. Cascading Confetti Ribbons (in full style)
        if (celebrationStyle === 'full') {
            pickConfettiParticles({ count: 32 }).forEach(c => {
                const conf = document.createElement('div');
                conf.className = 'ff-ac-confetti';
                conf.style.left = `${Math.round(x)}px`;
                conf.style.top = `${Math.round(y)}px`;
                conf.style.width = `${c.width}px`;
                conf.style.height = `${c.height}px`;
                conf.style.background = c.color;
                conf.style.borderRadius = c.shape === 'star' ? '50%' : '2px';
                conf.style.setProperty('--vx', `${c.vx.toFixed(1)}`);
                conf.style.setProperty('--vy', `${c.vy.toFixed(1)}`);
                conf.style.setProperty('--rx', `${c.vRotX.toFixed(0)}deg`);
                conf.style.setProperty('--ry', `${c.vRotY.toFixed(0)}deg`);
                conf.style.setProperty('--dur', `${(c.dur / 1000).toFixed(2)}s`);
                conf.style.setProperty('--del', `${(c.delay / 1000).toFixed(2)}s`);
                layer.appendChild(conf);
                setTimeout(() => conf.remove(), c.dur + c.delay + 100);
            });
        }

        // 6. Play Synthesized Sound
        playCelebrationAudio();
    }

    // ── Verdict Detection & Deduplication ───────────────
    function tryCelebrateFromEl(verdictEl) {
        if (!enabled) return;
        const row = verdictEl.closest?.('[data-submission-id]') || verdictEl.closest?.('tr') || null;
        const submissionId = row?.getAttribute?.('data-submission-id') || null;
        const problem = parseProblemKeyFromPath(window.location.pathname);
        const key = celebrateDedupKey(problem, submissionId);

        if (!shouldCelebrate(sessionSeen, celebratedCache, key)) return;

        sessionSeen.add(key);
        celebratedCache[key] = Date.now();
        chrome.storage.local.set({ [key]: Date.now() }).catch(() => {});
        pruneCacheIfNeeded();

        if (reducedMotion && reducedMotion.matches) return;
        ensureOverlay();
        applyTheme();

        const stats = parseSubmissionStats(row?.innerText || row?.textContent || '');
        const r = verdictEl.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;

        triggerCelebration(x, y, problem, stats);
    }

    function pruneCacheIfNeeded() {
        if (Object.keys(celebratedCache).length <= DEDUP_MAX_KEYS) return;
        const cutoff = Date.now() - DEDUP_TTL_MS;
        const stale = Object.keys(celebratedCache).filter(k => celebratedCache[k] < cutoff);
        if (!stale.length) return;
        stale.forEach(k => delete celebratedCache[k]);
        chrome.storage.local.remove(stale).catch(() => {});
    }

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
                    if (!isAcceptedToken(v.textContent || v.innerText || '')) continue;
                    tryCelebrateFromEl(v);
                }
            }
        }
    }

    function initialScan() {
        if (!enabled) return;
        const verdicts = document.querySelectorAll('.verdict-accepted');
        for (const v of verdicts) {
            if (!isAcceptedToken(v.textContent || v.innerText || '')) continue;
            tryCelebrateFromEl(v);
            break;
        }
    }

    // ── Lifecycle ───────────────────────────────────────
    function start() {
        if (enabled) return;
        if (reducedMotion && reducedMotion.matches) {
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

    // ── Boot & Message Listeners ─────────────────────────
    (async () => {
        try {
            const all = await chrome.storage.local.get(null);
            for (const k of Object.keys(all)) {
                if (k.startsWith(DEDUP_PREFIX)) celebratedCache[k] = all[k];
            }
            celebrationStyle = all[STYLE_KEY] || 'full';
            soundStyle = all[SOUND_KEY] || 'fanfare';
            masterVolume = typeof all[VOLUME_KEY] === 'number' ? all[VOLUME_KEY] : 0.7;

            if (all[STORAGE_KEY]) start();
        } catch (e) {
            console.debug('FocusForces: failed to load AC Celebration state', e);
        }
    })();

    chrome.runtime.onMessage.addListener(req => {
        if (!req) return;
        if (req.type === 'AC_CELEBRATE_TOGGLED') {
            if (req.enabled) start(); else stop();
        } else if (req.type === 'AC_CELEBRATE_PREVIEW') {
            // Interactive Preview triggered from popup settings!
            ensureOverlay();
            applyTheme();
            const cx = window.innerWidth / 2;
            const cy = window.innerHeight * 0.42;
            triggerCelebration(cx, cy, { contestId: '2024', index: 'A' }, { time: '92 ms', memory: '1.4 MB' });
        }
    });

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes[STORAGE_KEY]) {
            if (changes[STORAGE_KEY].newValue) start(); else stop();
        }
        if (changes[STYLE_KEY]) {
            celebrationStyle = changes[STYLE_KEY].newValue || 'full';
        }
        if (changes[SOUND_KEY]) {
            soundStyle = changes[SOUND_KEY].newValue || 'fanfare';
        }
        if (changes[VOLUME_KEY]) {
            masterVolume = typeof changes[VOLUME_KEY].newValue === 'number' ? changes[VOLUME_KEY].newValue : 0.7;
        }
        if (changes.ff_theme && enabled) {
            applyTheme();
        }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialScan);
    } else {
        initialScan();
    }
})();
