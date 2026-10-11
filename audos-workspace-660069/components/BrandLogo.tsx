import React from 'react';
import { COLORS } from './theme';

/**
 * BRAND LOGO — the Vidverge mark.
 *
 * A vector recreation of the workspace logo: a shallow, wide "V" drawn from
 * several swooping light filaments that converge at the vertex, brightest at
 * the centre and fading out at the tips.
 *
 * WHY IT IS CODE RATHER THAN THE RASTER FILE
 * `workspace-branding.json` still holds the original PNG, which is painted in
 * the retired gold. Drawing the same artwork here means the mark inherits the
 * live brand gradient from components/theme.ts, so the logo can never drift
 * out of step with the palette again — change the tokens and the logo follows.
 *
 * This is the STILL mark. components/VergeLoader.tsx is the animated sibling
 * that runs a spark along the same filaments while something is loading; the
 * two share the artwork on purpose so a surface can swap between them without
 * the brand shape changing.
 */

export interface BrandLogoProps {
  /** Width of the mark in px. Height follows the 5:3 artboard. */
  size?: number;
  /** 'mark' is the glyph alone; 'lockup' adds the Vidverge wordmark beside it. */
  variant?: 'mark' | 'lockup';
  /** Tagline under the wordmark. Lockup only. */
  tagline?: string;
  /** Soft brand bloom behind the vertex. */
  glow?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Five strands at increasing depth. The middle one is the hero; the outer two
 * are thinner and dimmer so the bundle reads as light rather than as lines.
 */
const FILAMENTS: Array<{ d: string; w: number; o: number }> = [
  { d: 'M 2 24 C 50 26, 70 44, 100 80 C 130 44, 150 26, 198 24', w: 1.0, o: 0.45 },
  { d: 'M 2 27 C 52 29, 72 47, 100 85 C 128 47, 148 29, 198 27', w: 1.6, o: 0.8 },
  { d: 'M 2 36 C 54 38, 74 56, 100 94 C 126 56, 146 38, 198 36', w: 2.4, o: 1 },
  { d: 'M 2 45 C 56 47, 76 64, 100 102 C 124 64, 144 47, 198 45', w: 1.6, o: 0.8 },
  { d: 'M 2 52 C 58 54, 78 70, 100 108 C 122 70, 142 54, 198 52', w: 1.0, o: 0.4 },
];

const BrandLogo: React.FC<BrandLogoProps> = function BrandLogo({
  size = 120,
  variant = 'mark',
  tagline,
  glow = true,
  className,
  style,
}) {
  // Unique per instance so several logos on one page never share gradient ids.
  const uid = React.useMemo(
    function makeId() {
      return 'vvlogo' + Math.random().toString(36).slice(2, 8);
    },
    [],
  );
  const gradId = uid + '-grad';
  const softId = uid + '-soft';
  const bloomId = uid + '-bloom';

  const mark = (
    <svg
      width={size}
      height={Math.round(size * 0.6)}
      viewBox="0 0 200 120"
      fill="none"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block', overflow: 'visible', flex: '0 0 auto' }}
    >
      <defs>
        {/* Gold at the tips, deep gold at the vertex — the brand sweep read
            along the mark rather than across a flat fill. */}
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={COLORS.primary} stopOpacity="0" />
          <stop offset="16%" stopColor={COLORS.primary} stopOpacity="0.6" />
          <stop offset="38%" stopColor={COLORS.primary} stopOpacity="1" />
          <stop offset="50%" stopColor={COLORS.accent} stopOpacity="1" />
          <stop offset="62%" stopColor={COLORS.primary} stopOpacity="1" />
          <stop offset="84%" stopColor={COLORS.primary} stopOpacity="0.6" />
          <stop offset="100%" stopColor={COLORS.primary} stopOpacity="0" />
        </linearGradient>
        <filter id={softId} x="-25%" y="-70%" width="150%" height="240%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
        <filter id={bloomId} x="-70%" y="-160%" width="240%" height="420%">
          <feGaussianBlur stdDeviation="8" />
        </filter>
      </defs>

      {glow ? (
        <ellipse
          cx="100"
          cy="94"
          rx="34"
          ry="13"
          fill={COLORS.primary}
          opacity="0.22"
          filter={'url(#' + bloomId + ')'}
        />
      ) : null}

      {/* Blurred halo under the bundle, so the strands sit in a gold wash. */}
      {FILAMENTS.map(function renderHalo(filament, i) {
        return (
          <path
            key={'halo' + i}
            d={filament.d}
            stroke={'url(#' + gradId + ')'}
            strokeWidth={filament.w * 2.6}
            strokeLinecap="round"
            fill="none"
            opacity={filament.o * 0.22}
            filter={'url(#' + softId + ')'}
          />
        );
      })}

      {FILAMENTS.map(function renderStrand(filament, i) {
        return (
          <path
            key={'strand' + i}
            d={filament.d}
            stroke={'url(#' + gradId + ')'}
            strokeWidth={filament.w}
            strokeLinecap="round"
            fill="none"
            opacity={filament.o}
          />
        );
      })}
    </svg>
  );

  if (variant === 'mark') {
    return (
      <span className={className} style={{ display: 'inline-flex', ...style }}>
        {mark}
      </span>
    );
  }

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: Math.round(size * 0.1),
        ...style,
      }}
    >
      {mark}
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span
          style={{
            fontFamily: "'Inter', system-ui, sans-serif",
            fontSize: Math.round(size * 0.26),
            fontWeight: 700,
            letterSpacing: '-0.02em',
            lineHeight: 1.1,
            background:
              'linear-gradient(100deg, ' + COLORS.text + ' 10%, ' + COLORS.primary + ' 60%, ' + COLORS.accent + ' 100%)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            whiteSpace: 'nowrap',
          }}
        >
          Vidverge
        </span>
        {tagline ? (
          <span
            style={{
              fontFamily: "'Inter', system-ui, sans-serif",
              fontSize: Math.max(10, Math.round(size * 0.1)),
              fontWeight: 600,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: COLORS.textFaint,
              whiteSpace: 'nowrap',
            }}
          >
            {tagline}
          </span>
        ) : null}
      </span>
    </span>
  );
};

export default BrandLogo;
