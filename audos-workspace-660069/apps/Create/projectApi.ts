/**
 * VidVerge Create — Long Video / Project mode: the API layer.
 *
 * The short-video flow submits ONE generate-video job whose scenes the render
 * hook turns into a handful of legacy provider clips. A project is the long form of that:
 * 3–6 sequential scenes of 10–20s each, every scene rendered by its OWN
 * generate-video call, with the SAME character anchor — the identical
 * `reference_image_url` and the identical character block — injected into
 * every single call. That lock is the whole point of this mode: it is what
 * stops the face drifting between scenes.
 *
 * Nothing here reinvents the render pipeline. Each scene goes through the
 * existing generate-video hook and is followed with check-video-status,
 * exactly the way apps/Create/studioApi.ts submitStudioVideo() does it for a
 * short video. The only new work is the plan → sequence → stitch loop.
 *
 * STITCHING — three paths, tried in this order:
 *   1. In-browser ffmpeg stream-copy concat (lib/client-stitch.ts) uploaded to
 *      GCS via POST /api/upload/file. It is the PRIMARY path because it is the
 *      only one that keeps any audio a clip carries: the platform's own ffmpeg
 *      concat drops every input audio stream (verified Aug 8 2026 and filed in
 *      the platform bug pipeline). legacy provider clips are silent, so on a legacy provider render
 *      this only matters for picture quality — both paths look the same.
 *   2. POST /api/workspaces/:uuid/videos/stitch — the platform's server-side
 *      ffmpeg merge (the `video-stitch` integration). It normalizes its inputs
 *      and has no size ceiling, but it is silent today, so it is the fallback
 *      for the cases the browser remux cannot cover: ffmpeg.wasm blocked, clip
 *      bytes over the ~45MB in-memory/upload cap (reachable on a 90s–120s
 *      project), or clips whose codec parameters differ between jobs, which a
 *      `-c copy` concat cannot join.
 *   3. Neither worked: the numbered per-scene clips are handed over as they
 *      are and labelled as separate files — never presented as one video.
 *
 * SESSION RULE (same as the rest of the app): every WorkspaceDB write carries
 * session_id and every read is re-filtered to the current session.
 */
import {
  checkVideoStatus,
  contentBlockReason,
  extractJson,
  isJobLostStatus,
  scopedSpaceId,
  sessionId,
  type RenderStatus,
} from './studioApi';
import {
  clampText,
  DIALOGUE_MAX,
  getTone,
  getVideoModel,
  type AspectRatio,
  type CharacterRef,
} from './videoTypes';
import { stitchAndUploadClips } from '../../lib/client-stitch';
import {
  aiProxyHeaders,
  FULL_NEGATIVE_PROMPT,
  PHONE_OK_NEGATIVE_PROMPT,
  waitForDbSession,
  workspaceUuid,
  writeFailureNotice,
} from '../../lib/reelioStudio';

// ---------------------------------------------------------------------------
// Shape of a project
// ---------------------------------------------------------------------------
export const MIN_PROJECT_SCENES = 3;
export const MAX_PROJECT_SCENES = 6;
export const MIN_SCENE_SECONDS = 10;
export const MAX_SCENE_SECONDS = 20;
/**
 * The clause used on the ONE scene the user picked for the phone shot. Naming
 * a held phone makes the hook attach its phone-screen block here. Applied to
 * that scene's FIRST beat only, so a 2–3 beat scene still contains exactly one
 * phone moment.
 *
 * Every OTHER scene sends the `phone_shot: false` opt-out instead — LIVE in
 * the hook since Aug 15 2026 (it answers phone_shot: "skipped"), which is what
 * retired the old NO_HELD_PHONE_CLAUSE background-scenery workaround.
 */
export const HELD_PHONE_CLAUSE =
  ' They hold up their smartphone towards camera, its screen facing the viewer.';

/**
 * Per-beat description budget for project scenes. Larger than the short flow's
 * SCENE_MAX because the seed line and the phone clause both have to fit
 * alongside the scene itself; still well inside the hook's ~1000-character cap
 * once the character block and style words are added.
 */
const PROJECT_SCENE_MAX = 480;

/** One legacy provider clip is 10s at most, so a 10–20s scene renders as 1–2 beats. */
export const SECONDS_PER_BEAT = 10;
export const MAX_BEATS_PER_SCENE = 3;

export const PROJECT_LENGTHS = [
  { seconds: 45, label: '45s' },
  { seconds: 60, label: '60s' },
  { seconds: 90, label: '90s' },
  { seconds: 120, label: '2 min' },
] as const;

/** One scene of the confirmed plan. */
export interface PlannedScene {
  key: string;
  /** 1-based position in the video. */
  index: number;
  label: string;
  prompt: string;
  dialogue: string;
  durationSec: number;
}

export type SceneRunStatus = 'pending' | 'submitting' | 'rendering' | 'done' | 'failed';

/** Live state of one scene's render. */
export interface SceneRun {
  status: SceneRunStatus;
  jobId?: string;
  clipUrls: string[];
  message?: string;
  error?: string;
}

