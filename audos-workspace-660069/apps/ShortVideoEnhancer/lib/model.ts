import { WORKSPACE_ID } from '../../../lib/workspace';

/**
 * Short Video Enhancer — the project model and the timeline compiler.
 *
 * This file is the single definition of what a project IS. Nothing here draws
 * anything: it describes the non-destructive layer stack and compiles it into
 * the absolute frame numbers that BOTH the preview Player and the server
 * render consume, so the two can never disagree about timing.
 *
 * Hierarchy the whole app is organised around:
 *   HOOK -> STORY -> PACING -> EMPHASIS -> CAPTIONS -> MOTION GRAPHICS
 *   -> TRANSITIONS -> SOUND DESIGN -> FINAL COMPOSITION
 *
 * Native canvas is 1080x1920 @ 30fps and never anything else. Every layout
 * number in a project is expressed in those canvas pixels, so a layer lands in
 * the same place at any playback scale.
 */

export const FPS = 30;
export const CANVAS_W = 1080;
export const CANVAS_H = 1920;
/** Caption / graphic safe area inset, in canvas pixels (QC checks against it). */
export const SAFE_MARGIN = 90;
/** Bumped whenever the motion maths changes, so a stored project says which engine drew it. */
export const MOTION_SPEC_VERSION = 3;
export const SVE_WORKSPACE_ID = WORKSPACE_ID;

/** Shortest transition that is still a transition rather than a cut. */
export const MIN_TRANSITION_S = 0.08;

export function uid(prefix: string): string {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
}

export function round3(n: number): number { return Math.round(n * 1000) / 1000; }

export function formatTime(sec: number): string {
  const s = Math.max(0, Number.isFinite(sec) ? sec : 0);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1);
}

// ---------------------------------------------------------------------------
// Shared vocabulary
// ---------------------------------------------------------------------------

export type EasingId = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'expoOut' | 'back' | 'spring';

export const EASINGS: { id: EasingId; label: string }[] = [
  { id: 'linear', label: 'Linear' },
  { id: 'easeIn', label: 'Ease in' },
  { id: 'easeOut', label: 'Ease out' },
  { id: 'easeInOut', label: 'Ease in-out' },
  { id: 'expoOut', label: 'Expo out' },
  { id: 'back', label: 'Back (overshoot)' },
  { id: 'spring', label: 'Spring' },
];

// ---------------------------------------------------------------------------
// Keyframes — every motion-graphic channel can be driven by its own curve
// ---------------------------------------------------------------------------

/**
 * A keyframed channel REPLACES that channel's ramp for the layer's whole life.
 * Channels with no keyframes keep reading their ramps, so every project built
 * on the Phase 1 / Phase 2 engine keeps animating exactly as it did.
 */
export type KeyChannel = 'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation' | 'opacity' | 'blur' | 'color';

export type KeyEasingId = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'spring';

export const KEY_EASINGS: { id: KeyEasingId; label: string }[] = [
  { id: 'linear', label: 'Linear' },
  { id: 'easeIn', label: 'Ease in' },
  { id: 'easeOut', label: 'Ease out' },
  { id: 'easeInOut', label: 'Ease in-out' },
  { id: 'spring', label: 'Spring' },
];

export interface KeyChannelSpec {
  id: KeyChannel;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  color: boolean;
}

export const KEY_CHANNELS: KeyChannelSpec[] = [
  { id: 'x', label: 'Position X', min: -400, max: CANVAS_W + 400, step: 2, unit: 'px', color: false },
  { id: 'y', label: 'Position Y', min: -400, max: CANVAS_H + 400, step: 4, unit: 'px', color: false },
  { id: 'scaleX', label: 'Scale X', min: 0.02, max: 4, step: 0.01, unit: '\u00d7', color: false },
  { id: 'scaleY', label: 'Scale Y', min: 0.02, max: 4, step: 0.01, unit: '\u00d7', color: false },
  { id: 'rotation', label: 'Rotation', min: -720, max: 720, step: 1, unit: '\u00b0', color: false },
  { id: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.02, unit: '', color: false },
  { id: 'blur', label: 'Blur', min: 0, max: 60, step: 0.5, unit: 'px', color: false },
  { id: 'color', label: 'Colour', min: 0, max: 1, step: 1, unit: '', color: true },
];

export function keyChannelSpec(id: KeyChannel): KeyChannelSpec {
  return KEY_CHANNELS.find((c) => c.id === id) || KEY_CHANNELS[0];
}

export interface Keyframe {
  id: string;
  /** Absolute timeline seconds. */
  t: number;
  /** Numeric channels read `v`; the colour channel reads `c`. */
  v: number;
  c: string;
  /** How the curve LEAVES this keyframe on its way to the next one. */
  easing: KeyEasingId;
}

export type KeyframeTracks = { [K in KeyChannel]?: Keyframe[] };

export function newKeyframe(t: number, v: number, color = '#FFFFFF', easing: KeyEasingId = 'easeInOut'): Keyframe {
  return { id: uid('kf'), t: round3(t), v, c: color, easing };
}

export function sortKeyframes(keys: Keyframe[]): Keyframe[] {
  return keys.slice().sort((a, b) => a.t - b.t);
}

/** The same easing maths the motion engine runs, so the graph view cannot lie. */
export function keyEase(id: KeyEasingId, raw: number): number {
  const t = clamp(raw, 0, 1);
  if (id === 'linear') return t;
  if (id === 'easeIn') return t * t * t;
  if (id === 'easeOut') return 1 - Math.pow(1 - t, 3);
  if (id === 'easeInOut') return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  if (id === 'spring') {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return 1 - Math.pow(2, -9 * t) * Math.cos(t * 13.5);
  }
  return t;
}

/** Sample a numeric keyframe track. Returns `fallback` when the track is empty. */
export function sampleKeyframes(keys: Keyframe[] | undefined, t: number, fallback: number): number {
  if (!keys || !keys.length) return fallback;
  const ks = sortKeyframes(keys);
  if (t <= ks[0].t) return ks[0].v;
  const last = ks[ks.length - 1];
  if (t >= last.t) return last.v;
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i];
    const b = ks[i + 1];
    if (t >= a.t && t <= b.t) {
      const span = Math.max(0.0001, b.t - a.t);
      return a.v + (b.v - a.v) * keyEase(a.easing, (t - a.t) / span);
    }
  }
  return fallback;
}

// --- colour maths, shared by the keyframe editor, the engine and QC ---------

export function parseHex(hex: string): { r: number; g: number; b: number } {
  const h = String(hex || '').replace('#', '').trim();
  const full = h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h;
  const n = parseInt((full + '000000').slice(0, 6), 16);
  if (!Number.isFinite(n)) return { r: 0, g: 0, b: 0 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function toHex(r: number, g: number, b: number): string {
  const c = (v: number) => {
    const s = Math.round(clamp(v, 0, 255)).toString(16);
    return s.length < 2 ? '0' + s : s;
  };
  return '#' + c(r) + c(g) + c(b);
}

export function mixHex(a: string, b: string, p: number): string {
  const x = parseHex(a);
  const y = parseHex(b);
  const t = clamp(p, 0, 1);
  return toHex(x.r + (y.r - x.r) * t, x.g + (y.g - x.g) * t, x.b + (y.b - x.b) * t);
}

export function sampleKeyframeColor(keys: Keyframe[] | undefined, t: number, fallback: string): string {
  if (!keys || !keys.length) return fallback;
  const ks = sortKeyframes(keys);
  if (t <= ks[0].t) return ks[0].c || fallback;
  const last = ks[ks.length - 1];
  if (t >= last.t) return last.c || fallback;
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i];
    const b = ks[i + 1];
    if (t >= a.t && t <= b.t) {
      const span = Math.max(0.0001, b.t - a.t);
      return mixHex(a.c || fallback, b.c || fallback, keyEase(a.easing, (t - a.t) / span));
    }
  }
  return fallback;
}

/** Relative luminance and WCAG contrast — read by the text-readability check. */
export function luminance(hex: string): number {
  const rgb = parseHex(hex);
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(rgb.r) + 0.7152 * ch(rgb.g) + 0.0722 * ch(rgb.b);
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return round3((hi + 0.05) / (lo + 0.05));
}

export type FontId = 'inter' | 'anton' | 'bebas' | 'montserrat' | 'oswald' | 'playfair' | 'dmsans' | 'mono';

