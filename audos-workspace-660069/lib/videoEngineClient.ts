/**
 * VIDEO ENGINE CLIENT — the shared network layer every VidVerge app uses to
 * talk to the platform's generation proxies.
 *
 *  GROUP A  POST /api/veo/generate/video          (standard app session —
 *           Content-Type only; no extra token header needed)
 *           GET  /api/veo/status/:operationId      poll every 5s
 *
 *  RUNWAY   POST /api/generate/runway/video        (X-Workspace-DB-Token +
 *           POST /api/generate/runway/recipes/:id   fresh Idempotency-Key)
 *           GET  /api/generate/runway/status/:id    poll every 5s (with token)
 *
 * Error contract implemented here for every surface:
 *   400 → name the offending field from the Zod `details` array
 *   401 → session problem            402 → wallet too low (link to wallet)
 *   429 → absorbed here (auto-retried); never blocks a submit
 *   502 → transient, safe to retry
 *   503 → provider not enabled ("Runway generation is being enabled — check back soon.")
 * `uncertain` Runway status → do NOT resubmit. failed/cancelled → auto-refund.
 *
 * Generation is deliberately UNGATED: there is no cooldown, no quote step and
 * no credit check between the user pressing Generate and the provider call.
 */

import { RUNWAY_DISABLED_MESSAGE, capPromptText, groupAModel, validateGroupAInputs } from './videoEngines';

export class EngineError extends Error {
  code: string;
  status: number;
  /** True when an identical retry can plausibly succeed (429/502/network). */
  retryable: boolean;
  retryAfterSeconds?: number;
  /** The raw provider/proxy payload, kept so a rejection can be diagnosed. */
  detail?: unknown;
  constructor(message: string, opts: { code?: string; status?: number; retryable?: boolean; retryAfterSeconds?: number; detail?: unknown } = {}) {
    super(message);
    this.name = 'EngineError';
    this.code = opts.code || 'error';
    this.status = opts.status || 0;
    this.retryable = Boolean(opts.retryable);
    this.retryAfterSeconds = opts.retryAfterSeconds;
    this.detail = opts.detail;
  }
}

function zodDetails(data: any): string {
  const details = Array.isArray(data?.details) ? data.details : [];
  const named = details
    .map((d: any) => {
      const path = Array.isArray(d?.path) ? d.path.join('.') : '';
      return path ? `${path}: ${d?.message || 'invalid'}` : String(d?.message || '');
    })
    .filter(Boolean);
  return named.join(' · ');
}

/** Map an HTTP rejection onto the shared error contract. */
export function describeHttpError(status: number, data: any, context = 'The request'): EngineError {
  const raw = String(data?.error?.message || (typeof data?.error === 'string' ? data.error : '') || data?.errorMessage || data?.message || '');
  const code = String(data?.error?.code || data?.code || '');
  if (status === 400) {
    const fields = zodDetails(data);
    return new EngineError(fields ? `${context} was rejected — ${fields}` : `${context} was rejected: ${raw || 'invalid request'}.`, { code: code || 'bad_request', status });
  }
  if (status === 401) {
    return new EngineError('Your workspace session is not ready — refresh the page and try again.', { code: code || 'unauthorized', status });
  }
  if (status === 402 || /insufficient/i.test(raw)) {
    return new EngineError('The workspace wallet balance is too low for this generation. Top up the wallet, then retry.', { code: code || 'insufficient_funds', status: 402 });
  }
  if (status === 409) {
    return new EngineError('This request was already submitted with different content (idempotency conflict). Start a fresh generation.', { code: code || 'idempotency_conflict', status });
  }
  if (status === 429) {
    const after = Number(data?.retryAfterSeconds) || undefined;
    return new EngineError(`${context} could not get through to the provider after several automatic retries.`, { code: code || 'rate_limited', status, retryable: true, retryAfterSeconds: after });
  }
  if (status === 502) {
    return new EngineError('The provider hiccuped (502). This one is safe to retry.', { code: code || 'bad_gateway', status, retryable: true });
  }
  if (status === 503) {
    if (/generation_disabled/i.test(code) || /generation_disabled|disabled/i.test(raw)) {
      return new EngineError(RUNWAY_DISABLED_MESSAGE, { code: 'generation_disabled', status });
    }
    return new EngineError(raw || 'This provider is not enabled on the platform yet — check back soon.', { code: code || 'provider_unavailable', status });
  }
  return new EngineError(raw || `${context} failed (HTTP ${status}).`, { code: code || 'error', status, retryable: status >= 500 });
}

export function isRunwayDisabledError(e: unknown): boolean {
  return e instanceof EngineError && e.code === 'generation_disabled';
}

