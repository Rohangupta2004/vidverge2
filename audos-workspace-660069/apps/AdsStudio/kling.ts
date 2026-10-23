/**
 * ADS STUDIO — KLING adapter (platform integration: kling-video).
 *
 * Kling is the consistency engine: its multi-image / Elements route keeps one
 * character and one visual style across every cut, and it is the ONLY engine
 * on this platform that takes a real `seed` integer.
 *
 *   POST /api/generate/kling/text-to-video    prompt only
 *   POST /api/generate/kling/image-to-video   one reference image
 *   POST /api/generate/kling/multi-image      2–4 reference images (Elements)
 *   GET  /api/generate/kling/status/:taskId   poll every 5s
 *   GET  /api/generate/kling/models           live capability catalogue
 *
 * WHY THIS LIVES IN apps/AdsStudio AND NOT IN lib/videoEngines.ts
 * lib/videoEngines.ts carries a founder ruling (26 Sep 2026) that Kling is
 * absent, and five other apps render their engine pickers from that list. A
 * live probe of GET /api/generate/kling/models on 26 Sep 2026 answered 200
 * with the full catalogue, so Kling IS configured — but re-populating the
 * shared list would silently change Product Video, SceneForge, Script-to-
 * Video, Video Enhancer and Creatables too. Ads Studio therefore keeps its
 * own adapter and asks the live catalogue every session instead of trusting
 * either the shared list or this comment.
 *
 * CAPABILITIES ARE READ, NOT ASSUMED. The modern Kling 2.5/2.6/3.0/3.0-omni
 * ids all report supportedModes ['std','pro'] per the current Kling API docs.
 * Asking for a mode a model does not have is a provider rejection, so the
 * mode is always resolved against what the catalogue actually said.
 */

import { wsToken } from './api';
import { EngineError, describeHttpError, isPublicHttpsUrl } from '../../lib/videoEngineClient';

export type KlingAspect = '16:9' | '9:16' | '1:1';
export type KlingMode = 'std' | 'pro';

/** Ads Studio's preferred order: newest first, all Elements-capable. */
export const KLING_PREFERRED_MODELS = ['kling-3.0-omni', 'kling-3.0', 'kling-2.6', 'kling-2.5-turbo'] as const;

export interface KlingModelCaps {
  id: string;
  label: string;
  capabilities: string[];
  supportedModes: KlingMode[];
  supportedDurations: string[];
  supportedAspectRatios: string[];
}

export interface KlingAvailability {
  available: boolean;
  models: KlingModelCaps[];
  /** Customer-facing sentence when Kling cannot be used. */
  message: string;
}

const KLING_UNAVAILABLE =
  'Kling is not answering on this platform right now — this ad will render on Gemini Omni Flash with the same reference images instead.';

function klingHeaders(): Record<string, string> {
  const token = wsToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'X-Workspace-DB-Token': token } : {}),
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function caps(raw: any): KlingModelCaps | null {
  const id = String(raw?.id || raw?.apiName || '');
  if (!id) return null;
  const modes = (Array.isArray(raw?.supportedModes) ? raw.supportedModes : [])
    .map(String)
    .filter((m: string): m is KlingMode => m === 'std' || m === 'pro');
  return {
    id,
    label: String(raw?.label || id),
    capabilities: (Array.isArray(raw?.capabilities) ? raw.capabilities : []).map(String),
    supportedModes: modes.length ? modes : ['std'],
    supportedDurations: (Array.isArray(raw?.supportedDurations) ? raw.supportedDurations : ['5', '10']).map(String),
    supportedAspectRatios: (Array.isArray(raw?.supportedAspectRatios) ? raw.supportedAspectRatios : ['16:9', '9:16', '1:1']).map(String),
  };
}

let availabilityPromise: Promise<KlingAvailability> | null = null;

/**
 * Ask the live catalogue whether Kling is configured. Cached for the session
 * so the engine card, the generation loop and the product-screen clip share
 * ONE probe instead of producing a burst on load.
 */
