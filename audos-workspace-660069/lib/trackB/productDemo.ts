/**
 * Product Demo timeline — the ONE source of truth for Track B's premium
 * SaaS/product-demo scene choreography (cinematic camera, demo cursor, UI
 * interactions, highlights, captions, transitions and SFX cues).
 *
 * DESIGN CONTRACT
 *  - Every timing in a DemoSceneSpec is a FRACTION (0..1) of its scene's
 *    duration. The scene's `duration_s` (the USER-owned field) is the only
 *    clock: retime a scene from 5s to 7s and every dependent animation —
 *    camera keys, cursor waypoints, click moments, highlight windows, caption
 *    windows, SFX cues — retimes with it. Nothing downstream hardcodes
 *    absolute seconds or frames.
 *  - buildDemoPlan() is DETERMINISTIC: same scenes + style in, same plan out
 *    (seeded by a stable hash of each scene id — no randomness, no clock).
 *  - The evaluators (cameraAt / cursorAt / activeEvent / activeHighlight /
 *    transitionPhase) are pure math with no React/Remotion imports, so both
 *    the browser (Editor debug panel) and the render composition compute the
 *    IDENTICAL state for any time t. The trackb-render COMPOSITION_SOURCE
 *    inlines a ported JS copy of the builder + evaluators (the render service
 *    compiles one self-contained file) — this file is canonical; keep the
 *    port in sync when changing anything here.
 */

export type DemoStyleId = 'cinematic' | 'social_ad' | 'explainer' | 'documentary';
export type DemoShot = 'establish' | 'feature' | 'return';
export type DemoAction =
  | 'click' | 'hover' | 'open' | 'close' | 'select' | 'drag' | 'drop'
  | 'type' | 'scroll' | 'toggle' | 'zoom' | 'expand';
export type DemoTransition = 'camera' | 'expand' | 'focus' | 'fade';
export type DemoHighlightStyle = 'spotlight' | 'outline';
export type DemoSfxKind = 'click' | 'whoosh' | 'pop' | 'type' | 'toggle';

/** A UI region on the product surface, normalized 0..1 of the surface box. */
export interface DemoTargetRect { x: number; y: number; w: number; h: number; label: string }

/** Camera keyframe: scale plus a normalized centre offset (0.1 ≈ 10% of the stage). */
export interface DemoCameraKey { at: number; scale: number; x: number; y: number; rotate: number }

export interface DemoCursorPoint { at: number; x: number; y: number; press?: boolean }

export interface DemoEvent { at: number; end: number; action: DemoAction; target: DemoTargetRect; target2?: DemoTargetRect | null }

export interface DemoHighlight { from: number; to: number; target: DemoTargetRect; style: DemoHighlightStyle }

export interface DemoSfxCue { at: number; kind: DemoSfxKind }

export interface DemoSceneSpec {
  shot: DemoShot;
  camera: DemoCameraKey[];
  cursor: { points: DemoCursorPoint[] } | null;
  events: DemoEvent[];
  highlights: DemoHighlight[];
  caption: { from: number; to: number };
  transitionIn: DemoTransition;
  transitionOut: DemoTransition;
  sfx: DemoSfxCue[];
  /** Vertical content drift (fraction of surface height) for scroll scenes. */
  scrollDrift: number;
}

/** The scene facts the builder needs (a projection of TrackBScene). */
export interface DemoBuildScene {
  id: string;
  motion?: string | null;
  intent?: string | null;
  headline?: string | null;
  /** True when the scene presents a real product screenshot (not an AI image, not a video clip). */
  demoSurface: boolean;
}

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------

