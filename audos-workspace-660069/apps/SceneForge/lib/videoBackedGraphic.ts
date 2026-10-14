import { generateVideoClip, integrationForEngineId, type VideoIntegrationId } from '../../../lib/videoIntegrations';
import { APP_IDS } from '../../../lib/appIds';
import { sceneVideoEngine } from './videoTool';
import { sceneForgeDurationLimits } from './providers';
import { OMNI_MODEL_ID, validateSceneDurations } from '../../../lib/videoEngines';
import { updateScene, type Project, type Scene } from './supabase';
import { directElementComposition, directScene, fallbackDirection } from '../agents/motionDirector';
import type { MotionProduceOptions } from './motionPipeline';
import { effectiveComposition, visualKindOf as kindOf } from './effects';
interface SceneNeighbors { prevKind?: string | null; nextKind?: string | null }
import { sceneDirection, sceneMotionDuration, sceneMotionSpec } from './motionScene';
import { directionFingerprint, normalizeSceneDirection, type DirectedLayer, type SceneDirection } from './visualTimeline';
import { motionFingerprint } from './motionSpec';
import { visualKindOf } from './effects';
import { normalizeElementComposition, type ElementComposition } from './elementComposition';

async function ensureSceneDirection(project: Project, scene: Scene, neighbors: SceneNeighbors = {}): Promise<Scene> {
  if (sceneDirection(scene)) return scene;
  const spec = sceneMotionSpec(scene);
  const aspect: '16:9' | '9:16' = project.aspect_ratio === '9:16' ? '9:16' : '16:9';
  const durationSec = sceneMotionDuration(scene);
  const kind = kindOf(scene.visual_kind);
  const composition = effectiveComposition(kind, scene.overlay_config, spec.kind);
  let direction: SceneDirection;
  try {
    direction = await directScene({
      description: String(scene.description || ''),
      narrationSegment: String((scene as Scene & { narration_segment?: string }).narration_segment || ''),
      motionNotes: String(scene.motion_notes || ''),
      visualKind: kind,
      spec,
      durationSec,
      aspect,
      compositionMode: composition?.mode || 'fullscreen',
      prevKind: neighbors.prevKind,
      nextKind: neighbors.nextKind,
    });
  } catch {
    direction = fallbackDirection(spec, durationSec, aspect);
  }
  await updateScene(scene.id, { director_timeline: direction as unknown as Record<string, unknown> }, scene.project_id).catch(() => undefined);
  return { ...scene, director_timeline: direction as unknown as Record<string, unknown> };
}

const looksLikeVideo = (url?: string | null) => /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(String(url || ''));

export interface VideoBackedGraphicSpec {
  version: 1;
  type: 'video_backed_graphic';
  background_prompt: string;
  background_clip_url?: string;
  /** Exact brief that produced background_clip_url; prevents stale clip reuse after an edit. */
  background_clip_prompt?: string;
  /** Independently animated z=1–4 layers rendered over the clip by Remotion. */
  element_composition?: ElementComposition;
  spec_fingerprint?: string;
}

export function normalizeVideoBackedSpec(raw: unknown): VideoBackedGraphicSpec | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  if (source.type !== 'video_backed_graphic' && !source.background_prompt) return null;
  const prompt = String(source.background_prompt || source.backgroundPrompt || '').trim();
  if (!prompt) return null;
  const spec: VideoBackedGraphicSpec = {
    version: 1,
    type: 'video_backed_graphic',
    background_prompt: prompt.slice(0, 1200),
  };
  const url = String(source.background_clip_url || source.backgroundClipUrl || '').trim();
  if (looksLikeVideo(url)) spec.background_clip_url = url;
  const clipPrompt = String(source.background_clip_prompt || source.backgroundClipPrompt || '').trim();
  if (clipPrompt) spec.background_clip_prompt = clipPrompt.slice(0, 1200);
  const composition = normalizeElementComposition(source.element_composition ?? source.elementComposition);
  if (composition) spec.element_composition = composition;
  if (source.spec_fingerprint) spec.spec_fingerprint = String(source.spec_fingerprint).slice(0, 60);
  return spec;
}

export function sceneVideoBackedSpec(scene: Scene): VideoBackedGraphicSpec | null {
  const fromRow = normalizeVideoBackedSpec((scene as Scene & { composition_spec?: unknown }).composition_spec);
  if (fromRow) return fromRow;
  const prompt = String(scene.video_prompt || scene.motion_notes || '').trim();
  if (!prompt || prompt.startsWith('mg:') || prompt.startsWith('vbg:') || prompt.startsWith('ec:')) return null;
  return { version: 1, type: 'video_backed_graphic', background_prompt: prompt };
}

export function videoBackedFingerprint(scene: Scene): string {
  const spec = sceneMotionSpec(scene);
  const base = motionFingerprint(spec);
  const direction = sceneDirection(scene);
  const dir = direction ? directionFingerprint(direction) : '0';
  const vbg = sceneVideoBackedSpec(scene);
  const bg = vbg?.background_prompt || '';
  let hash = 5381;
  const ordered = `${base}|${dir}|${bg}`;
  for (let i = 0; i < ordered.length; i += 1) hash = ((hash << 5) + hash + ordered.charCodeAt(i)) >>> 0;
  return `vbg:${hash.toString(36)}`;
}

