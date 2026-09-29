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
 * - 'runway' → POST /api/generate/runway/video + GET /api/generate/runway/status/:taskId,
 *   straight from the browser: stv-scene-generate has no Runway route, and the
 *   proxy needs its own X-Workspace-DB-Token + per-submit Idempotency-Key.
 *   Runway job ids are stored with a 'runway:' prefix so polling routes
 *   correctly across a reload, exactly like the kling: prefix below. The
 *   registry lists the FULL Runway text-to-video roster from ../runwayRoster
 *   (Gen 4.5, Veo 3.1, Seedance 2.0 / Fast / Mini / 2.5, MiniMax H3 and H3
 *   Max, WAN 3.0 and 3.0 Prime, Grok Imagine Video 1.5, HappyHorse 1.0,
 *   Gemini Omni Flash and Omni Flash 1.1, plus image-only Gen 4 Turbo).
 *   THAT module owns the id spellings and resolves the platform's own spelling
 *   from GET /api/generate/runway/capabilities, so a submit always carries the
 *   id the proxy actually accepts. A model is refused before the round trip
 *   only when the LIVE catalog was read and did not list it — never on a local
 *   guess.
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

import { Aspect, ReferenceAsset, appId, sessionId, uploadBlob, uploadDataUrl, wsToken } from '../api';
import { checkRunway, runwaySubmitVideo } from '../../../lib/videoEngineClient';
import {
  RUNWAY_ROSTER, RunwayRosterModel, clampRosterDuration, rosterInputLabel,
  rosterModel, rosterRatio, rosterState, submitModelId, syncRunwayRoster,
} from '../runwayRoster';

// ---------------------------------------------------------------------------
// Central model registry — add or change models HERE and nowhere else.
// ---------------------------------------------------------------------------

export type VideoProvider = 'google' | 'openrouter' | 'kling' | 'runway';

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
  /** True when the model cannot start from a prompt alone — every clip needs
   * a seed frame (Runway Gen 4 Turbo). */
  imageToVideoOnly?: boolean;
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

/** Registry ids for Runway entries: legacy films stored 'runway-gen4.5' /
 * 'runway-gen4-turbo' on their rows, so those two keep their historic ids;
 * every other roster model registers as `runway-<roster id>`. */
function runwayRegistryId(catalogId: string): string {
  if (catalogId === 'gen4.5') return 'runway-gen4.5';
  if (catalogId === 'gen4_turbo') return 'runway-gen4-turbo';
  return `runway-${catalogId}`;
}

function runwayConfig(m: RunwayRosterModel): VideoModelConfig {
  const id = runwayRegistryId(m.id);
  const durations = [4, 5, 6, 8, 10].filter((d) => d >= m.minDurationS && d <= m.maxDurationS);
  // An image-only model is the only entry that carries a note at build time:
  // real availability is read live and recomputed by the pickers, never frozen
  // into this registry.
  const availabilityNote = m.inputType === 'image'
    ? `${rosterInputLabel(m)} only — it animates a continuation scene’s seed frame. An opening scene has no seed frame, so start the film on a text-capable model such as Gen 4.5.`
    : undefined;
  return {
    id,
    label: m.label,
    provider: 'runway',
    model: id,
    apiModel: m.id,
    ...(m.inputType === 'image' ? { imageToVideoOnly: true } : {}),
    supportedDurations: durations.length ? durations : [m.defaultDurationS],
    safeMaxDuration: m.maxDurationS,
    maxReferenceImages: 0,
    promptMaxChars: 1000,
    negativeMaxChars: 0,
    pollIntervalMs: 5000,
    timeoutMs: 15 * 60 * 1000,
    ...(availabilityNote ? { availabilityNote } : {}),
  };
}

/** Every Runway video model this app can run, in picker order. */
export const RUNWAY_VIDEO_CONFIGS: VideoModelConfig[] = RUNWAY_ROSTER.map(runwayConfig);

