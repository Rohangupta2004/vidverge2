/**
 * Badge — status pill.
 *
 * Tints go through color-mix, never a Tailwind `/NN` opacity modifier on a
 * CSS variable: that combination emits no CSS at all and the pill renders
 * untinted and borderless.
 */
import type { CSSProperties, ReactNode } from 'react';
import { colors, tint } from '../tokens/colors';
import { radii } from '../tokens/radii';
import { typography } from '../tokens/typography';

export type BadgeTone = 'beam' | 'neutral' | 'success' | 'error' | 'warning';

export interface BadgeProps {
  children?: ReactNode;
  tone?: BadgeTone;
  /** Small leading dot — useful for live/processing states. */
  dot?: boolean;
  /** Softer, borderless treatment. */
  subtle?: boolean;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

const TONES: Record<BadgeTone, string> = {
  beam: colors.beamPrimary,
  neutral: colors.textSecondary,
  success: colors.success,
  error: colors.error,
  warning: colors.warning,
};

export default function Badge({ children, tone = 'beam', dot, subtle, className, style, title }: BadgeProps) {
  const c = TONES[tone];
  return (
    <span
      title={title}
      className={className}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '3px 9px', borderRadius: radii.pill,
        background: tint(c, subtle ? 7 : 12),
        border: subtle ? '1px solid transparent' : '1px solid ' + tint(c, 34),
        color: c,
        fontFamily: typography.fontMono,
        fontSize: typography.xs,
        fontWeight: typography.medium,
        letterSpacing: typography.wide,
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {dot ? <span aria-hidden='true' style={{ width: 5, height: 5, borderRadius: '50%', background: c, flexShrink: 0 }} /> : null}
      {children}
    </span>
  );
}
