/**
 * LightBeamPlayhead — the timeline playhead.
 *
 * A 1px white-hot vertical line with a small gold triangular handle above the
 * track, dragging a 40px horizontal trail that fades out behind it. The
 * playhead is positioned by translating a full-width runner, so scrubbing
 * never triggers layout.
 *
 * It is pointer-transparent unless `onSeek` is supplied, so dropping it over
 * an existing timeline cannot steal that timeline's own drag handlers.
 */
import type { CSSProperties } from 'react';
import { colors, tint } from '../tokens/colors';
import { beamGlow } from '../animations/beamKeyframes';
import { useBeamStyles, useRiveSlot } from '../animations/useBeamAnimation';

export interface LightBeamPlayheadProps {
  riveSrc?: string;
  /** Position along the track, 0–1. */
  progress: number;
  /** Length of the fading trail behind the head. */
  trailWidth?: number;
  /** Show the triangular grab handle above the track. */
  handle?: boolean;
  /** Wire up click-to-seek. Omit to stay pointer-transparent. */
  onSeek?: (fraction: number) => void;
  className?: string;
  style?: CSSProperties;
}

export default function LightBeamPlayhead({
  riveSrc, progress, trailWidth = 40, handle = true, onSeek, className, style,
}: LightBeamPlayheadProps) {
  useBeamStyles();
  const rive = useRiveSlot(riveSrc);
  const pct = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0)) * 100;

  if (rive.active) {
    return <rive.Rive src={riveSrc} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', ...style }} />;
  }

  return (
    <div
      className={className}
      onPointerDown={onSeek ? (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        if (r.width > 0) onSeek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
      } : undefined}
      style={{
        position: 'absolute', inset: 0, overflow: 'visible',
        pointerEvents: onSeek ? 'auto' : 'none',
        ...style,
      }}
    >
      <div
        style={{
          position: 'absolute', inset: 0,
          transform: 'translateX(calc(-100% + ' + pct.toFixed(3) + '%))',
          willChange: 'transform',
        }}
      >
        {/* Trail: brightest at the head, fading out behind it. */}
        <div
          aria-hidden='true'
          style={{
            position: 'absolute', right: 0, top: 0, bottom: 0, width: trailWidth,
            background: 'linear-gradient(90deg, transparent, ' + colors.beamTrail + ' 60%, ' + tint(colors.beamPrimary, 18) + ')',
            pointerEvents: 'none',
          }}
        />
        {/* The head. */}
        <div
          aria-hidden='true'
          style={{
            position: 'absolute', right: 0, top: 0, bottom: 0, width: 1,
            background: colors.beamCore,
            boxShadow: beamGlow(colors.beamPrimary, 7),
            pointerEvents: 'none',
          }}
        />
        {handle ? (
          <div
            aria-hidden='true'
            style={{
              position: 'absolute', right: -5, top: -7, width: 0, height: 0,
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              borderTop: '7px solid ' + colors.beamPrimary,
              filter: 'drop-shadow(0 0 4px ' + colors.beamGlow + ')',
              pointerEvents: 'none',
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

/** Border treatment for a selected clip on a LightBeam timeline. */
export const selectedClipStyle: CSSProperties = {
  border: '1px solid ' + colors.beamPrimary,
  boxShadow: '0 0 0 1px ' + colors.beamGlow,
};

/** Border treatment for an unselected clip. */
export const clipStyle: CSSProperties = {
  border: '1px solid ' + colors.borderSubtle,
  background: colors.bgGlass,
};
