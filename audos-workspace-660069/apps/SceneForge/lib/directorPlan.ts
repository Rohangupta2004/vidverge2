// DIRECTOR PLAN — the AI Editorial Director's structured decisions for one
// generation of the film. The single orchestrator LLM (agents/orchestrator)
// already writes the scene manifest; this module gives that manifest an
// EXPLICIT editorial vocabulary and a single authoritative record:
//
//   * VISUAL TREATMENTS — the ten documentary treatments the Director can
//     assign per scene. Each treatment maps onto the EXISTING visual_kind /
//     composition / spec schema (nothing here replaces the generation
//     pipeline; a treatment is a director-level view over it).
//   * PRESENTER STATE — every scene declares what the HeyGen presenter does
//     during its window (full / hidden / picture-in-picture) and what its
//     audio does. No scene ever relies on accidental stacking.
//   * EDITABLE OVERLAYS — first-class timeline elements (text, arrows,
//     circles, highlights, labels, stats, citations, lower thirds) that are
//     composed ABOVE the scene visual at assembly and stay editable after
//     generation. An overlay-only edit re-renders the composition without
//     regenerating any AI/HeyGen asset.
//   * MOTION TREATMENT — deterministic Ken Burns parameters for still
//     scenes, rendered inside the ONE Remotion assembly composition.
//   * MUSIC TREATMENT — whether the film needs music, its mood/intensity and
//     the generation prompt. Executed by the EXISTING ElevenLabs music +
//     Remotion ducking mix pipeline (sceneforge-v2 ops music / mix_music).
//   * GENERATION IDS — every plan generation gets one id; scenes and their
//     assets are stamped with it so timeline validation can prove that no
//     stale asset leaks into a new generation's render.

import type { Project, Scene } from './supabase';
import type { CompositionSpec } from './effects';
import { visualKindOf } from './effects';

// ---------------------------------------------------------------------------
// Visual treatments
// ---------------------------------------------------------------------------

export type VisualTreatment =
  | 'PRESENTER'            // talking head only — no middle visual (a gap in the scene list)
  | 'FULLSCREEN_BROLL'     // ai_video cutaway, full frame
  | 'FULLSCREEN_IMAGE'     // generated still, full frame, Ken Burns motion
  | 'FULLSCREEN_ARCHIVAL'  // archival-style still (image kind, archival prompt language), Ken Burns
  | 'FULLSCREEN_MAP'       // motion_graphic node_graph map, full frame
  | 'FULLSCREEN_DOCUMENT'  // motion_graphic annotated_image (document/source visual) with callout overlays
  | 'FULLSCREEN_CHART'     // motion_graphic bar_chart / timeline / comparison / big_stat
  | 'FULLSCREEN_GRAPHIC'   // motion_graphic diagram / flowchart / list_reveal / infographic
  | 'KINETIC_TYPOGRAPHY'   // motion_graphic text_reveal — large animated typography
  | 'PIP_BROLL';           // ai_video full frame with the presenter in a picture-in-picture card

export const VISUAL_TREATMENTS: VisualTreatment[] = ['PRESENTER', 'FULLSCREEN_BROLL', 'FULLSCREEN_IMAGE', 'FULLSCREEN_ARCHIVAL', 'FULLSCREEN_MAP', 'FULLSCREEN_DOCUMENT', 'FULLSCREEN_CHART', 'FULLSCREEN_GRAPHIC', 'KINETIC_TYPOGRAPHY', 'PIP_BROLL'];

