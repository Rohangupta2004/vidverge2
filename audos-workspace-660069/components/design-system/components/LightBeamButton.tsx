/**
 * LightBeamButton — the standard action.
 *
 * Dormant it is completely still: a subtle border on dark glass, no animation
 * at all. On hover a single small beam (4px white-hot edge + 40px gold body)
 * crosses the button face once in 0.5s and does not repeat while the pointer
 * stays. On click the same beam runs at 0.2s and the action fires. The button
 * itself never flashes — only the light moves.
 */
import type { CSSProperties, ReactNode } from 'react';
import { colors, beamVariants, tint } from '../tokens/colors';
import type { BeamVariant } from '../tokens/colors';
import { radii } from '../tokens/radii';
import { typography } from '../tokens/typography';
import { beamGradient, beamGlow } from '../animations/beamKeyframes';
import { useBeamAnimation, useBeamStyles, useRiveSlot } from '../animations/useBeamAnimation';

export type LightBeamButtonKind = 'primary' | 'ghost' | 'danger';

export interface LightBeamButtonProps {
  riveSrc?: string;
  children?: ReactNode;
  onClick?: () => void;
  kind?: LightBeamButtonKind;
  variant?: BeamVariant;
  disabled?: boolean;
  busy?: boolean;
  small?: boolean;
  fullWidth?: boolean;
  title?: string;
  type?: 'button' | 'submit';
  className?: string;
  style?: CSSProperties;
  testId?: string;
  ariaLabel?: string;
}

export default function LightBeamButton({
  riveSrc, children, onClick, kind = 'primary', variant = 'info', disabled, busy,
  small, fullWidth, title, type = 'button', className, style, testId, ariaLabel,
}: LightBeamButtonProps) {
  useBeamStyles();
  const rive = useRiveSlot(riveSrc);
  const hover = useBeamAnimation({ durationMs: 500 });
  const click = useBeamAnimation({ durationMs: 200 });

  const v = kind === 'danger' ? beamVariants.error : beamVariants[variant];
  const inert = disabled || busy;
  const showBeam = !inert && !rive.active && (click.running || hover.running);

  const surface: CSSProperties = kind === 'primary'
    ? { background: tint(colors.beamPrimary, 12), border: '1px solid ' + colors.borderActive, color: colors.beamPrimary }
    : kind === 'danger'
      ? { background: tint(colors.error, 10), border: '1px solid ' + tint(colors.error, 40), color: colors.error }
      : { background: colors.bgGlass, border: '1px solid ' + colors.borderSubtle, color: colors.textPrimary };

  return (
    <button
      type={type}
      title={title}
      aria-label={ariaLabel}
      data-testid={testId}
      disabled={inert}
      onMouseEnter={() => { if (!inert) hover.trigger(); }}
      onFocus={() => { if (!inert) hover.trigger(); }}
      onClick={() => { if (inert) return; click.restart(); onClick?.(); }}
      className={className}
      style={{
        position: 'relative', overflow: 'hidden', isolation: 'isolate',
        display: fullWidth ? 'flex' : 'inline-flex', width: fullWidth ? '100%' : undefined,
        alignItems: 'center', justifyContent: 'center', gap: 8,
        padding: small ? '7px 13px' : '11px 20px',
        borderRadius: small ? radii.md : radii.lg,
        fontFamily: typography.fontSans,
        fontSize: small ? typography.sm : typography.base,
        fontWeight: typography.semibold,
        letterSpacing: typography.tight,
        cursor: inert ? 'not-allowed' : 'pointer',
        opacity: inert ? 0.45 : 1,
        transition: 'border-color 0.18s ease, background 0.18s ease, opacity 0.18s ease',
        ...surface,
        ...style,
      }}
    >
      {rive.active ? (
        <rive.Rive src={riveSrc} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
      ) : showBeam ? (
        <span
          key={'beam-' + (click.running ? 'c' : 'h') + '-' + (click.running ? click.runId : hover.runId)}
          data-lb-anim='button'
          aria-hidden='true'
          style={{
            position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
            background: beamGradient({ core: v.core, body: v.body, trail: v.trail, bodyWidth: 40, trailWidth: 16 }),
            boxShadow: beamGlow(v.body, 12),
            opacity: 0.85,
            animation: 'lb-beamTravel ' + (click.running ? '0.2s' : '0.5s') + ' ease-in-out 1 both',
            willChange: 'transform, opacity',
          }}
        />
      ) : null}
      <span style={{ position: 'relative', zIndex: 1, display: 'inline-flex', alignItems: 'center', gap: 8 }}>{children}</span>
    </button>
  );
}
