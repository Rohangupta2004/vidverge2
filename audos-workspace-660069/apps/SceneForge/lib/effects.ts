// Preset effect system for supporting scenes. A preset replaces the old
// "write a bespoke Remotion composition per scene" step: the customer picks a
// named motion (with intensity, direction and easing) and the ONE final
// assembly composition interprets it deterministically. Nothing here renders
// on its own — these are metadata the Scene editor UI and the assembly
// timeline share.

export type EffectDirection = 'left' | 'right' | 'up' | 'down';
export type EffectEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';

export interface EffectSetting {
  preset: string;
  /** 0.25 (subtle) … 2 (strong). 1 is the designed default. */
  intensity: number;
  direction?: EffectDirection;
  easing?: EffectEasing;
}

export type OverlayPosition = 'top' | 'center' | 'bottom' | 'lower_third' | 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right';
export type OverlaySize = 'sm' | 'md' | 'lg';
export type TextAnimation = 'text_reveal' | 'text_pop' | 'fade' | 'none';

/**
 * How a scene's visual (AI clip or still) sits inside the frame at assembly:
 *  - 'full'        — full-bleed takeover (the classic behavior)
 *  - 'inset_left'  — cropped into a rounded card on the left, caption beside it
 *  - 'inset_right' — the same card on the right, caption on the left
 *  - 'circle'      — masked into a circle, caption beside it
 *  - 'card'        — centered rounded card over the motion backdrop
 * Anything but 'full' composites the clip as an ELEMENT inside the scene
 * (backdrop behind it, text beside it) instead of a full-screen takeover.
 */
export type MediaLayout = 'full' | 'inset_left' | 'inset_right' | 'circle' | 'card';

export const MEDIA_LAYOUTS: { id: MediaLayout; label: string; detail: string }[] = [
  { id: 'full', label: 'Full-bleed', detail: 'The clip fills the whole frame' },
  { id: 'inset_left', label: 'Inset left', detail: 'Clip in a card on the left, caption on the right' },
  { id: 'inset_right', label: 'Inset right', detail: 'Clip in a card on the right, caption on the left' },
  { id: 'circle', label: 'Circle', detail: 'Clip masked into a circle, caption beside it' },
  { id: 'card', label: 'Card', detail: 'Centered rounded card over the backdrop' },
];

// ---------------------------------------------------------------------------
// COMPOSITION — how a middle visual sits AGAINST the presenter. The avatar
// master is the base layer of the whole film; every supporting visual is
// composited around it. The orchestrator LLM decides the mode per beat
// (visual hierarchy, not one hardcoded treatment):
//   * 'overlay'    — the presenter stays fully visible; the visual rides a
//                    face-safe zone with a transparent background.
//   * 'central'    — the visual dominates the frame while the presenter
//                    remains partially visible behind/around it.
//   * 'fullscreen' — a temporary cutaway: the visual replaces the picture
//                    for its window (avatar → visual → avatar).
// ---------------------------------------------------------------------------

export type CompositionMode = 'overlay' | 'central' | 'fullscreen';
export type CompositionPosition = 'lower_third' | 'left' | 'right' | 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right' | 'bottom' | 'center';

export interface CompositionSpec {
  mode: CompositionMode;
  /** Face-safe anchor for overlay mode; central mode ignores it (always centered below the face band). */
  position?: CompositionPosition;
  /** Fraction of the frame width the visual occupies (0.2–0.95). */
  scale?: number;
  keepAvatarVisible?: boolean;
  /** Why this visual is on screen — written by the orchestrator, shown in the editor. */
  purpose?: string;
}

export const COMPOSITION_MODES: { id: CompositionMode; label: string; detail: string }[] = [
  { id: 'overlay', label: 'Overlay', detail: 'Presenter stays on screen — the graphic rides a face-safe zone' },
  { id: 'central', label: 'Central', detail: 'The visual dominates; the presenter stays partially visible' },
  { id: 'fullscreen', label: 'Full-screen', detail: 'Cutaway — the visual temporarily replaces the presenter' },
];

const COMPOSITION_POSITIONS: CompositionPosition[] = ['lower_third', 'left', 'right', 'top_left', 'top_right', 'bottom_left', 'bottom_right', 'bottom', 'center'];

/** Coerce whatever composition object the LLM (or a stored scene) carries into a usable spec; null when there is none. */
export function normalizeComposition(raw: unknown): CompositionSpec | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const mode = String(source.mode ?? source.compositionMode ?? source.composition_mode ?? '').toLowerCase().trim();
  if (mode !== 'overlay' && mode !== 'central' && mode !== 'fullscreen') return null;
  const spec: CompositionSpec = { mode, keepAvatarVisible: source.keepAvatarVisible === undefined ? mode !== 'fullscreen' : source.keepAvatarVisible === true };
  const position = String(source.position || '').toLowerCase().trim() as CompositionPosition;
  if (COMPOSITION_POSITIONS.includes(position)) spec.position = position;
  const scale = Number(source.scale);
  if (Number.isFinite(scale) && scale > 0) spec.scale = Math.min(0.95, Math.max(0.2, scale));
  const purpose = String(source.purpose || '').trim();
  if (purpose) spec.purpose = purpose.slice(0, 300);
  return spec;
}

