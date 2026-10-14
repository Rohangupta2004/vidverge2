/**
 * VidVerge LightBeam — color tokens.
 *
 * Deep space + flowing gold energy. Every LightBeam component reads its
 * colors from here; nothing hardcodes a hex value of its own.
 *
 * These values are mirrored into the shell's `--space-*` CSS variables in
 * config.json and into components/theme.ts, so the dock, the agent chat and
 * Settings stay on the identical palette. When one changes, change all three.
 *
 * ONE SURFACE DELIBERATELY DOES NOT INHERIT THIS, and it is not a bug:
 * `components/EmailGate.tsx` runs the "Prismatic Refraction" landing palette
 * (a #0D0B05 canvas with its own spectral gradient). It is a
 * marketing page with its own art direction, it declares its colours at the
 * top of its own file, and it already sits in the same dark gold family.
 */
export const colors = {
  // Backgrounds
  bgPrimary: '#0D0B05',
  bgSurface: '#15120A',
  bgGlass: 'rgba(255,255,255,0.03)',
  bgGlassHover: 'rgba(255,255,255,0.06)',

  // Light beam system
  beamCore: '#ffffff',           // white-hot center
  beamPrimary: '#D4920A',        // gold beam
  beamGlow: 'rgba(212,146,10,0.18)',
  beamTrail: 'rgba(212,146,10,0.07)',
  beamDim: 'rgba(212,146,10,0.03)',

  // Borders
  borderSubtle: 'rgba(255,200,50,0.08)',
  borderActive: 'rgba(212,146,10,0.45)',
  borderBeam: '#D4920A',

  // Text
  textPrimary: '#F5E9C8',
  textSecondary: 'rgba(245,233,200,0.6)',
  textDim: 'rgba(245,233,200,0.3)',

  // States
  success: '#4ade80',
  error: '#f87171',
  warning: '#fbbf24',
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
