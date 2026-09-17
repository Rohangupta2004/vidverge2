/**
 * Gradients & surfaces.
 * - Ground washes come from the analysed palette (dominant + accent at ≤14%
 *   alpha) and drift sub-pixel per frame.
 * - 2–4% monochrome noise grain covers the full frame (SVG feTurbulence).
 * - 4% vignette at the frame edge; on dark screens the washes go LIGHTER than
 *   the ground (not darker) and the vignette lifts at the centre instead.
 * - Scrim under overlay type: linear fade 0 → 0.72 alpha.
 * - Gradient never sits over interface pixels — it is the ground BEHIND the
 *   screenshot layer.
 */
import { hexWithAlpha, type RenderTheme } from './theme';

export const MAX_WASH_ALPHA = 0.14;

export function groundCss(theme: RenderTheme, style: string): string {
  const washA = hexWithAlpha(theme.isDark ? lighten(theme.paper, 0.22) : theme.paper, MAX_WASH_ALPHA);
  const washB = hexWithAlpha(theme.accent, MAX_WASH_ALPHA);
  const base = theme.isDark ? darken(theme.paper, 0.55) : darken(theme.paper, 0.06);
  if (style === 'flat') return base;
  if (style === 'wash') {
    return `linear-gradient(160deg, ${washA}, transparent 60%), linear-gradient(320deg, ${washB}, transparent 55%), ${base}`;
  }
  // mesh (default): two radial washes drifting sub-pixel per frame at render time
  return `radial-gradient(52% 44% at 24% 22%, ${washB}, transparent 70%), radial-gradient(46% 52% at 78% 76%, ${washA}, transparent 72%), ${base}`;
}

/** Sub-pixel per-frame drift for the mesh washes (applied as translate). */
export function washDrift(frame: number): { x: number; y: number } {
  return { x: Math.sin(frame / 90) * 0.9, y: Math.cos(frame / 110) * 0.9 };
}

export function vignetteCss(theme: RenderTheme, strength: number): string {
  const s = Math.min(0.1, Math.max(0, strength || 0.04));
  if (theme.isDark) {
    // dark screens: lift at centre rather than crush the edges
    return `radial-gradient(72% 72% at 50% 46%, rgba(255,255,255,${(s * 0.9).toFixed(3)}), transparent 62%)`;
  }
  return `radial-gradient(120% 120% at 50% 50%, transparent 62%, rgba(0,0,0,${s.toFixed(3)}))`;
}

export const SCRIM_MAX_ALPHA = 0.72;
export function scrimCss(side: string): string {
  const dir = side === 'top' ? 'to bottom' : side === 'left' ? 'to right' : side === 'right' ? 'to left' : 'to top';
  return `linear-gradient(${dir === 'to top' ? 'to top' : dir}, transparent, rgba(2,6,23,${SCRIM_MAX_ALPHA}))`;
}

/** Full-frame monochrome grain, 2–4%. Data URI only — no external fetches. */
export function grainDataUri(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="240" height="240" filter="url(%23n)"/></svg>`;
  return `url("data:image/svg+xml;utf8,${svg.replace(/</g, '%3C').replace(/>/g, '%3E').replace(/#/g, '%23')}")`;
}

export function clampGrain(value: number): number {
  return Math.min(0.04, Math.max(0.02, value || 0.03));
}

function lighten(hex: string, amount: number): string { return mix(hex, '#ffffff', amount); }
function darken(hex: string, amount: number): string { return mix(hex, '#000000', amount); }

function mix(hexA: string, hexB: string, t: number): string {
  const a = parse(hexA), b = parse(hexB);
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
function parse(hex: string): number[] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(full.slice(0, 2), 16) || 0, parseInt(full.slice(2, 4), 16) || 0, parseInt(full.slice(4, 6), 16) || 0];
}
