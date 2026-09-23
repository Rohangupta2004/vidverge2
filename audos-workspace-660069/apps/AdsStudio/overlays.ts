/**
 * ADS STUDIO — the motion overlay layer. GSAP + SVG rendered to canvas frames
 * with MediaRecorder (NO Remotion), then piped into the FFmpeg assembly.
 *
 * Overlays are composited AFTER Veo generation — they are never Veo
 * instructions. Each clip's overlay is recorded on a solid CHROMA-KEY
 * background (pure magenta) and keyed out in FFmpeg with colorkey, so opaque
 * content — real screenshots inside device mockups, caption pills, review
 * cards — survives the composite (a screen blend would eat dark pixels).
 *
 * Timing contract: overlays animate in at 0.3s, hold, then fade out 0.5s
 * before clip end. Captions (the spoken line) are baked into this same layer,
 * which is how the final ad gets styled, clip-timed burned-in subtitles.
 */

import { gsap } from 'https://esm.sh/gsap@3.12.5';
import { GeneratedAsset, MockupDevice, ScenePlan, ScriptClip, UploadedAsset } from './api';

export const KEY_COLOR = '#FF00FF';
const SVG_NS = 'http://www.w3.org/2000/svg';
const FPS = 30;

type Attrs = Record<string, string | number>;
function el<T extends SVGElement>(tag: string, attrs: Attrs = {}, parent?: SVGElement | null): T {
  const node = document.createElementNS(SVG_NS, tag) as T;
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, String(v)));
  if (parent) parent.appendChild(node);
  return node;
}

function text(parent: SVGElement, str: string, attrs: Attrs): SVGTextElement {
  const node = el<SVGTextElement>('text', attrs, parent);
  node.textContent = str;
  return node;
}

/** Inline a remote image as a data: URL — SVG rasterized through an <img>
 * loads no external resources, so images must travel inside the markup. */
export async function toDataUrl(url: string): Promise<string> {
  if (!url) return '';
  if (url.startsWith('data:')) return url;
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return '';
    const blob = await res.blob();
    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => resolve('');
      reader.readAsDataURL(blob);
    });
  } catch { return ''; }
}

function wrapWords(line: string, maxChars: number): string[] {
  const words = String(line || '').trim().split(/\s+/).filter(Boolean);
  const rows: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars && cur) { rows.push(cur); cur = w; }
    else cur = (cur + ' ' + w).trim();
  }
  if (cur) rows.push(cur);
  return rows.slice(0, 3);
}

export interface BuiltOverlay { svg: SVGSVGElement; timeline: any; durationSec: number; hasContent: boolean }

// ---------------------------------------------------------------------------
// Element painters — each adds its nodes + tweens; `inAt` = 0.3s, fade-out
// handled per-group at (duration - 0.5)s.
// ---------------------------------------------------------------------------

function fadeWindow(tl: any, group: SVGElement, inAt: number, duration: number) {
  gsap.set(group, { opacity: 0 });
  tl.to(group, { opacity: 1, duration: 0.35, ease: 'power2.out' }, inAt);
  tl.to(group, { opacity: 0, duration: 0.5, ease: 'power2.in' }, Math.max(inAt + 0.6, duration - 0.5));
}

