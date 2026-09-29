/**
 * VidVerge LightBeam — color tokens.
 *
 * Black space + flowing gold-amber energy. Every LightBeam component reads its
 * colors from here; nothing hardcodes a hex value of its own.
 *
 * The same values are mirrored into the shell's `--space-*` CSS variables in
 * config.json, so the dock, the agent chat, Settings and the email gate stay
 * on the identical palette. When one changes, change both.
 */
export const colors = {
  // Backgrounds
  bgPrimary: '#080808',
  bgSurface: '#0f0f0f',
  bgGlass: 'rgba(255,255,255,0.03)',
  bgGlassHover: 'rgba(255,255,255,0.06)',

  // Light beam system
  beamCore: '#ffffff',           // white-hot center
  beamPrimary: '#f5b936',        // gold/amber beam
  beamGlow: 'rgba(245,185,54,0.15)',
  beamTrail: 'rgba(245,185,54,0.06)',
  beamDim: 'rgba(245,185,54,0.03)',

  // Borders
  borderSubtle: 'rgba(255,255,255,0.06)',
  borderActive: 'rgba(245,185,54,0.4)',
  borderBeam: '#f5b936',

  // Text
  textPrimary: '#f0f0f0',
  textSecondary: 'rgba(240,240,240,0.5)',
  textDim: 'rgba(240,240,240,0.25)',

  // States
  success: '#4ade80',
  error: '#f87171',
  warning: '#f5b936',
} as const;

export type ColorToken = keyof typeof colors;

/** Beam tints for the non-gold variants (success / error notifications). */
export const beamVariants = {
  info: { core: colors.beamCore, body: colors.beamPrimary, trail: colors.beamTrail },
  success: { core: '#eafff1', body: colors.success, trail: 'rgba(74,222,128,0.08)' },
  error: { core: '#fff0f0', body: colors.error, trail: 'rgba(248,113,113,0.08)' },
} as const;

export type BeamVariant = keyof typeof beamVariants;

/**
 * Mix a token with transparency. Tailwind silently drops `/NN` opacity
 * modifiers applied to CSS variables, so every tint in this system goes
 * through color-mix instead.
 */
export function tint(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

export default colors;
