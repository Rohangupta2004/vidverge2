// ELEMENT COMPOSITION — the After-Effects-style structured composition model.
// This is the fundamental unit of SceneForge motion graphics:
//
//   visual concept → element decomposition → individual assets → spatial
//   composition → layer hierarchy → timed animation (keyframes) → element
//   interactions → Remotion frame-by-frame composition → final video.
//
// The AI Director (agents/motionDirector.composeElements) DESIGNS the scene as
// elements; Remotion ANIMATES it. Every element carries independent position,
// scale, rotation, opacity, timing, z-order, anchor point, entrance, exit and
// optional property KEYFRAMES; elements can be parented (a laptop's screen
// moves with the laptop) and can point at each other (arrows, highlights).
//
// ONE interpretation, three consumers — KEEP THEM IN SYNC:
//   * elementStateAt / resolveElementStates below (the authoritative math),
//   * components/ElementCompositionView (browser preview — imports this file),
//   * the elemState/ElementLayers code embedded in the generated Remotion
//     source (remotion/AssemblyComp.createAssemblySource) — plain JS mirror.
//
// The composition NEVER invents content: it is composed FROM the scene's
// MotionSpec (exact strings and numbers) and carries spec_fingerprint, so an
// edited spec always recomposes instead of reusing a stale design.

import type { Scene } from './supabase';
import { accentForSpec, contrastAccent, motionFingerprint, type MotionSpec } from './motionSpec';
import { sceneMotionSpec } from './motionScene';

export type ElementKind = 'image' | 'text' | 'stat' | 'card' | 'pill' | 'arrow' | 'line' | 'underline' | 'highlight' | 'chart' | 'progress';
export type ElementAnchor = 'center' | 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right' | 'top' | 'bottom' | 'left' | 'right';
export type ElementEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'spring';
export type EnterStyle = 'fade' | 'slide_up' | 'slide_down' | 'slide_left' | 'slide_right' | 'scale_in' | 'spring_in' | 'mask_reveal' | 'wipe' | 'draw' | 'blur_in' | 'pop' | 'countup' | 'none';
export type ExitStyle = 'fade' | 'slide_up' | 'slide_down' | 'scale_out' | 'drift' | 'none';
export type ElementTextVariant = 'headline' | 'subhead' | 'label' | 'stat' | 'caption';

export interface ElementKeyframe {
  /** Seconds from the SCENE window start. Values are ABSOLUTE property values. */
  at: number;
  x?: number; y?: number; scale?: number; rotation?: number; opacity?: number;
  /** Easing INTO this keyframe (from the previous one). */
  easing?: ElementEasing;
}

export interface CompositionElement {
  id: string;
  kind: ElementKind;
  /** Anchor-point position, normalized to the frame (0–1). */
  x: number; y: number;
  /** Width as a fraction of frame width; height optional (fraction of frame height). */
  w: number; h?: number;
  z: number;
  /** 0 = foreground (moves most), 1 = background (barely moves). */
  depth_z?: number;
  /** Visibility window, seconds from scene start. */
  start: number; end: number;
  anchor: ElementAnchor;
  /** Parent element id — this element rides the parent's motion and opacity. */
  parent?: string;
  rotation?: number; scale?: number; opacity?: number;
  enter: { style: EnterStyle; duration: number; from?: 'left' | 'right' | 'top' | 'bottom' };
  exit: { style: ExitStyle; duration: number };
  easing?: ElementEasing;
  keyframes?: ElementKeyframe[];
  /** image: the generated/reused asset. */
  asset_url?: string;
  /** image: the Director's brief for a NEW isolated element asset (subject on a plain deep-navy #0A0F1E backdrop, no text). */
  asset_brief?: string;
  fit?: 'cover' | 'contain';
  text?: string; subtext?: string;
  variant?: ElementTextVariant;
  accent?: string;
  /** arrow / line: target point, normalized. */
  tx?: number; ty?: number;
  /** chart / progress: labeled values (exact numbers from the spec). */
  items?: { label: string; value?: number }[];
  /** stat: exact number (counts up on entrance style 'countup'). */
  value?: number; prefix?: string; suffix?: string;
  /** card / pill background + corner radius (px at 1080p). */
  bg?: string; radius?: number;
  /** The viewer's current focus — exactly one visible element should carry it. */
  focus?: boolean;
  purpose?: string;
}

export interface CompositionCamera { move: 'none' | 'push_in' | 'pull_back' | 'drift_left' | 'drift_right'; intensity?: number }

export interface ElementComposition {
  version: 1;
  /** 'single_visual' = one asset is genuinely enough (the classic still/clip path renders it); 'multi_element' = this composition drives the scene. */
  type: 'multi_element' | 'single_visual';
  duration: number;
  /** CSS background for fullscreen scenes (transparent when riding the presenter). */
  background?: string;
  /** Optional dimmed contextual backdrop image behind the elements. */
  backdrop_url?: string;
  camera?: CompositionCamera;
  elements: CompositionElement[];
  spec_fingerprint?: string;
}

