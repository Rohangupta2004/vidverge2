import React from 'react';
import { COLORS, CSS_VARS, FONT, GRADIENT, MOTION } from '../theme';

/** Injects the canonical Vidverge v3 token layer once for the shell and apps. */
export const GLOBAL_STYLE_ID = 'vidverge-global-styles-v3';

function vars(values: Record<string, string>): string {
  return Object.entries(values).map(([key, value]) => `${key}:${value};`).join('');
}

const SPACE_COMPAT: Record<string, string> = {
  '--space-surface-bg': COLORS.bg,
  '--space-surface-page': COLORS.bg,
  '--space-surface-page-alt': COLORS.surface,
  '--space-surface-gradient-from': COLORS.bg,
  '--space-surface-gradient-via': COLORS.bg,
  '--space-surface-gradient-to': COLORS.bg,
  '--space-surface-card': COLORS.surface,
  '--space-surface-card-hover': COLORS.hover,
  '--space-surface-panel': COLORS.surface,
  '--space-surface-panel-strong': COLORS.raised,
  '--space-surface-muted': COLORS.raised,
  '--space-surface-accent-soft': COLORS.accentSoft,
  '--space-border-default': COLORS.border,
  '--space-border-subtle': COLORS.border,
  '--space-border-strong': COLORS.controlBorder,
  '--space-text-primary': COLORS.text,
  '--space-text': COLORS.text,
  '--space-text-secondary': COLORS.secondary,
  '--space-text-muted': COLORS.muted,
  '--space-text-brand': COLORS.accent,
  '--space-text-accent': COLORS.accent,
  '--space-text-on-primary': COLORS.onAccent,
  '--space-text-on-highlight': COLORS.onAccent,
  '--space-brand-primary': COLORS.accent,
  '--space-brand-primary-500': COLORS.accent,
  '--space-brand-primary-600': COLORS.accent,
  '--space-brand-primary-700': COLORS.accentPressed,
  '--space-brand-highlight': COLORS.accentHover,
  '--space-brand-highlight-500': COLORS.accentHover,
  '--space-brand-highlight-600': COLORS.accentHover,
  '--space-semantic-success': COLORS.success,
  '--space-semantic-success-50': COLORS.successBg,
  '--space-semantic-success-100': COLORS.successBg,
  '--space-semantic-success-500': COLORS.success,
  '--space-semantic-success-600': COLORS.success,
  '--space-semantic-success-700': COLORS.success,
  '--space-semantic-warning': COLORS.warning,
  '--space-semantic-warning-50': COLORS.warningBg,
  '--space-semantic-warning-100': COLORS.warningBg,
  '--space-semantic-warning-500': COLORS.warning,
  '--space-semantic-warning-600': COLORS.warning,
  '--space-semantic-warning-700': COLORS.warning,
  '--space-semantic-danger': COLORS.danger,
  '--space-semantic-danger-50': COLORS.dangerBg,
  '--space-semantic-danger-100': COLORS.dangerBg,
  '--space-semantic-danger-500': COLORS.danger,
  '--space-semantic-danger-600': COLORS.danger,
  '--space-semantic-danger-700': COLORS.danger,
  '--space-semantic-info': COLORS.info,
  '--space-semantic-info-bg': COLORS.infoBg,
  '--space-font-heading': FONT.heading,
  '--space-font-body': FONT.body,
};

const LIGHT_SURFACES = [
  'bg-white', 'bg-gray-50', 'bg-slate-50', 'bg-neutral-50', 'bg-zinc-50', 'bg-stone-50',
  'bg-gray-100', 'bg-slate-100', 'bg-neutral-100', 'bg-zinc-100', 'bg-stone-100',
];
const DARK_TEXT = [
  'text-black', 'text-gray-900', 'text-gray-800', 'text-slate-900', 'text-slate-800',
  'text-neutral-900', 'text-zinc-900',
];
const LIGHT_BORDERS = [
  'border-gray-100', 'border-gray-200', 'border-gray-300', 'border-slate-100',
  'border-slate-200', 'border-slate-300', 'border-neutral-200', 'border-zinc-200',
];
function classRule(classes: string[], declaration: string): string {
  return classes.map((name) => `.vv-dark .${name}`).join(',') + `{${declaration}}`;
}