/** Runway reference URLs must be public HTTPS — no private/localhost/ports/credentials. */
export function isPublicHttpsUrl(url: string): boolean {
  try {
    const u = new URL(String(url || ''));
    if (u.protocol !== 'https:') return false;
    if (u.port) return false;
    if (u.username || u.password) return false;
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      const [a, b] = host.split('.').map(Number);
      if (a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)) return false;
    }
    return true;
  } catch { return false; }
}

function wsToken(): string {
  if (typeof window === 'undefined') return '';
  return String((window as any).__workspaceDb?.token || '');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * POST JSON and absorb the throttles that are not decisions about the request:
 * a 429 or 502 is waited out and submitted again (up to MAX_ATTEMPTS) instead
 * of being handed to the user as "come back later". Headers are passed in
 * already built so a Runway retry reuses the SAME Idempotency-Key — the key
 * exists precisely so an identical resend cannot double-charge.
 */
async function postJson(path: string, body: unknown, headers: Record<string, string>, service: string): Promise<{ res: Response; data: any }> {
  const MAX_ATTEMPTS = 5;
  let networkError: EngineError | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let res: Response;
    try {
      res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
    } catch (e: any) {
      networkError = new EngineError(`Could not reach ${service}: ${String(e?.message || e)}`, { code: 'network', retryable: true });
      if (attempt === MAX_ATTEMPTS) throw networkError;
      await sleep(attempt * 2000);
      continue;
    }
    const data = await res.json().catch(() => null);
    if ((res.status === 429 || res.status === 502) && attempt < MAX_ATTEMPTS) {
      const after = Number(data?.retryAfterSeconds);
      await sleep(Math.min(20000, Number.isFinite(after) && after > 0 ? after * 1000 : attempt * 2000));
      continue;
    }
    return { res, data };
  }
  throw networkError || new EngineError(`${service} did not answer.`, { code: 'network', retryable: true });
}

// ---------------------------------------------------------------------------
// GROUP A — /api/veo
// ---------------------------------------------------------------------------

export interface GroupASubmitParams {
  model: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: '16:9' | '9:16' | '1:1';
  duration?: number;
  generateAudio?: boolean;
  resolution?: '720p' | '1080p' | '4k';
  imageData?: string | null;
  referenceImages?: { imageData: string; mimeType?: string; referenceType: 'asset' | 'style' }[] | null;
  lastFrameImage?: { imageData: string; mimeType?: string } | null;
}

export interface GroupAKickoff {
  operationId: string;
  generationId?: string;
  cost?: string;
  estimatedDuration?: string;
  /** The model the accepted job actually rendered on. */
  modelUsed: string;
  /** Set when the requested engine was refused and another one took the job. */
  fallbackFrom?: string;
  /** Why the requested engine was refused — shown next to the running job. */
  fallbackReason?: string;
}

/**
 * Engines whose provider route is known to accept a submit. When the chosen
 * engine is refused, the same brief is resubmitted on the first of these the
 * inputs are legal on, so a dead provider route costs the user a note rather
 * than their generation.
 */
const SUBMIT_FALLBACK_MODELS = [
  'gemini-omni-flash-preview',
  'veo-3.1-fast-generate-preview',
  'veo-3.1-generate-preview',
];

function groupABody(model: string, params: GroupASubmitParams): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    prompt: capPromptText(params.prompt, 1000),
    aspectRatio: params.aspectRatio || '16:9',
    generateAudio: Boolean(params.generateAudio),
  };
  // safetyFilterLevel is a Google-native control (the default level
  // false-positives on seeded reference frames). Sora and the OpenRouter-hosted
  // models have no equivalent, so it only travels on the Google routes.
  if (/^(gemini-|veo-)/.test(model)) body.safetyFilterLevel = 'block_only_high';
  if (params.duration) body.duration = Math.max(4, Math.min(25, Math.round(params.duration)));
  if (params.negativePrompt) body.negativePrompt = capPromptText(params.negativePrompt, 500);
  if (params.resolution) body.resolution = params.resolution;
  if (params.imageData) body.imageData = params.imageData;
  if (params.referenceImages?.length) body.referenceImages = params.referenceImages.slice(0, 3);
  if (params.lastFrameImage) body.lastFrameImage = params.lastFrameImage;
  return body;
}

