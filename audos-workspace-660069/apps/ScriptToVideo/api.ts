/**
 * Script-to-Video — shared types, design tokens and platform helpers for the
 * rebuilt pipeline (Sep 2026):
 *
 *   Script → GPT Sol writer/critic with Opus fallback → Scene plan
 *          → Veo (cinematic) / HTML+SVG+GSAP (graphics & product mockups) / assets
 *          → FFmpeg.wasm (browser assembly) → Final MP4
 *
 * No Remotion. No HeyGen. Planning runs in the app; paid production is handed
 * to the durable server runner and every checkpoint is persisted. Every step is
 * persisted to WorkspaceDB (s2v_films / s2v_film_scenes / s2v_asset_registry)
 * the moment it lands, so a reload or tab close resumes instead of restarting.
 * Each scene is independent: it has its own type, spec, status, clip and
 * fingerprint, so regenerating one scene never touches the others.
 */

import type { ShotIntent } from '../../lib/videoEngines';
import type {
  AudioPolicy, ControlMode, EntryType, ExecutionMode, LongFormSection,
  OrchestratorIntent, ProjectState, VideoStyleId,
} from './v2Contracts';
import { callHook, getSessionId, spaceId, workspaceTokenNow, WORKSPACE_ID } from '../../lib/workspace';

// ---------------------------------------------------------------------------
// Session / auth plumbing
// ---------------------------------------------------------------------------

export function sessionId(): string {
  return getSessionId();
}

export function wsToken(): string {
  return workspaceTokenNow();
}

function wdb(): any {
  const db = typeof window !== 'undefined' ? (window as any).__workspaceDb : null;
  if (!db) throw new Error('Your workspace session is still loading — try again in a moment.');
  return db;
}

export function appId(): string {
  return spaceId();
}

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export type FilmStatus = 'draft' | 'planning' | 'plan_ready' | 'producing' | 'assembling' | 'ready' | 'error' | 'cancelled' | 'blocked';
/** Sequential pipeline vocabulary (waiting/ready/generating/completed/failed/skipped).
 * The legacy values (pending/error, and 'ready' meaning "clip done") still exist on
 * rows written before the rebuild — normalizeScene() maps them on read. */
export type SceneStatus = 'waiting' | 'ready' | 'queued' | 'submitted' | 'processing' | 'generating' | 'completed' | 'succeeded' | 'failed' | 'cancelled' | 'retrying' | 'needs_action' | 'skipped' | 'pending' | 'error';
export type SceneType = 'video_clip' | 'veo_cinematic' | 'web_graphic' | 'product_mockup' | 'asset_overlay';
export type Aspect = '16:9' | '9:16' | '1:1';

// ---- Sequential pipeline (Sep 2026 rebuild) ----

/** Explicit pipeline state machine. Stored on films.machine_state. */
export type MachineState =
  | 'SCRIPT_RECEIVED' | 'ANALYZING_SCRIPT' | 'SEGMENTING_SCRIPT'
  | 'PREPARING_SCENE' | 'PROMPT_READY' | 'GENERATING_VIDEO' | 'VIDEO_COMPLETED'
  | 'EXTRACTING_FINAL_FRAME' | 'FRAME_READY' | 'DETERMINE_NEXT_REFERENCE' | 'PREPARE_NEXT_SCENE'
  | 'ALL_SCENES_COMPLETED' | 'AUDIO_PLANNING' | 'AUDIO_GENERATING' | 'AUDIO_READY'
  | 'FFMPEG_ASSEMBLY' | 'FINAL_VIDEO';

export type ReferenceType = 'previous_final_frame' | 'character_reference' | 'scene_reference' | 'none';

/** One reference asset attached to a generation request. The previous scene's
 * final frame travels as the seed first frame; character/scene references
 * travel as reference images. */
export interface ReferenceAsset {
  role: 'first_frame' | 'reference';
  url: string;
  assetId?: number | string;
  type?: 'character' | 'product' | 'environment' | 'continuity-frame' | 'style' | 'storyboard';
  /** Human-readable identity persisted with the exact provider request. */
  label?: string;
  /** Cast id used to enforce one best sheet per on-screen character. */
  characterId?: string;
  /** Immediate prior scene that produced a continuity frame. */
  sourceSceneId?: number;
  sourceSceneIndex?: number;
  /** Extraction evidence for continuity-frame inputs. */
  method?: 'ffmpeg' | 'canvas' | 'server-ffmpeg';
  atSecond?: number;
  priority?: number;
  critical?: boolean;
  storyboardOnly?: boolean;
  sourceProjectId?: number;
  /** Present only on proof records for inputs omitted by a provider cap. */
  dropReason?: string;
}

/** Script-grounded cast metadata. `inferred_fields` names only values the
 * planner inferred rather than copied directly from the script, so the review
 * UI never presents an inference as quoted canon. */
export type FilmCharacterKind = 'main' | 'narrator' | 'side';
export interface CharacterCoverage {
  scene: number;
  lines: string[];
}
export interface CharacterVoiceProfile {
  tone: string;
  accent: string;
  pace: string;
  voice_id?: string;
  voice_name?: string;
}
export interface FilmCharacterProfile {
  id: string;
  name: string;
  kind: FilmCharacterKind;
  role: string;
  age_appearance: string;
  wardrobe: string;
  personality_voice: string;
  voice: CharacterVoiceProfile;
  appearance: string;
  coverage: CharacterCoverage[];
  inferred_fields: string[];
}

