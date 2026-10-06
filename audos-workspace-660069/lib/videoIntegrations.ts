/**
 * Native Audos video integrations — one catalog for all six platform proxies.
 * Apps pick an integration, then a model within it; `generateVideoClip` routes
 * to the correct endpoint with `X-Workspace-DB-Token` on every paid call.
 */

import type { AppId } from './appIds';
import {
  GROUP_A_MODELS,
  DEFAULT_ENGINE_ID,
  KLING_MODELS,
  HIGGSFIELD_VIDEO_MODELS,
  RUNWAY_MODELS,
  groupAModel,
  isRunwayModel,
  runwayModel,
  runwayVideoRatio,
  clampRunwayDuration,
} from './videoEngines';
import {
  EngineError,
  submitGroupA,
  pollGroupA,
  postGeneration,
  submitKlingVideo,
  pollKling,
  submitHiggsfieldVideo,
  pollHiggsfield,
  runwaySubmitVideo,
  pollRunway,
} from './videoEngineClient';
import { generateWithRunway } from './runwayAdapter';

export type VideoIntegrationId =
  | 'image-and-video-generation'
  | 'google-veo3'
  | 'kling-video'
  | 'higgsfield-media'
  | 'heygen-video'
  | 'runway-recipes';

export interface VideoIntegrationMeta {
  id: VideoIntegrationId;
  label: string;
  blurb: string;
  /** Scene-clip integrations (HeyGen is presenter-only). */
  role: 'scene' | 'presenter';
}

export const VIDEO_INTEGRATIONS: VideoIntegrationMeta[] = [
  {
    id: 'image-and-video-generation',
    label: 'Image & Video (unified)',
    blurb: 'Seedance, Sora, Gemini Omni Flash, OpenRouter Veo — full schema proxy at /api/veo/generate/video.',
    role: 'scene',
  },
  {
    id: 'google-veo3',
    label: 'Google Veo',
    blurb: 'Veo 2/3/3.1 and convenience /api/generate/video when you want the platform default.',
    role: 'scene',
  },
  {
    id: 'kling-video',
    label: 'Kling AI',
    blurb: 'Text-to-video, image-to-video, Elements, extend, and lip-sync via /api/generate/kling/*.',
    role: 'scene',
  },
  {
    id: 'higgsfield-media',
    label: 'Higgsfield',
    blurb: 'Cinematic text-to-video (Hailuo) and camera-motion image-to-video (DoP).',
    role: 'scene',
  },
  {
    id: 'heygen-video',
    label: 'HeyGen',
    blurb: 'Avatar and prompt-driven presenter videos — use the HeyGen panels, not scene B-roll.',
    role: 'presenter',
  },
  {
    id: 'runway-recipes',
    label: 'Runway Gen-4',
    blurb: 'Gen 4.5 / Turbo video plus product-ad recipes on /api/generate/runway/*.',
    role: 'scene',
  },
];

/** Convenience id for POST /api/generate/video (platform-managed veo-3.1). */
export const GOOGLE_VEO_CONVENIENCE_MODEL = 'platform-veo-3.1-managed';

export interface IntegrationModelOption {
  id: string;
  label: string;
  hint?: string;
}

export function integrationMeta(id: string | null | undefined): VideoIntegrationMeta | null {
  return VIDEO_INTEGRATIONS.find((entry) => entry.id === id) || null;
}