async function submitGroupAOnce(model: string, params: GroupASubmitParams): Promise<GroupAKickoff> {
  const { res, data } = await postJson('/api/veo/generate/video', groupABody(model, params), {}, 'the video service');
  if (!res.ok) throw describeHttpError(res.status, data, 'The video request');
  const operationId = String((data && (data.operationId || data.operation_id)) || '');
  // The proxy answers 200 OK with a SYNTHETIC operation id (and status
  // 'failed') when the provider route itself refused the job. Those bodies
  // routinely carry no error text at all, so log and attach the whole payload
  // rather than swallowing it behind a generic sentence.
  const failed = String(data?.status || '').toLowerCase() === 'failed';
  const synthetic = /^(veo_video_error_|openrouter_error_)/.test(operationId);
  if (!operationId || failed || synthetic) {
    console.error(`[videoEngineClient] ${model} refused at submit (HTTP ${res.status})`, data);
    const reported = String(data?.errorMessage || data?.error?.message || (typeof data?.error === 'string' ? data.error : '') || '');
    const route = operationId.startsWith('openrouter_error_') ? 'the OpenRouter route' : 'the provider route';
    const dump = data ? JSON.stringify(data).slice(0, 400) : 'no response body';
    throw new EngineError(
      `${groupAModel(model)?.name || model}: ${route} refused the job${reported ? ` — ${reported}` : ' and returned no reason'}`
      + ` (HTTP ${res.status}${operationId ? `, ${operationId}` : ''}). Response: ${dump}`,
      { code: 'provider_rejected', status: res.status, detail: data },
    );
  }
  return {
    operationId,
    modelUsed: model,
    generationId: data?.generationId ? String(data.generationId) : undefined,
    cost: data?.cost !== undefined ? String(data.cost) : undefined,
    estimatedDuration: data?.estimatedDuration ? String(data.estimatedDuration) : undefined,
  };
}

export async function submitGroupA(params: GroupASubmitParams): Promise<GroupAKickoff> {
  const violation = validateGroupAInputs(params.model, params);
  if (violation) throw new EngineError(violation, { code: 'combining_rules', status: 400 });
  try {
    return await submitGroupAOnce(params.model, params);
  } catch (refusal) {
    if (!(refusal instanceof EngineError) || refusal.code !== 'provider_rejected') throw refusal;
    for (const alt of SUBMIT_FALLBACK_MODELS) {
      if (alt === params.model || validateGroupAInputs(alt, params)) continue;
      try {
        const kick = await submitGroupAOnce(alt, params);
        return { ...kick, fallbackFrom: params.model, fallbackReason: refusal.message };
      } catch (next) {
        if (next instanceof EngineError && next.code === 'provider_rejected') continue;
        throw next;
      }
    }
    throw refusal;
  }
}

export interface GroupAStatus {
  status: 'processing' | 'completed' | 'failed';
  videoUrl?: string;
  progress?: number;
  error?: string;
}

export async function checkGroupA(operationId: string): Promise<GroupAStatus> {
  const res = await fetch(`/api/veo/status/${encodeURIComponent(operationId)}`);
  const data = await res.json().catch(() => null);
  if (res.status === 404) return { status: 'failed', error: 'The video service has no record of this render (404). Start a new generation.' };
  if (!res.ok) return { status: 'processing', error: String(data?.error || `status HTTP ${res.status}`) };
  const status = String(data?.status || '').toLowerCase();
  if (status === 'completed' && data?.videoUrl) return { status: 'completed', videoUrl: String(data.videoUrl), progress: 100 };
  if (status === 'failed' || status === 'error') return { status: 'failed', error: String(data?.errorMessage || data?.error || 'The render failed at the provider.') };
  return { status: 'processing', progress: Number(data?.progress) || undefined };
}

/** Poll a Group A operation every 5s to completion → the clip URL. */
export async function pollGroupA(operationId: string, opts: { onProgress?: (p: number) => void; timeoutMs?: number; isCancelled?: () => boolean } = {}): Promise<string> {
  const deadline = Date.now() + (opts.timeoutMs || 10 * 60 * 1000);
  let misses = 0;
  while (Date.now() < deadline) {
    if (opts.isCancelled?.()) throw new EngineError('This generation was cancelled.', { code: 'cancelled' });
    const st = await checkGroupA(operationId);
    if (st.status === 'completed' && st.videoUrl) return st.videoUrl;
    if (st.status === 'failed') throw new EngineError(st.error || 'The render failed.', { code: 'render_failed' });
    if (st.error) { misses += 1; if (misses >= 6) throw new EngineError(`The video service stopped answering: ${st.error}`, { code: 'poll_lost', retryable: true }); }
    else misses = 0;
    if (opts.onProgress && typeof st.progress === 'number') opts.onProgress(st.progress);
    await sleep(5000);
  }
  throw new EngineError('The render took too long. Start it again to retry.', { code: 'timeout' });
}

// ---------------------------------------------------------------------------
// RUNWAY — submit / poll
// ---------------------------------------------------------------------------

