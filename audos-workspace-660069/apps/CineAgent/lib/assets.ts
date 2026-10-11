// CineAgent — generated-asset execution.
//
// Runs the plan's AssetSpecs against the real generation endpoints with a
// small concurrency pool, a documented model-fallback ladder (never a silent
// substitution — the asset records which model actually produced it), and
// reuse: an asset that already exists in the project registry is never paid
// for twice.

import type { AssetSpec, EditPlan, GeneratedAsset, SourceVideo } from './types';
import {
  VIDEO_MODEL_LADDERS, extractFrames, generateImage, pollVideoGeneration,
  startVideoGeneration, trimClip, measureVideo,
} from './platform';

export interface AssetProgress {
  done: number;
  total: number;
  current: string;
}

/** Generate every asset the plan references; returns the merged registry. */
export async function produceAssets(
  plan: EditPlan,
  source: SourceVideo,
  existing: Record<string, GeneratedAsset>,
  identityStyle: string,
  onProgress: (p: AssetProgress, note?: string) => void,
): Promise<{ registry: Record<string, GeneratedAsset>; failures: string[] }> {
  const registry: Record<string, GeneratedAsset> = { ...existing };
  const referenced = new Set<string>();
  plan.timeline.forEach((s) => { if (s.assetId) referenced.add(s.assetId); collectSpecAssets(s.board, referenced); });
  plan.overlays.forEach((o) => collectSpecAssets(o.spec, referenced));
  const wanted = plan.assets.filter((a) => referenced.has(a.id) && !registry[a.id]);

  const failures: string[] = [];
  let done = 0;
  const report = (current: string, note?: string) => onProgress({ done, total: wanted.length, current }, note);

  const queue = wanted.slice();
  const workers = new Array(Math.min(3, Math.max(1, queue.length))).fill(0).map(async () => {
    while (queue.length) {
      const spec = queue.shift();
      if (!spec) break;
      report(spec.id, 'Creating ' + spec.kind + ' asset: ' + spec.prompt.slice(0, 80));
      try {
        const asset = spec.kind === 'image'
          ? await produceImage(spec, identityStyle)
          : await produceVideo(spec, source, identityStyle);
        registry[spec.id] = asset;
      } catch (error) {
        failures.push(spec.id + ': ' + (error instanceof Error ? error.message : String(error)));
      }
      done += 1;
      report(spec.id);
    }
  });
  await Promise.all(workers);
  return { registry, failures };
}

function collectSpecAssets(spec: any, into: Set<string>): void {
  if (!spec) return;
  if (spec.type === 'image' && spec.assetId) into.add(String(spec.assetId));
  if (spec.type === 'custom' && Array.isArray(spec.layers)) {
    spec.layers.forEach((l: any) => { if (l?.assetId) into.add(String(l.assetId)); });
  }
}

async function produceImage(spec: AssetSpec, identityStyle: string): Promise<GeneratedAsset> {
  const prompt = spec.prompt + (spec.style ? ' Style: ' + spec.style : '') + ' ' + identityStyle
    + ' No text, no words, no letters anywhere in the image.';
  const url = await generateImage(prompt, '16:9');
  return { id: spec.id, kind: 'image', url, model: 'gemini-3.1-flash-image', prompt: spec.prompt };
}

async function produceVideo(spec: AssetSpec, source: SourceVideo, identityStyle: string): Promise<GeneratedAsset> {
  const ladder = VIDEO_MODEL_LADDERS[spec.model || 'seedance'] || VIDEO_MODEL_LADDERS.seedance;
  const prompt = spec.prompt + (spec.style ? ' Style: ' + spec.style : '') + ' ' + identityStyle
    + ' Absolutely no on-screen text, captions, words, letters, logos or subtitles.';

  // Continuity anchor: pull the reference frame out of the source footage and
  // seed image-to-video with it where the plan asked for one.
  let seed: string | undefined;
  if (spec.referenceFrameT != null) {
    try {
      const frames = await extractFrames(source.url, [spec.referenceFrameT]);
      seed = frames[0]?.url;
    } catch {
      seed = undefined;
    }
  }

  // Video-to-video anchor: for omni model, trim a short clip from the source
  // footage and use it as the video seed — gives Omni Flash full motion context
  // for character/scene consistency, not just a single frozen frame.
  let videoClipUrl: string | undefined;
  if (spec.referenceVideoClip != null) {
    const { start, end } = spec.referenceVideoClip;
    const clipDuration = Math.min(end - start, 6); // cap at 6s — longer clips time out
    try {
      const clip = await trimClip(source.url, start, Math.min(end, start + clipDuration));
      videoClipUrl = clip.url;
    } catch {
      // non-fatal: fall back to image seed or no seed
      videoClipUrl = undefined;
    }
  }

  let lastError = '';
  for (const model of ladder) {
    try {
      const operationId = await startVideoGeneration({
        prompt,
        model,
        durationSec: spec.durationSec || 6,
        imageData: seed,
        videoData: videoClipUrl,
        generateAudio: false,
      });
      const url = await pollVideoGeneration(operationId);
      let durationSec = spec.durationSec || 6;
      try {
        const measured = await measureVideo(url);
        if (measured.duration > 0.5) durationSec = measured.duration;
      } catch { /* keep requested duration */ }
      return { id: spec.id, kind: 'video', url, model, prompt: spec.prompt, durationSec };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      // 402 = wallet — no other model will succeed either.
      if ((error as any)?.status === 402) throw new Error('Insufficient wallet balance for video generation.');
    }
  }
  throw new Error('All video engines failed for ' + spec.id + ': ' + lastError);
}

/**
 * After assets exist: clamp generated segments to their real clip length and
 * drop references to assets that could not be produced, so the cut never shows
 * a black hole where a generation failed.
 */
export function reconcilePlanWithAssets(
  plan: EditPlan,
  registry: Record<string, GeneratedAsset>,
): { plan: EditPlan; dropped: string[] } {
  const dropped: string[] = [];
  const next: EditPlan = JSON.parse(JSON.stringify(plan));
  next.timeline = next.timeline.filter((seg) => {
    if (seg.kind === 'generated') {
      const asset = seg.assetId ? registry[seg.assetId] : null;
      if (!asset) { dropped.push('segment ' + seg.id); return false; }
      if (asset.kind === 'video' && asset.durationSec) {
        seg.duration = Math.min(Number(seg.duration || asset.durationSec), Math.max(1.5, asset.durationSec - 0.1));
      }
    }
    if (seg.kind === 'board' && seg.board) {
      if (!specAssetsAvailable(seg.board, registry)) { dropped.push('segment ' + seg.id); return false; }
    }
    return true;
  });
  next.overlays = next.overlays.filter((ov) => {
    if (!specAssetsAvailable(ov.spec, registry)) { dropped.push('overlay ' + ov.id); return false; }
    return true;
  });
  return { plan: next, dropped };
}

function specAssetsAvailable(spec: any, registry: Record<string, GeneratedAsset>): boolean {
  if (!spec) return true;
  if (spec.type === 'image') return Boolean(spec.assetId && registry[spec.assetId]);
  if (spec.type === 'custom' && Array.isArray(spec.layers)) {
    return spec.layers.every((l: any) => l?.kind !== 'image' || (l.assetId && registry[l.assetId]));
  }
  return true;
}
