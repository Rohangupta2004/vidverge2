/**
 * Short Video Enhancer — source analysis.
 *
 * Two jobs, both in the browser and both cheap:
 *   1. Probe the real intrinsic size and duration of a clip, so the reframe
 *      decision is made on facts rather than on a guess.
 *   2. Build a SUBJECT TRACK: a smoothed path of where the face / character /
 *      product is, sampled across the clip. The motion engine anchors the
 *      vertical cover-crop and every simulated camera move on that path, which
 *      is what keeps the subject inside the safe area when a landscape source is
 *      reframed to 9:16.
 *
 * The browser's native FaceDetector is used when the engine has it; otherwise a
 * skin-tone + edge-energy saliency pass finds the subject. Either way the track
 * is smoothed and rate-limited so the crop glides instead of chattering.
 */

import { clamp, round3, sourceOrientation, type FocusPoint } from './model';

export interface ProbeResult {
  width: number;
  height: number;
  duration: number;
  orientation: 'portrait' | 'landscape' | 'square';
}

export interface TrackResult {
  focus: FocusPoint[];
  source: 'none' | 'face-detector' | 'saliency';
  confidence: number;
  note: string;
}

const MAX_SAMPLES = 22;
const SAMPLE_WIDTH = 128;

function loadVideo(src: string, withCors: boolean): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    if (withCors) v.crossOrigin = 'anonymous';
    v.preload = 'auto';
    v.muted = true;
    v.playsInline = true;
    v.src = src;
    const done = () => {
      if (!v.videoWidth || !Number.isFinite(v.duration) || v.duration <= 0) {
        reject(new Error('The browser could not read this video\u2019s dimensions or duration.'));
        return;
      }
      resolve(v);
    };
    v.onloadedmetadata = done;
    v.onerror = () => reject(new Error('The browser could not open this video file.'));
    setTimeout(() => { if (!v.videoWidth) reject(new Error('Timed out reading the video.')); }, 20000);
  });
}

/** Intrinsic size + duration of a clip, read from the browser decoder. */
export async function probeVideo(src: string): Promise<ProbeResult> {
  const v = await loadVideo(src, false);
  const out: ProbeResult = {
    width: v.videoWidth,
    height: v.videoHeight,
    duration: round3(v.duration),
    orientation: sourceOrientation(v.videoWidth, v.videoHeight),
  };
  v.removeAttribute('src');
  v.load();
  return out;
}

function seek(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSeeked = () => { v.removeEventListener('seeked', onSeeked); resolve(); };
    v.addEventListener('seeked', onSeeked);
    const guard = setTimeout(() => { v.removeEventListener('seeked', onSeeked); reject(new Error('seek timed out')); }, 8000);
    const clear = () => clearTimeout(guard);
    v.addEventListener('seeked', clear, { once: true });
    try { v.currentTime = Math.max(0, t); } catch (e) { clear(); reject(e as Error); }
  });
}

/** Skin-tone + edge-energy centroid of one frame. */
function saliencyCentroid(data: Uint8ClampedArray, w: number, h: number): { x: number; y: number; weight: number } {
  let sx = 0;
  let sy = 0;
  let total = 0;
  const lum = new Float32Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    lum[p] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
  }
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const i = p * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      const skin = (r > 95 && g > 40 && b > 20 && mx - mn > 15 && Math.abs(r - g) > 14 && r > g && r > b) ? 1 : 0;
      const edge = Math.abs(lum[p] - lum[p + 1]) + Math.abs(lum[p] - lum[p + w]);
      // Faces and products sit above the middle of a vertical frame far more
      // often than below it, so bias the search upward a little.
      const bias = 1 - Math.abs(y / h - 0.42) * 0.7;
      const score = (skin * 3.2 + edge * 1.4) * bias;
      if (score <= 0.02) continue;
      sx += x * score;
      sy += y * score;
      total += score;
    }
  }
  if (total < 1) return { x: 0.5, y: 0.42, weight: 0 };
  return { x: sx / total / w, y: sy / total / h, weight: total / (w * h) };
}

