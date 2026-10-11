// Motion-graphic PLATES: the bridge between what the editor previews and what
// the platform's server-side compositor can actually burn into an MP4.
//
// The platform's portrait compositor (`video-overlay`) takes timed full-frame
// assets and keeps the base audio. It cannot draw type. So every text, brand
// and caption layer is rasterised here — at the exact export frame size, on a
// transparent canvas, with the same geometry the preview uses — uploaded as a
// PNG, and handed to the compositor as a timed `graphic` overlay. The pixels
// the customer sees in the preview are the pixels ffmpeg composites.
//
// Nothing in this file composites video. It only produces artwork.
import { uploadFile } from './proxy';
import { PRELOAD_FONT_SPECS } from './motionPresets';
import { FRAME, type AspectRatio, type BrandLayer, type CaptionSegment, type CaptionStyle, type TextLayer } from './motionEditor';

const PLATE_FOLDER = 'sceneforge-v2/motion-editor/plates';

/** Uploaded plates are reused across exports: identical artwork, one upload. */
const plateCache = new Map<string, string>();

export class PlateError extends Error {
  /** The layer that could not be rasterised, so the UI can point at it. */
  layerId: string;
  constructor(message: string, layerId = '') {
    super(message);
    this.name = 'PlateError';
    this.layerId = layerId;
  }
}

function canvasFor(aspect: AspectRatio): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; w: number; h: number } {
  const { w, h } = FRAME[aspect];
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new PlateError('This browser could not open a drawing canvas, so overlays cannot be rendered.');
  ctx.clearRect(0, 0, w, h);
  return { canvas, ctx, w, h };
}

async function toUploadedPng(canvas: HTMLCanvasElement, fingerprint: string): Promise<string> {
  const cached = plateCache.get(fingerprint);
  if (cached) return cached;
  const blob = await new Promise<Blob | null>((resolve) => {
    try { canvas.toBlob((value) => resolve(value), 'image/png'); }
    catch { resolve(null); }
  });
  if (!blob) throw new PlateError('The overlay artwork could not be read back from the canvas. If it uses an external logo, upload the logo file instead of linking it.');
  const file = new File([blob], `plate-${fingerprint.slice(0, 24)}.png`, { type: 'image/png' });
  const stored = await uploadFile(file, PLATE_FOLDER);
  plateCache.set(fingerprint, stored.url);
  return stored.url;
}

function hash(value: string): string {
  let out = 0;
  for (let i = 0; i < value.length; i += 1) out = (out * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(out).toString(36);
}

/**
 * Read an image into something a canvas can export from. A `fetch` + bitmap
 * read keeps the canvas untainted; a crossOrigin <img> is the fallback. Both
 * failing is reported as a plate error naming the fix (upload the file), not
 * swallowed into a silently missing logo.
 */
export async function loadDrawable(url: string, layerId = ''): Promise<CanvasImageSource & { width: number; height: number }> {
  try {
    const response = await fetch(url, { mode: 'cors' });
    if (response.ok) {
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      return bitmap as any;
    }
  } catch { /* fall through to the <img> path */ }
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image as any);
    image.onerror = () => reject(new PlateError('That image could not be read for compositing. Upload the file instead of linking it from another site.', layerId));
    image.src = url;
  });
}

export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const paragraphs = String(text || '').split(/\n/);
  const lines: string[] = [];
  paragraphs.forEach((paragraph) => {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(''); return; }
    let line = words[0];
    for (let i = 1; i < words.length; i += 1) {
      const candidate = `${line} ${words[i]}`;
      if (ctx.measureText(candidate).width <= maxWidth) line = candidate;
      else { lines.push(line); line = words[i]; }
    }
    lines.push(line);
  });
  return lines.slice(0, 8);
}

