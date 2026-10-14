import React from 'react';
import { COLORS } from '../theme';

/**
 * Abstract Vidverge "V" glyph: two converging beams in gold and deep gold.
 * Inline SVG so no icon library is needed and it inherits the brand palette.
 */

export interface VergeMarkProps {
  size?: number;
  /** Draw the rounded gold plate behind the glyph. */
  plate?: boolean;
  title?: string;
  style?: React.CSSProperties;
}

const VergeMark: React.FC<VergeMarkProps> = function VergeMark({
  size = 34,
  plate = true,
  title = 'Vidverge',
  style,
}) {
  const gradientId = React.useMemo(
    function makeId() {
      return 'vv-mark-' + Math.random().toString(36).slice(2, 8);
    },
    [],
  );

  return (
    <span
      aria-label={title}
      role="img"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        flex: '0 0 auto',
        borderRadius: Math.round(size * 0.3),
        background: plate
          ? 'linear-gradient(140deg, rgba(212,146,10,0.16) 0%, rgba(240,180,41,0.12) 100%)'
          : 'transparent',
        border: plate ? '1px solid ' + COLORS.border : 'none',
        boxShadow: plate ? '0 0 18px rgba(212,146,10,0.22)' : 'none',
        ...style,
      }}
    >
      <svg
        width={Math.round(size * 0.58)}
        height={Math.round(size * 0.58)}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={gradientId} x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
            <stop stopColor={COLORS.primary} />
            <stop offset="1" stopColor={COLORS.accent} />
          </linearGradient>
        </defs>
        <path
          d="M3 3.5 L12 20.5 L21 3.5"
          stroke={'url(#' + gradientId + ')'}
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M8.4 3.5 L12 10.4 L15.6 3.5"
          stroke={COLORS.primary}
          strokeOpacity="0.55"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
};

export default VergeMark;
