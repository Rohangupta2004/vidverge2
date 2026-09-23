import { buildMotionGraphic, type BuiltMotionGraphic } from '../components/MotionGraphicPlayer';
import { motionFingerprint, normalizeMotionSpec, specFromOverlay, type MotionSpec } from './motionSpec';
import { directionFingerprint, normalizeSceneDirection, type SceneDirection } from './visualTimeline';
import { updateScene, type Project, type Scene } from './supabase';
import { uploadFile } from './proxy';
import { visualKindOf, type CompositionSpec } from './effects';

// MOTION CAPTURE — the export path of the motion-graphics engine. The same
// GSAP + SVG animation the customer previews in the browser is played in real
// time into a canvas (SVG rasterized frame by frame), recorded with
// MediaRecorder, uploaded as a durable clip, and persisted onto the scene —
// so the FFmpeg composite receives a REAL video file, identical to what the
// preview showed. Text stays deterministic end to end: the capture renders
// exactly the spec's strings.
//
// Captures are serialized through one queue: recording is realtime work, and
// two simultaneous MediaRecorders competing for the main thread would degrade
// both clips. The parallel generation lanes still overlap captures with AI
// video and image generation, which are network-bound.

const FPS = 30;

let captureQueue: Promise<unknown> = Promise.resolve();
function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = captureQueue.then(work, work);
  captureQueue = next.catch(() => undefined);
  return next;
}

function recorderMime(): string {
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  if (typeof MediaRecorder === 'undefined') return '';
  return candidates.find((mime) => MediaRecorder.isTypeSupported(mime)) || '';
}

/** Fetch a remote image and inline it as a data: URL — SVG rasterized through
 * an <img> loads no external resources, so every image must travel inside the
 * markup. A fetch that fails (CORS, network) degrades to no image rather than
 * failing the scene. */
async function toDataUrl(url: string): Promise<string> {
  try {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) return '';
    const blob = await response.blob();
    if (!/^image\//.test(blob.type || '') && !/\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(url)) return '';
    return await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '')); reader.onerror = () => resolve(''); reader.readAsDataURL(blob); });
  } catch { return ''; }
}

async function inlineSpecImages(spec: MotionSpec): Promise<MotionSpec> {
  const copy: MotionSpec = JSON.parse(JSON.stringify(spec));
  if (copy.imageUrl) copy.imageUrl = (await toDataUrl(copy.imageUrl)) || undefined;
  for (const item of copy.items) if (item.imageUrl) item.imageUrl = (await toDataUrl(item.imageUrl)) || undefined;
  return copy;
}

/** The renderable spec for a scene: its stored spec, or — for text_overlay and
 * legacy text/graphics scenes — a text_reveal derived from its overlay copy. */
export function sceneMotionSpec(scene: Scene): MotionSpec {
  const kind = visualKindOf(scene.visual_kind);
  if (scene.spec && typeof scene.spec === 'object') {
    const spec = normalizeMotionSpec(scene.spec, scene.description);
    // A text_overlay scene keeps its overlay copy authoritative so the
    // existing headline/subtext editor keeps driving what gets rendered.
    if (kind === 'text_overlay' && scene.overlay_config?.text) { spec.title = scene.overlay_config.text; spec.subtitle = scene.overlay_config.subtext || spec.subtitle; }
    return spec;
  }
  const fromOverlay = specFromOverlay(scene.overlay_config, scene.description);
  if (kind !== 'text_overlay' && scene.overlay_config?.assetUrl) fromOverlay.imageUrl = scene.overlay_config.assetUrl;
  return fromOverlay;
}

export function sceneMotionDuration(scene: Scene): number {
  const span = Number(scene.script_end_sec) - Number(scene.script_start_sec);
  const wanted = Number.isFinite(span) && span > 0 ? span : 6;
  return Math.min(20, Math.max(2.5, wanted));
}

/**
 * The scene's usable Motion Director timeline: the stored director_timeline,
 * but ONLY when it was directed against the CURRENT spec — an edited spec
 * invalidates the direction (the pipeline re-directs before capturing), so a
 * stale timeline can never lay out text that no longer exists.
 */
export function sceneDirection(scene: Scene): SceneDirection | null {
  const direction = normalizeSceneDirection((scene as Scene & { director_timeline?: unknown }).director_timeline);
  if (!direction) return null;
  if (direction.spec_fingerprint && direction.spec_fingerprint !== motionFingerprint(sceneMotionSpec(scene))) return null;
  return direction;
}