export interface ProjectBrief {
  brand: string;
  brandContext: string;
  brief: string;
  toneId: string;
  aspect: AspectRatio;
  targetSeconds: number;
  /** Optional product / brand shot: shown to the planner and used as the
   *  anchor image when the character has no photo. */
  productImageUrl?: string;
  /** Vision read of that image — every scene prompt is written against it. */
  productReference?: string;
  /**
   * Whether the film carries the VidVerge phone-mockup beat at all. Undefined
   * counts as OFF: the beat is opt-in everywhere since Aug 15 2026, so a project
   * saved before the checkbox existed resumes WITHOUT a product placement rather
   * than gaining one nobody asked for.
   */
  phoneShot?: boolean;
  /** 1-based scene that carries it. Undefined = the final (CTA) scene. */
  phoneShotScene?: number;
  /**
   * The picker id every scene of this project renders on (one of
   * videoTypes.VIDEO_MODELS). It lives on the brief so it persists in the
   * project row's brief_json and a resumed project carries on with the model
   * it was started on. Absent (projects saved before the picker existed)
   * keeps the generate-video hook's own default engine, exactly as before.
   */
  model?: string;
}

/**
 * Which scene of a project should carry the phone beat, or null when the user
 * never asked for one (the default). Clamped to the plan, so deleting scenes
 * after choosing one can never leave the choice pointing past the end.
 */
export function resolvePhoneShotScene(brief: ProjectBrief, sceneTotal: number): number | null {
  if (brief.phoneShot !== true) return null;
  const total = Math.max(1, Math.round(sceneTotal) || 1);
  const wanted = Number(brief.phoneShotScene);
  if (!Number.isFinite(wanted) || wanted < 1) return total;
  return Math.min(total, Math.round(wanted));
}

/**
 * The anti-drift lock, built ONCE when the plan is confirmed and then reused
 * verbatim on every scene's generate-video call. Never rebuild it per scene.
 */
export interface CharacterAnchor {
  name: string;
  description: string;
  /** The character's portrait — display and resume only, never the seed. */
  imageUrl?: string;
  /** Sent as `character_description` on every call. */
  block: string;
  /**
   * THE anchor image, sent as `character_image_url` and
   * `reference_image_url` / `referenceImageUrl` on every call — i.e. the legacy provider
   * reference image every clip of the film is rendered against.
   */
  referenceImageUrl: string;
  /** Prefixed to every scene's prompt so the lock also travels as text. */
  seedLine: string;
}

let sceneSeq = 0;
function sceneKey(): string {
  sceneSeq += 1;
  return `pj_${Date.now()}_${sceneSeq}`;
}

