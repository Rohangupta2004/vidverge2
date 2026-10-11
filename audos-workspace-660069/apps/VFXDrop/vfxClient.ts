/**
 * VFX DROP — the network layer.
 *
 * One job: take the visitor's own clip and an engineered effect prompt, and
 * come back with the whole source range as one finished VFX clip URL.
 *
 * Short clips keep the original one-shot path. Longer clips are cut into
 * consecutive <=8s ranges, edited ONE AT A TIME on Omni Flash, frame-chained
 * from the preceding rendered segment, then merged into one verified MP4:
 *
 *   1. POST /api/upload/file   (multipart, 50MB ceiling) → public https URL
 *   2. POST /api/video/clip    per source range
 *   3. POST /api/veo/generate/video + GET /api/veo/status/:id sequentially
 *   4. POST /api/video/frames  → previous segment's final frame seeds the next
 *   5. POST /api/workspaces/:id/videos/stitch → one durable MP4
 *
 * Credits follow the workspace rule: 1 credit = 1 second of finished video.
 * Each segment is charged immediately before its provider call. A segment that
 * produces nothing is refunded, and if the chain cannot deliver a final MP4,
 * every completed segment charge from that run is refunded too.
 *
 * `/api/upload/file` refuses anything over 50MB, and the signed large-file
 * route is not reachable from a published space host.
 */
import { EngineError, describeHttpError, generationHeaders, postGeneration } from '../../lib/videoEngineClient';
import { chargeCredits, newChargeKey, refundCredits } from '../../lib/credits';
import { APP_IDS, OMNI_FLASH_MODEL, VEO_31_FAST_MODEL, safeModelFor } from '../../lib/appIds';

/**
 * The registered app id every VFX Drop generation is recorded against.
 *
 * Hardcoded, not read from `window`: the proxy keys each `veo_generations`
 * row to an `apps` row, and `window.__APP_ID__` resolves to the space rather
 * than to an app, which is what tripped `veo_generations_app_id_apps_id_fk`
 * and stopped this app generating on live.
 */
export const VFX_APP_ID = APP_IDS.vfxDrop;

/** The only accepted spelling of the Omni Flash model id on this platform. */
export const OMNI_MODEL = OMNI_FLASH_MODEL;

/** Supported engines retained by the generation pipeline. VFX Drop uses Omni Flash. */
export const VFX_MODELS = [
  {
    id: OMNI_FLASH_MODEL,
    label: 'Omni Flash',
    hint: 'Edits your actual footage, so your face, pose and movement survive the effect.',
    editsSourceVideo: true,
  },
  {
    id: VEO_31_FAST_MODEL,
    label: 'Veo 3.1 Fast',
    hint: 'Faster and cheaper, but it re-animates from one frame of your clip rather than editing the clip itself — your movement is reinvented.',
    editsSourceVideo: false,
  },
] as const;

/**
 * `videoData` is an Omni-only field: every other Group A model answers 400 for
 * it. A non-Omni engine therefore cannot edit the visitor's clip, and is
 * seeded with a still frame from it instead.
 */
function editsSourceVideo(model: string): boolean {
  return VFX_MODELS.some((engine) => engine.id === model && engine.editsSourceVideo);
}

/** `/api/upload/file` hard ceiling. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** The app renders at most the first 30 seconds of a longer source. */
export const MAX_SOURCE_SECONDS = 30;

/** Omni Flash's per-request ceiling. */
export const OUTPUT_SECONDS = 8;

export type VfxAspect = '16:9' | '9:16' | '1:1';
export type SegmentPhase = 'clipping' | 'rendering' | 'continuity' | 'stitching';

export interface SegmentProgress {
  current: number;
  total: number;
  phase: SegmentPhase;
}

function effectiveSourceSeconds(seconds: number): number {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return OUTPUT_SECONDS;
  return Math.min(MAX_SOURCE_SECONDS, value);
}

/** Number of sequential Omni edits needed for the accepted source range. */
export function vfxSegmentCount(seconds: number): number {
  const duration = effectiveSourceSeconds(seconds);
  return duration <= OUTPUT_SECONDS ? 1 : Math.ceil(duration / OUTPUT_SECONDS);
}

