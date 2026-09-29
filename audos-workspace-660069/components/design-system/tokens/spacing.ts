/**
 * VidVerge LightBeam — spacing tokens.
 *
 * A 4px base grid. Intentional negative space is part of the aesthetic: the
 * UI stays still and generous, and the light is what moves through it.
 */
export const spacing = {
  none: '0px',
  hair: '2px',
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '20px',
  '2xl': '24px',
  '3xl': '32px',
  '4xl': '40px',
  '5xl': '56px',
  '6xl': '72px',
  '7xl': '96px',
} as const;

export type SpacingToken = keyof typeof spacing;

/** Arbitrary step on the 4px grid — `space(5)` → '20px'. */
export function space(steps: number): string {
  return `${steps * 4}px`;
}

/** Beam geometry shared by every component so the light reads identically. */
export const beamMetrics = {
  /** Loader / progress / processing track height. */
  trackHeight: 2,
  /** White-hot leading edge. */
  coreWidth: 4,
  /** Gold body behind the core. */
  bodyWidth: 56,
  /** Fading amber tail. */
  trailWidth: 20,
  /** Gap between stacked LightBeamProcessing rows. */
  rowGap: 8,
  /** Stagger between stacked rows. */
  rowStaggerMs: 120,
} as const;

export default spacing;
