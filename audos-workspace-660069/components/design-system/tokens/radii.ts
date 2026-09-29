/** VidVerge LightBeam — corner radius tokens. Precision software, not soft SaaS. */
export const radii = {
  none: '0px',
  xs: '3px',
  sm: '6px',
  md: '9px',
  lg: '12px',
  xl: '16px',
  '2xl': '22px',
  pill: '999px',
  circle: '50%',
} as const;

export type RadiusToken = keyof typeof radii;

/** Numeric radius used by the SVG border-trace rects (needs a number, not a string). */
export const radiiPx = {
  none: 0, xs: 3, sm: 6, md: 9, lg: 12, xl: 16, '2xl': 22,
} as const;

export default radii;