/** A proposed cast member plus the locked sheet image used by every block.
 * Approval is explicit: Start stays gated until every retained sheet is
 * approved. Legacy rows omit the richer fields and remain readable. */
export interface FilmCharacter extends FilmCharacterProfile {
  url: string | null;
  approved: boolean;
  source?: 'generated' | 'uploaded' | 'library';
  source_reference_id?: number | null;
  image_error?: string;
  image_model?: string;
}

// ---- Audio layer (narration / music / SFX — Sep 2026 audio completion) ----

/** On-camera spoken line extracted from the ORIGINAL script at segmentation.
 * When present, the prepared video prompt MUST carry an explicit
 * Dialogue/Speaker/Delivery block so the video model actually voices the line,
 * and the scene keeps its native audio as the authoritative voice at assembly
 * (ElevenLabs narration is skipped for it — exactly one voice per scene). */
export interface SceneDialogue {
  /** Whether the words are spoken on camera or as narrator voice-over. */
  kind?: 'character' | 'narrator';
  /** The exact spoken words, copied from the accepted script — never paraphrased. */
  line: string;
  /** Character id of the speaker (from plan.characters). */
  speaker: string;
  /** Tone / emotion / energy of the delivery. */
  delivery: string;
  language: string;
  accent?: string;
}

/** Per-scene ElevenLabs narration produced by the audio stage. */
export interface SceneNarration {
  text: string;
  voiceId: string;
  audioUrl: string;
  duration_s: number;
}

/** One consistent voice identity for the whole film, chosen by Opus before any
 * narration is generated. Reused verbatim when a single line is regenerated so
 * the new take never sounds like a different person. */
export interface VoicePlan {
  tone: string;
  energy: string;
  pace: string;
  emotion: string;
  language: string;
  accent: string;
  voiceId: string;
  voiceName: string;
}

/** Which engine speaks the film's narration, chosen on the voiceover step.
 * 'none' is always available and needs nothing generated, which is what keeps
 * the step optional instead of a gate the pipeline waits behind. */
export type VoiceSourceId = 'none' | 'elevenlabs' | 'openai';

export interface AudioNarrationEntry {
  scene_key: string;
  /** Natural spoken wording for this scene — faithful to the original script. */
  text: string;
  /** 'elevenlabs' / 'openai' = that TTS engine is this scene's authoritative
   * voice; 'video_native' = the clip's own generated dialogue is (narration
   * skipped); 'none' = the scene is silent (no words, or no voiceover). */
  voice_source: 'elevenlabs' | 'openai' | 'video_native' | 'none';
  /** What the SOUND DIRECTOR decided for this line, independent of the voice
   * source the customer picked. Kept so switching the source off and back on
   * restores the right lines instead of losing which scenes had words. */
  planned_source?: 'elevenlabs' | 'video_native' | 'none';
  voiceId?: string;
  audioUrl?: string;
  duration_s?: number;
  status: 'pending' | 'ready' | 'failed';
  error?: string;
}

export interface AudioMusicPlan {
  required: boolean;
  preset: string;
  /** The provider that rendered the current bed. Older plans omit this. */
  provider?: 'elevenlabs' | 'gemini';
  /** Why an optional bed was skipped automatically rather than by the user. */
  skip_reason?: 'providers_unavailable';
  /** Optional richer brief for the custom music endpoint (style, energy,
   * tempo, mood, arc). Preset is the fallback. */
  customPrompt?: string;
  mood?: string;
  /** Music bed volume under the mix (0..1) — narration always ducks it further. */
  volume?: number;
  audioUrl?: string;
  duration_s?: number;
  status: 'pending' | 'ready' | 'failed' | 'skipped';
  error?: string;
}

export interface AudioSfxItem {
  scene_key: string;
  /** What the sound is for (e.g. 'whoosh on the reveal'). */
  description: string;
  /** Sound-design brief sent to the audio engine. */
  prompt: string;
  /** Offset in seconds from the START of the scene. */
  at_s: number;
  volume: number;
  audioUrl?: string;
  duration_s?: number;
  status: 'pending' | 'ready' | 'failed';
  error?: string;
}

/** The film's whole audio production state — persisted on films.audio after
 * every layer so a reload resumes. Regenerating any of it NEVER touches the
 * generated video clips. */
export interface FilmAudio {
  version: 1;
  voice_plan: VoicePlan | null;
  narration: AudioNarrationEntry[];
  music: AudioMusicPlan | null;
  sfx: AudioSfxItem[];
  sfx_status: 'pending' | 'ready' | 'failed' | 'skipped' | 'none';
  /** The engine speaking this film's narration. Absent on films planned before
   * the voiceover step became optional — those were all ElevenLabs. */
  voice_source?: VoiceSourceId;
  /** The built-in voice used while voice_source is 'openai' (alloy, nova, …). */
  openai_voice?: string;
  /** Durable, customer-readable provenance when ElevenLabs failed twice and
   * narration continued on the built-in voice. */
  voice_used?: 'none' | 'elevenlabs' | 'openai' | 'video_native';
  voice_fallback_reason?: string;
  /** Fingerprint of scene keys + segments + durations the plan was made for —
   * a mismatch means scenes changed and narration must be re-planned. */
  planned_fingerprint: string;
  planned_at: string;
}

export interface Palette { bg: string; ink: string; accent: string; accent2: string }

/** Veo scene: Opus writes the visual brief; the final prompt is assembled at
 * render time so continuity attributes from the previous scene can be folded in. */
