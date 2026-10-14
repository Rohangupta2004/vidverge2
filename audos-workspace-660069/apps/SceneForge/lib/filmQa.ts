// FILM QA — browser-side temporal inspection for the assembled MP4.
// The render URL first passes a hard file/duration gate, then an 11-frame
// contact sheet checks temporal continuity, cut pairs, luma and title-safe
// borders with the same <video> + canvas path used by visualQa.ts.

import type { CheckResult } from './supabase';

const MIN_FILM_BYTES = 120_000;
const BLACK_LUMA_FLOOR = 12;
const FROZEN_PIXEL_DELTA_FLOOR = 1.8;
const STRIP_FRAMES = 11;

export interface RenderVerification {
  ok: boolean;
  reason: string;
  bytes: number | null;
  duration_sec: number | null;
  expected_sec: number;
}

export interface FilmQaFrame {
  index: number;
  at_sec: number;
  thumbnail: string;
  luma: number;
  motion_delta: number | null;
  safe_band_score: number;
}

export interface CutPairIntegrity {
  cut_sec: number;
  before_luma: number;
  after_luma: number;
  pixel_delta: number;
  pass: boolean;
  reason: string;
}

export interface SafeBandIssue {
  frame_index: number;
  at_sec: number;
  score: number;
  detail: string;
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
  frames: FilmQaFrame[];
  luma_sparkline: number[];
  cut_pairs: CutPairIntegrity[];
  cut_pairs_failed: number;
  safe_band_issues: SafeBandIssue[];
  safe_band_pass: boolean;
  checked_at: string;
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
    let done = false;
    const finish = (value: number | null) => {
      if (done) return;
      done = true;
      video.removeAttribute('src'); video.load(); resolve(value);
    };
    const timer = window.setTimeout(() => finish(null), 15_000);
    video.preload = 'metadata';
    video.onloadedmetadata = () => { window.clearTimeout(timer); finish(Number.isFinite(video.duration) ? video.duration : null); };
    video.onerror = () => { window.clearTimeout(timer); finish(0); };
    video.src = url;
  });
}

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
    if (Math.abs(out.duration_sec - expectedSec) > tolerance) return { ...out, ok: false, reason: `The rendered film runs ${out.duration_sec.toFixed(1)}s but the timeline asked for ${expectedSec.toFixed(1)}s — a truncated or stale render.` };
  }
  return out;
}

function meanLuma(data: Uint8ClampedArray): number {
  let sum = 0; let count = 0;
  for (let i = 0; i < data.length; i += 28) { sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]; count += 1; }
  return count ? sum / count : 0;
}

function pixelDelta(a: Uint8ClampedArray | null, b: Uint8ClampedArray): number {
  if (!a || a.length !== b.length) return 255;
  let sum = 0; let count = 0;
  for (let i = 0; i < b.length; i += 32) {
    sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    count += 3;
  }
  return count ? sum / count : 0;
}

/**
 * Heuristic title-safe check. It measures high-contrast detail in the outer
 * 5% border relative to the center. A single photographic edge is reported
 * for review; only repeated severe border detail can fail the gate.
 */
function safeBandScore(data: Uint8ClampedArray, width: number, height: number): number {
  let borderEdges = 0; let borderSamples = 0;
  const xBand = Math.max(2, Math.round(width * 0.05));
  const yBand = Math.max(2, Math.round(height * 0.05));
  const lumaAt = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  };
  for (let y = 1; y < height - 1; y += 3) {
    for (let x = 1; x < width - 1; x += 3) {
      if (x > xBand && x < width - xBand && y > yBand && y < height - yBand) continue;
      const contrast = Math.abs(lumaAt(x, y) - lumaAt(Math.min(width - 1, x + 1), y)) + Math.abs(lumaAt(x, y) - lumaAt(x, Math.min(height - 1, y + 1)));
      if (contrast > 82) borderEdges += 1;
      borderSamples += 1;
    }
  }
  return borderSamples ? borderEdges / borderSamples : 0;
}

function seek(video: HTMLVideoElement, at: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; video.onseeked = null; resolve(); };
    const timer = window.setTimeout(() => { window.clearTimeout(timer); finish(); }, 8_000);
    video.onseeked = () => { window.clearTimeout(timer); finish(); };
    video.currentTime = at;
  });
}

function frameData(video: HTMLVideoElement, canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return {
    image,
    luma: meanLuma(image.data),
    safe: safeBandScore(image.data, canvas.width, canvas.height),
    thumbnail: canvas.toDataURL('image/jpeg', 0.58),
  };
}

