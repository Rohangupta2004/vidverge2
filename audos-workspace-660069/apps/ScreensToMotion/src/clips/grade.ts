/**
 * Grade (Phase 2 §4). `"grade": "auto"` samples the clip's black point, white
 * point and mean saturation across its trim range, then applies the INVERSE
 * toward the UI layers — screenshots move toward the footage, never the other
 * way. Black point first, then saturation.
 *
 * Sampling is deterministic: 3 frames across the trim are extracted
 * server-side by ffmpeg (/api/video/frames), drawn to a canvas, and reduced to
 * { blackPoint, whitePoint, meanLuma, meanSat }. The derived video-wide UI
 * grade is stored on the plan (plan.uiGrade) so the render itself needs no
 * network work and stays reproducible.
 */
import type { ClipStats, IngestedClip, UiGradeSpec, VideoPlan, ClipSceneSpec } from '../types';

function lumaOf(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function satOf(r: number, g: number, b: number): number {
  const mx = Math.max(r, g, b) / 255;
  const mn = Math.min(r, g, b) / 255;
  if (mx === 0) return 0;
  return (mx - mn) / mx;
}

/** Reduce any drawable image source on a canvas to footage statistics. */
export function statsFromCanvas(canvas: HTMLCanvasElement): ClipStats | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  } catch {
    return null; // tainted canvas — caller falls back to a neutral grade
  }
  const lumas: number[] = [];
  let satSum = 0, lumaSum = 0, n = 0;
  const step = Math.max(4, Math.floor(data.length / 4 / 40000)) * 4;
  for (let i = 0; i < data.length; i += step) {
    const l = lumaOf(data[i], data[i + 1], data[i + 2]);
    lumas.push(l);
    lumaSum += l;
    satSum += satOf(data[i], data[i + 1], data[i + 2]);
    n++;
  }
  if (n < 100) return null;
  lumas.sort((a, b) => a - b);
  return {
    blackPoint: lumas[Math.floor(n * 0.02)],
    whitePoint: lumas[Math.floor(n * 0.98)],
    meanLuma: lumaSum / n,
    meanSat: satSum / n,
  };
}

async function loadImage(url: string): Promise<HTMLCanvasElement | null> {
  return await new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 480 / img.naturalWidth);
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(null);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas);
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Extract sample frames across the trim range via server-side ffmpeg. */
export async function extractFrames(clipUrl: string, timestamps: number[], workspaceId: string): Promise<Array<{ timestamp: number; url: string }>> {
  const response = await fetch('/api/video/frames', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoUrl: clipUrl, timestamps, workspaceId }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(body?.frames)) {
    throw new Error(body?.error || `Frames could not be extracted from the clip (${response.status}).`);
  }
  return body.frames;
}

/** Sample a clip's stats across its trim range (3 frames, averaged). */
export async function sampleClipStats(clip: IngestedClip, trim: [number, number], workspaceId: string): Promise<ClipStats | null> {
  const span = Math.max(0.2, trim[1] - trim[0]);
  const timestamps = [0.15, 0.5, 0.85].map((t) => Math.min(clip.durationSeconds - 0.05, trim[0] + span * t));
  let frames: Array<{ timestamp: number; url: string }>;
  try {
    frames = await extractFrames(clip.url, timestamps, workspaceId);
  } catch {
    return null;
  }
  const collected: ClipStats[] = [];
  for (const frame of frames) {
    const canvas = await loadImage(frame.url);
    const stats = canvas ? statsFromCanvas(canvas) : null;
    if (stats) collected.push(stats);
  }
  if (collected.length === 0) return null;
  const avg = (pick: (s: ClipStats) => number) => collected.reduce((a, s) => a + pick(s), 0) / collected.length;
  return { blackPoint: avg((s) => s.blackPoint), whitePoint: avg((s) => s.whitePoint), meanLuma: avg((s) => s.meanLuma), meanSat: avg((s) => s.meanSat) };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Derive the video-wide UI grade: map the screenshots' levels toward the
 * footage. Solving out(0)=blackF and out(1)=whiteF for CSS
 * `contrast(c) brightness(b)` gives b = blackF + whiteF and
 * c = (whiteF - blackF) / (whiteF + blackF); saturation follows at 60%
 * strength so interface pixels stay legible.
 */
export function deriveUiGrade(uiStats: ClipStats[], footageStats: ClipStats[]): UiGradeSpec | null {
  if (footageStats.length === 0) return null;
  const avg = (list: ClipStats[], pick: (s: ClipStats) => number) => list.reduce((a, s) => a + pick(s), 0) / list.length;
  const blackF = avg(footageStats, (s) => s.blackPoint);
  const whiteF = avg(footageStats, (s) => s.whitePoint);
  const satF = avg(footageStats, (s) => s.meanSat);
  const satU = uiStats.length ? avg(uiStats, (s) => s.meanSat) : satF;

  const brightness = clamp(blackF + whiteF, 0.9, 1.12);
  const contrast = clamp((whiteF - blackF) / Math.max(0.05, whiteF + blackF), 0.8, 1);
  const satTarget = satF / Math.max(0.05, satU);
  const saturate = clamp(1 + (satTarget - 1) * 0.6, 0.72, 1.15);
  return {
    brightness: Math.round(brightness * 1000) / 1000,
    contrast: Math.round(contrast * 1000) / 1000,
    saturate: Math.round(saturate * 1000) / 1000,
  };
}

/**
 * Post-plan grade + exposure pass: sample every auto-graded clip scene over
 * its planned trim, derive plan.uiGrade, and return per-scene mean luminance
 * for the exposure-dip resolver.
 */
export async function gradePlan(
  plan: VideoPlan,
  clipsById: Map<string, IngestedClip>,
  screenStatsById: Map<string, ClipStats>,
  workspaceId: string,
): Promise<Map<string, number>> {
  const lumaBySceneId = new Map<string, number>();
  const footageStats: ClipStats[] = [];
  for (const scene of plan.scenes) {
    if ((scene as ClipSceneSpec).kind === 'clip') {
      const clipScene = scene as ClipSceneSpec;
      const clip = clipsById.get(clipScene.src);
      if (!clip) continue;
      const stats = await sampleClipStats(clip, clipScene.trim, workspaceId);
      if (stats) {
        clip.stats = stats;
        lumaBySceneId.set(scene.id, stats.meanLuma);
        if (clipScene.grade === 'auto') footageStats.push(stats);
      }
    } else {
      const stats = screenStatsById.get((scene as any).screenId);
      if (stats) lumaBySceneId.set(scene.id, stats.meanLuma);
    }
  }
  plan.uiGrade = deriveUiGrade([...screenStatsById.values()], footageStats);
  return lumaBySceneId;
}
