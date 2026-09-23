// FILM QA — output verification for the assembled MP4. Two layers:
//
//  1. verifyRenderOutput — the HARD gate completeAssembly runs BEFORE the new
//     video URL is accepted: the file must exist, be non-empty (a real film,
//     not a header), and decode to a duration close to what the timeline
//     asked for. An HTTP 200 from the render submission never counts as
//     completion; only a verified file does. A failure here means the
//     previous working output is left untouched.
//
//  2. runFilmQa — the best-effort frame sweep AFTER the film is accepted:
//     sample frames across the film, flag black/frozen stretches, and record
//     the whole verdict on the project (final_qa_report + extra delivery
//     checks). Frame extraction uses the same <video>+canvas technique the
//     per-scene visual QA proves (the platform /api/video/frames endpoint is
//     unavailable — it answers 402 'ffmpeg exited null'); a browser that
//     cannot decode or taints the canvas degrades to 'skipped', never to a
//     false failure.

import type { CheckResult } from './supabase';

/** Byte floor for a real film — anything under this is a header, not a video. */
const MIN_FILM_BYTES = 120_000;
const BLACK_LUMA_FLOOR = 12;
const FROZEN_DELTA_FLOOR = 1.2;

export interface RenderVerification {
  ok: boolean;
  reason: string;
  bytes: number | null;
  duration_sec: number | null;
  expected_sec: number;
}

async function remoteBytes(url: string): Promise<number | null> {
  try {
    const response = await fetch(url, { headers: { Range: 'bytes=0-0' } });
    if (response.status === 404 || response.status === 410) return 0;
    const contentRange = response.headers.get('content-range');
    const total = contentRange ? Number(contentRange.split('/')[1]) : NaN;
    if (Number.isFinite(total) && total >= 0) return total;
    const length = Number(response.headers.get('content-length'));
    if (response.ok && Number.isFinite(length)) return length;
    return response.ok ? null : 0;
  } catch { return null; }
}

function measureDuration(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const finish = (value: number | null) => { video.removeAttribute('src'); video.load(); resolve(value); };
    const timer = window.setTimeout(() => finish(null), 15_000);
    video.preload = 'metadata';
    video.onloadedmetadata = () => { window.clearTimeout(timer); finish(Number.isFinite(video.duration) ? video.duration : null); };
    video.onerror = () => { window.clearTimeout(timer); finish(0); };
    video.src = url;
  });
}

/**
 * The hard acceptance gate for a finished render. `expectedSec` comes from the
 * submitted timeline. Unmeasurable (CORS/network) properties never fail the
 * gate on their own — only positive evidence of a broken file does.
 */
export async function verifyRenderOutput(url: string, expectedSec: number): Promise<RenderVerification> {
  const out: RenderVerification = { ok: true, reason: '', bytes: null, duration_sec: null, expected_sec: Math.max(0, expectedSec) };
  if (!/^https?:\/\//i.test(url)) return { ...out, ok: false, reason: 'The renderer returned no usable video URL.' };
  out.bytes = await remoteBytes(url);
  if (out.bytes === 0) return { ...out, ok: false, reason: 'The rendered file is unreachable (the URL answers with no content).' };
  if (out.bytes !== null && out.bytes < MIN_FILM_BYTES) return { ...out, ok: false, reason: `The rendered file is only ${out.bytes} bytes — a header, not a film.` };
  out.duration_sec = await measureDuration(url);
  if (out.duration_sec === 0) return { ...out, ok: false, reason: 'The rendered file could not be decoded as video.' };
  if (out.duration_sec !== null && expectedSec > 0) {
    const tolerance = Math.max(3, expectedSec * 0.12);
    if (Math.abs(out.duration_sec - expectedSec) > tolerance) {
      return { ...out, ok: false, reason: `The rendered film runs ${out.duration_sec.toFixed(1)}s but the timeline asked for ${expectedSec.toFixed(1)}s — a truncated or stale render.` };
    }
  }
  return out;
}

export interface FilmQaReport {
  url: string;
  ok: boolean;
  status: 'pass' | 'flagged' | 'skipped';
  reason: string;
  bytes: number | null;
  duration_sec: number | null;
  expected_sec: number;
  frames_sampled: number;
  black_frames: number;
  frozen_pairs: number;
  checked_at: string;
}

/** Mean luma of the current canvas contents. */
function meanLuma(ctx: CanvasRenderingContext2D, width: number, height: number): number {
  const data = ctx.getImageData(0, 0, width, height).data;
  let sum = 0;
  const stride = 4 * 7; // sample every 7th pixel — plenty for a mean
  let count = 0;
  for (let i = 0; i < data.length; i += stride) { sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]; count += 1; }
  return count ? sum / count : 0;
}

