/**
 * FACELESS — render adapter.
 *
 * The renderer is the one piece of shared platform infrastructure a Faceless
 * film is allowed to reuse, so it is reached through an interface rather than
 * called directly. Faceless always uses HyperFramesAdapter.
 *
 * WHAT "HYPERFRAMES" MEANS ON THIS PLATFORM, stated plainly so the next
 * engineer does not go looking for a service that is not there: HyperFrames is
 * the workspace's motion-primitive composition contract, and the live service
 * that turns a HyperFrames composition into an MP4 is the platform render
 * service at /api/render/remotion — the same one Track B's HyperFrames product
 * films already go through. There is no separate HyperFrames HTTP endpoint in
 * the platform integration catalog. The adapter boundary is what makes that
 * swappable: point HYPERFRAMES_SUBMIT_PATH at a dedicated service the day one
 * exists and nothing upstream of this file changes.
 *
 * Not touched by this file, deliberately:
 *   - The HeyGen avatar cloud API. Completely separate system.
 *   - RemotionAdapter, the Avatar / ProductLaunch path. Unchanged.
 *
 * The composition this adapter emits is NEW. It shares no source with Track B's
 * primitive library; it is written against the Faceless MotionPlan and nothing
 * else.
 */

import {
  FacelessError,
  type FrameRef,
  type MotionPlan,
  type MotionShot,
  type ResolvedAsset,
  type TransitionType,
} from '../types/editorial';
import { poll, PollTimeoutError } from '../../../lib/poll';
import { callHook } from './platform';

/**
 * The platform render service is pinned to this geometry and rejects others.
 *
 * PORTRAIT FILMS. Because the Remotion frame cannot change, a 9:16 film is laid
 * out on its own 1080×1920 design canvas and the composition scales that canvas
 * into this fixed review frame, pillarboxed. Once that render completes, the
 * adapter asks the portrait export function to centre-crop the review file into
 * a genuine 1080×1920 MP4. Every composition size remains relative to the
 * design canvas, and a landscape film — whose canvas IS the frame — never takes
 * the crop path.
 */
export const RENDER_GEOMETRY = { width: 1920, height: 1080, fps: 30 } as const;

export interface RenderAdapter {
  readonly id: string;
  render(
    motionPlan: MotionPlan,
    assets: ResolvedAsset[],
    narrationUrl: string,
    onProgress?: (note: string) => void,
    onNotice?: (message: string, tone?: 'info' | 'warn') => void,
  ): Promise<{ mp4Url: string; frames: FrameRef[] }>;
}

// ---------------------------------------------------------------------------
// Props handed to the composition
// ---------------------------------------------------------------------------

interface ShotProps {
  beatId: string;
  startFrame: number;
  durationFrames: number;
  assetUrl: string;
  assetType: 'video' | 'image' | 'graphic';
  playback: string;
  sourceStartFrame: number;
  sourceFrames: number;
  startScale: number;
  endScale: number;
  originX: number;
  originY: number;
  easing: string;
  transitionIn: TransitionType;
  transitionFrames: number;
  textTreatment: string | null;
  textContent: string;
  textStartFrame: number;
  textEndFrame: number;
  emphasisWords: string[];
  musicEnergy: number;
  label: string;
}

/**
 * A beat's entrance is decided by the PREVIOUS beat's transition, which is
 * where the editorial plan puts it. The composition needs it on the incoming
 * shot, so the mapping happens here rather than polluting the MotionPlan type.
 */
function transitionInFor(shots: MotionShot[], index: number): { type: TransitionType; frames: number } {
  if (index === 0) return { type: 'cut', frames: 0 };
  const previous = shots[index - 1];
  const outgoing = previous.transitionOut;
  if (!outgoing) return { type: 'cut', frames: 0 };
  return { type: outgoing.type, frames: Math.max(0, Math.round(outgoing.durationFrames)) };
}

