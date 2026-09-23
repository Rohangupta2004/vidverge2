/**
 * ORCHESTRATOR — the explicit state machine of the sequential Script-to-Video
 * pipeline (Sep 2026 rebuild).
 *
 *   SCRIPT_RECEIVED → ANALYZING_SCRIPT → SEGMENTING_SCRIPT → PREPARING_SCENE
 *   → PROMPT_READY → (user clicks Generate) → GENERATING_VIDEO → VIDEO_COMPLETED
 *   → EXTRACTING_FINAL_FRAME → FRAME_READY → DETERMINE_NEXT_REFERENCE
 *   → PREPARE_NEXT_SCENE → PROMPT_READY → …
 *   → ALL_SCENES_COMPLETED → FFMPEG_ASSEMBLY → FINAL_VIDEO
 *
 * Core rules enforced here:
 * - Opus understands the WHOLE story first (one segmentation pass), then
 *   prepares exactly ONE clip prompt at a time.
 * - Prompt preparation and video generation are SEPARATE operations — the
 *   user (or the optional auto mode) triggers each generation explicitly, and
 *   dependent clips are never generated simultaneously.
 * - After every clip: read the REAL duration from media metadata, extract and
 *   validate the final frame with FFmpeg, then let Opus decide whether the
 *   NEXT scene continues from that frame or opens independently.
 * - A failed scene never loses completed scenes and never restarts the film:
 *   retry / regenerate-prompt / character-reference-fallback / skip act on
 *   that one scene only.
 *
 * Every step persists to WorkspaceDB, so a reload resumes instead of restarting.
 */

import {
  Aspect, Film, FilmCharacter, FilmScene, MachineState, ReferenceAsset,
  VideoClipSpec, db, generateBackdropImage, newSceneKey, sceneFingerprint,
} from '../api';
import {
  characterPortraitBrief, extractVisualAttributes, prepareScenePrompt,
  segmentScript, validateScene,
} from './opus';
import { VideoModelService, resolveVideoModel } from './videoModelService';
import { extractFinalFrame, probeVideoDuration } from './frames';
import { extractFrame as canvasExtractFrame } from './capture';
import { assembleFilm } from './assemble';
import { FinishSettings, buildCaptions, prepareFinish } from './finish';
import {
  AudioLayer, AudioLayerError, MAX_SCENE_EXTENSION_S, audioFingerprint,
  audioReady, audioScenes, ensureAudioPlan, generateMusicAudio,
  generateNarrationAudio, generateSfxAudio, musicReady, narrationReady,
  persistSceneNarration, sfxReady, skipMusicLayer, skipSfxLayer,
  withMusicPreset,
} from './audio';

export interface RunHooks {
  onFilm?: (patch: Partial<Film>) => void;
  onScene?: (sceneId: number, patch: Partial<FilmScene>) => void;
  onNote?: (note: string) => void;
  /** Live Final Assembly progress (steps + percent). Never faked — driven by
   * the real layer states and FFmpeg's own progress callbacks. */
  onAssembly?: (progress: AssemblyProgress) => void;
}

const say = (hooks: RunHooks, note: string) => { try { hooks.onNote?.(note); } catch { /* UI only */ } };

async function patchFilm(film: Film, hooks: RunHooks, patch: Partial<Film>): Promise<void> {
  Object.assign(film, patch);
  try { hooks.onFilm?.(patch); } catch { /* UI only */ }
  await db.updateFilm(film.id, patch);
}

async function patchScene(scene: FilmScene, hooks: RunHooks, patch: Partial<FilmScene>): Promise<void> {
  Object.assign(scene, patch);
  try { hooks.onScene?.(scene.id, patch); } catch { /* UI only */ }
  await db.updateScene(scene.id, patch);
}

async function setState(film: Film, hooks: RunHooks, state: MachineState, note?: string): Promise<void> {
  await patchFilm(film, hooks, { machine_state: state, ...(note ? { stage_note: note } : {}) });
  if (note) say(hooks, note);
}

// ---------------------------------------------------------------------------
// Scene selection helpers
// ---------------------------------------------------------------------------

const DONE = new Set(['completed', 'skipped']);

export function orderedScenes(scenes: FilmScene[]): FilmScene[] {
  return [...scenes].sort((a, b) => a.idx - b.idx);
}

/** The scene currently in play: the first (by order) not completed/skipped. */
export function activeScene(scenes: FilmScene[]): FilmScene | null {
  return orderedScenes(scenes).find((s) => !DONE.has(String(s.status))) || null;
}

/** The nearest COMPLETED earlier scene — the continuity source. */
export function previousCompletedScene(scenes: FilmScene[], beforeIdx: number): FilmScene | null {
  return orderedScenes(scenes).filter((s) => s.idx < beforeIdx && s.status === 'completed' && s.asset_url).pop() || null;
}

export function allScenesDone(scenes: FilmScene[]): boolean {
  return scenes.length > 0 && scenes.every((s) => DONE.has(String(s.status)));
}

// ---------------------------------------------------------------------------
// Stage 1 — script received → analyzed → segmented → first scene prepared
// ---------------------------------------------------------------------------

