/**
 * LightBeamProgress — determinate progress.
 *
 * The same 2px track as the loader, but the beam does not loop: its white-hot
 * leading edge sits exactly at `progress`, with the travelled distance behind
 * it left as a dim amber trail.
 *
 * Both moving layers are driven by `transform` alone (a translated runner and
 * a scaled trail), so the bar never triggers layout while it advances.
 */
import type { CSSProperties } from 'react';
import { colors, beamVariants } from '../tokens/colors';
import type { BeamVariant } from '../tokens/colors';
import { beamMetrics } from '../tokens/spacing';
import { radii } from '../tokens/radii';
import { microLabel, typography } from '../tokens/typography';
import { beamGradient, beamGlow } from '../animations/beamKeyframes';
import { useBeamStyles, useRiveSlot } from '../animations/useBeamAnimation';

export interface LightBeamProgressProps {
  riveSrc?: string;
  state?: 'idle' | 'processing' | 'complete' | 'error';
  /** 0–100. */
  progress?: number;
  label?: string;
  variant?: BeamVariant;
  height?: number;
  /** Show the numeric percentage beside the label. */
  showValue?: boolean;
  className?: string;
  style?: CSSProperties;
}

export default function LightBeamProgress({
  riveSrc, state = 'processing', progress = 0, label, variant = 'info',
  height = beamMetrics.trackHeight, showValue = true, className, style,
}: LightBeamProgressProps) {
  useBeamStyles();
  const rive = useRiveSlot(riveSrc);
  const pct = Math.max(0, Math.min(100, Number.isFinite(progress) ? progress : 0));
  const v = state === 'error' ? beamVariants.error : state === 'complete' ? beamVariants.success : beamVariants[variant];

  return (
    <div className={className} style={{ width: '100%', ...style }}>
      {label || showValue ? (
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
          {label ? <span style={{ ...microLabel, color: colors.textSecondary }}>{label}</span> : <span />}
          {showValue ? (
            <span style={{ fontFamily: typography.fontMono, fontSize: typography.xs, color: state === 'error' ? colors.error : colors.beamPrimary, fontVariantNumeric: 'tabular-nums' }}>
              {Math.round(pct)}%
            </span>
          ) : null}
        </div>
      ) : null}

      <div
        role='progressbar'
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{ position: 'relative', width: '100%', height, overflow: 'hidden', background: colors.bgSurface, borderRadius: radii.pill }}
      >
        {rive.active ? (
          <rive.Rive src={riveSrc} style={{ width: '100%', height: '100%' }} />
        ) : (
          <>
            {/* Travelled distance — scaled, never re-laid-out. */}
            <div
              style={{
                position: 'absolute', inset: 0, background: v.trail,
                transform: 'scaleX(' + (pct / 100).toFixed(4) + ')',
                transformOrigin: 'left center',
                transition: 'transform 0.4s ease',
              }}
            />
            {/* The beam: its right edge is the white-hot leading edge, parked
                at exactly `progress` by translating a full-width runner. */}
            <div
              style={{
                position: 'absolute', inset: 0,
                background: beamGradient({ core: v.core, body: v.body, trail: v.trail }),
                boxShadow: beamGlow(v.body, 9),
                transform: 'translateX(calc(-100% + ' + pct.toFixed(3) + '%))',
                transition: 'transform 0.4s ease',
                opacity: pct <= 0 ? 0 : 1,
                willChange: 'transform',
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
