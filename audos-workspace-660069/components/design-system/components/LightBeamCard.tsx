/**
 * LightBeamCard — dark glass surface with a border beam on activation.
 *
 * Dormant: bgGlass on borderSubtle, completely still. No idle shimmer, no
 * hover lift, no scale.
 * Active or hovered: one 1px beam travels the border path (top → right →
 * bottom → left) exactly once and stops. Hovering longer does not loop it.
 * `selected` holds the border on borderActive without animating.
 */
import type { CSSProperties, ReactNode } from 'react';
import { colors } from '../tokens/colors';
import type { BeamVariant } from '../tokens/colors';
import { radiiPx } from '../tokens/radii';
import { useBeamAnimation, useBeamStyles } from '../animations/useBeamAnimation';
import LightBeamBorder from './LightBeamBorder';

export interface LightBeamCardProps {
  riveSrc?: string;
  children?: ReactNode;
  /** Force the beam on (e.g. the scene currently rendering). */
  active?: boolean;
  /** Persistent highlight without motion. */
  selected?: boolean;
  /** Set false for read-only cards that should never react. */
  hoverable?: boolean;
  onClick?: () => void;
  variant?: BeamVariant;
  state?: 'idle' | 'processing' | 'complete' | 'error';
  radius?: number;
  padding?: number | string;
  className?: string;
  style?: CSSProperties;
  testId?: string;
  title?: string;
}

export default function LightBeamCard({
  riveSrc, children, active = false, selected = false, hoverable = true, onClick,
  variant = 'info', state, radius = radiiPx.lg, padding = 16, className, style, testId, title,
}: LightBeamCardProps) {
  useBeamStyles();
  const pass = useBeamAnimation({ durationMs: 1100 });
  const beamOn = active || (hoverable && pass.running);

  return (
    <LightBeamBorder
      riveSrc={riveSrc}
      active={beamOn}
      loop={active}
      variant={variant}
      state={state}
      radius={radius}
      runKey={pass.runId}
      showRestingBorder={false}
      style={{ display: 'block' }}
    >
      <div
        data-testid={testId}
        title={title}
        onMouseEnter={() => { if (hoverable && !active) pass.trigger(); }}
        onClick={onClick}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        onFocus={() => { if (hoverable && !active) pass.trigger(); }}
        onKeyDown={(e) => { if (onClick && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onClick(); } }}
        className={className}
        style={{
          background: colors.bgGlass,
          border: '1px solid ' + (selected || active ? colors.borderActive : colors.borderSubtle),
          borderRadius: radius,
          padding,
          color: colors.textPrimary,
          cursor: onClick ? 'pointer' : undefined,
          transition: 'border-color 0.2s ease, background 0.2s ease',
          ...style,
        }}
      >
        {children}
      </div>
    </LightBeamBorder>
  );
}
