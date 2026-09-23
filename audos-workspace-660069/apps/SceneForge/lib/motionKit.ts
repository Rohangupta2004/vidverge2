// MOTION KIT — the shared SVG construction helpers and the upgraded GSAP
// motion vocabulary every motion-graphics surface uses (the classic kind
// renderers in components/MotionGraphicPlayer and the directed primitive
// library in lib/motionPrimitives). One vocabulary, one set of rules:
//
//   * NO BARE FADES, NO BARE SLIDES. Every entrance combines transform
//     (scale / translate / mask / draw) WITH opacity — a lone opacity tween
//     reads as programmatic, not designed.
//   * SPRING PHYSICS ON ENTRANCES. Hero elements land with back.out overshoot
//     (back.out(1.7)) so arrivals feel physical rather than eased-linear.
//   * AMBIENT MOTION WHILE HOLDING. Stationary elements breathe or drift a
//     few pixels so a held frame never looks frozen.
//   * CAMERA LANGUAGE. The whole scene root can push in, pull back or drift
//     laterally like a camera move — scale/translate on the container.
//
// Serialization constraints (the capture path rasterizes the SVG through an
// <img>, which loads no external resources and applies no external CSS):
// concrete hex colors, per-element font stacks, gsap tweens on attributes and
// transforms only — all of which serialize into the SVG markup.

import { gsap } from 'https://esm.sh/gsap@3.12.5';

export const SVG_NS = 'http://www.w3.org/2000/svg';

// ---------------------------------------------------------------------------
// THEME SYSTEM. Two locked visual languages share the one motion vocabulary:
//   * 'midnight'  — the original dark editorial look (deep navy, light ink).
//   * 'papercut'  — the Vox-style paper-cut language: a warm paper field,
//     near-black ink, ONE highlighter-yellow accent, torn-edge cutouts with a
//     two-shadow stack, halftone/newsprint texture, heavy condensed display
//     type. Palette discipline is the point: 1 base + 1-2 accents, and color
//     means "look here" (only the answer element carries the accent).
// The style constants below are LIVE `let` bindings: setMotionTheme swaps
// them before a build, and every importer (motionPrimitives, the player's
// classic renderers) picks the change up because ES module imports are live.
// Fonts remain LOCALLY AVAILABLE stacks — the capture path rasterizes the SVG
// through an <img>, which loads no webfonts.
// ---------------------------------------------------------------------------

export interface MotionTheme {
  id: 'midnight' | 'papercut';
  font: string;
  displayFont: string;
  ink: string; inkSoft: string; inkMuted: string;
  bg: string; panel: string; panelEdge: string;
  panelGlass: string; glassEdge: string;
  onAccent: string; neutral: string; edgeSoft: string; route: string;
  accentOverride: string | null;
  accentSecondary: string | null;
  paper: boolean;
}

export const MIDNIGHT_THEME: MotionTheme = {
  id: 'midnight',
  font: "Inter, -apple-system, 'Segoe UI', Arial, sans-serif",
  displayFont: "Inter, -apple-system, 'Segoe UI', Arial, sans-serif",
  ink: '#F8FAFC', inkSoft: '#CBD5E1', inkMuted: '#94A3B8',
  bg: '#0A0F1E', panel: '#121C30', panelEdge: 'rgba(148,163,184,0.28)',
  panelGlass: 'rgba(10,15,30,0.82)', glassEdge: 'rgba(255,255,255,0.18)',
  onAccent: '#ffffff', neutral: '#121C30', edgeSoft: 'rgba(96,165,250,0.55)', route: 'rgba(96,165,250,0.6)',
  accentOverride: null, accentSecondary: null,
  paper: false,
};

export const PAPERCUT_THEME: MotionTheme = {
  id: 'papercut',
  font: "'Work Sans', Inter, -apple-system, 'Segoe UI', Arial, sans-serif",
  displayFont: "'Archivo Black', 'Arial Black', Arial, sans-serif",
  ink: '#1A1A1A', inkSoft: '#4B463C', inkMuted: '#8A8272',
  bg: '#F2EDE4', panel: '#E9E2D3', panelEdge: 'rgba(26,26,26,0.22)',
  panelGlass: 'rgba(250,247,240,0.94)', glassEdge: 'rgba(26,26,26,0.28)',
  onAccent: '#1A1A1A', neutral: '#C9C2B6', edgeSoft: 'rgba(26,26,26,0.38)', route: '#E4572E',
  accentOverride: '#FFEB00', accentSecondary: '#E4572E',
  paper: true,
};

