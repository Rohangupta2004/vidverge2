/**
 * VidVerge Create — LONG SERIES mode: the API layer.
 *
 * WHAT A SERIES IS HERE, and how it differs from the two modes next to it:
 *   - Long Video   → ONE film, 3–6 scenes, stitched into one MP4.
 *   - Video Series → a LIBRARY of many standalone clips, nothing stitched.
 *   - Long Series  → N EPISODES. Each episode is a 4-CLIP ASSEMBLY: four
 *                    separate renders that are stitched into ONE episode MP4,
 *                    and the whole run of episodes shares one locked character
 *                    and one carried-forward visual style.
 *
 * THE FOUR-CLIP ASSEMBLY. Every episode's script is broken into exactly
 * CLIPS_PER_EPISODE beats, each beat is its OWN generate-video render on the
 * model the user picked, and the four finished clips are concatenated into a
 * single deliverable (projectApi.stitchProject — browser ffmpeg first, the
 * platform stitch as the fallback). Four separate renders rather than one
 * four-scene job is what makes the per-clip progress in the build view real
 * ("clip 2/4"), lets a single clip be retried without re-spending the other
 * three, and — the reason that matters most — lets each clip be CHAINED to the
 * one before it.
 *
 * THE MODEL IS THE USER'S, ON EVERY SINGLE CLIP. The picker choice travels as
 * `model` / `video_model` plus legacy provider's `mode` / `legacy_mode` tier on all four
 * calls of all N episodes. Nothing here ever picks a model on its own; the one
 * exception is the same legacy provider→Google Omni Flash rescue the rest of the app
 * performs when legacy provider cannot take a render at all, and it says so out loud
 * (LEGACY_FALLBACK_NOTICE).
 *
 * HOW CONTINUITY IS HELD — two locks, and the second one follows the model.
 *   1. THE CHARACTER LOCK (identical for the entire series, never rebuilt):
 *      the same `character_description` block, the same portrait, the same
 *      in-situation anchor frame and the same seed line prefixed to every clip
 *      prompt. This is the anti-drift mechanism Long Video and Video Series
 *      already rely on, carried across episodes instead of scenes.
 *   2. THE CLIP CHAIN (within an episode): the tail frame of clip N is pulled
 *      out of the finished MP4 (POST /api/video/frames, the `video-frames`
 *      integration) and handed to clip N+1. How it is handed over depends on
 *      what the chosen engine actually supports — see continuityModeFor():
 *        'elements'   — legacy provider. Portrait + tail frame arrive as TWO reference
 *                       images, which is what routes the clip to legacy provider's
 *                       multi-image / Elements endpoint. The model derives its
 *                       own first and last frames, so no supplied still becomes
 *                       frame 0 and the character is locked by both references.
 *        'ingredient' — Gemini Omni Flash. Both images ride as
 *                       `referenceImages` ingredients (the hook's veo path), so
 *                       the scene carries forward without a hard cut-in frame.
 *        'extend'     — Veo 3.0/2.0 and Sora, which take a single seed image.
 *                       The tail frame IS that seed, so the clip literally
 *                       continues out of the previous one; the character is
 *                       carried by the block and the seed line.
 *
 * Nothing in this file reinvents the render pipeline: every clip goes through
 * the same generate-video hook and is followed with the same
 * projectApi.waitForSceneRender poller the other modes use.
 */
import { extractJson, generateScenePreview, scopedSpaceId, sessionId, workspaceDbToken } from './studioApi';
import {
  clampText,
  getTone,
  getVideoModel,
  longestClipSeconds,
  type AspectRatio,
  type CharacterRef,
} from './videoTypes';
import {
  aiProxyHeaders,
  FULL_NEGATIVE_PROMPT,
  waitForDbSession,
  workspaceUuid,
  writeFailureNotice,
} from '../../lib/reelioStudio';

// ---------------------------------------------------------------------------
// Shape of a series
// ---------------------------------------------------------------------------
/** Every episode is assembled from exactly this many clips. */
export const CLIPS_PER_EPISODE = 4;
export const MIN_EPISODES = 1;
/**
 * Ten episodes is forty renders. Past that a single run is longer than anyone
 * will sit with, and the series can simply be continued as a second run.
 */
export const MAX_EPISODES = 10;
export const EPISODE_COUNT_CHOICES = [1, 3, 5, 10];

