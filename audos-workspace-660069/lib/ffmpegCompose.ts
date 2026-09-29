// CLIENT-SIDE COMPOSITING — FFmpeg.wasm first, server render as the fallback.
//
// The heavy lifting already exists in lib/client-stitch.ts, which drives the
// @ffmpeg/core WASM module in the browser. This module is the thin policy
// layer every app shares:
//
//   * composeClipsInBrowser() NEVER throws. FFmpeg.wasm is unavailable in some
//     browsers (no WASM, blocked CDN, memory ceiling) and a clip can always
//     fail to download — every one of those cases resolves to null, and the
//     caller carries on with its existing server-side Remotion render.
//   * canComposeClientSide() is deliberately conservative. A timeline is only
//     a candidate when it is a plain back-to-back run of full-frame video
//     clips: the moment captions, a music bed, overlay elements, a
//     picture-in-picture presenter or a still image is involved, only the
//     Remotion composition can produce the right picture, so the browser path
//     stands down rather than shipping a wrong cut.
//
// Nothing here touches the render API's URL or parameters — the fallback is
// the existing call, unchanged.

import { stitchAndUploadClips } from './client-stitch';

/** Client-side compositing needs at least this many clips to be worth doing. */
const MIN_CLIPS = 2;

export interface ClientComposeInput {
  clipUrls: string[];
  workspaceUuid?: string | null;
  fileName?: string;
  onStage?: (stage: 'stitching' | 'uploading') => void;
}

/** True when this browser can plausibly run the WASM encoder at all. */
export function ffmpegSupported(): boolean {
  return typeof window !== 'undefined' && typeof WebAssembly === 'object';
}

/**
 * Join the clips into one MP4 in the browser and upload it. Resolves with the
 * durable URL, or null when the browser path is unavailable or fails for any
 * reason — the caller then runs its normal server render.
 */
export async function composeClipsInBrowser(input: ClientComposeInput): Promise<string | null> {
  const clips = (input.clipUrls || []).filter((url) => typeof url === 'string' && /^https?:\/\//i.test(url));
  if (!ffmpegSupported() || clips.length < MIN_CLIPS) return null;
  try {
    return await stitchAndUploadClips({
      clipUrls: clips,
      workspaceUuid: input.workspaceUuid || null,
      fileName: input.fileName,
      onStage: input.onStage,
    });
  } catch (error) {
    console.warn('[ffmpegCompose] Client-side compositing unavailable — falling back to the server render.', error);
    return null;
  }
}

export interface ComposeCandidateSegment {
  type: string;
  sceneRenderKind?: string | null;
  sceneRenderUrl?: string | null;
  frames: number;
  startSec: number;
  overlayElements?: unknown[] | null;
  presenter?: { video?: string } | null;
  composition?: { mode?: string } | null;
  elements?: unknown[] | null;
}

export interface ComposeCandidate {
  ok: boolean;
  clipUrls: string[];
}

/**
 * Decide whether a timeline is a straight sequence of full-frame clips that
 * FFmpeg.wasm can concatenate faithfully. Anything richer belongs to the
 * Remotion composition.
 */
export function canComposeClientSide(
  segments: ComposeCandidateSegment[],
  extras: { captions?: boolean; musicUrl?: string | null } = {},
): ComposeCandidate {
  const no: ComposeCandidate = { ok: false, clipUrls: [] };
  if (extras.captions || extras.musicUrl) return no;
  if (!Array.isArray(segments) || segments.length < MIN_CLIPS) return no;
  const clipUrls: string[] = [];
  for (const segment of segments) {
    if (segment.type !== 'scene') return no;
    if (segment.sceneRenderKind !== 'video') return no;
    if (!segment.sceneRenderUrl || !/^https?:\/\//i.test(segment.sceneRenderUrl)) return no;
    if (Array.isArray(segment.overlayElements) && segment.overlayElements.length) return no;
    if (Array.isArray(segment.elements) && segment.elements.length) return no;
    if (segment.presenter && segment.presenter.video && segment.presenter.video !== 'hidden') return no;
    if (segment.composition && segment.composition.mode && segment.composition.mode !== 'fullscreen') return no;
    clipUrls.push(segment.sceneRenderUrl);
  }
  return { ok: true, clipUrls };
}