export interface VeoSpec {
  visual_brief: string;          // subject, action, setting, composition
  style: string;                 // e.g. "documentary handheld, natural light"
  camera: string;                // framing + movement
  mood: string;                  // color mood / lighting
  seed_from_previous?: boolean;  // chain from prior scene's last frame
  duration_s?: number;           // 4–8
}

export type GraphicTreatment =
  | 'kinetic_type' | 'documentary_card' | 'flow' | 'stat' | 'bars'
  | 'list' | 'compare' | 'timeline' | 'node_map' | 'quote' | 'annotated';

export interface GraphicItem { label: string; sublabel?: string; value?: number; imageUrl?: string }

export interface GraphicSpec {
  treatment: GraphicTreatment;
  title?: string;
  subtitle?: string;
  items?: GraphicItem[];
  leftTitle?: string; rightTitle?: string;
  leftItems?: string[]; rightItems?: string[];
  stat?: { value: number; prefix?: string; suffix?: string; label?: string };
  backdropUrl?: string;          // asset image behind the graphic (any treatment; dimmed behind text)
  /** AI image brief for a contextual backdrop (subject, setting, mood — no
   * text). When set and backdropUrl is empty, the pipeline generates the
   * image once via the workspace image engine and persists it as backdropUrl. */
  backdrop_prompt?: string;
  footnote?: string;
  palette?: Partial<Palette>;    // Opus varies this per scene — never the same card twice
  texture?: 'grid' | 'dots' | 'diagonal' | 'none';
  duration_s?: number;
}

export interface MockupSpec {
  device: 'phone' | 'laptop' | 'browser';
  screenshot_url: string;        // the REAL product screenshot — never AI-recreated
  headline?: string;
  caption?: string;
  motion: 'scroll' | 'zoom' | 'pan' | 'highlight';
  /** Fractional region of the screenshot to zoom to / spotlight (0..1). */
  focus?: { x: number; y: number; w: number; h: number };
  url_bar_text?: string;         // browser device only
  palette?: Partial<Palette>;
  duration_s?: number;
}

export interface OverlaySpec {
  asset_url: string;             // existing project asset (image)
  motion: 'kenburns_in' | 'kenburns_out' | 'pan_left' | 'pan_right';
  labels?: { text: string; at?: number }[]; // deterministic on-screen labels
  palette?: Partial<Palette>;
  duration_s?: number;
}

/** MANUAL SCRIPT MODE — one scene exactly as parsed from a pre-formatted
 * script the customer pasted. No model reads the brief in this mode: the
 * parser in ./manualScript.ts produces these objects and the generation
 * prompt is assembled from them deterministically. */
export interface ManualDialogueLine { speaker: string; line: string }

export interface ParsedScene {
  /** 1-based position in the pasted script. */
  index: number;
  title: string;
  durationSec: number;
  visual: string;
  dialogue: ManualDialogueLine[];
  /** Exact display copy parsed from an "On-screen text:" block. It is burned
   * during final assembly and never sent to the video model. */
  onScreenText: string[];
  camera: string;
}

/** A whole pasted script: its scenes plus the trailing overall-style block. */
export interface ParsedScript { scenes: ParsedScene[]; globalStyle: string }

/** Sequential-pipeline scene spec: prep context stored beside the prompt.
 * The prompt itself lives in the scene row's `prompt` column. */
export interface VideoClipSpec {
  summary?: string;              // what happens in this clip (director's one-liner)
  visual_goal?: string;          // the visual outcome this clip must land
  negative?: string;             // negative prompt sent with the generation
  reasoning?: string;            // director's continuation/reference reasoning
  characters?: string[];         // character ids appearing in this clip
  /** Creative decision → shared routeShotIntent() → concrete workflow/engine. */
  shot_intent?: ShotIntent;
  workflow_kind?: 'engine' | 'recipe' | 'code' | 'unavailable';
  engine_id?: string | null;
  engine_reason?: string;
  /** Every duration adjustment or violation is surfaced, never silent. */
  duration_notes?: string[];
  duration_s?: number;
  timed_beats?: Array<{ start_s: number; end_s: number; action: string; camera?: string; dialogue?: string; audio?: string }>;
  model_assignment?: { model_id: string; operation: 'generate' | 'edit-existing'; locked: boolean; reason: string; alternative_model_id?: string };
  reference_asset_ids?: Array<number | string>;
  storyboard_only_asset_ids?: Array<number | string>;
  storyboard_url?: string;
  storyboard_caption?: string;
  storyboard_only?: boolean;
  storyboard_status?: 'loading' | 'ready' | 'error';
  storyboard_error?: string | null;
  storyboard_approved?: boolean;
  excluded_optional_references?: Array<{ asset_id?: number | string; url: string; reason: string; type?: string; label?: string }>;
  /** Immutable-at-submit proof of the exact image inputs sent to the provider. */
  request_evidence?: {
    built_at: string;
    model: string;
    frame_chain: { source_scene_id?: number; source_scene_index?: number; method?: string; at_second?: number; url?: string; status: 'first_scene' | 'sent' | 'continued_without' };
    references_used: ReferenceAsset[];
    dropped: Array<ReferenceAsset & { dropReason: string }>;
  };
  prompt_version?: number;
  background?: {
    idempotency_key?: string;
    status?: 'queued' | 'submitted' | 'processing' | 'succeeded' | 'failed' | 'cancelled' | 'retrying' | 'needs_action';
    provider_status?: string;
    provider_job_id?: string;
    retries?: number;
    max_retries?: number;
    /** Automatic semantic/asset repair is bounded independently from provider
     * submit retries: one bad completed clip gets one repair render, never a loop. */
    repair_attempts?: number;
    next_retry_at?: string;
    credits_estimated?: number;
    credits_reserved?: number;
    credits_actual?: number;
    actual_duration_s?: number;
    frame_extraction?: {
      status: 'extracting' | 'validating' | 'uploading' | 'ready' | 'failed' | 'continued_without';
      method?: 'ffmpeg' | 'canvas' | 'server-ffmpeg';
      at_second?: number;
      url?: string;
      error?: string;
      choice_recorded_at?: string;
    };
    [key: string]: unknown;
  };
  /** Manual Script Mode: this scene exactly as parsed from the pasted script. */
  manual?: ParsedScene;
}