export function checkKlingAvailability(force = false): Promise<KlingAvailability> {
  if (availabilityPromise && !force) return availabilityPromise;
  availabilityPromise = (async () => {
    try {
      const res = await fetch('/api/generate/kling/models', { headers: klingHeaders() });
      const data = await res.json().catch(() => null);
      if (!res.ok) return { available: false, models: [], message: KLING_UNAVAILABLE };
      const models = (Array.isArray(data?.models) ? data.models : [])
        .map(caps)
        .filter((m: KlingModelCaps | null): m is KlingModelCaps => !!m);
      if (!models.length) return { available: false, models: [], message: KLING_UNAVAILABLE };
      return { available: true, models, message: 'Kling is ready.' };
    } catch {
      return { available: false, models: [], message: KLING_UNAVAILABLE };
    }
  })();
  return availabilityPromise;
}

/** The best Elements-capable model the live catalogue actually offers. */
export function pickKlingModel(models: KlingModelCaps[], wanted?: string | null): KlingModelCaps | null {
  if (!models.length) return null;
  const byId = (id: string) => models.find((m) => m.id === id) || null;
  return byId(String(wanted || ''))
    || KLING_PREFERRED_MODELS.map(byId).find(Boolean)
    || models.find((m) => m.capabilities.includes('multi-image'))
    || models[0];
}

/** 'pro' only when the catalogue says this model has it (v2-master does not). */
export function resolveKlingMode(model: KlingModelCaps, wanted: KlingMode = 'pro'): KlingMode {
  return model.supportedModes.includes(wanted) ? wanted : model.supportedModes[0] || 'std';
}

/** Kling renders 5s or 10s only — a 4/6/8s script clip snaps to the nearest. */
export function klingDuration(seconds: number): '5' | '10' {
  return Number(seconds) >= 8 ? '10' : '5';
}

export interface KlingClipParams {
  prompt: string;
  negativePrompt?: string;
  aspect: KlingAspect;
  durationS: number;
  /** The real integer seed — Kling's own reproducibility parameter. */
  seed?: number | null;
  /** The locked character reference (a photo or a generated frame). */
  characterImageUrl?: string | null;
  /** The style reference — normally a frame lifted from scene 1. */
  styleImageUrl?: string | null;
  modelId?: string | null;
  mode?: KlingMode;
  cfgScale?: number;
  onStatus?: (message: string) => void;
}

export interface KlingClipResult {
  videoUrl: string;
  taskId: string;
  modelUsed: string;
  /** Which Kling route actually ran — recorded, never assumed. */
  route: 'multi-image' | 'image-to-video' | 'text-to-video';
}

function publicRefs(params: KlingClipParams): string[] {
  return [params.characterImageUrl, params.styleImageUrl]
    .map((u) => String(u || ''))
    .filter((u) => u && isPublicHttpsUrl(u));
}

async function kickoff(path: string, body: Record<string, unknown>, context: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(path, { method: 'POST', headers: klingHeaders(), body: JSON.stringify(body) });
  } catch (e: any) {
    throw new EngineError(`Could not reach Kling: ${String(e?.message || e)}`, { code: 'network', retryable: true });
  }
  const data = await res.json().catch(() => null);
  if (res.status === 503) throw new EngineError(KLING_UNAVAILABLE, { code: 'provider_unavailable', status: 503 });
  if (!res.ok) throw describeHttpError(res.status, data, context);
  const taskId = String(data?.taskId || data?.task_id || '');
  if (!taskId) {
    throw new EngineError('Kling accepted the request without returning a task id.', { code: 'no_task_id', status: res.status });
  }
  return taskId;
}

