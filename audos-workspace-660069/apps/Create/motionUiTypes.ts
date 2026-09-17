/**
 * VidVerge — MOTION UI: the Motion Plan schema.
 *
 * WHY THIS MODE EXISTS. Every other engine in this app cuts a video into
 * independent clips and stitches them. Motion UI does the opposite: it produces
 * ONE continuous Remotion composition driven by a single GLOBAL TIMELINE, so
 * camera movement, UI movement, typography and backgrounds stay connected. The
 * artefact that carries all of that is the MOTION PLAN below — a deterministic
 * JSON specification the AI Motion Director writes, the validator repairs, the
 * preview animates and the renderer turns into the final composition.
 *
 * THE CONTINUITY CONTRACT. There is exactly ONE camera for the whole video —
 * a keyframe track sampled across the global timeline — and every asset lives
 * in a shared WORLD space that the camera transforms. When the camera pans,
 * everything pans together; a new screen "enters" by fading/scaling in at its
 * own world position while the same camera keeps moving over it. That is what
 * makes the result read as one continuous piece of motion design rather than
 * scene → render → scene → render → concatenate. There is no per-shot camera
 * reset anywhere in this schema, by design.
 *
 * SOURCE OF TRUTH. Uploaded UI screenshots are pixel-accurate source assets.
 * The renderer only ever scales / translates / rotates / masks / shadows them —
 * it never regenerates UI. Any words on screen are Motion-Director text cues
 * rendered deterministically by Remotion, never drawn by a generative model.
 *
 * KEEP IT ADDITIVE. A plan is persisted (localStorage + optionally WorkspaceDB)
 * and edited by the AI Edit / Quick Editor, so treat these interfaces as a
 * storage format: only ADD optional fields, so an older saved plan still loads.
 */

export const MOTION_PLAN_VERSION = 1 as const;

/** The render is always 30fps — the platform Remotion endpoint is fixed there. */
export const MOTION_FPS = 30;

export type MotionAspect = '16:9' | '9:16' | '1:1';

/**
 * What an uploaded asset IS. Detected on upload / analysis so the Director can
 * assign motion roles without asking the visitor to classify their own image.
 */
export type AssetType =
  | 'ui_screenshot'
  | 'website'
  | 'mobile'
  | 'product'
  | 'logo'
  | 'brand'
  | 'reference_video';

/** A single uploaded asset plus everything the analyzer learned about it. */
export interface MotionAsset {
  id: string;
  /** Durable public URL from file-storage. The pixel-accurate source of truth. */
  url: string;
  /** Original filename, shown on the asset card. */
  filename: string;
  type: AssetType;
  /** True once the analyzer has run for this asset. */
  analyzed: boolean;
  /** Locked assets are never moved, replaced or dropped by AI edits. */
  locked: boolean;
  /** Natural pixel size, read on load. 0 until known. */
  width: number;
  height: number;
  /** width / height. 1 until known. */
  aspect: number;
  /** Up to ~5 dominant colors sampled from the image, as #rrggbb. */
  colors: string[];
  /** 'light' | 'dark' | '' — the screenshot's own theme. */
  theme: 'light' | 'dark' | '';
  /** The Director-facing semantic role, e.g. "dashboard", "analytics". */
  role: string;
  /** One-line human summary of what is on this screen. */
  summary: string;
  /** Structural notes: cards, buttons, charts, nav, headings the analyzer saw. */
  structure: string[];
  /** For a reference video only: extracted style/pacing notes. */
  referenceNotes?: string;
}

/** Named landing regions text and assets can snap to inside the safe frame. */
export type Anchor =
  | 'center'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

/**
 * THE GLOBAL CAMERA. One keyframe track for the entire video. `x`/`y` are world
 * offsets in fractions of the frame (−1..1 ≈ one frame width/height), `scale`
 * is the zoom, `rotate` an optional roll in degrees. The renderer interpolates
 * between keyframes with an eased curve so movement is smooth end-to-end and
 * never resets. Keyframes MUST be time-sorted and span [0, duration].
 */
export interface CameraKeyframe {
  t: number;
  x: number;
  y: number;
  scale: number;
  rotate?: number;
}

export type Easing = 'smooth' | 'linear' | 'ease_in' | 'ease_out' | 'spring';

/** Entrance/exit vocabulary for an asset layer. */
export type LayerEntrance =
  | 'fade'
  | 'slide_left'
  | 'slide_right'
  | 'slide_up'
  | 'slide_down'
  | 'scale_in'
  | 'rise'
  | 'none';

/** A continuous idle motion applied for the layer's whole life, over the camera. */
export type LayerFloat = 'none' | 'float' | 'drift_left' | 'drift_right' | 'parallax';

/**
 * Optional MatchFrame-style placement of a real UI screenshot inside an
 * AI-video layer. Values are normalized to the generated clip (0..1). The
 * renderer only applies this when trackingConfidence is high; otherwise the
 * Director keeps the screenshot as a normal foreground UI layer rather than
 * pretending an approximate placement is pixel-accurate.
 */
export interface ScreenComposite {
  assetId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotateX?: number;
  rotateY?: number;
  rotateZ?: number;
  skewX?: number;
  skewY?: number;
  borderRadius?: number;
  trackingConfidence: number;
}

/**
 * ONE ASSET LAYER on the global timeline. It occupies WORLD space: `worldX`,
 * `worldY` (fractions, 0,0 = frame centre) and `worldScale` place it in the
 * scene the camera flies over, so two layers at different worldX can be
 * connected by a single continuous camera pan between them.
 */
