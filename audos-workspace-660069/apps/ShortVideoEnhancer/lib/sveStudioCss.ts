/**
 * Short Video Enhancer — the compact studio layer.
 *
 * Loaded LAST, after `sveBaseStyles`, `sveStyles` and `PRO_CSS`, and scoped to
 * `.vp-root.sve-studio` so none of it leaks into the Video Enhancer copy of
 * the same design system (`apps/VideoEnhancer/proUi.tsx`), which must stay
 * byte-identical with `lib/sveProUi.tsx`.
 *
 * Three things live here and nowhere else:
 *
 *   1. DENSITY. The pro layout shipped at 11-16px padding and 12.5-13px type.
 *      A shorts editor is a tool, not a page, so every control drops to 8-9px
 *      padding and 10.5-12px labels.
 *   2. THE RETRACTABLE CONTROL RAIL. `--sve-side-w` drives the grid column, so
 *      collapsing the panel is one variable change and the main area always
 *      gets the width back — it never has to render underneath it.
 *   3. POINTER-EVENT HONESTY. The stage's two gradient scrims used to cover the
 *      preview edge to edge and swallow the clicks aimed at the picture behind
 *      them. They are now transparent to the pointer and only their own
 *      controls take it back.
 */

export const SVE_STUDIO_CSS = `
/* ====================================================================== */
/* 1. density                                                             */
/* ====================================================================== */
.vp-root.sve-studio{font-size:12px;}
.vp-root.sve-studio .vp-head{height:44px;padding:0 10px;gap:8px;}
.vp-root.sve-studio .vp-mark{width:26px;height:26px;border-radius:7px;}
.vp-root.sve-studio .vp-brand{gap:7px;}
.vp-root.sve-studio .vp-brand b{font-size:12.5px;}
.vp-root.sve-studio .vp-brand small{font-size:9.5px;}
.vp-root.sve-studio .vp-divider{height:18px;}

.vp-root.sve-studio .vp-btn{height:28px;padding:0 10px;gap:6px;font-size:11.5px;border-radius:5px;}
.vp-root.sve-studio .vp-btn.sm{height:25px;padding:0 8px;font-size:11px;}
.vp-root.sve-studio .vp-btn.xs{height:22px;padding:0 7px;font-size:10.5px;gap:4px;}
.vp-root.sve-studio .vp-ico{width:28px;height:28px;border-radius:5px;}
.vp-root.sve-studio .vp-ico.sm{width:24px;height:24px;}

.vp-root.sve-studio .vp-sidescroll{padding:8px 8px 10px;gap:8px;}
.vp-root.sve-studio .vp-sec{border-radius:7px;}
.vp-root.sve-studio .vp-sechead{padding:7px 9px;}
.vp-root.sve-studio .vp-sechead h4{font-size:10.5px;}
.vp-root.sve-studio .vp-sechead .vp-hint{font-size:10px;}
.vp-root.sve-studio .vp-secbody{padding:9px;gap:9px;}
.vp-root.sve-studio .vp-row{gap:7px;}

.vp-root.sve-studio .vp-label{font-size:10.5px;margin-bottom:4px;}
.vp-root.sve-studio .vp-input,
.vp-root.sve-studio .vp-select,
.vp-root.sve-studio .vp-area{font-size:12px;padding:6px 8px;border-radius:5px;}
.vp-root.sve-studio .vp-area{min-height:54px;}
.vp-root.sve-studio .vp-select{background-position:calc(100% - 14px) 12px,calc(100% - 9px) 12px;}
.vp-root.sve-studio .vp-color{width:30px;height:26px;}

.vp-root.sve-studio .vp-slidertop{margin-bottom:3px;}
.vp-root.sve-studio .vp-slidertop span:first-child{font-size:11px;}
.vp-root.sve-studio .vp-slidertop b{font-size:10.5px;}
.vp-root.sve-studio .vp-range{height:14px;}
.vp-root.sve-studio .vp-toggle{gap:8px;}
.vp-root.sve-studio .vp-tgl-txt{font-size:11.5px;}
.vp-root.sve-studio .vp-tgl-txt small{font-size:10px;}
.vp-root.sve-studio .vp-note{font-size:10.5px;line-height:1.5;}

.vp-root.sve-studio .vp-grid{gap:6px;}
.vp-root.sve-studio .vp-tile{border-radius:7px;}
.vp-root.sve-studio .vp-tile .vp-tilelab{padding:4px 6px 5px;font-size:10px;}
.vp-root.sve-studio .vp-tile .vp-tilesub{padding:0 6px 6px;font-size:9.5px;}
.vp-root.sve-studio .vp-tile.pad{padding:7px 8px;}
.vp-root.sve-studio .vp-pills{gap:4px;}
.vp-root.sve-studio .vp-pill{font-size:10.5px;padding:3px 8px;}
.vp-root.sve-studio .vp-badge{font-size:9px;padding:1px 7px;}

.vp-root.sve-studio .vp-stage{padding:10px;}
.vp-root.sve-studio .vp-stagetop{padding:8px 9px;gap:6px;}
.vp-root.sve-studio .vp-stagechrome{padding:22px 10px 9px;}
.vp-root.sve-studio .vp-tlbar{height:28px;padding:0 8px;}
.vp-root.sve-studio .vp-ruler{height:18px;}
.vp-root.sve-studio .vp-ruler span{line-height:18px;font-size:9px;}
.vp-root.sve-studio .vp-trk{height:32px;}

/* ====================================================================== */
/* 2. the retractable control rail                                        */
/* ====================================================================== */
.vp-root.sve-studio .vp-body{
  grid-template-columns:minmax(0,1fr) var(--sve-side-w,332px);
  transition:grid-template-columns 200ms ease;
}
.vp-root.sve-studio .vp-side{
  position:sticky;top:0;z-index:50;min-width:0;overflow:hidden;
  transition:all 200ms ease;
}
.vp-root.sve-studio .vp-sidehead{
  flex:0 0 auto;display:flex;align-items:center;gap:6px;height:28px;
  padding:0 5px 0 9px;background:#FFFAEB;border-bottom:1px solid rgba(180,120,0,0.14);
}
.vp-root.sve-studio .vp-sidehead b{
  font-size:9.5px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;
  color:#7A6030;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;
}
.vp-root.sve-studio .vp-sidetoggle{
  margin-left:auto;flex:0 0 auto;display:inline-grid;place-items:center;
  width:22px;height:22px;border-radius:4px;border:1px solid rgba(180,120,0,0.14);
  background:#FFFFFF;color:#7A6030;cursor:pointer;transition:all 200ms ease;
}
.vp-root.sve-studio .vp-sidetoggle:hover{
  color:#C8920A;border-color:rgba(180,120,0,0.36);background:rgba(200,146,10,.16);
}
.vp-root.sve-studio .vp-sidetoggle svg{transition:transform 200ms ease;}

.vp-root.sve-studio .vp-tab{padding:6px 2px 5px;gap:3px;font-size:9.5px;}
.vp-root.sve-studio .vp-tabico{display:inline-flex;}
.vp-root.sve-studio .vp-tablab{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}

/* collapsed: a vertical icon rail, nothing else */
.vp-root.sve-studio .vp-side.collapsed .vp-sidehead{padding:0 3px;}
.vp-root.sve-studio .vp-side.collapsed .vp-sidehead b{display:none;}
.vp-root.sve-studio .vp-side.collapsed .vp-sidetoggle{margin:0 auto;}
.vp-root.sve-studio .vp-side.collapsed .vp-tabs,
.vp-root.sve-studio .vp-side.collapsed .vp-tabs.c7{
  grid-template-columns:minmax(0,1fr);border-bottom:none;
  /* seven stacked icons can out-grow a short viewport — let the rail scroll
     rather than clipping the last tabs out of reach */
  flex:1 1 auto;min-height:0;overflow-y:auto;align-content:start;
}
.vp-root.sve-studio .vp-side.collapsed .vp-tab{
  padding:9px 2px;border-bottom:none;border-right:2px solid transparent;
}
.vp-root.sve-studio .vp-side.collapsed .vp-tab[aria-selected="true"]{
  border-bottom-color:transparent;border-right-color:#C8920A;
}
.vp-root.sve-studio .vp-side.collapsed .vp-tablab{display:none;}
.vp-root.sve-studio .vp-side.collapsed .vp-sidescroll,
.vp-root.sve-studio .vp-side.collapsed .vp-sidefoot{display:none;}

/* ====================================================================== */
/* 3. accordion sections                                                  */
/* ====================================================================== */
.vp-root.sve-studio .vp-acc{
  background:#FFFFFF;border:1px solid rgba(180,120,0,0.14);border-radius:7px;overflow:hidden;
  transition:all 200ms ease;
}
.vp-root.sve-studio .vp-acc.open{border-color:rgba(180,120,0,0.36);}
.vp-root.sve-studio .vp-acchit{
  display:flex;align-items:center;gap:7px;width:100%;appearance:none;
  border:none;border-bottom:1px solid transparent;background:#FFFAEB;
  color:inherit;font:inherit;padding:7px 9px;cursor:pointer;text-align:left;
  transition:all 200ms ease;
}
.vp-root.sve-studio .vp-acchit:hover{background:#FFF3D6;}
.vp-root.sve-studio .vp-acc.open .vp-acchit{background:#FFF3D6;border-bottom-color:rgba(180,120,0,0.14);}
.vp-root.sve-studio .vp-accico{
  display:inline-grid;place-items:center;width:18px;height:18px;flex:0 0 auto;
  border-radius:4px;background:rgba(200,146,10,.14);color:#C8920A;
  transition:all 200ms ease;
}
.vp-root.sve-studio .vp-acc.open .vp-accico{background:rgba(200,146,10,.26);color:#B4720A;}
.vp-root.sve-studio .vp-acchit h4{
  margin:0;font-size:10.5px;font-weight:800;letter-spacing:.06em;
  text-transform:uppercase;color:#3D2800;white-space:nowrap;flex:0 0 auto;
}
.vp-root.sve-studio .vp-acc.open .vp-acchit h4{color:#1A1000;}
.vp-root.sve-studio .vp-acchit .vp-hint{
  font-size:10px;font-weight:600;color:#7A6030;min-width:0;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.vp-root.sve-studio .vp-accgap{flex:1 1 auto;min-width:4px;}
.vp-root.sve-studio .vp-accchev{
  flex:0 0 auto;display:inline-flex;color:#7A6030;transform:rotate(0deg);
  transition:transform 200ms ease,color 200ms ease;
}
.vp-root.sve-studio .vp-acc.open .vp-accchev{transform:rotate(180deg);color:#C8920A;}
.vp-root.sve-studio .vp-accbody{padding:9px;display:flex;flex-direction:column;gap:9px;}

/* ====================================================================== */
/* 4. sticky Apply / Export call to action                                */
/* ====================================================================== */
.vp-root.sve-studio .vp-sidefoot{
  flex:0 0 auto;position:sticky;bottom:0;z-index:3;
  display:flex;flex-direction:column;gap:6px;padding:8px;
  background:linear-gradient(to top,#FFFDF4,#FFFAEB);
  border-top:1px solid rgba(180,120,0,0.14);box-shadow:0 -10px 24px rgba(120,80,0,0.12);
}
.vp-root.sve-studio .vp-sidefoot .vp-btn{width:100%;}
.vp-root.sve-studio .vp-footrow{display:grid;grid-template-columns:1fr 1fr;gap:6px;}
.vp-root.sve-studio .vp-footnote{
  margin:0;font-size:9.5px;line-height:1.4;color:#7A6030;text-align:center;
}

/* ====================================================================== */
/* 5. active / inactive hierarchy                                         */
/* ====================================================================== */
.vp-root.sve-studio .vp-tile{opacity:.84;}
.vp-root.sve-studio .vp-tile:hover:not(:disabled){opacity:1;}
.vp-root.sve-studio .vp-tile.on{
  opacity:1;border-color:#C8920A;
  background:color-mix(in srgb,#C8920A 16%,transparent);
  box-shadow:0 0 0 1px color-mix(in srgb,#C8920A 46%,transparent),
             0 4px 16px color-mix(in srgb,#C8920A 22%,transparent);
}
.vp-root.sve-studio .vp-tile:disabled{opacity:.4;cursor:not-allowed;}
.vp-root.sve-studio .vp-tile:disabled:hover{opacity:.4;border-color:rgba(180,120,0,0.14);background:#FFFAEB;}
.vp-root.sve-studio .vp-pill{opacity:.88;}
.vp-root.sve-studio .vp-pill:hover:not(:disabled){opacity:1;}
.vp-root.sve-studio .vp-pill.on{
  opacity:1;box-shadow:0 0 0 1px color-mix(in srgb,#C8920A 42%,transparent);
}
.vp-root.sve-studio .vp-pill:disabled{opacity:.4;cursor:not-allowed;}
.vp-root.sve-studio .vp-btn,
.vp-root.sve-studio .vp-ico,
.vp-root.sve-studio .vp-tile,
.vp-root.sve-studio .vp-pill,
.vp-root.sve-studio .vp-tab{transition:all 200ms ease;}

/* ====================================================================== */
/* 6. honest "not built yet" controls                                     */
/* ====================================================================== */
.vp-root.sve-studio .vp-soon{opacity:.4;cursor:not-allowed;}
.vp-root.sve-studio .vp-soon *{cursor:not-allowed;pointer-events:none;}
.vp-root.sve-studio .vp-soonbadge{
  display:inline-flex;align-items:center;gap:3px;flex:0 0 auto;
  border:1px solid rgba(180,120,0,0.14);border-radius:999px;padding:1px 6px;
  font-size:9px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;
  color:#7A6030;background:#FFFAEB;
}

/* ====================================================================== */
/* 7. nothing blocks a click it does not own                              */
/* ====================================================================== */
.vp-root.sve-studio button:not(:disabled),
.vp-root.sve-studio input:not(:disabled),
.vp-root.sve-studio select:not(:disabled),
.vp-root.sve-studio textarea:not(:disabled),
.vp-root.sve-studio audio,
.vp-root.sve-studio label,
.vp-root.sve-studio [role="tab"],
.vp-root.sve-studio [role="switch"]{pointer-events:auto;}
.vp-root.sve-studio .vp-stagetop,
.vp-root.sve-studio .vp-stagechrome,
.vp-root.sve-studio .vp-stagechrome.pin{pointer-events:none;}
.vp-root.sve-studio .vp-stagetop > *,
.vp-root.sve-studio .vp-stagechrome .vp-row > *,
.vp-root.sve-studio .vp-stagechrome .vp-scrub{pointer-events:auto;}

/* ====================================================================== */
/* 8. the agent drawer's own sections, at the same density                */
/* ====================================================================== */
.vp-root.sve-studio .vp-agent{width:320px;}
.vp-root.sve-studio .vp-agentscroll{padding:9px;gap:7px;}
.vp-root.sve-studio .vp-act{padding:8px 9px;gap:8px;}
.vp-root.sve-studio .vp-agent .sve-section{
  border:1px solid rgba(180,120,0,0.14);border-radius:7px;background:#FFFFFF;overflow:hidden;
  transition:all 200ms ease;
}
.vp-root.sve-studio .vp-agent .sve-section-head{
  height:32px;padding:0 10px;background:#FFFAEB;transition:all 200ms ease;
}
.vp-root.sve-studio .vp-agent .sve-section-head:hover{background:#FFF3D6;}
.vp-root.sve-studio .vp-agent .sve-section-head span{font-size:9.5px;}
.vp-root.sve-studio .vp-agent .sve-section-body{padding:2px 10px 10px;}
.vp-root.sve-studio .vp-agent .sve-action{height:30px;margin:4px 0 10px;font-size:9.5px;}
.vp-root.sve-studio .vp-agent .sve-field{gap:5px;margin-bottom:9px;}
.vp-root.sve-studio .vp-agent .sve-slider{margin:0 0 10px;}

/* ====================================================================== */
/* 9. the caption tier editor                                             */
/* ====================================================================== */
.vp-root.sve-studio .sve-tiermix{display:flex;gap:2px;height:7px;border-radius:99px;overflow:hidden;background:#FFFAEB;}
.vp-root.sve-studio .sve-tiermix i{display:block;min-width:3px;border-radius:99px;}
.vp-root.sve-studio .sve-tierlist{
  display:flex;flex-direction:column;gap:5px;
  /* A long transcript is a long list. Cap it and scroll rather than pushing
     every control below it off the panel. */
  max-height:340px;overflow-y:auto;padding-right:2px;
}
.vp-root.sve-studio .sve-tierrow{
  display:flex;flex-direction:column;gap:5px;padding:5px 6px;
  border:1px solid rgba(180,120,0,0.14);border-left:3px solid rgba(180,120,0,0.14);border-radius:6px;background:#FFFFFF;
  transition:border-color 200ms ease,background 200ms ease;
}
.vp-root.sve-studio .sve-tierrow.live{border-color:rgba(180,120,0,0.36);background:rgba(200,146,10,.08);}
.vp-root.sve-studio .sve-tierrow.assigned{border-left-color:#C8920A;}
.vp-root.sve-studio .sve-tierhead{display:flex;align-items:center;gap:6px;min-width:0;}
.vp-root.sve-studio .sve-tiertime{
  flex:0 0 auto;appearance:none;border:1px solid rgba(180,120,0,0.14);border-radius:4px;background:#FFFAEB;
  color:#7A6030;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:9.5px;
  font-variant-numeric:tabular-nums;padding:2px 5px;cursor:pointer;transition:all 200ms ease;
}
.vp-root.sve-studio .sve-tiertime:hover{color:#C8920A;border-color:rgba(180,120,0,0.36);}
.vp-root.sve-studio .sve-tierdot{flex:0 0 auto;width:7px;height:7px;border-radius:50%;}
.vp-root.sve-studio .sve-tiertext{
  flex:1 1 auto;min-width:0;font-size:11px;color:#3D2800;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.vp-root.sve-studio .sve-tierpick{
  flex:0 0 auto;width:116px;padding:3px 20px 3px 6px;font-size:10.5px;
  background-position:calc(100% - 11px) 10px,calc(100% - 7px) 10px;
}
.vp-root.sve-studio .sve-tierwords{display:flex;flex-wrap:wrap;align-items:center;gap:4px;padding-left:4px;}
.vp-root.sve-studio .sve-tierwlab{
  font-size:9px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#7A6030;
}
.vp-root.sve-studio .sve-tierword{
  appearance:none;border:1px solid rgba(180,120,0,0.14);border-radius:4px;background:#FFFAEB;color:#7A6030;
  font:inherit;font-size:10px;font-weight:650;padding:2px 6px;cursor:pointer;transition:all 200ms ease;
}
.vp-root.sve-studio .sve-tierword:hover{color:#1A1000;border-color:rgba(180,120,0,0.36);}
.vp-root.sve-studio .sve-tierword.on{
  background:color-mix(in srgb,#C8920A 20%,transparent);
  border-color:color-mix(in srgb,#C8920A 60%,transparent);
  color:#1A1000;
}

/* ====================================================================== */
/* 10. narrow screens: the rail stacks under the preview                  */
/* ====================================================================== */
@media (max-width:900px){
  .vp-root.sve-studio .vp-body{grid-template-columns:minmax(0,1fr);}
  .vp-root.sve-studio .vp-side{position:static;top:auto;z-index:auto;width:100%;}
  .vp-root.sve-studio .vp-side.collapsed .vp-tabs,
  .vp-root.sve-studio .vp-side.collapsed .vp-tabs.c7{
    grid-template-columns:repeat(4,minmax(0,1fr));flex:0 0 auto;overflow:visible;
  }
  .vp-root.sve-studio .vp-side.collapsed .vp-tab{
    padding:6px 2px 5px;border-right:none;border-bottom:2px solid transparent;
  }
  .vp-root.sve-studio .vp-side.collapsed .vp-tab[aria-selected="true"]{
    border-right-color:transparent;border-bottom-color:#C8920A;
  }
  .vp-root.sve-studio .vp-side.collapsed .vp-tablab{display:block;}
  .vp-root.sve-studio .vp-side.collapsed .vp-sidehead b{display:block;}
  .vp-root.sve-studio .vp-side.collapsed .vp-sidehead{padding:0 5px 0 9px;}
  .vp-root.sve-studio .vp-side.collapsed .vp-sidetoggle{margin-left:auto;}
}
@media (max-width:768px){
  .vp-root.sve-studio .vp-head{height:auto;flex-wrap:wrap;gap:6px;padding:7px 8px;}
  .vp-root.sve-studio .vp-sidefoot{padding:7px;}
  .vp-root.sve-studio .vp-footrow{grid-template-columns:1fr;}
}
`;
