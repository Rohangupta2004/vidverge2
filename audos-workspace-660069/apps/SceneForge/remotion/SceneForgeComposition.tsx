import { COMPARISON_CARD_SOURCE } from './ComparisonCardRemotion';
import { HEYGEN_LAYER_SOURCE } from './HeygenLayer';
import { SEEDANCE_LAYER_SOURCE } from './SeedanceClipLayer';
import { STATIC_IMAGE_SOURCE } from './StaticImageOverlay';
import { TEXT_FACT_SOURCE } from './TextFactOverlay';
import { POSITION_HELPERS_SOURCE } from './positionHelpers';

export const SCENE_FORGE_COMPOSITION_SOURCE = String.raw`
import React from 'react';
import { AbsoluteFill, Img, Sequence, Video, interpolate, spring, useCurrentFrame } from 'remotion';

${POSITION_HELPERS_SOURCE}
${HEYGEN_LAYER_SOURCE}
${SEEDANCE_LAYER_SOURCE}
${TEXT_FACT_SOURCE}
${COMPARISON_CARD_SOURCE}
${STATIC_IMAGE_SOURCE}

export default function SceneForgeComposition({ heygenVideoUrl, sourceAspectRatio = '16:9', overlays, fps = 30 }: any) {
  return (
    <AbsoluteFill style={{ backgroundColor: '#050505', overflow: 'hidden' }}>
      <HeygenLayer url={heygenVideoUrl} aspectRatio={sourceAspectRatio} />
      {overlays.map((overlay: any) => {
        const from = Math.max(0, Math.round(overlay.startSec * fps));
        const durationInFrames = Math.max(1, Math.round(overlay.durationSec * fps));
        return (
          <Sequence key={overlay.id} from={from} durationInFrames={durationInFrames}>
            {overlay.type === 'seedance_motion' && <SeedanceClipLayer overlay={overlay} fps={fps} />}
            {overlay.type === 'text_fact' && <TextFactOverlay overlay={overlay} fps={fps} />}
            {overlay.type === 'comparison_card' && <ComparisonCardRemotion overlay={overlay} fps={fps} />}
            {overlay.type === 'static_image' && <StaticImageOverlay overlay={overlay} fps={fps} />}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}
`;
