/**
 * Conform on ingest (Phase 2 §3).
 *
 * The platform's Remotion service renders at a FIXED geometry — 30fps at
 * 1920x1080 (`POST /api/render/remotion` rejects any other fps). So "set the
 * composition to match the clips" is realised as exact integer frame-mapping
 * onto that grid instead of a variable composition rate:
 *
 * - source fps that is an integer multiple of 30 (30, 60, 120) plays at
 *   natural speed — every composition frame advances a whole number of source
 *   frames (k:1), zero duplicated frames.
 * - any other source fps is RE-TIMED with playbackRate = 30 / sourceFps so
 *   every composition frame advances EXACTLY ONE source frame (1:1). A 24fps
 *   clip plays at 1.25x, a 25fps clip at 1.2x, a 50fps clip at 0.6x. This is
 *   the "conform to majority and re-time the rest" rule with the majority
 *   pinned to the platform's grid — deterministic, and zero judder because no
 *   frame is ever duplicated or dropped.
 *
 * Frames are extracted server-side by ffmpeg (Remotion <OffthreadVideo>), so
 * the mapping above is frame-accurate and reproducible.
 *
 * Spatial rule: never scale a clip past 100% of its native pixels — letterbox
 * into the ground instead (the renderer computes fit = min(W/cw, H/ch, 1)).
 * Temporal rule: a clip shorter than the scene using it is rejected — never
 * loop to fill time (enforced in plan validation via availableCompFrames).
 */
import type { IngestedClip, VideoPlan, ClipSceneSpec } from '../types';

/** Fixed by the platform render service — see integrations/remotion-rendering. */
export const COMPOSITION_FPS = 30;

const INTEGER_TOLERANCE = 0.002;

/** playbackRate giving an exact integer source-frame step per composition frame. */
export function conformPlaybackRate(sourceFps: number): number {
  const ratio = sourceFps / COMPOSITION_FPS;
  if (Math.round(ratio) >= 1 && Math.abs(ratio - Math.round(ratio)) / Math.round(ratio) < INTEGER_TOLERANCE) {
    return 1; // natural speed, whole-frame step (k:1)
  }
  return COMPOSITION_FPS / sourceFps; // re-timed, exact 1:1 frame map
}

export interface ConformNote { clipId: string; message: string; }

/** Set every clip's playbackRate; return human-readable conform notes. */
export function conformClips(clips: IngestedClip[]): ConformNote[] {
  const notes: ConformNote[] = [];
  for (const clip of clips) {
    clip.playbackRate = conformPlaybackRate(clip.fps);
    if (clip.playbackRate === 1) {
      const step = Math.round(clip.fps / COMPOSITION_FPS);
      notes.push({ clipId: clip.clipId, message: `${clip.fps}fps — natural speed, ${step}:1 frame map onto the ${COMPOSITION_FPS}fps grid` });
    } else {
      notes.push({ clipId: clip.clipId, message: `${clip.fps}fps — re-timed to ${clip.playbackRate.toFixed(3)}x for an exact 1:1 frame map (no duplicated frames, no judder)` });
    }
  }
  return notes;
}

/** Composition frames available inside a trim range at the conformed rate. */
export function availableCompFrames(clip: IngestedClip, trim: [number, number]): number {
  const seconds = Math.max(0, trim[1] - trim[0]);
  return Math.floor((seconds * COMPOSITION_FPS) / clip.playbackRate);
}

/** OffthreadVideo startFrom (composition frames) for a source-time trim-in. */
export function startFromFrames(clip: IngestedClip, trimInSeconds: number): number {
  return Math.round((trimInSeconds * COMPOSITION_FPS) / clip.playbackRate);
}

/**
 * Exposure match at cuts (Phase 2 §5): if mean luminance differs by more than
 * 12% across a boundary, the INCOMING scene gets a 4-frame dip. Screen-scene
 * luminance comes from the ingest canvas stats; clip-scene luminance from the
 * grade sampler's stats over the trim range.
 */
export function resolveExposureDips(
  plan: VideoPlan,
  lumaBySceneId: Map<string, number>,
): { applied: Array<{ sceneId: string; delta: number }> } {
  const applied: Array<{ sceneId: string; delta: number }> = [];
  for (let i = 1; i < plan.scenes.length; i++) {
    const prev = plan.scenes[i - 1];
    const scene = plan.scenes[i];
    const a = lumaBySceneId.get(prev.id);
    const b = lumaBySceneId.get(scene.id);
    if (a == null || b == null) continue;
    const delta = Math.abs(a - b);
    if (delta > 0.12) {
      (scene as ClipSceneSpec).dipIn = 4;
      applied.push({ sceneId: scene.id, delta: Math.round(delta * 100) / 100 });
    }
  }
  return { applied };
}
