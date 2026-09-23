/**
 * MOTION-DESIGN LAYER — lightweight branded motion built with SVG + GSAP and
 * rendered by the browser's capture layer (HTML/SVG/GSAP → real video clip —
 * deliberately NOT Remotion).
 *
 * Two delivery modes:
 *   1. BACKDROP — injectMotionBackdrop() inserts an ambient layer INTO a
 *      captured scene's SVG (mockups, graphics, asset scenes) so the motion
 *      renders behind/around the main content in the same recording pass.
 *   2. OVERLAY — buildMotionOverlay() builds a standalone animation on black
 *      that the capture layer records to WebM; the composition stage lays it
 *      over Veo footage with a screen blend at the scene's tunable opacity
 *      (light on black composites additively — glow, particles, gradients).
 *
 * Motion supports the story and brand — intensity and opacity are Opus-tuned
 * per scene and kept subtle by construction. Never visual noise.
 */

import { gsap } from 'https://esm.sh/gsap@3.12.5';
import type { BuiltAnimation } from '../../ScriptToVideo/pipeline/capture';
import { MotionSpec } from './api';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface MotionPalette { bg: string; ink: string; accent: string; accent2: string }

type Attrs = Record<string, string | number>;
function el<T extends SVGElement>(tag: string, attrs: Attrs = {}, parent?: SVGElement | null): T {
  const node = document.createElementNS(SVG_NS, tag) as T;
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, String(v)));
  if (parent) parent.appendChild(node);
  return node;
}

function rgba(hex: string, opacity: number): string {
  const h = String(hex || '#888888').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const n = parseInt(full, 16) || 0x888888;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${opacity})`;
}

function clamp01(v: unknown, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : d;
}

/**
 * Paint one motion treatment into `group` and add its tweens to `tl`.
 * `bright` = overlay mode (content on black for screen-blend compositing):
 * elements render brighter because the blend, not the SVG, applies opacity.
 */
function paintMotion(
  group: SVGGElement,
  defs: SVGElement,
  tl: any,
  spec: MotionSpec,
  P: MotionPalette,
  W: number,
  H: number,
  total: number,
  bright: boolean,
): void {
  const intensity = clamp01(spec.intensity, 0.5);
  const base = bright ? 0.85 : 0.10 + intensity * 0.14; // backdrop stays subtle by construction
  const u = Math.min(W, H) / 1080;
  const uid = `mo${Math.floor(Math.random() * 1e9)}`;

  if (spec.kind === 'gradient_flow') {
    const colors = [P.accent, P.accent2, P.accent];
    for (let i = 0; i < 3; i += 1) {
      const gid = `${uid}g${i}`;
      const grad = el('radialGradient', { id: gid, cx: '50%', cy: '50%', r: '50%' }, defs);
      el('stop', { offset: '0%', 'stop-color': colors[i], 'stop-opacity': base }, grad);
      el('stop', { offset: '100%', 'stop-color': colors[i], 'stop-opacity': 0 }, grad);
      const r = (0.42 + i * 0.16) * Math.max(W, H);
      const blob = el('circle', { cx: W * (0.2 + i * 0.3), cy: H * (i % 2 ? 0.75 : 0.25), r, fill: `url(#${gid})` }, group);
      tl.to(blob, { attr: { cx: W * (0.8 - i * 0.3), cy: H * (i % 2 ? 0.3 : 0.7) }, duration: total * (0.9 + i * 0.2), ease: 'sine.inOut', repeat: -1, yoyo: true }, 0);
    }
  } else if (spec.kind === 'ambient_glow') {
    for (let i = 0; i < 2; i += 1) {
      const gid = `${uid}a${i}`;
      const grad = el('radialGradient', { id: gid, cx: '50%', cy: '50%', r: '50%' }, defs);
      el('stop', { offset: '0%', 'stop-color': i ? P.accent2 : P.accent, 'stop-opacity': base * 1.15 }, grad);
      el('stop', { offset: '100%', 'stop-color': i ? P.accent2 : P.accent, 'stop-opacity': 0 }, grad);
      const orb = el('circle', { cx: i ? W * 0.85 : W * 0.15, cy: i ? H * 0.2 : H * 0.85, r: Math.max(W, H) * 0.38, fill: `url(#${gid})` }, group);
      gsap.set(orb, { transformOrigin: '50% 50%', scale: 0.85 });
      tl.to(orb, { scale: 1.15, duration: Math.max(2.4, total / 2), ease: 'sine.inOut', repeat: -1, yoyo: true }, i * 0.8);
    }
  } else if (spec.kind === 'particles') {
    const count = Math.round(14 + intensity * 26);
    for (let i = 0; i < count; i += 1) {
      const r = (1.4 + Math.random() * 3.2) * u;
      const x = Math.random() * W;
      const y = H * (0.15 + Math.random() * 0.95);
      const dot = el('circle', { cx: x, cy: y, r, fill: rgba(i % 3 ? P.accent : P.accent2, bright ? 0.9 : base * (0.5 + Math.random() * 0.5)) }, group);
      const rise = H * (0.25 + Math.random() * 0.4);
      const drift = (Math.random() - 0.5) * W * 0.12;
      tl.to(dot, { attr: { cy: y - rise, cx: x + drift }, duration: total * (0.7 + Math.random() * 0.6), ease: 'none', repeat: -1 }, Math.random() * -total);
      tl.to(dot, { opacity: 0.15 + Math.random() * 0.5, duration: 0.9 + Math.random() * 1.4, ease: 'sine.inOut', repeat: -1, yoyo: true }, Math.random());
    }
  } else if (spec.kind === 'lines') {
    const count = Math.round(3 + intensity * 4);
    for (let i = 0; i < count; i += 1) {
      const y = H * (0.12 + (i / Math.max(1, count - 1)) * 0.76);
      const len = W * (0.3 + Math.random() * 0.45);
      const line = el('rect', { x: -len, y, width: len, height: Math.max(1.5, 2.2 * u), rx: 1.5 * u, fill: rgba(i % 2 ? P.accent2 : P.accent, bright ? 0.8 : base) }, group);
      gsap.set(line, { skewX: -18 });
      tl.fromTo(line, { x: -len }, { x: W + len, duration: total * (0.55 + Math.random() * 0.5), ease: 'power1.inOut', repeat: -1, delay: 0 }, (i / count) * total * 0.4);
    }
  } else if (spec.kind === 'grid') {
    const step = Math.max(60 * u, Math.min(W, H) / 12);
    const gridGroup = el<SVGGElement>('g', { opacity: bright ? 0.5 : base }, group);
    for (let x = step / 2; x < W; x += step) el('line', { x1: x, y1: 0, x2: x, y2: H, stroke: rgba(P.accent, 0.5), 'stroke-width': Math.max(1, u) }, gridGroup);
    for (let y = step / 2; y < H; y += step) el('line', { x1: 0, y1: y, x2: W, y2: y, stroke: rgba(P.accent, 0.5), 'stroke-width': Math.max(1, u) }, gridGroup);
    tl.to(gridGroup, { opacity: (bright ? 0.5 : base) * 0.45, duration: Math.max(2, total / 3), ease: 'sine.inOut', repeat: -1, yoyo: true }, 0);
    // A soft scanning highlight travelling down the grid.
    const scanId = `${uid}s`;
    const grad = el('linearGradient', { id: scanId, x1: '0%', y1: '0%', x2: '0%', y2: '100%' }, defs);
    el('stop', { offset: '0%', 'stop-color': P.accent2, 'stop-opacity': 0 }, grad);
    el('stop', { offset: '50%', 'stop-color': P.accent2, 'stop-opacity': bright ? 0.55 : base * 1.3 }, grad);
    el('stop', { offset: '100%', 'stop-color': P.accent2, 'stop-opacity': 0 }, grad);
    const scan = el('rect', { x: 0, y: -H * 0.3, width: W, height: H * 0.3, fill: `url(#${scanId})` }, group);
    tl.to(scan, { attr: { y: H }, duration: Math.max(3, total * 0.8), ease: 'sine.inOut', repeat: -1 }, 0);
  }
}

