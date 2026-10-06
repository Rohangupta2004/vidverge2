/**
 * Short Video Enhancer — the composition.
 *
 * The compositing stack, bottom to top:
 *   background plate -> transition flourish -> BACKGROUND MG -> SUBJECT cutout
 *   -> FOREGROUND MG -> captions -> HOOK. The subject cutout is the same clip
 * masked to the segmented presenter, which is what lets a graphic sit behind
 * them; the hook sits above everything for the opening 1-3 seconds.
 *
 * ONE composition, used TWICE and never diverging:
 *   - lib/player.ts mounts this text in a real Remotion <Player /> inside the
 *     editor, at compositionWidth 1080 x compositionHeight 1920.
 *   - lib/render.ts sends the identical text to the platform render service.
 *
 * GEOMETRY. The platform render service is pinned to a 1920x1080 / 30fps
 * canvas (proved empirically — a 1080x1920 submit is refused; see the
 * veh-geometry-probe verdict). So the composition always lays its layers out on
 * a NATIVE 1080x1920 design stage and scales that whole stage uniformly to fit
 * whatever canvas it is handed. At 1080x1920 the scale is 1 and the stage fills
 * the frame; at 1920x1080 the scale is 0.5625 and the stage sits centred as a
 * 607.5x1080 column, which the portrait re-encode then cover-crops into a true
 * 1080x1920 master. Because the layout maths is identical either way, the
 * preview frame and the rendered frame are the same picture — nothing is ever
 * stretched and the output is never horizontal.
 */

import { SVE_LAYER_SOURCE } from './layerSource';
import { SVE_MOTION_SOURCE } from './motionSource';

const HEADER = `
import React from 'react';
import { AbsoluteFill, Audio, OffthreadVideo, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
`;