/**
 * The fingerprint a capture of this scene carries: the spec fingerprint plus
 * (when directed) the direction fingerprint — so editing EITHER the content
 * or the direction re-captures, while an untouched scene reuses its clip.
 * Keeps the 'mg:' prefix the server's settled check looks for.
 */
export function sceneCaptureFingerprint(scene: Scene): string {
  const base = motionFingerprint(sceneMotionSpec(scene));
  const direction = sceneDirection(scene);
  return direction ? `${base}.d${directionFingerprint(direction)}` : base;
}

const CALLOUT_WIDTH = 1080;
const CALLOUT_HEIGHT = 1920;

function calloutPosition(value?: string): string {
  if (!value || value === 'center') return 'lower_third';
  if (value === 'top') return 'top_right';
  return ['lower_third', 'bottom', 'bottom_left', 'bottom_right', 'top_left', 'top_right'].includes(value) ? value : 'lower_third';
}

function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) { lines.push(line); line = word; } else line = next;
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    while (lines[maxLines - 1].length > 1 && ctx.measureText(`${lines[maxLines - 1]}…`).width > maxWidth) lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1).trim();
    lines[maxLines - 1] += '…';
  }
  return lines;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

/**
 * Rasterize one over-avatar text scene as a true RGBA PNG. The portrait
 * compositor cover-scales every asset to 1080x1920, so the canvas is already
 * full-frame while every untouched pixel remains alpha=0. Only the compact
 * callout pill is painted, clamped to the same face-safe zones as the 16:9
 * Remotion path. The endpoint then holds this still for the scene's exact
 * narration window while the HeyGen picture and audio continue underneath.
 */
export async function generatePortraitCalloutImage(project: Project, scene: Scene): Promise<string> {
  const overlay = scene.overlay_config || {};
  const headline = String(overlay.text || scene.description || '').trim();
  const subtext = String(overlay.subtext || '').trim();
  if (!headline && !subtext) throw new Error(`Scene ${scene.scene_index} has no callout text yet.`);
  if (document.fonts?.ready) await document.fonts.ready.catch(() => undefined);

  const canvas = document.createElement('canvas');
  canvas.width = CALLOUT_WIDTH;
  canvas.height = CALLOUT_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable in this browser.');
  ctx.clearRect(0, 0, CALLOUT_WIDTH, CALLOUT_HEIGHT);

  const scale = Math.min(1.5, Math.max(0.65, Number(overlay.scale) || 1));
  const sizes = { sm: 48, md: 58, lg: 68 } as const;
  const headlineSize = Math.round((sizes[overlay.size as keyof typeof sizes] || sizes.sm) * scale);
  const subtextSize = Math.round(headlineSize * 0.48);
  const position = calloutPosition(overlay.position);
  const corner = position.includes('left') || position.includes('right');
  const maxWidth = corner ? 700 : 860;
  const padX = Math.round(34 * scale);
  const padY = Math.round(26 * scale);
  const headlineLine = Math.round(headlineSize * 1.16);
  const subtextLine = Math.round(subtextSize * 1.35);

  ctx.font = `800 ${headlineSize}px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif`;
  const headlineLines = wrapCanvasText(ctx, headline, maxWidth - padX * 2, 3);
  ctx.font = `500 ${subtextSize}px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif`;
  const subtextLines = subtext ? wrapCanvasText(ctx, subtext, maxWidth - padX * 2, 3) : [];
  const measured = Math.max(
    ...headlineLines.map((line) => { ctx.font = `800 ${headlineSize}px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif`; return ctx.measureText(line).width; }),
    ...subtextLines.map((line) => { ctx.font = `500 ${subtextSize}px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif`; return ctx.measureText(line).width; }),
    220,
  );
  const width = Math.min(maxWidth, Math.ceil(measured + padX * 2));
  const gap = subtextLines.length ? Math.round(14 * scale) : 0;
  const height = padY * 2 + headlineLines.length * headlineLine + gap + subtextLines.length * subtextLine;
  const marginX = 64;
  let x = (CALLOUT_WIDTH - width) / 2;
  let y = 1270 - height / 2;
  if (position.endsWith('_left')) x = marginX;
  if (position.endsWith('_right')) x = CALLOUT_WIDTH - marginX - width;
  if (position.startsWith('top_')) y = 150;
  if (position === 'bottom' || position.startsWith('bottom_')) y = 1600 - height;

  const alpha = Math.min(1, Math.max(0.15, Number(overlay.opacity) || 1));
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 10;
  roundedRect(ctx, x, y, width, height, 24);
  ctx.fillStyle = 'rgba(8,12,24,0.82)';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.stroke();

  const align: CanvasTextAlign = position.endsWith('_left') ? 'left' : position.endsWith('_right') ? 'right' : 'center';
  const textX = align === 'left' ? x + padX : align === 'right' ? x + width - padX : x + width / 2;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `800 ${headlineSize}px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif`;
  let textY = y + padY;
  headlineLines.forEach((line) => { ctx.fillText(line, textX, textY); textY += headlineLine; });
  if (subtextLines.length) {
    textY += gap;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = `500 ${subtextSize}px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif`;
    subtextLines.forEach((line) => { ctx.fillText(line, textX, textY); textY += subtextLine; });
  }
  ctx.restore();

  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('The transparent callout PNG came back empty.')), 'image/png'));
  const file = new File([blob], `scene-${scene.scene_index}-avatar-callout.png`, { type: 'image/png' });
  const uploaded = await uploadFile(file, `sceneforge-v2/${project.id}/callouts`);
  return uploaded.url;
}

