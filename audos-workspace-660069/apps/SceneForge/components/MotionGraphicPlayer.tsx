import { useEffect, useRef } from 'react';
import { gsap } from 'https://esm.sh/gsap@3.12.5';
import { accentForSpec, contrastAccent, normalizeMotionSpec, type MotionItem, type MotionSpec } from '../lib/motionSpec';
import { BG, INK, INK_SOFT, INK_MUTED, FONT, FONT_DISPLAY, PANEL, PANEL_EDGE, PANEL_GLASS, GLASS_EDGE, NEUTRAL, EDGE_SOFT, THEME, SVG_NS, cameraMove, desatFilter, drawIn, drawnLine, el, grainOverlay, halftonePattern, motionThemeForStyle, nodeBox, nodeImageChip, paperShadowFilter, riseIn, setMotionTheme, springIn, textBlock, tornClipPath, wrapLines } from '../lib/motionKit';
import { renderDirectedLayers, renderUSStateMap } from '../lib/motionPrimitives';
import { normalizeSceneDirection, type SceneDirection } from '../lib/visualTimeline';

// MOTION GRAPHICS ENGINE — GSAP + SVG. One builder produces both surfaces:
//   * the live in-browser preview (this component), and
//   * the capture path (lib/motionCapture) that rasterizes the same SVG frame
//     by frame into a real video file for the FFmpeg composite.
// Everything drawn here comes literally from the MotionSpec: exact strings,
// exact numbers. The engine never invents copy — that is the whole point of
// the motion-graphics layer versus text inside AI-generated video.
//
// TWO RENDER PATHS, ONE VOCABULARY (lib/motionKit):
//   * DIRECTED — when the scene carries a Motion Director timeline
//     (director_timeline), the primitive library (lib/motionPrimitives)
//     composes the layers with the director's hierarchy, spatial zones,
//     entrance timing, camera move and ambient motion.
//   * CLASSIC — the deterministic kind renderers below, upgraded to the same
//     vocabulary: spring entrances with overshoot, scale+opacity combinations
//     (never a bare fade), drawn connectors, camera push, ambient drift.
//
// Serialization constraints (the capture path rasterizes the SVG through an
// <img>, which applies no external CSS and loads no external resources):
//   * colors are concrete hex values, never var(--space-…) tokens,
//   * fonts are a plain system stack declared per <text> element,
//   * images must already be data: URLs when capturing (the capture module
//     inlines them); the live preview may use remote URLs directly.

// Classic-kind aliases over the shared vocabulary — pops are springs with
// overshoot, rises settle with scale+opacity, draws are real stroke reveals.
const pop = (tl: gsap.core.Timeline, node: SVGElement, at: number, dur = 0.5) => springIn(tl, node, at, { dur });
const rise = (tl: gsap.core.Timeline, node: SVGElement, at: number, dist = 26, dur = 0.55) => riseIn(tl, node, at, { dist, dur });
const draw = (tl: gsap.core.Timeline, line: SVGLineElement, at: number, dur = 0.5) => drawIn(tl, line, at, dur);

export interface BuiltMotionGraphic { svg: SVGSVGElement; timeline: gsap.core.Timeline; durationSec: number }

export interface MotionBuildOptions {
  /** Render with a fully transparent background — no full-bleed fill, grid,
   * glow or backdrop image — so the graphic composites OVER the live
   * presenter (the overlay/central composition modes) instead of shipping as
   * an isolated card on a dark frame. */
  transparent?: boolean;
  /** Draw a rounded glass panel behind the content so exact text stays
   * legible over arbitrary footage. Only meaningful with `transparent`. */
  panel?: boolean;
  /** Multiplier on the type/element unit — used when the graphic renders into
   * a small overlay tile so labels stay readable at final composited size. */
  unitScale?: number;
  /** The Motion Director's Visual Timeline for this scene (scene.director_timeline).
   * When present and usable, the directed primitive renderer composes the
   * scene; when absent or broken, the classic kind renderer takes over. */
  directed?: SceneDirection | Record<string, unknown> | null;
  /** The project's visual style id — picks the render THEME ('vox-explainer'
   * → the paper-cut language; everything else → midnight). Falls back to
   * window.__sceneForgeStyleId (set by the app when a project opens). */
  styleId?: string | null;
}

/**
 * Build the animated SVG for a spec at the given pixel size. The timeline is
 * returned PAUSED; callers play it (preview) or scrub/record it (capture).
 */
