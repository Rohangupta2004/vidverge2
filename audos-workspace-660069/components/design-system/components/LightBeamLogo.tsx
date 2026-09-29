/**
 * LightBeamLogo — the animated VidVerge wordmark.
 *
 * Horizontal beams flow in from the left and converge into the V. At rest
 * the V carries a very slow ambient pulse and nothing else moves; when the
 * product is working, the beams accelerate into the vertex.
 */
import type { CSSProperties } from 'react';
import { colors } from '../tokens/colors';
import { typography } from '../tokens/typography';
import { beamGradient, beamGlow } from '../animations/beamKeyframes';
import { useBeamStyles, useRiveSlot } from '../animations/useBeamAnimation';

export interface LightBeamLogoProps {
  riveSrc?: string;
  state?: 'idle' | 'active';
  size?: number;
  /** Render the 'VidVerge' wordmark beside the mark. */
  showWordmark?: boolean;
  /** Optional line under the wordmark. */
  tagline?: string;
  className?: string;
  style?: CSSProperties;
}

const FEED_ROWS = [0, 140, 280];

export default function LightBeamLogo({
  riveSrc, state = 'idle', size = 30, showWordmark = true, tagline, className, style,
}: LightBeamLogoProps) {
  useBeamStyles();
  const rive = useRiveSlot(riveSrc);
  const active = state === 'active';

  if (rive.active) {
    return <rive.Rive src={riveSrc} style={{ height: size * 1.4, ...style }} />;
  }

  return (
    <div className={className} style={{ display: 'inline-flex', alignItems: 'center', gap: 12, ...style }}>
      <div style={{ position: 'relative', width: size * 1.9, height: size, flexShrink: 0 }}>
        {/* Beams feeding the mark. */}
        <div aria-hidden='true' style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: size * 0.95, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: Math.max(3, size * 0.14), overflow: 'hidden' }}>
          {FEED_ROWS.map((delay) => (
            <div key={delay} style={{ position: 'relative', height: 1, width: '100%' }}>
              <div
                data-lb-anim='logo-feed'
                style={{
                  position: 'absolute', inset: 0,
                  background: beamGradient({ bodyWidth: 14, trailWidth: 8 }),
                  animation: active
                    ? 'lb-beamTravel 900ms linear ' + delay + 'ms infinite'
                    : 'lb-ambient 4.5s ease-in-out ' + delay + 'ms infinite',
                  willChange: 'transform, opacity',
                }}
              />
            </div>
          ))}
        </div>

        {/* The V the light arrives at. */}
        <svg
          viewBox='0 0 24 24'
          width={size}
          height={size}
          fill='none'
          aria-hidden='true'
          style={{ position: 'absolute', right: 0, top: 0 }}
        >
          <path
            data-lb-anim='logo-v'
            d='M4 5 L12 19 L20 5'
            stroke={colors.beamPrimary}
            strokeWidth={2.4}
            strokeLinecap='round'
            strokeLinejoin='round'
            style={{
              filter: 'drop-shadow(' + beamGlow(colors.beamPrimary, active ? 10 : 5) + ')',
              animation: active ? 'lb-beamPulse 900ms ease-in-out infinite' : 'lb-beamPulse 4.5s ease-in-out infinite',
              willChange: 'opacity',
            }}
          />
          <path d='M12 19 L12 19.01' stroke={colors.beamCore} strokeWidth={3} strokeLinecap='round' opacity={active ? 1 : 0.5} />
        </svg>
      </div>

      {showWordmark ? (
        <span style={{ minWidth: 0 }}>
          <span
            style={{
              display: 'block',
              fontFamily: typography.fontSans,
              fontSize: typography.xl,
              fontWeight: typography.bold,
              letterSpacing: typography.tight,
              color: colors.textPrimary,
              lineHeight: 1.1,
            }}
          >
            Vid<span style={{ color: colors.beamPrimary }}>Verge</span>
          </span>
          {tagline ? (
            <span style={{ display: 'block', fontFamily: typography.fontMono, fontSize: typography.xs, letterSpacing: typography.wide, color: colors.textSecondary, marginTop: 3 }}>
              {tagline}
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
