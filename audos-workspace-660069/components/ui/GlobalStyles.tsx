import React from 'react';

/**
 * Injects the Vidverge global rules (reset, dark ground, scrollbars, shared
 * keyframes) into the document head exactly once, no matter how many apps
 * mount.
 *
 * Mirrors components/global.css.
 *
 * TWO SCOPES, ON PURPOSE:
 *
 * `.vv-app-shell` carries the box-sizing / margin reset. It stays opt-in
 * because a bare `*` reset would also strip margins out of the OS shell that
 * renders the dock, agent chat and settings around every app.
 *
 * `.vv-dark` carries COLOUR ONLY — ground, text, scrollbars and the
 * light-utility neutraliser below. Desktop.tsx puts it on the shell root and
 * on the app content frame, so an app inherits the dark palette whether or
 * not it was written against the design system, and without any layout reset
 * being applied to it retroactively.
 *
 * THE NEUTRALISER is the second half of the dark conversion. The apps carry
 * leftover light-theme Tailwind utilities (bg-white, bg-gray-50,
 * text-gray-900, bg-slate-100 …) from the cream/gold era. Re-pointing those
 * utilities inside `.vv-dark` is what stops a single stray `bg-white` from
 * punching a white hole in a dark panel. Descendant selectors outrank a bare
 * utility class, so none of this needs `!important`. It is a safety net, not
 * a licence to keep writing light classes: new code should use the tokens in
 * components/theme.ts or the `--space-*` variables.
 */

export const GLOBAL_STYLE_ID = 'vidverge-global-styles';

const DARK = {
  bg: '#08090B',
  card: '#111318',
  panel: '#171A21',
  input: '#0E1014',
  text: '#F6F3EB',
  textMuted: '#77736B',
  border: 'rgba(255,255,255,0.07)',
  borderInput: 'rgba(255,255,255,0.11)',
  scrollThumb: '#2D3037',
};

/** Utility classes that paint a light surface, and the dark fill each takes. */
const LIGHT_SURFACE_REMAP: Array<[string[], string]> = [
  [['bg-white', 'bg-gray-50', 'bg-slate-50', 'bg-neutral-50', 'bg-zinc-50', 'bg-stone-50'], DARK.card],
  [['bg-gray-100', 'bg-slate-100', 'bg-neutral-100', 'bg-zinc-100', 'bg-stone-100'], DARK.panel],
  [['bg-gray-200', 'bg-slate-200', 'bg-neutral-200', 'bg-zinc-200'], DARK.panel],
];

/** Utility classes that paint dark-on-light text, and the light ink each takes. */
const LIGHT_TEXT_REMAP: Array<[string[], string]> = [
  [['text-black', 'text-gray-900', 'text-gray-800', 'text-slate-900', 'text-slate-800', 'text-neutral-900', 'text-zinc-900'], DARK.text],
  [['text-gray-700', 'text-gray-600', 'text-gray-500', 'text-slate-700', 'text-slate-600', 'text-slate-500', 'text-neutral-600', 'text-zinc-600'], DARK.textMuted],
];

const LIGHT_BORDER_CLASSES = [
  'border-gray-100', 'border-gray-200', 'border-gray-300',
  'border-slate-100', 'border-slate-200', 'border-slate-300',
  'border-neutral-200', 'border-zinc-200',
];

function rule(classes: string[], declaration: string): string {
  return classes.map((c) => '.vv-dark .' + c).join(',\n') + ' { ' + declaration + ' }';
}

const NEUTRALISER_CSS = [
  ...LIGHT_SURFACE_REMAP.map(([classes, fill]) => rule(classes, 'background-color: ' + fill + ';')),
  ...LIGHT_TEXT_REMAP.map(([classes, ink]) => rule(classes, 'color: ' + ink + ';')),
  rule(LIGHT_BORDER_CLASSES, 'border-color: ' + DARK.border + ';'),
  // An input is the one place a light fill is most jarring and most common.
  '.vv-dark input, .vv-dark textarea, .vv-dark select { background-color: ' + DARK.input + '; color: ' + DARK.text + '; border-color: ' + DARK.borderInput + '; }',
  '.vv-dark input::placeholder, .vv-dark textarea::placeholder { color: ' + DARK.textMuted + '; }',
  // Native pickers and dropdown lists render their own light chrome otherwise.
  '.vv-dark option { background-color: ' + DARK.panel + '; color: ' + DARK.text + '; }',
].join('\n');

export const GLOBAL_CSS = [
  '.vv-app-shell, .vv-app-shell * { box-sizing: border-box; }',
  '.vv-app-shell h1, .vv-app-shell h2, .vv-app-shell h3, .vv-app-shell h4, .vv-app-shell p, .vv-app-shell figure { margin: 0; }',
  ".vv-app-shell, .vv-dark { background: " + DARK.bg + "; color: " + DARK.text + "; font-family: 'Inter', system-ui, -apple-system, sans-serif; }",
  // Headings are tracked in slightly across the product.
  '.vv-dark h1, .vv-dark h2, .vv-dark h3, .vv-dark h4 { letter-spacing: -0.01em; }',
  // Dark scrollbars: the standards property for Firefox, the WebKit
  // pseudo-elements for everything else.
  '.vv-dark, .vv-dark * { scrollbar-color: ' + DARK.scrollThumb + ' transparent; scrollbar-width: thin; }',
  '.vv-dark ::-webkit-scrollbar { width: 8px; height: 8px; }',
  '.vv-dark ::-webkit-scrollbar-track { background: transparent; }',
  '.vv-dark ::-webkit-scrollbar-thumb { background: ' + DARK.scrollThumb + '; border-radius: 4px; }',
  '.vv-dark ::-webkit-scrollbar-thumb:hover { background: #41454F; }',
  '.vv-dark ::-webkit-scrollbar-corner { background: transparent; }',
  NEUTRALISER_CSS,
  '@keyframes beamPulse { 0%, 100% { opacity: 0; } 50% { opacity: 1; } }',
  '@keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }',
  '@keyframes spin { to { transform: rotate(360deg); } }',
  '@keyframes pulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.15); opacity: 0.7; } }',
  '@keyframes vvWave { 0%, 100% { transform: scaleY(0.25); } 50% { transform: scaleY(1); } }',
  '@keyframes vvSheen { 0% { transform: translateX(-120%); } 100% { transform: translateX(220%); } }',
  // Indeterminate sweep for video-generation progress bars.
  '@keyframes vvIndeterminate { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } }',
  '@media (prefers-reduced-motion: reduce) { .vv-app-shell *, .vv-app-shell *::before, .vv-app-shell *::after { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; } }',
].join('\n');

const GlobalStyles: React.FC = function GlobalStyles() {
  React.useEffect(function mountGlobalCss() {
    if (typeof document === 'undefined') return;
    const existing = document.getElementById(GLOBAL_STYLE_ID);
    if (existing) {
      // A stale copy from a previous palette would otherwise survive a
      // client-side remount and keep painting the old theme.
      if (existing.textContent !== GLOBAL_CSS) existing.textContent = GLOBAL_CSS;
      return;
    }
    const el = document.createElement('style');
    el.id = GLOBAL_STYLE_ID;
    el.textContent = GLOBAL_CSS;
    document.head.appendChild(el);
  }, []);

  return null;
};

export default GlobalStyles;
