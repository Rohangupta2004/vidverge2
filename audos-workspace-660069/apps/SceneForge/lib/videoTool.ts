import { updateScene, type Project, type Scene } from './supabase';
import { ProviderError } from './providers';
import { groupAModel } from '../../../lib/videoEngines';
import { generateVideoClip, integrationForEngineId, type VideoIntegrationId } from '../../../lib/videoIntegrations';
import { studioConfigOf } from './studioConfig';
import { EngineError } from '../../../lib/videoEngineClient';
import { APP_IDS } from '../../../lib/appIds';

// VIDEO TOOL — not an agent. This module contains no LLM: the single
// orchestrator LLM (agents/orchestrator.ts) writes every video prompt
// (scene.video_prompt), and this tool executes those prompts against the
// video model exactly as written.
//
// AI Video supporting scenes reuse the EXISTING generation pipeline — the
// same schema-validated /api/veo/generate/video proxy on Gemini Omni Flash
// that already renders the motion background (see lib/imageTool.ts). The
// finished clip is written to the scene's render_url and placed DIRECTLY on
// the assembly timeline; no intermediate per-scene Remotion render exists
// anywhere on this path.
const VIDEO_MODEL = 'gemini-omni-flash-preview';

// The engine every supporting scene films on. Omni Flash stays the default
// because it is the one model that carries a character reference across
// scenes, which is this app's whole point; Runway is offered for shots where
// look matters more than cast continuity. The choice lives in localStorage
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

// Omni clips cap at 8 seconds; a scene window that runs longer simply loops
// the clip inside the final composition, so the request never over-asks.
const MAX_CLIP_SECONDS = 8;

const looksLikeVideo = (url?: string | null) => /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(String(url || ''));

export function sceneVideoPrompt(scene: Scene): string {
  const staged = String(scene.video_prompt || '').trim();
  // An 'mg:' value is a motion-capture fingerprint left by a kind switch, not
  // a video prompt — fall through to the scene text instead of "filming" it.
  if (staged && !staged.startsWith('mg:')) return staged;
  const motion = String(scene.motion_notes || '').trim();
  return [String(scene.description || '').trim(), motion].filter(Boolean).join('. ');
}

/** True when the scene already carries a generated clip for this exact prompt. */
export function hasFreshSceneVideo(scene: Scene, prompt: string): boolean {
  return looksLikeVideo(scene.render_url) && String(scene.video_prompt || '').trim() === prompt.trim();
}

export interface SceneVideoResult { videoUrl: string; reused: boolean }

/**
 * Generate (or reuse) the AI video clip for one supporting scene. Reuse is
 * the default: an existing clip made from the same prompt is never paid for
 * twice. The durable URL is persisted onto the scene through the server
 * function (render_url is a server-only column).
 */
export async function generateSceneVideo(project: Project, scene: Scene, options: { force?: boolean; model?: string; characterRefUrl?: string } = {}): Promise<SceneVideoResult> {
  const prompt = sceneVideoPrompt(scene);
  if (!prompt || prompt.length < 5) throw new Error(`Scene ${scene.scene_index} has no description to generate video from.`);
  if (!options.force && hasFreshSceneVideo(scene, prompt)) return { videoUrl: String(scene.render_url), reused: true };

  const span = Number(scene.script_end_sec) - Number(scene.script_start_sec);
  const duration = Math.max(2, Math.min(MAX_CLIP_SECONDS, Math.round(Number.isFinite(span) && span > 0 ? span : MAX_CLIP_SECONDS)));
  const engine = options.model || sceneVideoEngine();
  const studio = studioConfigOf(project);
  const integration = (String(studio.video_integration || '') || integrationForEngineId(engine)) as VideoIntegrationId;

  const fail = (message: string, opts: { status?: number; code?: string; retryAfterSeconds?: number } = {}) =>
    new ProviderError(message, { provider: engine, sceneIndex: scene.scene_index, ...opts });

  const seedStill = /^https:\/\//.test(String(scene.render_url || '')) && !looksLikeVideo(scene.render_url)
    ? String(scene.render_url)
    : null;
  const characterRef = /^https:\/\//.test(String(options.characterRefUrl || '')) && groupAModel(engine)?.supportsReferenceImages
    ? [{ imageData: String(options.characterRefUrl), referenceType: 'asset' as const }]
    : null;

  const fullPrompt = `${prompt}. Cinematic, high quality, no on-screen text or lettering, no watermark.`;

  try {
    const videoUrl = await generateVideoClip({
      integration,
      model: engine,
      prompt: fullPrompt,
      aspectRatio: project.aspect_ratio as '16:9' | '9:16' | '1:1',
      duration,
      imageData: seedStill,
      referenceImages: characterRef,
      appId: APP_IDS.sceneForge,
    });
    await updateScene(scene.id, { render_url: videoUrl, video_prompt: prompt, status: 'ready' }, scene.project_id);
    return { videoUrl, reused: false };
  } catch (error: any) {
    const message = error instanceof EngineError
      ? error.message
      : String(error?.message || error || 'the generation request failed');
    throw fail(message, {
      status: error instanceof EngineError ? error.status : Number(error?.status) || undefined,
      code: error instanceof EngineError ? error.code : error?.code,
      retryAfterSeconds: error instanceof EngineError ? error.retryAfterSeconds : undefined,
    });
  }
}
