// filmTiming — the ONE place a frame number is decided.
//
// The film is mounted twice (the 60fps Player and the 30fps MP4 render), and a
// cut that lands differently in the two is the classic way a preview stops
// being a preview. So the plan is computed here from the script's own seconds
// and handed to the composition as props; the composition itself never does
// timeline arithmetic.

import type { FilmTiming, LaunchScript, SceneTiming, TransitionType } from './launchTypes';

/** A beat shorter than this cannot be read; longer than this is a stall. */
const MIN_SCENE_SECONDS = 1.4;
const MAX_SCENE_SECONDS = 9;

/** The outro hold — brand name, tagline, and room to breathe before black. */
const OUTRO_SECONDS = 3.4;

/**
 * How long the incoming shot overlaps the one it replaces. A hard cut lands on
 * the beat with no overlap at all; the softer transitions need the outgoing
 * shot still painted underneath, which is also what keeps a boundary frame
 * from ever being empty.
 */
export function overlapSeconds(transition: TransitionType): number {
  if (transition === 'crossfade') return 0.34;
  if (transition === 'whip') return 0.18;
  if (transition === 'flash') return 0.08;
  return 0;
}

/** Pacing is the creative tempo dial: it stretches or compresses every beat. */
function pacingScale(pacing: string): number {
  if (pacing === 'fast') return 0.82;
  if (pacing === 'cinematic') return 1.16;
  return 1;
}

export function clampSceneSeconds(seconds: number, pacing: string): number {
  const raw = Number(seconds);
  const safe = Number.isFinite(raw) && raw > 0 ? raw : 3;
  const scaled = safe * pacingScale(pacing);
  return Math.min(MAX_SCENE_SECONDS, Math.max(MIN_SCENE_SECONDS, scaled));
}

/**
 * Lay the script out on a frame grid for one fps.
 *
 * Scene i starts `overlap` frames before scene i-1 ends, and scene i-1 keeps
 * its full length, so both are mounted through the handover and the incoming
 * shot has something real to dissolve out of.
 */
export function planTiming(script: LaunchScript, fps: number): FilmTiming {
  const rate = Math.max(1, Math.round(fps));
  const scenes: SceneTiming[] = [];
  const list = Array.isArray(script.scenes) ? script.scenes : [];

  let cursor = 0;
  list.forEach((scene, index) => {
    const frames = Math.max(
      rate,
      Math.round(clampSceneSeconds(scene.durationSeconds, script.pacing) * rate),
    );
    if (index === 0) {
      scenes.push({ from: 0, durationInFrames: frames });
      cursor = frames;
      return;
    }
    const overlap = Math.round(overlapSeconds(scene.transitionType) * rate);
    const from = Math.max(0, cursor - overlap);
    scenes.push({ from, durationInFrames: frames });
    cursor = from + frames;
  });

  const outroOverlap = Math.round(overlapSeconds('crossfade') * rate);
  const outroFrames = Math.round(OUTRO_SECONDS * rate);
  const outroFrom = scenes.length ? Math.max(0, cursor - outroOverlap) : 0;

  return {
    fps: rate,
    scenes,
    outro: { from: outroFrom, durationInFrames: outroFrames },
    totalFrames: Math.max(rate, outroFrom + outroFrames),
  };
}

/** Runtime of the finished film, for the UI and for the frame sampler. */
export function filmSeconds(timing: FilmTiming): number {
  return timing.totalFrames / timing.fps;
}

export function formatSeconds(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return minutes + ':' + String(rest).padStart(2, '0');
}
