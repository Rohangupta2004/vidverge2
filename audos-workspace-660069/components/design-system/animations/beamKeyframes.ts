/**
 * VidVerge LightBeam — reusable CSS keyframes and beam gradients.
 *
 * DESIGN LAW: don't animate the UI, animate the light travelling through it.
 * Every keyframe here touches ONLY `transform` and `opacity` so the browser
 * composites it on the GPU. The one exception is the SVG border trace, which
 * animates `stroke-dashoffset` — the only way to run a beam along a rounded
 * border path, and still compositor-friendly because it never reflows.
 *
 * Never add width / left / top / height to a keyframe in this file.
 */
import { colors } from '../tokens/colors';
import { beamMetrics } from '../tokens/spacing';

export const BEAM_STYLE_ID = 'vidverge-lightbeam-keyframes';

/**
 * Build the travelling-beam gradient: a fading amber tail, a gold body, and a
 * white-hot leading edge at the 100% end of the gradient (the direction of
 * travel). Sizes are in px so the beam reads as a discrete object rather than
 * scaling with its container.
 */
export function beamGradient(opts: {
  core?: string;
  body?: string;
  trail?: string;
  coreWidth?: number;
  bodyWidth?: number;
  trailWidth?: number;
  /** 90deg travels left → right, 180deg travels top → bottom. */
  angle?: number;
} = {}): string {
  const core = opts.core ?? colors.beamCore;
  const body = opts.body ?? colors.beamPrimary;
  const trail = opts.trail ?? colors.beamTrail;
  const c = opts.coreWidth ?? beamMetrics.coreWidth;
  const b = opts.bodyWidth ?? beamMetrics.bodyWidth;
  const t = opts.trailWidth ?? beamMetrics.trailWidth;
  const total = c + b + t;
  const angle = opts.angle ?? 90;
  return [
    `linear-gradient(${angle}deg`,
    `transparent calc(100% - ${total}px)`,
    `${trail} calc(100% - ${total}px)`,
    `${body} calc(100% - ${c + b}px)`,
    `${body} calc(100% - ${c}px)`,
    `${core} calc(100% - ${c}px)`,
    `${core} 100%)`,
  ].join(', ');
}

/** The soft ambient glow that sits under a beam. */
export function beamGlow(color: string = colors.beamPrimary, strength = 10): string {
  return `0 0 ${strength}px color-mix(in srgb, ${color} 55%, transparent)`;
}

/**
 * The stylesheet every LightBeam component depends on. Injected once per
 * document by `useBeamStyles()`.
 */
export const BEAM_KEYFRAMES = `
/* ---- core beam travel ---- */
@keyframes lb-beamTravel {
  0%   { transform: translateX(-100%); opacity: 0; }
  10%  { opacity: 1; }
  90%  { opacity: 1; }
  100% { transform: translateX(100%); opacity: 0; }
}
@keyframes lb-beamTravelY {
  0%   { transform: translateY(-100%); opacity: 0; }
  10%  { opacity: 1; }
  90%  { opacity: 1; }
  100% { transform: translateY(100%); opacity: 0; }
}
@keyframes lb-beamPulse {
  0%, 100% { opacity: 0.4; }
  50%      { opacity: 1; }
}
@keyframes lb-beamConverge {
  0%   { transform: translateX(-120%) scaleX(1.2); opacity: 0; }
  50%  { opacity: 1; }
  100% { transform: translateX(0) scaleX(0.1); opacity: 0; }
}
@keyframes lb-beamConvergeY {
  0%   { transform: translateY(-120%) scaleY(1.2); opacity: 0; }
  50%  { opacity: 1; }
  100% { transform: translateY(0) scaleY(0.1); opacity: 0; }
}

/* ---- arrival ---- */
@keyframes lb-pointBloom {
  0%   { transform: scale(0.15); opacity: 0; }
  45%  { transform: scale(1.5);  opacity: 1; }
  100% { transform: scale(1);    opacity: 1; }
}
@keyframes lb-arrive {
  0%   { transform: scale(0.6); opacity: 0; }
  100% { transform: scale(1);   opacity: 1; }
}

/* ---- border trace (SVG stroke) ---- */
@keyframes lb-borderTrace { to { stroke-dashoffset: 0; } }

/* ---- failure ---- */
@keyframes lb-beamFalter {
  0%   { transform: translateX(-100%); opacity: 0; }
  10%  { opacity: 1; }
  74%  { opacity: 1; }
  78%  { opacity: 0.2; }
  82%  { opacity: 0.85; }
  88%  { opacity: 0.15; }
  100% { transform: translateX(60%); opacity: 0; }
}
@keyframes lb-shakeX {
  0%, 100% { transform: translateX(0); }
  20%      { transform: translateX(-2px); }
  60%      { transform: translateX(2px); }
}

/* ---- notification transport ---- */
@keyframes lb-cardFollowIn {
  0%   { transform: translateX(18px); opacity: 0; }
  100% { transform: translateX(0);    opacity: 1; }
}
@keyframes lb-cardFollowOut {
  0%   { transform: translateX(0);    opacity: 1; }
  100% { transform: translateX(18px); opacity: 0; }
}

/* ---- logo ambience ---- */
@keyframes lb-ambient {
  0%, 100% { opacity: 0.18; }
  50%      { opacity: 0.55; }
}

/* Respect the OS setting: the light holds still instead of travelling. */
@media (prefers-reduced-motion: reduce) {
  [data-lb-anim] { animation: none !important; opacity: 0.55 !important; }
}
`;

/**
 * Global surface rules, scoped to the LightBeam Shell subtree rather than the
 * document. An app-level `* { margin: 0 }` would also restyle the dock, the
 * agent chat and Settings, so the reset travels with the Shell wrapper.
 */
export const GLOBAL_RESET_CSS = `
.lb-shell, .lb-shell *, .lb-shell *::before, .lb-shell *::after { box-sizing: border-box; }
.lb-shell h1, .lb-shell h2, .lb-shell h3, .lb-shell h4, .lb-shell p, .lb-shell figure { margin: 0; padding: 0; }
.lb-shell {
  background: ${colors.bgPrimary};
  color: ${colors.textPrimary};
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
}
.lb-shell *:focus-visible {
  outline: 1px solid rgba(245,185,54,0.6);
  outline-offset: 2px;
}
.lb-shell ::-webkit-scrollbar { width: 4px; height: 4px; }
.lb-shell ::-webkit-scrollbar-track { background: ${colors.bgSurface}; }
.lb-shell ::-webkit-scrollbar-thumb { background: rgba(245,185,54,0.3); border-radius: 2px; }
.lb-shell { scrollbar-width: thin; scrollbar-color: rgba(245,185,54,0.3) ${colors.bgSurface}; }
`;

export default BEAM_KEYFRAMES;