function runwayHeaders(): Record<string, string> {
  return {
    'X-Workspace-DB-Token': wsToken(),
    // Fresh UUID per submit — reusing one with different input answers 409.
    'Idempotency-Key': (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  };
}

export interface RunwayKickoff {
  taskId: string;
  status: string;
  uncertain: boolean;
  raw: any;
}

async function runwaySubmit(path: string, body: Record<string, unknown>, context: string): Promise<RunwayKickoff> {
  const { res, data } = await postJson(path, body, runwayHeaders(), 'Runway');
  // A provider timeout is a 202 with status 'uncertain' — never resubmit it.
  if (!res.ok && res.status !== 202) throw describeHttpError(res.status, data, context);
  const taskId = String(data?.taskId || data?.id || data?.task_id || '');
  const status = String(data?.status || (res.status === 202 ? 'uncertain' : 'queued'));
  if (!taskId && status !== 'uncertain') {
    throw new EngineError(String(data?.error?.message || data?.error || 'Runway did not return a task id.'), { code: 'no_task_id', status: res.status });
  }
  return { taskId, status, uncertain: status === 'uncertain', raw: data };
}

/** Submit a base Runway video (gen4.5 t2v / i2v, gen4_turbo i2v). Goes
 * straight to the provider — no quote step. Validate every reference URL with
 * isPublicHttpsUrl BEFORE calling. */
export function runwaySubmitVideo(body: Record<string, unknown>): Promise<RunwayKickoff> {
  return runwaySubmit('/api/generate/runway/video', body, 'The Runway video request');
}

/** Submit one of the seven allowlisted Runway Recipes. */
export function runwaySubmitRecipe(recipeId: string, body: Record<string, unknown>): Promise<RunwayKickoff> {
  return runwaySubmit(`/api/generate/runway/recipes/${encodeURIComponent(recipeId)}`, body, `The ${recipeId} recipe request`);
}

export interface RunwayResult {
  status: string;
  /** Durable platform media URLs — only present on 'succeeded'. */
  mediaUrls: string[];
  raw: any;
}

function collectMediaUrls(data: any): string[] {
  const urls: string[] = [];
  const push = (v: unknown) => { if (typeof v === 'string' && /^https?:\/\//.test(v)) urls.push(v); };
  push(data?.videoUrl); push(data?.imageUrl); push(data?.url);
  for (const key of ['outputs', 'output', 'media', 'mediaUrls', 'assets', 'images', 'videos', 'results']) {
    const arr = data?.[key];
    if (Array.isArray(arr)) for (const item of arr) { push(item); push(item?.url); push(item?.uri); push(item?.videoUrl); push(item?.imageUrl); }
  }
  return [...new Set(urls)];
}

export async function checkRunway(taskId: string): Promise<RunwayResult> {
  const res = await fetch(`/api/generate/runway/status/${encodeURIComponent(taskId)}`, {
    headers: { 'X-Workspace-DB-Token': wsToken() },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw describeHttpError(res.status, data, 'The Runway status check');
  return { status: String(data?.status || 'unknown'), mediaUrls: collectMediaUrls(data), raw: data };
}

/**
 * Poll a Runway task every 5s. ONLY 'succeeded' is success.
 *  'uncertain'          → stop, never resubmit (same Idempotency-Key would be
 *                         needed — surface the message instead).
 *  'failed'/'cancelled' → credits are auto-refunded; tell the user.
 */
export async function pollRunway(taskId: string, opts: { onStatus?: (s: string) => void; timeoutMs?: number; isCancelled?: () => boolean } = {}): Promise<RunwayResult> {
  const deadline = Date.now() + (opts.timeoutMs || 15 * 60 * 1000);
  let misses = 0;
  while (Date.now() < deadline) {
    if (opts.isCancelled?.()) throw new EngineError('Polling stopped. The task keeps running server-side.', { code: 'cancelled' });
    let result: RunwayResult;
    try {
      result = await checkRunway(taskId);
      misses = 0;
    } catch (e) {
      misses += 1;
      if (misses >= 6) throw e;
      await sleep(5000);
      continue;
    }
    opts.onStatus?.(result.status);
    if (result.status === 'succeeded') return result;
    if (result.status === 'failed' || result.status === 'cancelled') {
      const reason = String(result.raw?.error?.message || result.raw?.error || 'no successful output');
      throw new EngineError(`Runway task ended ${result.status}: ${reason}. Your credits were automatically refunded.`, { code: `runway_${result.status}` });
    }
    if (result.status === 'uncertain') {
      throw new EngineError('The Runway task outcome is uncertain — do NOT resubmit; check back on this task shortly.', { code: 'runway_uncertain' });
    }
    await sleep(5000);
  }
  throw new EngineError('The Runway task is taking unusually long. It may still finish — check back on this task; do not resubmit.', { code: 'timeout' });
}
