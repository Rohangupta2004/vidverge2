/**
 * Theme derivation. theme.source 'derived' means accent + ink come from the
 * analysed palette (stage 2), never from a hardcoded brand. The first
 * screenshot's palette leads; the plan may override accent explicitly.
 */
import type { Palette, VideoPlan, ScreenAnalysis } from '../types';

export interface RenderTheme {
  accent: string;
  ink: string;
  paper: string;
  isDark: boolean;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function safeHex(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX.test(value.trim()) ? value.trim() : fallback;
}

export function deriveTheme(plan: VideoPlan, analyses: ScreenAnalysis[]): RenderTheme {
  const lead: Palette | undefined = analyses[0]?.palette;
  const isDark = plan.theme?.isDark ?? lead?.isDark ?? false;
  return {
    accent: safeHex(plan.theme?.accent, safeHex(lead?.accent, '#3B82F6')),
    ink: safeHex(lead?.ink, isDark ? '#F8FAFC' : '#0F172A'),
    paper: safeHex(lead?.dominant, isDark ? '#0B1020' : '#F5F7FA'),
    isDark,
  };
}

/** ink at 60% for secondary icon/label colour. */
export function inkSoft(theme: RenderTheme): string {
  return hexWithAlpha(theme.ink, 0.6);
}

export function hexWithAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255).toString(16).padStart(2, '0');
  return `#${full}${a}`;
}
