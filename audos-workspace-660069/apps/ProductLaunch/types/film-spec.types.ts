// FilmSpec — the creative truth of a run.
//
// Opus authors this and nothing downstream is allowed to contradict it: the
// component plan translates it, the code step renders that translation, and
// the critic judges the render against THIS document rather than against
// taste. Everything in here is a creative decision; nothing in here is a
// render setting (those live in sdk/component-sdk.types.ts RENDER_CONSTRAINTS,
// which Opus never chooses).

export type NarrativeArc = string;

/**
 * The canonical roles, left open on purpose. A concept that needs a beat the
 * six names do not cover may invent one, and the critic reads the FilmSpec's
 * own notes rather than a fixed rubric.
 */
export type SceneRole = 'hook' | 'problem' | 'product' | 'proof' | 'outcome' | 'cta' | string;

export type MotionIntensity = 'static' | 'subtle' | 'dynamic' | 'kinetic';

export type TransitionType = 'cut' | 'dissolve' | 'wipe' | 'push' | 'scale-out' | 'blur-through';

export interface SceneSpec {
  id: string;
  role: SceneRole;
  duration_frames: number;          // at 30fps
  visual_treatment: string;         // plain language description of the visual approach
  components: string[];             // must be valid SDK component names
  narration_beat: string;           // what is communicated: 'the cost of inconsistency lands'
  narration_text?: string;          // exact voiceover line if present
  assets_needed: string[];          // asset handles from ProductContext
  motion_intensity: MotionIntensity;
  transition_out?: TransitionType;
  notes?: string;                   // director's intention — used by critic
}

export interface FilmSpec {
  version: '1.0';
  generated_at: string;

  // From ProductContext
  product_name: string;
  product_url: string;
  target_audience: string;
  core_value_prop: string;
  key_features: string[];
  brand_colors: string[];

  // Creative decisions — Opus-authored
  narrative_arc: NarrativeArc;      // e.g. 'credits burned -> drift exposed -> consistency locked -> ship it'
  total_duration_frames: number;    // 450=15s, 750=25s, 900=30s
  typography_system: {
    scale: 'editorial' | 'product' | 'minimal' | 'bold';
    weight: 'light' | 'regular' | 'heavy';
    primary_typeface?: string;
  };
  color_story: string;
  visual_language: string;

  scenes: SceneSpec[];

  narration_enabled: boolean;
  narration_voice?: string;
  music_style?: 'tension' | 'momentum' | 'minimal' | 'cinematic' | 'none';

  // Multi-concept selection fields
  concept_score: number;            // 0–1
  concept_rationale: string;
  risks: string[];
}

export const MOTION_INTENSITIES: MotionIntensity[] = ['static', 'subtle', 'dynamic', 'kinetic'];

export const TRANSITION_TYPES: TransitionType[] = [
  'cut', 'dissolve', 'wipe', 'push', 'scale-out', 'blur-through',
];

export const TYPOGRAPHY_SCALES = ['editorial', 'product', 'minimal', 'bold'] as const;

export const TYPOGRAPHY_WEIGHTS = ['light', 'regular', 'heavy'] as const;

/** Total runtime of a spec in seconds, at the pinned 30fps render rate. */
export function filmSeconds(spec: FilmSpec, fps = 30): number {
  return Math.round((spec.total_duration_frames / fps) * 10) / 10;
}

/** The frames the scene list actually accounts for, which may drift from the stated total. */
export function scenesFrameTotal(spec: FilmSpec): number {
  return spec.scenes.reduce((sum, scene) => sum + (Number(scene.duration_frames) || 0), 0);
}
