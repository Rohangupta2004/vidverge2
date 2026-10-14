/**
 * THE RENDER BRIDGE — one TSX string in, one MP4 URL out.
 *
 * The platform's Remotion service compiles a STANDALONE composition string: it
 * cannot import anything from this workspace, which is why every composition
 * in this app is assembled as source text rather than written as a module.
 *
 * GEOMETRY IS FIXED. The service renders at 1920x1080 / 30fps and rejects any
 * other `fps` / `width` / `height`. A portrait pipeline therefore lays out a
 * 1080x1920 canvas inside the composition and scales it into the frame — the
 * same approach the other VidVerge studios use — rather than asking the
 * service for a geometry it will refuse.
 */

import { GENERATION_TIMEOUT_MS, isAbortError, sleep, STATUS_TIMEOUT_MS, timeoutSignal, WORKSPACE_ID } from './runtime';

/** The service's fixed output. Sent exactly as documented. */
export const FPS = 30;
export const FRAME_W = 1920;
export const FRAME_H = 1080;

/** The logical portrait canvas Pipeline A composes against before scaling. */
export const PORTRAIT_W = 1080;
export const PORTRAIT_H = 1920;

/** 1..18000 frames — ten minutes at 30fps. */
export const MAX_FRAMES = 18_000;

export class RenderError extends Error {
  code: string;
  constructor(message: string, code = 'render_failed') {
    super(message);
    this.name = 'RenderError';
    this.code = code;
  }
}

export function clampFrames(frames: number): number {
  return Math.max(30, Math.min(MAX_FRAMES, Math.round(frames) || FPS));
}

export function secondsToFrames(seconds: number): number {
  return Math.max(1, Math.round(seconds * FPS));
}

export interface RenderSubmission {
  compositionTsx: string;
  props: Record<string, unknown>;
  durationInFrames: number;
}

export async function submitRender(submission: RenderSubmission): Promise<string> {
  const durationInFrames = clampFrames(submission.durationInFrames);

  let response: Response;
  try {
    response = await fetch('/api/render/remotion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: WORKSPACE_ID,
        compositionTsx: submission.compositionTsx,
        props: submission.props,
        durationInFrames,
        fps: FPS,
        width: FRAME_W,
        height: FRAME_H,
      }),
      signal: timeoutSignal(GENERATION_TIMEOUT_MS),
    });
  } catch (error: any) {
    if (isAbortError(error)) {
      throw new RenderError(
        'The render service did not accept the job within 2 minutes. Try again.',
        'timeout',
      );
    }
    throw new RenderError(
      `The render service could not be reached: ${String(error?.message || error)}`,
      'network',
    );
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.operationId) {
    if (response.status === 402) {
      throw new RenderError(
        'The workspace wallet is too low to render this video. Top it up and run the job again.',
        'insufficient_funds',
      );
    }
    const detail = payload?.error || payload?.message || `HTTP ${response.status}`;
    throw new RenderError(`The render was not accepted: ${String(detail).slice(0, 240)}`, 'rejected');
  }
  return String(payload.operationId);
}

export interface RenderProgress {
  status: 'pending' | 'rendering' | 'complete' | 'failed';
  videoUrl?: string;
  error?: string;
}

export async function checkRender(operationId: string): Promise<RenderProgress> {
  let response: Response;
  try {
    response = await fetch(`/api/render/remotion/${encodeURIComponent(operationId)}`, {
      signal: timeoutSignal(STATUS_TIMEOUT_MS),
    });
  } catch (error: any) {
    // A dropped or hung status read must neither hang the poll past its
    // deadline nor kill it outright — pollRender's miss counter decides.
    return {
      status: 'rendering',
      error: isAbortError(error) ? 'The status check timed out after 30s.' : String(error?.message || error),
    };
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return { status: 'rendering', error: String(payload?.error || `status HTTP ${response.status}`) };
  }
  const status = String(payload?.status || 'pending');
  if (status === 'complete' && payload?.videoUrl) {
    return { status: 'complete', videoUrl: String(payload.videoUrl) };
  }
  if (status === 'failed') {
    return { status: 'failed', error: String(payload?.error || 'The render failed.') };
  }
  return { status: status === 'rendering' ? 'rendering' : 'pending' };
}

export interface PollOptions {
  onProgress?: (elapsedSeconds: number) => void;
  timeoutMs?: number;
  isCancelled?: () => boolean;
}

/**
 * Follow a render to its MP4. A status read that fails is tolerated several
 * times before giving up: a dropped poll is not a dead render, and the file is
 * durable on storage the moment it lands.
 */
export async function pollRender(operationId: string, options: PollOptions = {}): Promise<string> {
  const started = Date.now();
  const deadline = started + (options.timeoutMs || 15 * 60 * 1000);
  let misses = 0;
  while (Date.now() < deadline) {
    if (options.isCancelled?.()) {
      throw new RenderError('The render was cancelled. It may still finish on the server.', 'cancelled');
    }
    const progress = await checkRender(operationId);
    if (progress.status === 'complete' && progress.videoUrl) return progress.videoUrl;
    if (progress.status === 'failed') {
      throw new RenderError(progress.error || 'The render failed.', 'render_failed');
    }
    if (progress.error) {
      misses += 1;
      if (misses >= 8) {
        throw new RenderError(`The render service stopped answering: ${progress.error}`, 'poll_lost');
      }
    } else {
      misses = 0;
    }
    options.onProgress?.(Math.round((Date.now() - started) / 1000));
    await sleep(3000);
  }
  throw new RenderError(
    'The render is taking unusually long. It may still finish — check back before resubmitting.',
    'timeout',
  );
}

/** Submit and follow in one call. */
export async function renderToMp4(
  submission: RenderSubmission,
  options: PollOptions = {},
): Promise<string> {
  const operationId = await submitRender(submission);
  return pollRender(operationId, options);
}
