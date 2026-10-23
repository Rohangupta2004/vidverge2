/**
 * FINAL FRAME EXTRACTION — FFmpeg-based, with validation and fallbacks.
 *
 * After every generated clip the pipeline:
 *   1. reads the clip's REAL duration from its media metadata (never assumes
 *      the planned duration),
 *   2. extracts the final frame with FFmpeg.wasm (`-ss <duration - 0.1> -i …
 *      -frames:v 1`),
 *   3. validates the frame — the file exists, the image decodes, has real
 *      dimensions, and is not an empty/flat (all one color) frame,
 *   4. falls back to a frame slightly before the end when the last frame is
 *      invalid, and finally to the canvas-based extractor when FFmpeg cannot
 *      run in this browser,
 *   5. uploads the frame as a durable PNG so it can seed the next clip.
 */

import { fetchFile } from 'https://esm.sh/@ffmpeg/util@0.12.1';
import { Aspect, uploadBlob } from '../api';
import { loadFFmpeg } from './assemble';
import { extractFrame as canvasExtractFrame, probeClipDuration } from './capture';

export interface ExtractedFrame {
  url: string;
  width: number;
  height: number;
  /** Seconds from clip start the frame was taken at. */
  atSecond: number;
  method: 'ffmpeg' | 'canvas';
}

/** Real clip duration read from the media's own metadata. 0 when unreadable. */
export async function probeVideoDuration(videoUrl: string): Promise<number> {
  try { return await probeClipDuration(videoUrl); } catch { return 0; }
}

export interface FrameCheck { ok: boolean; width: number; height: number; reason?: string }
export type FrameProgress = 'loading-ffmpeg' | 'decoding-video' | 'validating-frame' | 'uploading-frame' | 'canvas-fallback';

/** Decode + inspect a candidate frame: must decode, have real dimensions,
 * match the film ratio, and not be a flat single-color (black/empty) image. */
