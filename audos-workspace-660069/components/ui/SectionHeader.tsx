import React from 'react';
import { COLORS, FONT } from '../theme';
import BrandLogo from '../BrandLogo';

/**
 * Title block that opens every Vidverge app: logo mark, app name, one-line
 * subtitle, and an optional slot for actions on the right.
 */

export interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  /** Replaces the default Vidverge mark (inline SVG or unicode mark). */
  icon?: React.ReactNode;
  /** Right-aligned controls: badges, buttons, counters. */
  actions?: React.ReactNode;
  /** Small uppercase label above the title. */
  eyebrow?: string;
  style?: React.CSSProperties;
}

const SectionHeader: React.FC<SectionHeaderProps> = function SectionHeader({
  title,
  subtitle,
  icon,
  actions,
  eyebrow,
  style,
}) {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 14,
        flexWrap: 'wrap',
        paddingBottom: 18,
        marginBottom: 22,
        borderBottom: '1px solid ' + COLORS.border,
        ...style,
      }}
    >
      <div style={{ paddingTop: 2 }}>{icon || <BrandLogo size={60} />}</div>

      <div style={{ flex: '1 1 240px', minWidth: 0 }}>
        {eyebrow ? (
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: 1.4,
              textTransform: 'uppercase',
              color: COLORS.accentGlow,
              marginBottom: 6,
            }}
          >
            {eyebrow}
          </div>
        ) : null}

        <h1
          style={{
            margin: 0,
            fontFamily: FONT.heading,
            fontSize: 'clamp(19px, 2.4vw, 25px)',
            fontWeight: 700,
            letterSpacing: -0.4,
            lineHeight: 1.2,
            color: COLORS.text,
          }}
        >
          {title}
        </h1>

        {subtitle ? (
          <p
            style={{
              margin: '6px 0 0',
              fontFamily: FONT.body,
              fontSize: 13.5,
              lineHeight: 1.55,
              color: COLORS.textMuted,
              maxWidth: 620,
            }}
          >
            {subtitle}
          </p>
        ) : null}
      </div>

      {actions ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            paddingTop: 2,
          }}
        >
          {actions}
        </div>
      ) : null}
    </header>
  );
};

export default SectionHeader;
