/**
 * Vidverge premium obsidian design tokens.
 *
 * Single source of truth for the palette used by every app under apps/*.
 * Import the constants instead of writing hex values inline so a palette
 * change here propagates across the whole product family.
 *
 *   import { COLORS, FONT, RADIUS, SHADOW } from '../../components/theme';
 *
 * These values are mirrored into the shell's `--space-*` CSS variables in
 * config.json and into workspace-branding.json, so the dock, the agent chat,
 * Settings and the email gate stay on the identical palette. When one
 * changes, change all three.
 */

export const COLORS = {
  /** Deepest ground — the page behind everything. */
  bg: '#08090B',
  /** Card / default panel. */
  surface: '#111318',
  /** Elevated panel that needs to read above a card. */
  surfaceAlt: '#171A21',
  /** Input and well backgrounds. */
  input: '#0E1014',
  /** Neutral (non-accent) button fill. */
  buttonSecondary: '#20232B',
  border: 'rgba(255,255,255,0.07)',
  borderHover: 'rgba(243,213,139,0.24)',
  /** Input borders read slightly stronger than panel borders. */
  borderInput: 'rgba(255,255,255,0.11)',
  primary: '#D6AB4A',
  primaryGlow: '#F3D58B',
  accent: '#F3D58B',
  accentGlow: '#FFE8AB',
  text: '#F6F3EB',
  textMuted: '#77736B',
  textFaint: '#55524C',
  success: '#4ade80',
  error: '#f87171',
  warning: '#fbbf24',
};

export const FONT = {
  heading: "'Inter', 'SF Pro Display', system-ui, sans-serif",
  body: "'Inter', system-ui, sans-serif",
  mono: "'JetBrains Mono', 'Fira Code', monospace",
};

export const RADIUS = { sm: 8, md: 12, lg: 16, xl: 24 };

/** 16 / 24 / 32px rhythm every app lays its sections out on. */
export const SPACING = { xs: 8, sm: 12, md: 16, lg: 24, xl: 32 };

/** Headings are tracked in slightly; body text is left alone. */
export const HEADING_TRACKING = '-0.01em';

export const SHADOW = {
  glow: '0 0 28px rgba(214,171,74,0.24)',
  glowCyan: '0 0 24px rgba(243,213,139,0.18)',
  card: '0 4px 24px rgba(0,0,0,0.5)',
};

/** Breakpoint below which every layout collapses to a single column. */
export const MOBILE_BREAKPOINT = 640;

/** Default max width of an app's centered content column. */
export const CONTENT_MAX_WIDTH = 900;

/** Gold → amber sweep used by beams, primary buttons and progress bars. */
export const GRADIENT = {
  brand: `linear-gradient(135deg, ${COLORS.primary} 0%, ${COLORS.accentGlow} 100%)`,
  brandSoft:
    'linear-gradient(135deg, rgba(214,171,74,0.18) 0%, rgba(243,213,139,0.08) 100%)',
  beam:
    'linear-gradient(to top, rgba(214,171,74,0) 0%, rgba(214,171,74,0.46) 45%, rgba(243,213,139,0.52) 100%)',
  surface: `linear-gradient(180deg, ${COLORS.surface} 0%, ${COLORS.surfaceAlt} 100%)`,
  /** Champagne-gold header wash over the obsidian ground. */
  header: 'linear-gradient(120deg, rgba(214,171,74,0.18) 0%, rgba(184,137,47,0.08) 55%, transparent 100%)',
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

export default { COLORS, FONT, RADIUS, SPACING, SHADOW, GRADIENT, alpha };