export async function createAndSegmentFilm(params: {
  script: string;
  aspect: Aspect;
  referenceImageUrl?: string | null;
  note?: string;
  /** Video model registry id (see VIDEO_MODELS); null/undefined = default. */
  videoModel?: string | null;
}, hooks: RunHooks = {}): Promise<{ film: Film; scenes: FilmScene[] }> {
  const film = await db.createFilm({
    title: null,
    script: params.script,
    aspect_ratio: params.aspect,
    status: 'planning',
    machine_state: 'SCRIPT_RECEIVED',
    stage_note: 'Script received.',
    product_screenshot_url: params.referenceImageUrl || null,
    video_model: resolveVideoModel(params.videoModel).id,
  });
  try {
    await setState(film, hooks, 'ANALYZING_SCRIPT', 'The director is reading the entire script and mapping the story…');
    const plan = await segmentScript({
      script: params.script,
      aspect: params.aspect,
      note: params.note,
      referenceImageUrl: params.referenceImageUrl,
    });
    await setState(film, hooks, 'SEGMENTING_SCRIPT', `Story understood — breaking it into ${plan.scenes.length} sequential clips…`);

    const planScenes = plan.scenes.map((s, i) => ({
      scene_key: newSceneKey(),
      idx: i,
      type: 'video_clip' as const,
      script_segment: s.script_segment,
      duration_s: s.duration_s,
      continuity_group: null,
      spec: { summary: s.summary, visual_goal: s.visual_goal, characters: s.characters, duration_s: s.duration_s } as VideoClipSpec,
      dialogue: s.dialogue || null,
      summary: s.summary,
      visual_goal: s.visual_goal,
      characters: s.characters,
    }));
    for (const s of planScenes) {
      await db.insertScene({
        film_id: film.id,
        idx: s.idx,
        scene_key: s.scene_key,
        type: 'video_clip',
        script_segment: s.script_segment,
        spec: s.spec,
        status: 'waiting',
        duration_s: s.duration_s,
        continuity_group: null,
        dialogue: s.dialogue || null,
      });
    }
    const characterRefs: FilmCharacter[] = plan.characters.map((c) => ({ ...c, url: null }));
    await patchFilm(film, hooks, {
      title: plan.title,
      status: 'plan_ready',
      plan: {
        title: plan.title,
        style_direction: plan.visual_style,
        story_summary: plan.story_summary,
        world: plan.world,
        visual_style: plan.visual_style,
        characters: plan.characters,
        scenes: planScenes,
      },
      character_refs: characterRefs,
      stage_note: `${plan.scenes.length} clips planned. Preparing scene 1…`,
    });

    const scenes = await db.listScenes(film.id);
    // Prepare ONLY the first scene's prompt — one clip at a time, always.
    await prepareScene(film, scenes, scenes[0], hooks);
    const fresh = await db.getFilm(film.id);
    return { film: fresh || film, scenes };
  } catch (e: any) {
    await db.updateFilm(film.id, { status: 'error', error: String(e?.message || e), stage_note: 'Script analysis failed.' });
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Character reference — generated ONCE per character, reused forever
// ---------------------------------------------------------------------------

async function ensureCharacterRef(film: Film, characterId: string | null, hooks: RunHooks): Promise<FilmCharacter | null> {
  const refs = Array.isArray(film.character_refs) ? film.character_refs : [];
  const character = characterId
    ? refs.find((c) => c.id === characterId) || refs[0] || null
    : refs[0] || null;
  if (!character) return null;
  if (character.url) return character;
  try {
    say(hooks, `Locking ${character.name}'s reference image…`);
    const url = await generateBackdropImage(characterPortraitBrief(character, String(film.plan?.visual_style || '')), '1:1');
    const updated = refs.map((c) => (c.id === character.id ? { ...c, url } : c));
    await patchFilm(film, hooks, { character_refs: updated });
    await db.addAsset({ film_id: film.id, kind: 'character', name: `${character.name} reference`, description: character.appearance.slice(0, 200), url });
    return { ...character, url };
  } catch (e: any) {
    say(hooks, `The character reference image could not be generated (${String(e?.message || e).slice(0, 90)}) — the prompt's locked appearance description carries the continuity instead.`);
    return character; // url stays null; the text appearance still locks identity
  }
}

// ---------------------------------------------------------------------------
// Stage 2 — prepare ONE scene (continuation decision + prompt)
// ---------------------------------------------------------------------------

export async function prepareScene(
  film: Film,
  scenes: FilmScene[],
  scene: FilmScene,
  hooks: RunHooks,
  opts: { revisionNote?: string | null; forceIndependent?: boolean } = {},
): Promise<void> {
  const statusBefore = scene.status;
  const prev = previousCompletedScene(scenes, scene.idx);
  await setState(
    film, hooks,
    scene.idx === 0 || !prev ? 'PREPARING_SCENE' : 'DETERMINE_NEXT_REFERENCE',
    scene.idx === 0 || !prev
      ? `Preparing scene ${scene.idx + 1}: the director is writing the shot…`
      : `Scene ${scene.idx + 1}: the director is studying scene ${prev.idx + 1}'s final frame and deciding continuity…`,
  );
  try {
    const prepared = await prepareScenePrompt({
      film,
      scene,
      prevScene: prev,
      characterRefs: Array.isArray(film.character_refs) ? film.character_refs : [],
      revisionNote: opts.revisionNote,
      forceIndependent: opts.forceIndependent,
    });

    if (prev && scene.idx > 0) await setState(film, hooks, 'PREPARE_NEXT_SCENE', `Scene ${scene.idx + 1}: ${prepared.continuation ? `continuing from scene ${prev.idx + 1}'s final frame` : 'independent scene'} — writing the prompt…`);

    // Resolve reference assets by the decided priority. A non-continuation
    // scene NEVER receives the previous frame — visual contamination is a bug.
    const assets: ReferenceAsset[] = [];
    let referenceType = prepared.reference_type;
    if (prepared.continuation && prev?.keyframe_url) {
      assets.push({ role: 'first_frame', url: prev.keyframe_url });
      if (prepared.needs_character) {
        const character = await ensureCharacterRef(film, prepared.needs_character, hooks);
        if (character?.url) assets.push({ role: 'reference', url: character.url });
      }
    } else if (referenceType === 'character_reference') {
      const character = await ensureCharacterRef(film, prepared.needs_character, hooks);
      if (character?.url) assets.push({ role: 'reference', url: character.url });
      else referenceType = 'none';
    } else if (referenceType === 'scene_reference' && film.product_screenshot_url) {
      assets.push({ role: 'reference', url: film.product_screenshot_url });
    } else if (referenceType === 'scene_reference') {
      referenceType = 'none';
    }

    const spec: VideoClipSpec = {
      ...((scene.spec || {}) as VideoClipSpec),
      negative: prepared.negative,
      reasoning: prepared.reasoning,
    };
    await patchScene(scene, hooks, {
      status: 'ready',
      error: null,
      prompt: prepared.prompt,
      continuation: prepared.continuation,
      reference_type: referenceType,
      reference_assets: assets,
      spec,
      clip_fingerprint: sceneFingerprint({ type: scene.type, spec }, (film.aspect_ratio || '16:9') as Aspect),
    });
    await setState(film, hooks, 'PROMPT_READY', `Scene ${scene.idx + 1} is ready — review the prompt and generate when you are.`);
  } catch (e: any) {
    // A completed scene whose prompt REVISION failed keeps its clip — only a
    // scene that never rendered becomes failed.
    await patchScene(scene, hooks, statusBefore === 'completed'
      ? { status: 'completed', error: String(e?.message || e) }
      : { status: 'failed', error: String(e?.message || e) });
    await patchFilm(film, hooks, { stage_note: `Scene ${scene.idx + 1} could not be prepared.`, error: String(e?.message || e) });
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Stage 3 — generate ONE scene (explicitly triggered), then extract the frame
// ---------------------------------------------------------------------------

export async function generateScene(film: Film, scenes: FilmScene[], scene: FilmScene, hooks: RunHooks): Promise<void> {
  if (!scene.prompt || scene.status !== 'ready') throw new Error(`Scene ${scene.idx + 1} has no prepared prompt yet — prepare it first.`);
  if (scenes.some((s) => s.status === 'generating')) throw new Error('Another scene is already generating — clips render one at a time.');

  await patchFilm(film, hooks, { status: 'producing', error: null });
  await setState(film, hooks, 'GENERATING_VIDEO', `Scene ${scene.idx + 1}: generating the clip…`);
  await patchScene(scene, hooks, { status: 'generating', error: null });
  try {
    const spec = (scene.spec || {}) as VideoClipSpec;
    const job = await VideoModelService.createVideo({
      prompt: scene.prompt,
      negative: spec.negative,
      aspect: (film.aspect_ratio || '16:9') as Aspect,
      durationS: Number(scene.duration_s) || 6,
      referenceAssets: scene.reference_assets,
      // The film's chosen model (Create screen); unknown/null ids fall back
      // to the default so pre-picker films keep rendering on Omni Flash.
      model: resolveVideoModel(film.video_model),
    });
    await patchScene(scene, hooks, { veo_operation_id: job.jobId });
    const videoUrl = await VideoModelService.getVideoResult(job.jobId, {
      onProgress: (p) => say(hooks, `Scene ${scene.idx + 1}: rendering… ${Math.round(p)}%`),
    });
    await setState(film, hooks, 'VIDEO_COMPLETED', `Scene ${scene.idx + 1}: clip landed.`);
    await patchScene(scene, hooks, { asset_url: videoUrl, veo_operation_id: null });
    await finalizeScene(film, scenes, scene, hooks, videoUrl);
  } catch (e: any) {
    await patchScene(scene, hooks, { status: 'failed', error: String(e?.message || e), veo_operation_id: null });
    await setState(film, hooks, 'PROMPT_READY', `Scene ${scene.idx + 1} failed — completed scenes are untouched. Retry, regenerate the prompt, fall back to the character reference, or skip it.`);
    throw e;
  }
}

/** Real duration → FFmpeg final frame → continuity attributes → director check
 * → scene completed → next scene's reference decided and prompt prepared. */
async function finalizeScene(film: Film, scenes: FilmScene[], scene: FilmScene, hooks: RunHooks, videoUrl: string): Promise<void> {
  const aspect = (film.aspect_ratio || '16:9') as Aspect;
  await setState(film, hooks, 'EXTRACTING_FINAL_FRAME', `Scene ${scene.idx + 1}: reading the real clip duration and extracting the final frame…`);

  const realDuration = await probeVideoDuration(videoUrl);
  let finalFrameUrl: string | null = null;
  let frameNote = '';
  try {
    const frame = await extractFinalFrame(videoUrl, aspect);
    finalFrameUrl = frame.url;
  } catch (e: any) {
    frameNote = `The final frame could not be extracted (${String(e?.message || e).slice(0, 140)}) — the next scene will fall back to the character reference.`;
  }
  let firstFrameUrl: string | null = null;
  try { firstFrameUrl = await canvasExtractFrame(videoUrl, 0.15); } catch { /* thumbnail only */ }

  await setState(film, hooks, 'FRAME_READY', frameNote || `Scene ${scene.idx + 1}: final frame captured and validated.`);

  let attrs: any = null;
  if (finalFrameUrl) {
    say(hooks, `Scene ${scene.idx + 1}: reading the end state for continuity…`);
    attrs = await extractVisualAttributes(finalFrameUrl);
  }
  const frames = [firstFrameUrl, finalFrameUrl].filter(Boolean) as string[];
  const verdict = frames.length
    ? await validateScene(scene, frames)
    : { pass: true, issues: 'No frame could be captured for review — accepted on trust.', method: 'trust' };

  await patchScene(scene, hooks, {
    status: 'completed',
    error: null,
    first_frame_url: firstFrameUrl,
    keyframe_url: finalFrameUrl,
    visual_attributes: attrs,
    validation: verdict,
    duration_s: realDuration || scene.duration_s,
  });
  if (finalFrameUrl) {
    await db.addAsset({ film_id: film.id, kind: 'keyframe', name: `Scene ${scene.idx + 1} final frame`, description: `Continuity reference — ${String(scene.script_segment).slice(0, 120)}`, url: finalFrameUrl });
  }

  // Decide the NEXT scene's reference and prepare its prompt — preparation
  // only. Generation always waits for an explicit trigger. A preparation
  // failure never touches THIS scene: its clip just landed and stays completed.
  const next = orderedScenes(scenes).find((s) => s.idx > scene.idx && !DONE.has(String(s.status)) && s.status !== 'generating');
  if (next) {
    try {
      await prepareScene(film, scenes, next, hooks);
    } catch (e: any) {
      say(hooks, `Scene ${next.idx + 1} could not be prepared (${String(e?.message || e).slice(0, 140)}) — scene ${scene.idx + 1} is safely completed; retry the preparation from the board.`);
    }
  } else if (allScenesDone(scenes)) {
    await setState(film, hooks, 'ALL_SCENES_COMPLETED', 'All video scenes are complete — prepare the audio and run Final Assembly.');
  }
}

// ---------------------------------------------------------------------------
// Per-scene recovery — never restart the project, never lose completed scenes
// ---------------------------------------------------------------------------

/** [Retry] — rerun generation with the SAME prompt and references. */
export async function retryScene(film: Film, scenes: FilmScene[], scene: FilmScene, hooks: RunHooks): Promise<void> {
  if (!scene.prompt) { await prepareScene(film, scenes, scene, hooks); return; }
  await patchScene(scene, hooks, { status: 'ready', error: null });
  await generateScene(film, scenes, scene, hooks);
}

/** [Regenerate Prompt] — Opus re-analyzes the scene (with the failure or a
 * user instruction as context) and writes an improved prompt. */
export async function regenerateScenePrompt(film: Film, scenes: FilmScene[], scene: FilmScene, hooks: RunHooks, instruction?: string): Promise<void> {
  const note = [instruction, scene.error ? `Previous failure: ${scene.error}` : ''].filter(Boolean).join(' · ') || 'Improve the prompt — the previous attempt was unsatisfying.';
  await prepareScene(film, scenes, scene, hooks, { revisionNote: note });
}

/** [Use Character Reference] — abandon the previous-frame path for this scene
 * and stage it on the locked character reference instead. */
export async function useCharacterReferenceFallback(film: Film, scenes: FilmScene[], scene: FilmScene, hooks: RunHooks): Promise<void> {
  await prepareScene(film, scenes, scene, hooks, { forceIndependent: true, revisionNote: scene.error ? `Previous failure: ${scene.error}` : null });
}

/** [Skip Scene] — exclude this scene and move on; nothing else changes. */
export async function skipScene(film: Film, scenes: FilmScene[], scene: FilmScene, hooks: RunHooks): Promise<void> {
  await patchScene(scene, hooks, { status: 'skipped', error: null });
  const next = orderedScenes(scenes).find((s) => s.idx > scene.idx && !DONE.has(String(s.status)));
  if (next && next.status === 'waiting') {
    await prepareScene(film, scenes, next, hooks);
  } else if (allScenesDone(scenes)) {
    await setState(film, hooks, 'ALL_SCENES_COMPLETED', 'All video scenes are complete — prepare the audio and run Final Assembly.');
  }
}

// ---------------------------------------------------------------------------
// Optional AUTO mode — the same sequential loop, self-triggering. Still one
// clip at a time: prepare → generate → extract → decide → prepare next → …
// ---------------------------------------------------------------------------

export async function autoProduce(film: Film, scenes: FilmScene[], hooks: RunHooks, shouldContinue: () => boolean): Promise<void> {
  for (;;) {
    if (!shouldContinue()) { say(hooks, 'Auto-generate paused.'); return; }
    const next = activeScene(scenes);
    if (!next) {
      if (allScenesDone(scenes)) await setState(film, hooks, 'ALL_SCENES_COMPLETED', 'All video scenes are complete — prepare the audio and run Final Assembly.');
      return;
    }
    if (next.status === 'failed') { say(hooks, `Auto-generate stopped at scene ${next.idx + 1} — it needs your decision (retry, new prompt, character fallback, or skip).`); return; }
    if (next.status === 'generating') return; // already in flight elsewhere
    if (next.status === 'waiting') await prepareScene(film, scenes, next, hooks);
    if (!shouldContinue()) { say(hooks, 'Auto-generate paused.'); return; }
    if (next.status === 'ready') await generateScene(film, scenes, next, hooks);
  }
}

// ---------------------------------------------------------------------------
// Stage 4 — FFmpeg assembly (+ optional finishing layers)
// ---------------------------------------------------------------------------

export async function assembleReadyFilm(
  film: Film,
  scenes: FilmScene[],
  hooks: RunHooks,
  finishSettings?: FinishSettings,
): Promise<void> {
  const ordered = orderedScenes(scenes);
  const done = ordered.filter((s) => s.status === 'completed' && s.asset_url);
  if (!done.length) throw new Error('No completed scenes to assemble yet.');
  const finishing = !!finishSettings && (finishSettings.narration || finishSettings.music || finishSettings.captions);
  await patchFilm(film, hooks, {
    status: 'assembling',
    machine_state: 'FFMPEG_ASSEMBLY',
    stage_note: finishing ? 'Preparing the optional finishing layers…' : 'FFmpeg is joining your clips…',
    error: null,
  });
  try {
    const prepared = finishing
      ? await prepareFinish(film, done, finishSettings!, (note) => {
          say(hooks, note);
          try { hooks.onFilm?.({ stage_note: note }); } catch { /* UI only */ }
        })
      : null;
    if (prepared) await patchFilm(film, hooks, { finish: prepared.state });

    const result = await assembleFilm(
      // AI video clips keep their native generated audio; only legacy captured
      // scenes (pre-rebuild films) ever carry a per-scene narration track.
      done.map((s) => ({
        sceneKey: s.scene_key,
        url: String(s.asset_url),
        narrationUrl: s.type === 'video_clip' || s.type === 'veo_cinematic' ? null : s.narration_url || null,
      })),
      (film.aspect_ratio || '16:9') as Aspect,
      (note) => say(hooks, note),
      prepared ? {
        durationS: prepared.durationS,
        narrationUrls: prepared.narrationUrls,
        musicUrl: prepared.musicUrl,
        captionsSrt: prepared.captionsSrt,
      } : undefined,
    );
    let durationS = 0; let thumb = '';
    try { durationS = await probeVideoDuration(result.url); } catch { /* cosmetic */ }
    try { thumb = await canvasExtractFrame(result.url, 0.3); } catch { /* cosmetic */ }
    const finishedLayers = finishSettings ? [
      finishSettings.narration ? 'narration' : '',
      finishSettings.music ? 'ducked music' : '',
      finishSettings.captions ? 'burned-in captions' : '',
    ].filter(Boolean).join(', ') : '';
    await patchFilm(film, hooks, {
      status: 'ready',
      machine_state: 'FINAL_VIDEO',
      stage_note: finishing
        ? `Finished with ${finishedLayers}; native clip sound is preserved.`
        : result.via === 'ffmpeg_wasm' ? 'Assembled in your browser with FFmpeg.' : 'Assembled with the platform joiner (FFmpeg fallback).',
      final_video_url: result.url,
      final_thumb_url: thumb || null,
      duration_s: durationS || result.durationS || null,
      finish: prepared
        ? { ...prepared.state, completed_at: new Date().toISOString() }
        : film.finish ? { ...film.finish, completed_at: undefined } : null,
      error: null,
    });
  } catch (e: any) {
    await patchFilm(film, hooks, {
      status: finishing && !!film.final_video_url ? 'ready' : 'producing',
      machine_state: 'ALL_SCENES_COMPLETED',
      stage_note: finishing ? 'The finish pass failed — your previous film is still intact.' : 'Assembly failed — fix the note below and try again. Completed scenes are untouched.',
      error: String(e?.message || e),
    });
    throw e;
  }
}

export async function finishReadyFilm(
  film: Film,
  scenes: FilmScene[],
  settings: FinishSettings,
  hooks: RunHooks,
): Promise<void> {
  if (!settings.narration && !settings.music && !settings.captions) throw new Error('Choose at least one finishing layer.');
  await assembleReadyFilm(film, scenes, hooks, settings);
}

// ---------------------------------------------------------------------------
// Stage 5 — AUDIO (voice plan / narration / music / SFX) + FINAL ASSEMBLY.
// Audio work NEVER regenerates video: change voice → re-record lines →
// re-assemble; change music → re-compose → re-assemble. Existing clips are
// reused as-is, which is why re-assembly is fast.
// ---------------------------------------------------------------------------

export type AssemblyStepKey = 'scenes' | 'narration' | 'music' | 'sfx' | 'mix' | 'render' | 'validate';
export type AssemblyStepStatus = 'pending' | 'active' | 'done' | 'failed';
export interface AssemblyProgress {
  steps: { key: AssemblyStepKey; label: string; status: AssemblyStepStatus }[];
  percent: number;
  running: boolean;
}

const ASSEMBLY_STEPS: { key: AssemblyStepKey; label: string }[] = [
  { key: 'scenes', label: 'Loading scenes' },
  { key: 'narration', label: 'Preparing narration' },
  { key: 'music', label: 'Preparing music' },
  { key: 'sfx', label: 'Preparing SFX' },
  { key: 'mix', label: 'Mixing audio' },
  { key: 'render', label: 'Rendering video' },
  { key: 'validate', label: 'Final validation' },
];

/** The length a scene occupies on the final timeline: its real clip duration,
 * extended (capped) when its narration needs slightly more room. */
export function sceneTargetDuration(scene: FilmScene, narration?: { voice_source?: string; duration_s?: number } | null): number {
  const base = Number(scene.duration_s) || 6;
  if (!narration || narration.voice_source !== 'elevenlabs' || !narration.duration_s) return base;
  return Math.max(base, Math.min(narration.duration_s + 0.3, base + MAX_SCENE_EXTENSION_S));
}

/** Plan (or refresh) the film's audio, then generate every missing layer.
 * Layer failures are typed (AudioLayerError) so the UI offers the right
 * recovery: [Retry Voice]/[Choose Voice], [Retry]/[Continue Without Music],
 * [Retry]/[Continue Without SFX]. */
export async function prepareFilmAudioStage(
  film: Film,
  scenes: FilmScene[],
  hooks: RunHooks,
  opts: { voiceId?: string; voiceName?: string; forceReplan?: boolean } = {},
): Promise<void> {
  await setState(film, hooks, 'AUDIO_PLANNING', film.audio ? 'Updating the audio plan…' : 'Opus is planning narration, music and SFX together with the scenes…');
  try {
    const audio = await ensureAudioPlan(film, scenes, (n) => say(hooks, n), opts);
    await patchFilm(film, hooks, { audio, error: null });
  } catch (e: any) {
    await patchFilm(film, hooks, { machine_state: 'ALL_SCENES_COMPLETED', stage_note: 'The audio plan could not be created.', error: String(e?.message || e) });
    throw e;
  }
  await generateAudioLayers(film, scenes, hooks);
}

/** Generate every missing audio layer. Each layer fails independently and the
 * others still run; the FIRST failure is rethrown at the end so nothing
 * generated is lost and the UI can target the broken layer. */
async function generateAudioLayers(film: Film, scenes: FilmScene[], hooks: RunHooks): Promise<void> {
  const audio = film.audio;
  if (!audio) throw new Error('The audio plan is missing — prepare the audio first.');
  await setState(film, hooks, 'AUDIO_GENERATING', 'Generating the audio layers…');
  const done = audioScenes(scenes);
  const totalTarget = done.reduce((n, s) => n + sceneTargetDuration(s, audio.narration.find((x) => x.scene_key === s.scene_key)), 0);
  let firstFailure: any = null;

  try {
    if (!narrationReady(audio)) await generateNarrationAudio(audio, scenes, (n) => say(hooks, n));
    await persistSceneNarration(audio, scenes);
  } catch (e) { firstFailure = firstFailure || e; }
  await patchFilm(film, hooks, { audio: { ...audio } });

  try { await generateMusicAudio(audio, totalTarget, (n) => say(hooks, n)); }
  catch (e) { firstFailure = firstFailure || e; }
  await patchFilm(film, hooks, { audio: { ...audio } });

  try { await generateSfxAudio(audio, (n) => say(hooks, n)); }
  catch (e) { firstFailure = firstFailure || e; }
  await patchFilm(film, hooks, { audio: { ...audio } });

  if (firstFailure) {
    const layer: AudioLayer = firstFailure instanceof AudioLayerError ? firstFailure.layer : 'narration';
    await patchFilm(film, hooks, {
      stage_note: layer === 'music' ? 'Music preparation failed.' : layer === 'sfx' ? 'SFX preparation failed.' : 'Narration generation failed.',
      error: String(firstFailure?.message || firstFailure),
    });
    throw firstFailure;
  }
  await patchFilm(film, hooks, { machine_state: 'AUDIO_READY', stage_note: 'Narration, music and SFX are ready — run Final Assembly.', error: null });
}

/** [Retry Voice] / [Retry] per layer — clears only that layer's failures and
 * regenerates what is missing. Video clips are untouched. */
export async function retryAudioLayer(film: Film, scenes: FilmScene[], hooks: RunHooks, layer: 'narration' | 'music' | 'sfx'): Promise<void> {
  if (!film.audio) { await prepareFilmAudioStage(film, scenes, hooks); return; }
  const audio = film.audio;
  if (layer === 'narration') {
    audio.narration.forEach((n) => {
      if (n.voice_source === 'elevenlabs' && (n.status === 'failed' || !n.audioUrl)) { n.status = 'pending'; n.error = undefined; }
    });
  } else if (layer === 'music' && audio.music) {
    audio.music.required = true;
    audio.music.status = 'pending';
    audio.music.audioUrl = undefined;
    audio.music.error = undefined;
  } else if (layer === 'sfx') {
    audio.sfx.forEach((f) => { if (f.status === 'failed') { f.status = 'pending'; f.error = undefined; } });
    audio.sfx_status = audio.sfx.length ? 'pending' : 'none';
  }
  await patchFilm(film, hooks, { audio: { ...audio }, error: null });
  await generateAudioLayers(film, scenes, hooks);
}

/** [Continue Without Music] / [Continue Without SFX]. */
export async function skipAudioLayer(film: Film, scenes: FilmScene[], hooks: RunHooks, layer: 'music' | 'sfx'): Promise<void> {
  if (!film.audio) return;
  const audio = layer === 'music' ? skipMusicLayer(film.audio) : skipSfxLayer(film.audio);
  await patchFilm(film, hooks, { audio, error: null });
  if (audioReady(audio)) {
    await patchFilm(film, hooks, { machine_state: 'AUDIO_READY', stage_note: layer === 'music' ? 'Continuing without music — run Final Assembly.' : 'Continuing without SFX — run Final Assembly.' });
  }
}

/** [Choose Voice] — same narration plan and lines, new voice identity. Every
 * ElevenLabs line is re-recorded; the videos are NOT regenerated. */
export async function changeNarrationVoice(film: Film, scenes: FilmScene[], hooks: RunHooks, voiceId: string, voiceName?: string): Promise<void> {
  await prepareFilmAudioStage(film, scenes, hooks, { voiceId, voiceName });
}

/** Change the music direction (preset) — re-composes music only. */
export async function changeMusicDirection(film: Film, scenes: FilmScene[], hooks: RunHooks, preset: string): Promise<void> {
  if (!film.audio) { await prepareFilmAudioStage(film, scenes, hooks); return; }
  const audio = withMusicPreset(film.audio, preset);
  await patchFilm(film, hooks, { audio, error: null });
  await generateAudioLayers(film, scenes, hooks);
}

// ---------------------------------------------------------------------------
// Post-production steps — each layer individually triggerable (manual mode)
// and an auto-advance entry point for when the last scene lands. Video clips
// are NEVER regenerated by any of these.
// ---------------------------------------------------------------------------

const LAYER_NOTES: Record<'narration' | 'music' | 'sfx', { run: string; done: string; fail: string }> = {
  narration: { run: 'Generating narration…', done: 'Narration ready.', fail: 'Narration generation failed.' },
  music: { run: 'Selecting music…', done: 'Music selected.', fail: 'Music preparation failed.' },
  sfx: { run: 'Preparing SFX…', done: 'SFX prepared.', fail: 'SFX preparation failed.' },
};

async function ensurePlanPersisted(film: Film, scenes: FilmScene[], hooks: RunHooks): Promise<void> {
  if (film.audio && film.audio.planned_fingerprint === audioFingerprint(scenes)) return;
  await setState(film, hooks, 'AUDIO_PLANNING', 'Opus is planning narration, music and SFX together with the scenes…');
  try {
    const audio = await ensureAudioPlan(film, scenes, (n) => say(hooks, n));
    await patchFilm(film, hooks, { audio, error: null });
  } catch (e: any) {
    await patchFilm(film, hooks, { machine_state: 'ALL_SCENES_COMPLETED', stage_note: 'The audio plan could not be created.', error: String(e?.message || e) });
    throw e;
  }
}

/** Run ONE post-production step (manual mode). Ensures the audio plan exists,
 * generates only that layer, and reports Ready for Final Assembly when the
 * last layer lands. Existing ready audio and all video clips are untouched. */
export async function runAudioLayerStep(film: Film, scenes: FilmScene[], hooks: RunHooks, layer: 'narration' | 'music' | 'sfx'): Promise<void> {
  await ensurePlanPersisted(film, scenes, hooks);
  const audio = film.audio!;
  await setState(film, hooks, 'AUDIO_GENERATING', LAYER_NOTES[layer].run);
  try {
    if (layer === 'narration') {
      if (!narrationReady(audio)) await generateNarrationAudio(audio, scenes, (n) => say(hooks, n));
      await persistSceneNarration(audio, scenes);
    } else if (layer === 'music') {
      const done = audioScenes(scenes);
      const totalTarget = done.reduce((n, s) => n + sceneTargetDuration(s, audio.narration.find((x) => x.scene_key === s.scene_key)), 0);
      await generateMusicAudio(audio, totalTarget, (n) => say(hooks, n));
    } else {
      await generateSfxAudio(audio, (n) => say(hooks, n));
    }
    await patchFilm(film, hooks, { audio: { ...audio }, error: null });
    if (audioReady(audio)) {
      await patchFilm(film, hooks, { machine_state: 'AUDIO_READY', stage_note: 'Narration, music and SFX are ready — run Final Assembly.' });
    } else {
      await patchFilm(film, hooks, { machine_state: 'ALL_SCENES_COMPLETED', stage_note: LAYER_NOTES[layer].done });
    }
  } catch (e: any) {
    await patchFilm(film, hooks, {
      audio: { ...audio },
      machine_state: 'ALL_SCENES_COMPLETED',
      stage_note: LAYER_NOTES[layer].fail,
      error: String(e?.message || e),
    });
    throw e;
  }
}

/** [Regenerate Narration] — re-records EVERY ElevenLabs line with the same
 * voice identity. Music, SFX and every video clip are untouched. */
export async function regenerateNarration(film: Film, scenes: FilmScene[], hooks: RunHooks): Promise<void> {
  if (!film.audio) { await prepareFilmAudioStage(film, scenes, hooks); return; }
  const audio = film.audio;
  audio.narration.forEach((n) => {
    if (n.voice_source === 'elevenlabs') { n.status = 'pending'; n.audioUrl = undefined; n.duration_s = undefined; n.error = undefined; }
  });
  await patchFilm(film, hooks, { audio: { ...audio }, error: null });
  await runAudioLayerStep(film, scenes, hooks, 'narration');
}

/** [Regenerate SFX] — re-makes every planned effect. Nothing else changes. */
export async function regenerateSfx(film: Film, scenes: FilmScene[], hooks: RunHooks): Promise<void> {
  if (!film.audio) { await prepareFilmAudioStage(film, scenes, hooks); return; }
  const audio = film.audio;
  audio.sfx.forEach((f) => { f.status = 'pending'; f.audioUrl = undefined; f.error = undefined; });
  audio.sfx_status = audio.sfx.length ? 'pending' : 'none';
  await patchFilm(film, hooks, { audio: { ...audio }, error: null });
  await runAudioLayerStep(film, scenes, hooks, 'sfx');
}

/** AUTO-ADVANCE — called when the last scene completes (11/11 ✓ + continuity ✓).
 * Runs the post-production sequence narration → music → SFX with the same
 * sequential generators, ending at AUDIO_READY ("Ready for Final Assembly").
 * Ready layers are reused; video is never regenerated. */
export async function autoPostProduce(film: Film, scenes: FilmScene[], hooks: RunHooks): Promise<void> {
  if (!allScenesDone(scenes)) return;
  if (film.audio && film.audio.planned_fingerprint === audioFingerprint(scenes) && audioReady(film.audio)) {
    await patchFilm(film, hooks, { machine_state: 'AUDIO_READY', stage_note: 'Narration, music and SFX are ready — run Final Assembly.' });
    return;
  }
  await prepareFilmAudioStage(film, scenes, hooks);
}

/** FINAL ASSEMBLY — one click: existing video scenes + ElevenLabs narration +
 * music + SFX → FFmpeg → audio mix + composition → final render. NEVER
 * regenerates video; missing audio layers are generated first, ready ones are
 * reused, so re-assembly after a voice/music change is fast. */
export async function runFinalAssembly(
  film: Film,
  scenes: FilmScene[],
  hooks: RunHooks,
  opts: { captions?: boolean } = {},
): Promise<void> {
  const done = orderedScenes(scenes).filter((s) => s.status === 'completed' && s.asset_url);
  if (!done.length) throw new Error('No completed scenes to assemble yet.');

  const progress: AssemblyProgress = { steps: ASSEMBLY_STEPS.map((s) => ({ ...s, status: 'pending' as AssemblyStepStatus })), percent: 0, running: true };
  const report = (key: AssemblyStepKey, status: AssemblyStepStatus, percent?: number) => {
    const step = progress.steps.find((s) => s.key === key);
    if (step) step.status = status;
    if (typeof percent === 'number') progress.percent = Math.max(progress.percent, Math.min(100, Math.round(percent)));
    try { hooks.onAssembly?.({ ...progress, steps: progress.steps.map((x) => ({ ...x })) }); } catch { /* UI only */ }
  };

  try {
    report('scenes', 'active', 2);
    // The LATEST scene versions, straight from their rows. Video is never
    // regenerated here — Final Assembly only reads existing clips.
    report('scenes', 'done', 6);

    if (!film.audio || film.audio.planned_fingerprint !== audioFingerprint(scenes) || !audioReady(film.audio)) {
      report('narration', 'active', 8);
      await prepareFilmAudioStage(film, scenes, hooks);
    }
    const audio = film.audio!;
    report('narration', narrationReady(audio) ? 'done' : 'failed', 18);
    report('music', musicReady(audio) ? 'done' : 'failed', 24);
    report('sfx', sfxReady(audio) ? 'done' : 'failed', 28);

    await patchFilm(film, hooks, { status: 'assembling', machine_state: 'FFMPEG_ASSEMBLY', stage_note: 'Final Assembly: mixing audio and cutting the film…', error: null });
    report('mix', 'active', 30);

    const narrationByKey = new Map(audio.narration.map((n) => [n.scene_key, n]));
    const inputs = done.map((s) => {
      const entry = narrationByKey.get(s.scene_key) || null;
      const narrated = !!entry && entry.voice_source === 'elevenlabs' && entry.status === 'ready' && !!entry.audioUrl;
      const sfx = audio.sfx
        .filter((f) => f.scene_key === s.scene_key && f.status === 'ready' && f.audioUrl && audio.sfx_status === 'ready')
        .map((f) => ({ url: String(f.audioUrl), atS: Number(f.at_s) || 0, volume: Number(f.volume) || 0.25, durationS: Number(f.duration_s) || undefined }));
      return {
        sceneKey: s.scene_key,
        url: String(s.asset_url),
        narrationUrl: narrated ? String(entry!.audioUrl) : null,
        // ONE authoritative voice per scene: narrated scenes keep native sound
        // as low ambience; dialogue/no-word scenes keep their native audio.
        nativeVolume: narrated ? 0.16 : 1,
        durationS: Number(s.duration_s) || undefined,
        targetDurationS: sceneTargetDuration(s, entry),
        sfx,
        strictAudio: true,
      };
    });
    const totalTarget = inputs.reduce((n, c) => n + (c.targetDurationS || c.durationS || 6), 0);
    const captionsSrt = opts.captions ? buildCaptions(done).srt : undefined;
    const musicUrl = audio.music && audio.music.status === 'ready' && audio.music.audioUrl ? audio.music.audioUrl : undefined;

    let rendering = false;
    const result = await assembleFilm(
      inputs,
      (film.aspect_ratio || '16:9') as Aspect,
      (note, fraction) => {
        say(hooks, note);
        const pct = 30 + Math.round(Math.max(0, Math.min(1, fraction)) * 60);
        if (fraction >= 0.89 && !rendering) { report('mix', 'done'); rendering = true; }
        report(rendering ? 'render' : 'mix', 'active', pct);
      },
      { durationS: totalTarget, musicUrl, musicVolume: audio.music?.volume, captionsSrt },
    );
    report('mix', 'done');
    report('render', 'done', 92);
    report('validate', 'active', 94);
    if (!result.url) throw new Error('Final Assembly produced no video file.');
    let durationS = 0; let thumb = '';
    try { durationS = await probeVideoDuration(result.url); } catch { /* cosmetic */ }
    try { thumb = await canvasExtractFrame(result.url, 0.3); } catch { /* cosmetic */ }
    progress.running = false;
    report('validate', 'done', 100);

    const layerSummary = [
      inputs.some((c) => c.narrationUrl) ? `ElevenLabs narration (${audio.voice_plan?.voiceName || 'one voice'})` : '',
      musicUrl ? `${audio.music?.preset || ''} music, ducked under speech`.trim() : '',
      inputs.some((c) => c.sfx.length) ? 'SFX' : '',
      captionsSrt ? 'captions' : '',
    ].filter(Boolean).join(' · ');
    await patchFilm(film, hooks, {
      status: 'ready',
      machine_state: 'FINAL_VIDEO',
      stage_note: layerSummary ? `Final video ready — ${layerSummary}.` : 'Final video ready.',
      final_video_url: result.url,
      final_thumb_url: thumb || null,
      duration_s: durationS || result.durationS || null,
      error: null,
    });
  } catch (e: any) {
    progress.running = false;
    const layer: AudioLayer = e instanceof AudioLayerError ? e.layer : 'assembly';
    const failStep = layer !== 'assembly'
      ? progress.steps.find((s) => s.key === layer)
      : progress.steps.find((s) => s.status === 'active');
    if (failStep) failStep.status = 'failed';
    progress.steps.forEach((s) => { if (s.status === 'active') s.status = s === failStep ? 'failed' : 'pending'; });
    try { hooks.onAssembly?.({ ...progress, steps: progress.steps.map((x) => ({ ...x })) }); } catch { /* UI only */ }
    await patchFilm(film, hooks, {
      status: film.final_video_url ? 'ready' : 'producing',
      machine_state: audioReady(film.audio) ? 'AUDIO_READY' : 'ALL_SCENES_COMPLETED',
      stage_note: layer === 'narration' ? 'Narration generation failed.'
        : layer === 'music' ? 'Music preparation failed.'
        : layer === 'sfx' ? 'SFX preparation failed.'
        : 'Final Assembly failed — completed scenes and audio are untouched.',
      error: String(e?.message || e),
    });
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Resume after a reload — adopt in-flight renders; never auto-generate
// ---------------------------------------------------------------------------

export async function resumeFilm(film: Film, scenes: FilmScene[], hooks: RunHooks): Promise<void> {
  for (const scene of orderedScenes(scenes)) {
    if (scene.status !== 'generating') continue;
    if (scene.veo_operation_id) {
      try {
        say(hooks, `Scene ${scene.idx + 1}: picking the render back up…`);
        const videoUrl = await VideoModelService.getVideoResult(scene.veo_operation_id);
        await patchScene(scene, hooks, { asset_url: videoUrl, veo_operation_id: null });
        await finalizeScene(film, scenes, scene, hooks, videoUrl);
      } catch (e: any) {
        await patchScene(scene, hooks, { status: 'failed', error: String(e?.message || e), veo_operation_id: null });
      }
    } else {
      // Interrupted before the job id landed — the prompt is intact.
      await patchScene(scene, hooks, { status: scene.prompt ? 'ready' : 'waiting', error: null });
    }
  }
  // Make sure the pipeline has an actionable head: if nothing is prepared or
  // running, prepare the next waiting scene's prompt (preparation only).
  const head = activeScene(scenes);
  if (head && head.status === 'waiting') {
    await prepareScene(film, scenes, head, hooks);
  } else if (allScenesDone(scenes) && !film.final_video_url) {
    await setState(film, hooks, 'ALL_SCENES_COMPLETED', 'All video scenes are complete — prepare the audio and run Final Assembly.');
  }
}
