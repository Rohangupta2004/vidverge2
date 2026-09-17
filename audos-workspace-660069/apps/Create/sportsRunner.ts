/**
 * apps/Create/sportsRunner.ts — SPORTS & EVENTS mode: module-scope store and
 * run loop. Track A ONLY: every render goes through the existing generate-video
 * / check-video-status hooks on Gemini Omni Flash image-to-video. Track B and
 * the other builders are untouched.
 *
 * THE FLOW (one continuous character across every scene):
 *   1. PARSE      — claude-opus-5 (platform Anthropic proxy) cuts the pasted
 *                  script into scenes: { title, description, action } (plus
 *                  optional setting / character-state fields). The parser is
 *                  BULLETPROOF: strict JSON parse → first-JSON-array regex →
 *                  deterministic paragraph split of the script itself, and the
 *                  raw LLM response is logged to the console for debugging.
 *   2. CHARACTER LOCK — runs ONCE per series, before any video renders:
 *                  claude-opus-5 writes an ultra-detailed visual description of
 *                  the main character from the full script, then a reference
 *                  portrait is generated through the platform image endpoint
 *                  (/api/generate/image — the workspace's working image
 *                  generation path; the chat-completions proxy only accepts
 *                  text models). An explicitly uploaded character photo IS the
 *                  lock image and skips the paid generation. If image
 *                  generation fails the lock degrades to text-only — never a
 *                  dead run. The lock persists for the series session; Clear
 *                  results clears it.
 *   3. EXPAND     — per scene, claude-opus-5 expands the parsed description
 *                  into a precise cinematic video prompt (body mechanics,
 *                  camera, light, character confirmation, atmosphere). The
 *                  expanded prompt — not the raw description — is what renders.
 *   4. PER SCENE, sequentially:
 *        a. claude-opus-5 writes two keyframe image prompts (start / end of
 *           the action), each carrying the SAME locked character description.
 *        b. The platform image endpoint renders the keyframes. If image
 *           generation fails, the character reference itself becomes the
 *           start frame — a degraded keyframe is never a dead scene.
 *        c. One Omni Flash image-to-video job is submitted with the LOCKED
 *           character image as the identity reference on EVERY scene, the
 *           start frame as the opening image and the end frame as the
 *           (additive) last-frame input.
 *        d. The job is polled with the same exponential backoff as the main
 *           studio (3s → 30s), bounded in time and in consecutive failures.
 *        e. When the clip lands, its LAST frame is extracted in the browser
 *           and seeds scene N+1's start keyframe — the whole script chains
 *           through one person.
 *
 * CHAT AUTO-DETECTION: detectSportsScript() classifies a chat message as a
 * multi-scene sports script (definite / ambiguous / not one), and
 * startSportsRunFromChat() pre-fills this store, opens the Create app in
 * Sports mode and kicks the full pipeline off — components/AgentChatView.tsx
 * calls both from the composer.
 *
 * WHY MODULE SCOPE: the shell unmounts the app on every tab switch (see the
 * note at the top of videoStore.ts). A three-scene run is ~10 minutes of wall
 * clock; it must survive every unmount, so the state and the loop live here
 * and components are pure projections of it. The run is ALSO persisted to
 * localStorage (vidverge.sports.v1) and picked back up on load, so a reload or
 * a sign-out/sign-in returns to the same generating/done view — see the
 * persistence block and resumeSportsRun at the bottom of this file.
 *
 * NO APPROVAL GATE: scenes render strictly one after another with no manual
 * confirmation in between. A job the backend parks in its review window
 * ('awaiting_approval') is approved + finalized programmatically, and a
 * finished single clip is accepted directly, so the next scene always starts
 * on its own. Per-scene Regenerate stays available after delivery.
 *
 * NOTHING HERE RUNS FOREVER: scene count is capped, every poll loop has a
 * time ceiling and a consecutive-failure ceiling, keyframe/vision calls fall
 * back deterministically, and automatic retries are bounded per scene.
 */
import { useEffect, useState } from 'react';
import { aiProxyHeaders, generateImage } from '../../lib/reelioStudio';
import {
  approveAndFinalizeJob,
  CHARACTER_VISION_PROMPT,
  checkVideoStatus,
  contentBlockReason,
  describeImage,
  extractJson,
  fetchJobClipUrls,
  isJobLostStatus,
  submitStudioVideo,
  type RenderStatus,
} from './studioApi';
import { clampText, DEFAULT_VIDEO_MODEL, makeScene, SCENE_MAX, type AspectRatio } from './videoTypes';
import { extractVideoFrames, getChainReference, isHttpUrl } from './frameChain';
import { setMode as setStudioMode } from './videoStore';

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------
export type SportsScenePhase =
  | 'pending'
  | 'expanding'
  | 'prompts'
  | 'keyframes'
  | 'submitting'
  | 'queued'
  | 'processing'
  | 'extracting'
  | 'complete'
  | 'failed';

export interface SportsScene {
  index: number;
  sceneNumber: number;
  /** Short scene name for the compact card, e.g. "The Break Away". */
  title: string;
  description: string;
  action: string;
  setting: string;
  characterStateAtStart: string;
  characterStateAtEnd: string;
  /** The claude-opus-5 director's expansion — the prompt that actually renders. */
  expandedPrompt: string;
  startFramePrompt: string;
  endFramePrompt: string;
  startFrameUrl: string;
  endFrameUrl: string;
  jobId: string | null;
  phase: SportsScenePhase;
  /** Live status line for the card, e.g. "Rendering…" / "Polling…". */
  message: string;
  /** 0–1 for the card's progress bar. */
  progress: number;
  videoUrl: string;
  /** Extracted final frame — seeds the next scene's start keyframe. */
  lastFrameUrl: string;
  error: string | null;
  startedAt: number;
  regenCount: number;
}

export type SportsPhase = 'setup' | 'parsing' | 'character' | 'expanding' | 'running' | 'done' | 'failed';

/** The once-per-series character lock: description always, image when it landed. */
export interface CharacterLock {
  description: string;
  imageUrl: string | null;
}

export interface SportsState {
  phase: SportsPhase;
  script: string;
  aspect: AspectRatio;
  /** Explicitly uploaded character reference (optional). */
  characterImageUrl: string;
  /** The locked character for this series session. */
  characterLock: CharacterLock | null;
  /** True while the lock is being (re)generated outside a run. */
  lockBusy: boolean;
  lockError: string | null;
  /** The lock's description — woven into every keyframe + render prompt. */
  characterDescription: string;
  scenes: SportsScene[];
  error: string | null;
  running: boolean;
  startedAt: number;
}

