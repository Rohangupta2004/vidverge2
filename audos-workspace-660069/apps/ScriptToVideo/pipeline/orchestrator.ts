/**
 * ORCHESTRATOR — the explicit state machine of the sequential Script-to-Video
 * pipeline (Sep 2026 rebuild).
 *
 *   SCRIPT_RECEIVED → ANALYZING_SCRIPT → SEGMENTING_SCRIPT → PREPARING_SCENE
 *   → PROMPT_READY → (auto-generate, or a click) → GENERATING_VIDEO → VIDEO_COMPLETED
 *   → EXTRACTING_FINAL_FRAME → FRAME_READY → DETERMINE_NEXT_REFERENCE
 *   → PREPARE_NEXT_SCENE → PROMPT_READY → …
 *   → ALL_SCENES_COMPLETED → FFMPEG_ASSEMBLY → FINAL_VIDEO
 *
 * Core rules enforced here:
 * - Opus understands the WHOLE story first (one segmentation pass), then
 *   prepares exactly ONE clip prompt at a time.
 * - Prompt preparation and video generation are SEPARATE operations — each
 *   generation is triggered from PROMPT_READY, by auto-generate or by a click,
 *   and dependent clips are never generated simultaneously.
 * - The frame stage cannot hang: every step of it is bounded, and a film found
 *   stranded at EXTRACTING_FINAL_FRAME is recovered from the clip that already
 *   rendered rather than re-rendered.
 * - After every clip: read the REAL duration from media metadata, extract and
 *   validate the final frame with FFmpeg, then require the NEXT scene to use
 *   that frame first unless the creator explicitly records a no-frame choice.
 * - A failed scene never loses completed scenes and never restarts the film:
 *   retry / regenerate-prompt / character-reference-fallback / skip act on
 *   that one scene only.
 *
 * Every step persists to WorkspaceDB, so a reload resumes instead of restarting.
 */

import {
  Aspect, AtReference, Film, FilmAudio, FilmCharacter, FilmCharacterProfile, FilmScene, MAX_OPERATION_ID_CHARS,
  MachineState, OnScreenTextItem, ParsedScene, PlanScene, ReferenceAsset, ReferenceType,
  SceneDialogue, VideoClipSpec, db, generateBackdropImage, newSceneKey,
  resolveAtMentions, sceneFingerprint,
} from '../api';
import {
  buildManualScenePrompt, manualSceneNegative, manualSceneSegment, parseManualScript,
} from '../manualScript';
import {
  analyzeScriptCast, askOpusJson, characterPortraitBrief, extractStyleFingerprint, extractVisualAttributes,
  prepareScenePrompt, segmentScript, validateScene,
} from './opus';
import { VideoModelService, capText, resolveDuration, resolveVideoModel } from './videoModelService';
import type { VideoModelConfig } from './videoModelService';
import { fallbackChain, isBadRequest, rephraseVideoPrompt } from './resilience';
import { extractFinalFrame, probeVideoDuration, validateFrameUrl } from './frames';
import { extractFrame as canvasExtractFrame } from './capture';
import { assembleFilm, interruptAssembly } from './assemble';
import { FinishSettings, buildCaptions, listVoices, prepareFinish } from './finish';
import {
  AudioLayer, AudioLayerError, MAX_SCENE_EXTENSION_S, audioPlanCurrent,
  audioReady, audioScenes, ensureAudioPlan, generateMusicAudio,
  generateNarrationAudio, generateSfxAudio, isSpokenSource, musicReady,
  narrationReady, persistSceneNarration, sfxReady, skipMusicLayer,
  skipNarrationLayer, skipSfxLayer, withMusicPreset, withVoiceSource,
} from './audio';
import type { VoiceSourceId } from './voiceSource';
import {
  S2V_CAPABILITY_REGISTRY_VERSION, S2V_VIDEO_CAPABILITIES,
  buildLongFormSections,
} from '../v2Contracts';
import type { AudioPolicy, ControlMode, EntryType, ExecutionMode, VideoStyleId } from '../v2Contracts';

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
// Stall protection for the frame stage
// ---------------------------------------------------------------------------

/** The frame stage runs entirely in the browser (FFmpeg.wasm, <video> decode,
 * upload) and none of those steps time out on their own, so a wedged decode
 * used to strand a film at EXTRACTING_FINAL_FRAME forever. The clip itself has
 * already rendered and is stored by then, so every step of the stage is now
 * bounded and a blown budget degrades to "no keyframe" instead of hanging. */
export const FRAME_EXTRACTION_TIMEOUT_MS = 5 * 60 * 1000;
/** How long a film may sit in EXTRACTING_FINAL_FRAME before it counts as stalled. */
export const FRAME_STALL_MS = 5 * 60 * 1000;
const PROBE_TIMEOUT_MS = 90_000;
const DIRECTOR_TIMEOUT_MS = 120_000;
/** A recovery pass re-reads a clip that already exists, so it degrades fast
 * rather than spending the full budget a second time. */
const RECOVERY_FRAME_TIMEOUT_MS = 90_000;

