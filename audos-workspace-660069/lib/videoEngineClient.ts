/**
 * VIDEO ENGINE CLIENT — the shared network layer every VidVerge app uses to
 * talk to the platform's generation proxies.
 *
 *  GROUP A  POST /api/veo/generate/video          (standard app session —
 *           Content-Type only; no extra token header needed)
 *           GET  /api/veo/status/:operationId      poll every 5s
 *
 *  RUNWAY   POST /api/generate/runway/quote        (free — NO auth)
 *           POST /api/generate/runway/video        (X-Workspace-DB-Token +
 *           POST /api/generate/runway/recipes/:id   fresh Idempotency-Key)
 *           GET  /api/generate/runway/status/:id    poll every 5s (with token)
 *
 * Error contract implemented here for every surface:
 *   400 → name the offending field from the Zod `details` array
 *   401 → session problem            402 → wallet too low (link to wallet)
 *   429 → show retry-after           502 → transient, safe to retry
 *   503 → provider not enabled ("Runway generation is being enabled — check back soon.")
 * `uncertain` Runway status → do NOT resubmit. failed/cancelled → auto-refund.
 *
 * CREDIT GATE (locked pricing, Sep 2026). Every submit in this file spends the
 * customer's credits BEFORE the provider is called — 1 credit = 1 second of
 * video, the same on every engine — and hands them straight back when the job
 * is never actually accepted. A submit that cannot be afforded never reaches
 * the provider: it raises the plans screen on the credit wall and throws
 * InsufficientCreditsError. Pass the same `creditKey` when retrying ONE clip
 * so the retry is not billed a second time. If the wallet itself cannot be
 * reached the render proceeds unmetered — a ledger outage must never be the
 * reason a paying customer cannot make their video.
 */

import { RUNWAY_DISABLED_MESSAGE, capPromptText, validateGroupAInputs } from './videoEngines';
import { chargeCredits, newChargeKey, refundCredits } from './credits';
import { isRegisteredAppId } from './appIds';
import type { AppId } from './appIds';

export class EngineError extends Error {
  code: string;
  status: number;
  /** True when an identical retry can plausibly succeed (429/502/network). */
  retryable: boolean;
  retryAfterSeconds?: number;
  constructor(message: string, opts: { code?: string; status?: number; retryable?: boolean; retryAfterSeconds?: number } = {}) {
    super(message);
    this.name = 'EngineError';
    this.code = opts.code || 'error';
    this.status = opts.status || 0;
    this.retryable = Boolean(opts.retryable);
    this.retryAfterSeconds = opts.retryAfterSeconds;
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
    return new EngineError(`The service is rate-limited right now${after ? ` — retry in about ${after}s` : ' — wait a minute and retry'}.`, { code: code || 'rate_limited', status, retryable: true, retryAfterSeconds: after });
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

// ---------------------------------------------------------------------------
// APP IDENTITY — what the generation row is keyed to
// ---------------------------------------------------------------------------

/**
 * POST a generation request carrying the registered app id the proxy records
 * the job against.
 *
 * The id travels twice deliberately. `X-App-Id` is the documented carrier for
 * app identity, and `appId` in the body is the value the proxy records when it
 * is present; both name the same registered app so the `veo_generations` insert
 * cannot trip `veo_generations_app_id_apps_id_fk`. Sending only one of them
 * leaves the outcome dependent on which the running proxy build reads.
 *
 * `appId` is optional, and an absent or unregistered one is sent as NOTHING
 * rather than as a guess. That is the important case to get right: naming no
 * app lets the proxy resolve the caller from the session, whereas naming a
 * WRONG one is exactly what trips the foreign key. A surface is better off
 * silent than approximate.
 *
 * NAMING NO APP IS THE CONFIGURATION PROVEN TO WORK. The `generate-video`
 * hook — the pipeline serving live customers — posts to this same proxy with
 * no `X-App-Id` at all, and its source records that sending that header
 * triggered this very foreign-key violation (verified 17 Sep 2026, after the
 * same failure in Asset Generator two days earlier). A registered id is
 * *expected* to satisfy the constraint where a space id did not, but that has
 * not been proven against a live proxy from here.
 *
 * So the identity is sent, and the call heals itself if the proxy will not
 * take it: a rejection that names `appId`, `app_id` or the constraint itself
 * is retried once with no identity at all. A surface that cannot be
 * attributed still generates, which is the outcome that matters to the
 * customer looking at the screen.
 */
export async function postGeneration(
  path: string,
  body: Record<string, unknown>,
  appId?: AppId,
): Promise<{ res: Response; data: any }> {
  const token = wsToken();
  const named = isRegisteredAppId(appId) ? appId : null;
  const base: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { 'X-Workspace-DB-Token': token } : {}),
  };