/** How each treatment maps onto the existing production schema. */
export function treatmentDefaults(treatment: VisualTreatment): { visual_kind: string; compositionMode: CompositionSpec['mode']; presenter: PresenterState } {
  switch (treatment) {
    case 'FULLSCREEN_BROLL': return { visual_kind: 'ai_video', compositionMode: 'fullscreen', presenter: { video: 'hidden', audio: 'continue' } };
    case 'PIP_BROLL': return { visual_kind: 'ai_video', compositionMode: 'fullscreen', presenter: { video: 'pip', audio: 'continue', pip: { position: 'bottom_right', scale: 0.24 } } };
    case 'FULLSCREEN_IMAGE':
    case 'FULLSCREEN_ARCHIVAL': return { visual_kind: 'image', compositionMode: 'fullscreen', presenter: { video: 'hidden', audio: 'continue' } };
    case 'FULLSCREEN_MAP':
    case 'FULLSCREEN_DOCUMENT':
    case 'FULLSCREEN_CHART':
    case 'FULLSCREEN_GRAPHIC': return { visual_kind: 'motion_graphic', compositionMode: 'fullscreen', presenter: { video: 'hidden', audio: 'continue' } };
    case 'KINETIC_TYPOGRAPHY': return { visual_kind: 'motion_graphic', compositionMode: 'fullscreen', presenter: { video: 'hidden', audio: 'continue' } };
    default: return { visual_kind: 'text_overlay', compositionMode: 'overlay', presenter: { video: 'full', audio: 'continue' } };
  }
}

/** The spec kinds the Director may pick per treatment (validation aid). */
export const TREATMENT_SPEC_KINDS: Partial<Record<VisualTreatment, string[]>> = {
  FULLSCREEN_MAP: ['node_graph'],
  FULLSCREEN_DOCUMENT: ['annotated_image'],
  FULLSCREEN_CHART: ['bar_chart', 'timeline', 'comparison', 'big_stat'],
  FULLSCREEN_GRAPHIC: ['branching_diagram', 'flowchart', 'list_reveal', 'node_graph'],
  KINETIC_TYPOGRAPHY: ['text_reveal'],
};

export function normalizeTreatment(raw: unknown): VisualTreatment | null {
  const value = String(raw || '').toUpperCase().trim() as VisualTreatment;
  return VISUAL_TREATMENTS.includes(value) ? value : null;
}

/** Derive the treatment label a stored scene effectively renders with. */
export function treatmentOfScene(scene: Scene): VisualTreatment {
  const kind = visualKindOf(scene.visual_kind);
  const presenter = normalizePresenterState(scene.presenter_state, null);
  if (kind === 'ai_video') return presenter?.video === 'pip' ? 'PIP_BROLL' : 'FULLSCREEN_BROLL';
  if (kind === 'image') return 'FULLSCREEN_IMAGE';
  const specKind = String((scene.spec as any)?.kind || '');
  if (specKind === 'node_graph') return 'FULLSCREEN_MAP';
  if (specKind === 'annotated_image') return 'FULLSCREEN_DOCUMENT';
  if (specKind === 'bar_chart' || specKind === 'timeline' || specKind === 'comparison' || specKind === 'big_stat') return 'FULLSCREEN_CHART';
  if (specKind === 'text_reveal' || kind === 'text_overlay' || kind === 'text_graphics') return 'KINETIC_TYPOGRAPHY';
  return 'FULLSCREEN_GRAPHIC';
}

// ---------------------------------------------------------------------------
// Presenter state
// ---------------------------------------------------------------------------

export type PipPosition = 'bottom_left' | 'bottom_right' | 'top_left' | 'top_right';
export interface PresenterState {
  /** 'full' — presenter is the visible base under an overlay/central visual;
   * 'hidden' — fullscreen cutaway (narration continues underneath);
   * 'pip' — presenter rides a small positioned card over the fullscreen visual. */
  video: 'full' | 'hidden' | 'pip';
  /** The HeyGen master is the continuous audio spine — 'continue' is the norm.
   * 'mute' silences the narration for this window (rare, deliberate only). */
  audio: 'continue' | 'mute';
  pip?: { position: PipPosition; scale: number };
}

const PIP_POSITIONS: PipPosition[] = ['bottom_left', 'bottom_right', 'top_left', 'top_right'];

