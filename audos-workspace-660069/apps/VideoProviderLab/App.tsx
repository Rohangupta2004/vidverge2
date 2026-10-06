/**
 * VIDEO PROVIDER LAB — a developer test panel.
 *
 * One shared prompt, one card per native video provider, each card running its
 * OWN independent submit -> poll -> play cycle. No provider key, environment
 * variable or BYOK secret appears here or reaches the browser: every request
 * goes to a same-origin /api path where the platform adds the provider
 * credential server-side and bills the workspace wallet.
 *
 * Provider contracts, verified against the platform integration docs:
 *   Veo 3 Fast / Seedance  POST /api/veo/generate/video            -> GET /api/veo/status/:operationId
 *   Runway Gen-4.5         POST /api/generate/runway/quote (free, unauthenticated)
 *                          POST /api/generate/runway/video         -> GET /api/generate/runway/status/:taskId
 *   Kling v1.5             POST /api/generate/kling/text-to-video  -> GET /api/generate/kling/status/:taskId
 *   Higgsfield             POST /api/generate/higgsfield/video     -> GET /api/generate/higgsfield/status/:requestId
 *   HeyGen                 POST /api/workspaces/:id/provider-credentials/heygen/proxy/v3/videos
 *                                                                  -> GET  (same base)/v3/videos/:videoId
 *
 * Two model ids in the brief are not in the proxy's documented enum
 * (veo-3.0-fast-generate-preview, openrouter/bytedance/seedance-2.5), so those
 * two cards walk a small ladder: the requested id first, then the documented
 * id, and the card reports which one the proxy actually accepted.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import {
  AlertCircle, CheckCircle2, Clapperboard, Clock, Download, Film, FlaskConical,
  Mountain, Play, Sparkles, Terminal, Users, Waves,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * The platform injects __workspaceDb into the page, so these are read per
 * request rather than snapshotted at module load — a snapshot taken before the
 * injection lands would send every call out with no credential.
 */
function wsDb(): any {
  return typeof window === 'undefined' ? null : (window as any).__workspaceDb;
}

function workspaceId(): string {
  const w = typeof window === 'undefined' ? null : (window as any);
  return String(wsDb()?.workspaceId || w?.__WORKSPACE_ID__ || '');
}

function workspaceHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = wsDb()?.token;
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'X-Workspace-DB-Token': String(token) } : {}),
    ...(extra || {}),
  };
}

/** Carries the status code and path so a card can label a 402 or a 404 exactly. */
class RequestError extends Error {
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
      data?.error?.message || data?.error || data?.message || `Request failed: ${response.status}`,
      response.status,
      url,
    );
  }
  return data;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  const text = String(error ?? '');
  return text && text !== '[object Object]' ? text : 'Something went wrong.';
}

function describeError(error: unknown, tried: string[]): string {
  if (error instanceof RequestError) {
    if (error.status === 402) {
      return 'Insufficient wallet balance. Top up the workspace wallet, then run this card again.';
    }
    if (error.status === 404) {
      const paths = tried.length ? tried.join('\n') : error.path;
      return `404 Not Found. Paths tried:\n${paths}\n\nLast message: ${error.message}`;
    }
    if (error.status === 401) {
      return `401 Unauthorized — this page sent no workspace credential. Reload the space and retry. (${error.message})`;
    }
    if (error.status === 403) {
      return `403 Forbidden — this workspace is not allowed to bill that provider. (${error.message})`;
    }
    if (error.status === 429) {
      return `429 Rate limited — wait a moment and retry. (${error.message})`;
    }
    if (error.status === 503) {
      return `503 — that provider is not enabled on this platform, so it cannot be called. (${error.message})`;
    }
    return `${error.message} (HTTP ${error.status} · ${error.path})`;
  }
  return errorText(error);
}

