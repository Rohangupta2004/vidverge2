/**
 * VidVerge — the agentic video system: SHAPES.
 *
 * WHAT THIS SYSTEM IS. Every other mode in this app runs a fixed pipeline:
 * write N scenes, render N clips, stitch. This one does not. A production is
 * planned by a DIRECTOR, cut into SHOTS, and then each shot is asked two
 * separate questions before anything is generated:
 *
 *   CONTINUITY AGENT  — what must persist into this shot? (character, dialogue,
 *                       UI state, physics, or nothing but the look)
 *   PRODUCTION ROUTER — which engine can actually deliver that? (Veo
 *                       image-to-video, HeyGen, Remotion, Veo text-to-video)
 *
 * The answers combine into a GenerationDecision — a small, auditable JSON
 * object that says exactly which references this shot carries and why. The
 * decision is what gets rendered, saved, and (on a failure) replayed.
 *
 * AFTER a shot renders, the FRAME ANALYZER pulls several stills out of the clip
 * and picks the BEST USABLE one rather than blindly taking the last frame — a
 * clip that ends mid-blink or mid-pan is a terrible thing to chain the next
 * shot out of. The CONTINUITY CHECK compares that frame against the masters; a
 * pass saves it into production memory, a fail regenerates the shot from a
 * bridge frame instead of failing the run.
 *
 * WHY THE TYPES LIVE ALONE IN THIS FILE. The runner, the router, the agents,
 * the engines and the UI all read the same shapes, and the shot list is
 * PERSISTED as JSON into the video_productions table — so these interfaces are
 * a storage format, not just an internal convenience. Keep them additive:
 * an older saved row must still load.
 */
import type { AspectRatio, CharacterRef } from './videoTypes';

// ---------------------------------------------------------------------------
// The five modes, plus AUTO
// ---------------------------------------------------------------------------
/**
 * `auto` is not a pipeline — it is the DEFAULT, and it means "the Director
 * Agent reads the brief and picks one of the five below". Everything
 * downstream only ever sees a resolved mode.
 */
export type VideoMode = 'auto' | 'faceless' | 'avatar' | 'ui_motion' | 'ad_creative' | 'long_series';

export type ResolvedMode = Exclude<VideoMode, 'auto'>;

export interface ModeDef {
  id: VideoMode;
  label: string;
  /** The engine the mode leads with, in the customer's words. */
  engine: string;
  blurb: string;
  /** lucide-react icon name. */
  icon: string;
  /** Longest production this mode plans, in seconds. */
  maxSeconds: number;
  /** True when the mode needs a credential this workspace may not have. */
  needsCredential?: 'heygen';
}

export const VIDEO_MODES: ModeDef[] = [
  {
    id: 'auto',
    label: 'AUTO',
    engine: 'Agent picks',
    blurb: 'Default. The director reads your brief and chooses the mode that suits it.',
    icon: 'Wand2',
    maxSeconds: 300,
  },
  {
    id: 'faceless',
    label: 'Faceless',
    engine: 'Veo 3',
    blurb: 'Explainer B-roll driven by narration — no presenter on camera.',
    icon: 'Waves',
    maxSeconds: 300,
  },
  {
    id: 'avatar',
    label: 'Avatar',
    engine: 'HeyGen',
    blurb: 'A talking head who delivers your lines to camera.',
    icon: 'UserRound',
    maxSeconds: 120,
    needsCredential: 'heygen',
  },
  {
    id: 'ui_motion',
    label: 'UI Motion',
    engine: 'Remotion',
    blurb: 'Your product screenshots, animated deterministically — state to state.',
    icon: 'MousePointerClick',
    maxSeconds: 90,
  },
  {
    id: 'ad_creative',
    label: 'Ad',
    engine: 'Veo 3 + Remotion',
    blurb: '15–30s social ad: problem, solution, product, call to action.',
    icon: 'Megaphone',
    maxSeconds: 45,
  },
  {
    id: 'long_series',
    label: 'Long Series',
    engine: 'Script + chained Veo 3',
    blurb: 'Up to five minutes, planned as chapters and chained shot by shot.',
    icon: 'Layers',
    maxSeconds: 300,
  },
];

export function getMode(id: string): ModeDef {
  return VIDEO_MODES.find((m) => m.id === id) || VIDEO_MODES[0];
}

export function modeLabel(id: string): string {
  return getMode(id).label;
}

