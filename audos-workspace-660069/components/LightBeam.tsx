/**
 * LIGHTBEAM — VidVerge's shared premium obsidian editor design system.
 *
 * One constant, imported by the studio apps (Script-to-Video, Video Enhancer,
 * Product Studio) so every studio surface shares the same canvas, cards and
 * accent. Values mirror components/theme.ts and the workspace brand
 * (workspace-branding.json: page #08090B, primary #D6AB4A), so the shell, the
 * shared UI layer and the apps read as one product.
 *
 * The four surface values are deliberately four distinct steps — ground,
 * card, card-hover, elevated — because the editors stack panels three deep
 * and a dark theme with only two surface tones loses all of its depth.
 */

export const LB = {
  bg: '#08090B',
  bgCard: '#111318',
  bgCardHover: '#171A21',
  bgDeep: '#1D212A',
  border: '1px solid rgba(255,255,255,0.07)',
  borderAccent: '1px solid rgba(214,171,74,0.40)',
  accent: '#D6AB4A',
  accentDark: '#B8892F',
  accentGlow: 'rgba(214,171,74,0.26)',
  accentGradient: 'linear-gradient(135deg, #D6AB4A 0%, #F3D58B 100%)',
  highlight: '#F3D58B',
  highlightBright: '#FFE8AB',
  textPrimary: '#F6F3EB',
  textSecondary: '#B8B2A7',
  textMuted: '#77736B',
  /** Input well — darker than a card so a field reads as recessed. */
  bgInput: '#0E1014',
  borderInput: '1px solid rgba(255,255,255,0.1)',
  /** Neutral button fill, for anything that is not the gold CTA. */
  bgButton: '#20232B',
  radius: { sm: '8px', md: '12px', lg: '16px', xl: '24px' },
  shadow: '0 4px 24px rgba(0,0,0,0.4)',
  glowFocus: '0 0 0 2px #D6AB4A, 0 0 22px rgba(214,171,74,0.26)',
} as const;

/** Timeline track colors (Video Enhancer NLE + anywhere clips are drawn).
 *  These stay three clearly different hues on purpose — a timeline whose
 *  tracks are all brand gold cannot be read at a glance. */
export const LB_TRACKS = {
  video: '#D6AB4A',
  audio: '#4ade80',
  captions: '#fbbf24',
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
  background: linear-gradient(90deg, rgba(214,171,74,0.06) 25%, rgba(243,213,139,0.18) 50%, rgba(214,171,74,0.06) 75%);
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
  borderRadius: 12,
} as const;

export default LB;
