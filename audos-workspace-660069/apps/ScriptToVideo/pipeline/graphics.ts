/**
 * GRAPHICS LAYER — deterministic HTML/SVG + GSAP motion graphics.
 *
 * Opus 5 writes a GraphicSpec (exact strings, exact numbers, a per-scene
 * palette and treatment); this engine renders EXACTLY that spec as an animated
 * SVG. The capture layer records the same animation the user previews into a
 * real WebM clip for FFmpeg assembly — readable text never goes near Veo.
 *
 * Visual variety is structural, not accidental: eleven treatments, per-scene
 * palettes chosen by Opus for the content's mood, three background textures,
 * and animated accents — so no two scenes fall back to the same blue card.
 *
 * Serialization constraints (the capture path rasterizes through an <img>,
 * which loads no external resources): concrete hex colors, per-element system
 * font stacks, and images inlined as data: URLs before building.
 */

import { gsap } from 'https://esm.sh/gsap@3.12.5';
import { FilmStyle, GraphicItem, GraphicSpec, Palette } from '../api';
import { BuiltAnimation, toDataUrl } from './capture';

const SVG_NS = 'http://www.w3.org/2000/svg';
const FONT = "Inter, -apple-system, 'Segoe UI', Arial, sans-serif";

// The film style the director (Opus) chose from the script's tone — set at
// the start of every buildGraphic() call (the build is synchronous, so this
// module-level slot cannot race). When present, its font and weights are
// applied to EVERY text node verbatim; the FONT constant above and the
// PALETTES list below only serve films planned before the style field existed.
let ACTIVE: { font: string; heading: number; body: number } | null = null;
const face = () => (ACTIVE ? ACTIVE.font : FONT);
const fw = (w: number) => (ACTIVE ? (w >= 700 ? ACTIVE.heading : ACTIVE.body) : w);

const PALETTES: Palette[] = [
  { bg: '#101418', ink: '#F5F3EE', accent: '#E8A33C', accent2: '#7FD4B4' },
  { bg: '#0D1321', ink: '#F0F4FF', accent: '#5EA8FF', accent2: '#F26D6D' },
  { bg: '#141019', ink: '#F4EFF8', accent: '#B387F5', accent2: '#63D6C0' },
  { bg: '#0F1712', ink: '#EFF6EE', accent: '#57C785', accent2: '#F2B84B' },
  { bg: '#1A1212', ink: '#F8F1EC', accent: '#F07857', accent2: '#7FB7D9' },
  { bg: '#F3EFE7', ink: '#20242C', accent: '#C4542C', accent2: '#2C6E63' },
];

export function resolvePalette(spec: { palette?: Partial<Palette>; title?: string }, seed = '', style?: FilmStyle | null): Palette {
  const hex = (v: unknown, fb: string) => (typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : fb);
  // The per-scene palette Opus wrote wins field by field; any gap falls to the
  // FILM style the director chose from the script's tone. The hashed PALETTES
  // list is reached only for films planned before the style field existed.
  let base: Palette;
  if (style && style.colors) {
    base = {
      bg: hex(style.colors.background, '#101418'),
      ink: hex(style.colors.text, '#F5F3EE'),
      accent: hex(style.colors.primary, '#E8A33C'),
      accent2: hex(style.colors.accent, hex(style.colors.secondary, '#7FD4B4')),
    };
  } else {
    const text = `${spec.title || ''}${seed}`;
    let hash = 5381;
    for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
    base = PALETTES[hash % PALETTES.length];
  }
  return {
    bg: hex(spec.palette?.bg, base.bg),
    ink: hex(spec.palette?.ink, base.ink),
    accent: hex(spec.palette?.accent, base.accent),
    accent2: hex(spec.palette?.accent2, base.accent2),
  };
}

type Attrs = Record<string, string | number>;
function el<T extends SVGElement>(tag: string, attrs: Attrs = {}, parent?: SVGElement | null): T {
  const node = document.createElementNS(SVG_NS, tag) as T;
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, String(v)));
  if (parent) parent.appendChild(node);
  return node;
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

interface TextOpts { size: number; weight?: number; fill: string; anchor?: 'start' | 'middle' | 'end'; maxChars?: number; maxLines?: number; lineHeight?: number }
function textBlock(parent: SVGElement, x: number, y: number, content: string, o: TextOpts): SVGTextElement {
  const node = el<SVGTextElement>('text', { x, y, 'font-family': face(), 'font-size': o.size, 'font-weight': fw(o.weight || 600), fill: o.fill, 'text-anchor': o.anchor || 'middle' }, parent);
  const lines = o.maxChars ? wrapLines(content, o.maxChars, o.maxLines || 3) : [String(content || '')];
  const lh = (o.lineHeight || 1.22) * o.size;
  lines.forEach((line, i) => { el('tspan', { x, dy: i === 0 ? 0 : lh }, node).textContent = line; });
  return node;
}

