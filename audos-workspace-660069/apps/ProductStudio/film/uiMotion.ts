/**
 * UI MOTION — the interaction layer for PRODUCT_UI / UI_ANIMATION scenes.
 *
 * The base scene is the shared device-mockup renderer (a REAL screenshot in a
 * phone/laptop/browser frame — generative video is never asked to make a UI).
 * This module injects, into that already-built SVG + GSAP timeline:
 *
 *   - an animated CURSOR that travels to the UI region the narration talks
 *     about (never teleports), with a press + ripple on click, caret pulses
 *     for typing, or a vertical drift for scroll;
 *   - an optional CALLOUT: a leader line + accent pill labelling what just
 *     happened (≤5 words — support, not the visual).
 *
 * The cursor group is injected INSIDE the device group so it inherits the
 * scene's camera motion (zoom/pan) and stays glued to the screen pixels.
 * Injection is best-effort: any failure ships the scene without the cursor.
 */

import { gsap } from 'https://esm.sh/gsap@3.12.5';

const SVG_NS = 'http://www.w3.org/2000/svg';

type Attrs = Record<string, string | number>;
function el<T extends SVGElement>(tag: string, attrs: Attrs = {}, parent?: SVGElement | null): T {
  const node = document.createElementNS(SVG_NS, tag) as T;
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, String(v)));
  if (parent) parent.appendChild(node);
  return node;
}

export interface CursorSpec {
  action?: 'click' | 'move' | 'scroll' | 'type';
  callout?: string;
}

interface ScreenRect { x: number; y: number; w: number; h: number }

/** Mirror of the shared mockup renderer's device geometry — keeps the cursor
 * math in one deterministic place without touching the shared module. */
function screenRect(device: string, hasHeadline: boolean, W: number, H: number): ScreenRect {
  const portrait = H > W;
  const u = Math.min(W, H) / 1080;
  const lift = hasHeadline ? H * 0.03 : 0;
  if (device === 'phone') {
    const bodyH = H * (portrait ? 0.72 : 0.78);
    const bodyW = bodyH * 0.485;
    const bx = W / 2 - bodyW / 2;
    const by = H * 0.5 - bodyH / 2 + lift;
    return { x: bx + 10 * u, y: by + 10 * u, w: bodyW - 20 * u, h: bodyH - 20 * u };
  }
  if (device === 'laptop') {
    const lidW = Math.min(W * 0.72, H * 1.15);
    const lidH = lidW * 0.625;
    return { x: W / 2 - lidW / 2, y: H * 0.5 - lidH / 2 - H * 0.03 + lift, w: lidW, h: lidH };
  }
  const winW = Math.min(W * 0.76, H * 1.25);
  const winH = winW * 0.62;
  const wx = W / 2 - winW / 2;
  const wy = H * 0.5 - winH / 2 + lift;
  const chrome = 54 * u;
  return { x: wx + 3 * u, y: wy + chrome, w: winW - 6 * u, h: winH - 3 * u };
}

/** Find the mockup's device group (the <g> containing the clipped screen) so
 * the cursor inherits the camera motion. */
function findDeviceGroup(svg: SVGSVGElement): SVGGElement | null {
  const root = Array.from(svg.children).find((c) => c.tagName.toLowerCase() === 'g') as SVGGElement | undefined;
  if (!root) return null;
  const groups = Array.from(root.children).filter((c) => c.tagName.toLowerCase() === 'g') as SVGGElement[];
  return groups.find((g) => g.querySelector('[clip-path]')) || groups[0] || null;
}

/**
 * Inject the cursor (+ optional callout) into a built mockup scene.
 * `focus` is the fractional screen region the narration talks about.
 */