/** The controlled motion-primitive vocabulary the Director combines (documented for the prompt). */
export const ENTER_STYLES: EnterStyle[] = ['fade', 'slide_up', 'slide_down', 'slide_left', 'slide_right', 'scale_in', 'spring_in', 'mask_reveal', 'wipe', 'draw', 'blur_in', 'pop', 'countup', 'none'];
export const EXIT_STYLES: ExitStyle[] = ['fade', 'slide_up', 'slide_down', 'scale_out', 'drift', 'none'];
const KINDS: ElementKind[] = ['image', 'text', 'stat', 'card', 'pill', 'arrow', 'line', 'underline', 'highlight', 'chart', 'progress'];
const ANCHORS: ElementAnchor[] = ['center', 'top_left', 'top_right', 'bottom_left', 'bottom_right', 'top', 'bottom', 'left', 'right'];
const EASINGS: ElementEasing[] = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'spring'];
const VARIANTS: ElementTextVariant[] = ['headline', 'subhead', 'label', 'stat', 'caption'];

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const num = (v: unknown): number | undefined => { const n = Number(v); return Number.isFinite(n) ? n : undefined; };
const str = (v: unknown, max = 240) => String(v == null ? '' : v).trim().slice(0, max);

// ---------------------------------------------------------------------------
// Easing — KEEP IN SYNC with elemEase in the generated Remotion source.
// ---------------------------------------------------------------------------

export function elementEase(t: number, kind?: ElementEasing | string): number {
  t = clamp(t, 0, 1);
  if (kind === 'linear') return t;
  if (kind === 'ease-in') return t * t;
  if (kind === 'ease-in-out') return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  if (kind === 'spring') { const c1 = 1.70158; const c3 = c1 + 1; const u = t - 1; return 1 + c3 * u * u * u + c1 * u * u; }
  // default ease-out — editorial, intentional, never robotic-linear
  return 1 - (1 - t) * (1 - t);
}

// ---------------------------------------------------------------------------
// Per-frame element state — the authoritative interpretation.
// KEEP IN SYNC with elemState in the generated Remotion source.
// ---------------------------------------------------------------------------

export interface ElementFrameState {
  visible: boolean;
  x: number; y: number;          // normalized anchor position after keyframes + parenting
  scale: number; rotation: number; opacity: number;
  /** 0–1 draw progress (arrow/line/underline/highlight sweep/chart build). */
  draw: number;
  /** 0–1 countup progress for stats. */
  count: number;
  /** CSS clip-path (mask_reveal / wipe) or empty. */
  clipPath: string;
  /** blur px (blur_in). */
  blur: number;
}

function trackValue(el: CompositionElement, prop: 'x' | 'y' | 'scale' | 'rotation' | 'opacity', t: number, base: number): number {
  const kfs = (el.keyframes || []).filter((k) => num((k as any)[prop]) !== undefined).sort((a, b) => a.at - b.at);
  if (!kfs.length) return base;
  let prevAt = el.start; let prevVal = base;
  for (const kf of kfs) {
    const val = Number((kf as any)[prop]);
    if (t <= kf.at) {
      const span = Math.max(0.001, kf.at - prevAt);
      const p = elementEase((t - prevAt) / span, kf.easing || el.easing || 'ease-in-out');
      return prevVal + (val - prevVal) * p;
    }
    prevAt = kf.at; prevVal = val;
  }
  return prevVal;
}

export function elementStateAt(el: CompositionElement, t: number): ElementFrameState {
  const hidden: ElementFrameState = { visible: false, x: el.x, y: el.y, scale: 1, rotation: 0, opacity: 0, draw: 0, count: 0, clipPath: '', blur: 0 };
  if (t < el.start || t >= el.end) return hidden;
  const state: ElementFrameState = {
    visible: true,
    x: trackValue(el, 'x', t, el.x),
    y: trackValue(el, 'y', t, el.y),
    scale: trackValue(el, 'scale', t, el.scale ?? 1),
    rotation: trackValue(el, 'rotation', t, el.rotation ?? 0),
    opacity: trackValue(el, 'opacity', t, el.opacity ?? 1),
    draw: 1, count: 1, clipPath: '', blur: 0,
  };
  // ENTRANCE — a controlled primitive, never a bare pop into existence.
  const inDur = Math.max(0.15, el.enter?.duration || 0.5);
  const p = clamp((t - el.start) / inDur, 0, 1);
  const eIn = elementEase(p, el.easing || 'ease-out');
  const style = el.enter?.style || 'fade';
  const off = 0.06 * (1 - eIn);
  if (style === 'fade') state.opacity *= eIn;
  else if (style === 'slide_up') { state.opacity *= eIn; state.y += off; }
  else if (style === 'slide_down') { state.opacity *= eIn; state.y -= off; }
  else if (style === 'slide_left') { state.opacity *= eIn; state.x += off; }
  else if (style === 'slide_right') { state.opacity *= eIn; state.x -= off; }
  else if (style === 'scale_in') { state.opacity *= eIn; state.scale *= 0.82 + 0.18 * eIn; }
  else if (style === 'spring_in') { state.opacity *= Math.min(1, p * 2.5); state.scale *= 0.7 + 0.3 * elementEase(p, 'spring'); }
  else if (style === 'pop') { state.opacity *= Math.min(1, p * 3); state.scale *= 0.72 + 0.28 * eIn + 0.05 * Math.sin(eIn * Math.PI); }
  else if (style === 'mask_reveal') { state.clipPath = `inset(0% 0% ${(1 - eIn) * 100}% 0%)`; state.opacity *= Math.min(1, p * 2); }
  else if (style === 'wipe') {
    const ins = (1 - eIn) * 100; const from = el.enter?.from || 'left';
    state.clipPath = from === 'right' ? `inset(0% 0% 0% ${ins}%)` : from === 'top' ? `inset(0% 0% ${ins}% 0%)` : from === 'bottom' ? `inset(${ins}% 0% 0% 0%)` : `inset(0% ${ins}% 0% 0%)`;
    state.opacity *= Math.min(1, p * 2);
  }
  else if (style === 'draw') { state.draw = eIn; state.opacity *= Math.min(1, p * 3); }
  else if (style === 'blur_in') { state.blur = 10 * (1 - eIn); state.opacity *= eIn; }
  else if (style === 'countup') { state.count = eIn; state.opacity *= Math.min(1, p * 3); }
  // Chart bars keep building past the entrance window for legibility.
  if (el.kind === 'chart' || el.kind === 'progress') state.draw = Math.min(state.draw, elementEase(clamp((t - el.start) / Math.max(0.8, inDur * 2), 0, 1), 'ease-in-out'));
  // EXIT
  const outDur = Math.max(0.12, el.exit?.duration || 0.35);
  const q = clamp((el.end - t) / outDur, 0, 1);
  const eOut = elementEase(q, 'ease-out');
  const xs = el.exit?.style || 'fade';
  if (xs === 'fade') state.opacity *= eOut;
  else if (xs === 'slide_up') { state.opacity *= eOut; state.y -= 0.05 * (1 - eOut); }
  else if (xs === 'slide_down') { state.opacity *= eOut; state.y += 0.05 * (1 - eOut); }
  else if (xs === 'scale_out') { state.opacity *= eOut; state.scale *= 0.85 + 0.15 * eOut; }
  else if (xs === 'drift') { state.opacity *= eOut; state.y -= 0.03 * (1 - eOut); state.scale *= 1 + 0.04 * (1 - eOut); }
  return state;
}

