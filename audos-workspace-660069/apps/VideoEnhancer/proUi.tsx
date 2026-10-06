/**
 * Vidverge Pro — the editor design system.
 *
 * One dark, desktop-class visual language shared by every surface of the
 * studio shell: header, preview, the right-hand control panel, the timeline,
 * the agent drawer and the export modal.
 *
 * Everything is driven from CSS classes in `PRO_CSS` rather than inline style
 * objects, so hover, focus, disabled and the sub-900px stacked layout are all
 * expressed once instead of being re-written at every call site. The same
 * stylesheet text is kept byte-identical in the Short Video Enhancer, which
 * means a visitor who opens both apps gets one consistent editor rather than
 * two that merely look similar.
 */
import type { CSSProperties, ReactNode } from 'react';

/** Token values, for the few places that genuinely need a JS colour. */
export const PRO = {
  bg: '#0A0A0A',
  surface: '#141414',
  elevated: '#1E1E1E',
  border: '#2A2A2A',
  accent: '#7C3AED',
  accentBright: '#9F67FF',
  text: '#FFFFFF',
  text2: '#A0A0A0',
  text3: '#606060',
  good: '#34D399',
  warn: '#FBBF24',
  bad: '#F87171',
  playhead: '#FF3B30',
  track: {
    video: '#3B82F6',
    audio: '#10B981',
    text: '#F59E0B',
    fx: '#A855F7',
    caption: '#EC4899',
  },
  font: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
} as const;

export const PRO_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Bebas+Neue&family=Montserrat:wght@500;600;700;800;900&family=Playfair+Display:wght@500;600;700&family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap';