export async function validateFrameBlob(blob: Blob, expectedAspect?: Aspect): Promise<FrameCheck> {
  if (!blob || blob.size < 200) return { ok: false, width: 0, height: 0, reason: 'The frame file is empty.' };
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('The frame image does not decode.'));
      el.src = url;
    });
    const w = img.naturalWidth; const h = img.naturalHeight;
    if (w < 16 || h < 16) return { ok: false, width: w, height: h, reason: 'The frame has no real dimensions.' };
    if (expectedAspect) {
      const expectedRatio = expectedAspect === '9:16' ? 9 / 16 : expectedAspect === '1:1' ? 1 : 16 / 9;
      const ratioError = Math.abs((w / h) - expectedRatio) / expectedRatio;
      if (ratioError > 0.06) return { ok: false, width: w, height: h, reason: `The decoded frame is ${w}×${h}, which does not match ${expectedAspect}.` };
    }
    // Flatness check: sample a downscaled copy; a corrupt/empty frame is one color.
    const canvas = document.createElement('canvas');
    canvas.width = 32; canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(img, 0, 0, 32, 32);
      const { data } = ctx.getImageData(0, 0, 32, 32);
      let min = 255; let max = 0;
      for (let i = 0; i < data.length; i += 4) {
        const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
        if (lum < min) min = lum;
        if (lum > max) max = lum;
      }
      if (max - min < 3) return { ok: false, width: w, height: h, reason: 'The frame is a flat single-color image (likely corrupt or black).' };
    }
    return { ok: true, width: w, height: h };
  } catch (e: any) {
    return { ok: false, width: 0, height: 0, reason: String(e?.message || e) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function frameExt(videoUrl: string): string {
  const m = /\.(mp4|webm|mov|m4v)(?:\?|#|$)/i.exec(videoUrl);
  return m ? m[1].toLowerCase() : 'mp4';
}

async function ffmpegFrameAt(videoUrl: string, atSecond: number, expectedAspect?: Aspect, onProgress?: (stage: FrameProgress) => void): Promise<{ blob: Blob; check: FrameCheck }> {
  onProgress?.('loading-ffmpeg');
  const ff = await loadFFmpeg();
  const inName = `frame-src.${frameExt(videoUrl)}`;
  const outName = 'final-frame.png';
  try {
    onProgress?.('decoding-video');
    await ff.writeFile(inName, await fetchFile(videoUrl));
    const rc = await ff.exec(['-y', '-ss', Math.max(0, atSecond).toFixed(3), '-i', inName, '-frames:v', '1', '-q:v', '2', outName]);
    if (rc !== 0) throw new Error(`FFmpeg could not decode a frame at ${atSecond.toFixed(2)}s.`);
    const bytes = await ff.readFile(outName);
    const blob = new Blob([bytes], { type: 'image/png' });
    onProgress?.('validating-frame');
    const check = await validateFrameBlob(blob, expectedAspect);
    return { blob, check };
  } finally {
    try { await ff.deleteFile(inName); } catch { /* fs cleanup */ }
    try { await ff.deleteFile(outName); } catch { /* fs cleanup */ }
  }
}

/**
 * Extract and VALIDATE the clip's final frame; upload it as a durable PNG.
 * Attempts, in order: FFmpeg at duration-0.1s → FFmpeg at duration-0.5s →
 * canvas extractor at the end → canvas extractor 0.5s earlier.
 * Throws only when every path fails — the caller pauses the chain for a user decision.
 */
export async function validateFrameUrl(url: string, expectedAspect?: Aspect): Promise<FrameCheck> {
  if (!/^https:\/\//i.test(String(url || ''))) return { ok: false, width: 0, height: 0, reason: 'The continuity frame is not a durable HTTPS URL.' };
  try {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) return { ok: false, width: 0, height: 0, reason: `The continuity frame returned HTTP ${response.status}.` };
    return await validateFrameBlob(await response.blob(), expectedAspect);
  } catch (error: any) {
    return { ok: false, width: 0, height: 0, reason: `The continuity frame could not be fetched: ${String(error?.message || error)}` };
  }
}

export async function extractFinalFrame(videoUrl: string, expectedAspect?: Aspect, onProgress?: (stage: FrameProgress) => void): Promise<ExtractedFrame> {
  const duration = await probeVideoDuration(videoUrl);
  const endAt = Math.max(0, (duration || 0.2) - 0.1);
  const earlierAt = Math.max(0, (duration || 0.6) - 0.5);
  const failures: string[] = [];

  // FFmpeg path — the real final frame, then a frame slightly before the end.
  for (const at of [endAt, earlierAt]) {
    try {
      const { blob, check } = await ffmpegFrameAt(videoUrl, at, expectedAspect, onProgress);
      if (check.ok) {
        onProgress?.('uploading-frame');
        const url = await uploadBlob(blob, `s2v-final-frame-${Date.now()}.png`);
        return { url, width: check.width, height: check.height, atSecond: at, method: 'ffmpeg' };
      }
      failures.push(`ffmpeg@${at.toFixed(2)}s: ${check.reason || 'invalid frame'}`);
    } catch (e: any) {
      failures.push(`ffmpeg@${at.toFixed(2)}s: ${String(e?.message || e).slice(0, 120)}`);
      // The first failure may be specific to the final GOP/frame. Always try
      // duration-0.5s before falling back to canvas.
      continue;
    }
  }

  // Canvas fallback — decodes through <video>, uploads a durable PNG, then
  // passes the exact same decode/aspect/flatness validation as FFmpeg output.
  for (const position of ['end' as const, earlierAt]) {
    try {
      onProgress?.('canvas-fallback');
      const url = await canvasExtractFrame(videoUrl, position);
      onProgress?.('validating-frame');
      const check = await validateFrameUrl(url, expectedAspect);
      if (!check.ok) {
        failures.push(`canvas@${position === 'end' ? 'end' : `${earlierAt.toFixed(2)}s`}: ${check.reason || 'invalid frame'}`);
        continue;
      }
      return { url, width: check.width, height: check.height, atSecond: position === 'end' ? endAt : earlierAt, method: 'canvas' };
    } catch (e: any) {
      failures.push(`canvas@${position === 'end' ? 'end' : `${earlierAt.toFixed(2)}s`}: ${String(e?.message || e).slice(0, 120)}`);
    }
  }

  throw new Error(`The final frame could not be extracted: ${failures.join(' · ')}`);
}