/**
 * Resolve every element's state at time t WITH parent/child transforms:
 * a child rides its parent's motion (translation delta, scale ratio) and
 * fades with it. Depth is capped so a bad parent loop cannot hang a frame.
 */
export function resolveElementStates(elements: CompositionElement[], t: number): Map<string, ElementFrameState> {
  const byId = new Map(elements.map((el) => [el.id, el] as const));
  const own = new Map(elements.map((el) => [el.id, elementStateAt(el, t)] as const));
  const out = new Map<string, ElementFrameState>();
  elements.forEach((el) => {
    const state = { ...(own.get(el.id) as ElementFrameState) };
    let parentId = el.parent; let depth = 0;
    while (parentId && depth < 4) {
      const parent = byId.get(parentId);
      if (!parent) break;
      const ps = own.get(parent.id) as ElementFrameState;
      state.x += ps.x - parent.x;
      state.y += ps.y - parent.y;
      const baseScale = parent.scale ?? 1;
      if (baseScale > 0) state.scale *= ps.scale / baseScale;
      state.opacity *= ps.visible ? ps.opacity : 0;
      if (!ps.visible) state.visible = false;
      parentId = parent.parent; depth += 1;
    }
    out.set(el.id, state);
  });
  return out;
}

/** Subtle global camera — always SECONDARY to element motion, never a zoom substitute. */
export function cameraStateAt(
  camera: CompositionCamera | undefined,
  t: number,
  duration: number,
  depthZ = 0.5,
): { scale: number; x: number; y: number; depth_z: number } {
  const depth = clamp(depthZ, 0, 1);
  if (!camera || camera.move === 'none') return { scale: 1, x: 0, y: 0, depth_z: depth };
  const k = clamp(camera.intensity ?? 1, 0.25, 1.5);
  const p = elementEase(duration > 0 ? t / duration : 1, 'ease-in-out');
  // Foreground travels at full camera speed; the deepest plane deliberately
  // retains 20% so it never looks pinned while the foreground moves.
  const speed = 0.2 + 0.8 * (1 - depth);
  if (camera.move === 'push_in') {
    const scale = 1 + 0.08 * speed * k * p;
    return { scale, x: 0, y: 0, depth_z: depth };
  }
  if (camera.move === 'pull_back') {
    const scale = 1 + 0.08 * speed * k * (1 - p);
    return { scale, x: 0, y: 0, depth_z: depth };
  }
  if (camera.move === 'drift_left') {
    const x = -0.04 * speed * k * (p - 0.5) * 2;
    return { scale: 1 + 0.02 * speed * k, x, y: 0, depth_z: depth };
  }
  if (camera.move === 'drift_right') {
    const x = 0.04 * speed * k * (p - 0.5) * 2;
    return { scale: 1 + 0.02 * speed * k, x, y: 0, depth_z: depth };
  }
  return { scale: 1 + 0.03 * k, x: 1.2 * k * (p - 0.5) * 2, y: 0, depth_z: depth };
}

/** transform-origin CSS for an anchor — scaling a pen around its tip, a card around its edge. */
export function anchorOrigin(anchor: ElementAnchor): string {
  if (anchor === 'top_left') return '0% 0%';
  if (anchor === 'top_right') return '100% 0%';
  if (anchor === 'bottom_left') return '0% 100%';
  if (anchor === 'bottom_right') return '100% 100%';
  if (anchor === 'top') return '50% 0%';
  if (anchor === 'bottom') return '50% 100%';
  if (anchor === 'left') return '0% 50%';
  if (anchor === 'right') return '100% 50%';
  return '50% 50%';
}

// ---------------------------------------------------------------------------
// Normalization — coerce whatever the Director (or a stored row) returned.
// ---------------------------------------------------------------------------