// ---------------------------------------------------------------------------
// PORTRAIT COMPOSITION LAYER — overlay/central visuals for the 9:16 FFmpeg
// composite. The portrait endpoint accepts only full-frame assets but its
// pipeline PRESERVES PNG ALPHA (verified empirically — see the s2v-probe
// verdict), so a graphic that must ride ON the presenter ships as a sequence
// of 1080×1920 RGBA stills: every untouched pixel stays transparent and only
// the graphic tile is painted, in a face-safe region. A few timed frames
// captured at successive points of the GSAP timeline give the graphic a real
// progressive-reveal animation over the live avatar — no black card, no
// full-frame takeover, narration uninterrupted underneath.
// ---------------------------------------------------------------------------

const FRAME_W = 1080;
const FRAME_H = 1920;

export interface PlacementRect { x: number; y: number; w: number; h: number }

/**
 * Where a composited visual sits in the 1080×1920 frame. Face-safe by
 * construction: the portrait presenter's face lives in the upper-center band,
 * so 'center' clamps to the lower third, corner tiles stay small, and every
 * rect keeps clear of the caption strip at the very bottom of the frame.
 */
export function portraitPlacement(comp: CompositionSpec, opts: { tall?: boolean } = {}): PlacementRect {
  const margin = 48;
  if (comp.mode === 'central') {
    const w = Math.round(Math.min(0.94, Math.max(0.6, Number(comp.scale) || 0.88)) * FRAME_W);
    const h = Math.round(FRAME_H * 0.52);
    return { x: Math.round((FRAME_W - w) / 2), y: Math.round(FRAME_H * 0.6 - h / 2), w, h };
  }
  const position = !comp.position || comp.position === 'center' ? 'lower_third' : comp.position;
  const corner = position === 'top_left' || position === 'top_right';
  const w = Math.round(Math.min(corner ? 0.52 : 0.8, Math.max(0.3, Number(comp.scale) || 0.58)) * FRAME_W);
  const h = Math.round(Math.min(FRAME_H * (opts.tall ? 0.4 : 0.34), w * (opts.tall ? 1.15 : 0.92)));
  let cx = FRAME_W / 2;
  let cy = FRAME_H * 0.63;
  if (position === 'left' || position === 'top_left' || position === 'bottom_left') cx = margin + w / 2;
  if (position === 'right' || position === 'top_right' || position === 'bottom_right') cx = FRAME_W - margin - w / 2;
  if (position === 'left' || position === 'right') cy = FRAME_H * 0.52;
  if (corner) cy = margin + 80 + h / 2;
  if (position === 'bottom' || position === 'bottom_left' || position === 'bottom_right') cy = FRAME_H * 0.7;
  const y = Math.max(margin, Math.min(FRAME_H - 270 - h, Math.round(cy - h / 2)));
  return { x: Math.round(cx - w / 2), y, w, h };
}

/** Rasterize the built SVG (at its own pixel size) into the placement rect of an otherwise-transparent full frame. */
function drawSvgIntoFrame(ctx: CanvasRenderingContext2D, serializer: XMLSerializer, svg: SVGSVGElement, rect: PlacementRect): Promise<void> {
  return new Promise((resolve, reject) => {
    const markup = serializer.serializeToString(svg);
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
    const frame = new Image();
    frame.onload = () => { try { ctx.drawImage(frame, rect.x, rect.y, rect.w, rect.h); resolve(); } finally { URL.revokeObjectURL(url); } };
    frame.onerror = () => { URL.revokeObjectURL(url); reject(new Error('The composited overlay frame could not be rasterized.')); };
    frame.src = url;
  });
}

