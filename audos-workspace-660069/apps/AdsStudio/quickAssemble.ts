/**
 * ADS STUDIO — SERVER-SIDE FFMPEG PIPELINE (quick assembly).
 *
 * The browser FFmpeg.wasm path in assemble.ts is what burns the GSAP overlay
 * layer and the captions into the ad, and it stays the path that produces the
 * final deliverable. What it is not is fast: it downloads every clip into a
 * wasm heap and re-encodes them in the tab.
 *
 * This module is the quick path — the platform's own ffmpeg does the work:
 *
 *   POST /api/workspaces/:workspaceId/videos/stitch  → { stitchedUrl }
 *   POST /api/video/clip                             → { url, durationSec }
 *   POST /api/video/frames                           → { frames: [{url}] }
 *
 * THE ONE HARD CONSTRAINT: /videos/stitch NORMALIZES ITS OUTPUT TO 1280×720
 * AT 30 FPS. That is stated in integrations/video-overlay/docs.md and in
 * integrations/heygen-video/docs.md ("do not use it for a portrait export");
 * integrations/video-stitch/docs.md itself only says "clips are normalized
 * then concatenated" and never names the geometry, which is exactly how a
 * 9:16 ad ends up silently landscape.
 *
 * So the quick path is offered ONLY for a 16:9 ad, where 1280×720 happens to
 * be precisely the frame size assemble.ts already targets. A 9:16 or 1:1 ad
 * goes to the browser assembler, which is the only path that keeps its shape.
 * canQuickAssemble() is the single place that decision is made.
 */

import { workspaceUuid, wsToken } from './api';

/** The geometry POST /videos/stitch always emits. */
export const SERVER_STITCH_SIZE = { W: 1280, H: 720 } as const;

export interface QuickAssemblyVerdict {
  ok: boolean;
  /** Why the quick path is or is not usable — shown in the UI verbatim. */
  reason: string;
}

/**
 * The quick server path is only honest for a 16:9 ad with at least two clips.
 * Everything else is told why, rather than being handed a reshaped video.
 */
export function canQuickAssemble(aspect: '9:16' | '16:9' | '1:1', clipCount: number): QuickAssemblyVerdict {
  if (clipCount < 2) {
    return { ok: false, reason: 'Server-side stitching needs at least two finished clips.' };
  }
  if (aspect !== '16:9') {
    return {
      ok: false,
      reason: `The platform stitcher always writes ${SERVER_STITCH_SIZE.W}×${SERVER_STITCH_SIZE.H} landscape, so a ${aspect} ad is assembled in your browser instead — that path keeps the vertical frame and burns in the overlays and captions.`,
    };
  }
  return { ok: true, reason: '' };
}

function jsonHeaders(): Record<string, string> {
  const token = wsToken();
  return { 'Content-Type': 'application/json', ...(token ? { 'X-Workspace-DB-Token': token } : {}) };
}

async function postJson(path: string, body: Record<string, unknown>): Promise<any> {
  let res: Response;
  try {
    res = await fetch(path, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(body) });
  } catch (e: any) {
    throw new Error(`Could not reach the video service: ${String(e?.message || e)}`);
  }
  const data = await res.json().catch(() => null);
  if (res.status === 402) throw new Error('The workspace wallet balance is too low for this render. Top up the wallet, then retry.');
  if (!res.ok || data?.success === false) {
    throw new Error(String(data?.error || `The video service answered HTTP ${res.status}.`));
  }
  return data;
}

/**
 * Concatenate finished clips server-side. Clips that never rendered are
 * skipped by the caller — a failed scene must never block the whole ad.
 */
export async function stitchClips(videoUrls: string[], onNote?: (n: string) => void): Promise<string> {
  const urls = videoUrls.filter((u) => typeof u === 'string' && /^https?:\/\//.test(u));
  if (urls.length < 2) throw new Error('At least two finished clips are needed to stitch.');
  onNote?.('⚡ Assembling clips with FFmpeg…');
  const data = await postJson(`/api/workspaces/${workspaceUuid()}/videos/stitch`, { videoUrls: urls });
  const url = String(data?.stitchedUrl || data?.video?.videoUrl || '');
  if (!url) throw new Error('The stitcher reported success without returning a video URL.');
  return url;
}

/** Trim an assembled ad down to the founder's target duration. */
export async function trimToDuration(videoUrl: string, endSec: number, onNote?: (n: string) => void): Promise<string> {
  const end = Number(endSec);
  if (!Number.isFinite(end) || end <= 0) return videoUrl;
  onNote?.(`⚡ Trimming to ${Math.round(end)}s with FFmpeg…`);
  const data = await postJson('/api/video/clip', {
    videoUrl,
    startSec: 0,
    endSec: end,
    workspaceId: workspaceUuid(),
  });
  return String(data?.url || videoUrl);
}

/**
 * Lift a still frame out of a clip server-side. This is how the style
 * reference for every later scene is taken from scene 1 — real pixels, no
 * vision model, and no CORS-tainted canvas in the tab.
 */
export async function extractFrameUrl(videoUrl: string, atSeconds = 0.5): Promise<string> {
  const data = await postJson('/api/video/frames', {
    videoUrl,
    timestamps: [Math.max(0, Number(atSeconds) || 0.5)],
    workspaceId: workspaceUuid(),
  });
  const frames = Array.isArray(data?.frames) ? data.frames : [];
  const url = String(frames[0]?.url || '');
  if (!url) throw new Error('Frame extraction returned no image.');
  return url;
}

/** Wall-clock label for the "Generated in {seconds}s" footer. */
export function elapsedSeconds(startedAt: number | null, finishedAt: number | null): number | null {
  if (!startedAt || !finishedAt || finishedAt < startedAt) return null;
  return Math.max(1, Math.round((finishedAt - startedAt) / 1000));
}
