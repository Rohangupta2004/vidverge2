/**
 * Screens to Motion — shared pipeline types.
 *
 * Screenshots are the UI; the software supplies motion, framing, and
 * typography. Every stage of the pipeline speaks these shapes:
 *   Stage 1 (ingest)  → IngestedScreen
 *   Stage 2 (analyse) → ScreenAnalysis (one vision call per screenshot)
 *   Stage 3 (plan)    → VideoPlan (schema-validated, post-validated)
 *   Stage 4 (render)  → one self-contained Remotion composition driven by
 *                       { plan, images } props.
 *
 * All crop/region geometry is normalised to 0–1 coordinates relative to the
 * source screenshot's true pixel dimensions.
 */

// ---------------------------------------------------------------- stage 1 ----
export interface IngestedScreen {
  screenId: string;
  /** Durable https URL of the normalised (EXIF-stripped, sRGB) PNG. */
  url: string;
  /** True pixel dimensions of the normalised image. */
  width: number;
  height: number;
  /** Original file name, for provenance only. */
  filename: string;
}

export const INGEST_RULES = {
  minWidth: 1600,
  minFiles: 2,
  maxFiles: 12,
  briefMinChars: 40,
  briefMaxChars: 600,
  acceptedTypes: ['image/png', 'image/jpeg'],
} as const;

// ------------------------------------------------------- stage 1b — clips ----
// Phase 2 (Presenter Mix): real footage — founder uploads, gated Veo
// atmosphere clips, and the HeyGen presenter — conformed onto the fixed
// 30fps/1920x1080 render grid (see src/clips/conform.ts).
export type ClipSource = 'upload' | 'veo' | 'heygen';

export interface ClipStats {
  /** 2nd / 98th percentile luminance and means, all 0–1, sampled over the trim. */
  blackPoint: number;
  whitePoint: number;
  meanLuma: number;
  meanSat: number;
}

export interface IngestedClip {
  clipId: string;
  /** Durable https URL of the unmodified clip bytes. */
  url: string;
  width: number;
  height: number;
  /** TRUE source frame rate, measured frame-by-frame on ingest — never assumed. */
  fps: number;
  durationSeconds: number;
  source: ClipSource;
  filename: string;
  /**
   * OffthreadVideo playbackRate chosen by conform so every composition frame
   * advances a WHOLE number of source frames — zero duplicated frames, zero
   * judder. 1 for k:1 sources (30/60fps); 30/fps re-time otherwise.
   */
  playbackRate: number;
  /** Footage statistics for grade:"auto", filled by the grade sampler. */
  stats?: ClipStats | null;
}

export const CLIP_RULES = {
  maxClips: 4,
  /** minimum 1080p: shorter edge in pixels */
  minEdge: 1080,
  acceptedTypes: ['video/mp4', 'video/quicktime'],
  /** rejection-gate regeneration budget per atmosphere clip */
  maxGateAttempts: 2,
  gateFrameSamples: 5,
} as const;

// ---------------------------------------------------------------- stage 2 ----
export type ScreenKind =
  | 'dashboard' | 'list' | 'detail' | 'form' | 'empty' | 'marketing' | 'settings';

export type RegionRole =
  | 'headline' | 'nav' | 'metric' | 'chart' | 'media' | 'panel' | 'row'
  | 'card' | 'cta' | 'form' | 'table' | 'badge' | 'other';

/** Normalised rectangle: [x, y, w, h], each 0–1. */
export type BBox = [number, number, number, number];

export interface Region {
  id: string;
  role: RegionRole;
  bbox: BBox;
  /** Transcription ONLY — never generated. null when illegible. */
  text: string | null;
  /** Visual weight + product importance, 0–1. */
  salience: number;
  /**
   * Plate colour sampled client-side from a 4px inset ring around the region
   * (hex). null when the ring varies more than 6% luminance — UI motion ops
   * must then skip and fall back to highlight.
   */
  plateColor?: string | null;
}

export interface Palette {
  dominant: string;
  ink: string;
  accent: string;
  isDark: boolean;
}

export interface ScreenAnalysis {
  screenId: string;
  kind: ScreenKind;
  summary: string;
  palette: Palette;
  /** At most 8 regions per screen. */
  regions: Region[];
  scrollable: boolean;
  /** Rectangles safe to crop without cutting a word or control. */
  safeCrops: BBox[];
}

// ---------------------------------------------------------------- stage 3 ----
export type MotionPresetName = 'calm' | 'snappy' | 'cinematic' | 'kinetic';
export type BedOpName = 'push' | 'pan' | 'scrollSim' | 'deviceTilt';
export type AccentOpName =
  | 'focus' | 'lift' | 'parallax' | 'cursor' | 'highlight' | 'callout'
  | 'maskWipe' | 'compare';
export type UiOpName =
  | 'countUp' | 'chartDraw' | 'listStagger' | 'skeleton' | 'typeIn'
  | 'progressFill' | 'toggleFlip' | 'statusFlip' | 'notify' | 'badgePop'
  | 'tabSlide' | 'ripple';

export interface BedSpec { op: BedOpName; params: Record<string, unknown>; }
export interface AccentSpec {
  op: AccentOpName;
  params: Record<string, unknown>;
  /** Frame window inside the scene. */
  from?: number;
  to?: number;
}
export interface UiSpec {
  op: UiOpName;
  regionId: string;
  params: Record<string, unknown>;
  /** Frame the op starts firing at (scene-local). */
  at: number;
  duration: number;
}

