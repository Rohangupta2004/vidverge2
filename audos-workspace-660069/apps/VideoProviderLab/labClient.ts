/**
 * VIDEO PROVIDER LAB — the network layer.
 *
 * One submit/poll pair per platform plugin, each reachable through
 * `runLabModel`. No provider key, environment variable or BYOK secret appears
 * here or reaches the browser: every request goes to a same-origin /api path
 * where the platform adds the provider credential server-side and bills the
 * workspace wallet. `X-Workspace-DB-Token` (read from window.__workspaceDb per
 * request, never snapshotted at module load) is the only credential sent.
 *
 * THE LAB NEVER SUBSTITUTES A MODEL. The old panel walked a ladder of model
 * ids when the proxy rejected the first one, which is the wrong behaviour for
 * a comparison tool — a card could report a clip that a different engine
 * produced. Every id in labModels.ts now comes from the documented enum, so a
 * rejection is reported as a rejection, with the exact status and path.
 *
 * This layer deliberately does NOT go through lib/videoEngineClient.ts.
 * That client charges the customer credit ledger and can raise the plans
 * screen; the lab is an owner-only developer panel that should hit the proxies
 * directly and show exactly what they answer.
 */

import { capPromptText, validateGroupAInputs, runwayVideoRatio, clampRunwayDuration } from '../../lib/videoEngines';
import { isOpenRouterRunwayModel } from './labModels';
import type { LabModel, LabRunInput } from './labModels';

// ---------------------------------------------------------------------------
// Shared plumbing
// ---------------------------------------------------------------------------

function wsDb(): any {
  return typeof window === 'undefined' ? null : (window as any).__workspaceDb;
}

export function workspaceToken(): string {
  return String(wsDb()?.token || '');
}

export function workspaceId(): string {
  const scope = typeof window === 'undefined' ? null : (window as any);
  return String(wsDb()?.workspaceId || scope?.__WORKSPACE_ID__ || '');
}

export function workspaceHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = workspaceToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'X-Workspace-DB-Token': token } : {}),
    ...(extra || {}),
  };
}

/** Carries the status code and path so a card can label a 402 or a 404 exactly. */
export class RequestError extends Error {
  status: number;
  path: string;

  constructor(message: string, status: number, path: string) {
    super(message);
    this.name = 'RequestError';
    this.status = status;
    this.path = path;
  }
}

async function jsonFetch(url: string, init: RequestInit = {}) {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new RequestError(
      data?.error?.message || data?.error || data?.message || data?.errorMessage || `Request failed: ${response.status}`,
      response.status,
      url,
    );
  }
  return data;
}

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  const text = String(error ?? '');
  return text && text !== '[object Object]' ? text : 'Something went wrong.';
}

/** The shared error contract, written for someone reading a lab card. */
export function describeError(error: unknown, tried: string[]): string {
  if (error instanceof RequestError) {
    if (error.status === 400) {
      return `400 Bad request — the endpoint rejected these parameters. ${error.message}`;
    }
    if (error.status === 401) {
      return `401 Unauthorized — this page sent no workspace credential. Reload the space and retry. (${error.message})`;
    }
    if (error.status === 402) {
      return 'Insufficient wallet balance. Top up the workspace wallet, then run this model again.';
    }
    if (error.status === 403) {
      return `403 Forbidden — this workspace is not allowed to bill that provider. (${error.message})`;
    }
    if (error.status === 404) {
      const paths = tried.length ? tried.join('\n') : error.path;
      return `404 Not Found. Paths tried:\n${paths}\n\nLast message: ${error.message}`;
    }
    if (error.status === 409) {
      return `409 Conflict — the source job is not finished yet, or an idempotency key was reused with different input. (${error.message})`;
    }
    if (error.status === 429) {
      return `429 Rate limited — wait a moment and retry. (${error.message})`;
    }
    if (error.status === 502) {
      return `502 — the provider kickoff failed and the wallet charge is auto-refunded. Safe to retry. (${error.message})`;
    }
    if (error.status === 503) {
      // 503 has two meanings: the platform plugin is not enabled, OR the
      // provider's own API is temporarily overloaded. Surface the right advice.
      const platformDisabled = /not enabled|not configured|no credential/i.test(error.message);
      return platformDisabled
        ? `503 — this provider plugin is not enabled on this platform. (${error.message})`
        : `503 Service Unavailable — the provider is temporarily down or overloaded. Wait a moment and retry. (${error.message})`;
    }
    return `${error.message} (HTTP ${error.status} · ${error.path})`;
  }
  return errorText(error);
}

