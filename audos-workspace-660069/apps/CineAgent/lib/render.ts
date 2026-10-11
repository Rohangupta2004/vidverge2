// CineAgent — render execution.
//
// One deterministic server-side Remotion pass per ≤9.5-minute chunk; longer
// cuts render as multiple chunks that are concatenated with the platform's
// ffmpeg stitch endpoint. durationInFrames always comes from the SAME frame
// math the composition itself uses, so the submitted length and the rendered
// length cannot drift.

import type { RenderPlan } from './types';
import { MOTION_RUNTIME_TSX, runtimeFrames } from './motionRuntime';
import { pollRender, portraitReencode, stitchClips, submitRender } from './platform';
import { splitIntoChunks } from './plan';

export interface RenderProgress {
  chunk: number;
  chunks: number;
  status: string;
}

export async function renderCut(
  renderPlan: RenderPlan,
  onProgress: (p: RenderProgress) => void,
): Promise<{ url: string; chunked: boolean; portraitDelivered: boolean; portraitError?: string }> {
  const chunks = splitIntoChunks(renderPlan);
  const urls: string[] = [];
  for (const chunk of chunks) {
    const frames = runtimeFrames(chunk.renderPlan.plan as any, chunk.renderPlan.fps);
    // The render service runs jobs in-process: a platform deploy mid-render
    // orphans the job (auto-refunded). That is infrastructure, not the plan —
    // resubmit once before giving up.
    let url = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      onProgress({ chunk: chunk.index + 1, chunks: chunks.length, status: attempt ? 'resubmitting' : 'submitting' });
      const operationId = await submitRender(MOTION_RUNTIME_TSX, chunk.renderPlan, frames);
      try {
        url = await pollRender(operationId, (status) => {
          onProgress({ chunk: chunk.index + 1, chunks: chunks.length, status });
        });
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const transient = /orphaned|restart|missing in GCS|timed out/i.test(message);
        if (attempt === 0 && transient) continue;
        throw error;
      }
    }
    urls.push(url);
  }
  let finalUrl = urls[0];
  let chunked = false;
  if (urls.length > 1) {
    onProgress({ chunk: chunks.length, chunks: chunks.length, status: 'stitching' });
    finalUrl = await stitchClips(urls);
    chunked = true;
  }
  // Portrait delivery: the render canvas is fixed at 1920x1080, so portrait
  // films are composed centered at full height and then cover-cropped to a
  // TRUE 1080x1920 MP4 by the platform's portrait re-encode. If that step
  // fails, the landscape master still ships (the caller logs it honestly).
  if (renderPlan.portrait) {
    onProgress({ chunk: chunks.length, chunks: chunks.length, status: 'portrait encode' });
    try {
      finalUrl = await portraitReencode(finalUrl, renderPlan.durationSec);
      return { url: finalUrl, chunked, portraitDelivered: true };
    } catch (error) {
      // Ship the centered landscape master rather than nothing — the caller
      // logs this honestly in the activity feed.
      return {
        url: finalUrl, chunked, portraitDelivered: false,
        portraitError: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return { url: finalUrl, chunked, portraitDelivered: false };
}
