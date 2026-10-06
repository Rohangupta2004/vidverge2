// Product Launch Engine — the shapes every screen and the composition share.
//
// NOTHING IN THIS APP SHIPS CONTENT. There is no sample product, no demo
// script, no starter scene list and no poster image anywhere in the engine:
// every string a viewer ever sees is either typed by the creator on Screen 1
// or written by Claude Opus 5 from those words. The only constant assets are
// the soundtrack below and the geometry the render service is pinned to.

/** The four directions the creator can send the film in. */
export type LaunchTone = 'Cinematic' | 'Energetic' | 'Professional' | 'Minimal';

export const LAUNCH_TONES: LaunchTone[] = ['Cinematic', 'Energetic', 'Professional', 'Minimal'];

/** Screen 1. Empty is the only initial state — no field is ever pre-filled. */
export interface LaunchInput {
  productName: string;
  whatItDoes: string;
  websiteUrl: string;
  audience: string;
  tone: LaunchTone;
}

export const EMPTY_LAUNCH_INPUT: LaunchInput = {
  productName: '',
  whatItDoes: '',
  websiteUrl: '',
  audience: '',
  tone: 'Cinematic',
};

export type TransitionType = 'cut' | 'crossfade' | 'whip' | 'flash';
export type Pacing = 'fast' | 'medium' | 'cinematic';

/** One beat of the film, exactly as Claude Opus 5 is asked to return it. */
export interface LaunchScene {
  sceneNumber: number;
  headline: string;
  subtext: string;
  /** The kinetic lines. Each word animates in on its own; *stars* mark accent words. */
  wordRevealLines: string[];
  visualDirection: string;
  durationSeconds: number;
  transitionType: TransitionType;
}

export interface LaunchScript {
  title: string;
  scenes: LaunchScene[];
  cta: string;
  brandColor: string;
  pacing: Pacing;
}

/** Frame plan for one mount of the film. Computed per fps, never guessed. */
export interface SceneTiming {
  from: number;
  durationInFrames: number;
}

export interface FilmTiming {
  fps: number;
  scenes: SceneTiming[];
  outro: SceneTiming;
  totalFrames: number;
}

/**
 * Everything the Remotion composition is mounted with. The composition is a
 * pure function of these props — it reads no module-level content of its own.
 */
export interface FilmProps extends LaunchScript {
  productName: string;
  tone: LaunchTone;
  audioUrl: string;
  /** Live screenshot of the creator's own site, or '' when none was given. */
  screenshotUrl: string;
  timing: FilmTiming;
}

/** The soundtrack every launch film is cut against. */
export const LAUNCH_AUDIO_URL =
  'https://storage.googleapis.com/audos-images/attachments/general/a60abd7f-802c-4334-8237-a42e02bd5814.mp3';

/** The Player runs the film at 60fps. */
export const PREVIEW_FPS = 60;

/**
 * The platform render service is pinned to 1920x1080 @ 30fps and rejects any
 * other geometry, so the MP4 is rendered at 30fps from the SAME composition.
 * Every animation in the film is expressed in seconds via useVideoConfig().fps,
 * so the two mounts are temporally identical.
 */
export const RENDER_FPS = 30;
export const RENDER_WIDTH = 1920;
export const RENDER_HEIGHT = 1080;

/** Claude Opus 5 — the frontier model, used for both script and vision. */
export const OPUS_MODEL = 'claude-opus-5';

/** One frame of the contact sheet. */
export interface SheetFrame {
  timestamp: number;
  url: string;
}

/** Screen 4's quality card, produced by the Opus 5 vision pass. */
export interface QualityReport {
  score: number;
  issues: string[];
  suggestions: string[];
  /** The stitched grid as a data URL, when the browser could read the frames. */
  sheetDataUrl: string;
  frames: SheetFrame[];
}

export function isLaunchInputReady(input: LaunchInput): boolean {
  return input.productName.trim().length > 1 && input.whatItDoes.trim().length > 11;
}
