// CineAgent — shared types.
//
// The EditPlan is the single contract between four parties:
//   1. the director (Claude Opus 5) which AUTHORS it as JSON,
//   2. plan.ts which VALIDATES and normalizes it,
//   3. motionRuntime.ts (the Remotion composition) which RENDERS it,
//   4. qa.ts which REVIEWS the rendered file against it.
// Keep field names stable — the render runtime reads this shape off `props`.

export type StageId =
  | 'upload'
  | 'analyze'
  | 'direct'
  | 'assets'
  | 'render'
  | 'review'
  | 'finish';

export const STAGE_ORDER: StageId[] = ['upload', 'analyze', 'direct', 'assets', 'render', 'review', 'finish'];

export const STAGE_LABELS: Record<StageId, string> = {
  upload: 'Registering footage',
  analyze: 'Watching & listening',
  direct: 'Creative direction',
  assets: 'Creating visuals & audio',
  render: 'Rendering the edit',
  review: 'Reviewing the cut',
  finish: 'Delivering',
};

// ---------------------------------------------------------------------------
// Source + analysis
// ---------------------------------------------------------------------------

export interface SourceVideo {
  url: string;
  key?: string;
  name: string;
  mime: string;
  bytes: number;
  duration: number;   // seconds, measured in the browser
  width: number;
  height: number;
}

export interface TranscriptWord {
  w: string;
  s: number;   // start sec in SOURCE time
  e: number;   // end sec in SOURCE time
}

export interface SilenceRange { start: number; end: number }

export interface SampledFrame {
  t: number;     // source timestamp (sec)
  url: string;   // public PNG
}

export interface AnalysisReport {
  transcript: string;
  words: TranscriptWord[];
  wordsExact: boolean;          // true when Deepgram supplied real timings
  silences: SilenceRange[];
  speechDuration: number;
  contentAnalysis: ContentAnalysis | null;
  frames: SampledFrame[];
  notes: string[];
}

export interface ContentAnalysis {
  contentType: string;          // e.g. talking-head, tutorial, product demo…
  summary: string;
  audience: string;
  scenes: { start: number; end: number; description: string }[];
  onScreenText: string[];
  keyMoments: { t: number; description: string }[];
  endingDescription: string;
  audioNotes: string;
  qualityNotes: string;
}

// ---------------------------------------------------------------------------
// Edit plan
// ---------------------------------------------------------------------------

export interface VisualIdentity {
  primary: string;     // hex
  secondary: string;
  accent: string;
  bg: string;          // used behind boards / chapter cards
  text: string;
  fontStyle: 'modern' | 'editorial' | 'bold' | 'mono' | 'elegant';
  tone: string;        // one line describing the visual voice
}

export type TransitionType = 'cut' | 'fade' | 'dip' | 'slide' | 'zoom' | 'whip';

export interface Transition {
  type: TransitionType;
  duration: number;    // seconds, 0.1–1.2
}

/** One block of the OUTPUT timeline, played in order. */
export interface Segment {
  id: string;
  kind: 'source' | 'generated' | 'board';
  /** kind=source — a span of the uploaded footage, in SOURCE seconds. */
  src?: { start: number; end: number; volume?: number };
  /** kind=generated — a generated video/image asset shown full-frame. */
  assetId?: string;
  /** How long a generated/board segment runs (sec). Source segments derive it. */
  duration?: number;
  /** kind=board — a pure motion-graphics section (no footage). */
  board?: MotionSpec;
  transitionIn?: Transition;
  note?: string;       // the director's intent, shown in the plan viewer + QA
}

export type OverlayAnchor =
  | 'lower-third' | 'center' | 'top' | 'left-panel' | 'right-panel' | 'full' | 'corner';

/** A motion graphic layered OVER whatever segment is playing, on OUTPUT time. */
export interface Overlay {
  id: string;
  at: number;          // output seconds
  duration: number;
  anchor: OverlayAnchor;
  spec: MotionSpec;
  note?: string;
}

// --- Motion specs: the primitive library + a free-form custom system --------

export type MotionSpec =
  | { type: 'kineticTitle'; text: string; subtext?: string; style?: 'rise' | 'split' | 'assemble' | 'typeOn' | 'blur' | 'punch'; size?: 'sm' | 'md' | 'lg' | 'xl' }
  | { type: 'lowerThird'; title: string; subtitle?: string }
  | { type: 'callout'; text: string; x: number; y: number; pointerTo?: { x: number; y: number } }
  | { type: 'stat'; value: number; prefix?: string; suffix?: string; label: string }
  | { type: 'barChart'; title?: string; items: { label: string; value: number }[]; unit?: string }
  | { type: 'list'; title?: string; items: string[] }
  | { type: 'quote'; text: string; attribution?: string }
  | { type: 'chapter'; index?: number; title: string; subtitle?: string }
  | { type: 'badge'; text: string }
  | { type: 'image'; assetId: string; motion?: 'kenburns' | 'parallax' | 'pop'; caption?: string }
  | { type: 'progress'; label?: string; from: number; to: number; suffix?: string }
  | { type: 'timeline'; title?: string; items: { label: string; detail?: string }[] }
  | { type: 'keyword'; words: string[] }
  | { type: 'custom'; bg?: string; layers: CustomLayer[] };

/**
 * Free-form keyframed layer — lets the director invent compositions that are
 * not in the primitive library while staying 100% deterministic to render.
 * All x/y/w/h are percentages of the 1920x1080 frame. start/end are seconds
 * RELATIVE to the overlay/board start.
 */
