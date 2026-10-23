/**
 * CAPTURE LAYER — browser-side video utilities shared by the graphics and
 * mockup layers, plus frame extraction for Veo continuity.
 *
 * - recordSvgAnimation: plays a GSAP timeline over an SVG in real time,
 *   rasterizes it frame-by-frame onto a canvas, records with MediaRecorder,
 *   and returns a WebM blob — the exact animation the user previewed becomes a
 *   real video clip for FFmpeg assembly. Text stays deterministic end to end.
 * - extractFrame / probeClip: hidden <video crossOrigin="anonymous"> +
 *   canvas — pulls the last frame of a rendered clip (the continuity keyframe)
 *   and measures real durations.
 *
 * Captures are serialized through one queue: MediaRecorder is realtime work
 * and two recorders competing for the main thread would degrade both clips.
 */

import { uploadBlob, uploadDataUrl } from '../api';

const FPS = 30;

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

/** Fetch a remote image and inline it as a data: URL — SVG rasterized through
 * an <img> loads no external resources, so images must travel inside the markup. */
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

export interface BuiltAnimation { svg: SVGSVGElement; timeline: any; durationSec: number }

export async function recordSvgAnimation(built: BuiltAnimation, W: number, H: number, onProgress?: (f: number) => void): Promise<Blob> {
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
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);

    const serializer = new XMLSerializer();
    let rasterBusy = false;
    let stopped = false;
    const paint = () => {
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
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const done = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });

    const totalMs = (built.durationSec + 0.25) * 1000;
    const startedAt = performance.now();
    let raf = 0;
    const tick = () => {
      if (stopped) return;
      paint();
      if (onProgress) onProgress(Math.min(1, (performance.now() - startedAt) / totalMs));
      raf = requestAnimationFrame(tick);
    };

    try {
      paint();
      await new Promise((r) => setTimeout(r, 120)); // first frame before recording, or the clip opens black
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
    if (!blob.size) throw new Error('The recording came back empty — try regenerating the scene.');
    return blob;
  });
}

export async function uploadClip(blob: Blob, name: string): Promise<string> {
  return uploadBlob(blob, name.endsWith('.webm') || name.endsWith('.mp4') ? name : `${name}.webm`);
}

// ---------------------------------------------------------------------------
// Frame extraction + duration probing (continuity mechanism)
// ---------------------------------------------------------------------------

function seekTo(video: HTMLVideoElement, t: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => { if (settled) return; settled = true; clearTimeout(giveUp); video.removeEventListener('seeked', onSeeked); resolve(ok); };
    const onSeeked = () => setTimeout(() => finish(true), 80);
    const giveUp = setTimeout(() => finish(false), 8000);
    video.addEventListener('seeked', onSeeked);
    try { video.currentTime = t; } catch { finish(false); }
  });
}

/** MediaRecorder WebMs report duration = Infinity until the browser is forced
 * to scan the file: seek far past the end and wait for durationchange. Without
 * this, probeClipDuration returns 0 and extractFrame('end') seeks nowhere on
 * every browser-captured clip. */
function resolveRealDuration(video: HTMLVideoElement): Promise<void> {
  const d = Number(video.duration);
  if (Number.isFinite(d) && d > 0) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return; settled = true;
      clearTimeout(giveUp);
      video.removeEventListener('durationchange', onChange);
      try { video.currentTime = 0; } catch { /* rewound best-effort */ }
      resolve();
    };
    const onChange = () => {
      const nd = Number(video.duration);
      if (Number.isFinite(nd) && nd > 0) finish();
    };
    const giveUp = setTimeout(finish, 12000);
    video.addEventListener('durationchange', onChange);
    try { video.currentTime = 1e7; } catch { finish(); }
  });
}

function openVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.preload = 'auto';
    (video as any).playsInline = true;
    const guard = setTimeout(() => reject(new Error('The clip took too long to load for frame capture.')), 60000);
    video.onerror = () => { clearTimeout(guard); reject(new Error('The clip could not be decoded in this browser.')); };
    video.onloadedmetadata = () => {
      clearTimeout(guard);
      void resolveRealDuration(video).then(() => resolve(video));
    };
    video.src = url;
  });
}

