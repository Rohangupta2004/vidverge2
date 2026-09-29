/**
 * LightBeamComplete — the finished artefact.
 *
 * Beams arrive from all four directions, converge on one point, the point
 * blooms into a glow, and only then does the completed content appear. The
 * mirrored directions reuse the same two keyframes through a flipped wrapper
 * (scaleX(-1) / scaleY(-1)) rather than duplicating them.
 */
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { colors } from '../tokens/colors';
import { typography } from '../tokens/typography';
import { beamGradient, beamGlow } from '../animations/beamKeyframes';
import { useBeamStyles, useRiveSlot } from '../animations/useBeamAnimation';

export interface LightBeamCompleteProps {
  riveSrc?: string;
  /** The finished thing: a player, a download row, a result card. */
  children?: ReactNode;
  label?: string;
  /** Restart the arrival by changing this. */
  runKey?: string | number;
  /** Skip the animation and show the content immediately. */
  instant?: boolean;
  className?: string;
  style?: CSSProperties;
}

const CONVERGE_MS = 620;
const BLOOM_MS = 380;

export default function LightBeamComplete({ riveSrc, children, label, runKey, instant, className, style }: LightBeamCompleteProps) {
  useBeamStyles();
  const rive = useRiveSlot(riveSrc);
  const [revealed, setRevealed] = useState(!!instant);

  useEffect(() => {
    if (instant) { setRevealed(true); return; }
    setRevealed(false);
    const t = setTimeout(() => setRevealed(true), CONVERGE_MS + BLOOM_MS - 120);
    return () => clearTimeout(t);
  }, [runKey, instant]);

  const beam = (axis: 'x' | 'y', flip: boolean, delay: number) => (
    <div
      aria-hidden='true'
      style={{
        position: 'absolute', inset: 0, overflow: 'hidden',
        transform: flip ? (axis === 'x' ? 'scaleX(-1)' : 'scaleY(-1)') : undefined,
      }}
    >
      <div
        data-lb-anim='complete-beam'
        style={{
          position: 'absolute',
          left: axis === 'x' ? 0 : '50%', right: axis === 'x' ? 0 : 'auto',
          top: axis === 'y' ? 0 : '50%', bottom: axis === 'y' ? 0 : 'auto',
          width: axis === 'x' ? '100%' : 1,
          height: axis === 'y' ? '100%' : 1,
          background: beamGradient({ bodyWidth: 80, trailWidth: 30, angle: axis === 'x' ? 90 : 180 }),
          transformOrigin: 'center',
          animation: 'lb-beamConverge' + (axis === 'y' ? 'Y' : '') + ' ' + CONVERGE_MS + 'ms ease-in ' + delay + 'ms 1 both',
          willChange: 'transform, opacity',
        }}
      />
    </div>
  );

  if (rive.active) {
    return (
      <div className={className} style={style}>
        <rive.Rive src={riveSrc} style={{ width: '100%', height: 120 }} />
        {children}
      </div>
    );
  }

  return (
    <div className={className} style={{ position: 'relative', width: '100%', ...style }}>
      {!revealed ? (
        <div key={'converge-' + String(runKey ?? '')} style={{ position: 'relative', width: '100%', minHeight: 132, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {beam('x', false, 0)}
          {beam('x', true, 70)}
          {beam('y', false, 140)}
          {beam('y', true, 210)}
          <div
            data-lb-anim='complete-point'
            style={{
              width: 40, height: 40, borderRadius: '50%',
              background: 'radial-gradient(circle, ' + colors.beamCore + ' 0%, ' + colors.beamPrimary + ' 45%, ' + colors.beamGlow + ' 72%, transparent 76%)',
              boxShadow: beamGlow(colors.beamPrimary, 26),
              animation: 'lb-pointBloom ' + BLOOM_MS + 'ms cubic-bezier(0.2, 0.8, 0.2, 1) ' + CONVERGE_MS + 'ms 1 both',
              willChange: 'transform, opacity',
            }}
          />
        </div>
      ) : (
        <div key={'revealed-' + String(runKey ?? '')} data-lb-anim='complete-content' style={{ animation: instant ? undefined : 'lb-arrive 300ms ease-out 1 both' }}>
          {label ? (
            <div style={{ fontFamily: typography.fontMono, fontSize: typography.xs, letterSpacing: typography.wider, textTransform: 'uppercase', color: colors.beamPrimary, marginBottom: 12 }}>
              {label}
            </div>
          ) : null}
          {children}
        </div>
      )}
    </div>
  );
}
