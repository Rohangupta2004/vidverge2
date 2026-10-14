/**
 * RUNWAY COMPATIBILITY LAYER — Audos native API only.
 *
 * Older VidVerge modules import Recipe ids and runRecipe from this path. The
 * implementation delegates to lib/runway.ts, which calls the authenticated
 * /api/generate/runway/* integration. No browser code calls api.runwayml.com,
 * reads a founder-owned secret, or constructs an Authorization header.
 */

import {
  runwayPoll,
  runwaySubmitRecipe,
} from '../../../lib/runway';
import type { RunwayRecipeId as NativeRunwayRecipeId } from '../../../lib/runway';

export const RUNWAY_HOST = 'api.runwayml.com';
export const RUNWAY_API_BASE = '/api/generate/runway';
export const RUNWAY_VERSION = 'platform-managed';
export const RUNWAY_SECRET_NAME = 'Audos native Runway integration';

export const RECIPE_MULTI_SHOT = 'multi_shot_video';
export const RECIPE_PRODUCT_UGC = 'product_ugc';
export const RECIPE_PRODUCT_AD = 'product_ad';
export const RECIPE_PRODUCT_SWAP = 'product_swap';
export const RECIPE_AD_LOCALIZATION = 'ad_localization';
export const RECIPE_MARKETING_STOCK_IMAGE = 'marketing_stock_image';
export const RECIPE_PRODUCT_CAMPAIGN_IMAGE = 'product_campaign_image';

export type RunwayRecipeId =
  | typeof RECIPE_MULTI_SHOT
  | typeof RECIPE_PRODUCT_UGC
  | typeof RECIPE_PRODUCT_AD
  | typeof RECIPE_PRODUCT_SWAP
  | typeof RECIPE_AD_LOCALIZATION
  | typeof RECIPE_MARKETING_STOCK_IMAGE
  | typeof RECIPE_PRODUCT_CAMPAIGN_IMAGE;

export const EMPTY_RESULT_MESSAGE = 'Runway returned an empty result — please try again';

export class RunwayError extends Error {
  code: string;
  constructor(message: string, code = 'runway_error') {
    super(message);
    this.name = 'RunwayError';
    this.code = code;
  }
}

/** Direct provider requests are deliberately refused from workspace code. */
export async function proxyGet(_url: string): Promise<any> {
  throw new RunwayError(
    'Direct Runway provider requests are disabled. Use the Audos native Runway status API.',
    'native_api_required',
  );
}

/** Direct provider requests are deliberately refused from workspace code. */
export async function proxyPost(_url: string, _json: Record<string, unknown>): Promise<any> {
  throw new RunwayError(
    'Direct Runway provider requests are disabled. Use the Audos native Runway generation API.',
    'native_api_required',
  );
}

/** Submit one Recipe through Audos' wallet-authenticated native endpoint. */
export async function startRecipe(
  recipeId: RunwayRecipeId,
  payload: Record<string, unknown>,
): Promise<{ taskId: string }> {
  try {
    const submission = await runwaySubmitRecipe(recipeId as NativeRunwayRecipeId, payload);
    return { taskId: submission.taskId };
  } catch (error: any) {
    throw new RunwayError(String(error?.message || error), String(error?.code || 'native_submit_failed'));
  }
}

export interface PollTaskOptions {
  onProgress?: (message: string) => void;
  isCancelled: () => boolean;
  timeoutMs?: number;
}

/** Watch an Audos-owned task. Stopping the watch never cancels provider work. */
export async function pollTask(
  taskId: string,
  opts: PollTaskOptions,
): Promise<{ outputUrls: string[] }> {
  const signal = { cancelled: false };
  const stopTimer = window.setInterval(() => {
    if (opts.isCancelled()) signal.cancelled = true;
  }, 500);
  try {
    const result = await runwayPoll(taskId, {
      signal,
      maxMs: opts.timeoutMs ?? 45 * 60 * 1000,
      onStatus: (status) => opts.onProgress?.(statusMessage(status)),
    });
    if (!result.mediaUrls.length) throw new RunwayError(EMPTY_RESULT_MESSAGE, 'no_output');
    return { outputUrls: result.mediaUrls };
  } catch (error: any) {
    if (signal.cancelled) {
      throw new RunwayError(
        'Stopped watching. The Audos Runway task continues safely; do not submit a duplicate.',
        'stopped_watching',
      );
    }
    throw new RunwayError(String(error?.message || error), String(error?.code || 'native_poll_failed'));
  } finally {
    window.clearInterval(stopTimer);
  }
}

function statusMessage(status: string): string {
  switch (status) {
    case 'admitting': return 'Checking the workspace wallet…';
    case 'charged': return 'Credits reserved — handing the task to Runway…';
    case 'submitting': return 'Submitting through Audos…';
    case 'queued': return 'Waiting in Runway’s queue…';
    case 'running': return 'Generating…';
    case 'throttled': return 'Waiting for a Runway slot…';
    case 'persisting': return 'Saving durable media…';
    case 'uncertain': return 'Reconciling the existing task — nothing is being resubmitted…';
    default: return status ? `${status}…` : 'Working…';
  }
}

/** Submit and watch through Audos native Runway in one compatibility call. */
export async function runRecipe(
  recipeId: RunwayRecipeId,
  payload: Record<string, unknown>,
  opts: PollTaskOptions,
): Promise<string[]> {
  const { taskId } = await startRecipe(recipeId, payload);
  opts.onProgress?.('Submitted through Audos — waiting for Runway…');
  const result = await pollTask(taskId, opts);
  return result.outputUrls;
}
