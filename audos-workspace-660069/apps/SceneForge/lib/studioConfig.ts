// STUDIO CONFIG — the workbench's own state, and the source of the Remotion
// POST-PROCESSING LAYER.
//
// Once every scene clip exists, the film is not shipped as raw generated
// footage: the whole timeline goes through ONE server-side Remotion render
// that draws the branded graphics on top, frame-accurately — a title card on
// the opening, a lower third per scene, fade/slide transitions between
// scenes, a closing CTA card, and any B-roll picture-in-picture. That is what
// replaces the glitchy browser-captured graphics: Remotion composites at the
// render's own frame rate, so text lands crisp and on-beat instead of being
// re-encoded from a screen recording.
//
// The settings live on the project (`studio_config`) rather than in component
// state, so the whole workbench — script draft included — survives a reload
// and the customer can come back and continue.

import type { Project, Scene } from './supabase';
import { updateProject, updateScene } from './supabase';
import { normalizeOverlays, type SceneOverlayElement } from './directorPlan';
import { sceneAccent, visionOf } from './sceneVision';
import { PRESENTER_VOICE_SETTINGS, clampSettings, type VoiceSettings } from './elevenLabs';

export type TransitionStyle = 'fade' | 'slide' | 'none';
export type SidebarTab = 'script' | 'character' | 'style' | 'audio' | 'music' | 'context' | 'broll';

/**
 * How the film is voiced.
 *   off        — the presenter master (when there is one) is the only speech.
 *   voiceover  — every scene speaks its own ElevenLabs line over its footage.
 *   lipsync    — every scene's line also drives a HeyGen avatar clip of the
 *                chosen look, rendered to the ElevenLabs audio, in place of
 *                the generated footage. A scene HeyGen cannot render falls
 *                back to voiceover on its own, recorded in `lipsync_note`.
 */
export type AudioMode = 'off' | 'voiceover' | 'lipsync';

/** One scene's spoken line and the clips made from it. */
export interface SceneAudio {
  /** Exactly the words this scene speaks; seeded from the script, editable. */
  text: string;
  /** The voice and text the clip was made with, so a change marks it stale. */
  voice_id: string;
  spoken_text: string;
  audio_url: string;
  /** Measured by the platform when the clip was made, not estimated. */
  duration_ms: number;
  lipsync_url: string;
  lipsync_video_id: string;
  /** The avatar the lip-sync clip was rendered with. */
  lipsync_avatar_id: string;
  /** Why this scene is plain voiceover although Lip-sync was asked for. */
  lipsync_note: string;
  generated_at: string;
}

export interface AudioConfig {
  mode: AudioMode;
  voice_id: string;
  voice_settings: VoiceSettings;
  /** The HeyGen look every lip-synced scene is rendered with. */
  lipsync_avatar_id: string;
  /** Keyed by scene id. */
  scenes: Record<string, SceneAudio>;
}

export interface TitleCardConfig { enabled: boolean; title: string; subtitle: string }
export interface CtaCardConfig { enabled: boolean; headline: string; subline: string; button: string }

export interface StudioConfig {
  /** Native Audos integration slug for scene clips. */
  video_integration: string;
  /** The scene-clip engine / model id the workbench generates with. */
  provider: string;
  /** Brand accent for every graphic the post-processing layer draws. */
  accent: string;
  lower_thirds: boolean;
  transitions: TransitionStyle;
  title_card: TitleCardConfig;
  cta_card: CtaCardConfig;
  broll_enabled: boolean;
  /** Optional customer-uploaded audio bed, mounted by the same render. */
  audio_track_url: string;
  /** The character reference photo sent with EVERY scene request on providers
   * that carry references across clips — the basis of character consistency. */
  character_photo_url: string;
  /** The script as last typed in the sidebar — auto-saved, never lost. */
  script_draft: string;
  /** Per-scene speech: the mode, the voice and every clip already paid for. */
  audio: AudioConfig;
  sidebar: SidebarTab;
  /** Motion / compositor theme for graphics and Remotion assembly. */
  motion_theme: 'dark-cinematic' | 'vox-paper';
  saved_at: string;
}

export const DEFAULT_ACCENT = '#F59E0B';

export const DEFAULT_AUDIO_CONFIG: AudioConfig = {
  mode: 'off',
  voice_id: '',
  voice_settings: PRESENTER_VOICE_SETTINGS,
  lipsync_avatar_id: '',
  scenes: {},
};

export const DEFAULT_STUDIO_CONFIG: StudioConfig = {
  video_integration: 'image-and-video-generation',
  provider: '',
  accent: DEFAULT_ACCENT,
  lower_thirds: true,
  transitions: 'fade',
  title_card: { enabled: true, title: '', subtitle: '' },
  cta_card: { enabled: false, headline: '', subline: '', button: '' },
  broll_enabled: true,
  audio_track_url: '',
  character_photo_url: '',
  script_draft: '',
  audio: DEFAULT_AUDIO_CONFIG,
  sidebar: 'script',
  motion_theme: 'dark-cinematic',
  saved_at: '',
};