/**
 * BACKDROP MODE — inject the ambient motion layer into an existing captured
 * scene's SVG so it renders behind the main content in the same pass. The
 * group is inserted right after the scene's base background rect (or first,
 * when none exists) so content painted later stays on top.
 */
export function injectMotionBackdrop(
  svg: SVGSVGElement,
  timeline: any,
  spec: MotionSpec | null | undefined,
  P: MotionPalette,
  W: number,
  H: number,
  durationSec: number,
): void {
  if (!spec || spec.kind === 'none') return;
  let defs = svg.querySelector('defs') as SVGElement | null;
  if (!defs) { defs = el('defs'); svg.insertBefore(defs, svg.firstChild); }
  const group = el<SVGGElement>('g');
  // Find the base full-canvas rect (first direct <rect> child) and slot in after it.
  const children = Array.from(svg.children);
  const baseRect = children.find((c) => c.tagName.toLowerCase() === 'rect');
  if (baseRect && baseRect.nextSibling) svg.insertBefore(group, baseRect.nextSibling);
  else if (baseRect) svg.appendChild(group);
  else if (defs.nextSibling) svg.insertBefore(group, defs.nextSibling);
  else svg.appendChild(group);
  paintMotion(group, defs, timeline, spec, P, W, H, Math.max(3, durationSec), false);
}

/**
 * OVERLAY MODE — a standalone motion layer on BLACK, recorded to WebM by the
 * capture layer and composited over Veo footage with blend=screen at the
 * scene's opacity in the FFmpeg composition pass. Black contributes nothing
 * under a screen blend, so only the light (glow/particles/gradients) lands.
 */
export function buildMotionOverlay(
  spec: MotionSpec,
  P: MotionPalette,
  W: number,
  H: number,
  durationSec: number,
): BuiltAnimation {
  const total = Math.max(3, durationSec);
  const svg = el<SVGSVGElement>('svg', { xmlns: SVG_NS, viewBox: `0 0 ${W} ${H}`, width: W, height: H });
  const defs = el('defs', {}, svg);
  el('rect', { x: 0, y: 0, width: W, height: H, fill: '#000000' }, svg);
  const group = el<SVGGElement>('g', {}, svg);
  const tl = gsap.timeline({ paused: true });
  paintMotion(group, defs, tl, spec, P, W, H, total, true);
  return { svg, timeline: tl, durationSec: total };
}
