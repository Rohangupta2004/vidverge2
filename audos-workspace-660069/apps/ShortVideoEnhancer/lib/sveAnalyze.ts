/**
 * Short Video Enhancer — local footage analysis.
 *
 * Everything here runs in the browser against the creator's own file, before a
 * single byte is uploaded, so the editor can show real numbers immediately:
 * what the clip looks like (a frame contact sheet for the vision model), how
 * loud and how fast it is (the music agent's brief), and whether the opening
 * three seconds actually move (the hook check that the research brief asks
 * for — the first 3 seconds decide whether a short is watched).
 *
 * None of it is guesswork dressed as measurement: when a signal cannot be
 * taken, the function says so and the UI reports the gap rather than inventing
 * a number.
 */

import { clamp } from './sveTypes';

export interface AudioStats {
  /** Estimated tempo from onset spacing. 0 when no usable audio track. */
  bpm: number;
  /** Mean RMS loudness, 0..1. */
  energy: number;
  /** Normalised envelope for the waveform strip. */
  peaks: number[];
  hasAudio: boolean;
  note: string;
}

export interface MotionRead {
  /** Mean inter-frame difference across the opening window, 0..1. */
  openingMotion: number;
  /** True when the first three seconds are visually static. */
  staticOpening: boolean;
  /** True when the clip stops on a held frame rather than resolving. */
  abruptEnding: boolean;
  note: string;
}

function decodeContext(): AudioContext | null {
  const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
  return AC ? new AC() : null;
}

/**
 * Loudness, tempo and an envelope, read straight off the decoded PCM.
 *
 * Tempo comes from the median spacing between energy onsets rather than a
 * full beat tracker: for a talking-head short that is enough to tell the music
 * agent whether it is briefing a 90 BPM bed or a 130 BPM one, and it never
 * claims more precision than that.
 */
export async function analyzeAudio(file: File, buckets = 160): Promise<AudioStats> {
  const empty: AudioStats = { bpm: 0, energy: 0, peaks: [], hasAudio: false, note: '' };
  const ctx = decodeContext();
  if (!ctx) return { ...empty, note: 'This browser cannot decode audio, so music is briefed from the visuals alone.' };

  let buffer: AudioBuffer;
  try {
    buffer = await ctx.decodeAudioData((await file.arrayBuffer()).slice(0));
  } catch (e) {
    return { ...empty, note: 'This clip has no readable audio track, so music is briefed from the visuals alone.' };
  } finally {
    try { await ctx.close(); } catch { /* no-op */ }
  }

  const data = buffer.getChannelData(0);
  const rate = buffer.sampleRate;
  if (!data.length) return { ...empty, note: 'This clip has a silent audio track.' };

  // --- envelope -------------------------------------------------------------
  const windowSize = Math.max(1, Math.floor(data.length / Math.max(1, buckets)));
  const peaks: number[] = [];
  let loudest = 0;
  for (let b = 0; b < buckets; b++) {
    const from = b * windowSize;
    const to = Math.min(data.length, from + windowSize);
    let sum = 0;
    for (let i = from; i < to; i++) sum += data[i] * data[i];
    const rms = to > from ? Math.sqrt(sum / (to - from)) : 0;
    peaks.push(rms);
    if (rms > loudest) loudest = rms;
  }
  const normalised = loudest > 0 ? peaks.map((p) => clamp(p / loudest, 0, 1)) : peaks;
  const energy = normalised.reduce((a, b) => a + b, 0) / Math.max(1, normalised.length);

  // --- onsets ---------------------------------------------------------------
  const hop = Math.max(1, Math.floor(rate / 86)); // ~11.6 ms frames
  const frames: number[] = [];
  for (let i = 0; i + hop <= data.length; i += hop) {
    let sum = 0;
    for (let j = i; j < i + hop; j++) sum += data[j] * data[j];
    frames.push(Math.sqrt(sum / hop));
  }
  const flux: number[] = [];
  for (let i = 1; i < frames.length; i++) flux.push(Math.max(0, frames[i] - frames[i - 1]));
  const mean = flux.reduce((a, b) => a + b, 0) / Math.max(1, flux.length);
  const threshold = mean * 1.9;
  const onsets: number[] = [];
  for (let i = 1; i < flux.length - 1; i++) {
    if (flux[i] > threshold && flux[i] >= flux[i - 1] && flux[i] > flux[i + 1]) {
      onsets.push((i * hop) / rate);
    }
  }

  let bpm = 0;
  if (onsets.length >= 6) {
    const gaps: number[] = [];
    for (let i = 1; i < onsets.length; i++) {
      const gap = onsets[i] - onsets[i - 1];
      if (gap > 0.22 && gap < 1.6) gaps.push(gap);
    }
    if (gaps.length >= 4) {
      gaps.sort((a, b) => a - b);
      const median = gaps[Math.floor(gaps.length / 2)];
      bpm = clamp(60 / median, 60, 180);
    }
  }

  return {
    bpm,
    energy,
    peaks: normalised,
    hasAudio: loudest > 0.002,
    note: bpm ? '' : 'Tempo could not be measured from this audio, so the brief uses the clip’s energy instead.',
  };
}