/**
 * THE PROMPT BUDGET, worked out from what the render hook actually does rather
 * than guessed. The hook assembles each clip's final prompt in this order and
 * then hard-slices it at 1000 characters:
 *
 *   "Scene 1 of 1: " + scene_description + dialogue + ". "
 *     + <97 chars of its own lock preamble> + character_description
 *     + <265 more chars of its own lock wording> + ". " + <193-char style block>
 *
 * Its own boilerplate is ~835 characters, so SOMETHING is always trimmed on
 * every mode in this app — and because the slice takes the END, what is trimmed
 * is the hook's repeated wording rather than anything a caller sent. The two
 * numbers below are chosen so the pieces that matter always survive that slice:
 * SCENE_TEXT_MAX for the clip text (which leads the prompt, and inside which
 * the character seed line and the continuity note are written FIRST, so a long
 * description is the only thing that can lose its tail), and LOCK_BLOCK_MAX
 * small enough that the character block lands whole even on a maximum-length
 * clip — 470 + 150 + 113 + 220 sits under 1000.
 */
export const SCENE_TEXT_MAX = 470;
/** Room for one clip's own visual description, inside SCENE_TEXT_MAX. */
export const CLIP_PROMPT_MAX = 260;
export const LOCK_BLOCK_MAX = 220;
/**
 * Tighter than the app-wide DIALOGUE_MAX: a clip is one beat of four, the line
 * has to be sayable inside it, and every character it saves is a character of
 * the character lock that survives the hook's slice.
 */
export const CLIP_DIALOGUE_MAX = 110;
/** The one-line "what just happened" the next episode is planned against. */
export const RECAP_MAX = 200;

export type ClipStatus = 'pending' | 'submitting' | 'rendering' | 'done' | 'failed';
export type EpisodeStatus =
  | 'pending'
  | 'planning'
  | 'rendering'
  | 'stitching'
  | 'done'
  | 'failed';

/**
 * The character lock: built ONCE when the series is confirmed and then reused
 * verbatim on every clip of every episode. Never rebuild it per episode — that
 * is the whole anti-drift mechanism.
 */
export interface CharacterLock {
  name: string;
  description: string;
  /** The portrait / uploaded photo. Identity half of the lock. */
  portraitUrl: string;
  /**
   * An in-situation still of the same character, drawn once for the series.
   * Used as the reference on an episode's FIRST clip, where there is no
   * previous clip to chain from — a plain studio portrait as the only
   * reference makes a legacy provider image-to-video clip open on that headshot.
   */
  anchorFrameUrl: string;
  /** Sent as `character_description` on every call. */
  block: string;
  /** Prefixed to every clip prompt, so the lock travels as text too. */
  seedLine: string;
}

/** The look the series keeps between episodes, alongside the character. */
export interface SeriesStyle {
  /** Where the series lives — set, location, world. */
  world: string;
  /** Camera / grade / palette words repeated into every clip. */
  look: string;
  /** Where the whole series is going, so episode 7 still belongs to it. */
  arc: string;
}

export const EMPTY_STYLE: SeriesStyle = { world: '', look: '', arc: '' };

/** One episode's plan, before any of its clips are written. */
export interface EpisodeOutline {
  index: number;
  title: string;
  logline: string;
}

/** One of the four clips an episode is assembled from. */
export interface EpisodeClipPlan {
  index: number;
  label: string;
  prompt: string;
  dialogue: string;
}

function isHttpUrl(value: unknown): boolean {
  return typeof value === 'string' && /^https?:\/\//.test(value);
}

// ---------------------------------------------------------------------------
// The character lock
// ---------------------------------------------------------------------------
export function buildCharacterLock(character: CharacterRef): CharacterLock {
  const description = clampText(character.description, 280);
  const portraitUrl = isHttpUrl(character.imageUrl) ? String(character.imageUrl) : '';
  // The description is clamped BEFORE the series note is appended, so the note
  // can never be the thing that gets truncated away. No "identical face, hair,
  // wardrobe" wording here on purpose: the hook wraps this block in exactly
  // that, at length, and repeating it would only push its own copy past the cap.
  const blockTail = ' Identical in every clip of every episode.';
  const room = Math.max(60, LOCK_BLOCK_MAX - blockTail.length - character.name.length - 2);
  return {
    name: character.name,
    description,
    portraitUrl,
    anchorFrameUrl: '',
    block: `${character.name}. ${clampText(description, room)}${blockTail}`,
    seedLine: seedLineFor(description, portraitUrl),
  };
}

function seedLineFor(description: string, hasImage: string): string {
  const short = clampText(description, 80).replace(/[.…]+$/, '');
  return hasImage
    ? `Same character as the reference image: ${short}.`
    : `Same character in every clip: ${short}.`;
}