function toShotProps(plan: MotionPlan, shot: MotionShot, index: number): ShotProps {
  const incoming = transitionInFor(plan.shots, index);
  const sourceFrames = Math.max(1, Math.round((shot.endFrame - shot.startFrame)));
  return {
    beatId: shot.beatId,
    startFrame: Math.max(0, Math.round(shot.startFrame)),
    durationFrames: Math.max(1, Math.round(shot.durationFrames)),
    assetUrl: shot.assetUrl || '',
    assetType: shot.assetType,
    playback: shot.playback,
    sourceStartFrame: Math.max(0, Math.round(shot.sourceStartSeconds * plan.fps)),
    sourceFrames,
    startScale: shot.camera.startScale,
    endScale: shot.camera.endScale,
    originX: shot.camera.originX,
    originY: shot.camera.originY,
    easing: shot.camera.easing,
    transitionIn: incoming.type,
    transitionFrames: incoming.frames,
    textTreatment: shot.text ? shot.text.treatment : null,
    textContent: shot.text ? shot.text.content : '',
    textStartFrame: shot.text ? Math.max(0, Math.round(shot.text.startFrame - shot.startFrame)) : 0,
    textEndFrame: shot.text ? Math.max(1, Math.round(shot.text.endFrame - shot.startFrame)) : 0,
    emphasisWords: shot.text ? shot.text.emphasisWords.slice(0, 6) : [],
    musicEnergy: shot.musicEnergy,
    label: shot.visualType,
  };
}

export function buildCompositionProps(
  plan: MotionPlan,
  narrationUrl: string,
): Record<string, unknown> {
  return {
    shots: plan.shots.map((shot, index) => toShotProps(plan, shot, index)),
    narrationUrl,
    canvasWidth: plan.canvas?.width || RENDER_GEOMETRY.width,
    canvasHeight: plan.canvas?.height || RENDER_GEOMETRY.height,
    musicVolume: typeof plan.musicVolume === 'number' ? plan.musicVolume : 0.3,
    musicUrl: plan.music?.url || '',
    sfx: plan.sfx.map((cue) => ({ url: cue.url, startFrame: Math.max(0, Math.round(cue.startFrame)) })),
    palette: plan.palette,
    typography: plan.typography,
  };
}

// ---------------------------------------------------------------------------
// The HyperFrames composition
// ---------------------------------------------------------------------------

/**
 * Self-contained by contract: the render service compiles ONE file, so this
 * source may not import from the workspace. It also may not contain a URL, a
 * timer, a browser global, Math.random or Date.now — every pixel has to be a
 * pure function of the frame number, or two renders of the same spec would
 * differ. All media addresses arrive through props.
 *
 * Written with string concatenation rather than template literals because the
 * whole thing lives inside one.
 */
