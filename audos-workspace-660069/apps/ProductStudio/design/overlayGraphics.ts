/**
 * DESIGN WITH AI — overlay motion-graphics engine (GSAP + SVG, no Remotion).
 *
 * Unlike the full-frame graphic scenes of the film pipelines, every graphic
 * here is a TRANSPARENT, COMPOSITABLE OVERLAY laid over the original video:
 * no background rect, content confined to a position slot that automatically
 * respects the talking-head safe area (graphics never cover the face), and a
 * paused GSAP timeline that both the live preview and the export compositor
 * SEEK to the video's current time — so what you preview is exactly what
 * exports.
 *
 * Fourteen graphics-first treatments: kinetic type, lower thirds, animated
 * stats, bar/decay charts, checklists, drawn callout arrows, step flows,
 * icon badges, hub diagrams, progress bars, comparisons, quotes, and real
 * screenshot/image cards. Every string renders EXACTLY as Opus wrote it.
 */

import { gsap } from 'https://esm.sh/gsap@3.12.5';
import { toDataUrl } from '../../ScriptToVideo/pipeline/capture';
import {
  AnimIn, AnimOut, DesignGraphic, DesignPalette, HeadInfo, IconName,
  OverlayPosition, clamp,
} from './api';

const SVG_NS = 'http://www.w3.org/2000/svg';
const FONT = "Inter, -apple-system, 'Segoe UI', Arial, sans-serif";

export interface BuiltOverlay { svg: SVGSVGElement; timeline: any; durationSec: number }

type Attrs = Record<string, string | number>;
function el<T extends SVGElement>(tag: string, attrs: Attrs = {}, parent?: SVGElement | null): T {
  const node = document.createElementNS(SVG_NS, tag) as T;
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, String(v)));
  if (parent) parent.appendChild(node);
  return node;
}

