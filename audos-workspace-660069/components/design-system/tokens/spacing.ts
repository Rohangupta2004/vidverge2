import { SPACING } from '../../theme';

/** Compatibility adapter: all values originate in components/theme.ts. */
export const spacing = {
  none: '0px', hair: '2px', xs: `${SPACING.xxs}px`, sm: `${SPACING.xs}px`,
  md: `${SPACING.sm}px`, lg: `${SPACING.md}px`, xl: `${SPACING.lg}px`,
  '2xl': `${SPACING.lg}px`, '3xl': `${SPACING.xl}px`, '4xl': `${SPACING['2xl']}px`,
  '5xl': `${SPACING['3xl']}px`, '6xl': `${SPACING['3xl']}px`, '7xl': `${SPACING['3xl']}px`,
} as const;
export type SpacingToken = keyof typeof spacing;
export function space(steps: number): string { return `${steps * 4}px`; }
export const beamMetrics = { trackHeight: 2, coreWidth: 4, bodyWidth: 56, trailWidth: 20, rowGap: 8, rowStaggerMs: 120 } as const;
export default spacing;
