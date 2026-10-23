import { COLORS } from '../../theme';

/** Compatibility adapter: all values originate in components/theme.ts. */
export const colors = {
  bgPrimary: COLORS.bg,
  bgSurface: COLORS.surface,
  bgGlass: COLORS.surface,
  bgGlassHover: COLORS.hover,
  beamCore: COLORS.focus,
  beamPrimary: COLORS.accent,
  beamGlow: COLORS.accentSoft,
  beamTrail: COLORS.accentSoft,
  beamDim: COLORS.surface,
  borderSubtle: COLORS.border,
  borderActive: COLORS.controlBorder,
  borderBeam: COLORS.accent,
  textPrimary: COLORS.text,
  textSecondary: COLORS.secondary,
  textDim: COLORS.muted,
  success: COLORS.success,
  error: COLORS.danger,
  warning: COLORS.warning,
} as const;
export type ColorToken = keyof typeof colors;
export const beamVariants = {
  info: { core: COLORS.focus, body: COLORS.info, trail: COLORS.infoBg },
  success: { core: COLORS.focus, body: COLORS.success, trail: COLORS.successBg },
  error: { core: COLORS.focus, body: COLORS.danger, trail: COLORS.dangerBg },
} as const;
export type BeamVariant = keyof typeof beamVariants;
export function tint(color: string, percent: number): string { return `color-mix(in srgb, ${color} ${percent}%, transparent)`; }
export default colors;
