/**
 * LightBeamProcessing — sustained work.
 *
 * Three to five 1px rows, 8px apart, each carrying a beam left to right,
 * staggered 120ms so the light reads as a stream rather than a pulse. As
 * `progress` rises the whole field funnels toward the destination point on
 * the right, and that point brightens — the light visibly has somewhere to
 * arrive.
 */
import type { CSSProperties } from 'react';
import { colors, beamVariants, tint } from '../tokens/colors';
import type { BeamVariant } from '../tokens/colors';
import { beamMetrics } from '../tokens/spacing';
import { microLabel } from '../tokens/typography';
import { beamGradient, beamGlow } from '../animations/beamKeyframes';
import { staggerDelays, useBeamStyles, useRiveSlot } from '../animations/useBeamAnimation';

export interface LightBeamProcessingProps {
  riveSrc?: string;
  state?: 'idle' | 'processing' | 'complete' | 'error';
  /** 0–100 — drives how tightly the beams funnel toward the right. */
  progress?: number;
  label?: string;
  /** 3–5. */
  rows?: number;
  variant?: BeamVariant;
  /** Show the arrival point on the right. */
  showDestination?: boolean;
  className?: string;
  style?: CSSProperties;
}

export default function LightBeamProcessing({
  riveSrc, state = 'processing', progress, label, rows = 4, variant = 'info',
  showDestination = true, className, style,
}: LightBeamProcessingProps) {
  useBeamStyles();
  const rive = useRiveSlot(riveSrc);
  const count = Math.max(3, Math.min(5, Math.round(rows)));
  const delays = staggerDelays(count, beamMetrics.rowStaggerMs);
  const pct = typeof progress === 'number' && Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0;
  const v = state === 'error' ? beamVariants.error : beamVariants[variant];
  const running = state === 'processing';
  // 1 → 0.42: the field narrows toward the destination as work completes.
  const funnel = (1 - (pct / 100) * 0.58).toFixed(3);

  if (rive.active) {
    return <rive.Rive src={riveSrc} style={{ width: '100%', height: count * 9, ...style }} />;
  }

  return (
    <div className={className} style={{ width: '100%', ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div
          style={{
            position: 'relative', flex: 1, minWidth: 0,
            display: 'flex', flexDirection: 'column', gap: beamMetrics.rowGap,
            transform: 'scaleX(' + funnel + ')',
            transformOrigin: 'right center',
            transition: 'transform 0.6s ease',
          }}
        >
          {delays.map((delay, i) => (
            <div key={i} style={{ position: 'relative', height: 1, width: '100%', background: colors.bgSurface, overflow: 'hidden' }}>
              {running ? (
                <div
                  data-lb-anim='processing-row'
                  style={{
                    position: 'absolute', inset: 0,
                    background: beamGradient({ core: v.core, body: v.body, trail: v.trail, bodyWidth: 48, trailWidth: 18 }),
                    boxShadow: beamGlow(v.body, 6),
                    animation: 'lb-beamTravel 1.6s linear ' + delay + ' infinite',
                    willChange: 'transform, opacity',
                  }}
                />
              ) : null}
            </div>
          ))}
        </div>

        {showDestination ? (
          <span
            aria-hidden='true'
            style={{
              width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
              background: state === 'error' ? colors.error : colors.beamPrimary,
              opacity: 0.25 + (pct / 100) * 0.75,
              boxShadow: beamGlow(state === 'error' ? colors.error : colors.beamPrimary, 4 + (pct / 100) * 14),
              transition: 'opacity 0.6s ease, box-shadow 0.6s ease',
            }}
          />
        ) : null}
      </div>

      {label ? (
        <div style={{ ...microLabel, color: state === 'error' ? colors.error : colors.textSecondary, marginTop: 12, display: 'flex', gap: 10, alignItems: 'baseline' }}>
          <span>{label}</span>
          {typeof progress === 'number' ? (
            <span style={{ color: colors.beamPrimary, background: tint(colors.beamPrimary, 10), padding: '1px 6px', borderRadius: 999 }}>{Math.round(pct)}%</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
