/**
 * VidVerge — MOTION UI: the continuous Remotion composition + server render.
 *
 * ONE COMPOSITION, ONE TIMELINE. `MOTION_UI_COMPOSITION` is a single Remotion
 * component (as source, sent to /api/render/remotion) that renders the WHOLE
 * video from the Motion Plan handed in as props. There is no per-shot render and
 * no stitching: a single global camera transform flies over a shared WORLD that
 * holds every UI screen, so camera, UI, typography and background all move on
 * the same clock and never reset between "scenes".
 *
 * The inline runtime math mirrors motionUiRuntime.ts so the in-browser preview
 * and the final render agree. It uses string concatenation (never nested
 * template literals) so the composition source survives being embedded here.
 *
 * SOURCE OF TRUTH. UI screenshots are drawn with <Img> and only transformed —
 * never regenerated. AI-video / avatar layers (optional) are drawn with <Video>
 * from a pre-generated clip URL and composited into the SAME timeline.
 *
 * RENDER GEOMETRY. The platform endpoint renders a fixed 1920×1080 canvas at
 * 30fps. 16:9 fills it natively; 9:16 and 1:1 are composed inside a centred
 * safe frame with the motion-graphic background bleeding full-frame, so the
 * result is intentional rather than letterboxed.
 */
import { workspaceUuid } from '../../lib/reelioStudio';
import { validateAndRepair } from './motionUiDirector';
import {
  isHttpUrl,
  planDurationInFrames,
  MOTION_FPS,
  type MotionAsset,
  type MotionPlan,
} from './motionUiTypes';

const RENDER_WIDTH = 1920;
const RENDER_HEIGHT = 1080;
const POLL_MS = 4000;
const MAX_TICKS = 150; // 10 minutes at 4s.

/**
 * The composition, as source. Everything that varies is a PROP (`plan`,
 * `assetUrls`). Keep the animation semantics in step with motionUiRuntime.ts.
 */
