/**
 * VidVerge Create — Video Series (batch clips): the API layer.
 *
 * A SERIES is not a film. Long Video / Project stitches its scenes into one
 * MP4; a series is a LIBRARY of many separate ~10s clips — one per skill card,
 * product feature, exercise, lesson — that all share ONE locked subject so the
 * same person appears in clip 1 and clip 19. Nothing is stitched; every clip is
 * its own download.
 *
 * The input is the list of prompts the user already writes by hand for tools
 * like Flow, so `parseSeriesDoc` reads that exact markdown shape:
 *
 *   ## Dribbling                      <- category (groups the clips)
 *   **Basic Crossover** (Beginner)     <- clip title + optional level badge
 *   > On an indoor court, mid-cross…   <- the prompt (blockquote, may wrap)
 *
 * Anything else in the document — intro prose, tip bullets, `---` rules, a
 * trailing "Batching tip" section — is ignored, and a `**Standard player
 * description**` block is lifted out as the SUBJECT instead of becoming a clip,
 * because that is how these documents are written in practice.
 *
 * Each clip is rendered by its own call to the existing generate-video hook —
 * ONE clip on the model the user picked — with the IDENTICAL subject block and
 * reference image on every call, the same anti-drift lock Long Video uses.
 * Polling reuses waitForSceneRender from projectApi.ts, so there is one
 * implementation of "follow a render to its clip URL".
 *
 * THE MODEL IS THE USER'S, ON EVERY CLIP (fixed Aug 16 2026). This layer used to
 * send no `model` at all, so every clip of every batch rendered on the hook's
 * own default no matter what was picked — and the `model` column on the
 * video_series row was written but never acted on, which made the saved row a
 * record of a choice that never happened. The picker id now travels as `model` /
 * `video_model` plus legacy provider's `mode` / `legacy_mode` tier on every clip, and the
 * clip LENGTH follows the engine too (legacy provider cuts 10s, a sound model ~8s) so the
 * length the screen promises is the length that comes back.
 */
import { generateScenePreview, scopedSpaceId, sessionId, workspaceDbToken } from './studioApi';
import {
  clampText,
  DEFAULT_VIDEO_MODEL,
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
  writeFailureNotice,
} from '../../lib/reelioStudio';

export { waitForSceneRender, isContentFilterError } from './projectApi';

// ---------------------------------------------------------------------------
// Shape of a series
// ---------------------------------------------------------------------------
/** Hard ceiling on one batch — past this a run is unmanageably long. */
export const MAX_SERIES_CLIPS = 40;
/**
 * The per-clip length on LEGACY. Every clip is one whole clip of whichever engine
 * the user picked, so the honest figure is clipSecondsFor(model) below — this
 * constant remains the legacy provider answer and the default the AI clip writer is
 * briefed against.
 */
export const CLIP_SECONDS = 10;

/** The per-clip length the chosen engine will actually cut. */
export function clipSecondsFor(model: string): number {
  return longestClipSeconds(model || DEFAULT_VIDEO_MODEL);
}
/**
 * Room for one clip's own prompt. The hook rejects a scene prompt over ~1000
 * characters (character block + description + style), so this plus
 * SUBJECT_BLOCK_MAX leaves comfortable headroom — and enough that a
 * hand-written Flow prompt (the longest real one measured is 460 characters)
 * is never truncated.
 */
export const CLIP_PROMPT_MAX = 620;
export const SUBJECT_BLOCK_MAX = 240;
export const CONCURRENCY_CHOICES = [1, 2, 3] as const;

export type ClipRunStatus = 'pending' | 'submitting' | 'rendering' | 'done' | 'failed';

export interface SeriesClip {
  key: string;
  /** 1-based position across the whole series. */
  index: number;
  /** Group heading it came under, '' when the list had no headings. */
  category: string;
  title: string;
  /** Optional badge from `**Title** (Beginner)`. */
  level: string;
  prompt: string;
  include: boolean;
}

export interface ClipRun {
  status: ClipRunStatus;
  jobId?: string;
  url?: string;
  message?: string;
  error?: string;
}

/**
 * The consistency lock, built ONCE and reused verbatim on every clip's call.
 * Never rebuild it per clip.
 */
