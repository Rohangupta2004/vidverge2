import { WORKSPACE_ID, updateScene, type Project, type Scene } from './supabase';
import { sleep, workspaceToken } from './proxy';
import { generationHeaders, postGeneration } from '../../../lib/videoEngineClient';
import { APP_IDS } from '../../../lib/appIds';

/**
 * OMNI FLASH — DIALOGUE + LIPSYNC (the HeyGen-style middle-scene mode).
 *
 * A scene of this kind is defined by two inputs and nothing else:
 *   * DIALOGUE — the exact words the on-screen character says
 *   * CHARACTER IMAGE (optional) — a face/character reference the generated
 *     presenter must look like, carried into every segment so the same person
 *     appears throughout
 *
 * PRODUCTION. The platform video proxy caps a single Omni Flash clip at 8
 * seconds, so a longer line is spoken in SEGMENTS — split on sentence
 * boundaries, each rendered with the SAME character reference, then joined by
 * the platform FFmpeg joiner into one continuous take. The mode's own ceiling
 * is 60 seconds of dialogue, enforced here and shown live in the editor.
 *
 * REUSE ACROSS SCENES. The identity of an Omni Flash take is exactly its
 * (dialogue + character image). Two scenes in the same project with identical
 * inputs therefore share ONE generated video: the second scene adopts the
 * first one's clip instead of paying to generate it again. The
 * fingerprint is stored in `video_prompt` with an `of:` prefix, so an edited
 * line always re-generates and an unchanged one never does (the same contract
 * the `mg:` motion captures and `ec:` element compositions use).
 */

/** The platform proxy's model id for Omni Flash. */
const OMNI_MODEL = 'gemini-omni-flash-preview';
/** The longest single clip the proxy renders. */
const SEGMENT_MAX_SECONDS = 8;
/** Hard ceiling for the whole mode — enforced in the UI and again here. */
export const OMNI_FLASH_MAX_SECONDS = 60;
/** Natural presenter pace (~150 words per minute) used for the live estimate. */
export const WORDS_PER_SECOND = 2.5;
/** Dialogue longer than this cannot fit the ceiling at a natural pace. */
export const OMNI_FLASH_MAX_WORDS = Math.floor(OMNI_FLASH_MAX_SECONDS * WORDS_PER_SECOND);
/** A generous character budget matching the word ceiling (shown as a counter). */
export const OMNI_FLASH_MAX_CHARS = 900;

const looksLikeVideo = (url?: string | null) => /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(String(url || ''));
const isHttpsUrl = (url?: string | null) => /^https:\/\//i.test(String(url || ''));

export interface OmniFlashInputs {
  /** The exact words the character speaks. */
  dialogue: string;
  /** Optional durable https URL of the face/character reference. */
  characterImageUrl: string;
}

/** Read an Omni Flash scene's inputs, wherever an older row happened to keep them. */
export function omniFlashInputs(scene: Scene): OmniFlashInputs {
  const spec = (scene.spec || {}) as Record<string, unknown>;
  const dialogue = String(spec.dialogue ?? scene.overlay_config?.dialogue ?? '').trim()
    // A scene switched over from another kind starts from its description, so
    // the field is never empty on arrival.
    || String(scene.description || '').trim();
  const image = String(spec.characterImageUrl ?? (spec as any).character_image_url ?? '').trim();
  return { dialogue: dialogue, characterImageUrl: isHttpsUrl(image) ? image : '' };
}

export function wordCount(text: string): number {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

/** Estimated spoken length of a line at a natural presenter pace. */
export function estimateDialogueSeconds(text: string): number {
  const words = wordCount(text);
  if (!words) return 0;
  return Math.round((words / WORDS_PER_SECOND) * 10) / 10;
}

/** True when the line is over the mode's 60-second ceiling. */
export function dialogueOverLimit(text: string): boolean {
  return estimateDialogueSeconds(text) > OMNI_FLASH_MAX_SECONDS;
}

/** A stable identity for one take: same inputs → same fingerprint → same clip. */
export function omniFlashFingerprint(inputs: OmniFlashInputs): string {
  const payload = JSON.stringify({
    d: inputs.dialogue.replace(/\s+/g, ' ').trim().toLowerCase(),
    c: inputs.characterImageUrl,
  });
  let hash = 5381;
  for (let i = 0; i < payload.length; i += 1) hash = ((hash << 5) + hash + payload.charCodeAt(i)) >>> 0;
  return `of:${hash.toString(36)}:${payload.length.toString(36)}`;
}

export function sceneOmniFingerprint(scene: Scene): string {
  return omniFlashFingerprint(omniFlashInputs(scene));
}

/** True when the stored clip was filmed from the scene's CURRENT dialogue and
 * character image. An edit makes it false; editing back makes it true again,
 * so nothing is ever re-billed for text that ended up unchanged. */
export function hasFreshOmniFlashClip(scene: Scene): boolean {
  const stored = String(scene.video_prompt || '');
  if (!looksLikeVideo(scene.render_url) || stored.indexOf('of:') !== 0) return false;
  return stored === sceneOmniFingerprint(scene);
}

/**
 * Split a line into segments the proxy can actually render, cutting on
 * sentence boundaries first and on clause/word boundaries only when a single
 * sentence runs long. Every segment is a complete spoken unit, so the joined
 * take never cuts mid-word.
 */
export function splitDialogue(text: string, maxSeconds = SEGMENT_MAX_SECONDS): string[] {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const maxWords = Math.max(4, Math.floor(maxSeconds * WORDS_PER_SECOND));
  const sentences = clean.match(/[^.!?]+[.!?]*/g) || [clean];
  const segments: string[] = [];
  let current = '';
  const push = () => { if (current.trim()) segments.push(current.trim()); current = ''; };
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    if (wordCount(sentence) > maxWords) {
      push();
      // One long sentence: break it at commas, then at word count.
      const clauses = sentence.split(/,\s*/).filter(Boolean);
      let chunk = '';
      for (const clause of clauses) {
        const candidate = chunk ? `${chunk}, ${clause}` : clause;
        if (wordCount(candidate) > maxWords && chunk) { segments.push(chunk.trim()); chunk = clause; }
        else chunk = candidate;
      }
      while (wordCount(chunk) > maxWords) {
        const words = chunk.split(' ');
        segments.push(words.slice(0, maxWords).join(' '));
        chunk = words.slice(maxWords).join(' ');
      }
      if (chunk.trim()) segments.push(chunk.trim());
      continue;
    }
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (wordCount(candidate) > maxWords) { push(); current = sentence; }
    else current = candidate;
  }
  push();
  return segments;
}