export const FONTS: { id: FontId; label: string }[] = [
  { id: 'inter', label: 'Inter' },
  { id: 'anton', label: 'Anton' },
  { id: 'bebas', label: 'Bebas Neue' },
  { id: 'montserrat', label: 'Montserrat' },
  { id: 'oswald', label: 'Oswald' },
  { id: 'playfair', label: 'Playfair Display' },
  { id: 'dmsans', label: 'DM Sans' },
  { id: 'mono', label: 'JetBrains Mono' },
];

export type GradeId = 'none' | 'cinematic' | 'warm' | 'cool' | 'bw' | 'vivid';

export const GRADES: { id: GradeId; label: string }[] = [
  { id: 'none', label: 'Original' },
  { id: 'cinematic', label: 'Cinematic' },
  { id: 'warm', label: 'Warm' },
  { id: 'cool', label: 'Cool' },
  { id: 'bw', label: 'B&W' },
  { id: 'vivid', label: 'Vivid' },
];

// ---------------------------------------------------------------------------
// 2. Transition library
// ---------------------------------------------------------------------------

export type TransitionId =
  | 'zoom' | 'whipPan' | 'motionBlur' | 'push' | 'slide'
  | 'scale' | 'spin' | 'glitch' | 'lightSweep' | 'maskReveal';

export type Direction = 'left' | 'right' | 'up' | 'down';

export interface TransitionSpec {
  id: TransitionId;
  label: string;
  blurb: string;
  /** Default duration in seconds — every transition ships inside the 0.3-0.6s band. */
  duration: number;
  easing: EasingId;
  directional: boolean;
}

export const TRANSITIONS: TransitionSpec[] = [
  { id: 'zoom', label: 'Zoom', blurb: 'Scale punch straight into the next clip.', duration: 0.4, easing: 'expoOut', directional: false },
  { id: 'whipPan', label: 'Whip Pan', blurb: 'Fast directional whip with motion blur.', duration: 0.35, easing: 'easeInOut', directional: true },
  { id: 'motionBlur', label: 'Motion Blur', blurb: 'Directional blur handoff between scenes.', duration: 0.45, easing: 'easeInOut', directional: true },
  { id: 'push', label: 'Push', blurb: 'The incoming clip pushes the outgoing one out.', duration: 0.5, easing: 'easeInOut', directional: true },
  { id: 'slide', label: 'Slide', blurb: 'Clean directional slide over the outgoing clip.', duration: 0.45, easing: 'easeOut', directional: true },
  { id: 'scale', label: 'Scale', blurb: 'Scale-up reveal with a soft overshoot.', duration: 0.45, easing: 'back', directional: false },
  { id: 'spin', label: 'Spin', blurb: 'Rotation swap between the two scenes.', duration: 0.5, easing: 'easeInOut', directional: false },
  { id: 'glitch', label: 'Glitch', blurb: 'RGB split, slice offset and a noise flash.', duration: 0.3, easing: 'linear', directional: false },
  { id: 'lightSweep', label: 'Light Sweep', blurb: 'Bright flare sweeps across and hands over.', duration: 0.5, easing: 'easeInOut', directional: true },
  { id: 'maskReveal', label: 'Mask Reveal', blurb: 'Shape-based wipe reveals the next clip.', duration: 0.55, easing: 'expoOut', directional: true },
];

export function transitionSpec(id: TransitionId): TransitionSpec {
  return TRANSITIONS.find((t) => t.id === id) || TRANSITIONS[0];
}

export interface TransitionInstance {
  id: string;
  type: TransitionId;
  /** The transition sits on the cut AFTER this clip. */
  afterClipId: string;
  duration: number;
  easing: EasingId;
  direction: Direction;
  /** Mask shape, only read by maskReveal. */
  shape: 'circle' | 'bar' | 'diagonal';
  enabled: boolean;
  /** A locked layer is never rewritten by a preset or by the pacing engine. */
  locked: boolean;
  /**
   * Snap this cut to the nearest detected music beat. The snap is applied at
   * EDIT time (it re-trims the clips either side so the cut lands on the
   * beat), never at render time — so the preview and the render can never
   * disagree about where the handoff happens.
   */
  syncToBeat: boolean;
}

export function newTransition(afterClipId: string, type: TransitionId): TransitionInstance {
  const spec = transitionSpec(type);
  return {
    id: uid('tr'),
    type,
    afterClipId,
    duration: spec.duration,
    easing: spec.easing,
    direction: 'left',
    shape: 'circle',
    enabled: true,
    locked: false,
    syncToBeat: false,
  };
}

// ---------------------------------------------------------------------------
// 7. Camera simulation (clip segments inside the VIDEO layer)
// ---------------------------------------------------------------------------

export type CameraAngle = 'wide' | 'medium' | 'closeUp' | 'punchIn' | 'sideCropLeft' | 'sideCropRight';

export interface CameraSpec {
  id: CameraAngle;
  label: string;
  blurb: string;
  /** Digital crop factor — 1 is the full reframed picture. */
  zoom: number;
  /** Horizontal / vertical bias applied on top of the tracked subject point. */
  dx: number;
  dy: number;
  /** Seconds the move takes when easing into this angle. */
  blend: number;
}

export const CAMERAS: CameraSpec[] = [
  { id: 'wide', label: 'Wide', blurb: 'The full subject, no digital crop.', zoom: 1, dx: 0, dy: 0, blend: 0.6 },
  { id: 'medium', label: 'Medium', blurb: 'Waist-up crop, subject centred.', zoom: 1.32, dx: 0, dy: -0.06, blend: 0.6 },
  { id: 'closeUp', label: 'Close Up', blurb: 'Shoulders-up crop on the tracked face.', zoom: 1.78, dx: 0, dy: -0.11, blend: 0.6 },
  { id: 'punchIn', label: 'Punch In', blurb: 'Fast push to the face for an emphasis beat.', zoom: 2.1, dx: 0, dy: -0.13, blend: 0.22 },
  { id: 'sideCropLeft', label: 'Side Crop L', blurb: 'Subject offset left, room for graphics on the right.', zoom: 1.45, dx: -0.14, dy: -0.04, blend: 0.6 },
  { id: 'sideCropRight', label: 'Side Crop R', blurb: 'Subject offset right, room for graphics on the left.', zoom: 1.45, dx: 0.14, dy: -0.04, blend: 0.6 },
];

export function cameraSpec(id: CameraAngle): CameraSpec {
  return CAMERAS.find((c) => c.id === id) || CAMERAS[0];
}

/** One simulated angle, in clip-local CONTENT seconds. */
export interface CameraSegment {
  id: string;
  angle: CameraAngle;
  start: number;
  end: number;
  /**
   * How long the move INTO this angle takes, in seconds. Left undefined the
   * angle's own default blend is used, which is how every Phase 1 project was
   * timed; set it and this one move eases over your own duration instead.
   * It is never zero at render time, so a camera change is always a move and
   * never a jump cut.
   */
  blend?: number;
  /** A locked move survives a preset switch and a pacing re-plan. */
  locked?: boolean;
}

/** The blend actually used for a move: the override when set, else the angle's own. */
export function cameraBlend(seg: CameraSegment): number {
  const override = Number(seg.blend);
  if (Number.isFinite(override) && override > 0) return clamp(override, MIN_CAMERA_BLEND, 4);
  return cameraSpec(seg.angle).blend;
}

/** Shortest camera move that still reads as a move rather than a cut. */
export const MIN_CAMERA_BLEND = 0.12;

// ---------------------------------------------------------------------------
// 1a. Reframe and subject tracking
// ---------------------------------------------------------------------------

/** A tracked subject point in normalised source coordinates. */
export interface FocusPoint { t: number; x: number; y: number }

export interface ReframeState {
  mode: 'auto' | 'center' | 'manual';
  /** Manual anchor, normalised. */
  x: number;
  y: number;
  /** Smoothed subject path from the analysis pass (clip-local source seconds). */
  focus: FocusPoint[];
  /** How the analysis pass found the subject, surfaced in the UI. */
  source: 'none' | 'face-detector' | 'saliency';
  confidence: number;
}

// ---------------------------------------------------------------------------
// 8. Subject segmentation + depth compositing
// ---------------------------------------------------------------------------

/** A subject box in normalised SOURCE coordinates — centre plus size. */
export interface SubjectBox { t: number; x: number; y: number; w: number; h: number }

export type SubjectShape = 'ellipse' | 'rounded' | 'column';

export const SUBJECT_SHAPES: { id: SubjectShape; label: string; blurb: string }[] = [
  { id: 'ellipse', label: 'Ellipse', blurb: 'Soft oval cutout — the safest shape for a talking head.' },
  { id: 'rounded', label: 'Rounded box', blurb: 'Rounded rectangle — suits products and screens.' },
  { id: 'column', label: 'Column', blurb: 'Full-height vertical band — keeps a standing subject whole.' },
];

