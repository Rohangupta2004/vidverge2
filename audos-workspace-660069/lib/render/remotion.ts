/**
 * The ONLY caller of /api/render/remotion in this codebase.
 *
 * Everything else goes through `submitRender` / `renderToMp4`, or through the
 * `vv-render-job` server function when the render must survive a closed tab.
 *
 * ## The geometry problem, and why this file exists
 *
 * The platform render service is pinned to **30 fps at 1920x1080**. Sending any
 * other fps/width/height is rejected. Portrait output is produced in two steps,
 * the technique proved by the retired `sve-render` hook:
 *
 *   1. Render 1920x1080 with the composition's real design stage (1080x1920)
 *      scaled and centred inside the landscape frame.
 *   2. Pass that master through `POST /api/workspaces/:id/videos/overlay` at
 *      1080x1920 with no overlays. That endpoint cover-crops, so it lifts the
 *      centred vertical column out and rescales it to a true portrait file with
 *      no pillarbox.
 *
 * `STAGE` below gives a composition the real pixel box it should lay out in,
 * and `stageTransform` gives the wrapper that fits that box into the 1920x1080
 * frame. A composition built on `lib/remotion-kit` gets both for free.
 */

import { WORKSPACE_ID } from '../workspace';
import { poll } from '../poll';

export type Aspect = '9:16' | '16:9' | '1:1';

/** The platform render frame. Not configurable — the service rejects anything else. */
export const RENDER_FRAME = { width: 1920, height: 1080, fps: 30 } as const;

/** The real design box for each aspect, in output pixels. */
export const STAGE: Record<Aspect, { width: number; height: number }> = {
  '9:16': { width: 1080, height: 1920 },
  '16:9': { width: 1920, height: 1080 },
  '1:1': { width: 1080, height: 1080 },
};

/** Final delivered file size for each aspect. */
export function outputSize(aspect: Aspect): { width: number; height: number } {
  // 16:9 ships as the native render. 9:16 and 1:1 both ship through the
  // portrait finisher, which only accepts 1080x1920 — a square stage is
  // centred inside that frame rather than silently delivered as landscape.
  return aspect === '16:9' ? { width: 1920, height: 1080 } : { width: 1080, height: 1920 };
}

/** True when the render needs the portrait finishing pass. */
export function needsPortraitFinish(aspect: Aspect): boolean {
  return aspect !== '16:9';
}

/**
 * CSS that fits an aspect's design stage into the fixed 1920x1080 render frame.
 * Wrap the composition's root in a div carrying this.
 */
export function stageTransform(aspect: Aspect): Record<string, string | number> {
  const stage = STAGE[aspect];
  const scale = Math.min(RENDER_FRAME.width / stage.width, RENDER_FRAME.height / stage.height);
  return {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: `${stage.width}px`,
    height: `${stage.height}px`,
    transform: `translate(-50%, -50%) scale(${scale})`,
    transformOrigin: 'center center',
    overflow: 'hidden',
  };
}

export function framesFor(seconds: number, fps = RENDER_FRAME.fps): number {
  return Math.max(1, Math.min(18_000, Math.round(seconds * fps)));
}

export interface RenderRequest {
  compositionTsx: string;
  props?: Record<string, unknown>;
  /** Length in frames. Supply this or `durationSeconds`. */
  durationInFrames?: number;
  durationSeconds?: number;
  /** Accepted and normalised — the service only runs at 30. */
  fps?: number;
  aspect: Aspect;
  /** Optional music bed mixed in during the portrait finish. */
  musicUrl?: string;
  musicVolume?: number;
}

export interface RenderResult {
  status: 'complete';
  videoUrl: string;
  operationId: string;
  aspect: Aspect;
  width: number;
  height: number;
  durationInFrames: number;
  /** True when the portrait finishing pass ran. */
  portraitFinished: boolean;
}

export class RenderError extends Error {
  stage: 'submit' | 'poll' | 'finish';
  operationId?: string;
  constructor(message: string, stage: RenderError['stage'], operationId?: string) {
    super(message);
    this.name = 'RenderError';
    this.stage = stage;
    this.operationId = operationId;
  }
}

function authHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = token || (typeof window !== 'undefined' ? String(window.__workspaceDb?.token || '') : '');
  if (t) headers['X-Workspace-DB-Token'] = t;
  return headers;
}

/**
 * Status shapes differ across the render service and its callers, so both
 * spellings of "done" and all three spellings of the URL field are accepted.
 * Normalising here is the whole point of having one caller.
 */