export let THEME: MotionTheme = MIDNIGHT_THEME;
export let FONT = MIDNIGHT_THEME.font;
export let FONT_DISPLAY = MIDNIGHT_THEME.displayFont;
export let INK = MIDNIGHT_THEME.ink;
export let INK_SOFT = MIDNIGHT_THEME.inkSoft;
export let INK_MUTED = MIDNIGHT_THEME.inkMuted;
export let BG = MIDNIGHT_THEME.bg;
export let PANEL = MIDNIGHT_THEME.panel;
export let PANEL_EDGE = MIDNIGHT_THEME.panelEdge;
export let PANEL_GLASS = MIDNIGHT_THEME.panelGlass;
export let GLASS_EDGE = MIDNIGHT_THEME.glassEdge;
export let ON_ACCENT = MIDNIGHT_THEME.onAccent;
export let NEUTRAL = MIDNIGHT_THEME.neutral;
export let EDGE_SOFT = MIDNIGHT_THEME.edgeSoft;
export let ROUTE = MIDNIGHT_THEME.route;

/** Swap the active theme. Builds are synchronous and captures are serialized
 * through one queue, so setting this at the top of a build is race-free. */
export function setMotionTheme(theme: MotionTheme) {
  THEME = theme;
  FONT = theme.font;
  FONT_DISPLAY = theme.displayFont;
  INK = theme.ink; INK_SOFT = theme.inkSoft; INK_MUTED = theme.inkMuted;
  BG = theme.bg; PANEL = theme.panel; PANEL_EDGE = theme.panelEdge;
  PANEL_GLASS = theme.panelGlass; GLASS_EDGE = theme.glassEdge;
  ON_ACCENT = theme.onAccent; NEUTRAL = theme.neutral;
  EDGE_SOFT = theme.edgeSoft; ROUTE = theme.route;
}

/** Which theme a project style renders with: the Vox-style explainer gets the
 * paper-cut language; every other style keeps the original midnight look. */
export function motionThemeForStyle(styleId?: string | null): MotionTheme {
  return String(styleId || '') === 'vox-explainer' ? PAPERCUT_THEME : MIDNIGHT_THEME;
}

export type Attrs = Record<string, string | number>;

export function el<T extends SVGElement>(tag: string, attrs: Attrs = {}, parent?: SVGElement | null): T {
  const node = document.createElementNS(SVG_NS, tag) as T;
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
  if (parent) parent.appendChild(node);
  return node;
}

export function wrapLines(text: string, maxChars: number, maxLines = 3): string[] {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line && (line + ' ' + word).length > maxChars) { lines.push(line); line = word; } else line = line ? line + ' ' + word : word;
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) lines[maxLines - 1] = lines[maxLines - 1].replace(/.{3}$/, '…');
  return lines.length ? lines : [''];
}

export interface TextOpts { size: number; weight?: number; fill?: string; anchor?: 'start' | 'middle' | 'end'; maxChars?: number; maxLines?: number; lineHeight?: number; spacing?: string }

export function textBlock(parent: SVGElement, x: number, y: number, content: string, opts: TextOpts): SVGTextElement {
  const node = el<SVGTextElement>('text', {
    x, y, 'font-family': FONT, 'font-size': opts.size, 'font-weight': opts.weight || 600,
    fill: opts.fill || INK, 'text-anchor': opts.anchor || 'middle', ...(opts.spacing ? { 'letter-spacing': opts.spacing } : {}),
  }, parent);
  const lines = opts.maxChars ? wrapLines(content, opts.maxChars, opts.maxLines || 3) : [String(content || '')];
  const lh = (opts.lineHeight || 1.25) * opts.size;
  lines.forEach((line, index) => { el('tspan', { x, dy: index === 0 ? 0 : lh }, node).textContent = line; });
  return node;
}