export const PRO_CSS = `
.vp-root{position:relative;height:100%;min-height:0;flex:1 1 auto;display:flex;flex-direction:column;background:#0A0A0A;color:#fff;font-family:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif;font-size:13px;line-height:1.45;-webkit-font-smoothing:antialiased;}
.vp-root *{box-sizing:border-box;}
.vp-root ::-webkit-scrollbar{width:4px;height:4px;}
.vp-root ::-webkit-scrollbar-track{background:transparent;}
.vp-root ::-webkit-scrollbar-thumb{background:#2F2F2F;border-radius:4px;}
.vp-root ::-webkit-scrollbar-thumb:hover{background:#464646;}
.vp-root{scrollbar-width:thin;scrollbar-color:#2F2F2F transparent;}
.vp-mono{font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,monospace;font-variant-numeric:tabular-nums;}

/* ---------- header ---------- */
.vp-head{flex:0 0 auto;display:flex;align-items:center;gap:10px;height:54px;padding:0 12px;background:#121212;border-bottom:1px solid #2A2A2A;}
.vp-brand{display:flex;align-items:center;gap:9px;min-width:0;}
.vp-mark{width:30px;height:30px;border-radius:8px;display:grid;place-items:center;background:linear-gradient(135deg,#7C3AED,#4C1D95);box-shadow:0 2px 10px rgba(124,58,237,.38);flex:0 0 auto;}
.vp-brand b{display:block;font-size:13.5px;font-weight:800;letter-spacing:-.01em;white-space:nowrap;}
.vp-brand small{display:block;font-size:10.5px;color:#606060;font-weight:500;white-space:nowrap;}
.vp-headgap{flex:1 1 auto;min-width:8px;}
.vp-divider{width:1px;height:22px;background:#2A2A2A;flex:0 0 auto;}

/* ---------- buttons ---------- */
.vp-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;height:34px;padding:0 13px;border-radius:6px;border:1px solid #2A2A2A;background:#1E1E1E;color:#E6E6E6;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap;transition:background 150ms ease,border-color 150ms ease,color 150ms ease,opacity 150ms ease,transform 150ms ease;}
.vp-btn:hover:not(:disabled){background:#262626;border-color:#3A3A3A;color:#fff;}
.vp-btn:active:not(:disabled){transform:translateY(1px);}
.vp-btn:disabled{opacity:.42;cursor:not-allowed;}
.vp-btn.ghost{background:transparent;}
.vp-btn.ghost:hover:not(:disabled){background:#1E1E1E;}
.vp-btn.primary{background:#7C3AED;border-color:#7C3AED;color:#fff;box-shadow:0 2px 14px rgba(124,58,237,.3);}
.vp-btn.primary:hover:not(:disabled){background:#8B4BF7;border-color:#8B4BF7;}
.vp-btn.on{background:rgba(124,58,237,.16);border-color:rgba(124,58,237,.5);color:#C4B5FD;}
.vp-btn.danger{border-color:rgba(248,113,113,.4);color:#FCA5A5;background:rgba(248,113,113,.1);}
.vp-btn.sm{height:28px;padding:0 10px;font-size:11.5px;border-radius:5px;}
.vp-btn.xs{height:24px;padding:0 8px;font-size:11px;border-radius:4px;gap:5px;}
.vp-btn.block{width:100%;}
.vp-ico{display:inline-grid;place-items:center;width:32px;height:32px;flex:0 0 auto;border-radius:6px;border:1px solid #2A2A2A;background:#1E1E1E;color:#A0A0A0;cursor:pointer;transition:background 150ms ease,color 150ms ease,border-color 150ms ease;}
.vp-ico:hover:not(:disabled){background:#262626;color:#fff;}
.vp-ico:disabled{opacity:.35;cursor:not-allowed;}
.vp-ico.on{background:rgba(124,58,237,.16);border-color:rgba(124,58,237,.5);color:#C4B5FD;}
.vp-ico.sm{width:26px;height:26px;border-radius:5px;}

/* ---------- layout ---------- */
/* A grid, not a row: it lets the timeline span the full width underneath both
   columns while the DOM keeps the preview before the panel. */
.vp-body{flex:1 1 auto;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) 380px;grid-template-rows:minmax(0,1fr) auto;}
.vp-stagecol{grid-column:1;grid-row:1;min-width:0;min-height:0;display:flex;flex-direction:column;position:relative;overflow:hidden;background:#0A0A0A;}
.vp-side{grid-column:2;grid-row:1;min-height:0;display:flex;flex-direction:column;background:#141414;border-left:1px solid #2A2A2A;}
.vp-tabs{flex:0 0 auto;display:grid;grid-template-columns:repeat(6,minmax(0,1fr));background:#121212;border-bottom:1px solid #2A2A2A;}
.vp-tab{appearance:none;border:none;background:transparent;color:#707070;font:inherit;font-size:10.5px;font-weight:700;letter-spacing:.02em;padding:9px 2px 8px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;border-bottom:2px solid transparent;transition:color 150ms ease,background 150ms ease,border-color 150ms ease;}
.vp-tab:hover{color:#C9C9C9;background:#171717;}
.vp-tab[aria-selected="true"]{color:#C4B5FD;border-bottom-color:#7C3AED;background:#161320;}
.vp-sidescroll{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;padding:12px 12px 16px;display:flex;flex-direction:column;gap:12px;}

/* ---------- panel sections ---------- */
.vp-sec{background:#161616;border:1px solid #242424;border-radius:8px;overflow:hidden;}
.vp-sechead{display:flex;align-items:center;gap:8px;padding:9px 11px;border-bottom:1px solid #222;}
.vp-sechead h4{margin:0;font-size:11px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:#CFCFCF;}
.vp-sechead .vp-hint{font-size:10.5px;color:#606060;font-weight:500;letter-spacing:0;text-transform:none;}
.vp-secbody{padding:11px;display:flex;flex-direction:column;gap:11px;}
summary.vp-sechead{list-style:none;user-select:none;}
summary.vp-sechead::-webkit-details-marker{display:none;}
summary.vp-sechead::after{content:'▾';margin-left:auto;color:#6A6A6A;font-size:11px;transition:transform 150ms ease;}
details[open] > summary.vp-sechead::after{transform:rotate(180deg);}
summary.vp-sechead:hover{background:#1A1A1A;}
.vp-row{display:flex;align-items:center;gap:8px;}
.vp-row.wrap{flex-wrap:wrap;}
.vp-spread{margin-left:auto;}
.vp-note{font-size:11px;line-height:1.55;color:#808080;margin:0;}
.vp-note.warn{color:#FBBF24;}
.vp-note.bad{color:#FCA5A5;}
.vp-note.good{color:#6EE7B7;}

/* ---------- fields ---------- */
.vp-label{display:block;font-size:10.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#777;margin-bottom:6px;}
.vp-input,.vp-select,.vp-area{width:100%;background:#0E0E0E;border:1px solid #2A2A2A;border-radius:6px;color:#fff;font:inherit;font-size:12.5px;padding:7px 9px;outline:none;transition:border-color 150ms ease,box-shadow 150ms ease;}
.vp-area{resize:vertical;min-height:62px;line-height:1.5;}
.vp-input:focus,.vp-select:focus,.vp-area:focus{border-color:rgba(124,58,237,.65);box-shadow:0 0 0 3px rgba(124,58,237,.14);}
.vp-select{appearance:none;cursor:pointer;background-image:linear-gradient(45deg,transparent 50%,#7a7a7a 50%),linear-gradient(135deg,#7a7a7a 50%,transparent 50%);background-position:calc(100% - 15px) 14px,calc(100% - 10px) 14px;background-size:5px 5px,5px 5px;background-repeat:no-repeat;padding-right:26px;}
.vp-color{width:34px;height:30px;padding:2px;border-radius:6px;border:1px solid #2A2A2A;background:#0E0E0E;cursor:pointer;flex:0 0 auto;}

/* ---------- slider ---------- */
.vp-slider{display:block;}
.vp-slidertop{display:flex;align-items:baseline;gap:8px;margin-bottom:5px;}
.vp-slidertop span:first-child{font-size:11.5px;font-weight:600;color:#C4C4C4;}
.vp-slidertop b{margin-left:auto;font-size:11px;font-weight:700;color:#8B8B8B;font-family:'JetBrains Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums;}
.vp-range{-webkit-appearance:none;appearance:none;width:100%;height:16px;background:transparent;cursor:pointer;margin:0;display:block;}
.vp-range::-webkit-slider-runnable-track{height:4px;border-radius:4px;background:linear-gradient(90deg,#7C3AED var(--vp-fill,0%),#2A2A2A var(--vp-fill,0%));}
.vp-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:13px;height:13px;margin-top:-4.5px;border-radius:50%;background:#fff;border:2px solid #7C3AED;box-shadow:0 1px 5px rgba(0,0,0,.6);transition:transform 150ms ease;}
.vp-range:hover::-webkit-slider-thumb{transform:scale(1.14);}
.vp-range::-moz-range-track{height:4px;border-radius:4px;background:#2A2A2A;}
.vp-range::-moz-range-progress{height:4px;border-radius:4px;background:#7C3AED;}
.vp-range::-moz-range-thumb{width:12px;height:12px;border-radius:50%;background:#fff;border:2px solid #7C3AED;}
.vp-range:disabled{opacity:.4;cursor:not-allowed;}

/* ---------- toggle ---------- */
.vp-toggle{display:flex;align-items:center;gap:9px;cursor:pointer;user-select:none;}
.vp-toggle input{position:absolute;opacity:0;width:0;height:0;}
.vp-switch{flex:0 0 auto;width:32px;height:18px;border-radius:999px;background:#2A2A2A;border:1px solid #333;position:relative;transition:background 150ms ease,border-color 150ms ease;}
.vp-switch::after{content:'';position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:#8A8A8A;transition:transform 150ms ease,background 150ms ease;}
.vp-toggle input:checked + .vp-switch{background:rgba(124,58,237,.42);border-color:#7C3AED;}
.vp-toggle input:checked + .vp-switch::after{transform:translateX(14px);background:#fff;}
.vp-toggle .vp-tgl-txt{font-size:12px;font-weight:600;color:#CFCFCF;}
.vp-toggle .vp-tgl-txt small{display:block;font-size:10.5px;font-weight:500;color:#666;}

/* ---------- pills ---------- */
.vp-pills{display:flex;flex-wrap:wrap;gap:5px;}
.vp-pill{appearance:none;border:1px solid #2A2A2A;background:#161616;color:#8E8E8E;border-radius:4px;font:inherit;font-size:11px;font-weight:650;padding:4px 9px;cursor:pointer;white-space:nowrap;transition:background 150ms ease,color 150ms ease,border-color 150ms ease;}
.vp-pill:hover{color:#E2E2E2;border-color:#3A3A3A;}
.vp-pill.on{background:rgba(124,58,237,.17);border-color:rgba(124,58,237,.55);color:#C4B5FD;}

/* ---------- tiles ---------- */
.vp-grid{display:grid;gap:7px;}
.vp-grid.c2{grid-template-columns:repeat(2,minmax(0,1fr));}
.vp-grid.c3{grid-template-columns:repeat(3,minmax(0,1fr));}
.vp-tile{appearance:none;text-align:left;border:1px solid #262626;background:#131313;border-radius:8px;padding:0;overflow:hidden;cursor:pointer;color:inherit;font:inherit;transition:border-color 150ms ease,background 150ms ease,transform 150ms ease;}
.vp-tile:hover{border-color:#3C3C3C;background:#181818;}
.vp-tile.on{border-color:#7C3AED;background:rgba(124,58,237,.1);}
.vp-tile .vp-swatch{display:block;width:100%;aspect-ratio:16/10;background-size:cover;background-position:center;position:relative;}
.vp-tile .vp-swatch .vp-check{position:absolute;top:4px;right:4px;width:16px;height:16px;border-radius:50%;background:#7C3AED;display:grid;place-items:center;color:#fff;}
.vp-tile .vp-tilelab{display:block;padding:5px 7px 6px;font-size:10.5px;font-weight:700;color:#C8C8C8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.vp-tile.on .vp-tilelab{color:#DDD3FF;}
.vp-tile .vp-tilesub{display:block;padding:0 7px 7px;font-size:10px;color:#6A6A6A;line-height:1.4;}
.vp-tile.pad{padding:9px 10px;}

/* ---------- status badge ---------- */
.vp-badge{display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:2px 8px;font-size:9.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;border:1px solid;}
.vp-badge.idle{color:#6F6F6F;border-color:#2A2A2A;background:#151515;}
.vp-badge.run{color:#C4B5FD;border-color:rgba(124,58,237,.5);background:rgba(124,58,237,.14);}
.vp-badge.done{color:#6EE7B7;border-color:rgba(52,211,153,.4);background:rgba(52,211,153,.12);}
.vp-badge.fail{color:#FCA5A5;border-color:rgba(248,113,113,.4);background:rgba(248,113,113,.12);}

/* ---------- preview stage ---------- */
.vp-stage{flex:1 1 auto;min-height:0;position:relative;display:flex;align-items:center;justify-content:center;padding:16px;overflow:hidden;background:radial-gradient(ellipse at 50% 0%,#141420 0%,#0A0A0A 62%);}
.vp-stageinner{position:relative;max-width:100%;max-height:100%;display:flex;align-items:center;justify-content:center;}
.vp-stagechrome{position:absolute;left:0;right:0;bottom:0;padding:26px 14px 11px;background:linear-gradient(to top,rgba(0,0,0,.86),rgba(0,0,0,0));opacity:0;transition:opacity 200ms ease;pointer-events:none;}
.vp-stage:hover .vp-stagechrome,.vp-stagechrome.pin{opacity:1;pointer-events:auto;}
.vp-scrub{position:relative;height:16px;display:flex;align-items:center;cursor:pointer;}
.vp-scrubtrack{position:relative;height:4px;width:100%;border-radius:4px;background:rgba(255,255,255,.2);overflow:hidden;}
.vp-scrubfill{position:absolute;inset:0 auto 0 0;background:#7C3AED;border-radius:4px;}
.vp-scrubknob{position:absolute;top:50%;width:11px;height:11px;margin-left:-5.5px;border-radius:50%;background:#fff;transform:translateY(-50%);box-shadow:0 1px 6px rgba(0,0,0,.7);pointer-events:none;}
.vp-stagetop{position:absolute;top:0;left:0;right:0;display:flex;align-items:center;gap:7px;padding:10px 12px;background:linear-gradient(to bottom,rgba(0,0,0,.7),rgba(0,0,0,0));}
.vp-chip{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 8px;border-radius:4px;background:rgba(10,10,10,.72);border:1px solid rgba(255,255,255,.12);color:#CFCFCF;font-size:10.5px;font-weight:700;letter-spacing:.03em;backdrop-filter:blur(8px);}

/* ---------- drop zone ---------- */
.vp-drop{width:min(640px,100%);border:2px dashed #2F2F2F;border-radius:12px;background:#111;padding:38px 26px;text-align:center;transition:border-color 150ms ease,background 150ms ease;}
.vp-drop.hot{border-color:#7C3AED;background:rgba(124,58,237,.07);}
.vp-drop h3{margin:12px 0 5px;font-size:17px;font-weight:800;letter-spacing:-.01em;}
.vp-drop p{margin:0 0 16px;font-size:12.5px;color:#808080;line-height:1.6;}

/* ---------- timeline ---------- */
.vp-tl{grid-column:1 / -1;grid-row:2;background:#111;border-top:1px solid #2A2A2A;display:flex;flex-direction:column;}
.vp-tlbar{flex:0 0 auto;display:flex;align-items:center;gap:8px;height:34px;padding:0 10px;border-bottom:1px solid #202020;background:#141414;}
.vp-tlwrap{position:relative;overflow-x:auto;overflow-y:hidden;}
.vp-tlgrid{position:relative;min-width:100%;}
.vp-ruler{position:relative;height:22px;border-bottom:1px solid #222;background:#131313;}
.vp-ruler span{position:absolute;top:0;bottom:0;border-left:1px solid #2C2C2C;padding-left:4px;font-size:9.5px;color:#5E5E5E;line-height:22px;font-family:'JetBrains Mono',ui-monospace,monospace;pointer-events:none;}
.vp-trk{position:relative;height:38px;border-bottom:1px solid #1C1C1C;background:#0F0F0F;}
.vp-trk:nth-child(even){background:#121212;}
.vp-trkhead{flex:0 0 76px;width:76px;display:flex;flex-direction:column;justify-content:center;gap:1px;padding:0 8px;border-right:1px solid #222;background:#141414;}
.vp-trkhead b{font-size:9.5px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:#8A8A8A;display:flex;align-items:center;gap:4px;}
.vp-clip{position:absolute;top:4px;bottom:4px;border-radius:5px;overflow:hidden;cursor:pointer;border:1px solid rgba(255,255,255,.14);display:flex;align-items:center;transition:box-shadow 150ms ease,border-color 150ms ease;}
.vp-clip:hover{border-color:rgba(255,255,255,.34);}
.vp-clip.on{border-color:#fff;box-shadow:0 0 0 1px #fff,0 2px 12px rgba(0,0,0,.6);}
.vp-cliplab{position:relative;z-index:2;padding:0 7px;font-size:10px;font-weight:700;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.9);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;}
.vp-handle{position:absolute;top:0;bottom:0;width:8px;z-index:4;cursor:ew-resize;background:linear-gradient(90deg,rgba(255,255,255,.3),rgba(255,255,255,0));}
.vp-handle.r{right:0;background:linear-gradient(270deg,rgba(255,255,255,.3),rgba(255,255,255,0));}
.vp-handle:hover{background:rgba(255,255,255,.5);}
.vp-key{position:absolute;bottom:3px;width:7px;height:7px;margin-left:-3.5px;background:#FDE68A;border:1px solid #92400E;transform:rotate(45deg);z-index:5;cursor:pointer;}
.vp-key.on{background:#fff;border-color:#7C3AED;}
.vp-trans{position:absolute;top:50%;transform:translate(-50%,-50%);z-index:6;height:17px;padding:0 6px;border-radius:4px;background:#1E1E1E;border:1px solid #3A3A3A;color:#B9B9B9;font-size:9px;font-weight:800;letter-spacing:.04em;cursor:pointer;display:inline-flex;align-items:center;gap:3px;white-space:nowrap;transition:background 150ms ease,color 150ms ease,border-color 150ms ease;}
.vp-trans:hover{background:#7C3AED;border-color:#7C3AED;color:#fff;}
.vp-playhead{position:absolute;top:0;bottom:0;width:1px;background:#FF3B30;z-index:9;pointer-events:none;}
.vp-playhead::before{content:'';position:absolute;top:0;left:-5px;width:11px;height:9px;background:#FF3B30;clip-path:polygon(0 0,100% 0,50% 100%);}
.vp-trk{cursor:crosshair;}

/* ---------- context menu ---------- */
.vp-menu{position:fixed;z-index:120;min-width:182px;background:#1A1A1A;border:1px solid #333;border-radius:8px;padding:5px;box-shadow:0 18px 48px rgba(0,0,0,.72);}
.vp-menu button{display:flex;align-items:center;gap:9px;width:100%;appearance:none;border:none;background:transparent;color:#D2D2D2;font:inherit;font-size:12px;font-weight:600;padding:7px 9px;border-radius:5px;cursor:pointer;text-align:left;transition:background 150ms ease,color 150ms ease;}
.vp-menu button:hover{background:#7C3AED;color:#fff;}
.vp-menu button.danger{color:#FCA5A5;}
.vp-menu button.danger:hover{background:rgba(248,113,113,.22);color:#FECACA;}
.vp-menu kbd{margin-left:auto;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:9.5px;color:#6A6A6A;background:#121212;border:1px solid #2E2E2E;border-radius:3px;padding:1px 4px;}
.vp-menu hr{border:none;border-top:1px solid #2A2A2A;margin:4px 2px;}

/* ---------- agent drawer ---------- */
.vp-scrim{position:absolute;inset:0;z-index:40;background:rgba(5,5,7,.6);backdrop-filter:blur(2px);animation:vp-fade 200ms ease;}
.vp-agent{position:absolute;top:0;bottom:0;left:0;z-index:41;width:340px;max-width:86vw;display:flex;flex-direction:column;background:#141414;border-right:1px solid #2A2A2A;box-shadow:24px 0 56px rgba(0,0,0,.62);animation:vp-slide 200ms ease;}
.vp-agenthead{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:11px 12px;border-bottom:1px solid #242424;}
.vp-agentscroll{flex:1 1 auto;min-height:0;overflow-y:auto;padding:11px;display:flex;flex-direction:column;gap:8px;}
.vp-act{display:flex;gap:9px;width:100%;appearance:none;text-align:left;border:1px solid #262626;background:#171717;border-radius:8px;padding:9px 10px;cursor:pointer;color:inherit;font:inherit;transition:border-color 150ms ease,background 150ms ease;}
.vp-act:hover:not(:disabled){border-color:#3C3C3C;background:#1C1C1C;}
.vp-act:disabled{opacity:.45;cursor:not-allowed;}
.vp-act .vp-actico{flex:0 0 auto;width:26px;height:26px;border-radius:6px;display:grid;place-items:center;background:rgba(124,58,237,.14);color:#C4B5FD;}
.vp-act b{display:block;font-size:12px;font-weight:700;color:#E8E8E8;}
.vp-act small{display:block;font-size:10.5px;color:#6E6E6E;line-height:1.45;margin-top:1px;}
.vp-agentfoot{flex:0 0 auto;border-top:1px solid #242424;padding:9px;display:flex;gap:6px;}
.vp-chatlog{display:flex;flex-direction:column;gap:6px;}
.vp-msg{border-radius:7px;padding:7px 9px;font-size:11.5px;line-height:1.55;}
.vp-msg.me{background:rgba(124,58,237,.16);border:1px solid rgba(124,58,237,.3);color:#E4DAFF;}
.vp-msg.bot{background:#181818;border:1px solid #262626;color:#BFBFBF;}

/* ---------- modal ---------- */
.vp-overlay{position:fixed;inset:0;z-index:130;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(4,4,6,.78);backdrop-filter:blur(3px);animation:vp-fade 150ms ease;}
.vp-modal{width:min(520px,100%);max-height:88vh;overflow-y:auto;background:#141414;border:1px solid #2A2A2A;border-radius:12px;box-shadow:0 30px 80px rgba(0,0,0,.76);}
.vp-modal.wide{width:min(760px,100%);}
.vp-modalhead{display:flex;align-items:center;gap:9px;padding:14px 16px;border-bottom:1px solid #242424;}
.vp-modalhead h3{margin:0;font-size:15px;font-weight:800;letter-spacing:-.01em;}
.vp-modalbody{padding:16px;display:flex;flex-direction:column;gap:14px;}
.vp-modalfoot{display:flex;align-items:center;gap:8px;padding:13px 16px;border-top:1px solid #242424;background:#121212;border-radius:0 0 12px 12px;}
.vp-bar{height:6px;border-radius:6px;background:#242424;overflow:hidden;}
.vp-bar i{display:block;height:100%;border-radius:6px;background:linear-gradient(90deg,#7C3AED,#A78BFA);transition:width 200ms ease;}

/* ---------- toast ---------- */
.vp-toasts{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);z-index:140;display:flex;flex-direction:column;gap:7px;align-items:center;pointer-events:none;}
.vp-toast{pointer-events:auto;display:flex;align-items:center;gap:9px;max-width:460px;background:#1C1C1C;border:1px solid #333;border-radius:8px;padding:9px 13px;font-size:12px;font-weight:600;color:#E6E6E6;box-shadow:0 14px 36px rgba(0,0,0,.6);animation:vp-rise 200ms ease;}
.vp-toast.bad{border-color:rgba(248,113,113,.45);color:#FECACA;}
.vp-toast.good{border-color:rgba(52,211,153,.4);color:#A7F3D0;}

@keyframes vp-fade{from{opacity:0}to{opacity:1}}
@keyframes vp-slide{from{transform:translateX(-18px);opacity:0}to{transform:translateX(0);opacity:1}}
@keyframes vp-rise{from{transform:translateY(8px);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes vp-spin{to{transform:rotate(360deg)}}
.vp-spin{animation:vp-spin 1s linear infinite;}

/* ---------- responsive: stack the panel under the preview ---------- */
@media (max-width:900px){
  .vp-body{grid-template-columns:minmax(0,1fr);grid-template-rows:auto auto auto;overflow-y:auto;}
  .vp-stagecol{grid-column:1;grid-row:1;min-height:44vh;}
  .vp-tl{grid-column:1;grid-row:2;}
  .vp-side{grid-column:1;grid-row:3;width:100%;border-left:none;border-top:1px solid #2A2A2A;}
  .vp-sidescroll{max-height:none;overflow:visible;}
  .vp-tabs{grid-template-columns:repeat(3,minmax(0,1fr));}
  .vp-agent{width:min(320px,86vw);}
  .vp-trkhead{flex-basis:56px;width:56px;}
}
@media (prefers-reduced-motion:reduce){
  .vp-root *,.vp-root *::before,.vp-root *::after{animation-duration:.001ms !important;transition-duration:.001ms !important;}
}
`;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export function Section(props: {
  title: string;
  hint?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="vp-sec">
      <div className="vp-sechead">
        <h4>{props.title}</h4>
        {props.hint ? <span className="vp-hint">{props.hint}</span> : null}
        {props.right ? <span className="vp-spread">{props.right}</span> : null}
      </div>
      <div className="vp-secbody">{props.children}</div>
    </section>
  );
}