export function buildMotionGraphic(rawSpec: MotionSpec | Record<string, unknown>, width: number, height: number, durationOverrideSec?: number, options: MotionBuildOptions = {}): BuiltMotionGraphic {
  const spec = normalizeMotionSpec(rawSpec);
  // THEME: the project's visual style picks the language — 'vox-explainer'
  // renders the paper-cut system, everything else keeps midnight. Builds are
  // synchronous and captures serialize through one queue, so swapping the
  // module theme here is race-free.
  setMotionTheme(motionThemeForStyle(options.styleId ?? (typeof window !== 'undefined' ? String((window as any).__sceneForgeStyleId || '') : '')));
  const W = width; const H = height;
  const transparent = options.transparent === true;
  const u = (Math.min(W, H) / 1080) * (Number(options.unitScale) > 0 ? Number(options.unitScale) : 1);
  // Content-aware accent: explicit spec accent > topic keywords > kind default
  // > deterministic rotation — so the film stops repeating one blue card.
  // Paper theme: palette DISCIPLINE beats variety — one locked accent per
  // film, and colour means "look here".
  const accent = THEME.accentOverride || accentForSpec(spec);
  const portrait = H > W;
  const total = Math.min(20, Math.max(2.5, Number(durationOverrideSec || spec.durationSec) || 6));

  const svg = el<SVGSVGElement>('svg', { xmlns: SVG_NS, viewBox: `0 0 ${W} ${H}`, width: W, height: H });
  const defs = el('defs', {}, svg);
  let glowRect: SVGElement | null = null;
  // The full-bleed background, grid and atmosphere glow belong to the
  // FULL-FRAME treatment only: a transparent build leaves every untouched
  // pixel alpha=0 so the presenter stays visible through the composite.
  if (!transparent && THEME.paper) {
    // Paper field: flat warm cream — no glow, no grid. The texture comes from
    // the single newsprint grain overlay appended above the content at the
    // end of the build; atmosphere never competes with the ink.
    el('rect', { x: 0, y: 0, width: W, height: H, fill: BG }, svg);
  } else if (!transparent) {
    const glowId = `mgGlow${Math.floor(Math.random() * 1e9)}`;
    const glow = el('radialGradient', { id: glowId, cx: '50%', cy: '0%', r: '85%' }, defs);
    el('stop', { offset: '0%', 'stop-color': accent, 'stop-opacity': 0.28 }, glow);
    el('stop', { offset: '60%', 'stop-color': accent, 'stop-opacity': 0.06 }, glow);
    el('stop', { offset: '100%', 'stop-color': accent, 'stop-opacity': 0 }, glow);

    el('rect', { x: 0, y: 0, width: W, height: H, fill: BG }, svg);
    glowRect = el('rect', { x: 0, y: 0, width: W, height: H, fill: `url(#${glowId})`, opacity: 0 }, svg);
    const grid = el<SVGGElement>('g', { opacity: 0.05, stroke: INK_SOFT, 'stroke-width': 1 }, svg);
    for (let x = 120 * u; x < W; x += 240 * u) el('line', { x1: x, y1: 0, x2: x, y2: H }, grid);
    for (let y = 120 * u; y < H; y += 240 * u) el('line', { x1: 0, y1: y, x2: W, y2: y }, grid);
  }

  // The director's Visual Timeline, when the scene carries one. Normalized
  // here so a stale or malformed stored timeline degrades to the classic path
  // instead of failing the build.
  const direction = options.directed ? normalizeSceneDirection(options.directed) : null;

  // CONTEXTUAL BACKDROP (AI-generated or reused project asset): for every
  // kind except annotated_image — which frames the image itself — spec.imageUrl
  // paints a dimmed, slowly drifting full-bleed picture behind the graphic
  // with a dark scrim on top, so scenes carry real atmosphere while the exact
  // text keeps full contrast. The capture path inlines the image as a data:
  // URL before recording, identical to the item image chips. Directed scenes
  // paint their own backdrop from the timeline's background layer.
  let backdropImage: SVGElement | null = null;
  if (!transparent && !direction && spec.imageUrl && spec.kind !== 'annotated_image') {
    backdropImage = el('image', { x: -W * 0.03, y: -H * 0.03, width: W * 1.06, height: H * 1.06, href: spec.imageUrl, preserveAspectRatio: 'xMidYMid slice', opacity: 0.34 }, svg);
    backdropImage.setAttributeNS('http://www.w3.org/1999/xlink', 'href', spec.imageUrl);
    // Paper theme: photos get pulled into the flat palette (desaturated) and
    // washed with paper rather than dimmed with navy.
    if (THEME.paper) backdropImage.setAttribute('filter', `url(#${desatFilter(defs, 0.25)})`);
    el('rect', { x: 0, y: 0, width: W, height: H, fill: BG, opacity: 0.56 }, svg);
  }

  const root = el<SVGGElement>('g', { opacity: 0 }, svg);
  // Legibility panel for composited graphics: a rounded glass card behind the
  // content, fading in and out with it, so exact text reads on any footage
  // while the presenter remains visible around the card.
  if (transparent && options.panel !== false) {
    el('rect', { x: W * 0.015, y: H * 0.015, width: W * 0.97, height: H * 0.97, rx: THEME.paper ? 8 : Math.min(W, H) * 0.055, fill: PANEL_GLASS, stroke: GLASS_EDGE, 'stroke-width': 2 }, root);
  }
  const tl = gsap.timeline({ paused: true });
  tl.to(root, { opacity: 1, duration: 0.35, ease: 'power1.out' }, 0);
  if (glowRect) tl.to(glowRect, { opacity: 1, duration: 0.8, ease: 'power1.out' }, 0);
  if (backdropImage) {
    gsap.set(backdropImage, { transformOrigin: '50% 50%', scale: 1 });
    tl.to(backdropImage, { scale: 1.07, duration: total, ease: 'none' }, 0);
  }

  const intro = Math.min(1, total * 0.18);
  const revealSpan = Math.max(0.8, total * 0.62 - intro);
  let cursor = 0.1;

  // DIRECTED PATH: the Motion Director's timeline drives the primitive
  // library. Any failure inside the directed render falls back to the classic
  // kind renderer — a scene must always produce a picture.
  let directedEnd = 0;
  if (direction && direction.layers.length) {
    try {
      directedEnd = renderDirectedLayers({ svg, defs, root, tl, W, H, u, total, accent, transparent, direction, spec });
    } catch (directedError) {
      console.warn('[SceneForge] Directed render failed — using the classic kind renderer.', directedError);
      directedEnd = 0;
    }
  }
  if (directedEnd > 0) {
    cursor = directedEnd;
  } else {
  // Camera-like push on the classic container — the same container-scale
  // camera language directed scenes use (subtle; full-frame builds only).
  if (!transparent) cameraMove(tl, root, 'push_in', 0.7, total, W);

  // Header (skipped for text_reveal / big_stat, which own the whole frame).
  const headerless = spec.kind === 'text_reveal' || spec.kind === 'big_stat';
  const titleY = portrait ? H * 0.1 : H * 0.13;
  if (!headerless && spec.title) {
    const bar = el('rect', { x: W / 2 - 36 * u, y: titleY - 74 * u, width: 72 * u, height: 7 * u, rx: 3.5 * u, fill: accent }, root);
    const title = textBlock(root, W / 2, titleY, spec.title, { size: 52 * u, weight: 800, fill: INK, maxChars: portrait ? 24 : 42, maxLines: 2 });
    pop(tl, bar, cursor, 0.4);
    rise(tl, title, cursor + 0.08, 24 * u, intro * 0.9);
    cursor += intro * 0.55;
    if (spec.subtitle) {
      const sub = textBlock(root, W / 2, titleY + 62 * u, spec.subtitle, { size: 28 * u, weight: 500, fill: INK_SOFT, maxChars: portrait ? 34 : 64, maxLines: 2 });
      rise(tl, sub, cursor, 18 * u, 0.5);
      cursor += 0.2;
    }
  }

  const top = (!headerless && spec.title) ? (portrait ? H * 0.18 : H * 0.24) : H * 0.12;
  const bottom = H * 0.9;
  const items = spec.items.length ? spec.items : ([{ label: spec.title || '' }] as MotionItem[]);
  const n = items.length;
  const step = n > 0 ? revealSpan / n : revealSpan;

  if (spec.kind === 'branching_diagram') {
    const rootLabel = spec.root || spec.title || items[0]?.label || '';
    const rootPos = portrait ? { x: W / 2, y: top + 90 * u } : { x: W / 2, y: top + (bottom - top) * 0.3 };
    const branchSize = 30 * u;
    const rootNode = nodeBox(root, rootPos.x, rootPos.y, rootLabel, { size: 38 * u, accent, filled: true, minWidth: 300 * u });
    pop(tl, rootNode.group, cursor, 0.55);
    cursor += 0.35;
    items.slice(0, 6).forEach((item, index) => {
      const count = Math.min(6, n);
      let bx: number; let by: number;
      if (portrait) { by = rootPos.y + 200 * u + index * ((bottom - rootPos.y - 240 * u) / Math.max(1, count - 1) || 0); bx = W / 2 + (index % 2 === 0 ? -1 : 1) * W * 0.16; }
      else { bx = W * (count === 1 ? 0.5 : 0.14 + (0.72 * index) / (count - 1)); by = top + (bottom - top) * 0.78; }
      const at = cursor + index * step;
      const line = drawnLine(root, rootPos.x, rootPos.y + rootNode.height / 2, bx, by - branchSize * 1.2, accent, 4 * u);
      draw(tl, line, at, Math.min(0.5, step + 0.2));
      const branch = nodeBox(root, bx, by, item.label, { size: branchSize, accent, minWidth: 190 * u, maxChars: 14 });
      pop(tl, branch.group, at + 0.22, 0.5);
      if (item.imageUrl && !portrait) { const chip = nodeImageChip(root, defs, bx, by - branch.height / 2 - 44 * u, 36 * u, item.imageUrl, accent); pop(tl, chip, at + 0.3, 0.45); }
      if (item.sublabel) { const sub = textBlock(root, bx, by + branch.height / 2 + 34 * u, item.sublabel, { size: 20 * u, weight: 500, fill: INK_MUTED, maxChars: 26, maxLines: 2 }); rise(tl, sub, at + 0.4, 12 * u, 0.4); }
    });
    cursor += Math.min(6, n) * step + 0.4;
  } else if (spec.kind === 'flowchart') {
    const count = Math.min(5, n);
    const size = count > 4 ? 26 * u : 30 * u;
    items.slice(0, 5).forEach((item, index) => {
      const at = cursor + index * step;
      let cx: number; let cy: number;
      if (portrait) { cx = W / 2; cy = top + 70 * u + index * ((bottom - top - 140 * u) / Math.max(1, count - 1) || 0); }
      else { cx = W * (count === 1 ? 0.5 : 0.11 + (0.78 * index) / (count - 1)); cy = (top + bottom) / 2; }
      const box = nodeBox(root, cx, cy, item.label, { size, accent, minWidth: 200 * u, maxChars: 14 });
      const badge = el('circle', { cx: cx - box.width / 2 + 2 * u, cy: cy - box.height / 2 + 2 * u, r: 22 * u, fill: accent }, root);
      const badgeText = textBlock(root, cx - box.width / 2 + 2 * u, cy - box.height / 2 + 10 * u, String(index + 1), { size: 24 * u, weight: 800, fill: '#fff' });
      rise(tl, box.group, at, 30 * u, 0.5); pop(tl, badge, at + 0.12, 0.35); rise(tl, badgeText, at + 0.12, 0, 0.35);
      if (item.sublabel) { const sub = textBlock(root, cx, cy + box.height / 2 + 32 * u, item.sublabel, { size: 19 * u, weight: 500, fill: INK_MUTED, maxChars: 24, maxLines: 2 }); rise(tl, sub, at + 0.25, 10 * u, 0.4); }
      if (index < count - 1) {
        const arrow = portrait
          ? drawnLine(root, W / 2, cy + box.height / 2 + 12 * u, W / 2, cy + ((bottom - top - 140 * u) / Math.max(1, count - 1)) - box.height / 2 + 46 * u, accent, 5 * u)
          : drawnLine(root, cx + box.width / 2 + 10 * u, cy, cx + (W * 0.78) / (count - 1) - box.width / 2 - 10 * u, cy, accent, 5 * u);
        draw(tl, arrow, at + 0.3, Math.min(0.45, step));
      }
    });
    cursor += count * step + 0.3;
  } else if (spec.kind === 'timeline') {
    const count = Math.min(6, n);
    if (portrait) {
      const x = W * 0.24; const spine = drawnLine(root, x, top + 40 * u, x, bottom - 40 * u, accent, 5 * u);
      draw(tl, spine, cursor, 0.7); cursor += 0.3;
      items.slice(0, 6).forEach((item, index) => {
        const at = cursor + index * step;
        const y = top + 70 * u + index * ((bottom - top - 140 * u) / Math.max(1, count - 1) || 0);
        const dot = el('circle', { cx: x, cy: y, r: 14 * u, fill: accent, stroke: BG, 'stroke-width': 4 * u }, root);
        pop(tl, dot, at, 0.35);
        const label = textBlock(root, x + 34 * u, y - 4 * u, item.label, { size: 30 * u, weight: 800, fill: INK, anchor: 'start', maxChars: 20, maxLines: 1 });
        rise(tl, label, at + 0.1, 14 * u, 0.4);
        if (item.sublabel) { const sub = textBlock(root, x + 34 * u, y + 30 * u, item.sublabel, { size: 21 * u, weight: 500, fill: INK_SOFT, anchor: 'start', maxChars: 30, maxLines: 2 }); rise(tl, sub, at + 0.2, 10 * u, 0.4); }
      });
    } else {
      const y = (top + bottom) / 2; const spine = drawnLine(root, W * 0.08, y, W * 0.92, y, accent, 5 * u);
      draw(tl, spine, cursor, 0.7); cursor += 0.3;
      items.slice(0, 6).forEach((item, index) => {
        const at = cursor + index * step;
        const x = W * (count === 1 ? 0.5 : 0.11 + (0.78 * index) / (count - 1));
        const above = index % 2 === 0;
        const dot = el('circle', { cx: x, cy: y, r: 14 * u, fill: accent, stroke: BG, 'stroke-width': 4 * u }, root);
        pop(tl, dot, at, 0.35);
        const stem = drawnLine(root, x, y + (above ? -18 * u : 18 * u), x, y + (above ? -64 * u : 64 * u), PANEL_EDGE, 2.5 * u);
        draw(tl, stem, at + 0.08, 0.3);
        const label = textBlock(root, x, y + (above ? -84 * u : 104 * u), item.label, { size: 28 * u, weight: 800, fill: INK, maxChars: 14, maxLines: 1 });
        rise(tl, label, at + 0.15, above ? 10 * u : -10 * u, 0.4);
        if (item.sublabel) { const sub = textBlock(root, x, y + (above ? -124 * u : 146 * u), item.sublabel, { size: 20 * u, weight: 500, fill: INK_SOFT, maxChars: 20, maxLines: 2 }); rise(tl, sub, at + 0.24, 8 * u, 0.4); }
      });
    }
    cursor += count * step + 0.3;
  } else if (spec.kind === 'comparison') {
    const half = Math.ceil(n / 2);
    const leftItems = (spec.leftItems?.length ? spec.leftItems : items.slice(0, half).map((item) => item.label)).filter(Boolean);
    const rightItems = (spec.rightItems?.length ? spec.rightItems : items.slice(half).map((item) => item.label)).filter(Boolean);
    // Two genuinely contrasting sides: the right column gets an opposing
    // accent, so the comparison reads as A-versus-B instead of one blue card
    // repeated twice.
    const rightAccent = THEME.accentSecondary || contrastAccent(accent);
    const panels: { title: string; entries: string[]; x: number; y: number; w: number; h: number; from: number; tone: string }[] = portrait
      ? [{ title: spec.leftTitle || 'A', entries: leftItems, x: W * 0.08, y: top, w: W * 0.84, h: (bottom - top) * 0.46, from: -1, tone: accent }, { title: spec.rightTitle || 'B', entries: rightItems, x: W * 0.08, y: top + (bottom - top) * 0.54, w: W * 0.84, h: (bottom - top) * 0.46, from: 1, tone: rightAccent }]
      : [{ title: spec.leftTitle || 'A', entries: leftItems, x: W * 0.07, y: top, w: W * 0.4, h: bottom - top, from: -1, tone: accent }, { title: spec.rightTitle || 'B', entries: rightItems, x: W * 0.53, y: top, w: W * 0.4, h: bottom - top, from: 1, tone: rightAccent }];
    if (!portrait) { const divider = drawnLine(root, W / 2, top + 10 * u, W / 2, bottom - 10 * u, PANEL_EDGE, 2.5 * u, true); tl.fromTo(divider, { opacity: 0 }, { opacity: 1, duration: 0.5 }, cursor); }
    panels.forEach((panel, panelIndex) => {
      const group = el<SVGGElement>('g', {}, root);
      el('rect', { x: panel.x, y: panel.y, width: panel.w, height: panel.h, rx: 26 * u, fill: PANEL, stroke: panel.tone, 'stroke-width': 2.5 }, group);
      textBlock(group, panel.x + panel.w / 2, panel.y + 62 * u, panel.title, { size: 34 * u, weight: 800, fill: panel.tone, maxChars: 20, maxLines: 1 });
      gsap.set(group, { x: panel.from * 46 * u, opacity: 0 });
      tl.to(group, { x: 0, opacity: 1, duration: 0.6, ease: 'power3.out' }, cursor + panelIndex * 0.18);
      if (!panel.entries.length) {
        // NO EMPTY SIDES: a slot with no entries still gets deliberate visual
        // content — an animated accent emblem (halo, drawn ring, the side's
        // initial) with the panel's own title as its statement.
        const mcx = panel.x + panel.w / 2; const mcy = panel.y + panel.h * 0.52;
        const r = Math.min(panel.w, panel.h) * 0.16;
        const halo = el('circle', { cx: mcx, cy: mcy, r: r * 1.5, fill: panel.tone, opacity: 0.12 }, root);
        pop(tl, halo, cursor + 0.4 + panelIndex * 0.18, 0.5);
        const ringLen = 2 * Math.PI * r;
        const ring = el<SVGCircleElement>('circle', { cx: mcx, cy: mcy, r, fill: 'none', stroke: panel.tone, 'stroke-width': 5 * u, 'stroke-linecap': 'round', 'stroke-dasharray': ringLen, 'stroke-dashoffset': ringLen, transform: `rotate(-90 ${mcx} ${mcy})` }, root);
        tl.to(ring, { strokeDashoffset: 0, duration: 0.8, ease: 'power2.inOut' }, cursor + 0.5 + panelIndex * 0.18);
        const initial = textBlock(root, mcx, mcy + r * 0.38, (panel.title || '?').trim().charAt(0).toUpperCase(), { size: r * 1.05, weight: 900, fill: panel.tone });
        pop(tl, initial, cursor + 0.62 + panelIndex * 0.18, 0.5);
        const statement = textBlock(root, mcx, mcy + r + 58 * u, panel.title, { size: 26 * u, weight: 700, fill: INK_SOFT, maxChars: 24, maxLines: 2 });
        rise(tl, statement, cursor + 0.75 + panelIndex * 0.18, 14 * u, 0.5);
        return;
      }
      panel.entries.slice(0, 5).forEach((entry, entryIndex) => {
        const y = panel.y + 120 * u + entryIndex * 62 * u;
        const row = el<SVGGElement>('g', {}, root);
        el('circle', { cx: panel.x + 40 * u, cy: y - 8 * u, r: 7 * u, fill: panel.tone }, row);
        textBlock(row, panel.x + 64 * u, y, entry, { size: 25 * u, weight: 600, fill: INK_SOFT, anchor: 'start', maxChars: portrait ? 30 : 26, maxLines: 1 });
        rise(tl, row, cursor + 0.5 + panelIndex * 0.18 + entryIndex * Math.min(0.3, step), 16 * u, 0.45);
      });
    });
    cursor += 0.5 + Math.max(leftItems.length, rightItems.length, 2) * Math.min(0.3, step) + 0.4;
  } else if (spec.kind === 'list_reveal') {
    const count = Math.min(6, n);
    items.slice(0, 6).forEach((item, index) => {
      const at = cursor + index * step;
      const y = top + 60 * u + index * ((bottom - top - 100 * u) / Math.max(1, count - 1) || 0);
      const row = el<SVGGElement>('g', {}, root);
      const x0 = portrait ? W * 0.1 : W * 0.18;
      el('circle', { cx: x0, cy: y - 10 * u, r: 16 * u, fill: 'none', stroke: accent, 'stroke-width': 3 * u }, row);
      el('circle', { cx: x0, cy: y - 10 * u, r: 7 * u, fill: accent }, row);
      textBlock(row, x0 + 42 * u, y, item.label, { size: 32 * u, weight: 700, fill: INK, anchor: 'start', maxChars: portrait ? 26 : 42, maxLines: 1 });
      if (item.sublabel) textBlock(row, x0 + 42 * u, y + 34 * u, item.sublabel, { size: 21 * u, weight: 500, fill: INK_MUTED, anchor: 'start', maxChars: portrait ? 34 : 56, maxLines: 1 });
      gsap.set(row, { x: -30 * u, opacity: 0 });
      tl.to(row, { x: 0, opacity: 1, duration: 0.5, ease: 'power3.out' }, at);
    });
    cursor += count * step + 0.3;
  } else if (spec.kind === 'big_stat') {
    const stat = spec.stat || { value: Number(items[0]?.value) || 0, label: spec.title || items[0]?.label };
    const cy = H * 0.46;
    const value = el<SVGTextElement>('text', { x: W / 2, y: cy, 'font-family': FONT_DISPLAY, 'font-size': (portrait ? 150 : 190) * u, 'font-weight': 900, fill: INK, 'text-anchor': 'middle' }, root);
    const decimals = Math.abs(stat.value) < 10 && !Number.isInteger(stat.value) ? 1 : 0;
    const fmt = (n: number) => `${stat.prefix || ''}${n.toLocaleString('en-US', { maximumFractionDigits: decimals, minimumFractionDigits: decimals })}${stat.suffix || ''}`;
    value.textContent = fmt(0);
    const counter = { n: 0 };
    rise(tl, value, cursor, 30 * u, 0.5);
    tl.to(counter, { n: stat.value, duration: Math.min(2.2, total * 0.42), ease: 'power2.out', onUpdate: () => { value.textContent = fmt(counter.n); } }, cursor + 0.15);
    const underline = el('rect', { x: W / 2 - 130 * u, y: cy + 44 * u, width: 260 * u, height: 8 * u, rx: 4 * u, fill: accent }, root);
    pop(tl, underline, cursor + 0.4, 0.45);
    if (stat.label || spec.subtitle) { const label = textBlock(root, W / 2, cy + 128 * u, stat.label || spec.subtitle || '', { size: 36 * u, weight: 600, fill: INK_SOFT, maxChars: portrait ? 28 : 48, maxLines: 2 }); rise(tl, label, cursor + 0.55, 20 * u, 0.5); }
    cursor += 1.4;
  } else if (spec.kind === 'bar_chart') {
    const count = Math.min(6, n);
    const max = Math.max(...items.map((item) => Math.abs(Number(item.value) || 0)), 1);
    const chartTop = top + 30 * u; const chartBottom = bottom - 70 * u;
    const span = portrait ? W * 0.84 : W * 0.72;
    const x0 = (W - span) / 2;
    const slot = span / count; const barW = Math.min(120 * u, slot * 0.52);
    const base = drawnLine(root, x0 - 10 * u, chartBottom, x0 + span + 10 * u, chartBottom, THEME.paper ? INK : PANEL_EDGE, 3 * u);
    draw(tl, base, cursor, 0.5); cursor += 0.25;
    // Colour means "look here": in the paper theme only the ANSWER bar (the
    // largest value) carries the accent; every other bar stays neutral gray.
    const answerIndex = THEME.paper ? items.slice(0, 6).reduce((best, item, index, all) => (Math.abs(Number(item.value) || 0) > Math.abs(Number(all[best]?.value) || 0) ? index : best), 0) : 0;
    items.slice(0, 6).forEach((item, index) => {
      const at = cursor + index * step;
      const value = Math.abs(Number(item.value) || 0);
      const h = Math.max(10 * u, ((chartBottom - chartTop) * value) / max);
      const x = x0 + slot * index + (slot - barW) / 2;
      const bar = el('rect', { x, y: chartBottom - h, width: barW, height: h, rx: THEME.paper ? 2 * u : 10 * u, fill: index === answerIndex ? accent : NEUTRAL, stroke: index === answerIndex ? accent : PANEL_EDGE, 'stroke-width': 2 }, root);
      gsap.set(bar, { transformOrigin: '50% 100%', scaleY: 0 });
      tl.to(bar, { scaleY: 1, duration: 0.6, ease: 'power3.out' }, at);
      const valueText = el<SVGTextElement>('text', { x: x + barW / 2, y: chartBottom - h - 16 * u, 'font-family': FONT, 'font-size': 27 * u, 'font-weight': 800, fill: INK, 'text-anchor': 'middle' }, root);
      valueText.textContent = '0';
      const counter = { n: 0 };
      const decimals = Number.isInteger(value) ? 0 : 1;
      tl.to(counter, { n: value, duration: 0.6, ease: 'power2.out', onUpdate: () => { valueText.textContent = counter.n.toLocaleString('en-US', { maximumFractionDigits: decimals }); } }, at + 0.05);
      tl.fromTo(valueText, { opacity: 0 }, { opacity: 1, duration: 0.3 }, at + 0.1);
      const label = textBlock(root, x + barW / 2, chartBottom + 40 * u, item.label, { size: 22 * u, weight: 600, fill: INK_SOFT, maxChars: 12, maxLines: 2 });
      rise(tl, label, at + 0.15, 10 * u, 0.4);
    });
    cursor += count * step + 0.3;
  } else if (spec.kind === 'node_graph') {
    const count = Math.min(7, n);
    const mapItems = items.slice(0, 7);
    const drewUSMap = renderUSStateMap({
      parent: root,
      timeline: tl,
      rect: { x: W * 0.06, y: top, w: W * 0.88, h: bottom - top },
      items: mapItems,
      accent,
      unit: u,
      at: cursor,
      step,
    });
    if (drewUSMap) {
      cursor += count * step + 0.45;
    } else {
      const cx = W / 2; const cy = (top + bottom) / 2;
      const rx = portrait ? W * 0.34 : W * 0.3; const ry = (bottom - top) * 0.38;
      const positions = mapItems.map((_, index) => { const angle = -Math.PI / 2 + (2 * Math.PI * index) / count; return { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) }; });
      const hub = spec.root ? nodeBox(root, cx, cy, spec.root, { size: 32 * u, accent, filled: true, minWidth: 220 * u }) : null;
      positions.forEach((pos, index) => {
        const at = cursor + index * step;
        const from = hub ? { x: cx, y: cy } : positions[(index + count - 1) % count];
        const edge = drawnLine(root, from.x, from.y, pos.x, pos.y, EDGE_SOFT, 3 * u);
        draw(tl, edge, at, Math.min(0.5, step + 0.2));
        const node = nodeBox(root, pos.x, pos.y, mapItems[index].label, { size: 26 * u, accent, minWidth: 150 * u, maxChars: 12 });
        pop(tl, node.group, at + 0.18, 0.45);
        if (mapItems[index].imageUrl) { const chip = nodeImageChip(root, defs, pos.x, pos.y - node.height / 2 - 40 * u, 34 * u, String(mapItems[index].imageUrl), accent); pop(tl, chip, at + 0.28, 0.45); }
      });
      if (hub) { pop(tl, hub.group, cursor + 0.1, 0.5); }
      cursor += count * step + 0.4;
    }
  } else if (spec.kind === 'annotated_image') {
    const frameX = portrait ? W * 0.06 : W * 0.1; const frameW = W - frameX * 2;
    const frameY = top; const frameH = bottom - top;
    // Paper theme: the annotated picture is a torn-edge CUTOUT seated with
    // the two-shadow stack (shadow on the OUTER group — filter-then-clip on
    // one element would clip the shadow away) and desaturated into the palette.
    let clipId: string;
    let cutoutHost: SVGElement = root;
    if (THEME.paper) {
      clipId = tornClipPath(defs, { x: frameX, y: frameY, w: frameW, h: frameH }, Math.round(frameX * 7 + frameY * 13 + frameW));
      cutoutHost = el<SVGGElement>('g', { filter: `url(#${paperShadowFilter(defs)})` }, root);
    } else {
      clipId = `mgClip${Math.floor(Math.random() * 1e9)}`;
      const clip = el('clipPath', { id: clipId }, defs);
      el('rect', { x: frameX, y: frameY, width: frameW, height: frameH, rx: 28 * u }, clip);
    }
    const imageGroup = el<SVGGElement>('g', { 'clip-path': `url(#${clipId})` }, cutoutHost);
    if (spec.imageUrl) {
      const image = el('image', { x: frameX, y: frameY, width: frameW, height: frameH, href: spec.imageUrl, preserveAspectRatio: 'xMidYMid slice' }, imageGroup);
      image.setAttributeNS('http://www.w3.org/1999/xlink', 'href', spec.imageUrl);
      if (THEME.paper) image.setAttribute('filter', `url(#${desatFilter(defs, 0.3)})`);
      gsap.set(image, { transformOrigin: '50% 50%', scale: 1.04 });
      tl.to(image, { scale: 1.14, x: -frameW * 0.015, duration: total, ease: 'none' }, 0);
    } else if (THEME.paper) {
      // No picture: a halftone accent block — the signature newsprint cutout.
      el('rect', { x: frameX, y: frameY, width: frameW, height: frameH, fill: `url(#${halftonePattern(defs, accent)})` }, imageGroup);
    } else {
      // No backdrop image reached the capture — draw a deliberate branded
      // backdrop (accent glow + concentric rings) instead of a flat gray
      // rectangle, so the frame never reads as a broken placeholder.
      el('rect', { x: frameX, y: frameY, width: frameW, height: frameH, fill: PANEL }, imageGroup);
      const frameGradId = `mgFrame${Math.floor(Math.random() * 1e9)}`;
      const frameGrad = el('radialGradient', { id: frameGradId, cx: '30%', cy: '25%', r: '95%' }, defs);
      el('stop', { offset: '0%', 'stop-color': accent, 'stop-opacity': 0.3 }, frameGrad);
      el('stop', { offset: '100%', 'stop-color': accent, 'stop-opacity': 0.02 }, frameGrad);
      el('rect', { x: frameX, y: frameY, width: frameW, height: frameH, fill: `url(#${frameGradId})` }, imageGroup);
      for (let ringIndex = 0; ringIndex < 3; ringIndex += 1) {
        el('circle', { cx: frameX + frameW * 0.72, cy: frameY + frameH * 0.36, r: frameH * (0.14 + ringIndex * 0.11), fill: 'none', stroke: accent, 'stroke-width': 2.5 * u, opacity: 0.26 - ringIndex * 0.07 }, imageGroup);
      }
    }
    if (!THEME.paper) el('rect', { x: frameX, y: frameY, width: frameW, height: frameH, rx: 28 * u, fill: 'none', stroke: PANEL_EDGE, 'stroke-width': 2.5 }, root);
    el('rect', { x: frameX, y: frameY + frameH * 0.55, width: frameW, height: frameH * 0.45, fill: 'rgba(5,8,18,0.0)' }, root);
    items.slice(0, 4).forEach((item, index) => {
      const at = cursor + 0.3 + index * step;
      const anchorX = frameX + frameW * (0.2 + 0.6 * ((index % 3) / 2));
      const anchorY = frameY + frameH * (0.28 + 0.38 * (index % 2));
      const dot = el('circle', { cx: anchorX, cy: anchorY, r: 12 * u, fill: THEME.paper ? INK : accent, stroke: THEME.paper ? BG : '#fff', 'stroke-width': 3 * u }, root);
      pop(tl, dot, at, 0.35);
      const labelY = frameY + frameH - 46 * u - index * 58 * u;
      const leader = drawnLine(root, anchorX, anchorY, frameX + 56 * u, labelY - 10 * u, THEME.paper ? EDGE_SOFT : 'rgba(248,250,252,0.65)', 2.5 * u);
      draw(tl, leader, at + 0.1, 0.4);
      const pill = el<SVGGElement>('g', {}, root);
      const label = item.label;
      const pillW = Math.min(frameW * 0.8, label.length * 15 * u + 60 * u);
      el('rect', { x: frameX + 30 * u, y: labelY - 34 * u, width: pillW, height: 48 * u, rx: THEME.paper ? 4 * u : 24 * u, fill: PANEL_GLASS, stroke: THEME.paper ? INK : accent, 'stroke-width': 2 }, pill);
      textBlock(pill, frameX + 30 * u + pillW / 2, labelY - 2 * u, label, { size: 24 * u, weight: 700, fill: INK, maxChars: 40, maxLines: 1 });
      rise(tl, pill, at + 0.2, 14 * u, 0.4);
    });
    cursor += 0.3 + Math.min(4, n) * step + 0.4;
  } else {
    // text_reveal — pure animated typography.
    const headline = spec.title || items[0]?.label || '';
    const lines = wrapLines(headline, portrait ? 16 : 24, 3);
    const size = (portrait ? 72 : 92) * u;
    const blockH = lines.length * size * 1.18;
    const startY = H * 0.46 - blockH / 2 + size * 0.8;
    if (THEME.paper) {
      // THE HIGHLIGHTER: a solid accent bar sweeps in BEHIND the last line,
      // landing ~120ms after the words settle — punctuation, one per scene.
      const lastLine = lines[lines.length - 1] || '';
      const lineY = startY + (lines.length - 1) * size * 1.18;
      const hlW = Math.max(size, lastLine.length * size * 0.62) + 24 * u;
      const hl = el('rect', { x: W / 2 - hlW / 2, y: lineY - size * 0.82, width: hlW, height: size * 1.02, fill: accent }, root);
      gsap.set(hl, { transformOrigin: '0% 50%', scaleX: 0 });
      tl.to(hl, { scaleX: 1, duration: 0.26, ease: 'power3.out' }, cursor + 0.77 + (lines.length - 1) * 0.16);
    } else {
      const bar = el('rect', { x: W / 2 - 44 * u, y: startY - size * 1.5, width: 88 * u, height: 8 * u, rx: 4 * u, fill: accent }, root);
      pop(tl, bar, cursor, 0.45);
    }
    lines.forEach((line, index) => {
      const lineText = el<SVGTextElement>('text', { x: W / 2, y: startY + index * size * 1.18, 'font-family': FONT_DISPLAY, 'font-size': size, 'font-weight': 900, fill: INK, 'text-anchor': 'middle', 'letter-spacing': '-0.01em' }, root);
      lineText.textContent = line;
      rise(tl, lineText, cursor + 0.15 + index * 0.16, 44 * u, 0.7);
    });
    if (spec.subtitle) {
      const sub = textBlock(root, W / 2, startY + lines.length * size * 1.18 + 40 * u, spec.subtitle, { size: 30 * u, weight: 500, fill: INK_SOFT, maxChars: portrait ? 32 : 58, maxLines: 2 });
      rise(tl, sub, cursor + 0.3 + lines.length * 0.16, 24 * u, 0.6);
    }
    cursor += 0.4 + lines.length * 0.16 + 0.6;
  }
  } // end classic kind renderers

  // Fit the reveal inside the scene window, hold, then fade for a clean cut.
  const naturalEnd = Math.max(tl.duration(), cursor);
  const revealBudget = Math.max(1.2, total - 0.6);
  if (naturalEnd > revealBudget) tl.timeScale(naturalEnd / revealBudget);
  const scaledEnd = Math.min(naturalEnd / (tl.timeScale() || 1), revealBudget);
  tl.to(root, { y: -6 * u, duration: Math.max(0.4, (total - 0.45) - scaledEnd) * (tl.timeScale() || 1), ease: 'sine.inOut' }, naturalEnd);
  tl.to(root, { opacity: 0, duration: 0.4 * (tl.timeScale() || 1), ease: 'power1.in' }, total * (tl.timeScale() || 1) - 0.42 * (tl.timeScale() || 1));

  // Paper theme: ONE newsprint grain overlay for the whole frame, above the
  // content (never per-asset) — the handmade texture that sells the paper.
  if (THEME.paper && !transparent) grainOverlay(svg, defs, W, H);

  return { svg, timeline: tl, durationSec: total };
}