const ROOT = `
export default function Composition(inputProps) {
  const p = inputProps || {};
  const frame = useCurrentFrame();
  const cfg = useVideoConfig();
  const fps = cfg.fps || 30;
  const t = frame / fps;

  const cw = num(p.canvasW, DESIGN_W);
  const ch = num(p.canvasH, DESIGN_H);
  // Uniform fit — never a non-uniform scale, so nothing is ever distorted.
  const stageScale = Math.min((cfg.width || cw) / cw, (cfg.height || ch) / ch);
  const bg = p.background || '#05070C';
  const accent = p.accent || '#FBBF24';

  const clips = Array.isArray(p.clips) ? p.clips : [];
  const transitions = Array.isArray(p.transitions) ? p.transitions : [];
  const captions = Array.isArray(p.captions) ? p.captions : [];
  const graphicsBg = Array.isArray(p.graphicsBg) ? p.graphicsBg : [];
  const graphicsFg = Array.isArray(p.graphicsFg) ? p.graphicsFg : [];
  const audio = Array.isArray(p.audio) ? p.audio : [];
  const liveCaptions = captions.filter(function (c) { return t >= num(c.start, 0) - 0.001 && t <= num(c.end, 0) + 0.001; });

  return (
    <AbsoluteFill style={{ background: bg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <style>{FONT_CSS}</style>

      {/* AUDIO — voice, music and the SFX track, no pixels of their own.
          A clip with a fade gets a volume CURVE rather than a flat level, so a
          whoosh or a riser lands without a click at either end. */}
      {audio.map(function (a, i) {
        if (!a || !a.url) return null;
        const level = clamp01(num(a.volume, 1));
        const fadeIn = Math.max(0, num(a.fadeIn, 0)) * fps;
        const fadeOut = Math.max(0, num(a.fadeOut, 0)) * fps;
        const clipFrames = num(a.duration, 0) > 0 ? Math.max(1, Math.round(num(a.duration, 0) * fps)) : 0;
        const volume = (fadeIn > 0 || (fadeOut > 0 && clipFrames > 0))
          ? function (f) {
              let v = level;
              if (fadeIn > 0) v = v * clamp01(f / fadeIn);
              if (fadeOut > 0 && clipFrames > 0) v = v * clamp01((clipFrames - f) / fadeOut);
              return v;
            }
          : level;
        return (
          <Sequence
            key={'aud-' + i}
            from={Math.max(0, Math.round(num(a.at, 0) * fps))}
            durationInFrames={clipFrames > 0 ? clipFrames : undefined}
          >
            <Audio src={a.url} volume={volume} loop={!!a.loop} />
          </Sequence>
        );
      })}

      <div style={{
        position: 'relative',
        width: cw,
        height: ch,
        flexShrink: 0,
        overflow: 'hidden',
        background: bg,
        transform: 'scale(' + stageScale.toFixed(6) + ')',
      }}>
        {/* VIDEO — clip 1..n */}
        {clips.map(function (c, i) {
          if (!c || !c.src) return null;
          return (
            <Sequence key={'clip-' + i} from={Math.max(0, num(c.from, 0))} durationInFrames={Math.max(1, num(c.frames, 1))}>
              <ClipLayer clip={c} />
            </Sequence>
          );
        })}

        {/* TRANSITIONS — flourishes that live only inside the overlap window */}
        {transitions.map(function (tr, i) {
          if (!tr) return null;
          return (
            <Sequence key={'tr-' + i} from={Math.max(0, num(tr.from, 0))} durationInFrames={Math.max(1, num(tr.frames, 1))}>
              <TransitionFX tr={tr} accent={accent} />
            </Sequence>
          );
        })}

        {/* BACKGROUND MOTION GRAPHICS — behind the presenter */}
        {graphicsBg.map(function (g, i) {
          return <GraphicView key={'gb-' + i} g={g} t={t} frame={frame} fps={fps} clips={clips} cw={cw} ch={ch} />;
        })}

        {/* SUBJECT — the segmented presenter, re-drawn above the background band
            so the layers below it genuinely read as BEHIND them. Only mounted
            for clips with depth compositing on, and always silent. */}
        {clips.map(function (c, i) {
          if (!c || !c.src || !c.depth) return null;
          return (
            <Sequence key={'subj-' + i} from={Math.max(0, num(c.from, 0))} durationInFrames={Math.max(1, num(c.frames, 1))}>
              <SubjectLayer clip={c} cw={cw} ch={ch} accent={accent} />
            </Sequence>
          );
        })}

        {/* FOREGROUND MOTION GRAPHICS — in front of the presenter */}
        {graphicsFg.map(function (g, i) {
          return <GraphicView key={'gf-' + i} g={g} t={t} frame={frame} fps={fps} clips={clips} cw={cw} ch={ch} />;
        })}

        {/* CAPTIONS — mixed styles per word */}
        {liveCaptions.map(function (c, i) { return <CaptionCueView key={'cap-' + i} cue={c} t={t} canvasW={cw} />; })}

        {/* HOOK — the opening 1-3 seconds, above every other layer */}
        <HookLayer hook={p.hook || null} t={t} cw={cw} ch={ch} safeMargin={num(p.safeMargin, 90)} />
      </div>
    </AbsoluteFill>
  );
}
`;

/** The exact TSX the preview Player and the render service both run. */
export const SVE_COMPOSITION_TSX = HEADER + SVE_MOTION_SOURCE + SVE_LAYER_SOURCE + ROOT;

/**
 * A cheap stable digest of the composition text. The editor shows it next to
 * the preview so a creator (or a future build) can see at a glance that the
 * preview and the submitted render came from the same engine build.
 */
export function compositionFingerprint(): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < SVE_COMPOSITION_TSX.length; i++) {
    const c = SVE_COMPOSITION_TSX.charCodeAt(i);
    h1 = (h1 ^ c) * 16777619 >>> 0;
    h2 = (h2 + c * (i + 7)) >>> 0;
  }
  return (h1.toString(16) + h2.toString(16)).slice(0, 12);
}
