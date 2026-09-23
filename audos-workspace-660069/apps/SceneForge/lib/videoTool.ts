import { updateScene, type Project, type Scene } from './supabase';
import { sleep, workspaceToken } from './proxy';

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
export async function generateSceneVideo(project: Project, scene: Scene, options: { force?: boolean; model?: string } = {}): Promise<SceneVideoResult> {
  const prompt = sceneVideoPrompt(scene);
  if (!prompt || prompt.length < 5) throw new Error(`Scene ${scene.scene_index} has no description to generate video from.`);
  if (!options.force && hasFreshSceneVideo(scene, prompt)) return { videoUrl: String(scene.render_url), reused: true };

  const span = Number(scene.script_end_sec) - Number(scene.script_start_sec);
  const duration = Math.max(2, Math.min(MAX_CLIP_SECONDS, Math.round(Number.isFinite(span) && span > 0 ? span : MAX_CLIP_SECONDS)));
  const response = await fetch('/api/veo/generate/video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': workspaceToken() },
    body: JSON.stringify({
      // Workspace-selectable engine (SceneForge settings) — Omni Flash default.
      model: options.model || VIDEO_MODEL,
      prompt: `${prompt}. Cinematic, high quality, no on-screen text or lettering, no watermark.`,
      aspectRatio: project.aspect_ratio,
      duration,
      generateAudio: false,
    }),
  });
  const start = await response.json().catch(() => ({}));
  if (!response.ok || !start.operationId) throw new Error(start.error || `Scene ${scene.scene_index} video generation could not start`);

  for (let i = 0; i < 120; i += 1) {
    await sleep(5000);
    // A dropped poll is not a failed render — the next tick asks again.
    const status = await fetch(`/api/veo/status/${encodeURIComponent(start.operationId)}`).then((r) => r.json()).catch(() => null);
    if (!status) continue;
    if (status.status === 'completed' && status.videoUrl) {
      const videoUrl = String(status.videoUrl);
      await updateScene(scene.id, { render_url: videoUrl, video_prompt: prompt, status: 'ready' }, scene.project_id);
      return { videoUrl, reused: false };
    }
    if (status.status === 'failed') throw new Error(status.errorMessage || `Scene ${scene.scene_index} video generation failed`);
  }
  throw new Error(`Scene ${scene.scene_index} video generation timed out. Retry it, or switch the scene to Text/Graphics.`);
}