function idempotencyKey(): string {
  const source = (typeof crypto !== 'undefined' ? crypto : undefined) as Crypto | undefined;
  if (source && typeof source.randomUUID === 'function') return source.randomUUID();
  return `vpl-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/** Pull a playable URL out of whichever shape a provider used. */
function firstMediaUrl(payload: any): string {
  const outputs = payload?.outputs;
  if (Array.isArray(outputs) && outputs.length) {
    const first = outputs[0];
    if (typeof first === 'string') return first;
    if (first?.url) return String(first.url);
  }
  const output = payload?.output;
  if (Array.isArray(output) && output.length) {
    const first = output[0];
    if (typeof first === 'string') return first;
    if (first?.url) return String(first.url);
  }
  if (payload?.videoUrl) return String(payload.videoUrl);
  const media = payload?.media;
  if (Array.isArray(media) && media[0]?.url) return String(media[0].url);
  return '';
}

/** The mime type carried by a data URL, for the ingredient fields that want one. */
function dataUrlMimeType(dataUrl: string): string | undefined {
  const match = /^data:([^;,]+)[;,]/.exec(String(dataUrl || ''));
  const mime = match ? match[1].toLowerCase() : '';
  return mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/webp' ? mime : undefined;
}

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

const POLL_MS = 5000;
export const CANCELLED = 'Stopped polling.';

interface PollStep<T> {
  done: boolean;
  value?: T;
  note?: string;
}

/**
 * A setInterval poller wrapped in a promise. The interval is cleared the moment
 * the job settles, times out or is cancelled, and the cancel function is handed
 * back to the caller so unmounting the panel stops every live poll.
 */
function pollWithInterval<T>(opts: {
  everyMs: number;
  capMs: number;
  onNote: (note: string) => void;
  timeoutMessage: string;
  step: (elapsedMs: number) => Promise<PollStep<T>>;
}): { promise: Promise<T>; cancel: () => void } {
  let intervalId = 0;
  let settled = false;
  let inFlight = false;
  let cancel = () => {};
  const startedAt = Date.now();

  const promise = new Promise<T>((resolve, reject) => {
    const finish = (settleWith: () => void) => {
      if (settled) return;
      settled = true;
      window.clearInterval(intervalId);
      settleWith();
    };

    cancel = () => finish(() => reject(new Error(CANCELLED)));

    const tick = async () => {
      if (settled || inFlight) return;
      inFlight = true;
      const elapsed = Date.now() - startedAt;
      try {
        const result = await opts.step(elapsed);
        if (settled) return;
        if (result.done) {
          finish(() => resolve(result.value as T));
          return;
        }
        if (result.note) opts.onNote(result.note);
        if (elapsed >= opts.capMs) finish(() => reject(new Error(opts.timeoutMessage)));
      } catch (error) {
        finish(() => reject(error));
      } finally {
        inFlight = false;
      }
    };

    intervalId = window.setInterval(() => { void tick(); }, opts.everyMs);
    void tick();
  });

  return { promise, cancel: () => cancel() };
}

function waitingNote(label: string, status: string, elapsedMs: number, progress?: unknown): string {
  const percent = Number(progress);
  const shown = Number.isFinite(percent) && percent > 0 ? ` ${Math.min(99, Math.round(percent))}%` : '';
  return `${label} is ${status || 'working'}…${shown} (${Math.round(elapsedMs / 1000)}s)`;
}

// ---------------------------------------------------------------------------
// Run contract
// ---------------------------------------------------------------------------

export interface RunContext {
  note: (text: string) => void;
  tried: (path: string) => void;
  register: (cancel: () => void) => void;
}

export interface RunResult {
  videoUrl: string;
  /** What actually produced the clip — printed verbatim on the result card. */
  modelUsed: string;
  detail?: string;
  /** Kling task id, so extend and lip-sync can be run on the finished clip. */
  klingTaskId?: string;
}

// ---------------------------------------------------------------------------
// Image upload — only Runway needs a public URL
// ---------------------------------------------------------------------------

/**
 * Every other provider accepts a `data:` URL inline, but Runway parses and
 * DNS-resolves its reference URLs and refuses anything that is not public
 * HTTPS. So a Runway image-to-video run puts the attached image in workspace
 * storage first and sends the returned public address.
 */
export async function uploadImageForPublicUrl(dataUrl: string, ctx: RunContext): Promise<string> {
  ctx.note('Uploading the image to workspace storage…');
  ctx.tried('POST /api/upload/image');
  const payload = await jsonFetch('/api/upload/image', {
    method: 'POST',
    headers: workspaceHeaders(),
    body: JSON.stringify({ imageData: dataUrl, fileName: 'video-provider-lab-input.png' }),
  });
  const url = String(payload?.imageUrl || payload?.url || '');
  if (!url) throw new Error('The upload succeeded but returned no public image URL.');
  return url;
}

// ---------------------------------------------------------------------------
// Group A — Seedance, Veo, Sora, Gemini Omni Flash
// ---------------------------------------------------------------------------

function pollVeoStatus(ctx: RunContext, operationId: string, label: string, capMs: number): Promise<string> {
  const path = `/api/veo/status/${encodeURIComponent(operationId)}`;
  ctx.tried(`GET ${path}`);
  const poller = pollWithInterval<string>({
    everyMs: POLL_MS,
    capMs,
    onNote: ctx.note,
    timeoutMessage: `${label} is still rendering after ${Math.round(capMs / 1000)}s. The job may still land — the operation id is ${operationId}.`,
    step: async (elapsed) => {
      const state = await jsonFetch(path, { headers: workspaceHeaders() });
      const status = String(state?.status || '');
      // The proxy reports `status`; `done` is accepted too in case an older
      // build of the endpoint answers with the operation-style boolean.
      const finished = state?.done === true || status === 'completed';
      const url = String(state?.videoUrl || '');
      if (status === 'failed') {
        throw new Error(String(state?.errorMessage || `${label} reported the render failed.`));
      }
      if (finished && url) return { done: true, value: url };
      if (finished && !url) {
        throw new Error(`${label} reported the job finished but returned no videoUrl.`);
      }
      return { done: false, note: waitingNote(label, status, elapsed, state?.progress) };
    },
  });
  ctx.register(poller.cancel);
  return poller.promise;
}

async function runGroupA(ctx: RunContext, model: LabModel, input: LabRunInput): Promise<RunResult> {
  const path = '/api/veo/generate/video';
  const useReferences = input.imageRole === 'reference' && model.params.maxRefs > 0 && input.images.length > 0;
  const referenceImages = useReferences
    ? input.images.slice(0, model.params.maxRefs).map((dataUrl) => ({
      imageData: dataUrl,
      mimeType: dataUrlMimeType(dataUrl),
      referenceType: 'asset' as const,
    }))
    : null;
  const seedImage = !useReferences && input.images.length ? input.images[0] : null;

  // The same rules the proxy enforces with a 400, checked before the wallet is
  // touched so an impossible combination costs nothing.
  const violation = isOpenRouterRunwayModel(model.modelId)
    ? null
    : validateGroupAInputs(model.modelId, {
      prompt: input.prompt,
      imageData: seedImage,
      referenceImages,
    });
  if (violation) throw new Error(violation);

  const body: Record<string, unknown> = {
    model: model.modelId,
    prompt: capPromptText(input.prompt, 10000),
    aspectRatio: input.aspectRatio,
    duration: input.duration,
    generateAudio: Boolean(input.audio),
  };
  if (input.resolution) body.resolution = input.resolution;
  if (input.negativePrompt.trim()) body.negativePrompt = capPromptText(input.negativePrompt, 10000);
  if (seedImage) body.imageData = seedImage;
  if (referenceImages?.length) body.referenceImages = referenceImages;

  // Omni Flash video-to-video: the uploaded clip rides as videoData. Only the
  // entries that declare videoUpload send it, so a compare batch never hands a
  // source video to an engine whose schema has no field for it.
  const sourceVideo = model.params.videoUpload && String(input.videoInput || '').startsWith('data:')
    ? input.videoInput
    : '';
  if (sourceVideo) body.videoData = sourceVideo;

  ctx.note(`Submitting ${model.modelId}${sourceVideo ? ' (video edit)' : ''}…`);
  ctx.tried(`POST ${path} · model=${model.modelId}${sourceVideo ? ' · videoData=<attached>' : ''}`);
  const start = await jsonFetch(path, {
    method: 'POST',
    headers: workspaceHeaders(),
    body: JSON.stringify(body),
  });

  const operationId = String(start?.operationId || start?.operation_id || '');
  if (!operationId) {
    throw new Error(`${model.name} accepted the request but returned no operationId.`);
  }
  // The proxy has been seen answering 200 with a synthetic already-failed id
  // when the upstream submission itself was refused.
  if (/_error_/.test(operationId)) {
    throw new Error(
      `${model.name} was rejected upstream — the proxy answered 200 with the synthetic id ${operationId} `
      + `instead of a real operation. ${String(start?.errorMessage || start?.message || '')}`.trim(),
    );
  }

  const videoUrl = await pollVeoStatus(ctx, operationId, model.name, model.capMs);
  const detail = [
    start?.cost !== undefined && start?.cost !== null ? `Proxy quoted $${String(start.cost)}.` : '',
    useReferences ? `Sent ${referenceImages?.length} reference image(s) as ingredients.` : '',
    sourceVideo ? 'Sent an uploaded source video as videoData for editing.' : '',
  ].filter(Boolean).join(' ');
  return { videoUrl, modelUsed: model.modelId, detail };
}

/** The convenience proxy: no model field, the server pins the Veo version. */
async function runVeoManaged(ctx: RunContext, model: LabModel, input: LabRunInput): Promise<RunResult> {
  const path = '/api/generate/video';
  const body: Record<string, unknown> = {
    prompt: capPromptText(input.prompt, 10000),
    aspectRatio: input.aspectRatio,
    duration: input.duration,
    generateAudio: Boolean(input.audio),
  };
  if (input.images.length) body.imageData = input.images[0];

  ctx.note('Submitting to the platform-managed Veo proxy…');
  ctx.tried(`POST ${path}`);
  const start = await jsonFetch(path, {
    method: 'POST',
    headers: workspaceHeaders(),
    body: JSON.stringify(body),
  });
  const operationId = String(start?.operationId || '');
  if (!operationId) throw new Error('The managed proxy accepted the request but returned no operationId.');
  if (/_error_/.test(operationId)) {
    throw new Error(`The managed proxy was rejected upstream (${operationId}).`);
  }
  const videoUrl = await pollVeoStatus(ctx, operationId, 'Managed Veo', model.capMs);
  return {
    videoUrl,
    modelUsed: 'server-pinned veo-3.1-generate-preview',
    detail: 'This endpoint takes no model field — the version is whatever the platform currently pins.',
  };
}

// ---------------------------------------------------------------------------
// Kling
// ---------------------------------------------------------------------------

function pollKlingTask(ctx: RunContext, taskId: string, label: string, capMs: number): Promise<string> {
  const path = `/api/generate/kling/status/${encodeURIComponent(taskId)}`;
  ctx.tried(`GET ${path}`);
  const poller = pollWithInterval<string>({
    everyMs: POLL_MS,
    capMs,
    onNote: ctx.note,
    timeoutMessage: `${label} is still working after ${Math.round(capMs / 1000)}s. Task ${taskId} may still finish — poll it again rather than resubmitting.`,
    step: async (elapsed) => {
      const state = await jsonFetch(path, { headers: workspaceHeaders() });
      const status = String(state?.status || '');
      if (status === 'failed') {
        throw new Error(String(state?.errorMessage || `${label} reported the generation failed.`));
      }
      if (status === 'completed') {
        const url = String(state?.videoUrl || '');
        if (!url) throw new Error(`${label} completed but returned no videoUrl.`);
        return { done: true, value: url };
      }
      return { done: false, note: waitingNote(label, status, elapsed) };
    },
  });
  ctx.register(poller.cancel);
  return poller.promise;
}

function klingDuration(seconds: number): string {
  return Number(seconds) >= 8 ? '10' : '5';
}

/**
 * One Kling entry covers three routes, and the attached images decide which:
 * none runs text-to-video, one runs image-to-video, and two to four runs
 * Elements (multi-image). The card reports the route that was used.
 */
async function runKling(ctx: RunContext, model: LabModel, input: LabRunInput): Promise<RunResult> {
  const images = input.images;
  const route = images.length >= 2 ? 'multi-image' : images.length === 1 ? 'image-to-video' : 'text-to-video';
  const path = `/api/generate/kling/${route}`;

  const body: Record<string, unknown> = {
    model: model.modelId,
    mode: input.mode || 'std',
    duration: klingDuration(input.duration),
  };
  const prompt = input.prompt.trim();
  if (prompt) body.prompt = capPromptText(prompt, 2500);
  if (input.negativePrompt.trim()) body.negativePrompt = capPromptText(input.negativePrompt, 2500);
  if (Number.isFinite(input.cfgScale)) body.cfgScale = Math.max(0, Math.min(1, input.cfgScale));
  const seed = Number.parseInt(input.seed, 10);
  if (Number.isFinite(seed)) body.seed = seed;

  if (route === 'text-to-video') {
    // Only the text-to-video body carries an aspect ratio; on the image routes
    // the source image sets the frame and the field is not in the schema.
    body.aspectRatio = input.aspectRatio;
    if (input.camera) body.cameraControl = { type: input.camera };
  } else if (route === 'image-to-video') {
    body.imageData = images[0];
    if (input.camera) body.cameraControl = { type: input.camera };
  } else {
    body.images = images.slice(0, 4);
  }

  ctx.note(`Submitting to Kling ${route}…`);
  ctx.tried(`POST ${path} · model=${model.modelId} · mode=${String(body.mode)}`);
  let start: Record<string, unknown> | null = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      start = await jsonFetch(path, {
        method: 'POST',
        headers: workspaceHeaders(),
        body: JSON.stringify(body),
      });
      break;
    } catch (err) {
      if (err instanceof RequestError && err.status === 503 && attempt < 3) {
        ctx.note(`Kling returned 503 — retrying in 5s (attempt ${attempt + 1}/3)…`);
        // eslint-disable-next-line no-await-in-loop
        await new Promise<void>((resolve) => { window.setTimeout(resolve, 5000); });
      } else {
        throw err;
      }
    }
  }
  if (!start) throw new Error('Kling did not respond after 3 attempts.');

  const taskId = String(start?.taskId || '');
  if (!taskId) throw new Error('Kling accepted the request but returned no taskId.');
  const detail = [
    `Route: ${route}.`,
    start?.modelFallback ? `Kling fell back: ${String(start.modelFallback)}` : '',
  ].filter(Boolean).join(' ');

  const videoUrl = await pollKlingTask(ctx, taskId, `Kling ${route}`, model.capMs);
  return { videoUrl, modelUsed: `${model.modelId} · ${route}`, detail, klingTaskId: taskId };
}

/** Lengthen a finished Kling clip by ~5s. The proxy resolves the Kling
 *  video-level id from the source task, so only the task id is sent. */
export async function runKlingExtend(ctx: RunContext, sourceTaskId: string, prompt: string, capMs: number): Promise<RunResult> {
  const path = '/api/generate/kling/extend';
  ctx.note('Submitting a Kling extend…');
  ctx.tried(`POST ${path} · sourceTaskId=${sourceTaskId}`);
  const body: Record<string, unknown> = { sourceTaskId };
  if (prompt.trim()) body.prompt = capPromptText(prompt, 2500);
  const start = await jsonFetch(path, {
    method: 'POST',
    headers: workspaceHeaders(),
    body: JSON.stringify(body),
  });
  const taskId = String(start?.taskId || '');
  if (!taskId) throw new Error('The Kling extend was accepted but returned no taskId.');
  const videoUrl = await pollKlingTask(ctx, taskId, 'Kling extend', capMs);
  return {
    videoUrl,
    modelUsed: 'kling extend (+~5s)',
    detail: `Extended from task ${sourceTaskId}. Billed separately at $0.25.`,
    klingTaskId: taskId,
  };
}

/** Apply TTS lip-sync to a finished Kling clip. */
export async function runKlingLipSync(ctx: RunContext, videoTaskId: string, text: string, capMs: number): Promise<RunResult> {
  const path = '/api/generate/kling/lip-sync';
  const spoken = text.trim();
  if (!spoken) throw new Error('Lip-sync needs the line you want spoken.');
  ctx.note('Submitting a Kling lip-sync…');
  ctx.tried(`POST ${path} · videoTaskId=${videoTaskId}`);
  const start = await jsonFetch(path, {
    method: 'POST',
    headers: workspaceHeaders(),
    body: JSON.stringify({
      videoTaskId,
      audioType: 'text',
      text: spoken.slice(0, 500),
      voiceLanguage: 'en',
      voiceSpeed: 1,
    }),
  });
  const taskId = String(start?.taskId || '');
  if (!taskId) throw new Error('The Kling lip-sync was accepted but returned no taskId.');
  const videoUrl = await pollKlingTask(ctx, taskId, 'Kling lip-sync', capMs);
  return {
    videoUrl,
    modelUsed: 'kling lip-sync (TTS)',
    detail: `Synced onto task ${videoTaskId}. Billed separately at $0.25.`,
    klingTaskId: taskId,
  };
}

// ---------------------------------------------------------------------------
// Higgsfield
// ---------------------------------------------------------------------------

function pollHiggsfield(ctx: RunContext, requestId: string, label: string, capMs: number): Promise<string> {
  const path = `/api/generate/higgsfield/status/${encodeURIComponent(requestId)}`;
  ctx.tried(`GET ${path}`);
  const poller = pollWithInterval<string>({
    everyMs: POLL_MS,
    capMs,
    onNote: ctx.note,
    timeoutMessage: `${label} is still working after ${Math.round(capMs / 1000)}s. Request ${requestId} may still finish.`,
    step: async (elapsed) => {
      const state = await jsonFetch(path, { headers: workspaceHeaders() });
      const status = String(state?.status || '');
      if (status === 'nsfw') {
        throw new Error('Higgsfield moderation rejected that prompt (status "nsfw"). Reword it and run again.');
      }
      if (status === 'failed') {
        throw new Error(String(state?.errorMessage || `${label} reported the generation failed.`));
      }
      if (status === 'completed') {
        const url = String(state?.videoUrl || state?.images?.[0]?.url || '');
        if (!url) throw new Error(`${label} completed but returned no videoUrl.`);
        return { done: true, value: url };
      }
      return { done: false, note: waitingNote(label, status, elapsed) };
    },
  });
  ctx.register(poller.cancel);
  return poller.promise;
}

async function runHiggsfieldText(ctx: RunContext, model: LabModel, input: LabRunInput): Promise<RunResult> {
  const path = '/api/generate/higgsfield/video';
  const body: Record<string, unknown> = {
    prompt: capPromptText(input.prompt, 2000),
    model: model.modelId,
    aspectRatio: input.aspectRatio,
    durationSeconds: Math.max(1, Math.min(15, Math.round(input.duration))),
  };
  const seed = Number.parseInt(input.seed, 10);
  if (Number.isFinite(seed)) body.seed = seed;

  ctx.note('Submitting to Higgsfield text-to-video…');
  ctx.tried(`POST ${path} · model=${model.modelId}`);
  const start = await jsonFetch(path, {
    method: 'POST',
    headers: workspaceHeaders(),
    body: JSON.stringify(body),
  });
  const requestId = String(start?.requestId || '');
  if (!requestId) throw new Error('Higgsfield accepted the request but returned no requestId.');
  const videoUrl = await pollHiggsfield(ctx, requestId, model.name, model.capMs);
  return {
    videoUrl,
    modelUsed: model.modelId,
    detail: start?.modelFallback ? `Higgsfield fell back: ${String(start.modelFallback)}` : '',
  };
}

async function runHiggsfieldImage(ctx: RunContext, model: LabModel, input: LabRunInput): Promise<RunResult> {
  const path = '/api/generate/higgsfield/image-to-video';
  if (!input.images.length) throw new Error(`${model.name} needs one source image.`);
  const body: Record<string, unknown> = {
    imageData: input.images[0],
    model: model.modelId,
  };
  if (input.prompt.trim()) body.prompt = capPromptText(input.prompt, 2000);
  const seed = Number.parseInt(input.seed, 10);
  if (Number.isFinite(seed)) body.seed = seed;

  ctx.note('Submitting to Higgsfield image-to-video…');
  ctx.tried(`POST ${path} · model=${model.modelId}`);
  const start = await jsonFetch(path, {
    method: 'POST',
    headers: workspaceHeaders(),
    body: JSON.stringify(body),
  });
  const requestId = String(start?.requestId || '');
  if (!requestId) throw new Error('Higgsfield accepted the request but returned no requestId.');
  const videoUrl = await pollHiggsfield(ctx, requestId, model.name, model.capMs);
  return {
    videoUrl,
    modelUsed: model.modelId,
    detail: start?.modelFallback ? `Higgsfield fell back: ${String(start.modelFallback)}` : '',
  };
}

// ---------------------------------------------------------------------------
// HeyGen
// ---------------------------------------------------------------------------

function heygenBase(): string {
  const id = workspaceId();
  if (!id) {
    throw new Error('This page exposed no workspace id, so the HeyGen proxy path cannot be built. Reload the space and retry.');
  }
  return `/api/workspaces/${id}/provider-credentials/heygen/proxy`;
}

function pollHeyGenVideo(ctx: RunContext, base: string, videoId: string, capMs: number): Promise<string> {
  const path = `${base}/v3/videos/${encodeURIComponent(videoId)}`;
  ctx.tried(`GET ${path}`);
  const poller = pollWithInterval<string>({
    everyMs: POLL_MS,
    capMs,
    onNote: ctx.note,
    timeoutMessage: `HeyGen is still rendering after ${Math.round(capMs / 1000)}s. Video ${videoId} may still finish.`,
    step: async (elapsed) => {
      const state = await jsonFetch(path);
      const video = state?.data || state;
      const status = String(video?.status || '');
      if (status === 'failed') {
        const code = video?.failure_code ? `${String(video.failure_code)}: ` : '';
        throw new Error(`${code}${String(video?.failure_message || 'HeyGen reported the render failed.')}`);
      }
      if (status === 'completed') {
        const url = String(video?.video_url || '');
        if (!url) throw new Error('HeyGen completed but returned no video_url.');
        return { done: true, value: url };
      }
      return { done: false, note: waitingNote('HeyGen', status, elapsed) };
    },
  });
  ctx.register(poller.cancel);
  return poller.promise;
}

/** HeyGen's script field is the only place the lab truncates a prompt hard:
 *  a long script turns a smoke test into a multi-minute paid render. */
const HEYGEN_SCRIPT_CHARS = 500;

async function runHeyGenAvatar(ctx: RunContext, model: LabModel, input: LabRunInput): Promise<RunResult> {
  const base = heygenBase();

  ctx.note('Loading HeyGen avatar looks…');
  const looksPath = `${base}/v3/avatars/looks?limit=50`;
  ctx.tried(`GET ${looksPath}`);
  const looks = await jsonFetch(looksPath);
  const list: any[] = Array.isArray(looks?.data) ? looks.data : [];
  // Prefer a look that carries both a default voice and a usable v3 engine.
  const look = list.filter((entry) => entry?.default_voice_id
    && Array.isArray(entry?.supported_api_engines)
    && entry.supported_api_engines.length)[0] || list[0];
  if (!look) throw new Error('No HeyGen avatar looks found.');

  const supported: string[] = Array.isArray(look.supported_api_engines)
    ? look.supported_api_engines.map((entry: unknown) => String(entry))
    : [];
  // v3 accepts only avatar_iii / avatar_iv / avatar_v, and only the ones this
  // look lists — anything else comes back 400 invalid_parameter.
  const engine = ['avatar_iv', 'avatar_v', 'avatar_iii']
    .filter((candidate) => supported.indexOf(candidate) !== -1)[0]
    || supported[0]
    || 'avatar_iv';
  if (!look.default_voice_id) {
    throw new Error(`HeyGen look ${String(look.id)} carries no default_voice_id, and v3 requires an explicit voice_id.`);
  }

  ctx.note(`Creating a HeyGen render on ${engine}…`);
  ctx.tried(`POST ${base}/v3/videos · engine=${engine}`);
  const created = await jsonFetch(`${base}/v3/videos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'avatar',
      avatar_id: look.id,
      engine: { type: engine },
      script: input.prompt.trim().slice(0, HEYGEN_SCRIPT_CHARS),
      voice_id: look.default_voice_id,
      voice_settings: { speed: Math.max(0.5, Math.min(1.5, input.voiceSpeed || 1)) },
      resolution: input.resolution || '720p',
      aspect_ratio: input.aspectRatio,
      fit: input.fit,
      output_format: 'mp4',
    }),
  });

  const detail = `Avatar ${String(look.id)} · engine ${engine} · voice ${String(look.default_voice_id)}`
    + (input.prompt.trim().length > HEYGEN_SCRIPT_CHARS
      ? ` · script truncated to ${HEYGEN_SCRIPT_CHARS} characters to keep the test render short`
      : '');
  const immediate = String(created?.data?.video_url || created?.video_url || '');
  if (immediate) return { videoUrl: immediate, modelUsed: `heygen/${engine}`, detail };

  const videoId = String(created?.data?.video_id || created?.video_id || '');
  if (!videoId) throw new Error('HeyGen did not return data.video_id.');
  const videoUrl = await pollHeyGenVideo(ctx, base, videoId, model.capMs);
  return { videoUrl, modelUsed: `heygen/${engine}`, detail };
}