/** Stable djb2 hash of a string — the only 'randomness' in the plan. */
export function demoHash(text: string): number {
  let h = 5381;
  const s = String(text || '');
  for (let i = 0; i < s.length; i += 1) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

export const demoClamp01 = (v: number): number => Math.max(0, Math.min(1, Number(v) || 0));

/** Smooth ease-in-out (cubic) — the shared easing character for camera + cursor. */
export function demoEase(t: number): number {
  const p = demoClamp01(t);
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}

/** Eased-with-settle: approaches 1 with a tiny overshoot then settles (anticipation + settling). */
export function demoSpringEase(t: number): number {
  const p = demoClamp01(t);
  return 1 - Math.pow(1 - p, 3) * Math.cos(p * 4.5) ;
}

// ---------------------------------------------------------------------------
// The UI target library — plausible SaaS interface regions the demo cursor
// and highlights work against (normalized to the product surface).
// ---------------------------------------------------------------------------

const TARGETS: DemoTargetRect[] = [
  { x: 0.70, y: 0.045, w: 0.22, h: 0.075, label: 'primary action' },
  { x: 0.05, y: 0.26, w: 0.17, h: 0.07, label: 'nav item' },
  { x: 0.26, y: 0.20, w: 0.30, h: 0.26, label: 'card' },
  { x: 0.60, y: 0.30, w: 0.34, h: 0.36, label: 'chart' },
  { x: 0.28, y: 0.58, w: 0.50, h: 0.09, label: 'table row' },
  { x: 0.30, y: 0.38, w: 0.34, h: 0.085, label: 'input field' },
  { x: 0.79, y: 0.21, w: 0.11, h: 0.055, label: 'toggle' },
  { x: 0.07, y: 0.045, w: 0.26, h: 0.07, label: 'navigation' },
];

function pickTarget(scene: DemoBuildScene, seed: number): DemoTargetRect {
  const text = ((scene.motion || '') + ' ' + (scene.intent || '') + ' ' + (scene.headline || '')).toLowerCase();
  if (/chart|graph|analytic|metric|report|insight/.test(text)) return TARGETS[3];
  if (/button|cta|action|start|create|sign|publish/.test(text)) return TARGETS[0];
  if (/form|input|type|search|field|enter/.test(text)) return TARGETS[5];
  if (/toggle|switch|enable|setting/.test(text)) return TARGETS[6];
  if (/nav|menu|sidebar|tab/.test(text)) return TARGETS[1];
  if (/list|table|row|feed|scroll|history/.test(text)) return TARGETS[4];
  if (/card|panel|widget|block/.test(text)) return TARGETS[2];
  return TARGETS[seed % TARGETS.length];
}

function pickAction(scene: DemoBuildScene, seed: number): DemoAction {
  const text = ((scene.motion || '') + ' ' + (scene.intent || '')).toLowerCase();
  if (/scroll|feed|browse|list/.test(text)) return 'scroll';
  if (/type|search|enter|write/.test(text)) return 'type';
  if (/toggle|switch|enable/.test(text)) return 'toggle';
  if (/drag|drop|reorder|move/.test(text)) return 'drag';
  if (/hover|inspect|peek/.test(text)) return 'hover';
  if (/open|expand|modal|dialog|detail/.test(text)) return 'open';
  const cycle: DemoAction[] = ['click', 'toggle', 'type', 'scroll', 'click', 'open'];
  return cycle[seed % cycle.length];
}

// ---------------------------------------------------------------------------
// Style vocabulary — pacing/zoom/rotation character per product video style.
// ---------------------------------------------------------------------------

interface StyleParams { zMax: number; arrive: number; rotate: number; establishScale: number; settle: number }

const STYLE_PARAMS: Record<DemoStyleId, StyleParams> = {
  cinematic: { zMax: 1.34, arrive: 0.38, rotate: 1.6, establishScale: 0.85, settle: 0.94 },
  social_ad: { zMax: 1.45, arrive: 0.26, rotate: 0.9, establishScale: 0.88, settle: 0.96 },
  explainer: { zMax: 1.26, arrive: 0.32, rotate: 0.5, establishScale: 0.87, settle: 0.95 },
  documentary: { zMax: 1.30, arrive: 0.34, rotate: 2.1, establishScale: 0.86, settle: 0.93 },
};

export function demoStyleParams(style: string): StyleParams {
  return STYLE_PARAMS[(style as DemoStyleId)] || STYLE_PARAMS.social_ad;
}

/** Camera offset that centres a target rect (camera x/y are normalized centre offsets). */
function offsetFor(target: DemoTargetRect): { x: number; y: number } {
  return { x: 0.5 - (target.x + target.w / 2), y: 0.5 - (target.y + target.h / 2) };
}

// ---------------------------------------------------------------------------
// The deterministic plan builder
// ---------------------------------------------------------------------------

/**
 * Build the premium demo choreography for a film. Returns one spec per scene
 * (null for scenes that are not demo surfaces — AI images, brand tiles and
 * video clips keep their existing treatments). Consecutive scenes chain their
 * transitions (scene N's transitionOut === scene N+1's transitionIn) so cuts
 * read as continuous camera moves, panel expands or focus pulls — never a
 * generic fade in the middle of the film.
 */
export function buildDemoPlan(scenes: DemoBuildScene[], style: string): (DemoSceneSpec | null)[] {
  const P = demoStyleParams(style);
  const demoIdx = scenes.map((s, i) => (s.demoSurface ? i : -1)).filter((i) => i >= 0);
  const specs: (DemoSceneSpec | null)[] = scenes.map(() => null);
  const transitions: DemoTransition[] = ['camera', 'expand', 'focus'];

  for (let k = 0; k < demoIdx.length; k += 1) {
    const i = demoIdx[k];
    const scene = scenes[i];
    const seed = demoHash(scene.id + ':' + i);
    const target = pickTarget(scene, seed);
    const action = pickAction(scene, seed >> 3);
    const off = offsetFor(target);
    const first = k === 0;
    const last = k === demoIdx.length - 1;
    const tIn: DemoTransition = first ? 'fade' : transitions[(k - 1) % transitions.length];
    const tOut: DemoTransition = last ? 'fade' : transitions[k % transitions.length];

    if (first && demoIdx.length > 1) {
      // ESTABLISHING SHOT — the whole product visible, subtle rotation, then a
      // smooth drift toward the next scene's feature so the cut reads continuous.
      const nextTarget = pickTarget(scenes[demoIdx[1]], demoHash(scenes[demoIdx[1]].id + ':' + demoIdx[1]));
      const nextOff = offsetFor(nextTarget);
      specs[i] = {
        shot: 'establish',
        camera: [
          { at: 0, scale: P.establishScale, x: 0, y: 0.01, rotate: P.rotate },
          { at: 0.55, scale: P.establishScale + 0.06, x: nextOff.x * 0.25, y: nextOff.y * 0.25, rotate: P.rotate * 0.35 },
          { at: 1, scale: P.establishScale + 0.11, x: nextOff.x * 0.5, y: nextOff.y * 0.5, rotate: 0 },
        ],
        cursor: {
          points: [
            { at: 0.58, x: 1.06, y: 0.82 },
            { at: 0.85, x: target.x + target.w * 0.7, y: target.y + target.h * 1.6 },
            { at: 1, x: nextTarget.x + nextTarget.w / 2, y: nextTarget.y + nextTarget.h / 2 },
          ],
        },
        events: [],
        highlights: [],
        caption: { from: 0.12, to: 0.82 },
        transitionIn: tIn,
        transitionOut: tOut,
        sfx: [{ at: 0.02, kind: 'whoosh' }],
        scrollDrift: 0,
      };
      continue;
    }

    if (last && demoIdx.length > 1) {
      // RETURN SHOT — pull back smoothly to the complete product for the close.
      specs[i] = {
        shot: 'return',
        camera: [
          { at: 0, scale: P.zMax * 0.9, x: off.x * 0.8, y: off.y * 0.8, rotate: 0 },
          { at: 0.55, scale: P.settle, x: 0, y: 0, rotate: P.rotate * 0.3 },
          { at: 1, scale: P.settle - 0.03, x: 0, y: 0.01, rotate: 0 },
        ],
        cursor: {
          points: [
            { at: 0, x: target.x + target.w / 2, y: target.y + target.h / 2 },
            { at: 0.3, x: 1.08, y: 0.5 },
          ],
        },
        events: [],
        highlights: [],
        caption: { from: 0.22, to: 0.95 },
        transitionIn: tIn,
        transitionOut: tOut,
        sfx: [{ at: 0.02, kind: 'whoosh' }],
        scrollDrift: 0,
      };
      continue;
    }

    // FEATURE CLOSE-UP — camera pushes onto the target, the cursor travels to
    // it, interacts, and the feature is highlighted while the camera settles.
    const arrive = P.arrive;
    const act = arrive + 0.10;
    const actEnd = Math.min(0.92, act + (action === 'type' ? 0.34 : action === 'drag' ? 0.30 : action === 'scroll' ? 0.36 : 0.16));
    const target2 = action === 'drag' ? TARGETS[(seed >> 5) % TARGETS.length] : null;
    const hlStyle: DemoHighlightStyle = (seed >> 7) % 2 === 0 ? 'spotlight' : 'outline';
    const zoomBase = P.zMax - ((seed >> 4) % 3) * 0.04;
    const cursorPoints: DemoCursorPoint[] = [
      { at: 0.04, x: (seed % 2 === 0 ? -0.06 : 1.06), y: 0.72 },
      { at: arrive, x: target.x + target.w / 2, y: target.y + target.h / 2 },
      { at: act, x: target.x + target.w / 2, y: target.y + target.h / 2, press: action !== 'hover' },
    ];
    if (action === 'drag' && target2) {
      cursorPoints.push({ at: actEnd - 0.04, x: target2.x + target2.w / 2, y: target2.y + target2.h / 2, press: true });
      cursorPoints.push({ at: actEnd, x: target2.x + target2.w / 2, y: target2.y + target2.h / 2 });
    } else if (action === 'scroll') {
      cursorPoints.push({ at: actEnd, x: target.x + target.w / 2 + 0.02, y: target.y + target.h / 2 + 0.05 });
    } else {
      cursorPoints.push({ at: Math.min(0.95, actEnd + 0.1), x: target.x + target.w * 0.8, y: target.y + target.h * 1.4 });
    }
    const sfxKind: DemoSfxKind = action === 'type' ? 'type' : action === 'toggle' ? 'toggle' : 'click';
    specs[i] = {
      shot: 'feature',
      camera: [
        { at: 0, scale: P.settle + 0.04, x: off.x * 0.3, y: off.y * 0.3, rotate: P.rotate * 0.25 },
        { at: arrive, scale: zoomBase, x: off.x, y: off.y, rotate: 0 },
        { at: Math.min(0.9, act + 0.04), scale: zoomBase + 0.06, x: off.x, y: off.y, rotate: 0 },
        { at: 1, scale: zoomBase - 0.03, x: off.x * 0.92, y: off.y * 0.92, rotate: P.rotate * -0.15 },
      ],
      cursor: { points: cursorPoints },
      events: [{ at: act, end: actEnd, action, target, target2 }],
      highlights: [{ from: act, to: 0.9, target, style: hlStyle }],
      caption: { from: 0.1, to: 0.85 },
      transitionIn: tIn,
      transitionOut: tOut,
      sfx: [
        { at: 0.02, kind: 'whoosh' },
        { at: act, kind: sfxKind },
        { at: Math.min(0.94, act + 0.06), kind: 'pop' },
      ],
      scrollDrift: action === 'scroll' ? 0.16 : 0,
    };
  }
  return specs;
}

// ---------------------------------------------------------------------------
// Evaluators — pure functions of (spec, t) where t is 0..1 within the scene.
// The composition and the Editor debug panel both use exactly this math.
// ---------------------------------------------------------------------------

export interface DemoCameraState { scale: number; x: number; y: number; rotate: number }

export function cameraAt(spec: DemoSceneSpec, t: number): DemoCameraState {
  const keys = spec.camera;
  if (!keys.length) return { scale: 1, x: 0, y: 0, rotate: 0 };
  const tt = demoClamp01(t);
  if (tt <= keys[0].at) return { scale: keys[0].scale, x: keys[0].x, y: keys[0].y, rotate: keys[0].rotate };
  for (let i = 1; i < keys.length; i += 1) {
    if (tt <= keys[i].at) {
      const a = keys[i - 1];
      const b = keys[i];
      const span = Math.max(0.0001, b.at - a.at);
      const p = demoEase((tt - a.at) / span);
      return {
        scale: a.scale + (b.scale - a.scale) * p,
        x: a.x + (b.x - a.x) * p,
        y: a.y + (b.y - a.y) * p,
        rotate: a.rotate + (b.rotate - a.rotate) * p,
      };
    }
  }
  const lastKey = keys[keys.length - 1];
  return { scale: lastKey.scale, x: lastKey.x, y: lastKey.y, rotate: lastKey.rotate };
}

export interface DemoCursorState { x: number; y: number; press: boolean; visible: boolean }

/** Cursor position at t — always interpolated between waypoints, never teleporting. */
export function cursorAt(spec: DemoSceneSpec, t: number): DemoCursorState | null {
  const c = spec.cursor;
  if (!c || !c.points.length) return null;
  const pts = c.points;
  const tt = demoClamp01(t);
  if (tt < pts[0].at) return { x: pts[0].x, y: pts[0].y, press: false, visible: false };
  for (let i = 1; i < pts.length; i += 1) {
    if (tt <= pts[i].at) {
      const a = pts[i - 1];
      const b = pts[i];
      const span = Math.max(0.0001, b.at - a.at);
      const p = demoEase((tt - a.at) / span);
      return {
        x: a.x + (b.x - a.x) * p,
        y: a.y + (b.y - a.y) * p,
        press: !!(b.press && p > 0.75) || !!(a.press && p < 0.3),
        visible: true,
      };
    }
  }
  const lastPt = pts[pts.length - 1];
  const off = lastPt.x < -0.02 || lastPt.x > 1.02 || lastPt.y < -0.02 || lastPt.y > 1.02;
  return { x: lastPt.x, y: lastPt.y, press: false, visible: !off };
}

export function activeEvent(spec: DemoSceneSpec, t: number): DemoEvent | null {
  for (const e of spec.events) if (t >= e.at && t <= e.end) return e;
  return null;
}

export function activeHighlight(spec: DemoSceneSpec, t: number): DemoHighlight | null {
  for (const h of spec.highlights) if (t >= h.from && t <= h.to) return h;
  return null;
}

/**
 * Transition phase at t: entering (0→1 over the first `frac`), full (1), or
 * exiting (1→0 over the last `frac`). Both scenes of a cut share the same
 * transition kind, so the exit of scene N choreographs into the entry of N+1.
 */
export function transitionPhase(t: number, frac = 0.1): { enter: number; exit: number } {
  const tt = demoClamp01(t);
  return {
    enter: demoClamp01(tt / Math.max(0.0001, frac)),
    exit: demoClamp01((1 - tt) / Math.max(0.0001, frac)),
  };
}

// ---------------------------------------------------------------------------
// Film timeline helper — absolute scene windows from the per-scene durations.
// ---------------------------------------------------------------------------

export interface DemoSceneWindow { index: number; startS: number; endS: number; durationS: number }

export function sceneWindows(durations: number[]): DemoSceneWindow[] {
  const out: DemoSceneWindow[] = [];
  let acc = 0;
  for (let i = 0; i < durations.length; i += 1) {
    const d = Math.max(0.5, Number(durations[i]) || 5);
    out.push({ index: i, startS: acc, endS: acc + d, durationS: d });
    acc += d;
  }
  return out;
}
