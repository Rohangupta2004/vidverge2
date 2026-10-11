/**
 * LIGHTBEAM — VidVerge's shared warm-gold editor design system.
 *
 * One constant, imported by the studio apps (Script-to-Video, Video Enhancer,
 * Product Studio) so every studio surface shares the same canvas, cards and
 * accent. Values mirror components/theme.ts and the workspace brand
 * (workspace-branding.json: page #FFFDF4, primary #C8920A), so the shell, the
 * shared UI layer and the apps read as one product.
 */

export const LB = {
  bg: '#FFFDF4',
  bgCard: '#FFFFFF',
  bgCardHover: '#FFFAEB',
  bgDeep: '#FFF3D6',
  border: '1px solid rgba(180,120,0,0.14)',
  borderAccent: '1px solid rgba(180,120,0,0.36)',
  accent: '#C8920A',
  accentDark: '#B4720A',
  accentGlow: 'rgba(200,146,10,0.3)',
  accentGradient: 'linear-gradient(135deg, #C8920A 0%, #E0A33A 100%)',
  cyan: '#B4720A',
  cyanBright: '#E0A33A',
  textPrimary: '#1A1000',
  textSecondary: '#7A6030',
  textMuted: '#A08B5F',
  radius: { sm: '8px', md: '12px', lg: '16px', xl: '24px' },
  shadow: '0 4px 24px rgba(120,80,0,0.12)',
  glowFocus: '0 0 0 2px #C8920A, 0 0 20px rgba(200,146,10,0.3)',
} as const;

/** Timeline track colors (Video Enhancer NLE + anywhere clips are drawn). */
export const LB_TRACKS = {
  video: '#C8920A',
  audio: '#166534',
  captions: '#B4720A',
} as const;

/**
 * Skeleton shimmer (pure CSS keyframes — no animation libraries). Drop this
 * string into a <style> tag once per app, then put className="lb-shimmer" on
 * any placeholder block.
 */
export const LB_SHIMMER_CSS = `
@keyframes shimmer {
  0% { background-position: -400px 0; }
  100% { background-position: 400px 0; }
}
.lb-shimmer {
  background: linear-gradient(90deg, rgba(200,146,10,0.06) 25%, rgba(200,146,10,0.16) 50%, rgba(200,146,10,0.06) 75%);
  background-size: 800px 100%;
  animation: shimmer 1.4s linear infinite;
  border-radius: 8px;
}
@media (prefers-reduced-motion: reduce) { .lb-shimmer { animation: none; } }
`;

/** Standard LightBeam card style (system-sans, 600-weight headers pair with it). */
export const lbCard = {
  background: LB.bgCard,
  border: LB.border,
  borderRadius: 16,
} as const;

export default LB;