/**
 * Kind-aware default when a scene carries no explicit composition. Motion
 * graphics stop being isolated full-frame cards: compact kinds ride the
 * presenter as overlays, structural kinds become central diagrams with the
 * presenter still visible, and only annotated_image keeps the full frame.
 * Other kinds return null — their existing treatment (full-bleed takeover or
 * mediaLayout framing) stays authoritative unless the plan says otherwise.
 */
export function defaultComposition(kind: VisualKind, motionKind?: string | null): CompositionSpec | null {
  if (kind !== 'motion_graphic') return null;
  const mk = String(motionKind || '');
  if (mk === 'big_stat') return { mode: 'overlay', position: 'lower_third', scale: 0.62, keepAvatarVisible: true };
  if (mk === 'text_reveal') return { mode: 'overlay', position: 'lower_third', scale: 0.78, keepAvatarVisible: true };
  if (mk === 'annotated_image') return { mode: 'fullscreen', keepAvatarVisible: false };
  return { mode: 'central', position: 'center', scale: 0.88, keepAvatarVisible: true };
}

/** The composition a scene actually renders with: explicit spec > kind default > null (legacy treatment). */
export function effectiveComposition(kind: VisualKind, overlay?: { composition?: unknown } | null, motionKind?: string | null): CompositionSpec | null {
  const explicit = normalizeComposition(overlay?.composition);
  if (explicit) return explicit;
  return defaultComposition(kind, motionKind);
}

/**
 * The full overlay definition a scene carries on the timeline. Text scenes
 * are DEFINED by this object; AI-video scenes may additionally carry one so a
 * caption/title can sit on top of the generated clip.
 */
export interface OverlayConfig {
  text?: string;
  subtext?: string;
  font?: string;
  size?: OverlaySize;
  position?: OverlayPosition;
  scale?: number;
  opacity?: number;
  animation?: TextAnimation;
  /** A picked/generated Asset Studio image shown as the scene visual. */
  assetUrl?: string;
  /** false hides the scene's asset/still entirely (pure text card). */
  showAsset?: boolean;
  /** How the scene's clip/still is framed at assembly (default 'full'). */
  mediaLayout?: MediaLayout;
  /**
   * true = this overlay renders ON TOP of the HeyGen presenter instead of
   * replacing the picture: the background stays transparent, the label is
   * clamped to a safe zone (lower third / corners — never over the face),
   * and no clip capture is needed — assembly composes it directly.
   */
  overAvatar?: boolean;
  /** How this scene's visual sits against the presenter (overlay / central / fullscreen) — decided by the orchestrator, editable per scene. */
  composition?: CompositionSpec;
  effect?: EffectSetting;
}

/**
 * How a middle (supporting) scene is produced:
 *  - 'ai_video'       — a generated motion clip (Omni Flash), placed directly on the timeline
 *  - 'image'          — a generated/stock/uploaded still shown for the window
 *  - 'motion_graphic' — GSAP + SVG animation (diagrams, flowcharts, timelines…) captured to a clip
 *  - 'text_overlay'   — deterministic animated text, captured to a clip by the same engine
 *  - 'text_graphics'  — LEGACY combined text+asset overlay composed at final assembly (pre-v4 scenes)
 */
export type VisualKind = 'ai_video' | 'image' | 'motion_graphic' | 'text_overlay' | 'text_graphics';

export interface EffectPresetMeta {
  id: string;
  label: string;
  detail: string;
  directional?: boolean;
  defaultDirection?: EffectDirection;
  defaultEasing: EffectEasing;
}

// Applied to the scene's visual (asset image, still, or AI clip).
export const EFFECT_PRESETS: EffectPresetMeta[] = [
  { id: 'none', label: 'None', detail: 'Hold the visual steady', defaultEasing: 'linear' },
  { id: 'zoom_in', label: 'Zoom In', detail: 'Slow push toward the subject', defaultEasing: 'ease-in-out' },
  { id: 'zoom_out', label: 'Zoom Out', detail: 'Start close, settle wide', defaultEasing: 'ease-in-out' },
  { id: 'pan_left', label: 'Pan Left', detail: 'Steady lateral drift left', directional: true, defaultDirection: 'left', defaultEasing: 'linear' },
  { id: 'pan_right', label: 'Pan Right', detail: 'Steady lateral drift right', directional: true, defaultDirection: 'right', defaultEasing: 'linear' },
  { id: 'parallax', label: 'Parallax', detail: 'Subject and backdrop drift at different speeds', directional: true, defaultDirection: 'left', defaultEasing: 'ease-in-out' },
  { id: 'ken_burns', label: 'Ken Burns', detail: 'Classic documentary zoom-and-drift', directional: true, defaultDirection: 'right', defaultEasing: 'ease-in-out' },
  { id: 'fade', label: 'Fade', detail: 'Soft fade up and out', defaultEasing: 'ease-in-out' },
  { id: 'blur_reveal', label: 'Blur Reveal', detail: 'Sharpens from a soft blur', defaultEasing: 'ease-out' },
  { id: 'light_sweep', label: 'Light Sweep', detail: 'A highlight band sweeps across', directional: true, defaultDirection: 'right', defaultEasing: 'ease-in-out' },
  { id: 'scale_up', label: 'Scale Up', detail: 'Grows into place with a spring', defaultEasing: 'ease-out' },
  { id: 'scale_down', label: 'Scale Down', detail: 'Settles down into place', defaultEasing: 'ease-out' },
  { id: 'float', label: 'Float', detail: 'Gentle continuous bobbing drift', defaultEasing: 'ease-in-out' },
  { id: 'push_in', label: 'Push In', detail: 'Slides in from the chosen edge', directional: true, defaultDirection: 'left', defaultEasing: 'ease-out' },
  { id: 'push_out', label: 'Push Out', detail: 'Slides out toward the chosen edge at the end', directional: true, defaultDirection: 'right', defaultEasing: 'ease-in' },
];

