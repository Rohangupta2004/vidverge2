import React from 'react';

/**
 * Injects the Vidverge global rules (reset, scrollbars, shared keyframes) into
 * the document head exactly once, no matter how many apps mount.
 *
 * Mirrors components/global.css. The reset is scoped to `.vv-app-shell` on
 * purpose: a bare `*` reset would also strip margins out of the OS shell that
 * renders the dock, agent chat and settings around every app.
 */

export const GLOBAL_STYLE_ID = 'vidverge-global-styles';

export const GLOBAL_CSS = [
  '.vv-app-shell, .vv-app-shell * { box-sizing: border-box; }',
  '.vv-app-shell h1, .vv-app-shell h2, .vv-app-shell h3, .vv-app-shell h4, .vv-app-shell p, .vv-app-shell figure { margin: 0; }',
  ".vv-app-shell { background: #FFFDF4; color: #1A1000; font-family: 'Inter', system-ui, sans-serif; }",
  '.vv-app-shell ::-webkit-scrollbar { width: 6px; height: 6px; }',
  '.vv-app-shell ::-webkit-scrollbar-track { background: #FFF9E8; }',
  '.vv-app-shell ::-webkit-scrollbar-thumb { background: rgba(180,120,0,0.35); border-radius: 3px; }',
  '.vv-app-shell ::-webkit-scrollbar-thumb:hover { background: rgba(180,120,0,0.65); }',
  '@keyframes beamPulse { 0%, 100% { opacity: 0; } 50% { opacity: 1; } }',
  '@keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }',
  '@keyframes spin { to { transform: rotate(360deg); } }',
  '@keyframes pulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.15); opacity: 0.7; } }',
  '@keyframes vvWave { 0%, 100% { transform: scaleY(0.25); } 50% { transform: scaleY(1); } }',
  '@keyframes vvSheen { 0% { transform: translateX(-120%); } 100% { transform: translateX(220%); } }',
  '@media (prefers-reduced-motion: reduce) { .vv-app-shell *, .vv-app-shell *::before, .vv-app-shell *::after { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; } }',
].join('\n');

const GlobalStyles: React.FC = function GlobalStyles() {
  React.useEffect(function mountGlobalCss() {
    if (typeof document === 'undefined') return;
    if (document.getElementById(GLOBAL_STYLE_ID)) return;
    const el = document.createElement('style');
    el.id = GLOBAL_STYLE_ID;
    el.textContent = GLOBAL_CSS;
    document.head.appendChild(el);
  }, []);

  return null;
};

export default GlobalStyles;