/**
 * Where the presenter / product is, so graphics can sit BEHIND them.
 *
 * The boxes are produced by the segmentation pass (Gemini vision, with the
 * local face / saliency tracker as the fallback) and the mask is built from
 * them geometrically. `mode: 'off'` means no depth stack at all and the clip
 * renders exactly as it did on the Phase 1 engine.
 */
export interface SubjectState {
  mode: 'off' | 'auto' | 'manual';
  boxes: SubjectBox[];
  /** Read when mode is manual, and as the fallback when nothing was detected. */
  box: { x: number; y: number; w: number; h: number };
  source: 'none' | 'gemini-vision' | 'face-detector' | 'saliency' | 'manual';
  confidence: number;
  note: string;
  shape: SubjectShape;
  /** Mask softness: 0 is a hard cutout edge, 1 is fully feathered. */
  feather: number;
  /** Mask padding multipliers around the detected box. */
  padX: number;
  padY: number;
}

/** The look of the depth composite — subject treatment plus background grade. */
export interface SubjectFx {
  /** Master switch for the depth composite on this clip. */
  enabled: boolean;
  outline: number;
  outlineColor: string;
  glow: number;
  glowColor: string;
  shadow: number;
  /** Blur and dim applied to the BACKGROUND plate, leaving the subject sharp. */
  depthBlur: number;
  backgroundDim: number;
}

export function newSubjectState(): SubjectState {
  return {
    mode: 'off',
    boxes: [],
    box: { x: 0.5, y: 0.56, w: 0.64, h: 0.9 },
    source: 'none',
    confidence: 0,
    note: '',
    shape: 'ellipse',
    feather: 0.3,
    padX: 1.1,
    padY: 1.05,
  };
}

export function newSubjectFx(): SubjectFx {
  return {
    enabled: false,
    outline: 0,
    outlineColor: '#FFFFFF',
    glow: 0,
    glowColor: '#F59E0B',
    shadow: 0,
    depthBlur: 0,
    backgroundDim: 0,
  };
}

/** The box the mask uses at a given SOURCE time, interpolated between samples. */
export function subjectBoxAt(subject: SubjectState, srcT: number): { x: number; y: number; w: number; h: number } {
  if (!subject) return { x: 0.5, y: 0.56, w: 0.64, h: 0.9 };
  const bs = Array.isArray(subject.boxes) ? subject.boxes : [];
  if (subject.mode === 'manual' || !bs.length) return subject.box;
  if (srcT <= bs[0].t) return bs[0];
  const last = bs[bs.length - 1];
  if (srcT >= last.t) return last;
  for (let i = 0; i < bs.length - 1; i++) {
    const a = bs[i];
    const b = bs[i + 1];
    if (srcT >= a.t && srcT <= b.t) {
      const p = (srcT - a.t) / Math.max(0.0001, b.t - a.t);
      return {
        x: a.x + (b.x - a.x) * p,
        y: a.y + (b.y - a.y) * p,
        w: a.w + (b.w - a.w) * p,
        h: a.h + (b.h - a.h) * p,
      };
    }
  }
  return subject.box;
}

// ---------------------------------------------------------------------------
// 1b. Clips
// ---------------------------------------------------------------------------

export interface Clip {
  id: string;
  name: string;
  src: string;
  srcW: number;
  srcH: number;
  srcDuration: number;
  /** Content the creator kept, in source seconds. Transitions borrow from OUTSIDE this range. */
  in: number;
  out: number;
  speed: number;
  volume: number;
  muted: boolean;
  grade: GradeId;
  reframe: ReframeState;
  camera: CameraSegment[];
  /** Where the presenter / product is, for the depth composite. */
  subject: SubjectState;
  /** How the depth composite looks on this clip. */
  subjectFx: SubjectFx;
  enabled: boolean;
  locked: boolean;
}

export function sourceOrientation(w: number, h: number): 'portrait' | 'landscape' | 'square' {
  if (!w || !h) return 'landscape';
  const r = w / h;
  if (r > 1.08) return 'landscape';
  if (r < 0.92) return 'portrait';
  return 'square';
}

export function newClip(fields: {
  name: string; src: string; srcW: number; srcH: number; srcDuration: number;
}): Clip {
  const dur = Math.max(0.2, fields.srcDuration || 0);
  return {
    id: uid('clip'),
    name: fields.name,
    src: fields.src,
    srcW: fields.srcW || 1920,
    srcH: fields.srcH || 1080,
    srcDuration: dur,
    in: 0,
    out: dur,
    speed: 1,
    volume: 1,
    muted: false,
    grade: 'none',
    reframe: { mode: 'auto', x: 0.5, y: 0.42, focus: [], source: 'none', confidence: 0 },
    camera: [],
    subject: newSubjectState(),
    subjectFx: newSubjectFx(),
    enabled: true,
    locked: false,
  };
}

/** Output seconds the clip's kept content occupies. */
export function clipContentDuration(c: Clip): number {
  return Math.max(0.05, (c.out - c.in) / Math.max(0.1, c.speed));
}

/** Output seconds of unused source available BEFORE the in point (transition handle). */
export function handleIn(c: Clip): number {
  return Math.max(0, c.in) / Math.max(0.1, c.speed);
}

/** Output seconds of unused source available AFTER the out point (transition handle). */
export function handleOut(c: Clip): number {
  return Math.max(0, c.srcDuration - c.out) / Math.max(0.1, c.speed);
}

// ---------------------------------------------------------------------------
// 4. Captions — mixed styles in one video, per-word
// ---------------------------------------------------------------------------

export type CaptionStyleId =
  | 'normal' | 'bold' | 'huge' | 'highlighted'
  | 'animated' | 'differentFont' | 'differentColor' | 'kinetic';

export const CAPTION_STYLES: { id: CaptionStyleId; label: string; blurb: string }[] = [
  { id: 'normal', label: 'Normal', blurb: 'Regular weight body caption.' },
  { id: 'bold', label: 'Bold', blurb: 'Heavy weight for a stressed word.' },
  { id: 'huge', label: 'Huge', blurb: 'Oversized keyword that owns the frame.' },
  { id: 'highlighted', label: 'Highlighted', blurb: 'Accent block painted behind the word.' },
  { id: 'animated', label: 'Animated', blurb: 'Per-character motion on this word only.' },
  { id: 'differentFont', label: 'Different Font', blurb: 'Switches typeface mid-sentence.' },
  { id: 'differentColor', label: 'Different Color', blurb: 'Accent colour mid-sentence.' },
  { id: 'kinetic', label: 'Kinetic', blurb: 'Word carries velocity and settles on a spring.' },
];

export type CaptionAnimId =
  | 'wordByWord' | 'charByChar' | 'pop' | 'bounce' | 'slideUp' | 'slideIn'
  | 'blurIn' | 'scale' | 'highlightSweep' | 'trackingReveal' | 'punchIn';

export const CAPTION_ANIMS: { id: CaptionAnimId; label: string; blurb: string }[] = [
  { id: 'wordByWord', label: 'Word by Word', blurb: 'Words appear on their own timestamp.' },
  { id: 'charByChar', label: 'Char by Char', blurb: 'Typewriter reveal across the word.' },
  { id: 'pop', label: 'Pop', blurb: 'Scale punch on entry.' },
  { id: 'bounce', label: 'Bounce', blurb: 'Spring bounce settle.' },
  { id: 'slideUp', label: 'Slide Up', blurb: 'Rises into place.' },
  { id: 'slideIn', label: 'Slide In', blurb: 'Enters from the side.' },
  { id: 'blurIn', label: 'Blur In', blurb: 'Blur-to-sharp reveal.' },
  { id: 'scale', label: 'Scale', blurb: 'Grows from nothing.' },
  { id: 'highlightSweep', label: 'Highlight Sweep', blurb: 'Highlight colour sweeps left to right.' },
  { id: 'trackingReveal', label: 'Tracking Reveal', blurb: 'Letter-spacing collapses inward.' },
  { id: 'punchIn', label: 'Punch In', blurb: 'Scale overshoot then settle.' },
];

export interface CaptionWord {
  id: string;
  text: string;
  /** Absolute timeline seconds, driven by word timestamps. */
  start: number;
  end: number;
  style: CaptionStyleId;
  anim: CaptionAnimId;
  /** Overrides, only read when the style asks for them. */
  color?: string;
  font?: FontId;
  /** Small rotational shake, used with Huge + Pop for a stressed word. */
  shake?: boolean;
}