function paintCaption(svg: SVGSVGElement, tl: any, line: string, W: number, H: number, duration: number, accent: string) {
  if (!line.trim()) return;
  const u = Math.min(W, H) / 1080;
  const fs = 46 * u;
  const rows = wrapWords(line, W > H ? 42 : 24);
  const lineH = fs * 1.32;
  const padX = 30 * u; const padY = 18 * u;
  const boxH = rows.length * lineH + padY * 2;
  const cy = H * 0.86 - boxH / 2;
  const group = el<SVGGElement>('g', {}, svg);
  const widest = Math.max(...rows.map((r) => r.length)) * fs * 0.56 + padX * 2;
  const bw = Math.min(W * 0.92, widest);
  el('rect', { x: (W - bw) / 2, y: cy, width: bw, height: boxH, rx: 18 * u, fill: 'rgba(10,15,30,0.82)', stroke: accent, 'stroke-width': Math.max(1, 2 * u), 'stroke-opacity': 0.55 }, group);
  rows.forEach((row, i) => {
    text(group, row, {
      x: W / 2, y: cy + padY + lineH * i + fs * 0.86,
      'text-anchor': 'middle', fill: '#F8FAFC',
      'font-family': "Inter, system-ui, sans-serif", 'font-size': fs, 'font-weight': 700,
    });
  });
  gsap.set(group, { opacity: 0, y: 24 * u });
  tl.to(group, { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out' }, 0.3);
  tl.to(group, { opacity: 0, duration: 0.5, ease: 'power2.in' }, Math.max(0.9, duration - 0.5));
}

function deviceFrame(group: SVGGElement, device: MockupDevice, x: number, y: number, w: number, h: number, u: number, screenshot: string, uid: string, svg: SVGSVGElement) {
  const defs = svg.querySelector('defs') as SVGElement;
  const clipId = `clip_${uid}`;
  const r = device === 'phone' ? 44 * u : 14 * u;
  // Soft drop shadow.
  el('rect', { x: x + 10 * u, y: y + 16 * u, width: w, height: h, rx: r, fill: 'rgba(0,0,0,0.45)' }, group);
  // Body.
  el('rect', { x, y, width: w, height: h, rx: r, fill: '#0B1120', stroke: 'rgba(148,163,184,0.5)', 'stroke-width': Math.max(1.5, 3 * u) }, group);
  let sx = x + 10 * u; let sy = y + 10 * u; let sw = w - 20 * u; let sh = h - 20 * u;
  if (device === 'browser') {
    const bar = 44 * u;
    el('rect', { x, y, width: w, height: bar, rx: r, fill: '#18243A' }, group);
    el('rect', { x, y: y + bar / 2, width: w, height: bar / 2, fill: '#18243A' }, group);
    ['#E2726F', '#E8A33C', '#7FD4B4'].forEach((c, i) => el('circle', { cx: x + (24 + i * 26) * u, cy: y + bar / 2, r: 7 * u, fill: c }, group));
    sy = y + bar + 4 * u; sh = h - bar - 14 * u; sx = x + 8 * u; sw = w - 16 * u;
  } else if (device === 'laptop' || device === 'monitor') {
    sy = y + 12 * u; sh = h - 24 * u;
    if (device === 'laptop') {
      el('rect', { x: x - w * 0.08, y: y + h, width: w * 1.16, height: 16 * u, rx: 8 * u, fill: '#101828', stroke: 'rgba(148,163,184,0.4)', 'stroke-width': Math.max(1, 2 * u) }, group);
    } else {
      el('rect', { x: x + w / 2 - 30 * u, y: y + h, width: 60 * u, height: 46 * u, fill: '#101828' }, group);
      el('rect', { x: x + w / 2 - 90 * u, y: y + h + 46 * u, width: 180 * u, height: 12 * u, rx: 6 * u, fill: '#101828' }, group);
    }
  } else if (device === 'phone') {
    el('rect', { x: x + w / 2 - 50 * u, y: y + 16 * u, width: 100 * u, height: 22 * u, rx: 11 * u, fill: '#000' }, group);
    sy = y + 46 * u; sh = h - 66 * u; sx = x + 14 * u; sw = w - 28 * u;
  }
  const clip = el('clipPath', { id: clipId }, defs);
  el('rect', { x: sx, y: sy, width: sw, height: sh, rx: 12 * u }, clip);
  if (screenshot) {
    const img = el('image', { x: sx, y: sy, width: sw, height: sh, 'clip-path': `url(#${clipId})`, preserveAspectRatio: 'xMidYMid slice' }, group);
    img.setAttribute('href', screenshot);
    img.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', screenshot);
  } else {
    el('rect', { x: sx, y: sy, width: sw, height: sh, rx: 12 * u, fill: '#121C30' }, group);
  }
}

function paintMockup(svg: SVGSVGElement, tl: any, device: MockupDevice, screenshot: string, W: number, H: number, duration: number, uid: string) {
  const u = Math.min(W, H) / 1080;
  const portrait = H >= W;
  let w: number; let h: number;
  if (device === 'phone') { w = Math.min(W, H) * (portrait ? 0.52 : 0.34); h = w * 2.05; }
  else if (device === 'tablet') { w = Math.min(W, H) * 0.62; h = w * 1.35; }
  else { w = W * (portrait ? 0.86 : 0.52); h = w * 0.64; }
  const x = (W - w) / 2;
  const y = portrait ? H * 0.16 : (H - h) / 2 - H * 0.06;
  const group = el<SVGGElement>('g', {}, svg);
  deviceFrame(group, device, x, y, w, h, u, screenshot, uid, svg);
  // Slide in from the bottom, gentle float, subtle shadow pulse via scale.
  gsap.set(group, { opacity: 0, y: H * 0.22, transformOrigin: '50% 50%' });
  tl.to(group, { opacity: 1, y: 0, duration: 0.55, ease: 'power3.out' }, 0.3);
  tl.to(group, { y: -10 * u, duration: 1.6, ease: 'sine.inOut', repeat: -1, yoyo: true }, 1.0);
  tl.to(group, { scale: 1.015, duration: 1.3, ease: 'sine.inOut', repeat: -1, yoyo: true }, 1.0);
  tl.to(group, { opacity: 0, duration: 0.5, ease: 'power2.in' }, Math.max(1, duration - 0.5));
}

function paintTextCallout(svg: SVGSVGElement, tl: any, phrase: string, W: number, H: number, duration: number, accent: string) {
  if (!phrase.trim()) return;
  const u = Math.min(W, H) / 1080;
  const fs = 78 * u;
  const rows = wrapWords(phrase, H >= W ? 14 : 24);
  const group = el<SVGGElement>('g', {}, svg);
  const cy = H * 0.3;
  rows.forEach((row, i) => {
    const t = text(group, row, {
      x: W / 2, y: cy + i * fs * 1.18,
      'text-anchor': 'middle', fill: '#FFFFFF',
      'font-family': "Inter, system-ui, sans-serif", 'font-size': fs, 'font-weight': 800,
      stroke: 'rgba(10,15,30,0.85)', 'stroke-width': 8 * u, 'paint-order': 'stroke',
    });
    gsap.set(t, { opacity: 0, scale: 0.7, transformOrigin: '50% 50%', y: 20 * u });
    tl.to(t, { opacity: 1, scale: 1, y: 0, duration: 0.4, ease: 'back.out(1.7)' }, 0.3 + i * 0.14);
  });
  const bar = el('rect', { x: W / 2, y: cy + rows.length * fs * 1.18 + 8 * u, width: 0, height: 8 * u, rx: 4 * u, fill: accent }, group);
  tl.to(bar, { attr: { x: W / 2 - 130 * u, width: 260 * u }, duration: 0.4, ease: 'power2.out' }, 0.55);
  tl.to(group, { opacity: 0, duration: 0.5, ease: 'power2.in' }, Math.max(1, duration - 0.5));
}

function paintReviewCard(svg: SVGSVGElement, tl: any, quote: string, W: number, H: number, duration: number, accent: string) {
  if (!quote.trim()) return;
  const u = Math.min(W, H) / 1080;
  const fs = 40 * u;
  const rows = wrapWords(quote, H >= W ? 26 : 44);
  const pad = 34 * u;
  const bw = Math.min(W * 0.86, Math.max(...rows.map((r) => r.length)) * fs * 0.54 + pad * 2);
  const bh = rows.length * fs * 1.35 + pad * 2 + 46 * u;
  const x = (W - bw) / 2; const y = H * 0.22;
  const group = el<SVGGElement>('g', {}, svg);
  el('rect', { x: x + 8 * u, y: y + 12 * u, width: bw, height: bh, rx: 22 * u, fill: 'rgba(0,0,0,0.4)' }, group);
  el('rect', { x, y, width: bw, height: bh, rx: 22 * u, fill: '#FFFFFF' }, group);
  // Five stars.
  for (let i = 0; i < 5; i += 1) {
    text(group, '\u2605', { x: x + pad + i * 40 * u, y: y + pad + 10 * u, fill: '#E8A33C', 'font-size': 40 * u, 'font-family': 'Inter, system-ui, sans-serif' });
  }
  rows.forEach((row, i) => {
    text(group, row, { x: x + pad, y: y + pad + 56 * u + i * fs * 1.35, fill: '#101828', 'font-family': 'Inter, system-ui, sans-serif', 'font-size': fs, 'font-weight': 600 });
  });
  el('rect', { x, y, width: 10 * u, height: bh, rx: 5 * u, fill: accent }, group);
  gsap.set(group, { opacity: 0, x: W * 0.12 });
  tl.to(group, { opacity: 1, x: 0, duration: 0.5, ease: 'power3.out' }, 0.3);
  tl.to(group, { y: -8 * u, duration: 1.8, ease: 'sine.inOut', repeat: -1, yoyo: true }, 1.0);
  tl.to(group, { opacity: 0, duration: 0.5, ease: 'power2.in' }, Math.max(1, duration - 0.5));
}

function paintStat(svg: SVGSVGElement, tl: any, statText: string, W: number, H: number, duration: number, accent: string) {
  if (!statText.trim()) return;
  const u = Math.min(W, H) / 1080;
  const m = /([0-9][0-9,.]*)/.exec(statText);
  const target = m ? Number(m[1].replace(/,/g, '')) : 0;
  const prefix = m ? statText.slice(0, m.index).trim() : '';
  const suffix = m ? statText.slice(m.index + m[1].length).trim() : statText;
  const group = el<SVGGElement>('g', {}, svg);
  const cy = H * 0.3;
  const numNode = text(group, m ? '0' : '', {
    x: W / 2, y: cy, 'text-anchor': 'middle', fill: accent,
    'font-family': 'Inter, system-ui, sans-serif', 'font-size': 150 * u, 'font-weight': 900,
    stroke: 'rgba(10,15,30,0.85)', 'stroke-width': 10 * u, 'paint-order': 'stroke',
  });
  const labelRows = wrapWords(`${prefix} ${suffix}`.trim(), H >= W ? 20 : 34);
  labelRows.forEach((row, i) => {
    text(group, row, {
      x: W / 2, y: cy + 70 * u + i * 52 * u, 'text-anchor': 'middle', fill: '#FFFFFF',
      'font-family': 'Inter, system-ui, sans-serif', 'font-size': 44 * u, 'font-weight': 700,
      stroke: 'rgba(10,15,30,0.85)', 'stroke-width': 6 * u, 'paint-order': 'stroke',
    });
  });
  fadeWindow(tl, group, 0.3, duration);
  if (m && target > 0) {
    const counter = { v: 0 };
    const decimals = m[1].includes('.') ? 1 : 0;
    tl.to(counter, {
      v: target, duration: Math.min(1.6, duration * 0.4), ease: 'power2.out',
      onUpdate: () => { numNode.textContent = counter.v.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ','); },
    }, 0.35);
  }
}

function paintCta(svg: SVGSVGElement, tl: any, cta: string, W: number, H: number, duration: number, accent: string) {
  if (!cta.trim()) return;
  const u = Math.min(W, H) / 1080;
  const fs = 52 * u;
  const label = cta.trim().slice(0, 40);
  const bw = Math.min(W * 0.86, label.length * fs * 0.6 + 90 * u);
  const bh = fs + 56 * u;
  const x = (W - bw) / 2; const y = H * 0.68 - bh;
  const group = el<SVGGElement>('g', {}, svg);
  el('rect', { x: x + 6 * u, y: y + 10 * u, width: bw, height: bh, rx: bh / 2, fill: 'rgba(0,0,0,0.45)' }, group);
  const btn = el('rect', { x, y, width: bw, height: bh, rx: bh / 2, fill: accent }, group);
  text(group, label, {
    x: W / 2, y: y + bh / 2 + fs * 0.36, 'text-anchor': 'middle', fill: '#FFFFFF',
    'font-family': 'Inter, system-ui, sans-serif', 'font-size': fs, 'font-weight': 800,
  });
  gsap.set(group, { opacity: 0, scale: 0.6, transformOrigin: '50% 50%' });
  tl.to(group, { opacity: 1, scale: 1, duration: 0.45, ease: 'back.out(1.8)' }, 0.3);
  tl.to(btn, { attr: { x: x - 6 * u, y: y - 4 * u, width: bw + 12 * u, height: bh + 8 * u } as any, duration: 0.7, ease: 'sine.inOut', repeat: -1, yoyo: true }, 0.9);
  tl.to(group, { opacity: 0, duration: 0.5, ease: 'power2.in' }, Math.max(1, duration - 0.5));
}

function paintArrow(svg: SVGSVGElement, tl: any, W: number, H: number, duration: number, accent: string) {
  const u = Math.min(W, H) / 1080;
  const group = el<SVGGElement>('g', {}, svg);
  const x1 = W * 0.18; const y1 = H * 0.38; const x2 = W * 0.46; const y2 = H * 0.52;
  const d = `M ${x1} ${y1} Q ${W * 0.22} ${H * 0.52}, ${x2} ${y2}`;
  const path = el<SVGPathElement>('path', { d, fill: 'none', stroke: accent, 'stroke-width': 10 * u, 'stroke-linecap': 'round' }, group);
  const head = el('path', { d: `M ${x2 - 34 * u} ${y2 - 30 * u} L ${x2} ${y2} L ${x2 - 42 * u} ${y2 + 12 * u}`, fill: 'none', stroke: accent, 'stroke-width': 10 * u, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, group);
  const len = path.getTotalLength ? path.getTotalLength() : 600;
  gsap.set(path, { strokeDasharray: len, strokeDashoffset: len });
  gsap.set(head, { opacity: 0 });
  tl.to(path, { strokeDashoffset: 0, duration: 0.6, ease: 'power2.inOut' }, 0.35);
  tl.to(head, { opacity: 1, duration: 0.2 }, 0.9);
  tl.to(group, { opacity: 0, duration: 0.5, ease: 'power2.in' }, Math.max(1, duration - 0.5));
}

function paintLogo(svg: SVGSVGElement, tl: any, logoDataUrl: string, W: number, H: number, duration: number) {
  if (!logoDataUrl) return;
  const u = Math.min(W, H) / 1080;
  const size = 110 * u;
  const group = el<SVGGElement>('g', {}, svg);
  const img = el('image', { x: W - size - 34 * u, y: 34 * u, width: size, height: size, preserveAspectRatio: 'xMidYMid meet', opacity: 0.85 }, group);
  img.setAttribute('href', logoDataUrl);
  img.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', logoDataUrl);
  gsap.set(group, { opacity: 0 });
  tl.to(group, { opacity: 1, duration: 0.4 }, 0.3);
  tl.to(group, { opacity: 0, duration: 0.4 }, Math.max(0.8, duration - 0.45));
}

// ---------------------------------------------------------------------------
// The per-clip overlay builder
// ---------------------------------------------------------------------------

export interface OverlayContext {
  screenshots: UploadedAsset[];
  productImages: UploadedAsset[];
  generatedAssets: GeneratedAsset[];
  logo: UploadedAsset | null;
  offerCta: string;
  reviewQuote: string;
  accent?: string;
}

function resolveAssetUrl(names: string[], ctx: OverlayContext): string {
  const pool = [
    ...ctx.screenshots, ...ctx.productImages,
    ...ctx.generatedAssets.map((g) => ({ name: g.description, url: g.url })),
  ];
  for (const n of names || []) {
    const hit = pool.find((a) => a.name === n || a.url === n || a.name.toLowerCase().includes(String(n || '').toLowerCase()));
    if (hit) return hit.url;
  }
  return pool[0]?.url || '';
}

/**
 * Build one clip's full overlay animation (device mockup / callout / proof /
 * CTA / arrow + always the caption pill + optional logo watermark) on the
 * chroma-key background. Returns hasContent=false when there is nothing to
 * composite so the assembler can skip the keying pass entirely.
 */
export async function buildClipOverlay(
  plan: ScenePlan,
  script: ScriptClip,
  ctx: OverlayContext,
  W: number,
  H: number,
  durationSec: number,
): Promise<BuiltOverlay> {
  const accent = ctx.accent || '#3B82F6';
  const duration = Math.max(2, durationSec);
  const svg = el<SVGSVGElement>('svg', { xmlns: SVG_NS, viewBox: `0 0 ${W} ${H}`, width: W, height: H });
  el('defs', {}, svg);
  el('rect', { x: 0, y: 0, width: W, height: H, fill: KEY_COLOR }, svg);
  const tl = gsap.timeline({ paused: true });
  const uid = Math.random().toString(36).slice(2, 8);
  let hasContent = false;

  if (plan.use_screenshot_mockup || plan.overlay_type === 'screenshot_mockup') {
    const url = resolveAssetUrl(plan.overlay_assets, ctx);
    const dataUrl = await toDataUrl(url);
    paintMockup(svg, tl, plan.screenshot_mockup_type || 'phone', dataUrl, W, H, duration, uid);
    hasContent = true;
  } else if (plan.overlay_type === 'text_callout') {
    paintTextCallout(svg, tl, plan.overlay_text || script.overlay_idea, W, H, duration, accent);
    hasContent = !!(plan.overlay_text || script.overlay_idea).trim();
  } else if (plan.overlay_type === 'review_card') {
    const quote = plan.overlay_text || ctx.reviewQuote;
    paintReviewCard(svg, tl, quote, W, H, duration, accent);
    hasContent = !!quote.trim();
  } else if (plan.overlay_type === 'stat_counter') {
    paintStat(svg, tl, plan.overlay_text, W, H, duration, accent);
    hasContent = !!plan.overlay_text.trim();
  } else if (plan.overlay_type === 'cta_button') {
    paintCta(svg, tl, plan.overlay_text || ctx.offerCta || 'Try it today', W, H, duration, accent);
    hasContent = true;
  } else if (plan.overlay_type === 'arrow_highlight') {
    paintArrow(svg, tl, W, H, duration, accent);
    hasContent = true;
  }

  if (ctx.logo?.url) {
    const logoData = await toDataUrl(ctx.logo.url);
    if (logoData) { paintLogo(svg, tl, logoData, W, H, duration); hasContent = true; }
  }

  // Burned-in styled subtitle — the spoken line, timed to the clip.
  paintCaption(svg, tl, script.spoken_line, W, H, duration, accent);
  if (script.spoken_line.trim()) hasContent = true;

  return { svg, timeline: tl, durationSec: duration, hasContent };
}

// ---------------------------------------------------------------------------
// Capture — GSAP over SVG → canvas frames → MediaRecorder WebM. Serialized:
// MediaRecorder is realtime work; two recorders degrade both clips.
// ---------------------------------------------------------------------------

let captureQueue: Promise<unknown> = Promise.resolve();
function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = captureQueue.then(work, work);
  captureQueue = next.catch(() => undefined);
  return next;
}

function recorderMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) || '';
}