function isHttpUrl(value: unknown): boolean {
  return typeof value === 'string' && /^https?:\/\//.test(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// The character lock
// ---------------------------------------------------------------------------
export function buildCharacterAnchor(
  character: CharacterRef,
  fallbackImageUrl?: string,
  openingFrameUrl?: string,
): CharacterAnchor {
  const description = clampText(character.description, 300);
  // OPENING-FRAME ANCHOR: with a single reference image legacy provider renders
  // image-to-video, animating out of that frame — so the anchor is effectively
  // frame 0 of every clip in the film. A plain-background portrait therefore
  // made each scene open on that headshot for a beat before the action
  // started, while an in-situation frame blends in invisibly
  // (video_jobs rows 73/74 vs row 75, Aug 13 2026). The approved scene-1 still
  // already shows this character in the world of the film, so it leads the
  // priority. ONE anchor is still reused verbatim for the whole project — that
  // is what holds the face across scenes — it is just an in-situation frame
  // now instead of a studio portrait.
  const referenceImageUrl = String(
    [openingFrameUrl, character.imageUrl, fallbackImageUrl].find((url) => isHttpUrl(url)) || '',
  );
  const short = clampText(description, 85).replace(/[.…]+$/, '');
  return {
    name: character.name,
    description,
    imageUrl: character.imageUrl,
    block: clampText(
      `${character.name}. ${description} The SAME person appears in every scene — identical face, hair, skin tone, wardrobe and build in every shot.`,
      360,
    ),
    referenceImageUrl,
    seedLine: referenceImageUrl
      ? `Same character as start image: ${short}.`
      : `Same character in every scene: ${short}.`,
  };
}

/**
 * The same anchor with its IMAGE half removed, keeping the text lock intact.
 *
 * Used when the video model's safety filter rejects the character photo (see
 * isContentFilterError). The description-only lock is how most of this
 * workspace's finished videos were made, so dropping the photo lets the rest of
 * the project render instead of dead-ending. It is a fallback, not the better
 * option: an image anchor that clears the filter really does hold the face
 * across scenes (video_jobs rows 73, 74 and 75, Aug 13 2026).
 */
export function withoutImageAnchor(anchor: CharacterAnchor): CharacterAnchor {
  const short = clampText(anchor.description, 85).replace(/[.…]+$/, '');
  return {
    ...anchor,
    imageUrl: undefined,
    referenceImageUrl: '',
    seedLine: `Same character in every scene: ${short}.`,
  };
}

/** How many ~8s Veo clips one planned scene is rendered as. */
export function beatCountFor(durationSec: number): number {
  const raw = Math.round((durationSec || MIN_SCENE_SECONDS) / SECONDS_PER_BEAT);
  return Math.max(1, Math.min(MAX_BEATS_PER_SCENE, raw));
}

/** Honest runtime of a scene once it is rendered as whole ~8s clips. */
export function estimatedSecondsFor(durationSec: number): number {
  return beatCountFor(durationSec) * SECONDS_PER_BEAT;
}

export function estimatedTotalSeconds(scenes: PlannedScene[]): number {
  return scenes.reduce((sum, s) => sum + estimatedSecondsFor(s.durationSec), 0);
}

export function makePlannedScene(
  index: number,
  label: string,
  prompt: string,
  dialogue: string,
  durationSec: number,
): PlannedScene {
  return {
    key: sceneKey(),
    index,
    label: clampText(label, 40) || `Scene ${index}`,
    prompt: clampText(prompt, 260),
    dialogue: clampText(dialogue, DIALOGUE_MAX),
    durationSec: Math.min(
      MAX_SCENE_SECONDS,
      Math.max(MIN_SCENE_SECONDS, Math.round(durationSec) || MIN_SCENE_SECONDS),
    ),
  };
}

// ---------------------------------------------------------------------------
// Scene planning: one brief -> a structured scene list
// ---------------------------------------------------------------------------
export interface ScenePlan {
  title: string;
  scenes: PlannedScene[];
  /** True when the AI planner could not be reached and the split is templated. */
  fallback: boolean;
}

function targetSceneCount(targetSeconds: number): number {
  const raw = Math.round(targetSeconds / 15);
  return Math.max(MIN_PROJECT_SCENES, Math.min(MAX_PROJECT_SCENES, raw));
}

const FALLBACK_BEATS: { label: string; shape: string; line: string }[] = [
  {
    label: 'Intro',
    shape: 'opens the video and introduces who they are and what this is about',
    line: "Let me show you what we've built.",
  },
  {
    label: 'The problem',
    shape: 'names the problem the audience actually has, in one concrete moment',
    line: 'This is the part everyone struggles with.',
  },
  {
    label: 'Product demo',
    shape: 'shows the product being used, close on the thing itself and what it does',
    line: 'Here it is, working — start to finish.',
  },
  {
    label: 'Proof',
    shape: 'shows the result: the payoff, the before-and-after, the detail that convinces',
    line: 'That is the difference, right there.',
  },
  {
    label: 'Testimonial',
    shape: 'speaks straight to camera about what changed for them, warm and unscripted',
    line: "Honestly, I wouldn't go back.",
  },
  {
    label: 'Call to action',
    shape: 'closes with a clear, direct call to action to camera',
    line: 'Try it today — the link is right there.',
  },
];

/** Deterministic split used when the AI planner cannot be reached. */
export function buildFallbackPlan(brief: ProjectBrief, character: CharacterRef): ScenePlan {
  const count = targetSceneCount(brief.targetSeconds);
  const tone = getTone(brief.toneId);
  const subject = clampText(brief.brand || brief.brief || 'the product', 60);
  const perScene = Math.min(
    MAX_SCENE_SECONDS,
    Math.max(MIN_SCENE_SECONDS, Math.round(brief.targetSeconds / count)),
  );
  // Keep the opening and closing beats, trim from the middle.
  const picked =
    count >= FALLBACK_BEATS.length
      ? FALLBACK_BEATS
      : [
          FALLBACK_BEATS[0],
          ...FALLBACK_BEATS.slice(1, FALLBACK_BEATS.length - 1).slice(0, count - 2),
          FALLBACK_BEATS[FALLBACK_BEATS.length - 1],
        ];
  const productNote = brief.productReference
    ? ` The product matches this exactly: ${clampText(brief.productReference, 90)}`
    : '';
  return {
    title: clampText(`${subject} — ${brief.targetSeconds}s film`, 60),
    scenes: picked.map((beat, i) =>
      makePlannedScene(
        i + 1,
        beat.label,
        `${character.name} ${beat.shape}, for ${subject}. ${tone.visual}.${productNote}`,
        beat.line,
        perScene,
      ),
    ),
    fallback: true,
  };
}

/**
 * Decompose the user's single brief into a sequential scene plan with the same
 * chat/LLM mechanism the app already uses for script writing (the platform
 * OpenAI proxy). Falls back to the deterministic split above on any failure,
 * so the user always reaches a confirmable plan.
 */
export async function planScenes(brief: ProjectBrief, character: CharacterRef): Promise<ScenePlan> {
  const count = targetSceneCount(brief.targetSeconds);
  const tone = getTone(brief.toneId);
  const perScene = Math.min(
    MAX_SCENE_SECONDS,
    Math.max(MIN_SCENE_SECONDS, Math.round(brief.targetSeconds / count)),
  );

  const system =
    'You are a video director breaking one brief into a sequential shot plan for an AI video generator. ' +
    'Respond with ONLY valid JSON, no markdown fences, in this exact shape: ' +
    '{"title": string, "scenes": [{"scene": number, "label": string, "prompt": string, "dialogue": string, "durationSec": number}]}. ' +
    `Rules: exactly ${count} scenes, in story order, numbered from 1; ` +
    `"label" is a 1-3 word beat name like "Intro", "Product demo", "Testimonial", "CTA"; ` +
    `"prompt" is a concrete visual description of that scene (setting, action, camera, lighting) under 240 characters, written so a video model can render it; ` +
    `"dialogue" is one short punchy line the character speaks on camera, under ${DIALOGUE_MAX} characters (never empty — the character always speaks); ` +
    `"durationSec" is between ${MIN_SCENE_SECONDS} and ${MAX_SCENE_SECONDS} and the scenes together add up to roughly ${brief.targetSeconds} seconds; ` +
    'the first scene hooks the viewer in the first 2 seconds and the last scene closes with a clear call to action; ' +
    'the SAME single character is on camera in every scene, so never introduce a second person and never describe a change of wardrobe or appearance; ' +
    'NOTHING WRITTEN EVER APPEARS ON SCREEN — the video model cannot spell, so anything written comes out garbled: never mention text, captions, subtitles, titles, end cards, signs, labels, logos or a wordmark; ' +
    'never mention the character\'s name changing.';

  const context = [
    `Brief from the user: ${clampText(brief.brief, 700)}`,
    brief.brand ? `Brand / product: ${clampText(brief.brand, 120)}` : '',
    brief.brandContext ? `Brand context: ${clampText(brief.brandContext, 400)}` : '',
    `On-camera character (identical in every scene): ${character.name} — ${clampText(character.description, 300)}`,
    `Tone: ${tone.label} (${tone.visual})`,
    `Aspect ratio: ${brief.aspect}`,
    `Target total length: about ${brief.targetSeconds} seconds across exactly ${count} scenes of about ${perScene} seconds each.`,
    brief.productReference
      ? `The user uploaded a product/brand image. It shows: ${clampText(brief.productReference, 400)}. Every scene that shows the product must describe it matching that exactly.`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const res = await fetch('/proxy/openai/v1/chat/completions', {
      method: 'POST',
      // The token is required: an anonymous proxy call is refused with 401
      // no_credentials, which this planner would read as "use the fallback plan".
      headers: aiProxyHeaders(),
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: context },
        ],
        max_tokens: 1600,
        temperature: 0.7,
      }),
    });
    const data = await res.json().catch(() => null);
    const raw: string | undefined =
      data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!res.ok || !raw) throw new Error('scene planning returned no content');

    const parsed = extractJson(raw);
    const rawScenes: any[] = Array.isArray(parsed)
      ? parsed
      : parsed && Array.isArray(parsed.scenes)
        ? parsed.scenes
        : [];
    const scenes = rawScenes
      .filter((s) => s && typeof s.prompt === 'string' && s.prompt.trim())
      .slice(0, MAX_PROJECT_SCENES)
      .map((s, i) =>
        makePlannedScene(
          i + 1,
          String(s.label || `Scene ${i + 1}`),
          String(s.prompt),
          typeof s.dialogue === 'string' ? s.dialogue : '',
          Number(s.durationSec) || perScene,
        ),
      );
    if (scenes.length < MIN_PROJECT_SCENES) {
      throw new Error(`plan came back with ${scenes.length} scene(s)`);
    }
    const fallbackTitle = buildFallbackPlan(brief, character).title;
    return {
      title:
        parsed && !Array.isArray(parsed) && typeof parsed.title === 'string' && parsed.title.trim()
          ? clampText(parsed.title, 60)
          : fallbackTitle,
      scenes,
      fallback: false,
    };
  } catch (e) {
    console.warn('[Create] scene planning fell back to the template split:', e);
    return buildFallbackPlan(brief, character);
  }
}

