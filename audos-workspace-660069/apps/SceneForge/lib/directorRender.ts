// THE RENDER BRIDGE — submit the generated composition to the platform's
// Remotion service and follow it to an MP4.
//
// Nothing is rendered in the browser. canvas.captureStream() cannot reliably
// produce MP4 and would be a lie to call an export; the finished file always
// comes back from the render service.
import { WORKSPACE_ID } from './supabase';
import { sleep } from './proxy';
import { buildCompositionProps, compositionDurationInFrames, createSceneForgeSource, FPS, FRAME_H, FRAME_W, MAX_FRAMES } from '../remotion/sceneForgeComposition';
import type { SceneSpec } from './sceneSpec';

export class RenderError extends Error {
  code: string;
  constructor(message: string, code = 'render_failed') {
    super(message);
    this.name = 'RenderError';
    this.code = code;
  }
}

export interface RenderRequest {
  specs: SceneSpec[];
  avatarVideoUrl?: string;
  accent?: string;
}

export interface RenderJob {
  operationId: string;
  durationInFrames: number;
}

/** Longest film this endpoint can take, in seconds, at the fixed 30 fps. */
export const MAX_FILM_SECONDS = MAX_FRAMES / FPS;

export async function submitDirectorRender(request: RenderRequest): Promise<RenderJob> {
  const specs = request.specs || [];
  if (!specs.length) throw new RenderError('There is no scene plan to render yet.', 'no_plan');
  const durationInFrames = compositionDurationInFrames(specs, FPS);
  const props = buildCompositionProps({ specs, avatarVideoUrl: request.avatarVideoUrl, accent: request.accent, fps: FPS });
  const compositionTsx = createSceneForgeSource(durationInFrames);

  let response: Response;
  try {
    response = await fetch('/api/render/remotion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: WORKSPACE_ID,
        compositionTsx,
        props,
        durationInFrames,
        // The service renders at a fixed geometry; sending anything else is
        // rejected, so these are sent exactly as documented.
        fps: FPS,
        width: FRAME_W,
        height: FRAME_H,
      }),
    });
  } catch (e: any) {
    throw new RenderError(`The render service could not be reached: ${String(e?.message || e)}`, 'network');
  }

  const payload = await response.json().catch(() => ({} as any));
  if (!response.ok || !payload?.operationId) {
    const detail = payload?.error || payload?.message || `HTTP ${response.status}`;
    if (response.status === 402) throw new RenderError('The workspace wallet is too low to run this render. Top it up and try again.', 'insufficient_funds');
    throw new RenderError(`The render was not accepted: ${String(detail).slice(0, 240)}`, 'rejected');
  }
  return { operationId: String(payload.operationId), durationInFrames };
}

export interface RenderProgress {
  status: 'pending' | 'rendering' | 'complete' | 'failed';
  videoUrl?: string;
  error?: string;
}

export async function checkDirectorRender(operationId: string): Promise<RenderProgress> {
  const response = await fetch(`/api/render/remotion/${encodeURIComponent(operationId)}`);
  const payload = await response.json().catch(() => ({} as any));
  if (!response.ok) return { status: 'rendering', error: String(payload?.error || `status HTTP ${response.status}`) };
  const status = String(payload?.status || 'pending');
  if (status === 'complete' && payload?.videoUrl) return { status: 'complete', videoUrl: String(payload.videoUrl) };
  if (status === 'failed') return { status: 'failed', error: String(payload?.error || 'The render failed.') };
  return { status: status === 'rendering' ? 'rendering' : 'pending' };
}

export interface PollOptions {
  onProgress?: (elapsedSec: number, status: string) => void;
  timeoutMs?: number;
  isCancelled?: () => boolean;
}

/**
 * Follow a render to its MP4. A status read that fails is tolerated a few
 * times before giving up — a dropped poll is not a dead render, and the file
 * is durable on storage once it lands.
 */
export async function pollDirectorRender(operationId: string, options: PollOptions = {}): Promise<string> {
  const started = Date.now();
  const deadline = started + (options.timeoutMs || 15 * 60 * 1000);
  let misses = 0;
  while (Date.now() < deadline) {
    if (options.isCancelled?.()) throw new RenderError('The render was cancelled. It may still finish on the server.', 'cancelled');
    const progress = await checkDirectorRender(operationId);
    if (progress.status === 'complete' && progress.videoUrl) return progress.videoUrl;
    if (progress.status === 'failed') throw new RenderError(progress.error || 'The render failed.', 'render_failed');
    if (progress.error) {
      misses += 1;
      if (misses >= 8) throw new RenderError(`The render service stopped answering: ${progress.error}`, 'poll_lost');
    } else {
      misses = 0;
    }
    options.onProgress?.(Math.round((Date.now() - started) / 1000), progress.status);
    await sleep(3000);
  }
  throw new RenderError('The render is taking unusually long. It may still finish — check back before resubmitting.', 'timeout');
}

/** The exact TSX the render farm will compile. Shown in the UI for inspection. */
export function previewSource(specs: SceneSpec[]): string {
  return createSceneForgeSource(compositionDurationInFrames(specs, FPS));
}
