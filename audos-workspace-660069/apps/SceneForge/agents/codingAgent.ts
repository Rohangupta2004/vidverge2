import { claudeJson, sleep } from '../lib/proxy';
import { WORKSPACE_ID, type Asset, type Scene } from '../lib/supabase';

export const CODING_AGENT_SYSTEM = `You are SceneForge's Remotion coding agent. Return strict JSON {"code":string}. Write one valid TypeScript/TSX default-exported Remotion composition for the SINGLE scene described in the request. You are called once per scene and never see the other scenes, the spoken script or any picture, so the composition must stand on its own from the description and motion notes you are given. It receives {assets,motionBgSrc,description}; it may read image and video URLs ONLY from the runtime assets manifest props and must never hardcode a URL. Use AbsoluteFill, Img, Video, interpolate, spring and useCurrentFrame from remotion. The visual must fill the frame, animate clearly, contain no avatar picture and never add its own audio. Keep it to one tight file — roughly 120 lines — because the reply is length-capped and a truncated composition is unusable. HARD RULES about the render contract: the renderer supplies durationInFrames, so do NOT export calculateDemoVideoDuration or any other metadata helper — the renderer calls such a helper with no arguments while it resolves the composition, and a helper that reads its parameter crashes the whole render before a frame is drawn. Read every prop defensively (props may arrive empty during resolution): default the assets manifest to an empty array and render a plain coloured AbsoluteFill when nothing is available, never a bare .map or .length on a possibly-undefined prop.`;

export const SCENE_DESCRIPTION_LIMIT = 500;
export const SCENE_MOTION_NOTES_LIMIT = 400;
// One scene's worth of Remotion is short. A bigger ceiling only bought a
// longer generation for the proxy to time out on, which came back as a 500.
export const SCENE_CODE_MAX_TOKENS = 2000;

export interface CodeSceneOptions { aspectRatio?: '16:9' | '9:16'; styleMotion?: string; model?: string }

const brief = (value: unknown, limit: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);

// One isolated Claude call per scene, carrying that scene and nothing else.
// The request this replaces shipped the whole 300-second script, every other
// scene and the scenes' GCS still URLs in a single message, and the proxy
// answered the queue with a 500.
export async function codeScene(scene: Scene, options: CodeSceneOptions = {}) {
  return claudeJson<{ code: string }>(CODING_AGENT_SYSTEM, {
    scene_index: scene.scene_index,
    description: brief(scene.description, SCENE_DESCRIPTION_LIMIT),
    motion_notes: brief(scene.motion_notes, SCENE_MOTION_NOTES_LIMIT),
    aspect_ratio: options.aspectRatio || '16:9',
    style_motion_theme: brief(options.styleMotion, 200),
  }, options.model || 'claude-sonnet-5', SCENE_CODE_MAX_TOKENS);
}

export async function renderScene(code: string, scene: Scene, assets: Asset[], motionBgSrc?: string) {
  // A scene whose times never landed would make this NaN, which JSON sends as
  // null and the renderer rejects before it starts.
  const span = Number(scene.script_end_sec) - Number(scene.script_start_sec);
  const durationInFrames = Math.max(1, Math.min(18000, Math.round(Number.isFinite(span) && span > 0 ? span * 30 : 30)));
  const response = await fetch('/api/render/remotion', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId: WORKSPACE_ID, compositionTsx: code, props: { assets, motionBgSrc, description: scene.description }, durationInFrames }),
  });
  const started = await response.json().catch(() => ({}));
  if (!response.ok || !started.operationId) throw new Error(started.error || 'Scene render could not start');
  for (let i = 0; i < 150; i += 1) {
    await sleep(2000);
    // A dropped poll is not a failed render — the next tick asks again.
    const status = await fetch(`/api/render/remotion/${encodeURIComponent(started.operationId)}`).then((r) => r.json()).catch(() => null);
    if (!status) continue;
    if (status.status === 'complete' && status.videoUrl) return String(status.videoUrl);
    if (status.status === 'failed') throw new Error(status.error || 'Scene render failed');
  }
  throw new Error('Scene render timed out');
}