/** Exact preflight quote: one credit per requested output second, with Omni's 4s floor. */
export function vfxCreditCost(seconds: number): number {
  const duration = effectiveSourceSeconds(seconds);
  return duration <= OUTPUT_SECONDS ? Math.max(4, Math.ceil(duration)) : Math.ceil(duration);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Upload, clip, frame and stitch are SPACE-scoped routes: they resolve the
 * caller from the space id, so this stays the window value. Only the two
 * generation proxies key a row to an app, and those name VFX_APP_ID instead.
 */
function appId(): string {
  if (typeof window === 'undefined') return 'workspace-660069';
  return String((window as any).__APP_ID__ || (window as any).__SPACE_ID__ || 'workspace-660069');
}

/** Stitching is workspace-scoped; prefer the space id over a surface app id. */
function workspaceId(): string {
  if (typeof window === 'undefined') return 'workspace-660069';
  return String((window as any).__SPACE_ID__ || 'workspace-660069');
}

function wsToken(): string {
  if (typeof window === 'undefined') return '';
  return String((window as any).__workspaceDb?.token || '');
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { 'X-App-Id': appId(), ...extra };
  const token = wsToken();
  if (token) headers['X-Workspace-DB-Token'] = token;
  return headers;
}

export function formatBytes(bytes: number): string {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

/** The proxy's `videoMimeType` enum, picked from the file the visitor chose. */
export function videoMimeTypeFor(file: File): string {
  const type = String(file.type || '').toLowerCase();
  if (type === 'video/mp4' || type === 'video/webm' || type === 'video/quicktime') return type;
  if (/\.mov$/i.test(file.name)) return 'video/quicktime';
  if (/\.webm$/i.test(file.name)) return 'video/webm';
  return 'video/mp4';
}

/** Keep portrait, landscape and square footage in its source orientation. */
export function aspectRatioFor(width?: number | null, height?: number | null): VfxAspect {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (!w || !h) throw new EngineError('The clip orientation could not be read.', { code: 'metadata_unreadable' });
  if (Math.abs(w - h) / Math.max(w, h) <= 0.08) return '1:1';
  return h > w ? '9:16' : '16:9';
}

export function isVideoFile(file: File): boolean {
  return /^video\//i.test(String(file.type || '')) || /\.(mp4|mov|m4v|webm)$/i.test(file.name);
}

// ---------------------------------------------------------------------------
// 1. Upload
// ---------------------------------------------------------------------------

/**
 * Put the clip in workspace storage and get a durable public https URL back.
 * Omni Flash accepts base64 too, but a 50MB clip is ~67MB of base64 in one
 * request body — the URL is the only shape that survives a real phone video.
 */
export async function uploadSourceVideo(file: File): Promise<string> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new EngineError(
      `This clip is ${formatBytes(file.size)}. Uploads are capped at 50 MB — trim it or export at a lower bitrate, then try again.`,
      { code: 'file_too_large' },
    );
  }

  const safeName = file.name.replace(/[^\w.-]+/g, '_') || 'clip.mp4';
  const form = new FormData();
  form.append('file', new File([file], safeName, { type: file.type || 'video/mp4' }));
  form.append('folder', 'vfx-drop');

  let res: Response;
  try {
    res = await fetch('/api/upload/file', { method: 'POST', headers: authHeaders(), body: form });
  } catch (e: any) {
    throw new EngineError(`Your clip could not be uploaded: ${String(e?.message || e)}`, { code: 'network', retryable: true });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.url) {
    throw new EngineError(String(data?.error || `Your clip could not be uploaded (HTTP ${res.status}).`), {
      code: 'upload_failed',
      status: res.status,
      retryable: res.status >= 500,
    });
  }
  return String(data.url);
}

// ---------------------------------------------------------------------------
// 2 + 3. Generate
// ---------------------------------------------------------------------------

export interface VfxRenderParams {
  /** Public https URL of the uploaded source clip. */
  sourceUrl: string;
  videoMimeType: string;
  /** Browser-measured source duration. The accepted render range is capped at 30s. */
  sourceSeconds?: number;
  /** The engineered effect prompt, identity lock already appended. */
  prompt: string;
  /** Chosen engine. Defaults to Omni Flash, the only one that edits video. */
  model?: string;
  aspectRatio: VfxAspect;
  /** Ledger context, e.g. "Element Switch · Galaxy". */
  effectLabel: string;
  onProgress?: (percent: number) => void;
  onSegmentProgress?: (progress: SegmentProgress) => void;
  isCancelled?: () => boolean;
  /** Internal per-segment billing/duration values. */
  chargeSeconds?: number;
  outputSeconds?: number;
  /** Previous rendered final frame; Omni accepts this with videoData. */
  continuationFrameUrl?: string;
}