// ---------------------------------------------------------------------------
// Ceilings — nothing in this mode runs forever.
// ---------------------------------------------------------------------------
export const MAX_SPORTS_SCENES = 8;
export const MIN_SCRIPT_CHARS = 50;
// Fast per-scene polling (Sep 12 2026): the old 3s → 30s backoff left a
// FINISHED scene undetected for up to 30s before the next one could start.
// 1s → 4s keeps detection latency under ~4s per scene while still asking the
// status hook only ~15 times a minute on a long render.
const SCENE_POLL_MIN_MS = 1000;
const SCENE_POLL_MAX_MS = 4000;
const SCENE_MAX_POLL_MS = 20 * 60 * 1000;
const SCENE_MAX_POLL_FAILURES = 10;
const MAX_SCENE_REGENS = 3;

export const SCRIPT_TOO_SHORT_ERROR = 'Script is too short — write at least one full scene.';

/**
 * STALL-PROOFING (Sep 12 2026): every awaited stage of the pipeline runs under
 * a hard timeout. A hung network call (flaky connection, a proxy holding the
 * socket open) used to freeze the run loop forever — scene N stuck on
 * "Writing keyframe prompts…" and every later scene parked on "Queued" with no
 * error and no way forward. A stage that times out now falls back (keyframes,
 * frame extraction, status polls) or fails only its own scene (submit), so the
 * series ALWAYS advances to the next scene.
 */
const LLM_STAGE_TIMEOUT_MS = 90 * 1000;
const IMAGE_STAGE_TIMEOUT_MS = 150 * 1000;
const SUBMIT_STAGE_TIMEOUT_MS = 120 * 1000;
const STATUS_POLL_TIMEOUT_MS = 45 * 1000;
const EXTRACT_STAGE_TIMEOUT_MS = 90 * 1000;

function withStageTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error(`${what} took too long to answer — the pipeline moved on. Retry this scene if it did not recover.`)),
      ms,
    );
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * FACE-VISIBILITY FIX (Sep 11 2026): positive framing terms appended to every
 * character-bearing image/video prompt in this mode, so the generated output
 * never crops the character's head or face at the frame edge. The matching
 * negative terms live in FRAMING_NEGATIVE inside the generate-video hook and
 * in lib/reelioStudio.ts's FRAMING_NEGATIVE_PROMPT.
 */
export const FRAMING_POSITIVE =
  'full body visible, face clearly visible, centered composition, head fully in frame';
const PARSE_FAILED_ERROR =
  'The script parser could not find scene breaks. Try adding blank lines between scenes or labelling them Scene 1, Scene 2, etc.';

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------
const EMPTY_SPORTS: SportsState = {
  phase: 'setup',
  script: '',
  // HORIZONTAL BY DEFAULT (Sep 11 2026 fix): sports videos — basketball
  // especially — belong in 16:9 landscape unless the user explicitly picks
  // vertical in the Video Orientation selector.
  aspect: '16:9',
  characterImageUrl: '',
  characterLock: null,
  lockBusy: false,
  lockError: null,
  characterDescription: '',
  scenes: [],
  error: null,
  running: false,
  startedAt: 0,
};

// ---------------------------------------------------------------------------
// Persistence — the run survives a reload and a sign-out, not just a tab
// switch. Without this the UI came back BLANK after close/reopen, because the
// store lived only in module scope.
// ---------------------------------------------------------------------------
const SPORTS_STORE_KEY = 'vidverge.sports.v1';

/** Set by rehydration when the persisted run was mid-flight (see boot below). */
let resumeOnBoot = false;

/** Frames persist only as https URLs — a data-URL frame would eat the quota. */
function persistableSports(s: SportsState): SportsState {
  return {
    ...s,
    lockBusy: false,
    lockError: null,
    scenes: s.scenes.map((scene) => ({
      ...scene,
      startFrameUrl: isHttpUrl(scene.startFrameUrl) ? scene.startFrameUrl : '',
      endFrameUrl: isHttpUrl(scene.endFrameUrl) ? scene.endFrameUrl : '',
      lastFrameUrl: isHttpUrl(scene.lastFrameUrl) ? scene.lastFrameUrl : '',
    })),
  };
}

/**
 * A reload is never silently mid-submit: a scene whose render was already in
 * flight keeps its job id and is simply re-polled (which costs nothing), while
 * one caught between submit steps goes back to pending for the resumed loop
 * to submit again. Finished and failed scenes come back exactly as they were.
 */
function rehydrateSports(saved: SportsState): SportsState {
  const scenes = (saved.scenes || []).map((scene) => {
    if (scene.phase === 'complete' || scene.phase === 'failed') return { ...scene };
    if (scene.jobId && (scene.phase === 'queued' || scene.phase === 'processing' || scene.phase === 'extracting')) {
      return { ...scene, message: 'Reconnecting…' };
    }
    return { ...scene, phase: 'pending' as SportsScenePhase, message: 'Queued', jobId: null, progress: 0 };
  });
  const hasUnfinished =
    scenes.length > 0 && scenes.some((scene) => scene.phase !== 'complete' && scene.phase !== 'failed');
  resumeOnBoot = hasUnfinished && (saved.running === true || saved.phase === 'running');
  const phase: SportsPhase =
    scenes.length === 0
      ? saved.phase === 'failed'
        ? 'failed'
        : 'setup'
      : hasUnfinished
        ? resumeOnBoot
          ? 'running'
          : saved.phase
        : 'done';
  return {
    ...saved,
    scenes,
    phase,
    running: false,
    lockBusy: false,
    lockError: null,
    error: resumeOnBoot ? null : saved.error || null,
  };
}

function loadSports(): SportsState {
  if (typeof window === 'undefined') return { ...EMPTY_SPORTS };
  try {
    const raw = window.localStorage.getItem(SPORTS_STORE_KEY);
    if (!raw) return { ...EMPTY_SPORTS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...EMPTY_SPORTS };
    return rehydrateSports({ ...EMPTY_SPORTS, ...parsed });
  } catch {
    return { ...EMPTY_SPORTS };
  }
}

function saveSports(s: SportsState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SPORTS_STORE_KEY, JSON.stringify(persistableSports(s)));
  } catch {
    /* storage disabled — the run still works, it just forgets on reload */
  }
}

let state: SportsState = loadSports();
const listeners = new Set<() => void>();

function set(patch: Partial<SportsState>): void {
  state = { ...state, ...patch };
  saveSports(state);
  listeners.forEach((listener) => {
    try {
      listener();
    } catch (e) {
      console.warn('[Sports] listener failed:', e);
    }
  });
}

function patchScene(index: number, patch: Partial<SportsScene>): void {
  set({ scenes: state.scenes.map((scene) => (scene.index === index ? { ...scene, ...patch } : scene)) });
}

export function getSportsState(): SportsState {
  return state;
}

