// HomeLauncher — premium cinematic launcher cards + ambient FX for the VidVerge home.
// Pure CSS keyframe animation (no new dependencies); honors prefers-reduced-motion.
import type { ComponentType, CSSProperties } from 'react';

interface LauncherApp {
  id: string;
  name: string;
  description?: string;
}

interface LauncherToolCardProps {
  app: LauncherApp;
  index: number;
  variant: 'desktop' | 'mobile';
  onOpen: () => void;
}

/* ------------------------------------------------------------------ */
/* Per-tool animated icon art (bespoke, layered, looping)              */
/* ------------------------------------------------------------------ */

// Product Video — 3D camera lens: rotating focus ring, breathing iris, lens-flare sweep.
function LensArt() {
  return (
    <div className="vv-art" aria-hidden="true">
      <div className="vv-lens-ring" />
      <div className="vv-lens-glass">
        <div className="vv-lens-iris" />
        <div className="vv-lens-glint" />
      </div>
    </div>
  );
}

// Video Enhancer — footage frame with a shimmer scan, twinkling sparkles, pulsing aura.
function EnhanceArt() {
  return (
    <div className="vv-art" aria-hidden="true">
      <div className="vv-enhance-aura" />
      <div className="vv-enhance-frame">
        <div className="vv-enhance-scan" />
      </div>
      <svg className="vv-spark vv-spark-a" viewBox="0 0 24 24">
        <path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z" fill="currentColor" />
      </svg>
      <svg className="vv-spark vv-spark-b" viewBox="0 0 24 24">
        <path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z" fill="currentColor" />
      </svg>
      <svg className="vv-spark vv-spark-c" viewBox="0 0 24 24">
        <path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z" fill="currentColor" />
      </svg>
    </div>
  );
}

// Script-to-Video — script lines flowing into a glowing video frame with a play glyph.
function ScriptArt() {
  return (
    <div className="vv-art vv-art-script" aria-hidden="true">
      <div className="vv-script-lines">
        <span className="vv-script-line" />
        <span className="vv-script-line" />
        <span className="vv-script-line" />
      </div>
      <div className="vv-script-frame">
        <div className="vv-script-play" />
      </div>
    </div>
  );
}