export const MOTION_UI_COMPOSITION = `
import React from 'react';
import { AbsoluteFill, Img, Video, Audio, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';

function clamp(n, lo, hi) { if (!isFinite(n)) return lo; return Math.min(hi, Math.max(lo, n)); }
function lerp(t, a, b) { return a + (b - a) * clamp(t, 0, 1); }
function easeInOutCubic(t) { var x = clamp(t,0,1); return x < 0.5 ? 4*x*x*x : 1 - Math.pow(-2*x+2,3)/2; }
function easeOutCubic(t) { var x = clamp(t,0,1); return 1 - Math.pow(1-x,3); }
function easeInCubic(t) { var x = clamp(t,0,1); return x*x*x; }
function springish(t) { var x = clamp(t,0,1); return 1 - Math.cos(x*Math.PI*0.5)*Math.exp(-2.2*x); }
function applyEasing(t, e) {
  if (e === 'linear') return clamp(t,0,1);
  if (e === 'ease_in') return easeInCubic(t);
  if (e === 'ease_out') return easeOutCubic(t);
  if (e === 'spring') return springish(t);
  return easeInOutCubic(t);
}
function sampleCamera(cam, t) {
  if (!cam || cam.length === 0) return { x:0, y:0, scale:1, rotate:0 };
  var s = cam.slice().sort(function(a,b){return a.t-b.t;});
  if (s.length === 1) return { x:s[0].x, y:s[0].y, scale:s[0].scale, rotate:s[0].rotate||0 };
  if (t <= s[0].t) return { x:s[0].x, y:s[0].y, scale:s[0].scale, rotate:s[0].rotate||0 };
  var last = s[s.length-1];
  if (t >= last.t) return { x:last.x, y:last.y, scale:last.scale, rotate:last.rotate||0 };
  for (var i=0;i<s.length-1;i++){
    var a=s[i], b=s[i+1];
    if (t>=a.t && t<=b.t){
      var span=Math.max(0.0001,b.t-a.t);
      var p=applyEasing((t-a.t)/span,'smooth');
      return { x:lerp(p,a.x,b.x), y:lerp(p,a.y,b.y), scale:lerp(p,a.scale,b.scale), rotate:lerp(p,a.rotate||0,b.rotate||0) };
    }
  }
  return { x:last.x, y:last.y, scale:last.scale, rotate:last.rotate||0 };
}
function sampleLayer(l, t) {
  var pad=0.35;
  if (t < l.start-pad || t > l.end+pad) return { visible:false, opacity:0, dx:0, dy:0, scale:1 };
  var inDur=Math.max(0.15,l.entranceDur||0.7), outDur=Math.max(0.15,l.exitDur||0.5);
  var inP=applyEasing(clamp((t-l.start)/inDur,0,1),'smooth');
  var outP=applyEasing(clamp((l.end-t)/outDur,0,1),'ease_out');
  var opacity=clamp(Math.min(inP,outP),0,1);
  var dx=0, dy=0, scale=1; var enter=1-inP; var SLIDE=0.35;
  if (l.entrance==='slide_left') dx=enter*SLIDE;
  else if (l.entrance==='slide_right') dx=-enter*SLIDE;
  else if (l.entrance==='slide_up') dy=enter*SLIDE;
  else if (l.entrance==='slide_down') dy=-enter*SLIDE;
  else if (l.entrance==='scale_in') scale=lerp(inP,0.86,1);
  else if (l.entrance==='rise'){ dy=enter*0.14; scale=lerp(inP,0.94,1); }
  var life=t-l.start;
  if (l.float==='float') dy+=Math.sin(life*0.9)*0.012;
  else if (l.float==='drift_left') dx-=life*0.006;
  else if (l.float==='drift_right') dx+=life*0.006;
  else if (l.float==='parallax'){ dx+=Math.sin(life*0.6)*0.02; dy+=Math.cos(life*0.5)*0.01; }
  return { visible:opacity>0.001, opacity:opacity, dx:dx, dy:dy, scale:scale };
}
function sampleText(cue, t) {
  if (t < cue.start-0.3 || t > cue.end+0.3) return { visible:false, opacity:0, dy:0, scale:1, reveal:0, tracking:0, mask:1 };
  var inP=easeOutCubic(clamp((t-cue.start)/0.6,0,1));
  var outP=easeInCubic(clamp((cue.end-t)/0.4,0,1));
  var opacity=clamp(Math.min(inP,outP),0,1);
  var dy=0, scale=1, reveal=1, tracking=0, mask=1;
  if (cue.animation==='slide_up') dy=(1-inP)*0.06;
  else if (cue.animation==='scale_reveal') scale=lerp(inP,0.8,1);
  else if (cue.animation==='tracking_expand') tracking=(1-inP)*0.4;
  else if (cue.animation==='word_reveal' || cue.animation==='char_reveal') reveal=easeOutCubic(clamp((t-cue.start)/0.84,0,1));
  else if (cue.animation==='mask_reveal') mask=easeInOutCubic(clamp((t-cue.start)/0.7,0,1));
  return { visible:opacity>0.001, opacity:opacity, dy:dy, scale:scale, reveal:reveal, tracking:tracking, mask:mask };
}
function revealText(content, animation, reveal) {
  if (animation==='word_reveal'){ var w=content.split(/\\s+/); var n=Math.ceil(w.length*clamp(reveal,0,1)); return w.slice(0,Math.max(0,n)).join(' '); }
  if (animation==='char_reveal'){ var m=Math.ceil(content.length*clamp(reveal,0,1)); return content.slice(0,Math.max(0,m)); }
  return content;
}
function anchorPos(a) {
  if (a==='top') return {x:0.5,y:0.16}; if (a==='bottom') return {x:0.5,y:0.84};
  if (a==='left') return {x:0.22,y:0.5}; if (a==='right') return {x:0.78,y:0.5};
  if (a==='top-left') return {x:0.2,y:0.18}; if (a==='top-right') return {x:0.8,y:0.18};
  if (a==='bottom-left') return {x:0.2,y:0.82}; if (a==='bottom-right') return {x:0.8,y:0.82};
  return {x:0.5,y:0.5};
}
function aspectValue(a){ if (a==='9:16') return 9/16; if (a==='1:1') return 1; return 16/9; }

function Background(props) {
  var bg = props.background || {}; var brand = props.brand || {}; var t = props.t; var frame = props.frame;
  var colors = (bg.colors && bg.colors.length) ? bg.colors : [brand.background||'#0A0F1E', brand.primary||'#2563eb'];
  var drift = bg.animation==='slow_drift' ? Math.sin(t*0.25)*8 : bg.animation==='pan' ? (t*6)%100 : 0;
  var pulse = bg.animation==='pulse' ? 0.5 + Math.sin(t*0.8)*0.14 : 0.5;
  var base = colors[0] || '#0A0F1E';
  var style = { background: base };
  if (bg.type==='gradient') {
    style = { backgroundImage: 'radial-gradient(1200px 700px at ' + (30+drift) + '% ' + (10+drift) + '%, ' + (colors[1]||'#2563eb') + '55, transparent 60%), radial-gradient(1000px 650px at ' + (80-drift) + '% ' + (90) + '%, ' + (colors[2]||colors[1]||'#60a5fa') + '33, transparent 62%), linear-gradient(145deg, ' + base + ', ' + base + ')' };
  } else if (bg.type==='mesh') {
    style = { backgroundImage: 'radial-gradient(700px 700px at ' + (20+drift) + '% 30%, ' + (colors[1]||'#2563eb') + '44, transparent 55%), radial-gradient(650px 650px at ' + (78-drift) + '% 68%, ' + (colors[2]||'#22d3ee') + '3a, transparent 58%), radial-gradient(900px 500px at 50% 120%, ' + (colors[1]||'#2563eb') + '22, transparent 60%), ' + base };
  } else if (bg.type==='spotlight') {
    style = { backgroundImage: 'radial-gradient(900px 900px at 50% ' + (36+drift) + '%, ' + (colors[1]||'#2563eb') + Math.round(pulse*60).toString(16) + ', transparent 55%), ' + base };
  }
  return React.createElement(AbsoluteFill, { style: style });
}

function Graphic(props) {
  var g = props.g; var t = props.t; var W = props.W; var H = props.H;
  var op = clamp(g.intensity||0.3, 0.05, 1);
  if (g.kind==='glow') {
    return React.createElement(AbsoluteFill, { style: { backgroundImage: 'radial-gradient(600px 600px at ' + (30+Math.sin(t*0.3)*10) + '% ' + (40+Math.cos(t*0.25)*10) + '%, ' + g.color + Math.round(op*40).toString(16).padStart(2,'0') + ', transparent 60%)' } });
  }
  if (g.kind==='grid') {
    var off = (t*10)%40;
    return React.createElement(AbsoluteFill, { style: { opacity: op, backgroundImage: 'linear-gradient(' + g.color + '22 1px, transparent 1px), linear-gradient(90deg, ' + g.color + '22 1px, transparent 1px)', backgroundSize: '48px 48px', backgroundPosition: off + 'px ' + off + 'px' } });
  }
  if (g.kind==='dots') {
    return React.createElement(AbsoluteFill, { style: { opacity: op, backgroundImage: 'radial-gradient(' + g.color + '55 1.5px, transparent 1.5px)', backgroundSize: '34px 34px', backgroundPosition: ((t*6)%34) + 'px 0px' } });
  }
  if (g.kind==='beams') {
    var rot = t*8;
    return React.createElement(AbsoluteFill, { style: { opacity: op*0.6, transform: 'rotate(' + rot + 'deg) scale(1.6)', transformOrigin: 'center', backgroundImage: 'repeating-linear-gradient(90deg, transparent 0px, transparent 120px, ' + g.color + '22 122px, transparent 128px)' } });
  }
  if (g.kind==='rings') {
    var scale = 1 + Math.sin(t*0.6)*0.06;
    var el = [];
    for (var i=0;i<4;i++){
      var size = 260 + i*220;
      el.push(React.createElement('div', { key:i, style: { position:'absolute', left:'50%', top:'50%', width:size, height:size, marginLeft:-size/2, marginTop:-size/2, borderRadius:'50%', border:'1px solid ' + g.color + '33', transform:'scale(' + (scale + i*0.02) + ')' } }));
    }
    return React.createElement(AbsoluteFill, { style:{opacity:op} }, el);
  }
  if (g.kind==='lines') {
    var els=[];
    for (var j=0;j<5;j++){ var y=(j+1)/6*H; var dx=((t*30 + j*80)% (W+200))-100; els.push(React.createElement('div',{key:j,style:{position:'absolute',left:dx,top:y,width:120,height:2,background:g.color+'55'}})); }
    return React.createElement(AbsoluteFill,{style:{opacity:op}},els);
  }
  if (g.kind==='particles') {
    var parts=[];
    for (var k=0;k<26;k++){
      var seedX=(k*97%100)/100, seedY=(k*57%100)/100, sp=0.2+(k%5)*0.08;
      var py=((seedY - t*sp*0.05) % 1 + 1) % 1;
      parts.push(React.createElement('div',{key:k,style:{position:'absolute',left:(seedX*W)+'px',top:(py*H)+'px',width:3+(k%3),height:3+(k%3),borderRadius:'50%',background:g.color,opacity:0.4+(k%4)*0.1}}));
    }
    return React.createElement(AbsoluteFill,{style:{opacity:op}},parts);
  }
  return null;
}

function frameChrome(style, brand) {
  if (style==='browser') return { pad: 42, radius: 16, bar: true, color: brand.text };
  if (style==='device') return { pad: 0, radius: 44, bar: false, color: brand.text, device: true };
  if (style==='card') return { pad: 0, radius: 18, bar: false, color: brand.text };
  return { pad: 0, radius: 0, bar: false, color: brand.text };
}

function Layer(props) {
  var l = props.layer; var url = props.url; var screenUrl = props.screenUrl; var s = props.s; var brand = props.brand; var safeW = props.safeW; var safeH = props.safeH;
  if (!s.visible) return null;
  var chrome = frameChrome(l.frameStyle, brand);
  var w = l.worldScale * safeW;
  var cx = safeW/2 + (l.worldX + s.dx) * safeW;
  var cy = safeH/2 + (l.worldY + s.dy) * safeH;
  var media = null;
  if ((l.kind==='ai_video' || l.kind==='avatar') && url) {
    media = React.createElement(Video, { src: url, style:{ width:'100%', aspectRatio: safeW + '/' + safeH, objectFit:'cover', display:'block' } });
  } else if (url) {
    media = React.createElement(Img, { src: url, style:{ width:'100%', height:'auto', display:'block', borderRadius: chrome.bar ? 0 : chrome.radius } });
  } else {
    media = React.createElement('div', { style:{ width:'100%', paddingBottom:'60%', background:'linear-gradient(135deg,' + (brand.primary||'#2563eb') + '33,' + (brand.secondary||'#60a5fa') + '22)' } });
  }
  var inner = media;
  var tracked = l.screenComposite;
  if (l.kind==='ai_video' && tracked && tracked.trackingConfidence>=0.85 && screenUrl) {
    var perspectiveTransform =
      'translate(-50%,-50%) perspective(1200px) rotateX(' + (tracked.rotateX||0) + 'deg) rotateY(' + (tracked.rotateY||0) + 'deg) rotateZ(' + (tracked.rotateZ||0) + 'deg) skew(' + (tracked.skewX||0) + 'deg,' + (tracked.skewY||0) + 'deg)';
    inner = React.createElement('div', { style:{ position:'relative', width:'100%', aspectRatio: safeW + '/' + safeH, overflow:'hidden', borderRadius: chrome.radius } }, [
      media,
      React.createElement(Img, { key:'screen', src:screenUrl, style:{ position:'absolute', left:(tracked.x*100)+'%', top:(tracked.y*100)+'%', width:(tracked.width*100)+'%', height:(tracked.height*100)+'%', objectFit:'fill', transform:perspectiveTransform, transformOrigin:'center', borderRadius:(tracked.borderRadius||0)+'px', clipPath:'inset(0 round ' + (tracked.borderRadius||0) + 'px)' } })
    ]);
  }
  if (chrome.bar) {
    inner = React.createElement('div', { style:{ borderRadius: chrome.radius, overflow:'hidden', background:'#0b1220', border:'1px solid rgba(255,255,255,0.12)' } }, [
      React.createElement('div', { key:'bar', style:{ height:34, display:'flex', alignItems:'center', gap:8, padding:'0 14px', background:'rgba(255,255,255,0.06)' } }, [
        React.createElement('span',{key:1,style:{width:10,height:10,borderRadius:'50%',background:'#ff5f57'}}),
        React.createElement('span',{key:2,style:{width:10,height:10,borderRadius:'50%',background:'#febc2e'}}),
        React.createElement('span',{key:3,style:{width:10,height:10,borderRadius:'50%',background:'#28c840'}})
      ]),
      media
    ]);
  } else if (chrome.device) {
    inner = React.createElement('div', { style:{ borderRadius: chrome.radius, overflow:'hidden', border:'8px solid #0b0f18', background:'#0b0f18', boxShadow:'0 0 0 2px rgba(255,255,255,0.08)' } }, media);
  } else if (l.frameStyle==='card') {
    inner = React.createElement('div', { style:{ borderRadius: chrome.radius, overflow:'hidden', border:'1px solid rgba(255,255,255,0.1)' } }, media);
  }
  return React.createElement('div', {
    style: {
      position:'absolute', left: cx + 'px', top: cy + 'px', width: w + 'px',
      transform: 'translate(-50%,-50%) scale(' + s.scale + ') rotate(' + (l.rotate||0) + 'deg)',
      opacity: s.opacity,
      filter: l.shadow ? 'drop-shadow(0 40px 80px rgba(0,0,0,0.55))' : 'none'
    }
  }, inner);
}

function TextCue(props) {
  var cue = props.cue; var s = props.s; var brand = props.brand; var safeW = props.safeW; var safeH = props.safeH;
  if (!s.visible) return null;
  var pos = anchorPos(cue.anchor);
  var px = (pos.x + (cue.x||0)) * safeW;
  var py = (pos.y + (cue.y||0)) * safeH;
  var base = cue.level===3 ? 0.11 : cue.level===2 ? 0.062 : 0.032;
  var fontSize = base * safeH;
  var shown = revealText(cue.content, cue.animation, s.reveal);
  var color = cue.color || brand.text || '#fff';
  var maxW = safeW * 0.8;
  var wrap = {
    position:'absolute', left: px + 'px', top: py + 'px', maxWidth: maxW + 'px',
    transform: 'translate(-50%,-50%) translateY(' + (s.dy*safeH) + 'px) scale(' + s.scale + ')',
    opacity: s.opacity, textAlign: cue.align || 'center'
  };
  var textStyle = {
    margin:0, fontFamily: brand.font, fontWeight: cue.weight||700, fontSize: fontSize + 'px',
    lineHeight: 1.08, letterSpacing: ((cue.level===3?-0.02:0) + s.tracking) + 'em', color: color,
    clipPath: cue.animation==='mask_reveal' ? ('inset(0 ' + Math.round((1-s.mask)*100) + '% 0 0)') : 'none',
    whiteSpace:'pre-wrap'
  };
  if (cue.emphasis) {
    return React.createElement('div', { style: wrap }, React.createElement('span', {
      style: { display:'inline-block', padding: (fontSize*0.28) + 'px ' + (fontSize*0.6) + 'px', borderRadius: 999, background: brand.primary||'#2563eb', color:'#fff', fontFamily: brand.font, fontWeight: 800, fontSize: fontSize + 'px', letterSpacing: s.tracking + 'em', boxShadow:'0 20px 60px -20px ' + (brand.primary||'#2563eb') }
    }, shown));
  }
  return React.createElement('div', { style: wrap }, React.createElement('p', { style: textStyle }, shown));
}

export default function Composition(props) {
  var plan = props.plan || {};
  var assetUrls = props.assetUrls || {};
  var brand = plan.brand || {};
  var frame = useCurrentFrame();
  var cfg = useVideoConfig();
  var fps = cfg.fps; var W = cfg.width; var H = cfg.height;
  var t = frame / fps;
  var cam = sampleCamera(plan.camera || [], t);

  var ratio = aspectValue(plan.aspectRatio);
  var safeH = H, safeW = H * ratio;
  if (safeW > W) { safeW = W; safeH = W / ratio; }

  var graphics = Array.isArray(plan.graphics) ? plan.graphics : [];
  var backGraphics = graphics.filter(function(g){ return g.depth !== 'front'; });
  var frontGraphics = graphics.filter(function(g){ return g.depth === 'front'; });
  var layers = Array.isArray(plan.layers) ? plan.layers : [];
  var texts = Array.isArray(plan.text) ? plan.text : [];

  var worldChildren = layers.map(function(l, i){
    var screenId = l.screenComposite && l.screenComposite.assetId ? l.screenComposite.assetId : l.screenAssetId;
    var node = React.createElement(Layer, { key: l.id||i, layer: l, url: l.clipUrl || assetUrls[l.assetId], screenUrl: screenId ? assetUrls[screenId] : null, s: sampleLayer(l, t), brand: brand, safeW: safeW, safeH: safeH });
    if ((l.kind==='ai_video' || l.kind==='avatar') && l.clipUrl) {
      return React.createElement(Sequence, { key:l.id||i, from:Math.max(0,Math.round(l.start*fps)), durationInFrames:Math.max(1,Math.round((l.end-l.start)*fps)) }, node);
    }
    return node;
  });

  var safeFrame = React.createElement('div', {
    style: { position:'absolute', left:'50%', top:'50%', width: safeW + 'px', height: safeH + 'px', transform:'translate(-50%,-50%)', overflow:'hidden' }
  }, [
    React.createElement('div', { key:'world', style: { position:'absolute', inset:0, transform: 'translate(' + (cam.x*safeW) + 'px,' + (cam.y*safeH) + 'px) scale(' + cam.scale + ') rotate(' + (cam.rotate||0) + 'deg)', transformOrigin: 'center center' } }, worldChildren),
    React.createElement('div', { key:'fg', style:{position:'absolute',inset:0,pointerEvents:'none'} }, frontGraphics.map(function(g,i){ return React.createElement(Graphic,{key:g.id||i,g:g,t:t,W:safeW,H:safeH}); })),
    React.createElement('div', { key:'text', style:{position:'absolute',inset:0} }, texts.map(function(c,i){ return React.createElement(TextCue,{key:c.id||i,cue:c,s:sampleText(c,t),brand:brand,safeW:safeW,safeH:safeH}); }))
  ]);

  var audio = (plan.audio && plan.audio.musicUrl && !plan.audio.muted) ? React.createElement(Audio, { src: plan.audio.musicUrl, volume: clamp(plan.audio.volume||0.6,0,1) }) : null;

  return React.createElement(AbsoluteFill, { style: { background: brand.background || '#0A0F1E', overflow:'hidden', fontFamily: brand.font } }, [
    React.createElement(Background, { key:'bg', background: plan.background, brand: brand, t: t, frame: frame }),
    React.createElement('div', { key:'bgfx', style:{position:'absolute',inset:0} }, backGraphics.map(function(g,i){ return React.createElement(Graphic,{key:g.id||i,g:g,t:t,W:W,H:H}); })),
    safeFrame,
    audio
  ]);
}

export const calculateDemoVideoDuration = function(props){ var p = props && props.plan; return Math.max(30, Math.round(((p && p.duration) || 15) * 30)); };
`;

