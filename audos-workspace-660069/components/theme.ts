/**
 * Vidverge light warm-gold design tokens.
 *
 * Single source of truth for the cream/gold brand used by every app under
 * apps/*. Import the constants instead of writing hex values inline so a
 * palette change here propagates across the whole product family.
 *
 *   import { COLORS, FONT, RADIUS, SHADOW } from '../../components/theme';
 */

export const COLORS = {
  bg: '#FFFDF4',
  surface: '#FFFFFF',
  surfaceAlt: '#FFFAEB',
  border: 'rgba(180,120,0,0.14)',
  borderHover: 'rgba(180,120,0,0.36)',
  primary: '#C8920A',
  primaryGlow: '#E8B737',
  accent: '#B4720A',
  accentGlow: '#E0A33A',
  text: '#1A1000',
  textMuted: '#7A6030',
  textFaint: '#A08B5F',
  success: '#166534',
  error: '#991B1B',
  warning: '#B45309',
};

export const FONT = {
  heading: "'Inter', 'SF Pro Display', system-ui, sans-serif",
  body: "'Inter', system-ui, sans-serif",
  mono: "'JetBrains Mono', 'Fira Code', monospace",
};

export const RADIUS = { sm: 8, md: 12, lg: 16, xl: 24 };

export const SHADOW = {
  glow: '0 0 24px rgba(200,146,10,0.22)',
  glowCyan: '0 0 24px rgba(180,114,10,0.18)',
  card: '0 4px 20px rgba(120,80,0,0.10)',
};

/** Breakpoint below which every layout collapses to a single column. */
export const MOBILE_BREAKPOINT = 640;

/** Default max width of an app's centered content column. */
export const CONTENT_MAX_WIDTH = 900;

/** Gold → amber sweep used by beams, primary buttons and progress bars. */
export const GRADIENT = {
  brand: `linear-gradient(135deg, ${COLORS.primary} 0%, ${COLORS.accentGlow} 100%)`,
  brandSoft:
    'linear-gradient(135deg, rgba(200,146,10,0.16) 0%, rgba(224,163,58,0.12) 100%)',
  beam:
    'linear-gradient(to top, rgba(200,146,10,0) 0%, rgba(200,146,10,0.55) 45%, rgba(232,183,55,0.55) 100%)',
  surface: `linear-gradient(180deg, ${COLORS.surface} 0%, ${COLORS.surfaceAlt} 100%)`,
};

/**
 * Translucent tint of a brand color. Tailwind silently drops `/NN` opacity
 * modifiers on CSS variables, so tints are always produced as real rgba here.
 */
export function alpha(hex: string, amount: number): string {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return hex;
  return `rgba(${r},${g},${b},${amount})`;
}

export type ThemeColor = keyof typeof COLORS;

export default { COLORS, FONT, RADIUS, SHADOW, GRADIENT, alpha };
