/** VidVerge LightBeam — typography tokens. */
export const typography = {
  fontSans: "'Inter', system-ui, -apple-system, sans-serif",
  fontMono: "'JetBrains Mono', 'Fira Code', monospace",
  xs: '11px', sm: '13px', base: '15px',
  lg: '17px', xl: '20px', '2xl': '26px', '3xl': '34px',
  regular: 400, medium: 500, semibold: 600, bold: 700,
  tight: '-0.02em', normal: '0', wide: '0.06em', wider: '0.12em',
} as const;

/** Uppercase micro-label used on every LightBeam status line and field label. */
export const microLabel = {
  fontFamily: typography.fontMono,
  fontSize: typography.xs,
  fontWeight: typography.medium,
  letterSpacing: typography.wider,
  textTransform: 'uppercase' as const,
};

export default typography;