/** Point the lock at the in-situation anchor still, written lock intact. */
export function withAnchorFrame(lock: CharacterLock, frameUrl: string): CharacterLock {
  if (!isHttpUrl(frameUrl)) return lock;
  return {
    ...lock,
    anchorFrameUrl: String(frameUrl),
    seedLine: seedLineFor(lock.description, String(frameUrl)),
  };
}

/**
 * The same lock with both images removed, keeping the written half intact —
 * the escape hatch when the video model's safety filter keeps rejecting the
 * character photo (see projectApi.isContentFilterError). Every remaining clip
 * then renders on the description alone, which is how most of this workspace's
 * finished videos were made.
 */
export function withoutLockImages(lock: CharacterLock): CharacterLock {
  return {
    ...lock,
    portraitUrl: '',
    anchorFrameUrl: '',
    seedLine: seedLineFor(lock.description, ''),
  };
}

/**
 * The series' anchor frame: the locked character shown in the world of episode
 * 1, drawn from that episode's own opening clip. One still, drawn once per
 * series — far cheaper than a single clip — and it stops every episode opening
 * on the same studio headshot for a beat. Returns '' on failure, which simply
 * leaves the portrait as the anchor.
 */
export async function drawSeriesAnchorFrame(input: {
  lock: CharacterLock;
  openingPrompt: string;
  aspect: AspectRatio;
  toneId: string;
  style: SeriesStyle;
}): Promise<string> {
  const worldNote = input.style.world ? ` Set in ${clampText(input.style.world, 90)}.` : '';
  const prompt = clampText(
    `Cinematic film still, full-body wide shot: ${input.lock.description}. ` +
      `${clampText(input.openingPrompt, 240)}${worldNote} ${getTone(input.toneId).prompt} mood, ` +
      'professional cinematography, high detail. The character is shown full-body in the real setting of ' +
      'the action — not a studio portrait, not a plain background. No text, no captions, no watermarks.',
    900,
  );
  try {
    return await generateScenePreview(prompt, input.aspect);
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Clip length and continuity, per chosen model
// ---------------------------------------------------------------------------
/**
 * Seconds per clip for the chosen engine — legacy provider cuts exactly 5 or 10, a
 * Veo / Sora / Gemini clip caps at ~8. Ten on legacy provider because four 10s clips is a
 * 40-second episode, which is the shape a short episode wants.
 */
export function clipSecondsFor(modelId: string): number {
  return longestClipSeconds(modelId);
}

/** Runtime one episode really delivers on the chosen model. */
export function episodeSeconds(modelId: string): number {
  return clipSecondsFor(modelId) * CLIPS_PER_EPISODE;
}

export type ContinuityMode = 'ingredient';

export function continuityModeFor(_modelId: string): ContinuityMode {
  return 'ingredient';
}

export function continuityLabel(_modelId: string): string {
  return 'Omni Flash scene continuity — the portrait and previous clip’s last frame ride as reference ingredients on every clip.';
}

// ---------------------------------------------------------------------------
// The continuity frame: the tail of a finished clip
// ---------------------------------------------------------------------------
/**
 * Pull the last frame out of a finished clip so the next one can continue from
 * it (the `video-frames` integration: POST /api/video/frames returns public PNG
 * URLs). Best-effort by design — a series must never stall because a frame
 * could not be extracted, so this returns '' and the next clip falls back to
 * the series anchor frame.
 */
export async function tailFrameOf(clipUrl: string, clipSeconds: number): Promise<string> {
  if (!isHttpUrl(clipUrl)) return '';
  // Just inside the end: asking for the exact final second sometimes lands past
  // the last decodable frame.
  const at = Math.max(0.2, Math.round((clipSeconds - 0.4) * 10) / 10);
  try {
    const res = await fetch('/api/video/frames', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoUrl: clipUrl,
        timestamps: [at],
        workspaceId: workspaceUuid() || undefined,
      }),
    });
    const data = await res.json().catch(() => null);
    const frames = data && Array.isArray(data.frames) ? data.frames : [];
    const url = frames.length > 0 ? frames[0].url : '';
    return isHttpUrl(url) ? String(url) : '';
  } catch (e) {
    console.warn('[Create] continuity frame extraction failed (the series continues):', e);
    return '';
  }
}

// ---------------------------------------------------------------------------
// Planning the series
// ---------------------------------------------------------------------------
function seriesTitleFrom(brief: string): string {
  return clampText(brief, 48) || 'My series';
}