/** Normalised envelope of a remote audio file, for the music waveform strip. */
export async function waveformFor(url: string, buckets = 96): Promise<number[]> {
  const ctx = decodeContext();
  if (!ctx || !url) return [];
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return [];
    const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
    const data = buffer.getChannelData(0);
    const windowSize = Math.max(1, Math.floor(data.length / buckets));
    const peaks: number[] = [];
    let loudest = 0;
    for (let b = 0; b < buckets; b++) {
      const from = b * windowSize;
      const to = Math.min(data.length, from + windowSize);
      let max = 0;
      for (let i = from; i < to; i++) {
        const v = Math.abs(data[i]);
        if (v > max) max = v;
      }
      peaks.push(max);
      if (max > loudest) loudest = max;
    }
    return loudest > 0 ? peaks.map((p) => clamp(p / loudest, 0.04, 1)) : peaks;
  } catch {
    // A waveform is decoration; never let it take the music feature down.
    return [];
  } finally {
    try { await ctx.close(); } catch { /* no-op */ }
  }
}

function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error('seek failed at ' + time.toFixed(2) + 's')); };
    const cleanup = () => {
      video.removeEventListener('seeked', done);
      video.removeEventListener('error', fail);
      window.clearTimeout(guard);
    };
    const guard = window.setTimeout(fail, 6000);
    video.addEventListener('seeked', done);
    video.addEventListener('error', fail);
    video.currentTime = Math.max(0, time);
  });
}

function offscreenVideo(src: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    video.src = src;
    const guard = window.setTimeout(() => reject(new Error('the clip took too long to open')), 20000);
    video.addEventListener('loadeddata', () => { window.clearTimeout(guard); resolve(video); }, { once: true });
    video.addEventListener('error', () => { window.clearTimeout(guard); reject(new Error('the clip could not be opened')); }, { once: true });
  });
}

export interface FrameSample {
  /** Evenly spaced timestamps the frames were taken at. */
  times: number[];
  /** One tiled JPEG of all the frames — a single vision call, not five. */
  contactSheetBase64: string;
  /** Per-frame thumbnails for the suggestions strip. */
  thumbs: string[];
  note: string;
}

/**
 * Sample `count` frames evenly through the clip and tile them into one image.
 *
 * Tiling matters: the vision endpoint takes a single image per call, so a
 * contact sheet is what lets the model reason about CHANGE across the clip
 * ("the product appears halfway through") instead of describing one still.
 */