interface Kickoff {
  operationId: string;
  creditKey: string;
  metered: boolean;
}

async function submitEdit(params: VfxRenderParams): Promise<Kickoff> {
  cancelled(params);
  const model = safeModelFor(VFX_APP_ID, params.model);
  const videoEdit = editsSourceVideo(model);
  const prompt = String(params.prompt || '').trim();
  if (prompt.length < 10 || prompt.length > 10000) {
    throw new EngineError('The engineered VFX prompt must be between 10 and 10,000 characters.', {
      code: 'invalid_prompt', status: 400,
    });
  }

  // Resolved BEFORE the charge so a seed that cannot be extracted never needs
  // a refund. Omni already has the clip itself, so it only needs the
  // continuity frame the previous segment handed over.
  const seedImageUrl = videoEdit
    ? params.continuationFrameUrl || ''
    : params.continuationFrameUrl || (await extractContinuationFrame(params.sourceUrl, 0.1));
  cancelled(params);

  const creditKey = newChargeKey('vfxdrop');
  const chargedSeconds = Math.max(1, Math.ceil(params.chargeSeconds ?? OUTPUT_SECONDS));
  const charge = await chargeCredits({
    seconds: chargedSeconds,
    entryKey: creditKey,
    source: 'vfx-drop',
    note: params.effectLabel,
  });
  /** Nothing was generated, so the visitor keeps their credits. */
  const release = (reason: string) => {
    if (charge.metered) void refundCredits(creditKey, reason);
  };
  if (params.isCancelled?.()) {
    release('The VFX render was cancelled before the provider call');
    throw new EngineError('This VFX render was cancelled.', { code: 'cancelled' });
  }

  const body = {
    model,
    prompt,
    ...(videoEdit ? { videoData: params.sourceUrl, videoMimeType: params.videoMimeType } : {}),
    ...(seedImageUrl ? { imageData: seedImageUrl } : {}),
    aspectRatio: params.aspectRatio,
    duration: Math.max(4, Math.min(OUTPUT_SECONDS, Math.ceil(params.outputSeconds ?? OUTPUT_SECONDS))),
    generateAudio: false,
    // The default safety level false-positives on real footage of a person.
    safetyFilterLevel: 'block_only_high',
  };

  let res: Response;
  let data: any;
  try {
    const posted = await postGeneration('/api/veo/generate/video', body, VFX_APP_ID);
    res = posted.res;
    data = posted.data;
  } catch (e: any) {
    release('The VFX service could not be reached');
    throw new EngineError(`Could not reach the VFX service: ${String(e?.message || e)}`, { code: 'network', retryable: true });
  }

  if (!res.ok) {
    release('The VFX service rejected the request');
    throw describeHttpError(res.status, data, 'The VFX request');
  }

  const operationId = data && (data.operationId || data.operation_id);
  // The proxy can answer 200 OK with a placeholder error id or status:'failed'
  // when the provider submission itself failed.
  const failed = String(data?.status || '').toLowerCase() === 'failed';
  if (typeof operationId !== 'string' || !operationId || failed || /_error_/.test(operationId)) {
    release('The provider did not accept the edit');
    throw new EngineError(
      String(data?.errorMessage || data?.error || 'The VFX engine would not accept this clip. Try a different clip or another effect.'),
      { code: 'provider_rejected', status: res.status },
    );
  }

  return { operationId, creditKey, metered: charge.metered };
}

/**
 * Poll one edit to completion. Reported provider progress is blended with an
 * eased time estimate so the bar always moves, but it never claims 100% before
 * a clip URL actually exists.
 */