/**
 * The prompt-driven Video Agent is a DIFFERENT v3 API: it takes `orientation`
 * rather than `aspect_ratio`, and the integration doc stops at the request
 * shape. So this runner reports the creation response keys it got back and
 * only polls when an id is actually present — it never claims a contract the
 * doc does not state.
 */
async function runHeyGenAgent(ctx: RunContext, model: LabModel, input: LabRunInput): Promise<RunResult> {
  const base = heygenBase();
  const path = `${base}/v3/video-agents`;
  const orientation = input.aspectRatio === '9:16' ? 'portrait' : 'landscape';

  ctx.note(`Creating a HeyGen Video Agent render (${orientation})…`);
  ctx.tried(`POST ${path} · orientation=${orientation}`);
  const created = await jsonFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: input.prompt.trim().slice(0, 1000),
      mode: 'generate',
      orientation,
    }),
  });

  const payload = created?.data || created;
  const immediate = String(payload?.video_url || '');
  const responseKeys = payload && typeof payload === 'object' ? Object.keys(payload).join(', ') : 'none';
  const detail = `Video Agent · orientation ${orientation} · creation response keys: ${responseKeys}`;
  if (immediate) return { videoUrl: immediate, modelUsed: 'heygen/video-agent', detail };

  const videoId = String(payload?.video_id || payload?.id || payload?.task_id || '');
  if (!videoId) {
    throw new Error(
      'HeyGen accepted the Video Agent request but returned no video id, and the integration doc does not '
      + `document this endpoint's response or poll shape. Creation response keys: ${responseKeys}.`,
    );
  }
  const videoUrl = await pollHeyGenVideo(ctx, base, videoId, model.capMs);
  return { videoUrl, modelUsed: 'heygen/video-agent', detail };
}

