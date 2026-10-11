/**
 * FACELESS — delivery options.
 *
 * Every knob the brief screen offers is declared once, here, so the UI, the
 * pipeline and the renderer all read the same table rather than each carrying
 * its own copy of the numbers. Nothing in this file calls anything; it is a
 * lookup table plus the small amount of arithmetic that turns a choice into
 * the shape a provider wants.
 */

import type {
  AspectId,
  FilmSettings,
  MusicMoodId,
  VoiceEffectId,
  VoiceSettings,
  VoiceStyleId,
} from '../types/editorial';

// ---------------------------------------------------------------------------
// Aspect ratio
// ---------------------------------------------------------------------------

export interface AspectOption {
  id: AspectId;
  label: string;
  blurb: string;
  /** The design canvas the film is laid out on. */
  width: number;
  height: number;
  /** CSS aspect-ratio for every preview container. */
  css: string;
  /** What the image and video providers call this shape. */
  providerRatio: '16:9' | '9:16';
  /** What the stock-photo search calls it. */
  stockOrientation: 'landscape' | 'portrait';
  /** Appended to generation prompts so the composition is framed for the shape. */
  framingHint: string;
}

export const ASPECTS: Record<AspectId, AspectOption> = {
  landscape: {
    id: 'landscape',
    label: 'Landscape',
    blurb: '16:9 — YouTube, embeds, the web',
    width: 1920,
    height: 1080,
    css: '16 / 9',
    providerRatio: '16:9',
    stockOrientation: 'landscape',
    framingHint: 'Cinematic 16:9 widescreen composition with clear negative space for an overlaid caption.',
  },
  portrait: {
    id: 'portrait',
    label: 'Portrait',
    blurb: '9:16 — Reels, TikTok, Shorts',
    width: 1080,
    height: 1920,
    css: '9 / 16',
    providerRatio: '9:16',
    stockOrientation: 'portrait',
    framingHint:
      'Vertical 9:16 composition with the subject centred in the upper two thirds and clear space at the bottom for captions.',
  },
};

export const ASPECT_LIST: AspectOption[] = [ASPECTS.landscape, ASPECTS.portrait];

export function aspectOf(id: AspectId | undefined): AspectOption {
  return ASPECTS[id || 'landscape'] || ASPECTS.landscape;
}

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------

export interface VoiceStyleOption {
  id: VoiceStyleId;
  label: string;
  blurb: string;
  settings: Pick<VoiceSettings, 'stability' | 'similarity_boost' | 'style'>;
}

export const VOICE_STYLES: VoiceStyleOption[] = [
  {
    id: 'authoritative',
    label: 'Authoritative',
    blurb: 'Steady, unhurried, trusts the words',
    settings: { stability: 0.8, similarity_boost: 0.75, style: 0.3 },
  },
  {
    id: 'conversational',
    label: 'Conversational',
    blurb: 'Talking to one person, not an audience',
    settings: { stability: 0.5, similarity_boost: 0.8, style: 0.5 },
  },
  {
    id: 'energetic',
    label: 'Energetic',
    blurb: 'Forward-leaning, built for a scroll feed',
    settings: { stability: 0.4, similarity_boost: 0.7, style: 0.8 },
  },
  {
    id: 'calm',
    label: 'Calm',
    blurb: 'Even and quiet, nothing pushed',
    settings: { stability: 0.9, similarity_boost: 0.85, style: 0.1 },
  },
];

export interface VoiceEffectOption {
  id: VoiceEffectId;
  label: string;
  blurb: string;
  /**
   * ElevenLabs exposes no post-processing, so an "effect" is expressed in the
   * only four controls it has. Each delta is added to the style's settings and
   * the result is clamped back into 0–1.
   */
  delta: Partial<Pick<VoiceSettings, 'stability' | 'similarity_boost' | 'style'>>;
  speakerBoost: boolean;
}

export const VOICE_EFFECTS: VoiceEffectOption[] = [
  {
    id: 'none',
    label: 'None',
    blurb: 'The style on its own',
    delta: {},
    speakerBoost: true,
  },
  {
    id: 'studio_warmth',
    label: 'Studio Warmth',
    blurb: 'Closer to the mic, fuller body',
    delta: { similarity_boost: 0.1, stability: 0.05 },
    speakerBoost: true,
  },
  {
    id: 'light_reverb',
    label: 'Light Reverb',
    blurb: 'Opens the room up a little',
    delta: { similarity_boost: -0.12, style: 0.08 },
    speakerBoost: false,
  },
  {
    id: 'cinematic_depth',
    label: 'Cinematic Depth',
    blurb: 'Slower, heavier, trailer-weight',
    delta: { stability: 0.12, style: -0.12, similarity_boost: 0.05 },
    speakerBoost: true,
  },
];

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}