/** Poll one Kling task to its re-hosted platform MP4. */
export async function pollKling(
  taskId: string,
  opts: { onStatus?: (s: string) => void; timeoutMs?: number } = {},
): Promise<string> {
  const deadline = Date.now() + (opts.timeoutMs || 12 * 60 * 1000);
  let misses = 0;
  while (Date.now() < deadline) {
    let data: any = null;
    let res: Response | null = null;
    try {
      res = await fetch(`/api/generate/kling/status/${encodeURIComponent(taskId)}`, { headers: klingHeaders() });
      data = await res.json().catch(() => null);
    } catch { /* a dropped status read is a miss, not an answer */ }
    if (res && res.ok) {
      misses = 0;
      const status = String(data?.status || '').toLowerCase();
      if (status === 'completed' && data?.videoUrl) return String(data.videoUrl);
      if (status === 'failed') {
        throw new EngineError(String(data?.errorMessage || 'The Kling render failed at the provider.'), { code: 'render_failed' });
      }
      opts.onStatus?.(status || 'processing');
    } else {
      misses += 1;
      if (misses >= 6) {
        throw new EngineError(`Kling stopped answering status checks for this clip (HTTP ${res?.status || 0}).`, { code: 'poll_lost', retryable: true });
      }
    }
    await sleep(5000);
  }
  throw new EngineError('The Kling render is taking unusually long. It may still finish — do not resubmit it.', { code: 'timeout' });
}

/**
 * Render ONE clip on Kling. The route is chosen from what is actually
 * available: two references go to Elements (the strongest consistency path),
 * one goes to image-to-video, none goes to text-to-video. The seed and the
 * negative prompt travel on all three.
 */
export async function renderKlingClip(params: KlingClipParams): Promise<KlingClipResult> {
  const gate = await checkKlingAvailability();
  if (!gate.available) throw new EngineError(gate.message, { code: 'provider_unavailable', status: 503 });
  const model = pickKlingModel(gate.models, params.modelId);
  if (!model) throw new EngineError(gate.message, { code: 'provider_unavailable', status: 503 });

  const mode = resolveKlingMode(model, params.mode || 'pro');
  const duration = klingDuration(params.durationS);
  const aspect = model.supportedAspectRatios.includes(params.aspect) ? params.aspect : '9:16';
  const refs = publicRefs(params);
  const seed = Math.floor(Number(params.seed));

  const shared: Record<string, unknown> = {
    prompt: String(params.prompt || '').slice(0, 2500),
    mode,
    duration,
  };
  if (params.negativePrompt) shared.negativePrompt = String(params.negativePrompt).slice(0, 2500);
  if (Number.isFinite(seed) && seed > 0) shared.seed = seed;
  if (typeof params.cfgScale === 'number') shared.cfgScale = params.cfgScale;

  let route: KlingClipResult['route'];
  let taskId: string;
  if (refs.length >= 2 && model.capabilities.includes('multi-image')) {
    route = 'multi-image';
    params.onStatus?.(`Kling Elements (${model.label}, ${mode}) — locking the character and style from ${refs.length} references…`);
    // Elements derives its own framing from the references, so aspectRatio is
    // not part of this route's documented body.
    taskId = await kickoff('/api/generate/kling/multi-image', { ...shared, model: model.id, images: refs.slice(0, 4) }, 'The Kling Elements request');
  } else if (refs.length === 1) {
    route = 'image-to-video';
    params.onStatus?.(`Kling image-to-video (${model.label}, ${mode}) — animating the reference…`);
    taskId = await kickoff('/api/generate/kling/image-to-video', { ...shared, model: model.id, imageData: refs[0] }, 'The Kling image-to-video request');
  } else {
    route = 'text-to-video';
    params.onStatus?.(`Kling text-to-video (${model.label}, ${mode})…`);
    taskId = await kickoff('/api/generate/kling/text-to-video', { ...shared, model: model.id, aspectRatio: aspect }, 'The Kling video request');
  }

  params.onStatus?.(`Kling task ${taskId} — polling every 5s…`);
  const videoUrl = await pollKling(taskId, { onStatus: (s) => params.onStatus?.(`Kling — ${s}…`) });
  return { videoUrl, taskId, modelUsed: `kling:${model.id}:${mode}`, route };
}

/** True for an Ads Studio engine id that means "render on Kling". */
export function isKlingEngineId(id: string | null | undefined): boolean {
  return /^kling-/.test(String(id || ''));
}
