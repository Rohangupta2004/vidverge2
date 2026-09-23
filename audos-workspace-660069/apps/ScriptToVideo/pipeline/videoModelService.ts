/**
 * VIDEO MODEL SERVICE — the ONE adapter between the pipeline and the platform's
 * video generation proxies. No other module talks to the video API; the model
 * REGISTRY below (VIDEO_MODELS) is the single place providers/models are
 * configured, so adding or switching a model never touches components.
 *
 *   createVideo          submit ONE clip → { jobId }
 *   getGenerationStatus  poll one job    → { status, videoUrl }
 *   getVideoResult       poll getGenerationStatus to completion → clip URL
 *   uploadReference      file/dataURL/blob → durable public URL (file-storage)
 *   cancelGeneration     abandon a job locally (the proxies have no cancel;
 *                        the poll loop stops and the scene is released)
 *
 * PROVIDERS
 * - 'google'  → POST /api/veo/generate/video + GET /api/veo/status/:id.
 *   Default model: Gemini Omni Flash (gemini-omni-flash-preview) — proven
 *   end-to-end in this workspace. Supports a single seed frame (imageData —
 *   how a continuation scene receives the previous scene's final frame) plus
 *   up to 3 referenceImages. Does NOT support lastFrameImage.
 * - 'openrouter' → the SAME /api/veo proxy with an openrouter/* model id
 *   (Seedance 2.0 Fast). Seed image only, no referenceImages.
 * - 'kling' → POST /api/generate/kling/text-to-video (or image-to-video when
 *   a seed frame travels) + GET /api/generate/kling/status/:taskId. Kling
 *   durations are the strings '5' | '10'. Kling job ids are stored with a
 *   'kling:' prefix so status polling routes to the right endpoint even
 *   across a reload (resumeFilm only has the stored operation id).
 *
 * AVAILABILITY (verified Sep 23 2026): Omni Flash works end-to-end. Kling
 * answers every call with "Kling is not configured on this platform
 * (KLING_API_KEY missing)" and every openrouter/* kickoff fails instantly at
 * the provider — both need PLATFORM-side keys, nothing this workspace can fix.
 * The adapters below are complete, so both models start working the moment
 * the platform configures them; until then their picker entries carry an
 * availability note and a submit fails with the provider's own plain reason.
 */

import { Aspect, ReferenceAsset, uploadBlob, uploadDataUrl, wsToken } from '../api';

// ---------------------------------------------------------------------------
// Central model registry — add or change models HERE and nowhere else.
// ---------------------------------------------------------------------------

export type VideoProvider = 'google' | 'openrouter' | 'kling';

export interface VideoModelConfig {
  /** Registry id — persisted on the film row (s2v_films.video_model). */
  id: string;
  /** Human name shown in the picker. */
  label: string;
  provider: VideoProvider;
  /** Friendly model id shown in the UI. */
  model: string;
  /** The exact model id the platform proxy accepts. */
  apiModel: string;
  /** Clip lengths the model supports (seconds). Segmentation targets these. */
  supportedDurations: number[];
  /** Longest duration known-safe on the proxy; longer requests fall back here
   * if the proxy rejects them. */
  safeMaxDuration: number;
  maxReferenceImages: number;
  /** The proxy rejects prompts longer than this with a 400. */
  promptMaxChars: number;
  negativeMaxChars: number;
  pollIntervalMs: number;
  timeoutMs: number;
  /** Availability hint surfaced in the picker (undefined = fully available). */
  availabilityNote?: string;
}

export const VIDEO_MODEL: VideoModelConfig = {
  id: 'omni-flash',
  label: 'Omni Flash (Google)',
  provider: 'google',
  model: 'omni-flash',
  apiModel: 'gemini-omni-flash-preview',
  supportedDurations: [4, 6, 8, 10],
  safeMaxDuration: 8,
  maxReferenceImages: 3,
  promptMaxChars: 1000,
  negativeMaxChars: 500,
  pollIntervalMs: 5000,
  timeoutMs: 8 * 60 * 1000,
};