/**
 * Sample the clip and return a smoothed subject track in normalised source
 * coordinates. Returns an empty track (and says why) when the frame pixels
 * cannot be read — the engine then falls back to the manual anchor rather than
 * guessing.
 */
export async function buildSubjectTrack(src: string, duration: number, onProgress?: (p: number) => void): Promise<TrackResult> {
  let v: HTMLVideoElement;
  try {
    v = await loadVideo(src, true);
  } catch (e) {
    return { focus: [], source: 'none', confidence: 0, note: (e as Error).message };
  }

  const canvas = document.createElement('canvas');
  const scale = SAMPLE_WIDTH / Math.max(1, v.videoWidth);
  canvas.width = Math.max(16, Math.round(v.videoWidth * scale));
  canvas.height = Math.max(16, Math.round(v.videoHeight * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { focus: [], source: 'none', confidence: 0, note: 'This browser could not open a 2D canvas for analysis.' };

  const FaceDetectorCtor = (window as unknown as { FaceDetector?: new (o?: unknown) => { detect: (s: unknown) => Promise<{ boundingBox: DOMRectReadOnly }[]> } }).FaceDetector;
  let detector: { detect: (s: unknown) => Promise<{ boundingBox: DOMRectReadOnly }[]> } | null = null;
  if (FaceDetectorCtor) {
    try { detector = new FaceDetectorCtor({ fastMode: true, maxDetectedFaces: 1 }); } catch { detector = null; }
  }

  const total = Math.max(3, Math.min(MAX_SAMPLES, Math.ceil(duration / 0.7)));
  const raw: { t: number; x: number; y: number; w: number }[] = [];
  let faceHits = 0;
  let readFailure = '';

  for (let i = 0; i < total; i++) {
    const t = (duration * (i + 0.5)) / total;
    try {
      await seek(v, t);
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      let point: { x: number; y: number; weight: number } | null = null;
      if (detector) {
        try {
          const faces = await detector.detect(canvas);
          if (faces && faces.length) {
            const b = faces[0].boundingBox;
            point = { x: (b.x + b.width / 2) / canvas.width, y: (b.y + b.height / 2) / canvas.height, weight: 1 };
            faceHits += 1;
          }
        } catch { detector = null; }
      }
      if (!point) {
        const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
        point = saliencyCentroid(frame.data, canvas.width, canvas.height);
      }
      raw.push({ t: round3(t), x: point.x, y: point.y, w: point.weight });
    } catch (e) {
      readFailure = (e as Error).message || String(e);
      break;
    }
    if (onProgress) onProgress((i + 1) / total);
  }

  v.removeAttribute('src');
  v.load();

  if (!raw.length) {
    return {
      focus: [],
      source: 'none',
      confidence: 0,
      note: readFailure
        ? 'The frame pixels could not be read for analysis (' + readFailure + '). Reframing will use the manual anchor instead.'
        : 'No frames could be sampled, so reframing will use the manual anchor.',
    };
  }

  // Smooth (3-tap) and rate-limit so the crop never snaps between samples.
  const focus: FocusPoint[] = [];
  let lastX = raw[0].x;
  let lastY = raw[0].y;
  for (let i = 0; i < raw.length; i++) {
    const a = raw[Math.max(0, i - 1)];
    const b = raw[i];
    const c = raw[Math.min(raw.length - 1, i + 1)];
    const mx = (a.x + b.x * 2 + c.x) / 4;
    const my = (a.y + b.y * 2 + c.y) / 4;
    const x = clamp(lastX + clamp(mx - lastX, -0.07, 0.07), 0.1, 0.9);
    const y = clamp(lastY + clamp(my - lastY, -0.07, 0.07), 0.1, 0.9);
    lastX = x;
    lastY = y;
    focus.push({ t: b.t, x: round3(x), y: round3(y) });
  }

  const weighted = raw.filter((r) => r.w > 0).length / raw.length;
  const usedFaces = faceHits >= Math.max(2, raw.length * 0.4);
  return {
    focus,
    source: usedFaces ? 'face-detector' : 'saliency',
    confidence: round3(usedFaces ? Math.min(1, faceHits / raw.length) : Math.min(0.85, weighted * 0.85)),
    note: usedFaces
      ? 'Face tracking locked on in ' + faceHits + ' of ' + raw.length + ' sampled frames.'
      : 'No face API in this browser — the subject was located with a skin-tone and edge-energy pass across ' + raw.length + ' frames.',
  };
}

// ---------------------------------------------------------------------------
// Frame sampling (for the vision-based subject segmentation pass)
// ---------------------------------------------------------------------------

export interface FrameSample { t: number; base64: string; mimeType: string; width: number; height: number }

/**
 * Grab a handful of JPEG stills from a clip, base64-encoded and ready to hand
 * to the vision model.
 *
 * A canvas drawn from a cross-origin video it is not allowed to read is
 * TAINTED, and `toDataURL` throws rather than returning anything — so a frame
 * grab that cannot be read comes back as an empty list with the reason, and the
 * caller falls back to the local tracker instead of pretending it worked.
 */
export async function sampleFrames(src: string, duration: number, count = 4, maxWidth = 512): Promise<{ frames: FrameSample[]; note: string }> {
  let v: HTMLVideoElement;
  try {
    v = await loadVideo(src, true);
  } catch (e) {
    return { frames: [], note: (e as Error).message };
  }
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, maxWidth / Math.max(1, v.videoWidth));
  canvas.width = Math.max(32, Math.round(v.videoWidth * scale));
  canvas.height = Math.max(32, Math.round(v.videoHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return { frames: [], note: 'This browser could not open a 2D canvas.' };

  const total = Math.max(1, Math.min(8, count));
  const frames: FrameSample[] = [];
  let failure = '';
  for (let i = 0; i < total; i++) {
    const t = (duration * (i + 0.5)) / total;
    try {
      await seek(v, t);
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      const url = canvas.toDataURL('image/jpeg', 0.72);
      const comma = url.indexOf(',');
      if (comma < 0) throw new Error('the frame could not be encoded');
      frames.push({
        t: round3(t),
        base64: url.slice(comma + 1),
        mimeType: 'image/jpeg',
        width: canvas.width,
        height: canvas.height,
      });
    } catch (e) {
      failure = (e as Error).message || String(e);
      break;
    }
  }

  v.removeAttribute('src');
  v.load();

  return {
    frames,
    note: frames.length
      ? ''
      : 'The frame pixels could not be read' + (failure ? ' (' + failure + ')' : '') +
        '. Subject detection will use the local tracker instead.',
  };
}

/**
 * Peak-normalised waveform of an audio/video file or an already-decoded buffer.
 * Beat detection passes its decoded buffer here, so the visible waveform and
 * the onset detector start from the same peak envelope without decoding twice.
 */
export async function waveformPeaks(source: Blob | AudioBuffer, buckets = 240): Promise<number[]> {
  let ctx: AudioContext | null = null;
  try {
    let decoded: AudioBuffer;
    if (typeof (source as AudioBuffer).getChannelData === 'function') {
      decoded = source as AudioBuffer;
    } else {
      const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
        || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return [];
      ctx = new AC();
      const buf = await (source as Blob).arrayBuffer();
      decoded = await ctx.decodeAudioData(buf.slice(0));
    }
    const count = Math.max(1, Math.round(buckets));
    const per = Math.max(1, Math.floor(decoded.length / count));
    const channels = Math.max(1, Math.min(2, decoded.numberOfChannels));
    const peaks: number[] = [];
    for (let i = 0; i < count; i++) {
      let max = 0;
      const start = i * per;
      for (let channelIndex = 0; channelIndex < channels; channelIndex++) {
        const channel = decoded.getChannelData(channelIndex);
        for (let j = start; j < start + per && j < channel.length; j++) {
          const value = Math.abs(channel[j]);
          if (value > max) max = value;
        }
      }
      peaks.push(Math.round(max * 10000) / 10000);
    }
    return peaks;
  } catch {
    return [];
  } finally {
    if (ctx) {
      try { await ctx.close(); } catch { /* no-op */ }
    }
  }
}
