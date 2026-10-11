/**
 * FACELESS — editorial type system.
 *
 * This is a clean build. Nothing here is inherited from Track B, ProductLaunch
 * or SceneForge; the only shared platform infrastructure the pipeline touches
 * is the HyperFrames render service, and it reaches that through the
 * RenderAdapter abstraction in ../lib/renderAdapter.ts.
 *
 * The governing idea: AUDIO DRIVES THE EDIT. Every beat is anchored to a span
 * of real ElevenLabs/Deepgram word timestamps, which is why narration is
 * generated BEFORE the script is analysed — raw text cannot tell you when a
 * word is actually spoken.
 */

// ---------------------------------------------------------------------------
// Core editorial vocabulary
// ---------------------------------------------------------------------------

export type FacelessMode =
  | 'documentary' | 'explainer' | 'news'
  | 'business' | 'story' | 'educational';

// ---------------------------------------------------------------------------
// Delivery options
//
// Everything here is chosen on the brief screen and every field is optional
// downstream, so a run saved before these existed deserialises unchanged and
// falls back to the behaviour the pipeline had before.
// ---------------------------------------------------------------------------

export type AspectId = 'landscape' | 'portrait';

export type VoiceStyleId = 'authoritative' | 'conversational' | 'energetic' | 'calm';

export type VoiceEffectId = 'none' | 'studio_warmth' | 'light_reverb' | 'cinematic_depth';

export type MusicMoodId = 'documentary' | 'energetic' | 'calm' | 'inspiring' | 'dark';

/** The four fields the ElevenLabs voiceover endpoint accepts as voice_settings. */
export interface VoiceSettings {
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
}

export interface FilmSettings {
  aspect: AspectId;
  voiceStyle: VoiceStyleId;
  voiceEffect: VoiceEffectId;
  musicMood: MusicMoodId;
  /** 0–1. The ceiling the music bed is mixed to underneath the narration. */
  musicVolume: number;
  /** Seconds the brief is aiming at. The real duration is always the narration's. */
  targetDurationSeconds: number;
  captionsEnabled: boolean;
  /**
   * Documentary only, and off by default: animate the depth stage's background
   * plate with Seedance 2.0. The platform prices one clip at about $6, which is
   * more than the rest of a short film put together, so it is never implicit.
   */
  depthMotion: boolean;
}

/**
 * The documentary-only background plate: one generated still, and the Seedance
 * 2.0 img-to-vid clip made from it. `videoUrl` is null whenever motion did not
 * arrive in time, which is a degraded success — the still is still usable.
 */
export interface DepthBackground {
  stillUrl: string;
  videoUrl: string | null;
  prompt: string;
  motionPrompt: string;
  degraded: boolean;
  reason?: string;
}

export type NarrativePurpose =
  | 'hook' | 'context' | 'explanation' | 'proof'
  | 'contrast' | 'reveal' | 'emotion' | 'transition' | 'cta';

export type VisualType =
  | 'broll_stock' | 'broll_generated'
  | 'image_generated' | 'image_archive'
  | 'diagram' | 'chart' | 'ui_screenshot'
  | 'map' | 'timeline_graphic' | 'kinetic_type' | 'mixed';

export type CameraType =
  | 'establishing_push'    // 100→106%, 2–4s slow push
  | 'statement_punch'      // 100→115%, 8–14 frames
  | 'emotional_slow'       // 100→104%, very slow
  | 'reveal_pullback'      // tight crop → pulls back to reveal context
  | 'data_static'          // no camera move; graphic animates instead
  | 'transition_follow';   // subject moves toward frame edge; next shot continues movement

export type TextTreatment =
  | 'massive_headline' | 'kinetic_phrase' | 'highlighted_word'
  | 'number_reveal' | 'quote_card' | 'lower_third';

export type TransitionType =
  | 'cut' | 'match_cut' | 'dissolve' | 'blur_reveal' | 'freeze_punch';

/** 1=existing workspace footage 2=stock clip 3=existing image/screenshot 4=generated still 5=generated AI video */
export type AssetTier = 1 | 2 | 3 | 4 | 5;

export interface AssetDecision {
  tier: AssetTier;
  rationale: string;                    // why this tier was chosen over a cheaper one
  searchQuery?: string;                 // tiers 1–3
  generationPrompt?: string;            // tiers 4–5
  matchCutDependencyBeatId?: string;    // if this beat must align geometrically with another beat
}

export interface FacelessBeat {
  id: string;

  // Narration anchor — everything derives from this
  narrationStart: number;               // seconds from the word-timestamp track
  narrationEnd: number;
  narrationText: string;                // exact words spoken during this beat

