/**
 * Canvas overlay renderer + MediaRecorder export for the Motion Graphics
 * Agent. A <canvas> sits on top of the <video> (same NATIVE pixel size as the
 * source — never a hardcoded 16:9) with pointer-events none; every animation
 * frame the active overlays are drawn for the current playhead with
 * easeOutCubic entrances and easeInCubic exits. The same draw functions power
 * the real-time MediaRecorder export (canvas stream + the video's audio).
 */
import { fetchVideoAsFile } from './enhancerCore';
import type { MotionOverlay } from './motionAgent';

export type CaptionRenderFn = (
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  videoWidth: number,
  videoHeight: number,
) => void;

export function easeOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - c, 3);
}

export function easeInCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * c;
}

function weightOf(w: string): number {
  return w === 'black' ? 900 : w === 'normal' ? 400 : 700;
}

function fontFor(weight: number, sizePx: number): string {
  return weight + ' ' + Math.max(8, Math.round(sizePx)) + "px 'Inter', system-ui, sans-serif";
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function drawArrowShape(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, lw: number): void {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const head = Math.max(8, lw * 3.2);
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2 - Math.cos(ang) * head * 0.6, y2 - Math.sin(ang) * head * 0.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - Math.cos(ang - 0.45) * head, y2 - Math.sin(ang - 0.45) * head);
  ctx.lineTo(x2 - Math.cos(ang + 0.45) * head, y2 - Math.sin(ang + 0.45) * head);
  ctx.closePath();
  ctx.fill();
}

interface Phase {
  alpha: number;
  dx: number;
  dy: number;
  scale: number;
  /** Eased entrance progress 0→1. */
  inP: number;
  /** LINEAR entrance progress 0→1 (typewriter). */
  inRaw: number;
  /** Whole-lifetime linear progress 0→1. */
  lifeP: number;
}

function phaseFor(o: MotionOverlay, t: number, vw: number, vh: number): Phase | null {
  if (t < o.startTime || t > o.endTime) return null;
  const ad = Math.max(0.12, Number(o.animateDuration) || 0.4);
  const inRaw = Math.min(1, (t - o.startTime) / ad);
  const outRaw = Math.min(1, (o.endTime - t) / ad);
  const inP = easeOutCubic(inRaw);
  const outP = easeInCubic(outRaw);
  let dx = 0, dy = 0, scale = 1;
  if (o.animateIn === 'slide_up') dy += (1 - inP) * vh * 0.05;
  if (o.animateIn === 'slide_left') dx += (1 - inP) * vw * 0.06;
  if (o.animateIn === 'scale_pop') scale *= 0.55 + 0.45 * inP + Math.sin(inRaw * Math.PI) * 0.06;
  if (o.animateOut === 'slide_down') dy += (1 - outP) * vh * 0.05;
  if (o.animateOut === 'scale_out') scale *= 0.6 + 0.4 * outP;
  const opacity = Math.min(1, Math.max(0.05, Number(o.style.opacity) || 1));
  const alpha = Math.max(0, Math.min(inP, outP)) * opacity;
  const lifeP = Math.min(1, Math.max(0, (t - o.startTime) / Math.max(0.05, o.endTime - o.startTime)));
  return { alpha, dx, dy, scale, inP, inRaw, lifeP };
}