async function pollEdit(kickoff: Kickoff, params: VfxRenderParams): Promise<string> {
  const startedAt = Date.now();
  const deadline = startedAt + 10 * 60 * 1000;
  let misses = 0;

  const refund = (reason: string) => {
    if (kickoff.metered) void refundCredits(kickoff.creditKey, reason);
  };

  while (Date.now() < deadline) {
    if (params.isCancelled?.()) {
      refund('The VFX render was cancelled before it produced a clip');
      throw new EngineError('This VFX render was cancelled.', { code: 'cancelled' });
    }

    let res: Response | null = null;
    let data: any = null;
    try {
      res = await fetch(`/api/veo/status/${encodeURIComponent(kickoff.operationId)}`, {
        headers: generationHeaders(VFX_APP_ID),
      });
      data = await res.json().catch(() => null);
    } catch {
      res = null;
    }

    if (res && res.status === 404) {
      refund('The VFX service lost the render');
      throw new EngineError('The VFX service has no record of this render. Start it again.', { code: 'not_found' });
    }

    if (res && res.ok) {
      misses = 0;
      const status = String(data?.status || '').toLowerCase();
      if (status === 'completed' && data?.videoUrl) return String(data.videoUrl);
      if (status === 'failed' || status === 'error') {
        refund('The VFX render failed at the provider');
        throw new EngineError(
          String(data?.errorMessage || data?.error || 'The VFX render failed at the provider.'),
          { code: 'render_failed', retryable: true },
        );
      }
      const reported = Number(data?.progress);
      // A two-minute ease toward 90%, so a provider that reports nothing still
      // reads as working rather than stuck.
      const elapsed = (Date.now() - startedAt) / 1000;
      const estimated = Math.min(90, Math.round(100 * (1 - Math.exp(-elapsed / 55))));
      params.onProgress?.(Math.min(95, Math.max(Number.isFinite(reported) ? reported : 0, estimated)));
    } else {
      misses += 1;
      if (misses >= 6) {
        refund('The VFX service stopped answering before a clip was delivered');
        throw new EngineError('The VFX service stopped answering. Start the render again to retry.', {
          code: 'poll_lost',
          retryable: true,
        });
      }
    }

    await sleep(5000);
  }

  refund('The VFX render timed out before a clip was delivered');
  throw new EngineError('This render took too long. Start it again to retry.', { code: 'timeout', retryable: true });
}

interface SourceSegment {
  startSec: number;
  endSec: number;
  durationSec: number;
  chargeSeconds: number;
}

/** Balanced integer ranges avoid an unusably tiny tail (for example 8s + 1s). */
function planSegments(sourceSeconds: number): SourceSegment[] {
  const duration = effectiveSourceSeconds(sourceSeconds);
  const total = vfxSegmentCount(duration);
  const totalCredits = vfxCreditCost(duration);
  const baseCredits = Math.floor(totalCredits / total);
  const extraCredits = totalCredits % total;
  const ranges: SourceSegment[] = [];
  let cursor = 0;
  for (let index = 0; index < total; index += 1) {
    const chargeSeconds = baseCredits + (index < extraCredits ? 1 : 0);
    const startSec = cursor;
    const endSec = index === total - 1 ? duration : Math.min(duration, startSec + chargeSeconds);
    ranges.push({
      startSec,
      endSec,
      durationSec: endSec - startSec,
      chargeSeconds,
    });
    cursor = endSec;
  }
  return ranges;
}

function cancelled(params: VfxRenderParams): void {
  if (params.isCancelled?.()) throw new EngineError('This VFX render was cancelled.', { code: 'cancelled' });
}

async function trimSource(sourceUrl: string, segment: SourceSegment): Promise<string> {
  const res = await fetch('/api/video/clip', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      videoUrlOrKey: sourceUrl,
      startSec: Number(segment.startSec.toFixed(3)),
      endSec: Number(segment.endSec.toFixed(3)),
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.success !== true || !data?.url) {
    throw new EngineError(String(data?.error || `The source clip could not be segmented (HTTP ${res.status}).`), {
      code: 'clip_failed', status: res.status, retryable: res.status >= 500,
    });
  }
  return String(data.url);
}