export function injectCursorAnimation(params: {
  svg: SVGSVGElement;
  timeline: any;
  durationSec: number;
  device: 'phone' | 'laptop' | 'browser';
  hasHeadline: boolean;
  focus?: { x: number; y: number; w: number; h: number } | null;
  cursor: CursorSpec;
  accent: string;
  W: number;
  H: number;
}): void {
  try {
    const { svg, timeline: tl, durationSec, device, hasHeadline, focus, cursor, accent, W, H } = params;
    const host = findDeviceGroup(svg);
    if (!host) return;
    const u = Math.min(W, H) / 1080;
    const S = screenRect(device, hasHeadline, W, H);
    const f = focus && Number.isFinite(focus.x) ? focus : { x: 0.3, y: 0.35, w: 0.4, h: 0.25 };
    const tx = S.x + S.w * Math.min(0.95, Math.max(0.05, f.x + f.w / 2));
    const ty = S.y + S.h * Math.min(0.95, Math.max(0.05, f.y + f.h / 2));
    const action = cursor.action || 'click';
    const total = Math.max(3, durationSec);

    // --- the cursor (macOS-style pointer, phone gets a touch dot) ---
    const cg = el<SVGGElement>('g', { opacity: 0 }, host);
    const scale = 1.15 * u;
    let hotX = 0; let hotY = 0; // hotspot offset inside the cursor group
    if (device === 'phone') {
      el('circle', { cx: 0, cy: 0, r: 17 * scale, fill: 'rgba(255,255,255,0.45)', stroke: 'rgba(255,255,255,0.9)', 'stroke-width': 2 * u }, cg);
    } else {
      const p = el('path', {
        d: 'M0,0 L0,26 L6.2,20.4 L10.4,29 L14.4,27 L10.2,18.6 L18,18 Z',
        fill: '#FFFFFF', stroke: '#1A1C22', 'stroke-width': 1.4, 'stroke-linejoin': 'round',
      }, cg);
      p.setAttribute('transform', `scale(${scale * 1.5})`);
      hotX = 1 * u; hotY = 1 * u;
    }

    // Entry: from the lower third of the screen, travelling — never teleporting.
    const sx = S.x + S.w * 0.72;
    const sy = S.y + S.h * 0.86;
    gsap.set(cg, { x: sx - hotX, y: sy - hotY });
    const tIn = 0.9;                       // after the device entrance settles
    const travel = Math.min(1.2, total * 0.22);
    tl.to(cg, { opacity: 1, duration: 0.25 }, tIn);
    tl.to(cg, { x: tx - hotX, y: ty - hotY, duration: travel, ease: 'power2.inOut' }, tIn + 0.1);
    const tAt = tIn + 0.1 + travel;        // cursor arrives

    const ripple = (at: number) => {
      const r = el('circle', { cx: tx, cy: ty, r: 6 * u, fill: 'none', stroke: accent, 'stroke-width': 3 * u, opacity: 0 }, host);
      tl.to(r, { opacity: 0.85, duration: 0.06 }, at);
      tl.to(r, { attr: { r: 44 * u }, opacity: 0, duration: 0.55, ease: 'power2.out' }, at + 0.06);
      tl.to(cg, { scale: 0.86, duration: 0.09, transformOrigin: 'top left', ease: 'power2.in' }, at - 0.05);
      tl.to(cg, { scale: 1, duration: 0.14, ease: 'power2.out' }, at + 0.06);
    };

    if (action === 'click') {
      ripple(tAt + 0.15);
    } else if (action === 'type') {
      ripple(tAt + 0.15);
      // A caret pulsing at the focus point after the click.
      const caret = el('rect', { x: tx + 10 * u, y: ty - 12 * u, width: 2.4 * u, height: 24 * u, fill: accent, opacity: 0 }, host);
      for (let i = 0; i < 4; i += 1) {
        tl.to(caret, { opacity: 1, duration: 0.12 }, tAt + 0.5 + i * 0.5);
        tl.to(caret, { opacity: 0.15, duration: 0.22 }, tAt + 0.72 + i * 0.5);
      }
    } else if (action === 'scroll') {
      // The cursor drifts down the screen with a small flick.
      tl.to(cg, { y: ty - hotY + S.h * 0.18, duration: Math.min(1.4, total * 0.3), ease: 'sine.inOut' }, tAt + 0.2);
    }
    // Gentle idle drift so the cursor never freezes.
    tl.to(cg, { x: `+=${6 * u}`, y: `+=${4 * u}`, duration: 1.2, ease: 'sine.inOut' }, tAt + 1.1);
    tl.to(cg, { opacity: 0, duration: 0.3 }, Math.max(tAt + 1.2, total - 0.55));

    // --- optional callout: leader line + accent label pill ---
    const label = String(cursor.callout || '').trim().slice(0, 42);
    if (label) {
      const above = ty > S.y + S.h * 0.4;
      const lx = Math.min(W * 0.86, Math.max(W * 0.14, tx + S.w * 0.16));
      const ly = above ? ty - S.h * 0.24 : ty + S.h * 0.24;
      const cgroup = el<SVGGElement>('g', { opacity: 0 }, host);
      const line = el('line', { x1: tx, y1: ty, x2: lx, y2: ly, stroke: accent, 'stroke-width': 2.6 * u, 'stroke-dasharray': '2 6', 'stroke-linecap': 'round' }, cgroup);
      el('circle', { cx: tx, cy: ty, r: 5 * u, fill: accent }, cgroup);
      const fs = 22 * u;
      const pw = label.length * fs * 0.58 + 36 * u;
      const ph = fs * 2;
      el('rect', { x: lx - pw / 2, y: ly - ph / 2, width: pw, height: ph, rx: ph / 2, fill: '#1E2434', stroke: accent, 'stroke-width': 1.8 * u, opacity: 0.96 }, cgroup);
      const t = el<SVGTextElement>('text', { x: lx, y: ly + fs * 0.34, 'font-family': "Inter, -apple-system, 'Segoe UI', Arial, sans-serif", 'font-size': fs, 'font-weight': 700, fill: '#FFFFFF', 'text-anchor': 'middle' }, cgroup);
      t.textContent = label;
      const tCall = tAt + (action === 'click' || action === 'type' ? 0.75 : 0.4);
      gsap.set(line, { attr: { x2: tx, y2: ty } });
      tl.to(cgroup, { opacity: 1, duration: 0.25, ease: 'power1.out' }, tCall);
      tl.to(line, { attr: { x2: lx, y2: ly }, duration: 0.4, ease: 'power2.out' }, tCall);
      tl.to(cgroup, { opacity: 0, duration: 0.3 }, Math.max(tCall + 1, total - 0.5));
    }
  } catch { /* the scene ships without the cursor layer */ }
}
