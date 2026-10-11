/**
 * Tier 5 — generateVideo.
 *
 * The most expensive operation in the pipeline at roughly $0.40 a clip, and
 * never the default. By the time a beat reaches this function the visual plan
 * has already proved that it is one of the small number of beats where motion
 * itself carries the meaning, and that the film is still inside its budget.
 *
 * Gemini Omni Flash is the model: it is the one the platform proxy actually
 * serves reliably, it accepts reference images, and it caps at 8 seconds —
 * which is longer than any sane faceless beat anyway.
 */

import { FacelessError, type AspectId, type ResolvedAsset } from '../types/editorial';
import { callHook, sleep } from '../lib/platform';
import { aspectOf } from '../lib/facelessOptions';

const STAGE = 'assets' as const;

export const VIDEO_COST = 0.4;
export const VIDEO_MODEL = 'gemini-omni-flash-preview';
export const MAX_CLIP_SECONDS = 8;

const POLL_MS = 6000;
const MAX_WAIT_MS = 6 * 60 * 1000;

export interface GenerateVideoOptions {
  durationSeconds?: number;
  styleSuffix?: string;
  /** Landscape unless the brief asked for portrait. */
  aspect?: AspectId;
  /**
   * The outgoing frame of a match-cut source beat. Passing it is what makes
   * the two shots line up geometrically instead of merely being adjacent.
   */
  referenceImageUrl?: string;
  onProgress?: (percent: number) => void;
}

export async function generateVideo(prompt: string, options: GenerateVideoOptions = {}): Promise<string> {
  const text = [String(prompt || '').trim(), String(options.styleSuffix || '').trim(), 'No on-screen text or lettering.']
    .filter(Boolean)
    .join(' ')
    .slice(0, 1000);
  if (text.length < 12) {
    throw new FacelessError('A video prompt needs more than a few words.', STAGE, 'prompt_too_short');
  }

  const duration = Math.max(4, Math.min(MAX_CLIP_SECONDS, Math.ceil(options.durationSeconds || 5)));

  const submitted = await callHook<{ operationId?: string }>(
    'faceless-assets',
    {
      op: 'video_submit',
      model: VIDEO_MODEL,
      prompt: text,
      aspectRatio: aspectOf(options.aspect).providerRatio,
      duration,
      referenceImageUrl: options.referenceImageUrl || null,
    },
    STAGE,
  );
  const operationId = String(submitted.operationId || '');
  if (!operationId) {
    throw new FacelessError('The video model accepted the prompt but returned no operation id.', STAGE, 'no_operation');
  }

  const deadline = Date.now() + MAX_WAIT_MS;
  let misses = 0;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    let status: { status?: string; videoUrl?: string; progress?: number; errorMessage?: string };
    try {
      status = await callHook('faceless-assets', { op: 'video_status', operationId }, STAGE);
    } catch {
      misses += 1;
      if (misses >= 6) break;
      continue;
    }
    misses = 0;
    const state = String(status.status || '');
    if (state === 'completed' && status.videoUrl) return String(status.videoUrl);
    if (state === 'failed') {
      throw new FacelessError(
        `AI video generation failed: ${status.errorMessage || 'no reason given by the provider'}`,
        STAGE,
        'video_failed',
      );
    }
    if (typeof status.progress === 'number') options.onProgress?.(status.progress);
  }

  throw new FacelessError('AI video generation did not finish in time.', STAGE, 'video_timeout');
}

export async function generateVideoAsset(
  beatId: string,
  prompt: string,
  options: GenerateVideoOptions = {},
): Promise<ResolvedAsset> {
  const url = await generateVideo(prompt, options);
  const duration = Math.max(4, Math.min(MAX_CLIP_SECONDS, Math.ceil(options.durationSeconds || 5)));
  return { beatId, tier: 5, url, duration, type: 'video', cost: VIDEO_COST, provider: VIDEO_MODEL };
}