export const FACELESS_COMPOSITION_TSX = `
import React from 'react';
import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, Loop, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

const EASINGS = {
  linear: (t) => t,
  easeOut: (t) => 1 - Math.pow(1 - t, 3),
  easeInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  snap: (t) => 1 - Math.pow(1 - t, 6),
};

function ease(name, t) {
  const fn = EASINGS[name] || EASINGS.easeInOut;
  return fn(clamp01(t));
}

/**
 * Narration must always win. The bed breathes with the beat energy, and the
 * ceiling is whatever the brief's volume slider asked for — at the 0.3
 * default this reproduces the fixed 0.08–0.22 range the film had before the
 * slider existed.
 */
function musicVolumeAt(shots, frame, ceiling) {
  let energy = 0.4;
  for (let i = 0; i < shots.length; i += 1) {
    const s = shots[i];
    if (frame >= s.startFrame && frame < s.startFrame + s.durationFrames) {
      energy = clamp01(s.musicEnergy);
      break;
    }
  }
  return clamp01(num(ceiling, 0.3)) * (0.27 + energy * 0.47);
}

function Scrim({ palette, strength }) {
  return (
    <AbsoluteFill
      style={{
        background:
          'linear-gradient(to top, ' + palette.scrim + ' 0%, rgba(0,0,0,0) 55%), ' +
          'linear-gradient(to bottom, rgba(0,0,0,' + (0.22 * strength) + ') 0%, rgba(0,0,0,0) 38%)',
      }}
    />
  );
}

/** No asset resolved for a beat: a branded motion card, never a black frame. */
function FallbackCard({ palette, typography, label, frame, duration }) {
  const drift = interpolate(frame, [0, duration], [0, 40], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: palette.background, overflow: 'hidden' }}>
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(ellipse 70% 60% at ' + (30 + drift * 0.4) + '% 20%, ' + palette.accent + '33 0%, rgba(0,0,0,0) 62%)',
          transform: 'translateX(' + (-drift * 0.5) + 'px)',
        }}
      />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div
          style={{
            fontFamily: typography.headingFont,
            color: palette.ink,
            opacity: 0.32,
            fontSize: 42,
            letterSpacing: 10,
            textTransform: 'uppercase',
          }}
        >
          {String(label || '')}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function TextLayer({ shot, palette, typography, frame }) {
  const treatment = shot.textTreatment;
  if (!treatment || !shot.textContent) return null;
  const start = num(shot.textStartFrame, 0);
  const end = num(shot.textEndFrame, shot.durationFrames);
  if (frame < start || frame > end) return null;

  const local = frame - start;
  const appear = ease('easeOut', local / 10);
  const leave = clamp01((end - frame) / 8);
  const opacity = Math.min(appear, leave);
  const words = String(shot.textContent).split(/\\s+/).filter(Boolean);
  const emphasis = (shot.emphasisWords || []).map((w) => String(w).toLowerCase().replace(/[^a-z0-9]/g, ''));
  const isEmphasis = (w) => emphasis.indexOf(String(w).toLowerCase().replace(/[^a-z0-9]/g, '')) >= 0;

  const base = {
    fontFamily: typography.headingFont,
    color: palette.ink,
    opacity: opacity,
    textWrap: 'balance',
  };

  if (treatment === 'lower_third') {
    return (
      <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'flex-start', padding: 96 }}>
        <div style={{ display: 'flex', alignItems: 'stretch', transform: 'translateX(' + ((1 - appear) * -60) + 'px)', opacity: opacity }}>
          <div style={{ width: 8, background: palette.accent, borderRadius: 4 }} />
          <div style={{ padding: '14px 26px', background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(10px)' }}>
            <div style={{ fontFamily: typography.headingFont, color: palette.ink, fontSize: 46, fontWeight: 600, letterSpacing: -0.5 }}>
              {shot.textContent}
            </div>
          </div>
        </div>
      </AbsoluteFill>
    );
  }

  if (treatment === 'quote_card') {
    return (
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: 180 }}>
        <div style={Object.assign({}, base, { borderLeft: '6px solid ' + palette.accent, paddingLeft: 40, fontSize: 64, fontStyle: 'italic', lineHeight: 1.22, maxWidth: 1240, transform: 'translateY(' + ((1 - appear) * 26) + 'px)' })}>
          {shot.textContent}
        </div>
      </AbsoluteFill>
    );
  }

  if (treatment === 'number_reveal') {
    const pop = 0.86 + ease('snap', local / 12) * 0.14;
    return (
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={Object.assign({}, base, { fontSize: 240, fontWeight: 800, letterSpacing: -8, color: palette.accent, transform: 'scale(' + pop + ')', textShadow: '0 24px 70px rgba(0,0,0,0.55)' })}>
          {shot.textContent}
        </div>
      </AbsoluteFill>
    );
  }

  if (treatment === 'massive_headline') {
    return (
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: 140 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0 26px', justifyContent: 'center', maxWidth: 1500 }}>
          {words.map((word, i) => {
            const wp = ease('easeOut', (local - i * 2) / 10);
            return (
              <span
                key={i}
                style={Object.assign({}, base, {
                  fontSize: 118,
                  fontWeight: 800,
                  letterSpacing: -3,
                  lineHeight: 1.04,
                  opacity: opacity * wp,
                  transform: 'translateY(' + ((1 - wp) * 34) + 'px)',
                  color: isEmphasis(word) ? palette.accent : palette.ink,
                })}
              >
                {word}
              </span>
            );
          })}
        </div>
      </AbsoluteFill>
    );
  }

  if (treatment === 'highlighted_word') {
    return (
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'flex-end', padding: 150 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 16px', justifyContent: 'center' }}>
          {words.map((word, i) => (
            <span
              key={i}
              style={Object.assign({}, base, {
                fontSize: 76,
                fontWeight: 700,
                padding: isEmphasis(word) ? '4px 18px' : '4px 0',
                borderRadius: 10,
                background: isEmphasis(word) ? palette.accent : 'transparent',
                color: isEmphasis(word) ? palette.background : palette.ink,
              })}
            >
              {word}
            </span>
          ))}
        </div>
      </AbsoluteFill>
    );
  }

  // kinetic_phrase — per-word staggered rise, the default kinetic treatment.
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: 160 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', justifyContent: 'center', maxWidth: 1420, overflow: 'hidden' }}>
        {words.map((word, i) => {
          const wp = ease('easeOut', (local - i * 3) / 12);
          return (
            <span
              key={i}
              style={Object.assign({}, base, {
                fontSize: 92,
                fontWeight: 700,
                letterSpacing: -1.5,
                opacity: opacity * wp,
                transform: 'translateY(' + ((1 - wp) * 52) + 'px)',
                color: isEmphasis(word) ? palette.accent : palette.ink,
              })}
            >
              {word}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

function Media({ shot }) {
  const url = String(shot.assetUrl || '');
  if (!url) return null;
  const fit = { width: '100%', height: '100%', objectFit: 'cover' };
  if (shot.assetType === 'video') {
    const clipFrames = Math.max(1, num(shot.sourceFrames, shot.durationFrames));
    const video = (
      <OffthreadVideo src={url} startFrom={num(shot.sourceStartFrame, 0)} muted style={fit} />
    );
    // A clip shorter than its beat is looped rather than padded with black;
    // the camera push underneath keeps the repeat from reading as a stutter.
    if (shot.playback === 'short_clip_hold' && clipFrames < shot.durationFrames) {
      return <Loop durationInFrames={clipFrames}>{video}</Loop>;
    }
    return video;
  }
  return <Img src={url} style={fit} />;
}

function Shot({ shot, palette, typography }) {
  const frame = useCurrentFrame();
  const duration = Math.max(1, num(shot.durationFrames, 1));

  const progress = ease(shot.easing, frame / duration);
  const scale = num(shot.startScale, 1) + (num(shot.endScale, 1) - num(shot.startScale, 1)) * progress;

  // Parallax stills get a second, slower axis of movement so a generated image
  // never plays as a flat slide.
  const drift = shot.playback === 'parallax_still'
    ? interpolate(frame, [0, duration], [-18, 18], { extrapolateRight: 'clamp' })
    : 0;

  const tFrames = Math.max(0, num(shot.transitionFrames, 0));
  const tProgress = tFrames > 0 ? clamp01(frame / tFrames) : 1;
  const type = shot.transitionIn;

  let opacity = 1;
  let blur = 0;
  let punch = 1;
  if (type === 'dissolve') opacity = ease('easeInOut', tProgress);
  else if (type === 'blur_reveal') { blur = (1 - ease('easeOut', tProgress)) * 22; opacity = ease('easeOut', tProgress); }
  else if (type === 'freeze_punch') punch = 1 + (1 - ease('snap', tProgress)) * 0.1;
  else if (type === 'match_cut') opacity = ease('linear', tFrames > 0 ? frame / Math.max(1, tFrames) : 1);

  const hasText = Boolean(shot.textTreatment && shot.textContent);

  return (
    <AbsoluteFill style={{ background: palette.background, overflow: 'hidden', opacity: opacity }}>
      <AbsoluteFill
        style={{
          transform: 'scale(' + (scale * punch) + ') translateX(' + drift + 'px)',
          transformOrigin: (num(shot.originX, 0.5) * 100) + '% ' + (num(shot.originY, 0.5) * 100) + '%',
          filter: blur > 0.05 ? 'blur(' + blur + 'px)' : 'none',
        }}
      >
        <Media shot={shot} />
        {!shot.assetUrl ? (
          <FallbackCard palette={palette} typography={typography} label={shot.label} frame={frame} duration={duration} />
        ) : null}
      </AbsoluteFill>
      {hasText ? <Scrim palette={palette} strength={1} /> : null}
      <TextLayer shot={shot} palette={palette} typography={typography} frame={frame} />
    </AbsoluteFill>
  );
}

export default function FacelessFilm(props) {
  const { width, height } = useVideoConfig();
  const shots = Array.isArray(props.shots) ? props.shots : [];
  const palette = props.palette || { background: '#07090f', ink: '#f5f7fb', accent: '#f59e0b', scrim: 'rgba(5,7,12,0.72)' };
  const typography = props.typography || { headingFont: 'Inter, system-ui, sans-serif', bodyFont: 'Inter, system-ui, sans-serif' };
  const sfx = Array.isArray(props.sfx) ? props.sfx : [];
  const musicCeiling = num(props.musicVolume, 0.3);

  // The design canvas. For a landscape film it is the frame itself and the
  // scale is exactly 1, so nothing about that path changes.
  const canvasWidth = Math.max(16, num(props.canvasWidth, width));
  const canvasHeight = Math.max(16, num(props.canvasHeight, height));
  const canvasScale = Math.min(width / canvasWidth, height / canvasHeight);

  return (
    <AbsoluteFill style={{ background: palette.background }}>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div
          style={{
            position: 'relative',
            width: canvasWidth,
            height: canvasHeight,
            overflow: 'hidden',
            background: palette.background,
            transform: 'scale(' + canvasScale + ')',
            transformOrigin: 'center center',
          }}
        >
          {shots.map((shot) => (
            <Sequence key={shot.beatId} from={shot.startFrame} durationInFrames={shot.durationFrames}>
              <Shot shot={shot} palette={palette} typography={typography} />
            </Sequence>
          ))}
        </div>
      </AbsoluteFill>

      {props.narrationUrl ? <Audio src={props.narrationUrl} /> : null}

      {props.musicUrl ? (
        <Audio src={props.musicUrl} volume={(f) => musicVolumeAt(shots, f, musicCeiling)} />
      ) : null}

      {sfx.map((cue, i) => (
        <Sequence key={'sfx' + i} from={cue.startFrame}>
          <Audio src={cue.url} volume={0.35} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
`;