/** Word-by-word tspans on one line block — the kinetic-headline text body. */
export function kineticWords(parent: SVGElement, x: number, y: number, content: string, opts: TextOpts): { node: SVGTextElement; words: SVGTSpanElement[] } {
  const node = el<SVGTextElement>('text', {
    x, y, 'font-family': FONT_DISPLAY, 'font-size': opts.size, 'font-weight': opts.weight || 900,
    fill: opts.fill || INK, 'text-anchor': opts.anchor || 'middle', 'letter-spacing': opts.spacing || '-0.01em',
  }, parent);
  const lines = wrapLines(content, opts.maxChars || 18, opts.maxLines || 3);
  const lh = (opts.lineHeight || 1.18) * opts.size;
  const words: SVGTSpanElement[] = [];
  lines.forEach((line, lineIndex) => {
    const parts = line.split(' ');
    parts.forEach((word, wordIndex) => {
      const span = el<SVGTSpanElement>('tspan', wordIndex === 0 ? { x, dy: lineIndex === 0 ? 0 : lh } : {}, node);
      span.textContent = wordIndex === parts.length - 1 ? word : word + '\u00A0';
      words.push(span);
    });
  });
  return { node, words };
}

export function nodeBox(parent: SVGElement, cx: number, cy: number, label: string, opts: { size: number; accent: string; filled?: boolean; minWidth?: number; maxChars?: number }): { group: SVGGElement; width: number; height: number } {
  const maxChars = opts.maxChars || 16;
  const lines = wrapLines(label, maxChars, 2);
  const widest = lines.reduce((n, line) => Math.max(n, line.length), 1);
  const width = Math.max(opts.minWidth || 0, widest * opts.size * 0.62 + opts.size * 1.6);
  const height = opts.size * (lines.length > 1 ? 3.1 : 2.2);
  const group = el<SVGGElement>('g', {}, parent);
  el('rect', {
    x: cx - width / 2, y: cy - height / 2, width, height, rx: height / 4,
    fill: opts.filled ? opts.accent : PANEL, stroke: opts.filled ? opts.accent : PANEL_EDGE, 'stroke-width': 2,
  }, group);
  const text = textBlock(group, cx, cy + opts.size * 0.35 - (lines.length - 1) * opts.size * 0.6, label, { size: opts.size, weight: 700, fill: opts.filled ? ON_ACCENT : INK, maxChars, maxLines: 2 });
  text.setAttribute('pointer-events', 'none');
  return { group, width, height };
}

/** A circular image chip (a reused character/product/icon asset). */
export function nodeImageChip(parent: SVGElement, defs: SVGElement, cx: number, cy: number, r: number, href: string, stroke: string): SVGGElement {
  const clipId = `mgNodeImg${Math.floor(Math.random() * 1e9)}`;
  const clip = el('clipPath', { id: clipId }, defs);
  el('circle', { cx, cy, r }, clip);
  const group = el<SVGGElement>('g', {}, parent);
  const image = el('image', { x: cx - r, y: cy - r, width: r * 2, height: r * 2, href, preserveAspectRatio: 'xMidYMid slice', 'clip-path': `url(#${clipId})` }, group);
  image.setAttributeNS('http://www.w3.org/1999/xlink', 'href', href);
  el('circle', { cx, cy, r, fill: 'none', stroke, 'stroke-width': 3 }, group);
  return group;
}

export function drawnLine(parent: SVGElement, x1: number, y1: number, x2: number, y2: number, stroke: string, width: number, dashed = false): SVGLineElement {
  const length = Math.hypot(x2 - x1, y2 - y1) || 1;
  return el<SVGLineElement>('line', {
    x1, y1, x2, y2, stroke, 'stroke-width': width, 'stroke-linecap': 'round',
    'stroke-dasharray': dashed ? `${width * 2.4} ${width * 2.4}` : length, 'stroke-dashoffset': dashed ? 0 : length,
  }, parent);
}

/** A path element prepared for a draw-in animation (dashoffset = length). */
export function drawnPath(parent: SVGElement, d: string, stroke: string, width: number): SVGPathElement {
  const path = el<SVGPathElement>('path', { d, fill: 'none', stroke, 'stroke-width': width, 'stroke-linecap': 'round' }, parent);
  const length = path.getTotalLength ? path.getTotalLength() : 600;
  path.setAttribute('stroke-dasharray', String(length));
  path.setAttribute('stroke-dashoffset', String(length));
  return path;
}

