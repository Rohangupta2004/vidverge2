/**
 * STAGE 8 — createMotionPlan.
 *
 * Turns an editorial plan expressed in seconds into renderer-facing
 * instructions expressed in frames. Everything downstream of here is
 * deterministic: the same FilmSpec renders the same film, which is what makes
 * a targeted revision cheap and a QA failure reproducible.
 *
 * Three things are decided here rather than earlier, because they only make
 * sense once the beat's actual media is known:
 *   - the camera's focal origin, so the push is into the subject rather than
 *     the middle of the frame
 *   - how long a transition runs, in frames
 *   - how much of the beat a text cue occupies
 */

import type {
  AspectId,
  EditorialTimeline,
  FacelessBeat,
  MotionCameraMove,
  MotionPlan,
  MotionSfxCue,
  MotionShot,
  MotionTransition,
  PreparedAsset,
  SFXAsset,
  TransitionType,
} from '../types/editorial';
import { RENDER_GEOMETRY } from '../lib/renderAdapter';
import { DEFAULT_MUSIC_VOLUME, aspectOf } from '../lib/facelessOptions';

/** How long each transition takes to resolve, in frames at 30fps. */
export const TRANSITION_FRAMES: Record<TransitionType, number> = {
  cut: 0,
  match_cut: 2,
  dissolve: 9,
  blur_reveal: 11,
  freeze_punch: 6,
};

export interface CreateMotionPlanInput {
  timeline: EditorialTimeline;
  preparedAssets: PreparedAsset[];
  musicUrl?: string | null;
  sfx?: SFXAsset[];
  /** Decides the design canvas. Landscape when omitted. */
  aspect?: AspectId;
  /** 0–1 ceiling for the music bed, from the brief's slider. */
  musicVolume?: number;
}

