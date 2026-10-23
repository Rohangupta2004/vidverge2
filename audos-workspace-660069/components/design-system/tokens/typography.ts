import { FONT, TYPE } from '../../theme';

/** Compatibility adapter: all values originate in components/theme.ts. */
export const typography = {
  fontSans: FONT.body,
  fontHeading: FONT.heading,
  fontMono: FONT.mono,
  xs: '12px', sm: '14px', base: '16px', lg: '20px', xl: '28px', '2xl': '40px', '3xl': '64px',
  regular: 400, medium: 500, semibold: 600, bold: 600,
  tight: '-0.025em', normal: '0', wide: '0.04em', wider: '0.08em',
  scale: TYPE,
} as const;
export const microLabel = { fontFamily: FONT.body, fontSize: 12, lineHeight: '18px', fontWeight: 500, letterSpacing: 0 } as const;
export default typography;
