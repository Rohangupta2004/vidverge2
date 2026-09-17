/**
 * apps/Create/frameChain.ts — Track A frame extraction + continuous character
 * chaining (Omni Flash / Veo path only; Track B never touches this file).
 *
 * WHAT LIVES HERE:
 *   1. extractVideoFrames() — pull the FIRST and LAST frame out of a finished
 *      render as PNG stills, in the browser: a hidden <video> element seeked to
 *      0.1s and duration−0.1s, drawn onto a canvas, read with toDataURL().
 *      The stills are then uploaded through the platform's file endpoint so a
 *      durable https URL exists — a data URL cannot be handed to the render
 *      hook as a reference image, and it would bloat localStorage.
 *   2. The SERIES ANCHOR — the session-level "same character across videos"
 *      state. Module scope, exactly like videoStore: the shell unmounts the
 *      app on every tab switch, so React state would forget the series.
 *      Deliberately NOT persisted to the DB — a series is a session-level
 *      choice for now.
 *
 * CHAINING RULE (who seeds the next render):
 *   - Series active  → the anchor frame (the last frame of the most recently
 *     completed video when the series was live).
 *   - Series off     → the last frame of the most recently completed video in
 *     this session, so back-to-back renders keep the same character with no
 *     setup at all.
 *   - An explicitly attached character photo always wins over both — the
 *     visitor's deliberate pick is never silently overridden (videoStore
 *     enforces that; this module only answers "what would chain?").
 */
import { useEffect, useState } from 'react';
import { uploadImage } from '../../lib/reelioStudio';

// ---------------------------------------------------------------------------
// Frame extraction
// ---------------------------------------------------------------------------
export interface ExtractedFrames {
  /** ~0.1s in. https URL when the upload worked, else a PNG data URL. */
  firstFrameUrl: string | null;
  /** duration − 0.1s. https URL when the upload worked, else a PNG data URL. */
  lastFrameUrl: string | null;
}

/** Frames are thumbnails and reference seeds, not deliverables — cap the size. */
const FRAME_MAX_DIM = 720;
const LOAD_TIMEOUT_MS = 20000;

export function isHttpUrl(url: string | null | undefined): boolean {
  return typeof url === 'string' && /^https?:\/\//.test(url);
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`${what} timed out`)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Could not seek the video for frame extraction.'));
    };
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    try {
      video.currentTime = time;
    } catch (e) {
      cleanup();
      reject(e instanceof Error ? e : new Error('Could not seek the video.'));
    }
  });
}

/**
 * Draw the video's current frame to a canvas and read it back as a PNG data
 * URL. Returns null instead of throwing on a TAINTED canvas — a video host
 * without CORS headers makes toDataURL throw a SecurityError, and a missing
 * frame is a degraded extra, never a failed render.
 */
function grabFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): string | null {
  try {
    const vw = video.videoWidth || 0;
    const vh = video.videoHeight || 0;
    if (!vw || !vh) return null;
    const scale = Math.min(1, FRAME_MAX_DIM / Math.max(vw, vh));
    canvas.width = Math.max(2, Math.round(vw * scale));
    canvas.height = Math.max(2, Math.round(vh * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } catch (e) {
    console.warn('[FrameChain] frame grab failed (CORS-tainted canvas?):', e);
    return null;
  }
}

function dataUrlToFile(dataUrl: string, name: string): File | null {
  try {
    const [head, body] = dataUrl.split(',');
    if (!head || !body || head.indexOf('base64') === -1) return null;
    const mime = (head.match(/data:([^;]+)/) || [])[1] || 'image/png';
    const bytes = atob(body);
    const buffer = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) buffer[i] = bytes.charCodeAt(i);
    return new File([buffer], name, { type: mime });
  } catch {
    return null;
  }
}

/** Best-effort upload of an extracted frame so it has a durable https URL. */
async function toDurableUrl(dataUrl: string | null, name: string): Promise<string | null> {
  if (!dataUrl) return null;
  const file = dataUrlToFile(dataUrl, name);
  if (!file) return dataUrl;
  try {
    const url = await uploadImage(file, 'frames');
    return isHttpUrl(url) ? url : dataUrl;
  } catch (e) {
    // The data URL still works for thumbnails; only hook submission needs https.
    console.warn('[FrameChain] frame upload failed, keeping the data URL:', e);
    return dataUrl;
  }
}

/**
 * Extract the first and last frame of a finished video. Never throws — a
 * null field means that frame could not be captured, and every caller treats
 * the frames as a bonus rather than a requirement.
 */
export async function extractVideoFrames(videoUrl: string): Promise<ExtractedFrames> {
  if (typeof window === 'undefined' || !videoUrl) {
    return { firstFrameUrl: null, lastFrameUrl: null };
  }
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  // Without this every frame grab is a tainted canvas. The render buckets
  // (GCS) answer with permissive CORS, so anonymous is the right ask.
  video.crossOrigin = 'anonymous';
  video.style.position = 'fixed';
  video.style.left = '-9999px';
  video.style.top = '-9999px';
  video.style.width = '2px';
  video.style.height = '2px';
  document.body.appendChild(video);
  const canvas = document.createElement('canvas');

  try {
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          video.removeEventListener('loadeddata', onLoaded);
          video.removeEventListener('error', onError);
        };
        const onLoaded = () => {
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          reject(new Error('The video could not be loaded for frame extraction.'));
        };
        video.addEventListener('loadeddata', onLoaded);
        video.addEventListener('error', onError);
        video.src = videoUrl;
        video.load();
      }),
      LOAD_TIMEOUT_MS,
      'video load',
    );

    const duration = Number.isFinite(video.duration) ? video.duration : 0;

    await withTimeout(seekTo(video, Math.min(0.1, Math.max(0, duration / 2))), LOAD_TIMEOUT_MS, 'first-frame seek');
    const firstData = grabFrame(video, canvas);

    let lastData: string | null = null;
    if (duration > 0.3) {
      await withTimeout(seekTo(video, Math.max(0.1, duration - 0.1)), LOAD_TIMEOUT_MS, 'last-frame seek');
      lastData = grabFrame(video, canvas);
    } else {
      lastData = firstData;
    }

    const stamp = Date.now();
    const [firstFrameUrl, lastFrameUrl] = await Promise.all([
      toDurableUrl(firstData, `first-frame-${stamp}.png`),
      toDurableUrl(lastData, `last-frame-${stamp}.png`),
    ]);
    return { firstFrameUrl, lastFrameUrl };
  } catch (e) {
    console.warn('[FrameChain] frame extraction skipped:', e);
    return { firstFrameUrl: null, lastFrameUrl: null };
  } finally {
    try {
      video.removeAttribute('src');
      video.load();
      video.remove();
    } catch {
      /* nothing to clean */
    }
  }
}

// ---------------------------------------------------------------------------
// Series anchor + last-completed-frame chaining (session-level, module scope)
// ---------------------------------------------------------------------------
export interface FrameAnchor {
  /** The frame image. https when uploaded, data URL as a display-only fallback. */
  url: string;
  /** The video it came from, for the badge copy. */
  title: string;
  jobId: string | null;
}

interface ChainState {
  seriesActive: boolean;
  seriesAnchor: FrameAnchor | null;
  lastCompletedFrame: FrameAnchor | null;
}

let chain: ChainState = {
  seriesActive: false,
  seriesAnchor: null,
  lastCompletedFrame: null,
};

const chainListeners = new Set<() => void>();

function emitChain(): void {
  chainListeners.forEach((listener) => {
    try {
      listener();
    } catch (e) {
      console.warn('[FrameChain] listener failed:', e);
    }
  });
}

export function getChainState(): ChainState {
  return chain;
}

/** Subscribe a component to the series/chain state. */
export function useFrameChain(): ChainState {
  const [snapshot, setSnapshot] = useState<ChainState>(chain);
  useEffect(() => {
    setSnapshot(chain);
    const listener = () => setSnapshot(chain);
    chainListeners.add(listener);
    return () => {
      chainListeners.delete(listener);
    };
  }, []);
  return snapshot;
}

/**
 * A render finished and its last frame was extracted. Remember it as the
 * most recent completed frame; while a series is live it ALSO becomes the
 * series anchor, so the series always continues from the newest video.
 */
export function noteCompletedFrame(anchor: FrameAnchor): void {
  if (!anchor || !anchor.url) return;
  chain = {
    ...chain,
    lastCompletedFrame: anchor,
    seriesAnchor: chain.seriesActive ? anchor : chain.seriesAnchor,
  };
  emitChain();
}

/** Turn the series on, anchored to the most recently completed video's last frame. */
export function startSeries(): void {
  const anchor = chain.lastCompletedFrame;
  if (!anchor) return;
  chain = { ...chain, seriesActive: true, seriesAnchor: anchor };
  emitChain();
}

/** Turn the series off and drop its anchor. */
export function clearSeries(): void {
  chain = { ...chain, seriesActive: false, seriesAnchor: null };
  emitChain();
}

/** The active series anchor, or null when no series is running. */
export function getSeriesAnchor(): FrameAnchor | null {
  return chain.seriesActive ? chain.seriesAnchor : null;
}

/**
 * What the NEXT generation should chain from: the series anchor when a series
 * is live, otherwise the most recently completed video's last frame. Callers
 * still let an explicitly attached character photo win over this.
 */
export function getChainReference(): FrameAnchor | null {
  return getSeriesAnchor() || chain.lastCompletedFrame;
}