export interface CaptionCue {
  id: string;
  start: number;
  end: number;
  words: CaptionWord[];
  /** Canvas-pixel centre of the cue block. */
  x: number;
  y: number;
  align: 'left' | 'center' | 'right';
  /** Block width as a share of the canvas (QC keeps it inside the safe area). */
  widthPct: number;
  font: FontId;
  baseSize: number;
  color: string;
  accent: string;
  outline: number;
  enabled: boolean;
  /** A locked cue keeps its styling through a preset switch or a re-plan. */
  locked: boolean;
}

export function newCaptionCue(start: number, end: number, words: CaptionWord[], base?: Partial<CaptionCue>): CaptionCue {
  return {
    id: uid('cap'),
    start: round3(start),
    end: round3(end),
    words,
    x: CANVAS_W / 2,
    y: Math.round(CANVAS_H * 0.74),
    align: 'center',
    widthPct: 0.8,
    font: 'inter',
    baseSize: 74,
    color: '#FFFFFF',
    accent: '#F59E0B',
    outline: 6,
    enabled: true,
    locked: false,
    ...(base || {}),
  };
}

// ---------------------------------------------------------------------------
// 3. Motion graphics primitives
// ---------------------------------------------------------------------------

export type GraphicType =
  | 'arrow' | 'circle' | 'ring' | 'underline' | 'box'
  | 'callout' | 'label' | 'dots' | 'line' | 'progressBar' | 'uiCard'
  // Phase 3 / Phase 4 primitives: visual inserts, mockups and tech surfaces.
  | 'statCard' | 'arrowDiagram' | 'icon' | 'browserMockup' | 'phoneMockup'
  | 'gridOverlay' | 'glow'
  // Phase 2 motion-graphics expansion: particles, light, UI and interaction.
  | 'confetti' | 'sparkles' | 'fireSparks' | 'speedLines'
  | 'glowRing' | 'lightStreak' | 'radialBurst'
  | 'featureCard' | 'cursorClick' | 'notification' | 'animatedBorder';

/** The primitives whose look is driven by a scattered particle field. */
export const PARTICLE_TYPES: GraphicType[] = ['confetti', 'sparkles', 'fireSparks', 'speedLines', 'radialBurst'];

export function isParticleType(type: GraphicType): boolean {
  return PARTICLE_TYPES.indexOf(type) >= 0;
}

/** Built-in vector glyphs — the engine cannot import an icon font. */
export type IconId = 'spark' | 'bulb' | 'gear' | 'check' | 'bolt' | 'chart' | 'lock' | 'cloud' | 'target' | 'rocket';

export const ICONS: { id: IconId; label: string }[] = [
  { id: 'spark', label: 'Spark' },
  { id: 'bulb', label: 'Idea' },
  { id: 'gear', label: 'Process' },
  { id: 'check', label: 'Check' },
  { id: 'bolt', label: 'Speed' },
  { id: 'chart', label: 'Growth' },
  { id: 'lock', label: 'Secure' },
  { id: 'cloud', label: 'Cloud' },
  { id: 'target', label: 'Target' },
  { id: 'rocket', label: 'Launch' },
];

export interface GraphicSpec {
  id: GraphicType;
  label: string;
  blurb: string;
  w: number;
  h: number;
  text: string;
}

export const GRAPHICS: GraphicSpec[] = [
  { id: 'arrow', label: 'Animated Arrow', blurb: 'Directional arrow with a styleable tip and shaft.', w: 340, h: 180, text: '' },
  { id: 'circle', label: 'Animated Circle', blurb: 'Stroke-draw circle that rings a detail.', w: 380, h: 380, text: '' },
  { id: 'ring', label: 'Animated Ring', blurb: 'Double stroke-draw ring with a pulse.', w: 380, h: 380, text: '' },
  { id: 'underline', label: 'Animated Underline', blurb: 'Sweeps under a line of text.', w: 520, h: 40, text: '' },
  { id: 'box', label: 'Animated Box', blurb: 'Border-draw reveal around a region.', w: 520, h: 300, text: '' },
  { id: 'callout', label: 'Callout', blurb: 'Bubble with a pointer and a label.', w: 520, h: 170, text: 'Look here' },
  { id: 'label', label: 'Label', blurb: 'Floating tag on a solid background.', w: 420, h: 110, text: 'New' },
  { id: 'dots', label: 'Animated Dots', blurb: 'Dots appearing in sequence.', w: 320, h: 80, text: '' },
  { id: 'line', label: 'Animated Line', blurb: 'Straight or curved connector.', w: 480, h: 240, text: '' },
  { id: 'progressBar', label: 'Progress Bar', blurb: 'Fill animation with an optional label.', w: 620, h: 90, text: '72%' },
  { id: 'uiCard', label: 'UI Card', blurb: 'Frosted card surface for SaaS screenshots.', w: 760, h: 460, text: 'Dashboard' },
  { id: 'statCard', label: 'Stat Card', blurb: 'Animated number counting up to a figure.', w: 620, h: 300, text: '3.4x|conversion lift' },
  { id: 'arrowDiagram', label: 'Arrow Diagram', blurb: 'Connected steps with animated arrows between them.', w: 880, h: 220, text: 'Brief|Draft|Ship' },
  { id: 'icon', label: 'Animated Icon', blurb: 'Built-in vector glyph that draws itself in.', w: 260, h: 260, text: '' },
  { id: 'browserMockup', label: 'Browser Mockup', blurb: 'Browser chrome with an animated address bar.', w: 860, h: 540, text: 'yourapp.com' },
  { id: 'phoneMockup', label: 'Phone Mockup', blurb: 'Phone shell for a product screen or UGC shot.', w: 520, h: 1000, text: '' },
  { id: 'gridOverlay', label: 'Grid Overlay', blurb: 'Technical grid that wipes across the frame.', w: 1080, h: 1080, text: '' },
  { id: 'glow', label: 'Glow', blurb: 'Soft radial light bloom behind a subject or card.', w: 720, h: 720, text: '' },

  // --- Phase 2: particles -------------------------------------------------
  { id: 'confetti', label: 'Confetti', blurb: 'Celebration ribbons that burst out and tumble down.', w: 900, h: 940, text: '' },
  { id: 'sparkles', label: 'Sparkles', blurb: 'Four-point stars twinkling in and out across the box.', w: 720, h: 720, text: '' },
  { id: 'fireSparks', label: 'Fire Sparks', blurb: 'Embers rising and cooling as they climb.', w: 640, h: 860, text: '' },
  { id: 'speedLines', label: 'Speed Lines', blurb: 'Motion lines racing across the frame in one direction.', w: 1080, h: 1080, text: '' },

  // --- Phase 2: glow and light -------------------------------------------
  { id: 'glowRing', label: 'Glow Ring', blurb: 'Neon ring that draws itself in and pulses on a bloom.', w: 640, h: 640, text: '' },
  { id: 'lightStreak', label: 'Light Streak', blurb: 'Bright streak sweeping across, with a lens flare core.', w: 1080, h: 520, text: '' },
  { id: 'radialBurst', label: 'Radial Burst', blurb: 'Rays firing outward from the centre on an impact beat.', w: 900, h: 900, text: '' },

  // --- Phase 2: UI, mockups and interaction ------------------------------
  { id: 'featureCard', label: 'Feature Card', blurb: 'Icon, title and supporting line on a frosted card.', w: 780, h: 300, text: 'Auto captions|Word-perfect timing' },
  { id: 'cursorClick', label: 'Cursor + Click', blurb: 'Cursor travels to a point and clicks with a ripple.', w: 520, h: 440, text: '' },
  { id: 'notification', label: 'Notification', blurb: 'Push notification that slides in, settles and lifts away.', w: 840, h: 230, text: 'New sale|Another order just landed' },
  { id: 'animatedBorder', label: 'Animated Border', blurb: 'Gradient border chasing around a region.', w: 800, h: 470, text: '' },
];

export function graphicSpec(id: GraphicType): GraphicSpec {
  return GRAPHICS.find((g) => g.id === id) || GRAPHICS[0];
}

/** A value that ramps across the layer's life. */
export interface Ramp { from: number; to: number }

// --- graphic tracking (a graphic that follows the subject) ------------------

export type TrackTarget = 'none' | 'face' | 'product';

export const TRACK_TARGETS: { id: TrackTarget; label: string; blurb: string }[] = [
  { id: 'none', label: 'Fixed position', blurb: 'The graphic stays exactly where you put it.' },
  { id: 'face', label: 'Follow the face', blurb: 'Pins to the tracked face centre for every frame.' },
  { id: 'product', label: 'Follow the product', blurb: 'Pins to the lower centre of the tracked subject box.' },
];