/** `#rrggbb` plus an alpha, for a gradient stop. Non-hex input passes through. */
function rgba(color: string, alpha: number): string {
  const hex = String(color || '').trim();
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return hex || `rgba(255,255,255,${alpha})`;
  const value = parseInt(match[1], 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${Math.max(0, Math.min(1, alpha))})`;
}

/**
 * Canvas letter-spacing. Chromium and Safari 17+ honour `ctx.letterSpacing`
 * AND fold it into `measureText`, so wrapping stays correct when it is set.
 * An engine without it simply draws the type untracked — a slightly tighter
 * title, never a broken layout.
 */
function applyTracking(ctx: CanvasRenderingContext2D, em: number, sizePx: number) {
  if (!('letterSpacing' in ctx)) return;
  const px = Math.round((Number(em) || 0) * sizePx * 100) / 100;
  (ctx as any).letterSpacing = `${px}px`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
  ctx.fill();
}

interface TextGeometry { lines: string[]; lineHeight: number; boxWidth: number; left: number; top: number; anchorX: number }

/** Geometry shared by the canvas plate and the DOM preview so they agree. */
export function textGeometry(ctx: CanvasRenderingContext2D, layer: TextLayer, frameW: number, frameH: number): TextGeometry {
  ctx.font = `${layer.weight} ${layer.sizePx}px ${layer.font}, Inter, system-ui, sans-serif`;
  // Tracking is set BEFORE anything is measured: it changes every advance
  // width, so wrapping computed without it would break lines in the wrong
  // places on a widely tracked cinematic title.
  applyTracking(ctx, Number(layer.trackingEm) || 0, layer.sizePx);
  const boxWidth = Math.round(frameW * layer.width);
  const lines = wrapText(ctx, layer.text, boxWidth);
  const lineHeight = Math.round(layer.sizePx * 1.18);
  const blockHeight = lineHeight * lines.length;
  const left = Math.round(frameW * layer.x - boxWidth / 2);
  const top = Math.round(frameH * layer.y - blockHeight / 2);
  const anchorX = layer.align === 'left' ? left : layer.align === 'right' ? left + boxWidth : left + boxWidth / 2;
  return { lines, lineHeight, boxWidth, left, top, anchorX };
}

/**
 * Make sure Poppins and Inter are really resident before anything is drawn.
 *
 * `document.fonts.ready` alone is not enough: a webfont the page has not
 * USED yet is never fetched, so the first plate would silently rasterise in
 * the system fallback and look nothing like the preview. Each family is
 * therefore requested explicitly, and a family that fails to load is skipped
 * rather than allowed to reject the whole export.
 */
async function waitForFonts() {
  try {
    const fonts = (document as any).fonts;
    if (fonts?.load) await Promise.all(PRELOAD_FONT_SPECS.map((spec: string) => fonts.load(spec).catch(() => undefined)));
    await fonts?.ready;
  } catch { /* the default family still draws */ }
}

/**
 * One frame of a layer's entrance. The export emits a short sequence of these
 * so a fade / slide / pop / typewriter entrance is REALLY in the MP4 rather
 * than only in the preview.
 */
export interface PlateStepOptions {
  alpha?: number;
  /** Vertical offset as a fraction of the frame height. */
  offsetY?: number;
  /** Uniform scale about the layer's anchor. */
  scale?: number;
  /** Replaces the layer's own copy (typewriter steps). */
  textOverride?: string;
  /**
   * 0–1 of a clip-path reveal. `clip-reveal` uncovers left-to-right,
   * `mask-wipe` uncovers bottom-to-top. 1 (or absent) draws the finished
   * plate. This is what makes a reveal a REVEAL in the exported MP4 rather
   * than a fade that only the preview shows.
   */
  clipProgress?: number;
}

export async function renderTextPlate(layer: TextLayer, aspect: AspectRatio, step: PlateStepOptions = {}): Promise<string> {
  await waitForFonts();
  const { canvas, ctx, w, h } = canvasFor(aspect);
  const alpha = Math.max(0.02, Math.min(1, step.alpha == null ? 1 : step.alpha));
  const scale = Math.max(0.4, Math.min(1.6, step.scale == null ? 1 : step.scale));
  const reveal = step.clipProgress == null ? 1 : Math.max(0, Math.min(1, step.clipProgress));
  const shifted: TextLayer = {
    ...layer,
    text: step.textOverride == null ? layer.text : step.textOverride,
    sizePx: Math.round(layer.sizePx * scale),
    y: Math.max(0, Math.min(1, layer.y + (step.offsetY || 0))),
  };
  ctx.globalAlpha = alpha;
  const geometry = textGeometry(ctx, shifted, w, h);
  ctx.textBaseline = 'top';
  ctx.textAlign = shifted.align as CanvasTextAlign;
  const rendered = shifted;
  const blockHeight = geometry.lineHeight * Math.max(1, geometry.lines.length);

  // The reveal clips EVERYTHING this plate draws — backdrop included — so a
  // plated title wipes on as one object instead of the box appearing a frame
  // before the words inside it.
  if (reveal < 1) {
    const padX = Math.round(rendered.sizePx * 0.8);
    const padY = Math.round(rendered.sizePx * 0.6);
    const left = geometry.left - padX;
    const width = geometry.boxWidth + padX * 2;
    const top = geometry.top - padY;
    const height = blockHeight + padY * 2;
    ctx.save();
    ctx.beginPath();
    if (rendered.anim === 'mask-wipe') {
      const visible = Math.round(height * reveal);
      ctx.rect(left, top + height - visible, width, visible);
    } else {
      ctx.rect(left, top, Math.round(width * reveal), height);
    }
    ctx.clip();
  }

  if (rendered.plate !== 'none' && geometry.lines.some((line) => line.trim())) {
    const padX = Math.round(rendered.sizePx * 0.62);
    const padY = Math.round(rendered.sizePx * 0.38);
    const widest = geometry.lines.reduce((max, line) => Math.max(max, ctx.measureText(line).width), 0);
    const plateW = Math.min(w - 24, widest + padX * 2);
    const plateH = geometry.lineHeight * geometry.lines.length + padY * 2;
    const plateX = rendered.align === 'left' ? geometry.left - padX : rendered.align === 'right' ? geometry.left + geometry.boxWidth - plateW + padX : Math.round(w * rendered.x - plateW / 2);
    const plateY = geometry.top - padY;
    const gradientTo = String(rendered.plateGradientTo || '');
    if (gradientTo) {
      const fill = ctx.createLinearGradient(plateX, plateY, plateX + plateW, plateY + plateH);
      fill.addColorStop(0, rendered.plateColor);
      fill.addColorStop(1, gradientTo);
      ctx.fillStyle = fill;
    } else {
      ctx.fillStyle = rendered.plateColor;
    }
    if (rendered.plate === 'pill') roundRect(ctx, plateX, plateY, plateW, plateH, plateH / 2);
    else roundRect(ctx, plateX, plateY, plateW, plateH, Math.round(rendered.sizePx * 0.16));
  }

  const draw = () => geometry.lines.forEach((line, index) => {
    ctx.fillText(line, geometry.anchorX, geometry.top + index * geometry.lineHeight);
  });

  // A glow pass first, so the coloured bloom sits UNDER the solid letterform
  // rather than smearing across it.
  if (rendered.glow) {
    ctx.fillStyle = rendered.color;
    ctx.shadowColor = rgba(rendered.color, 0.9);
    ctx.shadowBlur = Math.round(rendered.sizePx * 0.6);
    draw();
    draw();
  }

  // Depth for legibility over moving video: a wide, slightly dropped shadow
  // rather than the old flat 0.45 blur.
  ctx.fillStyle = rendered.color;
  ctx.shadowColor = 'rgba(0,0,0,0.62)';
  ctx.shadowOffsetY = Math.round(rendered.sizePx * 0.05);
  ctx.shadowBlur = Math.round(rendered.sizePx * 0.3);
  draw();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  if (reveal < 1) ctx.restore();
  ctx.globalAlpha = 1;
  return toUploadedPng(canvas, hash(`text:${aspect}:${JSON.stringify({ ...rendered, start: 0, duration: 0, hidden: false })}:${alpha}:${reveal}`));
}

/**
 * Film grain, as one full-frame plate held for the whole export.
 *
 * The noise is generated once into a small tile and repeated: filling a
 * 1080×1920 ImageData pixel by pixel is two million random values and locks
 * the main thread for long enough to look like a hang.
 */
export async function renderGrainPlate(aspect: AspectRatio, opacity: number): Promise<string> {
  const { canvas, ctx, w, h } = canvasFor(aspect);
  const strength = Math.max(0.01, Math.min(0.12, Number(opacity) || 0.04));
  const tileSize = 128;
  const tile = document.createElement('canvas');
  tile.width = tileSize;
  tile.height = tileSize;
  const tileCtx = tile.getContext('2d');
  if (!tileCtx) throw new PlateError('This browser could not open a drawing canvas, so the film grain could not be rendered.');
  const noise = tileCtx.createImageData(tileSize, tileSize);
  for (let i = 0; i < noise.data.length; i += 4) {
    const level = 110 + Math.round(Math.random() * 145);
    noise.data[i] = level;
    noise.data[i + 1] = level;
    noise.data[i + 2] = level;
    noise.data[i + 3] = 255;
  }
  tileCtx.putImageData(noise, 0, 0);
  const pattern = ctx.createPattern(tile, 'repeat');
  if (!pattern) throw new PlateError('The film-grain texture could not be built in this browser.');
  ctx.globalAlpha = strength;
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1;
  // The tile is random, so the fingerprint is the SETTINGS, not the pixels:
  // re-exporting the same film must reuse the grain already uploaded rather
  // than storing a new one every time.
  return toUploadedPng(canvas, hash(`grain:${aspect}:${Math.round(strength * 1000)}`));
}

/**
 * The warm light leak: a bloom anchored just outside the top-right corner,
 * the way a real flare enters frame, with a small counter-pool bottom-left so
 * the frame does not read lopsided.
 */
export async function renderLightLeakPlate(aspect: AspectRatio, accent: string, intensity = 1): Promise<string> {
  const { canvas, ctx, w, h } = canvasFor(aspect);
  const strength = Math.max(0.1, Math.min(1, Number(intensity) || 1));
  const bloom = ctx.createRadialGradient(w * 1.02, -h * 0.04, 0, w * 1.02, -h * 0.04, Math.max(w, h) * 0.82);
  bloom.addColorStop(0, rgba(accent, 0.4 * strength));
  bloom.addColorStop(0.3, rgba('#fbbf24', 0.2 * strength));
  bloom.addColorStop(0.62, rgba('#f97316', 0.08 * strength));
  bloom.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, w, h);
  const counter = ctx.createRadialGradient(-w * 0.1, h * 1.05, 0, -w * 0.1, h * 1.05, Math.max(w, h) * 0.5);
  counter.addColorStop(0, rgba(accent, 0.12 * strength));
  counter.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = counter;
  ctx.fillRect(0, 0, w, h);
  return toUploadedPng(canvas, hash(`leak:${aspect}:${accent}:${Math.round(strength * 100)}`));
}

export async function renderBrandPlate(layer: BrandLayer, aspect: AspectRatio, step: PlateStepOptions = {}): Promise<string> {
  await waitForFonts();
  const { canvas, ctx, w, h } = canvasFor(aspect);
  const stepAlpha = Math.max(0.02, Math.min(1, step.alpha == null ? 1 : step.alpha));
  const stepShift = Math.round((step.offsetY || 0) * h);
  const opacity = Math.max(0.02, Math.min(1, layer.opacity * stepAlpha));
  if (layer.kind === 'accent-bar') {
    const barH = Math.round(h * 0.012);
    const top = (layer.corner.startsWith('top') ? Math.round(h * 0.06) : Math.round(h * 0.92)) + stepShift;
    const gradient = ctx.createLinearGradient(0, 0, w, 0);
    gradient.addColorStop(0, layer.accentColor);
    gradient.addColorStop(1, layer.color);
    ctx.globalAlpha = opacity;
    ctx.fillStyle = gradient;
    const grown = Math.max(0.1, Math.min(1, 0.84 * (step.scale == null ? 1 : step.scale)));
    roundRect(ctx, Math.round(w * (1 - grown) / 2), top, Math.round(w * grown), barH, barH / 2);
    ctx.globalAlpha = 1;
  } else if (layer.kind === 'lower-third') {
    const nameSize = Math.round(w * 0.055);
    const roleSize = Math.round(w * 0.032);
    const padding = Math.round(w * 0.045);
    const boxH = nameSize + roleSize + padding * 1.6;
    const boxW = Math.round(w * 0.74);
    const left = Math.round(w * 0.07);
    const top = (layer.corner.startsWith('top') ? Math.round(h * 0.1) : Math.round(h * 0.76)) + stepShift;
    // The brief's lower-third: it slides in from the left behind an accent
    // gradient that falls away to nothing on the right, instead of a plain
    // white/dark box with hard edges.
    const reveal = step.clipProgress == null ? 1 : Math.max(0, Math.min(1, step.clipProgress));
    ctx.globalAlpha = opacity;
    if (reveal < 1) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(left, top - 4, Math.max(1, Math.round(boxW * reveal)), boxH + 8);
      ctx.clip();
    }
    if (layer.gradient) {
      const fill = ctx.createLinearGradient(left, top, left + boxW, top);
      fill.addColorStop(0, rgba(layer.accentColor, 0.9));
      fill.addColorStop(0.16, 'rgba(10,14,24,0.92)');
      fill.addColorStop(0.72, 'rgba(10,14,24,0.74)');
      fill.addColorStop(1, 'rgba(10,14,24,0)');
      ctx.fillStyle = fill;
    } else {
      ctx.fillStyle = 'rgba(8,12,20,0.78)';
    }
    roundRect(ctx, left, top, boxW, boxH, Math.round(padding * 0.6));
    ctx.fillStyle = layer.accentColor;
    roundRect(ctx, left, top, Math.round(w * 0.012), boxH, Math.round(w * 0.006));
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = Math.round(nameSize * 0.24);
    ctx.fillStyle = layer.color;
    ctx.font = `800 ${nameSize}px Poppins, Inter, system-ui, sans-serif`;
    ctx.fillText(layer.name || '', left + padding, top + padding * 0.55, boxW - padding * 2);
    ctx.fillStyle = layer.accentColor;
    ctx.font = `600 ${roleSize}px Inter, system-ui, sans-serif`;
    ctx.fillText(layer.role || '', left + padding, top + padding * 0.55 + nameSize * 1.12, boxW - padding * 2);
    ctx.shadowBlur = 0;
    if (reveal < 1) ctx.restore();
    ctx.globalAlpha = 1;
  } else {
    if (!layer.logoUrl) throw new PlateError('This logo layer has no image yet — pick or upload a logo before exporting.', layer.id);
    const logo = await loadDrawable(layer.logoUrl, layer.id);
    const logoW = Math.round(w * layer.scale * (step.scale == null ? 1 : step.scale));
    const ratio = Number(logo.height) / Math.max(1, Number(logo.width));
    const logoH = Math.round(logoW * (Number.isFinite(ratio) && ratio > 0 ? ratio : 1));
    const margin = Math.round(w * 0.055);
    const x = layer.corner.endsWith('left') ? margin : w - margin - logoW;
    const y = (layer.corner.startsWith('top') ? margin : h - margin - logoH) + stepShift;
    ctx.globalAlpha = opacity;
    ctx.drawImage(logo as any, x, y, logoW, logoH);
    ctx.globalAlpha = 1;
  }
  return toUploadedPng(canvas, hash(`brand:${aspect}:${JSON.stringify({ ...layer, start: 0, duration: 0, hidden: false })}:${stepAlpha}:${step.offsetY || 0}:${step.scale == null ? 1 : step.scale}:${step.clipProgress == null ? 1 : step.clipProgress}`));
}

export async function renderCaptionPlate(segment: CaptionSegment, style: CaptionStyle, aspect: AspectRatio): Promise<string> {
  await waitForFonts();
  const { canvas, ctx, w, h } = canvasFor(aspect);
  const size = Math.round(style.sizePx * (aspect === '16:9' ? 1.15 : 1));
  ctx.font = `700 ${size}px ${style.font}, Inter, system-ui, sans-serif`;
  const maxWidth = Math.round(w * 0.86);
  const lines = wrapText(ctx, segment.text, maxWidth).slice(0, 3);
  const lineHeight = Math.round(size * 1.22);
  const blockHeight = lineHeight * lines.length;
  const centreY = style.position === 'top' ? Math.round(h * 0.14) : style.position === 'middle' ? Math.round(h * 0.5) : Math.round(h * 0.84);
  const top = centreY - Math.round(blockHeight / 2);
  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';
  if (style.plate === 'pill') {
    const widest = lines.reduce((max, line) => Math.max(max, ctx.measureText(line).width), 0);
    const padX = Math.round(size * 0.6);
    const padY = Math.round(size * 0.34);
    const plateW = Math.min(w - 20, widest + padX * 2);
    ctx.fillStyle = style.plateColor;
    roundRect(ctx, Math.round(w / 2 - plateW / 2), top - padY, plateW, blockHeight + padY * 2, Math.round(size * 0.45));
  }
  ctx.lineWidth = Math.max(2, Math.round(size * 0.08));
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.fillStyle = style.color;
  lines.forEach((line, index) => {
    const y = top + index * lineHeight;
    if (style.plate === 'none') ctx.strokeText(line, w / 2, y);
    ctx.fillText(line, w / 2, y);
  });
  return toUploadedPng(canvas, hash(`cap:${aspect}:${style.font}:${style.sizePx}:${style.color}:${style.plate}:${style.plateColor}:${style.position}:${segment.text}`));
}

/**
 * The fallback artwork for a stat/feature card when HeyGen HyperFrames is not
 * available on the account: the same card, drawn here and composited as a
 * timed full-frame plate instead of a rendered clip. The card still lands in
 * the finished MP4 — it just does not animate.
 */
export async function renderCardPlate(
  template: string,
  variables: Record<string, string>,
  kit: { primary: string; accent: string; contrast: string; textColor: string; font: string },
  aspect: AspectRatio,
): Promise<string> {
  await waitForFonts();
  const { canvas, ctx, w, h } = canvasFor(aspect);
  const panelW = Math.round(w * 0.86);
  const panelH = Math.round(h * (aspect === '9:16' ? 0.42 : 0.6));
  const left = Math.round((w - panelW) / 2);
  const top = Math.round((h - panelH) / 2);
  const pad = Math.round(panelW * 0.08);
  const backdrop = ctx.createLinearGradient(left, top, left + panelW, top + panelH);
  backdrop.addColorStop(0, 'rgba(10,14,24,0.92)');
  backdrop.addColorStop(1, 'rgba(40,31,16,0.92)');
  ctx.fillStyle = backdrop;
  roundRect(ctx, left, top, panelW, panelH, Math.round(panelW * 0.06));
  ctx.fillStyle = kit.primary;
  roundRect(ctx, left, top, panelW, Math.round(h * 0.008), Math.round(h * 0.004));
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  const title = String(variables.title || variables.headline || variables.quote || variables.label || '');
  const body = String(variables.body || variables.subtitle || variables.detail || variables.attribution || '');
  const value = String(variables.value || variables.stat || '');
  const label = String(variables.label || '');
  const cta = String(variables.cta || variables.button || '');
  /** The filled entries of a numbered field family (step1\u2026, left1\u2026). */
  const filled = (keys: string[]) => keys.map((key) => String(variables[key] || '').trim()).filter(Boolean);

  if (template === 'step-sequence') {
    // A step sequence's content lives in step1\u2026step5, so the generic
    // title/body branch below would draw the headline and nothing under it.
    const titleSize = Math.round(panelW * 0.085);
    ctx.fillStyle = kit.textColor;
    ctx.font = `800 ${titleSize}px ${kit.font}, Inter, system-ui, sans-serif`;
    wrapText(ctx, title, panelW - pad * 2).slice(0, 2).forEach((line, index) => {
      ctx.fillText(line, left + pad, top + pad + index * Math.round(titleSize * 1.2));
    });
    const stepSize = Math.round(panelW * 0.055);
    const indent = Math.round(stepSize * 1.7);
    let y = top + pad + Math.round(titleSize * 1.7);
    filled(['step1', 'step2', 'step3', 'step4', 'step5']).forEach((step, index) => {
      ctx.fillStyle = kit.accent;
      ctx.font = `900 ${stepSize}px ${kit.font}, Inter, system-ui, sans-serif`;
      ctx.fillText(`${index + 1}`, left + pad, y);
      ctx.fillStyle = 'rgba(241,245,249,0.88)';
      ctx.font = `600 ${stepSize}px ${kit.font}, Inter, system-ui, sans-serif`;
      ctx.fillText(step, left + pad + indent, y, panelW - pad * 2 - indent);
      y += Math.round(stepSize * 1.65);
    });
  } else if (template === 'comparison-table') {
    // Two columns, drawn side by side \u2014 a comparison collapsed into one text
    // block is not a comparison.
    const colW = Math.round((panelW - pad * 3) / 2);
    const headSize = Math.round(panelW * 0.06);
    const rowSize = Math.round(panelW * 0.05);
    const columns: { head: string; rows: string[] }[] = [
      { head: String(variables.leftTitle || ''), rows: filled(['left1', 'left2', 'left3', 'left4']) },
      { head: String(variables.rightTitle || ''), rows: filled(['right1', 'right2', 'right3', 'right4']) },
    ];
    columns.forEach((column, index) => {
      const x = left + pad + index * (colW + pad);
      ctx.fillStyle = index ? kit.accent : kit.textColor;
      ctx.font = `800 ${headSize}px ${kit.font}, Inter, system-ui, sans-serif`;
      ctx.fillText(column.head, x, top + pad, colW);
      ctx.fillStyle = 'rgba(241,245,249,0.85)';
      ctx.font = `500 ${rowSize}px ${kit.font}, Inter, system-ui, sans-serif`;
      column.rows.forEach((entry, row) => {
        ctx.fillText(entry, x, top + pad + Math.round(headSize * 1.8) + row * Math.round(rowSize * 1.55), colW);
      });
    });
  } else if (template === 'stat-counter') {
    const valueSize = Math.round(panelW * 0.3);
    ctx.fillStyle = kit.accent;
    ctx.font = `900 ${valueSize}px ${kit.font}, Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(value || '0', w / 2, top + pad, panelW - pad * 2);
    ctx.fillStyle = kit.textColor;
    ctx.font = `600 ${Math.round(panelW * 0.065)}px ${kit.font}, Inter, system-ui, sans-serif`;
    wrapText(ctx, label || title, panelW - pad * 2).slice(0, 2).forEach((line, index) => {
      ctx.fillText(line, w / 2, top + pad + valueSize * 1.15 + index * Math.round(panelW * 0.08));
    });
  } else {
    const titleSize = Math.round(panelW * (template === 'quote-card' ? 0.085 : 0.095));
    ctx.fillStyle = kit.textColor;
    ctx.font = `800 ${titleSize}px ${kit.font}, Inter, system-ui, sans-serif`;
    const titleLines = wrapText(ctx, template === 'quote-card' ? `\u201C${title}\u201D` : title, panelW - pad * 2).slice(0, 4);
    titleLines.forEach((line, index) => ctx.fillText(line, left + pad, top + pad + index * Math.round(titleSize * 1.2)));
    const afterTitle = top + pad + titleLines.length * Math.round(titleSize * 1.2) + Math.round(titleSize * 0.4);
    if (body) {
      const bodySize = Math.round(panelW * 0.055);
      ctx.fillStyle = 'rgba(241,245,249,0.82)';
      ctx.font = `500 ${bodySize}px ${kit.font}, Inter, system-ui, sans-serif`;
      wrapText(ctx, body, panelW - pad * 2).slice(0, 4).forEach((line, index) => {
        ctx.fillText(line, left + pad, afterTitle + index * Math.round(bodySize * 1.3));
      });
    }
    if (cta) {
      const ctaSize = Math.round(panelW * 0.055);
      ctx.font = `800 ${ctaSize}px ${kit.font}, Inter, system-ui, sans-serif`;
      const ctaW = Math.min(panelW - pad * 2, ctx.measureText(cta).width + pad * 1.6);
      const ctaH = Math.round(ctaSize * 2.1);
      const ctaY = top + panelH - pad - ctaH;
      ctx.fillStyle = kit.primary;
      roundRect(ctx, left + pad, ctaY, ctaW, ctaH, ctaH / 2);
      ctx.fillStyle = kit.contrast;
      ctx.textAlign = 'center';
      ctx.fillText(cta, left + pad + ctaW / 2, ctaY + Math.round(ctaH / 2 - ctaSize * 0.6));
    }
  }
  return toUploadedPng(canvas, hash(`card:${aspect}:${template}:${JSON.stringify(variables)}:${kit.primary}:${kit.accent}`));
}