export interface SeriesSubject {
  name: string;
  description: string;
  /** The subject's portrait — display and resume only, never the seed. */
  imageUrl?: string;
  /** Sent as `character_description` on every call. */
  block: string;
  /**
   * THE anchor image, sent as `character_image_url` and
   * `reference_image_url` / `referenceImageUrl` on every call — i.e. the legacy provider
   * reference image every clip in the batch is rendered against.
   */
  referenceImageUrl: string;
  /** Prefixed to a prompt that does NOT already describe the subject. */
  seedLine: string;
}

let clipSeq = 0;
function clipKey(): string {
  clipSeq += 1;
  return `sc_${Date.now()}_${clipSeq}`;
}

function isHttpUrl(value: unknown): boolean {
  return typeof value === 'string' && /^https?:\/\//.test(value);
}

export function makeSeriesClip(
  index: number,
  category: string,
  title: string,
  level: string,
  prompt: string,
): SeriesClip {
  return {
    key: clipKey(),
    index,
    category: clampText(category, 48),
    title: clampText(title, 60) || `Clip ${index}`,
    level: clampText(level, 24),
    prompt: clampText(prompt, CLIP_PROMPT_MAX),
    include: true,
  };
}

export function renumberClips(clips: SeriesClip[]): SeriesClip[] {
  return clips.map((c, i) => ({ ...c, index: i + 1 }));
}

/** Clips in list order, grouped under their category headings. */
export function groupClips(clips: SeriesClip[]): { category: string; clips: SeriesClip[] }[] {
  const groups: { category: string; clips: SeriesClip[] }[] = [];
  clips.forEach((clip) => {
    const last = groups[groups.length - 1];
    if (last && last.category === clip.category) last.clips.push(clip);
    else groups.push({ category: clip.category, clips: [clip] });
  });
  return groups;
}

// ---------------------------------------------------------------------------
// The subject lock
// ---------------------------------------------------------------------------
export function buildSeriesSubject(character: CharacterRef): SeriesSubject {
  const description = clampText(character.description, 200);
  const referenceImageUrl = isHttpUrl(character.imageUrl) ? String(character.imageUrl) : '';
  const short = clampText(description, 70).replace(/[.…]+$/, '');
  return {
    name: character.name,
    description,
    imageUrl: character.imageUrl,
    block: clampText(`${character.name}. ${description} Identical in every clip.`, SUBJECT_BLOCK_MAX),
    referenceImageUrl,
    seedLine: referenceImageUrl
      ? `Same subject as the reference image: ${short}.`
      : `Same subject in every clip: ${short}.`,
  };
}

/**
 * The batch's ANCHOR FRAME: the subject shown in situation, drawn from the
 * first clip's own prompt.
 *
 * With a single reference image legacy provider renders image-to-video, animating out of
 * that frame, so the anchor is effectively frame 0 of every clip. A
 * plain-background portrait therefore made every clip in a library open on the
 * same studio headshot for a beat before the action started, while a full-body
 * in-situation frame blends in invisibly (video_jobs rows 73/74 vs
 * row 75, Aug 13 2026). This is one still, drawn once per batch — far cheaper
 * than a single clip — and it is only needed when the user did not already
 * draw a test frame.
 *
 * Returns '' on failure, which simply leaves the portrait as the anchor.
 */
export async function renderSubjectAnchorFrame(input: {
  subject: SeriesSubject;
  clipPrompt: string;
  aspect: AspectRatio;
  toneId: string;
}): Promise<string> {
  const prompt = clampText(
    `Cinematic film still, full-body wide shot: ${input.subject.description} ` +
      `${clampText(input.clipPrompt, 260)} ${getTone(input.toneId).prompt} mood, professional cinematography, ` +
      'high detail. The subject is shown full-body in the real setting of the action — not a studio portrait, ' +
      'not a plain background. No text, no captions, no watermarks.',
    900,
  );
  try {
    return await generateScenePreview(prompt, input.aspect);
  } catch {
    return '';
  }
}

/** Point the subject's anchor at an in-situation frame, written lock intact. */
export function withSubjectAnchorFrame(subject: SeriesSubject, frameUrl: string): SeriesSubject {
  if (!isHttpUrl(frameUrl)) return subject;
  const short = clampText(subject.description, 70).replace(/[.…]+$/, '');
  return {
    ...subject,
    referenceImageUrl: String(frameUrl),
    seedLine: `Same subject as the reference image: ${short}.`,
  };
}