/** Deterministic outlines, used when the planner cannot be reached. */
export function buildFallbackOutlines(brief: string, count: number): EpisodeOutline[] {
  const subject = clampText(brief, 70) || 'the story';
  const shapes = [
    'sets the scene and introduces what this is all about',
    'raises the first real obstacle and shows what it costs',
    'tries the obvious answer and finds out why it is not enough',
    'finds the thing that actually works',
    'puts it to a proper test in front of everyone',
    'goes wrong at the worst possible moment',
    'recovers by doing the harder, braver thing',
    'shows what it has all added up to',
    'faces the last and biggest version of the problem',
    'lands the payoff and points at what comes next',
  ];
  return Array.from({ length: count }, (_, i) => ({
    index: i + 1,
    title: `Episode ${i + 1}`,
    logline: clampText(`${subject} — this episode ${shapes[i % shapes.length]}.`, 180),
  }));
}

export interface SeriesPlan {
  title: string;
  style: SeriesStyle;
  outlines: EpisodeOutline[];
  /** True when the planner could not be reached and the split is templated. */
  fallback: boolean;
}

async function askModel(system: string, user: string, maxTokens: number): Promise<string> {
  const res = await fetch('/proxy/openai/v1/chat/completions', {
    method: 'POST',
    // The token is required: an anonymous proxy call is refused with 401
    // no_credentials, and every caller here reads that as "fall back to the
    // template split" — so a missing header looks like a planner that never
    // works rather than a request that never arrived.
    headers: aiProxyHeaders(),
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: maxTokens,
      temperature: 0.8,
    }),
  });
  const data = await res.json().catch(() => null);
  const raw: string | undefined =
    data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : undefined;
  if (!res.ok || !raw) throw new Error('the planner returned no content');
  return String(raw);
}

/**
 * Plan the whole series in one call: a title, the world / look / arc that every
 * episode inherits, and one outline per episode that follows on from the last.
 * Falls back to the deterministic split so the user always reaches a
 * confirmable plan.
 */
export async function planSeries(input: {
  brief: string;
  episodeCount: number;
  character: CharacterRef;
  toneId: string;
  aspect: AspectRatio;
  model: string;
}): Promise<SeriesPlan> {
  const count = Math.max(MIN_EPISODES, Math.min(MAX_EPISODES, Math.round(input.episodeCount) || 3));
  const tone = getTone(input.toneId);
  const runtime = episodeSeconds(input.model);

  const system =
    'You are a series showrunner planning a short-form video series for an AI video generator. ' +
    'Respond with ONLY valid JSON, no markdown fences, in this exact shape: ' +
    '{"title": string, "world": string, "look": string, "arc": string, ' +
    '"episodes": [{"episode": number, "title": string, "logline": string}]}. ' +
    `Rules: exactly ${count} episodes, numbered from 1, in running order; ` +
    '"title" is a short series name (under 48 characters); ' +
    '"world" is the ONE setting the whole series lives in — a place a video model can render, under 160 characters; ' +
    '"look" is the camera, lighting and colour language every episode repeats, under 160 characters; ' +
    '"arc" is where the series as a whole is going, in one sentence; ' +
    'each episode "title" is 2–5 words and each "logline" is one or two sentences on what happens in THAT episode, ' +
    `and every episode has to work as a self-contained ~${runtime}-second video while still moving the arc forward; ` +
    'the SAME single character is on camera in every episode, so never introduce a replacement lead and never change their appearance or wardrobe; ' +
    'NOTHING WRITTEN EVER APPEARS ON SCREEN — the video model cannot spell, so anything written comes out garbled: ' +
    'never plan text, captions, subtitles, titles, end cards, signs, labels or logos.';

  const user = [
    `Series brief from the user: ${clampText(input.brief, 700)}`,
    `The recurring lead (identical in every episode): ${input.character.name} — ${clampText(input.character.description, 300)}`,
    `Tone: ${tone.label} (${tone.visual})`,
    `Aspect ratio: ${input.aspect}`,
    `Each episode is about ${runtime} seconds, assembled from ${CLIPS_PER_EPISODE} clips.`,
    `Plan exactly ${count} episodes.`,
  ].join('\n');

  try {
    const parsed = extractJson(await askModel(system, user, 2000));
    const rows: any[] =
      parsed && Array.isArray(parsed.episodes)
        ? parsed.episodes
        : Array.isArray(parsed)
          ? parsed
          : [];
    const outlines = rows
      .filter((e) => e && (typeof e.logline === 'string' || typeof e.title === 'string'))
      .slice(0, count)
      .map((e, i) => ({
        index: i + 1,
        title: clampText(String(e.title || `Episode ${i + 1}`), 60),
        logline: clampText(String(e.logline || ''), 240),
      }));
    if (outlines.length === 0) throw new Error('the plan came back with no episodes');
    // A planner that came back short is topped up rather than thrown away.
    const topped = buildFallbackOutlines(input.brief, count);
    while (outlines.length < count) outlines.push(topped[outlines.length]);
    return {
      title:
        parsed && typeof parsed.title === 'string' && parsed.title.trim()
          ? clampText(parsed.title, 48)
          : seriesTitleFrom(input.brief),
      style: {
        world: parsed && typeof parsed.world === 'string' ? clampText(parsed.world, 200) : '',
        look:
          parsed && typeof parsed.look === 'string' && parsed.look.trim()
            ? clampText(parsed.look, 200)
            : tone.visual,
        arc: parsed && typeof parsed.arc === 'string' ? clampText(parsed.arc, 240) : '',
      },
      outlines,
      fallback: false,
    };
  } catch (e) {
    console.warn('[Create] series planning fell back to the template split:', e);
    return {
      title: seriesTitleFrom(input.brief),
      style: { world: '', look: tone.visual, arc: clampText(input.brief, 240) },
      outlines: buildFallbackOutlines(input.brief, count),
      fallback: true,
    };
  }
}