export function useSports(): SportsState {
  const [snapshot, setSnapshot] = useState<SportsState>(state);
  useEffect(() => {
    setSnapshot(state);
    const listener = () => setSnapshot(state);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return snapshot;
}

export function setSportsScript(script: string): void {
  set({ script });
}

export function setSportsAspect(aspect: AspectRatio): void {
  set({ aspect });
}

export function setSportsCharacterImage(url: string): void {
  set({ characterImageUrl: url });
}

/**
 * Start a fresh series — keeps the typed script, drops results AND the
 * character lock (the lock lives for one series session, no longer).
 */
export function resetSports(): void {
  runSeq += 1;
  set({ ...EMPTY_SPORTS, script: state.script, aspect: state.aspect, characterImageUrl: state.characterImageUrl });
}

// ---------------------------------------------------------------------------
// LLM helpers (claude-opus-5 via the platform Anthropic proxy)
// ---------------------------------------------------------------------------
async function callOpus(system: string, user: string, maxTokens = 2200): Promise<string> {
  // Hard timeout on the LLM call: an unanswered request ABORTS instead of
  // hanging the whole run loop (see the STALL-PROOFING note above). Every
  // caller already has a deterministic fallback for a thrown error.
  const controller = new AbortController();
  const abortTimer = window.setTimeout(() => controller.abort(), LLM_STAGE_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch('/proxy/anthropic/v1/messages', {
      method: 'POST',
      // aiProxyHeaders carries the REQUIRED X-Workspace-DB-Token — an anonymous
      // proxy call is refused with 401 no_credentials before any model runs.
      headers: aiProxyHeaders(),
      body: JSON.stringify({
        model: 'claude-opus-5',
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
      signal: controller.signal,
    });
  } catch {
    throw new Error('The scene director did not answer in time.');
  } finally {
    window.clearTimeout(abortTimer);
  }
  const data = await res.json().catch(() => null);
  const text =
    data && Array.isArray(data.content)
      ? data.content
          .filter((block: any) => block && block.type === 'text' && typeof block.text === 'string')
          .map((block: any) => block.text)
          .join('\n')
          .trim()
      : '';
  if (!res.ok || !text) {
    const detail = data && data.error && data.error.message ? `: ${data.error.message}` : '';
    throw new Error(`The scene director could not be reached${detail}`);
  }
  return text;
}

// ---------------------------------------------------------------------------
// PROBLEM-1 FIX: the bulletproof scene parser
// ---------------------------------------------------------------------------
/**
 * The parse prompt is unambiguous: the schema is spelled out with an example,
 * so the model has no room to answer in prose.
 */
const PARSE_SYSTEM =
  'You are a sports video director. Parse the provided script into distinct scenes.\n' +
  'Respond with ONLY a JSON array — no prose, no markdown fences, no explanation.\n' +
  'Each element MUST be an object with exactly these keys:\n' +
  '  "title": string — a short 3-6 word scene name\n' +
  '  "description": string — what happens in the scene, visually concrete\n' +
  '  "action": string — the physical action beat of the scene\n' +
  'You may ALSO include optional keys "setting", "characterStateAtStart", "characterStateAtEnd".\n' +
  'Example output for a two-scene script:\n' +
  '[{"title":"Locker Room Focus","description":"She laces up alone in the empty locker room, headphones on, game jersey ready on the bench.","action":"Tying laces, slow exhale, stands up"},' +
  '{"title":"The Break Away","description":"First sprint of the final — she breaks away from the pack down the sideline.","action":"Explosive sprint, arms pumping, crowd a blur"}]';

function scenesFromList(list: any[]): SportsScene[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((item) => item && (item.description || item.action || item.title))
    .slice(0, MAX_SPORTS_SCENES)
    .map((item, index) => makeEmptyScene(index, item));
}

/**
 * Strategy (c): deterministic fallback that needs no model at all — every
 * blank-line-separated paragraph (or "Scene N:" label) is one scene, with the
 * paragraph text as its description.
 */
function paragraphScenes(script: string): SportsScene[] {
  const text = (script || '').trim();
  if (!text) return [];
  let parts = text
    .split(/\n\s*\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length <= 1) {
    // "Scene 1: … \n Scene 2: …" on single newlines still cuts cleanly.
    const labelled = text
      .split(/(?=\bscene\s*\d+\s*[:.)\-])/i)
      .map((part) => part.trim())
      .filter(Boolean);
    if (labelled.length > 1) parts = labelled;
  }
  return parts.slice(0, MAX_SPORTS_SCENES).map((paragraph, index) => {
    const label = paragraph.match(/^scene\s*\d+\s*[:.)\-]?\s*/i);
    const body = label ? paragraph.slice(label[0].length).trim() || paragraph : paragraph;
    return makeEmptyScene(index, { title: `Scene ${index + 1}`, description: body, action: '' });
  });
}

/**
 * Three parse strategies, in order:
 *   a. JSON.parse of the response (extractJson also strips fences and slices
 *      the outermost object/array),
 *   b. regex-extract the FIRST JSON array in the response and parse that,
 *   c. deterministic paragraph split of the script itself.
 * The raw LLM response is always logged so developers can debug a bad parse,
 * and the error when everything fails says exactly what to change — never the
 * old generic "No scenes could be read".
 */
async function parseScenes(script: string): Promise<SportsScene[]> {
  let raw = '';
  try {
    raw = await callOpus(PARSE_SYSTEM, script);
  } catch (e) {
    console.warn('[Sports] scene parser LLM call failed — falling back to paragraph split:', e);
  }
  if (raw) {
    console.log('[Sports] raw scene-parser response:', raw);
    // (a) strict parse of the whole response.
    const parsed = extractJson(raw);
    const list: any[] = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.scenes) ? parsed.scenes : [];
    let scenes = scenesFromList(list);
    if (scenes.length > 0) return scenes;
    // (b) the first JSON array anywhere in the response.
    const arrayMatch = raw.match(/\[[\s\S]*?\]/);
    if (arrayMatch) {
      try {
        scenes = scenesFromList(JSON.parse(arrayMatch[0]));
        if (scenes.length > 0) return scenes;
      } catch {
        /* strategy (c) below still applies */
      }
    }
  }
  // (c) the script's own structure — works with the model entirely offline.
  const fromScript = paragraphScenes(script);
  if (fromScript.length > 0) return fromScript;
  throw new Error(PARSE_FAILED_ERROR);
}

function makeEmptyScene(index: number, item: any): SportsScene {
  const description = clampText(String(item.description || ''), 380);
  const action = clampText(String(item.action || ''), 240);
  return {
    index,
    sceneNumber: Number(item.sceneNumber) || index + 1,
    title: clampText(String(item.title || item.name || '').trim() || action || description || `Scene ${index + 1}`, 60),
    description,
    action,
    setting: clampText(String(item.setting || ''), 160),
    characterStateAtStart: clampText(String(item.characterStateAtStart || ''), 160),
    characterStateAtEnd: clampText(String(item.characterStateAtEnd || ''), 160),
    expandedPrompt: '',
    startFramePrompt: '',
    endFramePrompt: '',
    startFrameUrl: '',
    endFrameUrl: '',
    jobId: null,
    phase: 'pending',
    message: 'Queued',
    progress: 0,
    videoUrl: '',
    lastFrameUrl: '',
    error: null,
    startedAt: 0,
    regenCount: 0,
  };
}

// ---------------------------------------------------------------------------
// PROBLEM-2 FIX: the once-per-series CHARACTER LOCK
// ---------------------------------------------------------------------------
const CHARACTER_DESCRIPTION_PROMPT =
  'Read this sports video script. Write a single, consistent, ultra-detailed visual description of the main ' +
  'character for use as an image generation reference. Include: approximate age, ethnicity, body type, ' +
  'height/build descriptors, hair style and color, facial features, exact clothing (jersey number if mentioned, ' +
  'colors, brand style), footwear, any accessories. Write as one dense paragraph, 80–120 words. Output only the ' +
  'description, nothing else.';

const FALLBACK_LOCK_DESCRIPTION =
  'The same recurring athlete in every scene — identical face, build, hair, kit colors and footwear throughout.';

/**
 * Build the lock: description first (claude-opus-5, then a vision read of an
 * uploaded photo as fallback), then the reference image. An explicitly
 * uploaded character photo IS the lock image — no generation spend needed.
 * Image generation failing is never fatal: the description still locks.
 */
async function buildCharacterLock(script: string): Promise<CharacterLock> {
  const uploaded = isHttpUrl(state.characterImageUrl) ? state.characterImageUrl : '';
  let description = '';
  try {
    description = (
      await callOpus(
        'You are a casting director preparing a character lock for an AI sports video. Follow the instruction exactly.',
        `${CHARACTER_DESCRIPTION_PROMPT}\n\nScript:\n${script.slice(0, 4000)}`,
        450,
      )
    ).trim();
  } catch (e) {
    console.warn('[Sports] character description call failed:', e);
  }
  if (!description && uploaded) {
    try {
      description = await withStageTimeout(
        describeImage(uploaded, CHARACTER_VISION_PROMPT),
        LLM_STAGE_TIMEOUT_MS,
        'Reading the uploaded character photo',
      );
    } catch {
      /* the generic lock below still holds the series together */
    }
  }
  description = clampText(description || FALLBACK_LOCK_DESCRIPTION, 900);

  let imageUrl: string | null = null;
  if (uploaded) {
    imageUrl = uploaded;
  } else {
    try {
      imageUrl = await withStageTimeout(
        generateImage({
          prompt:
            `Photorealistic full-body reference portrait of this character, for use as a consistent video character lock. ` +
            `Character: ${description} ` +
            'Style: cinematic, neutral seamless background, even studio lighting, standing still and facing camera, ' +
            'full face visible, medium shot or wider, ' +
            'every identifying detail (face, hair, kit, jersey number, footwear) clearly visible. ' +
            `Framing: ${FRAMING_POSITIVE}. ` +
            'A calm standing reference portrait — no motion blur, no action pose.',
          aspectRatio: '9:16',
          quality: 'high',
        }),
        IMAGE_STAGE_TIMEOUT_MS,
        'The character reference render',
      );
    } catch (e) {
      console.warn('[Sports] character reference image generation failed — continuing with the text-only lock:', e);
      imageUrl = null;
    }
  }
  return { description, imageUrl };
}

/** UI action: lock the character from the current script (the auto-generate button). */
export async function generateCharacterLockFromScript(): Promise<void> {
  if (state.lockBusy || state.running) return;
  const script = state.script.trim();
  if (script.length < MIN_SCRIPT_CHARS) {
    set({ lockError: SCRIPT_TOO_SHORT_ERROR });
    return;
  }
  set({ lockBusy: true, lockError: null });
  try {
    const lock = await buildCharacterLock(script);
    set({ characterLock: lock, characterDescription: lock.description, lockBusy: false });
  } catch (e: any) {
    set({ lockBusy: false, lockError: (e && e.message) || 'The character could not be generated — try again.' });
  }
}

/** UI action: lock a manually written character description (keeps any image). */
export function setCharacterLockDescription(description: string): void {
  const text = (description || '').trim();
  if (!text) return;
  const locked = clampText(text, 900);
  set({
    characterLock: { description: locked, imageUrl: state.characterLock ? state.characterLock.imageUrl : null },
    characterDescription: locked,
    lockError: null,
  });
}

/** UI action: throw the lock away and rebuild it from the current script. */
export async function regenerateCharacterLock(): Promise<void> {
  if (state.running || state.lockBusy) return;
  set({ characterLock: null });
  await generateCharacterLockFromScript();
}

// ---------------------------------------------------------------------------
// PROBLEM-3 FIX: per-scene SCENE EXPANSION
// ---------------------------------------------------------------------------
const EXPAND_SYSTEM =
  'You are a cinematic AI video director. Expand the provided scene description into a precise, detailed video ' +
  'generation prompt for a sports video. Include:\n' +
  '- Exact body mechanics (foot plant, knee angle, hand position, follow-through)\n' +
  '- Camera movement (tracking shot, POV, slow-mo, push-in, pull-out, angle)\n' +
  '- Lighting and environment (court markings, crowd bokeh, gym lighting or outdoor light)\n' +
  '- Character appearance confirmation matching the provided character lock exactly\n' +
  '- Sound/atmosphere hint (shoe squeak, crowd, ball impact)\n' +
  '- FRAMING (mandatory): the character must be framed with the full body visible, face clearly visible, ' +
  'centered composition, and the head fully in frame — never cropped at any frame edge\n' +
  'Keep it under 150 words. Never mention words, captions, logos or lettering appearing on screen. ' +
  'Output only the expanded prompt.';

/** Cheap sport-type read off the script, for the expansion context line. */
function guessSport(script: string): string {
  const s = (script || '').toLowerCase();
  if (/basketball|dribbl|layup|dunk|three-?pointer|free[ -]?throw|crossover|floater|rebound/.test(s)) return 'basketball';
  if (/soccer|football|goalkeeper|penalty|striker|midfield/.test(s)) return 'soccer / football';
  if (/sprint|track|marathon|relay|finish line|hurdle/.test(s)) return 'track & field';
  if (/tennis|serve|baseline|rally/.test(s)) return 'tennis';
  if (/boxing|jab|hook|knockout|mma|octagon/.test(s)) return 'combat sports';
  return 'a sports event';
}

/** Expand ONE scene. Best-effort: a failed expansion keeps the original text. */
async function expandScene(run: number, index: number, lockDescription: string, sport: string): Promise<void> {
  const scene = state.scenes[index];
  if (!scene) return;
  patchScene(index, { phase: 'expanding', message: 'Expanding the prompt…' });
  try {
    const raw = await callOpus(
      EXPAND_SYSTEM,
      [
        `Sport: ${sport}`,
        `Scene ${scene.sceneNumber} — ${scene.title}`,
        `Description: ${scene.description}`,
        scene.action ? `Action: ${scene.action}` : '',
        scene.setting ? `Setting: ${scene.setting}` : '',
        `Character lock (the character's appearance must match this exactly): ${lockDescription}`,
      ]
        .filter(Boolean)
        .join('\n'),
      500,
    );
    if (run !== runSeq) return;
    patchScene(index, {
      expandedPrompt: clampText(raw, 1200),
      phase: 'pending',
      message: 'Queued',
    });
  } catch (e) {
    console.warn(`[Sports] scene ${index + 1} expansion failed — rendering from the original description:`, e);
    if (run !== runSeq) return;
    patchScene(index, { phase: 'pending', message: 'Queued' });
  }
}

const KEYFRAME_SYSTEM =
  'You write image generation prompts for sports video keyframes. ' +
  'Respond with ONLY valid JSON, no markdown fences: {"startFramePrompt": string, "endFramePrompt": string}. ' +
  'startFramePrompt shows the character entering or beginning the scene action; ' +
  'endFramePrompt shows the character at peak action or completing the scene. ' +
  'Both prompts MUST include the same consistent character description drawn from the reference ' +
  '("same character as reference: …"), the setting, and concrete cinematic sports-photography detail ' +
  '(lens, light, motion). Both prompts MUST also end with this exact framing clause: ' +
  '"full body visible, face clearly visible, centered composition, head fully in frame". ' +
  'Never mention words, captions, logos or lettering appearing on screen.';

async function writeKeyframePrompts(
  scene: SportsScene,
  characterDescription: string,
): Promise<{ start: string; end: string }> {
  const character = characterDescription || 'the same recurring athlete from the reference image';
  const fallbackStart = clampText(
    `Cinematic sports film still: same character as reference: ${character}. ${scene.characterStateAtStart || 'Entering the action'} — beginning of: ${scene.action || scene.description}. Setting: ${scene.setting || 'the event venue'}. Dynamic sports photography, crisp motion, dramatic light, ${FRAMING_POSITIVE}.`,
    880,
  );
  const fallbackEnd = clampText(
    `Cinematic sports film still: same character as reference: ${character}. ${scene.characterStateAtEnd || 'At peak action'} — climax of: ${scene.action || scene.description}. Setting: ${scene.setting || 'the event venue'}. Peak-action freeze, dynamic sports photography, dramatic light, ${FRAMING_POSITIVE}.`,
    880,
  );
  try {
    const raw = await callOpus(
      KEYFRAME_SYSTEM,
      [
        `Character (locked reference): ${character}`,
        `Scene ${scene.sceneNumber}: ${scene.description}`,
        scene.expandedPrompt ? `Expanded director's prompt: ${scene.expandedPrompt}` : '',
        `Action: ${scene.action}`,
        `Setting: ${scene.setting}`,
        `Character at start: ${scene.characterStateAtStart}`,
        `Character at end: ${scene.characterStateAtEnd}`,
      ]
        .filter(Boolean)
        .join('\n'),
      900,
    );
    const parsed = extractJson(raw);
    const start = parsed && typeof parsed.startFramePrompt === 'string' ? parsed.startFramePrompt.trim() : '';
    const end = parsed && typeof parsed.endFramePrompt === 'string' ? parsed.endFramePrompt.trim() : '';
    return { start: clampText(start, 880) || fallbackStart, end: clampText(end, 880) || fallbackEnd };
  } catch {
    // The deterministic prompts carry the same character lock — keep moving.
    return { start: fallbackStart, end: fallbackEnd };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// The run loop
// ---------------------------------------------------------------------------
/** Bumped by reset — every await in the loop checks it so a reset ends the run. */
let runSeq = 0;

/**
 * The active character reference: the series LOCK image first, then an
 * explicit upload, then the cross-video chain anchor.
 */
function activeReference(): string {
  if (state.characterLock && isHttpUrl(state.characterLock.imageUrl || '')) {
    return state.characterLock.imageUrl as string;
  }
  if (isHttpUrl(state.characterImageUrl)) return state.characterImageUrl;
  const anchor = getChainReference();
  return anchor && isHttpUrl(anchor.url) ? anchor.url : '';
}

export async function startSportsRun(): Promise<void> {
  if (state.running) return;
  const script = state.script.trim();
  if (!script) {
    set({ error: 'Paste your multi-scene script first.' });
    return;
  }
  // Minimum-length gate: shorter than one real scene can never parse usefully.
  if (script.length < MIN_SCRIPT_CHARS) {
    set({ error: SCRIPT_TOO_SHORT_ERROR });
    return;
  }
  const run = ++runSeq;
  set({ phase: 'parsing', running: true, error: null, scenes: [], startedAt: Date.now() });

  try {
    // STEP 1 of 4 — parse the script into scenes (bulletproof, see parseScenes).
    const scenes = await parseScenes(script);
    if (run !== runSeq) return;
    set({ scenes });

    // STEP 2 of 4 — the character lock, ONCE per series. A lock set earlier
    // (auto-generated or manual) is reused untouched.
    set({ phase: 'character' });
    let lock = state.characterLock;
    if (!lock) {
      lock = await buildCharacterLock(script);
      if (run !== runSeq) return;
      set({ characterLock: lock, characterDescription: lock.description });
    } else if (!state.characterDescription) {
      set({ characterDescription: lock.description });
    }

    // STEP 3 of 4 — expand every scene into a precise cinematic prompt.
    set({ phase: 'expanding' });
    const sport = guessSport(script);
    for (let i = 0; i < state.scenes.length; i++) {
      if (run !== runSeq) return;
      await expandScene(run, i, lock.description, sport);
    }
    if (run !== runSeq) return;

    // STEP 4 of 4 — render, scene by scene, chained through the lock. Every
    // scene starts AUTOMATICALLY the moment the previous one lands: there is
    // no per-scene approval gate anywhere in this pipeline.
    set({ phase: 'running' });
    await driveScenes(run);

    if (run !== runSeq) return;
    set({ phase: 'done', running: false });
  } catch (e: any) {
    if (run !== runSeq) return;
    set({
      phase: state.scenes.length > 0 ? 'done' : 'failed',
      running: false,
      error: (e && e.message) || 'The run could not be completed.',
    });
  }
}

/**
 * Render every unfinished scene in order, chaining each one off the previous
 * scene's extracted LAST frame — the chained frame is passed straight into the
 * next scene's render submit (see runScene). Shared by a fresh run
 * (startSportsRun) and a resumed one (resumeSportsRun). NO APPROVAL GATE: the
 * next scene starts automatically the moment the previous one lands.
 */
async function driveScenes(run: number): Promise<void> {
  const reference = activeReference();
  for (let i = 0; i < state.scenes.length; i++) {
    if (run !== runSeq) return;
    const sceneNow = state.scenes[i];
    if (!sceneNow) continue;
    // Already delivered (a resumed run): kept as-is — its last frame chains on.
    if (sceneNow.phase === 'complete' && sceneNow.videoUrl) continue;
    // A failed scene keeps its Retry button; the rest of the series continues.
    if (sceneNow.phase === 'failed') continue;
    // IMAGE CHAINING: scene N+1 anchors on scene N's extracted last frame; the
    // first scene — or a broken extraction — falls back to the character
    // reference. Logged every time so the chain is auditable in the console.
    const previous = state.scenes[i - 1];
    const chained = previous && isHttpUrl(previous.lastFrameUrl) ? previous.lastFrameUrl : '';
    const seed = chained || reference;
    console.log(
      chained
        ? `[Sports] scene ${i + 1}: chaining from scene ${i}'s last frame: ${chained}`
        : `[Sports] scene ${i + 1}: no chained frame — using the character reference: ${reference || '(none)'}`,
    );
    await runScene(run, i, seed);
  }
}

/**
 * Produce ONE scene end to end: keyframe prompts → keyframe images → Omni
 * Flash image-to-video → poll → extract the last frame. Never throws for a
 * per-scene failure — the scene card carries the error and its Retry button.
 * A scene whose render was already in flight (a persisted run picked back up
 * after a reload) is re-polled on its existing job id, never resubmitted.
 */
async function runScene(run: number, index: number, referenceUrl: string, statusPrefix = ''): Promise<void> {
  const scene = state.scenes[index];
  if (!scene) return;
  const label = (text: string) => (statusPrefix ? `${statusPrefix} ${text}` : text);

  // RESUME SUPPORT (persistence fix): re-poll an in-flight render for free
  // instead of resetting the scene and paying for a second submit.
  const resumeJobId =
    scene.jobId && (scene.phase === 'queued' || scene.phase === 'processing' || scene.phase === 'extracting')
      ? scene.jobId
      : null;

  if (resumeJobId) {
    patchScene(index, {
      phase: 'processing',
      message: label('Reconnecting to this render…'),
      progress: Math.max(scene.progress || 0, 0.4),
      error: null,
      startedAt: scene.startedAt || Date.now(),
    });
  } else {
    patchScene(index, {
      phase: 'prompts',
      message: label('Writing keyframe prompts…'),
      progress: 0.06,
      error: null,
      startedAt: Date.now(),
      videoUrl: '',
      lastFrameUrl: '',
      jobId: null,
    });
  }

  try {
    const character =
      (state.characterLock && state.characterLock.description) ||
      state.characterDescription ||
      'the same recurring athlete from the reference image';

    let startFrameUrl = resumeJobId ? scene.startFrameUrl || '' : '';
    let endFrameUrl = resumeJobId ? scene.endFrameUrl || '' : '';

    if (!resumeJobId) {
      // IMAGE CHAINING (fix): when the previous scene handed its last frame
      // over, THAT frame is this scene's start anchor and goes straight into
      // the render submit below — the start keyframe is only generated for
      // the first scene or when the chain broke.
      const lockImageNow =
        state.characterLock && isHttpUrl(state.characterLock.imageUrl || '')
          ? (state.characterLock.imageUrl as string)
          : '';
      const chainedFrame = isHttpUrl(referenceUrl) && referenceUrl !== lockImageNow ? referenceUrl : '';

      const prompts = await writeKeyframePrompts(state.scenes[index] || scene, character);
      if (run !== runSeq) return;
      patchScene(index, {
        startFramePrompt: prompts.start,
        endFramePrompt: prompts.end,
        phase: 'keyframes',
        message: label(chainedFrame ? 'Rendering the end keyframe…' : 'Rendering the start keyframe…'),
        progress: 0.14,
      });

      // Keyframes. A failed image generation falls back to the character
      // reference for the start frame — the scene still renders.
      if (chainedFrame) {
        startFrameUrl = chainedFrame;
        console.log(`[Sports] scene ${index + 1}: start frame anchored on the chained frame: ${chainedFrame}`);
      } else {
        try {
          startFrameUrl = await withStageTimeout(
            generateImage({ prompt: prompts.start, aspectRatio: state.aspect, quality: 'medium' }),
            IMAGE_STAGE_TIMEOUT_MS,
            'The start keyframe render',
          );
        } catch (e) {
          console.warn('[Sports] start keyframe fell back to the reference image:', e);
          startFrameUrl = referenceUrl;
        }
      }
      if (run !== runSeq) return;
      patchScene(index, { startFrameUrl, message: label('Rendering the end keyframe…'), progress: 0.24 });
      try {
        endFrameUrl = await withStageTimeout(
          generateImage({ prompt: prompts.end, aspectRatio: state.aspect, quality: 'medium' }),
          IMAGE_STAGE_TIMEOUT_MS,
          'The end keyframe render',
        );
      } catch (e) {
        console.warn('[Sports] end keyframe skipped:', e);
        endFrameUrl = '';
      }
      if (run !== runSeq) return;
      patchScene(index, { endFrameUrl, phase: 'submitting', message: label('Sending to Omni Flash…'), progress: 0.3 });
    }

    // ONE Omni Flash image-to-video job for this scene, through the existing
    // Track A submit path (session attribution, safety negatives, event).
    // THE EXPANDED PROMPT — not the raw description — is what renders; the
    // pipeline's per-scene cap still applies via clampText/makeScene.
    const total = state.scenes.length;
    const sceneNow = state.scenes[index] || scene;
    const expanded = (sceneNow.expandedPrompt || '').trim();
    // FACE-VISIBILITY FIX: every render prompt carries the framing clause, so
    // the character's head/face is never cropped at the frame edge. The body
    // text is clamped first so the clause itself can never be truncated away.
    const framingClause = ` Framing: ${FRAMING_POSITIVE}.`;
    const sceneBody = expanded
      ? clampText(expanded, SCENE_MAX - framingClause.length)
      : clampText(
          `${scene.description} ${scene.action ? `Action: ${scene.action}.` : ''} ${scene.setting ? `Setting: ${scene.setting}.` : ''}`,
          SCENE_MAX - framingClause.length,
        );
    const sceneText = `${sceneBody}${framingClause}`;
    // CHARACTER LOCK CHAINING: the locked reference image travels as the
    // identity ingredient on EVERY scene's submit; keyframes carry the motion.
    const lockImage =
      state.characterLock && isHttpUrl(state.characterLock.imageUrl || '')
        ? (state.characterLock.imageUrl as string)
        : '';
    const identityImage = lockImage || startFrameUrl || referenceUrl;
    const submitOnce = (withImage: boolean) =>
      submitStudioVideo({
        scenes: [makeScene('Action shot', sceneText, '', 8, DEFAULT_VIDEO_MODEL)],
        character: withImage
          ? {
              name: 'Series character',
              description: clampText(character, 300),
              imageUrl: isHttpUrl(identityImage) ? identityImage : undefined,
              source: 'upload',
            }
          : { name: 'Series character', description: clampText(character, 300), source: 'upload' },
        characterDescription: clampText(`Same character in every scene: ${character}`, 360),
        productImages: [],
        tone: 'energetic, high-energy',
        aspectRatio: state.aspect,
        title: `Scene ${index + 1} of ${total} — ${clampText(sceneNow.title || scene.action || scene.description, 40)}`,
        targetDurationSeconds: 8,
        openingFrameUrl: isHttpUrl(startFrameUrl) ? startFrameUrl : undefined,
        endFrameUrl: isHttpUrl(endFrameUrl) ? endFrameUrl : undefined,
        model: DEFAULT_VIDEO_MODEL,
      });

    let activeJobId = resumeJobId || '';
    if (!activeJobId) {
      const result = await withStageTimeout(submitOnce(true), SUBMIT_STAGE_TIMEOUT_MS, 'The render submit');
      if (run !== runSeq) return;
      if (!result.success || !result.jobId) {
        throw new Error(result.error || 'The scene render could not be started.');
      }
      activeJobId = result.jobId;
      patchScene(index, { jobId: activeJobId, phase: 'queued', message: label('Queued…'), progress: 0.34 });
    }

    // Poll with a fast bounded backoff (1s → 4s), bounded twice.
    let delay = SCENE_POLL_MIN_MS;
    let failures = 0;
    let likenessRetryUsed = false;
    // ONE automatic approval per submit: the pipeline NEVER waits for the
    // "Approve Video & Make Final" review window — a job parked there is
    // approved and finalized programmatically so the next scene starts
    // immediately. Individual scenes stay regenerable afterwards.
    let autoApprovalSent = false;
    const startedAt = Date.now();
    while (true) {
      if (run !== runSeq) return;
      if (Date.now() - startedAt > SCENE_MAX_POLL_MS) {
        throw new Error('The render engine stopped answering for this scene. Retry it — every other scene is safe.');
      }
      await sleep(delay);
      delay = Math.min(SCENE_POLL_MAX_MS, delay * 2);
      if (run !== runSeq) return;

      // A status check that never answers is a FAILED poll, not a frozen run:
      // the bounded consecutive-failure counter below decides when to give up.
      // The error text is kept so a hard "job not found" can be told apart
      // from a transient network wobble.
      const status = await withStageTimeout(
        checkVideoStatus(state.scenes[index]?.jobId || activeJobId || undefined),
        STATUS_POLL_TIMEOUT_MS,
        'The render status check',
      ).catch((e: unknown) => ({ success: false, error: e instanceof Error ? e.message : String(e) } as RenderStatus));
      if (run !== runSeq) return;

      if (!status.success) {
        // HARD 404 / LOST-JOB FAILURE (Sep 12 2026): when the render service
        // answers that this job no longer EXISTS (a provider 404 / "not
        // found"), no amount of re-polling can ever succeed — burning through
        // the consecutive-failure budget (or the 20-minute poll ceiling, which
        // ended as 'The render engine stopped answering for this scene')
        // only delays the Retry button. Fail the scene instantly instead;
        // Retry submits a FRESH job through the same Omni Flash pipeline.
        if (isJobLostStatus(status.error)) {
          throw new Error('The render service no longer recognises this scene’s render job — it was lost provider-side. Retry the scene to submit it fresh; every other scene is safe.');
        }
        failures += 1;
        if (failures >= SCENE_MAX_POLL_FAILURES) {
          throw new Error('We lost contact with the render service for this scene. Retry it in a moment.');
        }
        patchScene(index, { message: label(failures > 2 ? 'Reconnecting…' : 'Polling…') });
        continue;
      }
      failures = 0;

      const refusal = contentBlockReason(status);
      if (refusal) {
        // Flagged character image → one silent retry without it (text-only
        // character lock), instead of a blocking error state.
        if (!likenessRetryUsed && /likeness|real people|real person|people's names|people’s names|famous/i.test(refusal)) {
          likenessRetryUsed = true;
          patchScene(index, { phase: 'submitting', message: label('Adjusting the reference and retrying…'), progress: 0.32 });
          const retry = await withStageTimeout(submitOnce(false), SUBMIT_STAGE_TIMEOUT_MS, 'The adjusted render submit');
          if (run !== runSeq) return;
          if (!retry.success || !retry.jobId) throw new Error(retry.error || 'The retry could not be started.');
          activeJobId = retry.jobId;
          patchScene(index, { jobId: activeJobId, phase: 'queued', message: label('Queued…'), progress: 0.34 });
          delay = SCENE_POLL_MIN_MS;
          autoApprovalSent = false;
          continue;
        }
        throw new Error(refusal);
      }

      const ready =
        status.stage === 'ready' || status.status === 'completed' || status.status === 'partial';
      const failed = status.stage === 'failed' || status.status === 'failed';
      if (failed) {
        throw new Error(status.user_message || status.error || 'The scene render failed. Retry it — the rest of the series is safe.');
      }
      if (ready && status.download_url) {
        patchScene(index, { videoUrl: status.download_url, phase: 'extracting', message: label('Extracting frames…'), progress: 0.93 });
        break;
      }

      // NO PER-SCENE APPROVAL GATE: a job parked in the review window
      // ('awaiting_approval') is approved + finalized automatically, and a
      // finished clip is accepted directly — a sports scene is a single-clip
      // job, so the clip IS the scene video. Either way the next scene starts
      // without anyone pressing "Approve Video & Make Final".
      const statusText = `${status.status || ''} ${status.stage || ''}`.toLowerCase();
      const awaitingApproval = /approv|review/.test(statusText);
      if (awaitingApproval || ready) {
        if (!autoApprovalSent) {
          autoApprovalSent = true;
          console.log(`[Sports] scene ${index + 1}: auto-approving job ${activeJobId} — the pipeline never waits for manual approval.`);
          void approveAndFinalizeJob(activeJobId).then((approval) => {
            if (!approval.success) {
              console.warn(`[Sports] scene ${index + 1}: auto-approval call failed (the backend still auto-finalizes):`, approval.error);
            }
          });
          delay = SCENE_POLL_MIN_MS;
        }
        const statusClip = Array.isArray(status.clip_urls)
          ? status.clip_urls.find((clipCandidate) => isHttpUrl(clipCandidate)) || ''
          : '';
        const clipUrl =
          statusClip ||
          (
            await withStageTimeout(fetchJobClipUrls(activeJobId), STATUS_POLL_TIMEOUT_MS, 'The clip lookup').catch(
              () => [] as string[],
            )
          ).find((clipCandidate) => isHttpUrl(clipCandidate)) ||
          '';
        if (run !== runSeq) return;
        if (clipUrl) {
          console.log(`[Sports] scene ${index + 1}: finished clip accepted for chaining: ${clipUrl}`);
          patchScene(index, { videoUrl: clipUrl, phase: 'extracting', message: label('Extracting frames…'), progress: 0.93 });
          break;
        }
        patchScene(index, {
          phase: 'processing',
          message: label('Finalizing this scene…'),
          progress: Math.max(state.scenes[index]?.progress || 0, 0.9),
        });
        continue;
      }

      // Still rendering: keep the bar honestly alive with a time-based creep.
      const elapsed = Date.now() - startedAt;
      const creep = Math.min(0.9, 0.36 + (elapsed / 240000) * 0.5);
      patchScene(index, {
        phase: 'processing',
        message: label(status.user_message || 'Rendering…'),
        progress: Math.max(state.scenes[index]?.progress || 0, creep),
      });
    }

    // Last-frame extraction — the chain link into the next scene: the frame
    // captured here is exactly what scene N+1 anchors its start on.
    const finished = state.scenes[index];
    const frames = await withStageTimeout(
      extractVideoFrames(finished?.videoUrl || ''),
      EXTRACT_STAGE_TIMEOUT_MS,
      'Frame extraction',
    ).catch(() => ({ firstFrameUrl: null, lastFrameUrl: null }));
    if (run !== runSeq) return;
    if (isHttpUrl(frames.lastFrameUrl)) {
      console.log(`[Sports] scene ${index + 1}: captured last frame for scene ${index + 2}: ${frames.lastFrameUrl}`);
    } else {
      console.warn(`[Sports] scene ${index + 1}: no durable last frame — the next scene falls back to the character reference.`);
    }
    patchScene(index, {
      lastFrameUrl: frames.lastFrameUrl || '',
      phase: 'complete',
      message: statusPrefix ? 'Done ✓' : 'Complete ✓',
      progress: 1,
    });
  } catch (e: any) {
    if (run !== runSeq) return;
    patchScene(index, {
      phase: 'failed',
      message: 'This scene needs a retry',
      error: (e && e.message) || 'This scene could not be generated.',
      progress: state.scenes[index]?.progress || 0.3,
    });
  }
}

/**
 * SCENE REGENERATION — re-run exactly one scene, chained off the previous
 * scene's last frame (and always the same character lock), with the visible
 * status ladder the card shows. Bounded per scene.
 */
export async function regenerateSportsScene(index: number): Promise<void> {
  const scene = state.scenes[index];
  if (!scene || state.running) return;
  if (scene.regenCount >= MAX_SCENE_REGENS) {
    patchScene(index, {
      error: `This scene has been retried ${MAX_SCENE_REGENS} times — edit the script and run the series again.`,
    });
    return;
  }
  const run = ++runSeq;
  set({ running: true, phase: 'running', error: null });
  patchScene(index, { regenCount: scene.regenCount + 1, message: `Regenerating scene ${index + 1}…`, progress: 0.04 });
  const previous = state.scenes[index - 1];
  const seed = previous && isHttpUrl(previous.lastFrameUrl) ? previous.lastFrameUrl : activeReference();
  await runScene(run, index, seed, `Regenerating scene ${index + 1} —`);
  if (run !== runSeq) return;
  set({ running: false, phase: 'done' });
}

// ---------------------------------------------------------------------------
// PROBLEM-4 SUPPORT: chat auto-detection + hand-off
// ---------------------------------------------------------------------------
export interface SportsScriptDetection {
  /** 'sports' = run it now; 'ambiguous' = ask first; 'none' = ordinary message. */
  verdict: 'sports' | 'ambiguous' | 'none';
  /** Best estimate of how many scenes the script holds (for the reply copy). */
  sceneCount: number;
}

const SPORTS_KEYWORDS_RE =
  /\b(basketball|dribbles?|dribbling|shoot(?:s|ing)?|layups?|dunk(?:s|ing)?|three-?pointers?|court|defenders?|offensive|floaters?|crossovers?|pass(?:es|ing)?|rebounds?|free[ -]?throws?)\b/i;
const SCENE_MARKER_RE = /\bscene\s*\d+\b|\bscene\s*:|(^|\n)\s*(INT|EXT)\./i;

/**
 * Classify a chat message as a multi-scene sports script.
 *
 * Matches when ANY of these hold:
 *   - it carries scene markers ('Scene 1', 'Scene:', 'INT.', 'EXT.'),
 *   - it has 5+ non-empty lines AND sports keywords,
 *   - it is over 200 characters with 2+ blank-line-separated paragraphs.
 * A match WITH sports keywords is definite ('sports'); a structural match
 * without them is 'ambiguous' — the chat asks before hijacking the message.
 */
export function detectSportsScript(text: string): SportsScriptDetection {
  const value = (text || '').trim();
  if (!value) return { verdict: 'none', sceneCount: 0 };
  const sceneMarkers = SCENE_MARKER_RE.test(value);
  const keywords = SPORTS_KEYWORDS_RE.test(value);
  const lineCount = value.split('\n').map((line) => line.trim()).filter(Boolean).length;
  const paragraphs = value
    .split(/\n\s*\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const structured = value.length > 200 && paragraphs.length >= 2;
  const matched = sceneMarkers || (lineCount >= 5 && keywords) || structured;
  if (!matched) return { verdict: 'none', sceneCount: 0 };

  const markerCount = (value.match(/\bscene\s*\d+/gi) || []).length;
  const sceneCount = Math.min(MAX_SPORTS_SCENES, Math.max(1, markerCount || paragraphs.length || 1));
  return { verdict: keywords ? 'sports' : 'ambiguous', sceneCount };
}

/**
 * The chat hand-off: pre-fill the script, switch the studio to Sports mode,
 * raise the Create app, and kick the whole pipeline off — character lock →
 * scene expansion → per-scene renders — with no further clicks.
 */
export function startSportsRunFromChat(script: string): void {
  const text = (script || '').trim();
  if (!text) return;
  setSportsScript(text);
  setStudioMode('sports');
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('openApp', { detail: { appId: 'create' } }));
  }
  void startSportsRun();
}

// ---------------------------------------------------------------------------
// Boot: restore + resume a persisted run (the persistence fix)
// ---------------------------------------------------------------------------
/**
 * RESUME a persisted run: finished scenes are kept, scenes with a render in
 * flight are re-polled on their existing job id (free), and unstarted scenes
 * are submitted in order — so reopening the app (or signing back in) shows
 * the same generating/done view the visitor left, never a blank screen.
 */
export async function resumeSportsRun(): Promise<void> {
  if (state.running || state.scenes.length === 0) return;
  const unfinished = state.scenes.some((scene) => scene.phase !== 'complete' && scene.phase !== 'failed');
  if (!unfinished) {
    if (state.phase !== 'done') set({ phase: 'done', running: false });
    return;
  }
  const run = ++runSeq;
  set({ phase: 'running', running: true, error: null });
  console.log('[Sports] resuming the persisted run — re-polling in-flight scenes and continuing the pipeline.');
  try {
    await driveScenes(run);
    if (run !== runSeq) return;
    set({ phase: 'done', running: false });
  } catch (e: any) {
    if (run !== runSeq) return;
    set({
      phase: 'done',
      running: false,
      error: (e && e.message) || 'The resumed run could not be completed.',
    });
  }
}

if (typeof window !== 'undefined' && resumeOnBoot) {
  // A short beat lets the WorkspaceDB session bootstrap before the first poll.
  window.setTimeout(() => void resumeSportsRun(), 1500);
}