function normalizeElement(raw: any, index: number): CompositionElement | null {
  if (!raw || typeof raw !== 'object') return null;
  const kind = KINDS.includes(raw.kind) ? raw.kind as ElementKind : null;
  if (!kind) return null;
  const el: CompositionElement = {
    id: str(raw.id, 40) || `el_${index + 1}`,
    kind,
    x: clamp(num(raw.x) ?? 0.5, -0.3, 1.3),
    y: clamp(num(raw.y) ?? 0.5, -0.3, 1.3),
    w: clamp(num(raw.w) ?? 0.3, 0.01, 1.6),
    z: Math.round(clamp(num(raw.z) ?? index + 1, 0, 40)),
    start: Math.max(0, num(raw.start) ?? 0),
    end: Math.max(0.2, num(raw.end) ?? 6),
    anchor: ANCHORS.includes(raw.anchor) ? raw.anchor : 'center',
    enter: {
      style: ENTER_STYLES.includes(raw.enter?.style) ? raw.enter.style : (kind === 'arrow' || kind === 'line' || kind === 'underline' ? 'draw' : kind === 'stat' ? 'countup' : 'slide_up'),
      duration: clamp(num(raw.enter?.duration) ?? 0.5, 0.15, 2.5),
      ...(['left', 'right', 'top', 'bottom'].includes(raw.enter?.from) ? { from: raw.enter.from } : {}),
    },
    exit: {
      style: EXIT_STYLES.includes(raw.exit?.style) ? raw.exit.style : 'fade',
      duration: clamp(num(raw.exit?.duration) ?? 0.35, 0.12, 1.5),
    },
  };
  const h = num(raw.h); if (h !== undefined) el.h = clamp(h, 0.01, 1.6);
  const rot = num(raw.rotation); if (rot) el.rotation = clamp(rot, -180, 180);
  const sc = num(raw.scale); if (sc !== undefined) el.scale = clamp(sc, 0.05, 4);
  const dz = num(raw.depth_z ?? raw.depthZ); if (dz !== undefined) el.depth_z = clamp(dz, 0, 1);
  const op = num(raw.opacity); if (op !== undefined) el.opacity = clamp(op, 0, 1);
  if (EASINGS.includes(raw.easing)) el.easing = raw.easing;
  if (raw.parent) el.parent = str(raw.parent, 40);
  const asset = str(raw.asset_url ?? raw.assetUrl ?? '', 600);
  if (/^(https?:|data:image)/i.test(asset)) el.asset_url = asset;
  const brief = str(raw.asset_brief ?? raw.assetBrief ?? '', 900);
  if (brief) el.asset_brief = brief;
  if (raw.fit === 'cover' || raw.fit === 'contain') el.fit = raw.fit;
  const text = str(raw.text ?? raw.label ?? '', 200); if (text) el.text = text;
  const subtext = str(raw.subtext ?? '', 260); if (subtext) el.subtext = subtext;
  if (VARIANTS.includes(raw.variant)) el.variant = raw.variant;
  const accent = str(raw.accent ?? '', 16); if (/^#[0-9a-fA-F]{3,8}$/.test(accent)) el.accent = accent;
  const tx = num(raw.tx); const ty = num(raw.ty);
  if (tx !== undefined) el.tx = clamp(tx, -0.3, 1.3);
  if (ty !== undefined) el.ty = clamp(ty, -0.3, 1.3);
  if (Array.isArray(raw.items)) {
    el.items = raw.items.slice(0, 8).map((item: any) => {
      const label = str(typeof item === 'object' && item ? item.label ?? item.text ?? '' : item, 80);
      if (!label) return null;
      const value = num(typeof item === 'object' && item ? item.value : undefined);
      return { label, ...(value !== undefined ? { value } : {}) };
    }).filter(Boolean) as { label: string; value?: number }[];
    if (!el.items.length) delete el.items;
  }
  const value = num(raw.value); if (value !== undefined) el.value = value;
  if (raw.prefix) el.prefix = str(raw.prefix, 12);
  if (raw.suffix) el.suffix = str(raw.suffix, 16);
  if (raw.bg) el.bg = str(raw.bg, 60);
  const radius = num(raw.radius); if (radius !== undefined) el.radius = clamp(radius, 0, 200);
  if (raw.focus === true) el.focus = true;
  if (raw.purpose) el.purpose = str(raw.purpose, 300);
  if (Array.isArray(raw.keyframes)) {
    el.keyframes = raw.keyframes.slice(0, 12).map((kf: any) => {
      const at = num(kf?.at); if (at === undefined) return null;
      const entry: ElementKeyframe = { at: Math.max(0, at) };
      (['x', 'y', 'scale', 'rotation', 'opacity'] as const).forEach((prop) => { const v = num(kf[prop]); if (v !== undefined) (entry as any)[prop] = v; });
      if (EASINGS.includes(kf.easing)) entry.easing = kf.easing;
      return Object.keys(entry).length > 1 ? entry : null;
    }).filter(Boolean).sort((a: any, b: any) => a.at - b.at) as ElementKeyframe[];
    if (!el.keyframes.length) delete el.keyframes;
  }
  // Content requirement per kind.
  if (kind === 'image' && !el.asset_url && !el.asset_brief) return null;
  if ((kind === 'text' || kind === 'pill') && !el.text) return null;
  if (kind === 'stat' && el.value === undefined && !el.text) return null;
  if ((kind === 'chart' || kind === 'progress') && !el.items?.length) return null;
  return el;
}

export function normalizeElementComposition(raw: unknown): ElementComposition | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = (raw as any).composition && typeof (raw as any).composition === 'object' ? (raw as any).composition : raw as any;
  const elements = (Array.isArray(source.elements) ? source.elements : (Array.isArray(source.layers) ? source.layers : []))
    .slice(0, 16)
    .map((entry: any, index: number) => normalizeElement(entry, index))
    .filter(Boolean) as CompositionElement[];
  if (!elements.length) return null;
  const duration = clamp(num(source.duration) ?? 6, 1, 30);
  elements.forEach((el) => { el.end = Math.min(el.end, duration); if (el.end <= el.start) el.end = Math.min(duration, el.start + 1); });
  const comp: ElementComposition = {
    version: 1,
    type: source.type === 'single_visual' ? 'single_visual' : 'multi_element',
    duration,
    elements,
  };
  const bg = str(source.background ?? '', 120); if (bg) comp.background = bg;
  const backdrop = str(source.backdrop_url ?? source.backdropUrl ?? '', 600);
  if (/^https?:/i.test(backdrop)) comp.backdrop_url = backdrop;
  const move = String(source.camera?.move || '');
  if (['none', 'push_in', 'pull_back', 'drift_left', 'drift_right'].includes(move)) {
    comp.camera = { move: move as CompositionCamera['move'], intensity: clamp(num(source.camera?.intensity) ?? 1, 0.25, 1.5) };
  }
  if (source.spec_fingerprint) comp.spec_fingerprint = str(source.spec_fingerprint, 60);
  return comp;
}