// ---------------------------------------------------------------------------
// MOTION VOCABULARY. Every function registers tweens on the shared timeline
// and declares WHY that motion exists. Start states are set with gsap.set
// so the first painted frame is already correct (no flash of unanimated SVG).
// ---------------------------------------------------------------------------

export type MotionTimeline = gsap.core.Timeline;

/** Spring entrance with overshoot — hero/dominant elements land physically
 * (scale + opacity + back.out(1.7)); optional directional travel. */
export function springIn(tl: MotionTimeline, node: SVGElement, at: number, opts: { dur?: number; fromX?: number; fromY?: number; overshoot?: number } = {}) {
  const dur = opts.dur ?? 0.55;
  gsap.set(node, { transformOrigin: '50% 50%', scale: 0.6, opacity: 0, x: opts.fromX || 0, y: opts.fromY || 0 });
  tl.to(node, { scale: 1, x: 0, y: 0, opacity: 1, duration: dur, ease: `back.out(${opts.overshoot ?? 1.7})` }, at);
}

/** Rise entrance — supporting elements: upward travel + settle scale +
 * opacity together, so nothing ever "just fades". */
export function riseIn(tl: MotionTimeline, node: SVGElement, at: number, opts: { dist?: number; dur?: number; fromScale?: number } = {}) {
  const dist = opts.dist ?? 26;
  gsap.set(node, { transformOrigin: '50% 50%', y: dist, opacity: 0, scale: opts.fromScale ?? 0.96 });
  tl.to(node, { y: 0, opacity: 1, scale: 1, duration: opts.dur ?? 0.55, ease: 'power3.out' }, at);
}

/** Directional slide entrance WITH scale + opacity — the designed version of
 * a slide (a bare lateral slide is banned). */
export function slideFadeIn(tl: MotionTimeline, node: SVGElement, at: number, opts: { fromX?: number; fromY?: number; dur?: number } = {}) {
  gsap.set(node, { transformOrigin: '50% 50%', x: opts.fromX || 0, y: opts.fromY || 0, opacity: 0, scale: 0.97 });
  tl.to(node, { x: 0, y: 0, opacity: 1, scale: 1, duration: opts.dur ?? 0.6, ease: 'power3.out' }, at);
}

/** Masked reveal — a clipPath rect wipes the content open (clip-path
 * animation serializes into the captured SVG markup). */
export function maskReveal(tl: MotionTimeline, defs: SVGElement, node: SVGElement, bounds: { x: number; y: number; w: number; h: number }, at: number, opts: { dur?: number; from?: 'left' | 'right' | 'top' | 'bottom' } = {}) {
  const clipId = `mgMask${Math.floor(Math.random() * 1e9)}`;
  const clip = el('clipPath', { id: clipId }, defs);
  const pad = Math.max(bounds.w, bounds.h) * 0.08;
  const from = opts.from || 'left';
  const full = { x: bounds.x - pad, y: bounds.y - pad, width: bounds.w + pad * 2, height: bounds.h + pad * 2 };
  const rect = el<SVGRectElement>('rect', { ...full }, clip);
  if (from === 'left') rect.setAttribute('width', '0');
  if (from === 'right') { rect.setAttribute('width', '0'); rect.setAttribute('x', String(full.x + full.width)); }
  if (from === 'top') rect.setAttribute('height', '0');
  if (from === 'bottom') { rect.setAttribute('height', '0'); rect.setAttribute('y', String(full.y + full.height)); }
  node.setAttribute('clip-path', `url(#${clipId})`);
  tl.to(rect, { attr: from === 'left' || from === 'right' ? { width: full.width, x: full.x } : { height: full.height, y: full.y }, duration: opts.dur ?? 0.7, ease: 'power2.inOut' }, at);
}

/** Draw-in for lines and paths — connectors literally draw themselves. */
export function drawIn(tl: MotionTimeline, stroke: SVGLineElement | SVGPathElement, at: number, dur = 0.5) {
  tl.to(stroke, { strokeDashoffset: 0, duration: dur, ease: 'power2.inOut' }, at);
}