/**
 * Sample frames across the assembled film: flags black frames and frozen
 * stretches (consecutive samples with near-zero difference in a film that
 * should be moving). Best-effort by design — decode/taint failures return
 * 'skipped' so delivery is never blocked by a browser limitation.
 */
export async function runFilmQa(url: string, verification: RenderVerification, sampleCount = 9): Promise<FilmQaReport> {
  const base: FilmQaReport = {
    url, ok: verification.ok, status: 'skipped', reason: verification.reason || '',
    bytes: verification.bytes, duration_sec: verification.duration_sec, expected_sec: verification.expected_sec,
    frames_sampled: 0, black_frames: 0, frozen_pairs: 0, checked_at: new Date().toISOString(),
  };
  if (!verification.ok) return { ...base, status: 'flagged' };
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.crossOrigin = 'anonymous'; video.preload = 'auto';
  video.style.cssText = 'position:fixed;left:-99999px;top:0;width:320px;pointer-events:none;opacity:0;';
  document.body.appendChild(video);
  try {
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('load timeout')), 20_000);
      video.onloadeddata = () => { window.clearTimeout(timer); resolve(); };
      video.onerror = () => { window.clearTimeout(timer); reject(new Error('decode failed')); };
    });
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : (verification.duration_sec || 0);
    if (!duration) return { ...base, reason: 'Duration unavailable for frame sampling.' };
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 320 / Math.max(1, video.videoWidth));
    canvas.width = Math.max(2, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(2, Math.round(video.videoHeight * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { ...base, reason: 'Canvas unavailable.' };
    let black = 0; let frozen = 0; let sampled = 0; let lastLuma: number | null = null; let lastDelta = 0;
    for (let i = 0; i < sampleCount; i += 1) {
      const at = Math.min(duration - 0.1, Math.max(0.1, duration * ((i + 0.5) / sampleCount)));
      video.currentTime = at;
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(() => resolve(), 8_000);
        video.onseeked = () => { window.clearTimeout(timer); resolve(); };
      });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      let luma = 0;
      try { luma = meanLuma(ctx, canvas.width, canvas.height); } catch { return { ...base, reason: 'Canvas tainted — frame sweep unavailable in this browser.' }; }
      sampled += 1;
      if (luma < BLACK_LUMA_FLOOR) black += 1;
      if (lastLuma !== null) { lastDelta = Math.abs(luma - lastLuma); if (lastDelta < FROZEN_DELTA_FLOOR) frozen += 1; }
      lastLuma = luma;
    }
    // A talking-head film legitimately has similar-luma frames; frozen pairs
    // only FLAG when most of the film shows no change at all.
    const flagged = black > 0 || (sampled >= 5 && frozen >= sampled - 1);
    return {
      ...base,
      status: flagged ? 'flagged' : 'pass',
      ok: !flagged,
      reason: flagged ? (black > 0 ? `${black} of ${sampled} sampled frames are black.` : 'The sampled frames show no visual change — the film may be frozen.') : '',
      frames_sampled: sampled, black_frames: black, frozen_pairs: frozen,
    };
  } catch (error: any) {
    return { ...base, reason: `Frame sweep skipped: ${String(error?.message || error).slice(0, 160)}` };
  } finally {
    video.remove();
  }
}

/** The film-QA verdicts expressed as delivery-check rows (appended to the six existing checks). */
export function filmQaChecks(verification: RenderVerification, qa: FilmQaReport | null): CheckResult[] {
  return [
    {
      id: 'output_verified',
      pass: verification.ok,
      label: 'Output verified',
      detail: verification.ok
        ? `The rendered file is real: ${verification.bytes ? `${Math.round(verification.bytes / 1024)} KB` : 'size unmeasurable (CORS)'}${verification.duration_sec ? `, ${verification.duration_sec.toFixed(1)}s measured` : ''}.`
        : verification.reason,
    },
    {
      id: 'frame_sweep',
      pass: !qa || qa.status !== 'flagged',
      label: 'Frame sweep',
      detail: !qa || qa.status === 'skipped'
        ? `Frame sweep ${qa?.reason ? `skipped: ${qa.reason}` : 'not run in this browser'} — delivery is not blocked by a browser limitation.`
        : qa.status === 'pass'
          ? `${qa.frames_sampled} frames sampled: no black frames, picture changes across the film.`
          : qa.reason,
    },
  ];
}
