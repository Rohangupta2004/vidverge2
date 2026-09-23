// VISUAL PRIMITIVE LIBRARY + DIRECTED RENDERER. Composable SVG+GSAP building
// blocks the Motion Director casts per layer (SmartText, KineticHeadline,
// Metric, Chart, Callout, Diagram, DeviceMockup, …) and the renderer that
// composes them from a SceneDirection (the Visual Timeline JSON). Primitives
// are COMPOSABLE — each draws into a rect the spatial system resolved, so a
// scene can stack a Metric over a DeviceMockup with a Callout connecting
// them — not standalone templates.
//
// Every piece of text and every number rendered here comes from the scene's
// MotionSpec (or the director's content copied from it) — the primitives
// never invent copy. Rendering runs inside the same serialization constraints
// as the classic engine: concrete colors, per-element fonts, animatable
// attributes only, so the capture path records exactly what previews show.

import { gsap } from 'https://esm.sh/gsap@3.12.5';
import {
  el, textBlock, kineticWords, wrapLines, nodeBox, nodeImageChip, drawnLine, drawnPath,
  springIn, riseIn, slideFadeIn, maskReveal, drawIn, countUp, ambientFloat, breathe, cameraMove, exitOut, parallaxDrift,
  FONT, INK, INK_SOFT, INK_MUTED, BG, PANEL, PANEL_EDGE, type MotionTimeline,
} from './motionKit';
import { resolvePlacements, toPixels } from './spatial';
import type { DirectedLayer, EntranceSpec, SceneDirection } from './visualTimeline';
import { contrastAccent, type MotionSpec } from './motionSpec';

export interface PixRect { x: number; y: number; w: number; h: number }
const centerOf = (rect: PixRect) => ({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });

export interface DirectedRenderContext {
  svg: SVGSVGElement;
  defs: SVGElement;
  root: SVGGElement;
  tl: MotionTimeline;
  W: number;
  H: number;
  u: number;
  total: number;
  accent: string;
  transparent: boolean;
  direction: SceneDirection;
  spec: MotionSpec;
}

interface LayerContentResolved {
  text: string; subtext: string; value: number | undefined; prefix: string; suffix: string;
  items: { label: string; sublabel?: string; value?: number; imageUrl?: string }[];
  leftTitle: string; rightTitle: string; leftItems: string[]; rightItems: string[]; imageUrl: string;
}

/** Layer content with MotionSpec fallbacks — the spec stays the text source. */
function contentFor(layer: DirectedLayer, spec: MotionSpec): LayerContentResolved {
  const c = layer.content || {};
  return {
    text: String(c.text ?? spec.title ?? '').trim(),
    subtext: String(c.subtext ?? spec.subtitle ?? '').trim(),
    value: c.value ?? spec.stat?.value ?? spec.items.find((item) => item.value !== undefined)?.value,
    prefix: String(c.prefix ?? spec.stat?.prefix ?? ''),
    suffix: String(c.suffix ?? spec.stat?.suffix ?? ''),
    items: (c.items && c.items.length ? c.items : spec.items) || [],
    leftTitle: String(c.leftTitle ?? spec.leftTitle ?? 'A'),
    rightTitle: String(c.rightTitle ?? spec.rightTitle ?? 'B'),
    leftItems: (c.leftItems && c.leftItems.length ? c.leftItems : spec.leftItems) || [],
    rightItems: (c.rightItems && c.rightItems.length ? c.rightItems : spec.rightItems) || [],
    imageUrl: String(c.imageUrl ?? spec.imageUrl ?? ''),
  };
}

/** Group-level entrance dispatch — role-aware: heroes get overshoot springs,
 * captions rise softly. Never a bare fade. */
function applyEntrance(ctx: DirectedRenderContext, group: SVGElement, bounds: PixRect, entrance: EntranceSpec, role: string, at: number) {
  const { tl, defs, u } = ctx;
  const travel = 46 * u;
  const fromX = entrance.from === 'left' ? -travel : entrance.from === 'right' ? travel : 0;
  const fromY = entrance.from === 'top' ? -travel : entrance.from === 'bottom' ? travel : 0;
  const hero = role === 'main';
  switch (entrance.style) {
    case 'mask':
      maskReveal(tl, defs, group, bounds, at, { dur: hero ? 0.8 : 0.6, from: entrance.from === 'top' || entrance.from === 'bottom' ? entrance.from : entrance.from === 'right' ? 'right' : 'left' });
      break;
    case 'rise':
      riseIn(tl, group, at, { dist: 30 * u, dur: hero ? 0.65 : 0.5 });
      break;
    case 'slide_fade':
      slideFadeIn(tl, group, at, { fromX: fromX || travel, fromY, dur: 0.6 });
      break;
    case 'pop':
      springIn(tl, group, at, { dur: 0.45, overshoot: entrance.overshoot === false ? 1.2 : 1.7 });
      break;
    case 'blur_in':
      // Soft-focus approximation without per-frame filters: settle from an
      // oversized, transparent state — cheap to rasterize, reads as focus.
      gsap.set(group, { transformOrigin: '50% 50%', scale: 1.08, opacity: 0 });
      tl.to(group, { scale: 1, opacity: 1, duration: 0.7, ease: 'power2.out' }, at);
      break;
    case 'draw':
    case 'countup':
      // Internal choreography (drawn strokes / counters) carries the reveal;
      // the group itself settles in quietly underneath it.
      riseIn(tl, group, at, { dist: 14 * u, dur: 0.4 });
      break;
    case 'spring':
    default:
      springIn(tl, group, at, { dur: hero ? 0.6 : 0.5, fromX, fromY, overshoot: entrance.overshoot === false ? 1.2 : 1.7 });
      break;
  }
}

// ---------------------------------------------------------------------------
// PRIMITIVES. Each returns the group it drew plus the bounds callouts target.
// `at` is the layer's entrance time; internal choreography offsets from it.
// ---------------------------------------------------------------------------

type PrimitiveBuild = { group: SVGGElement; bounds: PixRect };

function glassPanel(parent: SVGElement, rect: PixRect, u: number, stroke = PANEL_EDGE): SVGRectElement {
  return el<SVGRectElement>('rect', { x: rect.x, y: rect.y, width: rect.w, height: rect.h, rx: Math.min(rect.w, rect.h) * 0.08, fill: 'rgba(10,15,30,0.72)', stroke, 'stroke-width': 2 }, parent);
}

