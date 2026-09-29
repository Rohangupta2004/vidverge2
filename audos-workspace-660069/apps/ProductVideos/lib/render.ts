// Product Videos — rendering entry point.
//
// REWIRED (Sep 26 2026): rendering no longer starts from the browser at all.
// The old client-side path — the tab submitting composition TSX to
// POST /api/render/remotion and polling the operation itself — is gone; a
// closed tab used to strand that flow mid-poll. Submitting a URL now queues
// the WHOLE production (scrape → script → voiceover → timestamps → Veo
// backdrop → Remotion render → MP4 on GCS) on the pv-ad-director server
// function via lib/renderJob.ts, and the browser only ever READS the
// pv_projects row afterwards. The render service geometry is unchanged:
// 30fps, 1920x1080, fixed.
//
// Everything exported here delegates to renderJob.ts — this module stays as
// the app's stable "start a render" surface.

import type { AdProductSummary } from './director';
import {
  isAdJobDone,
  isAdJobFailed,
  readAdProject,
  retryAdJob,
  startAdJob,
  type AdProjectRow,
} from './renderJob';

/**
 * Queue the server-side URL→MP4 production. Returns the pv_projects id the
 * studio polls. The customer can close the tab the moment this resolves.
 * `stylePreset` picks the art direction the Remotion coding agent codes from
 * ('auto' lets the director choose); a REAL screenshot must be on the summary.
 */
export async function queueAdRender(
  url: string,
  summary?: AdProductSummary | null,
  stylePreset?: string,
): Promise<number> {
  return await startAdJob(url, summary, stylePreset);
}

/** Re-run a failed production from the top (same URL, fresh assets). */
export async function retryAdRender(projectId: number): Promise<void> {
  await retryAdJob(projectId);
}

export interface RenderStatus {
  state: 'pending' | 'rendering' | 'complete' | 'failed';
  videoUrl: string | null;
  error: string | null;
}

/**
 * Read the job's render state from its pv_projects row (never from a
 * browser-held operation id — the server owns the render now).
 */
export async function checkAdRender(projectId: number): Promise<RenderStatus> {
  const row: AdProjectRow | null = await readAdProject(projectId);
  if (!row) return { state: 'pending', videoUrl: null, error: null };
  if (isAdJobDone(row.status) && row.video_url) {
    return { state: 'complete', videoUrl: String(row.video_url), error: null };
  }
  if (isAdJobFailed(row.status)) {
    return { state: 'failed', videoUrl: null, error: String(row.error || 'The production failed.') };
  }
  return { state: row.status === 'rendering' ? 'rendering' : 'pending', videoUrl: null, error: null };
}