function drawOverlay(ctx: CanvasRenderingContext2D, o: MotionOverlay, t: number, vw: number, vh: number): void {
  const ph = phaseFor(o, t, vw, vh);
  if (!ph || ph.alpha <= 0.01) return;
  const s = o.style;
  const px = o.x * vw + ph.dx;
  const py = o.y * vh + ph.dy;
  const w = Math.max(2, o.width * vw);
  const h = Math.max(2, o.height * vh);
  const fs = Math.max(9, s.fontSize * vh);
  const hasBg = typeof s.backgroundColor === 'string' && s.backgroundColor !== 'transparent' && s.backgroundColor !== '';

  ctx.save();
  ctx.globalAlpha = ph.alpha;
  const cx = px + w / 2;
  const cy = py + h / 2;
  ctx.translate(cx, cy);
  ctx.scale(ph.scale, ph.scale);
  ctx.translate(-cx, -cy);

  switch (o.type) {
    case 'text': {
      let text = o.content || '';
      if (o.animateIn === 'typewriter') text = text.slice(0, Math.ceil(text.length * ph.inRaw));
      ctx.font = fontFor(weightOf(s.fontWeight), fs);
      if (hasBg) {
        const tw = ctx.measureText(text).width;
        const bw = Math.max(w, tw + fs * 0.9);
        const bh = Math.max(h, fs * 1.6);
        ctx.fillStyle = s.backgroundColor;
        roundRectPath(ctx, px, py, bw, bh, s.borderRadius);
        ctx.fill();
        ctx.fillStyle = s.color;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillText(text, px + fs * 0.45, py + bh / 2);
      } else {
        ctx.shadowColor = 'rgba(0,0,0,0.6)';
        ctx.shadowBlur = fs * 0.22;
        ctx.shadowOffsetY = fs * 0.06;
        ctx.fillStyle = s.color;
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        ctx.fillText(text, px, py);
      }
      break;
    }
    case 'highlight_box': {
      ctx.globalAlpha = ph.alpha * 0.28;
      ctx.fillStyle = hasBg ? s.backgroundColor : s.color;
      roundRectPath(ctx, px, py, w, h, s.borderRadius);
      ctx.fill();
      ctx.globalAlpha = ph.alpha;
      ctx.strokeStyle = s.borderColor || s.color;
      ctx.lineWidth = Math.max(2, vh * 0.004);
      roundRectPath(ctx, px, py, w, h, s.borderRadius);
      ctx.stroke();
      break;
    }
    case 'arrow': {
      ctx.strokeStyle = s.color;
      ctx.fillStyle = s.color;
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = vh * 0.008;
      const x1 = px;
      const y1 = py + h / 2;
      const x2 = px + Math.max(vw * 0.02, w * ph.inP);
      drawArrowShape(ctx, x1, y1, x2, py + h / 2, Math.max(3, vh * 0.008));
      break;
    }
    case 'circle': {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = Math.max(3, vh * 0.006);
      ctx.shadowColor = 'rgba(0,0,0,0.4)';
      ctx.shadowBlur = vh * 0.006;
      ctx.beginPath();
      ctx.ellipse(px + w / 2, py + h / 2, w / 2, h / 2, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ph.inP);
      ctx.stroke();
      break;
    }
    case 'underline': {
      const ly = py + h;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = Math.max(3, vh * 0.007);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(px, ly);
      ctx.lineTo(px + w * ph.inP, ly);
      ctx.stroke();
      if (o.content) {
        ctx.font = fontFor(weightOf(s.fontWeight), fs);
        ctx.fillStyle = s.color;
        ctx.textBaseline = 'bottom';
        ctx.textAlign = 'left';
        ctx.shadowColor = 'rgba(0,0,0,0.55)';
        ctx.shadowBlur = fs * 0.2;
        ctx.fillText(o.content, px, ly - vh * 0.008);
      }
      break;
    }
    case 'callout_label': {
      ctx.fillStyle = hasBg ? s.backgroundColor : 'rgba(8,10,20,0.78)';
      roundRectPath(ctx, px, py, w, h, s.borderRadius);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(px + w * 0.18, py + h);
      ctx.lineTo(px + w * 0.18 + h * 0.35, py + h);
      ctx.lineTo(px + w * 0.18, py + h + h * 0.32);
      ctx.closePath();
      ctx.fill();
      if (s.borderColor && s.borderColor !== 'transparent') {
        ctx.strokeStyle = s.borderColor;
        ctx.lineWidth = Math.max(1.5, vh * 0.0025);
        roundRectPath(ctx, px, py, w, h, s.borderRadius);
        ctx.stroke();
      }
      ctx.font = fontFor(weightOf(s.fontWeight), fs);
      ctx.fillStyle = s.color;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillText(o.content || '', px + w / 2, py + h / 2, w - fs * 0.6);
      break;
    }
    case 'icon': {
      ctx.font = fontFor(400, Math.min(w, h) * 0.9 || fs * 2);
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = vh * 0.01;
      ctx.fillStyle = s.color;
      ctx.fillText(o.content || '✨', px + w / 2, py + h / 2);
      break;
    }
    case 'stat_card': {
      const parts = String(o.content || '').split(/[|\n]/);
      const value = (parts[0] || '').trim();
      const label = (parts[1] || '').trim();
      ctx.fillStyle = hasBg ? s.backgroundColor : 'rgba(10,14,28,0.82)';
      roundRectPath(ctx, px, py, w, h, s.borderRadius);
      ctx.fill();
      ctx.fillStyle = s.borderColor || s.color;
      roundRectPath(ctx, px, py, Math.max(3, vw * 0.005), h, 2);
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.fillStyle = s.color;
      if (label) {
        ctx.font = fontFor(900, fs * 1.35);
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(value, px + w / 2, py + h * 0.52, w - fs);
        ctx.font = fontFor(600, fs * 0.72);
        ctx.globalAlpha = ph.alpha * 0.85;
        ctx.fillText(label, px + w / 2, py + h * 0.82, w - fs);
      } else {
        ctx.font = fontFor(900, fs * 1.35);
        ctx.textBaseline = 'middle';
        ctx.fillText(value, px + w / 2, py + h / 2, w - fs);
      }
      break;
    }
    case 'progress_bar': {
      const trackH = Math.max(4, h * 0.4);
      const ty = py + h - trackH;
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      roundRectPath(ctx, px, ty, w, trackH, trackH / 2);
      ctx.fill();
      ctx.fillStyle = s.color;
      roundRectPath(ctx, px, ty, Math.max(trackH, w * easeOutCubic(ph.lifeP)), trackH, trackH / 2);
      ctx.fill();
      if (o.content) {
        ctx.font = fontFor(weightOf(s.fontWeight), fs * 0.85);
        ctx.fillStyle = s.color;
        ctx.textBaseline = 'bottom';
        ctx.textAlign = 'left';
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = fs * 0.18;
        ctx.fillText(o.content, px, ty - vh * 0.006);
      }
      break;
    }
    case 'particle_burst': {
      const n = 14;
      const maxR = Math.max(w, h) / 2;
      const spread = easeOutCubic(Math.min(1, ph.lifeP * 1.6));
      const fade = 1 - Math.min(1, ph.lifeP * 1.4);
      ctx.fillStyle = s.color;
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2 + (i % 2 === 0 ? 0.2 : 0);
        const rr = maxR * spread * (0.65 + 0.35 * ((i * 37) % 10) / 10);
        const dot = Math.max(1.5, vh * 0.006 * (0.7 + 0.6 * ((i * 13) % 5) / 5));
        ctx.globalAlpha = ph.alpha * Math.max(0, fade);
        ctx.beginPath();
        ctx.arc(px + w / 2 + Math.cos(ang) * rr, py + h / 2 + Math.sin(ang) * rr, dot, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

/** Draw every overlay active at time t. One bad overlay never kills the frame. */
export function drawMotionOverlays(ctx: CanvasRenderingContext2D, overlays: MotionOverlay[], t: number, vw: number, vh: number): void {
  for (const o of overlays) {
    try { drawOverlay(ctx, o, t, vw, vh); } catch { /* skip the broken overlay */ }
  }
}

/** Run the (LLM-generated) caption style function safely for one frame. */
export function drawCanvasCaption(ctx: CanvasRenderingContext2D, fn: CaptionRenderFn, text: string, vw: number, vh: number): void {
  ctx.save();
  try {
    fn(ctx, text, vw / 2, vh * 0.86, vw, vh);
  } catch { /* a broken style function never breaks playback */ }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// MediaRecorder export: canvas (video frames + overlays + captions) + audio
// ---------------------------------------------------------------------------

export interface OverlayCaption { start: number; end: number; text: string }

export interface OverlayRecordingResult {
  blob: Blob;
  url: string;
  mimeType: string;
  durationSec: number;
}

/**
 * Real-time export at the video's NATIVE resolution: the source plays through
 * a hidden element, every frame is drawn to a canvas with the overlays and the
 * selected caption style on top, and MediaRecorder captures the canvas stream
 * plus the original audio track. Prefers the local File (no CORS taint);
 * otherwise the stored source is fetched back first.
 */
export async function recordOverlayVideo(opts: {
  file: File | null;
  srcUrl: string;
  overlays: MotionOverlay[];
  captionFn: CaptionRenderFn | null;
  captions: OverlayCaption[];
  onProgress?: (fraction: number) => void;
  isAlive?: () => boolean;
}): Promise<OverlayRecordingResult> {
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('This browser does not support in-browser recording (MediaRecorder) — use the server-side export instead.');
  }
  let f = opts.file;
  if (!f) {
    if (!opts.srcUrl) throw new Error('Upload a video first.');
    f = await fetchVideoAsFile(opts.srcUrl);
  }
  const srcObjUrl = URL.createObjectURL(f);
  const v = document.createElement('video');
  v.src = srcObjUrl;
  v.playsInline = true;
  v.preload = 'auto';

  const cleanupSrc = () => { try { URL.revokeObjectURL(srcObjUrl); } catch { /* no-op */ } };

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('Could not load the video for recording.')), 20000);
      v.onloadedmetadata = () => { window.clearTimeout(timer); resolve(); };
      v.onerror = () => { window.clearTimeout(timer); reject(new Error('Could not load the video for recording.')); };
    });

    const vw = v.videoWidth || 1280;
    const vh = v.videoHeight || 720;
    const durationSec = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
    const canvas = document.createElement('canvas');
    canvas.width = vw;
    canvas.height = vh;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create the recording canvas.');

    const stream: MediaStream | null = (canvas as any).captureStream ? (canvas as any).captureStream(30) : null;
    if (!stream) throw new Error('This browser cannot capture a canvas stream.');

    // Route the element's audio into the recording without playing it out loud.
    let ac: AudioContext | null = null;
    try {
      const AC: any = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (AC) {
        ac = new AC();
        const src = (ac as AudioContext).createMediaElementSource(v);
        const dest = (ac as AudioContext).createMediaStreamDestination();
        src.connect(dest);
        dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
      }
    } catch { /* silent export — the video track still records */ }

    const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
      .find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) || '';
    const rec = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 8_000_000 } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };

    let raf = 0;
    const drawFrame = () => {
      const t = v.currentTime;
      ctx.clearRect(0, 0, vw, vh);
      try { ctx.drawImage(v, 0, 0, vw, vh); } catch { /* first frames may not be ready */ }
      if (opts.overlays.length) drawMotionOverlays(ctx, opts.overlays, t, vw, vh);
      if (opts.captionFn) {
        const seg = opts.captions.find((c) => t >= c.start && t < c.end);
        if (seg && seg.text) drawCanvasCaption(ctx, opts.captionFn, seg.text, vw, vh);
      }
      if (opts.onProgress && durationSec > 0) opts.onProgress(Math.min(1, t / durationSec));
      raf = requestAnimationFrame(drawFrame);
    };

    const blob = await new Promise<Blob>((resolve, reject) => {
      let settled = false;
      let watchAlive = 0;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearInterval(watchAlive);
        cancelAnimationFrame(raf);
        try { if (rec.state !== 'inactive') rec.stop(); } catch { /* no-op */ }
      };
      rec.onstop = () => {
        cancelAnimationFrame(raf);
        resolve(new Blob(chunks, { type: mimeType || 'video/webm' }));
      };
      rec.onerror = () => { finish(); reject(new Error('Recording failed — try again.')); };
      v.onended = () => finish();
      // Safety net: never record more than duration + 5s.
      if (durationSec > 0) window.setTimeout(finish, (durationSec + 5) * 1000);
      watchAlive = window.setInterval(() => {
        if (opts.isAlive && !opts.isAlive()) finish();
      }, 1000);
      rec.start(1000);
      raf = requestAnimationFrame(drawFrame);
      void ac?.resume?.().catch(() => undefined);
      v.currentTime = 0;
      v.play().catch((e) => { finish(); reject(e instanceof Error ? e : new Error('Playback for recording was blocked.')); });
    });

    try { v.pause(); } catch { /* no-op */ }
    try { ac?.close(); } catch { /* no-op */ }
    if (!blob.size) throw new Error('The recording came back empty — try again.');
    return { blob, url: URL.createObjectURL(blob), mimeType: mimeType || 'video/webm', durationSec };
  } finally {
    cleanupSrc();
  }
}