function fitFont(text: string, rect: PixRect, opts: { maxLines?: number; weight?: number } = {}): { size: number; maxChars: number; lines: number } {
  const maxLines = opts.maxLines || 3;
  const length = Math.max(4, String(text || '').length);
  const perLine = Math.ceil(length / maxLines);
  const byWidth = rect.w / (perLine * 0.6);
  const byHeight = rect.h / (maxLines * 1.35);
  const size = Math.max(16, Math.min(byWidth, byHeight));
  return { size, maxChars: Math.max(8, Math.floor(rect.w / (size * 0.58))), lines: maxLines };
}

function buildSmartText(ctx: DirectedRenderContext, layer: DirectedLayer, rect: PixRect, at: number): PrimitiveBuild {
  const group = el<SVGGElement>('g', {}, ctx.root);
  const content = contentFor(layer, ctx.spec);
  const { x, y } = centerOf(rect);
  const hasSub = Boolean(content.subtext);
  const fit = fitFont(content.text, { ...rect, h: rect.h * (hasSub ? 0.62 : 0.9) }, { maxLines: 2 });
  const title = textBlock(group, x, y - (hasSub ? rect.h * 0.1 : 0), content.text, { size: fit.size, weight: 800, fill: INK, maxChars: fit.maxChars, maxLines: 2 });
  riseIn(ctx.tl, title, at + 0.05, { dist: 20 * ctx.u, dur: 0.55 });
  if (hasSub) {
    const sub = textBlock(group, x, y + rect.h * 0.22, content.subtext, { size: Math.max(14, fit.size * 0.44), weight: 500, fill: INK_SOFT, maxChars: Math.round(fit.maxChars * 1.7), maxLines: 2 });
    riseIn(ctx.tl, sub, at + 0.22, { dist: 14 * ctx.u, dur: 0.5 });
  }
  return { group, bounds: rect };
}

function buildKineticHeadline(ctx: DirectedRenderContext, layer: DirectedLayer, rect: PixRect, at: number): PrimitiveBuild {
  const group = el<SVGGElement>('g', {}, ctx.root);
  const content = contentFor(layer, ctx.spec);
  const { x } = centerOf(rect);
  const fit = fitFont(content.text, { ...rect, h: rect.h * 0.7 }, { maxLines: 3 });
  const bar = el('rect', { x: x - 40 * ctx.u, y: rect.y + fit.size * 0.1, width: 80 * ctx.u, height: 7 * ctx.u, rx: 3.5 * ctx.u, fill: ctx.accent }, group);
  springIn(ctx.tl, bar, at, { dur: 0.4 }); // accent bar leads — anchors the eye before the words land
  const { words } = kineticWords(group, x, rect.y + fit.size * 1.35, content.text, { size: fit.size, weight: 900, maxChars: fit.maxChars, maxLines: 3 });
  // Word-by-word kinetic entrance — each word springs up with overshoot.
  words.forEach((word, index) => {
    gsap.set(word, { y: 34 * ctx.u, opacity: 0 });
    ctx.tl.to(word, { y: 0, opacity: 1, duration: 0.5, ease: 'back.out(1.6)' }, at + 0.12 + index * 0.09);
  });
  if (content.subtext) {
    const sub = textBlock(group, x, rect.y + rect.h * 0.88, content.subtext, { size: Math.max(14, fit.size * 0.36), weight: 500, fill: INK_SOFT, maxChars: Math.round(fit.maxChars * 2), maxLines: 2 });
    riseIn(ctx.tl, sub, at + 0.2 + words.length * 0.09, { dist: 16 * ctx.u });
  }
  return { group, bounds: rect };
}

function buildMetric(ctx: DirectedRenderContext, layer: DirectedLayer, rect: PixRect, at: number): PrimitiveBuild {
  const group = el<SVGGElement>('g', {}, ctx.root);
  const content = contentFor(layer, ctx.spec);
  const value = Number(content.value) || 0;
  const { x, y } = centerOf(rect);
  const size = Math.min(rect.h * 0.52, rect.w / (String(Math.round(value)).length + content.prefix.length + content.suffix.length + 1) * 1.5);
  const decimals = Math.abs(value) < 10 && !Number.isInteger(value) ? 1 : 0;
  const fmt = (n: number) => `${content.prefix}${n.toLocaleString('en-US', { maximumFractionDigits: decimals, minimumFractionDigits: decimals })}${content.suffix}`;
  const valueText = el<SVGTextElement>('text', { x, y: y + size * 0.1, 'font-family': FONT, 'font-size': size, 'font-weight': 900, fill: INK, 'text-anchor': 'middle' }, group);
  countUp(ctx.tl, valueText, value, at + 0.15, { dur: Math.min(2, ctx.total * 0.35), format: fmt }); // the number IS the story — counting to the exact value
  const underline = el('rect', { x: x - rect.w * 0.18, y: y + size * 0.34, width: rect.w * 0.36, height: 7 * ctx.u, rx: 3.5 * ctx.u, fill: ctx.accent }, group);
  springIn(ctx.tl, underline, at + 0.35, { dur: 0.45 });
  const label = content.text || content.subtext;
  if (label) {
    const labelText = textBlock(group, x, y + size * 0.34 + 46 * ctx.u, label, { size: Math.max(16, size * 0.22), weight: 600, fill: INK_SOFT, maxChars: Math.round(rect.w / (size * 0.13)), maxLines: 2 });
    riseIn(ctx.tl, labelText, at + 0.5, { dist: 18 * ctx.u });
  }
  breathe(ctx.tl, valueText, at + 1.6, ctx.total, 0.018); // ambient life while the number holds
  return { group, bounds: rect };
}