/**
 * The style sets the delivery and the effect nudges it. Values are clamped
 * because the voiceover endpoint rejects anything outside 0–1 with a 400
 * before it bills, and a rejected call is a dead run rather than a flat read.
 */
export function resolveVoiceSettings(
  styleId: VoiceStyleId | undefined,
  effectId: VoiceEffectId | undefined,
): VoiceSettings {
  const style = VOICE_STYLES.find((entry) => entry.id === styleId) || VOICE_STYLES[1];
  const effect = VOICE_EFFECTS.find((entry) => entry.id === effectId) || VOICE_EFFECTS[0];
  return {
    stability: clamp01(style.settings.stability + (effect.delta.stability || 0)),
    similarity_boost: clamp01(style.settings.similarity_boost + (effect.delta.similarity_boost || 0)),
    style: clamp01(style.settings.style + (effect.delta.style || 0)),
    use_speaker_boost: effect.speakerBoost,
  };
}

// ---------------------------------------------------------------------------
// Music
// ---------------------------------------------------------------------------

export interface MusicMoodOption {
  id: MusicMoodId;
  label: string;
  blurb: string;
  /** Instrumentation handed to the custom-music prompt. */
  instrumentation: string;
  /** The nearest platform preset, kept for reference and for a prompt hint. */
  preset: string;
}

export const MUSIC_MOODS: MusicMoodOption[] = [
  {
    id: 'documentary',
    label: 'Documentary',
    blurb: 'Strings, low brass, sub-bass texture',
    instrumentation: 'cinematic strings, low brass swells and sub-bass texture',
    preset: 'cinematic',
  },
  {
    id: 'energetic',
    label: 'Energetic',
    blurb: 'Driving pulse, modern synths',
    instrumentation: 'driving percussion, modern synth bass and a bright arpeggiated pulse',
    preset: 'energetic',
  },
  {
    id: 'calm',
    label: 'Calm',
    blurb: 'Soft piano and ambient pads',
    instrumentation: 'soft piano, ambient pads and long sustained air',
    preset: 'calm',
  },
  {
    id: 'inspiring',
    label: 'Inspiring',
    blurb: 'Warm, rising, hopeful',
    instrumentation: 'warm acoustic guitar, rising piano figures and gentle uplifting strings',
    preset: 'uplifting',
  },
  {
    id: 'dark',
    label: 'Dark',
    blurb: 'Low drone, tension, restraint',
    instrumentation: 'low drones, detuned cello, sparse metallic percussion and held tension',
    preset: 'cinematic',
  },
];

export const DEFAULT_MUSIC_VOLUME = 0.3;

export function musicMoodOf(id: MusicMoodId | undefined): MusicMoodOption {
  return MUSIC_MOODS.find((entry) => entry.id === id) || MUSIC_MOODS[0];
}

// ---------------------------------------------------------------------------
// Duration
// ---------------------------------------------------------------------------

/** Nothing in Faceless renders past five minutes. */
export const MAX_DURATION_SECONDS = 300;

/** Above this, generation is long enough that the user should be told first. */
export const LONG_RUN_WARNING_SECONDS = 180;

export interface DurationPreset {
  seconds: number;
  label: string;
}

export const DURATION_PRESETS: DurationPreset[] = [
  { seconds: 30, label: '30s' },
  { seconds: 60, label: '1 min' },
  { seconds: 120, label: '2 min' },
  { seconds: 180, label: '3 min' },
  { seconds: 300, label: '5 min' },
];

export const DEFAULT_DURATION_SECONDS = 60;

/** One scene every fifteen seconds, which is the planning unit the brief shows. */
export function sceneCountFor(seconds: number): number {
  const safe = Math.max(1, Math.min(MAX_DURATION_SECONDS, Math.round(seconds || 0)));
  return Math.ceil(safe / 15);
}

/** Narration lands near 150 words a minute. The only estimate available pre-audio. */
export function estimateSecondsFor(wordCount: number): number {
  return Math.round((Math.max(0, wordCount) / 150) * 60);
}