export async function sampleFrames(src: string, duration: number, count = 5): Promise<FrameSample> {
  const empty: FrameSample = { times: [], contactSheetBase64: '', thumbs: [], note: '' };
  const total = Number(duration) || 0;
  if (!src || total <= 0) return { ...empty, note: 'The clip length is not known yet.' };

  let video: HTMLVideoElement;
  try {
    video = await offscreenVideo(src);
  } catch (e) {
    return { ...empty, note: 'Scene analysis could not read this clip (' + (e instanceof Error ? e.message : String(e)) + ').' };
  }

  const n = Math.max(2, Math.min(6, count));
  const times: number[] = [];
  for (let i = 0; i < n; i++) times.push(((i + 0.5) / n) * total);

  const tileW = 288;
  const tileH = 512;
  const cols = Math.min(3, n);
  const rows = Math.ceil(n / cols);
  const sheet = document.createElement('canvas');
  sheet.width = tileW * cols;
  sheet.height = tileH * rows;
  const sheetCtx = sheet.getContext('2d');
  const tile = document.createElement('canvas');
  tile.width = tileW;
  tile.height = tileH;
  const tileCtx = tile.getContext('2d');
  if (!sheetCtx || !tileCtx) return { ...empty, note: 'This browser blocked canvas access, so scene analysis is off.' };

  sheetCtx.fillStyle = '#05050A';
  sheetCtx.fillRect(0, 0, sheet.width, sheet.height);

  const thumbs: string[] = [];
  const taken: number[] = [];
  for (let i = 0; i < times.length; i++) {
    try {
      await seekTo(video, times[i]);
    } catch {
      continue;
    }
    tileCtx.fillStyle = '#05050A';
    tileCtx.fillRect(0, 0, tileW, tileH);
    drawCover(tileCtx, video, tileW, tileH);
    sheetCtx.drawImage(tile, (i % cols) * tileW, Math.floor(i / cols) * tileH);
    thumbs.push(tile.toDataURL('image/jpeg', 0.62));
    taken.push(times[i]);
  }

  video.src = '';

  if (!taken.length) return { ...empty, note: 'No frames could be read from this clip.' };
  return {
    times: taken,
    contactSheetBase64: sheet.toDataURL('image/jpeg', 0.72).split(',')[1] || '',
    thumbs,
    note: '',
  };
}

function drawCover(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, w: number, h: number) {
  const vw = video.videoWidth || w;
  const vh = video.videoHeight || h;
  const scale = Math.max(w / vw, h / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  ctx.drawImage(video, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

/**
 * Does the clip move where it matters?
 *
 * Four downscaled frames across the opening three seconds, plus two at the
 * tail. A mean pixel difference under 2% reads as a held frame — the opening
 * that the research brief says to rescue with a title-card hook, and the
 * ending that wants a CTA rather than just stopping.
 */
export async function readMotion(src: string, duration: number): Promise<MotionRead> {
  const empty: MotionRead = { openingMotion: 0, staticOpening: false, abruptEnding: false, note: '' };
  const total = Number(duration) || 0;
  if (!src || total <= 0) return { ...empty, note: 'The clip length is not known yet.' };

  let video: HTMLVideoElement;
  try {
    video = await offscreenVideo(src);
  } catch (e) {
    return { ...empty, note: 'The hook check could not read this clip (' + (e instanceof Error ? e.message : String(e)) + ').' };
  }

  const W = 64;
  const H = 114;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true } as any);
  if (!ctx) return { ...empty, note: 'This browser blocked canvas access, so the hook check is off.' };

  const grab = async (t: number): Promise<Uint8ClampedArray | null> => {
    try {
      await seekTo(video, Math.min(t, Math.max(0, total - 0.05)));
      ctx.drawImage(video, 0, 0, W, H);
      return ctx.getImageData(0, 0, W, H).data;
    } catch {
      return null;
    }
  };

  const diff = (a: Uint8ClampedArray | null, b: Uint8ClampedArray | null): number => {
    if (!a || !b) return 0;
    let sum = 0;
    for (let i = 0; i < a.length; i += 4) {
      sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    }
    return sum / ((a.length / 4) * 3 * 255);
  };

  const openWindow = Math.min(3, total);
  const openFrames = await Promise.resolve().then(async () => {
    const out: (Uint8ClampedArray | null)[] = [];
    for (const t of [0.15, openWindow * 0.35, openWindow * 0.7, Math.max(0.2, openWindow - 0.1)]) {
      out.push(await grab(t));
    }
    return out;
  });

  let openingMotion = 0;
  let compared = 0;
  for (let i = 1; i < openFrames.length; i++) {
    if (openFrames[i] && openFrames[i - 1]) {
      openingMotion += diff(openFrames[i], openFrames[i - 1]);
      compared++;
    }
  }
  openingMotion = compared ? openingMotion / compared : 0;

  let abruptEnding = false;
  if (total > 2) {
    const tailA = await grab(total - 0.9);
    const tailB = await grab(total - 0.08);
    // Still moving right up to the final frame means the clip was cut mid-shot.
    abruptEnding = diff(tailA, tailB) > 0.03;
  }

  video.src = '';

  return {
    openingMotion,
    staticOpening: compared > 0 && openingMotion < 0.02,
    abruptEnding,
    note: compared ? '' : 'The opening frames could not be compared on this clip.',
  };
}