export async function recordOverlay(built: BuiltOverlay, W: number, H: number): Promise<Blob> {
  return enqueue(async () => {
    const mime = recorderMime();
    if (!mime) throw new Error('This browser cannot record motion graphics (MediaRecorder unavailable).');
    const host = document.createElement('div');
    host.style.cssText = `position:fixed;left:-100000px;top:0;width:${W}px;height:${H}px;pointer-events:none;opacity:0;`;
    host.appendChild(built.svg);
    document.body.appendChild(host);

    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) { host.remove(); throw new Error('Canvas 2D is unavailable in this browser.'); }
    ctx.fillStyle = KEY_COLOR; ctx.fillRect(0, 0, W, H);

    const serializer = new XMLSerializer();
    let rasterBusy = false;
    let stopped = false;
    const paint = () => {
      if (rasterBusy || stopped) return;
      rasterBusy = true;
      const markup = serializer.serializeToString(built.svg);
      const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
      const frame = new Image();
      frame.onload = () => { try { if (!stopped) { ctx.fillStyle = KEY_COLOR; ctx.fillRect(0, 0, W, H); ctx.drawImage(frame, 0, 0, W, H); } } finally { URL.revokeObjectURL(url); rasterBusy = false; } };
      frame.onerror = () => { URL.revokeObjectURL(url); rasterBusy = false; };
      frame.src = url;
    };

    const stream = canvas.captureStream(FPS);
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const done = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });

    const totalMs = (built.durationSec + 0.25) * 1000;
    let raf = 0;
    const tick = () => {
      if (stopped) return;
      paint();
      raf = requestAnimationFrame(tick);
    };

    try {
      paint();
      await new Promise((r) => setTimeout(r, 120)); // first frame before recording
      recorder.start(500);
      built.timeline.play(0);
      raf = requestAnimationFrame(tick);
      await new Promise((r) => setTimeout(r, totalMs));
      stopped = true;
      cancelAnimationFrame(raf);
      recorder.stop();
      await done;
    } finally {
      stopped = true;
      cancelAnimationFrame(raf);
      try { built.timeline.kill(); } catch { /* released */ }
      stream.getTracks().forEach((t) => t.stop());
      host.remove();
    }
    const blob = new Blob(chunks, { type: 'video/webm' });
    if (!blob.size) throw new Error('The overlay recording came back empty.');
    return blob;
  });
}