/** Roughly how many words the preset wants, so the brief can say so. */
export function targetWordsFor(seconds: number): number {
  return Math.round((seconds / 60) * 150);
}

// ---------------------------------------------------------------------------
// Progress phases
// ---------------------------------------------------------------------------

export type ProgressPhaseId = 'plan' | 'visuals' | 'audio';

export interface ProgressPhase {
  id: ProgressPhaseId;
  label: string;
  stages: string[];
  /** Share of a typical run, used for the remaining-time estimate. */
  weight: number;
}

/**
 * The twelve pipeline stages collapse into the three things a person waiting
 * for a film actually wants to know. The stage list underneath stays visible;
 * this is the headline.
 */
export const PROGRESS_PHASES: ProgressPhase[] = [
  {
    id: 'plan',
    label: 'Writing script & scene plan\u2026',
    stages: ['narration', 'analysis', 'asset_index', 'editorial', 'visual_plan'],
    weight: 0.3,
  },
  {
    id: 'visuals',
    label: 'Generating visuals & motion\u2026',
    stages: ['assets', 'prepare', 'motion'],
    weight: 0.45,
  },
  {
    id: 'audio',
    label: 'Composing narration & audio\u2026',
    stages: ['compile', 'validate', 'render', 'finalize'],
    weight: 0.25,
  },
];

export function phaseForStage(stage: string): ProgressPhaseId {
  const match = PROGRESS_PHASES.find((phase) => phase.stages.indexOf(stage) >= 0);
  return match ? match.id : 'plan';
}

/**
 * A run on a 60-second film takes somewhere around six minutes end to end.
 * The estimate scales with the target duration because the asset phase is the
 * part that grows, and it is only ever shown as "about".
 */
export function estimatedRunSeconds(targetDurationSeconds: number): number {
  const minutes = Math.max(0.5, (targetDurationSeconds || DEFAULT_DURATION_SECONDS) / 60);
  return Math.round(180 + minutes * 180);
}

// ---------------------------------------------------------------------------
// The settings object itself
// ---------------------------------------------------------------------------

/**
 * What the platform charges for one Seedance 2.0 clip, measured against the
 * live endpoint rather than guessed. It dwarfs every other line in a short
 * film — a generated still is about $0.067 — which is why background motion
 * is an explicit choice and not a default.
 */
export const SEEDANCE_CLIP_COST_USD = 6;

export const DEFAULT_SETTINGS: FilmSettings = {
  aspect: 'landscape',
  voiceStyle: 'conversational',
  voiceEffect: 'none',
  musicMood: 'documentary',
  musicVolume: DEFAULT_MUSIC_VOLUME,
  targetDurationSeconds: DEFAULT_DURATION_SECONDS,
  captionsEnabled: true,
  depthMotion: false,
};

const ASPECT_IDS: AspectId[] = ['landscape', 'portrait'];
const STYLE_IDS: VoiceStyleId[] = ['authoritative', 'conversational', 'energetic', 'calm'];
const EFFECT_IDS: VoiceEffectId[] = ['none', 'studio_warmth', 'light_reverb', 'cinematic_depth'];
const MOOD_IDS: MusicMoodId[] = ['documentary', 'energetic', 'calm', 'inspiring', 'dark'];

function pick<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  const candidate = String(value || '') as T;
  return allowed.indexOf(candidate) >= 0 ? candidate : fallback;
}

/** Anything read back from storage is normalised before the UI binds to it. */
export function normaliseSettings(raw: unknown): FilmSettings {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<FilmSettings>;
  const target = Number(source.targetDurationSeconds);
  const volume = Number(source.musicVolume);
  return {
    aspect: pick(source.aspect, ASPECT_IDS, DEFAULT_SETTINGS.aspect),
    voiceStyle: pick(source.voiceStyle, STYLE_IDS, DEFAULT_SETTINGS.voiceStyle),
    voiceEffect: pick(source.voiceEffect, EFFECT_IDS, DEFAULT_SETTINGS.voiceEffect),
    musicMood: pick(source.musicMood, MOOD_IDS, DEFAULT_SETTINGS.musicMood),
    musicVolume: Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : DEFAULT_MUSIC_VOLUME,
    targetDurationSeconds: Number.isFinite(target)
      ? Math.max(15, Math.min(MAX_DURATION_SECONDS, Math.round(target)))
      : DEFAULT_DURATION_SECONDS,
    captionsEnabled: source.captionsEnabled !== false,
    depthMotion: source.depthMotion === true,
  };
}