export interface TimedOverlayFrame { url: string; start: number; end: number }

/**
 * Produce the timed transparent RGBA stills that composite one overlay/central
 * motion-graphic (or text-overlay) scene OVER the presenter in the portrait
 * assembly. Each frame is a snapshot of the same GSAP timeline the preview
 * plays, taken at successive reveal points, so the graphic builds up
 * progressively while the avatar keeps talking underneath. Offsets are
 * relative to the scene window.
 */
export async function generatePortraitMotionOverlayFrames(project: Project, scene: Scene, comp: CompositionSpec): Promise<TimedOverlayFrame[]> {
  const spec = await inlineSpecImages(sceneMotionSpec(scene));
  if (!spec.title && !spec.items.length && !spec.stat && !spec.root) throw new Error(`Scene ${scene.scene_index} has no motion-graphic content to composite.`);
  const duration = sceneMotionDuration(scene);
  const rect = portraitPlacement(comp, { tall: spec.items.length > 3 });
  const compact = spec.kind === 'big_stat' || spec.kind === 'text_reveal';
  // Small tiles get a bigger type unit so labels remain readable at 9:16.
  const unitScale = comp.mode === 'central' ? 1.12 : compact ? 1.5 : 1.25;
  if (document.fonts?.ready) await document.fonts.ready.catch(() => undefined);
  const built: BuiltMotionGraphic = buildMotionGraphic(spec, rect.w, rect.h, duration, { transparent: true, panel: true, unitScale, directed: sceneDirection(scene) });
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${rect.w}px;height:${rect.h}px;pointer-events:none;opacity:0;`;
  host.appendChild(built.svg);
  document.body.appendChild(host);
  try {
    built.timeline.pause(0);
    const canvas = document.createElement('canvas');
    canvas.width = FRAME_W; canvas.height = FRAME_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is unavailable in this browser.');
    const serializer = new XMLSerializer();
    // A handful of timed stills stand in for the live animation: window i
    // shows the timeline state its reveal has reached, and the last window
    // holds the fully revealed graphic (sampled before the end fade).
    const reveal = Math.max(1, duration * 0.68);
    let steps = Math.max(2, Math.min(4, (spec.items.length || 1) + 1));
    while (steps > 1 && duration / steps < 0.9) steps -= 1;
    const bounds: number[] = [0];
    for (let i = 1; i < steps; i += 1) bounds.push(Math.round(reveal * (i / steps) * 100) / 100);
    bounds.push(duration);
    const frames: TimedOverlayFrame[] = [];
    for (let i = 0; i < steps; i += 1) {
      const start = bounds[i];
      const end = bounds[i + 1];
      const at = i === steps - 1 ? Math.max(0.2, Math.min(duration * 0.72, duration - 0.6)) : Math.max(0.2, end - 0.05);
      built.timeline.seek(at, false);
      ctx.clearRect(0, 0, FRAME_W, FRAME_H);
      await drawSvgIntoFrame(ctx, serializer, built.svg, rect);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('The transparent overlay PNG came back empty.')), 'image/png'));
      const file = new File([blob], `scene-${scene.scene_index}-overlay-${i}.png`, { type: 'image/png' });
      const uploaded = await uploadFile(file, `sceneforge-v2/${project.id}/overlays`);
      frames.push({ url: uploaded.url, start, end });
    }
    return frames;
  } finally {
    built.timeline.kill();
    host.remove();
  }
}

/**
 * Composite one image scene as a framed supporting card over the presenter
 * (portrait overlay/central composition): the still sits in a rounded,
 * bordered card inside a face-safe region of an otherwise transparent
 * 1080×1920 PNG, with the scene's caption (when present) in a pill beneath —
 * a supporting reference beside the presenter rather than a full takeover.
 */
export async function generatePortraitImageCardPng(project: Project, scene: Scene, comp: CompositionSpec): Promise<string> {
  const isVideo = (value: string) => /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(value);
  const stillUrl = (scene.render_url && !isVideo(String(scene.render_url)) ? String(scene.render_url) : '')
    || (scene.overlay_config?.showAsset !== false && scene.overlay_config?.assetUrl ? String(scene.overlay_config.assetUrl) : '');
  if (!stillUrl) throw new Error(`Scene ${scene.scene_index} has no still to composite.`);
  const dataUrl = await toDataUrl(stillUrl);
  if (!dataUrl) throw new Error(`Scene ${scene.scene_index}'s image could not be loaded for compositing.`);
  const image = await new Promise<HTMLImageElement>((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error(`Scene ${scene.scene_index}'s image could not be decoded.`)); img.src = dataUrl; });
  if (document.fonts?.ready) await document.fonts.ready.catch(() => undefined);

  const rect = portraitPlacement(comp, { tall: true });
  const canvas = document.createElement('canvas');
  canvas.width = FRAME_W; canvas.height = FRAME_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable in this browser.');
  ctx.clearRect(0, 0, FRAME_W, FRAME_H);

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 48;
  ctx.shadowOffsetY = 14;
  roundedRect(ctx, rect.x, rect.y, rect.w, rect.h, 28);
  ctx.fillStyle = 'rgba(8,12,24,0.9)';
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundedRect(ctx, rect.x, rect.y, rect.w, rect.h, 28);
  ctx.clip();
  const cover = Math.max(rect.w / image.width, rect.h / image.height);
  const dw = image.width * cover; const dh = image.height * cover;
  ctx.drawImage(image, rect.x + (rect.w - dw) / 2, rect.y + (rect.h - dh) / 2, dw, dh);
  ctx.restore();
  roundedRect(ctx, rect.x, rect.y, rect.w, rect.h, 28);
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.stroke();

  const caption = String(scene.overlay_config?.text || '').trim();
  if (caption && rect.y + rect.h + 110 < FRAME_H - 220) {
    const size = 34;
    ctx.font = `700 ${size}px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif`;
    const lines = wrapCanvasText(ctx, caption, rect.w - 72, 2);
    const lineH = Math.round(size * 1.25);
    const pillW = Math.min(rect.w, Math.ceil(Math.max(...lines.map((line) => ctx.measureText(line).width), 160) + 72));
    const pillH = 30 + lines.length * lineH;
    const pillX = rect.x + (rect.w - pillW) / 2;
    const pillY = rect.y + rect.h + 22;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 30;
    roundedRect(ctx, pillX, pillY, pillW, pillH, 20);
    ctx.fillStyle = 'rgba(8,12,24,0.82)';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    let textY = pillY + 16;
    lines.forEach((line) => { ctx.fillText(line, pillX + pillW / 2, textY); textY += lineH; });
    ctx.restore();
  }

  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('The image card PNG came back empty.')), 'image/png'));
  const file = new File([blob], `scene-${scene.scene_index}-image-card.png`, { type: 'image/png' });
  const uploaded = await uploadFile(file, `sceneforge-v2/${project.id}/overlays`);
  return uploaded.url;
}

