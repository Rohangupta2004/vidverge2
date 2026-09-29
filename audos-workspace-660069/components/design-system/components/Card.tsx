/**
 * Card — the shared LightBeam surface.
 *
 * bgGlass on borderSubtle with LightBeamCard's border-beam behaviour on
 * hover and activation. Adds the header / eyebrow / actions layout the apps
 * repeat everywhere, so a panel is one component instead of six nested divs.
 */
import type { CSSProperties, ReactNode } from 'react';
import { colors } from '../tokens/colors';
import type { BeamVariant } from '../tokens/colors';
import { radiiPx } from '../tokens/radii';
import { microLabel, typography } from '../tokens/typography';
import LightBeamCard from './LightBeamCard';

export interface CardProps {
  riveSrc?: string;
  children?: ReactNode;
  /** Uppercase micro-label above the title. */
  eyebrow?: string;
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned header controls. */
  actions?: ReactNode;
  active?: boolean;
  selected?: boolean;
  hoverable?: boolean;
  onClick?: () => void;
  variant?: BeamVariant;
  state?: 'idle' | 'processing' | 'complete' | 'error';
  padding?: number | string;
  radius?: number;
  className?: string;
  style?: CSSProperties;
  testId?: string;
}

export default function Card({
  riveSrc, children, eyebrow, title, subtitle, actions, active, selected, hoverable = true,
  onClick, variant = 'info', state, padding = 18, radius = radiiPx.lg, className, style, testId,
}: CardProps) {
  const hasHeader = !!(eyebrow || title || subtitle || actions);

  return (
    <LightBeamCard
      riveSrc={riveSrc}
      active={active}
      selected={selected}
      hoverable={hoverable}
      onClick={onClick}
      variant={variant}
      state={state}
      radius={radius}
      padding={padding}
      className={className}
      style={style}
      testId={testId}
    >
      {hasHeader ? (
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, marginBottom: children ? 14 : 0 }}>
          <div style={{ minWidth: 0 }}>
            {eyebrow ? <div style={{ ...microLabel, color: colors.beamPrimary, marginBottom: 6 }}>{eyebrow}</div> : null}
            {title ? (
              <div style={{ fontFamily: typography.fontSans, fontSize: typography.lg, fontWeight: typography.semibold, letterSpacing: typography.tight, color: colors.textPrimary }}>
                {title}
              </div>
            ) : null}
            {subtitle ? (
              <div style={{ fontFamily: typography.fontSans, fontSize: typography.sm, lineHeight: 1.55, color: colors.textSecondary, marginTop: 5 }}>
                {subtitle}
              </div>
            ) : null}
          </div>
          {actions ? <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </LightBeamCard>
  );
}
