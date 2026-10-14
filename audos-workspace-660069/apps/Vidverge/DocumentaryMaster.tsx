/**
 * THE DOCUMENTARY MASTER COMPOSITION — Pipeline B's final assembly.
 *
 * WHY THIS IS A STRING AND NOT A MODULE. The platform's Remotion service
 * compiles ONE standalone TSX string on the server; it cannot import anything
 * from this workspace, and `remotion` itself is not a package the space bundle
 * can resolve — a real `import ... from 'remotion'` in an app file fails the
 * whole space compile with "Could not resolve". So the composition lives here
 * as source text, exactly like every other VidVerge composition
 * (see apps/SceneForge/remotion/*). The props it consumes are typed below and
 * built by `buildDocumentaryProps`, which is where the timeline arithmetic is
 * done in checkable code rather than inside a template.
 *
 * WHAT IT DOES
 *   · Lays each Seedance clip end to end on exact frame boundaries.
 *   · Cross-dissolves between them over 5 frames: an incoming clip starts 5
 *     frames early and fades up OVER the outgoing one, so the cut never dips
 *     through the background.
 *   · Plays the narration at full level and ducks the ambient bed to -22 dB
 *     underneath it, ramped rather than stepped, against the real word
 *     timings from Deepgram.
 */

import { clampFrames, FPS } from './lib/render';
import type { DocumentaryShot } from './types';

// BED_VOLUME (0.12) and DUCKED_VOLUME (0.079, which is -22 dB on a 0..1
// scale) live only inside the composition source. The crossfade is shared with
// prop construction because incoming clips and their SFX must use one timeline.
export const DOCUMENTARY_CROSSFADE_FRAMES = 5;

export interface DocumentaryScene {
  scene_id: string;
  video_url: string;
  duration_frames: number;
  /** Frame within the scene where the paper-snap hit lands. */
  sfx_trigger_frame: number;
  /** Absolute frame this scene starts on, computed by buildDocumentaryProps. */
  start_frame: number;
}

export interface DocumentaryProps {
  canvas_bg_color: string;
  voiceover_url: string;
  ambient_music_url: string;
  /**
   * The paper-snap hit. Optional on purpose: a composition pointed at an
   * asset URL that does not resolve fails the render, so the SFX layer is only
   * mounted when a real URL is supplied.
   */
  sfx_url: string;
  /** Frame ranges where the narrator is speaking, for the music ducking. */
  speech_ranges: Array<[number, number]>;
  scenes: DocumentaryScene[];
}

export interface BuildDocumentaryPropsInput {
  shots: DocumentaryShot[];
  voiceoverUrl: string;
  ambientMusicUrl: string;
  speechRanges: Array<[number, number]>;
  canvasBgColor: string;
  sfxUrl?: string;
}

export interface BuiltDocumentary {
  props: DocumentaryProps;
  durationInFrames: number;
}

/**
 * Lay the shots on the timeline. Scenes are placed on exact frame boundaries
 * so no clip can land a frame short of the next one, and the overall length is
 * the sum of the clip lengths — the crossfades borrow from the outgoing clip
 * rather than extending the film.
 */
export function buildDocumentaryProps(input: BuildDocumentaryPropsInput): BuiltDocumentary {
  let cursor = 0;
  const scenes: DocumentaryScene[] = input.shots.map((shot, index) => {
    const duration = Math.max(1, Math.round(shot.durationFrames));
    const start = cursor;
    cursor += duration;
    return {
      scene_id: `beat-${index + 1}`,
      video_url: shot.videoUrl,
      duration_frames: duration,
      // Incoming clips begin on the crossfade lead. Subtract it here so the
      // hit stays one third into the clip's local movement, not the nominal cut.
      sfx_trigger_frame: Math.max(
        0,
        Math.min(
          duration - 1,
          Math.round(duration / 3) - (index === 0 ? 0 : DOCUMENTARY_CROSSFADE_FRAMES),
        ),
      ),
      start_frame: start,
    };
  });

  return {
    props: {
      canvas_bg_color: input.canvasBgColor,
      voiceover_url: input.voiceoverUrl,
      ambient_music_url: input.ambientMusicUrl,
      sfx_url: input.sfxUrl || '',
      speech_ranges: input.speechRanges,
      scenes,
    },
    durationInFrames: clampFrames(cursor || FPS),
  };
}

/** The exact TSX the render farm compiles. */
export const DOCUMENTARY_MASTER_SOURCE = String.raw`
import React from 'react';
import { AbsoluteFill, Audio, OffthreadVideo, Sequence, interpolate, useCurrentFrame } from 'remotion';

const CROSSFADE = ${DOCUMENTARY_CROSSFADE_FRAMES};
const BED_VOLUME = 0.12;
const DUCKED_VOLUME = 0.079;
const DUCK_RAMP = 6;

const SeedanceClip = ({ scene, isFirst }: { scene: any; isFirst: boolean }) => {
  const frame = useCurrentFrame();
  const opacity = isFirst
    ? 1
    : interpolate(frame, [0, CROSSFADE], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      });
  return (
    <AbsoluteFill style={{ opacity }}>
      <OffthreadVideo
        src={scene.video_url}
        muted
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    </AbsoluteFill>
  );
};

export default function DocumentaryMaster(props: any) {
  const scenes = Array.isArray(props.scenes) ? props.scenes : [];
  const speechRanges = Array.isArray(props.speech_ranges) ? props.speech_ranges : [];

  const duckAmount = (frame: number) => {
    for (let i = 0; i < speechRanges.length; i += 1) {
      const from = speechRanges[i][0];
      const to = speechRanges[i][1];
      if (frame >= from && frame <= to) return 1;
      if (frame >= from - DUCK_RAMP && frame < from) return (frame - (from - DUCK_RAMP)) / DUCK_RAMP;
      if (frame > to && frame <= to + DUCK_RAMP) return (to + DUCK_RAMP - frame) / DUCK_RAMP;
    }
    return 0;
  };

  const bedVolume = (frame: number) =>
    BED_VOLUME + (DUCKED_VOLUME - BED_VOLUME) * duckAmount(frame);

  return (
    <AbsoluteFill style={{ backgroundColor: props.canvas_bg_color || '#0D0B05' }}>
      {scenes.map((scene: any, index: number) => {
        const lead = index === 0 ? 0 : CROSSFADE;
        return (
          <Sequence
            key={scene.scene_id}
            from={Math.max(0, scene.start_frame - lead)}
            durationInFrames={scene.duration_frames + lead}
          >
            <SeedanceClip scene={scene} isFirst={index === 0} />
          </Sequence>
        );
      })}

      {props.voiceover_url ? <Audio src={props.voiceover_url} volume={1} /> : null}
      {props.ambient_music_url ? <Audio src={props.ambient_music_url} volume={bedVolume} /> : null}

      {props.sfx_url
        ? scenes.map((scene: any) => (
            <Sequence
              key={'sfx-' + scene.scene_id}
              from={scene.start_frame + scene.sfx_trigger_frame}
              durationInFrames={24}
            >
              <Audio src={props.sfx_url} volume={0.35} />
            </Sequence>
          ))
        : null}
    </AbsoluteFill>
  );
}
`;

/**
 * The composition source with its length baked into
 * `calculateDemoVideoDuration`, so the render still knows the film's length
 * even if the submit body's `durationInFrames` is ever dropped.
 */
export function createDocumentaryMasterSource(totalFrames: number): string {
  return [
    DOCUMENTARY_MASTER_SOURCE,
    '',
    `export const calculateDemoVideoDuration = function () { return ${clampFrames(totalFrames)}; };`,
    '',
  ].join('\n');
}
