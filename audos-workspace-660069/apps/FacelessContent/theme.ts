/**
 * FACELESS CONTENT — design tokens.
 *
 * This app deliberately runs its own gold-glass palette alongside the amber
 * VidVerge shell: it is a production console, and the terminal progress view
 * needs the contrast. Everything is defined once here so the Create form, the
 * terminal, the result screen and the history grid cannot drift apart.
 *
 * `F.bg` and `F.accentGradient` are GRADIENT strings, so they may only be used
 * as a `background`. `F.accent` stays a flat hex because borders, focus rings
 * and text colours cannot take a gradient.
 */
import { CSSProperties } from 'react';

export const F = {
  bg: 'linear-gradient(135deg, #FFFDF4 0%, #FFF3D6 52%, #FFFAEB 100%)',
  /** The flat fallback behind the gradient (video letterboxing, canvas fills). */
  bgSolid: '#FFFDF4',
  card: '#FFFFFF',
  raised: '#FFFAEB',
  /** The terminal needs a darker plate than a card so log text stays legible. */
  terminalBg: '#FFF3D6',
  line: 'rgba(180,120,0,0.14)',
  lineStrong: 'rgba(180,120,0,0.36)',
  ink: '#1A1000',
  soft: '#3D2800',
  muted: '#7A6030',
  accent: '#C8920A',
  accentDeep: '#B4720A',
  accentBright: '#C8920A',
  accentLight: '#B4720A',
  accentSoft: 'rgba(200,146,10,0.18)',
  accentGradient: 'linear-gradient(90deg, #B4720A, #C8920A)',
  accentGlow: '0 0 20px rgba(200,146,10,0.4)',
  glass: 'blur(12px)',
  terminal: '#166534',
  warn: '#B45309',
  bad: '#991B1B',
  sans: "'Inter', 'Geist', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  mono: "'JetBrains Mono', 'SF Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
} as const;

export const cardStyle: CSSProperties = {
  background: F.card,
  border: `1px solid ${F.line}`,
  borderRadius: 16,
  padding: 18,
  backdropFilter: F.glass,
  WebkitBackdropFilter: F.glass,
  boxShadow: '0 18px 48px rgba(120,80,0,0.12)',
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
  background: F.raised,
  border: `1px solid ${F.line}`,
  borderRadius: 12,
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
  borderRadius: 12,
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
  background: 'linear-gradient(90deg, #1A1000, #C8920A)',
  backgroundClip: 'text',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  color: 'transparent',
};

/** Section rule that fades in from both edges. */
export const dividerStyle: CSSProperties = {
  height: 1,
  border: 'none',
  background: 'linear-gradient(90deg, transparent, #C8920A, transparent)',
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
.fc-cta:hover:not(:disabled) { filter: brightness(1.12); box-shadow: 0 0 28px rgba(200,146,10,0.55); }
.fc-cta:active:not(:disabled) { transform: translateY(1px); }
.fc-card { transition: border-color .2s ease, transform .2s ease, box-shadow .2s ease; }
.fc-card:hover { border-color: ${F.lineStrong}; transform: translateY(-2px); box-shadow: 0 22px 54px rgba(120,80,0,0.14); }
.fc-root input, .fc-root textarea { transition: border-color .16s ease, box-shadow .16s ease; }
.fc-root input:focus, .fc-root textarea:focus { outline: 2px solid ${F.accent}; outline-offset: 1px; border-color: ${F.accent}; box-shadow: 0 0 18px rgba(200,146,10,0.32); }
.fc-root input::placeholder, .fc-root textarea::placeholder { color: ${F.muted}; }
.fc-sweep { position: relative; overflow: hidden; }
.fc-sweep::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgba(232,183,55,0.85), transparent); animation: fcSweep 1.9s ease-in-out infinite; }
.fc-root ::-webkit-scrollbar { width: 8px; height: 8px; }
.fc-root ::-webkit-scrollbar-thumb { background: rgba(200,146,10,0.45); border-radius: 999px; }
.fc-root ::-webkit-scrollbar-track { background: transparent; }
@media (prefers-reduced-motion: reduce) {
  .fc-root *, .fc-root *::before, .fc-root *::after {
    animation: none !important;
    transition-duration: 0.01ms !important;
  }
}
`;