export interface AssetLayer {
  id: string;
  /** References MotionAsset.id. Empty for a pure graphic/device placeholder. */
  assetId: string;
  kind: 'ui' | 'product' | 'logo' | 'ai_video' | 'avatar';
  /** When the layer is on screen, in seconds on the global timeline. */
  start: number;
  end: number;
  /** World placement. 0,0 is frame centre; 1 ≈ one frame dimension. */
  worldX: number;
  worldY: number;
  worldScale: number;
  rotate: number;
  entrance: LayerEntrance;
  /** Entrance/exit length in seconds. */
  entranceDur: number;
  exitDur: number;
  float: LayerFloat;
  /** Presentation frame around a UI/product asset: subtle browser/device chrome. */
  frameStyle: 'none' | 'browser' | 'device' | 'card';
  shadow: boolean;
  /** A generated/av segment's clip URL, filled before final render. */
  clipUrl?: string;
  /** For ai_video / avatar layers: the prompt the Director requested. */
  prompt?: string;
  /**
   * Real screenshot intended for a device/screen in this generated shot. When
   * no reliable tracked placement exists it remains a separate foreground UI
   * layer. This field records the relationship without fabricating alignment.
   */
  screenAssetId?: string;
  /** High-confidence tracked mask/perspective data, when a tracker supplies it. */
  screenComposite?: ScreenComposite;
}

export type TextAnimation =
  | 'fade'
  | 'slide_up'
  | 'word_reveal'
  | 'char_reveal'
  | 'tracking_expand'
  | 'scale_reveal'
  | 'mask_reveal';

/**
 * ONE TEXT CUE on its own global track. All on-screen words are cues — rendered
 * by Remotion, character-accurate, never by a generative model. `x`/`y` are
 * fractions of the safe frame; `anchor` gives the Director a coarse placement
 * that the validator keeps inside the safe area.
 */
export interface TextCue {
  id: string;
  content: string;
  start: number;
  end: number;
  anchor: Anchor;
  /** Fine offset from the anchor, fractions of frame. Optional. */
  x?: number;
  y?: number;
  /** Relative type scale: 1 = body, 2 = headline, 3 = hero. */
  level: 1 | 2 | 3;
  weight: 400 | 500 | 600 | 700 | 800 | 900;
  animation: TextAnimation;
  align: 'left' | 'center' | 'right';
  /** Optional explicit color; defaults to the brand text color. */
  color?: string;
  /** True for a CTA-styled pill treatment. */
  emphasis?: boolean;
}

/** The procedural, deterministic background. Native Remotion, never a video. */
export interface MotionBackground {
  type: 'gradient' | 'solid' | 'mesh' | 'spotlight';
  colors: string[];
  animation: 'none' | 'slow_drift' | 'pan' | 'pulse';
}

export type GraphicKind = 'rings' | 'grid' | 'beams' | 'particles' | 'lines' | 'dots' | 'glow';

/** A procedural motion-graphic layer. Deterministic and continuous. */
export interface MotionGraphic {
  id: string;
  kind: GraphicKind;
  color: string;
  /** 0..1 — how strong/dense/opaque this layer reads. */
  intensity: number;
  /** Whether it sits behind the assets (bg) or in front (fg). */
  depth: 'back' | 'front';
}

/** Brand system maintained across the whole composition. */
export interface MotionBrand {
  primary: string;
  secondary: string;
  background: string;
  text: string;
  accent: string;
  /** CSS font-family stack. */
  font: string;
  logoUrl?: string;
}

export interface MotionAudio {
  /** A durable music URL, when the visitor added one. Optional. */
  musicUrl?: string;
  /** 0..1 */
  volume: number;
  muted: boolean;
}

/**
 * THE MOTION PLAN — the deterministic specification for the whole video.
 * One camera, one background, one set of graphics, one asset-layer track, one
 * text track, one audio track, over ONE global timeline of `duration` seconds.
 */
export interface MotionPlan {
  version: number;
  /** Total runtime in seconds. */
  duration: number;
  fps: number;
  aspectRatio: MotionAspect;
  presetId: string;
  /** The look word the Director worked to (from the visual-style control). */
  styleWord: string;
  brand: MotionBrand;
  background: MotionBackground;
  graphics: MotionGraphic[];
  /** The single global camera path. */
  camera: CameraKeyframe[];
  /** Every asset placement on the timeline, in draw order (later = on top). */
  layers: AssetLayer[];
  /** Every on-screen word, on its own track. */
  text: TextCue[];
  audio: MotionAudio;
  /** The one-line title the Director gave the piece. */
  title: string;
}

/** A validation finding. `repaired` records what the auto-repair changed. */
export interface MotionIssue {
  level: 'error' | 'warning';
  code: string;
  message: string;
  repaired?: string;
}

export interface ValidationResult {
  plan: MotionPlan;
  issues: MotionIssue[];
  ok: boolean;
}

// ---------------------------------------------------------------------------
// Small shared guards / helpers used across the Motion UI modules.
// ---------------------------------------------------------------------------
export function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//.test(value);
}

export function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

export function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

/** Frame count for the whole plan, floored to at least one second. */
export function planDurationInFrames(plan: MotionPlan): number {
  const secs = clamp(plan.duration || 0, 1, 600);
  return Math.max(MOTION_FPS, Math.round(secs * MOTION_FPS));
}

/** The asset a layer draws, or null. */
export function assetForLayer(plan: MotionPlan, assets: MotionAsset[], layer: AssetLayer): MotionAsset | null {
  if (!layer.assetId) return null;
  return assets.find((a) => a.id === layer.assetId) || null;
}