export function normalizePresenterState(raw: unknown, fallback: PresenterState | null): PresenterState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback;
  const source = raw as Record<string, unknown>;
  const video = String(source.video || '').toLowerCase();
  if (video !== 'full' && video !== 'hidden' && video !== 'pip') return fallback;
  const state: PresenterState = { video, audio: String(source.audio || '').toLowerCase() === 'mute' ? 'mute' : 'continue' };
  if (video === 'pip') {
    const rawPip = (source.pip && typeof source.pip === 'object' ? source.pip : {}) as Record<string, unknown>;
    const position = String(rawPip.position || 'bottom_right').toLowerCase() as PipPosition;
    const scale = Number(rawPip.scale);
    state.pip = {
      position: PIP_POSITIONS.includes(position) ? position : 'bottom_right',
      scale: Number.isFinite(scale) && scale > 0 ? Math.min(0.34, Math.max(0.16, scale)) : 0.24,
    };
  }
  return state;
}

/**
 * The presenter state a scene actually renders with. Explicit state first;
 * otherwise derived from the scene's composition, so EVERY scene has an
 * explicit answer at assembly (never accidental stacking):
 *  - overlay/central composition or an over-avatar callout → presenter 'full'
 *  - fullscreen (or legacy full-bleed) → presenter 'hidden'
 */
export function effectivePresenterState(scene: Scene): PresenterState {
  const explicit = normalizePresenterState(scene.presenter_state, null);
  if (explicit) return explicit;
  const overlay = scene.overlay_config as Record<string, any> | null | undefined;
  if (overlay?.overAvatar === true) return { video: 'full', audio: 'continue' };
  const mode = String(overlay?.composition?.mode || '');
  if (mode === 'overlay' || mode === 'central') return { video: 'full', audio: 'continue' };
  return { video: 'hidden', audio: 'continue' };
}

// ---------------------------------------------------------------------------
// Editable overlay elements (first-class timeline elements)
// ---------------------------------------------------------------------------

export type OverlayElementType = 'text' | 'label' | 'lower_third' | 'stat' | 'citation' | 'arrow' | 'circle' | 'highlight';
export const OVERLAY_ELEMENT_TYPES: { id: OverlayElementType; label: string }[] = [
  { id: 'text', label: 'Text' },
  { id: 'label', label: 'Label' },
  { id: 'lower_third', label: 'Lower third' },
  { id: 'stat', label: 'Statistic' },
  { id: 'citation', label: 'Citation' },
  { id: 'arrow', label: 'Arrow' },
  { id: 'circle', label: 'Circle' },
  { id: 'highlight', label: 'Highlight' },
];

export type OverlayAnim = 'fade' | 'rise' | 'pop' | 'draw' | 'none';

export interface SceneOverlayElement {
  /** Unique within the film — `${sceneId or index}-ov-${n}` by convention. */
  id: string;
  type: OverlayElementType;
  text?: string;
  subtext?: string;
  /** citation: the source being cited. */
  source?: string;
  /** Anchor position on the 16:9 frame, in percent of width/height (0–100). */
  x_pct: number;
  y_pct: number;
  /** arrow: where the head points; circle: ignored. */
  target_x_pct?: number;
  target_y_pct?: number;
  /** 0.5–2, multiplies the element's designed size. */
  scale: number;
  /** Stacking among overlays (captions always render above all overlays). */
  z_index: number;
  /** Seconds after the SCENE window opens. */
  start_offset_sec: number;
  /** Seconds visible; clamped to the scene window at build time. */
  duration_sec: number;
  anim_in: OverlayAnim;
  anim_out: OverlayAnim;
  /** Optional accent hex; falls back to the film's accent language. */
  accent?: string;
}

const OVERLAY_TYPES: OverlayElementType[] = ['text', 'label', 'lower_third', 'stat', 'citation', 'arrow', 'circle', 'highlight'];
const ANIMS: OverlayAnim[] = ['fade', 'rise', 'pop', 'draw', 'none'];
const clampNum = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** Position presets → frame percentages, shared by the Director output and the editor UI. */
export const OVERLAY_POSITION_PRESETS: Record<string, { x: number; y: number }> = {
  lower_third: { x: 50, y: 84 },
  bottom: { x: 50, y: 90 },
  center: { x: 50, y: 50 },
  top: { x: 50, y: 12 },
  top_left: { x: 18, y: 14 },
  top_right: { x: 82, y: 14 },
  bottom_left: { x: 18, y: 84 },
  bottom_right: { x: 82, y: 84 },
  left: { x: 16, y: 50 },
  right: { x: 84, y: 50 },
};