/** True when the scene already carries a capture of exactly this spec AND
 * this direction — editing either one forces a re-capture. */
export function hasFreshMotionClip(scene: Scene): boolean {
  const isVideo = /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(String(scene.render_url || ''));
  return isVideo && String(scene.video_prompt || '') === sceneCaptureFingerprint(scene);
}

/**
 * Record one motion-graphic spec to a WebM blob at the project's aspect.
 * Runs the GSAP timeline in real time; a rasterization pass that briefly
 * falls behind repeats the last frame instead of distorting the timing.
 */
export async function recordMotionGraphic(spec: MotionSpec, aspect: '16:9' | '9:16', durationSec: number, onProgress?: (fraction: number) => void, directed?: SceneDirection | null): Promise<Blob> {
  const mime = recorderMime();
  if (!mime) throw new Error('This browser cannot record motion graphics (MediaRecorder is unavailable). Switch the scene to Image or AI Video instead.');
  const portrait = aspect === '9:16';
  const W = portrait ? 1080 : 1920;
  const H = portrait ? 1920 : 1080;

  const inlined = await inlineSpecImages(spec);
  const built = buildMotionGraphic(inlined, W, H, durationSec, directed ? { directed } : {});
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${W}px;height:${H}px;pointer-events:none;opacity:0;`;
  host.appendChild(built.svg);
  document.body.appendChild(host);

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) { host.remove(); throw new Error('Canvas 2D is unavailable in this browser.'); }
  ctx.fillStyle = '#0A0F1E'; ctx.fillRect(0, 0, W, H);

  const serializer = new XMLSerializer();
  let rasterBusy = false;
  let stopped = false;
  const paintLatestFrame = () => {
    if (rasterBusy || stopped) return;
    rasterBusy = true;
    const markup = serializer.serializeToString(built.svg);
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
    const frame = new Image();
    frame.onload = () => { try { if (!stopped) ctx.drawImage(frame, 0, 0, W, H); } finally { URL.revokeObjectURL(url); rasterBusy = false; } };
    frame.onerror = () => { URL.revokeObjectURL(url); rasterBusy = false; };
    frame.src = url;
  };

  const stream = canvas.captureStream(FPS);
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: portrait ? 7_000_000 : 8_000_000 });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (event) => { if (event.data && event.data.size) chunks.push(event.data); };
  const done = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });

  const totalMs = (durationSec + 0.25) * 1000;
  const startedAt = performance.now();
  let raf = 0;
  const tick = () => {
    if (stopped) return;
    paintLatestFrame();
    if (onProgress) onProgress(Math.min(1, (performance.now() - startedAt) / totalMs));
    raf = requestAnimationFrame(tick);
  };

  try {
    // First frame must be on the canvas before recording starts, or the clip
    // opens on a black frame.
    paintLatestFrame();
    await new Promise((resolve) => setTimeout(resolve, 120));
    recorder.start(500);
    built.timeline.play(0);
    raf = requestAnimationFrame(tick);
    await new Promise((resolve) => setTimeout(resolve, totalMs));
    stopped = true;
    cancelAnimationFrame(raf);
    recorder.stop();
    await done;
  } finally {
    stopped = true;
    cancelAnimationFrame(raf);
    built.timeline.kill();
    stream.getTracks().forEach((track) => track.stop());
    host.remove();
  }
  const blob = new Blob(chunks, { type: 'video/webm' });
  // A healthy VP9 capture carries hundreds of kilobytes per second; a file of
  // ~1 KB is a container holding at most one frame. Recording in a hidden or
  // backgrounded tab is the usual cause (requestAnimationFrame and
  // canvas.captureStream both pause), and uploading such a clip breaks the
  // whole portrait assembly later: ffmpeg finds no video stream in it and
  // fails the composite with exit 234. Refuse it here, where one retry with
  // the tab visible fixes it.
  const minBytes = Math.max(24_000, Math.round(durationSec * 6_000));
  if (!blob.size || blob.size < minBytes) throw new Error(`The motion-graphic recording came back with no real frames (${blob.size} bytes). Keep this tab visible and in the foreground while the scene records, then try again — or switch the scene to Image.`);
  return blob;
}

export interface MotionClipResult {
  videoUrl: string;
  reused: boolean;
  fingerprint: string;
  /** The freshly recorded bytes (absent when the clip was reused) — the QA
   * pipeline reads frames from this local blob so no CORS round-trip is needed. */
  blob?: Blob;
}

/**
 * Produce (or reuse) the captured clip for one motion-graphic / text-overlay
 * scene, upload it durably, and persist it onto the scene. The spec
 * fingerprint is stored in video_prompt, so an unchanged spec reuses its clip
 * and an edited spec always re-captures.
 */
export async function generateSceneMotionClip(project: Project, scene: Scene, options: { force?: boolean; onProgress?: (fraction: number) => void } = {}): Promise<MotionClipResult> {
  const spec = sceneMotionSpec(scene);
  if (!spec.title && !spec.items.length && !spec.stat && !spec.root) throw new Error(`Scene ${scene.scene_index} has no motion-graphic content yet — add a headline or items in the scene editor.`);
  const directed = sceneDirection(scene);
  const fingerprint = sceneCaptureFingerprint(scene);
  if (!options.force && hasFreshMotionClip(scene)) return { videoUrl: String(scene.render_url), reused: true, fingerprint };
  const blob = await enqueue(() => recordMotionGraphic(spec, project.aspect_ratio === '9:16' ? '9:16' : '16:9', sceneMotionDuration(scene), options.onProgress, directed));
  const file = new File([blob], `scene-${scene.scene_index}-motion.webm`, { type: 'video/webm' });
  const uploaded = await uploadFile(file, `sceneforge-v2/${project.id}/motion`);
  await updateScene(scene.id, { render_url: uploaded.url, video_prompt: fingerprint, status: 'ready' }, scene.project_id);
  return { videoUrl: uploaded.url, reused: false, fingerprint, blob };
}