/** The production prompt for one spoken segment. */
function segmentPrompt(line: string, hasReference: boolean, position: { index: number; total: number }): string {
  const continuity = position.index > 0
    ? ' This continues the same unbroken take: identical person, wardrobe, framing, background and lighting as the previous shot.'
    : '';
  const who = hasReference
    ? 'the person in the reference image, filmed as a presenter'
    : 'a single confident presenter';
  return [
    `A medium close-up of ${who}, facing the camera and speaking directly to the lens with natural, accurate lip-sync and relaxed hand gestures.`,
    'Soft key light, clean neutral studio background, shallow depth of field, eyes on the lens.',
    `They say, word for word: "${line}"`,
    'Spoken audio only — no music, no on-screen text, no captions, no subtitles, no watermark.',
    continuity,
  ].join(' ').trim().slice(0, 990);
}

const NEGATIVE = 'on-screen text, captions, subtitles, watermarks, logos, split screen, multiple people, distorted mouth, distorted hands, still photograph, silent footage';

async function submitSegment(project: Project, line: string, characterImageUrl: string, position: { index: number; total: number }): Promise<string> {
  const payload: Record<string, unknown> = {
    model: OMNI_MODEL,
    prompt: segmentPrompt(line, Boolean(characterImageUrl), position),
    aspectRatio: project.aspect_ratio,
    duration: Math.max(4, Math.min(SEGMENT_MAX_SECONDS, Math.ceil(estimateDialogueSeconds(line)) + 1)),
    // Dialogue is the whole point of this mode — the clip must carry its voice.
    generateAudio: true,
    negativePrompt: NEGATIVE,
    safetyFilterLevel: 'block_only_high',
  };
  // Omni Flash is the character-consistency engine: the same reference on
  // every segment is what keeps one presenter across the whole take.
  if (characterImageUrl) payload.referenceImages = [{ imageData: characterImageUrl, referenceType: 'asset' }];

  // Posted through the shared engine client so the segment is recorded
  // against SceneForge like every other clip this app films.
  const { res: response, data } = await postGeneration('/api/veo/generate/video', payload, APP_IDS.sceneForge);
  const start: any = data || {};
  const operationId = String(start.operationId || start.operation_id || '');
  // The proxy answers 200 with a placeholder id when the provider route itself
  // refused the job — polling that id would 404 forever.
  const refused = String(start.status || '').toLowerCase() === 'failed' || /^(veo_video_error_|openrouter_error_)/.test(operationId);
  if (!response.ok || !operationId || refused) {
    throw new Error(String(start.errorMessage || start.error || 'Omni Flash did not accept this dialogue segment.'));
  }

  for (let i = 0; i < 120; i += 1) {
    await sleep(5000);
    // A dropped poll is not a failed render — the next tick asks again.
    const status = await fetch(`/api/veo/status/${encodeURIComponent(operationId)}`, { headers: generationHeaders(APP_IDS.sceneForge) }).then((r) => r.json()).catch(() => null);
    if (!status) continue;
    if (status.status === 'completed' && status.videoUrl) return String(status.videoUrl);
    if (status.status === 'failed' || status.status === 'error') throw new Error(String(status.errorMessage || status.error || 'The dialogue segment failed at the provider.'));
  }
  throw new Error('The dialogue segment took too long. Retry the scene, or shorten the line.');
}

