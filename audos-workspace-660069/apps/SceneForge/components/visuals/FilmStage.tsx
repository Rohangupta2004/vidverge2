// FILM STAGE — the browser's preview of the finished composition.
//
// It composites exactly what the render farm will: the scene visual filling
// the frame, the HeyGen narrator as a picture-in-picture in the corner the
// spec asked for, a frosted caption bar, and a 0.3s crossfade between scenes.
// The narration video is the CLOCK whenever one exists, so what the customer
// hears and what they see are driven by the same timeline the render uses.
//
// KEEP IN SYNC with remotion/sceneForgeSource.ts — geometry, timings and the
// crossfade length are duplicated there because the render farm compiles a
// standalone composition and cannot import this file.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { activeSpecAt, progressWithin, totalDurationSec, type SceneSpec } from '../../lib/sceneSpec';
import { DIRECTOR_THEME, clamp01 } from './visualTheme';
import VisualRouter from './VisualRouter';

export const FRAME_W = 1920;
export const FRAME_H = 1080;
/** Crossfade between scenes, in seconds. Mirrored in the Remotion source. */
export const CROSSFADE_SEC = 0.3;
/** The narrator inset is a quarter of the frame wide. */
export const PIP_WIDTH = Math.round(FRAME_W * 0.25);
const PIP_MARGIN = 68;

export function pipStyle(placement: SceneSpec['avatar'], blend: number): CSSProperties {
  if (placement === 'full') {
    return { position: 'absolute', left: 0, top: 0, width: FRAME_W, height: FRAME_H, borderRadius: 0, opacity: 1, overflow: 'hidden' };
  }
  if (placement === 'hidden') {
    return { position: 'absolute', left: PIP_MARGIN, top: FRAME_H - PIP_MARGIN - PIP_WIDTH, width: PIP_WIDTH, height: PIP_WIDTH, borderRadius: '50%', opacity: 0, overflow: 'hidden' };
  }
  const left = placement === 'small_left' ? PIP_MARGIN : FRAME_W - PIP_MARGIN - PIP_WIDTH;
  return {
    position: 'absolute',
    left,
    top: FRAME_H - PIP_MARGIN - PIP_WIDTH,
    width: PIP_WIDTH,
    height: PIP_WIDTH,
    borderRadius: '50%',
    overflow: 'hidden',
    opacity: clamp01(blend),
    border: '5px solid rgba(255,255,255,0.14)',
    boxShadow: '0 28px 80px rgba(0,0,0,0.6)',
  };
}

export interface FilmStageProps {
  specs: SceneSpec[];
  avatarVideoUrl?: string;
  accent?: string;
  playing?: boolean;
  /** Bump this number to force a seek to `seekSec`. */
  seekToken?: number;
  seekSec?: number;
  muted?: boolean;
  onTime?: (seconds: number) => void;
  onEnded?: () => void;
}

export default function FilmStage({ specs, avatarVideoUrl, accent = DIRECTOR_THEME.accent, playing = false, seekToken = 0, seekSec = 0, muted = false, onTime, onEnded }: FilmStageProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef(0);
  const clockRef = useRef(0);
  const lastTickRef = useRef(0);
  const [time, setTime] = useState(0);
  const [scale, setScale] = useState(0.5);

  const duration = Math.max(0.1, totalDurationSec(specs));

  // The 1920x1080 canvas is drawn at native size and scaled down, so a
  // position in the preview is the same position in the render — no second
  // layout system to keep in agreement.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => setScale(Math.max(0.05, host.clientWidth / FRAME_W));
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (observer) observer.observe(host);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  const push = useCallback((next: number) => {
    setTime(next);
    onTime?.(next);
  }, [onTime]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) { try { video.currentTime = seekSec; } catch { /* not seekable yet */ } }
    clockRef.current = seekSec;
    push(seekSec);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekToken]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      if (playing) void video.play().catch(() => { /* autoplay refused — the scrubber still works */ });
      else video.pause();
    }
    if (!playing) {
      cancelAnimationFrame(rafRef.current);
      return;
    }
    lastTickRef.current = performance.now();
    const tick = () => {
      const now = performance.now();
      const delta = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;
      const current = videoRef.current;
      // With narration present the video IS the clock: picture and sound can
      // never drift apart, which is the whole point of the preview.
      const next = current && !current.paused ? current.currentTime : clockRef.current + delta;
      clockRef.current = next;
      if (next >= duration) {
        push(duration);
        onEnded?.();
        return;
      }
      push(next);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, duration]);

  const spec = activeSpecAt(specs, time);
  const progress = spec ? progressWithin(spec, time) : 0;
  const sceneIn = spec ? clamp01((time - spec.startSec) / CROSSFADE_SEC) : 1;
  const sceneOut = spec ? clamp01((spec.startSec + spec.durationSec - time) / CROSSFADE_SEC) : 1;
  const sceneAlpha = Math.min(sceneIn, sceneOut);
  const placement = spec?.avatar || 'small_right';

  return (
    <div ref={hostRef} style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', background: DIRECTOR_THEME.bg, borderRadius: 16, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: FRAME_W, height: FRAME_H, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        {/* Backdrop: a single soft accent bloom so the dark frame is not flat. */}
        <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(1400px 760px at 50% -12%, ${accent}1f, transparent 62%), ${DIRECTOR_THEME.bg}` }} />

        {spec && placement !== 'full' ? (
          <div key={spec.scene} style={{ position: 'absolute', inset: 0, opacity: sceneAlpha }}>
            <VisualRouter spec={spec} progress={progress} accent={accent} />
          </div>
        ) : null}

        {avatarVideoUrl ? (
          <div style={pipStyle(placement, sceneAlpha)}>
            <video
              ref={videoRef}
              src={avatarVideoUrl}
              muted={muted}
              playsInline
              preload="auto"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>
        ) : null}

        {spec?.caption ? (
          <div
            style={{
              position: 'absolute',
              left: 150,
              right: 150,
              bottom: 54,
              padding: '22px 40px',
              borderRadius: 22,
              background: 'rgba(18,18,18,0.6)',
              border: '1.5px solid rgba(255,255,255,0.12)',
              backdropFilter: 'blur(18px)',
              color: '#fff',
              fontFamily: DIRECTOR_THEME.font,
              fontSize: 38,
              fontWeight: 600,
              lineHeight: 1.3,
              textAlign: 'center',
              opacity: sceneAlpha,
            }}
          >
            {spec.caption}
          </div>
        ) : null}
      </div>
    </div>
  );
}