/** Deterministic 4-beat split of one episode, when the writer cannot answer. */
export function buildFallbackClips(outline: EpisodeOutline, style: SeriesStyle): EpisodeClipPlan[] {
  const where = style.world ? ` in ${clampText(style.world, 70)}` : '';
  const look = style.look ? ` ${clampText(style.look, 80)}.` : '';
  const what = clampText(outline.logline || outline.title, 110);
  const beats: { label: string; shape: string; line: string }[] = [
    { label: 'Open', shape: `arrives${where} at the start of it: ${what}`, line: 'Right — let’s get into it.' },
    { label: 'Turn', shape: `runs straight into the problem of this episode: ${what}`, line: 'That is not going to work.' },
    { label: 'Push', shape: `works the problem hard, close on hands and effort: ${what}`, line: 'Come on. One more go.' },
    { label: 'Land', shape: `lands the moment this episode was building to: ${what}`, line: 'There it is.' },
  ];
  return beats.slice(0, CLIPS_PER_EPISODE).map((beat, i) => ({
    index: i + 1,
    label: beat.label,
    prompt: clampText(`The lead ${beat.shape}.${look}`, CLIP_PROMPT_MAX),
    dialogue: clampText(beat.line, CLIP_DIALOGUE_MAX),
  }));
}

/**
 * Write ONE episode as exactly CLIPS_PER_EPISODE continuous beats. The writer
 * is told the locked character, the series style, what happened in the previous
 * episode and anything the user typed to steer this one — which is how the
 * series stays a series rather than N unrelated videos.
 */