/** Join the spoken segments into one continuous take. */
async function joinSegments(urls: string[]): Promise<string> {
  const response = await fetch(`/api/workspaces/${WORKSPACE_ID}/videos/stitch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': workspaceToken() },
    body: JSON.stringify({ videoUrls: urls }),
  });
  const raw = await response.text();
  let data: any = null;
  try { data = JSON.parse(raw); } catch { /* the serving layer answers HTML on an unknown path */ }
  const url = data && (data.stitchedUrl || data.videoUrl || data.url);
  if (!data || !response.ok || data.success === false || !isHttpsUrl(url)) {
    throw new Error(String((data && (data.error || data.message)) || `the joiner answered HTTP ${response.status}`));
  }
  return String(url);
}

export interface OmniFlashResult {
  videoUrl: string;
  fingerprint: string;
  segments: number;
  /** 'generated' | 'scene_cache' (another scene's identical take) | 'unchanged'. */
  reuse: 'generated' | 'scene_cache' | 'unchanged';
  estimatedSeconds: number;
}

export interface OmniFlashOptions {
  /** Regenerate even when a matching clip already exists. */
  force?: boolean;
  /** Every scene of the project — the reuse pool for identical takes. */
  projectScenes?: Scene[];
  onNote?: (note: string) => void;
}

/**
 * Produce (or reuse) the talking-head take for ONE Omni Flash scene.
 * Generation only ever happens when nothing in the project already holds a
 * clip for these exact inputs.
 */
export async function generateOmniFlashScene(project: Project, scene: Scene, options: OmniFlashOptions = {}): Promise<OmniFlashResult> {
  const say = (note: string) => { try { options.onNote?.(note); } catch { /* UI only */ } };
  const inputs = omniFlashInputs(scene);
  const dialogue = inputs.dialogue.replace(/\s+/g, ' ').trim();
  if (wordCount(dialogue) < 2) throw new Error(`Scene ${scene.scene_index} has no dialogue yet — write what the character says.`);
  const estimatedSeconds = estimateDialogueSeconds(dialogue);
  if (estimatedSeconds > OMNI_FLASH_MAX_SECONDS) {
    throw new Error(`Scene ${scene.scene_index}'s dialogue runs about ${estimatedSeconds}s — Omni Flash scenes are capped at ${OMNI_FLASH_MAX_SECONDS}s. Shorten the line or split it across two scenes.`);
  }
  const fingerprint = omniFlashFingerprint({ dialogue: dialogue, characterImageUrl: inputs.characterImageUrl });

  // 1. This scene already holds the take for these exact inputs.
  if (!options.force && looksLikeVideo(scene.render_url) && String(scene.video_prompt || '') === fingerprint) {
    return { videoUrl: String(scene.render_url), fingerprint: fingerprint, segments: 0, reuse: 'unchanged', estimatedSeconds: estimatedSeconds };
  }

  // 2. VIDEO REUSE ACROSS SCENES — another scene in this project already
  //    generated the identical dialogue with the identical character, so this
  //    scene adopts that clip instead of generating (and billing) it twice.
  const pool = (options.projectScenes || []).filter((row) => row && row.id !== scene.id);
  const twin = pool.find((row) => String(row.video_prompt || '') === fingerprint && looksLikeVideo(row.render_url));
  if (twin) {
    say(`Scene ${scene.scene_index}: identical dialogue to scene ${twin.scene_index} — reusing that take instead of generating it again.`);
    await updateScene(scene.id, { render_url: String(twin.render_url), video_prompt: fingerprint, status: 'ready' }, scene.project_id);
    return { videoUrl: String(twin.render_url), fingerprint: fingerprint, segments: 0, reuse: 'scene_cache', estimatedSeconds: estimatedSeconds };
  }

  // 3. Generate. A line longer than one clip is spoken in segments that carry
  //    the same character reference and are joined into one take.
  const lines = splitDialogue(dialogue);
  if (!lines.length) throw new Error(`Scene ${scene.scene_index} has no dialogue to speak.`);
  const urls: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    say(lines.length > 1
      ? `Scene ${scene.scene_index}: filming the dialogue, part ${i + 1} of ${lines.length}…`
      : `Scene ${scene.scene_index}: filming the talking-head dialogue…`);
    urls.push(await submitSegment(project, lines[i], inputs.characterImageUrl, { index: i, total: lines.length }));
  }

  let videoUrl = urls[0];
  if (urls.length > 1) {
    say(`Scene ${scene.scene_index}: joining ${urls.length} spoken parts into one take…`);
    try {
      videoUrl = await joinSegments(urls);
    } catch (e: any) {
      // Every segment rendered and is paid for — ship the opening take rather
      // than losing the scene, and say plainly what is missing.
      say(`Scene ${scene.scene_index}: the parts could not be joined (${String(e?.message || e).slice(0, 110)}) — keeping the first part.`);
      videoUrl = urls[0];
    }
  }

  await updateScene(scene.id, { render_url: videoUrl, video_prompt: fingerprint, status: 'ready' }, scene.project_id);
  return { videoUrl: videoUrl, fingerprint: fingerprint, segments: urls.length, reuse: 'generated', estimatedSeconds: estimatedSeconds };
}