  const send = (withIdentity: boolean) => fetch(path, {
    method: 'POST',
    headers: withIdentity && named ? { ...base, 'X-App-Id': named } : base,
    body: JSON.stringify(withIdentity && named ? { ...body, appId: named } : body),
  });

  let res = await send(Boolean(named));
  let data = await res.json().catch(() => null);

  if (named && rejectsAppIdentity(res, data)) {
    res = await send(false);
    data = await res.json().catch(() => null);
  }
  return { res, data };
}

/**
 * Whether a failure is the proxy refusing the app identity rather than the
 * generation itself. Covers both shapes: a strict body schema that does not
 * know the field (400 naming `appId`) and the insert refusing the value
 * (`veo_generations_app_id_apps_id_fk`).
 */
function rejectsAppIdentity(res: Response, data: any): boolean {
  if (res.ok) return false;
  return /veo_generations_app_id|app_id|\bappId\b/i.test(JSON.stringify(data ?? ''));
}

/** Poll and status reads are GETs, but still name the app they belong to. */
export function generationHeaders(appId?: AppId): Record<string, string> {
  const token = wsToken();
  return {
    ...(isRegisteredAppId(appId) ? { 'X-App-Id': appId } : {}),
    ...(token ? { 'X-Workspace-DB-Token': token } : {}),
  };
}

// ---------------------------------------------------------------------------
// GROUP A — /api/veo
// ---------------------------------------------------------------------------

export interface GroupASubmitParams {
  /**
   * The calling app's registered id (see ./appIds.ts). Every VidVerge surface
   * should name itself so its jobs are attributed to the right app; a caller
   * that omits it falls back to session-resolved attribution rather than
   * failing — see postGeneration.
   */
  appId?: AppId;
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
  /** Reuse across retries of the SAME clip so the retry is not billed twice. */
  creditKey?: string;
}

export interface GroupAKickoff {
  operationId: string;
  /** The credit charge behind this clip — hand it to pollGroupA so a failed
   * render refunds itself, or to a retry so it is not billed twice. */
  creditKey?: string;
  generationId?: string;
  cost?: string;
  estimatedDuration?: string;
}

export async function submitGroupA(params: GroupASubmitParams): Promise<GroupAKickoff> {
  const violation = validateGroupAInputs(params.model, params);
  if (violation) throw new EngineError(violation, { code: 'combining_rules', status: 400 });

  // Credit gate. A Group A clip runs ~8s when the caller names no duration.
  const seconds = Math.max(1, Math.round(Number(params.duration) || 8));
  const creditKey = params.creditKey || newChargeKey('groupa');
  const charge = await chargeCredits({
    seconds,
    entryKey: creditKey,
    source: 'group-a',
    note: `${seconds}s clip`,
  });
  /** Nothing was generated, so the customer keeps their credits. */
  const releaseCredits = (reason: string) => {
    if (charge.metered) void refundCredits(creditKey, reason);
  };

  const body: Record<string, unknown> = {
    model: params.model,
    prompt: capPromptText(params.prompt, 10000),
    aspectRatio: params.aspectRatio || '16:9',
    generateAudio: Boolean(params.generateAudio),
    // The default safety level false-positives on seeded reference frames.
    safetyFilterLevel: 'block_only_high',
  };
  if (params.duration) body.duration = Math.max(4, Math.min(25, Math.round(params.duration)));
  if (params.negativePrompt) body.negativePrompt = capPromptText(params.negativePrompt, 10000);
  if (params.resolution) body.resolution = params.resolution;
  if (params.imageData) body.imageData = params.imageData;
  if (params.referenceImages?.length) body.referenceImages = params.referenceImages.slice(0, 3);
  if (params.lastFrameImage) body.lastFrameImage = params.lastFrameImage;

  let res: Response;
  let data: any;
  try {
    const posted = await postGeneration('/api/veo/generate/video', body, params.appId);
    res = posted.res;
    data = posted.data;
  } catch (e: any) {
    releaseCredits('The video service could not be reached');
    throw new EngineError(`Could not reach the video service: ${String(e?.message || e)}`, { code: 'network', retryable: true });
  }
  if (!res.ok) {
    releaseCredits('The video service rejected the request');
    throw describeHttpError(res.status, data, 'The video request');
  }
  const operationId = data && (data.operationId || data.operation_id);
  // The proxy can answer 200 OK with a placeholder error id or status:'failed'
  // when the provider submission itself failed.
  // success:true + operationId (status 'processing') is an accepted async job
  // that the caller polls; `message` there is progress text, never an error.
  const failed = data?.success === false || String(data?.status || '').toLowerCase() === 'failed';
  if (typeof operationId !== 'string' || !operationId || failed || /^(veo_video_error_|openrouter_error_)/.test(operationId)) {
    releaseCredits('The provider did not accept the generation');
    const reason = data?.errorMessage || data?.error || (data?.success === false ? data?.message : '');
    throw new EngineError(String(reason || 'The provider did not accept this generation.'), { code: 'provider_rejected', status: res.status });
  }
  return {
    operationId,
    creditKey,
    generationId: data?.generationId ? String(data.generationId) : undefined,
    cost: data?.cost !== undefined ? String(data.cost) : undefined,
    estimatedDuration: data?.estimatedDuration ? String(data.estimatedDuration) : undefined,
  };
}

