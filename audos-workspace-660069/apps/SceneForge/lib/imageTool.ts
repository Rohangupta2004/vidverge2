import { updateProject, type Asset, type Project, type Scene } from './supabase';
import { forgeApi } from './forge';
import { sleep, workspaceToken } from './proxy';
import type { ForgeStyle } from '../styles/registry';

// IMAGE TOOL — not an agent. This module contains no LLM: the single
// orchestrator LLM (agents/orchestrator.ts) writes every image prompt, and
// this tool executes those prompts against the image model exactly as
// written, returning durable asset URLs.
//
// Every scene image routes through the `sceneforge-v2` server function, which
// calls the schema-validated /api/veo/generate/image proxy with model
// gemini-3.1-flash-image and writes the scene's protected `render_url`. A
// browser call could do neither.
//
// HyperFrames + Omni Flash policy: Gemini's flash image model is the only
// picture model this app uses -- no picker, no GPT Image / DALL-E fallback.
// (Fixed 17 Sep 2026: the earlier `veo_generations` foreign-key error was
// caused by the server function sending an X-App-Id header on that call;
// removing the header makes it resolve synchronously and reliably.)
export const IMAGE_MODELS = [
  { id: 'gemini-3.1-flash-image', label: 'Omni Flash', detail: 'Gemini · strong art direction, consistent with the rest of the pipeline' },
] as const;
export type ImageModelId = typeof IMAGE_MODELS[number]['id'];
export const DEFAULT_IMAGE_MODEL: ImageModelId = 'gemini-3.1-flash-image';

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
  // HyperFrames + Omni Flash policy: the motion background renders on Gemini
  // Omni Flash, not Veo -- no other video model is called from this app.
  const response = await fetch('/api/veo/generate/video', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': workspaceToken() }, body: JSON.stringify({ model: 'gemini-omni-flash-preview', prompt: `A seamless subtle motion background for ${style.name}: ${style.description}. Abstract texture only, no people, objects, logos or text. Designed to loop behind transparent elements.`, aspectRatio: project.aspect_ratio, duration: 8, generateAudio: false }) });
  const start = await response.json().catch(() => ({})); if (!response.ok || !start.operationId) throw new Error(start.error || 'Motion background generation failed');
  for (let i = 0; i < 90; i += 1) {
    await sleep(5000);
    const status = await fetch(`/api/veo/status/${encodeURIComponent(start.operationId)}`).then((r) => r.json());
    if (status.status === 'completed' && status.videoUrl) { await updateProject(project.id, { motion_bg_url: status.videoUrl }); return String(status.videoUrl); }
    if (status.status === 'failed') throw new Error(status.errorMessage || 'Motion background failed');
  }
  throw new Error('Motion background timed out');
}