/** Renumber after an edit or a delete so labels and indexes stay honest. */
export function renumberScenes(scenes: PlannedScene[]): PlannedScene[] {
  return scenes.map((s, i) => ({ ...s, index: i + 1 }));
}

// ---------------------------------------------------------------------------
// Rendering one scene through the existing generate-video hook
// ---------------------------------------------------------------------------
function hookHeaders(sid: string | null = sessionId()): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (sid) headers['X-Session-Id'] = sid;
  const workspaceClient = typeof window !== 'undefined' ? (window as any).__workspaceDb : null;
  const token = workspaceClient && typeof workspaceClient.token === 'string' ? workspaceClient.token : '';
  if (token) headers['X-Workspace-DB-Token'] = token;
  return headers;
}

/**
 * The ~8s beats one scene is rendered as. The anchor's seed line leads EVERY
 * beat, and only the description tail is ever truncated, so the character
 * reference can never be clipped off by the length cap.
 */
export function beatsForScene(
  scene: PlannedScene,
  anchor: CharacterAnchor,
  brief: ProjectBrief,
  carriesPhoneShot = false,
): { scene_description: string; dialogue: string }[] {
  const beats = beatCountFor(scene.durationSec);
  // Only scenes that actually show the thing carry the product reference —
  // pushing it into a pure talking-head beat invents props.
  const productNote =
    brief.productReference &&
    /\b(product|packaging|pack|box|bottle|device|app|screen|phone|laptop|unbox\w*)\b/i.test(scene.prompt)
      ? ` Product matches the reference exactly: ${clampText(brief.productReference, 80)}`
      : '';
  return Array.from({ length: beats }, (_, k) => {
    const continuity =
      beats > 1 ? ` Part ${k + 1}/${beats} of one continuous shot — same place, same wardrobe, same light.` : '';
    const prefix = `${anchor.seedLine}${continuity} `;
    // The chosen scene shows the phone once, on its opening beat; its later
    // beats say nothing about a phone. Every other scene relies on the
    // phone_shot: false opt-out sent by submitSceneRender (live in the hook
    // since Aug 15 2026), so no scenery clause is needed any more.
    const phoneClause = carriesPhoneShot && k === 0 ? HELD_PHONE_CLAUSE : '';
    // The scene text is clamped BEFORE the phone clause is appended, so the
    // clause can never be the thing that gets truncated away.
    const room = Math.max(60, PROJECT_SCENE_MAX - prefix.length - phoneClause.length);
    return {
      scene_description: `${prefix}${clampText(`${scene.prompt}${productNote}`, room)}${phoneClause}`,
      dialogue: k === 0 ? clampText(scene.dialogue, DIALOGUE_MAX) : '',
    };
  });
}