  // Narrative role
  narrativePurpose: NarrativePurpose;
  isHook: boolean;                      // first-class flag — beat 0 only; enforces hook constraints

  // Visual plan
  visualIntent: string;                 // e.g. "one point multiplying to 40 points on a world map"
  visualType: VisualType;
  emphasisWords?: string[];

  // Asset selection
  assetDecision: AssetDecision;

  // Camera
  camera: {
    type: CameraType;
    startScale: number;                 // e.g. 1.0
    endScale: number;                   // e.g. 1.06
    durationMs: number;
  };

  // Text — only when it adds information NOT in the narration
  textOverlay?: {
    type: TextTreatment;
    content: string;
    offsetMs: number;                   // ms after beat start
  };

  // Transition to next beat
  transition?: {
    type: TransitionType;
    sourceElement?: string;             // match cut: geometric element in THIS beat
    destinationElement?: string;        // match cut: element in NEXT beat that must match
  };

  // Sound
  soundDesign?: {
    sfx?: { description: string; offsetMs: number }[];
    musicEnergy: number;                // 0–1
  };

  /** Computed during createVisualPlan. Low scores force a visual-type deviation. */
  visualNoveltyScore?: number;          // 0–1
}

export interface MusicArcSection {
  section: string;
  energy: number;
  timeRange: [number, number];
}

export interface ContinuityGuide {
  colorStory: string;
  visualMotif: string;
  cameraGrammar: string;                // e.g. "slow documentary push, no handheld"
  timePeriod?: string;
  subject?: string;
  location?: string;
}

export interface AssetMixTarget {
  stock: number;                        // ~35%
  imageGenerated: number;               // ~20%
  videoGenerated: number;               // ~15%
  graphics: number;                     // ~15%
  ui: number;                           // ~10%
  typography: number;                   // ~5%
}

export interface EditorialTimeline {
  filmId: string;
  mode: FacelessMode;
  duration: number;                     // seconds (== narration duration)

  narrativeArc: {
    hook: [number, number];
    body: [number, number];
    resolution: [number, number];
  };

  musicArc: MusicArcSection[];

  continuityGuide: ContinuityGuide;

  assetMixTarget: AssetMixTarget;

  beats: FacelessBeat[];
}

// ---------------------------------------------------------------------------
// Narration
// ---------------------------------------------------------------------------

export interface WordTimestamp {
  word: string;
  start: number;                        // seconds
  end: number;
}

export interface NarrationResult {
  audioUrl: string;
  wordTimestamps: WordTimestamp[];
  /** Measured, not estimated: the decoded length of the generated MP3. */
  duration: number;
  voiceId: string;
  /**
   * True when word timing came from Deepgram's forced read of the real audio.
   * False means the transcription step was unavailable and timings were
   * distributed across the measured duration — the pipeline still runs, but
   * every downstream consumer can see that the spine is weaker.
   */
  timestampsMeasured: boolean;
}

// ---------------------------------------------------------------------------
// Script analysis (stage 2 — consumes the timed transcript, never raw text)
// ---------------------------------------------------------------------------

export interface NarrativeSection {
  label: string;
  purpose: NarrativePurpose;
  start: number;
  end: number;
  text: string;
}

export interface NarrativeAnalysis {
  mode: FacelessMode;
  modeRationale: string;
  duration: number;
  narrativeArc: {
    hook: [number, number];
    body: [number, number];
    resolution: [number, number];
  };
  sections: NarrativeSection[];
  musicArc: MusicArcSection[];
  continuitySeed: ContinuityGuide;
  /** Phrases the director should treat as claim/number/name moments. */
  emphasisCandidates: string[];
}

// ---------------------------------------------------------------------------
// Asset index (stage 3 — what this workspace already owns)
// ---------------------------------------------------------------------------

export type AssetIndexKind = 'video' | 'image' | 'screenshot' | 'graphic';

export interface IndexedAsset {
  id: string;
  kind: AssetIndexKind;
  url: string;
  thumbUrl?: string;
  title: string;
  /** Free-text the matcher scores a beat's search query against. */
  haystack: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  /** Tier 1 for footage already in the workspace, Tier 3 for stills/screenshots. */
  tier: 1 | 3;
  source: string;
}