export async function planEpisodeClips(input: {
  outline: EpisodeOutline;
  episodeTotal: number;
  brief: string;
  lock: CharacterLock;
  style: SeriesStyle;
  toneId: string;
  clipSeconds: number;
  /** The previous episode's recap, '' for episode 1. */
  previously: string;
  /** What the user asked for between episodes, '' when they said nothing. */
  steer: string;
}): Promise<EpisodeClipPlan[]> {
  const tone = getTone(input.toneId);
  const system =
    'You are a director cutting ONE episode of a short video series into consecutive shots for an AI video generator. ' +
    'Respond with ONLY valid JSON, no markdown fences, in this exact shape: ' +
    '{"clips": [{"clip": number, "label": string, "prompt": string, "dialogue": string}]}. ' +
    `Rules: exactly ${CLIPS_PER_EPISODE} clips, numbered 1 to ${CLIPS_PER_EPISODE}, in running order; ` +
    '"label" is a 1–2 word beat name like "Open", "Turn", "Push", "Land"; ' +
    `"prompt" is a concrete visual description of that single ${input.clipSeconds}-second shot — setting, action, camera, lighting — under ${CLIP_PROMPT_MAX - 60} characters, written so a video model can render it; ` +
    `"dialogue" is one short line the lead speaks on camera, under ${CLIP_DIALOGUE_MAX} characters and never empty; ` +
    'the four clips are cut back to back into one continuous episode, so each one has to pick up exactly where the last one left off — same place, same light, same wardrobe — and the fourth has to land the episode; ' +
    'NEVER describe the lead’s appearance, name them differently, or add a second recurring person: the lead is already locked and their description travels with every clip; ' +
    'NOTHING WRITTEN EVER APPEARS ON SCREEN — the video model cannot spell, so anything written comes out garbled: never mention text, captions, subtitles, titles, end cards, signs, labels or logos.';

  const user = [
    `Series brief: ${clampText(input.brief, 400)}`,
    `Episode ${input.outline.index} of ${input.episodeTotal}: ${input.outline.title}`,
    input.outline.logline ? `What happens in it: ${clampText(input.outline.logline, 300)}` : '',
    `The locked lead (do NOT re-describe them): ${input.lock.name} — ${clampText(input.lock.description, 220)}`,
    input.style.world ? `The series setting, unchanged every episode: ${input.style.world}` : '',
    input.style.look ? `The series look, unchanged every episode: ${input.style.look}` : '',
    input.style.arc ? `Where the series is going: ${input.style.arc}` : '',
    input.previously ? `Previously, at the end of the last episode: ${clampText(input.previously, 240)}` : '',
    input.steer ? `The user has asked for this episode specifically: ${clampText(input.steer, 300)}` : '',
    `Tone: ${tone.label} (${tone.visual})`,
    `Write exactly ${CLIPS_PER_EPISODE} clips.`,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const parsed = extractJson(await askModel(system, user, 1600));
    const rows: any[] =
      parsed && Array.isArray(parsed.clips) ? parsed.clips : Array.isArray(parsed) ? parsed : [];
    const clips = rows
      .filter((c) => c && typeof c.prompt === 'string' && c.prompt.trim())
      .slice(0, CLIPS_PER_EPISODE)
      .map((c, i) => ({
        index: i + 1,
        label: clampText(String(c.label || `Clip ${i + 1}`), 24),
        prompt: clampText(String(c.prompt), CLIP_PROMPT_MAX),
        dialogue: clampText(typeof c.dialogue === 'string' ? c.dialogue : '', CLIP_DIALOGUE_MAX),
      }));
    if (clips.length === 0) throw new Error('the episode came back with no clips');
    // Short answers are topped up from the template, so an episode is always a
    // full four-clip assembly rather than a partial one.
    const filler = buildFallbackClips(input.outline, input.style);
    while (clips.length < CLIPS_PER_EPISODE) {
      clips.push({ ...filler[clips.length], index: clips.length + 1 });
    }
    return clips;
  } catch (e) {
    console.warn('[Create] episode clip planning fell back to the template beats:', e);
    return buildFallbackClips(input.outline, input.style);
  }
}

/**
 * One line describing where an episode left off, for the next episode's plan.
 * Deliberately derived from the episode's own last beat rather than a fresh
 * model call — it costs nothing and it cannot invent something that was not
 * rendered.
 */
export function recapFor(outline: EpisodeOutline, clips: EpisodeClipPlan[]): string {
  const last = clips.length > 0 ? clips[clips.length - 1] : null;
  const ending = last ? last.prompt : outline.logline;
  return clampText(`${outline.title}: ${ending}`, RECAP_MAX);
}

// ---------------------------------------------------------------------------
// Rendering ONE clip of ONE episode
// ---------------------------------------------------------------------------
export interface ClipSubmitInput {
  clip: EpisodeClipPlan;
  lock: CharacterLock;
  style: SeriesStyle;
  /** The tail frame of the previous clip. '' on an episode's first clip. */
  continuityFrameUrl: string;
  seriesTitle: string;
  episodeTitle: string;
  episodeIndex: number;
  episodeTotal: number;
  /** The picker id the user chose. Passed through to the hook on every clip. */
  model: string;
  /** Persistent parent row whose player reference is reused across episodes. */
  seriesId?: number | null;
  toneId: string;
  aspect: AspectRatio;
  clipSeconds: number;
}

export interface ClipSubmitResult {
  success: boolean;
  jobId?: string;
  error?: string;
  /** Set when the render had to move engines — see LEGACY_FALLBACK_NOTICE. */
  notice?: string;
  /** The model this clip actually started on. */
  modelUsed?: string;
}

/**
 * The prompt one clip is rendered from: the character seed line, then the
 * continuity note, then the clip's own description. Only the description tail
 * is ever truncated, so neither lock can be clipped off by the length cap.
 */