export function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  onCommit?: () => void;
}) {
  const span = Math.max(0.000001, props.max - props.min);
  const fill = `${Math.max(0, Math.min(100, ((props.value - props.min) / span) * 100)).toFixed(2)}%`;
  const shown = props.format
    ? props.format(props.value)
    : `${Math.round(props.value * 100) / 100}${props.suffix || ''}`;
  return (
    <label className="vp-slider">
      <span className="vp-slidertop">
        <span>{props.label}</span>
        <b>{shown}</b>
      </span>
      <input
        className="vp-range"
        type="range"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        disabled={props.disabled}
        aria-label={props.label}
        style={{ '--vp-fill': fill } as CSSProperties}
        onPointerDown={props.onCommit}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );
}

export function Toggle(props: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="vp-toggle">
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span className="vp-switch" />
      <span className="vp-tgl-txt">
        {props.label}
        {props.hint ? <small>{props.hint}</small> : null}
      </span>
    </label>
  );
}

export function Pills<T extends string>(props: {
  options: { id: T; label: string; title?: string }[];
  value: T | null;
  onPick: (id: T) => void;
}) {
  return (
    <div className="vp-pills">
      {props.options.map((o) => (
        <button
          key={o.id}
          type="button"
          title={o.title}
          className={`vp-pill${props.value === o.id ? ' on' : ''}`}
          onClick={() => props.onPick(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field(props: { label: string; children: ReactNode }) {
  return (
    <div>
      <span className="vp-label">{props.label}</span>
      {props.children}
    </div>
  );
}

export type RunState = 'idle' | 'running' | 'done' | 'failed';

export function StatusBadge({ state }: { state: RunState }) {
  if (state === 'running') return <span className="vp-badge run">Working</span>;
  if (state === 'done') return <span className="vp-badge done">Done</span>;
  if (state === 'failed') return <span className="vp-badge fail">Failed</span>;
  return <span className="vp-badge idle">Idle</span>;
}

export function Modal(props: {
  title: string;
  icon?: ReactNode;
  wide?: boolean;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className="vp-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={props.title}
      onClick={props.onClose}
    >
      <div className={`vp-modal${props.wide ? ' wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="vp-modalhead">
          {props.icon}
          <h3>{props.title}</h3>
          <button type="button" className="vp-ico sm vp-spread" aria-label="Close" onClick={props.onClose}>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="vp-modalbody">{props.children}</div>
        {props.footer ? <div className="vp-modalfoot">{props.footer}</div> : null}
      </div>
    </div>
  );
}

/** `mm:ss.ff` at 30 fps — the timecode the ruler and the transport both show. */
export function timecode(seconds: number): string {
  const s = Math.max(0, Number(seconds) || 0);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const frames = Math.floor((s % 1) * 30);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(frames).padStart(2, '0')}`;
}

export function clampNum(v: number, lo: number, hi: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