// ---------------------------------------------------------------------------
// Engines
// ---------------------------------------------------------------------------
/**
 * The four things that can actually produce a shot. `remotion` is deliberately
 * described as DETERMINISTIC: it is not a generative model, it renders the
 * exact composition it is handed, which is the only honest way to animate real
 * product UI (a generative model cannot spell, so it cannot draw your app).
 */
export type ShotEngine = 'veo_i2v' | 'veo_t2v' | 'heygen' | 'remotion';

/** What the shot is FOR — the Continuity Agent's classification. */
export type ShotKind =
  | 'character'
  | 'dialogue'
  | 'avatar'
  | 'presenter'
  | 'talking_head'
  | 'ui'
  | 'physics'
  | 'broll'
  | 'bridge';

/** The only explicitly on-camera speaking shot types HeyGen may render. */
export function isPresenterShotKind(kind: ShotKind | undefined): kind is 'avatar' | 'presenter' | 'talking_head' {
  return kind === 'avatar' || kind === 'presenter' || kind === 'talking_head';
}

/**
 * How this shot is seeded. These are the strings written into the persisted
 * decision, so they are stable identifiers rather than prose.
 */
export type GenerationStrategy =
  | 'last_frame_plus_character_reference'
  | 'new_scene_reference'
  | 'remotion'
  | 'heygen_avatar'
  | 'text_to_video'
  | 'image_to_video'
  | 'bridge_frame';

/**
 * The Visual Metaphor Agent's verdict for one narration beat. Faceless video
 * lives or dies on this: a beat about "compound interest" wants a motion
 * graphic, a beat about "your desk at 6am" wants a generated clip, and a beat
 * that just re-states the last one wants the last frame rather than a new spend.
 */
export type VisualStrategy =
  | 'GENERATE_VIDEO'
  | 'GENERATE_IMAGE_THEN_VIDEO'
  | 'USE_STOCK'
  | 'USE_REFERENCE'
  | 'USE_LAST_FRAME'
  | 'USE_UI'
  | 'USE_MOTION_GRAPHIC'
  | 'USE_TEXT'
  | 'USE_BRIDGE_SHOT';

/**
 * How one shot gets into the next. A deliberate HARD_CUT at a problem→solution
 * boundary is not an action/framing continuity failure — it is the transformation
 * the ad is selling. The production visual bible still remains locked.
 */
export type TransitionKind =
  | 'LAST_FRAME'
  | 'MATCH_CUT'
  | 'MORPH'
  | 'WHIP_PAN'
  | 'ZOOM_THROUGH'
  | 'OBJECT_WIPE'
  | 'UI_TRANSITION'
  | 'GRAPHIC_TRANSITION'
  | 'HARD_CUT'
  | 'SOUND_BRIDGE'
  | 'BRIDGE_SHOT';

// ---------------------------------------------------------------------------
// Master references — level 1 of the reference hierarchy
// ---------------------------------------------------------------------------
/**
 * CHARACTER_MASTER. Built ONCE per production and never rebuilt: that is the
 * whole anti-drift mechanism. Every shot with a character on screen carries
 * this master plus the relevant scene reference plus the previous best frame —
 * a graph anchored on the master, not a linear chain, so shot 30 is still
 * tied to the same face as shot 1 rather than to 29 generations of drift.
 */
export interface CharacterMaster {
  id: string;
  name: string;
  /** The written lock, reused verbatim as `character_description`. */
  description: string;
  faceReference: string;
  fullBodyReference: string;
  outfitReference: string;
  hair: string;
  age: string;
  visualStyle: string;
  /** Prefixed to every prompt so the lock travels as text as well as pixels. */
  seedLine: string;
}

/**
 * PRODUCT_MASTER — the ad engine's brand-level truth. Level 1 of the ad
 * reference hierarchy (brand master → scene master → shot continuity).
 */
export interface ProductMaster {
  name: string;
  tagline: string;
  logo: string;
  screenshots: string[];
  /** Named UI states, e.g. { dashboard: url, analysis: url }. */
  uiStates: Record<string, string>;
  renders: string[];
  colors: string[];
  typography: string;
  physicalReferences: string[];
  /** Anything the brand will not do on screen. Honoured, never argued with. */
  brandRules: string;
}

/** An ENVIRONMENT reference — a recurring visual world, one per chapter/scene. */
export interface EnvironmentMaster {
  id: string;
  label: string;
  description: string;
  referenceUrl: string;
}

/** An OBJECT / visual motif that has to look the same every time it appears. */
export interface ObjectMaster {
  id: string;
  label: string;
  description: string;
  referenceUrl: string;
}

/**
 * The Faceless engine's Visual Anchor: the style, the worlds and the motifs
 * that hold a narration-driven video together when there is no face to anchor
 * on.
 */