export function modelsForIntegration(integration: VideoIntegrationId): IntegrationModelOption[] {
  switch (integration) {
    case 'image-and-video-generation':
      return GROUP_A_MODELS.map((m) => ({ id: m.id, label: m.name, hint: m.costHint }));
    case 'google-veo3':
      return [
        { id: GOOGLE_VEO_CONVENIENCE_MODEL, label: 'Veo 3.1 (managed default)', hint: 'POST /api/generate/video' },
        ...GROUP_A_MODELS.filter((m) => m.provider === 'Google' || m.id.startsWith('veo-')).map((m) => ({ id: m.id, label: m.name, hint: m.costHint })),
        ...GROUP_A_MODELS.filter((m) => m.id.startsWith('sora')).map((m) => ({ id: m.id, label: m.name, hint: m.costHint })),
      ];
    case 'kling-video':
      return KLING_MODELS.map((m) => ({ id: m.id, label: m.name, hint: m.blurb.slice(0, 80) }));
    case 'higgsfield-media':
      return HIGGSFIELD_VIDEO_MODELS.map((m) => ({ id: m.id, label: m.name, hint: m.blurb.slice(0, 80) }));
    case 'runway-recipes':
      return RUNWAY_MODELS.filter((m) => m.type === 'video').map((m) => ({
        id: m.id,
        label: m.label,
        hint: m.available ? m.priceNote : (m.unavailableReason || 'unavailable'),
      }));
    case 'heygen-video':
      return [{ id: 'heygen-avatar', label: 'HeyGen avatar / agent', hint: 'Configure in the HeyGen character panel.' }];
    default:
      return [];
  }
}

export function defaultModelForIntegration(integration: VideoIntegrationId): string {
  const models = modelsForIntegration(integration);
  if (integration === 'image-and-video-generation' || integration === 'google-veo3') {
    return models.find((m) => m.id === DEFAULT_ENGINE_ID)?.id || models[0]?.id || DEFAULT_ENGINE_ID;
  }
  return models[0]?.id || '';
}

/** Infer integration from a legacy engine id stored on older projects. */
export function integrationForEngineId(engineId: string): VideoIntegrationId {
  const id = String(engineId || '');
  if (id === 'heygen' || id === 'heygen-avatar') return 'heygen-video';
  if (isRunwayModel(id)) return 'runway-recipes';
  if (KLING_MODELS.some((m) => m.id === id)) return 'kling-video';
  if (HIGGSFIELD_VIDEO_MODELS.some((m) => m.id === id)) return 'higgsfield-media';
  if (id === GOOGLE_VEO_CONVENIENCE_MODEL) return 'google-veo3';
  if (groupAModel(id)) return 'image-and-video-generation';
  return 'image-and-video-generation';
}

export interface GenerateVideoClipParams {
  integration: VideoIntegrationId;
  model: string;
  prompt: string;
  aspectRatio?: '16:9' | '9:16' | '1:1';
  duration?: number;
  imageData?: string | null;
  referenceImages?: { imageData: string; mimeType?: string; referenceType: 'asset' | 'style' }[] | null;
  appId?: AppId;
  onProgress?: (progress: number) => void;
}

/**
 * Generate one clip URL through the selected native integration.
 * Surfaces provider errors via EngineError — never swallows failures.
 */