/** True when background clip + director timeline match the current spec/prompt. */
export function hasFreshVideoBackedGraphic(scene: Scene): boolean {
  if (visualKindOf(scene.visual_kind) !== 'video_backed_graphic') return false;
  const vbg = sceneVideoBackedSpec(scene);
  if (!vbg?.background_clip_url || !looksLikeVideo(vbg.background_clip_url)) return false;
  if (!vbg.element_composition || vbg.element_composition.type !== 'multi_element') return false;
  if (vbg.background_clip_prompt?.trim() !== vbg.background_prompt.trim()) return false;
  if (vbg.spec_fingerprint !== motionFingerprint(sceneMotionSpec(scene))) return false;
  if (String(scene.video_prompt || '') !== videoBackedFingerprint(scene)) return false;
  return Boolean(sceneDirection(scene));
}

export function directorLayersOf(scene: Scene): DirectedLayer[] {
  const direction = sceneDirection(scene) || normalizeSceneDirection(scene.director_timeline);
  return direction?.layers || [];
}

async function generateBackgroundClip(project: Project, scene: Scene, prompt: string, force?: boolean, onNote?: (note: string) => void): Promise<string> {
  const vbg = sceneVideoBackedSpec(scene);
  if (!force && vbg?.background_clip_url && looksLikeVideo(vbg.background_clip_url) && vbg.background_clip_prompt?.trim() === prompt.trim()) return vbg.background_clip_url;
  const span = Number(scene.script_end_sec) - Number(scene.script_start_sec);
  const duration = Math.round(Number.isFinite(span) && span > 0 ? span : 8);
  const engine = sceneVideoEngine();
  const limits = sceneForgeDurationLimits(engine);
  const durationProblems = validateSceneDurations(engine, [duration], { limits });
  if (durationProblems.length) throw new Error(`Scene ${scene.scene_index}: ${durationProblems[0]}`);
  const fullPrompt = `${prompt}. Cinematic documentary B-roll, rich motion, no on-screen text, no lettering, no watermark, no UI.`;
  const request = (model: string) => generateVideoClip({
    integration: integrationForEngineId(model) as VideoIntegrationId,
    model,
    prompt: fullPrompt,
    aspectRatio: project.aspect_ratio as '16:9' | '9:16' | '1:1',
    duration,
    appId: APP_IDS.sceneForge,
  });
  try {
    return await request(engine);
  } catch (error: any) {
    const status = Number(error?.status) || 0;
    const code = String(error?.code || '');
    if (engine !== 'openrouter/bytedance/seedance-2.0-fast' || [400, 401, 402, 403].includes(status) || code === 'cancelled') throw error;
    const why = String(error?.message || error || 'routing failure');
    onNote?.(`Scene ${scene.scene_index}: Seedance 2 could not route the background clip (${why}). Gemini Omni Flash is rendering the same prompt and duration instead.`);
    return request(OMNI_MODEL_ID);
  }
}

/**
 * Produce one video_backed_graphic scene: Seedance/Veo background + Motion Director layers.
 * The final composite happens at Remotion assembly (not a GSAP full-frame capture).
 */
export async function produceVideoBackedGraphicScene(
  project: Project,
  scene: Scene,
  options: MotionProduceOptions = {},
): Promise<{ scene: Scene; fingerprint: string; backgroundUrl: string }> {
  const vbg = sceneVideoBackedSpec(scene);
  const existingDirection = sceneDirection(scene);
  const background_prompt = String(vbg?.background_prompt || existingDirection?.background_prompt || scene.motion_notes || scene.description || '').trim();
  if (background_prompt.length < 8) throw new Error(`Scene ${scene.scene_index} needs a motion-rich background_prompt for video_backed_graphic.`);

  let working = await ensureSceneDirection(project, scene, options.neighbors || {});
  let fingerprint = videoBackedFingerprint(working);
  if (!options.force && hasFreshVideoBackedGraphic(working)) {
    const existing = sceneVideoBackedSpec(working)!;
    return { scene: working, fingerprint, backgroundUrl: String(existing.background_clip_url) };
  }

  const direction = sceneDirection(working) || fallbackDirection(sceneMotionSpec(working), sceneMotionDuration(working), project.aspect_ratio === '9:16' ? '9:16' : '16:9');
  const directedPrompt = String(direction.background_prompt || background_prompt).trim();
  fingerprint = videoBackedFingerprint({ ...working, composition_spec: { version: 1, type: 'video_backed_graphic', background_prompt: directedPrompt } } as Scene);
  options.onNote?.(`Scene ${scene.scene_index}: generating cinematic background footage…`);
  const backgroundUrl = await generateBackgroundClip(project, working, directedPrompt, options.force, options.onNote);
  options.onNote?.(`Scene ${scene.scene_index}: directing independent depth layers…`);
  const elementComposition = await directElementComposition({
    spec: sceneMotionSpec(working),
    direction,
    durationSec: sceneMotionDuration(working),
    aspect: project.aspect_ratio === '9:16' ? '9:16' : '16:9',
    backgroundPrompt: directedPrompt,
  });
  const spec: VideoBackedGraphicSpec = {
    version: 1,
    type: 'video_backed_graphic',
    background_prompt: directedPrompt,
    background_clip_url: backgroundUrl,
    background_clip_prompt: directedPrompt,
    element_composition: elementComposition,
    spec_fingerprint: motionFingerprint(sceneMotionSpec(working)),
  };
  await updateScene(working.id, {
    composition_spec: spec as unknown as Record<string, unknown>,
    video_prompt: fingerprint,
    status: 'ready',
  }, working.project_id).catch(() => undefined);
  working = {
    ...working,
    composition_spec: spec as unknown as Record<string, unknown>,
    video_prompt: fingerprint,
    status: 'ready',
  };
  return { scene: working, fingerprint, backgroundUrl };
}