/** Animated counter — numbers count up to their EXACT value, never approximate. */
export function countUp(tl: MotionTimeline, textNode: SVGTextElement, to: number, at: number, opts: { dur?: number; format?: (n: number) => string } = {}) {
  const fmt = opts.format || ((n: number) => n.toLocaleString('en-US', { maximumFractionDigits: Number.isInteger(to) ? 0 : 1 }));
  const counter = { n: 0 };
  textNode.textContent = fmt(0);
  tl.to(counter, { n: to, duration: opts.dur ?? 1.2, ease: 'power2.out', onUpdate: () => { textNode.textContent = fmt(counter.n); } }, at);
}

/** Ambient float — slow sinusoidal drift while an element holds, so held
 * frames never look frozen. Runs from `at` to the end of the scene. */
export function ambientFloat(tl: MotionTimeline, node: SVGElement, at: number, total: number, amplitude = 6) {
  const span = Math.max(0.8, total - at);
  tl.to(node, { y: `-=${amplitude}`, duration: span / 2, ease: 'sine.inOut', yoyo: true, repeat: 1 }, at);
}

/** Breathing scale — the hero's ambient life while stationary. */
export function breathe(tl: MotionTimeline, node: SVGElement, at: number, total: number, magnitude = 0.02) {
  const span = Math.max(0.8, total - at);
  tl.to(node, { scale: 1 + magnitude, transformOrigin: '50% 50%', duration: span / 2, ease: 'sine.inOut', yoyo: true, repeat: 1 }, at);
}

/** Camera move on the scene root — push-in / pull-back / lateral drift, the
 * container-scale camera language. Runs across the whole scene. */
export function cameraMove(tl: MotionTimeline, root: SVGElement, move: string, intensity: number, total: number, width: number) {
  const k = Math.min(2, Math.max(0.25, intensity || 1));
  gsap.set(root, { transformOrigin: '50% 50%' });
  if (move === 'push_in') tl.to(root, { scale: 1 + 0.045 * k, duration: total, ease: 'sine.inOut' }, 0);
  else if (move === 'pull_back') { gsap.set(root, { scale: 1 + 0.05 * k }); tl.to(root, { scale: 1, duration: total, ease: 'sine.inOut' }, 0); }
  else if (move === 'drift_left') tl.to(root, { x: -width * 0.012 * k, scale: 1 + 0.02 * k, duration: total, ease: 'sine.inOut' }, 0);
  else if (move === 'drift_right') tl.to(root, { x: width * 0.012 * k, scale: 1 + 0.02 * k, duration: total, ease: 'sine.inOut' }, 0);
}

/** Exit — elements leave deliberately (scale + travel + opacity together). */
export function exitOut(tl: MotionTimeline, node: SVGElement, at: number, style: 'settle' | 'collapse' | 'drift' = 'settle', dur = 0.4) {
  if (style === 'collapse') tl.to(node, { scale: 0.82, opacity: 0, transformOrigin: '50% 50%', duration: dur, ease: 'power2.in' }, at);
  else if (style === 'drift') tl.to(node, { y: -18, opacity: 0, scale: 0.97, duration: dur, ease: 'power2.in' }, at);
  else tl.to(node, { scale: 0.96, opacity: 0, duration: dur, ease: 'power2.in' }, at);
}

/** Parallax pair — backdrop counter-drifts against the foreground so layered
 * scenes read as depth rather than a flat card. */
export function parallaxDrift(tl: MotionTimeline, backdrop: SVGElement, total: number, amount = 0.014, width = 1920) {
  gsap.set(backdrop, { transformOrigin: '50% 50%', scale: 1.06 });
  tl.to(backdrop, { x: -width * amount, scale: 1.09, duration: total, ease: 'none' }, 0);
}

// ---------------------------------------------------------------------------
// PAPER-CUT CONSTRUCTION (papercut theme). Every element is a piece of paper
// on the page: torn edges, a two-shadow stack (tight seat + soft lift),
// halftone accent blocks and one newsprint grain overlay. All deterministic —
// the torn edge comes from a SEEDED generator so the same scene renders the
// identical silhouette on every preview and every capture — and all cheap to
// rasterize (patterns and feDropShadow, no per-frame turbulence).
// ---------------------------------------------------------------------------

function seededRandom(seed: number): () => number {
  let state = (Math.floor(Math.abs(seed)) % 2147483646) + 1;
  return () => { state = (state * 48271) % 2147483647; return (state - 1) / 2147483646; };
}

let paperIdCounter = 0;

