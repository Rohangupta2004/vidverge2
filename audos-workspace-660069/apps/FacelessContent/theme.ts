/**
 * FACELESS CONTENT — design tokens.
 *
 * This app runs the VidVerge dark gold palette: it is a production console,
 * and the terminal progress view needs the contrast a dark plate gives it.
 * Everything is defined once here so the Create form, the terminal, the
 * result screen and the history grid cannot drift apart.
 *
 * The values track components/theme.ts — change the palette there and mirror
 * it here rather than inventing a second gold.
 *
 * `F.bg` and `F.accentGradient` are GRADIENT strings, so they may only be used
 * as a `background`. `F.accent` stays a flat hex because borders, focus rings
 * and text colours cannot take a gradient.
 */
import { CSSProperties } from 'react';

export const F = {
  bg: 'linear-gradient(135deg, #0D0B05 0%, #15120A 52%, #18150A 100%)',
  /** The flat fallback behind the gradient (video letterboxing, canvas fills). */
  bgSolid: '#0D0B05',
  card: '#15120A',
  raised: '#1C1808',
  /** The terminal needs a darker plate than a card so log text stays legible. */
  terminalBg: '#0D0B05',
  line: 'rgba(255,255,255,0.07)',
  lineStrong: 'rgba(255,255,255,0.18)',
  ink: '#F5E9C8',
  soft: '#C8AA6E',
  muted: '#9E8B55',
  accent: '#D4920A',
  accentDeep: '#B87808',
  accentBright: '#F0B429',
  accentLight: '#F0B429',
  accentSoft: 'rgba(212,146,10,0.18)',
  accentGradient: 'linear-gradient(90deg, #D4920A, #F0B429)',
  accentGlow: '0 0 20px rgba(212,146,10,0.42)',
  glass: 'blur(12px)',
  terminal: '#4ade80',
  warn: '#fbbf24',
  bad: '#f87171',
  sans: "'Inter', 'Geist', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  mono: "'JetBrains Mono', 'SF Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
} as const;

export const cardStyle: CSSProperties = {
  background: F.card,
  border: `1px solid ${F.line}`,
  borderRadius: 12,
  padding: 18,
  backdropFilter: F.glass,
  WebkitBackdropFilter: F.glass,
  boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
};

/** The lighter glass used for rows and chips nested inside a card. */
export const panelStyle: CSSProperties = {
  background: F.raised,
  border: `1px solid ${F.line}`,
  borderRadius: 12,
  backdropFilter: F.glass,
  WebkitBackdropFilter: F.glass,
};

export const inputStyle: CSSProperties = {
  width: '100%',
  background: '#18150A',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 8,
  padding: '13px 15px',
  color: F.ink,
  fontSize: 15,
  fontFamily: F.sans,
  outline: 'none',
  boxSizing: 'border-box',
  backdropFilter: F.glass,
  WebkitBackdropFilter: F.glass,
};

export const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: 11.5,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: F.accentLight,
  marginBottom: 8,
};

/** The gradient CTA. Spread it, then set width/padding/font-size per button. */
export const ctaStyle: CSSProperties = {
  background: F.accentGradient,
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  fontFamily: F.sans,
  fontWeight: 800,
  cursor: 'pointer',
  boxShadow: F.accentGlow,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 9,
};

/** Gradient text. Needs a `background` of its own to clip, so spread it last. */
export const headingGradient: CSSProperties = {
  background: 'linear-gradient(90deg, #F5E9C8, #F0B429)',
  backgroundClip: 'text',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  color: 'transparent',
};

/** Section rule that fades in from both edges. */
export const dividerStyle: CSSProperties = {
  height: 1,
  border: 'none',
  background: 'linear-gradient(90deg, transparent, #D4920A, transparent)',
};

/**
 * One stylesheet for the whole app. The terminal line fade-in is the only
 * animation the progress view needs, and it is disabled under
 * prefers-reduced-motion like every other VidVerge surface.
 */
export const FC_CSS = `
@keyframes fcSpin { to { transform: rotate(360deg); } }
@keyframes fcLineIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@keyframes fcCaret { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
@keyframes fcSweep { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
.fc-spin { animation: fcSpin .9s linear infinite; }
.fc-line { animation: fcLineIn .34s ease-out backwards; }
.fc-caret { animation: fcCaret 1.05s step-end infinite; }
.fc-pill { transition: background .16s ease, border-color .16s ease, color .16s ease, box-shadow .16s ease; }
.fc-pill:hover:not(:disabled) { border-color: ${F.lineStrong}; }
.fc-cta { transition: filter .16s ease, box-shadow .16s ease, transform .16s ease; }
.fc-cta:hover:not(:disabled) { filter: brightness(1.12); box-shadow: 0 0 28px rgba(212,146,10,0.58); }
.fc-cta:active:not(:disabled) { transform: translateY(1px); }
.fc-card { transition: border-color .2s ease, transform .2s ease, box-shadow .2s ease; }
.fc-card:hover { border-color: ${F.lineStrong}; transform: translateY(-2px); box-shadow: 0 8px 32px rgba(0,0,0,0.55); }
.fc-root input, .fc-root textarea { transition: border-color .16s ease, box-shadow .16s ease; }
.fc-root input:focus, .fc-root textarea:focus { outline: 2px solid ${F.accent}; outline-offset: 1px; border-color: ${F.accent}; box-shadow: 0 0 18px rgba(212,146,10,0.34); }
.fc-root input::placeholder, .fc-root textarea::placeholder { color: ${F.muted}; }
.fc-sweep { position: relative; overflow: hidden; }
.fc-sweep::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgba(240,180,41,0.85), transparent); animation: fcSweep 1.9s ease-in-out infinite; }
.fc-root ::-webkit-scrollbar { width: 8px; height: 8px; }
.fc-root ::-webkit-scrollbar-thumb { background: #2A2410; border-radius: 999px; }
.fc-root ::-webkit-scrollbar-track { background: transparent; }
.fc-root { scrollbar-color: #2A2410 transparent; scrollbar-width: thin; }
@media (prefers-reduced-motion: reduce) {
  .fc-root *, .fc-root *::before, .fc-root *::after {
    animation: none !important;
    transition-duration: 0.01ms !important;
  }
}
`;
