import { updateScene, type Project, type Scene } from './supabase';
import { ProviderError, sceneForgeDurationLimits } from './providers';
import { OMNI_MODEL_ID, groupAModel, validateSceneDurations } from '../../../lib/videoEngines';
import { generateVideoClip, integrationForEngineId, type VideoIntegrationId } from '../../../lib/videoIntegrations';
import { EngineError } from '../../../lib/videoEngineClient';
import { APP_IDS } from '../../../lib/appIds';

// VIDEO TOOL — not an agent. This module contains no LLM: the single
// orchestrator LLM (agents/orchestrator.ts) writes every video prompt
// (scene.video_prompt), and this tool executes those prompts against the
// video model exactly as written.
//
// AI Video supporting scenes use the schema-validated
// /api/veo/generate/video proxy: Seedance 2 primary, canonical Gemini Omni
// Flash fallback when routing fails. The
// finished clip is written to the scene's render_url and placed DIRECTLY on
// the assembly timeline; no intermediate per-scene Remotion render exists
// anywhere on this path.
const PRIMARY_VIDEO_MODEL = 'openrouter/bytedance/seedance-2.0-fast';
const VIDEO_MODEL = PRIMARY_VIDEO_MODEL;

// The engine every supporting scene films on. Seedance 2 is the default;
// Gemini Omni Flash receives the same prompt, duration, seed and references
// only when the explicit fallback fires. Other engines remain selectable.
// The choice lives in localStorage
// rather than on the project row: render_url and its siblings are server-only
// columns, so a client-side preference must not pretend to be project data.
const ENGINE_KEY = 'sceneforge:video-engine';

export function sceneVideoEngine(): string {
  if (typeof localStorage === 'undefined') return VIDEO_MODEL;
  try { return localStorage.getItem(ENGINE_KEY) || VIDEO_MODEL; } catch { return VIDEO_MODEL; }
}

export function setSceneVideoEngine(id: string): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(ENGINE_KEY, id || VIDEO_MODEL); } catch { /* preference is best-effort */ }
}

const looksLikeVideo = (url?: string | null) => /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(String(url || ''));

export function sceneVideoPrompt(scene: Scene): string {
  const staged = String(scene.video_prompt || '').trim();
  // Capture/compositor fingerprints left by a kind switch are not video
  // prompts — fall through to scene text instead of trying to film a hash.
  if (staged && !/^(mg|ec|vbg):/.test(staged)) return staged;
  const motion = String(scene.motion_notes || '').trim();
  return [String(scene.description || '').trim(), motion].filter(Boolean).join('. ');
}

/** True when the scene already carries a generated clip for this exact prompt. */
export function hasFreshSceneVideo(scene: Scene, prompt: string): boolean {
  return looksLikeVideo(scene.render_url) && String(scene.video_prompt || '').trim() === prompt.trim();
}

export interface SceneVideoResult {
  videoUrl: string;
  reused: boolean;
  modelUsed: string;
  fallbackFrom?: string;
  fallbackNotice?: string;
}

/**
 * Generate (or reuse) the AI video clip for one supporting scene. Reuse is
 * the default: an existing clip made from the same prompt is never paid for
 * twice. The durable URL is persisted onto the scene through the server
 * function (render_url is a server-only column).
 */
export async function generateSceneVideo(project: Project, scene: Scene, options: { force?: boolean; model?: string; characterRefUrl?: string } = {}): Promise<SceneVideoResult> {
  const prompt = sceneVideoPrompt(scene);
  if (!prompt || prompt.length < 5) throw new Error(`Scene ${scene.scene_index} has no description to generate video from.`);
  const engine = options.model || sceneVideoEngine();
  if (!options.force && hasFreshSceneVideo(scene, prompt)) return { videoUrl: String(scene.render_url), reused: true, modelUsed: engine };

  const span = Number(scene.script_end_sec) - Number(scene.script_start_sec);
  const duration = Math.round(Number.isFinite(span) && span > 0 ? span : 8);
  const limits = sceneForgeDurationLimits(engine);
  const durationProblems = validateSceneDurations(engine, [duration], { limits });
  if (durationProblems.length) {
    throw new ProviderError(durationProblems[0], { provider: engine, sceneIndex: scene.scene_index, code: 'duration_contract', status: 400 });
  }
  const fail = (provider: string, message: string, opts: { status?: number; code?: string; retryAfterSeconds?: number } = {}) =>
    new ProviderError(message, { provider, sceneIndex: scene.scene_index, ...opts });

  const seedStill = /^https:\/\//.test(String(scene.render_url || '')) && !looksLikeVideo(scene.render_url)
    ? String(scene.render_url)
    : null;
  const characterRef = /^https:\/\//.test(String(options.characterRefUrl || ''))
    ? [{ imageData: String(options.characterRefUrl), referenceType: 'asset' as const }]
    : null;

  const fullPrompt = `${prompt}. Cinematic, high quality, no on-screen text or lettering, no watermark.`;

  const request = (model: string, references: typeof characterRef) => generateVideoClip({
    integration: integrationForEngineId(model) as VideoIntegrationId,
    model,
    prompt: fullPrompt,
    aspectRatio: project.aspect_ratio as '16:9' | '9:16' | '1:1',
    duration,
    imageData: seedStill,
    referenceImages: references,
    appId: APP_IDS.sceneForge,
  });
  const errorFields = (error: any) => ({
    status: error instanceof EngineError ? error.status : Number(error?.status) || undefined,
    code: error instanceof EngineError ? error.code : error?.code,
    retryAfterSeconds: error instanceof EngineError ? error.retryAfterSeconds : undefined,
  });

  try {
    const videoUrl = await request(engine, groupAModel(engine)?.supportsReferenceImages ? characterRef : null);
    await updateScene(scene.id, { render_url: videoUrl, video_prompt: prompt, status: 'ready' }, scene.project_id);
    return { videoUrl, reused: false, modelUsed: engine };
  } catch (primaryError: any) {
    const primaryMessage = primaryError instanceof EngineError
      ? primaryError.message
      : String(primaryError?.message || primaryError || 'the generation request failed');
    const fields = errorFields(primaryError);
    const canFallback = engine === PRIMARY_VIDEO_MODEL
      && fields.status !== 400
      && fields.status !== 401
      && fields.status !== 402
      && fields.status !== 403
      && fields.code !== 'duration_contract'
      && fields.code !== 'cancelled';
    if (!canFallback) throw fail(engine, primaryMessage, fields);

    try {
      // Creative intent is immutable across the fallback: same exact prompt,
      // same scene duration/division, same seed image, and every available
      // character reference. Only the provider id changes.
      const videoUrl = await request(OMNI_MODEL_ID, characterRef);
      await updateScene(scene.id, { render_url: videoUrl, video_prompt: prompt, status: 'ready' }, scene.project_id);
      const fallbackNotice = `Scene ${scene.scene_index}: Seedance 2 could not route this clip (${primaryMessage}). Gemini Omni Flash rendered the same prompt, scene duration and references instead.`;
      return { videoUrl, reused: false, modelUsed: OMNI_MODEL_ID, fallbackFrom: engine, fallbackNotice };
    } catch (fallbackError: any) {
      const fallbackMessage = fallbackError instanceof EngineError
        ? fallbackError.message
        : String(fallbackError?.message || fallbackError || 'the fallback generation failed');
      throw fail(OMNI_MODEL_ID, `Seedance 2 failed first (${primaryMessage}); Gemini Omni Flash fallback also failed (${fallbackMessage}).`, errorFields(fallbackError));
    }
  }
}