export interface GraphicTrack {
  target: TrackTarget;
  /** Offset from the tracked point, in canvas pixels. */
  offsetX: number;
  offsetY: number;
  /** 1 pins the graphic to the subject; lower values let it lag behind. */
  strength: number;
  /** Optional window — outside it the layer sits at its own x / y. */
  from: number | null;
  to: number | null;
}

export function newGraphicTrack(): GraphicTrack {
  return { target: 'none', offsetX: 0, offsetY: 0, strength: 1, from: null, to: null };
}

/**
 * One motion graphic. Every primitive honours the same eight channels:
 * Position -> Scale -> Rotation -> Opacity -> Blur -> Color -> Timing -> Easing.
 */
export interface GraphicLayer {
  id: string;
  type: GraphicType;
  /**
   * Z-order band. `auto` is resolved at compile time: behind the presenter
   * when the depth composite is on and the layer would otherwise cover them,
   * in front of the presenter in every other case.
   */
  band: GraphicBand;
  /** Absolute timeline seconds. */
  start: number;
  end: number;
  /** Centre position in canvas pixels. */
  x: number;
  y: number;
  /** Position drift across the layer's life, in canvas pixels. */
  dx: Ramp;
  dy: Ramp;
  w: number;
  h: number;
  scale: Ramp;
  rotation: Ramp;
  opacity: Ramp;
  blur: Ramp;
  color: string;
  color2: string;
  easing: EasingId;
  /** Entry / exit reveal length in seconds. */
  inDur: number;
  outDur: number;
  text: string;
  thickness: number;
  /** Target fill for progressBar, 0..1. */
  fill: number;
  direction: Direction;
  curved: boolean;
  enabled: boolean;
  /** A locked layer is never moved or rewritten by a preset or the pacer. */
  locked: boolean;
  /** Which built-in glyph the `icon` primitive draws. */
  icon: IconId;
  /**
   * How many elements a scattered primitive draws — confetti pieces, sparkles,
   * embers, speed lines, burst rays. Ignored by every other primitive.
   */
  count: number;
  /**
   * The scatter seed. Particle positions are derived from this number, never
   * from Math.random, so the same layer draws the same field in the preview
   * and in the render — change it to reshuffle the look.
   */
  seed: number;
  /** Per-channel keyframe curves. A keyed channel overrides its ramp. */
  keys: KeyframeTracks;
  /** Make the layer follow the tracked subject instead of sitting still. */
  track: GraphicTrack;
}

export type GraphicBand = 'background' | 'auto' | 'foreground';

export const GRAPHIC_BANDS: { id: GraphicBand; label: string }[] = [
  { id: 'background', label: 'Background — behind the presenter' },
  { id: 'auto', label: 'Auto — decided by subject detection' },
  { id: 'foreground', label: 'Foreground — in front of the presenter' },
];

/** Graphics that read as part of the scene rather than an overlay. */
const BACKGROUND_FIRST: GraphicType[] = [
  'uiCard', 'gridOverlay', 'glow', 'browserMockup',
  'speedLines', 'radialBurst', 'lightStreak',
];

export function newGraphic(type: GraphicType, start: number, end: number, accent: string, accent2: string): GraphicLayer {
  const spec = graphicSpec(type);
  return {
    id: uid('gfx'),
    type,
    band: BACKGROUND_FIRST.indexOf(type) >= 0 ? 'background' : 'foreground',
    start: round3(start),
    end: round3(Math.max(start + 0.4, end)),
    x: Math.round(CANVAS_W / 2),
    y: Math.round(CANVAS_H * 0.38),
    dx: { from: 0, to: 0 },
    dy: { from: 0, to: 0 },
    w: spec.w,
    h: spec.h,
    scale: { from: 1, to: 1 },
    rotation: { from: 0, to: 0 },
    opacity: { from: 1, to: 1 },
    blur: { from: 0, to: 0 },
    color: accent,
    color2: accent2,
    easing: 'expoOut',
    inDur: 0.42,
    outDur: 0.32,
    text: spec.text,
    thickness: 10,
    fill: 0.72,
    direction: 'right',
    curved: false,
    enabled: true,
    locked: false,
    icon: 'spark',
    count: type === 'speedLines' ? 18 : type === 'radialBurst' ? 20 : 26,
    seed: 7,
    keys: {},
    track: newGraphicTrack(),
  };
}

/**
 * The canvas region the presenter occupies after the 9:16 reframe. The crop is
 * anchored on the tracked subject, so the presenter always lands in this
 * central column — which is what lets `band: 'auto'` be decided from layout
 * alone, with no second copy of the engine's camera maths.
 */
export const SUBJECT_COLUMN = { x0: 0.2, x1: 0.8, y0: 0.16, y1: 1 };

