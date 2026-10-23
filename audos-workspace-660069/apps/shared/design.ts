import { COLORS, FONT, GRADIENT, RADIUS, TYPE as TYPOGRAPHY } from '../../components/theme';

/** Compatibility adapter for existing app imports; values originate in components/theme.ts. */
export const BRAND = {
  bg: COLORS.bg,
  surface: COLORS.surface,
  surfaceHover: COLORS.hover,
  border: COLORS.border,
  borderStrong: COLORS.controlBorder,
  accent: COLORS.accent,
  accentHover: COLORS.accentHover,
  accentSoft: COLORS.accentSoft,
  text: COLORS.text,
  textSub: COLORS.secondary,
  textMuted: COLORS.muted,
  success: COLORS.success,
  warning: COLORS.warning,
  error: COLORS.danger,
  radius: `${RADIUS.sm}px`,
  radiusSm: `${RADIUS.sm}px`,
  radiusLg: `${RADIUS.card}px`,
};

export const TYPE = {
  pageTitle: { ...TYPOGRAPHY.appTitle, color: BRAND.text, fontFamily: FONT.heading } as const,
  cardTitle: { ...TYPOGRAPHY.cardTitle, color: BRAND.text, fontFamily: FONT.body } as const,
  body: { ...TYPOGRAPHY.compact, color: BRAND.textSub, fontFamily: FONT.body } as const,
  hint: { ...TYPOGRAPHY.metadata, color: BRAND.textMuted, fontFamily: FONT.body } as const,
  sectionLabel: { ...TYPOGRAPHY.metadata, color: BRAND.textMuted, fontFamily: FONT.body } as const,
};

export const controlStyle: Record<string, string | number> = {
  minHeight: 44, padding: '0 12px', background: COLORS.bg,
  border: `1px solid ${COLORS.controlBorder}`, borderRadius: RADIUS.sm,
  color: COLORS.text, fontSize: 14, fontFamily: FONT.body, outline: 'none', width: '100%',
};
export const textareaStyle: Record<string, string | number> = {
  minHeight: 120, padding: 12, background: COLORS.bg,
  border: `1px solid ${COLORS.controlBorder}`, borderRadius: RADIUS.sm,
  color: COLORS.text, fontSize: 14, lineHeight: '20px', fontFamily: FONT.body,
  outline: 'none', width: '100%', resize: 'vertical',
};
export type ButtonKind = 'primary' | 'secondary' | 'ghost' | 'destructive';
export function buttonStyle(kind: ButtonKind = 'primary'): Record<string, string | number> {
  const base = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 44, padding: '0 16px', borderRadius: RADIUS.sm, fontSize: 14, fontWeight: 600, fontFamily: FONT.body, cursor: 'pointer', transition: 'background 120ms cubic-bezier(.2,0,0,1)', whiteSpace: 'nowrap' } as const;
  if (kind === 'secondary') return { ...base, background: COLORS.surface, border: `1px solid ${COLORS.controlBorder}`, color: COLORS.text };
  if (kind === 'ghost') return { ...base, background: 'transparent', border: '1px solid transparent', color: COLORS.secondary };
  if (kind === 'destructive') return { ...base, background: COLORS.dangerBg, border: `1px solid ${COLORS.danger}`, color: COLORS.danger };
  return { ...base, background: GRADIENT.action, border: '1px solid transparent', color: COLORS.onAccent };
}
export const cardStyle: Record<string, string | number> = { background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.card, padding: 24 };
export const shimmerStyle: Record<string, string | number> = { background: `linear-gradient(90deg, ${COLORS.surface} 25%, ${COLORS.hover} 50%, ${COLORS.surface} 75%)`, backgroundSize: '200% 100%', animation: 'shimmer 1.4s linear infinite', borderRadius: RADIUS.badge };
export default BRAND;