function buildChart(ctx: DirectedRenderContext, layer: DirectedLayer, rect: PixRect, at: number): PrimitiveBuild {
  const group = el<SVGGElement>('g', {}, ctx.root);
  const content = contentFor(layer, ctx.spec);
  const items = content.items.slice(0, 6);
  const max = Math.max(...items.map((item) => Math.abs(Number(item.value) || 0)), 1);
  const chartTop = rect.y + rect.h * 0.08;
  const chartBottom = rect.y + rect.h * 0.78;
  const slot = rect.w / Math.max(1, items.length);
  const barW = Math.min(110 * ctx.u, slot * 0.52);
  const base = drawnLine(group, rect.x, chartBottom, rect.x + rect.w, chartBottom, PANEL_EDGE, 3 * ctx.u);
  drawIn(ctx.tl, base, at, 0.45);
  items.forEach((item, index) => {
    const t = at + 0.2 + index * 0.22; // staggered build-in — magnitudes land one at a time
    const value = Math.abs(Number(item.value) || 0);
    const h = Math.max(8 * ctx.u, (chartBottom - chartTop) * value / max);
    const x = rect.x + slot * index + (slot - barW) / 2;
    const bar = el('rect', { x, y: chartBottom - h, width: barW, height: h, rx: 8 * ctx.u, fill: index === 0 ? ctx.accent : PANEL, stroke: index === 0 ? ctx.accent : PANEL_EDGE, 'stroke-width': 2 }, group);
    gsap.set(bar, { transformOrigin: '50% 100%', scaleY: 0 });
    ctx.tl.to(bar, { scaleY: 1, duration: 0.6, ease: 'back.out(1.2)' }, t); // bars overshoot slightly — growth feels physical
    const valueText = el<SVGTextElement>('text', { x: x + barW / 2, y: chartBottom - h - 14 * ctx.u, 'font-family': FONT, 'font-size': Math.max(15, 24 * ctx.u), 'font-weight': 800, fill: INK, 'text-anchor': 'middle' }, group);
    countUp(ctx.tl, valueText, value, t + 0.05, { dur: 0.6 });
    ctx.tl.fromTo(valueText, { opacity: 0, y: 8 * ctx.u }, { opacity: 1, y: 0, duration: 0.3 }, t + 0.1);
    const label = textBlock(group, x + barW / 2, chartBottom + 32 * ctx.u, item.label, { size: Math.max(13, 20 * ctx.u), weight: 600, fill: INK_SOFT, maxChars: 12, maxLines: 2 });
    riseIn(ctx.tl, label, t + 0.15, { dist: 10 * ctx.u, dur: 0.4 });
  });
  return { group, bounds: rect };
}

function buildTimelineRail(ctx: DirectedRenderContext, layer: DirectedLayer, rect: PixRect, at: number): PrimitiveBuild {
  const group = el<SVGGElement>('g', {}, ctx.root);
  const content = contentFor(layer, ctx.spec);
  const items = content.items.slice(0, 6);
  const vertical = rect.h > rect.w * 0.8;
  if (vertical) {
    const x = rect.x + rect.w * 0.14;
    const spine = drawnLine(group, x, rect.y + 10 * ctx.u, x, rect.y + rect.h - 10 * ctx.u, ctx.accent, 5 * ctx.u);
    drawIn(ctx.tl, spine, at, 0.7); // the rail draws first — chronology has a spine
    items.forEach((item, index) => {
      const t = at + 0.25 + index * 0.24;
      const y = rect.y + 24 * ctx.u + index * ((rect.h - 48 * ctx.u) / Math.max(1, items.length - 1) || 0);
      const dot = el('circle', { cx: x, cy: y, r: 12 * ctx.u, fill: ctx.accent, stroke: BG, 'stroke-width': 4 * ctx.u }, group);
      springIn(ctx.tl, dot, t, { dur: 0.35 });
      const label = textBlock(group, x + 28 * ctx.u, y - 2 * ctx.u, item.label, { size: Math.max(15, 26 * ctx.u), weight: 800, fill: INK, anchor: 'start', maxChars: 20, maxLines: 1 });
      slideFadeIn(ctx.tl, label, t + 0.08, { fromX: 20 * ctx.u, dur: 0.45 });
      if (item.sublabel) { const sub = textBlock(group, x + 28 * ctx.u, y + 26 * ctx.u, item.sublabel, { size: Math.max(12, 18 * ctx.u), weight: 500, fill: INK_SOFT, anchor: 'start', maxChars: 30, maxLines: 2 }); riseIn(ctx.tl, sub, t + 0.16, { dist: 8 * ctx.u, dur: 0.4 }); }
    });
  } else {
    const y = rect.y + rect.h * 0.55;
    const spine = drawnLine(group, rect.x, y, rect.x + rect.w, y, ctx.accent, 5 * ctx.u);
    drawIn(ctx.tl, spine, at, 0.7);
    items.forEach((item, index) => {
      const t = at + 0.25 + index * 0.24;
      const x = rect.x + (items.length === 1 ? rect.w / 2 : (rect.w * index) / (items.length - 1));
      const above = index % 2 === 0;
      const dot = el('circle', { cx: x, cy: y, r: 12 * ctx.u, fill: ctx.accent, stroke: BG, 'stroke-width': 4 * ctx.u }, group);
      springIn(ctx.tl, dot, t, { dur: 0.35 });
      const label = textBlock(group, x, y + (above ? -34 * ctx.u : 52 * ctx.u), item.label, { size: Math.max(14, 24 * ctx.u), weight: 800, fill: INK, maxChars: 14, maxLines: 1 });
      riseIn(ctx.tl, label, t + 0.1, { dist: above ? 10 * ctx.u : -10 * ctx.u, dur: 0.4 });
      if (item.sublabel) { const sub = textBlock(group, x, y + (above ? -64 * ctx.u : 84 * ctx.u), item.sublabel, { size: Math.max(11, 17 * ctx.u), weight: 500, fill: INK_SOFT, maxChars: 18, maxLines: 2 }); riseIn(ctx.tl, sub, t + 0.18, { dist: 8 * ctx.u, dur: 0.4 }); }
    });
  }
  return { group, bounds: rect };
}