export function normalizeStatus(body: any): {
  state: 'pending' | 'rendering' | 'complete' | 'failed';
  videoUrl: string;
  error: string;
} {
  const raw = String(body?.status || '').toLowerCase();
  const videoUrl = String(body?.videoUrl || body?.video_url || body?.downloadUrl || body?.renderUrl || '');
  const error = String(body?.error || body?.errorMessage || '');
  if (raw === 'complete' || raw === 'completed' || raw === 'done' || raw === 'succeeded') {
    return { state: 'complete', videoUrl, error };
  }
  if (raw === 'failed' || raw === 'error') return { state: 'failed', videoUrl, error: error || 'The render failed.' };
  if (raw === 'rendering' || raw === 'processing' || raw === 'running') return { state: 'rendering', videoUrl, error };
  return { state: 'pending', videoUrl, error };
}

/** Submit a render and return its operation id. Does not wait. */
export async function submitRender(request: RenderRequest, token?: string): Promise<{ operationId: string; durationInFrames: number }> {
  const durationInFrames =
    request.durationInFrames ?? framesFor(request.durationSeconds ?? 10, RENDER_FRAME.fps);

  const res = await fetch('/api/render/remotion', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      workspaceId: WORKSPACE_ID,
      compositionTsx: request.compositionTsx,
      props: { ...(request.props || {}), aspect: request.aspect },
      durationInFrames,
      fps: RENDER_FRAME.fps,
      width: RENDER_FRAME.width,
      height: RENDER_FRAME.height,
    }),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.operationId) {
    throw new RenderError(String(body?.error || `The render service refused the job (HTTP ${res.status}).`), 'submit');
  }
  return { operationId: String(body.operationId), durationInFrames };
}

/** Read one render's status. */
export async function readRender(operationId: string) {
  const res = await fetch(`/api/render/remotion/${encodeURIComponent(operationId)}`);
  return normalizeStatus(await res.json().catch(() => null));
}

/**
 * Turn a finished 1920x1080 master into a true 1080x1920 portrait file, and
 * mix the music bed while we are re-encoding anyway.
 */
export async function finishPortrait(
  masterUrl: string,
  options: { musicUrl?: string; musicVolume?: number; durationSeconds?: number } = {},
  token?: string,
): Promise<string> {
  const res = await fetch(`/api/workspaces/${WORKSPACE_ID}/videos/overlay`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      base_video_url: masterUrl,
      overlays: [],
      dimensions: { width: 1080, height: 1920 },
      output_format: 'mp4',
      ...(options.durationSeconds ? { duration_seconds: options.durationSeconds } : {}),
      ...(options.musicUrl ? { music_url: options.musicUrl, music_volume: options.musicVolume ?? 0.2 } : {}),
    }),
  });
  const body = await res.json().catch(() => null);
  if (!body?.success || !body?.overlayUrl) {
    throw new RenderError(String(body?.error || `Portrait conversion failed (HTTP ${res.status}).`), 'finish');
  }
  return String(body.overlayUrl);
}

/**
 * Submit, wait, and deliver a playable MP4 at the requested aspect.
 *
 * Use this only when a person is watching. For anything that must finish with
 * the tab closed, create a `vv-render-job` row instead and watch that row.
 */
export async function renderToMp4(request: RenderRequest, options: { token?: string; signal?: AbortSignal } = {}): Promise<RenderResult> {
  const { operationId, durationInFrames } = await submitRender(request, options.token);

  const final = await poll(() => readRender(operationId), {
    interval: 4_000,
    timeout: 15 * 60 * 1_000,
    backoff: 1.15,
    maxInterval: 15_000,
    signal: options.signal,
    until: (s) => s.state === 'complete' || s.state === 'failed',
  });

  if (final.state === 'failed' || !final.videoUrl) {
    throw new RenderError(final.error || 'The render finished without producing a video.', 'poll', operationId);
  }

  let videoUrl = final.videoUrl;
  let portraitFinished = false;
  if (needsPortraitFinish(request.aspect)) {
    videoUrl = await finishPortrait(
      videoUrl,
      {
        musicUrl: request.musicUrl,
        musicVolume: request.musicVolume,
        durationSeconds: durationInFrames / RENDER_FRAME.fps,
      },
      options.token,
    );
    portraitFinished = true;
  }

  const size = outputSize(request.aspect);
  return {
    status: 'complete',
    videoUrl,
    operationId,
    aspect: request.aspect,
    width: size.width,
    height: size.height,
    durationInFrames,
    portraitFinished,
  };
}