/** Torn-paper clipPath around a rect — jagged points every 3-6% of each edge,
 * 4-14px deep, always cut INWARD. Returns the clipPath id. */
export function tornClipPath(defs: SVGElement, rect: { x: number; y: number; w: number; h: number }, seed: number): string {
  const rand = seededRandom(seed || 7);
  const points: string[] = [];
  const jag = () => 4 + rand() * 10;
  const walk = (x1: number, y1: number, x2: number, y2: number, nx: number, ny: number) => {
    let t = 0;
    while (t < 1) {
      points.push(`${(x1 + (x2 - x1) * t + nx * jag()).toFixed(1)},${(y1 + (y2 - y1) * t + ny * jag()).toFixed(1)}`);
      t += 0.03 + rand() * 0.03;
    }
  };
  walk(rect.x, rect.y, rect.x + rect.w, rect.y, 0, 1);
  walk(rect.x + rect.w, rect.y, rect.x + rect.w, rect.y + rect.h, -1, 0);
  walk(rect.x + rect.w, rect.y + rect.h, rect.x, rect.y + rect.h, 0, -1);
  walk(rect.x, rect.y + rect.h, rect.x, rect.y, 1, 0);
  paperIdCounter += 1;
  const id = `mgTorn${paperIdCounter}`;
  const clip = el('clipPath', { id }, defs);
  el('polygon', { points: points.join(' ') }, clip);
  return id;
}

/** The paper shadow stack: a tight dark shadow seats the cutout on the layer
 * below, a soft diffuse one lifts it. Apply to the GROUP carrying a clipped
 * cutout (a plain box-shadow would follow the box, not the torn silhouette). */
export function paperShadowFilter(defs: SVGElement): string {
  paperIdCounter += 1;
  const id = `mgPaperShadow${paperIdCounter}`;
  const filter = el('filter', { id, x: '-20%', y: '-20%', width: '140%', height: '150%' }, defs);
  el('feDropShadow', { dx: 0, dy: 2, stdDeviation: 0, 'flood-color': '#000000', 'flood-opacity': 0.25 }, filter);
  el('feDropShadow', { dx: 0, dy: 8, stdDeviation: 8, 'flood-color': '#000000', 'flood-opacity': 0.2 }, filter);
  return id;
}

/** Newsprint halftone fill — an accent field stippled with dark dots. */
export function halftonePattern(defs: SVGElement, color: string, dotColor = 'rgba(0,0,0,0.5)'): string {
  paperIdCounter += 1;
  const id = `mgHalftone${paperIdCounter}`;
  const pattern = el('pattern', { id, width: 14, height: 14, patternUnits: 'userSpaceOnUse' }, defs);
  el('rect', { width: 14, height: 14, fill: color }, pattern);
  el('circle', { cx: 7, cy: 7, r: 3, fill: dotColor }, pattern);
  return id;
}

/** Photos get pulled into the flat palette — full-colour photography breaks a
 * 2-3 colour system instantly. Apply to <image> elements in the paper theme. */
export function desatFilter(defs: SVGElement, amount = 0.25): string {
  paperIdCounter += 1;
  const id = `mgDesat${paperIdCounter}`;
  const filter = el('filter', { id }, defs);
  el('feColorMatrix', { type: 'saturate', values: String(amount) }, filter);
  return id;
}

/** ONE full-frame grain overlay per scene, appended LAST so it sits above the
 * content. A rotated speck pattern rather than feTurbulence: the capture path
 * re-rasterizes the whole SVG every frame, and per-frame turbulence is the
 * kind of cost that drops recorded frames. */
export function grainOverlay(svg: SVGSVGElement, defs: SVGElement, W: number, H: number): SVGElement {
  paperIdCounter += 1;
  const id = `mgGrain${paperIdCounter}`;
  const pattern = el('pattern', { id, width: 5, height: 5, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(8)' }, defs);
  el('circle', { cx: 1.2, cy: 1.4, r: 0.55, fill: '#1A1A1A', opacity: 0.5 }, pattern);
  el('circle', { cx: 3.6, cy: 3.2, r: 0.4, fill: '#1A1A1A', opacity: 0.35 }, pattern);
  return el('rect', { x: 0, y: 0, width: W, height: H, fill: `url(#${id})`, opacity: 0.14, 'pointer-events': 'none' }, svg);
}