// ---------------------------------------------------------------------------
// Runway
// ---------------------------------------------------------------------------

async function runRunway(ctx: RunContext, model: LabModel, input: LabRunInput): Promise<RunResult> {
  const imageToVideo = input.images.length > 0;
  const promptImage = imageToVideo ? await uploadImageForPublicUrl(input.images[0], ctx) : '';
  const ratio = runwayVideoRatio(input.aspectRatio, model.modelId, imageToVideo);
  const duration = clampRunwayDuration(input.duration, model.modelId);

  const body: Record<string, unknown> = { model: model.modelId, ratio, duration };
  // Gen 4 Turbo is image-to-video only and takes no prompt text; Gen 4.5
  // requires promptText on BOTH of its modes.
  // Runway's own API caps promptText at 1,000 characters, unlike the Veo paths.
  if (model.modelId !== 'gen4_turbo') body.promptText = capPromptText(input.prompt, 1000);
  if (imageToVideo) {
    body.promptImage = promptImage;
    if (model.modelId === 'gen4.5') body.mode = 'image-to-video';
  }

  let detail = '';
  // The quote is free, unauthenticated and spends nothing — the cheap way to
  // find out the request is invalid or Runway is disabled before billing.
  ctx.note('Quoting the request…');
  ctx.tried('POST /api/generate/runway/quote');
  try {
    const quote = await jsonFetch('/api/generate/runway/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const price = quote?.quote?.priceUsd ?? quote?.priceUsd ?? quote?.quote?.price ?? quote?.price;
    detail = price === undefined || price === null
      ? 'Runway quoted the request before generating.'
      : `Runway quoted this request at $${String(price)} before generating.`;
  } catch (error) {
    const status = error instanceof RequestError ? error.status : 0;
    // An invalid request or a disabled provider fails the paid submit too, so
    // stop here rather than spending the wallet to learn the same thing.
    if (status === 400 || status === 402 || status === 503) throw error;
    detail = `The quote endpoint answered ${status || 'an error'} (${errorText(error)}); submitted anyway.`;
  }

  ctx.note('Submitting to Runway…');
  ctx.tried(`POST /api/generate/runway/video · model=${model.modelId} · ratio=${ratio}`);
  const task = await jsonFetch('/api/generate/runway/video', {
    method: 'POST',
    headers: workspaceHeaders({ 'Idempotency-Key': idempotencyKey() }),
    body: JSON.stringify(body),
  });

  if (String(task?.status || '') === 'uncertain') {
    throw new Error('Runway cannot confirm this job either way. Do NOT resubmit — check Runway usage before trying again.');
  }

  const immediate = firstMediaUrl(task);
  if (immediate) return { videoUrl: immediate, modelUsed: model.modelId, detail };

  const taskId = String(task?.taskId || task?.id || '');
  if (!taskId) {
    throw new Error('Runway accepted the request but returned neither a taskId nor a media URL.');
  }

  const path = `/api/generate/runway/status/${encodeURIComponent(taskId)}`;
  ctx.tried(`GET ${path}`);
  const poller = pollWithInterval<string>({
    everyMs: POLL_MS,
    capMs: model.capMs,
    onNote: ctx.note,
    timeoutMessage: `Runway is still working after ${Math.round(model.capMs / 1000)}s. Task ${taskId} may still finish — poll it again rather than resubmitting.`,
    step: async (elapsed) => {
      const state = await jsonFetch(path, { headers: workspaceHeaders() });
      const status = String(state?.status || '');
      if (status === 'succeeded') {
        const url = firstMediaUrl(state);
        if (!url) throw new Error('Runway succeeded but returned no media URL.');
        return { done: true, value: url };
      }
      if (status === 'failed' || status === 'cancelled') {
        throw new Error(`Runway ended ${status}: ${String(state?.error?.message || state?.error || 'no successful output')}`);
      }
      if (status === 'uncertain') {
        throw new Error('Runway cannot confirm this job either way. Do NOT resubmit — check Runway usage before trying again.');
      }
      return { done: false, note: waitingNote('Runway', status, elapsed, state?.progress) };
    },
  });
  ctx.register(poller.cancel);
  return { videoUrl: await poller.promise, modelUsed: model.modelId, detail };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export function runLabModel(model: LabModel, input: LabRunInput, ctx: RunContext): Promise<RunResult> {
  switch (model.runner) {
    case 'group-a': return runGroupA(ctx, model, input);
    case 'veo-managed': return runVeoManaged(ctx, model, input);
    case 'kling': return runKling(ctx, model, input);
    case 'higgsfield-text': return runHiggsfieldText(ctx, model, input);
    case 'higgsfield-image': return runHiggsfieldImage(ctx, model, input);
    case 'heygen-avatar': return runHeyGenAvatar(ctx, model, input);
    case 'heygen-agent': return runHeyGenAgent(ctx, model, input);
    case 'runway': return runRunway(ctx, model, input);
    default:
      return Promise.reject(new Error(
        model.unavailableReason || `${model.name} has no endpoint on this platform, so the lab will not call one.`,
      ));
  }
}

/** Read a picked file as the `data:` URL every provider except Runway takes inline. */
export function readImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`${file.name} could not be read.`));
    reader.readAsDataURL(file);
  });
}

/** The proxies cap an inline image at ~10MB decoded. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