const TRANSITIONS: TransitionStyle[] = ['fade', 'slide', 'none'];
const TABS: SidebarTab[] = ['script', 'character', 'style', 'audio', 'music', 'context', 'broll'];
const AUDIO_MODES: AudioMode[] = ['off', 'voiceover', 'lipsync'];
const text = (value: unknown, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const httpUrl = (value: unknown) => (/^https?:\/\//i.test(String(value || '')) ? String(value) : '');

// Hard ceilings so a corrupt or runaway record can never bloat the project
// row: the segments route itself narrates at most 100 lines per batch.
const MAX_AUDIO_SCENES = 200;
const MAX_LINE_CHARS = 10000;

function normalizeSceneAudio(raw: unknown): SceneAudio | null {
  const source = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, any>;
  const line = String(source.text ?? '').trim().slice(0, MAX_LINE_CHARS);
  const audioUrl = httpUrl(source.audio_url);
  if (!line && !audioUrl) return null;
  return {
    text: line,
    voice_id: text(source.voice_id, 120),
    spoken_text: String(source.spoken_text ?? '').trim().slice(0, MAX_LINE_CHARS),
    audio_url: audioUrl,
    duration_ms: Math.max(0, Math.round(Number(source.duration_ms) || 0)),
    lipsync_url: httpUrl(source.lipsync_url),
    lipsync_video_id: text(source.lipsync_video_id, 120),
    lipsync_avatar_id: text(source.lipsync_avatar_id, 120),
    lipsync_note: text(source.lipsync_note, 300),
    generated_at: text(source.generated_at, 40),
  };
}

export function normalizeAudioConfig(raw: unknown): AudioConfig {
  const source = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, any>;
  const mode = String(source.mode || '') as AudioMode;
  const scenesRaw = (source.scenes && typeof source.scenes === 'object' && !Array.isArray(source.scenes) ? source.scenes : {}) as Record<string, unknown>;
  const scenes: Record<string, SceneAudio> = {};
  for (const [sceneId, value] of Object.entries(scenesRaw).slice(0, MAX_AUDIO_SCENES)) {
    const entry = normalizeSceneAudio(value);
    if (entry && sceneId) scenes[sceneId] = entry;
  }
  return {
    mode: AUDIO_MODES.includes(mode) ? mode : 'off',
    voice_id: text(source.voice_id, 120),
    voice_settings: clampSettings({ ...PRESENTER_VOICE_SETTINGS, ...(source.voice_settings && typeof source.voice_settings === 'object' ? source.voice_settings : {}) }),
    lipsync_avatar_id: text(source.lipsync_avatar_id, 120),
    scenes,
  };
}

export function normalizeStudioConfig(raw: unknown): StudioConfig {
  const source = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, any>;
  const title = (source.title_card && typeof source.title_card === 'object' ? source.title_card : {}) as Record<string, any>;
  const cta = (source.cta_card && typeof source.cta_card === 'object' ? source.cta_card : {}) as Record<string, any>;
  const accent = String(source.accent || '').trim();
  const sidebar = String(source.sidebar || '') as SidebarTab;
  const transitions = String(source.transitions || '') as TransitionStyle;
  const provider = text(source.provider, 120);
  const videoIntegration = text(source.video_integration, 80) || 'image-and-video-generation';
  return {
    video_integration: videoIntegration,
    provider,
    accent: /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : DEFAULT_ACCENT,
    lower_thirds: source.lower_thirds !== false,
    transitions: TRANSITIONS.includes(transitions) ? transitions : 'fade',
    title_card: {
      enabled: title.enabled !== false,
      title: text(title.title, 70),
      subtitle: text(title.subtitle, 100),
    },
    cta_card: {
      enabled: cta.enabled === true,
      headline: text(cta.headline, 60),
      subline: text(cta.subline, 110),
      button: text(cta.button, 32),
    },
    broll_enabled: source.broll_enabled !== false,
    audio_track_url: /^https?:\/\//i.test(String(source.audio_track_url || '')) ? String(source.audio_track_url) : '',
    character_photo_url: /^https?:\/\//i.test(String(source.character_photo_url || '')) ? String(source.character_photo_url) : '',
    script_draft: String(source.script_draft ?? '').slice(0, 24000),
    audio: normalizeAudioConfig(source.audio),
    motion_theme: source.motion_theme === 'vox-paper' ? 'vox-paper' : 'dark-cinematic',
    sidebar: TABS.includes(sidebar) ? sidebar : 'script',
    saved_at: text(source.saved_at, 40),
  };
}

/** The config a project renders with, with the project's own topic filled in. */
export function studioConfigOf(project: Project | null | undefined): StudioConfig {
  const config = normalizeStudioConfig((project as any)?.studio_config);
  if (!config.title_card.title && project?.topic) config.title_card.title = text(project.topic, 70);
  return config;
}

/** Persist the workbench state. Callers debounce; this write is cheap and additive. */
export async function saveStudioConfig(projectId: string, config: StudioConfig): Promise<void> {
  await updateProject(projectId, { studio_config: { ...config, saved_at: new Date().toISOString() } } as any);
}

// ---------------------------------------------------------------------------
// Auto-applied graphics
// ---------------------------------------------------------------------------

/**
 * The lower third the post-processing layer draws over one scene. Copy comes
 * from Gemini Vision when it has looked at the scene (so the caption matches
 * what is actually on screen), otherwise from the scene's own description.
 */
export function autoLowerThird(scene: Scene, config: StudioConfig): SceneOverlayElement | null {
  const vision = visionOf(scene);
  const headline = text(vision?.lower_third?.text, 60)
    || text(String(scene.description || '').split(/[.!?]/)[0], 60);
  if (!headline) return null;
  const subtext = text(vision?.lower_third?.subtext, 90);
  const window = Math.max(1, Number(scene.script_end_sec) - Number(scene.script_start_sec) || 4);
  return {
    id: `${scene.id}-auto-lt`,
    type: 'lower_third',
    text: headline,
    ...(subtext ? { subtext } : {}),
    x_pct: 4,
    y_pct: 84,
    scale: 1,
    z_index: 12,
    start_offset_sec: Math.min(0.5, window * 0.1),
    duration_sec: Math.max(1.6, Math.min(window - 0.4, 4.5)),
    anim_in: 'rise',
    anim_out: 'fade',
    accent: sceneAccent(scene, config.accent),
  };
}

/** An optional callout naming the strongest object vision found in the frame. */
export function autoCallout(scene: Scene, config: StudioConfig): SceneOverlayElement | null {
  const vision = visionOf(scene);
  const subject = text(vision?.objects?.[0], 36);
  if (!subject) return null;
  const window = Math.max(1, Number(scene.script_end_sec) - Number(scene.script_start_sec) || 4);
  if (window < 3) return null;
  return {
    id: `${scene.id}-auto-label`,
    type: 'label',
    text: subject.replace(/^./, (c) => c.toUpperCase()),
    x_pct: 80,
    y_pct: 18,
    scale: 0.9,
    z_index: 11,
    start_offset_sec: Math.min(1.2, window * 0.25),
    duration_sec: Math.max(1.4, Math.min(window - 1.4, 2.6)),
    anim_in: 'pop',
    anim_out: 'fade',
    accent: sceneAccent(scene, config.accent),
  };
}

const AUTO_SUFFIXES = ['-auto-lt', '-auto-label'];
const isAuto = (element: SceneOverlayElement) => AUTO_SUFFIXES.some((suffix) => element.id.endsWith(suffix));

/**
 * 'Auto-apply graphics': give every analyzed scene a vision-grounded lower
 * third (and a subject callout where the window is long enough), keeping any
 * overlay the customer added by hand. Re-running it refreshes only the
 * auto-generated elements. Returns how many scenes changed.
 */
export async function applyAutoGraphics(scenes: Scene[], config: StudioConfig, options: { withCallouts?: boolean } = {}): Promise<number> {
  let changed = 0;
  for (const scene of scenes) {
    if (scene.status === 'skipped') continue;
    const manual = normalizeOverlays((scene as any).overlays, scene.id).filter((element) => !isAuto(element));
    const generated = [autoLowerThird(scene, config), options.withCallouts ? autoCallout(scene, config) : null]
      .filter(Boolean) as SceneOverlayElement[];
    if (!generated.length) continue;
    const next = [...manual, ...generated].slice(0, 8);
    await updateScene(scene.id, { overlays: next as any }, scene.project_id).catch(() => undefined);
    changed += 1;
  }
  return changed;
}

/** Strip the auto-generated overlays again (the undo for Auto-apply graphics). */
export async function clearAutoGraphics(scenes: Scene[]): Promise<number> {
  let changed = 0;
  for (const scene of scenes) {
    const all = normalizeOverlays((scene as any).overlays, scene.id);
    const manual = all.filter((element) => !isAuto(element));
    if (manual.length === all.length) continue;
    await updateScene(scene.id, { overlays: manual as any }, scene.project_id).catch(() => undefined);
    changed += 1;
  }
  return changed;
}

/**
 * The props the post-processing layer needs, read straight off the config.
 * `createAssemblySource`'s composition draws these as the opening title card,
 * the closing CTA card and the per-scene transition style.
 */
export function postProductionProps(config: StudioConfig, project: Project | null | undefined, durationInFrames: number) {
  const titleFrames = 72;
  const ctaFrames = 84;
  const title = config.title_card.enabled && (config.title_card.title || project?.topic)
    ? { title: config.title_card.title || text(project?.topic, 70), subtitle: config.title_card.subtitle, frames: titleFrames }
    : null;
  const cta = config.cta_card.enabled && config.cta_card.headline
    ? { headline: config.cta_card.headline, subline: config.cta_card.subline, button: config.cta_card.button, frames: ctaFrames, from: Math.max(0, durationInFrames - ctaFrames) }
    : null;
  return {
    accent: config.accent,
    transitionPreset: config.transitions,
    brollEnabled: config.broll_enabled,
    ...(title ? { titleCard: title } : {}),
    ...(cta ? { ctaCard: cta } : {}),
    ...(config.audio_track_url ? { audioTrackUrl: config.audio_track_url } : {}),
  };
}