export interface AssetIndex {
  filmId: string;
  builtAt: string;
  assets: IndexedAsset[];
  counts: { video: number; image: number; screenshot: number; graphic: number };
  /** Non-fatal reasons a catalog could not be read, surfaced rather than swallowed. */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Visual plan (stage 5 — resolves the match-cut DAG before anything is bought)
// ---------------------------------------------------------------------------

export interface AssetTask {
  beatId: string;
  tier: AssetTier;
  /** Beats in the same wave may run in parallel; waves run in order. */
  wave: number;
  dependsOnBeatId?: string;
  visualType: VisualType;
  searchQuery?: string;
  generationPrompt?: string;
  estimatedCost: number;
}

export interface TierDowngrade {
  beatId: string;
  from: AssetTier;
  to: AssetTier;
  reason: string;
}

export interface VisualPlan {
  filmId: string;
  tasks: AssetTask[];
  /** Ordered waves of beat ids. Wave N cannot start until wave N-1 resolves. */
  waves: string[][];
  noveltyScores: Record<string, number>;
  noveltyDeviations: { beatId: string; from: VisualType; to: VisualType; reason: string }[];
  downgrades: TierDowngrade[];
  estimatedCost: number;
  tierMix: Record<AssetTier, number>;
}

// ---------------------------------------------------------------------------
// Asset acquisition
// ---------------------------------------------------------------------------

export interface StockClip {
  id: string;
  url: string;
  thumbUrl: string;
  description: string;
  width: number;
  height: number;
  /** Seconds for a real clip; undefined for a still that the camera animates. */
  durationSeconds?: number;
  kind: 'video' | 'image';
  provider: string;
  attribution?: string;
}

export interface ResolvedAsset {
  beatId: string;
  tier: AssetTier;
  url: string;
  duration: number;                     // actual media duration in seconds
  type: 'video' | 'image' | 'graphic';
  /** What it cost to put this asset on screen, in USD. */
  cost?: number;
  provider?: string;
  width?: number;
  height?: number;
}

export interface SFXAsset {
  beatId: string;
  description: string;
  offsetMs: number;
  url: string | null;
  /** Null url with a reason means the beat ships without that effect, loudly. */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Asset preparation (asset-type-aware — never a blanket trim-to-duration)
// ---------------------------------------------------------------------------

export type PreparedPlayback =
  | 'video_subrange'      // clip trimmed to the most relevant window
  | 'still_with_camera'   // image; the motion plan supplies all movement
  | 'parallax_still'      // generated image; layered drift rather than a flat zoom
  | 'short_clip_hold';    // under-length clip; the motion plan covers the remainder

export interface PreparedAsset {
  beatId: string;
  url: string;
  type: 'video' | 'image' | 'graphic';
  playback: PreparedPlayback;
  /** Seconds into the source media where the beat should start. */
  sourceStart: number;
  sourceEnd: number;
  beatDuration: number;
  /** Set when the media is shorter than the beat and motion must cover the gap. */
  shortfall: number;
  notes: string;
}

// ---------------------------------------------------------------------------
// Motion plan (stage 9 — precise, renderer-facing instructions)
// ---------------------------------------------------------------------------

export interface MotionCameraMove {
  type: CameraType;
  startScale: number;
  endScale: number;
  startFrame: number;
  endFrame: number;
  /** Normalised 0–1 focal point the scale animates around. */
  originX: number;
  originY: number;
  easing: 'linear' | 'easeOut' | 'easeInOut' | 'snap';
}

export interface MotionTextCue {
  treatment: TextTreatment;
  content: string;
  startFrame: number;
  endFrame: number;
  emphasisWords: string[];
}

export interface MotionTransition {
  type: TransitionType;
  startFrame: number;
  durationFrames: number;
  sourceElement?: string;
  destinationElement?: string;
}

export interface MotionShot {
  beatId: string;
  index: number;
  startFrame: number;
  endFrame: number;
  durationFrames: number;
  assetUrl: string;
  assetType: 'video' | 'image' | 'graphic';
  playback: PreparedPlayback;
  sourceStartSeconds: number;
  camera: MotionCameraMove;
  text?: MotionTextCue;
  transitionOut?: MotionTransition;
  visualType: VisualType;
  narrationText: string;
  musicEnergy: number;
}

export interface MotionSfxCue {
  url: string;
  startFrame: number;
  description: string;
}

export interface MotionPlan {
  filmId: string;
  fps: number;
  width: number;
  height: number;
  /**
   * The design canvas the film is composed on. The platform render service is
   * pinned to 1920×1080, so a portrait film is laid out at 1080×1920 here and
   * the composition scales that canvas into the fixed frame.
   */
  canvas?: { width: number; height: number };
  /** 0–1 ceiling for the music bed, from the brief's volume slider. */
  musicVolume?: number;
  durationInFrames: number;
  shots: MotionShot[];
  sfx: MotionSfxCue[];
  music: { url: string | null; arc: MusicArcSection[] } | null;
  palette: { background: string; ink: string; accent: string; scrim: string };
  typography: { headingFont: string; bodyFont: string };
  continuity: ContinuityGuide;
}

// ---------------------------------------------------------------------------
// FilmSpec — immutable once compiled; revisions create v2, v3 …
// ---------------------------------------------------------------------------

export interface FilmSpec {
  version: number;
  filmId: string;
  timeline: EditorialTimeline;
  resolvedAssets: Record<string, ResolvedAsset>; // beatId → asset
  motionPlan: MotionPlan;
  narrationUrl: string;
  narrationTimestamps: WordTimestamp[];
  createdAt: string;
  /** What changed relative to the previous version. Empty on v1. */
  revisionNotes?: string[];
}

export interface ValidationIssue {
  code: string;
  beatId?: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

export interface FrameRef {
  /** Seconds into the rendered film. */
  t: number;
  url: string;
  beatId?: string;
}

export interface RenderResult {
  mp4Url: string;
  frames: FrameRef[];
  adapter: string;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// QA — two separate stages with different failure paths
// ---------------------------------------------------------------------------

export type MechanicalCheckId =
  | 'duration_match' | 'audio_present' | 'audio_sync'
  | 'no_long_black' | 'frame_rate_consistent' | 'no_narration_gaps';

export interface MechanicalCheck {
  id: MechanicalCheckId;
  pass: boolean;
  detail: string;
  /** The measured value, so a fix has evidence rather than a guess. */
  measured?: number;
  expected?: number;
}

export interface MechanicalQAResult {
  pass: boolean;
  checks: MechanicalCheck[];
  /** Set when a check could not run at all (e.g. the host blocked frame reads). */
  inconclusive: string[];
}

export interface CreativeQAIssue {
  beatId: string | null;
  category:
    | 'visual_supports_narration' | 'hook_strength' | 'broll_overuse'
    | 'ai_video_overuse' | 'repeated_composition' | 'metaphor_too_literal'
    | 'match_cut_implausible' | 'text_duplicates_narration' | 'music_drowns_narration';
  severity: 'blocking' | 'minor';
  issue: string;
  fix: string;
}

export interface CreativeQAResult {
  pass: boolean;
  score: number;                        // 0–10
  issues: CreativeQAIssue[];
  summary: string;
}

export interface FinalFilm {
  filmId: string;
  mp4Url: string;
  durationSeconds: number;
  mode: FacelessMode;
  specVersion: number;
  beatCount: number;
  tierMix: Record<AssetTier, number>;
  estimatedCost: number;
  narrationUrl: string;
  mechanicalQA: MechanicalQAResult | null;
  creativeQA: CreativeQAResult | null;
  revisionsUsed: number;
  finalizedAt: string;
}

// ---------------------------------------------------------------------------
// Pipeline surface
// ---------------------------------------------------------------------------

export type PipelineStageId =
  | 'narration' | 'analysis' | 'asset_index' | 'editorial' | 'visual_plan'
  | 'assets' | 'prepare' | 'motion' | 'compile' | 'validate' | 'render'
  | 'mechanical_qa' | 'creative_qa' | 'revision' | 'finalize';

export type StageState = 'pending' | 'active' | 'done' | 'failed' | 'skipped';

export interface StageUpdate {
  stage: PipelineStageId;
  state: StageState;
  label: string;
  detail?: string;
  /** 0–1 within the stage, when the stage can measure itself. */
  progress?: number;
}

export interface FacelessFilmInput {
  script: string;
  topic: string;
  mode?: FacelessMode;
  voiceId?: string;
  /** Absent on runs created before the delivery options existed. */
  settings?: FilmSettings;
}

/** Everything a run accumulates, so the UI can show work in progress. */
export interface FilmRunState {
  filmId: string;
  input: FacelessFilmInput;
  narration: NarrationResult | null;
  analysis: NarrativeAnalysis | null;
  assetIndex: AssetIndex | null;
  timeline: EditorialTimeline | null;
  visualPlan: VisualPlan | null;
  resolvedAssets: Record<string, ResolvedAsset>;
  preparedAssets: PreparedAsset[];
  motionPlan: MotionPlan | null;
  specs: FilmSpec[];
  renders: RenderResult[];
  mechanicalQA: MechanicalQAResult | null;
  creativeQA: CreativeQAResult | null;
  revisionsUsed: number;
  spend: number;
  final: FinalFilm | null;
}

/** Thrown with a stage attached so the UI can point at the step that failed. */
export class FacelessError extends Error {
  stage: PipelineStageId;
  code: string;

  constructor(message: string, stage: PipelineStageId, code = 'faceless_error') {
    super(message);
    this.name = 'FacelessError';
    this.stage = stage;
    this.code = code;
  }
}