// SceneForge — cinematic clapper board that claps on a loop over a rolling film strip.
function ClapperArt() {
  return (
    <div className="vv-art" aria-hidden="true">
      <div className="vv-clap-top" />
      <div className="vv-clap-body">
        <div className="vv-clap-strip" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tool identity registry                                              */
/* ------------------------------------------------------------------ */

interface ToolIdentity {
  accent: string;
  tagline?: string;
  Art: ComponentType;
}

const TOOL_IDENTITIES: Record<string, ToolIdentity> = {
  'product-video': {
    accent: '#3b82f6',
    tagline: 'Cinematic product films — scripted, scored, and rendered from your real product.',
    Art: LensArt,
  },
  'video-enhancer': {
    accent: '#2dd4bf',
    tagline: 'Polish footage you already have: captions, overlays, music, and pro-grade export.',
    Art: EnhanceArt,
  },
  'script-to-video': {
    accent: '#8b5cf6',
    tagline: 'Paste a script and an AI director turns every scene into film.',
    Art: ScriptArt,
  },
  sceneforge: {
    accent: '#f59e0b',
    tagline: 'Talking-head studio with documentary-style motion graphics.',
    Art: ClapperArt,
  },
};

const DEFAULT_IDENTITY: ToolIdentity = { accent: '#3b82f6', Art: LensArt };

function getIdentity(appId: string): ToolIdentity {
  return TOOL_IDENTITIES[appId] || DEFAULT_IDENTITY;
}

/* ------------------------------------------------------------------ */
/* Cards                                                               */
/* ------------------------------------------------------------------ */

export function LauncherToolCard({ app, index, variant, onOpen }: LauncherToolCardProps) {
  const identity = getIdentity(app.id);
  const { Art } = identity;
  const copy = identity.tagline || app.description || `Open ${app.name}`;
  const style = {
    '--vv-accent': identity.accent,
    '--vv-i': index,
  } as CSSProperties;

  if (variant === 'mobile') {
    return (
      <button type="button" onClick={onOpen} className="vv-card vv-card-mobile" style={style}>
        <div className="vv-card-glow" aria-hidden="true" />
        <div className="vv-card-sheen" aria-hidden="true" />
        <div className="vv-icon-tile vv-icon-tile-sm">
          <Art />
        </div>
        <div className="vv-card-copy">
          <h2 className="vv-card-title">{app.name}</h2>
          <p className="vv-card-desc">{copy}</p>
        </div>
      </button>
    );
  }

  return (
    <button type="button" onClick={onOpen} className="vv-card vv-card-desktop" style={style}>
      <div className="vv-card-glow" aria-hidden="true" />
      <div className="vv-card-sheen" aria-hidden="true" />
      <div className="vv-icon-tile">
        <Art />
      </div>
      <h3 className="vv-card-title">{app.name}</h3>
      <p className="vv-card-desc">{copy}</p>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Ambient FX layer (film grain, light rays, dust motes) + styles      */
/* ------------------------------------------------------------------ */

const MOTES: Array<{ left: string; delay: string; duration: string; size: number }> = [
  { left: '10%', delay: '0s', duration: '15s', size: 3 },
  { left: '26%', delay: '4s', duration: '18s', size: 2 },
  { left: '44%', delay: '9s', duration: '14s', size: 3 },
  { left: '62%', delay: '2s', duration: '19s', size: 2 },
  { left: '78%', delay: '6s', duration: '16s', size: 3 },
  { left: '90%', delay: '11s', duration: '17s', size: 2 },
];

export function LauncherFX({ compact }: { compact?: boolean }) {
  const motes = compact ? MOTES.slice(0, 3) : MOTES;
  return (
    <>
      <style>{LAUNCHER_CSS}</style>
      <div className="vv-fx" aria-hidden="true">
        <div className="vv-ray vv-ray-a" />
        <div className="vv-ray vv-ray-b" />
        {!compact && <div className="vv-orb vv-orb-a" />}
        {!compact && <div className="vv-orb vv-orb-b" />}
        {motes.map((m, i) => (
          <span
            key={i}
            className="vv-mote"
            style={{
              left: m.left,
              width: m.size,
              height: m.size,
              animationDelay: m.delay,
              animationDuration: m.duration,
            }}
          />
        ))}
        <div className="vv-grain" />
      </div>
    </>
  );
}

const LAUNCHER_CSS = `
/* ===== VidVerge launcher: ambient stage ===== */
.vv-fx { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.vv-ray {
  position: absolute; left: -20%; width: 140%; height: 300px;
  filter: blur(64px); opacity: 0.4;
  background: linear-gradient(90deg, transparent, rgba(59,130,246,0.16), rgba(45,212,191,0.10), transparent);
}
.vv-ray-a { top: -8%; transform: rotate(-14deg); animation: vv-drift-a 26s ease-in-out infinite alternate; }
.vv-ray-b {
  bottom: -12%; transform: rotate(10deg);
  background: linear-gradient(90deg, transparent, rgba(139,92,246,0.12), rgba(59,130,246,0.10), transparent);
  animation: vv-drift-b 32s ease-in-out infinite alternate;
}
@keyframes vv-drift-a { from { transform: rotate(-14deg) translateX(-3%); } to { transform: rotate(-10deg) translateX(3%); } }
@keyframes vv-drift-b { from { transform: rotate(10deg) translateX(3%); } to { transform: rotate(7deg) translateX(-3%); } }
.vv-orb { position: absolute; border-radius: 9999px; filter: blur(70px); }
.vv-orb-a {
  width: 380px; height: 380px; top: 8%; right: -6%;
  background: radial-gradient(circle, rgba(37,99,235,0.20), transparent 70%);
  animation: vv-orb-a 24s ease-in-out infinite alternate;
}
.vv-orb-b {
  width: 320px; height: 320px; bottom: -4%; left: -4%;
  background: radial-gradient(circle, rgba(245,158,11,0.10), transparent 70%);
  animation: vv-orb-b 30s ease-in-out infinite alternate;
}
@keyframes vv-orb-a { from { transform: translate(0, 0) scale(1); } to { transform: translate(-30px, 26px) scale(1.08); } }
@keyframes vv-orb-b { from { transform: translate(0, 0) scale(1); } to { transform: translate(24px, -20px) scale(1.06); } }
.vv-mote {
  position: absolute; bottom: 6%; border-radius: 9999px;
  background: rgba(147,197,253,0.55); filter: blur(0.5px);
  opacity: 0; animation: vv-mote 16s linear infinite;
}
@keyframes vv-mote {
  0% { transform: translateY(0) translateX(0); opacity: 0; }
  10% { opacity: 0.7; }
  85% { opacity: 0.35; }
  100% { transform: translateY(-420px) translateX(26px); opacity: 0; }
}
.vv-grain {
  position: absolute; inset: -40px; opacity: 0.05; mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E");
  animation: vv-grain 1.4s steps(3) infinite;
}
@keyframes vv-grain {
  0% { transform: translate(0, 0); }
  25% { transform: translate(-10px, 6px); }
  50% { transform: translate(8px, -8px); }
  75% { transform: translate(-6px, -10px); }
  100% { transform: translate(0, 0); }
}

/* ===== Brand title shimmer + entrance ===== */
.vv-title-shimmer {
  background: linear-gradient(100deg, #f8fafc 24%, #93c5fd 40%, #5eead4 50%, #f8fafc 64%);
  background-size: 220% 100%;
  -webkit-background-clip: text; background-clip: text;
  color: transparent; -webkit-text-fill-color: transparent;
  animation: vv-title 8s ease-in-out infinite;
}
@keyframes vv-title { 0%, 100% { background-position: 100% 0; } 50% { background-position: 0% 0; } }
.vv-fade-up { animation: vv-card-in 0.7s cubic-bezier(0.22, 1, 0.36, 1) backwards; }

/* ===== Cards ===== */
.vv-card {
  position: relative; z-index: 1; isolation: isolate; overflow: hidden;
  border-radius: 22px; text-align: left; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  border: 1px solid color-mix(in srgb, var(--vv-accent) 26%, rgba(148,163,184,0.14));
  background:
    linear-gradient(155deg,
      color-mix(in srgb, var(--vv-accent) 13%, rgba(16,24,42,0.92)) 0%,
      rgba(13,20,36,0.94) 46%,
      rgba(9,13,26,0.96) 100%);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.05),
    0 18px 40px -18px rgba(2,6,18,0.9),
    0 8px 24px -12px color-mix(in srgb, var(--vv-accent) 26%, transparent);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.35s ease, border-color 0.35s ease;
  animation: vv-card-in 0.8s cubic-bezier(0.22, 1, 0.36, 1) backwards;
  animation-delay: calc(0.12s + var(--vv-i, 0) * 0.1s);
}
@keyframes vv-card-in {
  from { opacity: 0; transform: translateY(26px) scale(0.96); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.vv-card:hover, .vv-card:focus-visible {
  transform: translateY(-6px) scale(1.015);
  border-color: color-mix(in srgb, var(--vv-accent) 55%, rgba(148,163,184,0.2));
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.07),
    0 30px 60px -20px rgba(2,6,18,0.95),
    0 12px 42px -10px color-mix(in srgb, var(--vv-accent) 38%, transparent);
}
.vv-card:active { transform: translateY(-2px) scale(0.99); }
.vv-card:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--vv-accent) 70%, white);
  outline-offset: 3px;
}
.vv-card-desktop {
  display: flex; flex-direction: column; align-items: flex-start;
  padding: 26px 26px 24px; min-height: 212px;
}
.vv-card-mobile {
  display: flex; align-items: center; gap: 16px;
  width: 100%; padding: 16px 18px;
}
.vv-card-mobile:active { transform: scale(0.98); }
.vv-card-copy { min-width: 0; }
.vv-card-glow {
  position: absolute; inset: 0; z-index: -1;
  background: radial-gradient(120% 90% at 18% 0%, color-mix(in srgb, var(--vv-accent) 22%, transparent), transparent 55%);
  opacity: 0.8; transition: opacity 0.35s ease;
}
.vv-card:hover .vv-card-glow { opacity: 1; }
.vv-card-sheen {
  position: absolute; top: 0; bottom: 0; left: -60%; width: 46%; z-index: 0;
  transform: skewX(-14deg); pointer-events: none;
  background: linear-gradient(105deg, transparent, rgba(255,255,255,0.05) 42%, rgba(255,255,255,0.11) 50%, rgba(255,255,255,0.05) 58%, transparent);
  animation: vv-sheen 8s ease-in-out infinite;
  animation-delay: calc(var(--vv-i, 0) * 1.3s);
}
@keyframes vv-sheen {
  0%, 62% { left: -60%; opacity: 0; }
  68% { opacity: 1; }
  82%, 100% { left: 120%; opacity: 0; }
}
.vv-card-title {
  margin: 0 0 6px; font-size: 1.05rem; font-weight: 700;
  letter-spacing: -0.01em; color: var(--space-text-primary, #F8FAFC);
}
.vv-card-desc {
  margin: 0; font-size: 0.8rem; line-height: 1.5;
  color: var(--space-text-secondary, #CBD5E1);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}

/* ===== Icon tile (3D-lit pedestal) ===== */
.vv-icon-tile {
  position: relative; width: 76px; height: 76px; border-radius: 20px; margin-bottom: 18px;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  background: linear-gradient(160deg, color-mix(in srgb, var(--vv-accent) 30%, rgba(10,15,30,0.9)), rgba(8,12,24,0.92) 70%);
  border: 1px solid color-mix(in srgb, var(--vv-accent) 35%, transparent);
  box-shadow:
    0 10px 24px -10px color-mix(in srgb, var(--vv-accent) 45%, transparent),
    inset 0 1px 0 rgba(255,255,255,0.08);
  transform: perspective(500px) rotateX(6deg);
  transition: transform 0.4s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.4s ease;
}
.vv-card:hover .vv-icon-tile {
  transform: perspective(500px) rotateX(0deg) translateY(-2px) scale(1.04);
  box-shadow:
    0 16px 34px -10px color-mix(in srgb, var(--vv-accent) 60%, transparent),
    inset 0 1px 0 rgba(255,255,255,0.12);
}
.vv-icon-tile-sm { width: 60px; height: 60px; margin-bottom: 0; border-radius: 16px; }
.vv-icon-tile-sm .vv-art { transform: scale(0.78); }
.vv-art { position: relative; width: 48px; height: 48px; }

/* ===== Product Video: camera lens ===== */
.vv-lens-ring {
  position: absolute; inset: -4px; border-radius: 9999px;
  background: conic-gradient(from 0deg, rgba(147,197,253,0), rgba(147,197,253,0.6), rgba(45,212,191,0.35), rgba(147,197,253,0));
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px));
  mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px));
  animation: vv-spin 9s linear infinite;
}
@keyframes vv-spin { to { transform: rotate(360deg); } }
.vv-lens-glass {
  position: absolute; inset: 0; border-radius: 9999px; overflow: hidden;
  background: radial-gradient(circle at 34% 30%, #7db4ff 0%, #2f6fe0 22%, #14264d 58%, #070d1d 100%);
  box-shadow:
    inset 0 0 0 2px rgba(148,197,253,0.28),
    inset 0 -6px 10px rgba(0,0,0,0.55),
    0 4px 14px rgba(37,99,235,0.35);
}
.vv-lens-iris {
  position: absolute; left: 50%; top: 50%; width: 16px; height: 16px; margin: -8px 0 0 -8px;
  border-radius: 9999px;
  background: radial-gradient(circle at 40% 35%, #0ea5e9 0%, #082044 55%, #01060f 100%);
  box-shadow: 0 0 10px rgba(56,189,248,0.5);
  animation: vv-iris 5.5s ease-in-out infinite;
}
@keyframes vv-iris { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.22); } }
.vv-lens-glint {
  position: absolute; top: 4px; left: -70px; width: 60px; height: 18px;
  transform: rotate(-24deg); filter: blur(2px);
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent);
  animation: vv-glint 6s ease-in-out infinite;
}
@keyframes vv-glint {
  0%, 58% { left: -70px; opacity: 0; }
  66% { opacity: 0.9; }
  78%, 100% { left: 60px; opacity: 0; }
}

/* ===== Video Enhancer: shimmer + sparkles ===== */
.vv-enhance-aura {
  position: absolute; inset: -10px; border-radius: 18px; z-index: -1;
  background: radial-gradient(circle, rgba(45,212,191,0.30), transparent 65%);
  animation: vv-pulse 4s ease-in-out infinite;
}
@keyframes vv-pulse {
  0%, 100% { opacity: 0.5; transform: scale(0.92); }
  50% { opacity: 1; transform: scale(1.06); }
}
.vv-enhance-frame {
  position: absolute; inset: 9px 3px; border-radius: 10px; overflow: hidden;
  background: linear-gradient(150deg, rgba(20,184,166,0.28), rgba(8,20,34,0.9) 60%);
  border: 1.5px solid rgba(94,234,212,0.55);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.15), 0 4px 12px rgba(20,184,166,0.28);
}
.vv-enhance-scan {
  position: absolute; top: -20%; bottom: -20%; left: -40%; width: 34%;
  transform: skewX(-16deg);
  background: linear-gradient(90deg, transparent, rgba(153,246,228,0.5), transparent);
  animation: vv-scan 3.4s ease-in-out infinite;
}
@keyframes vv-scan { 0%, 15% { left: -40%; } 60%, 100% { left: 115%; } }
.vv-spark {
  position: absolute; color: #ccfbf1;
  filter: drop-shadow(0 0 6px rgba(45,212,191,0.8));
  animation: vv-twinkle 2.6s ease-in-out infinite;
}
.vv-spark-a { width: 16px; height: 16px; top: -6px; right: -4px; }
.vv-spark-b { width: 11px; height: 11px; bottom: -2px; left: -6px; animation-delay: 0.9s; }
.vv-spark-c { width: 8px; height: 8px; top: 10px; left: -10px; animation-delay: 1.7s; }
@keyframes vv-twinkle {
  0%, 100% { transform: scale(0.55) rotate(0deg); opacity: 0.5; }
  50% { transform: scale(1.15) rotate(24deg); opacity: 1; }
}

/* ===== Script-to-Video: lines becoming frames ===== */
.vv-art-script { display: flex; align-items: center; justify-content: center; gap: 6px; }
.vv-script-lines { display: flex; flex-direction: column; gap: 5px; width: 18px; flex-shrink: 0; }
.vv-script-line {
  display: block; height: 3px; border-radius: 2px;
  background: linear-gradient(90deg, #c4b5fd, #8b5cf6);
  animation: vv-line 3s ease-in-out infinite;
}
.vv-script-line:nth-child(2) { width: 78%; animation-delay: 0.35s; }
.vv-script-line:nth-child(3) { width: 56%; animation-delay: 0.7s; }
@keyframes vv-line {
  0% { transform: translateX(0); opacity: 1; }
  45% { transform: translateX(14px); opacity: 0; }
  55% { transform: translateX(-6px); opacity: 0; }
  100% { transform: translateX(0); opacity: 1; }
}
.vv-script-frame {
  position: relative; width: 26px; height: 20px; border-radius: 5px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(150deg, rgba(139,92,246,0.4), rgba(15,10,32,0.95));
  border: 1.5px solid rgba(196,181,253,0.6);
  animation: vv-frame-glow 3s ease-in-out infinite;
}
@keyframes vv-frame-glow {
  0%, 100% { box-shadow: 0 0 8px rgba(139,92,246,0.3); }
  48% { box-shadow: 0 0 16px rgba(167,139,250,0.75); }
}
.vv-script-play {
  width: 0; height: 0; margin-left: 2px;
  border-left: 7px solid #ede9fe;
  border-top: 4.5px solid transparent;
  border-bottom: 4.5px solid transparent;
  filter: drop-shadow(0 0 4px rgba(196,181,253,0.8));
}

/* ===== SceneForge: clapper board + film strip ===== */
.vv-clap-top {
  position: absolute; left: 2px; right: 6px; top: 7px; height: 10px; border-radius: 3px;
  background: repeating-linear-gradient(115deg, #fbbf24 0 7px, #171310 7px 14px);
  transform-origin: 0% 100%;
  box-shadow: 0 2px 6px rgba(0,0,0,0.5);
  animation: vv-clap 4.6s ease-in-out infinite;
}
@keyframes vv-clap {
  0%, 68% { transform: rotate(0deg); }
  76% { transform: rotate(-18deg); }
  82% { transform: rotate(1deg); }
  86%, 100% { transform: rotate(0deg); }
}
.vv-clap-body {
  position: absolute; left: 2px; right: 6px; top: 18px; bottom: 3px; overflow: hidden;
  border-radius: 4px 4px 6px 6px;
  background: linear-gradient(165deg, #2a2f3e, #12151f 70%);
  border: 1px solid rgba(251,191,36,0.35);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.1), 0 4px 10px rgba(0,0,0,0.45);
}
.vv-clap-strip {
  position: absolute; left: 4px; right: 4px; bottom: 4px; height: 7px; border-radius: 2px;
  opacity: 0.85;
  background: repeating-linear-gradient(90deg, rgba(251,191,36,0.85) 0 4px, rgba(18,21,31,0.9) 4px 8px);
  animation: vv-filmroll 2.4s linear infinite;
}
@keyframes vv-filmroll { to { background-position: 16px 0; } }

/* ===== Reduced motion: everything settles into its static state ===== */
@media (prefers-reduced-motion: reduce) {
  .vv-fx *, .vv-card, .vv-card *, .vv-art *, .vv-fade-up, .vv-title-shimmer {
    animation: none !important;
    transition: none !important;
  }
  .vv-card { opacity: 1 !important; transform: none !important; }
}
`;