// ---------------------------------------------------------------------------
// HyperFramesAdapter
// ---------------------------------------------------------------------------

/** Change this one constant to move Faceless onto a dedicated render service. */
export const HYPERFRAMES_SERVICE = 'platform-render-service';

export class HyperFramesAdapter implements RenderAdapter {
  readonly id = 'hyperframes';

  private pollMs: number;

  private maxWaitMs: number;

  constructor(options: { pollMs?: number; maxWaitMs?: number } = {}) {
    this.pollMs = options.pollMs ?? 6000;
    this.maxWaitMs = options.maxWaitMs ?? 14 * 60 * 1000;
  }

  async render(
    motionPlan: MotionPlan,
    _assets: ResolvedAsset[],
    narrationUrl: string,
    onProgress?: (note: string) => void,
    onNotice?: (message: string, tone?: 'info' | 'warn') => void,
  ): Promise<{ mp4Url: string; frames: FrameRef[] }> {
    if (!motionPlan.shots.length) {
      throw new FacelessError('The motion plan has no shots to render.', 'render', 'empty_plan');
    }

    const submitted = await callHook<{ operationId?: string; status?: string; error?: string }>(
      'faceless-render',
      {
        op: 'submit',
        compositionTsx: FACELESS_COMPOSITION_TSX,
        props: buildCompositionProps(motionPlan, narrationUrl),
        durationInFrames: Math.max(30, Math.round(motionPlan.durationInFrames)),
      },
      'render',
    );

    const operationId = String(submitted.operationId || '');
    if (!operationId) {
      throw new FacelessError(
        'The render service accepted the request but returned no operation id.',
        'render',
        'no_operation',
      );
    }
    onProgress?.('Render queued on the HyperFrames service…');

    type RenderStatus = { status?: string; videoUrl?: string; error?: string; progress?: number };
    let status: RenderStatus;
    try {
      status = await poll(
        () => callHook<RenderStatus>('faceless-render', { op: 'status', operationId }, 'render'),
        {
          interval: this.pollMs,
          timeout: this.maxWaitMs,
          tolerateErrors: 6,
          until: (value) => ['complete', 'completed', 'failed'].includes(String(value.status || '').toLowerCase()),
          onTick: (value) => {
            if (typeof value.progress === 'number') onProgress?.(`Rendering — ${Math.round(value.progress)}%`);
          },
        },
      );
    } catch (error) {
      if (error instanceof FacelessError) throw error;
      throw new FacelessError(
        error instanceof PollTimeoutError
          ? 'The render did not finish inside the adapter\u2019s wait window.'
          : 'The render status endpoint stopped answering.',
        'render',
        error instanceof PollTimeoutError ? 'render_timeout' : 'status_lost',
      );
    }

    const terminalStatus = String(status.status || '').toLowerCase();
    if (terminalStatus === 'failed') {
      throw new FacelessError(
        `The render failed: ${status.error || 'no reason given by the render service'}`,
        'render',
        'render_failed',
      );
    }
    if (!status.videoUrl) {
      throw new FacelessError('The render completed without a video URL.', 'render', 'no_output');
    }

    const reviewUrl = String(status.videoUrl);
    let mp4Url = reviewUrl;
    if (motionPlan.canvas && motionPlan.canvas.height > motionPlan.canvas.width) {
      onProgress?.('Render complete — preparing the 1080×1920 portrait master…');
      try {
        const cropped = await callHook<{ videoUrl?: string }>(
          'faceless-portrait-export',
          { videoUrl: reviewUrl },
          'render',
        );
        if (!cropped.videoUrl) throw new Error('The portrait crop returned no video URL.');
        mp4Url = String(cropped.videoUrl);
      } catch {
        onNotice?.('Portrait export unavailable — using the 1920×1080 review file instead.', 'warn');
      }
    }

    onProgress?.('Render complete — extracting QA frames…');
    const frames = await this.extractFrames(mp4Url, motionPlan);
    return { mp4Url, frames };
  }