/** Live in-browser preview of a motion-graphic scene spec (loops). With
 * `transparent`, the graphic renders on an alpha background (plus its glass
 * legibility panel) and fills its container — the "preview on video" mode
 * positions it over the real avatar footage exactly as assembly will. */
export default function MotionGraphicPlayer({ spec, aspect = '16:9', durationSec, className, transparent, tileWidth, tileHeight, unitScale, directed, styleId }: { spec: MotionSpec | Record<string, unknown>; aspect?: '16:9' | '9:16'; durationSec?: number; className?: string; transparent?: boolean; tileWidth?: number; tileHeight?: number; unitScale?: number; directed?: SceneDirection | Record<string, unknown> | null; styleId?: string | null }) {
  const host = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const mount = host.current;
    if (!mount) return undefined;
    const portrait = aspect === '9:16';
    const W = Number(tileWidth) > 0 ? Number(tileWidth) : (portrait ? 1080 : 1920);
    const H = Number(tileHeight) > 0 ? Number(tileHeight) : (portrait ? 1920 : 1080);
    const built = buildMotionGraphic(spec, W, H, durationSec, transparent ? { transparent: true, panel: true, unitScale, directed, styleId } : { directed, styleId });
    built.svg.removeAttribute('width'); built.svg.removeAttribute('height');
    built.svg.style.width = '100%'; built.svg.style.height = '100%'; built.svg.style.display = 'block';
    mount.innerHTML = '';
    mount.appendChild(built.svg);
    built.timeline.repeat(-1).repeatDelay(0.8).play(0);
    return () => { built.timeline.kill(); mount.innerHTML = ''; };
  }, [JSON.stringify(spec), JSON.stringify(directed || null), aspect, durationSec, transparent, tileWidth, tileHeight, unitScale, styleId]);
  const fills = Boolean(transparent || (Number(tileWidth) > 0 && Number(tileHeight) > 0));
  return <div ref={host} className={className} style={fills ? { width: '100%', height: '100%' } : { aspectRatio: aspect === '9:16' ? '9 / 16' : '16 / 9' }} />;
}
