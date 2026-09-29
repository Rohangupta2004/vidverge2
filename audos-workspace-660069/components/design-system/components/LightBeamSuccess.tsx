/**
 * LightBeamSuccess — the arrival.
 *
 * Four beams travel in from the left together, converge on a single bright
 * point at the centre, the point blooms, and a gold checkmark is revealed
 * inside it. One second, start to finish.
 */
import type { CSSProperties } from 'react';
import { colors } from '../tokens/colors';
import { typography } from '../tokens/typography';
import { beamGradient, beamGlow } from '../animations/beamKeyframes';
import { useBeamStyles, useRiveSlot } from '../animations/useBeamAnimation';

export interface LightBeamSuccessProps {
  riveSrc?: string;
  label?: string;
  /** Diameter of the arrival point. */
  size?: number;
  /** Restart the sequence by changing this. */
  runKey?: string | number;
  className?: string;
  style?: CSSProperties;
}

const BEAM_ROWS = [0, 60, 120, 180];

export default function LightBeamSuccess({ riveSrc, label, size = 44, runKey, className, style }: LightBeamSuccessProps) {
  useBeamStyles();
  const rive = useRiveSlot(riveSrc);

  if (rive.active) {
    return <rive.Rive src={riveSrc} style={{ width: '100%', height: size * 2, ...style }} />;
  }

  return (
    <div
      key={'success-' + String(runKey ?? '')}
      className={className}
      style={{ position: 'relative', width: '100%', minHeight: size * 2, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, ...style }}
    >
      <div style={{ position: 'relative', width: '100%', height: size * 1.6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {/* Converging beams */}
        <div aria-hidden='true' style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8, overflow: 'hidden' }}>
          {BEAM_ROWS.map((delay) => (
            <div key={delay} style={{ position: 'relative', height: 1, width: '100%' }}>
              <div
                data-lb-anim='success-beam'
                style={{
                  position: 'absolute', inset: 0,
                  background: beamGradient({ bodyWidth: 72, trailWidth: 28 }),
                  transformOrigin: 'center',
                  animation: 'lb-beamConverge 620ms ease-in ' + delay + 'ms 1 both',
                  willChange: 'transform, opacity',
                }}
              />
            </div>
          ))}
        </div>

        {/* The point the light arrives at */}
        <div
          data-lb-anim='success-point'
          style={{
            position: 'relative', width: size, height: size, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'radial-gradient(circle, ' + colors.beamCore + ' 0%, ' + colors.beamPrimary + ' 42%, ' + colors.beamGlow + ' 70%, transparent 74%)',
            boxShadow: beamGlow(colors.beamPrimary, 22),
            animation: 'lb-pointBloom 420ms cubic-bezier(0.2, 0.8, 0.2, 1) 560ms 1 both',
            willChange: 'transform, opacity',
          }}
        >
          <svg width={size * 0.5} height={size * 0.5} viewBox='0 0 24 24' fill='none' aria-hidden='true' data-lb-anim='success-check' style={{ animation: 'lb-arrive 220ms ease-out 820ms 1 both' }}>
            <path d='M4 12.5 L9.5 18 L20 6.5' stroke='#1a1205' strokeWidth={2.6} strokeLinecap='round' strokeLinejoin='round' />
          </svg>
        </div>
      </div>

      {label ? (
        <div
          data-lb-anim='success-label'
          style={{ fontFamily: typography.fontSans, fontSize: typography.base, fontWeight: typography.semibold, letterSpacing: typography.tight, color: colors.textPrimary, animation: 'lb-arrive 260ms ease-out 900ms 1 both' }}
        >
          {label}
        </div>
      ) : null}
    </div>
  );
}