function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} did not finish within ${Math.round(ms / 1000)}s.`)), ms);
    work.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/** Milliseconds since the film row was last written. An unreadable timestamp
 * reads as "just updated", so nothing is ever recovered on a guess. */
export function msSinceFilmUpdate(film: Film): number {
  const at = Date.parse(String(film.updated_at || ''));
  return Number.isFinite(at) ? Math.max(0, Date.now() - at) : 0;
}

/** The scene whose clip landed but whose frame stage never finished. */
export function stalledFrameScene(scenes: FilmScene[]): FilmScene | null {
  return orderedScenes(scenes).find((s) => s.status === 'generating' && !!s.asset_url && !s.keyframe_url) || null;
}

/** True when the film has been sitting in the frame stage past the budget with
 * a rendered clip and nothing to show for it. */
export function isFrameExtractionStalled(film: Film, scenes: FilmScene[], stalledForMs: number): boolean {
  if (film.machine_state !== 'EXTRACTING_FINAL_FRAME') return false;
  if (stalledForMs < FRAME_STALL_MS) return false;
  return !!stalledFrameScene(scenes);
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

/** The nearest COMPLETED earlier scene — retained for legacy lookups. */
export function previousCompletedScene(scenes: FilmScene[], beforeIdx: number): FilmScene | null {
  return orderedScenes(scenes).filter((s) => s.idx < beforeIdx && s.status === 'completed' && s.asset_url).pop() || null;
}

/** Continuity is never allowed to jump over a failed or unfinished scene. */
export function immediatePreviousScene(scenes: FilmScene[], beforeIdx: number): FilmScene | null {
  return orderedScenes(scenes).find((s) => s.idx === beforeIdx - 1) || null;
}

function frameExtractionOf(scene: FilmScene | null | undefined): NonNullable<VideoClipSpec['background']>['frame_extraction'] | undefined {
  return ((scene?.spec || {}) as VideoClipSpec).background?.frame_extraction;
}

function onScreenCharacterReferences(film: Film, scene: FilmScene): ReferenceAsset[] {
  const spec = (scene.spec || {}) as VideoClipSpec;
  const ids = Array.isArray(spec.characters) ? spec.characters.map((id) => String(id)) : [];
  if (!ids.length) return [];
  const cast = Array.isArray(film.character_refs) ? film.character_refs : [];
  const seen = new Set<string>();
  const out: ReferenceAsset[] = [];
  for (const id of ids) {
    const character = cast.find((item) => String(item.id) === id && isHttpUrl(item.url));
    if (!character || seen.has(id)) continue;
    seen.add(id);
    out.push({ role: 'reference', url: String(character.url), type: 'character', label: character.name || id, characterId: id, priority: 500, critical: true });
  }
  return out;
}

function supportingSceneReferences(film: Film): ReferenceAsset[] {
  const out: ReferenceAsset[] = [];
  if (isHttpUrl(film.product_screenshot_url)) out.push({ role: 'reference', url: String(film.product_screenshot_url), type: 'product', label: 'Product', priority: 400 });
  for (const ref of Array.isArray(film.at_references) ? film.at_references : []) {
    if (!isHttpUrl(ref?.url) || ref.type === 'character') continue;
    const type = ref.type === 'location' ? 'environment' : 'style';
    out.push({ role: 'reference', url: ref.url, type, label: `@${ref.name}`, priority: type === 'environment' ? 200 : 100 });
  }
  return out;
}

function sceneCharacterPromptNote(film: Film, scene: FilmScene): string {
  const ids = Array.isArray(((scene.spec || {}) as VideoClipSpec).characters)
    ? (((scene.spec || {}) as VideoClipSpec).characters || []).map(String)
    : [];
  const cast = Array.isArray(film.character_refs) ? film.character_refs : [];
  const lines = ids.map((id) => cast.find((item) => String(item.id) === id)).filter(Boolean).map((character) =>
    `${character!.name}: ${[character!.appearance, character!.wardrobe ? `wardrobe ${character!.wardrobe}` : ''].filter(Boolean).join('; ')}`,
  );
  return lines.length ? `ON-SCREEN CHARACTERS — keep each visible in the frame position stated by this scene: ${lines.join(' | ')}` : '';
}

export function allScenesDone(scenes: FilmScene[]): boolean {
  return scenes.length > 0 && scenes.every((s) => DONE.has(String(s.status)));
}

/** Pack adjacent director beats into the chosen model's legal generation
 * blocks. Script text is concatenated verbatim and each visual beat gets an
 * explicit time range inside the block. A 60-second Seedance 2.5 plan therefore
 * becomes 30+30 (subject to the source plan's measured total), not six browser-
 * dependent 10-second jobs. The final remainder is rebalanced, never padded or
 * discarded. */
function packPlannedBlocks(source: any[], model: VideoModelConfig, targetDuration?: number | null): any[] {
  const max = Math.max(1, Number(model.safeMaxDuration) || 8);
  const min = Math.max(1, Number(model.minDuration) || 1);
  let input = Array.isArray(source) ? source.map((beat) => ({ ...beat })) : [];
  const wanted = Math.max(0, Math.round(Number(targetDuration) || 0));
  const groups: any[][] = [];
  if (wanted && input.length) {
    const desiredBlocks = Math.max(1, Math.ceil(wanted / max));
    // A terse script can produce fewer director beats than the chosen runtime
    // needs. Split the longest source segment at a word boundary until every
    // legal block has real, non-duplicated script coverage.
    while (input.length < desiredBlocks) {
      let longest = -1;
      for (let i = 0; i < input.length; i += 1) {
        if (longest < 0 || String(input[i].script_segment || '').length > String(input[longest].script_segment || '').length) longest = i;
      }
      const beat = input[longest];
      const words = String(beat?.script_segment || '').trim().split(/\s+/).filter(Boolean);
      if (!beat || words.length < 2) break;
      const split = Math.max(1, Math.floor(words.length / 2));
      const seconds = Math.max(2, Number(beat.duration_s) || 2);
      const dialogueWords = beat.dialogue?.line ? String(beat.dialogue.line).trim().split(/\s+/).filter(Boolean) : [];
      const dialogueCut = dialogueWords.length > 1 ? Math.max(1, Math.min(dialogueWords.length - 1, Math.round(dialogueWords.length * (split / words.length)))) : dialogueWords.length;
      const firstDialogue = dialogueWords.length ? { ...beat.dialogue, line: dialogueWords.slice(0, dialogueCut).join(' ') } : beat.dialogue;
      const secondDialogue = dialogueWords.length > 1 ? { ...beat.dialogue, line: dialogueWords.slice(dialogueCut).join(' ') } : null;
      const first = { ...beat, script_segment: words.slice(0, split).join(' '), duration_s: Math.max(1, Math.floor(seconds / 2)), summary: `${String(beat.summary || 'Beat')} — part 1`, dialogue: firstDialogue };
      const second = { ...beat, script_segment: words.slice(split).join(' '), duration_s: Math.max(1, Math.ceil(seconds / 2)), summary: `${String(beat.summary || 'Beat')} — part 2`, dialogue: secondDialogue };
      input.splice(longest, 1, first, second);
    }
    const blockCount = Math.max(1, Math.min(input.length, desiredBlocks));
    let cursor = 0;
    for (let block = 0; block < blockCount; block += 1) {
      const remainingBlocks = blockCount - block;
      const remainingBeats = input.length - cursor;
      const take = remainingBlocks === 1
        ? remainingBeats
        : Math.max(1, Math.min(remainingBeats - (remainingBlocks - 1), Math.round(input.length / blockCount)));
      groups.push(input.slice(cursor, cursor + take).map((beat) => ({ ...beat })));
      cursor += take;
    }
    const blockDurations: number[] = [];
    let remaining = wanted;
    for (let index = 0; index < blockCount; index += 1) {
      const duration = Math.min(max, remaining);
      blockDurations.push(duration);
      remaining -= duration;
    }
    // Legal remainder handling: borrow only enough from the preceding full
    // block to bring the final block up to the provider floor. For the current
    // choices this yields Seedance 45s = 30+15 and Kling 15s = 10+5.
    if (blockDurations.length > 1 && blockDurations[blockDurations.length - 1] < min) {
      const need = min - blockDurations[blockDurations.length - 1];
      blockDurations[blockDurations.length - 2] -= need;
      blockDurations[blockDurations.length - 1] += need;
    }
    groups.forEach((beats, index) => {
      const blockDuration = blockDurations[index];
      const weight = beats.reduce((n, beat) => n + Math.max(1, Number(beat?.duration_s) || 1), 0) || 1;
      let allocated = 0;
      beats.forEach((beat, beatIndex) => {
        const seconds = beatIndex === beats.length - 1
          ? Math.max(1, blockDuration - allocated)
          : Math.max(1, Math.round(blockDuration * (Math.max(1, Number(beat?.duration_s) || 1) / weight)));
        beat.duration_s = seconds; allocated += seconds;
      });
    });
  } else {
    let current: any[] = [];
    let currentS = 0;
    for (const beat of input) {
      const seconds = Math.max(1, Number(beat?.duration_s) || min);
      if (current.length && currentS + seconds > max) {
        groups.push(current); current = []; currentS = 0;
      }
      current.push({ ...beat, duration_s: seconds }); currentS += seconds;
    }
    if (current.length) groups.push(current);
  }
  if (groups.length > 1) {
    const last = groups[groups.length - 1];
    const lastS = last.reduce((n, beat) => n + Number(beat.duration_s || 0), 0);
    const prev = groups[groups.length - 2];
    const prevS = prev.reduce((n, beat) => n + Number(beat.duration_s || 0), 0);
    if (lastS < min && prevS + lastS <= max) groups.splice(groups.length - 2, 2, [...prev, ...last]);
  }
  return groups.map((beats) => {
    const duration = beats.reduce((n, beat) => n + Number(beat.duration_s || 0), 0);
    let cursor = 0;
    const timedBeats = beats.map((beat) => {
      const start = cursor; cursor += Number(beat.duration_s || 0);
      return {
        start_s: start,
        end_s: cursor,
        action: String(beat.visual_goal || beat.summary || '').trim(),
        dialogue: beat.dialogue?.line ? String(beat.dialogue.line) : undefined,
        audio: beat.dialogue?.kind === 'narrator' ? 'narration' : beat.dialogue?.line ? 'native dialogue' : 'native ambience/effects',
      };
    });
    const dialogueLines = beats.map((beat) => beat.dialogue).filter(Boolean);
    return {
      ...beats[0],
      duration_s: duration,
      script_segment: beats.map((beat) => String(beat.script_segment || '')).join('\n').trim(),
      summary: beats.map((beat) => String(beat.summary || '')).filter(Boolean).join(' → '),
      visual_goal: timedBeats.map((beat) => `[${beat.start_s.toFixed(0)}–${beat.end_s.toFixed(0)}s] ${beat.action}`).join('\n'),
      timed_beats: timedBeats,
      characters: Array.from(new Set(beats.flatMap((beat) => Array.isArray(beat.characters) ? beat.characters : []))),
      dialogue: dialogueLines.length === 1 ? dialogueLines[0] : dialogueLines.length ? {
        kind: dialogueLines.every((line: any) => line.kind === 'narrator') ? 'narrator' : 'character',
        line: dialogueLines.map((line: any) => String(line.line || '')).filter(Boolean).join(' '),
        speaker: dialogueLines.map((line: any) => String(line.speaker || '')).filter(Boolean).join(' / '),
        delivery: 'Follow each timed line exactly; never pad, paraphrase or drop dialogue.',
        language: dialogueLines[0].language || 'English',
        accent: dialogueLines[0].accent,
      } : null,
      duration_notes: beats.flatMap((beat) => Array.isArray(beat.duration_notes) ? beat.duration_notes : []),
    };
  });
}

// ---------------------------------------------------------------------------
// Manual Script Mode + the dual-reference (n+1) method
// ---------------------------------------------------------------------------

/** True when this film's scenes were parsed from a script the customer pasted
 * rather than segmented by the director model. Manual mode does not rewrite
 * the script, but every rendered clip still receives the required vision check. */
export function isManualFilm(film: Film): boolean {
  return film.plan?.input_mode === 'manual';
}

/** Append a note to a prompt without the proxy's hard character cap cutting
 * the note itself back off the end. */
function appendPromptNote(prompt: string, note: string, maxChars: number): string {
  const body = String(prompt || '').trim();
  if (!note) return body;
  return `${capText(body, Math.max(160, maxChars - note.length - 1))}\n${note}`;
}

// ---------------------------------------------------------------------------
// Stored @name references + style lock — the two things every scene of a film
// carries, whatever else changes clip to clip
// ---------------------------------------------------------------------------

/** The stored references this script summoned with @name, resolved once when
 * the film is created and then persisted on the film row. A reference lookup
 * must never stop a film from being made, so a failure resolves to none. */
async function resolveFilmAtReferences(script: string): Promise<AtReference[]> {
  try {
    const stored = await db.listReferences();
    return resolveAtMentions(script, stored).map((r) => ({
      name: r.name,
      url: r.url,
      type: r.type,
      ...(r.description ? { description: r.description } : {}),
    }));
  } catch {
    return [];
  }
}

/** The stored references' appearance notes in words, so a model carrying
 * fewer pictures than the script summoned still gets their identity. */
function appendAtReferenceNote(film: Film, prompt: string, modelId?: string | null): string {
  const described = (Array.isArray(film.at_references) ? film.at_references : [])
    .filter((r) => r?.type !== 'character' && String(r?.description || '').trim());
  if (!described.length) return prompt;
  const note = `Stored references (match them exactly): ${described.map((r) => `${r.name} — ${capText(String(r.description), 1000)}`).join('; ')}`;
  return appendPromptNote(prompt, capText(note, 5000), resolveVideoModel(modelId || film.video_model).promptMaxChars);
}

/**
 * STYLE LOCK — scene 1's visual fingerprint, prepended verbatim to every
 * later prompt so clip 7 cannot drift into a different palette, light or lens
 * than clip 1. The combined text is capped to the model's own limit AFTER
 * prepending (the scene body is trimmed from the end), so the lock itself is
 * never the part that gets cut.
 */
function applyStyleLock(film: Film, scene: FilmScene, prompt: string): string {
  const lock = String(film.style_lock_description || '').trim();
  if (film.style_lock !== true || !lock || scene.idx === 0) return prompt;
  const head = `STYLE LOCK (maintain exactly):\n${lock}\n\n`;
  const modelId = ((scene.spec || {}) as VideoClipSpec).engine_id || film.video_model;
  const room = Math.max(200, resolveVideoModel(modelId).promptMaxChars - head.length);
  return `${head}${capText(prompt, room)}`;
}

/** Everything a prepared prompt carries beyond the scene itself: the stored
 * reference notes, then the film's locked style. */
function finishScenePrompt(film: Film, scene: FilmScene, prompt: string): string {
  const modelId = ((scene.spec || {}) as VideoClipSpec).engine_id || film.video_model;
  return applyStyleLock(film, scene, appendAtReferenceNote(film, prompt, modelId));
}

function sceneStarts(scenes: PlanScene[]): number[] {
  let cursor = 0;
  return scenes.map((scene) => { const start = cursor; cursor += Math.max(0.25, Number(scene.duration_s) || 0); return start; });
}

function plannedTextTimeline(items: Array<{ text: string; scene_numbers: number[]; start_s: number; end_s: number; position: OnScreenTextItem['position']; style: OnScreenTextItem['style'] }>, scenes: PlanScene[]): OnScreenTextItem[] {
  const starts = sceneStarts(scenes);
  return items.map((item, index) => {
    const indexes = item.scene_numbers.map((number) => Math.min(scenes.length - 1, Math.max(0, number - 1))).sort((a, b) => a - b);
    const first = indexes[0] ?? 0;
    const last = indexes[indexes.length - 1] ?? first;
    const windowStart = starts[first] || 0;
    const windowEnd = (starts[last] || 0) + Math.max(0.25, Number(scenes[last]?.duration_s) || 0);
    const start = Math.min(windowEnd - 0.25, windowStart + Math.max(0, Number(item.start_s) || 0));
    const end = Math.min(windowEnd, windowStart + Math.max(Number(item.end_s) || 0, Number(item.start_s) + 0.25));
    return {
      id: `text_${index + 1}_${newSceneKey()}`,
      text: item.text,
      scene_keys: indexes.map((sceneIndex) => scenes[sceneIndex]?.scene_key).filter(Boolean) as string[],
      start_s: start,
      end_s: Math.max(start + 0.25, end),
      position: item.position,
      style: item.style,
      source: 'brief' as const,
    };
  }).filter((item) => item.text && item.end_s > item.start_s);
}

function manualTextTimeline(parsed: ParsedScene[], scenes: PlanScene[]): OnScreenTextItem[] {
  const starts = sceneStarts(scenes);
  const items: OnScreenTextItem[] = [];
  parsed.forEach((source, index) => {
    const scene = scenes[index];
    if (!scene) return;
    (source.onScreenText || []).forEach((text, textIndex) => items.push({
      id: `text_${index + 1}_${textIndex + 1}_${newSceneKey()}`,
      text,
      scene_keys: [scene.scene_key],
      start_s: starts[index] || 0,
      end_s: (starts[index] || 0) + Math.max(0.25, Number(scene.duration_s) || 0),
      position: 'bottom',
      style: 'clean',
      source: 'manual',
    }));
  });
  return items;
}

function sceneTextItems(film: Film, scene: FilmScene): OnScreenTextItem[] {
  return (film.plan?.on_screen_text || []).filter((item) => (item.scene_keys || []).includes(scene.scene_key));
}

// ---------------------------------------------------------------------------
// Stage 1 — script received → analyzed → segmented → first scene prepared
// ---------------------------------------------------------------------------

export async function createAndSegmentFilm(params: {
  script: string;
  aspect: Aspect;
  referenceImageUrl?: string | null;
  /** Character reference image for the dual-reference (n+1) method. */
  characterRefUrl?: string | null;
  note?: string;
  /** Video model registry id (see VIDEO_MODELS); null/undefined = default. */
  videoModel?: string | null;
  /** Style Lock (default ON): freeze the look after scene 1. */
  styleLock?: boolean | null;
  targetDuration?: number | null;
  audioEnabled?: boolean;
  narrationEnabled?: boolean;
  charactersSpeak?: boolean;
  entryType?: EntryType;
  controlMode?: ControlMode;
  executionMode?: ExecutionMode;
  videoStyle?: VideoStyleId;
  customVisualDirection?: string;
  audioPolicy?: AudioPolicy;
  maxAuthorizedCredits?: number | null;
  storyboardRequested?: boolean;
}, hooks: RunHooks = {}): Promise<{ film: Film; scenes: FilmScene[] }> {
  const requestedDuration = Math.round(Number(params.targetDuration) || 0);
  if (requestedDuration > 1800) throw new Error('The maximum assembled project duration is 30:00.');
  if (requestedDuration && requestedDuration < 2) throw new Error('Choose at least a 2-second project duration.');
  // Anything the script summoned with @name is resolved BEFORE the row is
  // written, so every scene of this film carries the same references.
  const atReferences = await resolveFilmAtReferences(params.script);
  const film = await db.createFilm({
    title: null,
    script: params.script,
    aspect_ratio: params.aspect,
    status: 'planning',
    machine_state: 'SCRIPT_RECEIVED',
    stage_note: 'Script received.',
    product_screenshot_url: params.referenceImageUrl || null,
    character_ref_url: params.characterRefUrl || null,
    video_model: resolveVideoModel(params.videoModel).id,
    style_lock: params.styleLock !== false,
    style_lock_description: null,
    at_references: atReferences,
  });
  try {
    if (atReferences.length) say(hooks, `${atReferences.length} stored reference${atReferences.length === 1 ? '' : 's'} resolved from your script (${atReferences.map((r) => `@${r.name}`).join(', ')}) — they travel with every scene.`);
    await setState(film, hooks, 'ANALYZING_SCRIPT', 'The director is reading the entire script and mapping the story…');
    const castVoices = await listVoices().catch(() => []);
    const plan = await segmentScript({
      script: params.script,
      aspect: params.aspect,
      note: params.note,
      referenceImageUrl: params.referenceImageUrl,
      audioEnabled: params.audioEnabled !== false,
      narrationEnabled: params.narrationEnabled === true,
      charactersSpeak: params.charactersSpeak === true,
      voices: castVoices,
      targetDuration: requestedDuration || null,
      videoModel: params.videoModel,
      videoStyle: params.customVisualDirection || params.videoStyle,
      audioPolicy: params.audioPolicy,
      maxAuthorizedCredits: params.maxAuthorizedCredits,
    });
    await setState(film, hooks, 'SEGMENTING_SCRIPT', `Written by ${plan.writer_model}. Story understood — checking and packing ${plan.scenes.length} sequential clips…`);
    plan.notes.forEach((note) => say(hooks, `Planning guardrail: ${note}`));

    // One model-selection state drives planner, UI and server. The creative
    // planner may recommend shot intents, but it cannot silently override the
    // film's approved primary model scene by scene.
    const primaryModel = resolveVideoModel(params.videoModel);
    const primaryReason = primaryModel.id === 'seedance-2.5'
      ? 'Seedance 2.5 is the approved primary model: 4–30 whole seconds per block, optional audio, and first/last frames or up to three asset references.'
      : primaryModel.id === 'kling-3.0-omni'
        ? 'Kling Omni 3.0 is the approved primary model: 5s or 10s blocks with up to four recurring-subject references.'
        : `${primaryModel.label} is the approved primary model for this film.`;
    const packedScenes = packPlannedBlocks(plan.scenes, primaryModel, requestedDuration || null);
    const packedDuration = packedScenes.reduce((sum, scene) => sum + Number(scene.duration_s || 0), 0);
    if (requestedDuration && Math.abs(packedDuration - requestedDuration) > 1) {
      throw new Error(`The accepted script supports ${packedDuration}s of non-duplicated model blocks, not the requested ${requestedDuration}s. Choose one: use ${packedDuration}s, allow the writer to expand the script, or add more source material. Nothing was submitted or billed.`);
    }
    const planScenes = packedScenes.map((s, i) => ({
      scene_key: newSceneKey(),
      idx: i,
      type: 'video_clip' as const,
      script_segment: s.script_segment,
      duration_s: s.duration_s,
      continuity_group: null,
      spec: {
        summary: s.summary,
        visual_goal: s.visual_goal,
        characters: s.characters,
        shot_intent: s.shot_intent,
        workflow_kind: s.workflow_kind,
        engine_id: primaryModel.id,
        engine_reason: primaryReason,
        // The approved film model owns duration. Shot-intent routing notes were
        // calculated before that choice and can incorrectly claim an 8s model
        // on a legal 30s Seedance block, so they never travel into the plan.
        duration_notes: [],
        duration_s: s.duration_s,
        timed_beats: Array.isArray(s.timed_beats) ? s.timed_beats : [],
        model_assignment: { model_id: primaryModel.apiModel, operation: 'generate', locked: params.controlMode === 'manual', reason: primaryReason },
        prompt_version: 1,
        background: {
          idempotency_key: `stv:film:${film.id}:scene:${i}`,
          status: 'queued', retries: 0, max_retries: 3,
          credits_estimated: s.duration_s,
        },
      } as VideoClipSpec,
      dialogue: s.dialogue || null,
      summary: s.summary,
      visual_goal: s.visual_goal,
      characters: s.characters,
    }));
    const onScreenText = plannedTextTimeline(plan.on_screen_text || [], planScenes);
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
    const characterRefs = await generateInitialCharacterSheets(
      film, plan.characters, plan.visual_style, params.characterRefUrl || null, atReferences, hooks,
    );
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
        on_screen_text: onScreenText,
        assumptions: [...plan.notes, ...(params.note ? [params.note] : [])],
        input_mode: 'ai',
        requested_duration_s: requestedDuration || null,
        contract_version: 2,
        entry_type: params.entryType || 'idea',
        control_mode: params.controlMode || 'agentic',
        execution_mode: params.executionMode || 'review',
        video_style: params.videoStyle || 'cinematic-live-action',
        custom_visual_direction: params.customVisualDirection || '',
        target_duration_sec: requestedDuration || planScenes.reduce((sum, scene) => sum + scene.duration_s, 0),
        audio_policy: params.audioPolicy || 'native-dialogue-effects',
        max_authorized_credits: Number(params.maxAuthorizedCredits) || planScenes.reduce((sum, scene) => sum + scene.duration_s, 0),
        master_script_version: 1,
        scene_plan_version: 1,
        model_registry_snapshot: { version: S2V_CAPABILITY_REGISTRY_VERSION, captured_at: new Date().toISOString(), capabilities: S2V_VIDEO_CAPABILITIES },
        project_asset_ids: [],
        storyboard_only_asset_ids: [],
        storyboard_requested: params.storyboardRequested === true,
        writer_model: plan.writer_model,
        clip_ids: planScenes.map((scene) => scene.scene_key),
        sections: buildLongFormSections(requestedDuration || planScenes.reduce((sum, scene) => sum + scene.duration_s, 0), planScenes.map((scene) => scene.duration_s)),
        continuity_manifest: {
          version: 1,
          cast: Object.fromEntries(plan.characters.map((character) => [character.id, { name: character.name, appearance: character.appearance, wardrobe: character.wardrobe, voice: character.voice }])),
          style: { direction: params.customVisualDirection || plan.visual_style, lock: params.styleLock !== false },
          locations: {}, products: {}, handoffs: [],
        },
        orchestration: {
          state: params.executionMode === 'automatic' ? 'auto_authorized' : 'awaiting_approval',
          intent: 'plan', checkpoint: 'storyboard_ready', manual_locks: {}, paused: false, cancel_requested: false,
          completed_count: 0, total_count: planScenes.length,
          credits_estimated: planScenes.reduce((sum, scene) => sum + scene.duration_s, 0), credits_reserved: 0, credits_actual: 0, billed_so_far: 0,
          updated_at: new Date().toISOString(),
        },
        editor_composition_version: 0,
        export_records: [],
        audio_enabled: params.audioEnabled !== false,
        narration_enabled: params.audioEnabled !== false && params.narrationEnabled === true,
        characters_speak: params.audioEnabled !== false && params.charactersSpeak === true,
        cast_reviewed: false,
      },
      character_refs: characterRefs,
      stage_note: characterRefs.length
        ? characterRefs.some((character) => !character.url)
          ? `${planScenes.length} legal ${primaryModel.label} block${planScenes.length === 1 ? '' : 's'} planned. ${characterRefs.filter((character) => !character.url).length} cast sheet image${characterRefs.filter((character) => !character.url).length === 1 ? '' : 's'} still need attention before Start.`
          : `${planScenes.length} legal ${primaryModel.label} block${planScenes.length === 1 ? '' : 's'} planned. Review and approve ${characterRefs.length} cast sheet${characterRefs.length === 1 ? '' : 's'} before Start.`
        : `${planScenes.length} legal ${primaryModel.label} block${planScenes.length === 1 ? '' : 's'} planned. No clear characters were found — add one if the film needs a recurring identity, or confirm the character-free plan.`,
    });

    const scenes = await db.listScenes(film.id);
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

function castSlug(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Generate every proposed sheet before plan approval. Existing @name library
 * references and a creator-uploaded cast image are reused first; only the
 * remaining sheets spend image-generation credits. Nothing is auto-approved. */
async function generateInitialCharacterSheets(
  film: Film,
  profiles: FilmCharacterProfile[],
  visualStyle: string,
  uploadedUrl: string | null,
  atReferences: AtReference[],
  hooks: RunHooks,
): Promise<FilmCharacter[]> {
  const output: FilmCharacter[] = [];
  for (let index = 0; index < profiles.length; index += 1) {
    const profile = profiles[index];
    const matched = atReferences.find((ref) => castSlug(ref.name) === castSlug(profile.name) || castSlug(ref.name) === castSlug(profile.id));
    const uploaded = index === 0 && isHttpUrl(uploadedUrl) ? String(uploadedUrl) : '';
    let url = uploaded || String(matched?.url || '');
    let source: FilmCharacter['source'] = uploaded ? 'uploaded' : matched ? 'library' : 'generated';
    let imageError = '';
    if (!url) {
      try {
        say(hooks, `Generating ${profile.name}'s character sheet…`);
        url = await generateBackdropImage(characterPortraitBrief(profile, visualStyle), '1:1', 'draft');
      } catch (error: any) {
        source = 'generated';
        imageError = String(error?.message || error).slice(0, 240);
        say(hooks, `${profile.name}'s fast draft could not be generated (${imageError.slice(0, 100)}). Retry the sheet, upload one, reuse one, or remove this cast member.`);
      }
    }
    const sheet: FilmCharacter = { ...profile, url: url || null, approved: false, source, ...(imageError ? { image_error: imageError } : {}), ...(url && source === 'generated' ? { image_model: 'gemini-3.1-flash-image' } : {}) };
    output.push(sheet);
    if (url) await db.addAsset({ film_id: film.id, kind: 'character', name: `${profile.name} character sheet`, description: profile.appearance.slice(0, 200), url });
  }
  return output;
}

