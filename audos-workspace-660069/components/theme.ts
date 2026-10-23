/**
 * Vidverge Design System v3.0 — canonical token source.
 *
 * All TypeScript UI tokens originate here. config.json mirrors the same values
 * as --space-* variables for the OS shell. Compatibility aliases remain so
 * older studios adopt v3 without breaking their existing imports.
 */

export const COLORS = {
  bg: '#101214',
  surface: '#171A1E',
  raised: '#20242A',
  hover: '#292E35',
  border: '#343A43',
  controlBorder: '#596270',
  text: '#F4F5F7',
  secondary: '#C4C9D0',
  muted: '#9AA3AF',
  accent: '#D9A441',
  onAccent: '#17120A',
  accentHover: '#E5B75A',
  accentPressed: '#B8832E',
  accentSoft: '#2B2418',
  bronze: '#8A5C24',
  focus: '#F3D58B',
  success: '#72C99A',
  successBg: '#15261F',
  warning: '#E0B96B',
  warningBg: '#2B2418',
  danger: '#F28B8B',
  dangerBg: '#311D22',
  info: '#8FB5EA',
  infoBg: '#192538',

  // Compatibility names used by existing studios.
  surfaceAlt: '#20242A',
  input: '#101214',
  buttonSecondary: '#20242A',
  borderHover: '#596270',
  borderInput: '#596270',
  primary: '#D9A441',
  primaryGlow: '#E5B75A',
  accentGlow: '#E5B75A',
  textMuted: '#C4C9D0',
  textFaint: '#9AA3AF',
  error: '#F28B8B',
} as const;

export const FONT = {
  heading: "'Space Grotesk', 'Segoe UI', sans-serif",
  body: "'Manrope', 'Segoe UI', sans-serif",
  mono: "ui-monospace, 'SFMono-Regular', Consolas, monospace",
} as const;

export const TYPE = {
  brand: { fontSize: 64, lineHeight: '68px', fontWeight: 500, letterSpacing: '-0.04em' },
  appTitle: { fontSize: 28, lineHeight: '36px', fontWeight: 600, letterSpacing: '-0.025em' },
  sectionTitle: { fontSize: 20, lineHeight: '28px', fontWeight: 500, letterSpacing: '-0.02em' },
  cardTitle: { fontSize: 16, lineHeight: '24px', fontWeight: 600 },
  body: { fontSize: 16, lineHeight: '24px', fontWeight: 400 },
  compact: { fontSize: 14, lineHeight: '20px', fontWeight: 400 },
  control: { fontSize: 14, lineHeight: '20px', fontWeight: 600 },
  metadata: { fontSize: 12, lineHeight: '18px', fontWeight: 500 },
} as const;

export const RADIUS = { badge: 6, sm: 10, md: 10, card: 12, lg: 12, dialog: 16, xl: 16, brand: 24 } as const;
export const SPACING = { xxs: 4, xs: 8, sm: 12, md: 16, lg: 24, xl: 32, '2xl': 48, '3xl': 64 } as const;
export const MOTION = {
  fast: '120ms cubic-bezier(.2,0,0,1)',
  standard: '180ms cubic-bezier(.2,0,0,1)',
  overlay: '240ms cubic-bezier(.2,0,0,1)',
} as const;

export const HEADING_TRACKING = '-0.025em';
export const SHADOW = {
  glow: 'none',
  glowCyan: 'none',
  card: 'none',
  overlay: '0 18px 48px rgba(0,0,0,0.52)',
} as const;
export const MOBILE_BREAKPOINT = 768;
export const CONTENT_MAX_WIDTH = 1280;

export const GRADIENT = {
  brand: 'linear-gradient(115deg, #C79232 0%, #D9A441 58%, #E5B75A 100%)',
  action: 'linear-gradient(115deg, #C79232 0%, #D9A441 58%, #E5B75A 100%)',
  actionHover: 'linear-gradient(115deg, #D2A044 0%, #E5B75A 58%, #EBC673 100%)',
  display: 'linear-gradient(110deg, #8A5C24 0%, #B8832E 40%, #D9A441 74%, #E5B75A 100%)',
  surface: 'linear-gradient(145deg, #20242A 0%, #191C21 56%, #15181C 100%)',
  selected: 'linear-gradient(100deg, #2B2418 0%, #202126 100%)',
  ambient: 'radial-gradient(ellipse at 85% 0%, #D9A44118 0%, transparent 55%)',
  brandSoft: 'linear-gradient(100deg, #2B2418 0%, #202126 100%)',
  beam: 'linear-gradient(to top, transparent 0%, #8A5C24 58%, #D9A441 100%)',
  header: 'radial-gradient(ellipse at 85% 0%, #D9A44118 0%, transparent 55%)',
} as const;

export function alpha(hex: string, amount: number): string {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return hex;
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, amount))})`;
}

export const CSS_VARS: Record<string, string> = {
  '--vg-bg': COLORS.bg,
  '--vg-surface': COLORS.surface,
  '--vg-raised': COLORS.raised,
  '--vg-hover': COLORS.hover,
  '--vg-border': COLORS.border,
  '--vg-control-border': COLORS.controlBorder,
  '--vg-text': COLORS.text,
  '--vg-secondary': COLORS.secondary,
  '--vg-muted': COLORS.muted,
  '--vg-accent': COLORS.accent,
  '--vg-on-accent': COLORS.onAccent,
  '--vg-accent-hover': COLORS.accentHover,
  '--vg-accent-pressed': COLORS.accentPressed,
  '--vg-accent-soft': COLORS.accentSoft,
  '--vg-bronze': COLORS.bronze,
  '--vg-focus': COLORS.focus,
  '--vg-success': COLORS.success,
  '--vg-success-bg': COLORS.successBg,
  '--vg-warning': COLORS.warning,
  '--vg-warning-bg': COLORS.warningBg,
  '--vg-danger': COLORS.danger,
  '--vg-danger-bg': COLORS.dangerBg,
  '--vg-info': COLORS.info,
  '--vg-info-bg': COLORS.infoBg,
  '--vg-gradient-brand': GRADIENT.display,
  '--vg-gradient-action': GRADIENT.action,
  '--vg-gradient-action-hover': GRADIENT.actionHover,
  '--vg-gradient-surface': GRADIENT.surface,
  '--vg-gradient-selected': GRADIENT.selected,
  '--vg-gradient-ambient': GRADIENT.ambient,
};

export type ThemeColor = keyof typeof COLORS;
export default { COLORS, FONT, TYPE, RADIUS, SPACING, MOTION, SHADOW, GRADIENT, CSS_VARS, alpha };
