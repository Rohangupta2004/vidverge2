/**
 * Short Video Enhancer — Phase 2 stylesheet.
 *
 * Loaded AFTER the Phase 1 redesign's stylesheet, so it extends that look
 * rather than replacing it: same ink (#0D0B05), same amber accent, same
 * panel geometry. Three things it deliberately overrides:
 *
 *   1. `.preview-copy.caption` — the Phase 1 caption drew a solid plate behind
 *      the whole line. Captions now sit straight on the picture.
 *   2. the 820px breakpoint — Phase 1 let the layout scroll sideways on a
 *      phone. It now STACKS: preview on top, controls underneath.
 *   3. focus rings — every interactive control gets a visible one.
 */

export const SVE_PHASE2_STYLES = `
/* --- the caption plate is gone for good ---------------------------------- */
.sve-premium .preview-copy.caption{background:transparent!important;padding:0!important;border-radius:0!important}
.sve-premium .sve-safe-area{inset:7% 8%;border-color:color-mix(in srgb,#FCD34D 16%,transparent)}
.sve-premium .sve-safe-area.hidden{display:none}

/* --- caption track ---------------------------------------------------------
   Inter is named explicitly rather than inherited: the Remotion composition
   renders these words with an Inter stack of its own, and a caption drawn in
   one face here and another in the export is exactly the mismatch this whole
   pipeline exists to prevent. */
.sve-caption-track{position:absolute;left:8%;width:84%;transform:translateY(-50%);text-align:center;pointer-events:none;z-index:6;line-height:1.14;font-family:'Inter','Montserrat',system-ui,-apple-system,'Segoe UI',sans-serif}
.sve-cap-word{display:inline-block;margin:0 .14em;font-weight:800;letter-spacing:-.012em;transform-origin:center bottom;-webkit-font-smoothing:antialiased}
.sve-cap-word.pill{border-radius:.26em;padding:.08em .22em;margin:0 .09em;background:rgba(10,10,16,.4)}
.sve-cap-empty{position:absolute;left:0;right:0;bottom:12%;text-align:center;color:rgba(255,255,255,.45);font-size:10px;letter-spacing:1.4px;text-transform:uppercase;pointer-events:none}
/* The five tiers. Everything else about a tier (size, weight, tracking,
   position, entrance) is inline, because the Remotion composition has to
   compute the same numbers and cannot read a stylesheet. Only the line box
   lives here — and 'Word' in lib/sveComposition.ts mirrors these three
   numbers. */
.sve-caption-track.tier-cinematic,.sve-caption-track.tier-beat{line-height:1.04}
.sve-caption-track.tier-ui{line-height:1.26}

/* --- two-up segmented control (caption language) -------------------------- */
.sve-segmented.two{grid-template-columns:repeat(2,1fr)}

/* --- preview cards + b-roll ---------------------------------------------- */
.sve-pv-card{position:absolute;left:9%;right:9%;display:flex;flex-direction:column;align-items:center;text-align:center;pointer-events:none;z-index:5}
.sve-pv-card .body{padding:9px 13px;border-radius:9px;box-shadow:0 10px 30px rgba(0,0,0,.45)}
.sve-pv-card strong{display:block;font-size:15px;font-weight:900;line-height:1.08;letter-spacing:-.4px;color:#fff;text-shadow:0 2px 8px rgba(0,0,0,.5)}
.sve-pv-card small{display:block;margin-top:4px;font-size:9px;font-weight:700}
.sve-pv-lower{position:absolute;left:8%;bottom:14%;display:flex;gap:7px;align-items:stretch;z-index:5;pointer-events:none}
.sve-pv-lower i{width:3px;border-radius:2px}
.sve-pv-lower div{padding:7px 11px;border-radius:7px;background:rgba(8,8,14,.62);border:1px solid rgba(255,255,255,.12);text-align:left}
.sve-pv-broll{position:absolute;overflow:hidden;z-index:4;pointer-events:none}
.sve-pv-broll video{width:100%;height:100%;object-fit:cover;display:block}
.sve-pv-broll.corner{right:5.5%;top:8%;width:38%;aspect-ratio:16/9;border-radius:11px;border:2px solid rgba(255,255,255,.2);box-shadow:0 10px 30px rgba(0,0,0,.5)}
.sve-pv-broll.split{left:0;right:0;top:50%;height:50%;border-top:2px solid rgba(255,255,255,.16)}
.sve-pv-broll.blend{inset:0}

/* --- generic Phase 2 chrome ---------------------------------------------- */
.sve-premium :focus-visible{outline:2px solid #C8920A;outline-offset:2px;border-radius:6px}
.sve-note{display:flex;gap:6px;align-items:flex-start;margin:0 0 10px;padding:8px 9px;border-radius:8px;font-size:9.5px;line-height:1.45;border:1px solid color-mix(in srgb,#C8920A 26%,transparent);background:color-mix(in srgb,#C8920A 10%,transparent);color:#3D2800}
.sve-note svg{flex:0 0 auto;margin-top:1px}
.sve-note.warn{border-color:color-mix(in srgb,#B45309 34%,transparent);background:color-mix(in srgb,#B45309 10%,transparent);color:#B45309}
.sve-note.bad{border-color:color-mix(in srgb,#991B1B 38%,transparent);background:color-mix(in srgb,#991B1B 10%,transparent);color:#991B1B}
.sve-note.good{border-color:color-mix(in srgb,#166534 30%,transparent);background:color-mix(in srgb,#166534 9%,transparent);color:#166534}
.sve-muted{color:#7A6030;font-size:9px;line-height:1.5;margin:6px 0 0}

/* --- caption style picker ------------------------------------------------- */
.sve-cap-styles{display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-bottom:12px}
.sve-cap-styles button{position:relative;padding:9px 7px 7px;border:1px solid rgba(180,120,0,0.24);border-radius:9px;background:#15120A;cursor:pointer;text-align:center;transition:all .16s}
.sve-cap-styles button:hover{border-color:rgba(180,120,0,0.5)}
.sve-cap-styles button.active{border-color:#C8920A;box-shadow:0 0 0 1px color-mix(in srgb,#C8920A 26%,transparent),0 0 13px color-mix(in srgb,#C8920A 18%,transparent)}
.sve-cap-styles em{display:block;font-style:normal;font-size:14px;font-weight:900;line-height:1;letter-spacing:-.4px;color:#fff}
.sve-cap-styles em.gradient{background:linear-gradient(180deg,#fff 10%,#F59E0B 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
.sve-cap-styles em.outline{color:#fff;text-shadow:-1.5px 0 0 #000,1.5px 0 0 #000,0 -1.5px 0 #000,0 1.5px 0 #000}
.sve-cap-styles em.boxed{display:inline-block;padding:2px 6px;border-radius:5px;background:rgba(10,10,16,.6)}
.sve-cap-styles small{display:block;margin-top:6px;font-size:8px;color:#9E8B55;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sve-cap-styles button.active small{color:#FCD34D}

/* --- music studio --------------------------------------------------------- */
.sve-wave{display:flex;align-items:flex-end;gap:1px;height:46px;padding:6px 8px;margin:9px 0;border:1px solid rgba(180,120,0,0.14);border-radius:9px;background:linear-gradient(180deg,#FFFAEB,#FFFDF4);overflow:hidden}
.sve-wave i{flex:1;min-width:1px;border-radius:1px;background:linear-gradient(180deg,#E8B737,#C8920A);opacity:.9}
.sve-wave.empty{align-items:center;justify-content:center;color:#7A6030;font-size:9px;letter-spacing:.6px}
.sve-wave-skeleton i{background:rgba(180,120,0,0.18);animation:sve-pulse 1.3s ease-in-out infinite}
.sve-prompt{width:100%;min-height:66px;resize:vertical;line-height:1.5;border:1px solid rgba(180,120,0,0.14);border-radius:8px;background:#FFFAEB;color:#1A1000;padding:8px 9px;outline:none;font-size:11px}
.sve-prompt:focus{border-color:#C8920A;box-shadow:0 0 0 3px color-mix(in srgb,#C8920A 14%,transparent)}
.sve-mix{display:grid;gap:3px;margin-bottom:11px}
.sve-mix-head{display:flex;align-items:center;justify-content:space-between;color:#7A6030;font-size:11px}
.sve-mix-head b{font-size:10px;color:#1A1000;font-variant-numeric:tabular-nums}
.sve-btn-row{display:grid;grid-template-columns:1fr auto;gap:6px}

/* --- b-roll timeline ------------------------------------------------------ */
.sve-broll-list{display:flex;flex-direction:column;gap:6px;margin-bottom:9px}
.sve-broll-row{display:grid;grid-template-columns:52px 1fr auto;gap:8px;align-items:center;padding:7px;border:1px solid rgba(180,120,0,0.14);border-radius:9px;background:#FFFFFF}
.sve-broll-row.selected{border-color:#C8920A;background:#FFF3D6}
.sve-broll-thumb{width:52px;height:34px;border-radius:6px;background:#FFFAEB center/cover no-repeat;border:1px solid rgba(180,120,0,0.14);flex:0 0 auto}
.sve-broll-meta{min-width:0}
.sve-broll-meta strong{display:block;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sve-broll-meta small{display:block;margin-top:2px;font-size:8px;color:#7A6030;letter-spacing:.4px}
.sve-broll-bar{position:relative;height:22px;margin:8px 0 10px;border:1px solid rgba(180,120,0,0.14);border-radius:7px;background:#FFFAEB;overflow:hidden}
.sve-broll-bar span{position:absolute;top:2px;bottom:2px;border-radius:4px;background:linear-gradient(135deg,#C8920A,#E8B737);opacity:.75;cursor:pointer}
.sve-broll-bar span.selected{opacity:1;box-shadow:0 0 0 1px #FFFFFF inset}
.sve-broll-bar em{position:absolute;top:0;bottom:0;width:2px;background:#1A1000;opacity:.7}
.sve-chiprow{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:9px}
.sve-chip{padding:5px 8px;border:1px solid rgba(180,120,0,0.36);border-radius:999px;background:#FFF3D6;color:#B4720A;font-size:9px;cursor:pointer;transition:all .15s}
.sve-chip:hover{border-color:#C8920A;color:#1A1000}
.sve-chip.plain{border-color:rgba(180,120,0,0.14);background:#FFFAEB;color:#7A6030;cursor:default}
.sve-search{display:grid;grid-template-columns:1fr auto;gap:6px;margin-bottom:9px}
.sve-stock{display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-bottom:8px}
.sve-stock button{position:relative;padding:0;border:1px solid rgba(180,120,0,0.14);border-radius:8px;background:#FFFAEB center/cover no-repeat;aspect-ratio:9/13;cursor:pointer;overflow:hidden}
.sve-stock button:hover{border-color:#C8920A}
.sve-stock button b{position:absolute;left:4px;bottom:4px;padding:2px 5px;border-radius:4px;background:rgba(6,6,12,.78);font-size:7.5px;font-weight:700;color:#FCD34D}

/* --- optimization tips ---------------------------------------------------- */
.sve-checklist{display:flex;flex-direction:column;gap:6px}
.sve-check{display:grid;grid-template-columns:18px 1fr;gap:8px;align-items:start;padding:7px 8px;border:1px solid rgba(180,120,0,0.14);border-radius:8px;background:#FFFFFF}
.sve-check.done{border-color:color-mix(in srgb,#166534 26%,transparent)}
.sve-check>span:first-child{display:grid;place-items:center;width:18px;height:18px;border-radius:50%;background:#FFFAEB;color:#7A6030}
.sve-check.done>span:first-child{background:color-mix(in srgb,#166534 20%,transparent);color:#166534}
.sve-check strong{display:block;font-size:10px;color:#1A1000}
.sve-check small{display:block;margin-top:2px;font-size:8.5px;line-height:1.45;color:#7A6030}
.sve-check button{margin-top:6px;padding:4px 8px;border:1px solid rgba(180,120,0,0.36);border-radius:6px;background:#FFF3D6;color:#B4720A;font-size:8.5px;font-weight:700;cursor:pointer}
.sve-check button:hover{border-color:#C8920A;color:#1A1000}
.sve-score{display:flex;align-items:center;gap:9px;margin-bottom:11px}
.sve-score-ring{position:relative;width:44px;height:44px;flex:0 0 auto;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:900;color:#1A1000}
.sve-score-copy strong{display:block;font-size:11px}
.sve-score-copy small{display:block;margin-top:2px;font-size:8.5px;color:#7A6030}

/* --- export --------------------------------------------------------------- */
.sve-variant{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;padding:9px 10px;margin-bottom:7px;border:1px solid rgba(180,120,0,0.36);border-radius:9px;background:linear-gradient(135deg,#FFF3D6,#FFFAEB)}
.sve-variant strong{display:block;font-size:10.5px;color:#1A1000}
.sve-variant small{display:block;margin-top:3px;font-size:8.5px;color:#7A6030}
.sve-variant button{height:30px;padding:0 11px;border:0;border-radius:7px;background:linear-gradient(135deg,#C8920A,#E8B737);color:#fff;font-size:9.5px;font-weight:800;letter-spacing:.3px;cursor:pointer;display:flex;align-items:center;gap:5px}
.sve-variant button:hover{filter:brightness(1.15)}
.sve-variant button.ghost{background:#FFFFFF;border:1px solid rgba(180,120,0,0.14);color:#3D2800}
.sve-variant button:disabled{opacity:.55;cursor:not-allowed}
.sve-progress{height:5px;margin:3px 0 9px;border-radius:99px;background:rgba(180,120,0,0.14);overflow:hidden}
.sve-progress i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#C8920A,#E8B737);transition:width .4s ease}
.sve-progress.indeterminate i{width:38%;animation:sve-sweep 1.25s ease-in-out infinite}
.sve-stage-list{display:flex;flex-direction:column;gap:4px;margin-bottom:9px}
.sve-stage-row{display:flex;align-items:center;gap:7px;font-size:9px;color:#7A6030}
.sve-stage-row.active{color:#C8920A}
.sve-stage-row.done{color:#7A6030}
.sve-stage-row svg{flex:0 0 auto}

/* --- history + loading ---------------------------------------------------- */
.sve-history{display:flex;gap:4px}
.sve-history button{width:30px;height:30px;display:grid;place-items:center;border:1px solid rgba(180,120,0,0.14);border-radius:8px;background:#FFFFFF;color:#7A6030;cursor:pointer}
.sve-history button:hover:not(:disabled){border-color:rgba(180,120,0,0.36);color:#C8920A}
.sve-history button:disabled{opacity:.35;cursor:not-allowed}
.sve-autosave{display:flex;align-items:center;gap:5px;font-size:8.5px;color:#7A6030;letter-spacing:.3px}
.sve-autosave.saving{color:#C8920A}
.sve-skeleton{border-radius:9px;background:linear-gradient(90deg,#FFFAEB 25%,#FFF3D6 37%,#FFFAEB 63%);background-size:400% 100%;animation:sve-shimmer 1.5s ease infinite}
.sve-stage-skeleton{position:absolute;inset:10px;border-radius:17px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:11px;color:#7A6030;font-size:10px;letter-spacing:.6px}
@keyframes sve-shimmer{0%{background-position:100% 0}100%{background-position:0 0}}
@keyframes sve-pulse{0%,100%{opacity:.35}50%{opacity:.85}}
@keyframes sve-sweep{0%{transform:translateX(-100%)}100%{transform:translateX(330%)}}
@keyframes sve-wordpop{0%{opacity:.3;transform:scale(.8)}70%{transform:scale(1.04)}100%{opacity:1;transform:scale(1)}}

/* --- MOBILE: stack preview on top, controls below ------------------------- */
@media(max-width:820px){
  .sve-premium{font-size:13px}
  .sve-layout{display:flex!important;flex-direction:column;overflow:auto!important;grid-template-columns:none!important}
  .sve-topbar{min-width:0!important;height:auto;flex:0 0 auto;padding:10px 12px;flex-wrap:wrap;gap:8px}
  .sve-top-actions{flex-wrap:wrap}
  .sve-center{order:1;flex:0 0 auto;min-height:62vh}
  .sve-panel.sve-right{order:2}
  .sve-panel.sve-left{order:3}
  .sve-panel{border-left:0!important;border-right:0!important;border-top:1px solid rgba(180,120,0,0.14);max-height:none}
  .sve-scroll{overflow:visible}
  .sve-stage-shell{padding:10px}
  .sve-phone{max-height:58vh}
  .sve-player-controls{margin:0 10px}
  .sve-cap-styles,.sve-stock{grid-template-columns:repeat(2,1fr)}
  .sve-filter-grid{grid-template-columns:repeat(4,1fr)}
  .sve-toast{left:12px;right:12px;bottom:12px;max-width:none}
}
@media(max-width:480px){
  .sve-filter-grid{grid-template-columns:repeat(3,1fr)}
  .sve-brand small{display:none}
}
`;
