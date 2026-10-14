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
  brand: { fg: COLORS.primaryGlow, bg: 'rgba(212,146,10,0.14)', border: 'rgba(212,146,10,0.35)' },
  cyan: { fg: COLORS.accentGlow, bg: 'rgba(6,182,212,0.14)', border: 'rgba(6,182,212,0.35)' },
  green: { fg: '#6ee7b7', bg: 'rgba(16,185,129,0.14)', border: 'rgba(16,185,129,0.35)' },
  red: { fg: '#fca5a5', bg: 'rgba(239,68,68,0.14)', border: 'rgba(239,68,68,0.35)' },
  amber: { fg: COLORS.accentGlow, bg: 'rgba(240,180,41,0.14)', border: 'rgba(240,180,41,0.35)' },
  muted: { fg: COLORS.textMuted, bg: 'rgba(187,168,153,0.1)', border: 'rgba(187,168,153,0.22)' },
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
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
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
            boxShadow: '0 0 8px ' + tone.fg,
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