/** assetId → durable URL, the only asset data the composition needs. */
function assetUrlMap(assets: MotionAsset[]): Record<string, string> {
  const map: Record<string, string> = {};
  assets.forEach((a) => {
    if (isHttpUrl(a.url)) map[a.id] = a.url;
  });
  return map;
}

export interface MotionRenderResult {
  success: boolean;
  videoUrl?: string;
  operationId?: string;
  error?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Render the whole Motion Plan as ONE composition and poll for the MP4.
 * The plan is validated/repaired first so the renderer never sees bad input.
 */
export async function renderMotionVideo(input: {
  plan: MotionPlan;
  assets: MotionAsset[];
  onStage?: (message: string) => void;
  isAborted?: () => boolean;
  operationId?: string;
}): Promise<MotionRenderResult> {
  const uuid = workspaceUuid();
  if (!uuid) return { success: false, error: 'This session cannot reach the renderer yet. Try again in a moment.' };

  const { plan } = validateAndRepair(input.plan, input.assets);
  const durationInFrames = planDurationInFrames(plan);
  const props = { plan, assetUrls: assetUrlMap(input.assets) };

  let operationId = input.operationId || '';
  if (!operationId) {
    try {
      if (input.onStage) input.onStage('Building the composition…');
      const res = await fetch('/api/render/remotion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: uuid,
          compositionTsx: MOTION_UI_COMPOSITION,
          props,
          durationInFrames,
          fps: MOTION_FPS,
          width: RENDER_WIDTH,
          height: RENDER_HEIGHT,
        }),
      });
      const data = await res.json().catch(() => null);
      operationId = String((data && data.operationId) || '');
      if (!res.ok || !operationId) {
        return { success: false, error: (data && data.error) || `The render could not be started (HTTP ${res.status}).` };
      }
    } catch (e: any) {
      return { success: false, error: (e && e.message) || 'Network error starting the render.' };
    }
  }

  for (let tick = 0; tick < MAX_TICKS; tick++) {
    if (input.isAborted && input.isAborted()) return { success: false, operationId, error: 'aborted' };
    try {
      const res = await fetch(`/api/render/remotion/${encodeURIComponent(operationId)}`);
      const data = await res.json().catch(() => null);
      const status = String((data && data.status) || '').toLowerCase();
      if (status === 'complete' && isHttpUrl(data && data.videoUrl)) {
        return { success: true, operationId, videoUrl: String(data.videoUrl) };
      }
      if (status === 'failed') {
        return { success: false, operationId, error: (data && data.error) || 'The render failed.' };
      }
      if (input.onStage) input.onStage('Rendering your motion video…');
    } catch {
      if (input.onStage) input.onStage('Reconnecting to the renderer…');
    }
    await sleep(POLL_MS);
  }
  return { success: false, operationId, error: 'The render did not land in time.' };
}