function isHttpUrl(value: unknown): boolean {
  return /^https:\/\//i.test(String(value || '').trim());
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
  // Manual Script Mode writes its own prompt straight from the pasted text —
  // the director model is never called for a manual film.
  if (isManualFilm(film)) { await prepareManualScene(film, scenes, scene, hooks, opts); return; }
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

    // Mandatory n→n+1 chain. The creative director still writes the scene,
    // but it cannot demote continuity or substitute a character sheet into the
    // first-frame slot. Only the explicit user override recorded on the prior
    // card permits a later scene to proceed without that frame.
    const existingSpec = (scene.spec || {}) as VideoClipSpec;
    const assets: ReferenceAsset[] = [];
    let continuation = false;
    let referenceType: ReferenceType = 'none';
    const immediate = scene.idx > 0 ? immediatePreviousScene(scenes, scene.idx) : null;
    if (scene.idx > 0) {
      const extraction = frameExtractionOf(immediate);
      if (!immediate || (immediate.status !== 'completed' && !(immediate.status === 'skipped' && extraction?.status === 'continued_without'))) {
        throw new Error(`Scene ${scene.idx + 1} is waiting for Scene ${scene.idx}'s validated last frame.`);
      }
      if (isHttpUrl(immediate.keyframe_url)) {
        assets.push({
          role: 'first_frame', url: String(immediate.keyframe_url), type: 'continuity-frame', label: `Scene ${immediate.idx + 1} last frame`,
          sourceSceneId: immediate.id, sourceSceneIndex: immediate.idx, method: extraction?.method, atSecond: extraction?.at_second,
          priority: 600, critical: true,
        });
        continuation = true;
        referenceType = 'previous_final_frame';
      } else if (extraction?.status !== 'continued_without') {
        throw new Error(`Scene ${scene.idx + 1} is waiting for Scene ${scene.idx}'s last frame. Retry frame extraction or explicitly continue without continuity on that scene card.`);
      }
    }
    const candidateRefs = [...onScreenCharacterReferences(film, scene), ...supportingSceneReferences(film)];
    for (const ref of candidateRefs) if (!assets.some((asset) => asset.url === ref.url)) assets.push(ref);
    if (scene.idx === 0 && assets.length) referenceType = assets[0].type === 'character' ? 'character_reference' : 'scene_reference';
    const characterNote = sceneCharacterPromptNote(film, scene);
    const prompt = characterNote
      ? appendPromptNote(prepared.prompt, characterNote, resolveVideoModel(existingSpec.engine_id || film.video_model).promptMaxChars)
      : prepared.prompt;

    const spec: VideoClipSpec = {
      ...existingSpec,
      negative: prepared.negative,
      reasoning: prepared.reasoning,
    };
    await patchScene(scene, hooks, {
      status: 'ready',
      error: null,
      prompt: finishScenePrompt(film, scene, prompt),
      continuation,
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

/**
 * Prepare ONE manual scene. No model is called at any point: the prompt is
 * assembled from the scene's own parsed visual, camera and dialogue plus the
 * script's overall style block, and the references follow the same
 * dual-reference rule every other mode uses.
 */
async function prepareManualScene(
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
    scene.idx === 0 || !prev ? 'PREPARING_SCENE' : 'PREPARE_NEXT_SCENE',
    `Scene ${scene.idx + 1}: building the prompt from your script…`,
  );
  try {
    const spec = (scene.spec || {}) as VideoClipSpec;
    const manual = spec.manual;
    if (!manual) throw new Error(`Scene ${scene.idx + 1} carries no parsed script data — re-create this film from the pasted script.`);

    const immediate = scene.idx > 0 ? immediatePreviousScene(scenes, scene.idx) : null;
    const extraction = frameExtractionOf(immediate);
    const continuation = scene.idx > 0 && !!immediate?.keyframe_url;
    const assets: ReferenceAsset[] = [];
    if (scene.idx > 0 && (!immediate || (immediate.status !== 'completed' && !(immediate.status === 'skipped' && extraction?.status === 'continued_without')))) throw new Error(`Scene ${scene.idx + 1} is waiting for Scene ${scene.idx}'s validated last frame.`);
    if (continuation && immediate?.keyframe_url) assets.push({ role: 'first_frame', url: immediate.keyframe_url, type: 'continuity-frame', label: `Scene ${immediate.idx + 1} last frame`, sourceSceneId: immediate.id, sourceSceneIndex: immediate.idx, method: extraction?.method, atSecond: extraction?.at_second, priority: 600, critical: true });
    else if (scene.idx > 0 && extraction?.status !== 'continued_without') throw new Error(`Scene ${scene.idx + 1} is waiting for Scene ${scene.idx}'s last frame. Retry frame extraction or explicitly continue without continuity.`);
    for (const ref of [...onScreenCharacterReferences(film, scene), ...supportingSceneReferences(film)]) if (!assets.some((asset) => asset.url === ref.url)) assets.push(ref);

    const model = resolveVideoModel(film.video_model);
    const audioEnabled = film.plan?.audio_enabled !== false;
    const narrationEnabled = audioEnabled && film.plan?.narration_enabled === true;
    const charactersSpeak = audioEnabled && film.plan?.characters_speak === true;
    const promptScene: ParsedScene = {
      ...manual,
      dialogue: manual.dialogue.filter((entry) => {
        const narrator = /^(narrator|voice[ -]?over|vo)$/i.test(entry.speaker.trim());
        return narrator ? narrationEnabled : charactersSpeak;
      }),
    };
    const basePrompt = buildManualScenePrompt({
      scene: promptScene,
      globalStyle: String(film.plan?.global_style || ''),
      continuity: continuation,
      revisionNote: opts.revisionNote,
      maxChars: model.promptMaxChars,
    });
    const characterNote = sceneCharacterPromptNote(film, scene);
    const finalPrompt = characterNote ? appendPromptNote(basePrompt, characterNote, model.promptMaxChars) : basePrompt;

    const nextSpec: VideoClipSpec = {
      ...spec,
      negative: manualSceneNegative(promptScene),
      reasoning: continuation
        ? `Manual Script Mode — continuing from scene ${(prev?.idx ?? 0) + 1}'s final frame.`
        : 'Manual Script Mode — staged exactly as written in your script.',
    };
    await patchScene(scene, hooks, {
      status: 'ready',
      error: null,
      prompt: finishScenePrompt(film, scene, finalPrompt),
      continuation,
      reference_type: continuation ? 'previous_final_frame' : assets.length ? (assets[0].type === 'character' ? 'character_reference' : 'scene_reference') : 'none',
      reference_assets: assets,
      spec: nextSpec,
      clip_fingerprint: sceneFingerprint({ type: scene.type, spec: nextSpec }, (film.aspect_ratio || '16:9') as Aspect),
    });
    await setState(film, hooks, 'PROMPT_READY', `Scene ${scene.idx + 1} is ready — review the prompt and generate when you are.`);
  } catch (e: any) {
    await patchScene(scene, hooks, statusBefore === 'completed'
      ? { status: 'completed', error: String(e?.message || e) }
      : { status: 'failed', error: String(e?.message || e) });
    await patchFilm(film, hooks, { stage_note: `Scene ${scene.idx + 1} could not be prepared.`, error: String(e?.message || e) });
    throw e;
  }
}

/** A manual scene's on-camera line, as the audio stage reads it: a scene that
 * speaks keeps the clip's own generated voice and is never narrated over. */
function manualSceneDialogue(scene: ParsedScene, options: { audioEnabled: boolean; narrationEnabled: boolean; charactersSpeak: boolean }): SceneDialogue | null {
  if (!options.audioEnabled) return null;
  const spoken = scene.dialogue.filter((entry) => entry.line.trim()).filter((entry) => {
    const narrator = /^(narrator|voice[ -]?over|vo)$/i.test(entry.speaker.trim());
    return narrator ? options.narrationEnabled : options.charactersSpeak;
  });
  if (!spoken.length) return null;
  return {
    kind: /^(narrator|voice[ -]?over|vo)$/i.test(spoken[0].speaker.trim()) ? 'narrator' : 'character',
    line: spoken.map((entry) => entry.line.trim()).join(' '),
    speaker: spoken[0].speaker || 'the speaker', 
    delivery: 'natural, exactly as written in the script',
    language: 'English',
  };
}

/**
 * MANUAL SCRIPT MODE — create a film straight from a pre-formatted script.
 * The parser is the only thing that reads the text: no scene detection and no
 * directing pass run. The scenes it produces enter the normal generation
 * pipeline exactly as a planned film's would, so everything downstream —
 * sequential rendering, frame extraction, the review board, post-production
 * and Final Assembly — is unchanged.
 */
export async function createManualScriptFilm(params: {
  script: string;
  aspect: Aspect;
  /** Character reference image for the dual-reference (n+1) method. */
  characterRefUrl?: string | null;
  referenceImageUrl?: string | null;
  note?: string | null;
  videoModel?: string | null;
  /** Style Lock (default ON): freeze the look after scene 1. */
  styleLock?: boolean | null;
  targetDuration?: number | null;
  audioEnabled?: boolean;
  narrationEnabled?: boolean;
  charactersSpeak?: boolean;
  entryType?: EntryType;
  controlMode?: ControlMode;
  executionMode?: ExecutionMode;
  videoStyle?: VideoStyleId;
  customVisualDirection?: string;
  audioPolicy?: AudioPolicy;
  maxAuthorizedCredits?: number | null;
  storyboardRequested?: boolean;
}, hooks: RunHooks = {}): Promise<{ film: Film; scenes: FilmScene[] }> {
  const requestedDuration = Math.round(Number(params.targetDuration) || 0);
  if (requestedDuration > 1800) throw new Error('The maximum assembled project duration is 30:00.');
  const parsed = parseManualScript(params.script);
  if (!parsed.scenes.length) {
    throw new Error('No scenes were found in that script. Every scene must open with a line like "Scene 1 — Title | 8 sec".');
  }
  // A director note has nobody to direct in this mode, so it joins the
  // overall style block and reaches every clip that way.
  const globalStyle = [parsed.globalStyle, String(params.note || '').trim()].filter(Boolean).join(' ');
  const model = resolveVideoModel(params.videoModel);
  say(hooks, 'Reading the full script to propose the cast without changing your wording…');
  const castVoices = await listVoices().catch(() => []);
  const proposedCast = await analyzeScriptCast(params.script, castVoices);
  // The @name mentions are read from the pasted script exactly as they are in
  // AI Mode — the parser leaves them in the visual text.
  const atReferences = await resolveFilmAtReferences(params.script);
  const film = await db.createFilm({
    title: parsed.scenes[0].title || 'Manual script film',
    script: params.script,
    aspect_ratio: params.aspect,
    status: 'planning',
    machine_state: 'SEGMENTING_SCRIPT',
    stage_note: `${parsed.scenes.length} scenes read from your script.`,
    product_screenshot_url: params.referenceImageUrl || null,
    character_ref_url: params.characterRefUrl || null,
    video_model: model.id,
    style_lock: params.styleLock !== false,
    style_lock_description: null,
    at_references: atReferences,
  });
  try {
    if (atReferences.length) say(hooks, `${atReferences.length} stored reference${atReferences.length === 1 ? '' : 's'} resolved from your script (${atReferences.map((r) => `@${r.name}`).join(', ')}) — they travel with every scene.`);
    const planScenes: PlanScene[] = [];
    for (const parsedScene of parsed.scenes) {
      const idx = parsedScene.index - 1;
      // MANUAL SCRIPT MODE films the length the script asks for. The only
      // thing allowed to change it is the provider's own floor/ceiling, so a
      // "| 7 sec" scene is seven seconds long — it is no longer rounded down
      // onto a fixed 4/6/8/10 ladder.
      const duration = resolveDuration(parsedScene.durationSec, model);
      const segment = manualSceneSegment(parsedScene);
      const dialogue = manualSceneDialogue(parsedScene, {
        audioEnabled: params.audioEnabled !== false,
        narrationEnabled: params.narrationEnabled === true,
        charactersSpeak: params.charactersSpeak === true,
      });
      const sceneKey = newSceneKey();
      const spec: VideoClipSpec = {
        summary: parsedScene.title,
        visual_goal: parsedScene.visual,
        duration_s: duration,
        timed_beats: [{ start_s: 0, end_s: duration, action: parsedScene.visual, camera: parsedScene.camera, dialogue: dialogue?.line, audio: dialogue ? (dialogue.kind === 'narrator' ? 'narration' : 'native dialogue') : 'native ambience/effects' }],
        model_assignment: { model_id: model.apiModel, operation: 'generate', locked: true, reason: 'Creator locked this model in Manual mode.' },
        prompt_version: 1,
        background: { idempotency_key: `stv:film:${film.id}:scene:${idx}`, status: 'queued', retries: 0, max_retries: 3, credits_estimated: duration },
        manual: parsedScene,
      };
      planScenes.push({
        scene_key: sceneKey,
        idx,
        type: 'video_clip',
        script_segment: segment,
        duration_s: duration,
        continuity_group: null,
        spec,
        dialogue,
        summary: parsedScene.title,
        visual_goal: parsedScene.visual,
      });
      await db.insertScene({
        film_id: film.id,
        idx,
        scene_key: sceneKey,
        type: 'video_clip',
        script_segment: segment,
        spec,
        status: 'waiting',
        duration_s: duration,
        continuity_group: null,
        dialogue,
      });
    }
    const onScreenText = manualTextTimeline(parsed.scenes, planScenes);
    const characterRefs = await generateInitialCharacterSheets(
      film, proposedCast, globalStyle, params.characterRefUrl || null, atReferences, hooks,
    );
    await patchFilm(film, hooks, {
      status: 'plan_ready',
      plan: {
        title: String(film.title || 'Manual script film'),
        style_direction: globalStyle,
        visual_style: globalStyle,
        story_summary: parsed.scenes.map((s) => `${s.index}. ${s.title}`).join(' · ').slice(0, 1200),
        world: '',
        characters: proposedCast,
        scenes: planScenes,
        on_screen_text: onScreenText,
        assumptions: params.note ? [String(params.note)] : [],
        input_mode: 'manual',
        global_style: globalStyle,
        requested_duration_s: requestedDuration || parsed.scenes.reduce((n, scene) => n + scene.durationSec, 0),
        contract_version: 2,
        entry_type: params.entryType || 'script', control_mode: 'manual', execution_mode: params.executionMode || 'review',
        video_style: params.videoStyle || 'custom', custom_visual_direction: params.customVisualDirection || globalStyle,
        target_duration_sec: requestedDuration || planScenes.reduce((sum, scene) => sum + scene.duration_s, 0),
        audio_policy: params.audioPolicy || 'native-dialogue-effects',
        max_authorized_credits: Number(params.maxAuthorizedCredits) || planScenes.reduce((sum, scene) => sum + scene.duration_s, 0),
        master_script_version: 1, scene_plan_version: 1,
        model_registry_snapshot: { version: S2V_CAPABILITY_REGISTRY_VERSION, captured_at: new Date().toISOString(), capabilities: S2V_VIDEO_CAPABILITIES },
        project_asset_ids: [], storyboard_only_asset_ids: [], storyboard_requested: params.storyboardRequested === true, writer_model: 'GPT Sol', clip_ids: planScenes.map((scene) => scene.scene_key),
        sections: buildLongFormSections(requestedDuration || planScenes.reduce((sum, scene) => sum + scene.duration_s, 0), planScenes.map((scene) => scene.duration_s)),
        continuity_manifest: { version: 1, cast: Object.fromEntries(proposedCast.map((character) => [character.id, { name: character.name, appearance: character.appearance, wardrobe: character.wardrobe, voice: character.voice }])), style: { direction: params.customVisualDirection || globalStyle, lock: params.styleLock !== false }, locations: {}, products: {}, handoffs: [] },
        orchestration: { state: params.executionMode === 'automatic' ? 'auto_authorized' : 'awaiting_approval', intent: 'plan', checkpoint: 'storyboard_ready', manual_locks: { script: true, model: true, prompts: true }, paused: false, cancel_requested: false, completed_count: 0, total_count: planScenes.length, credits_estimated: planScenes.reduce((sum, scene) => sum + scene.duration_s, 0), credits_reserved: 0, credits_actual: 0, billed_so_far: 0, updated_at: new Date().toISOString() },
        editor_composition_version: 0, export_records: [],
        audio_enabled: params.audioEnabled !== false,
        narration_enabled: params.audioEnabled !== false && params.narrationEnabled === true,
        characters_speak: params.audioEnabled !== false && params.charactersSpeak === true,
        cast_reviewed: false,
      },
      character_refs: characterRefs,
      stage_note: characterRefs.length
        ? `${parsed.scenes.length} scenes read from your script. Review and approve ${characterRefs.length} proposed cast sheet${characterRefs.length === 1 ? '' : 's'} before Start.`
        : `${parsed.scenes.length} scenes read from your script. No clear characters were found — add one if needed, or confirm this character-free plan.`,
    });

    const scenes = await db.listScenes(film.id);
    const fresh = await db.getFilm(film.id);
    return { film: fresh || film, scenes };
  } catch (e: any) {
    await db.updateFilm(film.id, { status: 'error', error: String(e?.message || e), stage_note: 'The pasted script could not be turned into scenes.' });
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Stage 3 — generate ONE scene (explicitly triggered), then extract the frame
// ---------------------------------------------------------------------------

export async function generateScene(
  film: Film,
  scenes: FilmScene[],
  scene: FilmScene,
  hooks: RunHooks,
  opts: {
    /** Multi-generate only: this scene may render alongside others. */
    allowConcurrent?: boolean;
    /** false = do not prepare the following scene's prompt when this clip
     * lands (a batch run prepares nothing, so parallel renders cannot race
     * each other rewriting the same waiting scene). */
    prepareNext?: boolean;
  } = {},
): Promise<void> {
  // A scene counts as prepared when it actually HAS a prompt — the prompt
  // field itself is the authority. The old guard also required the status
  // flag to read 'ready', and when that flag lagged behind the written prompt
  // it threw a false "no prepared prompt" error (and silently blocked
  // generation) on scenes whose prompt was plainly visible on the card.
  const preparedPrompt = typeof scene.prompt === 'string' ? scene.prompt.trim() : '';
  if (!preparedPrompt) throw new Error(`Scene ${scene.idx + 1} has no prepared prompt yet — prepare it first.`);
  if (!opts.allowConcurrent && scenes.some((s) => s.status === 'generating')) throw new Error('Another scene is already generating — clips render one at a time.');

  await patchFilm(film, hooks, { status: 'producing', error: null });
  await setState(film, hooks, 'GENERATING_VIDEO', `Scene ${scene.idx + 1}: generating the clip…`);
  const beforeSpec = (scene.spec || {}) as VideoClipSpec;
  const beforeBackground = { ...(beforeSpec.background || {}), status: 'submitted' as const, provider_status: 'submitting', retries: Number(beforeSpec.background?.retries || 0) };
  await patchScene(scene, hooks, { status: 'generating', error: null, spec: { ...beforeSpec, background: beforeBackground } });
  const creditKey = String(beforeBackground.idempotency_key || `stv:film:${film.id}:scene:${scene.id}`);
  try {
    const spec = (scene.spec || {}) as VideoClipSpec;
    const aspect = (film.aspect_ratio || '16:9') as Aspect;
    const durationS = Number(scene.duration_s) || 6;
    // AI plans carry a per-shot routed engine. Manual and legacy scenes fall
    // back to the film-level choice so existing projects keep working.
    const chosenModel = resolveVideoModel(spec.engine_id || film.video_model);
    let requestAssets = scene.idx === 0
      ? (scene.reference_assets || []).filter((asset) => asset && !asset.storyboardOnly && asset.type !== 'storyboard')
      : (scene.reference_assets || []).filter((asset) => asset && asset.type !== 'continuity-frame' && asset.role !== 'first_frame');
    if (scene.idx > 0) {
      const previous = immediatePreviousScene(scenes, scene.idx);
      const extraction = frameExtractionOf(previous);
      if (!previous || (previous.status !== 'completed' && !(previous.status === 'skipped' && extraction?.status === 'continued_without'))) throw new Error(`Scene ${scene.idx + 1} is waiting for Scene ${scene.idx} to finish and validate its last frame.`);
      if (isHttpUrl(previous.keyframe_url)) {
        const check = await validateFrameUrl(String(previous.keyframe_url), aspect);
        if (!check.ok) {
          const previousSpec = (previous.spec || {}) as VideoClipSpec;
          await patchScene(previous, hooks, {
            status: 'needs_action', keyframe_url: null,
            error: `The saved continuity frame is no longer valid: ${check.reason || 'validation failed'}`,
            spec: { ...previousSpec, background: { ...(previousSpec.background || {}), frame_extraction: { status: 'failed', error: check.reason || 'The saved frame failed validation.' } } },
          });
          throw new Error(`Scene ${scene.idx + 1} was not submitted. Retry frame extraction on Scene ${scene.idx}, or explicitly continue without continuity.`);
        }
        requestAssets = [{
          role: 'first_frame', url: String(previous.keyframe_url), type: 'continuity-frame', label: `Scene ${previous.idx + 1} last frame`,
          sourceSceneId: previous.id, sourceSceneIndex: previous.idx, method: extraction?.method, atSecond: extraction?.at_second,
          priority: 600, critical: true,
        }, ...requestAssets];
      } else if (extraction?.status !== 'continued_without') {
        throw new Error(`Scene ${scene.idx + 1} was not submitted. It is waiting for Scene ${scene.idx}'s validated last frame.`);
      }
      await patchScene(scene, hooks, { reference_assets: requestAssets, continuation: requestAssets[0]?.type === 'continuity-frame', reference_type: requestAssets[0]?.type === 'continuity-frame' ? 'previous_final_frame' : 'none' });
    }
    const hasSeedFrame = requestAssets.some((asset) => asset?.role === 'first_frame');
    const modelMin = Math.max(1, Number(chosenModel.minDuration) || 1);
    const modelMax = Math.max(modelMin, Number(chosenModel.safeMaxDuration) || modelMin);
    const discreteOk = !chosenModel.discreteDurations || chosenModel.supportedDurations.includes(Math.round(durationS));
    if (durationS < modelMin || durationS > modelMax || !discreteOk) {
      const legal = chosenModel.discreteDurations
        ? chosenModel.supportedDurations.join('s or ') + 's'
        : `${modelMin}–${modelMax}s`;
      throw new Error(`Scene ${scene.idx + 1} cannot be submitted: ${chosenModel.label} accepts ${legal}; this block is ${Math.round(durationS)}s.`);
    }

    // 400 LADDER (see ./resilience): original prompt → rephrased prompt →
    // rephrased prompt on the next provider. The aspect, duration, references,
    // negative prompt and creditKey are IDENTICAL on every attempt, so the
    // shot never changes and the scene is never billed twice.
    const attempts: { prompt: string; model: VideoModelConfig }[] = [{ prompt: preparedPrompt, model: chosenModel }];
    let job: Awaited<ReturnType<typeof VideoModelService.createVideo>> | null = null;
    /** The config the job actually went out on — the provider fallback may
     * have moved it — so the poll loop uses THAT model's interval and
     * timeout rather than Omni Flash's. */
    let jobModel: VideoModelConfig = chosenModel;
    let submitError: any = null;
    let rephrased = '';
    for (let step = 0; step < attempts.length && !job; step += 1) {
      const attempt = attempts[step];
      try {
        job = await VideoModelService.createVideo({
          prompt: attempt.prompt,
          negative: spec.negative,
          aspect,
          durationS,
          referenceAssets: requestAssets,
          model: attempt.model,
          creditKey,
          generateAudio: film.plan?.audio_enabled !== false,
          onRequestBuilt: async (evidence) => {
            const normalizedEvidence = scene.idx > 0 && evidence.frame_chain.status === 'first_scene'
              ? { ...evidence, frame_chain: { source_scene_id: immediatePreviousScene(scenes, scene.idx)?.id, source_scene_index: scene.idx - 1, status: 'continued_without' as const } }
              : evidence;
            const currentSpec = (scene.spec || spec) as VideoClipSpec;
            await patchScene(scene, hooks, {
              spec: {
                ...currentSpec,
                request_evidence: normalizedEvidence,
                excluded_optional_references: normalizedEvidence.dropped.map((asset) => ({ asset_id: asset.assetId, url: asset.url, type: asset.type, label: asset.label, reason: asset.dropReason })),
              },
            });
          },
        });
        jobModel = attempt.model;
        if (job.warning) say(hooks, `Scene ${scene.idx + 1}: ${job.warning}`);
        // The board shows the prompt that actually rendered.
        if (step > 0 && attempt.prompt !== preparedPrompt) await patchScene(scene, hooks, { prompt: attempt.prompt });
      } catch (e: any) {
        submitError = e;
        if (!isBadRequest(e)) throw e;
        if (step === 0) {
          say(hooks, `Scene ${scene.idx + 1}: the provider refused this request — retrying with a rephrased prompt…`);
          rephrased = await rephraseVideoPrompt(preparedPrompt, String(e?.message || e));
          if (rephrased && rephrased !== preparedPrompt) attempts.push({ prompt: rephrased, model: attempt.model });
        } else if (step === 1) {
          const next = fallbackChain(attempt.model, { hasSeedFrame, durationS })[0];
          if (next) {
            say(hooks, `Scene ${scene.idx + 1}: switching provider to ${next.label}…`);
            attempts.push({ prompt: attempt.prompt, model: next });
          }
        }
      }
    }
    if (!job) throw submitError || new Error(`Scene ${scene.idx + 1} could not be submitted to any video provider.`);
    // The job id is capped before it is written: some providers (Seedance
    // 2.0, a few Runway/OpenRouter models) answer with ids long enough that
    // the data API refused the value ("value too long") and failed the whole
    // scene write — losing the id of a render already paid for.
    await patchScene(scene, hooks, {
      veo_operation_id: job.jobId.slice(0, MAX_OPERATION_ID_CHARS),
      spec: {
        ...spec,
        excluded_optional_references: job.requestEvidence.dropped.map((asset) => ({ asset_id: asset.assetId, url: asset.url, type: asset.type, label: asset.label, reason: asset.dropReason })),
        request_evidence: scene.idx > 0 && job.requestEvidence.frame_chain.status === 'first_scene'
          ? { ...job.requestEvidence, frame_chain: { source_scene_id: immediatePreviousScene(scenes, scene.idx)?.id, source_scene_index: scene.idx - 1, status: 'continued_without' as const } }
          : job.requestEvidence,
        background: { ...(spec.background || {}), status: 'processing', provider_status: 'processing', provider_job_id: job.jobId.slice(0, MAX_OPERATION_ID_CHARS) },
      },
    });
    const videoUrl = await VideoModelService.getVideoResult(job.jobId, {
      onProgress: (p) => say(hooks, `Scene ${scene.idx + 1}: rendering… ${Math.round(p)}%`),
      creditKey,
      model: jobModel,
    });
    await setState(film, hooks, 'VIDEO_COMPLETED', `Scene ${scene.idx + 1}: clip landed.`);
    await patchScene(scene, hooks, { asset_url: videoUrl, veo_operation_id: null });
    await finalizeScene(film, scenes, scene, hooks, videoUrl, { prepareNext: opts.prepareNext });
  } catch (e: any) {
    const failedSpec = (scene.spec || {}) as VideoClipSpec;
    const message = String(e?.message || e);
    const continuityBlocked = /was not submitted|is waiting for Scene .*last frame|waiting for Scene .*finish and validate/i.test(message);
    await patchScene(scene, hooks, {
      status: continuityBlocked ? 'ready' : 'failed', error: message, veo_operation_id: null,
      spec: { ...failedSpec, background: { ...(failedSpec.background || {}), status: continuityBlocked ? 'needs_action' : 'failed', provider_status: continuityBlocked ? 'waiting_for_frame' : 'failed', retries: Number(failedSpec.background?.retries || 0) } },
    });
    await setState(film, hooks, continuityBlocked ? 'FRAME_READY' : 'PROMPT_READY', continuityBlocked
      ? `Scene ${scene.idx + 1} was not submitted. Resolve the prior scene's continuity frame first.`
      : `Scene ${scene.idx + 1} failed — completed scenes are untouched. Retry, regenerate the prompt, or skip it.`);
    throw e;
  }
}

/** Real duration → FFmpeg final frame → continuity attributes → director check
 * → scene completed → next scene's reference decided and prompt prepared.
 *
 * Every step is bounded. By the time this runs the clip has rendered and is
 * stored. If every extractor fails, the clip is preserved in needs_action and
 * no dependent scene is submitted until Retry frame or an explicit override. */
async function finalizeScene(
  film: Film,
  scenes: FilmScene[],
  scene: FilmScene,
  hooks: RunHooks,
  videoUrl: string,
  opts: { frameTimeoutMs?: number; prepareNext?: boolean } = {},
): Promise<void> {
  const aspect = (film.aspect_ratio || '16:9') as Aspect;
  const frameBudget = opts.frameTimeoutMs ?? FRAME_EXTRACTION_TIMEOUT_MS;
  await setState(film, hooks, 'EXTRACTING_FINAL_FRAME', `Scene ${scene.idx + 1}: reading the real clip duration and extracting the final frame…`);

  let realDuration = 0;
  try { realDuration = await withTimeout(probeVideoDuration(videoUrl), PROBE_TIMEOUT_MS, 'Reading the clip duration'); } catch { realDuration = 0; }
  const extractingSpec = (scene.spec || {}) as VideoClipSpec;
  await patchScene(scene, hooks, {
    spec: { ...extractingSpec, background: { ...(extractingSpec.background || {}), frame_extraction: { status: 'extracting' } } },
  });
  let finalFrameUrl: string | null = null;
  let extractedFrame: Awaited<ReturnType<typeof extractFinalFrame>> | null = null;
  let frameError = '';
  const progressLabel: Record<string, string> = {
    'loading-ffmpeg': 'loading FFmpeg.wasm',
    'decoding-video': 'decoding the clip near its real end',
    'validating-frame': 'validating decode, aspect ratio and pixels',
    'uploading-frame': 'uploading the durable PNG',
    'canvas-fallback': 'trying the browser canvas fallback',
  };
  try {
    extractedFrame = await withTimeout(extractFinalFrame(videoUrl, aspect, (stage) => {
      const progressNote = `Scene ${scene.idx + 1}: ${progressLabel[stage] || stage}…`;
      say(hooks, progressNote);
      try { hooks.onFilm?.({ stage_note: progressNote }); } catch { /* live progress only */ }
    }), frameBudget, 'Final frame extraction');
    finalFrameUrl = extractedFrame.url;
  } catch (e: any) {
    frameError = String(e?.message || e).slice(0, 500);
  }
  let firstFrameUrl: string | null = null;
  try { firstFrameUrl = await withTimeout(canvasExtractFrame(videoUrl, 0.15), PROBE_TIMEOUT_MS, 'Thumbnail capture'); } catch { /* thumbnail only */ }

  if (!finalFrameUrl || !extractedFrame) {
    const failedSpec = (scene.spec || {}) as VideoClipSpec;
    await patchScene(scene, hooks, {
      status: 'needs_action',
      error: `Continuity frame extraction failed: ${frameError || 'no validated frame was produced'}`,
      asset_url: videoUrl,
      first_frame_url: firstFrameUrl,
      keyframe_url: null,
      validation: { pass: false, issues: frameError || 'No validated continuity frame was produced.', method: 'frame_extraction' },
      spec: { ...failedSpec, background: { ...(failedSpec.background || {}), frame_extraction: { status: 'failed', error: frameError || 'No validated continuity frame was produced.' } } },
    });
    await setState(film, hooks, 'FRAME_READY', `Scene ${scene.idx + 1}'s clip is safe, but its final frame could not be validated. Retry frame extraction, or explicitly continue without continuity.`);
    return;
  }

  await setState(film, hooks, 'FRAME_READY', `Scene ${scene.idx + 1}: final frame captured, validated and uploaded.`);

  // Manual mode skips creative end-state rewriting, but it still runs the
  // required post-clip visibility check before a frame can pass forward.
  const manual = isManualFilm(film);
  let attrs: any = null;
  if (finalFrameUrl && !manual) {
    say(hooks, `Scene ${scene.idx + 1}: reading the end state for continuity…`);
    try { attrs = await withTimeout(extractVisualAttributes(finalFrameUrl), DIRECTOR_TIMEOUT_MS, 'Reading the end state'); } catch { attrs = null; }
  }
  const frames = [firstFrameUrl, finalFrameUrl].filter(Boolean) as string[];
  const expectedIds = Array.isArray(((scene.spec || {}) as VideoClipSpec).characters) ? (((scene.spec || {}) as VideoClipSpec).characters || []).map(String) : [];
  const expectedCharacters = (Array.isArray(film.character_refs) ? film.character_refs : [])
    .filter((character) => expectedIds.includes(String(character.id)))
    .map((character) => ({ id: String(character.id), name: character.name, appearance: character.appearance, wardrobe: character.wardrobe }));
  let verdict: { pass: boolean; issues: string; method: string } = {
    pass: false,
    issues: 'No decoded frame was available for the required post-clip character visibility check.',
    method: 'vision_unavailable',
  };
  if (frames.length) {
    try { verdict = await withTimeout(validateScene(scene, frames, expectedCharacters, sceneTextItems(film, scene)), DIRECTOR_TIMEOUT_MS, 'The post-clip character visibility check'); }
    catch { verdict = { pass: false, issues: 'The post-clip character visibility check could not complete, so this frame cannot be passed forward.', method: 'vision_unavailable' }; }
  }

  const completedSpec = (scene.spec || {}) as VideoClipSpec;
  const repairReason = !videoUrl
    ? 'the rendered clip URL is missing'
    : verdict.pass === false
      ? String(verdict.issues || 'the automatic scene check failed')
      : '';
  if (repairReason) {
    const repairAttempts = Number(completedSpec.background?.repair_attempts || 0);
    const creditCost = Number(completedSpec.background?.credits_estimated || scene.duration_s || 0);
    if (repairAttempts < 1) {
      const repairSpec: VideoClipSpec = {
        ...completedSpec,
        background: { ...(completedSpec.background || {}), repair_attempts: repairAttempts + 1, status: 'retrying', provider_status: 'repairing' },
      };
      await patchScene(scene, hooks, { status: 'ready', validation: verdict, error: `Automatic check: ${repairReason}.`, spec: repairSpec });
      say(hooks, `Scene ${scene.idx + 1} did not pass its automatic check (${repairReason}) — repairing it once${creditCost > 0 ? ` (up to ${creditCost} video credits)` : ''}.`);
      try {
        await regenerateScenePrompt(film, scenes, scene, hooks, `Automatic check failed: ${repairReason}. Correct this exact defect; preserve the approved story, cast, timing and style.`);
        const preparedRepairSpec = (scene.spec || {}) as VideoClipSpec;
        await patchScene(scene, hooks, {
          spec: { ...preparedRepairSpec, background: { ...(preparedRepairSpec.background || {}), repair_attempts: repairAttempts + 1 } },
        });
        await generateScene(film, scenes, scene, hooks, { prepareNext: opts.prepareNext });
      } catch (repairError: any) {
        await patchScene(scene, hooks, { status: 'failed', error: `Automatic repair did not pass: ${String(repairError?.message || repairError).slice(0, 180)}` });
      }
      return;
    }
    await patchScene(scene, hooks, {
      status: 'failed', validation: verdict,
      error: `Automatic repair was already used; this scene still needs attention: ${repairReason}.`,
      spec: { ...completedSpec, background: { ...(completedSpec.background || {}), status: 'needs_action', provider_status: 'failed' } },
    });
    await setState(film, hooks, 'PROMPT_READY', `Scene ${scene.idx + 1} still needs attention after one automatic repair. Retry it once from the scene card.`);
    return;
  }
  await patchScene(scene, hooks, {
    status: 'completed',
    error: null,
    first_frame_url: firstFrameUrl,
    keyframe_url: finalFrameUrl,
    visual_attributes: attrs,
    validation: verdict,
    duration_s: realDuration || scene.duration_s,
    spec: { ...completedSpec, background: { ...(completedSpec.background || {}), status: 'succeeded', provider_status: 'completed', actual_duration_s: realDuration || Number(scene.duration_s) || undefined, credits_actual: Number(completedSpec.background?.credits_estimated || scene.duration_s || 0), frame_extraction: { status: 'ready', method: extractedFrame.method, at_second: extractedFrame.atSecond, url: extractedFrame.url } } },
  });
  if (film.plan?.orchestration) {
    const flow = film.plan.orchestration;
    const actualCredits = Number(completedSpec.background?.credits_estimated || scene.duration_s || 0);
    const handoff = finalFrameUrl ? { from_clip_id: scene.scene_key, frame_url: finalFrameUrl, attributes: attrs || {}, created_at: new Date().toISOString() } : null;
    const plan = {
      ...film.plan,
      continuity_manifest: film.plan.continuity_manifest ? { ...film.plan.continuity_manifest, handoffs: handoff ? [...film.plan.continuity_manifest.handoffs, handoff] : film.plan.continuity_manifest.handoffs } : film.plan.continuity_manifest,
      orchestration: { ...flow, state: 'generating' as const, checkpoint: `clip_${scene.idx + 1}_completed`, completed_count: Math.min(flow.total_count, Number(flow.completed_count || 0) + 1), credits_actual: Number(flow.credits_actual || 0) + actualCredits, billed_so_far: Number(flow.billed_so_far || 0) + actualCredits, updated_at: new Date().toISOString() },
    };
    await patchFilm(film, hooks, { plan });
  }
  if (finalFrameUrl) {
    await db.addAsset({ film_id: film.id, kind: 'keyframe', name: `Scene ${scene.idx + 1} final frame`, description: `Continuity reference — ${String(scene.script_segment).slice(0, 120)}`, url: finalFrameUrl });
  }

  // STYLE LOCK — scene 1 is the clip that decides what this film looks like.
  // Its fingerprint is read ONCE, the moment that clip is in the can, and
  // every later prompt then carries it. A failure here is cosmetic: the film
  // simply continues without a lock.
  if (scene.idx === 0 && film.style_lock === true && !film.style_lock_description && scene.prompt) {
    try {
      say(hooks, 'Style lock: reading scene 1’s look so every later clip matches it…');
      const fingerprint = await withTimeout(
        extractStyleFingerprint({ film, prompt: String(scene.prompt) }),
        DIRECTOR_TIMEOUT_MS,
        'Reading the film’s visual style',
      );
      if (fingerprint) await patchFilm(film, hooks, { style_lock_description: fingerprint });
    } catch (e: any) {
      say(hooks, `The style lock could not be read (${String(e?.message || e).slice(0, 120)}) — the film continues without it.`);
    }
  }

  // Decide the NEXT scene's reference and prepare its prompt — preparation
  // only. Generation always waits for an explicit trigger. A preparation
  // failure never touches THIS scene: its clip just landed and stays completed.
  const next = orderedScenes(scenes).find((s) => s.idx > scene.idx && !DONE.has(String(s.status)) && s.status !== 'generating');
  if (next && opts.prepareNext !== false) {
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

/** [Retry] — rerun generation with the SAME prompt and references.
 *
 * BUG FIX (Sep 27 2026): the old version flipped the scene to 'ready' and
 * cleared its error BEFORE generateScene's pre-flight guards ran. When a
 * guard threw ("Another scene is already generating"), the scene was left
 * stranded at 'ready' with its failure context wiped — the Retry / New
 * prompt / Skip recovery row disappeared even though nothing had been
 * retried. The guard is now checked first, and a throw that happens before
 * the render actually starts restores the failed state with its error. */
export async function retryScene(film: Film, scenes: FilmScene[], scene: FilmScene, hooks: RunHooks): Promise<void> {
  if (!scene.prompt) { await prepareScene(film, scenes, scene, hooks); return; }
  if (scenes.some((s) => s.id !== scene.id && s.status === 'generating')) {
    throw new Error('Another scene is already generating — clips render one at a time. Wait for it to finish, then retry.');
  }
  const previousError = scene.error;
  await patchScene(scene, hooks, { status: 'ready', error: null });
  try {
    await generateScene(film, scenes, scene, hooks);
  } catch (e: any) {
    // generateScene marks a scene 'failed' itself when the render fails; only
    // a pre-flight throw leaves it at 'ready' — restore the failed state so
    // the recovery actions stay on screen with an honest reason.
    if (scene.status === 'ready') {
      await patchScene(scene, hooks, { status: 'failed', error: String(e?.message || e) || previousError });
    }
    throw e;
  }
}

/** [Regenerate Prompt] — Opus re-analyzes the scene (with the failure or a
 * user instruction as context) and writes an improved prompt. */
export async function regenerateScenePrompt(film: Film, scenes: FilmScene[], scene: FilmScene, hooks: RunHooks, instruction?: string): Promise<void> {
  const note = [instruction, scene.error ? `Previous failure: ${scene.error}` : ''].filter(Boolean).join(' · ') || 'Improve the prompt — the previous attempt was unsatisfying.';
  await prepareScene(film, scenes, scene, hooks, { revisionNote: note });
}

/** Retry only the extraction/validation/upload stage from the already-paid
 * clip. No provider generation is submitted and no video credit is spent. */
export async function retryFinalFrame(
  film: Film,
  scenes: FilmScene[],
  scene: FilmScene,
  hooks: RunHooks,
): Promise<void> {
  if (!isHttpUrl(scene.asset_url)) throw new Error('This scene has no durable clip to extract a frame from. Retry the video instead.');
  await finalizeScene(film, scenes, scene, hooks, String(scene.asset_url), { frameTimeoutMs: FRAME_EXTRACTION_TIMEOUT_MS });
}

/** The sole escape hatch for a failed chain. The choice is persisted on the
 * source scene before the following scene can be prepared or submitted. */
export async function continueWithoutContinuityFrame(
  film: Film,
  scenes: FilmScene[],
  scene: FilmScene,
  hooks: RunHooks,
): Promise<void> {
  if (!isHttpUrl(scene.asset_url)) throw new Error('There is no completed clip to keep. Retry the video instead.');
  const spec = (scene.spec || {}) as VideoClipSpec;
  const choiceAt = new Date().toISOString();
  await patchScene(scene, hooks, {
    status: 'completed', error: null, keyframe_url: null,
    validation: { ...(scene.validation || {}), pass: true, issues: 'Creator explicitly continued without a continuity frame after extraction failed.', method: 'explicit_continue_without_continuity' },
    spec: { ...spec, background: { ...(spec.background || {}), frame_extraction: { status: 'continued_without', error: spec.background?.frame_extraction?.error, choice_recorded_at: choiceAt } } },
  });
  const next = orderedScenes(scenes).find((candidate) => candidate.idx === scene.idx + 1) || null;
  if (next && !DONE.has(String(next.status))) {
    if (film.plan?.background?.enabled) {
      await patchFilm(film, hooks, { stage_note: 'Continue-without-continuity recorded. The durable worker will prepare the next block without a frame.' });
      return;
    }
    await prepareScene(film, scenes, next, hooks, { forceIndependent: true });
  } else if (allScenesDone(scenes)) {
    await setState(film, hooks, 'ALL_SCENES_COMPLETED', 'All video scenes are complete — prepare the audio and run Final Assembly.');
  }
}

/** RECOVERY — the film is stranded at EXTRACTING_FINAL_FRAME: the browser that
 * was extracting the frame went away, or the decode wedged. The clip itself
 * already rendered and is stored, so recovery NEVER re-renders (and never
 * re-bills). A second extraction failure becomes an explicit user decision. */
export async function recoverStalledFrameExtraction(film: Film, scenes: FilmScene[], hooks: RunHooks): Promise<void> {
  const stalled = stalledFrameScene(scenes);
  if (!stalled) {
    // Nothing to salvage — re-arm the pipeline head instead of sitting stuck.
    await resumeFilm(film, scenes, hooks);
    return;
  }
  say(hooks, `Scene ${stalled.idx + 1}: the final-frame extraction stalled — picking it up again from the clip that already rendered.`);
  try {
    await finalizeScene(film, scenes, stalled, hooks, String(stalled.asset_url), { frameTimeoutMs: RECOVERY_FRAME_TIMEOUT_MS });
    return;
  } catch (e: any) {
    say(hooks, `Scene ${stalled.idx + 1}: the retry could not finish (${String(e?.message || e).slice(0, 120)}) — keeping the clip and moving on without a keyframe.`);
  }
  const spec = (stalled.spec || {}) as VideoClipSpec;
  const reason = 'The final frame could not be extracted after the automatic retry.';
  await patchScene(stalled, hooks, {
    status: 'needs_action',
    error: reason,
    keyframe_url: null,
    validation: { pass: false, issues: reason, method: 'frame_extraction' },
    spec: { ...spec, background: { ...(spec.background || {}), frame_extraction: { status: 'failed', error: reason } } },
  });
  await setState(film, hooks, 'FRAME_READY', `Scene ${stalled.idx + 1}'s clip is safe. Retry frame extraction or explicitly continue without continuity; no later scene was submitted.`);
}

/** [Skip Scene] — exclude this scene and move on; nothing else changes. */
export async function skipScene(film: Film, scenes: FilmScene[], scene: FilmScene, hooks: RunHooks): Promise<void> {
  const spec = (scene.spec || {}) as VideoClipSpec;
  await patchScene(scene, hooks, {
    status: 'skipped', error: null,
    spec: { ...spec, background: { ...(spec.background || {}), frame_extraction: { status: 'continued_without', error: 'Scene skipped by creator.', choice_recorded_at: new Date().toISOString() } } },
  });
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
  // Continuity is mandatory: scene N+1 cannot be prepared or submitted until
  // scene N has completed and its final frame has been validated. A provider
  // failure therefore pauses this signed-in loop at that scene. Retrying it
  // re-enters here, and finalizeScene prepares the dependent scene from the
  // newly validated frame before the loop continues automatically.
  for (;;) {
    if (!shouldContinue()) { say(hooks, 'Auto-generate paused.'); return; }
    const next = orderedScenes(scenes).find((s) => !DONE.has(String(s.status))) || null;
    if (!next) {
      if (allScenesDone(scenes)) await setState(film, hooks, 'ALL_SCENES_COMPLETED', 'All video scenes are complete — prepare the audio and run Final Assembly.');
      return;
    }
    if (next.status === 'failed' || next.status === 'needs_action') {
      say(hooks, `Scene ${next.idx + 1} needs action. Later scenes are still waiting for its validated last frame; Retry, repair the frame, or skip this scene to continue.`);
      return;
    }
    if (next.status === 'generating') return; // already in flight elsewhere
    if (next.status === 'waiting') {
      try {
        await prepareScene(film, scenes, next, hooks);
      } catch {
        say(hooks, `Scene ${next.idx + 1} could not be prepared. Later scenes remain queued until this scene is resolved.`);
        return;
      }
    }
    if (!shouldContinue()) { say(hooks, 'Auto-generate paused.'); return; }
    if (next.status === 'ready') {
      try {
        await generateScene(film, scenes, next, hooks);
      } catch {
        say(hooks, `Scene ${next.idx + 1} failed. Later scenes remain queued until you retry, reprompt, or skip it.`);
        return;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// MULTI-GENERATE — every prepared scene at once (deliberately NOT the
// sequential loop above, which stays exactly as it is for normal use)
// ---------------------------------------------------------------------------

/**
 * Fire generation for EVERY scene that already has a prepared prompt.
 *
 * The sequential loop is still how a film is normally made: one clip at a
 * time, each seeded from the last one's final frame. This is for a board full
 * of scenes that are already prepared and independent, where waiting for each
 * render in turn is the only thing left slowing the film down. Each scene
 * keeps its own prompt, references and credit key, so one that fails fails
 * alone, and no scene is billed twice.
 *
 * Nothing is prepared and no post-production is advanced here — the caller
 * decides what happens when the batch lands.
 */
export async function generateAllReadyScenes(
  film: Film,
  scenes: FilmScene[],
  hooks: RunHooks,
): Promise<void> {
  const ready = orderedScenes(scenes).filter((s) => s.status === 'ready' && String(s.prompt || '').trim());
  if (!ready.length) throw new Error('No scene has a prepared prompt waiting — prepare a scene first.');

  await patchFilm(film, hooks, { status: 'producing', error: null });
  await setState(film, hooks, 'GENERATING_VIDEO', `Generating ${ready.length} prepared scene${ready.length === 1 ? '' : 's'} in continuity order…`);
  const failed: FilmScene[] = [];
  let rendered = 0;
  for (const scene of ready) {
    try {
      // Deliberately sequential: if an earlier scene is regenerated, the next
      // scene must wait and consume that NEW validated last frame, never the
      // previous version or a frame that has not landed yet.
      await generateScene(film, scenes, scene, hooks, { prepareNext: false });
      if (scene.status === 'completed') rendered += 1;
      else if (scene.status === 'needs_action') break;
    } catch (error: any) {
      failed.push(scene);
      const reason = String(error?.message || error);
      if (scene.status !== 'failed') await patchScene(scene, hooks, { status: 'failed', error: reason });
      break;
    }
  }

  const attempted = rendered + failed.length;
  await setState(
    film, hooks,
    allScenesDone(scenes) ? 'ALL_SCENES_COMPLETED' : 'PROMPT_READY',
    failed.length
      ? `${rendered} of ${attempted} attempted scenes rendered — scene${failed.length === 1 ? '' : 's'} ${failed.map((s) => s.idx + 1).join(', ')} failed; later scenes were not submitted.`
      : rendered === ready.length
        ? `All ${rendered} prepared scene${rendered === 1 ? '' : 's'} rendered in continuity order.`
        : `${rendered} scene${rendered === 1 ? '' : 's'} rendered; the next scene is waiting for a frame decision.`, 
  );
}

/** [Style Lock] — toggled from the board mid-production. Turning it ON after
 * scene 1 has already landed reads the fingerprint straight away so the very
 * next prompt carries it; turning it OFF keeps the fingerprint on the row (so
 * turning it back on costs nothing) and simply stops injecting it. Prompts
 * already written are not rewritten — regenerate a scene's prompt for that. */
export async function setStyleLock(film: Film, scenes: FilmScene[], hooks: RunHooks, on: boolean): Promise<void> {
  await patchFilm(film, hooks, { style_lock: on });
  if (!on) { say(hooks, 'Style lock off — later clips are prompted on their own look.'); return; }
  const first = orderedScenes(scenes).find((s) => s.idx === 0) || null;
  if (film.style_lock_description) { say(hooks, 'Style lock on — every later clip carries scene 1’s look.'); return; }
  if (!first || first.status !== 'completed' || !first.prompt) {
    say(hooks, 'Style lock on — the look is read from scene 1 as soon as it lands.');
    return;
  }
  try {
    say(hooks, 'Style lock: reading scene 1’s look…');
    const fingerprint = await withTimeout(
      extractStyleFingerprint({ film, prompt: String(first.prompt) }),
      DIRECTOR_TIMEOUT_MS,
      'Reading the film’s visual style',
    );
    if (fingerprint) await patchFilm(film, hooks, { style_lock_description: fingerprint });
  } catch (e: any) {
    say(hooks, `The style lock could not be read (${String(e?.message || e).slice(0, 120)}) — it is read again after the next clip.`);
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
  const textOverlays = (film.plan?.on_screen_text || []).filter((item) => item.text && item.end_s > item.start_s);
  const finishing = textOverlays.length > 0 || (!!finishSettings && (finishSettings.narration || finishSettings.music || finishSettings.captions));
  await patchFilm(film, hooks, {
    status: 'assembling',
    machine_state: 'FFMPEG_ASSEMBLY',
    stage_note: finishing ? 'Preparing the optional finishing layers…' : 'FFmpeg is joining your clips…',
    error: null,
  });
  try {
    const prepared = finishSettings && (finishSettings.narration || finishSettings.music || finishSettings.captions)
      ? await prepareFinish(film, done, finishSettings, (note) => {
          say(hooks, note);
          try { hooks.onFilm?.({ stage_note: note }); } catch { /* UI only */ }
        })
      : null;
    if (prepared) await patchFilm(film, hooks, { finish: prepared.state });

    const audioRequired = film.plan?.audio_enabled !== false;
    const result = await assembleFilm(
      done.map((s) => {
        // AI clips normally keep native sound. A creator-approved character
        // fallback is the one exception: its stored per-scene ElevenLabs take
        // replaces the silent model's dialogue while every other scene stays
        // untouched.
        const dialogueFallback = s.dialogue?.kind === 'character' && s.narration?.audioUrl
          ? String(s.narration.audioUrl)
          : null;
        return {
          sceneKey: s.scene_key,
          url: String(s.asset_url),
          narrationUrl: dialogueFallback || (s.type === 'video_clip' || s.type === 'veo_cinematic' ? null : s.narration_url || null),
          nativeVolume: dialogueFallback ? 0.16 : undefined,
          durationS: Number(s.duration_s) || undefined,
          targetDurationS: dialogueFallback ? sceneTargetDuration(s, { voice_source: 'elevenlabs', duration_s: s.narration?.duration_s }) : undefined,
          strictAudio: dialogueFallback ? true : undefined,
        };
      }),
      (film.aspect_ratio || '16:9') as Aspect,
      (note) => say(hooks, note),
      prepared ? {
        durationS: prepared.durationS,
        narrationUrls: prepared.narrationUrls,
        musicUrl: prepared.musicUrl,
        captionsSrt: prepared.captionsSrt,
        textOverlays,
        requireAudibleAudio: audioRequired,
      } : {
        durationS: done.reduce((sum, scene) => sum + (Number(scene.duration_s) || 0), 0),
        textOverlays,
        requireAudibleAudio: audioRequired,
      },
    );
    let durationS = 0; let thumb = '';
    try { durationS = await probeVideoDuration(result.url); } catch { /* cosmetic */ }
    try { thumb = await canvasExtractFrame(result.url, 0.3); } catch { /* cosmetic */ }
    const textOverlayCheck = await verifyAssembledText(result.url, textOverlays);
    if (!textOverlayCheck.pass) throw new Error(`Final on-screen text validation failed. ${textOverlayCheck.items.filter((item) => !item.pass).map((item) => `“${item.text}”: ${item.issue}`).join(' ')}`);
    const finishedLayers = finishSettings ? [
      finishSettings.narration ? 'narration' : '',
      finishSettings.music ? 'ducked music' : '',
      finishSettings.captions ? 'burned-in captions' : '',
      textOverlays.length ? `${textOverlays.length} verified text overlay${textOverlays.length === 1 ? '' : 's'}` : '',
    ].filter(Boolean).join(', ') : textOverlays.length ? `${textOverlays.length} verified text overlay${textOverlays.length === 1 ? '' : 's'}` : '';
    await patchFilm(film, hooks, {
      status: 'ready',
      machine_state: 'FINAL_VIDEO',
      stage_note: finishing
        ? `Finished with ${finishedLayers}; native clip sound is preserved${typeof result.audioMeanDb === 'number' ? ` and measured ${result.audioMeanDb.toFixed(1)} dB mean` : ''}.`
        : result.via === 'ffmpeg_wasm'
          ? `Assembled in your browser with FFmpeg${typeof result.audioMeanDb === 'number' ? ` · audio verified ${result.audioMeanDb.toFixed(1)} dB mean` : ''}.`
          : 'Assembled with the platform joiner (FFmpeg fallback).',
      final_video_url: result.url,
      final_thumb_url: thumb || null,
      duration_s: durationS || result.durationS || null,
      finish: prepared
        ? { ...prepared.state, text_overlay_check: textOverlayCheck, completed_at: new Date().toISOString() }
        : { ...(film.finish || { settings: { narration: false, music: false, musicPreset: 'cinematic', captions: false }, source_fingerprint: '' }), text_overlay_check: textOverlayCheck, completed_at: new Date().toISOString() },
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

function silentAudioState(scenes: FilmScene[]): FilmAudio {
  return {
    version: 1,
    voice_plan: null,
    narration: orderedScenes(scenes).map((scene) => ({ scene_key: scene.scene_key, text: '', voice_source: 'none', planned_source: 'none', status: 'ready' })),
    music: { required: false, preset: 'silent', status: 'skipped' },
    sfx: [],
    sfx_status: 'skipped',
    voice_source: 'none',
    planned_fingerprint: `silent:${orderedScenes(scenes).map((scene) => `${scene.scene_key}:${scene.duration_s}`).join('|')}`,
    planned_at: new Date().toISOString(),
  };
}

async function ensureSilentAudio(film: Film, scenes: FilmScene[], hooks: RunHooks): Promise<void> {
  if (film.plan?.audio_policy !== 'fully-silent' && film.plan?.audio_enabled !== false) return;
  const audio = silentAudioState(scenes);
  await patchFilm(film, hooks, { audio, machine_state: 'AUDIO_READY', stage_note: 'Fully silent selected — no speech, music or effects were generated.' });
}

export type AssemblyStepKey = 'scenes' | 'narration' | 'music' | 'sfx' | 'mix' | 'render' | 'validate';
export type AssemblyStepStatus = 'pending' | 'active' | 'done' | 'failed';
export interface AssemblyProgress {
  steps: { key: AssemblyStepKey; label: string; status: AssemblyStepStatus }[];
  percent: number;
  running: boolean;
}

const finishStopRequested = new Set<number>();

/** Stop after the active network layer, or immediately while FFmpeg is active.
 * All durable inputs remain saved, so Retry resumes without regenerating clips. */
export function stopFinalAssembly(filmId: number): void {
  finishStopRequested.add(filmId);
  interruptAssembly();
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
  if (!narration || !isSpokenSource(narration.voice_source) || !narration.duration_s) return base;
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
  opts: {
    voiceId?: string;
    voiceName?: string;
    forceReplan?: boolean;
    /** Voice source for this run; omitted = the film's own choice. */
    voiceSource?: VoiceSourceId;
    openaiVoice?: string;
  } = {},
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
  await patchFilm(film, hooks, {
    machine_state: 'AUDIO_READY',
    stage_note: audio.music?.skip_reason === 'providers_unavailable'
      ? 'Music providers are unavailable — continuing without music, and ready for Final Assembly.'
      : 'Narration, music and SFX are ready for Final Assembly.',
    error: null,
  });
}

/** [Retry Voice] / [Retry] per layer — clears only that layer's failures and
 * regenerates what is missing. Video clips are untouched. */
export async function retryAudioLayer(film: Film, scenes: FilmScene[], hooks: RunHooks, layer: 'narration' | 'music' | 'sfx'): Promise<void> {
  if (!film.audio) { await prepareFilmAudioStage(film, scenes, hooks); return; }
  const audio = film.audio;
  if (layer === 'narration') {
    audio.narration.forEach((n) => {
      if (isSpokenSource(n.voice_source) && (n.status === 'failed' || !n.audioUrl)) { n.status = 'pending'; n.error = undefined; }
    });
  } else if (layer === 'music' && audio.music) {
    audio.music.required = true;
    audio.music.status = 'pending';
    audio.music.audioUrl = undefined;
    audio.music.provider = undefined;
    audio.music.skip_reason = undefined;
    audio.music.error = undefined;
  } else if (layer === 'sfx') {
    audio.sfx.forEach((f) => { if (f.status === 'failed') { f.status = 'pending'; f.error = undefined; } });
    audio.sfx_status = audio.sfx.length ? 'pending' : 'none';
  }
  await patchFilm(film, hooks, { audio: { ...audio }, error: null });
  await generateAudioLayers(film, scenes, hooks);
}

/** [Continue Without Voiceover] / [Continue Without Music] / [Continue Without
 * SFX]. Every audio layer is optional: dropping one leaves the clips and the
 * other layers exactly as they are and unlocks Final Assembly. */
export async function skipAudioLayer(film: Film, scenes: FilmScene[], hooks: RunHooks, layer: 'narration' | 'music' | 'sfx'): Promise<void> {
  if (!film.audio) return;
  const audio = layer === 'narration' ? skipNarrationLayer(film.audio)
    : layer === 'music' ? skipMusicLayer(film.audio)
      : skipSfxLayer(film.audio);
  await patchFilm(film, hooks, { audio, error: null });
  if (audioReady(audio)) {
    await patchFilm(film, hooks, {
      machine_state: 'AUDIO_READY',
      stage_note: layer === 'narration' ? 'Continuing without a voiceover — run Final Assembly.'
        : layer === 'music' ? 'Continuing without music — run Final Assembly.'
        : 'Continuing without SFX — run Final Assembly.',
    });
  }
}

/**
 * [Voice Source] — No Voiceover / ElevenLabs / built-in AI voice.
 *
 * The choice only re-shapes the narration layer: music, SFX and every video
 * clip are untouched, and 'No Voiceover' completes the step immediately, so
 * Final Assembly is never held up waiting on a voice provider. Recording the
 * new lines stays an explicit step (the narration card's own button, or Final
 * Assembly), so switching engines never spends the wallet by itself.
 */
export async function changeVoiceSource(
  film: Film,
  scenes: FilmScene[],
  hooks: RunHooks,
  source: VoiceSourceId,
  openaiVoice?: string,
): Promise<void> {
  // Nothing planned yet: the plan is built with this choice when it runs.
  if (!film.audio) return;
  const audio = withVoiceSource(film.audio, source, openaiVoice);
  await patchFilm(film, hooks, { audio, error: null });
  if (!allScenesDone(scenes)) return;
  if (audioReady(audio)) {
    await patchFilm(film, hooks, {
      machine_state: 'AUDIO_READY',
      stage_note: source === 'none'
        ? 'No voiceover — run Final Assembly whenever you are ready.'
        : 'Narration, music and SFX are ready for Final Assembly.',
    });
  } else {
    await patchFilm(film, hooks, {
      machine_state: 'ALL_SCENES_COMPLETED',
      stage_note: source === 'openai'
        ? 'Built-in AI voice selected — generate the narration, or just run Final Assembly.'
        : 'ElevenLabs selected — generate the narration, or just run Final Assembly.',
    });
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
  if (audioPlanCurrent(film, scenes)) return;
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
      await patchFilm(film, hooks, {
        machine_state: 'AUDIO_READY',
        stage_note: audio.music?.skip_reason === 'providers_unavailable'
          ? 'Music providers are unavailable — continuing without music, and ready for Final Assembly.'
          : 'Narration, music and SFX are ready for Final Assembly.',
      });
    } else {
      await patchFilm(film, hooks, {
        machine_state: 'ALL_SCENES_COMPLETED',
        stage_note: layer === 'music' && audio.music?.skip_reason === 'providers_unavailable'
          ? 'Music providers are unavailable — continuing without music.'
          : LAYER_NOTES[layer].done,
      });
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

/** [Regenerate Narration] — re-records EVERY spoken line on the film's current
 * engine and voice. Music, SFX and every video clip are untouched. */
export async function regenerateNarration(film: Film, scenes: FilmScene[], hooks: RunHooks): Promise<void> {
  if (!film.audio) { await prepareFilmAudioStage(film, scenes, hooks); return; }
  const audio = film.audio;
  audio.narration.forEach((n) => {
    if (isSpokenSource(n.voice_source)) { n.status = 'pending'; n.audioUrl = undefined; n.duration_s = undefined; n.error = undefined; }
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
  if (film.plan?.audio_policy === 'fully-silent' || film.plan?.audio_enabled === false) {
    await ensureSilentAudio(film, scenes, hooks);
    return;
  }
  if (audioPlanCurrent(film, scenes) && audioReady(film.audio)) {
    await patchFilm(film, hooks, {
      machine_state: 'AUDIO_READY',
      stage_note: film.audio?.music?.skip_reason === 'providers_unavailable'
        ? 'Music providers are unavailable — continuing without music, and ready for Final Assembly.'
        : 'Narration, music and SFX are ready for Final Assembly.',
    });
    return;
  }
  await prepareFilmAudioStage(film, scenes, hooks);
}

async function verifyAssembledText(videoUrl: string, overlays: OnScreenTextItem[]): Promise<NonNullable<NonNullable<Film['finish']>['text_overlay_check']>> {
  const items: NonNullable<NonNullable<Film['finish']>['text_overlay_check']>['items'] = [];
  for (const overlay of overlays) {
    const at = overlay.start_s + Math.max(0.1, (overlay.end_s - overlay.start_s) / 2);
    let frameUrl = '';
    try {
      frameUrl = await canvasExtractFrame(videoUrl, at);
      const verdict = await askOpusJson<{ pass: boolean; issue?: string }>({
        system: 'You verify one deterministic post-production text overlay in a finished video frame. Reply only with JSON: {"pass":boolean,"issue":string}. PASS only when the exact requested text is visibly present and legible. Ignore all other creative choices.',
        user: `REQUIRED EXACT TEXT: ${JSON.stringify(overlay.text)}\nEXPECTED POSITION: ${overlay.position}\nDoes this assembled-output frame visibly contain that exact text?`,
        images: [frameUrl],
        maxTokens: 512,
        effort: 'low',
      });
      items.push({ id: overlay.id, text: overlay.text, at_s: at, frame_url: frameUrl, pass: verdict.pass === true, issue: verdict.pass === true ? undefined : String(verdict.issue || 'The exact text was not legible in the sampled assembled frame.') });
    } catch (error: any) {
      items.push({ id: overlay.id, text: overlay.text, at_s: at, frame_url: frameUrl || undefined, pass: false, issue: `Final text check unavailable: ${String(error?.message || error).slice(0, 160)}` });
    }
  }
  return { pass: items.every((item) => item.pass), checked_at: new Date().toISOString(), items };
}

/** FINAL ASSEMBLY — one click: existing video scenes + the chosen voiceover
 * (optional) + music + SFX → FFmpeg → audio mix + composition → final render.
 * NEVER regenerates video; missing audio layers are generated first, ready ones
 * are reused, so re-assembly after a voice/music change is fast. A film with no
 * voiceover simply has one less layer to mix. */
export async function runFinalAssembly(
  film: Film,
  scenes: FilmScene[],
  hooks: RunHooks,
  opts: { captions?: boolean } = {},
): Promise<void> {
  const done = orderedScenes(scenes).filter((s) => s.status === 'completed' && s.asset_url);
  if (!done.length) throw new Error('No completed scenes to assemble yet.');
  finishStopRequested.delete(film.id);

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

    if (film.plan?.audio_policy === 'fully-silent' || film.plan?.audio_enabled === false) {
      report('narration', 'active', 8);
      await ensureSilentAudio(film, scenes, hooks);
    } else if (!audioPlanCurrent(film, scenes) || !audioReady(film.audio)) {
      report('narration', 'active', 8);
      await prepareFilmAudioStage(film, scenes, hooks);
    }
    const audio = film.audio!;
    if (finishStopRequested.has(film.id)) throw new Error('finish_paused');
    report('narration', narrationReady(audio) ? 'done' : 'failed', 18);
    report('music', musicReady(audio) ? 'done' : 'failed', 24);
    report('sfx', sfxReady(audio) ? 'done' : 'failed', 28);

    await patchFilm(film, hooks, { status: 'assembling', machine_state: 'FFMPEG_ASSEMBLY', stage_note: 'Final Assembly: mixing audio and cutting the film…', error: null });
    report('mix', 'active', 30);

    const narrationByKey = new Map(audio.narration.map((n) => [n.scene_key, n]));
    const inputs = done.map((s) => {
      const entry = narrationByKey.get(s.scene_key) || null;
      const narrated = !!entry && isSpokenSource(entry.voice_source) && entry.status === 'ready' && !!entry.audioUrl;
      const dialogueFallback = s.dialogue?.kind === 'character' && s.narration?.audioUrl ? s.narration : null;
      const spokenUrl = dialogueFallback?.audioUrl || (narrated ? String(entry!.audioUrl) : null);
      const timingEntry = dialogueFallback
        ? { voice_source: 'elevenlabs', duration_s: dialogueFallback.duration_s }
        : entry;
      const sfx = audio.sfx
        .filter((f) => f.scene_key === s.scene_key && f.status === 'ready' && f.audioUrl && audio.sfx_status === 'ready')
        .map((f) => ({ url: String(f.audioUrl), atS: Number(f.at_s) || 0, volume: Number(f.volume) || 0.25, durationS: Number(f.duration_s) || undefined }));
      return {
        sceneKey: s.scene_key,
        url: String(s.asset_url),
        narrationUrl: spokenUrl,
        // ONE authoritative voice per scene: narrated scenes keep native sound
        // as low ambience; dialogue/no-word scenes keep their native audio.
        nativeVolume: film.plan?.audio_enabled === false ? 0 : spokenUrl ? 0.16 : 1,
        durationS: Number(s.duration_s) || undefined,
        targetDurationS: sceneTargetDuration(s, timingEntry),
        sfx,
        strictAudio: true,
      };
    });
    const totalTarget = inputs.reduce((n, c) => n + (c.targetDurationS || c.durationS || 6), 0);
    const captionsSrt = opts.captions ? buildCaptions(done).srt : undefined;
    const textOverlays = (film.plan?.on_screen_text || []).filter((item) => item.text && item.end_s > item.start_s);
    const musicUrl = audio.music && audio.music.status === 'ready' && audio.music.audioUrl ? audio.music.audioUrl : undefined;

    let rendering = false;
    const assembleOnce = () => assembleFilm(
      inputs,
      (film.aspect_ratio || '16:9') as Aspect,
      (note, fraction) => {
        say(hooks, note);
        const pct = 30 + Math.round(Math.max(0, Math.min(1, fraction)) * 60);
        if (fraction >= 0.89 && !rendering) { report('mix', 'done'); rendering = true; }
        report(rendering ? 'render' : 'mix', 'active', pct);
      },
      { durationS: totalTarget, musicUrl, musicVolume: audio.music?.volume, captionsSrt, textOverlays, requireAudibleAudio: film.plan?.audio_enabled !== false },
    );
    let result;
    try {
      result = await assembleOnce();
    } catch (firstAssemblyError: any) {
      if (finishStopRequested.has(film.id)) throw new Error('finish_paused');
      say(hooks, `Final Assembly hit a problem — retrying once (${String(firstAssemblyError?.message || firstAssemblyError).slice(0, 120)}).`);
      result = await assembleOnce();
    }
    report('mix', 'done');
    report('render', 'done', 92);
    report('validate', 'active', 94);
    if (!result.url) throw new Error('Final Assembly produced no video file.');
    let durationS = 0; let thumb = '';
    try { durationS = await probeVideoDuration(result.url); } catch { /* cosmetic */ }
    try { thumb = await canvasExtractFrame(result.url, 0.3); } catch { /* cosmetic */ }
    const textOverlayCheck = await verifyAssembledText(result.url, textOverlays);
    if (!textOverlayCheck.pass) {
      const failed = textOverlayCheck.items.filter((item) => !item.pass).map((item) => `“${item.text}”: ${item.issue}`).join(' ');
      throw new Error(`Final on-screen text validation failed. ${failed}`);
    }
    progress.running = false;
    report('validate', 'done', 100);

    const usedBuiltInVoice = audio.voice_used === 'openai' || audio.narration.some((entry) => entry.voice_source === 'openai' && entry.status === 'ready');
    const narrationLabel = usedBuiltInVoice
      ? `built-in AI narration (${audio.openai_voice || 'alloy'}${audio.voice_fallback_reason ? ', ElevenLabs unavailable after one retry' : ''})`
      : `ElevenLabs narration (${audio.voice_plan?.voiceName || 'one voice'})`;
    const layerSummary = [
      typeof result.audioMeanDb === 'number' ? `audio verified ${result.audioMeanDb.toFixed(1)} dB mean` : film.plan?.audio_enabled === false ? 'audio off' : '',
      inputs.some((c) => c.narrationUrl) ? narrationLabel : '',
      musicUrl ? `${audio.music?.preset || ''} music, ducked under speech`.trim() : '',
      inputs.some((c) => c.sfx.length) ? 'SFX' : '',
      captionsSrt ? 'captions' : '',
      textOverlays.length ? `${textOverlays.length} on-screen text overlay${textOverlays.length === 1 ? '' : 's'} verified` : '',
    ].filter(Boolean).join(' · ');
    const measuredDuration = durationS || result.durationS || null;
    const exportId = `assembly_${Date.now().toString(36)}`;
    const finalPlan = film.plan ? {
      ...film.plan,
      assembled_media_id: result.url,
      orchestration: film.plan.orchestration ? { ...film.plan.orchestration, state: 'ready' as const, intent: 'export' as const, checkpoint: 'verified_final_media', completed_count: film.plan.orchestration.total_count, updated_at: new Date().toISOString() } : film.plan.orchestration,
      export_records: [...(film.plan.export_records || []), { id: exportId, status: 'complete' as const, url: result.url, created_at: new Date().toISOString(), completed_at: new Date().toISOString(), settings: { captions: Boolean(captionsSrt), audio_policy: film.plan.audio_policy || 'legacy', measured_duration_s: measuredDuration, via: result.via } }],
    } : film.plan;
    await patchFilm(film, hooks, {
      status: 'ready',
      machine_state: 'FINAL_VIDEO',
      stage_note: layerSummary ? `Final video ready — ${layerSummary}.` : 'Final video ready.',
      final_video_url: result.url,
      final_thumb_url: thumb || null,
      duration_s: measuredDuration,
      plan: finalPlan,
      finish: { ...(film.finish || { settings: { narration: false, music: false, musicPreset: 'cinematic', captions: Boolean(captionsSrt) }, source_fingerprint: '' }), text_overlay_check: textOverlayCheck, completed_at: new Date().toISOString() },
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
    const paused = finishStopRequested.has(film.id) || String(e?.message || e) === 'finish_paused';
    const publicError = paused
      ? 'Finishing is paused. Press Retry to continue from the saved scenes and audio.'
      : layer === 'narration'
      ? 'Narration could not be prepared after one retry. The scenes are safe.'
      : layer === 'music'
        ? 'Music could not be prepared after one retry. The scenes are safe.'
        : layer === 'sfx'
          ? 'Sound effects could not be prepared after one retry. The scenes are safe.'
          : 'Final Assembly could not finish after one retry. The scenes and prepared audio are safe.';
    await patchFilm(film, hooks, {
      status: film.final_video_url ? 'ready' : 'producing',
      machine_state: audioReady(film.audio) ? 'AUDIO_READY' : 'ALL_SCENES_COMPLETED',
      stage_note: publicError,
      error: publicError,
    });
    throw new Error(publicError);
  }
}

// ---------------------------------------------------------------------------
// Resume after a reload — adopt in-flight renders; never auto-generate
// ---------------------------------------------------------------------------

export async function resumeFilm(film: Film, scenes: FilmScene[], hooks: RunHooks): Promise<void> {
  for (const scene of orderedScenes(scenes)) {
    if (scene.status !== 'generating') continue;
    if (scene.asset_url) {
      // The clip landed but the browser went away mid-frame-stage. Finish from
      // the stored clip — re-rendering it would pay for the same video twice.
      try {
        await finalizeScene(film, scenes, scene, hooks, String(scene.asset_url), { frameTimeoutMs: RECOVERY_FRAME_TIMEOUT_MS });
      } catch {
        await recoverStalledFrameExtraction(film, scenes, hooks);
      }
    } else if (scene.veo_operation_id) {
      try {
        say(hooks, `Scene ${scene.idx + 1}: picking the render back up…`);
        const videoUrl = await VideoModelService.getVideoResult(scene.veo_operation_id, {
          creditKey: `stv:film:${film.id}:scene:${scene.id}`,
          model: resolveVideoModel(film.video_model),
        });
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
    await setState(film, hooks, 'ALL_SCENES_COMPLETED', 'All video scenes are complete — preparing the audio for Final Assembly.');
  }
}

// ---------------------------------------------------------------------------
// AUTO-ASSEMBLE (bug D1)
//
// Final Assembly used to wait for a button press, and nothing else in this
// pipeline does. A film left to run on its own therefore stopped dead at
// "Narration, music and SFX are ready" — everything paid for, nothing
// delivered — and stayed there until somebody came back and clicked.
//
// So the last step is the same kind of step as the others now: when every
// scene is finished and every audio layer is ready, assembly starts by itself.
// Reviewing the cut before it is assembled stays available as an OPT-IN (the
// review toggle in App.tsx), because some films genuinely want a look first —
// but it is a choice, not the default.
// ---------------------------------------------------------------------------

/**
 * Is this film's next step Final Assembly, with nothing left to wait for?
 *
 * Deliberately conservative: a film already assembling, already finished, or
 * still missing a scene or an audio layer answers false, so a caller polling
 * this on a timer can never start a second assembly or jump the queue.
 */
export function readyToAutoAssemble(film: Film | null | undefined, scenes: FilmScene[]): boolean {
  if (!film) return false;
  if (film.status === 'ready' || film.final_video_url) return false;
  if (film.status === 'assembling' || film.machine_state === 'FFMPEG_ASSEMBLY') return false;
  if (!allScenesDone(scenes)) return false;
  return audioReady(film.audio);
}

// ---------------------------------------------------------------------------
// SCENE WATCHDOG (bug D2)
//
// A scene whose render stopped answering used to sit on "generating the
// clip…" indefinitely: nothing measured how long it had been there, so an
// automated film never finished and the board offered no way out.
//
// The budget is measured from the SCENE ROW's own updated_at, not from when a
// tab happened to open the film, so a render abandoned an hour ago is stalled
// the moment the board loads rather than getting a fresh fifteen minutes.
// ---------------------------------------------------------------------------

/** No progress for this long means the job is gone, not slow. */
export const SCENE_STALL_MS = 15 * 60 * 1000;

/** Milliseconds since this scene row last changed. Falls back to the film's
 * own timestamp for a row written before scenes carried one. */
export function msSinceSceneUpdate(scene: FilmScene, film?: Film | null): number {
  const sceneAt = Date.parse(String(scene.updated_at || ''));
  const filmAt = Date.parse(String(film?.updated_at || ''));
  const at = Number.isFinite(sceneAt) ? sceneAt : filmAt;
  return Number.isFinite(at) ? Math.max(0, Date.now() - at) : 0;
}

/** True for a scene mid-render that has shown no progress for the stall
 * budget. Only 'generating' counts — every other status is either finished or
 * deliberately waiting on a person. */
export function isSceneStalled(scene: FilmScene, sinceMs: number): boolean {
  if (String(scene.status) !== 'generating') return false;
  return sinceMs >= SCENE_STALL_MS;
}

/** The first stalled scene on the board, or null. */
export function stalledScene(film: Film | null | undefined, scenes: FilmScene[]): FilmScene | null {
  for (const scene of orderedScenes(scenes)) {
    if (isSceneStalled(scene, msSinceSceneUpdate(scene, film))) return scene;
  }
  return null;
}

/**
 * Retry ONE stalled scene, exactly once.
 *
 * A second failure is where it stops: the scene is marked `failed` with a
 * sentence a person can act on, which is what puts the board's retry control
 * in front of them. Leaving a card spinning is the single outcome this
 * function exists to prevent, so even an unexpected error ends in a failed
 * scene rather than a quiet return.
 */
export async function recoverStalledScene(
  film: Film,
  scenes: FilmScene[],
  scene: FilmScene,
  hooks: RunHooks,
): Promise<void> {
  const minutes = Math.round(SCENE_STALL_MS / 60000);
  say(hooks, `Scene ${scene.idx + 1} has shown no progress for ${minutes} minutes — retrying it once.`);
  // The dead job id has to go first, or the retry adopts the render that
  // stopped answering instead of starting a new one.
  await patchScene(scene, hooks, { status: 'ready', error: null, veo_operation_id: null });
  try {
    await retryScene(film, scenes, scene, hooks);
  } catch (e: any) {
    await patchScene(scene, hooks, {
      status: 'failed',
      error: `This scene stopped responding for ${minutes} minutes and the retry did not work either `
        + `(${String(e?.message || e).slice(0, 160)}). Retry it from this step, or skip it — every `
        + 'other scene in the film is untouched.',
    });
    return;
  }
  if (String(scene.status) === 'generating') {
    await patchScene(scene, hooks, {
      status: 'failed',
      error: `This scene stopped responding for ${minutes} minutes and the retry did not finish either. `
        + 'Retry it from this step, or skip it — every other scene in the film is untouched.',
    });
  }
}