// ---------------------------------------------------------------------------
// Fingerprints + scene helpers (mirror the mg:/director fingerprint contract).
// ---------------------------------------------------------------------------

/** The 'ec:' fingerprint stored in scene.video_prompt when an element composition lands. */
export function elementFingerprint(spec: MotionSpec): string {
  return `ec:${motionFingerprint(spec).slice(3)}`;
}

export const isElementFingerprint = (value?: string | null) => String(value || '').startsWith('ec:');

/**
 * The scene's usable element composition: the stored composition_spec, but
 * ONLY when it was composed against the CURRENT MotionSpec — an edited spec
 * invalidates the composition (the pipeline recomposes before assembling).
 */
export function sceneElementComposition(scene: Scene): ElementComposition | null {
  const comp = normalizeElementComposition((scene as Scene & { composition_spec?: unknown }).composition_spec);
  if (!comp || comp.type !== 'multi_element') return null;
  const current = motionFingerprint(sceneMotionSpec(scene));
  if (comp.spec_fingerprint && comp.spec_fingerprint !== current) return null;
  return comp;
}

/** True when the scene carries a composition of exactly its current spec. */
export function hasFreshElementComposition(scene: Scene): boolean {
  if (!isElementFingerprint(scene.video_prompt)) return false;
  if (String(scene.video_prompt) !== elementFingerprint(sceneMotionSpec(scene))) return false;
  return Boolean(sceneElementComposition(scene));
}

// ---------------------------------------------------------------------------
// MOTION-GRAPHIC QA — deterministic checks against the composition itself.
// ---------------------------------------------------------------------------

export interface CompositionValidation { errors: string[]; warnings: string[] }

export function validateElementComposition(comp: ElementComposition): CompositionValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!comp.elements.length) { errors.push('The composition has no elements.'); return { errors, warnings }; }
  const ids = new Set<string>();
  comp.elements.forEach((el) => {
    if (ids.has(el.id)) errors.push(`Element id "${el.id}" is duplicated.`);
    ids.add(el.id);
  });
  comp.elements.forEach((el) => {
    if (el.end <= el.start) errors.push(`Element "${el.id}" has an invalid window (${el.start}s → ${el.end}s).`);
    if (el.parent && !ids.has(el.parent)) errors.push(`Element "${el.id}" is parented to missing element "${el.parent}".`);
    if (el.kind === 'image' && !el.asset_url && !el.asset_brief) errors.push(`Image element "${el.id}" has no asset and no brief.`);
    // Outside the frame (allowing entrance travel head-room).
    if (el.x < -0.2 || el.x > 1.2 || el.y < -0.2 || el.y > 1.2) warnings.push(`Element "${el.id}" sits outside the frame (${el.x.toFixed(2)}, ${el.y.toFixed(2)}).`);
    // Excessive zoom — keyframed scale swings beyond 1.6x read as the old "giant zoom" problem.
    const scales = [el.scale ?? 1, ...(el.keyframes || []).map((kf) => kf.scale).filter((v): v is number => v !== undefined)];
    if (scales.length > 1 && Math.max(...scales) / Math.max(0.05, Math.min(...scales)) > 1.6) warnings.push(`Element "${el.id}" scales more than 1.6x across its keyframes — motion should come from elements, not zoom.`);
  });
  // Sequencing: a multi-element scene where everything appears at once is a slide, not a composition.
  const starts = comp.elements.filter((el) => el.kind !== 'card' && el.kind !== 'image' || !el.parent).map((el) => el.start);
  const distinct = new Set(starts.map((s) => Math.round(s * 10)));
  if (comp.elements.length >= 3 && distinct.size === 1) warnings.push('All elements enter simultaneously — sequence entrances so the scene builds with the narration.');
  // Z-order sanity: two overlapping focus-band elements on one z read as accidental stacking.
  const zs = comp.elements.map((el) => el.z);
  if (new Set(zs).size < zs.length) warnings.push('Two or more elements share a z-order — make stacking explicit.');
  // THE VISUAL BUDGET, in the element model's own terms. A composition groups
  // many elements into one visual — a laptop and its screen are one thing — so
  // the budget is enforced on FOCUS rather than on element count: exactly one
  // element is the thing the viewer is meant to look at, and only one at a time
  // (lib/visualBudget states the same rule for the directed-layer model).
  const focused = comp.elements.filter((el) => el.focus);
  if (focused.length > 1) {
    const overlapping = focused.some((el, index) => focused.slice(index + 1).some((other) => el.start < other.end && other.start < el.end));
    const named = focused.map((el) => el.id).join(', ');
    warnings.push(overlapping
      ? `${focused.length} elements claim the viewer's focus at the same time (${named}). ONE dominant visual + ONE supporting layer — more than two competing layers is a production error, not a creative choice.`
      : `${focused.length} elements claim focus (${named}). They do not overlap in time, so the scene still reads, but each handover has to be deliberate rather than accidental.`);
  }
  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// DETERMINISTIC FALLBACK COMPOSER — a directed multi-element composition
