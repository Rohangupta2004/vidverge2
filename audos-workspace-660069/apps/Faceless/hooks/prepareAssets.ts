/**
 * STAGE 7 — prepareAssets.
 *
 * Asset-type-aware, explicitly NOT trim-to-duration. The media a beat resolved
 * to arrives in four different shapes and each one needs a different decision:
 *
 *   video clip           → pick the most relevant subrange, not the first N seconds
 *   long B-roll          → same, but the window matters more: the middle of a
 *                          clip is almost always the part worth using
 *   image                → leave it alone; the motion plan supplies the movement
 *   generated image      → mark for parallax so it never plays as a flat zoom
 *   short clip (<2s)     → do not pad. Flag the shortfall and let the motion
 *                          plan cover it
 *
 * Nothing here touches the media itself. It produces the decision; the motion
 * plan and the composition act on it. That keeps the stage cheap and
 * re-runnable, which matters when a revision only patches two beats.
 */

import type {
  FacelessBeat,
  PreparedAsset,
  PreparedPlayback,
  ResolvedAsset,
} from '../types/editorial';

/** Under this, a clip is treated as a texture to loop rather than a shot to trim. */
export const SHORT_CLIP_SECONDS = 2;

export interface PrepareAssetsInput {
  beat: FacelessBeat;
  asset: ResolvedAsset;
}

export function prepareAssets(input: PrepareAssetsInput): PreparedAsset {
  const { beat, asset } = input;
  const beatDuration = round3(beat.narrationEnd - beat.narrationStart);

  if (asset.type !== 'video') {
    // A generated still is the one case where a flat Ken Burns push gives the
    // game away, because the image has no real parallax of its own to borrow.
    const playback: PreparedPlayback = asset.tier >= 4 ? 'parallax_still' : 'still_with_camera';
    return {
      beatId: beat.id,
      url: asset.url,
      type: asset.type,
      playback,
      sourceStart: 0,
      sourceEnd: beatDuration,
      beatDuration,
      shortfall: 0,
      notes:
        playback === 'parallax_still'
          ? 'Generated still: layered drift plus the beat camera move, never static playback.'
          : 'Existing still: the beat camera move carries it.',
    };
  }

  const clipDuration = asset.duration > 0 ? asset.duration : beatDuration;

  if (clipDuration < SHORT_CLIP_SECONDS && clipDuration < beatDuration) {
    return {
      beatId: beat.id,
      url: asset.url,
      type: 'video',
      playback: 'short_clip_hold',
      sourceStart: 0,
      sourceEnd: round3(clipDuration),
      beatDuration,
      shortfall: round3(beatDuration - clipDuration),
      notes: `Clip is ${clipDuration.toFixed(2)}s against a ${beatDuration.toFixed(2)}s beat. Not padded: the motion plan covers the remainder with a continuous camera move over a loop.`,
    };
  }

  const window = chooseSubrange(clipDuration, beatDuration);
  return {
    beatId: beat.id,
    url: asset.url,
    type: 'video',
    playback: 'video_subrange',
    sourceStart: window.start,
    sourceEnd: window.end,
    beatDuration,
    shortfall: round3(Math.max(0, beatDuration - (window.end - window.start))),
    notes:
      clipDuration > beatDuration + 0.5
        ? `Long clip (${clipDuration.toFixed(1)}s): using the ${window.start.toFixed(1)}s–${window.end.toFixed(1)}s window, where the action usually is.`
        : 'Clip length matches the beat; played from the top.',
  };
}

/**
 * Stock and generated clips almost always open on a settling camera and close
 * on a drift-off, so the usable material is in the middle. The window is
 * centred, then nudged forward slightly — the back half of a clip is more
 * often the part with the subject fully in frame.
 */
export function chooseSubrange(clipDuration: number, beatDuration: number): { start: number; end: number } {
  if (clipDuration <= beatDuration + 0.25) {
    return { start: 0, end: round3(Math.min(clipDuration, beatDuration)) };
  }
  const slack = clipDuration - beatDuration;
  const start = Math.min(slack, slack * 0.55);
  return { start: round3(start), end: round3(start + beatDuration) };
}

/** Every beat prepared in one pass, with unresolved beats skipped rather than faked. */
export function prepareAllAssets(
  beats: FacelessBeat[],
  resolved: Record<string, ResolvedAsset>,
): PreparedAsset[] {
  return beats
    .map((beat) => {
      const asset = resolved[beat.id];
      return asset ? prepareAssets({ beat, asset }) : null;
    })
    .filter((entry): entry is PreparedAsset => entry !== null);
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