function buildComparison(ctx: DirectedRenderContext, layer: DirectedLayer, rect: PixRect, at: number): PrimitiveBuild {
  const group = el<SVGGElement>('g', {}, ctx.root);
  const content = contentFor(layer, ctx.spec);
  const rightAccent = contrastAccent(ctx.accent);
  const stacked = rect.h > rect.w * 0.9;
  const panels = stacked
    ? [{ title: content.leftTitle, entries: content.leftItems, x: rect.x, y: rect.y, w: rect.w, h: rect.h * 0.47, from: -1, tone: ctx.accent }, { title: content.rightTitle, entries: content.rightItems, x: rect.x, y: rect.y + rect.h * 0.53, w: rect.w, h: rect.h * 0.47, from: 1, tone: rightAccent }]
    : [{ title: content.leftTitle, entries: content.leftItems, x: rect.x, y: rect.y, w: rect.w * 0.47, h: rect.h, from: -1, tone: ctx.accent }, { title: content.rightTitle, entries: content.rightItems, x: rect.x + rect.w * 0.53, y: rect.y, w: rect.w * 0.47, h: rect.h, from: 1, tone: rightAccent }];
  panels.forEach((panel, panelIndex) => {
    const panelGroup = el<SVGGElement>('g', {}, group);
    el('rect', { x: panel.x, y: panel.y, width: panel.w, height: panel.h, rx: 20 * ctx.u, fill: PANEL, stroke: panel.tone, 'stroke-width': 2.5 }, panelGroup);
    textBlock(panelGroup, panel.x + panel.w / 2, panel.y + 44 * ctx.u, panel.title, { size: Math.max(16, 28 * ctx.u), weight: 800, fill: panel.tone, maxChars: 20, maxLines: 1 });
    slideFadeIn(ctx.tl, panelGroup, at + panelIndex * 0.18, { fromX: panel.from * 40 * ctx.u, dur: 0.6 }); // opposing sides enter from opposing directions
    panel.entries.slice(0, 5).forEach((entry, entryIndex) => {
      const y = panel.y + 84 * ctx.u + entryIndex * Math.min(52 * ctx.u, (panel.h - 100 * ctx.u) / Math.max(1, panel.entries.length));
      const row = el<SVGGElement>('g', {}, group);
      el('circle', { cx: panel.x + 28 * ctx.u, cy: y - 6 * ctx.u, r: 6 * ctx.u, fill: panel.tone }, row);
      textBlock(row, panel.x + 46 * ctx.u, y, entry, { size: Math.max(13, 21 * ctx.u), weight: 600, fill: INK_SOFT, anchor: 'start', maxChars: Math.round(panel.w / (12 * ctx.u)), maxLines: 1 });
      slideFadeIn(ctx.tl, row, at + 0.4 + panelIndex * 0.18 + entryIndex * 0.14, { fromX: panel.from * 22 * ctx.u, dur: 0.45 });
    });
  });
  return { group, bounds: rect };
}

function buildDiagram(ctx: DirectedRenderContext, layer: DirectedLayer, rect: PixRect, at: number): PrimitiveBuild {
  const group = el<SVGGElement>('g', {}, ctx.root);
  const content = contentFor(layer, ctx.spec);
  const items = content.items.slice(0, 7);
  const { x: cx, y: cy } = centerOf(rect);
  const rx = rect.w * 0.36; const ry = rect.h * 0.34;
  const hubLabel = ctx.spec.root || content.text;
  const hub = hubLabel ? nodeBox(group, cx, cy, hubLabel, { size: Math.max(16, 26 * ctx.u), accent: ctx.accent, filled: true, minWidth: rect.w * 0.28 }) : null;
  items.forEach((item, index) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / Math.max(1, items.length);
    const nx = cx + rx * Math.cos(angle); const ny = cy + ry * Math.sin(angle);
    const t = at + 0.3 + index * 0.2;
    const edge = drawnLine(group, cx, cy, nx, ny, 'rgba(96,165,250,0.55)', 3 * ctx.u);
    drawIn(ctx.tl, edge, t, 0.4); // relationships literally draw themselves
    const node = nodeBox(group, nx, ny, item.label, { size: Math.max(14, 21 * ctx.u), accent: ctx.accent, minWidth: rect.w * 0.16, maxChars: 12 });
    springIn(ctx.tl, node.group, t + 0.16, { dur: 0.45 });
    if (item.imageUrl) { const chip = nodeImageChip(group, ctx.defs, nx, ny - node.height / 2 - 30 * ctx.u, 26 * ctx.u, item.imageUrl, ctx.accent); springIn(ctx.tl, chip, t + 0.26, { dur: 0.4 }); }
  });
  if (hub) springIn(ctx.tl, hub.group, at + 0.1, { dur: 0.5, overshoot: 1.7 }); // the hub lands first — hierarchy before branches
  return { group, bounds: rect };
}

function buildFlowChart(ctx: DirectedRenderContext, layer: DirectedLayer, rect: PixRect, at: number): PrimitiveBuild {
  const group = el<SVGGElement>('g', {}, ctx.root);
  const content = contentFor(layer, ctx.spec);
  const items = content.items.slice(0, 5);
  const vertical = rect.h > rect.w * 0.8;
  const size = Math.max(14, (items.length > 3 ? 20 : 24) * ctx.u);
  items.forEach((item, index) => {
    const t = at + index * 0.28;
    const cx = vertical ? rect.x + rect.w / 2 : rect.x + (items.length === 1 ? rect.w / 2 : rect.w * 0.1 + (rect.w * 0.8 * index) / (items.length - 1));
    const cy = vertical ? rect.y + 30 * ctx.u + index * ((rect.h - 60 * ctx.u) / Math.max(1, items.length - 1) || 0) : rect.y + rect.h / 2;
    const box = nodeBox(group, cx, cy, item.label, { size, accent: ctx.accent, minWidth: rect.w * (vertical ? 0.5 : 0.16), maxChars: 14 });
    const badge = el('circle', { cx: cx - box.width / 2 + 2 * ctx.u, cy: cy - box.height / 2 + 2 * ctx.u, r: 16 * ctx.u, fill: ctx.accent }, group);
    const badgeText = textBlock(group, cx - box.width / 2 + 2 * ctx.u, cy - box.height / 2 + 8 * ctx.u, String(index + 1), { size: 18 * ctx.u, weight: 800, fill: '#fff' });
    slideFadeIn(ctx.tl, box.group, t, { fromY: vertical ? 24 * ctx.u : 0, fromX: vertical ? 0 : 24 * ctx.u, dur: 0.5 }); // steps arrive in narrative order
    springIn(ctx.tl, badge, t + 0.12, { dur: 0.35 });
    riseIn(ctx.tl, badgeText, t + 0.12, { dist: 0, dur: 0.35 });
    if (index < items.length - 1) {
      const arrow = vertical
        ? drawnLine(group, rect.x + rect.w / 2, cy + box.height / 2 + 8 * ctx.u, rect.x + rect.w / 2, cy + ((rect.h - 60 * ctx.u) / Math.max(1, items.length - 1)) - box.height / 2 + 22 * ctx.u, ctx.accent, 4 * ctx.u)
        : drawnLine(group, cx + box.width / 2 + 8 * ctx.u, cy, cx + (rect.w * 0.8) / Math.max(1, items.length - 1) - box.width / 2 - 8 * ctx.u, cy, ctx.accent, 4 * ctx.u);
      drawIn(ctx.tl, arrow, t + 0.26, 0.4);
    }
  });
  return { group, bounds: rect };
}