export const RUNWAY_GEN_4_5: VideoModelConfig = RUNWAY_VIDEO_CONFIGS.find((m) => m.apiModel === 'gen4.5') || RUNWAY_VIDEO_CONFIGS[0];
export const RUNWAY_GEN_4_TURBO: VideoModelConfig = RUNWAY_VIDEO_CONFIGS.find((m) => m.apiModel === 'gen4_turbo') || RUNWAY_VIDEO_CONFIGS[0];

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

/** Every model the pipeline can run on, in picker order. The Runway roster
 * leads because Gen 4.5 is this app's default engine for a NEW film. */
export const VIDEO_MODELS: VideoModelConfig[] = [...RUNWAY_VIDEO_CONFIGS, VIDEO_MODEL, SEEDANCE_2_0, KLING_V2_MASTER];

/** The engine a NEW film starts on. Films created before the picker existed
 * stored no id at all and were rendered on Omni Flash, so resolveVideoModel
 * still falls back to VIDEO_MODEL for them — only new work defaults here. */
export const DEFAULT_FILM_MODEL: VideoModelConfig = RUNWAY_GEN_4_5;

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

/**
 * SERVER-SIDE GENERATION (Sep 2026): the browser never calls the generation
 * proxies directly any more. Every submit and status check goes through the
 * stv-scene-generate server function, which talks to the providers, applies
 * the duration fallback, and normalizes the answers — so a closed laptop lid
 * mid-submit can't strand a scene and the provider calls run server-side.
 */