  /**
   * One representative frame per beat, taken a third of the way in so the
   * sample lands after any entrance transition has resolved. Frame extraction
   * is best-effort: creative QA can capture its own frames in the browser, and
   * failing the whole render because a thumbnail service blinked would be a
   * worse outcome than reviewing fewer frames.
   */
  private async extractFrames(mp4Url: string, plan: MotionPlan): Promise<FrameRef[]> {
    const sampleBeats = plan.shots.slice(0, 12);
    const stamps = sampleBeats.map((shot) => ({
      beatId: shot.beatId,
      t: Math.max(0.05, (shot.startFrame + shot.durationFrames / 3) / plan.fps),
    }));
    if (!stamps.length) return [];
    try {
      const out = await callHook<{ frames?: { t: number; url: string }[] }>(
        'faceless-render',
        { op: 'frames', videoUrl: mp4Url, timestamps: stamps.map((s) => Math.round(s.t * 100) / 100) },
        'render',
      );
      const frames = Array.isArray(out.frames) ? out.frames : [];
      return frames.map((frame, index) => ({
        t: Number(frame.t),
        url: String(frame.url),
        beatId: stamps[index]?.beatId,
      }));
    } catch {
      return [];
    }
  }
}

/**
 * Faceless always renders through HyperFrames. The factory exists so a test
 * harness can substitute a fake without the pipeline knowing.
 */
export function facelessRenderAdapter(): RenderAdapter {
  return new HyperFramesAdapter();
}