function imageInFrame(ctx: DirectedRenderContext, parent: SVGElement, frame: PixRect, href: string, rxRadius: number) {
  const clipId = `mgCard${Math.floor(Math.random() * 1e9)}`;
  const clip = el('clipPath', { id: clipId }, ctx.defs);
  el('rect', { x: frame.x, y: frame.y, width: frame.w, height: frame.h, rx: rxRadius }, clip);
  const holder = el<SVGGElement>('g', { 'clip-path': `url(#${clipId})` }, parent);
  if (href) {
    const image = el('image', { x: frame.x, y: frame.y, width: frame.w, height: frame.h, href, preserveAspectRatio: 'xMidYMid slice' }, holder);
    image.setAttributeNS('http://www.w3.org/1999/xlink', 'href', href);
    gsap.set(image, { transformOrigin: '50% 50%', scale: 1.04 });
    ctx.tl.to(image, { scale: 1.12, x: -frame.w * 0.012, duration: ctx.total, ease: 'none' }, 0); // Ken Burns drift — stills are never static
  } else {
    el('rect', { x: frame.x, y: frame.y, width: frame.w, height: frame.h, fill: PANEL }, holder);
    for (let ring = 0; ring < 3; ring += 1) el('circle', { cx: frame.x + frame.w * 0.7, cy: frame.y + frame.h * 0.35, r: frame.h * (0.12 + ring * 0.1), fill: 'none', stroke: ctx.accent, 'stroke-width': 2 * ctx.u, opacity: 0.24 - ring * 0.06 }, holder);
  }
  return holder;
}

function buildImageCard(ctx: DirectedRenderContext, layer: DirectedLayer, rect: PixRect, at: number): PrimitiveBuild {
  const group = el<SVGGElement>('g', {}, ctx.root);
  const content = contentFor(layer, ctx.spec);
  const caption = layer.content?.text || '';
  const frameH = caption ? rect.h * 0.84 : rect.h;
  const frame = { x: rect.x, y: rect.y, w: rect.w, h: frameH };
  imageInFrame(ctx, group, frame, content.imageUrl, 22 * ctx.u);
  el('rect', { x: frame.x, y: frame.y, width: frame.w, height: frame.h, rx: 22 * ctx.u, fill: 'none', stroke: PANEL_EDGE, 'stroke-width': 2.5 }, group);
  if (caption) {
    const cap = textBlock(group, rect.x + rect.w / 2, rect.y + frameH + 32 * ctx.u, caption, { size: Math.max(14, 22 * ctx.u), weight: 600, fill: INK_SOFT, maxChars: Math.round(rect.w / (12 * ctx.u)), maxLines: 1 });
    riseIn(ctx.tl, cap, at + 0.3, { dist: 12 * ctx.u });
  }
  return { group, bounds: frame };
}

function buildDeviceMockup(ctx: DirectedRenderContext, layer: DirectedLayer, rect: PixRect, at: number): PrimitiveBuild {
  const group = el<SVGGElement>('g', {}, ctx.root);
  const content = contentFor(layer, ctx.spec);
  // Phone proportions inside the rect (portrait 9:19 body).
  const bodyH = rect.h;
  const bodyW = Math.min(rect.w, bodyH * 0.5);
  const bx = rect.x + (rect.w - bodyW) / 2;
  const radius = bodyW * 0.14;
  el('rect', { x: bx, y: rect.y, width: bodyW, height: bodyH, rx: radius, fill: '#0B1120', stroke: 'rgba(203,213,225,0.5)', 'stroke-width': 3 * ctx.u }, group);
  const screen = { x: bx + bodyW * 0.05, y: rect.y + bodyH * 0.03, w: bodyW * 0.9, h: bodyH * 0.94 };
  imageInFrame(ctx, group, screen, content.imageUrl, radius * 0.7);
  el('rect', { x: bx + bodyW * 0.32, y: rect.y + bodyH * 0.015, width: bodyW * 0.36, height: bodyH * 0.028, rx: bodyH * 0.014, fill: '#0B1120' }, group); // notch
  return { group, bounds: { x: bx, y: rect.y, w: bodyW, h: bodyH } };
}

function buildBrowserMockup(ctx: DirectedRenderContext, layer: DirectedLayer, rect: PixRect, at: number): PrimitiveBuild {
  const group = el<SVGGElement>('g', {}, ctx.root);
  const content = contentFor(layer, ctx.spec);
  const barH = Math.min(44 * ctx.u, rect.h * 0.12);
  el('rect', { x: rect.x, y: rect.y, width: rect.w, height: rect.h, rx: 16 * ctx.u, fill: '#0B1120', stroke: 'rgba(203,213,225,0.45)', 'stroke-width': 2.5 * ctx.u }, group);
  ['#F87171', '#FBBF24', '#34D399'].forEach((dot, index) => el('circle', { cx: rect.x + 24 * ctx.u + index * 26 * ctx.u, cy: rect.y + barH / 2, r: 7 * ctx.u, fill: dot }, group));
  el('rect', { x: rect.x + 110 * ctx.u, y: rect.y + barH * 0.24, width: rect.w * 0.5, height: barH * 0.52, rx: barH * 0.26, fill: PANEL }, group);
  imageInFrame(ctx, group, { x: rect.x + 3 * ctx.u, y: rect.y + barH, w: rect.w - 6 * ctx.u, h: rect.h - barH - 3 * ctx.u }, content.imageUrl, 10 * ctx.u);
  return { group, bounds: rect };
}