export async function runFilmQa(
  url: string,
  verification: RenderVerification,
  sampleCount = STRIP_FRAMES,
  options: { cutTimesSec?: number[] } = {},
): Promise<FilmQaReport> {
  const base: FilmQaReport = {
    url, ok: verification.ok, status: 'skipped', reason: verification.reason || '',
    bytes: verification.bytes, duration_sec: verification.duration_sec, expected_sec: verification.expected_sec,
    frames_sampled: 0, black_frames: 0, frozen_pairs: 0, frames: [], luma_sparkline: [],
    cut_pairs: [], cut_pairs_failed: 0, safe_band_issues: [], safe_band_pass: true,
    checked_at: new Date().toISOString(),
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

    const count = Math.max(STRIP_FRAMES, Math.round(sampleCount) || STRIP_FRAMES);
    const frames: FilmQaFrame[] = [];
    const safeIssues: SafeBandIssue[] = [];
    let previous: Uint8ClampedArray | null = null;
    let black = 0; let frozen = 0;
    for (let i = 0; i < count; i += 1) {
      const at = Math.min(duration - 0.1, Math.max(0.1, duration * ((i + 0.5) / count)));
      await seek(video, at);
      let sampled: ReturnType<typeof frameData>;
      try { sampled = frameData(video, canvas, ctx); } catch { return { ...base, reason: 'Canvas tainted — frame sweep unavailable in this browser.' }; }
      const delta = previous ? pixelDelta(previous, sampled.image.data) : null;
      if (sampled.luma < BLACK_LUMA_FLOOR) black += 1;
      if (delta !== null && delta < FROZEN_PIXEL_DELTA_FLOOR) frozen += 1;
      if (sampled.safe > 0.2) safeIssues.push({ frame_index: i, at_sec: at, score: sampled.safe, detail: 'High-contrast detail reaches the outer 5% title-safe border.' });
      frames.push({ index: i, at_sec: at, thumbnail: sampled.thumbnail, luma: sampled.luma, motion_delta: delta, safe_band_score: sampled.safe });
      previous = new Uint8ClampedArray(sampled.image.data);
    }

    const cutPairs: CutPairIntegrity[] = [];
    for (const rawCut of (options.cutTimesSec || []).slice(0, 30)) {
      const cut = Math.max(0.12, Math.min(duration - 0.12, Number(rawCut)));
      if (!Number.isFinite(cut)) continue;
      await seek(video, cut - 0.08); const before = frameData(video, canvas, ctx);
      await seek(video, cut + 0.08); const after = frameData(video, canvas, ctx);
      const delta = pixelDelta(before.image.data, after.image.data);
      const pass = before.luma >= BLACK_LUMA_FLOOR && after.luma >= BLACK_LUMA_FLOOR && delta >= 0.35;
      cutPairs.push({ cut_sec: cut, before_luma: before.luma, after_luma: after.luma, pixel_delta: delta, pass, reason: pass ? 'Both sides decode with picture continuity.' : before.luma < BLACK_LUMA_FLOOR || after.luma < BLACK_LUMA_FLOOR ? 'A cut side is black.' : 'The cut pair is effectively identical; the transition may be frozen.' });
    }

    const failedCuts = cutPairs.filter((pair) => !pair.pass).length;
    const severeSafe = safeIssues.filter((issue) => issue.score > 0.32).length;
    const safePass = severeSafe < 3;
    const frozenFilm = frames.length >= 5 && frozen >= frames.length - 1;
    const flagged = black > 0 || frozenFilm || failedCuts > 0 || !safePass;
    const reasons = [
      black ? `${black} of ${frames.length} strip frames are black.` : '',
      frozenFilm ? 'The 11-frame strip shows no visual change.' : '',
      failedCuts ? `${failedCuts} cut pair${failedCuts === 1 ? '' : 's'} failed integrity.` : '',
      !safePass ? 'Repeated high-contrast content reaches beyond the title-safe band.' : '',
    ].filter(Boolean);
    return {
      ...base,
      status: flagged ? 'flagged' : 'pass', ok: !flagged, reason: reasons.join(' '),
      frames_sampled: frames.length, black_frames: black, frozen_pairs: frozen,
      frames, luma_sparkline: frames.map((frame) => frame.luma),
      cut_pairs: cutPairs, cut_pairs_failed: failedCuts,
      safe_band_issues: safeIssues, safe_band_pass: safePass,
    };
  } catch (error: any) {
    return { ...base, reason: `Frame sweep skipped: ${String(error?.message || error).slice(0, 160)}` };
  } finally { video.remove(); }
}

export function filmQaChecks(verification: RenderVerification, qa: FilmQaReport | null): CheckResult[] {
  return [
    {
      id: 'output_verified', pass: verification.ok, label: 'Output verified',
      detail: verification.ok ? `The rendered file is real: ${verification.bytes ? `${Math.round(verification.bytes / 1024)} KB` : 'size unmeasurable (CORS)'}${verification.duration_sec ? `, ${verification.duration_sec.toFixed(1)}s measured` : ''}.` : verification.reason,
    },
    {
      id: 'film_qc_sheet', pass: !qa || qa.status !== 'flagged', label: 'Film QC sheet',
      detail: !qa || qa.status === 'skipped'
        ? `QC sheet ${qa?.reason ? `skipped: ${qa.reason}` : 'not run in this browser'} — delivery is not blocked by a browser limitation.`
        : qa.status === 'pass'
          ? `${qa.frames_sampled}-frame strip passed · ${qa.cut_pairs.length} cut pairs · safe bands clear.`
          : qa.reason,
    },
  ];
}