async function callGenerateHook(payload: Record<string, unknown>): Promise<any> {
  let res: Response;
  try {
    res = await fetch(`/api/hooks/execute/${appId()}/stv-scene-generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(wsToken() ? { 'X-Workspace-DB-Token': wsToken() } : {}),
        ...(sessionId() ? { 'X-Session-Id': sessionId() } : {}),
      },
      body: JSON.stringify(payload),
    });
  } catch (e: any) {
    throw new Error(`Could not reach the video service: ${String(e?.message || e)}`);
  }
  const raw = await res.json().catch(() => null);
  const data = raw && typeof raw === 'object' && raw.response !== undefined && raw._meta !== undefined ? raw.response : raw;
  if (!res.ok) throw new Error(String(data?.error || `The generation service answered HTTP ${res.status}.`));
  return data || {};
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

/** Submit one generation through the server hook. The hook applies the
 * duration fallback and rejects placeholder failure ids itself. */
async function submitViaHook(provider: VideoProvider, body: Record<string, unknown>, safeMaxDuration: number): Promise<{ ok: true; jobId: string } | { ok: false; status: number; data: any }> {
  const out = await callGenerateHook({ op: 'submit', provider, body, safeMaxDuration });
  if (out?.status === 'submitted' && typeof out.operationId === 'string' && out.operationId) {
    return { ok: true, jobId: String(out.operationId) };
  }
  return { ok: false, status: Number(out?.httpStatus) || 0, data: out?.data || { error: String(out?.error || 'Video submit failed.') } };
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

    if (cfg.provider === 'runway') {
      // Availability is live: the roster is refreshed from
      // GET /api/generate/runway/capabilities (cached, never throws). A model
      // is refused before the round trip ONLY when that read succeeded and did
      // not list it — an unreadable catalog lets the submit through so the
      // proxy answers for itself instead of a stale local guess blocking it.
      await syncRunwayRoster();
      const live = rosterModel(cfg.apiModel);
      if (live && !live.available && rosterState() === 'live') {
        throw new Error(live.unavailableReason || `${cfg.label} is not enabled on the Audos Runway proxy right now — pick another model for this film.`);
      }
      const seedUrl = String(seed?.url || '');
      const imageOnly = live ? live.inputType === 'image' : Boolean(cfg.imageToVideoOnly);
      if (imageOnly && !seedUrl) {
        throw new Error(`${cfg.label} only animates an existing frame, and this scene has none. Render the opening scene on a text-capable model (Runway Gen 4.5 or Omni Flash) — image-to-video models can carry the continuations.`);
      }
      const runwayBody: Record<string, unknown> = {
        // The platform's own spelling of the id whenever the live catalog
        // supplied one — the canonical roster id otherwise.
        model: live ? submitModelId(live) : cfg.apiModel,
        promptText: capText(params.prompt, cfg.promptMaxChars),
        ratio: rosterRatio(params.aspect, live, Boolean(seedUrl)),
        duration: clampRosterDuration(params.durationS, live),
      };
      if (seedUrl) {
        runwayBody.mode = 'image-to-video';
        // promptImage is a bounded HTTPS string here, not a { uri } object —
        // that shape belongs to the recipe media fields.
        runwayBody.promptImage = seedUrl;
      }
      try {
        const kickoff = await runwaySubmitVideo(runwayBody);
        return { jobId: `runway:${kickoff.taskId}`, model: cfg.model };
      } catch (e: any) {
        throw new Error(classifySubmitError(Number(e?.status) || 0, { error: String(e?.message || e) }));
      }
    }

    if (cfg.provider === 'kling') {
      // Kling wants durations as the strings '5' | '10'; a seed frame routes
      // the hook to the image-to-video endpoint.
      const klingBody: Record<string, unknown> = {
        model: cfg.apiModel,
        prompt: capText(params.prompt, cfg.promptMaxChars),
        mode: 'std',
        duration: String(snapDuration(params.durationS, cfg)),
        aspectRatio: params.aspect,
      };
      if (params.negative) klingBody.negativePrompt = capText(params.negative, cfg.negativeMaxChars);
      if (seed) klingBody.imageData = seed.url;
      const attempt = await submitViaHook('kling', klingBody, cfg.safeMaxDuration);
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

    // The hook retries once at safeMaxDuration when a long clip is rejected.
    const attempt = await submitViaHook(cfg.provider, body, cfg.safeMaxDuration);
    if (!attempt.ok) throw new Error(classifySubmitError(attempt.status, attempt.data));
    return { jobId: attempt.jobId, model: cfg.model };
  },

  /** One status check for a running job, answered by the server hook. Kling
   * jobs carry a 'kling:' prefix on their stored id, so polling routes
   * correctly even after a reload (the hook reads the prefix). */
  async getGenerationStatus(jobId: string): Promise<VideoJobStatus> {
    if (jobId.indexOf('runway:') === 0) {
      try {
        const result = await checkRunway(jobId.slice('runway:'.length));
        if (result.status === 'succeeded' && result.mediaUrls.length) {
          return { status: 'completed', videoUrl: result.mediaUrls[0], progress: 100 };
        }
        if (result.status === 'failed' || result.status === 'cancelled') {
          const reason = String(result.raw?.error?.message || result.raw?.error || 'no successful output');
          return { status: 'failed', error: `Runway ended this clip ${result.status}: ${reason}. The credits were refunded automatically.` };
        }
        // 'uncertain' and 'persisting' keep polling on purpose and are NEVER
        // resubmitted, so neither counts as an error here.
        return { status: 'processing' };
      } catch (e: any) {
        return { status: 'processing', error: String(e?.message || e) };
      }
    }
    let out: any;
    try {
      out = await callGenerateHook({ op: 'status', operationId: jobId });
    } catch (e: any) {
      return { status: 'processing', error: String(e?.message || e) };
    }
    const status = String(out?.status || '').toLowerCase();
    if (status === 'completed' && out?.videoUrl) return { status: 'completed', videoUrl: String(out.videoUrl), progress: 100 };
    if (status === 'failed') return { status: 'failed', error: String(out?.error || 'The render failed at the provider.') };
    return { status: 'processing', progress: Number(out?.progress) || undefined, error: out?.error ? String(out.error) : undefined };
  },

  /** Poll a job to completion; resolves with the clip URL or throws with the
   * provider's reason. Times out so a dead job never hangs a scene forever. */
  async getVideoResult(jobId: string, opts: { onProgress?: (p: number) => void; timeoutMs?: number } = {}): Promise<string> {
    const cfg = jobId.indexOf('runway:') === 0 ? RUNWAY_GEN_4_5 : VIDEO_MODEL;
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