export function createMotionPlan(input: CreateMotionPlanInput): MotionPlan {
  const { timeline, preparedAssets } = input;
  const fps = RENDER_GEOMETRY.fps;
  const prepared = new Map(preparedAssets.map((asset) => [asset.beatId, asset]));
  const totalFrames = Math.max(fps, Math.round(timeline.duration * fps));

  const shots: MotionShot[] = timeline.beats.map((beat, index) => {
    const startFrame = Math.round(beat.narrationStart * fps);
    const isLast = index === timeline.beats.length - 1;
    const endFrame = isLast ? totalFrames : Math.round(beat.narrationEnd * fps);
    const durationFrames = Math.max(2, endFrame - startFrame);
    const asset = prepared.get(beat.id);

    return {
      beatId: beat.id,
      index,
      startFrame,
      endFrame: startFrame + durationFrames,
      durationFrames,
      assetUrl: asset?.url || '',
      assetType: asset?.type || 'graphic',
      playback: asset?.playback || 'still_with_camera',
      sourceStartSeconds: asset?.sourceStart || 0,
      camera: cameraMove(beat, startFrame, durationFrames, fps, timeline.beats[index - 1]),
      text: textCue(beat, startFrame, durationFrames, fps),
      transitionOut: transitionOut(beat, startFrame + durationFrames),
      visualType: beat.visualType,
      narrationText: beat.narrationText,
      musicEnergy: beat.soundDesign?.musicEnergy ?? 0.5,
    };
  });

  const shape = aspectOf(input.aspect);

  return {
    filmId: timeline.filmId,
    fps,
    // The rendered frame is fixed by the platform render service; the canvas
    // is what the film is actually laid out on, and the composition scales
    // one into the other.
    width: RENDER_GEOMETRY.width,
    height: RENDER_GEOMETRY.height,
    canvas: { width: shape.width, height: shape.height },
    musicVolume:
      typeof input.musicVolume === 'number' && Number.isFinite(input.musicVolume)
        ? Math.max(0, Math.min(1, input.musicVolume))
        : DEFAULT_MUSIC_VOLUME,
    durationInFrames: totalFrames,
    shots,
    sfx: sfxCues(input.sfx || [], fps, totalFrames),
    music: { url: input.musicUrl || null, arc: timeline.musicArc },
    palette: resolvePalette(),
    typography: resolveTypography(),
    continuity: timeline.continuityGuide,
  };
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

function cameraMove(
  beat: FacelessBeat,
  startFrame: number,
  durationFrames: number,
  fps: number,
  previous: FacelessBeat | undefined,
): MotionCameraMove {
  const requested = Math.round((beat.camera.durationMs / 1000) * fps);
  const moveFrames = Math.max(2, Math.min(durationFrames, requested || durationFrames));

  // A match cut only reads as one continuous movement if the incoming shot
  // picks the camera up where the outgoing one put it down.
  const continuesFrom = previous?.transition?.type === 'match_cut' ? previous.camera.endScale : null;
  const startScale = continuesFrom ?? beat.camera.startScale;

  const origin = focalOrigin(beat);

  return {
    type: beat.camera.type,
    startScale,
    endScale: beat.camera.endScale,
    startFrame,
    endFrame: startFrame + moveFrames,
    originX: origin.x,
    originY: origin.y,
    easing: easingFor(beat.camera.type),
  };
}

function easingFor(type: FacelessBeat['camera']['type']): MotionCameraMove['easing'] {
  switch (type) {
    case 'statement_punch':
      return 'snap';
    case 'reveal_pullback':
      return 'easeOut';
    case 'data_static':
      return 'linear';
    case 'transition_follow':
      return 'linear';
    default:
      return 'easeInOut';
  }
}

/**
 * Pushing into the dead centre of every frame for a whole film is the tell of
 * an automated edit. The origin is offset deterministically from the beat id
 * so successive shots move into different parts of the frame, except where
 * the grammar requires the centre.
 */
export function focalOrigin(beat: FacelessBeat): { x: number; y: number } {
  if (beat.camera.type === 'data_static' || beat.visualType === 'kinetic_type') {
    return { x: 0.5, y: 0.5 };
  }
  if (beat.camera.type === 'transition_follow') {
    return { x: hash(beat.id) % 2 === 0 ? 0.18 : 0.82, y: 0.5 };
  }
  const h = hash(beat.id);
  return {
    x: round2(0.34 + ((h % 7) / 6) * 0.32),
    y: round2(0.36 + (((h >> 3) % 5) / 4) * 0.28),
  };
}

function hash(value: string): number {
  let out = 0;
  for (let i = 0; i < value.length; i += 1) {
    out = (out * 31 + value.charCodeAt(i)) & 0x7fffffff;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Text and transitions
// ---------------------------------------------------------------------------

function textCue(
  beat: FacelessBeat,
  startFrame: number,
  durationFrames: number,
  fps: number,
): MotionShot['text'] {
  const overlay = beat.textOverlay;
  if (!overlay) return undefined;

  const offsetFrames = Math.round((overlay.offsetMs / 1000) * fps);
  const cueStart = startFrame + Math.max(0, Math.min(durationFrames - 6, offsetFrames));

  // Long enough to read: roughly a fifth of a second per word, floored at a
  // second and a half, and never past the end of the beat.
  const words = overlay.content.split(/\s+/).filter(Boolean).length;
  const readFrames = Math.max(Math.round(1.5 * fps), Math.round(words * 0.22 * fps));
  const cueEnd = Math.min(startFrame + durationFrames, cueStart + readFrames);

  return {
    treatment: overlay.type,
    content: overlay.content,
    startFrame: cueStart,
    endFrame: Math.max(cueStart + 4, cueEnd),
    emphasisWords: beat.emphasisWords || [],
  };
}

function transitionOut(beat: FacelessBeat, endFrame: number): MotionTransition | undefined {
  if (!beat.transition) return undefined;
  const frames = TRANSITION_FRAMES[beat.transition.type] ?? 0;
  return {
    type: beat.transition.type,
    startFrame: endFrame,
    durationFrames: frames,
    sourceElement: beat.transition.sourceElement,
    destinationElement: beat.transition.destinationElement,
  };
}

function sfxCues(sfx: SFXAsset[], fps: number, totalFrames: number): MotionSfxCue[] {
  return sfx
    .filter((cue) => Boolean(cue.url))
    .map((cue) => ({
      url: String(cue.url),
      startFrame: Math.max(0, Math.min(totalFrames - 1, Math.round((cue.offsetMs / 1000) * fps))),
      description: cue.description,
    }))
    .sort((a, b) => a.startFrame - b.startFrame);
}

// ---------------------------------------------------------------------------
// Look
// ---------------------------------------------------------------------------

/**
 * The film inherits the space's own theme tokens rather than carrying its own
 * palette, so a brand change in workspace-branding.json reaches the rendered
 * output as well as the shell.
 */
function resolvePalette(): MotionPlan['palette'] {
  const read = (name: string, fallback: string) => {
    if (typeof window === 'undefined' || !document?.documentElement) return fallback;
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  };
  return {
    background: read('--space-surface-bg', '#080c14'),
    ink: read('--space-text-primary', '#f1f5f9'),
    accent: read('--space-brand-primary-500', '#f59e0b'),
    scrim: 'rgba(5,8,14,0.74)',
  };
}

function resolveTypography(): MotionPlan['typography'] {
  const stack = "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  return { headingFont: stack, bodyFont: stack };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