// derived straight from the MotionSpec, used when the Director call fails so
// production keeps the sequential, element-based motion language.
// ---------------------------------------------------------------------------

export function fallbackElementComposition(spec: MotionSpec, durationSec: number, backdropUrl?: string): ElementComposition {
  const duration = clamp(durationSec, 2.5, 20);
  const accent = accentForSpec(spec);
  const elements: CompositionElement[] = [];
  const end = duration;
  let t = 0.2;
  const step = clamp((duration * 0.55) / Math.max(3, (spec.items.length || 2) + 2), 0.35, 0.9);
  const title = spec.title || spec.stat?.label || '';
  if (title) {
    elements.push({ id: 'headline', kind: 'text', variant: 'headline', text: title, ...(spec.subtitle ? { subtext: spec.subtitle } : {}), x: 0.5, y: 0.14, w: 0.8, z: 6, start: t, end, anchor: 'top', enter: { style: 'slide_up', duration: 0.55 }, exit: { style: 'fade', duration: 0.4 }, accent });
    t += step;
  }
  if (spec.kind === 'big_stat' && spec.stat) {
    elements.push({ id: 'stat', kind: 'stat', value: spec.stat.value, prefix: spec.stat.prefix, suffix: spec.stat.suffix, text: spec.stat.label, x: 0.5, y: 0.52, w: 0.6, z: 8, start: t, end, anchor: 'center', enter: { style: 'countup', duration: 1.1 }, exit: { style: 'fade', duration: 0.4 }, accent, focus: true });
    elements.push({ id: 'underline', kind: 'underline', x: 0.5, y: 0.66, w: 0.24, z: 7, start: t + 0.9, end, anchor: 'center', enter: { style: 'draw', duration: 0.5 }, exit: { style: 'fade', duration: 0.3 }, accent });
  } else if (spec.kind === 'bar_chart' && spec.items.length) {
    elements.push({ id: 'chart', kind: 'chart', items: spec.items.map((item) => ({ label: item.label, value: item.value })), x: 0.5, y: 0.56, w: 0.72, h: 0.5, z: 8, start: t, end, anchor: 'center', enter: { style: 'fade', duration: 0.4 }, exit: { style: 'fade', duration: 0.4 }, accent, focus: true });
  } else if (spec.kind === 'comparison') {
    const right = contrastAccent(accent);
    elements.push({ id: 'left_card', kind: 'card', x: 0.28, y: 0.56, w: 0.38, h: 0.52, z: 4, start: t, end, anchor: 'center', enter: { style: 'slide_right', duration: 0.5 }, exit: { style: 'fade', duration: 0.4 }, accent, bg: 'rgba(8,12,24,0.72)' });
    elements.push({ id: 'left_title', kind: 'text', variant: 'subhead', text: spec.leftTitle || 'A', parent: 'left_card', x: 0.28, y: 0.36, w: 0.34, z: 5, start: t + 0.15, end, anchor: 'top', enter: { style: 'fade', duration: 0.4 }, exit: { style: 'fade', duration: 0.3 }, accent });
    elements.push({ id: 'right_card', kind: 'card', x: 0.72, y: 0.56, w: 0.38, h: 0.52, z: 4, start: t + step, end, anchor: 'center', enter: { style: 'slide_left', duration: 0.5 }, exit: { style: 'fade', duration: 0.4 }, accent: right, bg: 'rgba(8,12,24,0.72)' });
    elements.push({ id: 'right_title', kind: 'text', variant: 'subhead', text: spec.rightTitle || 'B', parent: 'right_card', x: 0.72, y: 0.36, w: 0.34, z: 5, start: t + step + 0.15, end, anchor: 'top', enter: { style: 'fade', duration: 0.4 }, exit: { style: 'fade', duration: 0.3 }, accent: right });
    (spec.leftItems || []).slice(0, 4).forEach((item, i) => elements.push({ id: `left_${i + 1}`, kind: 'pill', text: item, parent: 'left_card', x: 0.28, y: 0.46 + i * 0.09, w: 0.32, z: 6, start: t + step * (i + 2) * 0.6, end, anchor: 'center', enter: { style: 'slide_up', duration: 0.4 }, exit: { style: 'fade', duration: 0.3 }, accent }));
    (spec.rightItems || []).slice(0, 4).forEach((item, i) => elements.push({ id: `right_${i + 1}`, kind: 'pill', text: item, parent: 'right_card', x: 0.72, y: 0.46 + i * 0.09, w: 0.32, z: 6, start: t + step * (i + 2.5) * 0.6, end, anchor: 'center', enter: { style: 'slide_up', duration: 0.4 }, exit: { style: 'fade', duration: 0.3 }, accent: right }));
  } else if (spec.kind === 'timeline' && spec.items.length) {
    elements.push({ id: 'rail', kind: 'line', x: 0.1, y: 0.55, tx: 0.9, ty: 0.55, w: 0.8, z: 4, start: t, end, anchor: 'left', enter: { style: 'draw', duration: 1 }, exit: { style: 'fade', duration: 0.4 }, accent });
    spec.items.slice(0, 6).forEach((item, i, all) => {
      const x = 0.12 + (0.76 * i) / Math.max(1, all.length - 1);
      elements.push({ id: `beat_${i + 1}`, kind: 'pill', text: item.label, ...(item.sublabel ? { subtext: item.sublabel } : {}), x, y: i % 2 ? 0.68 : 0.42, w: 0.2, z: 6, start: t + 0.5 + i * step, end, anchor: 'center', enter: { style: 'pop', duration: 0.45 }, exit: { style: 'fade', duration: 0.3 }, accent });
    });
  } else if ((spec.kind === 'flowchart' || spec.kind === 'list_reveal' || spec.kind === 'branching_diagram' || spec.kind === 'node_graph') && spec.items.length) {
    const across = spec.kind === 'flowchart';
    spec.items.slice(0, 6).forEach((item, i, all) => {
      const x = across ? 0.14 + (0.72 * i) / Math.max(1, all.length - 1) : 0.5;
      const y = across ? 0.55 : 0.34 + i * clamp(0.5 / Math.max(1, all.length - 1), 0.09, 0.14);
      elements.push({ id: `item_${i + 1}`, kind: 'pill', text: item.label, ...(item.sublabel ? { subtext: item.sublabel } : {}), x, y, w: across ? 0.19 : 0.5, z: 6, start: t + i * step, end, anchor: 'center', enter: { style: across ? 'slide_right' : 'slide_up', duration: 0.45 }, exit: { style: 'fade', duration: 0.3 }, accent });
      if (i > 0) {
        const prevX = across ? 0.14 + (0.72 * (i - 1)) / Math.max(1, all.length - 1) : 0.5;
        const prevY = across ? 0.55 : 0.34 + (i - 1) * clamp(0.5 / Math.max(1, all.length - 1), 0.09, 0.14);
        elements.push({ id: `link_${i}`, kind: 'arrow', x: across ? prevX + 0.1 : prevX, y: across ? prevY : prevY + 0.045, tx: across ? x - 0.1 : x, ty: across ? y : y - 0.045, w: 0.1, z: 5, start: t + i * step - step * 0.4, end, anchor: 'center', enter: { style: 'draw', duration: 0.4 }, exit: { style: 'fade', duration: 0.3 }, accent });
      }
    });
  } else if (spec.kind === 'annotated_image' && (spec.imageUrl || backdropUrl)) {
    elements.push({ id: 'document', kind: 'image', asset_url: spec.imageUrl || backdropUrl, fit: 'contain', x: 0.42, y: 0.55, w: 0.56, z: 3, start: t, end, anchor: 'center', enter: { style: 'slide_up', duration: 0.6 }, exit: { style: 'fade', duration: 0.4 }, keyframes: [{ at: t + 0.6, scale: 1 }, { at: Math.min(end - 0.5, t + 2.2), scale: 1.08, easing: 'ease-in-out' }] });
    elements.push({ id: 'focus_highlight', kind: 'highlight', parent: 'document', x: 0.42, y: 0.52, w: 0.3, h: 0.1, z: 7, start: t + 1.1, end, anchor: 'center', enter: { style: 'wipe', duration: 0.5, from: 'left' }, exit: { style: 'fade', duration: 0.3 }, accent, focus: true });
    spec.items.slice(0, 3).forEach((item, i) => {
      elements.push({ id: `note_${i + 1}`, kind: 'pill', text: item.label, x: 0.82, y: 0.32 + i * 0.16, w: 0.26, z: 8, start: t + 1.3 + i * step, end, anchor: 'center', enter: { style: 'slide_left', duration: 0.45 }, exit: { style: 'fade', duration: 0.3 }, accent });
      elements.push({ id: `note_arrow_${i + 1}`, kind: 'arrow', x: 0.69, y: 0.32 + i * 0.16, tx: 0.55, ty: 0.45 + i * 0.06, w: 0.14, z: 7, start: t + 1.5 + i * step, end, anchor: 'center', enter: { style: 'draw', duration: 0.5 }, exit: { style: 'fade', duration: 0.3 }, accent });
    });
  } else {
    // text_reveal / anything else: kinetic headline + drawn underline.
    if (!title && spec.subtitle) elements.push({ id: 'line', kind: 'text', variant: 'headline', text: spec.subtitle, x: 0.5, y: 0.48, w: 0.8, z: 6, start: 0.2, end, anchor: 'center', enter: { style: 'spring_in', duration: 0.7 }, exit: { style: 'fade', duration: 0.4 }, accent, focus: true });
    elements.push({ id: 'rule', kind: 'underline', x: 0.5, y: title ? 0.3 : 0.6, w: 0.2, z: 5, start: 0.8, end, anchor: 'center', enter: { style: 'draw', duration: 0.5 }, exit: { style: 'fade', duration: 0.3 }, accent });
  }
  if (backdropUrl && spec.kind !== 'annotated_image') {
    elements.unshift({ id: 'backdrop', kind: 'image', asset_url: backdropUrl, fit: 'cover', x: 0.5, y: 0.5, w: 1.02, h: 1.02, z: 0, opacity: 0.32, start: 0, end, anchor: 'center', enter: { style: 'blur_in', duration: 0.8 }, exit: { style: 'none', duration: 0.2 } });
  }
  return {
    version: 1,
    type: 'multi_element',
    duration,
    background: '#0A0F1E',
    camera: { move: 'push_in', intensity: 0.6 },
    elements,
    spec_fingerprint: motionFingerprint(spec),
  };
}