export const SEEDANCE_2_0: VideoModelConfig = {
  id: 'seedance-2.0',
  label: 'Seedance 2.0 Fast',
  provider: 'openrouter',
  model: 'seedance-2.0-fast',
  apiModel: 'openrouter/bytedance/seedance-2.0-fast',
  supportedDurations: [4, 6, 8, 10],
  safeMaxDuration: 10,
  maxReferenceImages: 0,
  promptMaxChars: 1000,
  negativeMaxChars: 500,
  pollIntervalMs: 5000,
  timeoutMs: 10 * 60 * 1000,
  availabilityNote: 'Provider key pending on the platform — submits fail until it lands.',
};

export const KLING_V2_MASTER: VideoModelConfig = {
  id: 'kling-v2-master',
  label: 'Kling v2 Master',
  provider: 'kling',
  model: 'kling-v2-master',
  apiModel: 'kling-v2-master',
  supportedDurations: [5, 10],
  safeMaxDuration: 10,
  maxReferenceImages: 0,
  promptMaxChars: 2500,
  negativeMaxChars: 2500,
  pollIntervalMs: 5000,
  timeoutMs: 10 * 60 * 1000,
  availabilityNote: 'Provider key pending on the platform — submits fail until it lands.',
};

/** Every model the pipeline can run on, in picker order. */
export const VIDEO_MODELS: VideoModelConfig[] = [VIDEO_MODEL, SEEDANCE_2_0, KLING_V2_MASTER];

/** Resolve a stored model id (s2v_films.video_model) onto its config.
 * Unknown/null ids fall back to the default so old films keep working. */
export function resolveVideoModel(id?: string | null): VideoModelConfig {
  return VIDEO_MODELS.find((m) => m.id === String(id || '')) || VIDEO_MODEL;
}

/** Snap an arbitrary duration onto the nearest supported clip length. */
export function snapDuration(seconds: number, config: VideoModelConfig = VIDEO_MODEL): number {
  const wanted = Number(seconds) || config.supportedDurations[0];
  return [...config.supportedDurations].sort((a, b) => Math.abs(a - wanted) - Math.abs(b - wanted))[0];
}

/** Cap text at the proxy's hard limit, cutting on a sentence/word boundary so
 * a truncated prompt still reads complete. */
export function capText(text: string, max: number): string {
  const t = String(text || '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'));
  if (sentence > max * 0.6) return cut.slice(0, sentence + 1).trim();
  const space = cut.lastIndexOf(' ');
  return (space > 0 ? cut.slice(0, space) : cut).trim();
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export interface CreateVideoParams {
  prompt: string;
  negative?: string;
  aspect: Aspect;
  durationS: number;
  /** first_frame → seed image (continuation); reference → reference image. */
  referenceAssets?: ReferenceAsset[] | null;
  model?: VideoModelConfig;
}

export interface VideoJob { jobId: string; model: string }

export interface VideoJobStatus {
  status: 'processing' | 'completed' | 'failed';
  videoUrl?: string;
  progress?: number;
  error?: string;
}

const cancelled = new Set<string>();

const KLING_PREFIX = 'kling:';

function authHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': wsToken() };
}

function classifySubmitError(status: number, data: any): string {
  const raw = String(data?.errorMessage || data?.error || data?.message || '');
  if (/not configured/i.test(raw)) return `This model's provider is not configured on the platform yet — no charge was made. Switch the film to Omni Flash, or ask the platform to add the key. (${raw})`;
  if (status === 402 || /insufficient/i.test(raw)) return `The workspace wallet balance is too low for this render. Top up the wallet and retry. (${raw || 'HTTP 402'})`;
  if (status === 429 || /rate.?limit|quota/i.test(raw)) return `The video service is rate-limited right now — wait a minute and retry this scene. (${raw || 'HTTP 429'})`;
  if (status === 400) return `The video service rejected this request: ${raw || 'invalid request'}. Regenerating the prompt usually fixes this.`;
  if (/blocked|safety|likeness/i.test(raw)) return `The provider's safety filter blocked this request (${raw}). Try the character-reference fallback or regenerate the prompt.`;
  return raw || `Video submit failed (HTTP ${status}).`;
}