function idempotencyKey(): string {
  const c = (typeof crypto !== 'undefined' ? crypto : undefined) as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
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

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

const POLL_MS = 5000;
const DEFAULT_CAP_MS = 120000;
const CANCELLED = 'Stopped polling.';

interface PollStep<T> {
  done: boolean;
  value?: T;
  note?: string;
}

/**
 * A setInterval poller wrapped in a promise. The interval is cleared the moment
 * the job settles, times out or is cancelled, and the cancel function is handed
 * back to the card so unmounting the panel stops every live poll.
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
  const pct = Number(progress);
  const shown = Number.isFinite(pct) && pct > 0 ? ` ${Math.min(99, Math.round(pct))}%` : '';
  return `${label} is ${status || 'working'}…${shown} (${Math.round(elapsedMs / 1000)}s)`;
}

// ---------------------------------------------------------------------------
// Provider runners
// ---------------------------------------------------------------------------

interface RunContext {
  prompt: string;
  note: (text: string) => void;
  tried: (path: string) => void;
  register: (cancel: () => void) => void;
}

interface RunResult {
  videoUrl: string;
  modelUsed: string;
  detail?: string;
}

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

/**
 * Veo and Seedance share the one video proxy. `models` is a ladder: a 400 from
 * the proxy's model enum falls through to the next id, and the card reports
 * which one was accepted instead of claiming the first.
 */
async function runVeoFamily(ctx: RunContext, models: string[], label: string, capMs: number): Promise<RunResult> {
  const path = '/api/veo/generate/video';
  let lastError: unknown = null;

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    ctx.note(`Submitting ${model}…`);
    ctx.tried(`POST ${path} · model=${model}`);

    let start: any = null;
    try {
      start = await jsonFetch(path, {
        method: 'POST',
        headers: workspaceHeaders(),
        body: JSON.stringify({
          model,
          prompt: ctx.prompt,
          aspectRatio: '16:9',
          duration: 5,
        }),
      });
    } catch (error) {
      lastError = error;
      const status = error instanceof RequestError ? error.status : 0;
      if ((status === 400 || status === 404) && index < models.length - 1) {
        ctx.note(`The proxy rejected "${model}" — trying the next model id…`);
        continue;
      }
      throw error;
    }

    const operationId = String(start?.operationId || '');
    if (!operationId) {
      throw new Error(`${label} accepted the request but returned no operationId.`);
    }
    // The proxy has been seen answering 200 with a synthetic already-failed id.
    if (/_error_/.test(operationId)) {
      lastError = new Error(`${label} rejected the job upstream (${operationId}).`);
      if (index < models.length - 1) {
        ctx.note('The job was rejected upstream — trying the next model id…');
        continue;
      }
      throw lastError;
    }

    const videoUrl = await pollVeoStatus(ctx, operationId, label, capMs);
    return {
      videoUrl,
      modelUsed: model,
      detail: index === 0 ? '' : `"${models[0]}" was rejected by the proxy, so this ran on "${model}".`,
    };
  }

  throw lastError instanceof Error ? lastError : new Error(`${label} rejected every model id tried.`);
}

