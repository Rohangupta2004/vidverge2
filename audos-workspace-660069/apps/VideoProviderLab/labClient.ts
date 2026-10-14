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
import { klingCameraControl } from './labModels';
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
// Group A — Seedance, Veo and Gemini Omni Flash
// ---------------------------------------------------------------------------

function pollVeoStatus(ctx: RunContext, operationId: string, label: string, capMs: number): Promise<string> {
  // Before the first status poll: a synthetic error id means the upstream
  // submission was refused, so there is no real job behind it and polling
  // would just run until the cap for nothing. Fail fast instead.
  if (/_error_[0-9]+$/.test(operationId) || /^(veo_video_error|sora_error|openrouter_error)_/.test(operationId)) {
    throw new Error(
      `Provider refused: the proxy returned a synthetic error ID (${operationId}) instead of a real job. `
      + 'This model is not accepting submissions right now — try Veo 3.1, Veo 3.1 Fast, or Seedance 2.0 Fast instead.',
    );
  }
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
  const violation = validateGroupAInputs(model.modelId, {
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
// Higgsfield — POST /api/generate/higgsfield/video
// ---------------------------------------------------------------------------

async function runHiggsfield(ctx: RunContext, model: LabModel, input: LabRunInput): Promise<RunResult> {
  // WALLET ATTRIBUTION (the 400 "A billable workspace could not be resolved"
  // fix): unlike the Veo and Runway proxies, the Higgsfield proxy does NOT
  // resolve the billable workspace from X-Workspace-DB-Token — per its docs it
  // needs an x-app-id header, a ?workspaceId= query param, or workspaceId in
  // the body. Send the body field plus the header so either one resolves it.
  const wsId = workspaceId();
  const appId = typeof window === 'undefined'
    ? ''
    : String((window as any).__APP_ID__ || (window as any).__SPACE_ID__ || '');
  const headers = workspaceHeaders(appId ? { 'X-App-Id': appId } : undefined);

  // Text-to-video and image-to-video are SEPARATE endpoints on this proxy.
  const useImage = input.images.length > 0 && model.image !== 'none';
  const submitPath = useImage
    ? '/api/generate/higgsfield/image-to-video'
    : '/api/generate/higgsfield/video';
  const body: Record<string, unknown> = {
    model: model.modelId,
    prompt: capPromptText(input.prompt, 2000),
  };
  if (wsId) body.workspaceId = wsId;
  if (useImage) {
    // Higgsfield's own file storage refuses inline uploads today — a data: URL
    // makes the proxy answer 502 "Higgsfield image upload failed (403)" — but a
    // public HTTPS URL passes straight through (both verified live 13 Oct
    // 2026). So the attached image is staged to workspace storage first,
    // exactly like the Runway runner does.
    body.imageData = await uploadImageForPublicUrl(input.images[0], ctx);
  } else {
    body.aspectRatio = input.aspectRatio;
    body.durationSeconds = input.duration;
  }

  ctx.note(`Submitting ${model.modelId} to Higgsfield…`);
  ctx.tried(`POST ${submitPath} · model=${model.modelId}`);
  const task = await jsonFetch(submitPath, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const requestId = String(task?.requestId || task?.jobId || task?.taskId || task?.id || '');
  if (!requestId) throw new Error('Higgsfield accepted the request but returned no request ID.');

  // Unknown model ids never fail on this proxy — they fall back to the mode
  // default and the kickoff carries a modelFallback note. A comparison tool
  // must say so rather than labelling the clip with the id that was asked for.
  const fallbackNote = task?.modelFallback ? String(task.modelFallback) : '';
  const modelUsed = String(task?.model || model.modelId);
  if (fallbackNote) ctx.note(`Higgsfield model fallback: ${fallbackNote}`);

  const statusPath = `/api/generate/higgsfield/status/${encodeURIComponent(requestId)}`;
  ctx.tried(`GET ${statusPath}`);
  const poller = pollWithInterval<string>({
    everyMs: POLL_MS,
    capMs: model.capMs,
    onNote: ctx.note,
    timeoutMessage: `Higgsfield is still rendering after ${Math.round(model.capMs / 1000)}s. Request ID: ${requestId}.`,
    step: async (elapsed) => {
      const state = await jsonFetch(statusPath, { headers: workspaceHeaders() });
      const status = String(state?.status || '').toLowerCase();
      if (status === 'succeeded' || status === 'completed' || status === 'done') {
        const url = firstMediaUrl(state) || String(state?.videoUrl || state?.video_url || '');
        if (!url) throw new Error('Higgsfield finished but returned no video URL.');
        return { done: true, value: url };
      }
      if (status === 'failed' || status === 'error' || status === 'nsfw') {
        const detail = String(state?.errorMessage || state?.error || state?.error_message
          || (status === 'nsfw' ? 'moderation rejected the generation — adjust the prompt and retry' : 'no detail'));
        throw new Error(`Higgsfield ${status}: ${detail}`);
      }
      return { done: false, note: waitingNote('Higgsfield', status, elapsed) };
    },
  });
  ctx.register(poller.cancel);
  return {
    videoUrl: await poller.promise,
    modelUsed,
    detail: fallbackNote
      ? `The proxy fell back to its mode default: ${fallbackNote}`
      : (useImage ? 'Sent through the image-to-video route with the attached image.' : ''),
  };
}

// ---------------------------------------------------------------------------
// Kling — POST /api/generate/kling/text-to-video
//         POST /api/generate/kling/image-to-video
// ---------------------------------------------------------------------------

async function runKling(ctx: RunContext, model: LabModel, input: LabRunInput): Promise<RunResult> {
  const imageToVideo = input.images.length > 0 && model.image !== 'none';
  const submitPath = imageToVideo
    ? '/api/generate/kling/image-to-video'
    : '/api/generate/kling/text-to-video';

  const body: Record<string, unknown> = {
    model: model.modelId,
    prompt: capPromptText(input.prompt, 2500),
    // Kling duration tokens are strings ("5" / "10"), not integers.
    duration: String(input.duration),
  };
  if (input.negativePrompt.trim()) body.negativePrompt = capPromptText(input.negativePrompt, 2500);

  if (model.params.modes.length && input.mode) body.mode = input.mode;

  if (model.params.camera && input.cameraPreset && input.cameraPreset !== 'none') {
    const cameraControl = klingCameraControl(input.cameraPreset);
    if (cameraControl) body.cameraControl = cameraControl;
  }
  if (model.params.cfgScale && input.cfgScale !== undefined) {
    body.cfgScale = Math.min(1, Math.max(0, Number(input.cfgScale) || 0));
  }
  if (model.params.seed && input.seed !== null && input.seed !== undefined && Number.isFinite(Number(input.seed))) {
    body.seed = Math.trunc(Number(input.seed));
  }

  if (imageToVideo) {
    // Send inline data: URL — if Kling requires a public URL the 400 response
    // from the proxy will say so verbatim on the card. The image-to-video
    // contract has no aspectRatio field (the ratio follows the input image),
    // so it is only sent on the text-to-video route.
    body.imageData = input.images[0];
  } else {
    body.aspectRatio = input.aspectRatio;
  }

  ctx.note(`Submitting ${model.modelId} to Kling…`);
  ctx.tried(`POST ${submitPath} · model=${model.modelId}`);

  const task = await jsonFetch(submitPath, {
    method: 'POST',
    headers: workspaceHeaders(),
    body: JSON.stringify(body),
  });

  const taskId = String(task?.taskId || task?.id || task?.task_id || '');
  if (!taskId) throw new Error('Kling accepted the request but returned no task ID.');

  // The proxy never rejects an unknown model id — it falls back to its mode
  // default and notes it in modelFallback. A comparison tool must say so
  // rather than labelling the clip with the id that was asked for. This is
  // how the new kling-2.5/2.6/3.0 ids reveal whether the proxy routes them
  // as themselves or substitutes the default.
  const fallbackNote = task?.modelFallback ? String(task.modelFallback) : '';
  const modelUsed = String(task?.model || model.modelId);
  if (fallbackNote) ctx.note(`Kling model fallback: ${fallbackNote}`);

  const statusPath = `/api/generate/kling/status/${encodeURIComponent(taskId)}`;
  ctx.tried(`GET ${statusPath}`);

  const poller = pollWithInterval<string>({
    everyMs: POLL_MS,
    capMs: model.capMs,
    onNote: ctx.note,
    timeoutMessage: `Kling is still rendering after ${Math.round(model.capMs / 1000)}s. Task ID: ${taskId}.`,
    step: async (elapsed) => {
      const state = await jsonFetch(statusPath, { headers: workspaceHeaders() });
      const status = String(state?.status || '').toLowerCase();
      if (status === 'succeeded' || status === 'completed' || status === 'done') {
        const url = firstMediaUrl(state) || String(state?.videoUrl || state?.video_url || '');
        if (!url) throw new Error('Kling finished but returned no video URL.');
        return { done: true, value: url };
      }
      if (status === 'failed' || status === 'error') {
        throw new Error(`Kling ${status}: ${String(state?.errorMessage || state?.error || 'no detail')}`);
      }
      return { done: false, note: waitingNote('Kling', status, elapsed, state?.progress) };
    },
  });
  ctx.register(poller.cancel);
  return {
    videoUrl: await poller.promise,
    modelUsed,
    detail: [
      fallbackNote ? `The proxy fell back to its default model: ${fallbackNote}` : '',
      imageToVideo ? 'Sent through the image-to-video route.' : '',
      body.cameraControl ? `Camera preset: ${input.cameraPreset}.` : '',
      `Task ID: ${taskId} — paste it into Kling — Video Extend or Lip Sync to build on this clip.`,
    ].filter(Boolean).join(' '),
  };
}

// ---------------------------------------------------------------------------
// Kling Elements, Video Extend and Lip Sync. All three kick off a task and
// poll the same status route as text-to-video and image-to-video.
// ---------------------------------------------------------------------------

function readKlingKickoff(task: any, label: string, requestedModel: string) {
  const taskId = String(task?.taskId || task?.id || task?.task_id || '');
  if (!taskId) throw new Error(`${label} accepted the request but returned no task ID.`);
  return {
    taskId,
    fallbackNote: task?.modelFallback ? String(task.modelFallback) : '',
    modelUsed: String(task?.model || requestedModel),
  };
}

async function pollKlingStatus(ctx: RunContext, taskId: string, capMs: number): Promise<string> {
  const statusPath = `/api/generate/kling/status/${encodeURIComponent(taskId)}`;
  ctx.tried(`GET ${statusPath}`);
  const poller = pollWithInterval<string>({
    everyMs: POLL_MS,
    capMs,
    onNote: ctx.note,
    timeoutMessage: `Kling is still rendering after ${Math.round(capMs / 1000)}s. Task ID: ${taskId}.`,
    step: async (elapsed) => {
      const state = await jsonFetch(statusPath, { headers: workspaceHeaders() });
      const status = String(state?.status || '').toLowerCase();
      if (status === 'succeeded' || status === 'completed' || status === 'done') {
        const url = firstMediaUrl(state) || String(state?.videoUrl || state?.video_url || '');
        if (!url) throw new Error('Kling finished but returned no video URL.');
        return { done: true, value: url };
      }
      if (status === 'failed' || status === 'error') {
        throw new Error(`Kling ${status}: ${String(state?.errorMessage || state?.error || 'no detail')}`);
      }
      return { done: false, note: waitingNote('Kling', status, elapsed, state?.progress) };
    },
  });
  ctx.register(poller.cancel);
  return poller.promise;
}

/** POST /api/generate/kling/multi-image — character consistency from 2-4 references. */
async function runKlingMultiImage(ctx: RunContext, model: LabModel, input: LabRunInput): Promise<RunResult> {
  const submitPath = '/api/generate/kling/multi-image';
  if (input.images.length < 2) {
    throw new Error(`${model.name} needs 2\u2013${model.maxImages} reference images — attach at least 2 with the paperclip.`);
  }

  const body: Record<string, unknown> = {
    model: model.modelId,
    prompt: capPromptText(input.prompt, 2500),
    images: input.images.slice(0, model.maxImages).map((dataUrl) => ({
      imageData: dataUrl,
      mimeType: dataUrlMimeType(dataUrl) || 'image/png',
    })),
    duration: String(input.duration),
    aspectRatio: input.aspectRatio,
  };
  if (input.negativePrompt.trim()) body.negativePrompt = capPromptText(input.negativePrompt, 2500);
  if (model.params.modes.length && input.mode) body.mode = input.mode;

  ctx.note(`Submitting ${model.modelId} (${(body.images as unknown[]).length} references) to Kling…`);
  ctx.tried(`POST ${submitPath} · model=${model.modelId} · images=${(body.images as unknown[]).length}`);
  const task = await jsonFetch(submitPath, {
    method: 'POST',
    headers: workspaceHeaders(),
    body: JSON.stringify(body),
  });

  const { taskId, fallbackNote, modelUsed } = readKlingKickoff(task, 'Kling', model.modelId);
  if (fallbackNote) ctx.note(`Kling model fallback: ${fallbackNote}`);

  const videoUrl = await pollKlingStatus(ctx, taskId, model.capMs);
  return {
    videoUrl,
    modelUsed,
    detail: [
      fallbackNote ? `The proxy fell back to its default model: ${fallbackNote}` : '',
      `Sent ${(body.images as unknown[]).length} reference images through the multi-image (Elements) route.`,
      `Task ID: ${taskId} — paste it into Kling — Video Extend or Lip Sync to build on this clip.`,
    ].filter(Boolean).join(' '),
  };
}

/** POST /api/generate/kling/extend — lengthen a finished clip by ~5s ($0.25). */
async function runKlingExtend(ctx: RunContext, model: LabModel, input: LabRunInput): Promise<RunResult> {
  const submitPath = '/api/generate/kling/extend';
  const sourceTaskId = input.sourceTaskId.trim();
  if (!sourceTaskId) throw new Error('Video Extend needs the task ID of a finished Kling clip.');

  const body: Record<string, unknown> = { taskId: sourceTaskId };
  if (input.prompt.trim()) body.prompt = capPromptText(input.prompt, 2500);
  if (input.negativePrompt.trim()) body.negativePrompt = capPromptText(input.negativePrompt, 2500);

  ctx.note('Submitting the extend request to Kling…');
  ctx.tried(`POST ${submitPath} · taskId=${sourceTaskId}`);
  const task = await jsonFetch(submitPath, {
    method: 'POST',
    headers: workspaceHeaders(),
    body: JSON.stringify(body),
  });

  const { taskId, modelUsed } = readKlingKickoff(task, 'Kling', `extend of ${sourceTaskId}`);
  const videoUrl = await pollKlingStatus(ctx, taskId, model.capMs);
  return {
    videoUrl,
    modelUsed,
    detail: `Extended clip ${sourceTaskId}. New task ID: ${taskId} — paste it to extend or lip sync again.`,
  };
}

/** POST /api/generate/kling/lip-sync — add speech to a finished clip ($0.25). */
async function runKlingLipSync(ctx: RunContext, model: LabModel, input: LabRunInput): Promise<RunResult> {
  const submitPath = '/api/generate/kling/lip-sync';
  const sourceTaskId = input.sourceTaskId.trim();
  if (!sourceTaskId) throw new Error('Lip Sync needs the task ID of a finished Kling clip.');
  const text = input.lipSyncText.trim();
  const audioUrl = input.lipSyncAudioUrl.trim();
  if (!text && !audioUrl) throw new Error('Lip Sync needs either text to speak or an audio URL.');

  const body: Record<string, unknown> = { taskId: sourceTaskId };
  if (text) body.text = text;
  if (audioUrl) body.audioUrl = audioUrl;
  if (input.voiceId.trim()) body.voiceId = input.voiceId.trim();
  if (input.language.trim()) body.language = input.language.trim();
  if (model.params.voiceSpeed && text && Number.isFinite(Number(input.voiceSpeed))) {
    body.speed = Number(input.voiceSpeed);
  }

  ctx.note('Submitting the lip-sync request to Kling…');
  ctx.tried(`POST ${submitPath} · taskId=${sourceTaskId}`);
  const task = await jsonFetch(submitPath, {
    method: 'POST',
    headers: workspaceHeaders(),
    body: JSON.stringify(body),
  });

  const { taskId, modelUsed } = readKlingKickoff(task, 'Kling', `lip-sync of ${sourceTaskId}`);
  const videoUrl = await pollKlingStatus(ctx, taskId, model.capMs);
  return {
    videoUrl,
    modelUsed,
    detail: `Lip-synced clip ${sourceTaskId} from ${audioUrl && !text ? 'an audio URL' : 'text-to-speech'}. New task ID: ${taskId}.`,
  };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export function runLabModel(model: LabModel, input: LabRunInput, ctx: RunContext): Promise<RunResult> {
  switch (model.runner) {
    case 'group-a': return runGroupA(ctx, model, input);
    case 'veo-managed': return runVeoManaged(ctx, model, input);
    case 'runway': return runRunway(ctx, model, input);
    case 'higgsfield': return runHiggsfield(ctx, model, input);
    case 'kling':
      if (model.params.extend) return runKlingExtend(ctx, model, input);
      if (model.params.lipSync) return runKlingLipSync(ctx, model, input);
      if (model.params.multiImage) return runKlingMultiImage(ctx, model, input);
      return runKling(ctx, model, input);
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