function buildProgressIndicator(ctx: DirectedRenderContext, layer: DirectedLayer, rect: PixRect, at: number): PrimitiveBuild {
  const group = el<SVGGElement>('g', {}, ctx.root);
  const content = contentFor(layer, ctx.spec);
  const steps = Math.max(2, Math.min(6, content.items.length || 4));
  const y = rect.y + rect.h * 0.4;
  const gap = 14 * ctx.u;
  const segW = (rect.w - gap * (steps - 1)) / steps;
  for (let index = 0; index < steps; index += 1) {
    const seg = el('rect', { x: rect.x + index * (segW + gap), y, width: segW, height: 12 * ctx.u, rx: 6 * ctx.u, fill: PANEL, stroke: PANEL_EDGE, 'stroke-width': 1.5 }, group);
    const fill = el('rect', { x: rect.x + index * (segW + gap), y, width: segW, height: 12 * ctx.u, rx: 6 * ctx.u, fill: ctx.accent }, group);
    gsap.set(fill, { transformOrigin: '0% 50%', scaleX: 0 });
    ctx.tl.to(fill, { scaleX: 1, duration: 0.45, ease: 'power2.inOut' }, at + 0.2 + index * 0.3); // progress fills stepwise — the viewer reads momentum
    const label = content.items[index]?.label;
    if (label) { const text = textBlock(group, rect.x + index * (segW + gap) + segW / 2, y + 44 * ctx.u, label, { size: Math.max(12, 18 * ctx.u), weight: 600, fill: INK_SOFT, maxChars: 12, maxLines: 1 }); riseIn(ctx.tl, text, at + 0.3 + index * 0.3, { dist: 10 * ctx.u, dur: 0.4 }); }
  }
  return { group, bounds: rect };
}

function buildMap(ctx: DirectedRenderContext, layer: DirectedLayer, rect: PixRect, at: number): PrimitiveBuild {
  const group = el<SVGGElement>('g', {}, ctx.root);
  const content = contentFor(layer, ctx.spec);
  const items = content.items.slice(0, 6);
  glassPanel(group, rect, ctx.u);
  // Deterministic abstract geography: pins spread across the panel; arcs
  // connect consecutive pins (routes/relationships), drawn in sequence.
  const positions = items.map((_, index) => ({
    x: rect.x + rect.w * (0.16 + 0.68 * ((index * 0.618) % 1)),
    y: rect.y + rect.h * (0.22 + 0.5 * (((index * 0.618) + 0.38) % 1)),
  }));
  positions.forEach((pos, index) => {
    const t = at + 0.2 + index * 0.24;
    if (index > 0) {
      const prev = positions[index - 1];
      const mx = (prev.x + pos.x) / 2; const my = Math.min(prev.y, pos.y) - rect.h * 0.12;
      const arc = drawnPath(group, `M ${prev.x} ${prev.y} Q ${mx} ${my} ${pos.x} ${pos.y}`, 'rgba(96,165,250,0.6)', 3 * ctx.u);
      drawIn(ctx.tl, arc, t - 0.08, 0.45); // the route draws between pins
    }
    const pin = el<SVGGElement>('g', {}, group);
    el('circle', { cx: pos.x, cy: pos.y, r: 11 * ctx.u, fill: ctx.accent, stroke: '#fff', 'stroke-width': 2.5 * ctx.u }, pin);
    el('circle', { cx: pos.x, cy: pos.y, r: 20 * ctx.u, fill: 'none', stroke: ctx.accent, 'stroke-width': 1.5 * ctx.u, opacity: 0.4 }, pin);
    springIn(ctx.tl, pin, t, { dur: 0.4 });
    const label = textBlock(group, pos.x, pos.y + 34 * ctx.u, items[index].label, { size: Math.max(12, 19 * ctx.u), weight: 700, fill: INK, maxChars: 14, maxLines: 1 });
    riseIn(ctx.tl, label, t + 0.12, { dist: 8 * ctx.u, dur: 0.4 });
  });
  return { group, bounds: rect };
}

function buildLogo(ctx: DirectedRenderContext, layer: DirectedLayer, rect: PixRect, at: number): PrimitiveBuild {
  const group = el<SVGGElement>('g', {}, ctx.root);
  const content = contentFor(layer, ctx.spec);
  const { x, y } = centerOf(rect);
  const fit = fitFont(content.text, rect, { maxLines: 1 });
  const mark = textBlock(group, x, y, content.text, { size: fit.size, weight: 900, fill: INK, maxChars: fit.maxChars, maxLines: 1, spacing: '0.04em' });
  maskReveal(ctx.tl, ctx.defs, mark, { x: rect.x, y: y - fit.size, w: rect.w, h: fit.size * 1.6 }, at, { dur: 0.8, from: 'left' }); // wordmark wipes on like a brand sting
  const underline = el('rect', { x: x - rect.w * 0.2, y: y + fit.size * 0.5, width: rect.w * 0.4, height: 5 * ctx.u, rx: 2.5 * ctx.u, fill: ctx.accent }, group);
  springIn(ctx.tl, underline, at + 0.5, { dur: 0.4 });
  return { group, bounds: rect };
}

function buildCaption(ctx: DirectedRenderContext, layer: DirectedLayer, rect: PixRect, at: number): PrimitiveBuild {
  const group = el<SVGGElement>('g', {}, ctx.root);
  const content = contentFor(layer, ctx.spec);
  const text = content.text || content.subtext;
  const size = Math.max(15, Math.min(rect.h * 0.42, 26 * ctx.u));
  const lines = wrapLines(text, Math.round(rect.w / (size * 0.56)), 2);
  const pillW = Math.min(rect.w, Math.max(...lines.map((line) => line.length)) * size * 0.58 + 48 * ctx.u);
  const pillH = lines.length * size * 1.3 + 26 * ctx.u;
  const px = rect.x + (rect.w - pillW) / 2;
  const py = rect.y + (rect.h - pillH) / 2;
  el('rect', { x: px, y: py, width: pillW, height: pillH, rx: 16 * ctx.u, fill: 'rgba(8,12,24,0.82)', stroke: 'rgba(255,255,255,0.18)', 'stroke-width': 1.5 }, group);
  textBlock(group, px + pillW / 2, py + 22 * ctx.u + size * 0.72, text, { size, weight: 700, fill: INK, maxChars: Math.round(rect.w / (size * 0.56)), maxLines: 2 });
  return { group, bounds: { x: px, y: py, w: pillW, h: pillH } };
}

// Attention primitives — these AIM at another layer.

function edgePoint(target: PixRect, from: PixRect): { x: number; y: number } {
  const tc = centerOf(target); const fc = centerOf(from);
  const dx = tc.x - fc.x; const dy = tc.y - fc.y;
  return { x: tc.x - Math.sign(dx) * target.w * 0.42, y: tc.y - Math.sign(dy) * target.h * 0.42 };
}

