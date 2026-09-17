/**
 * Clip scene renderer — emitted verbatim into the rendered composition.
 *
 * One clip scene = real footage (upload / Veo atmosphere / HeyGen presenter)
 * letterboxed into the ground. Rules implemented here (Phase 2):
 * - <OffthreadVideo>, never <Video> — frames are extracted with ffmpeg so
 *   renders are frame-accurate and reproducible.
 * - startFrom/playbackRate come from the conform stage: every composition
 *   frame advances a whole number of source frames — zero judder.
 * - Never scale a clip past 100% of its native pixels — letterbox instead
 *   (fit = min(W/cw, H/ch, 1)).
 * - The clip is NEVER graded — screenshots move toward the footage
 *   (plan.uiGrade on the Scene stage), never the other way.
 * - audio 'strip' (default) mutes the clip; 'duck' keeps it with 6-frame
 *   fades at both ends while the music bed ducks −12dB (in the Video root).
 * - Blank-plate composite: the real screenshot is corner-pinned into the
 *   tracked screen quad via homography → CSS matrix3d, with focus-matched
 *   blur, glow spill onto nearby surfaces, and a 4–8% reflection. Grain is
 *   applied AFTER this composite by the global FinishLayer — one pass, never
 *   two.
 *
 * References from the assembled composition scope: OffthreadVideo,
 * AbsoluteFill, Img, useCurrentFrame, plateMatrix3d, interpolatePlateCorners,
 * withAlpha, clamp01, Overlay.
 */
export const CLIP_SCENE_TSX = `
const ClipScene = ({ scene, clip, plateImage, theme, preset, width, height, fps }) => {
  const frame = useCurrentFrame();
  const trim = Array.isArray(scene.trim) ? scene.trim : [0, clip.durationSeconds || 0];
  const rate = clip.playbackRate || 1;
  const startFrom = Math.round((trim[0] * fps) / rate);

  // Letterbox into the ground; never scale past 100% of native pixels.
  const fit = Math.min(width / clip.width, height / clip.height, 1);
  const boxW = Math.round(clip.width * fit);
  const boxH = Math.round(clip.height * fit);

  const stripped = (scene.audio || 'strip') !== 'duck';
  const fadeIn = clamp01(frame / 6);
  const fadeOut = clamp01((scene.duration - frame) / 6);
  const clipVolume = stripped ? 0 : Math.max(0, Math.min(fadeIn, fadeOut));

  let plate = null;
  const plateSpec = scene.plate;
  if (plateSpec && plateImage && Array.isArray(plateSpec.corners) && plateSpec.corners.length >= 2 && plateSpec.corners.length <= 4) {
    const corners = interpolatePlateCorners(plateSpec.corners, frame);
    const srcW = 800;
    const srcH = Math.round((plateImage.height / plateImage.width) * srcW);
    const matrix = corners ? plateMatrix3d(srcW, srcH, corners, boxW, boxH) : null;
    if (matrix) {
      const blur = Math.max(0, plateSpec.blur || 0);
      const glow = Math.max(0, Math.min(0.4, plateSpec.glow || 0));
      const reflection = Math.max(0.04, Math.min(0.08, plateSpec.reflection == null ? 0.06 : plateSpec.reflection));
      plate = (
        <div style={{ position: 'absolute', left: 0, top: 0, width: boxW, height: boxH, pointerEvents: 'none' }}>
          {glow > 0 ? (
            <div style={{ position: 'absolute', left: 0, top: 0, width: srcW, height: srcH, transform: matrix, transformOrigin: '0 0', background: withAlpha('#BFD7FF', glow), filter: 'blur(26px)' }} />
          ) : null}
          <div style={{ position: 'absolute', left: 0, top: 0, width: srcW, height: srcH, transform: matrix, transformOrigin: '0 0', overflow: 'hidden', filter: blur > 0 ? 'blur(' + blur + 'px)' : 'none' }}>
            <Img src={plateImage.url} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(115deg, rgba(255,255,255,' + reflection + ') 0%, rgba(255,255,255,0) 42%)' }} />
          </div>
        </div>
      );
    }
  }

  return (
    <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: boxW, height: boxH, overflow: 'hidden', background: '#000' }}>
        <OffthreadVideo
          src={clip.url}
          startFrom={startFrom}
          playbackRate={rate}
          muted={stripped}
          volume={clipVolume}
          style={{ width: '100%', height: '100%', display: 'block' }}
        />
        {plate}
      </div>
      <Overlay spec={scene.overlay} theme={theme} preset={preset} frame={frame} sceneDuration={scene.duration} width={width} height={height} />
    </AbsoluteFill>
  );
};
`;