export interface CustomLayer {
  kind: 'text' | 'rect' | 'ellipse' | 'line' | 'image';
  text?: string;
  assetId?: string;
  color?: string;
  fontSize?: number;      // px at 1080p
  weight?: number;        // 300–900
  radius?: number;        // px corner radius for rects
  start: number;
  end: number;
  ease?: 'linear' | 'out' | 'inOut' | 'spring';
  from: LayerState;
  to: LayerState;
}

export interface LayerState {
  x?: number; y?: number;       // % of frame (center of the element)
  w?: number; h?: number;       // % of frame
  scale?: number;
  rotate?: number;              // degrees
  opacity?: number;             // 0–1
  blur?: number;                // px
}

// --- Assets ------------------------------------------------------------------

export interface AssetSpec {
  id: string;
  kind: 'image' | 'video';
  prompt: string;
  /** video only — preferred engine; the executor falls back down the ladder. */
  model?: 'seedance' | 'veo-fast' | 'veo' | 'omni';
  durationSec?: number;        // video only, 4–8
  /** source timestamp whose frame seeds/anchors the generation (continuity). */
  referenceFrameT?: number;
  /** source clip (start/end in source seconds) passed as video input to Omni Flash for video-to-video consistency. Preferred over referenceFrameT when using model:'omni'. Max 6s recommended. */
  referenceVideoClip?: { start: number; end: number };
  style?: string;
}

export interface GeneratedAsset {
  id: string;
  kind: 'image' | 'video';
  url: string;
  model: string;
  prompt: string;
  durationSec?: number;
}

// --- Audio -------------------------------------------------------------------

export interface AudioPlan {
  keepOriginal: boolean;
  originalVolume?: number;      // 0–1, default 1
  music?: {
    prompt: string;             // custom music brief
    volume: number;             // 0–1 base level
    duckTo: number;             // 0–1 level under speech
  } | null;
  narration?: {
    voiceId?: string;
    segments: { text: string; at: number }[];   // at = output seconds
  } | null;
}

export interface NarrationTrack {
  segments: { at: number; url: string; durationMs: number; text: string }[];
}

// --- Captions ----------------------------------------------------------------

export interface CaptionStyle {
  preset: 'clean' | 'bold' | 'karaoke' | 'minimal' | 'editorial';
  position: 'bottom' | 'lower' | 'center';
}

/** Baked caption cue on OUTPUT time — computed deterministically in plan.ts. */
export interface CaptionCue {
  at: number;
  duration: number;
  words: { w: string; t: number; d: number }[];   // t relative to cue start
}

// --- The plan ----------------------------------------------------------------

export interface EditPlan {
  title: string;
  logline: string;
  contentType: string;
  direction: string;            // the director's overall creative note
  identity: VisualIdentity;
  frame: { mode: 'fit' | 'cover'; bgBlur: boolean };
  timeline: Segment[];
  overlays: Overlay[];
  captions: { enabled: boolean; style: CaptionStyle };
  audio: AudioPlan;
  assets: AssetSpec[];
}

/** Everything the Remotion runtime receives as props. */
export interface RenderPlan {
  plan: EditPlan;
  assets: Record<string, GeneratedAsset>;
  captionCues: CaptionCue[];
  musicUrl: string | null;
  narration: NarrationTrack | null;
  /** per-output-second speech presence 0/1, for music ducking */
  speechEnvelope: number[];
  source: { url: string; width: number; height: number; duration: number };
  durationSec: number;
  fps: number;
  /** True when the source is taller than wide: the film is composed on a
   * virtual 1080x1920 canvas and delivered as a true portrait MP4. */
  portrait?: boolean;
}

// ---------------------------------------------------------------------------
// QA
// ---------------------------------------------------------------------------

export interface QADefect {
  severity: 'critical' | 'major' | 'minor';
  where: string;               // segment/overlay id or output timestamp
  issue: string;
  action: 'remove' | 'shorten' | 'retime' | 'restyle' | 'replace_text' | 'drop_overlay' | 'accept';
  details?: string;
}

export interface QAReport {
  attempt: number;
  score: number;               // 0–1
  shippable: boolean;
  summary: string;
  defects: QADefect[];
  mechanical: { durationOk: boolean; playable: boolean; measuredDuration: number; expectedDuration: number };
}

// ---------------------------------------------------------------------------
// Project row (cine_projects)
// ---------------------------------------------------------------------------

export interface ActivityLine { t: number; text: string; kind?: 'info' | 'ok' | 'warn' | 'error' }

export interface UserPrefs {
  tone?: string;               // optional creative guidance, free text
  captions?: 'auto' | 'on' | 'off';
  music?: 'auto' | 'on' | 'off';
  framing?: 'auto' | 'fit' | 'cover';
  intensity?: 'subtle' | 'balanced' | 'expressive';
}

export interface ProjectRow {
  id: number;
  name: string;
  status: 'running' | 'done' | 'failed';
  stage: StageId;
  progress: { pct: number; detail: string } | null;
  source: SourceVideo | null;
  analysis: AnalysisReport | null;
  plan: EditPlan | null;
  assets: Record<string, GeneratedAsset> | null;
  qa: QAReport[] | null;
  result: { url: string; durationSec: number; renderedAt: string; attempt: number } | null;
  activity: ActivityLine[] | null;
  prefs: UserPrefs | null;
  error: string | null;
  created_at?: string;
  updated_at?: string;
}

export const FPS = 30;
export const OUT_W = 1920;
export const OUT_H = 1080;
export const MAX_RENDER_SEC = 570;        // chunk past ~9.5 min (render cap is 10)
export const MAX_VIDEO_ASSETS = 6;        // wallet guardrails per project
export const MAX_IMAGE_ASSETS = 10;
