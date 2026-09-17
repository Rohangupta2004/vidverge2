import { updateProject, type Asset, type Project, type Scene } from '../lib/supabase';
import { forgeApi } from '../lib/forge';
import { sleep, workspaceToken } from '../lib/proxy';
import type { ForgeStyle } from '../styles/registry';

// Every option routes through the `sceneforge-v2` server function, which calls
// the platform image proxies with a server-side X-App-Id and writes the
// scene's protected `render_url`. A browser call could do neither.
//
// Known platform state (verified 17 Sep 2026): `/api/veo/generate/image` is
// currently refusing this workspace with a `veo_generations` foreign-key
// error, so DALL·E 3 and Nano Banana fall back to the platform OpenAI proxy
// and the UI reports the model that actually ran. Nothing silently pretends.
export const IMAGE_MODELS = [
  { id: 'gpt-image-2', label: 'GPT Image 2', detail: 'OpenAI · newest image model' },
  { id: 'gpt-image', label: 'Platform default', detail: 'OpenAI gpt-image-1.5 · fastest, most reliable' },
  { id: 'dall-e-3', label: 'DALL·E 3', detail: 'OpenAI · detailed prompt following' },
  { id: 'gemini-3.1-flash-image', label: 'Nano Banana 2', detail: 'Gemini · strong art direction' },
] as const;
export type ImageModelId = typeof IMAGE_MODELS[number]['id'];
export const DEFAULT_IMAGE_MODEL: ImageModelId = 'gpt-image-2';

export interface SceneImageResult { url: string; model: string; fallbackFrom?: string | null; fallbackReason?: string | null }

const IMAGE_RETRY_DELAYS_MS = [1500, 4000];
const TRANSIENT_IMAGE_ERROR = /abort|timed?\s*out|timeout|network|fetch|HTTP\s*(?:408|425|429|5\d\d)|did not answer/i;

/**
 * Image generation is synchronous behind the SceneForge server function and
 * can occasionally hit the platform fetch ceiling with "This operation was
 * aborted". Retry only those transient failures; invalid prompts and policy
 * errors still fail immediately. Batch calls use `reuse: true`, so a late
 * first attempt that already persisted its image is returned, not regenerated.
 */
async function withImageRetry<T>(request: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= IMAGE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      lastError = error;
      const message = String((error as any)?.message || error);
      if (attempt >= IMAGE_RETRY_DELAYS_MS.length || !TRANSIENT_IMAGE_ERROR.test(message)) throw error;
      await sleep(IMAGE_RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastError;
}

/** One scene, one picture. Callers fan these out so each card lights up alone. */
export async function generateSceneImage(project: Project, scene: Scene, imageModel = DEFAULT_IMAGE_MODEL, style?: ForgeStyle, promptOverride?: string): Promise<SceneImageResult> {
  const result = await withImageRetry(() => forgeApi.sceneImage(project.id, scene.id, {
    prompt: promptOverride || scene.image_prompts?.[0] || scene.description,
    model: imageModel,
    style_prefix: style?.imagePromptPrefix || '',
    reuse: false,
  }));
  return { url: result.imageUrl, model: result.model, fallbackFrom: result.fallback_from, fallbackReason: result.fallback_reason };
}

/** Used by the batch run: reuses a picture the scene already has. */
export async function ensureSceneImage(project: Project, scene: Scene, style: ForgeStyle, imageModel = DEFAULT_IMAGE_MODEL): Promise<SceneImageResult> {
  const result = await withImageRetry(() => forgeApi.sceneImage(project.id, scene.id, {
    prompt: scene.image_prompts?.[0] || scene.description,
    model: imageModel,
    style_prefix: style.imagePromptPrefix,
    reuse: true,
  }));
  return { url: result.imageUrl, model: result.model, fallbackFrom: result.fallback_from, fallbackReason: result.fallback_reason };
}

/** Kept for the assembly manifest: the scene images already stored for a project. */
export function sceneImageAssets(assets: Asset[], sceneId: string) {
  return assets.filter((asset) => asset.scene_id === sceneId && asset.public_url);
}

export async function ensureMotionBackground(project: Project, style: ForgeStyle) {
  if (project.motion_bg_url) return project.motion_bg_url;
  const response = await fetch('/api/veo/generate/video', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': workspaceToken() }, body: JSON.stringify({ model: 'veo-3.1-fast-generate-preview', prompt: `A seamless subtle motion background for ${style.name}: ${style.description}. Abstract texture only, no people, objects, logos or text. Designed to loop behind transparent elements.`, aspectRatio: project.aspect_ratio, duration: 8, resolution: '1080p', generateAudio: false }) });
  const start = await response.json().catch(() => ({})); if (!response.ok || !start.operationId) throw new Error(start.error || 'Motion background generation failed');
  for (let i = 0; i < 90; i += 1) {
    await sleep(5000);
    const status = await fetch(`/api/veo/status/${encodeURIComponent(start.operationId)}`).then((r) => r.json());
    if (status.status === 'completed' && status.videoUrl) { await updateProject(project.id, { motion_bg_url: status.videoUrl }); return String(status.videoUrl); }
    if (status.status === 'failed') throw new Error(status.errorMessage || 'Motion background failed');
  }
  throw new Error('Motion background timed out');
}