export const TEXT_ANIMATIONS: { id: TextAnimation; label: string; detail: string }[] = [
  { id: 'text_reveal', label: 'Text Reveal', detail: 'Lines slide up and fade in one after another' },
  { id: 'text_pop', label: 'Text Pop', detail: 'Headline pops in with a spring' },
  { id: 'fade', label: 'Fade', detail: 'Simple fade in and out' },
  { id: 'none', label: 'None', detail: 'Text is simply present' },
];

export const OVERLAY_POSITIONS: { id: OverlayPosition; label: string }[] = [
  { id: 'center', label: 'Center' },
  { id: 'lower_third', label: 'Lower third' },
  { id: 'top', label: 'Top' },
  { id: 'bottom', label: 'Bottom' },
  { id: 'top_left', label: 'Top left' },
  { id: 'top_right', label: 'Top right' },
  { id: 'bottom_left', label: 'Bottom left' },
  { id: 'bottom_right', label: 'Bottom right' },
];

/**
 * Positions that never cover a centered presenter's face — the safe zones an
 * over-avatar label may occupy (assembly clamps center/top to lower_third).
 */
export const AVATAR_SAFE_POSITIONS: OverlayPosition[] = ['lower_third', 'bottom', 'bottom_left', 'bottom_right', 'top_left', 'top_right'];

export const OVERLAY_SIZES: { id: OverlaySize; label: string }[] = [
  { id: 'sm', label: 'Small' },
  { id: 'md', label: 'Medium' },
  { id: 'lg', label: 'Large' },
];

export function effectPresetMeta(id?: string): EffectPresetMeta {
  return EFFECT_PRESETS.find((preset) => preset.id === id) || EFFECT_PRESETS[0];
}

/** Fill in the preset's own defaults for anything the setting leaves out. */
export function normalizeEffect(effect?: EffectSetting | null): EffectSetting {
  const meta = effectPresetMeta(effect?.preset);
  const intensity = Number(effect?.intensity);
  return {
    preset: meta.id,
    intensity: Number.isFinite(intensity) && intensity > 0 ? Math.min(2, Math.max(0.25, intensity)) : 1,
    direction: effect?.direction || meta.defaultDirection,
    easing: effect?.easing || meta.defaultEasing,
  };
}

const VISUAL_KIND_IDS: VisualKind[] = ['ai_video', 'image', 'motion_graphic', 'text_overlay', 'text_graphics'];

/** Legacy scenes (null visual_kind) behave as text/graphics overlays. */
export function visualKindOf(value?: string | null): VisualKind {
  return VISUAL_KIND_IDS.includes(value as VisualKind) ? (value as VisualKind) : 'text_graphics';
}

/**
 * Timeline color language, shared by the blueprint strip and the scene cards:
 * HeyGen = blue, motion graphic = green, AI video = purple, image = orange,
 * text = teal. Concrete hexes on purpose — these also appear inside captured
 * clips where CSS variables do not exist.
 */
export const KIND_COLORS: Record<'heygen' | VisualKind, string> = {
  heygen: '#3B82F6',
  ai_video: '#a855f7',
  image: '#f59e0b',
  motion_graphic: '#22c55e',
  text_overlay: '#2dd4bf',
  text_graphics: '#2dd4bf',
};

export const KIND_LABELS: Record<'heygen' | VisualKind, string> = {
  heygen: 'HeyGen',
  ai_video: 'AI Video',
  image: 'Image',
  motion_graphic: 'Motion Graphic',
  text_overlay: 'Text Overlay',
  text_graphics: 'Text / Graphics',
};

/** A usable overlay for a scene that never carried one: its description as a headline. */
export function defaultOverlay(description?: string): OverlayConfig {
  const headline = String(description || '').split(/[.!?]/)[0]?.trim().slice(0, 90) || '';
  return { text: headline, position: 'lower_third', size: 'md', animation: 'text_reveal', effect: { preset: 'ken_burns', intensity: 1, direction: 'right', easing: 'ease-in-out' } };
}