async function submitVeoProxyOnce(body: Record<string, unknown>): Promise<{ ok: true; jobId: string } | { ok: false; status: number; data: any }> {
  let res: Response;
  try {
    res = await fetch('/api/veo/generate/video', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
  } catch (e: any) {
    return { ok: false, status: 0, data: { error: `Could not reach the video service: ${String(e?.message || e)}` } };
  }
  const data = await res.json().catch(() => null);
  const jobId = data && (data.operationId || data.operation_id);
  // The proxy can answer 200 OK with a placeholder id (veo_video_error_* /
  // openrouter_error_*) or status: 'failed' when the provider submission
  // itself failed — treating that as success would leave the scene polling a
  // 404 forever.
  const failed = String(data?.status || '').toLowerCase() === 'failed';
  if (res.ok && typeof jobId === 'string' && jobId && !failed && !/^(veo_video_error_|openrouter_error_)/.test(jobId)) {
    return { ok: true, jobId };
  }
  return { ok: false, status: res.status, data };
}

/** Kling kickoff — text-to-video, or image-to-video when a continuation seed
 * frame travels. Kling wants durations as the strings '5' | '10'. */
async function submitKling(cfg: VideoModelConfig, params: CreateVideoParams, seedUrl: string | null): Promise<{ ok: true; jobId: string } | { ok: false; status: number; data: any }> {
  const duration = String(snapDuration(params.durationS, cfg)) as '5' | '10';
  const body: Record<string, unknown> = {
    model: cfg.apiModel,
    prompt: capText(params.prompt, cfg.promptMaxChars),
    mode: 'std',
    duration,
    aspectRatio: params.aspect,
  };
  if (params.negative) body.negativePrompt = capText(params.negative, cfg.negativeMaxChars);
  if (seedUrl) body.imageData = seedUrl;
  const path = seedUrl ? '/api/generate/kling/image-to-video' : '/api/generate/kling/text-to-video';
  let res: Response;
  try {
    res = await fetch(path, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
  } catch (e: any) {
    return { ok: false, status: 0, data: { error: `Could not reach the video service: ${String(e?.message || e)}` } };
  }
  const data = await res.json().catch(() => null);
  const taskId = data && (data.taskId || data.task_id);
  if (res.ok && typeof taskId === 'string' && taskId) return { ok: true, jobId: `${KLING_PREFIX}${taskId}` };
  return { ok: false, status: res.status, data };
}

async function klingStatus(taskId: string): Promise<VideoJobStatus> {
  const res = await fetch(`/api/generate/kling/status/${encodeURIComponent(taskId)}`, { headers: authHeaders() });
  const data = await res.json().catch(() => null);
  if (res.status === 404 || res.status === 403) return { status: 'failed', error: 'The video service has no record of this render. Retry the scene.' };
  if (!res.ok) return { status: 'processing', error: String(data?.error || `status HTTP ${res.status}`) };
  const status = String(data?.status || '').toLowerCase();
  if (status === 'completed' && data?.videoUrl) return { status: 'completed', videoUrl: String(data.videoUrl), progress: 100 };
  if (status === 'failed') return { status: 'failed', error: String(data?.errorMessage || data?.error || 'The render failed at the provider.') };
  return { status: 'processing' };
}

export const VideoModelService = {
  config: VIDEO_MODEL,
  models: VIDEO_MODELS,

  /** Submit ONE clip generation. Reference priority is decided upstream by the
   * director — this method only transports what it is given. */
  async createVideo(params: CreateVideoParams): Promise<VideoJob> {
    const cfg = params.model || VIDEO_MODEL;
    const duration = snapDuration(params.durationS, cfg);
    const assets = (params.referenceAssets || []).filter((a) => a && /^https:\/\//.test(String(a.url || '')));
    const seed = assets.find((a) => a.role === 'first_frame') || null;
    const refs = assets.filter((a) => a.role === 'reference').slice(0, cfg.maxReferenceImages);

    if (cfg.provider === 'kling') {
      const attempt = await submitKling(cfg, params, seed ? seed.url : null);
      if (!attempt.ok) throw new Error(classifySubmitError(attempt.status, attempt.data));
      return { jobId: attempt.jobId, model: cfg.model };
    }

    const body: Record<string, unknown> = {
      model: cfg.apiModel,
      prompt: capText(params.prompt, cfg.promptMaxChars),
      aspectRatio: params.aspect,
      duration,
      // Blocks only genuinely high-confidence violations — the default level
      // false-positives on seeded continuity frames.
      safetyFilterLevel: 'block_only_high',
    };
    // Omni renders native audio; the openrouter path is video-only.
    if (cfg.provider === 'google') body.generateAudio = true;
    if (params.negative) body.negativePrompt = capText(params.negative, cfg.negativeMaxChars);
    if (seed) body.imageData = seed.url;
    if (refs.length) body.referenceImages = refs.map((r) => ({ imageData: r.url, referenceType: 'asset' }));

    let attempt = await submitVeoProxyOnce(body);
    // Duration fallback: if the proxy rejects a long clip (e.g. 10s) with a 400,
    // retry once at the known-safe maximum instead of failing the scene.
    if (!attempt.ok && attempt.status === 400 && duration > cfg.safeMaxDuration) {
      attempt = await submitVeoProxyOnce({ ...body, duration: cfg.safeMaxDuration });
    }
    if (!attempt.ok) throw new Error(classifySubmitError(attempt.status, attempt.data));
    return { jobId: attempt.jobId, model: cfg.model };
  },

  /** One status check for a running job. Kling jobs carry a 'kling:' prefix on
   * their stored id, so polling routes correctly even after a reload. */
  async getGenerationStatus(jobId: string): Promise<VideoJobStatus> {
    if (jobId.startsWith(KLING_PREFIX)) return klingStatus(jobId.slice(KLING_PREFIX.length));
    const res = await fetch(`/api/veo/status/${encodeURIComponent(jobId)}`);
    const data = await res.json().catch(() => null);
    if (res.status === 404) return { status: 'failed', error: 'The video service has no record of this render (404). Retry the scene.' };
    if (!res.ok) return { status: 'processing', error: String(data?.error || `status HTTP ${res.status}`) };
    const status = String(data?.status || '').toLowerCase();
    if (status === 'completed' && data?.videoUrl) return { status: 'completed', videoUrl: String(data.videoUrl), progress: 100 };
    if (status === 'failed' || status === 'error') return { status: 'failed', error: String(data?.errorMessage || data?.error || 'The render failed at the provider.') };
    return { status: 'processing', progress: Number(data?.progress) || undefined };
  },

  /** Poll a job to completion; resolves with the clip URL or throws with the
   * provider's reason. Times out so a dead job never hangs a scene forever. */
  async getVideoResult(jobId: string, opts: { onProgress?: (p: number) => void; timeoutMs?: number } = {}): Promise<string> {
    const cfg = VIDEO_MODEL;
    const deadline = Date.now() + (opts.timeoutMs || cfg.timeoutMs);
    let misses = 0;
    while (Date.now() < deadline) {
      if (cancelled.has(jobId)) { cancelled.delete(jobId); throw new Error('This generation was cancelled.'); }
      const st = await this.getGenerationStatus(jobId);
      if (st.status === 'completed' && st.videoUrl) return st.videoUrl;
      if (st.status === 'failed') throw new Error(st.error || 'The render failed.');
      if (st.error) { misses += 1; if (misses >= 6) throw new Error(`The video service stopped answering: ${st.error}`); }
      else misses = 0;
      if (opts.onProgress && typeof st.progress === 'number') opts.onProgress(st.progress);
      await new Promise((r) => setTimeout(r, cfg.pollIntervalMs));
    }
    throw new Error(`The render took too long (${Math.round((opts.timeoutMs || cfg.timeoutMs) / 60000)} minutes). Retry the scene.`);
  },

  /** Upload a reference image (File/Blob or data: URL) → durable public URL. */
  async uploadReference(input: File | Blob | string, fileName = `s2v-ref-${Date.now()}.png`): Promise<string> {
    if (typeof input === 'string') {
      if (/^https:\/\//.test(input)) return input; // already durable
      if (input.startsWith('data:')) return uploadDataUrl(input, fileName);
      throw new Error('A reference must be a file, a data: URL, or an https URL.');
    }
    return uploadBlob(input, fileName);
  },

  /** Abandon a running job: the poll loop stops and the scene is released.
   * (The platform proxies expose no provider-side cancel.) */
  cancelGeneration(jobId: string): void {
    if (jobId) cancelled.add(jobId);
  },
};