export const GLOBAL_CSS = [
  `:root,.vv-dark,.vv-app-shell{${vars({ ...CSS_VARS, ...SPACE_COMPAT })}}`,
  `html,body{background:${COLORS.bg};color:${COLORS.text};}`,
  `.vv-dark,.vv-app-shell{background:${COLORS.bg};color:${COLORS.text};font-family:${FONT.body};font-synthesis:none;color-scheme:dark;}`,
  '.vv-app-shell,.vv-app-shell *{box-sizing:border-box;}',
  '.vv-app-shell h1,.vv-app-shell h2,.vv-app-shell h3,.vv-app-shell h4,.vv-dark h1,.vv-dark h2,.vv-dark h3,.vv-dark h4{font-family:var(--space-font-heading);font-synthesis:none;}',
  '.vv-dark,.vv-dark *{scrollbar-color:var(--vg-border) transparent;scrollbar-width:thin;}',
  '.vv-dark ::-webkit-scrollbar{width:8px;height:8px;}',
  '.vv-dark ::-webkit-scrollbar-track{background:transparent;}',
  '.vv-dark ::-webkit-scrollbar-thumb{background:var(--vg-border);border-radius:6px;}',
  '.vv-dark ::selection{background:var(--vg-accent-soft);color:var(--vg-text);}',
  classRule(LIGHT_SURFACES, `background-color:${COLORS.surface};`),
  classRule(DARK_TEXT, `color:${COLORS.text};`),
  classRule(LIGHT_BORDERS, `border-color:${COLORS.border};`),
  '.vv-dark [class*="purple-"],.vv-dark [class*="violet-"]{--tw-gradient-from:var(--vg-accent)!important;--tw-gradient-to:var(--vg-accent-hover)!important;border-color:var(--vg-border)!important;color:var(--vg-accent)!important;}',
  '.vv-dark input,.vv-dark textarea,.vv-dark select{background-color:var(--vg-bg);color:var(--vg-text);border-color:var(--vg-control-border);font-family:var(--space-font-body);}',
  '.vv-dark input,.vv-dark select{min-height:44px;border-radius:10px;}',
  '.vv-app-shell textarea{min-height:120px;border-radius:10px;}',
  '.vv-dark input::placeholder,.vv-dark textarea::placeholder{color:var(--vg-muted);}',
  '.vv-dark option{background:var(--vg-raised);color:var(--vg-text);}',
  '.vv-dark :where(button,a,input,textarea,select,[tabindex]):focus-visible{outline:2px solid var(--vg-focus)!important;outline-offset:3px!important;box-shadow:none!important;}',
  '.vv-dark button,.vv-dark a[role="button"]{font-family:var(--space-font-body);font-synthesis:none;}',
  `.vg-primary-action{min-height:44px;border:0;border-radius:10px;background:${GRADIENT.action};color:var(--vg-on-accent);font-weight:600;transition:background ${MOTION.fast},transform ${MOTION.fast};}`,
  `.vg-primary-action:hover:not(:disabled){background:${GRADIENT.actionHover};}`,
  '.vg-primary-action:active:not(:disabled){background:var(--vg-accent-pressed);transform:translateY(1px);}',
  '.vg-primary-action:disabled{background:var(--vg-raised);color:var(--vg-muted);cursor:not-allowed;}',
  '.vg-panel{background:var(--vg-surface);border:1px solid var(--vg-border);border-radius:12px;padding:24px;}',
  '.vg-featured-panel{background:var(--vg-gradient-surface);border:1px solid var(--vg-border);border-radius:12px;padding:24px;}',
  '.vg-status{display:inline-flex;align-items:center;gap:8px;border-radius:6px;padding:3px 8px;font-size:12px;font-weight:500;}',
  '.vg-tabular{font-variant-numeric:tabular-nums;}',
  '.vg-thumbnail-label{background:var(--vg-bg);color:var(--vg-text);padding:4px 8px;border-radius:6px;}',
  '@keyframes spin{to{transform:rotate(360deg);}}',
  '@keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}',
  '@keyframes pulse{0%,100%{opacity:.72}50%{opacity:1}}',
  '@keyframes vvWave{0%,100%{transform:scaleY(.25)}50%{transform:scaleY(1)}}',
  '@keyframes vvCompletionSweep{from{transform:translateX(-120%)}to{transform:translateX(220%)}}',
  '.vv-dark [role="toolbar"],.vv-dark .toolbar,.vv-dark [class*="toolbar"]{flex-wrap:wrap;}',
  '@media(max-width:1199px){.vv-app-shell>[style*="padding"]{max-width:100%;}}',
  '@media(max-width:767px){.vv-dark button,.vv-dark a[role="button"],.vv-app-shell button,.vv-app-shell a[role="button"]{min-height:44px;min-width:44px}.vv-app-shell{overflow-x:hidden}}',
  '@media(max-width:480px){.vv-app-shell{font-size:16px}.vg-panel,.vg-featured-panel{padding:16px}}',
  '@media(prefers-reduced-motion:reduce){.vv-dark *,.vv-dark *::before,.vv-dark *::after,.vv-app-shell *,.vv-app-shell *::before,.vv-app-shell *::after{animation-duration:.001ms!important;animation-iteration-count:1!important;scroll-behavior:auto!important;transition-duration:.001ms!important;}}',
].join('\n');

const GlobalStyles: React.FC = function GlobalStyles() {
  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    const stale = document.getElementById('vidverge-global-styles');
    if (stale) stale.remove();
    let element = document.getElementById(GLOBAL_STYLE_ID) as HTMLStyleElement | null;
    if (!element) {
      element = document.createElement('style');
      element.id = GLOBAL_STYLE_ID;
      document.head.appendChild(element);
    }
    if (element.textContent !== GLOBAL_CSS) element.textContent = GLOBAL_CSS;
  }, []);
  return null;
};

export default GlobalStyles;