export interface SceneSubmitResult {
  success: boolean;
  jobId?: string;
  error?: string;
  /** Shown when the scene had to move engines — see LEGACY_FALLBACK_NOTICE. */
  notice?: string;
  /** The model this scene actually started on. */
  modelUsed?: string;
}

/**
 * Start ONE scene's render on the existing generate-video hook.
 *
 * Everything that makes the character consistent is passed identically on
 * every call of a project: `character_description` is the anchor block,
 * `reference_image_url` / `referenceImageUrl` is the one anchor image (both
 * spellings, because the live hook reads snake_case while the pending patch
 * reads camelCase — see tools/generate-video.ts), and every beat's
 * description is prefixed with the anchor's seed line.
 */
export async function submitSceneRender(input: {
  scene: PlannedScene;
  anchor: CharacterAnchor;
  brief: ProjectBrief;
  projectTitle: string;
  sceneTotal: number;
}): Promise<SceneSubmitResult> {
  const { scene, anchor, brief, projectTitle, sceneTotal } = input;
  const phoneShotScene = resolvePhoneShotScene(brief, sceneTotal);
  const carriesPhoneShot = phoneShotScene !== null && scene.index === phoneShotScene;
  const beats = beatsForScene(scene, anchor, brief, carriesPhoneShot);
  if (beats.length === 0 || !beats[0].scene_description.trim()) {
    return { success: false, error: 'This scene has no visual description yet.' };
  }
  const durationSeconds = beats.length * SECONDS_PER_BEAT;
  // SESSION ATTRIBUTION: wait for the verified session before submitting, so
  // the video_jobs row is owned from birth — an unowned row is invisible to
  // every visitor (My Videos filters strictly on session_id).
  const sid = (await waitForDbSession()) || sessionId();
  // Negative prompt (safety + quality + phone terms). The one scene that
  // deliberately carries the held-phone beat sends the PHONE_OK list instead,
  // so the negative can never fight HELD_PHONE_CLAUSE.
  const negativeList = carriesPhoneShot ? PHONE_OK_NEGATIVE_PROMPT : FULL_NEGATIVE_PROMPT;
  const body: Record<string, unknown> = {
    script: JSON.stringify(beats),
    script_json: beats.map((b, i) => ({
      scene_number: i + 1,
      shot_type: scene.label,
      description: b.scene_description,
      dialogue: b.dialogue,
      duration_seconds: SECONDS_PER_BEAT,
    })),
    character_description: anchor.block,
    character_data: {
      name: anchor.name,
      description: anchor.description,
      image_url: anchor.referenceImageUrl || undefined,
    },
    dialogues: beats.map((b) => b.dialogue),
    tone: getTone(brief.toneId).prompt,
    aspect_ratio: brief.aspect,
    title: `${clampText(projectTitle, 40)} · Scene ${scene.index}/${sceneTotal} — ${scene.label}`,
    duration_seconds: durationSeconds,
    target_duration_seconds: durationSeconds,
    // Negative prompt, both key spellings — the hook forwards it to legacy provider's
    // own negativePrompt parameter. See FULL_NEGATIVE_PROMPT.
    negative_prompt: negativeList,
    negativePrompt: negativeList,
  };
  if (sid) body.session_id = sid;
  // The phone-mockup beat is OPT-IN at the hook, and a project is one render per
  // scene — so every scene says which it wants outright: the ONE scene the user
  // picked asks for the beat, and all the others refuse it. Nothing is left to a
  // default (an absent argument used to mean "add the beat", which is how films
  // that switched the checkbox off still ended up with a phone in shot one).
  body.phone_shot = carriesPhoneShot;
  body.phoneShot = carriesPhoneShot;
  // The anchor — not the portrait — travels as character_image_url too, because
  // that key outranks reference_image_url for the hook's anchor choice.
  if (anchor.referenceImageUrl) body.character_image_url = anchor.referenceImageUrl;
  if (brief.productImageUrl) body.product_images = [brief.productImageUrl];
  if (anchor.referenceImageUrl) {
    body.reference_image_url = anchor.referenceImageUrl;
    body.referenceImageUrl = anchor.referenceImageUrl;
  }

  // THE USER'S MODEL, ON EVERY SCENE — the same shape studioApi's
  // submitStudioVideo() sends: the picker id resolved into a bare provider
  // model id plus legacy provider's render tier, each under both key spellings so
  // whichever the hook reads, the choice lands. A project saved before the
  // picker existed carries no model and keeps the hook's own default.
  const pickedModel = getVideoModel(brief.model || 'gemini-omni-flash-preview');
  body.provider = pickedModel.provider;
  body.video_provider = pickedModel.provider;
  body.model = pickedModel.model;
  body.video_model = pickedModel.model;

  /** One submit attempt. Throws on anything that stopped the render starting. */
  const start = async (): Promise<SceneSubmitResult> => {
    const res = await fetch(`/api/hooks/execute/${scopedSpaceId()}/generate-video`, {
      method: 'POST',
      headers: hookHeaders(sid),
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.success || !data.job_id) {
      throw new Error(
        (data && data.error) || `The scene render could not be started (HTTP ${res.status}).`,
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
    return { success: false, error: (e && e.message) || 'Network error starting the scene render.' };
  }
}

/**
 * True when a render died on the video model's content/safety filter rather
 * than a transient hiccup — e.g. "Content filtered: The image was flagged as
 * containing a celebrity likeness".
 *
 * These are NOT deterministic, despite what the rejection message implies: the
 * identical photo, sent as the identical start image, completed on a later
 * attempt (video_jobs row 75, Aug 13 2026). So retrying the same input CAN
 * work — the UI steers the user to change the input because that is the
 * RELIABLE fix, and additionally offers ONE manual "Try that photo again"
 * re-run (the user explicitly spends one extra render to keep the image
 * anchor, which holds the face better than the text-only lock). The live
 * pipeline records the real reason and deliberately skips its own auto-retry
 * for these to control spend (verified on video_jobs row 72: retry_count
 * stayed 0).
 */
export function isContentFilterError(message?: string | null): boolean {
  const text = String(message || '');
  if (!text) return false;
  return /content filter|content_filter|celebrity likeness|safety filter|flagged as containing|blocked by safety/i.test(
    text,
  );
}

/**
 * PER-SCENE POLLING RAMP (the "every scene feels slow" fix, Sep 12 2026): the
 * old fixed 10s interval left every FINISHED scene sitting undetected for up
 * to 10 extra seconds — per scene, on every mode that renders scene by scene.
 * Polling now starts at SCENE_POLL_MIN_MS and backs off 1.5x per ask to the
 * SCENE_POLL_MS ceiling, so a finished scene is noticed within ~4s worst case
 * (~2s typical) while a long render still asks the status hook only ~15 times
 * a minute. Sub-second polling is deliberately NOT used: every check is a hook
 * execution, and hammering it invites the 429s whose bounded retry ladder
 * would hand back every second this saves.
 */
export const SCENE_POLL_MIN_MS = 1000;
/** The backoff ceiling — kept under its old name for existing callers. */
export const SCENE_POLL_MS = 4000;
export const SCENE_TIMEOUT_MS = 16 * 60 * 1000;
/**
 * Consecutive status CALLS that may fail outright before the scene is declared
 * unreachable. A couple are a wobbly connection and the loop rides them out;
 * eight in a row means nothing is coming back, and the caller's Retry is a
 * better answer than polling silently until the 16-minute ceiling.
 */
const MAX_STATUS_POLL_FAILURES = 8;

export interface SceneRenderResult {
  clipUrls: string[];
  workspaceUuid?: string;
  audio?: string;
}

/**
 * The raw clips of a finished job, in order. `clip_urls` is preferred over
 * `download_url` when the hook offers it, because on the Veo-era path the
 * platform-stitched cut is video-only while the individual clips carry the
 * audio. A legacy provider job is silent throughout and reports no clip_urls, so this
 * simply falls through to the delivered file.
 */
function clipsFromStatus(status: RenderStatus): string[] {
  if (Array.isArray(status.clip_urls)) {
    const clips = status.clip_urls.filter(isHttpUrl) as string[];
    if (clips.length > 0) return clips;
  }
  return isHttpUrl(status.download_url) ? [String(status.download_url)] : [];
}

/** Poll check-video-status until this scene's clips exist, or it fails. */
export async function waitForSceneRender(
  jobId: string,
  opts: {
    onTick?: (message: string, status: RenderStatus) => void;
    isAborted?: () => boolean;
    pollMs?: number;
    timeoutMs?: number;
  } = {},
): Promise<SceneRenderResult> {
  const pollMaxMs = opts.pollMs || SCENE_POLL_MS;
  const timeoutMs = opts.timeoutMs || SCENE_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let pollMs = Math.min(SCENE_POLL_MIN_MS, pollMaxMs);
  let statusFailures = 0;

  while (Date.now() < deadline) {
    if (opts.isAborted && opts.isAborted()) throw new Error('aborted');
    const status = await checkVideoStatus(jobId);
    if (opts.isAborted && opts.isAborted()) throw new Error('aborted');

    if (!status.success) {
      // HARD 404 / LOST-JOB FAILURE (Sep 12 2026): a job the render service no
      // longer knows (provider 404 / "not found") can never complete — fail
      // this scene NOW with a fresh-submit Retry instead of re-polling an
      // answer that cannot change until the 16-minute ceiling.
      if (isJobLostStatus(status.error)) {
        throw new Error('The render service no longer recognises this scene’s render job — it was lost provider-side. Retry the scene to submit it fresh.');
      }
      statusFailures += 1;
      if (statusFailures >= MAX_STATUS_POLL_FAILURES) {
        throw new Error('We lost contact with the render service for this scene. It may still finish — retry it in a moment.');
      }
    } else {
      statusFailures = 0;
    }

    const ready =
      status.success && (status.stage === 'ready' || status.status === 'completed' || status.status === 'partial');
    if (ready) {
      const clipUrls = clipsFromStatus(status);
      if (clipUrls.length > 0) {
        return { clipUrls, workspaceUuid: status.workspace_uuid, audio: status.audio };
      }
      // Completed but the URLs have not landed yet — they usually land within
      // a second or two, so drop back to the fast interval to catch them.
      pollMs = Math.min(SCENE_POLL_MIN_MS, pollMaxMs);
    } else {
      // A content refusal is an ENDING: polling it for another sixteen
      // minutes holds the whole run open on an answer that cannot change, and
      // leaves this scene's row spinning as if it were still rendering.
      const refusal = contentBlockReason(status);
      if (refusal) throw new Error(refusal);
      if (status.success && (status.stage === 'failed' || status.status === 'failed')) {
        throw new Error(status.user_message || status.error || 'The scene render failed.');
      }
    }

    if (opts.onTick) {
      const retried = (status as any).retried === true;
      opts.onTick(
        retried
          ? 'That render hiccuped — it restarted itself.'
          : status.user_message || 'Rendering this scene…',
        status,
      );
    }
    await sleep(pollMs);
    pollMs = Math.min(pollMaxMs, Math.round(pollMs * 1.5));
  }
  throw new Error('This scene is taking unusually long. It keeps rendering — retry the scene to pick it back up.');
}

// ---------------------------------------------------------------------------
// Stitching every scene's clips into ONE MP4
// ---------------------------------------------------------------------------
export type StitchMethod = 'browser' | 'server' | 'single' | 'none';

export interface StitchOutcome {
  url?: string;
  method: StitchMethod;
  /** Whether the delivered file keeps any audio the clips carried. */
  audio: 'preserved' | 'dropped' | 'unknown';
  error?: string;
}

async function serverStitch(clipUrls: string[], uuid: string): Promise<string> {
  const res = await fetch(`/api/workspaces/${uuid}/videos/stitch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoUrls: clipUrls }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.success || !isHttpUrl(data.stitchedUrl)) {
    throw new Error((data && data.error) || `server stitch failed (HTTP ${res.status})`);
  }
  return String(data.stitchedUrl);
}

/**
 * Merge every scene's clips into one downloadable MP4. Browser ffmpeg first
 * (keeps any audio the clips carry), the platform's server-side ffmpeg merge
 * second (always works, always silent), and if both are out, the caller
 * delivers the numbered clips instead.
 */
export async function stitchProject(
  clipUrls: string[],
  opts: {
    workspaceUuid?: string | null;
    fileName?: string;
    onStage?: (stage: 'stitching' | 'uploading' | 'server') => void;
  } = {},
): Promise<StitchOutcome> {
  const clips = clipUrls.filter(isHttpUrl);
  if (clips.length === 0) return { method: 'none', audio: 'unknown', error: 'No finished clips to stitch.' };
  if (clips.length === 1) return { url: clips[0], method: 'single', audio: 'preserved' };

  const uuid = opts.workspaceUuid || workspaceUuid();
  let browserError = '';
  try {
    const url = await stitchAndUploadClips({
      clipUrls: clips,
      workspaceUuid: uuid,
      fileName: opts.fileName || `reelio-project-${Date.now()}.mp4`,
      onStage: (stage) => opts.onStage && opts.onStage(stage),
    });
    return { url, method: 'browser', audio: 'preserved' };
  } catch (e: any) {
    browserError = (e && e.message) || 'in-browser stitch failed';
    console.warn('[Create] in-browser project stitch failed, trying the server stitch:', e);
  }

  if (uuid) {
    try {
      if (opts.onStage) opts.onStage('server');
      const url = await serverStitch(clips, uuid);
      return { url, method: 'server', audio: 'dropped' };
    } catch (e: any) {
      return {
        method: 'none',
        audio: 'unknown',
        error: `${browserError}; server stitch: ${(e && e.message) || 'failed'}`,
      };
    }
  }
  return { method: 'none', audio: 'unknown', error: browserError };
}

// ---------------------------------------------------------------------------
// Project rows (WorkspaceDB, session-scoped) — a project survives a reload,
// so a run interrupted halfway can be resumed instead of re-rendered.
// ---------------------------------------------------------------------------
const PROJECTS_TABLE = 'video_projects';

function db(): any {
  if (typeof window === 'undefined') return null;
  return (window as any).__workspaceDb || null;
}

export interface ProjectSceneRow {
  index: number;
  label: string;
  prompt: string;
  dialogue: string;
  durationSec: number;
  status: SceneRunStatus;
  jobId?: string;
  clipUrls: string[];
}

export interface ProjectRow {
  id: number;
  title?: string | null;
  brief?: string | null;
  brand?: string | null;
  tone?: string | null;
  aspect_ratio?: string | null;
  target_seconds?: number | null;
  scene_count?: number | null;
  character_name?: string | null;
  character_description?: string | null;
  character_image_url?: string | null;
  reference_image_url?: string | null;
  /** The locked anchor, stored verbatim so a resumed run reuses it exactly. */
  character_anchor?: CharacterAnchor | null;
  brief_json?: ProjectBrief | null;
  scenes_json?: ProjectSceneRow[] | null;
  clip_urls?: string[] | null;
  status?: string | null;
  final_video_url?: string | null;
  stitch_method?: string | null;
  error?: string | null;
  session_id?: string | null;
  created_at?: string;
}

export interface PersistedRow {
  /** The saved row id, or null when the row could not be saved. */
  id: number | null;
  /** Customer-safe explanation when `id` is null. Absent when the row saved. */
  notice?: string;
}

/**
 * Persistence is best-effort: a write failure never stops a render.
 *
 * `video_projects` is a GUARDED table — its write policy is
 * `{ ownerColumn: 'session_id', allowSharedWrites: false,
 * requireVerifiedOwner: true }` — so the platform refuses this insert outright
 * for a visitor with no verified session: "A verified session ID is required for
 * private writes". That is not retryable and not a pipeline fault; the scenes
 * still render and still land in My Videos, and only Resume is lost. So the
 * refusal is classified and handed back as plain language the UI can show,
 * instead of being swallowed into the console where the user silently loses
 * Resume with no idea why.
 */
export async function createProjectRow(row: Record<string, unknown>): Promise<PersistedRow> {
  const client = db();
  if (!client || typeof client.from !== 'function') return { id: null };
  // Session guard: wait for the verified session the SDK will send as its
  // X-Session-Id header before this guarded insert, and stamp THAT id on the
  // row so the owner column always matches the header — otherwise a write
  // fired during session bootstrap is refused with "A verified session ID is
  // required for private writes" even for a signed-in visitor.
  const sid = (await waitForDbSession()) || sessionId();
  try {
    // Only stamp a real session: the table requires a verified owner, so an
    // unowned row would be refused outright.
    const res = await client.from(PROJECTS_TABLE).insert(sid ? { ...row, session_id: sid } : { ...row });
    const data = (res && (res.data || res)) as any;
    const inserted = Array.isArray(data) ? data[0] : data;
    const id = inserted && Number(inserted.id);
    return { id: Number.isFinite(id) ? id : null };
  } catch (e) {
    console.warn('[Create] createProjectRow failed:', e);
    return { id: null, notice: writeFailureNotice(e, 'This project') };
  }
}

export async function updateProjectRow(id: number | null, patch: Record<string, unknown>): Promise<void> {
  if (!id) return;
  const client = db();
  if (!client || typeof client.from !== 'function') return;
  // Same session guard as createProjectRow — updates are owner-verified too.
  await waitForDbSession();
  try {
    await client.from(PROJECTS_TABLE).update(id, patch);
  } catch (e) {
    console.warn('[Create] updateProjectRow failed:', e);
  }
}

export async function listProjectRows(): Promise<ProjectRow[]> {
  const client = db();
  if (!client || typeof client.from !== 'function') return [];
  try {
    const res = await client.from(PROJECTS_TABLE).orderBy('created_at', 'desc').limit(25).get();
    const rows = Array.isArray(res && res.data) ? res.data : [];
    const sid = sessionId();
    // Strict session filter: only this visitor's own projects. Unowned rows
    // are shown to nobody — the same deliberate rule as listOwnVideos (and
    // this table's guarded write policy means an unowned row cannot even be
    // inserted).
    return sid ? rows.filter((r: any) => r.session_id === sid) : [];
  } catch (e) {
    console.warn('[Create] listProjectRows failed:', e);
    return [];
  }
}