// ---------------------------------------------------------------------------
// ACCEPTANCE TEST SCENE — the fixed composition the motion system must render
// as designed motion graphics (background → paper → notebook → pen → writing
// highlight → arrow → statistic), with independent, sequential element motion.
// Rendered from Settings → "Motion system acceptance test".
// ---------------------------------------------------------------------------

export function demoComposition(): ElementComposition {
  const end = 6;
  const accent = '#F59E0B';
  return {
    version: 1,
    type: 'multi_element',
    duration: end,
    background: 'radial-gradient(1100px 560px at 30% -10%, rgba(59,130,246,0.2), transparent 60%), #0A0F1E',
    camera: { move: 'push_in', intensity: 0.5 },
    elements: [
      { id: 'desk', kind: 'card', x: 0.5, y: 0.62, w: 0.86, h: 0.62, z: 1, start: 0, end, anchor: 'center', bg: 'rgba(30,26,20,0.85)', radius: 26, enter: { style: 'fade', duration: 0.3 }, exit: { style: 'none', duration: 0.2 } },
      { id: 'paper', kind: 'card', x: 0.38, y: 0.58, w: 0.3, h: 0.46, z: 3, start: 0.3, end, anchor: 'center', bg: 'rgba(250,247,240,0.96)', radius: 8, rotation: -3, enter: { style: 'slide_up', duration: 0.6 }, exit: { style: 'fade', duration: 0.4 }, keyframes: [{ at: 0.9, rotation: -1.5, easing: 'ease-out' }] },
      { id: 'paper_lines', kind: 'progress', parent: 'paper', items: [{ label: '' }, { label: '' }, { label: '' }], x: 0.38, y: 0.58, w: 0.24, h: 0.3, z: 4, start: 0.7, end, anchor: 'center', accent: 'rgba(26,26,26,0.35)', enter: { style: 'fade', duration: 0.4 }, exit: { style: 'fade', duration: 0.3 } },
      { id: 'notebook', kind: 'card', x: 0.68, y: 0.62, w: 0.26, h: 0.38, z: 4, start: 1.1, end, anchor: 'center', bg: 'rgba(24,50,86,0.95)', radius: 10, rotation: 2, enter: { style: 'slide_right', duration: 0.6 }, exit: { style: 'fade', duration: 0.4 }, keyframes: [{ at: 1.8, rotation: 0.5, easing: 'ease-out' }] },
      { id: 'pen', kind: 'card', x: 0.62, y: 0.4, w: 0.02, h: 0.2, z: 8, start: 2, end, anchor: 'bottom', bg: '#F59E0B', radius: 4, rotation: 38, enter: { style: 'slide_down', duration: 0.45 }, exit: { style: 'drift', duration: 0.5 }, keyframes: [{ at: 2.4, x: 0.66, y: 0.5, rotation: 32, easing: 'ease-in-out' }, { at: 3.2, x: 0.72, y: 0.55, rotation: 36, easing: 'ease-in-out' }] },
      { id: 'writing', kind: 'highlight', parent: 'notebook', x: 0.67, y: 0.58, w: 0.16, h: 0.05, z: 6, start: 2.8, end, anchor: 'left', accent: 'rgba(245,158,11,0.7)', enter: { style: 'wipe', duration: 0.9, from: 'left' }, exit: { style: 'fade', duration: 0.4 }, focus: true },
      { id: 'callout_arrow', kind: 'arrow', x: 0.32, y: 0.24, tx: 0.6, ty: 0.5, w: 0.2, z: 9, start: 3.5, end, anchor: 'center', accent, enter: { style: 'draw', duration: 0.6 }, exit: { style: 'fade', duration: 0.3 } },
      { id: 'headline', kind: 'text', variant: 'subhead', text: 'The student starts writing', x: 0.28, y: 0.18, w: 0.34, z: 10, start: 3.6, end, anchor: 'center', enter: { style: 'slide_up', duration: 0.5 }, exit: { style: 'fade', duration: 0.4 } },
      { id: 'stat', kind: 'stat', value: 92, suffix: '%', text: 'retention with written notes', x: 0.82, y: 0.24, w: 0.26, z: 10, start: 4, end, anchor: 'center', accent, enter: { style: 'countup', duration: 0.9 }, exit: { style: 'fade', duration: 0.4 } },
      { id: 'chart', kind: 'chart', items: [{ label: 'Typed', value: 61 }, { label: 'Written', value: 92 }], x: 0.85, y: 0.62, w: 0.2, h: 0.3, z: 7, start: 4.3, end, anchor: 'center', accent, enter: { style: 'fade', duration: 0.4 }, exit: { style: 'fade', duration: 0.4 } },
    ],
  };
}