export type SceneSpec = VideoClipSpec | VeoSpec | GraphicSpec | MockupSpec | OverlaySpec;

export interface PlanScene {
  scene_key: string;
  idx: number;
  type: SceneType;
  script_segment: string;
  duration_s: number;
  continuity_group: string | null;
  rationale?: string;
  spec: SceneSpec;
  /** Sequential pipeline: on-camera dialogue extracted from the script. */
  dialogue?: SceneDialogue | null;
  /** Sequential pipeline: director's one-line summary of the clip. */
  summary?: string;
  /** Sequential pipeline: the visual outcome this clip must land. */
  visual_goal?: string;
  /** Sequential pipeline: character ids appearing in this clip. */
  characters?: string[];
}

/** Film-level visual identity the director chooses from the script's tone and
 * subject matter — typography, base palette and mood. The renderer applies
 * these verbatim; the old hardcoded font/palette constants only serve films
 * planned before this field existed. */
export interface FilmStyle {
  /** CSS font stack of LOCALLY AVAILABLE system fonts — the SVG capture path
   * rasterizes through an <img> and cannot load webfonts. */
  font_family: string;
  heading_weight: number;
  body_weight: number;
  colors: { primary: string; secondary: string; accent: string; background: string; text: string };
  visual_mood: string;
}

export interface FilmPlan {
  title: string;
  style_direction: string;       // one-paragraph visual north star for the film
  /** Director-chosen typography + palette + mood, matched to the script (legacy pipeline). */
  style?: FilmStyle;
  scenes: PlanScene[];
  assumptions?: string[];
  // ---- Sequential pipeline GLOBAL CONTEXT (layer 1 of the three-layer prompt system) ----
  /** What the whole story is — Opus writes this after reading the ENTIRE script. */
  story_summary?: string;
  /** The world/setting shared by every scene. */
  world?: string;
  /** The film-wide visual style (look, palette, lens language, mood). */
  visual_style?: string;
  /** Script-derived cast. Sheet URLs and approval live on film.character_refs. */
  characters?: FilmCharacterProfile[];
  /** How these scenes were produced: 'ai' = the director model read the brief
   * and segmented it; 'manual' = they were parsed from a pre-formatted pasted
   * script and no director model runs at any step. Absent on films planned
   * before Manual Script Mode existed (they are all 'ai'). */
  input_mode?: 'ai' | 'manual';
  /** Manual Script Mode: the overall-style block at the end of the pasted
   * script. Appended to the end of every scene's generation prompt. */
  global_style?: string;
  /** Creator-approved total runtime used by the legal block packer. */
  requested_duration_s?: number | null;
  /** Brief-stage sound choices. Absent only on legacy films. */
  audio_enabled?: boolean;
  narration_enabled?: boolean;
  characters_speak?: boolean;
  /** Start is blocked until all retained sheets are approved, or the creator
   * explicitly confirms that a character-free script needs no cast. */
  cast_reviewed?: boolean;
  // ---- Script-to-Video V2 durable contract (kept in this existing JSON column) ----
  contract_version?: 2;
  entry_type?: EntryType;
  control_mode?: ControlMode;
  execution_mode?: ExecutionMode;
  video_style?: VideoStyleId;
  custom_visual_direction?: string;
  target_duration_sec?: number;
  audio_policy?: AudioPolicy;
  max_authorized_credits?: number;
  master_script_version?: number;
  scene_plan_version?: number;
  model_registry_snapshot?: { version: string; captured_at: string; capabilities: unknown[] };
  project_asset_ids?: Array<number | string>;
  storyboard_only_asset_ids?: Array<number | string>;
  storyboard_requested?: boolean;
  writer_model?: 'GPT Sol' | 'Opus';
  continuity_manifest?: {
    version: number;
    cast: Record<string, unknown>;
    style: Record<string, unknown>;
    locations: Record<string, unknown>;
    products: Record<string, unknown>;
    handoffs: Array<Record<string, unknown>>;
  };
  clip_ids?: Array<number | string>;
  sections?: LongFormSection[];
  orchestration?: {
    state: ProjectState;
    intent: OrchestratorIntent;
    checkpoint: string;
    manual_locks: Record<string, boolean>;
    paused: boolean;
    cancel_requested: boolean;
    completed_count: number;
    total_count: number;
    credits_estimated: number;
    credits_reserved: number;
    credits_actual: number;
    billed_so_far: number;
    decision?: { reason: string; options: string[]; free_text: boolean };
    updated_at: string;
  };
  /** Required display copy is a post-production layer, never a video-model
   * requirement. Stored in the existing plan JSON because this workspace is at
   * its table limit. */
  on_screen_text?: OnScreenTextItem[];
  assembled_media_id?: string;
  editor_composition_version?: number;
  editor_composition?: Record<string, unknown>;
  export_records?: Array<{ id: string; status: 'pending' | 'rendering' | 'complete' | 'failed'; operation_id?: string; url?: string; created_at: string; completed_at?: string; settings: Record<string, unknown> }>;
  /** Per-film Director conversation, visible tool steps, pending proposals,
   * undo snapshots and measured model-call durations. Stored here because the
   * workspace is at its table limit; no separate chat table is required. */
  assistant?: {
    messages: unknown[];
    metrics: unknown;
    trim_notice?: string;
    updated_at: string;
  };
  /** Durable unattended runner checkpoint. Kept inside the existing plan JSON
   * because this workspace is at its table limit. */
  background?: {
    enabled?: boolean;
    chain_id?: string;
    stage?: 'queued' | 'generating' | 'waiting_for_tab' | 'assembling' | 'ready' | 'failed';
    review_gate?: boolean;
    captions?: boolean;
    lease_owner?: string;
    lease_until?: string | null;
    next_poll_at?: string;
    notify_sent?: boolean;
    failure_notify_sent?: boolean;
    final_url?: string;
    [key: string]: unknown;
  };
}