/**
 * The same subject with its photo removed, keeping the written lock intact —
 * the escape hatch when the safety filter rejects the portrait (see
 * isContentFilterError). Every clip then renders on the description alone.
 */
export function withoutSubjectImage(subject: SeriesSubject): SeriesSubject {
  const short = clampText(subject.description, 70).replace(/[.…]+$/, '');
  return {
    ...subject,
    imageUrl: undefined,
    referenceImageUrl: '',
    seedLine: `Same subject in every clip: ${short}.`,
  };
}

function fingerprint(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when the clip's own prompt already spells the subject out — which is
 * exactly what hand-written Flow prompts do. In that case the seed line is NOT
 * prefixed, so the description is never sent twice and the user's carefully
 * tuned prompt survives intact.
 */
export function subjectAppearsIn(prompt: string, description: string): boolean {
  const target = fingerprint(description);
  if (target.length < 30) return false;
  return fingerprint(prompt).includes(target.slice(0, 60));
}

// ---------------------------------------------------------------------------
// Parsing a pasted prompt list
// ---------------------------------------------------------------------------
export interface ParsedSeries {
  clips: SeriesClip[];
  /** A `**Standard player description**` block, when the document had one. */
  subjectDescription: string;
  /** A leading `# Title`, when the document had one. */
  title: string;
  /** Category headings found, in order. */
  categories: string[];
}

function cleanHeading(text: string): string {
  return String(text || '')
    .replace(/[*_`#]/g, '')
    .replace(/\s*:\s*$/, '')
    .trim();
}

const SUBJECT_HEADING = /standard\s+\w*\s*(player|character|subject|person|model)\s+description/i;

/**
 * Read a hand-written prompt list into a clip queue. Deliberately forgiving:
 * only a title line followed by a blockquote becomes a clip, so intro prose,
 * tip bullets, horizontal rules and trailing notes are all skipped rather than
 * turning into junk clips.
 */
export function parseSeriesDoc(text: string): ParsedSeries {
  const lines = String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n');

  const clips: SeriesClip[] = [];
  const categories: string[] = [];
  let title = '';
  let category = '';
  let subjectDescription = '';
  let pending: { title: string; level: string; quote: string[] } | null = null;

  const flush = () => {
    const current = pending;
    pending = null;
    if (!current) return;
    const prompt = current.quote.join(' ').replace(/\s+/g, ' ').trim();
    if (!prompt) return;
    // A "standard player description" block is the SUBJECT, not a clip.
    if (SUBJECT_HEADING.test(current.title)) {
      if (!subjectDescription) subjectDescription = prompt;
      return;
    }
    if (clips.length >= MAX_SERIES_CLIPS) return;
    clips.push(makeSeriesClip(clips.length + 1, category, current.title, current.level, prompt));
    // Only headings that actually produced a clip count as categories, so a
    // trailing "Batching tip" section never inflates the count.
    if (category && categories.indexOf(category) === -1) categories.push(category);
  };

  for (const raw of lines) {
    const line = raw.trim();

    const h2 = line.match(/^#{2,}\s+(.+?)\s*$/);
    if (h2) {
      flush();
      category = cleanHeading(h2[1]);
      continue;
    }
    const h1 = line.match(/^#\s+(.+?)\s*$/);
    if (h1) {
      flush();
      if (!title) title = cleanHeading(h1[1]);
      continue;
    }

    const bold = line.match(/^\*\*(.+?)\*\*(.*)$/);
    if (bold) {
      flush();
      const levelMatch = bold[2].trim().match(/^\((.+?)\)/);
      pending = {
        title: cleanHeading(bold[1]),
        level: levelMatch ? cleanHeading(levelMatch[1]) : '',
        quote: [],
      };
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      if (pending) pending.quote.push(quote[1]);
      continue;
    }

    // A blank line may sit inside a wrapped blockquote, so it never ends a clip.
    if (line === '') continue;
    // Any other prose ends a clip that already has its prompt.
    if (pending && pending.quote.length > 0) flush();
  }
  flush();

  return { clips: renumberClips(clips), subjectDescription, title, categories };
}

/** Shown in the app as the "what should I paste?" example. */
export const FORMAT_EXAMPLE = `## Dribbling

**Basic Crossover** (Beginner)
> On an indoor court, mid-crossover dribble, ball kept low to the ground, pushing off the opposite foot to change direction sharply, eyes up and away from the ball. Gym lighting, camera at chest height tracking the move.

**Between the Legs** (Intermediate)
> Wide athletic stance dribbling the ball between the legs, ball moving forward rather than straight down, controlled with the fingertips, repeating to both sides. Indoor court, side-angle camera at knee height.

## Shooting

**Shooting Form Basics** (Beginner)
> Shooting a jump shot with textbook form: balanced feet shoulder-width apart, elbow tucked in line with the basket, wrist snapping down on the follow-through. Slow motion, side-angle camera, indoor gym.

**Free Throw Routine** (Beginner)
> At the free throw line with a consistent pre-shot routine: a deep breath, eyes on the front of the rim, then a soft-touch release. Front-on camera, calm repetitive rhythm, indoor gym.`;

// ---------------------------------------------------------------------------
// Writing a clip list with AI (for users who don't already have one)
// ---------------------------------------------------------------------------
function extractJsonArray(raw: string): any[] {
  const cleaned = String(raw || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const candidates = [cleaned];
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start !== -1 && end > start) candidates.push(cleaned.slice(start, end + 1));
  const objStart = cleaned.indexOf('{');
  const objEnd = cleaned.lastIndexOf('}');
  if (objStart !== -1 && objEnd > objStart) candidates.push(cleaned.slice(objStart, objEnd + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray(parsed.clips)) return parsed.clips;
    } catch {
      /* try the next slice */
    }
  }
  return [];
}

/**
 * Ask the model for a clip list when the user has a subject and a topic but no
 * written prompts yet. Returns [] on failure — the caller keeps the paste box.
 */
export async function writeSeriesClips(input: {
  brief: string;
  count: number;
  subjectDescription: string;
}): Promise<SeriesClip[]> {
  const count = Math.max(2, Math.min(MAX_SERIES_CLIPS, Math.round(input.count) || 8));
  const system =
    'You plan batches of short instructional/demo video clips for an AI video generator. ' +
    'Respond with ONLY valid JSON, no markdown fences: ' +
    '[{"category": string, "title": string, "level": string, "prompt": string}]. ' +
    `Rules: exactly ${count} clips; group them by putting a shared "category" on related clips and order the list so categories stay together; ` +
    '"title" is a short name for the one thing that clip demonstrates; ' +
    '"level" is "Beginner", "Intermediate" or "Advanced" (use "" when it does not apply); ' +
    `"prompt" describes ONE continuous ${CLIP_SECONDS}-second shot under 420 characters — the action, the concrete technique cues that make it correct, the setting, and the camera angle — written so a video model can render it; ` +
    'the SAME single subject performs every clip, so never describe their appearance, never rename them and never add a second person unless the clip genuinely needs a partner (then describe that partner by their kit only); ' +
    'NOTHING WRITTEN EVER APPEARS ON SCREEN — the video model cannot spell, so anything written comes out garbled: never mention text, captions, subtitles, titles, signs, labels or logos.';

  const user = [
    `Series brief: ${clampText(input.brief, 600)}`,
    input.subjectDescription
      ? `The recurring subject (already locked, do not re-describe them): ${clampText(input.subjectDescription, 300)}`
      : '',
    `Write exactly ${count} clips.`,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const res = await fetch('/proxy/openai/v1/chat/completions', {
      method: 'POST',
      // The token is REQUIRED: an anonymous proxy call is refused with 401
      // no_credentials before any model runs, and the catch below reads that as
      // "the planner had nothing for us" and quietly returns no clips. Every
      // other AI call in the app already sends it; this one did not, so the
      // "write the clip list for me" path could never work.
      headers: aiProxyHeaders(),
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: 3000,
        temperature: 0.7,
      }),
    });
    const data = await res.json().catch(() => null);
    const raw: string | undefined =
      data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!res.ok || !raw) throw new Error('the clip planner returned no content');
    const rows = extractJsonArray(raw)
      .filter((c) => c && typeof c.prompt === 'string' && c.prompt.trim())
      .slice(0, count);
    return renumberClips(
      rows.map((c, i) =>
        makeSeriesClip(
          i + 1,
          String(c.category || ''),
          String(c.title || `Clip ${i + 1}`),
          String(c.level || ''),
          String(c.prompt),
        ),
      ),
    );
  } catch (e) {
    console.warn('[Create] AI clip list failed:', e);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Rendering ONE clip through the existing generate-video hook
// ---------------------------------------------------------------------------
export interface ClipSubmitResult {
  success: boolean;
  jobId?: string;
  error?: string;
  /** Shown when the clip had to move engines — see LEGACY_FALLBACK_NOTICE. */
  notice?: string;
  /** The model this clip actually started on. */
  modelUsed?: string;
}

export async function submitClipRender(input: {
  clip: SeriesClip;
  subject: SeriesSubject;
  seriesTitle: string;
  aspect: AspectRatio;
  toneId: string;
  total: number;
  /** The picker id the user chose on Review. Passed through on every clip. */
  model?: string;
  /** Persistent parent row whose player reference is reused by every clip/video. */
  seriesId?: number | null;
}): Promise<ClipSubmitResult> {
  const { clip, subject, seriesTitle, aspect, toneId, total } = input;
  const pickedModel = input.model || DEFAULT_VIDEO_MODEL;
  const clipSeconds = clipSecondsFor(pickedModel);
  const prompt = (clip.prompt || '').trim();
  if (!prompt) return { success: false, error: 'This clip has no prompt yet.' };

  // The subject travels as text on every call — but only once: a hand-written
  // prompt that already describes them is left exactly as the user wrote it.
  // No phone clause any more: the phone_shot: false opt-out below is live in
  // the hook (Aug 15 2026), so the prompt is the user's words alone.
  const prefix = subjectAppearsIn(prompt, subject.description) ? '' : `${subject.seedLine} `;
  const room = Math.max(160, CLIP_PROMPT_MAX - prefix.length);
  const sceneDescription = `${prefix}${clampText(prompt, room)}`;

  const beats = [{ scene_description: sceneDescription, dialogue: '' }];
  // SESSION ATTRIBUTION: wait for the verified session before submitting, so
  // the video_jobs row is owned from birth — an unowned row is invisible to
  // every visitor (My Videos filters strictly on session_id).
  const sid = (await waitForDbSession()) || sessionId();
  const body: Record<string, unknown> = {
    script: JSON.stringify(beats),
    script_json: [
      {
        scene_number: 1,
        shot_type: clip.title,
        description: sceneDescription,
        dialogue: '',
        duration_seconds: clipSeconds,
      },
    ],
    character_description: subject.block,
    character_data: {
      name: subject.name,
      description: subject.description,
      image_url: subject.referenceImageUrl || undefined,
    },
    dialogues: [''],
    tone: getTone(toneId).prompt,
    aspect_ratio: aspect,
    title: `${clampText(seriesTitle, 34)} · ${clip.index}/${total} — ${clip.title}`,
    duration_seconds: clipSeconds,
    target_duration_seconds: clipSeconds,
    // A demo/teaching clip must not carry the VidVerge phone product placement
    // the hook otherwise guarantees per render. LIVE since Aug 15 2026: the
    // hook reads this opt-out and answers phone_shot: "skipped" — no injected
    // beat and no appended screen block. See tools/generate-video.ts.
    phone_shot: false,
    phoneShot: false,
    // Negative prompt (safety + quality + phone terms), both key spellings —
    // the hook forwards it to legacy provider's own negativePrompt parameter. Series
    // clips always opt out of the phone beat, so the full list applies.
    negative_prompt: FULL_NEGATIVE_PROMPT,
    negativePrompt: FULL_NEGATIVE_PROMPT,
    series_mode: !!input.seriesId,
    series_id: input.seriesId || undefined,
    series_table: input.seriesId ? 'video_series' : undefined,
  };
  if (sid) body.session_id = sid;
  // The anchor — not the portrait — travels as character_image_url too, because
  // that key outranks reference_image_url for the hook's anchor choice.
  if (subject.referenceImageUrl) body.character_image_url = subject.referenceImageUrl;
  if (subject.referenceImageUrl) {
    body.reference_image_url = subject.referenceImageUrl;
    body.referenceImageUrl = subject.referenceImageUrl;
  }

  // Every clip uses the same Omni Flash model.
  const model = getVideoModel(pickedModel);
  body.provider = model.provider;
  body.video_provider = model.provider;
  body.model = model.model;
  body.video_model = model.model;

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
// Series rows (WorkspaceDB, session-scoped)
// ---------------------------------------------------------------------------
const SERIES_TABLE = 'video_series';

function db(): any {
  if (typeof window === 'undefined') return null;
  return (window as any).__workspaceDb || null;
}

export interface SeriesClipRow {
  index: number;
  category: string;
  title: string;
  level: string;
  prompt: string;
  include: boolean;
  status: ClipRunStatus;
  jobId?: string;
  url?: string;
}

export interface SeriesRow {
  id: number;
  title?: string | null;
  source_doc?: string | null;
  subject_name?: string | null;
  subject_description?: string | null;
  subject_image_url?: string | null;
  reference_image_url?: string | null;
  player_ref_image_url?: string | null;
  subject_json?: SeriesSubject | null;
  aspect_ratio?: string | null;
  tone?: string | null;
  /**
   * The picker id every clip of this batch was rendered on. The column has
   * existed since Aug 16 2026 but nothing read or wrote it until the model was
   * actually passed through — a resumed batch now continues on the same model
   * rather than silently changing engines halfway.
   */
  model?: string | null;
  concurrency?: number | null;
  clip_count?: number | null;
  done_count?: number | null;
  clips_json?: SeriesClipRow[] | null;
  status?: string | null;
  error?: string | null;
  session_id?: string | null;
  created_at?: string;
}

export interface PersistedSeriesRow {
  /** The saved row id, or null when the row could not be saved. */
  id: number | null;
  /** Customer-safe explanation when `id` is null. Absent when the row saved. */
  notice?: string;
}

/**
 * Persistence is best-effort: a write failure never stops a render.
 *
 * `video_series` is a GUARDED table — its write policy is
 * `{ ownerColumn: 'session_id', allowSharedWrites: false,
 * requireVerifiedOwner: true }` — so the platform refuses this insert outright
 * for a visitor with no verified session: "A verified session ID is required for
 * private writes". Not retryable, and not a fault in the batch: every clip still
 * renders and still lands in My Videos, and only Resume is lost. The refusal is
 * classified and returned as plain language for the UI, rather than swallowed
 * into the console where the user silently loses Resume.
 */
export async function createSeriesRow(row: Record<string, unknown>): Promise<PersistedSeriesRow> {
  const client = db();
  if (!client || typeof client.from !== 'function') return { id: null };
  // Session guard: wait for the verified session the SDK will send as its
  // X-Session-Id header before this guarded insert, and stamp THAT id on the
  // row so the owner column always matches the header — otherwise a write
  // fired during session bootstrap is refused with "A verified session ID is
  // required for private writes" even for a signed-in visitor.
  const sid = (await waitForDbSession()) || sessionId();
  try {
    const res = await client.from(SERIES_TABLE).insert(sid ? { ...row, session_id: sid } : { ...row });
    const data = (res && (res.data || res)) as any;
    const inserted = Array.isArray(data) ? data[0] : data;
    const id = inserted && Number(inserted.id);
    return { id: Number.isFinite(id) ? id : null };
  } catch (e) {
    console.warn('[Create] createSeriesRow failed:', e);
    return { id: null, notice: writeFailureNotice(e, 'This series') };
  }
}

export async function updateSeriesRow(id: number | null, patch: Record<string, unknown>): Promise<void> {
  if (!id) return;
  const client = db();
  if (!client || typeof client.from !== 'function') return;
  // Same session guard as createSeriesRow — updates are owner-verified too.
  await waitForDbSession();
  try {
    await client.from(SERIES_TABLE).update(id, patch);
  } catch (e) {
    console.warn('[Create] updateSeriesRow failed:', e);
  }
}

export async function listSeriesRows(): Promise<SeriesRow[]> {
  const client = db();
  if (!client || typeof client.from !== 'function') return [];
  try {
    const res = await client.from(SERIES_TABLE).orderBy('created_at', 'desc').limit(25).get();
    const rows = Array.isArray(res && res.data) ? res.data : [];
    const sid = sessionId();
    // Strict session filter: only this visitor's own series. Unowned rows are
    // shown to nobody — the same deliberate rule as listOwnVideos (and this
    // table's guarded write policy means an unowned row cannot even be
    // inserted).
    return sid ? rows.filter((r: any) => r.session_id === sid) : [];
  } catch (e) {
    console.warn('[Create] listSeriesRows failed:', e);
    return [];
  }
}
