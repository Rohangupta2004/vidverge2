/**
 * PRODUCT MOCKUP LAYER — the user's REAL screenshot inside a professional
 * phone / laptop / browser frame, animated with GSAP (scroll, zoom, pan,
 * highlight) and captured to a clip by the capture layer.
 *
 * Veo is NEVER asked to recreate a UI — the pixels on the device screen are
 * the actual screenshot, inlined as a data: URL so SVG rasterization sees it.
 */

import { gsap } from 'https://esm.sh/gsap@3.12.5';
import { FilmStyle, MockupSpec, Palette } from '../api';
import { BuiltAnimation, toDataUrl } from './capture';
import { resolvePalette } from './graphics';

const SVG_NS = 'http://www.w3.org/2000/svg';
const FONT = "Inter, -apple-system, 'Segoe UI', Arial, sans-serif";

type Attrs = Record<string, string | number>;
function el<T extends SVGElement>(tag: string, attrs: Attrs = {}, parent?: SVGElement | null): T {
  const node = document.createElementNS(SVG_NS, tag) as T;
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, String(v)));
  if (parent) parent.appendChild(node);
  return node;
}

function mix(hex: string, opacity: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${opacity})`;
}

function setImageHref(img: SVGElement, href: string) {
  img.setAttribute('href', href);
  img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', href);
}

export async function inlineMockupImages(spec: MockupSpec): Promise<MockupSpec> {
  const copy: MockupSpec = JSON.parse(JSON.stringify(spec));
  copy.screenshot_url = (await toDataUrl(copy.screenshot_url)) || copy.screenshot_url;
  if (!copy.screenshot_url.startsWith('data:')) throw new Error('The product screenshot could not be loaded for the mockup scene.');
  return copy;
}

async function imageDims(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 1200, h: img.naturalHeight || 800 });
    img.onerror = () => resolve({ w: 1200, h: 800 });
    img.src = dataUrl;
  });
}

/**
 * Build the animated device mockup. Call inlineMockupImages() first — the
 * screenshot must already be a data: URL.
 */
export async function buildMockup(spec: MockupSpec, W: number, H: number, durationSec: number, style?: FilmStyle | null): Promise<BuiltAnimation> {
  const P: Palette = resolvePalette({ palette: spec.palette, title: spec.headline || 'product' }, '', style);
  // The director's film style applies verbatim to the mockup's text chrome.
  const font = style?.font_family || FONT;
  const headingW = style ? Math.min(900, Math.max(300, Number(style.heading_weight) || 800)) : 800;
  const bodyW = style ? Math.min(700, Math.max(300, Number(style.body_weight) || 500)) : 0;
  const portrait = H > W;
  const u = Math.min(W, H) / 1080;
  const total = Math.min(14, Math.max(3, durationSec || Number(spec.duration_s) || 7));
  const shot = await imageDims(spec.screenshot_url);

  const svg = el<SVGSVGElement>('svg', { xmlns: SVG_NS, viewBox: `0 0 ${W} ${H}`, width: W, height: H });
  const defs = el('defs', {}, svg);

  // Stage backdrop — soft branded gradient, never flat gray.
  el('rect', { x: 0, y: 0, width: W, height: H, fill: P.bg }, svg);
  const gid = `mk${Math.floor(Math.random() * 1e9)}`;
  const grad = el('radialGradient', { id: gid, cx: '50%', cy: '18%', r: '95%' }, defs);
  el('stop', { offset: '0%', 'stop-color': P.accent, 'stop-opacity': 0.22 }, grad);
  el('stop', { offset: '100%', 'stop-color': P.accent, 'stop-opacity': 0 }, grad);
  el('rect', { x: 0, y: 0, width: W, height: H, fill: `url(#${gid})` }, svg);

  const root = el<SVGGElement>('g', { opacity: 0 }, svg);
  const tl = gsap.timeline({ paused: true });
  tl.to(root, { opacity: 1, duration: 0.35, ease: 'power1.out' }, 0);

  // ----- device geometry -----
  const device = spec.device === 'phone' || spec.device === 'laptop' ? spec.device : 'browser';
  let screenX = 0; let screenY = 0; let screenW = 0; let screenH = 0;
  const deviceGroup = el<SVGGElement>('g', {}, root);

  if (device === 'phone') {
    const bodyH = H * (portrait ? 0.72 : 0.78);
    const bodyW = bodyH * 0.485;
    const bx = W / 2 - bodyW / 2;
    const by = H * 0.5 - bodyH / 2 + (spec.headline ? H * 0.03 : 0);
    el('rect', { x: bx - 8 * u, y: by - 8 * u, width: bodyW + 16 * u, height: bodyH + 16 * u, rx: 58 * u, fill: '#0B0C10', stroke: mix(P.ink, 0.35), 'stroke-width': 2.5 * u }, deviceGroup);
    screenX = bx + 10 * u; screenY = by + 10 * u; screenW = bodyW - 20 * u; screenH = bodyH - 20 * u;
    // Notch drawn after the screenshot so it reads as hardware.
  } else if (device === 'laptop') {
    const lidW = Math.min(W * 0.72, H * 1.15);
    const lidH = lidW * 0.625;
    const lx = W / 2 - lidW / 2;
    const ly = H * 0.5 - lidH / 2 - H * 0.03 + (spec.headline ? H * 0.03 : 0);
    el('rect', { x: lx - 14 * u, y: ly - 14 * u, width: lidW + 28 * u, height: lidH + 28 * u, rx: 26 * u, fill: '#0B0C10', stroke: mix(P.ink, 0.35), 'stroke-width': 2.5 * u }, deviceGroup);
    screenX = lx; screenY = ly; screenW = lidW; screenH = lidH;
    // Base + keyboard deck.
    el('rect', { x: W / 2 - lidW * 0.62, y: ly + lidH + 14 * u, width: lidW * 1.24, height: 26 * u, rx: 13 * u, fill: '#15161C', stroke: mix(P.ink, 0.25), 'stroke-width': 2 * u }, deviceGroup);
    el('rect', { x: W / 2 - lidW * 0.09, y: ly + lidH + 14 * u, width: lidW * 0.18, height: 10 * u, rx: 5 * u, fill: '#23242C' }, deviceGroup);
  } else {
    const winW = Math.min(W * 0.76, H * 1.25);
    const winH = winW * 0.62;
    const wx = W / 2 - winW / 2;
    const wy = H * 0.5 - winH / 2 + (spec.headline ? H * 0.03 : 0);
    const chrome = 54 * u;
    el('rect', { x: wx, y: wy, width: winW, height: winH + chrome, rx: 18 * u, fill: '#15161C', stroke: mix(P.ink, 0.3), 'stroke-width': 2.5 * u }, deviceGroup);
    ['#F26D6D', '#F2B84B', '#57C785'].forEach((c, i) => el('circle', { cx: wx + 30 * u + i * 30 * u, cy: wy + chrome / 2, r: 8 * u, fill: c }, deviceGroup));
    const barW = winW * 0.6;
    el('rect', { x: wx + winW / 2 - barW / 2, y: wy + chrome / 2 - 15 * u, width: barW, height: 30 * u, rx: 15 * u, fill: '#0B0C10' }, deviceGroup);
    if (spec.url_bar_text) {
      const urlText = el<SVGTextElement>('text', { x: wx + winW / 2, y: wy + chrome / 2 + 7 * u, 'font-family': font, 'font-size': 19 * u, 'font-weight': bodyW || 500, fill: mix(P.ink, 0.6), 'text-anchor': 'middle' }, deviceGroup);
      urlText.textContent = String(spec.url_bar_text).slice(0, 60);
    }
    screenX = wx + 3 * u; screenY = wy + chrome; screenW = winW - 6 * u; screenH = winH - 3 * u;
  }

  // Drop shadow under the device.
  const shadow = el('ellipse', { cx: W / 2, cy: screenY + screenH + (device === 'laptop' ? 70 : 60) * u, rx: screenW * 0.62, ry: 22 * u, fill: 'rgba(0,0,0,0.45)' }, root);
  root.insertBefore(shadow, deviceGroup);

  // ----- the real screenshot inside a clipped screen -----
  const clipId = `mkclip${Math.floor(Math.random() * 1e9)}`;
  const clip = el('clipPath', { id: clipId }, defs);
  el('rect', { x: screenX, y: screenY, width: screenW, height: screenH, rx: device === 'phone' ? 44 * u : 8 * u }, clip);
  const screen = el<SVGGElement>('g', { 'clip-path': `url(#${clipId})` }, deviceGroup);
  el('rect', { x: screenX, y: screenY, width: screenW, height: screenH, fill: '#0E0F13' }, screen);

  // Fit the screenshot by WIDTH (top-aligned) so scroll motion has real travel.
  const imgW = screenW;
  const imgH = (shot.h / shot.w) * imgW;
  const img = el('image', { x: screenX, y: screenY, width: imgW, height: Math.max(imgH, screenH), preserveAspectRatio: 'xMidYMin slice' }, screen);
  setImageHref(img, spec.screenshot_url);

  if (device === 'phone') {
    el('rect', { x: W / 2 - 60 * u, y: screenY + 8 * u, width: 120 * u, height: 26 * u, rx: 13 * u, fill: '#0B0C10' }, deviceGroup);
  }

  // ----- entrance -----
  gsap.set(deviceGroup, { transformOrigin: '50% 50%', y: 40 * u, opacity: 0, scale: 0.96 });
  tl.to(deviceGroup, { y: 0, opacity: 1, scale: 1, duration: 0.7, ease: 'power3.out' }, 0.1);
  gsap.set(shadow, { opacity: 0 });
  tl.to(shadow, { opacity: 1, duration: 0.7 }, 0.2);

  // ----- motion -----
  const motionSpan = Math.max(1.2, total - 1.6);
  const focus = spec.focus && Number.isFinite(spec.focus.x) ? spec.focus : null;
  if (spec.motion === 'scroll' && imgH > screenH * 1.05) {
    const travel = Math.min(imgH - screenH, screenH * 1.6);
    tl.to(img, { y: -travel, duration: motionSpan, ease: 'power1.inOut' }, 0.9);
  } else if (spec.motion === 'zoom') {
    const fx = screenX + screenW * (focus ? focus.x + focus.w / 2 : 0.5);
    const fy = screenY + screenH * (focus ? focus.y + focus.h / 2 : 0.42);
    gsap.set(deviceGroup, { transformOrigin: `${(fx / W) * 100}% ${(fy / H) * 100}%` });
    tl.to(deviceGroup, { scale: focus ? 1.7 : 1.28, duration: motionSpan, ease: 'power2.inOut' }, 0.9);
  } else if (spec.motion === 'pan') {
    tl.to(deviceGroup, { x: -W * 0.045, duration: motionSpan, ease: 'sine.inOut' }, 0.9);
    tl.to(deviceGroup, { scale: 1.08, duration: motionSpan, ease: 'sine.inOut' }, 0.9);
  } else if (spec.motion === 'highlight' && focus) {
    const hx = screenX + screenW * focus.x;
    const hy = screenY + screenH * focus.y;
    const hw = screenW * focus.w;
    const hh = screenH * focus.h;
    const dim = el('rect', { x: screenX, y: screenY, width: screenW, height: screenH, fill: 'rgba(0,0,0,0.55)', opacity: 0 }, screen);
    const hole = el('rect', { x: hx, y: hy, width: hw, height: hh, rx: 12 * u, fill: 'none', stroke: P.accent, 'stroke-width': 5 * u, opacity: 0 }, deviceGroup);
    // Dim everything, then cut the highlight window back out with a lighter pass.
    const window_ = el('rect', { x: hx, y: hy, width: hw, height: hh, rx: 12 * u, fill: mix('#ffffff', 0.06), opacity: 0 }, screen);
    tl.to(dim, { opacity: 1, duration: 0.5 }, 1.1);
    tl.to(window_, { opacity: 1, duration: 0.5 }, 1.1);
    tl.to(hole, { opacity: 1, duration: 0.4, ease: 'power2.out' }, 1.2);
    tl.fromTo(hole, { scale: 1.06, transformOrigin: '50% 50%' }, { scale: 1, duration: 0.5, ease: 'back.out(2)' }, 1.2);
    tl.to(deviceGroup, { scale: 1.12, transformOrigin: `${((hx + hw / 2) / W) * 100}% ${((hy + hh / 2) / H) * 100}%`, duration: motionSpan * 0.7, ease: 'power2.inOut' }, 1.3);
  } else {
    // Default gentle push.
    tl.to(deviceGroup, { scale: 1.1, duration: motionSpan, ease: 'power1.inOut' }, 0.9);
  }

  // ----- exact headline / caption (deterministic text) -----
  if (spec.headline) {
    const hl = el<SVGTextElement>('text', { x: W / 2, y: H * (portrait ? 0.09 : 0.11), 'font-family': font, 'font-size': 46 * u, 'font-weight': headingW, fill: P.ink, 'text-anchor': 'middle' }, root);
    hl.textContent = String(spec.headline).slice(0, portrait ? 28 : 52);
    gsap.set(hl, { y: -20 * u, opacity: 0 });
    tl.to(hl, { y: 0, opacity: 1, duration: 0.55, ease: 'power3.out' }, 0.35);
  }
  if (spec.caption) {
    const cap = el<SVGGElement>('g', {}, root);
    const capW = Math.min(W * 0.8, String(spec.caption).length * 15 * u + 70 * u);
    el('rect', { x: W / 2 - capW / 2, y: H * 0.9 - 34 * u, width: capW, height: 52 * u, rx: 26 * u, fill: mix(P.bg, 0.88), stroke: P.accent, 'stroke-width': 2 }, cap);
    const capText = el<SVGTextElement>('text', { x: W / 2, y: H * 0.9, 'font-family': font, 'font-size': 24 * u, 'font-weight': bodyW || 600, fill: P.ink, 'text-anchor': 'middle' }, root);
    capText.textContent = String(spec.caption).slice(0, 64);
    cap.appendChild(capText);
    gsap.set(cap, { y: 18 * u, opacity: 0 });
    tl.to(cap, { y: 0, opacity: 1, duration: 0.5, ease: 'power3.out' }, 0.9);
  }

  // Clean fade for the cut.
  tl.to(root, { opacity: 0, duration: 0.4, ease: 'power1.in' }, total - 0.42);

  return { svg, timeline: tl, durationSec: total };
}
