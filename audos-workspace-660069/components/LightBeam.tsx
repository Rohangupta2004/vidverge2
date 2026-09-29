/**
 * LIGHTBEAM — VidVerge's shared dark-editor design system.
 *
 * One constant, imported by the video apps (Script-to-Video, Video Enhancer,
 * Product Studio) so every studio surface shares the same deep-navy canvas,
 * translucent cards and amber accent. Values line up with the workspace brand
 * (workspace-branding.json: page #080c14, primary #f59e0b) so the shell and
 * the apps read as one product.
 */

export const LB = {
  bg: '#080c14',
  bgCard: 'rgba(255,255,255,0.04)',
  bgCardHover: 'rgba(255,255,255,0.07)',
  bgDeep: '#0a0e1a',
  border: '1px solid rgba(255,255,255,0.08)',
  borderAccent: '1px solid rgba(245,158,11,0.4)',
  accent: '#f59e0b',
  accentDark: '#d97706',
  accentGlow: 'rgba(245,158,11,0.3)',
  accentGradient: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
  textPrimary: '#ffffff',
  textSecondary: 'rgba(255,255,255,0.6)',
  textMuted: 'rgba(255,255,255,0.3)',
  radius: { sm: '8px', md: '12px', lg: '16px', xl: '24px' },
  shadow: '0 4px 24px rgba(0,0,0,0.5)',
  glowFocus: '0 0 0 2px #f59e0b, 0 0 20px rgba(245,158,11,0.3)',
} as const;

/** Timeline track colors (Video Enhancer NLE + anywhere clips are drawn). */
export const LB_TRACKS = {
  video: '#6366f1',
  audio: '#10b981',
  captions: '#f59e0b',
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
  background: linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.10) 50%, rgba(255,255,255,0.04) 75%);
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