function mix(hex: string, opacity: number): string {
  const h = String(hex || '#888888').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const n = parseInt(full, 16) || 0x888888;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${opacity})`;
}

function wrapLines(text: string, maxChars: number, maxLines = 3): string[] {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if (line && (line + ' ' + w).length > maxChars) { lines.push(line); line = w; } else line = line ? `${line} ${w}` : w;
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) lines[maxLines - 1] = lines[maxLines - 1].replace(/.{3}$/, '…');
  return lines.length ? lines : [''];
}

interface TextOpts { size: number; weight?: number; fill: string; anchor?: 'start' | 'middle' | 'end'; maxChars?: number; maxLines?: number; lineHeight?: number; shadow?: boolean }
function textBlock(parent: SVGElement, x: number, y: number, content: string, o: TextOpts): SVGTextElement {
  const node = el<SVGTextElement>('text', {
    x, y, 'font-family': FONT, 'font-size': o.size, 'font-weight': o.weight || 600,
    fill: o.fill, 'text-anchor': o.anchor || 'middle',
    ...(o.shadow ? { style: 'filter: drop-shadow(0 2px 8px rgba(0,0,0,0.55))' } : {}),
  }, parent);
  const lines = o.maxChars ? wrapLines(content, o.maxChars, o.maxLines || 3) : [String(content || '')];
  const lh = (o.lineHeight || 1.22) * o.size;
  lines.forEach((line, i) => { el('tspan', { x, dy: i === 0 ? 0 : lh }, node).textContent = line; });
  return node;
}

const pop = (tl: any, node: SVGElement, at: number, dur = 0.45) => { gsap.set(node, { transformOrigin: '50% 50%', scale: 0.6, opacity: 0 }); tl.to(node, { scale: 1, opacity: 1, duration: dur, ease: 'back.out(1.7)' }, at); };
const rise = (tl: any, node: SVGElement, at: number, dist: number, dur = 0.5) => { gsap.set(node, { y: dist, opacity: 0 }); tl.to(node, { y: 0, opacity: 1, duration: dur, ease: 'power3.out' }, at); };
function drawnLine(parent: SVGElement, x1: number, y1: number, x2: number, y2: number, stroke: string, width: number): SVGLineElement {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  return el<SVGLineElement>('line', { x1, y1, x2, y2, stroke, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-dasharray': len, 'stroke-dashoffset': len }, parent);
}
const draw = (tl: any, line: SVGElement, at: number, dur = 0.45) => tl.to(line, { strokeDashoffset: 0, duration: dur, ease: 'power2.inOut' }, at);

// ---------------------------------------------------------------------------
// Icon library — deterministic 24x24 paths, scaled where used
// ---------------------------------------------------------------------------

const ICONS: Record<IconName, string> = {
  calendar: 'M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm-2 6h18M8 2v4M16 2v4',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3.5 2',
  chart_up: 'M3 21h18M6 17l4-5 3 3 5-7M18 8h3v3',
  chart_down: 'M3 21h18M6 8l4 5 3-3 5 7M18 17h3v-3',
  bolt: 'M13 2 4 14h6l-1 8 9-12h-6l1-8z',
  shield: 'M12 2 4 6v6c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10V6l-8-4zM9 12l2 2 4-4',
  gear: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19 12a7 7 0 0 0-.2-1.6l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2.8-1.6L13.3 2h-2.6l-.4 2.9a7 7 0 0 0-2.8 1.6l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .5.1 1.1.2 1.6l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2.8 1.6l.4 2.9h2.6l.4-2.9a7 7 0 0 0 2.8-1.6l2.3 1 2-3.4-2-1.5c.1-.5.2-1.1.2-1.6z',
  check: 'M4 12.5 9.5 18 20 6.5',
  cross: 'M6 6l12 12M18 6 6 18',
  star: 'M12 2.5 15 9l7 .8-5.2 4.7 1.5 6.9L12 17.8 5.7 21.4l1.5-6.9L2 9.8 9 9l3-6.5z',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5 21 21',
  brain: 'M9 3a3 3 0 0 0-3 3v1a3 3 0 0 0-2 3c0 1 .4 1.8 1 2.4A3 3 0 0 0 6 18a3 3 0 0 0 3 3c1.2 0 2.2-.6 2.8-1.6V4.6A3.3 3.3 0 0 0 9 3zM15 3a3 3 0 0 1 3 3v1a3 3 0 0 1 2 3c0 1-.4 1.8-1 2.4A3 3 0 0 1 18 18a3 3 0 0 1-3 3c-1.2 0-2.2-.6-2.8-1.6V4.6A3.3 3.3 0 0 1 15 3z',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 13a1 1 0 1 0 0-2',
  rocket: 'M12 2c4 1.5 6.5 5 6.5 9.5 0 1.6-.3 3-.8 4.3L14 13l-4 0-3.7 2.8c-.5-1.3-.8-2.7-.8-4.3C5.5 7 8 3.5 12 2zM12 9.5a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4zM8 16l-2 6 4-2.5M16 16l2 6-4-2.5',
  dollar: 'M12 2v20M17 6.5c-1-1.5-2.8-2-5-2-2.7 0-4.5 1.3-4.5 3.5 0 4.7 9.6 2.3 9.6 7 0 2.3-2 3.7-4.9 3.7-2.4 0-4.3-.7-5.2-2.2',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21c0-3.9 3.1-7 7-7s7 3.1 7 7M17 4a4 4 0 0 1 0 7.5M22 21c0-3-1.8-5.5-4.5-6.5',
  heart: 'M12 21S3 14.5 3 8.5C3 5.5 5.3 3.5 8 3.5c1.7 0 3.2.8 4 2.2.8-1.4 2.3-2.2 4-2.2 2.7 0 5 2 5 5C21 14.5 12 21 12 21z',
  lock: 'M6 11h12a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 18 21H6a1.5 1.5 0 0 1-1.5-1.5v-7A1.5 1.5 0 0 1 6 11zM8 11V7a4 4 0 1 1 8 0v4M12 15v2.5',
  bell: 'M18 9a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9zM10 20a2.2 2.2 0 0 0 4 0',
  book: 'M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17.5H6.5A2.5 2.5 0 0 0 4 22V4.5zM4 19.5A2.5 2.5 0 0 1 6.5 17H20',
  bulb: 'M9 18h6M10 21h4M12 3a6.5 6.5 0 0 0-4 11.6c.8.7 1.5 1.5 1.5 2.4h5c0-.9.7-1.7 1.5-2.4A6.5 6.5 0 0 0 12 3z',
  phone: 'M6 2h12a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM10 18.5h4',
  mail: 'M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM2.5 6.5 12 13l9.5-6.5',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.4 4 5.6 4 9s-1.5 6.6-4 9c-2.5-2.4-4-5.6-4-9s1.5-6.6 4-9z',
};

function iconNode(parent: SVGElement, name: string, cx: number, cy: number, size: number, stroke: string): SVGGElement {
  const path = ICONS[name as IconName] || ICONS.star;
  const g = el<SVGGElement>('g', { transform: `translate(${cx - size / 2} ${cy - size / 2}) scale(${size / 24})` }, parent);
  el('path', { d: path, fill: 'none', stroke, 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
  return g;
}

// ---------------------------------------------------------------------------
// Position slots + talking-head safe area
// ---------------------------------------------------------------------------

interface Region { x: number; y: number; w: number; h: number }

const SLOTS: Record<OverlayPosition, Region> = {
  left_third: { x: 0.04, y: 0.10, w: 0.55, h: 0.78 },
  right_third: { x: 0.41, y: 0.10, w: 0.55, h: 0.78 },
  top_third: { x: 0.06, y: 0.05, w: 0.88, h: 0.36 },
  bottom_third: { x: 0.06, y: 0.56, w: 0.88, h: 0.38 },
  lower_third: { x: 0.05, y: 0.72, w: 0.90, h: 0.23 },
  center: { x: 0.18, y: 0.20, w: 0.64, h: 0.60 },
  full: { x: 0.05, y: 0.07, w: 0.90, h: 0.86 },
};

function overlap(a: Region, b: Region): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return (ix * iy) / Math.max(1e-6, a.w * a.h);
}

/** Resolve the slot for a graphic, flipping away from the talking head so a
 * graphic NEVER sits over the person's face. */
export function resolveSlot(position: OverlayPosition, head: HeadInfo | null): OverlayPosition {
  if (!head || head.position === 'none' || position === 'lower_third' || position === 'full') return position;
  const headBox: Region = head.box && head.box.w > 0
    ? head.box
    : head.position === 'left' ? { x: 0.0, y: 0.05, w: 0.42, h: 0.9 }
    : head.position === 'right' ? { x: 0.58, y: 0.05, w: 0.42, h: 0.9 }
    : head.position === 'top' ? { x: 0.25, y: 0.0, w: 0.5, h: 0.45 }
    : { x: 0.3, y: 0.05, w: 0.4, h: 0.9 }; // center
  const slot = SLOTS[position] || SLOTS.left_third;
  if (overlap(slot, headBox) < 0.28) return position;
  // Flip to the emptiest third.
  const candidates: OverlayPosition[] = ['left_third', 'right_third', 'top_third', 'bottom_third', 'lower_third'];
  let best: OverlayPosition = 'lower_third';
  let bestScore = Infinity;
  for (const c of candidates) {
    const score = overlap(SLOTS[c], headBox);
    if (score < bestScore) { bestScore = score; best = c; }
  }
  return best;
}

/** The resolved slot's frame-fraction rectangle — used by the preview and the
 * export compositor to place video (broll) layers exactly like SVG graphics. */
export interface SlotRegion { x: number; y: number; w: number; h: number }
export function slotRegion(position: OverlayPosition, head: HeadInfo | null): SlotRegion {
  const s = SLOTS[resolveSlot(position, head)] || SLOTS.left_third;
  return { x: s.x, y: s.y, w: s.w, h: s.h };
}

// ---------------------------------------------------------------------------
// Entrance / exit animation of the whole graphic
// ---------------------------------------------------------------------------

function animateIn(tl: any, root: SVGGElement, kind: AnimIn, u: number, maxOpacity: number): void {
  const D = 0.55;
  if (kind === 'pop') { gsap.set(root, { transformOrigin: '50% 50%', scale: 0.75, opacity: 0 }); tl.to(root, { scale: 1, opacity: maxOpacity, duration: D, ease: 'back.out(1.5)' }, 0); }
  else if (kind === 'fade_slide_left') { gsap.set(root, { x: 70 * u, opacity: 0 }); tl.to(root, { x: 0, opacity: maxOpacity, duration: D, ease: 'power3.out' }, 0); }
  else if (kind === 'fade_slide_right') { gsap.set(root, { x: -70 * u, opacity: 0 }); tl.to(root, { x: 0, opacity: maxOpacity, duration: D, ease: 'power3.out' }, 0); }
  else if (kind === 'fade_slide_up') { gsap.set(root, { y: 60 * u, opacity: 0 }); tl.to(root, { y: 0, opacity: maxOpacity, duration: D, ease: 'power3.out' }, 0); }
  else if (kind === 'fade_slide_down') { gsap.set(root, { y: -60 * u, opacity: 0 }); tl.to(root, { y: 0, opacity: maxOpacity, duration: D, ease: 'power3.out' }, 0); }
  else if (kind === 'wipe') { gsap.set(root, { transformOrigin: '0% 50%', scaleX: 0.001, opacity: maxOpacity }); tl.to(root, { scaleX: 1, duration: D, ease: 'power3.inOut' }, 0); }
  else { gsap.set(root, { opacity: 0 }); tl.to(root, { opacity: maxOpacity, duration: D, ease: 'power2.out' }, 0); }
}

function animateOut(tl: any, root: SVGGElement, kind: AnimOut, u: number, total: number): void {
  const D = 0.4;
  const at = Math.max(0.6, total - D);
  if (kind === 'slide_left') tl.to(root, { x: -80 * u, opacity: 0, duration: D, ease: 'power2.in' }, at);
  else if (kind === 'slide_right') tl.to(root, { x: 80 * u, opacity: 0, duration: D, ease: 'power2.in' }, at);
  else if (kind === 'slide_down') tl.to(root, { y: 70 * u, opacity: 0, duration: D, ease: 'power2.in' }, at);
  else if (kind === 'shrink') tl.to(root, { scale: 0.8, opacity: 0, transformOrigin: '50% 50%', duration: D, ease: 'power2.in' }, at);
  else tl.to(root, { opacity: 0, duration: D, ease: 'power1.in' }, at);
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

/** Readability panel behind content — translucent, brand-tinted, rounded. */
function panel(parent: SVGElement, R: Region, W: number, H: number, P: DesignPalette, u: number, radius = 22): SVGRectElement {
  return el<SVGRectElement>('rect', {
    x: R.x * W, y: R.y * H, width: R.w * W, height: R.h * H, rx: radius * u,
    fill: mix(P.bg, 0.78), stroke: mix(P.ink, 0.14), 'stroke-width': Math.max(1, u),
  }, parent);
}

/**
 * Build one overlay graphic as a full-frame TRANSPARENT SVG with a paused
 * GSAP timeline covering the graphic's whole visible window (end - start).
 * Preview and export both SEEK this timeline to (videoTime - start).
 */
export async function buildOverlayGraphic(
  g: DesignGraphic,
  W: number,
  H: number,
  basePalette: DesignPalette,
  head: HeadInfo | null,
): Promise<BuiltOverlay> {
  const total = Math.max(1, g.end - g.start);
  const scale = clamp(Number(g.scale) || 1, 0.5, 1.4);
  const maxOpacity = clamp(Number(g.opacity) || 1, 0.2, 1);
  const u = (Math.min(W, H) / 1080) * scale;
  const hex = (v: unknown, fb: string) => (typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : fb);
  const P: DesignPalette = {
    bg: hex(g.spec.palette?.bg, basePalette.bg),
    ink: hex(g.spec.palette?.ink, basePalette.ink),
    accent: hex(g.spec.palette?.accent, basePalette.accent),
    accent2: hex(g.spec.palette?.accent2, basePalette.accent2),
  };

  const svg = el<SVGSVGElement>('svg', { xmlns: SVG_NS, viewBox: `0 0 ${W} ${H}`, width: W, height: H, style: 'overflow:visible' });
  el('defs', {}, svg);
  const root = el<SVGGElement>('g', {}, svg);
  const tl = gsap.timeline({ paused: true });

  const slot = resolveSlot(g.position, head);
  const S = SLOTS[slot] || SLOTS.left_third;
  const R: Region = { x: S.x, y: S.y, w: S.w, h: S.h };
  const cx = (R.x + R.w / 2) * W;
  const cy = (R.y + R.h / 2) * H;
  const items = (g.spec.items || []).slice(0, 6);
  const n = Math.max(1, items.length);
  const step = Math.min(0.5, (total * 0.45) / (n + 1));
  let inner = 0.35; // content reveals start after the entrance

  const t = g.treatment;

  if (t === 'kinetic_type') {
    const headline = g.spec.title || g.narration_ref || '';
    const portraitish = R.w * W < R.h * H;
    const lines = wrapLines(headline, portraitish ? 12 : 16, 3);
    const size = Math.min((R.w * W) / Math.max(4, Math.max(...lines.map((l) => l.length)) * 0.58), 92 * u);
    const startY = cy - ((lines.length - 1) * size * 1.14) / 2;
    const tick = el('rect', { x: cx - 44 * u, y: startY - size * 1.35, width: 88 * u, height: 8 * u, rx: 4 * u, fill: P.accent }, root);
    pop(tl, tick, inner, 0.35);
    lines.forEach((line, i) => {
      const node = el<SVGTextElement>('text', { x: cx, y: startY + i * size * 1.14, 'font-family': FONT, 'font-size': size, 'font-weight': 900, fill: i === lines.length - 1 && lines.length > 1 ? P.accent : P.ink, 'text-anchor': 'middle', 'letter-spacing': '-0.01em', style: 'filter: drop-shadow(0 3px 12px rgba(0,0,0,0.65))' }, root);
      node.textContent = line;
      rise(tl, node, inner + 0.1 + i * 0.14, 42 * u, 0.55);
    });
    if (g.spec.subtitle) {
      const sub = textBlock(root, cx, startY + lines.length * size * 1.14 + 20 * u, g.spec.subtitle, { size: 26 * u, weight: 600, fill: mix(P.ink, 0.9), maxChars: 40, maxLines: 2, shadow: true });
      rise(tl, sub, inner + 0.3, 20 * u, 0.5);
    }
  } else if (t === 'lower_third') {
    const y0 = (R.y + R.h * 0.55) * H;
    const tagW = Math.min(R.w * W, Math.max((g.spec.title || '').length, 8) * 22 * u + 96 * u);
    const x0 = R.x * W;
    const bar = el<SVGGElement>('g', {}, root);
    el('rect', { x: x0, y: y0 - 52 * u, width: 9 * u, height: 92 * u, fill: P.accent }, bar);
    el('rect', { x: x0 + 9 * u, y: y0 - 52 * u, width: tagW, height: 92 * u, fill: mix(P.bg, 0.86) }, bar);
    textBlock(bar, x0 + 40 * u, y0 - 6 * u, g.spec.title || '', { size: 36 * u, weight: 800, fill: P.ink, anchor: 'start', maxChars: 36, maxLines: 1 });
    if (g.spec.subtitle) textBlock(bar, x0 + 40 * u, y0 + 26 * u, g.spec.subtitle, { size: 21 * u, weight: 500, fill: mix(P.ink, 0.78), anchor: 'start', maxChars: 52, maxLines: 1 });
    gsap.set(bar, { x: -50 * u, opacity: 0 });
    tl.to(bar, { x: 0, opacity: 1, duration: 0.55, ease: 'power3.out' }, inner);
  } else if (t === 'stat') {
    const stat = g.spec.stat || { value: Number(items[0]?.value) || 0, label: g.spec.title };
    const r = Math.min(R.w * W, R.h * H) * 0.3;
    panel(root, { x: cx / W - (r + 60 * u) / W, y: cy / H - (r + 46 * u) / H, w: (2 * r + 120 * u) / W, h: (2 * r + 118 * u) / H }, W, H, P, u, 26);
    const ringLen = 2 * Math.PI * r;
    const ring = el<SVGCircleElement>('circle', { cx, cy: cy - 8 * u, r, fill: 'none', stroke: mix(P.accent, 0.85), 'stroke-width': 7 * u, 'stroke-linecap': 'round', 'stroke-dasharray': ringLen, 'stroke-dashoffset': ringLen, transform: `rotate(-90 ${cx} ${cy - 8 * u})` }, root);
    tl.to(ring, { strokeDashoffset: ringLen * 0.08, duration: Math.min(1.6, total * 0.5), ease: 'power2.inOut' }, inner);
    const decimals = Math.abs(stat.value) < 10 && !Number.isInteger(stat.value) ? 1 : 0;
    const fmt = (v: number) => `${stat.prefix || ''}${v.toLocaleString('en-US', { maximumFractionDigits: decimals, minimumFractionDigits: decimals })}${stat.suffix || ''}`;
    const value = el<SVGTextElement>('text', { x: cx, y: cy + r * 0.22 - 8 * u, 'font-family': FONT, 'font-size': r * 0.62, 'font-weight': 900, fill: P.ink, 'text-anchor': 'middle' }, root);
    value.textContent = fmt(0);
    const counter = { v: 0 };
    rise(tl, value, inner, 22 * u, 0.45);
    tl.to(counter, { v: stat.value, duration: Math.min(1.8, total * 0.5), ease: 'power2.out', onUpdate: () => { value.textContent = fmt(counter.v); } }, inner + 0.1);
    if (stat.label) { const lbl = textBlock(root, cx, cy + r + 44 * u, stat.label, { size: 26 * u, weight: 700, fill: mix(P.ink, 0.9), maxChars: 30, maxLines: 2 }); rise(tl, lbl, inner + 0.4, 14 * u, 0.45); }
  } else if (t === 'bar_chart' || t === 'decay_chart') {
    panel(root, R, W, H, P, u);
    const pad = 34 * u;
    const top = R.y * H + pad + (g.spec.title ? 52 * u : 0);
    const bottom = (R.y + R.h) * H - pad - 34 * u;
    const left = R.x * W + pad;
    const right = (R.x + R.w) * W - pad;
    if (g.spec.title) { const title = textBlock(root, (left + right) / 2, R.y * H + pad + 14 * u, g.spec.title, { size: 30 * u, weight: 800, fill: P.ink, maxChars: 34, maxLines: 1 }); rise(tl, title, inner, 16 * u, 0.4); }
    const series = t === 'decay_chart' && !items.length
      ? [{ label: 'Day 1', value: 100 }, { label: 'Day 2', value: 62 }, { label: 'Day 7', value: 31 }, { label: 'Day 30', value: 12 }]
      : items.map((it) => ({ label: it.label, value: Math.abs(Number(it.value) || 0) }));
    const count = Math.max(1, Math.min(6, series.length));
    const max = Math.max(...series.map((s) => s.value), 1);
    const slotW = (right - left) / count;
    const barW = Math.min(90 * u, slotW * 0.56);
    const base = drawnLine(root, left - 6 * u, bottom, right + 6 * u, bottom, mix(P.ink, 0.4), 2.5 * u);
    draw(tl, base, inner, 0.4);
    series.slice(0, 6).forEach((s, i) => {
      const at = inner + 0.2 + i * step;
      const hpx = Math.max(10 * u, ((bottom - top - 30 * u) * s.value) / max);
      const x = left + slotW * i + (slotW - barW) / 2;
      const fill = t === 'decay_chart' ? mix(P.accent, 1 - i * 0.16) : (i === 0 ? P.accent : mix(P.accent2, 0.85));
      const bar = el('rect', { x, y: bottom - hpx, width: barW, height: hpx, rx: 8 * u, fill }, root);
      gsap.set(bar, { transformOrigin: '50% 100%', scaleY: 0 });
      tl.to(bar, { scaleY: 1, duration: 0.5, ease: 'power3.out' }, at);
      const vt = el<SVGTextElement>('text', { x: x + barW / 2, y: bottom - hpx - 12 * u, 'font-family': FONT, 'font-size': 21 * u, 'font-weight': 800, fill: P.ink, 'text-anchor': 'middle' }, root);
      vt.textContent = String(s.value);
      tl.fromTo(vt, { opacity: 0 }, { opacity: 1, duration: 0.3 }, at + 0.15);
      const lbl = textBlock(root, x + barW / 2, bottom + 26 * u, s.label, { size: 17 * u, weight: 600, fill: mix(P.ink, 0.75), maxChars: 10, maxLines: 1 });
      rise(tl, lbl, at + 0.12, 8 * u, 0.35);
    });
  } else if (t === 'list_reveal') {
    panel(root, R, W, H, P, u);
    const pad = 34 * u;
    let y = R.y * H + pad + 20 * u;
    if (g.spec.title) { const title = textBlock(root, R.x * W + pad, y, g.spec.title, { size: 30 * u, weight: 800, fill: P.ink, anchor: 'start', maxChars: 28, maxLines: 1 }); rise(tl, title, inner, 14 * u, 0.4); y += 54 * u; }
    const rows = Math.max(1, Math.min(5, items.length));
    const rowGap = Math.min(72 * u, ((R.y + R.h) * H - pad - y) / rows);
    items.slice(0, 5).forEach((item, i) => {
      const at = inner + 0.2 + i * step;
      const ry = y + i * rowGap + rowGap * 0.4;
      const row = el<SVGGElement>('g', {}, root);
      const bx = R.x * W + pad;
      el('circle', { cx: bx + 15 * u, cy: ry - 8 * u, r: 15 * u, fill: mix(P.accent, 0.2), stroke: P.accent, 'stroke-width': 2 * u }, row);
      el('path', { d: `M ${bx + 8 * u} ${ry - 8 * u} l ${5 * u} ${5 * u} l ${9 * u} ${-11 * u}`, fill: 'none', stroke: P.accent, 'stroke-width': 2.6 * u, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, row);
      textBlock(row, bx + 44 * u, ry, item.label, { size: 26 * u, weight: 700, fill: P.ink, anchor: 'start', maxChars: 30, maxLines: 1 });
      if (item.sublabel) textBlock(row, bx + 44 * u, ry + 26 * u, item.sublabel, { size: 18 * u, weight: 500, fill: mix(P.ink, 0.65), anchor: 'start', maxChars: 42, maxLines: 1 });
      gsap.set(row, { x: -28 * u, opacity: 0 });
      tl.to(row, { x: 0, opacity: 1, duration: 0.45, ease: 'power3.out' }, at);
    });
  } else if (t === 'callout') {
    // Pill + drawn leader line pointing from the pill toward the frame content.
    const pillW = Math.min(R.w * W, Math.max((g.spec.title || '').length, 6) * 15 * u + 70 * u);
    const px = R.x * W + 10 * u;
    const py = cy;
    const pill = el<SVGGElement>('g', {}, root);
    el('rect', { x: px, y: py - 34 * u, width: pillW, height: 64 * u, rx: 32 * u, fill: mix(P.bg, 0.88), stroke: P.accent, 'stroke-width': 2.5 * u }, pill);
    textBlock(pill, px + pillW / 2, py + 6 * u, g.spec.title || '', { size: 24 * u, weight: 700, fill: P.ink, maxChars: 34, maxLines: 1 });
    pop(tl, pill, inner, 0.45);
    const tx = slot === 'right_third' ? px - 60 * u : px + pillW + 60 * u;
    const leader = drawnLine(root, slot === 'right_third' ? px : px + pillW, py, tx, py - 40 * u, mix(P.ink, 0.8), 3 * u);
    draw(tl, leader, inner + 0.25, 0.4);
    const dot = el('circle', { cx: tx, cy: py - 40 * u, r: 9 * u, fill: P.accent, stroke: '#fff', 'stroke-width': 2.5 * u }, root);
    pop(tl, dot, inner + 0.55, 0.3);
    if (g.spec.subtitle) { const sub = textBlock(root, px + pillW / 2, py + 58 * u, g.spec.subtitle, { size: 19 * u, weight: 500, fill: mix(P.ink, 0.9), maxChars: 40, maxLines: 2, shadow: true }); rise(tl, sub, inner + 0.4, 10 * u, 0.4); }
  } else if (t === 'arrow_flow') {
    panel(root, R, W, H, P, u);
    const pad = 30 * u;
    const count = Math.max(2, Math.min(4, items.length || 3));
    const vertical = R.h * H > R.w * W * 0.8;
    if (g.spec.title) { const title = textBlock(root, cx, R.y * H + pad + 16 * u, g.spec.title, { size: 28 * u, weight: 800, fill: P.ink, maxChars: 32, maxLines: 1 }); rise(tl, title, inner, 14 * u, 0.4); }
    const top = R.y * H + pad + (g.spec.title ? 58 * u : 10 * u);
    items.slice(0, 4).forEach((item, i) => {
      const at = inner + 0.2 + i * step;
      const bx = vertical ? cx : R.x * W + pad + ((R.w * W - pad * 2) * (i + 0.5)) / count;
      const by = vertical ? top + ((((R.y + R.h) * H - pad) - top) * (i + 0.5)) / count : (top + (R.y + R.h) * H - pad) / 2;
      const boxW = Math.min(210 * u, (vertical ? R.w * W - pad * 2 : (R.w * W - pad * 2) / count) * 0.9);
      const gnode = el<SVGGElement>('g', {}, root);
      el('rect', { x: bx - boxW / 2, y: by - 34 * u, width: boxW, height: 68 * u, rx: 16 * u, fill: mix(P.ink, 0.08), stroke: mix(P.ink, 0.3), 'stroke-width': 1.8 * u }, gnode);
      el('circle', { cx: bx - boxW / 2 + 2 * u, cy: by - 34 * u + 2 * u, r: 15 * u, fill: P.accent }, gnode);
      textBlock(gnode, bx - boxW / 2 + 2 * u, by - 26 * u, String(i + 1), { size: 17 * u, weight: 800, fill: '#fff' });
      textBlock(gnode, bx, by + 7 * u, item.label, { size: 21 * u, weight: 700, fill: P.ink, maxChars: 16, maxLines: 2 });
      rise(tl, gnode, at, 22 * u, 0.45);
      if (i < Math.min(4, items.length) - 1) {
        const arrow = vertical
          ? drawnLine(root, bx, by + 40 * u, bx, by + ((((R.y + R.h) * H - pad) - top) / count) - 40 * u + 40 * u, P.accent, 4 * u)
          : drawnLine(root, bx + boxW / 2 + 8 * u, by, bx + ((R.w * W - pad * 2) / count) - boxW / 2 - 8 * u, by, P.accent, 4 * u);
        draw(tl, arrow, at + 0.25, 0.35);
      }
    });
  } else if (t === 'icon_badge') {
    const names = (g.spec.icons && g.spec.icons.length ? g.spec.icons : items.map((i) => i.icon || 'star')).slice(0, 3);
    const count = Math.max(1, names.length);
    const size = Math.min(R.w * W / (count + 0.5), R.h * H * 0.42, 190 * u);
    names.forEach((name, i) => {
      const at = inner + i * 0.22;
      const bx = cx + (i - (count - 1) / 2) * size * 1.35;
      const by = cy - 14 * u;
      const badge = el<SVGGElement>('g', {}, root);
      el('circle', { cx: bx, cy: by, r: size * 0.56, fill: mix(P.bg, 0.82), stroke: mix(P.accent, 0.9), 'stroke-width': 3 * u }, badge);
      iconNode(badge, name, bx, by, size * 0.62, P.accent);
      pop(tl, badge, at, 0.5);
      const label = items[i]?.label || '';
      if (label) { const lbl = textBlock(root, bx, by + size * 0.56 + 34 * u, label, { size: 21 * u, weight: 700, fill: P.ink, maxChars: 16, maxLines: 2, shadow: true }); rise(tl, lbl, at + 0.2, 10 * u, 0.4); }
      // Gentle idle float so icons feel alive during the hold (finite repeats
      // so the timeline keeps a measurable duration for the fit pass below).
      const floats = Math.max(1, Math.ceil((total - at - 0.5) / 1.3));
      tl.to(badge, { y: -7 * u, duration: 1.3, ease: 'sine.inOut', repeat: floats, yoyo: true }, at + 0.5);
    });
    if (g.spec.title) { const title = textBlock(root, cx, R.y * H + 40 * u, g.spec.title, { size: 27 * u, weight: 800, fill: P.ink, maxChars: 30, maxLines: 1, shadow: true }); rise(tl, title, inner, 14 * u, 0.4); }
  } else if (t === 'diagram') {
    panel(root, R, W, H, P, u);
    const count = Math.max(2, Math.min(5, items.length || 3));
    const rx = R.w * W * 0.32;
    const ry = R.h * H * 0.3;
    const hubW = Math.min(R.w * W * 0.5, Math.max((g.spec.title || 'hub').length, 6) * 15 * u + 56 * u);
    items.slice(0, 5).forEach((item, i) => {
      const at = inner + 0.25 + i * step;
      const a = -Math.PI / 2 + (2 * Math.PI * i) / count;
      const nx = cx + rx * Math.cos(a);
      const ny = cy + ry * Math.sin(a);
      const edge = drawnLine(root, cx, cy, nx, ny, mix(P.accent, 0.6), 2.6 * u);
      draw(tl, edge, at, 0.35);
      const bw = Math.min(R.w * W * 0.4, Math.max(item.label.length, 5) * 12 * u + 44 * u);
      const node = el<SVGGElement>('g', {}, root);
      el('rect', { x: nx - bw / 2, y: ny - 26 * u, width: bw, height: 52 * u, rx: 15 * u, fill: mix(P.ink, 0.08), stroke: mix(P.ink, 0.3), 'stroke-width': 1.8 * u }, node);
      textBlock(node, nx, ny + 7 * u, item.label, { size: 19 * u, weight: 700, fill: P.ink, maxChars: 14, maxLines: 1 });
      pop(tl, node, at + 0.15, 0.4);
    });
    const hub = el<SVGGElement>('g', {}, root);
    el('rect', { x: cx - hubW / 2, y: cy - 32 * u, width: hubW, height: 64 * u, rx: 18 * u, fill: P.accent }, hub);
    textBlock(hub, cx, cy + 8 * u, g.spec.title || '', { size: 23 * u, weight: 800, fill: '#fff', maxChars: 18, maxLines: 1 });
    pop(tl, hub, inner, 0.45);
  } else if (t === 'progress') {
    const pct = clamp(Number(g.spec.percent) || Number(g.spec.stat?.value) || 0, 0, 100);
    const barY = cy;
    const barX = R.x * W + 24 * u;
    const barW = R.w * W - 48 * u;
    panel(root, { x: R.x, y: (barY - 84 * u) / H, w: R.w, h: (150 * u) / H }, W, H, P, u, 20);
    if (g.spec.title) { const title = textBlock(root, barX, barY - 36 * u, g.spec.title, { size: 25 * u, weight: 800, fill: P.ink, anchor: 'start', maxChars: 36, maxLines: 1 }); rise(tl, title, inner, 12 * u, 0.4); }
    el('rect', { x: barX, y: barY - 11 * u, width: barW, height: 22 * u, rx: 11 * u, fill: mix(P.ink, 0.14) }, root);
    const fillRect = el('rect', { x: barX, y: barY - 11 * u, width: barW, height: 22 * u, rx: 11 * u, fill: P.accent }, root);
    gsap.set(fillRect, { transformOrigin: '0% 50%', scaleX: 0 });
    tl.to(fillRect, { scaleX: pct / 100, duration: Math.min(1.6, total * 0.5), ease: 'power2.inOut' }, inner + 0.1);
    const pctText = el<SVGTextElement>('text', { x: barX + barW, y: barY + 44 * u, 'font-family': FONT, 'font-size': 30 * u, 'font-weight': 900, fill: P.ink, 'text-anchor': 'end' }, root);
    pctText.textContent = '0%';
    const c = { v: 0 };
    tl.to(c, { v: pct, duration: Math.min(1.6, total * 0.5), ease: 'power2.inOut', onUpdate: () => { pctText.textContent = `${Math.round(c.v)}%`; } }, inner + 0.1);
  } else if (t === 'compare') {
    panel(root, R, W, H, P, u);
    const pad = 26 * u;
    const halves = [
      { title: g.spec.leftTitle || 'A', entries: (g.spec.leftItems || []).slice(0, 4), tone: P.accent, x: R.x * W + pad, from: -1 },
      { title: g.spec.rightTitle || 'B', entries: (g.spec.rightItems || []).slice(0, 4), tone: P.accent2, x: R.x * W + R.w * W / 2 + pad / 2, from: 1 },
    ];
    const half = R.w * W / 2 - pad * 1.5;
    const top = R.y * H + pad + (g.spec.title ? 50 * u : 0);
    if (g.spec.title) { const title = textBlock(root, cx, R.y * H + pad + 12 * u, g.spec.title, { size: 27 * u, weight: 800, fill: P.ink, maxChars: 32, maxLines: 1 }); rise(tl, title, inner, 12 * u, 0.4); }
    halves.forEach((hh, pi) => {
      const gp = el<SVGGElement>('g', {}, root);
      el('rect', { x: hh.x, y: top, width: half, height: (R.y + R.h) * H - pad - top, rx: 18 * u, fill: mix(P.ink, 0.05), stroke: hh.tone, 'stroke-width': 2 * u }, gp);
      textBlock(gp, hh.x + half / 2, top + 40 * u, hh.title, { size: 24 * u, weight: 800, fill: hh.tone, maxChars: 16, maxLines: 1 });
      gsap.set(gp, { x: hh.from * 36 * u, opacity: 0 });
      tl.to(gp, { x: 0, opacity: 1, duration: 0.5, ease: 'power3.out' }, inner + pi * 0.15);
      hh.entries.forEach((entry, ei) => {
        const ey = top + 84 * u + ei * 46 * u;
        const row = el<SVGGElement>('g', {}, root);
        el('circle', { cx: hh.x + 24 * u, cy: ey - 7 * u, r: 6 * u, fill: hh.tone }, row);
        textBlock(row, hh.x + 42 * u, ey, entry, { size: 19 * u, weight: 600, fill: mix(P.ink, 0.9), anchor: 'start', maxChars: 22, maxLines: 1 });
        rise(tl, row, inner + 0.35 + pi * 0.15 + ei * Math.min(0.22, step), 12 * u, 0.4);
      });
    });
  } else if (t === 'quote_card') {
    const q = g.spec.title || g.narration_ref || '';
    panel(root, R, W, H, P, u, 26);
    const mark = el<SVGTextElement>('text', { x: R.x * W + 56 * u, y: R.y * H + 96 * u, 'font-family': 'Georgia, serif', 'font-size': 120 * u, 'font-weight': 800, fill: mix(P.accent, 0.7), 'text-anchor': 'middle' }, root);
    mark.textContent = '“';
    pop(tl, mark, inner, 0.4);
    const body = textBlock(root, cx, cy - 6 * u, q, { size: 34 * u, weight: 700, fill: P.ink, maxChars: 30, maxLines: 4, lineHeight: 1.35 });
    rise(tl, body, inner + 0.15, 24 * u, 0.6);
    if (g.spec.subtitle) {
      const rule = drawnLine(root, cx - 46 * u, (R.y + R.h) * H - 74 * u, cx + 46 * u, (R.y + R.h) * H - 74 * u, P.accent, 3.5 * u);
      draw(tl, rule, inner + 0.55, 0.35);
      const attr = textBlock(root, cx, (R.y + R.h) * H - 44 * u, g.spec.subtitle, { size: 20 * u, weight: 600, fill: mix(P.ink, 0.7), maxChars: 40, maxLines: 1 });
      rise(tl, attr, inner + 0.7, 10 * u, 0.4);
    }
  } else if (t === 'image_card') {
    // A real screenshot / uploaded asset floating in a card with a slow pan.
    const imgUrl = g.spec.imageUrl ? await toDataUrl(g.spec.imageUrl) : '';
    const cw = R.w * W;
    const ch = R.h * H;
    const card = el<SVGGElement>('g', {}, root);
    el('rect', { x: R.x * W, y: R.y * H, width: cw, height: ch, rx: 20 * u, fill: mix(P.bg, 0.92), stroke: mix(P.ink, 0.2), 'stroke-width': 1.6 * u, style: 'filter: drop-shadow(0 12px 34px rgba(0,0,0,0.5))' }, card);
    // Browser chrome dots for product-screenshot feel.
    ['#F26D6D', '#E8A33C', '#7FD4B4'].forEach((c, i) => el('circle', { cx: R.x * W + (26 + i * 24) * u, cy: R.y * H + 24 * u, r: 6.5 * u, fill: c }, card));
    if (imgUrl) {
      const clipId = `dgclip${Math.floor(Math.random() * 1e9)}`;
      const cp = el('clipPath', { id: clipId }, svg.querySelector('defs') as SVGElement);
      el('rect', { x: R.x * W + 10 * u, y: R.y * H + 42 * u, width: cw - 20 * u, height: ch - 54 * u, rx: 12 * u }, cp);
      const imgG = el<SVGGElement>('g', { 'clip-path': `url(#${clipId})` }, card);
      const img = el('image', { x: R.x * W + 10 * u, y: R.y * H + 42 * u, width: cw - 20 * u, height: (cw - 20 * u) * 1.4, href: imgUrl, preserveAspectRatio: 'xMidYMin slice' }, imgG);
      img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', imgUrl);
      // Slow scroll/pan of the screenshot inside the card.
      tl.to(img, { y: -Math.max(0, (cw - 20 * u) * 1.4 - (ch - 54 * u)) * 0.6, duration: Math.max(2, total - 1.2), ease: 'sine.inOut' }, inner + 0.4);
    } else {
      textBlock(card, cx, cy, g.spec.title || 'Screenshot', { size: 24 * u, weight: 700, fill: mix(P.ink, 0.6), maxChars: 26, maxLines: 2 });
    }
    pop(tl, card, inner, 0.5);
    if (g.spec.title && imgUrl) {
      const cap = textBlock(root, cx, (R.y + R.h) * H + 34 * u, g.spec.title, { size: 21 * u, weight: 700, fill: P.ink, maxChars: 34, maxLines: 1, shadow: true });
      rise(tl, cap, inner + 0.35, 10 * u, 0.4);
    }
  } else {
    // Unknown treatment — never blank: fall back to kinetic type on the title.
    const body = textBlock(root, cx, cy, g.spec.title || g.narration_ref || '', { size: 44 * u, weight: 800, fill: P.ink, maxChars: 22, maxLines: 3, shadow: true });
    rise(tl, body, inner, 26 * u, 0.55);
  }

  // Compress the content reveal if the window is short. Idle loops (icon
  // float, image pan) are sized to the window, so only meaningfully longer
  // reveals get compressed — and never by a runaway factor.
  const naturalEnd = tl.duration();
  const budget = Math.max(0.9, total - 0.55);
  if (Number.isFinite(naturalEnd) && naturalEnd > budget) tl.timeScale(Math.min(3, naturalEnd / budget));

  // Entrance / hold drift / exit for the whole graphic (unscaled real time).
  const outer = gsap.timeline({ paused: true });
  outer.add(tl.play(), 0);
  animateIn(outer, root, g.anim_in, u, maxOpacity);
  outer.to(root, { y: `-=${4 * u}`, duration: Math.max(0.5, total - 1), ease: 'sine.inOut' }, 0.6);
  animateOut(outer, root, g.anim_out, u, total);
  outer.pause(0);

  return { svg, timeline: outer, durationSec: total };
}