async function runRunway(ctx: RunContext, capMs: number): Promise<RunResult> {
  const body = { model: 'gen4.5', promptText: ctx.prompt, ratio: '1280:720', duration: 5 };
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
  ctx.tried('POST /api/generate/runway/video');
  const task = await jsonFetch('/api/generate/runway/video', {
    method: 'POST',
    headers: workspaceHeaders({ 'Idempotency-Key': idempotencyKey() }),
    body: JSON.stringify(body),
  });

  if (String(task?.status || '') === 'uncertain') {
    throw new Error('Runway cannot confirm this job either way. Do NOT resubmit — check Runway usage before trying again.');
  }

  const immediate = firstMediaUrl(task);
  if (immediate) return { videoUrl: immediate, modelUsed: 'gen4.5', detail };

  const taskId = String(task?.taskId || task?.id || '');
  if (!taskId) {
    throw new Error('Runway accepted the request but returned neither a taskId nor a media URL.');
  }

  const path = `/api/generate/runway/status/${encodeURIComponent(taskId)}`;
  ctx.tried(`GET ${path}`);
  const poller = pollWithInterval<string>({
    everyMs: POLL_MS,
    capMs,
    onNote: ctx.note,
    timeoutMessage: `Runway is still working after ${Math.round(capMs / 1000)}s. Task ${taskId} may still finish — poll it again rather than resubmitting.`,
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
  return { videoUrl: await poller.promise, modelUsed: 'gen4.5', detail };
}

async function runKling(ctx: RunContext, capMs: number): Promise<RunResult> {
  const model = 'kling-v1-5';
  ctx.note('Submitting to Kling…');
  ctx.tried('POST /api/generate/kling/text-to-video');
  const start = await jsonFetch('/api/generate/kling/text-to-video', {
    method: 'POST',
    headers: workspaceHeaders(),
    body: JSON.stringify({
      prompt: ctx.prompt,
      model,
      mode: 'std',
      duration: '5',
      aspectRatio: '16:9',
    }),
  });

  const taskId = String(start?.taskId || '');
  if (!taskId) throw new Error('Kling accepted the request but returned no taskId.');
  const detail = start?.modelFallback ? `Kling fell back: ${String(start.modelFallback)}` : '';

  const path = `/api/generate/kling/status/${encodeURIComponent(taskId)}`;
  ctx.tried(`GET ${path}`);
  const poller = pollWithInterval<string>({
    everyMs: POLL_MS,
    capMs,
    onNote: ctx.note,
    timeoutMessage: `Kling is still working after ${Math.round(capMs / 1000)}s. Task ${taskId} may still finish.`,
    step: async (elapsed) => {
      const state = await jsonFetch(path, { headers: workspaceHeaders() });
      const status = String(state?.status || '');
      if (status === 'failed') {
        throw new Error(String(state?.errorMessage || 'Kling reported the generation failed.'));
      }
      if (status === 'completed') {
        const url = String(state?.videoUrl || '');
        if (!url) throw new Error('Kling completed but returned no videoUrl.');
        return { done: true, value: url };
      }
      return { done: false, note: waitingNote('Kling', status, elapsed) };
    },
  });
  ctx.register(poller.cancel);
  return { videoUrl: await poller.promise, modelUsed: model, detail };
}

async function runHiggsfield(ctx: RunContext, capMs: number): Promise<RunResult> {
  // The first entry is the documented text-to-video contract. The two after it
  // are the fallbacks named in the brief, kept so a 404 reports every path
  // tried rather than only the first.
  const candidates = [
    { path: '/api/generate/higgsfield/video', body: { prompt: ctx.prompt, model: 'minimax-hailuo-02', aspectRatio: '16:9', durationSeconds: 5 } },
    { path: '/api/generate/higgsfield/text-to-video', body: { prompt: ctx.prompt, aspectRatio: '16:9', duration: 5 } },
    { path: '/api/higgsfield/video', body: { prompt: ctx.prompt, aspectRatio: '16:9', duration: 5 } },
  ];

  let start: any = null;
  let model = '';
  let lastError: unknown = null;

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    ctx.note(`Submitting to Higgsfield via ${candidate.path}…`);
    ctx.tried(`POST ${candidate.path}`);
    try {
      start = await jsonFetch(candidate.path, {
        method: 'POST',
        headers: workspaceHeaders(),
        body: JSON.stringify(candidate.body),
      });
      model = String((candidate.body as any).model || 'minimax-hailuo-02');
      break;
    } catch (error) {
      lastError = error;
      const status = error instanceof RequestError ? error.status : 0;
      if (status === 404 && index < candidates.length - 1) {
        ctx.note(`${candidate.path} answered 404 — trying the next candidate path…`);
        continue;
      }
      throw error;
    }
  }

  if (!start) {
    throw lastError instanceof Error
      ? lastError
      : new Error('Higgsfield: endpoint discovery needed — every candidate path answered 404.');
  }

  const requestId = String(start?.requestId || start?.taskId || '');
  if (!requestId) throw new Error('Higgsfield accepted the request but returned no requestId.');
  const detail = start?.modelFallback ? `Higgsfield fell back: ${String(start.modelFallback)}` : '';

  const path = `/api/generate/higgsfield/status/${encodeURIComponent(requestId)}`;
  ctx.tried(`GET ${path}`);
  const poller = pollWithInterval<string>({
    everyMs: POLL_MS,
    capMs,
    onNote: ctx.note,
    timeoutMessage: `Higgsfield is still working after ${Math.round(capMs / 1000)}s. Request ${requestId} may still finish.`,
    step: async (elapsed) => {
      const state = await jsonFetch(path, { headers: workspaceHeaders() });
      const status = String(state?.status || '');
      if (status === 'nsfw') {
        throw new Error('Higgsfield moderation rejected that prompt. Reword it and try again.');
      }
      if (status === 'failed') {
        throw new Error(String(state?.errorMessage || 'Higgsfield reported the generation failed.'));
      }
      if (status === 'completed') {
        const url = String(state?.videoUrl || state?.images?.[0]?.url || '');
        if (!url) throw new Error('Higgsfield completed but returned no videoUrl.');
        return { done: true, value: url };
      }
      return { done: false, note: waitingNote('Higgsfield', status, elapsed) };
    },
  });
  ctx.register(poller.cancel);
  return { videoUrl: await poller.promise, modelUsed: model, detail };
}

async function runHeyGen(ctx: RunContext, capMs: number): Promise<RunResult> {
  const id = workspaceId();
  if (!id) {
    throw new Error('This page exposed no workspace id, so the HeyGen proxy path cannot be built. Reload the space and retry.');
  }
  const base = `/api/workspaces/${id}/provider-credentials/heygen/proxy`;

  ctx.note('Loading HeyGen avatar looks…');
  const looksPath = `${base}/v3/avatars/looks?limit=50`;
  ctx.tried(`GET ${looksPath}`);
  const looks = await jsonFetch(looksPath);
  const list: any[] = Array.isArray(looks?.data) ? looks.data : [];
  // Prefer a look that carries both a default voice and a usable v3 engine.
  const look = list.filter((entry) => entry?.default_voice_id
    && Array.isArray(entry?.supported_api_engines)
    && entry.supported_api_engines.length)[0] || list[0];
  if (!look) throw new Error('No HeyGen avatar looks found');

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
  ctx.tried(`POST ${base}/v3/videos`);
  const created = await jsonFetch(`${base}/v3/videos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'avatar',
      avatar_id: look.id,
      engine: { type: engine },
      script: ctx.prompt.slice(0, 200),
      voice_id: look.default_voice_id,
      resolution: '720p',
      aspect_ratio: '16:9',
      fit: 'cover',
      output_format: 'mp4',
    }),
  });

  const detail = `Avatar ${String(look.id)} · engine ${engine}`;
  const immediate = String(created?.data?.video_url || created?.video_url || '');
  if (immediate) return { videoUrl: immediate, modelUsed: `heygen/${engine}`, detail };

  const videoId = String(created?.data?.video_id || created?.video_id || '');
  if (!videoId) throw new Error('HeyGen did not return data.video_id.');

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
  return { videoUrl: await poller.promise, modelUsed: `heygen/${engine}`, detail };
}

// ---------------------------------------------------------------------------
// Provider catalog
// ---------------------------------------------------------------------------

// Higgsfield's own docs put text-to-video at 1–5 minutes and a HeyGen avatar
// render regularly runs past two, so those two carry a longer cap than the
// 2:00 the other four use — a cap below the provider's own stated render time
// would time out jobs that were going to succeed.
const HIGGSFIELD_CAP_MS = 300000;
const HEYGEN_CAP_MS = 240000;

interface ProviderDef {
  id: string;
  name: string;
  vendor: string;
  Icon: ComponentType<any>;
  tint: string;
  endpoint: string;
  run: (ctx: RunContext) => Promise<RunResult>;
}

const PROVIDERS: ProviderDef[] = [
  {
    id: 'veo3',
    name: 'Google Veo 3 Fast',
    vendor: 'Google · platform video proxy',
    Icon: Film,
    tint: '#6c63ff',
    endpoint: 'POST /api/veo/generate/video',
    run: (ctx) => runVeoFamily(
      ctx,
      ['veo-3.0-fast-generate-preview', 'veo-3.0-fast-generate-001', 'veo-3.1-fast-generate-preview'],
      'Veo 3 Fast',
      DEFAULT_CAP_MS,
    ),
  },
  {
    id: 'seedance',
    name: 'Seedance 2.5',
    vendor: 'ByteDance via OpenRouter',
    Icon: Waves,
    tint: '#2dd4bf',
    endpoint: 'POST /api/veo/generate/video',
    run: (ctx) => runVeoFamily(
      ctx,
      ['openrouter/bytedance/seedance-2.5', 'openrouter/bytedance/seedance-2.0-fast'],
      'Seedance',
      DEFAULT_CAP_MS,
    ),
  },
  {
    id: 'runway',
    name: 'Runway Gen-4.5',
    vendor: 'Runway · quoted before billing',
    Icon: Clapperboard,
    tint: '#a78bfa',
    endpoint: 'POST /api/generate/runway/video',
    run: (ctx) => runRunway(ctx, DEFAULT_CAP_MS),
  },
  {
    id: 'kling',
    name: 'Kling v1.5',
    vendor: 'Kling AI · std mode, 5s',
    Icon: Sparkles,
    tint: '#f59e0b',
    endpoint: 'POST /api/generate/kling/text-to-video',
    run: (ctx) => runKling(ctx, DEFAULT_CAP_MS),
  },
  {
    id: 'higgsfield',
    name: 'Higgsfield Media',
    vendor: 'MiniMax Hailuo 02',
    Icon: Mountain,
    tint: '#38bdf8',
    endpoint: 'POST /api/generate/higgsfield/video',
    run: (ctx) => runHiggsfield(ctx, HIGGSFIELD_CAP_MS),
  },
  {
    id: 'heygen',
    name: 'HeyGen Avatar',
    vendor: 'Text-only avatar · v3',
    Icon: Users,
    tint: '#34d399',
    endpoint: 'POST …/heygen/proxy/v3/videos',
    run: (ctx) => runHeyGen(ctx, HEYGEN_CAP_MS),
  },
];

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

const C = {
  bg: '#0a0a0a',
  card: '#111111',
  raised: '#171717',
  line: '#242424',
  lineStrong: '#343434',
  accent: '#6c63ff',
  ink: '#f4f4f5',
  soft: '#c9c9d1',
  muted: '#86868f',
  good: '#22c55e',
  bad: '#f87171',
  warn: '#fbbf24',
};
const FONT = "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const DEFAULT_PROMPT = 'A cinematic AI video showcase, 5 seconds';
const MIN_PROMPT = 10;
const STYLE_ID = 'video-provider-lab-styles';

type Phase = 'idle' | 'generating' | 'done' | 'error';

interface CardState {
  phase: Phase;
  note: string;
  videoUrl: string;
  modelUsed: string;
  detail: string;
  error: string;
  tried: string[];
  startedAt: number;
  finishedMs: number;
}

const BLANK: CardState = {
  phase: 'idle',
  note: '',
  videoUrl: '',
  modelUsed: '',
  detail: '',
  error: '',
  tried: [],
  startedAt: 0,
  finishedMs: 0,
};

const PHASE_LABEL: Record<Phase, string> = {
  idle: 'Idle',
  generating: 'Generating',
  done: 'Done',
  error: 'Error',
};

function phaseColor(phase: Phase): string {
  if (phase === 'generating') return C.accent;
  if (phase === 'done') return C.good;
  if (phase === 'error') return C.bad;
  return C.muted;
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

function useLabStyles() {
  useEffect(() => {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '@keyframes vpl-spin { to { transform: rotate(360deg); } }',
      '@keyframes vpl-pulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }',
      '.vpl-btn { transition: filter 120ms ease, transform 120ms ease; }',
      '.vpl-btn:hover:not(:disabled) { filter: brightness(1.15); }',
      '.vpl-btn:active:not(:disabled) { transform: translateY(1px); }',
      '.vpl-btn:disabled { opacity: 0.4; cursor: not-allowed; }',
      '.vpl-scroll::-webkit-scrollbar { height: 6px; width: 6px; }',
      '.vpl-scroll::-webkit-scrollbar-thumb { background: #343434; border-radius: 99px; }',
    ].join('\n');
    document.head.appendChild(style);
  }, []);
}

function Badge({ phase }: { phase: Phase }) {
  const color = phaseColor(phase);
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.6,
        textTransform: 'uppercase',
        color,
        background: `${color}1f`,
        border: `1px solid ${color}55`,
        borderRadius: 999,
        padding: '3px 9px',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 99,
          background: color,
          animation: phase === 'generating' ? 'vpl-pulse 1.1s ease-in-out infinite' : undefined,
        }}
      />
      {PHASE_LABEL[phase]}
    </span>
  );
}

function Spinner({ color }: { color: string }) {
  return (
    <span
      style={{
        width: 12,
        height: 12,
        borderRadius: 99,
        border: `2px solid ${color}33`,
        borderTopColor: color,
        display: 'inline-block',
        animation: 'vpl-spin 0.8s linear infinite',
      }}
    />
  );
}

export default function App() {
  useLabStyles();

  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [cards, setCards] = useState<Record<string, CardState>>(() => {
    const seed: Record<string, CardState> = {};
    PROVIDERS.forEach((provider) => { seed[provider.id] = BLANK; });
    return seed;
  });
  const [tick, setTick] = useState(0);

  const mounted = useRef(true);
  const cancels = useRef<Record<string, Array<() => void>>>({});

  const stopPolling = useCallback((id?: string) => {
    const ids = id ? [id] : Object.keys(cancels.current);
    ids.forEach((key) => {
      (cancels.current[key] || []).forEach((fn) => {
        try { fn(); } catch { /* already settled */ }
      });
      cancels.current[key] = [];
    });
  }, []);

  useEffect(() => () => {
    mounted.current = false;
    stopPolling();
  }, [stopPolling]);

  const runningCount = useMemo(
    () => PROVIDERS.filter((provider) => cards[provider.id]?.phase === 'generating').length,
    [cards],
  );

  // One shared heartbeat drives every card's elapsed timer, so six concurrent
  // runs do not carry six intervals.
  useEffect(() => {
    if (!runningCount) return undefined;
    const id = window.setInterval(() => {
      if (mounted.current) setTick((value) => value + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [runningCount]);

  const now = useMemo(() => Date.now(), [tick, runningCount]);

  const patch = useCallback((id: string, next: Partial<CardState>) => {
    if (!mounted.current) return;
    setCards((prev) => ({ ...prev, [id]: { ...prev[id], ...next } }));
  }, []);

  const generate = useCallback(async (provider: ProviderDef) => {
    const text = prompt.trim();
    if (text.length < MIN_PROMPT) return;

    stopPolling(provider.id);
    const startedAt = Date.now();
    patch(provider.id, { ...BLANK, phase: 'generating', note: 'Starting…', startedAt });

    const triedPaths: string[] = [];
    const ctx: RunContext = {
      prompt: text,
      note: (note) => patch(provider.id, { note }),
      tried: (path) => {
        if (triedPaths.indexOf(path) === -1) triedPaths.push(path);
        patch(provider.id, { tried: triedPaths.slice() });
      },
      register: (cancel) => {
        if (!cancels.current[provider.id]) cancels.current[provider.id] = [];
        cancels.current[provider.id].push(cancel);
      },
    };

    // Each card owns its own try/catch, so one provider failing never takes the
    // panel — or any other card — down with it.
    try {
      const result = await provider.run(ctx);
      patch(provider.id, {
        phase: 'done',
        note: '',
        videoUrl: result.videoUrl,
        modelUsed: result.modelUsed,
        detail: result.detail || '',
        finishedMs: Date.now() - startedAt,
      });
    } catch (error) {
      if (errorText(error) === CANCELLED) {
        patch(provider.id, { ...BLANK });
      } else {
        patch(provider.id, {
          phase: 'error',
          note: '',
          error: describeError(error, triedPaths),
          finishedMs: Date.now() - startedAt,
        });
      }
    } finally {
      cancels.current[provider.id] = [];
    }
  }, [patch, prompt, stopPolling]);

  const generateAll = useCallback(() => {
    PROVIDERS.forEach((provider) => { void generate(provider); });
  }, [generate]);

  const resetAll = useCallback(() => {
    stopPolling();
    const seed: Record<string, CardState> = {};
    PROVIDERS.forEach((provider) => { seed[provider.id] = BLANK; });
    setCards(seed);
  }, [stopPolling]);

  const promptReady = prompt.trim().length >= MIN_PROMPT;
  const hasToken = Boolean(wsDb()?.token);
  const spaceWorkspaceId = workspaceId();

  return (
    <div style={{ minHeight: '100%', background: C.bg, color: C.ink, fontFamily: FONT }}>
      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '28px 22px 56px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: `${C.accent}1f`,
              border: `1px solid ${C.accent}55`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <FlaskConical size={22} color={C.accent} />
          </div>
          <div style={{ minWidth: 260, flex: 1 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: -0.2 }}>
              Video Provider Lab
            </h1>
            <p style={{ margin: '6px 0 0', fontSize: 13.5, color: C.soft, lineHeight: 1.65, maxWidth: 800 }}>
              A developer test panel. One prompt, six native video providers, each card submitting and
              polling on its own so a slow render or a hard failure never blocks the others. Every call goes
              through the Audos platform proxy — no API key, no environment variable and no BYOK secret
              appears in this app or reaches the browser. Generations bill the workspace wallet.
            </p>
          </div>
        </div>

        {/* Credential strip */}
        <div
          style={{
            marginTop: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            background: C.card,
            border: `1px solid ${C.line}`,
            borderRadius: 10,
            padding: '10px 13px',
            fontSize: 11.5,
            color: C.muted,
            fontFamily: MONO,
            wordBreak: 'break-all',
          }}
        >
          <Terminal size={14} color={C.muted} />
          <span style={{ color: hasToken ? C.good : C.bad }}>
            X-Workspace-DB-Token {hasToken ? 'present' : 'MISSING'}
          </span>
          <span style={{ color: C.lineStrong }}>|</span>
          <span style={{ color: spaceWorkspaceId ? C.good : C.warn }}>
            workspaceId {spaceWorkspaceId || 'missing — the HeyGen card cannot build its proxy path'}
          </span>
        </div>

        {/* Shared prompt */}
        <div
          style={{
            marginTop: 16,
            background: C.card,
            border: `1px solid ${C.line}`,
            borderRadius: 14,
            padding: 16,
          }}
        >
          <label
            htmlFor="vpl-prompt"
            style={{
              display: 'block',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.7,
              textTransform: 'uppercase',
              color: C.muted,
              marginBottom: 8,
            }}
          >
            Shared prompt — used by every provider
          </label>
          <textarea
            id="vpl-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={3}
            spellCheck={false}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              resize: 'vertical',
              background: C.bg,
              color: C.ink,
              border: `1px solid ${C.lineStrong}`,
              borderRadius: 10,
              padding: '11px 13px',
              fontSize: 14,
              lineHeight: 1.6,
              fontFamily: FONT,
              outline: 'none',
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="vpl-btn"
              onClick={generateAll}
              disabled={!promptReady}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                background: C.accent,
                color: '#ffffff',
                border: 'none',
                borderRadius: 9,
                padding: '9px 16px',
                fontSize: 13,
                fontWeight: 700,
                fontFamily: FONT,
                cursor: 'pointer',
              }}
            >
              <Play size={14} /> Generate on all {PROVIDERS.length}
            </button>
            <button
              type="button"
              className="vpl-btn"
              onClick={resetAll}
              style={{
                background: 'transparent',
                color: C.soft,
                border: `1px solid ${C.lineStrong}`,
                borderRadius: 9,
                padding: '9px 16px',
                fontSize: 13,
                fontWeight: 600,
                fontFamily: FONT,
                cursor: 'pointer',
              }}
            >
              Reset panel
            </button>
            <span style={{ fontSize: 12, color: promptReady ? C.muted : C.warn, lineHeight: 1.5 }}>
              {promptReady
                ? `${prompt.trim().length} characters · ${runningCount} running`
                : `Every provider rejects a prompt under ${MIN_PROMPT} characters.`}
            </span>
          </div>
        </div>

        {/* Provider grid */}
        <div
          style={{
            marginTop: 18,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
            gap: 14,
            alignItems: 'start',
          }}
        >
          {PROVIDERS.map((provider) => {
            const state = cards[provider.id] || BLANK;
            const elapsedMs = state.phase === 'generating'
              ? Math.max(0, now - state.startedAt)
              : state.finishedMs;
            const Icon = provider.Icon;

            return (
              <div
                key={provider.id}
                style={{
                  background: C.card,
                  border: `1px solid ${state.phase === 'generating' ? `${provider.tint}66` : C.line}`,
                  borderRadius: 14,
                  padding: 15,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 11,
                }}
              >
                {/* Identity */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 9,
                      background: `${provider.tint}1f`,
                      border: `1px solid ${provider.tint}44`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Icon size={17} color={provider.tint} />
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700, lineHeight: 1.3 }}>{provider.name}</div>
                    <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>{provider.vendor}</div>
                  </div>
                </div>

                {/* Status */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Badge phase={state.phase} />
                  {state.phase !== 'idle' ? (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        fontSize: 11.5,
                        color: C.muted,
                        fontFamily: MONO,
                      }}
                    >
                      <Clock size={12} /> {formatClock(elapsedMs)}
                    </span>
                  ) : null}
                  {state.phase === 'generating' ? <Spinner color={provider.tint} /> : null}
                </div>

                {/* Endpoint */}
                <div
                  className="vpl-scroll"
                  style={{
                    fontFamily: MONO,
                    fontSize: 10.5,
                    color: C.muted,
                    background: C.bg,
                    border: `1px solid ${C.line}`,
                    borderRadius: 8,
                    padding: '7px 9px',
                    overflowX: 'auto',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {provider.endpoint}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="vpl-btn"
                    onClick={() => { void generate(provider); }}
                    disabled={!promptReady || state.phase === 'generating'}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      background: state.phase === 'generating' ? C.raised : provider.tint,
                      color: state.phase === 'generating' ? C.muted : '#0a0a0a',
                      border: 'none',
                      borderRadius: 8,
                      padding: '8px 14px',
                      fontSize: 12.5,
                      fontWeight: 700,
                      fontFamily: FONT,
                      cursor: 'pointer',
                    }}
                  >
                    <Play size={13} />
                    {state.phase === 'generating'
                      ? 'Generating…'
                      : state.phase === 'idle' ? 'Generate' : 'Generate again'}
                  </button>
                  {state.phase === 'generating' ? (
                    <button
                      type="button"
                      className="vpl-btn"
                      onClick={() => stopPolling(provider.id)}
                      title="Stops this card polling. The provider keeps rendering and the wallet charge stands."
                      style={{
                        background: 'transparent',
                        color: C.soft,
                        border: `1px solid ${C.lineStrong}`,
                        borderRadius: 8,
                        padding: '8px 14px',
                        fontSize: 12.5,
                        fontWeight: 600,
                        fontFamily: FONT,
                        cursor: 'pointer',
                      }}
                    >
                      Stop polling
                    </button>
                  ) : null}
                </div>

                {/* Live note */}
                {state.phase === 'generating' && state.note ? (
                  <div style={{ fontSize: 12, color: C.soft, lineHeight: 1.55 }}>{state.note}</div>
                ) : null}

                {/* Result */}
                {state.phase === 'done' && state.videoUrl ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                    <video
                      src={state.videoUrl}
                      controls
                      playsInline
                      preload="metadata"
                      style={{
                        width: '100%',
                        borderRadius: 10,
                        background: '#000000',
                        border: `1px solid ${C.line}`,
                        display: 'block',
                      }}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <CheckCircle2 size={13} color={C.good} />
                      <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO, wordBreak: 'break-all' }}>
                        {state.modelUsed}
                      </span>
                      <a
                        href={state.videoUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          marginLeft: 'auto',
                          fontSize: 12,
                          fontWeight: 600,
                          color: provider.tint,
                          textDecoration: 'none',
                        }}
                      >
                        <Download size={13} /> MP4
                      </a>
                    </div>
                    {state.detail ? (
                      <div style={{ fontSize: 11.5, color: C.warn, lineHeight: 1.55 }}>{state.detail}</div>
                    ) : null}
                  </div>
                ) : null}

                {/* Error */}
                {state.phase === 'error' ? (
                  <div
                    style={{
                      background: `${C.bad}14`,
                      border: `1px solid ${C.bad}44`,
                      borderRadius: 9,
                      padding: '9px 11px',
                      display: 'flex',
                      gap: 8,
                    }}
                  >
                    <AlertCircle size={14} color={C.bad} style={{ flexShrink: 0, marginTop: 2 }} />
                    <div
                      style={{
                        fontSize: 11.5,
                        color: '#fca5a5',
                        lineHeight: 1.6,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        fontFamily: MONO,
                      }}
                    >
                      {state.error}
                    </div>
                  </div>
                ) : null}

                {/* The exact requests made — the point of a provider lab */}
                {state.tried.length ? (
                  <details style={{ fontSize: 11 }}>
                    <summary style={{ color: C.muted, cursor: 'pointer', outline: 'none' }}>
                      {state.tried.length} request{state.tried.length === 1 ? '' : 's'} made
                    </summary>
                    <div
                      className="vpl-scroll"
                      style={{
                        marginTop: 7,
                        fontFamily: MONO,
                        fontSize: 10.5,
                        color: C.muted,
                        lineHeight: 1.75,
                        maxHeight: 128,
                        overflow: 'auto',
                        wordBreak: 'break-all',
                      }}
                    >
                      {state.tried.map((path) => (
                        <div key={path}>{path}</div>
                      ))}
                    </div>
                  </details>
                ) : null}
              </div>
            );
          })}
        </div>

        <p style={{ marginTop: 22, fontSize: 11.5, color: C.muted, lineHeight: 1.7, maxWidth: 880 }}>
          Polling runs every 5s on a setInterval that is cleared on completion, on “Stop polling” and on
          unmount. Veo, Seedance, Runway and Kling give up after 2:00; Higgsfield (whose own docs quote 1–5
          minutes) after 5:00 and HeyGen after 4:00. A timeout does not cancel the provider’s job or refund
          the wallet — it only stops this panel waiting, and the card prints the id to poll again.
        </p>
      </div>
    </div>
  );
}