async function extractContinuationFrame(videoUrl: string, timestamp: number): Promise<string> {
  const res = await fetch('/api/video/frames', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ videoUrl, timestamps: [Math.max(0.1, Number(timestamp.toFixed(3)))] }),
  });
  const data = await res.json().catch(() => null);
  const frameUrl = data?.frames?.[0]?.url;
  if (!res.ok || data?.success !== true || !frameUrl) {
    throw new EngineError(
      String(data?.error || 'The continuity frame could not be extracted, so the app stopped before making a visible effect reset.'),
      { code: 'continuity_failed', status: res.status, retryable: res.status >= 500 },
    );
  }
  return String(frameUrl);
}

async function stitchSegments(videoUrls: string[]): Promise<string> {
  const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId())}/videos/stitch`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ videoUrls }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.success !== true || !data?.stitchedUrl) {
    throw new EngineError(String(data?.error || `The finished segments could not be stitched (HTTP ${res.status}).`), {
      code: 'stitch_failed', status: res.status, retryable: res.status >= 500,
    });
  }
  return String(data.stitchedUrl);
}

async function renderOne(params: VfxRenderParams): Promise<{ url: string; kickoff: Kickoff }> {
  const kickoff = await submitEdit(params);
  const url = await pollEdit(kickoff, params);
  return { url, kickoff };
}

/**
 * Submit one short edit unchanged, or run the long-clip clip → edit → frame-chain
 * → stitch pipeline. Segment submits are strictly sequential to avoid provider
 * rate limits. No final MP4 means every successful segment charge is returned.
 */
export async function renderVfx(params: VfxRenderParams): Promise<string> {
  const segments = planSegments(params.sourceSeconds ?? OUTPUT_SECONDS);
  if (segments.length === 1) {
    const segment = segments[0];
    const single = await renderOne({
      ...params,
      chargeSeconds: segment.chargeSeconds,
      outputSeconds: segment.chargeSeconds,
    });
    return single.url;
  }

  const renderedUrls: string[] = [];
  const completedCharges: Kickoff[] = [];
  let continuationFrameUrl = '';

  try {
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const current = index + 1;
      cancelled(params);
      params.onSegmentProgress?.({ current, total: segments.length, phase: 'clipping' });
      const clippedUrl = await trimSource(params.sourceUrl, segment);
      cancelled(params);

      params.onSegmentProgress?.({ current, total: segments.length, phase: 'rendering' });
      const rendered = await renderOne({
        ...params,
        sourceUrl: clippedUrl,
        videoMimeType: 'video/mp4',
        chargeSeconds: segment.chargeSeconds,
        outputSeconds: segment.chargeSeconds,
        continuationFrameUrl: continuationFrameUrl || undefined,
        onProgress: (percent) => {
          const completedShare = index / segments.length;
          const currentShare = (Math.max(0, Math.min(100, percent)) / 100) / segments.length;
          params.onProgress?.(Math.min(88, Math.round((completedShare + currentShare) * 88)));
        },
      });
      renderedUrls.push(rendered.url);
      completedCharges.push(rendered.kickoff);

      if (current < segments.length) {
        params.onSegmentProgress?.({ current, total: segments.length, phase: 'continuity' });
        const safeTimestamp = Math.max(0.1, Math.min(segment.durationSec, segment.chargeSeconds) - 0.15);
        continuationFrameUrl = await extractContinuationFrame(rendered.url, safeTimestamp);
      }
    }

    cancelled(params);
    params.onSegmentProgress?.({ current: segments.length, total: segments.length, phase: 'stitching' });
    params.onProgress?.(94);
    const stitchedUrl = await stitchSegments(renderedUrls);
    cancelled(params);
    params.onProgress?.(100);
    return stitchedUrl;
  } catch (error) {
    await Promise.all(completedCharges.map((charge) =>
      charge.metered ? refundCredits(charge.creditKey, 'The segmented VFX run did not deliver a final MP4') : Promise.resolve(),
    ));
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

/**
 * Save the finished clip. The provider URL is cross-origin, where a bare
 * `download` attribute is ignored, so the bytes are pulled into a blob first
 * and the direct link is only the fallback when that read is refused.
 */
export async function downloadVideo(url: string, filename: string): Promise<void> {
  const click = (href: string, openInTab: boolean) => {
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    if (openInTab) {
      a.target = '_blank';
      a.rel = 'noopener';
    }
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    click(href, false);
    setTimeout(() => URL.revokeObjectURL(href), 20000);
  } catch {
    click(url, true);
  }
}
