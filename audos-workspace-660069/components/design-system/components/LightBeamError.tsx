/**
 * LightBeamError — the failure.
 *
 * One beam sets off left to right, flickers at ~80% of the way across, dims,
 * and never arrives. The track shakes 2px horizontally. The beam core carries
 * a red tint. 0.8s.
 */
import type { CSSProperties, ReactNode } from 'react';
import { colors, beamVariants, tint } from '../tokens/colors';
import { typography } from '../tokens/typography';
import { beamGradient, beamGlow } from '../animations/beamKeyframes';
import { useBeamStyles, useRiveSlot } from '../animations/useBeamAnimation';

export interface LightBeamErrorProps {
  riveSrc?: string;
  message?: ReactNode;
  /** Restart the sequence by changing this. */
  runKey?: string | number;
  className?: string;
  style?: CSSProperties;
}

export default function LightBeamError({ riveSrc, message, runKey, className, style }: LightBeamErrorProps) {
  useBeamStyles();
  const rive = useRiveSlot(riveSrc);
  const v = beamVariants.error;

  return (
    <div key={'error-' + String(runKey ?? '')} className={className} style={{ width: '100%', ...style }}>
      {rive.active ? (
        <rive.Rive src={riveSrc} style={{ width: '100%', height: 24 }} />
      ) : (
        <div
          data-lb-anim='error-track'
          style={{
            position: 'relative', width: '100%', height: 2, overflow: 'hidden',
            background: colors.bgSurface, borderRadius: 999,
            animation: 'lb-shakeX 120ms ease-in-out 3 both',
            willChange: 'transform',
          }}
        >
          <div
            data-lb-anim='error-beam'
            style={{
              position: 'absolute', inset: 0,
              background: beamGradient({ core: v.core, body: v.body, trail: v.trail }),
              boxShadow: beamGlow(v.body, 10),
              animation: 'lb-beamFalter 800ms ease-out 1 both',
              willChange: 'transform, opacity',
            }}
          />
        </div>
      )}
      {message ? (
        <div
          style={{
            marginTop: 10, padding: '9px 12px', borderRadius: 9,
            background: tint(colors.error, 8), border: '1px solid ' + tint(colors.error, 34),
            color: colors.error, fontFamily: typography.fontSans, fontSize: typography.sm, lineHeight: 1.5,
          }}
        >
          {message}
        </div>
      ) : null}
    </div>
  );
}