export async function generateVideoClip(params: GenerateVideoClipParams): Promise<string> {
  const integration = params.integration;
  const model = params.model;
  const aspect = params.aspectRatio || '16:9';
  const duration = params.duration;

  if (integration === 'heygen-video') {
    throw new EngineError('HeyGen renders avatar videos from the HeyGen character panel — pick a scene engine for B-roll clips.', { code: 'wrong_integration' });
  }

  if (integration === 'image-and-video-generation') {
    const kickoff = await submitGroupA({
      appId: params.appId,
      model,
      prompt: params.prompt,
      aspectRatio: aspect,
      duration,
      generateAudio: false,
      imageData: params.imageData || undefined,
      referenceImages: params.referenceImages || undefined,
    });
    return pollGroupA(kickoff.operationId, { onProgress: params.onProgress, creditKey: kickoff.creditKey, appId: params.appId });
  }

  if (integration === 'google-veo3') {
    if (model === GOOGLE_VEO_CONVENIENCE_MODEL) {
      const body: Record<string, unknown> = {
        prompt: params.prompt,
        aspectRatio: aspect,
        generateAudio: false,
      };
      if (duration) body.duration = duration;
      if (params.imageData) body.imageData = params.imageData;
      const { res, data } = await postGeneration('/api/generate/video', body, params.appId);
      if (!res.ok) throw new EngineError(String(data?.error || data?.errorMessage || data?.message || `Google Veo request failed (${res.status}).`), { status: res.status });
      const operationId = String(data?.operationId || '');
      if (!operationId) throw new EngineError(String(data?.errorMessage || 'Google Veo did not return an operation id.'), { code: 'no_operation' });
      return pollGroupA(operationId, { onProgress: params.onProgress, appId: params.appId });
    }
    const kickoff = await submitGroupA({
      appId: params.appId,
      model,
      prompt: params.prompt,
      aspectRatio: aspect,
      duration,
      generateAudio: false,
      imageData: params.imageData || undefined,
      referenceImages: params.referenceImages || undefined,
    });
    return pollGroupA(kickoff.operationId, { onProgress: params.onProgress, creditKey: kickoff.creditKey, appId: params.appId });
  }

  if (integration === 'kling-video') {
    const kickoff = await submitKlingVideo({
      model,
      prompt: params.prompt,
      aspectRatio: aspect,
      duration,
      imageData: params.imageData || undefined,
    });
    return pollKling(kickoff.taskId, { onProgress: params.onProgress });
  }

  if (integration === 'higgsfield-media') {
    const kickoff = await submitHiggsfieldVideo({
      model,
      prompt: params.prompt,
      aspectRatio: aspect,
      durationSeconds: duration,
      imageData: params.imageData || undefined,
    });
    return pollHiggsfield(kickoff.requestId, { onProgress: params.onProgress });
  }

  if (integration === 'runway-recipes') {
    const rw = runwayModel(model);
    if (rw?.available && rw.route === 'video') {
      const seed = params.imageData && /^https:\/\//.test(params.imageData) ? params.imageData : null;
      const out = await generateWithRunway({
        model,
        prompt: params.prompt,
        image: seed,
        aspectRatio: aspect,
        duration: duration || rw.defaultDurationS || 5,
      });
      const url = out.mediaUrls[0];
      if (!url) throw new EngineError('Runway finished but returned no clip URL.', { code: 'no_media' });
      return url;
    }
    const seconds = clampRunwayDuration(duration, model);
    const ratio = runwayVideoRatio(aspect, model, Boolean(params.imageData));
    const body: Record<string, unknown> = {
      model,
      ratio,
      duration: seconds,
      promptText: params.prompt,
    };
    if (params.imageData && /^https:\/\//.test(params.imageData)) {
      body.mode = 'image-to-video';
      body.promptImage = params.imageData;
    }
    const kickoff = await runwaySubmitVideo(body, { seconds });
    const result = await pollRunway(kickoff.taskId, { creditKey: kickoff.creditKey });
    const url = result.mediaUrls[0];
    if (!url) throw new EngineError('Runway finished but returned no clip URL.', { code: 'no_media' });
    return url;
  }

  throw new EngineError(`Unknown video integration "${integration}".`, { code: 'unknown_integration' });
}

export const VIDEO_INTEGRATION_STORAGE_KEY = 'vidverge:video-integration';
export const VIDEO_MODEL_STORAGE_KEY = 'vidverge:video-model';

export function loadVideoSelection(): { integration: VideoIntegrationId; model: string } {
  const fallback = { integration: 'image-and-video-generation' as VideoIntegrationId, model: DEFAULT_ENGINE_ID };
  if (typeof window === 'undefined') return fallback;
  try {
    const integration = String(window.sessionStorage.getItem(VIDEO_INTEGRATION_STORAGE_KEY) || '') as VideoIntegrationId;
    const model = String(window.sessionStorage.getItem(VIDEO_MODEL_STORAGE_KEY) || '');
    const meta = integrationMeta(integration);
    if (!meta || meta.role !== 'scene') return fallback;
    const models = modelsForIntegration(integration);
    const chosen = models.some((m) => m.id === model) ? model : defaultModelForIntegration(integration);
    return { integration, model: chosen };
  } catch {
    return fallback;
  }
}

export function saveVideoSelection(integration: VideoIntegrationId, model: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(VIDEO_INTEGRATION_STORAGE_KEY, integration);
    window.sessionStorage.setItem(VIDEO_MODEL_STORAGE_KEY, model);
  } catch { /* preference only */ }
}
