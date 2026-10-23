import { RADIUS } from '../../theme';

/** Compatibility adapter: all values originate in components/theme.ts. */
export const radii = {
  none: '0px', xs: '3px', sm: `${RADIUS.badge}px`, md: `${RADIUS.sm}px`,
  lg: `${RADIUS.card}px`, xl: `${RADIUS.dialog}px`, '2xl': `${RADIUS.brand}px`,
  pill: '999px', circle: '50%',
} as const;
export type RadiusToken = keyof typeof radii;
export const radiiPx = { none: 0, xs: 3, sm: RADIUS.badge, md: RADIUS.sm, lg: RADIUS.card, xl: RADIUS.dialog, '2xl': RADIUS.brand } as const;
export default radii;
