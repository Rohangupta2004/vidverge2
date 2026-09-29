/**
 * LightBeamLoader — the indeterminate loader.
 *
 * A 2px track that does not move. A beam enters from the left, crosses, and
 * exits right on a 1.6s loop: 4px white-hot leading edge, gold body, 20px
 * fading amber tail. No spinner, ever.
 */
import type { CSSProperties } from 'react';
import { colors, beamVariants } from '../tokens/colors';
import type { BeamVariant } from '../tokens/colors';
import { beamMetrics } from '../tokens/spacing';
import { radii } from '../tokens/radii';
import { microLabel } from '../tokens/typography';
import { beamGradient, beamGlow } from '../animations/beamKeyframes';
import { useBeamStyles, useRiveSlot } from '../animations/useBeamAnimation';

export interface LightBeamLoaderProps {
  /** Optional .riv file (future). When present, Rive replaces the CSS layer. */
  riveSrc?: string;
  state?: 'idle' | 'processing' | 'complete' | 'error';
  /** 0–100. Ignored here — use LightBeamProgress for determinate work. */
  progress?: number;
  label?: string;
  variant?: BeamVariant;
  height?: number;
  className?: string;
  style?: CSSProperties;
}

export default function LightBeamLoader({
  riveSrc, state = 'processing', label, variant = 'info',
  height = beamMetrics.trackHeight, className, style,
}: LightBeamLoaderProps) {
  useBeamStyles();
  const rive = useRiveSlot(riveSrc);
  const v = state === 'error' ? beamVariants.error : state === 'complete' ? beamVariants.success : beamVariants[variant];
  const travelling = state === 'processing';

  return (
    <div className={className} style={{ width: '100%', ...style }}>
      <div
        style={{
          position: 'relative', width: '100%', height, overflow: 'hidden',
          background: colors.bgSurface, borderRadius: radii.pill,
        }}
      >
        {rive.active ? (
          <rive.Rive src={riveSrc} style={{ width: '100%', height: '100%' }} />
        ) : travelling ? (
          <div
            data-lb-anim='loader'
            style={{
              position: 'absolute', inset: 0,
              background: beamGradient({ core: v.core, body: v.body, trail: v.trail }),
              boxShadow: beamGlow(v.body, 8),
              animation: 'lb-beamTravel 1.6s ease-in-out infinite',
              willChange: 'transform, opacity',
            }}
          />
        ) : (
          <div
            data-lb-anim='loader-rest'
            style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(90deg, transparent, ' + (state === 'idle' ? colors.beamDim : v.trail) + ', transparent)',
              opacity: state === 'idle' ? 0.5 : 1,
            }}
          />
        )}
      </div>
      {label ? (
        <div style={{ ...microLabel, color: state === 'error' ? colors.error : colors.textSecondary, marginTop: 8 }}>
          {label}
        </div>
      ) : null}
    </div>
  );
}