export interface GroupAStatus {
  status: 'processing' | 'completed' | 'failed';
  videoUrl?: string;
  progress?: number;
  error?: string;
}

export async function checkGroupA(operationId: string, appId?: AppId): Promise<GroupAStatus> {
  const res = await fetch(`/api/veo/status/${encodeURIComponent(operationId)}`, {
    headers: appId ? generationHeaders(appId) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (res.status === 404) return { status: 'failed', error: 'The video service has no record of this render (404). Start a new generation.' };
  if (!res.ok) return { status: 'processing', error: String(data?.error || `status HTTP ${res.status}`) };
  const status = String(data?.status || '').toLowerCase();
  if (status === 'completed' && data?.videoUrl) return { status: 'completed', videoUrl: String(data.videoUrl), progress: 100 };
  if (status === 'failed' || status === 'error') return { status: 'failed', error: String(data?.errorMessage || data?.error || 'The render failed at the provider.') };
  return { status: 'processing', progress: Number(data?.progress) || undefined };
}

/** Poll a Group A operation every 5s to completion → the clip URL. */
export async function pollGroupA(operationId: string, opts: { onProgress?: (p: number) => void; timeoutMs?: number; isCancelled?: () => boolean; creditKey?: string; appId?: AppId } = {}): Promise<string> {
  const deadline = Date.now() + (opts.timeoutMs || 10 * 60 * 1000);
  let misses = 0;
  while (Date.now() < deadline) {
    if (opts.isCancelled?.()) throw new EngineError('This generation was cancelled.', { code: 'cancelled' });
    const st = await checkGroupA(operationId, opts.appId);
    if (st.status === 'completed' && st.videoUrl) return st.videoUrl;
    if (st.status === 'failed') {
      // No usable video came back, so the credits go back too.
      if (opts.creditKey) void refundCredits(opts.creditKey, 'The render failed at the provider');
      throw new EngineError(st.error || 'The render failed.', { code: 'render_failed' });
    }
    if (st.error) { misses += 1; if (misses >= 6) throw new EngineError(`The video service stopped answering: ${st.error}`, { code: 'poll_lost', retryable: true }); }
    else misses = 0;
    if (opts.onProgress && typeof st.progress === 'number') opts.onProgress(st.progress);
    await sleep(5000);
  }
  throw new EngineError('The render took too long. Start it again to retry.', { code: 'timeout' });
}

export interface GroupAResilientOptions {
  /** Models to try, in order, when the requested engine rejects or fails. */
  fallbackModels?: string[];
  onStatus?: (status: string) => void;
  onProgress?: (progress: number) => void;
  timeoutMs?: number;
  isCancelled?: () => boolean;
}

export interface GroupAResilientResult {
  videoUrl: string;
  /** The model that actually produced the clip. */
  modelUsed: string;
  /** Set when a fallback finished the clip: the model originally requested. */
  fallbackFrom?: string;
}

/** Submit + poll one Group A clip, falling back through `fallbackModels` when
 * the requested engine rejects the job or fails the render. Each attempt
 * carries its own credit key, and a failed attempt refunds itself inside
 * submitGroupA/pollGroupA. A cancelled run never falls back. */
export async function renderGroupAResilient(params: GroupASubmitParams, opts: GroupAResilientOptions = {}): Promise<GroupAResilientResult> {
  const requested = params.model;
  const chain = [requested, ...(opts.fallbackModels || []).filter((model) => model && model !== requested)];
  let lastError: unknown = null;
  for (const model of chain) {
    if (opts.isCancelled?.()) throw new EngineError('This generation was cancelled.', { code: 'cancelled' });
    try {
      if (opts.onStatus) opts.onStatus(model === requested ? 'Submitting…' : `Trying ${model} instead…`);
      const kickoff = await submitGroupA({ ...params, model });
      const videoUrl = await pollGroupA(kickoff.operationId, {
        onProgress: opts.onProgress,
        timeoutMs: opts.timeoutMs,
        isCancelled: opts.isCancelled,
        creditKey: kickoff.creditKey,
        appId: params.appId,
      });
      return model === requested
        ? { videoUrl, modelUsed: model }
        : { videoUrl, modelUsed: model, fallbackFrom: requested };
    } catch (e) {
      if (e instanceof EngineError && e.code === 'cancelled') throw e;
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new EngineError('The render failed on every engine.', { code: 'render_failed' });
}

// ---------------------------------------------------------------------------
// RUNWAY — quote / submit / poll
// ---------------------------------------------------------------------------

export interface RunwayQuote {
  ok: boolean;
  /** Price in USD when the quote endpoint reports one. */
  priceUsd?: number;
  credits?: number;
  raw: any;
  error?: string;
}

/** FREE validation + exact price — no auth, no billing, no provider work.
 * Body: a /video body, or { recipeId, ...recipeFields }. */
export async function runwayQuote(body: Record<string, unknown>): Promise<RunwayQuote> {
  let res: Response;
  try {
    res = await fetch('/api/generate/runway/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e: any) {
    return { ok: false, raw: null, error: `Could not reach the quote service: ${String(e?.message || e)}` };
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = describeHttpError(res.status, data, 'The quote request');
    return { ok: false, raw: data, error: err.message };
  }
  const credits = Number(data?.credits ?? data?.totalCredits ?? data?.quote?.credits);
  const priceRaw = data?.priceUsd ?? data?.price ?? data?.totalUsd ?? data?.quote?.priceUsd ?? data?.quote?.price;
  let priceUsd = Number(priceRaw);
  // Platform catalog prices provider credits at $0.01 / credit.
  if (!Number.isFinite(priceUsd) && Number.isFinite(credits)) priceUsd = credits * 0.01;
  return { ok: true, priceUsd: Number.isFinite(priceUsd) ? priceUsd : undefined, credits: Number.isFinite(credits) ? credits : undefined, raw: data };
}

/** Live, free provider gate used by every Auto Director surface. A successful
 * quote proves the Runway contract is accepting this session's inputs without
 * submitting provider work or spending wallet credits. */
export async function checkRunwayAvailability(): Promise<{ available: boolean; reason?: string }> {
  const quote = await runwayQuote({
    model: 'gen4.5',
    promptText: 'Slow cinematic product reveal in warm studio light.',
    ratio: '1280:720',
    duration: 5,
  });
  return quote.ok
    ? { available: true }
    : { available: false, reason: quote.error || RUNWAY_DISABLED_MESSAGE };
}

function runwayHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
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
  /** The credit charge behind this task — hand it to pollRunway so a failed
   * task refunds itself, or to a retry so it is not billed twice. */
  creditKey?: string;
}

/** Credit context for one Runway submit. */
export interface RunwayCreditOptions {
  /** Clip length being bought, when the request body does not carry one. */
  seconds?: number;
  /** Reuse across retries of the SAME clip so the retry is not billed twice. */
  creditKey?: string;
}

async function runwaySubmit(path: string, body: Record<string, unknown>, context: string, credit?: RunwayCreditOptions): Promise<RunwayKickoff> {
  // Credit gate. Runway clips are 5s unless the caller says otherwise.
  const seconds = Math.max(1, Math.round(Number(credit?.seconds ?? body.duration) || 5));
  const creditKey = credit?.creditKey || newChargeKey('runway');
  const charge = await chargeCredits({ seconds, entryKey: creditKey, source: 'runway', note: `${seconds}s clip` });
  /** Nothing was generated, so the customer keeps their credits. */
  const releaseCredits = (reason: string) => {
    if (charge.metered) void refundCredits(creditKey, reason);
  };

  let res: Response;
  try {
    res = await fetch(path, { method: 'POST', headers: runwayHeaders(), body: JSON.stringify(body) });
  } catch (e: any) {
    releaseCredits('Runway could not be reached');
    throw new EngineError(`Could not reach Runway: ${String(e?.message || e)}`, { code: 'network', retryable: true });
  }
  const data = await res.json().catch(() => null);
  // A provider timeout is a 202 with status 'uncertain' — never resubmit it.
  if (!res.ok && res.status !== 202) {
    releaseCredits('Runway rejected the request');
    throw describeHttpError(res.status, data, context);
  }
  const taskId = String(data?.taskId || data?.id || data?.task_id || '');
  const status = String(data?.status || (res.status === 202 ? 'uncertain' : 'queued'));
  if (!taskId && status !== 'uncertain') {
    releaseCredits('Runway returned no task id');
    throw new EngineError(String(data?.error?.message || data?.error || 'Runway did not return a task id.'), { code: 'no_task_id', status: res.status });
  }
  return { taskId, status, uncertain: status === 'uncertain', raw: data, creditKey };
}

/** Submit a base Runway video (gen4.5 t2v / i2v, gen4_turbo i2v). Validate
 * every reference URL with isPublicHttpsUrl BEFORE calling. */
export function runwaySubmitVideo(body: Record<string, unknown>, credit?: RunwayCreditOptions): Promise<RunwayKickoff> {
  return runwaySubmit('/api/generate/runway/video', body, 'The Runway video request', credit);
}

/** Submit one of the seven allowlisted Runway Recipes. */
export function runwaySubmitRecipe(recipeId: string, body: Record<string, unknown>, credit?: RunwayCreditOptions): Promise<RunwayKickoff> {
  return runwaySubmit(`/api/generate/runway/recipes/${encodeURIComponent(recipeId)}`, body, `The ${recipeId} recipe request`, credit);
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
export async function pollRunway(taskId: string, opts: { onStatus?: (s: string) => void; timeoutMs?: number; isCancelled?: () => boolean; creditKey?: string } = {}): Promise<RunwayResult> {
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
      // No usable video came back, so the credits go back too.
      if (opts.creditKey) void refundCredits(opts.creditKey, `Runway ended ${result.status}`);
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

// ---------------------------------------------------------------------------
// KLING — /api/generate/kling/*
// ---------------------------------------------------------------------------

function klingHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Workspace-DB-Token': wsToken(),
  };
}

export interface KlingKickoff {
  taskId: string;
  status: string;
}

export async function submitKlingVideo(params: {
  model: string;
  prompt: string;
  aspectRatio?: '16:9' | '9:16' | '1:1';
  duration?: number;
  imageData?: string;
}): Promise<KlingKickoff> {
  const durationSec = Math.round(Number(params.duration) || 5);
  const duration = durationSec >= 8 ? '10' : '5';
  const path = params.imageData ? '/api/generate/kling/image-to-video' : '/api/generate/kling/text-to-video';
  const body: Record<string, unknown> = {
    prompt: capPromptText(params.prompt, 2500),
    model: params.model || 'kling-v1-5',
    mode: 'std',
    duration,
  };
  if (params.aspectRatio && params.aspectRatio !== '1:1') body.aspectRatio = params.aspectRatio;
  if (params.imageData) body.imageData = params.imageData;

  let res: Response;
  try {
    res = await fetch(path, { method: 'POST', headers: klingHeaders(), body: JSON.stringify(body) });
  } catch (e: any) {
    throw new EngineError(`Could not reach Kling: ${String(e?.message || e)}`, { code: 'network', retryable: true });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw describeHttpError(res.status, data, 'The Kling video request');
  const taskId = String(data?.taskId || '');
  if (!taskId) throw new EngineError(String(data?.error || 'Kling did not return a task id.'), { code: 'no_task_id' });
  return { taskId, status: String(data?.status || 'queued') };
}

export async function checkKling(taskId: string): Promise<{ status: string; videoUrl?: string; error?: string }> {
  const res = await fetch(`/api/generate/kling/status/${encodeURIComponent(taskId)}`, { headers: klingHeaders() });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw describeHttpError(res.status, data, 'The Kling status check');
  const status = String(data?.status || '').toLowerCase();
  if (status === 'completed' && data?.videoUrl) return { status: 'completed', videoUrl: String(data.videoUrl) };
  if (status === 'failed') return { status: 'failed', error: String(data?.errorMessage || data?.error || 'Kling reported the render failed.') };
  return { status: status || 'processing' };
}

export async function pollKling(taskId: string, opts: { onProgress?: (p: number) => void; timeoutMs?: number } = {}): Promise<string> {
  const deadline = Date.now() + (opts.timeoutMs || 15 * 60 * 1000);
  let tick = 0;
  while (Date.now() < deadline) {
    const st = await checkKling(taskId);
    if (st.status === 'completed' && st.videoUrl) return st.videoUrl;
    if (st.status === 'failed') throw new EngineError(st.error || 'Kling render failed.', { code: 'render_failed' });
    tick += 1;
    if (opts.onProgress) opts.onProgress(Math.min(95, tick * 8));
    await sleep(5000);
  }
  throw new EngineError('Kling is taking longer than expected — check back on this task or retry.', { code: 'timeout' });
}

// ---------------------------------------------------------------------------
// HIGGSFIELD — /api/generate/higgsfield/*
// ---------------------------------------------------------------------------

function higgsfieldHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Workspace-DB-Token': wsToken(),
  };
}

export interface HiggsfieldKickoff {
  requestId: string;
  status: string;
}

export async function submitHiggsfieldVideo(params: {
  model: string;
  prompt: string;
  aspectRatio?: string;
  durationSeconds?: number;
  imageData?: string;
}): Promise<HiggsfieldKickoff> {
  const path = params.imageData ? '/api/generate/higgsfield/image-to-video' : '/api/generate/higgsfield/video';
  const body: Record<string, unknown> = {
    prompt: capPromptText(params.prompt, 2000),
    model: params.model,
  };
  if (params.aspectRatio) body.aspectRatio = params.aspectRatio;
  if (params.durationSeconds) body.durationSeconds = Math.max(1, Math.min(15, Math.round(params.durationSeconds)));
  if (params.imageData) body.imageData = params.imageData;

  let res: Response;
  try {
    res = await fetch(path, { method: 'POST', headers: higgsfieldHeaders(), body: JSON.stringify(body) });
  } catch (e: any) {
    throw new EngineError(`Could not reach Higgsfield: ${String(e?.message || e)}`, { code: 'network', retryable: true });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw describeHttpError(res.status, data, 'The Higgsfield video request');
  const requestId = String(data?.requestId || '');
  if (!requestId) throw new EngineError(String(data?.error || 'Higgsfield did not return a request id.'), { code: 'no_request_id' });
  return { requestId, status: String(data?.status || 'queued') };
}

export async function checkHiggsfield(requestId: string): Promise<{ status: string; videoUrl?: string; error?: string }> {
  const res = await fetch(`/api/generate/higgsfield/status/${encodeURIComponent(requestId)}`, {
    headers: higgsfieldHeaders(),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw describeHttpError(res.status, data, 'The Higgsfield status check');
  const status = String(data?.status || '').toLowerCase();
  if (status === 'completed' && data?.videoUrl) return { status: 'completed', videoUrl: String(data.videoUrl) };
  if (status === 'failed' || status === 'nsfw') {
    return { status: 'failed', error: String(data?.errorMessage || `Higgsfield ended ${status}.`) };
  }
  return { status: status || 'processing' };
}

export async function pollHiggsfield(requestId: string, opts: { onProgress?: (p: number) => void; timeoutMs?: number } = {}): Promise<string> {
  const deadline = Date.now() + (opts.timeoutMs || 15 * 60 * 1000);
  let tick = 0;
  while (Date.now() < deadline) {
    const st = await checkHiggsfield(requestId);
    if (st.status === 'completed' && st.videoUrl) return st.videoUrl;
    if (st.status === 'failed') throw new EngineError(st.error || 'Higgsfield render failed.', { code: 'render_failed' });
    tick += 1;
    if (opts.onProgress) opts.onProgress(Math.min(95, tick * 7));
    await sleep(5000);
  }
  throw new EngineError('Higgsfield is taking longer than expected — check back on this task or retry.', { code: 'timeout' });
}