export interface VisualAnchors {
  /** Lighting, lens, colour, composition — repeated into every prompt. */
  style: string;
  environments: EnvironmentMaster[];
  objects: ObjectMaster[];
  motifs: string[];
}

/** One node of the UI State Graph the Remotion engine animates between. */
export interface UIState {
  /** Stable id, e.g. `dashboard`, `analysis_page`, `weak_topics_expanded`. */
  id: string;
  label: string;
  imageUrl: string;
  /** What is on this screen, so the Motion Agent can animate its elements. */
  description: string;
}

/** The Motion Agent's per-element animation spec for one UI shot. */
export interface MotionSpec {
  element: string;
  entrance: 'spring_up' | 'fade' | 'slide_left' | 'slide_right' | 'scale_in' | 'none';
  /** Milliseconds. */
  duration: number;
  delay: number;
  emphasis: 'none' | 'scale_105' | 'glow' | 'outline';
  camera: 'push_in' | 'pull_back' | 'pan_left' | 'pan_right' | 'hold';
}

/**
 * The match-frame maths for handing a cinematic AI shot over to real product
 * UI: where the screen sits in the outgoing frame, so the Remotion shot can
 * start exactly there and grow into a full-bleed interface.
 */
export interface MatchFrame {
  /** 0–1 fractions of frame width/height. */
  screenPosition: { x: number; y: number; width: number; height: number };
  screenRotation: number;
  screenScale: number;
  /** CSS perspective in px, 0 for a flat-on screen. */
  perspective: number;
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------
/** One chapter — a Faceless/Long Series world that several shots share. */
export interface Chapter {
  index: number;
  title: string;
  /** The environment id every shot in this chapter anchors to. */
  environmentId: string;
  summary: string;
}

export type CameraDistance = 'wide' | 'medium' | 'close';
export type CameraMovement = 'static' | 'push' | 'pull' | 'pan';

/** The visual contract established once by the Director before any shot renders. */
export interface VisualBible {
  /** Palette plus grade, e.g. warm amber, muted, cinematic contrast. */
  colorGrade: string;
  lighting: string;
  cameraStyle: string;
  environment: string;
  atmosphere: string;
}

/** The Director Agent's output: the story or the ad, before it is cut up. */
export interface StoryPlan {
  title: string;
  logline: string;
  /** Where it lives. One renderable place. */
  world: string;
  /** Camera / grade / palette language every shot repeats. */
  look: string;
  /** The explicit five-part look lock repeated into every generated shot. */
  visualBible: VisualBible;
  /** Where the whole thing is going. */
  arc: string;
  /** The narration or ad copy, beat by beat. */
  beats: PlannedBeat[];
  chapters: Chapter[];
  /** Ad mode only: the four ad states the engine tracks. */
  adStates?: AdStates;
  cta: string;
  /** True when the planner could not be reached and this is templated. */
  fallback: boolean;
}

export interface PlannedBeat {
  index: number;
  /** 1–2 word beat name: Hook, Problem, Turn, Proof, Land. */
  label: string;
  /** What is on screen. */
  visual: string;
  /** What is said over it. May be empty for a pure-visual beat. */
  narration: string;
  chapterIndex: number;
  /** The Continuity Agent's first guess, refined per shot later. */
  kind: ShotKind;
  /** Planned visual progression. Optional only on plans saved before this contract existed. */
  cameraDistance?: CameraDistance;
  cameraMovement?: CameraMovement;
  visualConnection?: string;
}

/** The Ad engine's running state, maintained across the whole ad. */
export interface AdStates {
  problem: string;
  solution: string;
  /** The UI state id the ad shows at its product beat, when it has one. */
  uiState: string;
  visualStyle: string;
  currentCta: string;
}

// ---------------------------------------------------------------------------
// Continuity + routing, per shot
// ---------------------------------------------------------------------------
/** The Continuity Agent's answer: what must persist INTO this shot. */
export interface ContinuityNeed {
  kind: ShotKind;
  /** True when the same person has to be recognisable in this shot. */
  needsCharacter: boolean;
  /** True when someone speaks a scripted line to camera. */
  needsDialogue: boolean;
  /** True when real product UI is on screen. */
  needsUI: boolean;
  /** True when the shot's whole point is believable motion or physics. */
  needsPhysics: boolean;
  /** True when this is the first shot of a NEW place. */
  newScene: boolean;
  /**
   * A DELIBERATE break: problem→solution in an ad, where a hard cut IS the
   * transformation. Action and framing may break; the visual bible may not.
   */
  deliberateBreak: boolean;
  /** Short human sentences: what has to carry over. */
  mustPersist: string[];
  transitionIn: TransitionKind;
}

/**
 * THE GENERATION DECISION — the auditable record of how one shot is made.
 * Persisted verbatim, so a regeneration replays the same intent and a support
 * question about "why does shot 7 look like that?" has an actual answer.
 */
export interface GenerationDecision {
  generation_strategy: GenerationStrategy;
  engine: ShotEngine;
  character_reference: string | null;
  environment_reference: string | null;
  previous_best_frame: string | null;
  story_state: string;
  camera_continuity: boolean;
  /** UI shots only. */
  from_ui_state?: string;
  to_ui_state?: string;
  camera_motion?: MotionSpec['camera'];
  /** Uploaded visual references selected for this shot, most relevant first. */
  reference_images?: string[];
  /** Faceless shots only — the Visual Metaphor Agent's verdict. */
  visual_strategy?: VisualStrategy;
  /** Why the router chose this engine, in one line. */
  reason: string;
}

// ---------------------------------------------------------------------------
// Shots
// ---------------------------------------------------------------------------
export type ShotStatus =
  | 'pending'
  | 'deciding'
  | 'submitting'
  | 'rendering'
  | 'analyzing'
  | 'regenerating'
  | 'done'
  | 'failed'
  | 'skipped';

export interface ShotState {
  index: number;
  label: string;
  /** Director beat type; optional only for productions saved before this field existed. */
  kind?: ShotKind;
  /** The visual description this shot renders from. */
  prompt: string;
  dialogue: string;
  /** Copied verbatim from the Director's shot plan and persisted with the shot. */
  cameraDistance?: CameraDistance;
  cameraMovement?: CameraMovement;
  visualConnection?: string;
  chapterIndex: number;
  seconds: number;
  status: ShotStatus;
  continuity: ContinuityNeed | null;
  decision: GenerationDecision | null;
  engine: ShotEngine | null;
  jobId?: string;
  /** Remotion / HeyGen operation ids, which are not generate-video job ids. */
  operationId?: string;
  clipUrl?: string;
  /** The Frame Analyzer's pick — NOT necessarily the last frame. */
  bestFrameUrl?: string;
  lastFrameUrl?: string;
  continuityVerdict?: ContinuityVerdict;
  /** Actual rendered appearance, produced by the vision continuity pass for the next shot. */
  visualDescription?: string;
  /** Context from both neighbours when the final sequence check asks for a targeted repair. */
  finalContinuityContext?: string;
  /** Separate bounded budget for sequence-level repairs after all shots exist. */
  finalRegenCount?: number;
  /** Bounded: MAX_SHOT_REGENERATIONS. */
  regenCount: number;
  /** Live line from the poller, e.g. "Rendering…". */
  message?: string;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
}

export interface ContinuityVerdict {
  passed: boolean;
  /** 0–1. Below CONTINUITY_PASS_SCORE is a fail. */
  score: number;
  reason: string;
  /** Which dimensions were compared, for the shot card's detail row. */
  dimensions?: Record<string, number>;
  /** A concise factual description of the rendered frame, used by the next shot. */
  visualDescription?: string;
}

// ---------------------------------------------------------------------------
// Persistent production memory
// ---------------------------------------------------------------------------
/**
 * EVERYTHING WORTH KEEPING, in one object. A five-minute series is fifty
 * renders and hours of wall clock; losing this is losing the production. It is
 * written to WorkspaceDB after every shot and mirrored to localStorage, so a
 * reload, an app switch or a closed tab all resume rather than restart.
 */
export interface ProductionMemory {
  /** Established at planning time and immutable for the production. */
  visualBible: VisualBible | null;
  characterMasters: CharacterMaster[];
  environments: EnvironmentMaster[];
  objects: ObjectMaster[];
  productMaster: ProductMaster | null;
  anchors: VisualAnchors;
  uiStates: UIState[];
  /** shot index → the Frame Analyzer's best frame for it. */
  bestFrames: Record<number, string>;
  /** shot index → that clip's true final frame. */
  lastFrames: Record<number, string>;
  /** Per-shot visual memory rows, in shot order. */
  visualMemory: VisualMemoryEntry[];
  characterState: string;
  objectState: string;
  cameraState: string;
  narrativeState: string;
  /** Set once a HeyGen probe has answered, so nothing re-probes per shot. */
  heygenAvailable: boolean | null;
  /** True only when the visitor explicitly asked for an avatar, presenter, spokesperson, or talking head. */
  presenterRequested: boolean;
  /** Uploaded product, UI, brand, and inspiration references, capped at ten. */
  referenceImages?: string[];
  /** Vision summaries in the same order, supplied to the director. */
  referenceDescriptions?: string[];
  /**
   * The exact browser-resolved render settings the background orchestrator
   * needs after the tab is gone. Additive so older saved rows still load.
   */
  serverRuntime?: {
    tonePrompt: string;
    provider: string;
    model: string;
  };
}

/** The Faceless engine's per-shot visual memory row. */
export interface VisualMemoryEntry {
  shot: number;
  visualWorld: string;
  objects: string[];
  lighting: string;
  camera: string;
  motion: string;
  visualMotif: string;
  lastFrame: string;
  bestReference: string;
}

export const EMPTY_MEMORY: ProductionMemory = {
  visualBible: null,
  characterMasters: [],
  environments: [],
  objects: [],
  productMaster: null,
  anchors: { style: '', environments: [], objects: [], motifs: [] },
  uiStates: [],
  bestFrames: {},
  lastFrames: {},
  visualMemory: [],
  characterState: '',
  objectState: '',
  cameraState: '',
  narrativeState: '',
  heygenAvailable: null,
  presenterRequested: false,
  referenceImages: [],
  referenceDescriptions: [],
};

// ---------------------------------------------------------------------------
// The production
// ---------------------------------------------------------------------------
export type ProductionPhase =
  | 'setup'
  | 'routing'
  | 'planning'
  | 'plan'
  | 'running'
  | 'paused'
  | 'assembling'
  | 'done';

/** How the visitor started this production — see agenticInput.ts. */
export type ProductionSource = 'url' | 'idea' | 'screenshot' | 'character_photo' | 'product_image';

export interface ProductionInputs {
  source: ProductionSource;
  url: string;
  brief: string;
  /** An uploaded product screenshot → routes to UI Motion. */
  screenshotUrl: string;
  /** An uploaded character photo → becomes the CHARACTER_MASTER. */
  characterPhotoUrl: string;
  productImageUrls: string[];
  character: CharacterRef | null;
}

export const EMPTY_INPUTS: ProductionInputs = {
  source: 'idea',
  url: '',
  brief: '',
  screenshotUrl: '',
  characterPhotoUrl: '',
  productImageUrls: [],
  character: null,
};

// ---------------------------------------------------------------------------
// Ceilings. NOTHING in this system runs forever.
// ---------------------------------------------------------------------------
/** Veo caps a clip at ~8s, so runtime is shot count × this. */
export const SHOT_SECONDS = 8;
/** Five minutes at 8s a shot. The Long Series ceiling, and the system's. */
export const MAX_SHOTS = 38;
export const MIN_SHOTS = 2;
/**
 * Per-shot automatic regenerations. Two, because a continuity fail is usually
 * fixed by re-seeding from a bridge frame on the first retry — and a third
 * identical attempt has never once produced a different answer.
 */
export const MAX_SHOT_REGENERATIONS = 2;
/** Below this the Continuity Check fails the shot and asks for a bridge. */
export const CONTINUITY_PASS_SCORE = 0.72;
/**
 * THE VEO PROMPT WINDOW, enforced not assumed: /api/veo/generate/video rejects
 * a prompt outside 10–1000 characters, and the generate-video hook slices at
 * the same ceiling. Every prompt this system builds is clamped to fit.
 */
export const VEO_PROMPT_MIN = 10;
export const VEO_PROMPT_MAX = 1000;
/** Room for one shot's own description inside the assembled prompt. */
export const SHOT_PROMPT_MAX = 420;
export const SHOT_DIALOGUE_MAX = 120;

export interface ProductionState {
  phase: ProductionPhase;
  requestedMode: VideoMode;
  mode: ResolvedMode;
  modeReason: string;
  title: string;
  inputs: ProductionInputs;
  aspect: AspectRatio;
  model: string;
  toneId: string;
  targetSeconds: number;
  plan: StoryPlan | null;
  shots: ShotState[];
  memory: ProductionMemory;
  /** 1-based shot in flight, 0 when nothing is rendering. */
  cursor: number;
  /** A polite pause: the shot in flight finishes first. */
  pauseRequested: boolean;
  finalVideoUrl: string;
  /** How the final cut was assembled, for the honest delivery line. */
  assembly: string;
  notice: string | null;
  error: string | null;
  rowId: number | null;
  saveNotice: string | null;
  startedAt: number;
  /** Set when a reload found a run mid-flight, so Continue is offered. */
  resumable: boolean;
}