/** Would this layer cover the presenter if it were drawn in front of them? */
export function coversSubjectColumn(g: GraphicLayer): boolean {
  // Auto placement has to follow the successor model's keyed channels. A
  // layer that starts beside the presenter but crosses them on an x/y or
  // scale curve belongs behind the subject for its whole life; switching bands
  // mid-layer would be a visible pop and would break preview/render parity.
  const span = Math.max(0.1, g.end - g.start);
  const scaleFallback = Math.max(g.scale.from, g.scale.to, 0.01);
  const ramp = (r: Ramp, life: number) => r.from + (r.to - r.from) * life;
  for (let i = 0; i <= 16; i++) {
    const life = i / 16;
    const at = g.start + span * life;
    const x = sampleKeyframes(g.keys && g.keys.x, at, g.x + ramp(g.dx, life));
    const y = sampleKeyframes(g.keys && g.keys.y, at, g.y + ramp(g.dy, life));
    const sx = Math.abs(sampleKeyframes(g.keys && g.keys.scaleX, at, scaleFallback));
    const sy = Math.abs(sampleKeyframes(g.keys && g.keys.scaleY, at, scaleFallback));
    const rotation = sampleKeyframes(g.keys && g.keys.rotation, at, ramp(g.rotation, life));
    const radians = rotation * Math.PI / 180;
    const cos = Math.abs(Math.cos(radians));
    const sin = Math.abs(Math.sin(radians));
    const halfW = (g.w * sx * cos + g.h * sy * sin) / 2;
    const halfH = (g.w * sx * sin + g.h * sy * cos) / 2;
    if (x - halfW < SUBJECT_COLUMN.x1 * CANVAS_W && x + halfW > SUBJECT_COLUMN.x0 * CANVAS_W
      && y - halfH < SUBJECT_COLUMN.y1 * CANVAS_H && y + halfH > SUBJECT_COLUMN.y0 * CANVAS_H) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// 5. Audio layer — voice, music and the dedicated SFX track
// ---------------------------------------------------------------------------

/** What a sound-effect clip was placed to punctuate. */
export type SfxAnchor = 'manual' | 'transition' | 'textAnimation' | 'graphicEntry' | 'hook' | 'beat';

export const SFX_ANCHORS: { id: SfxAnchor; label: string }[] = [
  { id: 'manual', label: 'Placed by hand' },
  { id: 'transition', label: 'On a transition' },
  { id: 'textAnimation', label: 'On a text animation' },
  { id: 'graphicEntry', label: 'On a graphic entry' },
  { id: 'hook', label: 'On the hook' },
  { id: 'beat', label: 'On a music beat' },
];

export interface AudioTrack {
  id: string;
  kind: 'voice' | 'music' | 'sfx';
  label: string;
  url: string;
  /** Absolute timeline seconds the track starts at. */
  at: number;
  volume: number;
  loop: boolean;
  enabled: boolean;
  /** Which library sound this is, empty for an uploaded file. */
  sfxId: string;
  /** Seconds the clip runs for. 0 means the whole file. */
  duration: number;
  /** Per-clip fades, in seconds, applied by the engine's volume curve. */
  fadeIn: number;
  fadeOut: number;
  /** What this clip was aligned to, so the editor can explain its position. */
  anchor: SfxAnchor;
  /** Human description of the event it punctuates, shown in the sound panel. */
  anchorNote: string;
  /** A locked clip is never moved by a re-align or a beat snap. */
  locked: boolean;
}

export interface ProjectAudio {
  voice: AudioTrack | null;
  music: AudioTrack | null;
  sfx: AudioTrack[];
}

export function newAudioTrack(kind: AudioTrack['kind'], label: string, url: string, at = 0): AudioTrack {
  return {
    id: uid('aud'),
    kind,
    label,
    url,
    at: round3(at),
    volume: kind === 'music' ? 0.26 : kind === 'sfx' ? 0.6 : 1,
    loop: kind === 'music',
    enabled: true,
    sfxId: '',
    duration: 0,
    fadeIn: kind === 'sfx' ? 0.01 : kind === 'music' ? 0.6 : 0,
    fadeOut: kind === 'sfx' ? 0.06 : kind === 'music' ? 1.2 : 0,
    anchor: 'manual',
    anchorNote: '',
    locked: false,
  };
}

/** Every audio clip in the project, in stack order, including the SFX track. */
export function audioTracks(audio: ProjectAudio): AudioTrack[] {
  const out: AudioTrack[] = [];
  if (audio.voice) out.push(audio.voice);
  if (audio.music) out.push(audio.music);
  for (const s of audio.sfx) out.push(s);
  return out;
}

// ---------------------------------------------------------------------------
// 5b. Beat detection — the music's own grid
// ---------------------------------------------------------------------------

/**
 * Beat timestamps measured from the music bed, in ABSOLUTE timeline seconds
 * (the music's start offset is already folded in), plus the tempo they imply.
 *
 * Nothing in the render reads this: beats are an EDITING grid. Snapping writes
 * real layer times into the project, so the preview and the render still see
 * exactly the same document and no beat maths has to exist twice.
 */
export interface BeatState {
  times: number[];
  bpm: number;
  source: 'none' | 'analysis' | 'tempo-grid';
  detectedAt: number | null;
  note: string;
  /** Master switch for the snapping passes. */
  syncEnabled: boolean;
  /** How far a layer may be moved to reach a beat, in seconds. */
  tolerance: number;
}

export function newBeatState(): BeatState {
  return {
    times: [],
    bpm: 0,
    source: 'none',
    detectedAt: null,
    note: '',
    syncEnabled: false,
    tolerance: 0.14,
  };
}

/** The nearest beat to `t`, or null when nothing is within `tolerance`. */
export function nearestBeat(beats: BeatState, t: number, tolerance?: number): number | null {
  const window = Math.max(0.01, tolerance == null ? beats.tolerance : tolerance);
  let best: number | null = null;
  let bestGap = Infinity;
  for (const b of beats.times) {
    const gap = Math.abs(b - t);
    if (gap < bestGap) { bestGap = gap; best = b; }
  }
  return best !== null && bestGap <= window ? round3(best) : null;
}

// ---------------------------------------------------------------------------
// 5c. Hook — the opening 1–3 seconds
// ---------------------------------------------------------------------------

export type HookTemplateId = 'statement' | 'number' | 'problem';

export const HOOK_TEMPLATES: { id: HookTemplateId; label: string; blurb: string }[] = [
  { id: 'statement', label: 'Statement', blurb: 'One line scales in hard, the camera pushes, an underline sweeps under it.' },
  { id: 'number', label: 'Number', blurb: 'A figure counts up or pops in, with a supporting line sliding in beneath.' },
  { id: 'problem', label: 'Problem', blurb: 'The words land one at a time and the key phrase takes the contrast colour.' },
];

export function hookTemplateLabel(id: HookTemplateId): string {
  const hit = HOOK_TEMPLATES.find((h) => h.id === id);
  return hit ? hit.label : id;
}

/**
 * The opening hook. It is the FIRST layer on the timeline: with `leadIn` above
 * zero it plays on its own before clip 1 starts (the compiler reserves that
 * time at the head and every clip moves back by it), and with `leadIn` at zero
 * it plays over the opening of clip 1 instead.
 */
export interface HookState {
  enabled: boolean;
  template: HookTemplateId;
  /** How long the hook holds the frame, in seconds. */
  duration: number;
  /** Seconds reserved BEFORE clip 1. Zero overlays the hook on the footage. */
  leadIn: number;
  /** Statement and Problem read this; Number uses it as a fallback label. */
  text: string;
  /** Problem: which words take the contrast colour, 1-based, comma separated. */
  emphasisWords: string;
  /** Number hook. */
  value: string;
  currency: string;
  support: string;
  countUp: boolean;
  /** Shared look. */
  font: FontId;
  fontSize: number;
  color: string;
  accent: string;
  emphasisColor: string;
  background: string;
  /** Scrim over the footage behind the hook, 0..1. */
  scrim: number;
  /** Extra scale the camera push adds across the hook. */
  push: number;
  locked: boolean;
}

export function newHook(template: HookTemplateId = 'statement'): HookState {
  return {
    enabled: true,
    template,
    duration: template === 'problem' ? 2.4 : 1.8,
    leadIn: template === 'problem' ? 2.4 : 1.8,
    text: template === 'problem' ? 'YOUR ADS AREN\u2019T CONVERTING' : 'STOP SCROLLING',
    emphasisWords: '3',
    value: '10000',
    currency: '\u20b9',
    support: 'in the first month',
    countUp: true,
    font: 'anton',
    fontSize: 128,
    color: '#FFFFFF',
    accent: '#F59E0B',
    emphasisColor: '#EF4444',
    background: '#05070C',
    scrim: 0.55,
    push: 0.12,
    locked: false,
  };
}

/** The 1-based word positions the Problem hook paints in the contrast colour. */
export function hookEmphasisIndexes(hook: HookState): number[] {
  return String(hook.emphasisWords || '')
    .split(/[,\s]+/)
    .map((part) => Math.round(Number(part)))
    .filter((n) => Number.isFinite(n) && n > 0);
}

// ---------------------------------------------------------------------------
// The project document
// ---------------------------------------------------------------------------

export type PresetId =
  | 'clean-saas' | 'high-energy' | 'creator' | 'educational'
  | 'cinematic' | 'ugc-ad' | 'tech';

export interface TranscriptWord { word: string; start: number; end: number }

// ---------------------------------------------------------------------------
// 9. The short-form pacing plan
// ---------------------------------------------------------------------------

export type PacingKind =
  | 'zoomPunch' | 'cameraMove' | 'captionEmphasis' | 'captionStyleSwitch'
  | 'hookCaption' | 'transitionTrigger' | 'graphicAccent';

export const PACING_KINDS: { id: PacingKind; label: string; blurb: string }[] = [
  { id: 'zoomPunch', label: 'Zoom punch-in', blurb: 'A fast push to the subject on a stressed word.' },
  { id: 'cameraMove', label: 'Camera move', blurb: 'A new simulated angle, to break a static shot.' },
  { id: 'captionEmphasis', label: 'Caption emphasis', blurb: 'Promote the word to the pack\u2019s emphasis treatment.' },
  { id: 'captionStyleSwitch', label: 'Caption style switch', blurb: 'Change the cue\u2019s treatment \u2014 used on questions.' },
  { id: 'hookCaption', label: 'Hook treatment', blurb: 'Oversized hook-style caption on a strong statement.' },
  { id: 'transitionTrigger', label: 'Transition trigger', blurb: 'A scene-change word that wants a cut handoff.' },
  { id: 'graphicAccent', label: 'Graphic accent', blurb: 'A motion graphic on the beat.' },
];

export function pacingKindLabel(id: PacingKind): string {
  const hit = PACING_KINDS.find((k) => k.id === id);
  return hit ? hit.label : id;
}

/** One decision the pacing engine made, reviewable before it is applied. */
export interface PacingItem {
  id: string;
  kind: PacingKind;
  /** Absolute timeline seconds. */
  at: number;
  end: number;
  /** 0..1 — how hard the effect hits. */
  intensity: number;
  /** The rule that fired, shown verbatim in the editable list. */
  reason: string;
  /** The word or phrase that triggered it. */
  trigger: string;
  clipId: string | null;
  /** Unticking an item leaves it in the plan but out of the apply pass. */
  enabled: boolean;
  applied: boolean;
  /** Set when the item was skipped because the target layer is locked. */
  blockedBy: string;
}

export interface PacingPlan {
  items: PacingItem[];
  generatedAt: number | null;
  note: string;
}

export function newPacingPlan(): PacingPlan {
  return { items: [], generatedAt: null, note: '' };
}

// ---------------------------------------------------------------------------
// 10. Auto B-roll / visual inserts
// ---------------------------------------------------------------------------

export type InsertKind = 'product' | 'data' | 'process' | 'concept';

export const INSERT_KINDS: { id: InsertKind; label: string; blurb: string }[] = [
  { id: 'product', label: 'Product / SaaS', blurb: 'A UI card, browser or phone mockup.' },
  { id: 'data', label: 'Data / number', blurb: 'A stat card or animated number.' },
  { id: 'process', label: 'Process / workflow', blurb: 'An animated arrow diagram.' },
  { id: 'concept', label: 'Concept', blurb: 'A relevant animated icon or graphic.' },
];

/** A suggested visual insert, placed as a real MG layer only once accepted. */
export interface InsertSuggestion {
  id: string;
  at: number;
  end: number;
  /** The transcript phrase it came from. */
  phrase: string;
  concept: string;
  kind: InsertKind;
  graphicType: GraphicType;
  icon: IconId;
  text: string;
  band: GraphicBand;
  reason: string;
  status: 'pending' | 'accepted' | 'rejected';
  /** The layer id once accepted, so rejecting it again can remove the layer. */
  graphicId: string | null;
}

export interface Project {
  specVersion: number;
  rowId: number | null;
  title: string;
  presetId: PresetId;
  canvas: { w: number; h: number; fps: number };
  background: string;
  /** The opening hook, or null when the video starts straight on clip 1. */
  hook: HookState | null;
  /** The music's beat grid, used to snap edits — never read at render time. */
  beats: BeatState;
  clips: Clip[];
  transitions: TransitionInstance[];
  captions: CaptionCue[];
  graphics: GraphicLayer[];
  audio: ProjectAudio;
  /** Word timestamps the caption engine was built from (source seconds of clip 1). */
  transcript: TranscriptWord[];
  transcriptText: string;
  /** The reviewable pacing plan (Phase 3) — never auto-applied. */
  pacing: PacingPlan;
  /** Suggested visual inserts awaiting accept / reject / swap (Phase 3). */
  inserts: InsertSuggestion[];
  accent: string;
  accent2: string;
  renderUrl: string | null;
  renderGeometry: string | null;
  renderOperationId: string | null;
}

export function newProject(title = 'Untitled short'): Project {
  return {
    specVersion: MOTION_SPEC_VERSION,
    rowId: null,
    title,
    presetId: 'creator',
    canvas: { w: CANVAS_W, h: CANVAS_H, fps: FPS },
    background: '#05070C',
    hook: null,
    beats: newBeatState(),
    clips: [],
    transitions: [],
    captions: [],
    graphics: [],
    audio: { voice: null, music: null, sfx: [] },
    transcript: [],
    transcriptText: '',
    pacing: newPacingPlan(),
    inserts: [],
    accent: '#F59E0B',
    accent2: '#FBBF24',
    renderUrl: null,
    renderGeometry: null,
    renderOperationId: null,
  };
}

// ---------------------------------------------------------------------------
// The timeline compiler
// ---------------------------------------------------------------------------

export interface PlacedCameraSegment {
  angle: CameraAngle;
  /** Clip-local CONTENT seconds. */
  start: number;
  end: number;
  blend: number;
}

export interface PlacedClip {
  id: string;
  src: string;
  /** Absolute frame the clip's SEQUENCE starts at (content start minus its in-handle). */
  from: number;
  frames: number;
  /** Source frame range handed to OffthreadVideo. */
  startFrom: number;
  endAt: number;
  speed: number;
  volume: number;
  /** Frames between the sequence start and the first frame of kept content. */
  contentOffset: number;
  contentFrames: number;
  srcW: number;
  srcH: number;
  grade: GradeId;
  reframe: { mode: ReframeState['mode']; x: number; y: number; focus: FocusPoint[] };
  camera: PlacedCameraSegment[];
  /** Subject mask + depth-composite look, read by the depth stack. */
  subject: SubjectState;
  subjectFx: SubjectFx;
  /** True when this clip renders a masked subject copy above background MG. */
  depth: boolean;
  /** Absolute frame windows of the transitions this clip takes part in. */
  inTrans: { type: TransitionId; easing: EasingId; direction: Direction; shape: string; from: number; frames: number } | null;
  outTrans: { type: TransitionId; easing: EasingId; direction: Direction; shape: string; from: number; frames: number } | null;
}

export interface PlacedTransition {
  id: string;
  type: TransitionId;
  easing: EasingId;
  direction: Direction;
  shape: string;
  from: number;
  frames: number;
  /** Requested vs granted duration, in seconds — the QC gate reads this. */
  requested: number;
  granted: number;
  fromClipId: string;
  toClipId: string;
}

export interface CompiledTimeline {
  totalFrames: number;
  durationS: number;
  clips: PlacedClip[];
  transitions: PlacedTransition[];
  /** Content start / end of every clip in absolute output seconds, for the UI ruler. */
  contentSpans: { id: string; name: string; start: number; end: number }[];
  /** Seconds the hook holds before clip 1 starts. Zero when there is no lead-in. */
  leadInS: number;
  notes: string[];
}

/**
 * Compile the project into absolute frames.
 *
 * The rule that makes a transition a TRANSITION and not an accidental cut:
 * the kept content of every clip plays in full. An overlap is paid for out of
 * the unused source on either side of the in/out points (the handles), split
 * evenly across the cut, so the outgoing clip runs past its out point while
 * the incoming clip pre-rolls before its in point. When a handle is too short
 * the overlap shrinks to what the footage can actually pay for and the
 * shortfall is reported, rather than eating the creator's content.
 */
export function compileTimeline(project: Project): CompiledTimeline {
  const fps = project.canvas.fps || FPS;
  const clips = project.clips.filter((c) => c.enabled && c.src);
  const notes: string[] = [];
  // The hook's lead-in is the only thing that can add time to the timeline,
  // and it adds it at the HEAD: clip 1 starts after it rather than under it.
  const hook = project.hook && project.hook.enabled ? project.hook : null;
  const leadInS = hook ? round3(clamp(hook.leadIn, 0, 6)) : 0;
  if (!clips.length) {
    const bare = Math.max(1, leadInS || 1);
    return {
      totalFrames: Math.max(fps, Math.round(bare * fps)),
      durationS: round3(bare),
      clips: [],
      transitions: [],
      contentSpans: [],
      leadInS,
      notes: [hook ? 'Only the hook is on the timeline — add a clip for it to open.' : 'No clips in the VIDEO layer yet.'],
    };
  }

  // Pass 1 — lay the kept content end to end after the hook's lead-in. Total
  // duration is the lead-in plus the sum of the clip contents and nothing
  // else; transitions never add or remove time.
  const spans: { clip: Clip; start: number; end: number; dur: number }[] = [];
  let cursor = leadInS;
  for (const c of clips) {
    const dur = clipContentDuration(c);
    spans.push({ clip: c, start: cursor, end: cursor + dur, dur });
    cursor += dur;
  }
  const totalS = cursor;

  // Pass 2 — decide each cut's overlap from the handles available on both sides.
  const halves: { half: number; tr: TransitionInstance; aIndex: number }[] = [];
  for (let i = 0; i < spans.length - 1; i++) {
    const a = spans[i];
    const b = spans[i + 1];
    const tr = project.transitions.find((t) => t.enabled && t.afterClipId === a.clip.id);
    if (!tr) { halves.push({ half: 0, tr: newTransition(a.clip.id, 'push'), aIndex: i }); continue; }
    const wantHalf = Math.max(0, tr.duration) / 2;
    const half = Math.min(
      wantHalf,
      handleOut(a.clip),
      handleIn(b.clip),
      a.dur * 0.25,
      b.dur * 0.25,
    );
    const granted = half * 2;
    if (granted < MIN_TRANSITION_S) {
      notes.push(
        'The ' + transitionSpec(tr.type).label + ' transition after "' + a.clip.name + '" has no footage to run on, so it is playing as a straight cut. ' +
        'Trim the clips a little (leave spare source on either side of the cut) and it will animate.',
      );
      halves.push({ half: 0, tr, aIndex: i });
    } else {
      if (granted < tr.duration - 0.02) {
        notes.push(
          'The ' + transitionSpec(tr.type).label + ' transition after "' + a.clip.name + '" was shortened to ' + granted.toFixed(2) +
          's — that is all the spare footage either side of the cut allows. No part of either clip was cut.',
        );
      }
      halves.push({ half, tr, aIndex: i });
    }
  }

  // Pass 3 — place sequences, source ranges and transition windows.
  const placed: PlacedClip[] = [];
  const placedTransitions: PlacedTransition[] = [];

  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    const c = s.clip;
    const prev = i > 0 ? halves[i - 1] : null;
    const next = i < halves.length ? halves[i] : null;
    const halfIn = prev ? prev.half : 0;
    const halfOut = next ? next.half : 0;
    const seqStartS = Math.max(0, s.start - halfIn);
    const seqEndS = s.end + halfOut;
    const from = Math.round(seqStartS * fps);
    const frames = Math.max(1, Math.round(seqEndS * fps) - from);
    const srcStart = Math.max(0, c.in - halfIn * c.speed);
    const srcEnd = Math.min(c.srcDuration, c.out + halfOut * c.speed);

    const inTrans = prev && prev.half > 0
      ? {
          type: prev.tr.type, easing: prev.tr.easing, direction: prev.tr.direction, shape: prev.tr.shape,
          from: Math.round((s.start - prev.half) * fps), frames: Math.max(1, Math.round(prev.half * 2 * fps)),
        }
      : null;
    const outTrans = next && next.half > 0
      ? {
          type: next.tr.type, easing: next.tr.easing, direction: next.tr.direction, shape: next.tr.shape,
          from: Math.round((s.end - next.half) * fps), frames: Math.max(1, Math.round(next.half * 2 * fps)),
        }
      : null;

    placed.push({
      id: c.id,
      src: c.src,
      from,
      frames,
      startFrom: Math.max(0, Math.round(srcStart * fps)),
      endAt: Math.max(1, Math.round(srcEnd * fps)),
      speed: c.speed,
      volume: c.muted ? 0 : clamp(c.volume, 0, 1),
      contentOffset: Math.round(halfIn * fps),
      contentFrames: Math.max(1, Math.round(s.dur * fps)),
      srcW: c.srcW,
      srcH: c.srcH,
      grade: c.grade,
      reframe: { mode: c.reframe.mode, x: c.reframe.x, y: c.reframe.y, focus: c.reframe.focus.slice(0, 400) },
      camera: c.camera
        .slice()
        .sort((p, q) => p.start - q.start)
        .map((seg) => ({ angle: seg.angle, start: seg.start, end: seg.end, blend: cameraBlend(seg) })),
      subject: c.subject || newSubjectState(),
      subjectFx: c.subjectFx || newSubjectFx(),
      depth: !!(c.subjectFx && c.subjectFx.enabled && c.subject && c.subject.mode !== 'off'),
      inTrans,
      outTrans,
    });

    if (next && next.half > 0) {
      placedTransitions.push({
        id: next.tr.id,
        type: next.tr.type,
        easing: next.tr.easing,
        direction: next.tr.direction,
        shape: next.tr.shape,
        from: Math.round((s.end - next.half) * fps),
        frames: Math.max(1, Math.round(next.half * 2 * fps)),
        requested: next.tr.duration,
        granted: round3(next.half * 2),
        fromClipId: c.id,
        toClipId: spans[i + 1].clip.id,
      });
    }
  }

  return {
    totalFrames: Math.max(fps, Math.round(totalS * fps)),
    durationS: round3(totalS),
    clips: placed,
    transitions: placedTransitions,
    contentSpans: spans.map((s) => ({ id: s.clip.id, name: s.clip.name, start: round3(s.start), end: round3(s.end) })),
    leadInS,
    notes,
  };
}

/**
 * Resolve a graphic's Z-order band into the one the compositing stack uses.
 *
 * `auto` only ever becomes `background` when the clip under it is rendering a
 * masked subject copy ABOVE the background band — otherwise there is nothing
 * to be behind and the layer would simply be hidden by the video plate.
 */
export function resolveBand(g: GraphicLayer, timeline: CompiledTimeline): 'background' | 'foreground' {
  if (g.band === 'background') return 'background';
  if (g.band !== 'auto') return 'foreground';
  const mid = (g.start + g.end) / 2;
  const span = timeline.contentSpans.find((s) => mid >= s.start - 0.001 && mid <= s.end + 0.001);
  const placed = span ? timeline.clips.find((c) => c.id === span.id) : null;
  if (!placed || !placed.depth) return 'foreground';
  return coversSubjectColumn(g) ? 'background' : 'foreground';
}

/**
 * Fill in everything a newer engine expects on a project saved by an older
 * one. A Phase 1 / Phase 2 document has no subject state, keyframe tracks,
 * tracking or pacing plan; without this it would read as half-initialised and
 * the depth stack would have nothing to test.
 */
export function hydrateProject(doc: Partial<Project>): Project {
  const base = newProject(doc.title || 'Untitled short');
  const merged: Project = { ...base, ...doc } as Project;
  merged.canvas = { w: CANVAS_W, h: CANVAS_H, fps: FPS };
  merged.clips = (merged.clips || []).map((c) => ({
    ...c,
    camera: (c.camera || []).map((seg) => ({ ...seg, locked: !!seg.locked })),
    subject: { ...newSubjectState(), ...(c.subject || {}) },
    subjectFx: { ...newSubjectFx(), ...(c.subjectFx || {}) },
    locked: !!c.locked,
  }));
  merged.transitions = (merged.transitions || []).map((t) => ({ ...t, locked: !!t.locked, syncToBeat: !!t.syncToBeat }));
  merged.captions = (merged.captions || []).map((c) => ({ ...c, locked: !!c.locked }));
  merged.graphics = (merged.graphics || []).map((g) => ({
    ...g,
    band: g.band === 'background' || g.band === 'auto' ? g.band : 'foreground',
    locked: !!g.locked,
    icon: g.icon || 'spark',
    count: Number.isFinite(g.count) && g.count > 0 ? g.count : 26,
    seed: Number.isFinite(g.seed) ? g.seed : 7,
    keys: g.keys || {},
    track: { ...newGraphicTrack(), ...(g.track || {}) },
  }));
  // Phase 1 documents have no hook, no beat grid and no per-clip SFX fields.
  // Filling them in here is what lets an older project reopen in a fully
  // formed Phase 2 editor instead of a half-initialised one.
  merged.hook = merged.hook ? { ...newHook(merged.hook.template || 'statement'), ...merged.hook } : null;
  merged.beats = { ...newBeatState(), ...(merged.beats || {}) };
  merged.beats.times = (merged.beats.times || []).filter((t) => Number.isFinite(t)).map((t) => round3(t));
  const hydrateTrack = (t: AudioTrack | null): AudioTrack | null =>
    (t ? { ...newAudioTrack(t.kind, t.label, t.url, t.at), ...t } : null);
  merged.audio = {
    voice: hydrateTrack(merged.audio ? merged.audio.voice : null),
    music: hydrateTrack(merged.audio ? merged.audio.music : null),
    sfx: ((merged.audio && merged.audio.sfx) || []).map((s) => hydrateTrack(s) as AudioTrack),
  };
  merged.pacing = { ...newPacingPlan(), ...(merged.pacing || {}) };
  merged.pacing.items = (merged.pacing.items || []).map((i) => ({ ...i, blockedBy: i.blockedBy || '' }));
  merged.inserts = merged.inserts || [];
  merged.specVersion = MOTION_SPEC_VERSION;
  return merged;
}

/** The exact props object both the preview Player and the server render receive. */
export function compositionProps(project: Project, timeline: CompiledTimeline) {
  const audio = audioTracks(project.audio).filter((a) => a.enabled && a.url);

  return {
    specVersion: MOTION_SPEC_VERSION,
    canvasW: project.canvas.w,
    canvasH: project.canvas.h,
    background: project.background,
    accent: project.accent,
    accent2: project.accent2,
    safeMargin: SAFE_MARGIN,
    // The hook is handed over whole: it is a layer like any other, drawn from
    // t=0 for its own duration and nothing else in the stack knows about it.
    hook: project.hook && project.hook.enabled
      ? { ...project.hook, emphasisIndexes: hookEmphasisIndexes(project.hook) }
      : null,
    clips: timeline.clips,
    transitions: timeline.transitions,
    captions: project.captions
      .filter((c) => c.enabled && c.words.length)
      .map((c) => ({
        id: c.id, start: c.start, end: c.end, x: c.x, y: c.y, align: c.align, widthPct: c.widthPct,
        font: c.font, baseSize: c.baseSize, color: c.color, accent: c.accent, outline: c.outline,
        words: c.words.map((w) => ({
          text: w.text, start: w.start, end: w.end, style: w.style, anim: w.anim,
          color: w.color || '', font: w.font || '', shake: !!w.shake,
        })),
      })),
    graphicsBg: project.graphics.filter((g) => g.enabled && resolveBand(g, timeline) === 'background'),
    graphicsFg: project.graphics.filter((g) => g.enabled && resolveBand(g, timeline) === 'foreground'),
    audio: audio.map((a) => ({
      kind: a.kind, url: a.url, at: a.at, volume: a.volume, loop: a.loop,
      duration: a.duration, fadeIn: a.fadeIn, fadeOut: a.fadeOut,
    })),
    totalFrames: timeline.totalFrames,
  };
}