export function normalizeOverlayElement(raw: unknown, index: number, sceneKey: string): SceneOverlayElement | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const type = String(source.type || '').toLowerCase() as OverlayElementType;
  if (!OVERLAY_TYPES.includes(type)) return null;
  const preset = OVERLAY_POSITION_PRESETS[String(source.position || '').toLowerCase()] || null;
  const element: SceneOverlayElement = {
    id: String(source.id || '').trim() || `${sceneKey}-ov-${index + 1}`,
    type,
    x_pct: clampNum(source.x_pct ?? preset?.x, 0, 100, preset?.x ?? 50),
    y_pct: clampNum(source.y_pct ?? preset?.y, 0, 100, preset?.y ?? 84),
    scale: clampNum(source.scale, 0.5, 2, 1),
    z_index: Math.round(clampNum(source.z_index ?? source.zIndex, 1, 40, 10 + index)),
    start_offset_sec: clampNum(source.start_offset_sec ?? source.start, 0, 600, 0),
    duration_sec: clampNum(source.duration_sec ?? source.duration, 0.4, 600, 3),
    anim_in: ANIMS.includes(String(source.anim_in || '').toLowerCase() as OverlayAnim) ? String(source.anim_in).toLowerCase() as OverlayAnim : (type === 'arrow' || type === 'circle' ? 'draw' : 'rise'),
    anim_out: ANIMS.includes(String(source.anim_out || '').toLowerCase() as OverlayAnim) ? String(source.anim_out).toLowerCase() as OverlayAnim : 'fade',
  };
  const text = String(source.text ?? source.label ?? '').trim();
  if (text) element.text = text.slice(0, 160);
  const subtext = String(source.subtext ?? source.detail ?? '').trim();
  if (subtext) element.subtext = subtext.slice(0, 220);
  const cite = String(source.source ?? source.citation ?? '').trim();
  if (cite) element.source = cite.slice(0, 180);
  if (source.target_x_pct !== undefined || source.target_y_pct !== undefined) {
    element.target_x_pct = clampNum(source.target_x_pct, 0, 100, 50);
    element.target_y_pct = clampNum(source.target_y_pct, 0, 100, 40);
  }
  const accent = String(source.accent || '').trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(accent)) element.accent = accent;
  // Content requirement: visual markers (arrow/circle/highlight) may be
  // textless; every text-bearing type needs its text.
  if (!element.text && !element.source && type !== 'arrow' && type !== 'circle' && type !== 'highlight') return null;
  return element;
}

export function normalizeOverlays(raw: unknown, sceneKey: string): SceneOverlayElement[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry, index) => normalizeOverlayElement(entry, index, sceneKey)).filter(Boolean).slice(0, 8) as SceneOverlayElement[];
}

// ---------------------------------------------------------------------------
// Motion treatment (Ken Burns for stills)
// ---------------------------------------------------------------------------

export interface MotionTreatment {
  scale_from: number;
  scale_to: number;
  pan_x_pct: number;
  pan_y_pct: number;
  rotate_deg?: number;
  easing: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
}