function releaseVideo(video: HTMLVideoElement) {
  try { video.removeAttribute('src'); video.load(); } catch { /* released */ }
}

export async function probeClipDuration(url: string): Promise<number> {
  const video = await openVideo(url);
  const d = Number(video.duration);
  releaseVideo(video);
  return Number.isFinite(d) && d > 0 ? d : 0;
}

export interface ClipAudioProbe {
  hasAudioTrack: boolean;
  audible: boolean;
  channels: number;
  sampleRate: number;
  durationS: number;
  rms: number;
  rmsDb: number;
  peak: number;
  peakDb: number;
}

/** Decode the actual media bytes and measure PCM energy. `loadedmetadata`
 * only proves that a video container opened; it says nothing about whether an
 * audio stream exists or contains sound. Call this from a player's
 * onLoadedMetadata handler so every preview reports evidence, not a guess. */
export async function probeClipAudio(url: string): Promise<ClipAudioProbe> {
  if (typeof window === 'undefined') throw new Error('Audio inspection needs an open browser tab.');
  const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextCtor) throw new Error('This browser cannot inspect clip audio.');
  const response = await fetch(url, { mode: 'cors' });
  if (!response.ok) throw new Error(`The clip could not be fetched for its sound check (HTTP ${response.status}).`);
  const bytes = await response.arrayBuffer();
  const context = new AudioContextCtor();
  try {
    let decoded: AudioBuffer;
    try {
      decoded = await context.decodeAudioData(bytes.slice(0));
    } catch {
      // A playable video-only MP4 has no decodable audio payload. This is the
      // expected result for silent routes such as the connected Kling proxy.
      return { hasAudioTrack: false, audible: false, channels: 0, sampleRate: 0, durationS: 0, rms: 0, rmsDb: -Infinity, peak: 0, peakDb: -Infinity };
    }
    let squares = 0;
    let peak = 0;
    let samples = 0;
    for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
      const pcm = decoded.getChannelData(channel);
      samples += pcm.length;
      for (let i = 0; i < pcm.length; i += 1) {
        const value = Math.abs(pcm[i]);
        squares += value * value;
        if (value > peak) peak = value;
      }
    }
    const rms = samples ? Math.sqrt(squares / samples) : 0;
    const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
    const peakDb = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
    return {
      hasAudioTrack: decoded.numberOfChannels > 0,
      audible: decoded.numberOfChannels > 0 && Number.isFinite(rmsDb) && rmsDb > -65,
      channels: decoded.numberOfChannels,
      sampleRate: decoded.sampleRate,
      durationS: decoded.duration,
      rms,
      rmsDb,
      peak,
      peakDb,
    };
  } finally {
    try { await context.close(); } catch { /* released */ }
  }
}

/**
 * Photograph one frame of a clip and upload it as a durable PNG.
 * position: seconds from start, or 'end' for the final frame (mirrors
 * ffmpeg -sseof -0.1). Returns the uploaded https URL.
 */
export async function extractFrame(videoUrl: string, position: number | 'end', maxDim = 1280): Promise<string> {
  if (typeof document === 'undefined') throw new Error('Frame capture needs an open browser tab.');
  const video = await openVideo(videoUrl);
  try {
    const duration = Math.max(0.2, Number(video.duration) || 0.2);
    const t = position === 'end' ? Math.max(0, duration - 0.1) : Math.min(Math.max(0, position), duration - 0.05);
    let ok = await seekTo(video, t);
    if (!ok) ok = await seekTo(video, t);
    if (!ok) throw new Error('The clip did not answer the frame seek.');
    const w = Number(video.videoWidth) || 1280;
    const h = Number(video.videoHeight) || 720;
    const scale = Math.min(1, maxDim / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(2, Math.round(w * scale));
    canvas.height = Math.max(2, Math.round(h * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is unavailable.');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    let dataUrl = '';
    try { dataUrl = canvas.toDataURL('image/png'); }
    catch { throw new Error('The clip host blocked frame capture (CORS-tainted canvas).'); }
    return await uploadDataUrl(dataUrl, `s2v-frame-${Date.now()}.png`);
  } finally {
    releaseVideo(video);
  }
}