export type OnScreenTextPosition = 'top' | 'center' | 'bottom';
export type OnScreenTextStyle = 'clean' | 'boxed' | 'accent';

export interface OnScreenTextItem {
  id: string;
  text: string;
  /** Scene keys are the durable editorial intent; absolute times are the
   * editable assembly coordinates derived from the current cut. */
  scene_keys?: string[];
  start_s: number;
  end_s: number;
  position: OnScreenTextPosition;
  style: OnScreenTextStyle;
  source?: 'brief' | 'manual' | 'user';
}

export interface FilmFinishState {
  settings: {
    narration: boolean;
    voiceId?: string;
    music: boolean;
    musicPreset: string;
    captions: boolean;
  };
  source_fingerprint: string;
  narration_urls?: string[];
  music_url?: string;
  captions_srt?: string;
  /** Evidence from sampling the assembled output during each overlay window. */
  text_overlay_check?: {
    pass: boolean;
    checked_at: string;
    items: Array<{ id: string; text: string; at_s: number; frame_url?: string; pass: boolean; issue?: string }>;
  };
  completed_at?: string;
}

export interface Film {
  id: number;
  title: string | null;
  script: string | null;
  aspect_ratio: Aspect | null;
  status: FilmStatus | null;
  stage_note: string | null;
  plan: FilmPlan | null;
  continuity: Record<string, { keyframe_url?: string; attributes?: any }> | null;
  brand: any;
  product_screenshot_url: string | null;
  final_video_url: string | null;
  final_thumb_url: string | null;
  duration_s: number | null;
  error: string | null;
  finish: FilmFinishState | null;
  /** Sequential pipeline state machine state (null on pre-rebuild films). */
  machine_state: MachineState | null;
  /** Locked character reference images: [{ id, name, appearance, url }]. */
  character_refs: FilmCharacter[] | null;
  /** The character reference image the CUSTOMER uploaded on the create screen
   * (durable public URL). It drives the dual-reference (n+1) method in every
   * generation mode: it travels alongside the previous scene's extracted
   * final frame so one character stays consistent across clips. */
  character_ref_url?: string | null;
  /** Audio production state: voice plan, per-scene narration, music, SFX. */
  audio: FilmAudio | null;
  /** Video model id this film's clips render on ('omni-flash' | 'seedance-2.0'
   * | 'kling-v2-master'). Null = omni-flash (pre-picker films). */
  video_model: string | null;
  /** STYLE LOCK — true = the film's look is frozen after scene 1 and the
   * extracted fingerprint is prepended to every later prompt, so clip 7
   * cannot drift into a different palette or lens language than clip 1. */
  style_lock: boolean | null;
  /** The style fingerprint itself (palette, lighting, lens language, mood),
   * extracted once scene 1 completes. Null until then. */
  style_lock_description: string | null;
  /** Stored references resolved from the script's @name mentions. They ride
   * along with EVERY scene of the film, so a character summoned with
   * @maya looks like the same person in every clip. */
  at_references?: AtReference[] | null;
  /** True when the user has archived this film from the Library — hidden from
   * the default list but never deleted. Null/false = active. */
  is_archived?: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface FilmScene {
  id: number;
  film_id: number;
  idx: number;
  scene_key: string;
  type: SceneType;
  script_segment: string;
  spec: SceneSpec;
  status: SceneStatus;
  error: string | null;
  asset_url: string | null;
  /** ElevenLabs narration for CAPTURED (motion-graphic / mockup / overlay)
   * scenes only — Veo cinematic scenes keep their native dialogue/ambient
   * audio and never carry one. Mixed into the scene's segment at assembly. */
  narration_url?: string | null;
  clip_fingerprint: string | null;
  veo_operation_id: string | null;
  first_frame_url: string | null;
  keyframe_url: string | null;
  visual_attributes: any;
  validation: ({
    pass?: boolean;
    issues?: string;
    method?: string;
    actual_model?: string;
    requested_duration?: number;
    original_url?: string;
    active_revision_id?: string | null;
    continuity_review_required?: boolean;
    /** Real decoded PCM evidence captured by ClipAudioStatus. Infinity is
     * normalized to null before JSON persistence for a track with no signal. */
    audio_probe?: {
      hasAudioTrack: boolean;
      audible: boolean;
      channels: number;
      sampleRate: number;
      durationS: number;
      rms: number;
      rmsDb: number | null;
      peak: number;
      peakDb: number | null;
      measured_at: string;
    };
    revisions?: Array<{
      id: string;
      before_url: string;
      after_url: string;
      before_keyframe_url?: string | null;
      after_keyframe_url?: string | null;
      instruction: string;
      model: string;
      edited_window_s?: number;
      preserved_remainder_s?: number;
      assembled_from_window?: boolean;
      boundary_evidence?: string;
      operation_id?: string;
      incremental_cost?: string;
      status: 'preview' | 'accepted' | 'undone';
      created_at: string;
    }>;
    [key: string]: unknown;
  }) | null;
  duration_s: number | null;
  continuity_group: string | null;
  /** Sequential pipeline: the production-ready prompt Opus prepared for this clip
   * (three-layer context). Null until the scene is prepared. */
  prompt: string | null;
  /** Opus's continuation decision: true = continue from the previous scene's final
   * frame; false = independent scene that must NOT receive the previous frame. */
  continuation: boolean | null;
  reference_type: ReferenceType | null;
  reference_assets: ReferenceAsset[] | null;
  /** On-camera spoken line from the ORIGINAL script (null = no on-camera speech). */
  dialogue: SceneDialogue | null;
  /** ElevenLabs narration attached to this scene by the audio stage. */
  narration: SceneNarration | null;
  /** When this row last changed. The scene watchdog measures a stall from
   * HERE rather than from when a tab happened to open the film, so a render
   * abandoned an hour ago reads as stalled immediately. */
  updated_at?: string;
}

/**
 * Map legacy scene rows (pre-rebuild vocabulary) onto the sequential pipeline
 * vocabulary at READ time. Never written back — writes always use new values.
 *   pending → waiting · error → failed
 *   ready without a prepared prompt = a legacy FINISHED clip → completed
 */
export function isDeferredTextIssue(value: unknown): boolean {
  const issue = String(value || '').trim();
  if (!issue) return false;
  const namesDisplayCopy = /(?:on[- ]screen text|typography|wordmark|end card|address bar|\burl\b|\baddress\b|(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+\.(?:com|io|ai|co|org|net)\b)/i.test(issue);
  const saysItIsMissing = /(?:missing|absent|omitt|not (?:legibly )?(?:shown|visible)|not legible|does not (?:show|display|contain)|with no\b)/i.test(issue);
  // A mixed failure still needs scene review. Only copy-only flags are moved to
  // post-production; identity, action, environment and broken-frame defects stay.
  const alsoNamesVisualFailure = /(?:character|identity|wardrobe|wrong subject|wrong scene|broken|black frame|empty frame|action|environment|constellation|interface windows|network nodes|workspaces|path central|visualization is absent)/i.test(issue);
  return namesDisplayCopy && saysItIsMissing && !alsoNamesVisualFailure;
}

export function normalizeScene(row: FilmScene): FilmScene {
  const s = String(row.status || '');
  let status: SceneStatus;
  if (s === 'pending') status = 'waiting';
  else if (s === 'error') status = 'failed';
  else if (s === 'ready' && !row.prompt) status = row.asset_url ? 'completed' : 'waiting';
  else status = (s as SceneStatus) || 'waiting';
  // Historical raw clips may have been failed solely because display copy was
  // absent, even though generation prompts correctly forbid model-made text.
  // Treat those assets as completed in memory and preserve the original issue
  // verbatim as provenance; the final assembled-film check owns text validity.
  const deferText = Boolean(row.asset_url && isDeferredTextIssue(row.validation?.issues));
  if (deferText) {
    return {
      ...row,
      status: 'completed',
      error: null,
      validation: { ...(row.validation || {}), pass: true, raw_clip_pass: true, text_overlay_deferred: true },
    };
  }
  return status === row.status ? row : { ...row, status };
}

/**
 * STORED REFERENCE — one picture the customer saves once and summons from any
 * script by typing @name. A character, a style plate or a location: the
 * pipeline resolves every @name mention in the script against this list and
 * injects the matches into every scene of the film.
 */
export interface StoredReference {
  id: number;
  /** The slug the customer calls with @name (lowercased, no spaces). */
  name: string;
  /** Human label shown in the reference manager. */
  display_name: string;
  /** Durable public URL the generation proxies can fetch. */
  url: string;
  type: 'character' | 'style' | 'location';
  /** Optional appearance note injected into the resolved scenes' prompts. */
  description?: string;
  created_at: string;
}

/** A resolved stored reference as it is persisted on the film row. */
export interface AtReference {
  name: string;
  url: string;
  type: StoredReference['type'];
  description?: string;
}

/** The @name a stored reference answers to, derived from its label. */
export function referenceSlug(label: string): string {
  return String(label || '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/**
 * Every @name mention in a script, resolved against the stored references.
 * Matching is case-insensitive on the slug, the result is deduped, and the
 * order follows the script so the first character mentioned has first claim
 * on a model that carries only one reference image.
 */
export function resolveAtMentions(script: string, refs: StoredReference[]): StoredReference[] {
  const mentions = String(script || '').match(/(@[a-zA-Z][\w-]*)/g) || [];
  const known = Array.isArray(refs) ? refs : [];
  const out: StoredReference[] = [];
  for (const mention of mentions) {
    const slug = mention.slice(1).toLowerCase();
    const match = known.find((r) => String(r?.name || '').toLowerCase() === slug);
    if (match && !out.some((r) => r.id === match.id)) out.push(match);
  }
  return out;
}

export interface AssetRow {
  id: number;
  film_id: number | null;
  kind: 'character' | 'environment' | 'storyboard' | 'style' | 'icon' | 'product' | 'screenshot' | 'generated_image' | 'keyframe' | 'clip';
  name: string;
  description: string | null;
  url: string;
  tags: string[] | null;
  fingerprint: string | null;
}

// ---------------------------------------------------------------------------
// WorkspaceDB access (browser SDK — session-scoped rows)
// ---------------------------------------------------------------------------

/** The job id is only ever used to resume polling, but some providers
 * (Seedance 2.0, a few Runway/OpenRouter models) answer with ids thousands of
 * characters long, and the data API refuses a value longer than the column
 * holds ("value too long") — which failed the ENTIRE scene write and lost a
 * render that was already paid for. No provider's real id comes close to this
 * cap, so trimming it costs nothing and keeps the write alive. */
export const MAX_OPERATION_ID_CHARS = 2000;

export function capOperationId<T extends Partial<FilmScene>>(row: T): T {
  const id = row.veo_operation_id;
  if (typeof id !== 'string' || id.length <= MAX_OPERATION_ID_CHARS) return row;
  return { ...row, veo_operation_id: id.slice(0, MAX_OPERATION_ID_CHARS) } as T;
}

export const db = {
  async listFilms(): Promise<Film[]> {
    const { data } = await wdb().from('s2v_films').orderBy('created_at', 'desc').limit(100).get();
    return Array.isArray(data) ? data : [];
  },
  async getFilm(id: number): Promise<Film | null> {
    const { data } = await wdb().from('s2v_films').getById(id);
    return (data as Film) || null;
  },
  async createFilm(row: Partial<Film>): Promise<Film> {
    const res = await wdb().from('s2v_films').insert(row);
    const created = res?.data?.[0] || res?.data || res;
    if (!created?.id) {
      // Some SDK builds return only { success } — re-read the newest row.
      const all = await this.listFilms();
      if (all[0]?.id) return all[0];
      throw new Error('The film row could not be created.');
    }
    return created as Film;
  },
  async updateFilm(id: number, patch: Partial<Film>): Promise<void> {
    await wdb().from('s2v_films').update(id, patch);
  },
  /** Archive / unarchive a film — a soft hide that keeps the row and its clips. */
  async setFilmArchived(id: number, archived: boolean): Promise<void> {
    await wdb().from('s2v_films').update(id, { is_archived: archived });
  },
  /** Permanently delete a film and its scene rows (scenes best-effort so a
   * partial cleanup never blocks removing the film itself). */
  async deleteFilm(id: number): Promise<void> {
    try {
      const scenes = await this.listScenes(id);
      for (const s of scenes) {
        try { await this.deleteScene(s.id); } catch { /* best-effort per scene */ }
      }
    } catch { /* best-effort — still remove the film row below */ }
    await wdb().from('s2v_films').delete(id);
  },
  async listScenes(filmId: number): Promise<FilmScene[]> {
    // Every scene row a film has, however many. The data API serves at most
    // 10,000 rows per request, so the list is read in idx order one page at a
    // time until a short page ends it — there is no fixed scene ceiling here.
    const PAGE = 10000;
    const rows: FilmScene[] = [];
    let previousFirstId: number | null = null;
    for (let offset = 0; ; offset += PAGE) {
      const { data } = await wdb().from('s2v_film_scenes').eq('film_id', filmId).orderBy('idx', 'asc').limit(PAGE).offset(offset).get();
      const page: FilmScene[] = Array.isArray(data) ? data : [];
      if (page.length && page[0].id === previousFirstId) throw new Error('The scene list could not be paged — the data API returned the same page twice.');
      previousFirstId = page.length ? page[0].id : null;
      rows.push(...page);
      if (page.length < PAGE) break;
    }
    return rows.map(normalizeScene);
  },
  async insertScene(row: Partial<FilmScene>): Promise<void> {
    await wdb().from('s2v_film_scenes').insert(capOperationId(row));
  },
  async updateScene(id: number, patch: Partial<FilmScene>): Promise<void> {
    await wdb().from('s2v_film_scenes').update(id, capOperationId(patch));
  },
  async deleteScene(id: number): Promise<void> {
    await wdb().from('s2v_film_scenes').delete(id);
  },
  async listAssets(filmId?: number | null): Promise<AssetRow[]> {
    const q = wdb().from('s2v_asset_registry').orderBy('created_at', 'desc').limit(200);
    const { data } = await q.get();
    const rows: AssetRow[] = Array.isArray(data) ? data : [];
    // Project assets never bleed into another project. Cross-project reuse is
    // possible only when the caller opens the explicit import picker and asks
    // for the full owned list (filmId omitted), then copies a selected asset.
    return filmId == null ? rows : rows.filter((a) => a.film_id === filmId);
  },
  async importAssetToFilm(asset: AssetRow, filmId: number): Promise<void> {
    if (!asset?.id || !filmId) throw new Error('Choose an owned asset and a destination project.');
    await this.addAsset({
      film_id: filmId, kind: asset.kind, name: asset.name,
      description: asset.description, url: asset.url,
      tags: [...(asset.tags || []), `imported-from-project:${asset.film_id ?? 'library'}`],
      fingerprint: asset.fingerprint,
    });
  },
  async addAsset(row: Partial<AssetRow>): Promise<void> {
    try { await wdb().from('s2v_asset_registry').insert(row); } catch { /* registry is best-effort */ }
  },
  /** The customer's saved @name references (newest first). */
  async listReferences(): Promise<StoredReference[]> {
    const { data } = await wdb().from('s2v_references').orderBy('created_at', 'desc').limit(50).get();
    return Array.isArray(data) ? data : [];
  },
  async addReference(row: Partial<StoredReference>): Promise<StoredReference> {
    const res = await wdb().from('s2v_references').insert(row);
    const created = res?.data?.[0] || res?.data || res;
    if (created?.id) return created as StoredReference;
    // Some SDK builds return only { success } — find the row that just landed.
    const match = (await this.listReferences()).find((r) => r.name === row.name);
    if (match) return match;
    throw new Error('The reference was uploaded but could not be saved — try adding it again.');
  },
  async deleteReference(id: number): Promise<void> {
    await wdb().from('s2v_references').delete(id);
  },
};

// ---------------------------------------------------------------------------
// Uploads (file-storage integration)
// ---------------------------------------------------------------------------

export async function uploadDataUrl(dataUrl: string, fileName: string): Promise<string> {
  const res = await fetch('/api/upload/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-App-Id': appId() },
    body: JSON.stringify({ imageData: dataUrl, fileName }),
  });
  const data = await res.json().catch(() => null);
  const url = data && (data.imageUrl || data.url);
  if (!res.ok || typeof url !== 'string') throw new Error(String(data?.error || `Image upload failed (HTTP ${res.status}).`));
  return url;
}

export async function uploadBlob(blob: Blob, fileName: string): Promise<string> {
  const form = new FormData();
  form.append('file', new File([blob], fileName, { type: blob.type || 'application/octet-stream' }));
  form.append('folder', 's2v');
  form.append('workspaceId', WORKSPACE_ID);
  const token = wsToken();
  const res = await fetch('/api/upload/file', {
    method: 'POST',
    headers: token ? { 'X-Workspace-DB-Token': token } : undefined,
    body: form,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.url) throw new Error(String(data?.error || `File upload failed (HTTP ${res.status}).`));
  return String(data.url);
}

// ---------------------------------------------------------------------------
// AI image generation (asset-image-gen server function → Omni Flash → GCS)
// ---------------------------------------------------------------------------

/** Generate a bespoke backdrop/contextual image through the workspace's
 * cached Asset Generator server function — the same engine the other apps in
 * this workspace use. The platform AI proxy exposes no image-generation
 * endpoint (only chat and speech), so images always route through this hook,
 * which returns a durable public GCS URL. */
export async function generateBackdropImage(
  prompt: string,
  aspect: Aspect | '1:1',
  quality: 'draft' | 'premium' = 'draft',
): Promise<string> {
  const data = await callHook<{ imageUrl?: string; model?: string; error?: string }>('asset-image-gen', { op: 'generate', prompt, aspect, quality });
  const url = data?.imageUrl;
  if (typeof url !== 'string' || !/^https:\/\//i.test(url)) {
    throw new Error(String(data?.error || 'The image engine returned no durable image. Retry Fast draft, upload your own, or reuse an existing sheet.'));
  }
  return url;
}

// ---------------------------------------------------------------------------
// Fingerprints (clip cache identity) + misc
// ---------------------------------------------------------------------------

export function fingerprint(value: unknown): string {
  const text = JSON.stringify(value) || '';
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  return `s2v:${hash.toString(36)}:${text.length.toString(36)}`;
}

export function sceneFingerprint(scene: Pick<FilmScene, 'type' | 'spec'>, aspect: Aspect): string {
  return fingerprint({ t: scene.type, s: scene.spec, a: aspect });
}

export function newSceneKey(): string {
  return `sc_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(m)}:${two(s % 60)}`;
}

export function sceneTypeLabel(t: SceneType): string {
  return t === 'video_clip' ? 'AI video clip'
    : t === 'veo_cinematic' ? 'Cinematic (Veo)'
    : t === 'web_graphic' ? 'Motion graphic'
    : t === 'product_mockup' ? 'Product mockup'
    : 'Asset overlay';
}

/** Frame size the graphics/mockup captures render at, per aspect. */
export function frameSize(aspect: Aspect): { W: number; H: number } {
  return aspect === '9:16' ? { W: 1080, H: 1920 }
    : aspect === '1:1' ? { W: 1080, H: 1080 }
      : { W: 1920, H: 1080 };
}

// ---------------------------------------------------------------------------
// Design tokens — derived directly from the shared --space-* contract in
// config.json. Script-to-Video keeps its compact T API, but it no longer owns
// a second palette: shell changes flow through every one of its sub-screens.
// ---------------------------------------------------------------------------

export const T = {
  canvas: 'var(--vg-bg, #101214)',
  raised: 'var(--vg-raised, #20242A)',
  card: 'var(--vg-surface, #171A1E)',
  input: 'var(--vg-bg, #101214)',
  line: 'var(--vg-border, #343A43)',
  bone: 'var(--vg-text, #F4F5F7)',
  muted: 'var(--vg-secondary, #C4C9D0)',
  dim: 'var(--vg-muted, #9AA3AF)',
  live: 'var(--vg-accent, #D9A441)',
  done: 'var(--vg-success, #72C99A)',
  fault: 'var(--vg-danger, #F28B8B)',
  mono: "ui-monospace, 'SFMono-Regular', Consolas, monospace",
  sans: "'Manrope', 'Segoe UI', sans-serif",
} as const;
