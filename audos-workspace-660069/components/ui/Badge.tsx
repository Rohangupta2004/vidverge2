import React from 'react';
import { COLORS } from '../theme';

/** Small pill label used for statuses, counts and provider tags. */

export type BadgeVariant = 'brand' | 'cyan' | 'green' | 'red' | 'amber' | 'muted';

export interface BadgeProps {
  children?: React.ReactNode;
  variant?: BadgeVariant;
  /** Show a leading status dot. */
  dot?: boolean;
  /** Make the dot breathe (for in-progress states). */
  pulse?: boolean;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
}

const TONES: Record<BadgeVariant, { fg: string; bg: string; border: string }> = {
  brand: { fg: COLORS.accent, bg: COLORS.accentSoft, border: COLORS.accentPressed },
  cyan: { fg: COLORS.info, bg: COLORS.infoBg, border: COLORS.info },
  green: { fg: COLORS.success, bg: COLORS.successBg, border: COLORS.success },
  red: { fg: COLORS.danger, bg: COLORS.dangerBg, border: COLORS.danger },
  amber: { fg: COLORS.warning, bg: COLORS.warningBg, border: COLORS.warning },
  muted: { fg: COLORS.secondary, bg: COLORS.raised, border: COLORS.border },
};

const Badge: React.FC<BadgeProps> = function Badge({
  children,
  variant = 'brand',
  dot = false,
  pulse = false,
  className,
  style,
  title,
}) {
  const tone = TONES[variant];
  return (
    <span
      className={className}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 10px',
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 500,
        letterSpacing: 0,
        color: tone.fg,
        background: tone.bg,
        border: '1px solid ' + tone.border,
        whiteSpace: 'nowrap',
        lineHeight: 1.5,
        ...style,
      }}
    >
      {dot ? (
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: tone.fg,
            boxShadow: 'none',
            animation: pulse ? 'pulse 1.4s ease-in-out infinite' : undefined,
            flex: '0 0 auto',
          }}
        />
      ) : null}
      {children}
    </span>
  );
};

export default Badge;