function buildCallout(ctx: DirectedRenderContext, layer: DirectedLayer, rect: PixRect, at: number, target: PixRect | null): PrimitiveBuild {
  const group = el<SVGGElement>('g', {}, ctx.root);
  const content = contentFor(layer, ctx.spec);
  const text = content.text || content.subtext;
  const size = Math.max(14, 22 * ctx.u);
  const lines = wrapLines(text, Math.round(rect.w / (size * 0.56)), 2);
  const pillW = Math.min(rect.w, Math.max(...lines.map((line) => line.length), 6) * size * 0.58 + 44 * ctx.u);
  const pillH = lines.length * size * 1.3 + 22 * ctx.u;
  const px = rect.x + (rect.w - pillW) / 2;
  const py = rect.y + (rect.h - pillH) / 2;
  const pill = el<SVGGElement>('g', {}, group);
  el('rect', { x: px, y: py, width: pillW, height: pillH, rx: 14 * ctx.u, fill: 'rgba(10,15,30,0.88)', stroke: ctx.accent, 'stroke-width': 2 }, pill);
  textBlock(pill, px + pillW / 2, py + 18 * ctx.u + size * 0.72, text, { size, weight: 700, fill: INK, maxChars: Math.round(pillW / (size * 0.56)), maxLines: 2 });
  if (target) {
    const anchor = edgePoint(target, { x: px, y: py, w: pillW, h: pillH });
    const start = { x: px + pillW / 2, y: py + (anchor.y > py + pillH / 2 ? pillH : 0) };
    const mx = (start.x + anchor.x) / 2 + (anchor.x - start.x) * 0.1;
    const my = (start.y + anchor.y) / 2 - Math.abs(anchor.x - start.x) * 0.12;
    const leader = drawnPath(group, `M ${start.x} ${start.y} Q ${mx} ${my} ${anchor.x} ${anchor.y}`, ctx.accent, 3 * ctx.u);
    drawIn(ctx.tl, leader, at + 0.24, 0.45); // the connector draws TO the thing being explained
    const dot = el('circle', { cx: anchor.x, cy: anchor.y, r: 9 * ctx.u, fill: ctx.accent, stroke: '#fff', 'stroke-width': 2.5 * ctx.u }, group);
    springIn(ctx.tl, dot, at + 0.6, { dur: 0.35 });
  }
  return { group, bounds: { x: px, y: py, w: pillW, h: pillH } };
}

function buildArrow(ctx: DirectedRenderContext, layer: DirectedLayer, rect: PixRect, at: number, target: PixRect | null): PrimitiveBuild {
  const group = el<SVGGElement>('g', {}, ctx.root);
  const from = centerOf(rect);
  const to = target ? edgePoint(target, rect) : { x: from.x + rect.w * 0.4, y: from.y };
  const line = drawnLine(group, from.x, from.y, to.x, to.y, ctx.accent, 5 * ctx.u);
  drawIn(ctx.tl, line, at, 0.5);
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const headLen = 16 * ctx.u;
  const head = el<SVGPathElement>('path', { d: `M ${to.x} ${to.y} L ${to.x - headLen * Math.cos(angle - 0.5)} ${to.y - headLen * Math.sin(angle - 0.5)} M ${to.x} ${to.y} L ${to.x - headLen * Math.cos(angle + 0.5)} ${to.y - headLen * Math.sin(angle + 0.5)}`, fill: 'none', stroke: ctx.accent, 'stroke-width': 5 * ctx.u, 'stroke-linecap': 'round' }, group);
  ctx.tl.fromTo(head, { opacity: 0 }, { opacity: 1, duration: 0.2 }, at + 0.45);
  return { group, bounds: rect };
}

function buildPointer(ctx: DirectedRenderContext, layer: DirectedLayer, rect: PixRect, at: number, target: PixRect | null): PrimitiveBuild {
  const group = el<SVGGElement>('g', {}, ctx.root);
  const point = target ? centerOf(target) : centerOf(rect);
  const dot = el('circle', { cx: point.x, cy: point.y, r: 10 * ctx.u, fill: ctx.accent, stroke: '#fff', 'stroke-width': 3 * ctx.u }, group);
  const halo = el('circle', { cx: point.x, cy: point.y, r: 10 * ctx.u, fill: 'none', stroke: ctx.accent, 'stroke-width': 2.5 * ctx.u }, group);
  springIn(ctx.tl, dot, at, { dur: 0.35 });
  gsap.set(halo, { transformOrigin: '50% 50%', scale: 1, opacity: 0.8 });
  ctx.tl.to(halo, { scale: 2.4, opacity: 0, duration: 1, ease: 'power1.out', repeat: Math.max(1, Math.floor((ctx.total - at) / 1.2)), repeatDelay: 0.2 }, at + 0.3); // pulsing ring keeps drawing the eye to the point
  return { group, bounds: rect };
}

function buildHighlight(ctx: DirectedRenderContext, layer: DirectedLayer, rect: PixRect, at: number, target: PixRect | null): PrimitiveBuild {
  const group = el<SVGGElement>('g', {}, ctx.root);
  const box = target || rect;
  const pad = 10 * ctx.u;
  const outline = { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };
  const perimeter = 2 * (outline.w + outline.h);
  const stroke = el<SVGRectElement>('rect', { x: outline.x, y: outline.y, width: outline.w, height: outline.h, rx: 14 * ctx.u, fill: 'none', stroke: ctx.accent, 'stroke-width': 4 * ctx.u, 'stroke-dasharray': perimeter, 'stroke-dashoffset': perimeter }, group);
  ctx.tl.to(stroke, { strokeDashoffset: 0, duration: 0.7, ease: 'power2.inOut' }, at); // the box draws itself around the subject
  return { group, bounds: outline };
}

function buildGlow(ctx: DirectedRenderContext, layer: DirectedLayer, rect: PixRect, at: number, target: PixRect | null): PrimitiveBuild {
  const group = el<SVGGElement>('g', {}, ctx.root);
  const box = target || rect;
  const { x, y } = centerOf(box);
  const gradId = `mgGlowP${Math.floor(Math.random() * 1e9)}`;
  const grad = el('radialGradient', { id: gradId }, ctx.defs);
  el('stop', { offset: '0%', 'stop-color': ctx.accent, 'stop-opacity': 0.4 }, grad);
  el('stop', { offset: '100%', 'stop-color': ctx.accent, 'stop-opacity': 0 }, grad);
  const halo = el('ellipse', { cx: x, cy: y, rx: box.w * 0.75, ry: box.h * 0.75, fill: `url(#${gradId})` }, group);
  gsap.set(halo, { transformOrigin: '50% 50%', scale: 0.7, opacity: 0 });
  ctx.tl.to(halo, { scale: 1, opacity: 1, duration: 0.8, ease: 'power2.out' }, at);
  breathe(ctx.tl, halo, at + 1, ctx.total, 0.06); // ambient glow breathes behind the focal element
  return { group, bounds: box };
}