export function clipPromptFor(input: {
  clip: EpisodeClipPlan;
  lock: CharacterLock;
  style: SeriesStyle;
  hasContinuityFrame: boolean;
}): string {
  const chain = input.hasContinuityFrame
    ? `Clip ${input.clip.index}/${CLIPS_PER_EPISODE}, continuing straight on from the last: same place, wardrobe and light. `
    : `Clip ${input.clip.index}/${CLIPS_PER_EPISODE} of this episode. `;
  const prefix = `${input.lock.seedLine} ${chain}`;
  const lookNote = input.style.look ? ` ${clampText(input.style.look, 60)}.` : '';
  const room = Math.max(140, SCENE_TEXT_MAX - prefix.length - lookNote.length);
  return `${prefix}${clampText(input.clip.prompt, room)}${lookNote}`;
}

/**
 * Start ONE clip's render on the existing generate-video hook.
 *
 * Everything that holds the series together is passed identically on every
 * call: the lock's `character_description` block, the lock's images, and the
 * seed line in front of the prompt. The only thing that changes clip to clip is
 * the description and the continuity frame — and the reference keys those
 * images travel under, which follow continuityModeFor(model).
 */
export async function submitEpisodeClip(input: ClipSubmitInput): Promise<ClipSubmitResult> {
  if (!input.clip.prompt.trim()) {
    return { success: false, error: 'This clip has no visual description yet.' };
  }
  const prompt = clipPromptFor({
    clip: input.clip,
    lock: input.lock,
    style: input.style,
    hasContinuityFrame: isHttpUrl(input.continuityFrameUrl),
  });
  const dialogue = clampText(input.clip.dialogue, CLIP_DIALOGUE_MAX);
  const beats = [{ scene_description: prompt, dialogue }];
  // SESSION ATTRIBUTION: wait for the verified session before submitting, so
  // the hook's video_jobs insert is owned from birth — an unowned row is
  // invisible to every visitor (My Videos filters strictly on session_id).
  const sid = (await waitForDbSession()) || sessionId();
  const body: Record<string, unknown> = {
    script: JSON.stringify(beats),
    script_json: [
      {
        scene_number: 1,
        shot_type: input.clip.label,
        description: prompt,
        dialogue,
        duration_seconds: input.clipSeconds,
      },
    ],
    character_description: input.lock.block,
    character_data: {
      name: input.lock.name,
      description: input.lock.description,
      image_url: input.lock.portraitUrl || input.lock.anchorFrameUrl || undefined,
    },
    dialogues: [dialogue],
    tone: getTone(input.toneId).prompt,
    aspect_ratio: input.aspect,
    title:
      `${clampText(input.seriesTitle, 28)} · E${input.episodeIndex}/${input.episodeTotal} · ` +
      `Clip ${input.clip.index}/${CLIPS_PER_EPISODE} — ${clampText(input.episodeTitle, 24)}`,
    duration_seconds: input.clipSeconds,
    target_duration_seconds: input.clipSeconds,
    // An episode of a story carries no product placement: the phone beat is
    // opt-in at the hook, and every clip here says no outright.
    phone_shot: false,
    phoneShot: false,
    // Negative prompt (safety + quality + text + phone terms), both key
    // spellings — the hook forwards it to the engine's own negative parameter.
    negative_prompt: FULL_NEGATIVE_PROMPT,
    negativePrompt: FULL_NEGATIVE_PROMPT,
    series_mode: !!input.seriesId,
    series_id: input.seriesId || undefined,
    series_table: input.seriesId ? 'video_episode_series' : undefined,
  };
  if (sid) body.session_id = sid;

  // Every episode clip uses the same Omni Flash model.
  const model = getVideoModel(input.model);
  body.provider = model.provider;
  body.video_provider = model.provider;
  body.model = model.model;
  body.video_model = model.model;

  // The identity remains a reusable Omni reference ingredient. Motion is a
  // separate per-episode chain: only clip N's tail becomes clip N+1's opening
  // firstFrame, and the runner resets continuityFrameUrl before each episode so
  // no previous episode/video frame can leak into the next one.
  const chainFrame = isHttpUrl(input.continuityFrameUrl) ? input.continuityFrameUrl : '';
  const identity = input.lock.portraitUrl || input.lock.anchorFrameUrl;
  const place = chainFrame || input.lock.anchorFrameUrl;
  if (isHttpUrl(identity)) body.character_image_url = identity;
  if (chainFrame) {
    body.first_frame_url = chainFrame;
    body.firstFrameUrl = chainFrame;
  }
  if (isHttpUrl(place) && place !== identity) {
    body.reference_image_url = place;
    body.referenceImageUrl = place;
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (sid) headers['X-Session-Id'] = sid;
  const token = workspaceDbToken();
  if (token) headers['X-Workspace-DB-Token'] = token;

  const start = async (): Promise<ClipSubmitResult> => {
    const res = await fetch(`/api/hooks/execute/${scopedSpaceId()}/generate-video`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.success || !data.job_id) {
      throw new Error(
        (data && data.error) || `This clip could not be started (HTTP ${res.status}).`,
      );
    }
    return {
      success: true,
      jobId: String(data.job_id),
      notice: typeof data.notice === 'string' ? data.notice : undefined,
      modelUsed: typeof data.model_used === 'string' ? data.model_used : undefined,
    };
  };

  try {
    return await start();
  } catch (e: any) {
    return { success: false, error: (e && e.message) || 'Network error starting this clip.' };
  }
}

// ---------------------------------------------------------------------------
// Series rows (WorkspaceDB, session-scoped) — a run survives a reload, so a
// series interrupted halfway is continued instead of re-rendered.
// ---------------------------------------------------------------------------
const SERIES_TABLE = 'video_episode_series';

function db(): any {
  if (typeof window === 'undefined') return null;
  return (window as any).__workspaceDb || null;
}

export interface PersistedSeriesRow {
  /** The saved row id, or null when the row could not be saved. */
  id: number | null;
  /** Customer-safe explanation when `id` is null. Absent when it saved. */
  notice?: string;
}

/**
 * Persistence is best-effort: a write failure never stops a render.
 *
 * `video_episode_series` is a GUARDED table — `{ ownerColumn: 'session_id',
 * allowSharedWrites: false, requireVerifiedOwner: true }` — so the platform
 * refuses this insert outright for a visitor with no verified session ("A
 * verified session ID is required for private writes"). That is not retryable
 * and not a pipeline fault: every clip still renders and still lands in My
 * Videos, and only Continue-after-a-reload is lost. So the refusal is
 * classified and handed back as plain language the UI can show.
 */
export async function createSeriesRow(row: Record<string, unknown>): Promise<PersistedSeriesRow> {
  const client = db();
  if (!client || typeof client.from !== 'function') return { id: null };
  const sid = (await waitForDbSession()) || sessionId();
  try {
    const res = await client
      .from(SERIES_TABLE)
      .insert(sid ? { ...row, session_id: sid } : { ...row });
    const data = (res && (res.data || res)) as any;
    const inserted = Array.isArray(data) ? data[0] : data;
    const id = inserted && Number(inserted.id);
    return { id: Number.isFinite(id) ? id : null };
  } catch (e) {
    console.warn('[Create] createSeriesRow failed:', e);
    return { id: null, notice: writeFailureNotice(e, 'This series') };
  }
}

export async function updateSeriesRow(
  id: number | null,
  patch: Record<string, unknown>,
): Promise<void> {
  if (!id) return;
  const client = db();
  if (!client || typeof client.from !== 'function') return;
  await waitForDbSession();
  try {
    await client.from(SERIES_TABLE).update(id, patch);
  } catch (e) {
    console.warn('[Create] updateSeriesRow failed:', e);
  }
}

export interface EpisodeSeriesRow {
  id: number;
  title?: string | null;
  brief?: string | null;
  episode_count?: number | null;
  episodes_done?: number | null;
  model?: string | null;
  continuity_mode?: string | null;
  aspect_ratio?: string | null;
  clip_seconds?: number | null;
  character_name?: string | null;
  character_image_url?: string | null;
  player_ref_image_url?: string | null;
  episodes_json?: any[] | null;
  status?: string | null;
  session_id?: string | null;
  created_at?: string;
}

export async function listSeriesRows(): Promise<EpisodeSeriesRow[]> {
  const client = db();
  if (!client || typeof client.from !== 'function') return [];
  try {
    const res = await client.from(SERIES_TABLE).orderBy('created_at', 'desc').limit(25).get();
    const rows = Array.isArray(res && res.data) ? res.data : [];
    const sid = sessionId();
    // Strict session filter: only this visitor's own series. Unowned rows are
    // shown to nobody — the same deliberate rule as the rest of the app.
    return sid ? rows.filter((r: any) => r.session_id === sid) : [];
  } catch (e) {
    console.warn('[Create] listSeriesRows failed:', e);
    return [];
  }
}