export function normalizeMotionTreatment(raw: unknown): MotionTreatment | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const scaleFrom = clampNum(source.scale_from ?? source.scaleFrom ?? source.initial_scale, 1, 1.4, 1.04);
  const scaleTo = clampNum(source.scale_to ?? source.scaleTo ?? source.final_scale, 1, 1.4, 1.14);
  const easing = String(source.easing || 'ease-in-out').toLowerCase();
  const treatment: MotionTreatment = {
    scale_from: scaleFrom,
    scale_to: scaleTo,
    pan_x_pct: clampNum(source.pan_x_pct ?? source.panX ?? source.pan_x, -8, 8, 0),
    pan_y_pct: clampNum(source.pan_y_pct ?? source.panY ?? source.pan_y, -8, 8, 0),
    easing: (['linear', 'ease-in', 'ease-out', 'ease-in-out'].includes(easing) ? easing : 'ease-in-out') as MotionTreatment['easing'],
  };
  const rotate = Number(source.rotate_deg ?? source.rotate);
  if (Number.isFinite(rotate) && rotate !== 0) treatment.rotate_deg = Math.min(3, Math.max(-3, rotate));
  // A dead-still treatment is not a treatment.
  if (treatment.scale_from === treatment.scale_to && !treatment.pan_x_pct && !treatment.pan_y_pct && !treatment.rotate_deg) return null;
  return treatment;
}

/** Deterministic default when the Director gave a still scene no explicit motion — images never sit dead. */
export function defaultMotionTreatment(sceneIndex: number): MotionTreatment {
  const directions = [[3, -2], [-3, 2], [2, 3], [-2, -3]];
  const [panX, panY] = directions[Math.abs(sceneIndex) % directions.length];
  return { scale_from: 1.04, scale_to: 1.16, pan_x_pct: panX, pan_y_pct: panY, easing: 'ease-in-out' };
}

// ---------------------------------------------------------------------------
// Music treatment
// ---------------------------------------------------------------------------

export interface MusicTreatment {
  required: boolean;
  mood?: string;
  intensity?: 'low' | 'medium' | 'high';
  /** Sent to the existing ElevenLabs music op verbatim (when the user keeps it). */
  prompt?: string;
  /** Bed level in the gaps between narration (the mix still ducks under speech). */
  volume?: number;
}

export function normalizeMusicTreatment(raw: unknown): MusicTreatment {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { required: false };
  const source = raw as Record<string, unknown>;
  const treatment: MusicTreatment = { required: source.required === true };
  const mood = String(source.mood || '').trim();
  if (mood) treatment.mood = mood.slice(0, 120);
  const intensity = String(source.intensity || '').toLowerCase();
  if (intensity === 'low' || intensity === 'medium' || intensity === 'high') treatment.intensity = intensity;
  const prompt = String(source.prompt || '').trim();
  if (prompt) treatment.prompt = prompt.slice(0, 600);
  const volume = Number(source.volume);
  if (Number.isFinite(volume)) treatment.volume = Math.min(0.6, Math.max(0.08, volume));
  return treatment;
}

// ---------------------------------------------------------------------------
// The DirectorPlan record (single source of truth per generation)
// ---------------------------------------------------------------------------

export interface DirectorPlan {
  version: 1;
  generation_id: string;
  /** Bumped on every timeline-affecting edit; renders stamp the version they
   * were submitted with, so an output of an older draft is never promoted
   * over a newer edit. */
  draft_version: number;
  created_at: string;
  music: MusicTreatment;
  captions: boolean;
  treatments: { scene_index: number; treatment: VisualTreatment }[];
}

export function newGenerationId(): string {
  return `gen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeDirectorPlan(raw: unknown): DirectorPlan | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const generationId = String(source.generation_id || '').trim();
  if (!generationId) return null;
  return {
    version: 1,
    generation_id: generationId,
    draft_version: Math.max(1, Math.round(Number(source.draft_version) || 1)),
    created_at: String(source.created_at || new Date().toISOString()),
    music: normalizeMusicTreatment(source.music),
    captions: source.captions === true,
    treatments: (Array.isArray(source.treatments) ? source.treatments : [])
      .map((entry: any) => ({ scene_index: Number(entry?.scene_index) || 0, treatment: normalizeTreatment(entry?.treatment) || 'FULLSCREEN_GRAPHIC' }))
      .filter((entry) => entry.scene_index > 0)
      .slice(0, 200),
  };
}

export function planOf(project: Project | null | undefined): DirectorPlan | null {
  return normalizeDirectorPlan((project as any)?.director_plan);
}