// ---------------------------------------------------------------------------
// DIRECTED RENDERER — composes the primitives from a SceneDirection inside
// the caller's svg/root/timeline. Returns the natural end time (seconds) so
// the caller can fit reveal + hold + exit into the scene window.
// ---------------------------------------------------------------------------

export function renderDirectedLayers(ctx: DirectedRenderContext): number {
  const { direction, tl, root, defs, W, H, total, transparent, u } = ctx;
  const portrait = H > W;
  const paceScale = direction.pacing === 'energetic' ? 0.78 : direction.pacing === 'contemplative' ? 1.25 : 1;

  // Spatial pass: zones → collision-free rects; every fix is kept on record.
  const { placed, adjustments } = resolvePlacements(direction.layers, { portrait, avoidFace: transparent });
  if (adjustments.length) direction.adjustments = [...(direction.adjustments || []), ...adjustments].slice(-12);

  // Background layer: an image backdrop with parallax + scrim (full-frame
  // builds only — transparent composites keep the presenter visible).
  const backgroundLayer = placed.find((entry) => entry.layer.role === 'background');
  if (!transparent && backgroundLayer) {
    const href = contentFor(backgroundLayer.layer, ctx.spec).imageUrl;
    if (href) {
      const image = el('image', { x: -W * 0.03, y: -H * 0.03, width: W * 1.06, height: H * 1.06, href, preserveAspectRatio: 'xMidYMid slice', opacity: 0.34 }, ctx.svg);
      image.setAttributeNS('http://www.w3.org/1999/xlink', 'href', href);
      ctx.svg.insertBefore(image, root);
      const scrim = el('rect', { x: 0, y: 0, width: W, height: H, fill: BG, opacity: 0.56 }, ctx.svg);
      ctx.svg.insertBefore(scrim, root);
      parallaxDrift(tl, image, total, 0.012, W); // backdrop counter-drifts against the camera — depth, not a flat card
    }
  }

  // Camera move on the scene container.
  cameraMove(tl, root, direction.camera.move, direction.camera.intensity || 1, total, W);

  // Layers in z order; entrances clamped so everything lands inside the
  // reveal window (the last ~30% of the scene is hold + exit).
  const revealCeiling = Math.max(0.8, total * 0.62);
  const boundsById = new Map<string, PixRect>();
  let cursor = 0.1;
  // Background layers never join the primitive pass: full-frame builds paint
  // them behind the root above, and transparent composites must leave the
  // presenter visible — a full-frame backdrop would cover the avatar.
  const ordered = placed.filter((entry) => entry.layer.role !== 'background');
  ordered.sort((a, b) => (a.layer.zIndex || 0) - (b.layer.zIndex || 0));
  ordered.forEach((entry) => {
    const layer = entry.layer;
    const rect = toPixels(entry.rect, W, H);
    const at = Math.min(revealCeiling, Math.max(0.05, layer.entrance.at * paceScale));
    const target = layer.targetLayerId ? boundsById.get(layer.targetLayerId) || null : null;
    let build: PrimitiveBuild;
    switch (layer.type) {
      case 'KineticHeadline': build = buildKineticHeadline(ctx, layer, rect, at); break;
      case 'Metric': build = buildMetric(ctx, layer, rect, at); break;
      case 'Chart': build = buildChart(ctx, layer, rect, at); break;
      case 'TimelineRail': build = buildTimelineRail(ctx, layer, rect, at); break;
      case 'Comparison': build = buildComparison(ctx, layer, rect, at); break;
      case 'Diagram': build = buildDiagram(ctx, layer, rect, at); break;
      case 'FlowChart': build = buildFlowChart(ctx, layer, rect, at); break;
      case 'DeviceMockup': build = buildDeviceMockup(ctx, layer, rect, at); break;
      case 'BrowserMockup': build = buildBrowserMockup(ctx, layer, rect, at); break;
      case 'ProductUI':
      case 'VideoLayer': // at capture time an AI-footage layer renders its poster frame
      case 'ImageCard': build = buildImageCard(ctx, layer, rect, at); break;
      case 'ProgressIndicator': build = buildProgressIndicator(ctx, layer, rect, at); break;
      case 'Map': build = buildMap(ctx, layer, rect, at); break;
      case 'Logo': build = buildLogo(ctx, layer, rect, at); break;
      case 'Caption': build = buildCaption(ctx, layer, rect, at); break;
      case 'Callout': build = buildCallout(ctx, layer, rect, at, target); break;
      case 'Arrow': build = buildArrow(ctx, layer, rect, at, target); break;
      case 'Pointer': build = buildPointer(ctx, layer, rect, at, target); break;
      case 'Highlight': build = buildHighlight(ctx, layer, rect, at, target); break;
      case 'Glow': build = buildGlow(ctx, layer, rect, at, target); break;
      case 'SmartText':
      default: build = buildSmartText(ctx, layer, rect, at); break;
    }
    boundsById.set(layer.id, build.bounds);
    // Group-level entrance on top of the primitive's internal choreography
    // (skipped for draw-only attention primitives, whose stroke IS the entrance).
    if (layer.type !== 'Highlight' && layer.type !== 'Arrow' && layer.type !== 'Pointer') {
      applyEntrance(ctx, build.group, build.bounds, layer.entrance, layer.role, at);
    }
    // Ambient motion while holding — the hero breathes, supports drift.
    if (direction.ambient && (layer.role === 'main' || layer.role === 'support') && layer.type !== 'Chart' && layer.type !== 'ProgressIndicator') {
      ambientFloat(tl, build.group, Math.min(total * 0.7, at + 1.2), total, layer.role === 'main' ? 5 * u : 8 * u);
    }
    // Declared early exits leave deliberately; everything else rides the
    // scene-level exit the caller applies.
    if (layer.exit?.at !== undefined && layer.exit.at < total - 0.5) {
      exitOut(tl, build.group, Math.max(at + 0.8, layer.exit.at), layer.exit.style || 'settle');
    }
    cursor = Math.max(cursor, at + 0.9);
  });
  return cursor + 0.3;
}