const pop = (tl: any, node: SVGElement, at: number, dur = 0.5) => { gsap.set(node, { transformOrigin: '50% 50%', scale: 0.6, opacity: 0 }); tl.to(node, { scale: 1, opacity: 1, duration: dur, ease: 'back.out(1.7)' }, at); };
const rise = (tl: any, node: SVGElement, at: number, dist: number, dur = 0.55) => { gsap.set(node, { y: dist, opacity: 0 }); tl.to(node, { y: 0, opacity: 1, duration: dur, ease: 'power3.out' }, at); };
const slide = (tl: any, node: SVGElement, at: number, dx: number, dur = 0.5) => { gsap.set(node, { x: dx, opacity: 0 }); tl.to(node, { x: 0, opacity: 1, duration: dur, ease: 'power3.out' }, at); };
function drawnLine(parent: SVGElement, x1: number, y1: number, x2: number, y2: number, stroke: string, width: number): SVGLineElement {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  return el<SVGLineElement>('line', { x1, y1, x2, y2, stroke, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-dasharray': len, 'stroke-dashoffset': len }, parent);
}
const draw = (tl: any, line: SVGElement, at: number, dur = 0.5) => tl.to(line, { strokeDashoffset: 0, duration: dur, ease: 'power2.inOut' }, at);

function mix(hex: string, opacity: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${opacity})`;
}

/** Inline every remote image so SVG rasterization can see them. */
export async function inlineGraphicImages(spec: GraphicSpec): Promise<GraphicSpec> {
  const copy: GraphicSpec = JSON.parse(JSON.stringify(spec));
  if (copy.backdropUrl) copy.backdropUrl = (await toDataUrl(copy.backdropUrl)) || undefined;
  for (const item of copy.items || []) if (item.imageUrl) item.imageUrl = (await toDataUrl(item.imageUrl)) || undefined;
  return copy;
}

function backdrop(svg: SVGSVGElement, defs: SVGElement, W: number, H: number, P: Palette, spec: GraphicSpec) {
  el('rect', { x: 0, y: 0, width: W, height: H, fill: P.bg }, svg);
  // Contextual backdrop image (AI-generated from backdrop_prompt, or a reused
  // asset) for every treatment EXCEPT the two that frame the image themselves
  // (documentary_card / annotated): dimmed cover picture + scrim, so the scene
  // carries real atmosphere while the exact text keeps full contrast on top.
  if (spec.backdropUrl && spec.treatment !== 'documentary_card' && spec.treatment !== 'annotated') {
    const img = el('image', { x: -W * 0.03, y: -H * 0.03, width: W * 1.06, height: H * 1.06, href: spec.backdropUrl, preserveAspectRatio: 'xMidYMid slice', opacity: 0.34 }, svg);
    img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', spec.backdropUrl);
    el('rect', { x: 0, y: 0, width: W, height: H, fill: P.bg, opacity: 0.56 }, svg);
  }
  const gid = `g${Math.floor(Math.random() * 1e9)}`;
  const grad = el('radialGradient', { id: gid, cx: '30%', cy: '10%', r: '90%' }, defs);
  el('stop', { offset: '0%', 'stop-color': P.accent, 'stop-opacity': 0.16 }, grad);
  el('stop', { offset: '100%', 'stop-color': P.accent, 'stop-opacity': 0 }, grad);
  el('rect', { x: 0, y: 0, width: W, height: H, fill: `url(#${gid})` }, svg);
  const texture = spec.texture || 'grid';
  if (texture === 'grid') {
    const g = el<SVGGElement>('g', { opacity: 0.05, stroke: P.ink, 'stroke-width': 1 }, svg);
    for (let x = W / 10; x < W; x += W / 10) el('line', { x1: x, y1: 0, x2: x, y2: H }, g);
    for (let y = H / 8; y < H; y += H / 8) el('line', { x1: 0, y1: y, x2: W, y2: y }, g);
  } else if (texture === 'dots') {
    const g = el<SVGGElement>('g', { opacity: 0.08, fill: P.ink }, svg);
    for (let x = W / 16; x < W; x += W / 16) for (let y = H / 10; y < H; y += H / 10) el('circle', { cx: x, cy: y, r: 2.2 }, g);
  } else if (texture === 'diagonal') {
    const g = el<SVGGElement>('g', { opacity: 0.05, stroke: P.accent2, 'stroke-width': 2 }, svg);
    for (let x = -H; x < W; x += W / 9) el('line', { x1: x, y1: H, x2: x + H, y2: 0 }, g);
  }
}

/**
 * Build the animated SVG for a graphic spec. Timeline returned PAUSED — the
 * preview plays it, the capture records it. Both render the identical thing.
 */
export function buildGraphic(spec: GraphicSpec, W: number, H: number, durationSec: number, paletteSeed = '', style?: FilmStyle | null): BuiltAnimation {
  // The director's film style (typography + base palette) applies verbatim to
  // every text node and palette gap in this build.
  ACTIVE = style && style.font_family
    ? {
        font: style.font_family,
        heading: Math.min(900, Math.max(300, Number(style.heading_weight) || 800)),
        body: Math.min(700, Math.max(300, Number(style.body_weight) || 500)),
      }
    : null;
  const P = resolvePalette(spec, paletteSeed, style);
  const portrait = H > W;
  const u = Math.min(W, H) / 1080;
  const total = Math.min(14, Math.max(3, durationSec || Number(spec.duration_s) || 6));
  const items: GraphicItem[] = (spec.items || []).slice(0, 7);
  const n = Math.max(1, items.length);

  const svg = el<SVGSVGElement>('svg', { xmlns: SVG_NS, viewBox: `0 0 ${W} ${H}`, width: W, height: H });
  const defs = el('defs', {}, svg);
  backdrop(svg, defs, W, H, P, spec);
  const root = el<SVGGElement>('g', { opacity: 0 }, svg);
  const tl = gsap.timeline({ paused: true });
  tl.to(root, { opacity: 1, duration: 0.3, ease: 'power1.out' }, 0);

  const revealSpan = Math.max(0.8, total * 0.6);
  const step = revealSpan / (n + 1);
  let cursor = 0.15;
  const t = spec.treatment;

  const header = (topY: number, maxTitle = portrait ? 22 : 40) => {
    if (!spec.title) return topY;
    const bar = el('rect', { x: W / 2 - 40 * u, y: topY - 70 * u, width: 80 * u, height: 8 * u, rx: 4 * u, fill: P.accent }, root);
    pop(tl, bar, cursor, 0.4);
    const title = textBlock(root, W / 2, topY, spec.title, { size: 52 * u, weight: 800, fill: P.ink, maxChars: maxTitle, maxLines: 2 });
    rise(tl, title, cursor + 0.08, 24 * u, 0.55);
    cursor += 0.35;
    if (spec.subtitle) {
      const sub = textBlock(root, W / 2, topY + 62 * u, spec.subtitle, { size: 27 * u, weight: 500, fill: mix(P.ink, 0.72), maxChars: portrait ? 34 : 64, maxLines: 2 });
      rise(tl, sub, cursor, 16 * u, 0.45);
      cursor += 0.18;
    }
    return topY + (spec.subtitle ? 130 : 80) * u;
  };

  if (t === 'kinetic_type') {
    const headline = spec.title || items[0]?.label || '';
    const lines = wrapLines(headline, portrait ? 14 : 22, 3);
    const size = (portrait ? 84 : 104) * u;
    const startY = H * 0.46 - (lines.length * size * 1.16) / 2 + size * 0.8;
    const tick = el('rect', { x: W / 2 - 48 * u, y: startY - size * 1.6, width: 96 * u, height: 9 * u, rx: 4.5 * u, fill: P.accent }, root);
    pop(tl, tick, cursor, 0.4);
    lines.forEach((line, i) => {
      const node = el<SVGTextElement>('text', { x: W / 2, y: startY + i * size * 1.16, 'font-family': face(), 'font-size': size, 'font-weight': fw(900), fill: i === lines.length - 1 && lines.length > 1 ? P.accent : P.ink, 'text-anchor': 'middle', 'letter-spacing': '-0.01em' }, root);
      node.textContent = line;
      rise(tl, node, cursor + 0.12 + i * 0.18, 50 * u, 0.7);
    });
    if (spec.subtitle) {
      const sub = textBlock(root, W / 2, startY + lines.length * size * 1.16 + 46 * u, spec.subtitle, { size: 30 * u, weight: 500, fill: mix(P.ink, 0.72), maxChars: portrait ? 32 : 56, maxLines: 2 });
      rise(tl, sub, cursor + 0.3 + lines.length * 0.18, 24 * u, 0.6);
    }
  } else if (t === 'documentary_card' || t === 'annotated') {
    // Full-bleed backdrop with slow push + lower-third label / drawn callouts.
    if (spec.backdropUrl) {
      const img = el('image', { x: -W * 0.04, y: -H * 0.04, width: W * 1.08, height: H * 1.08, href: spec.backdropUrl, preserveAspectRatio: 'xMidYMid slice' }, root);
      img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', spec.backdropUrl);
      gsap.set(img, { transformOrigin: '50% 50%', scale: 1 });
      tl.to(img, { scale: 1.08, duration: total, ease: 'none' }, 0);
      el('rect', { x: 0, y: H * 0.55, width: W, height: H * 0.45, fill: mix(P.bg, 0.0) }, root);
      const shadeId = `sh${Math.floor(Math.random() * 1e9)}`;
      const shade = el('linearGradient', { id: shadeId, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
      el('stop', { offset: '0%', 'stop-color': P.bg, 'stop-opacity': 0 }, shade);
      el('stop', { offset: '100%', 'stop-color': P.bg, 'stop-opacity': 0.9 }, shade);
      el('rect', { x: 0, y: H * 0.55, width: W, height: H * 0.45, fill: `url(#${shadeId})` }, root);
    }
    if (t === 'annotated') {
      items.slice(0, 4).forEach((item, i) => {
        const at = cursor + 0.4 + i * step;
        const ax = W * (0.22 + 0.56 * ((i % 3) / 2));
        const ay = H * (0.24 + 0.34 * (i % 2));
        const dot = el('circle', { cx: ax, cy: ay, r: 12 * u, fill: P.accent, stroke: '#fff', 'stroke-width': 3 * u }, root);
        pop(tl, dot, at, 0.35);
        const ly = H - (90 + i * 62) * u;
        const leader = drawnLine(root, ax, ay, W * 0.06 + 24 * u, ly - 12 * u, mix(P.ink, 0.65), 2.5 * u);
        draw(tl, leader, at + 0.1, 0.4);
        const pillW = Math.min(W * 0.8, item.label.length * 15 * u + 64 * u);
        const pill = el<SVGGElement>('g', {}, root);
        el('rect', { x: W * 0.06, y: ly - 36 * u, width: pillW, height: 52 * u, rx: 26 * u, fill: mix(P.bg, 0.9), stroke: P.accent, 'stroke-width': 2 }, pill);
        textBlock(pill, W * 0.06 + pillW / 2, ly - 2 * u, item.label, { size: 24 * u, weight: 700, fill: P.ink, maxChars: 44, maxLines: 1 });
        rise(tl, pill, at + 0.2, 14 * u, 0.4);
      });
    } else {
      // Lower-third documentary label.
      const y0 = H * 0.78;
      const tag = el<SVGGElement>('g', {}, root);
      const tagW = Math.min(W * 0.86, Math.max(spec.title?.length || 8, 8) * 26 * u + 80 * u);
      el('rect', { x: W * 0.07, y: y0 - 56 * u, width: 10 * u, height: 96 * u, fill: P.accent }, tag);
      el('rect', { x: W * 0.07 + 10 * u, y: y0 - 56 * u, width: tagW, height: 96 * u, fill: mix(P.bg, 0.88) }, tag);
      textBlock(tag, W * 0.07 + 44 * u, y0, spec.title || '', { size: 40 * u, weight: 800, fill: P.ink, anchor: 'start', maxChars: portrait ? 22 : 40, maxLines: 1 });
      if (spec.subtitle) textBlock(tag, W * 0.07 + 44 * u, y0 + 34 * u, spec.subtitle, { size: 22 * u, weight: 500, fill: mix(P.ink, 0.75), anchor: 'start', maxChars: portrait ? 34 : 58, maxLines: 1 });
      slide(tl, tag, cursor + 0.2, -60 * u, 0.6);
    }
  } else if (t === 'flow') {
    const contentTop = header(portrait ? H * 0.1 : H * 0.13);
    const count = Math.min(5, n);
    const size = count > 4 ? 26 * u : 30 * u;
    items.slice(0, 5).forEach((item, i) => {
      const at = cursor + i * step;
      const cx = portrait ? W / 2 : W * (count === 1 ? 0.5 : 0.12 + (0.76 * i) / (count - 1));
      const cy = portrait ? contentTop + 90 * u + i * ((H * 0.88 - contentTop - 160 * u) / Math.max(1, count - 1)) : (contentTop + H * 0.88) / 2;
      const boxW = Math.max(200 * u, Math.min(15, item.label.length) * size * 0.64 + size * 1.8);
      const boxH = size * 3;
      const g = el<SVGGElement>('g', {}, root);
      el('rect', { x: cx - boxW / 2, y: cy - boxH / 2, width: boxW, height: boxH, rx: boxH / 4, fill: mix(P.ink, 0.06), stroke: mix(P.ink, 0.25), 'stroke-width': 2 }, g);
      const badge = el('circle', { cx: cx - boxW / 2 + 4 * u, cy: cy - boxH / 2 + 4 * u, r: 22 * u, fill: P.accent }, g);
      textBlock(g, cx - boxW / 2 + 4 * u, cy - boxH / 2 + 12 * u, String(i + 1), { size: 24 * u, weight: 800, fill: '#fff' });
      textBlock(g, cx, cy + size * 0.35, item.label, { size, weight: 700, fill: P.ink, maxChars: 15, maxLines: 2 });
      rise(tl, g, at, 30 * u, 0.5);
      void badge;
      if (item.sublabel) { const sub = textBlock(root, cx, cy + boxH / 2 + 32 * u, item.sublabel, { size: 19 * u, weight: 500, fill: mix(P.ink, 0.6), maxChars: 26, maxLines: 2 }); rise(tl, sub, at + 0.22, 10 * u, 0.4); }
      if (i < count - 1) {
        const arrow = portrait
          ? drawnLine(root, W / 2, cy + boxH / 2 + 12 * u, W / 2, cy + (H * 0.88 - contentTop - 160 * u) / Math.max(1, count - 1) - boxH / 2 + 78 * u, P.accent, 5 * u)
          : drawnLine(root, cx + boxW / 2 + 10 * u, cy, cx + (W * 0.76) / (count - 1) - boxW / 2 - 10 * u, cy, P.accent, 5 * u);
        draw(tl, arrow, at + 0.28, Math.min(0.45, step));
      }
    });
  } else if (t === 'stat') {
    const stat = spec.stat || { value: Number(items[0]?.value) || 0, label: spec.title || items[0]?.label };
    const cy = H * 0.47;
    const r = Math.min(W, H) * 0.27;
    const ringLen = 2 * Math.PI * r;
    const ring = el<SVGCircleElement>('circle', { cx: W / 2, cy, r, fill: 'none', stroke: mix(P.accent, 0.35), 'stroke-width': 7 * u, 'stroke-dasharray': ringLen, 'stroke-dashoffset': ringLen, transform: `rotate(-90 ${W / 2} ${cy})` }, root);
    tl.to(ring, { strokeDashoffset: 0, duration: Math.min(2, total * 0.4), ease: 'power2.inOut' }, cursor);
    const decimals = Math.abs(stat.value) < 10 && !Number.isInteger(stat.value) ? 1 : 0;
    const fmt = (v: number) => `${stat.prefix || ''}${v.toLocaleString('en-US', { maximumFractionDigits: decimals, minimumFractionDigits: decimals })}${stat.suffix || ''}`;
    const value = el<SVGTextElement>('text', { x: W / 2, y: cy + 40 * u, 'font-family': face(), 'font-size': (portrait ? 130 : 150) * u, 'font-weight': fw(900), fill: P.ink, 'text-anchor': 'middle' }, root);
    value.textContent = fmt(0);
    const counter = { v: 0 };
    rise(tl, value, cursor, 26 * u, 0.5);
    tl.to(counter, { v: stat.value, duration: Math.min(2.2, total * 0.42), ease: 'power2.out', onUpdate: () => { value.textContent = fmt(counter.v); } }, cursor + 0.15);
    if (stat.label || spec.subtitle) { const label = textBlock(root, W / 2, cy + r + 76 * u, stat.label || spec.subtitle || '', { size: 34 * u, weight: 600, fill: mix(P.ink, 0.8), maxChars: portrait ? 26 : 44, maxLines: 2 }); rise(tl, label, cursor + 0.55, 18 * u, 0.5); }
  } else if (t === 'bars') {
    const contentTop = header(portrait ? H * 0.09 : H * 0.12);
    const count = Math.min(6, n);
    const max = Math.max(...items.map((it) => Math.abs(Number(it.value) || 0)), 1);
    const chartBottom = H * 0.84;
    const span = portrait ? W * 0.84 : W * 0.7;
    const x0 = (W - span) / 2;
    const slot = span / count;
    const barW = Math.min(120 * u, slot * 0.55);
    const base = drawnLine(root, x0 - 12 * u, chartBottom, x0 + span + 12 * u, chartBottom, mix(P.ink, 0.3), 3 * u);
    draw(tl, base, cursor, 0.5); cursor += 0.2;
    items.slice(0, 6).forEach((item, i) => {
      const at = cursor + i * step;
      const v = Math.abs(Number(item.value) || 0);
      const h = Math.max(12 * u, ((chartBottom - contentTop - 40 * u) * v) / max);
      const x = x0 + slot * i + (slot - barW) / 2;
      const bar = el('rect', { x, y: chartBottom - h, width: barW, height: h, rx: 10 * u, fill: i === 0 ? P.accent : mix(P.accent2, 0.75) }, root);
      gsap.set(bar, { transformOrigin: '50% 100%', scaleY: 0 });
      tl.to(bar, { scaleY: 1, duration: 0.6, ease: 'power3.out' }, at);
      const valueText = el<SVGTextElement>('text', { x: x + barW / 2, y: chartBottom - h - 16 * u, 'font-family': face(), 'font-size': 26 * u, 'font-weight': fw(800), fill: P.ink, 'text-anchor': 'middle' }, root);
      valueText.textContent = '0';
      const c = { v: 0 };
      tl.to(c, { v, duration: 0.6, ease: 'power2.out', onUpdate: () => { valueText.textContent = c.v.toLocaleString('en-US', { maximumFractionDigits: Number.isInteger(v) ? 0 : 1 }); } }, at + 0.05);
      tl.fromTo(valueText, { opacity: 0 }, { opacity: 1, duration: 0.3 }, at + 0.1);
      const label = textBlock(root, x + barW / 2, chartBottom + 38 * u, item.label, { size: 21 * u, weight: 600, fill: mix(P.ink, 0.75), maxChars: 12, maxLines: 2 });
      rise(tl, label, at + 0.15, 10 * u, 0.4);
    });
  } else if (t === 'list') {
    const contentTop = header(portrait ? H * 0.1 : H * 0.14);
    const count = Math.min(6, n);
    items.slice(0, 6).forEach((item, i) => {
      const at = cursor + i * step;
      const y = contentTop + 60 * u + i * ((H * 0.86 - contentTop - 80 * u) / Math.max(1, count - 1 || 1));
      const row = el<SVGGElement>('g', {}, root);
      const x0 = portrait ? W * 0.1 : W * 0.2;
      el('circle', { cx: x0, cy: y - 10 * u, r: 16 * u, fill: 'none', stroke: P.accent, 'stroke-width': 3 * u }, row);
      el('circle', { cx: x0, cy: y - 10 * u, r: 7 * u, fill: P.accent }, row);
      textBlock(row, x0 + 42 * u, y, item.label, { size: 32 * u, weight: 700, fill: P.ink, anchor: 'start', maxChars: portrait ? 26 : 42, maxLines: 1 });
      if (item.sublabel) textBlock(row, x0 + 42 * u, y + 34 * u, item.sublabel, { size: 21 * u, weight: 500, fill: mix(P.ink, 0.6), anchor: 'start', maxChars: portrait ? 34 : 56, maxLines: 1 });
      slide(tl, row, at, -34 * u, 0.5);
    });
  } else if (t === 'compare') {
    const contentTop = header(portrait ? H * 0.09 : H * 0.12);
    const leftItems = (spec.leftItems || []).slice(0, 5);
    const rightItems = (spec.rightItems || []).slice(0, 5);
    const panels = portrait
      ? [{ title: spec.leftTitle || 'A', entries: leftItems, x: W * 0.08, y: contentTop, w: W * 0.84, h: (H * 0.88 - contentTop) * 0.47, from: -1, tone: P.accent }, { title: spec.rightTitle || 'B', entries: rightItems, x: W * 0.08, y: contentTop + (H * 0.88 - contentTop) * 0.53, w: W * 0.84, h: (H * 0.88 - contentTop) * 0.47, from: 1, tone: P.accent2 }]
      : [{ title: spec.leftTitle || 'A', entries: leftItems, x: W * 0.07, y: contentTop, w: W * 0.4, h: H * 0.86 - contentTop, from: -1, tone: P.accent }, { title: spec.rightTitle || 'B', entries: rightItems, x: W * 0.53, y: contentTop, w: W * 0.4, h: H * 0.86 - contentTop, from: 1, tone: P.accent2 }];
    panels.forEach((panel, pi) => {
      const g = el<SVGGElement>('g', {}, root);
      el('rect', { x: panel.x, y: panel.y, width: panel.w, height: panel.h, rx: 26 * u, fill: mix(P.ink, 0.05), stroke: panel.tone, 'stroke-width': 2.5 }, g);
      textBlock(g, panel.x + panel.w / 2, panel.y + 60 * u, panel.title, { size: 34 * u, weight: 800, fill: panel.tone, maxChars: 20, maxLines: 1 });
      slide(tl, g, cursor + pi * 0.18, panel.from * 48 * u, 0.6);
      panel.entries.forEach((entry, ei) => {
        const y = panel.y + 118 * u + ei * 60 * u;
        const row = el<SVGGElement>('g', {}, root);
        el('circle', { cx: panel.x + 38 * u, cy: y - 8 * u, r: 7 * u, fill: panel.tone }, row);
        textBlock(row, panel.x + 62 * u, y, entry, { size: 25 * u, weight: 600, fill: mix(P.ink, 0.85), anchor: 'start', maxChars: portrait ? 30 : 26, maxLines: 1 });
        rise(tl, row, cursor + 0.45 + pi * 0.18 + ei * Math.min(0.28, step), 16 * u, 0.45);
      });
    });
  } else if (t === 'timeline') {
    const contentTop = header(portrait ? H * 0.09 : H * 0.12);
    const count = Math.min(6, n);
    if (portrait) {
      const x = W * 0.22;
      const spine = drawnLine(root, x, contentTop + 30 * u, x, H * 0.88, P.accent, 5 * u);
      draw(tl, spine, cursor, 0.7); cursor += 0.25;
      items.slice(0, 6).forEach((item, i) => {
        const at = cursor + i * step;
        const y = contentTop + 60 * u + i * ((H * 0.86 - contentTop - 90 * u) / Math.max(1, count - 1 || 1));
        pop(tl, el('circle', { cx: x, cy: y, r: 13 * u, fill: P.accent, stroke: P.bg, 'stroke-width': 4 * u }, root), at, 0.35);
        const label = textBlock(root, x + 34 * u, y - 2 * u, item.label, { size: 30 * u, weight: 800, fill: P.ink, anchor: 'start', maxChars: 20, maxLines: 1 });
        rise(tl, label, at + 0.1, 14 * u, 0.4);
        if (item.sublabel) { const sub = textBlock(root, x + 34 * u, y + 32 * u, item.sublabel, { size: 21 * u, weight: 500, fill: mix(P.ink, 0.65), anchor: 'start', maxChars: 32, maxLines: 2 }); rise(tl, sub, at + 0.2, 10 * u, 0.4); }
      });
    } else {
      const y = (contentTop + H * 0.86) / 2;
      const spine = drawnLine(root, W * 0.08, y, W * 0.92, y, P.accent, 5 * u);
      draw(tl, spine, cursor, 0.7); cursor += 0.25;
      items.slice(0, 6).forEach((item, i) => {
        const at = cursor + i * step;
        const x = W * (count === 1 ? 0.5 : 0.11 + (0.78 * i) / (count - 1));
        const above = i % 2 === 0;
        pop(tl, el('circle', { cx: x, cy: y, r: 13 * u, fill: P.accent, stroke: P.bg, 'stroke-width': 4 * u }, root), at, 0.35);
        const stem = drawnLine(root, x, y + (above ? -18 * u : 18 * u), x, y + (above ? -60 * u : 60 * u), mix(P.ink, 0.3), 2.5 * u);
        draw(tl, stem, at + 0.08, 0.3);
        const label = textBlock(root, x, y + (above ? -80 * u : 100 * u), item.label, { size: 28 * u, weight: 800, fill: P.ink, maxChars: 14, maxLines: 1 });
        rise(tl, label, at + 0.15, above ? 10 * u : -10 * u, 0.4);
        if (item.sublabel) { const sub = textBlock(root, x, y + (above ? -118 * u : 140 * u), item.sublabel, { size: 20 * u, weight: 500, fill: mix(P.ink, 0.65), maxChars: 20, maxLines: 2 }); rise(tl, sub, at + 0.24, 8 * u, 0.4); }
      });
    }
  } else if (t === 'node_map') {
    const contentTop = header(portrait ? H * 0.09 : H * 0.12);
    const count = Math.min(7, n);
    const cx = W / 2; const cy = (contentTop + H * 0.88) / 2;
    const rx = portrait ? W * 0.33 : W * 0.29;
    const ry = (H * 0.88 - contentTop) * 0.36;
    const hubLabel = spec.title && !spec.subtitle ? '' : (spec.subtitle || '');
    const positions = items.slice(0, 7).map((_, i) => { const a = -Math.PI / 2 + (2 * Math.PI * i) / count; return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) }; });
    positions.forEach((pos, i) => {
      const at = cursor + i * step;
      const edge = drawnLine(root, cx, cy, pos.x, pos.y, mix(P.accent, 0.55), 3 * u);
      draw(tl, edge, at, Math.min(0.5, step + 0.2));
      const label = items[i].label;
      const bw = Math.max(150 * u, Math.min(12, label.length) * 26 * u * 0.6 + 50 * u);
      const g = el<SVGGElement>('g', {}, root);
      el('rect', { x: pos.x - bw / 2, y: pos.y - 34 * u, width: bw, height: 68 * u, rx: 20 * u, fill: mix(P.ink, 0.06), stroke: mix(P.ink, 0.25), 'stroke-width': 2 }, g);
      textBlock(g, pos.x, pos.y + 9 * u, label, { size: 26 * u, weight: 700, fill: P.ink, maxChars: 12, maxLines: 2 });
      pop(tl, g, at + 0.18, 0.45);
    });
    const hubW = Math.max(220 * u, (hubLabel || 'hub').length * 20 * u * 0.62 + 60 * u);
    const hub = el<SVGGElement>('g', {}, root);
    el('rect', { x: cx - hubW / 2, y: cy - 40 * u, width: hubW, height: 80 * u, rx: 24 * u, fill: P.accent }, hub);
    textBlock(hub, cx, cy + 10 * u, hubLabel || spec.title || '', { size: 30 * u, weight: 800, fill: '#fff', maxChars: 16, maxLines: 2 });
    pop(tl, hub, cursor + 0.1, 0.5);
  } else if (t === 'quote') {
    const q = spec.title || items[0]?.label || '';
    const mark = el<SVGTextElement>('text', { x: W * 0.14, y: H * 0.3, 'font-family': ACTIVE ? ACTIVE.font : 'Georgia, serif', 'font-size': 200 * u, 'font-weight': fw(800), fill: mix(P.accent, 0.55), 'text-anchor': 'middle' }, root);
    mark.textContent = '“';
    pop(tl, mark, cursor, 0.5);
    const body = textBlock(root, W / 2, H * 0.42, q, { size: (portrait ? 46 : 54) * u, weight: 700, fill: P.ink, maxChars: portrait ? 24 : 38, maxLines: 4, lineHeight: 1.35 });
    rise(tl, body, cursor + 0.2, 30 * u, 0.7);
    if (spec.subtitle) {
      const rule = drawnLine(root, W / 2 - 60 * u, H * 0.72, W / 2 + 60 * u, H * 0.72, P.accent, 4 * u);
      draw(tl, rule, cursor + 0.7, 0.4);
      const attr = textBlock(root, W / 2, H * 0.78, spec.subtitle, { size: 27 * u, weight: 600, fill: mix(P.ink, 0.7), maxChars: 40, maxLines: 1 });
      rise(tl, attr, cursor + 0.85, 14 * u, 0.5);
    }
  } else {
    // Fallback — never blank: treat as kinetic_type on the segment title.
    const body = textBlock(root, W / 2, H * 0.5, spec.title || spec.subtitle || '', { size: 60 * u, weight: 800, fill: P.ink, maxChars: portrait ? 20 : 34, maxLines: 3 });
    rise(tl, body, cursor, 36 * u, 0.7);
  }

  if (spec.footnote) {
    const fn = textBlock(root, W / 2, H * 0.95, spec.footnote, { size: 18 * u, weight: 500, fill: mix(P.ink, 0.5), maxChars: 70, maxLines: 1 });
    tl.fromTo(fn, { opacity: 0 }, { opacity: 1, duration: 0.5 }, cursor + 0.8);
  }

  // Fit reveal inside the scene window; drift, then fade for a clean cut.
  const naturalEnd = Math.max(tl.duration(), cursor + 0.8);
  const budget = Math.max(1.2, total - 0.6);
  if (naturalEnd > budget) tl.timeScale(naturalEnd / budget);
  const ts = tl.timeScale() || 1;
  tl.to(root, { y: -6 * u, duration: Math.max(0.4, total - 0.9) * ts, ease: 'sine.inOut' }, 0.4);
  tl.to(root, { opacity: 0, duration: 0.4 * ts, ease: 'power1.in' }, total * ts - 0.42 * ts);

  return { svg, timeline: tl, durationSec: total };
}