export interface OverlaySpec {
  /** Four sizes only. */
  size: 'eyebrow' | 'headline' | 'body' | 'caption';
  /** headline <= 42 chars, caption <= 90 chars — enforced by schema. */
  text: string;
  /** Margin placement; overlay never sits on interface pixels. */
  side: 'top' | 'bottom' | 'left' | 'right';
  /** Optional icon name from the 20-icon set; one icon per callout/overlay. */
  icon?: string | null;
  at?: number;
}

/** Motion carry across a footage boundary: "every scene ends at rest" is
 * SUSPENDED there — the outgoing camera velocity continues into the incoming
 * scene in this direction. */
export type CarryDirection = 'left' | 'right' | 'up' | 'down' | 'in' | 'out';
export interface OutSpec { carry: CarryDirection; }

export interface SceneSpec {
  id: string;
  /** Absent or 'screen' — a Phase 1 screenshot scene. */
  kind?: 'screen';
  screenId: string;
  /** Scene length in frames at plan fps. */
  duration: number;
  bed: BedSpec;
  /** 0–2 accents; cursor never combined with focus; lift XOR parallax. */
  accents: AccentSpec[];
  /** Max 2 UI motion ops, no time overlap. */
  ui: UiSpec[];
  overlay?: OverlaySpec | null;
  out?: OutSpec | null;
  /** Frames of dip at scene start — set by the exposure matcher, never by the planner. */
  dipIn?: number;
}

// --------------------------------------------------- stage 3 — clip scenes ----
export interface PlateCorners {
  /** Scene-local frame this keyframe applies at. */
  at: number;
  tl: [number, number];
  tr: [number, number];
  br: [number, number];
  bl: [number, number];
}

/** Blank-plate composite: the real screenshot corner-pinned into a tracked
 * blank device screen. 2–4 keyframes; shots needing more are rejected. */
export interface PlateSpec {
  screenId: string;
  corners: PlateCorners[];
  /** px blur matched to the shot's focus. */
  blur: number;
  /** 0–0.4 glow spill onto nearby surfaces. */
  glow: number;
  /** 0.04–0.08 reflection over the plate. */
  reflection: number;
}

/** 'strip' (default — silence beats one clip's ambience) or 'duck' (clip
 * audio is the point; the music bed ducks −12dB with 6-frame fades). */
export type ClipAudioMode = 'strip' | 'duck';

export interface ClipSceneSpec {
  id: string;
  kind: 'clip';
  /** clipId of an IngestedClip. */
  src: string;
  /** Scene length in frames at plan fps — never longer than the trim provides. */
  duration: number;
  /** [inSeconds, outSeconds] in SOURCE time. */
  trim: [number, number];
  grade: 'auto' | 'none';
  audio: ClipAudioMode;
  overlay?: OverlaySpec | null;
  out?: OutSpec | null;
  plate?: PlateSpec | null;
  /** Frames of dip at scene start — set by the exposure matcher. */
  dipIn?: number;
}

export type PlanScene = SceneSpec | ClipSceneSpec;

// ----------------------------------------------------- stage 3 — beat sync ----
export interface SyncSpec {
  bpm: number;
  offsetMs: number;
  snap: 'beat' | 'bar';
  /** 'settle': animations FINISH on the beat — entrances offset backwards by rise time. */
  landOn: 'settle' | 'start';
}

export interface MusicSpec { url: string; gainDb?: number; }

/** Video-wide grade pulling the UI layers toward the footage (§4: black point
 * first, then saturation — screenshots move toward the footage, never the
 * other way). Emitted as CSS `contrast() brightness() saturate()`. */
export interface UiGradeSpec { brightness: number; contrast: number; saturate: number; }

export interface VideoPlan {
  meta: { title: string; fps: number; width: number; height: number };
  motion: MotionPresetName;
  theme: { source: 'derived'; accent: string; isDark: boolean };
  ground: { style: 'mesh' | 'wash' | 'flat'; from: 'palette'; grain: number; vignette: number };
  scenes: PlanScene[];
  /** Beat grid (Presenter Mix). Absent = Phase 1 behaviour, unchanged. */
  sync?: SyncSpec | null;
  /** Music bed under the whole video; clip 'duck' scenes duck it −12dB. */
  music?: MusicSpec | null;
  /** Derived by the grade sampler — not written by the planner. */
  uiGrade?: UiGradeSpec | null;
}

/** Render-time props for the composition. */
export interface CompositionProps {
  plan: VideoPlan;
  images: IngestedScreen[];
  analyses: ScreenAnalysis[];
  /** Conformed clips (Presenter Mix); absent for screenshots-only videos. */
  clips?: IngestedClip[];
}

// Composition rules the planner post-validation enforces (see src/plan/validate.ts):
// - every scene: exactly one bed op + 0–2 accents
// - cursor never combined with focus in the same scene
// - lift and parallax are mutually exclusive
// - every scene ends at rest (final 8 frames zero velocity — ops guarantee it)
// - all crops inside safeCrops; no repeated bed op back-to-back
// - total duration 20–40s at 30fps; scene lengths vary; best screenshot at
//   60–70%; final hold >= 20 frames
