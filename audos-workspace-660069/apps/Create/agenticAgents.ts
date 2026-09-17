/**
 * VidVerge — the agentic video system: THE AGENTS.
 *
 * Six thinking steps, in the order the pipeline runs them:
 *
 *   1. MODE ROUTER          — AUTO reads the brief and picks one of the five modes.
 *   2. DIRECTOR AGENT       — brief → story (or ad) plan: world, look, arc, beats.
 *   3. SHOT PLANNER         — plan → an ordered shot list at the engine's clip length.
 *   4. CONTINUITY AGENT     — per shot: what must persist, and is this a deliberate break?
 *   5. VISUAL METAPHOR AGENT— per faceless beat: generate, reuse, stock, graphic, or text?
 *   6. MOTION AGENT         — per UI shot: element-by-element animation specs.
 *
 * EVERY ONE OF THEM HAS A DETERMINISTIC FALLBACK, and that is not a nicety. A
 * proxy hiccup, a 401, malformed JSON or a model that answers in prose must
 * never be the reason a customer cannot make a video: each function below
 * catches its own failure, logs it, and returns a templated answer that is
 * genuinely usable. Nothing here throws at its caller.
 *
 * MODEL CHOICE follows the platform's app AI policy rather than naming a
 * provider model in app code: the frontier model does the directing (the one
 * call whose quality shows up in every shot), the balanced model does the
 * per-shot writing, and the fast model does the small classification calls that
 * run once per shot. All three go through the platform's OpenAI proxy, which
 * REQUIRES the workspace data-plane token — an anonymous call is refused with
 * 401 no_credentials before the provider is ever contacted.
 */
import { extractJson } from './studioApi';
import { aiProxyHeaders } from '../../lib/reelioStudio';
import {
  clampText,
  getTone,
  type AspectRatio,
  type CharacterRef,
} from './videoTypes';
import {
  MAX_SHOTS,
  MIN_SHOTS,
  SHOT_DIALOGUE_MAX,
  SHOT_PROMPT_MAX,
  SHOT_SECONDS,
  getMode,
  isPresenterShotKind,
  type AdStates,
  type Chapter,
  type ContinuityNeed,
  type MotionSpec,
  type PlannedBeat,
  type ProductionInputs,
  type ProductionMemory,
  type ResolvedMode,
  type ShotKind,
  type ShotState,
  type StoryPlan,
  type TransitionKind,
  type UIState,
  type VideoMode,
  type VisualStrategy,
} from './agenticTypes';

// ---------------------------------------------------------------------------
// The proxy call every agent shares
// ---------------------------------------------------------------------------
/** Frontier: the Director, whose one call shapes every shot after it. */
const MODEL_DIRECTOR = 'gpt-5.6-sol';
/** Balanced: the per-shot writing. */
const MODEL_WRITER = 'gpt-5.6-terra';
/** Fast: the small per-shot classifications. */
const MODEL_FAST = 'gpt-5.6-luna';


/**
 * One agent turn. Returns '' rather than throwing on ANY failure, so every
 * caller's fallback is a plain `if (!raw)` rather than a try/catch dance.
 *
 * The workspace data-plane token is not optional: the platform's chat proxy
 * rejects an anonymous request with `401 { code: "no_credentials" }` before it
 * reaches a provider, which would silently turn every agent in this file into
 * its own fallback.
 */
async function ask(
  model: string,
  system: string,
  user: string,
  maxTokens: number,
): Promise<string> {
  try {
    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      // The proxy caps output at 8,192 tokens; nothing here asks for near that.
      max_completion_tokens: Math.min(8192, maxTokens),
    };
    // The balanced and fast models take a reasoning budget; spending none on a
    // structured-extraction turn is the documented default for both.
    if (model !== MODEL_DIRECTOR) body.reasoning_effort = 'none';
    const res = await fetch('/proxy/openai/v1/chat/completions', {
      method: 'POST',
      headers: aiProxyHeaders(),
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    const raw =
      data && data.choices && data.choices[0] && data.choices[0].message
        ? String(data.choices[0].message.content || '')
        : '';
    if (!res.ok || !raw.trim()) {
      console.warn('[Agentic] agent call returned nothing usable:', res.status, data && data.error);
      return '';
    }
    return raw;
  } catch (e) {
    console.warn('[Agentic] agent call failed, using the deterministic fallback:', e);
    return '';
  }
}

/** Ask for JSON and get an object back, or null. Never throws. */
async function askJson(
  model: string,
  system: string,
  user: string,
  maxTokens: number,
): Promise<any | null> {
  const raw = await ask(model, system, user, maxTokens);
  if (!raw) return null;
  const parsed = extractJson(raw);
  return parsed && typeof parsed === 'object' ? parsed : null;
}

/**
 * The rule every single prompt in this system inherits, stated once. Video
 * models cannot spell: anything written they are asked for comes back as warped
 * pseudo-lettering, so nothing this app plans ever puts words on screen. Real
 * product UI is the deliberate exception, and that is rendered by Remotion
 * (which draws exactly what it is given) rather than generated.
 */
const NO_TEXT_RULE =
  'NOTHING WRITTEN EVER APPEARS ON SCREEN in a generated shot — the video model cannot spell, so ' +
  'any words it is asked for come out garbled: never describe text, captions, subtitles, titles, ' +
  'end cards, signs, labels, logos or a wordmark, and never plan a shot whose point is something written.';

const JSON_ONLY = 'Respond with ONLY valid JSON, no markdown fences, no preamble, no explanation.';

// ---------------------------------------------------------------------------
// 1. MODE ROUTER — what AUTO actually does
// ---------------------------------------------------------------------------
export interface ModeDecision {
  mode: ResolvedMode;
  reason: string;
  /** Runtime the director should plan for, in seconds. */
  targetSeconds: number;
}

/** Read only explicit presenter language from the visitor's own request. */
export function briefImpliesPresenter(brief: string): boolean {
  return /\b(avatar|presenter|talking[ -]head|spokesperson|speak(?:s|ing)? to camera|on-camera speaker|testimonial|interview)\b/i.test(
    brief,
  );
}

/**
 * SMART INPUT ROUTING comes FIRST, and it is deterministic on purpose — what
 * the visitor actually handed us outranks anything a model can infer from prose:
 *
 *   a screenshot      → UI Motion. They uploaded a product screen; animate it.
 *   a character photo → the photo becomes the CHARACTER_MASTER, so the video
 *                       has a face in it: Avatar if we can speak with HeyGen,
 *                       otherwise an Ad or story with that character on camera.
 *
 * Only when the inputs are ambiguous (a URL, or a typed idea) does the model get
 * a say — and even then a keyword read is used if the call cannot be made.
 */
export async function decideMode(input: {
  requested: VideoMode;
  inputs: ProductionInputs;
  heygenAvailable: boolean | null;
  presenterRequested: boolean;
}): Promise<ModeDecision> {
  const { inputs } = input;
  const cap = (mode: ResolvedMode, seconds: number) =>
    Math.min(getMode(mode).maxSeconds, Math.max(SHOT_SECONDS * MIN_SHOTS, seconds));

  // An explicit pick is honoured, with one exception: Avatar without a usable
  // HeyGen credential degrades to a Veo character video rather than failing.
  if (input.requested !== 'auto') {
    const explicit = input.requested as ResolvedMode;
    if (explicit === 'avatar' && input.heygenAvailable === false) {
      return {
        mode: 'ad_creative',
        reason:
          'Avatar needs a HeyGen key on this workspace, so this is rendering as a character-led ' +
          'video on Veo instead — same script, same person in every shot.',
        targetSeconds: cap('ad_creative', 30),
      };
    }
    return {
      mode: explicit,
      reason: `You picked ${getMode(explicit).label}.`,
      targetSeconds: cap(explicit, explicit === 'long_series' ? 180 : explicit === 'ui_motion' ? 24 : 30),
    };
  }

  if (inputs.screenshotUrl) {
    return {
      mode: 'ui_motion',
      reason: 'You uploaded a product screenshot, so this is being animated as real UI rather than generated.',
      targetSeconds: cap('ui_motion', 24),
    };
  }
  if (inputs.characterPhotoUrl && input.heygenAvailable && input.presenterRequested) {
    return {
      mode: 'avatar',
      reason: 'You uploaded a character photo and this workspace can speak with HeyGen, so they deliver the lines to camera.',
      targetSeconds: cap('avatar', 30),
    };
  }

  const brief = clampText(`${inputs.brief} ${inputs.url}`, 900).trim();
  const parsed = await askJson(
    MODEL_FAST,
    'You route a video brief to ONE production mode. ' +
      JSON_ONLY +
      ' Shape: {"mode": string, "seconds": number, "reason": string}. ' +
      '"mode" is exactly one of: "faceless" (narration-driven explainer B-roll, no presenter), ' +
      '"avatar" (a presenter delivering dialogue to camera), ' +
      '"ui_motion" (animating a software product\'s own screens), ' +
      '"ad_creative" (a 15–30 second social ad with a problem, a product and a call to action), ' +
      '"long_series" (a multi-chapter piece longer than about 90 seconds). ' +
      '"seconds" is the runtime this brief deserves, between 16 and 300. ' +
      '"reason" is ONE short sentence addressed to the person who wrote the brief, in second person, ' +
      'saying why this mode suits what they asked for.',
    brief ? `Brief: ${brief}` : 'The visitor gave no brief at all.',
    300,
  );

  const allowed: ResolvedMode[] = ['faceless', 'avatar', 'ui_motion', 'ad_creative', 'long_series'];
  let mode = allowed.find((m) => m === String(parsed && parsed.mode)) || null;
  if (mode === 'avatar' && (!input.heygenAvailable || !input.presenterRequested)) mode = 'ad_creative';
  if (!mode) mode = keywordMode(brief, input.heygenAvailable && input.presenterRequested);

  const seconds = Number(parsed && parsed.seconds);
  return {
    mode,
    reason:
      (parsed && typeof parsed.reason === 'string' && parsed.reason.trim()
        ? clampText(parsed.reason, 220)
        : '') || `AUTO picked ${getMode(mode).label} for this brief.`,
    targetSeconds: cap(mode, Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 30),
  };
}

/** The keyword read, for when the router call cannot be made at all. */
function keywordMode(brief: string, heygen: boolean | null): ResolvedMode {
  const t = brief.toLowerCase();
  if (/\b(dashboard|saas|app screen|screenshot|onboarding|ui|interface|web app)\b/.test(t)) return 'ui_motion';
  if (heygen && briefImpliesPresenter(t)) return 'avatar';
  if (/\b(episode|series|chapter|documentary|five minute|5 minute|long form|course)\b/.test(t)) return 'long_series';
  if (/\b(explain|how it works|why|narration|voiceover|faceless|b-roll)\b/.test(t)) return 'faceless';
  return 'ad_creative';
}

// ---------------------------------------------------------------------------
// 2. DIRECTOR AGENT
// ---------------------------------------------------------------------------
function shotCountFor(targetSeconds: number): number {
  return Math.max(MIN_SHOTS, Math.min(MAX_SHOTS, Math.round(targetSeconds / SHOT_SECONDS)));
}

function chaptersFor(mode: ResolvedMode, shots: number): number {
  // A five-minute piece is not one continuous chain — it is chapter worlds, so
  // drift is bounded inside a chapter instead of accumulating over 38 shots.
  if (mode !== 'long_series' && mode !== 'faceless') return 1;
  return Math.max(1, Math.min(6, Math.ceil(shots / 6)));
}

/**
 * THE DIRECTOR. Reads the brief and plans the whole thing before a single
 * credit is spent: the world, the look every shot repeats, the arc, the chapter
 * split, and one beat per shot with its narration.
 */
export async function runDirectorAgent(input: {
  mode: ResolvedMode;
  inputs: ProductionInputs;
  toneId: string;
  aspect: AspectRatio;
  targetSeconds: number;
  /** Vision reads of uploaded product, UI, brand, and inspiration references. */
  visualReferences: string[];
  /** Named product UI states already discovered, for an ad or a UI piece. */
  uiStates: UIState[];
}): Promise<StoryPlan> {
  const shots = shotCountFor(input.targetSeconds);
  const chapters = chaptersFor(input.mode, shots);
  const tone = getTone(input.toneId);
  const modeDef = getMode(input.mode);

  const modeBrief: Record<ResolvedMode, string> = {
    faceless:
      'This is a FACELESS explainer: narration over B-roll, with NO presenter and no recurring person on camera. ' +
      'Plan concrete visual metaphors for each narration beat — objects, environments and motion, not people talking.',
    avatar:
      'This is an AVATAR video: one presenter speaks directly to camera throughout. Every beat needs a spoken line, ' +
      'because the line IS the shot. Keep the visuals simple; the performance carries it.',
    ui_motion:
      'This is a UI MOTION piece built from the product\'s own screens. Plan each beat as a move between two named ' +
      'product states (what the viewer is looking at, and what changes), not as generated footage.',
    ad_creative:
      'This is a SOCIAL AD. Plan it as: hook, the problem stated sharply, the turn into the product, one concrete ' +
      'proof beat, then the call to action. The problem→solution boundary should feel like a hard cut — the visual ' +
      'contrast IS the transformation being sold.',
    long_series:
      'This is a LONG piece of up to five minutes, so plan it as CHAPTERS: each chapter is one visual world the shots ' +
      'inside it share, and the piece moves between worlds deliberately rather than drifting.',
  };

  const system =
    'You are a video director planning a complete short-form production for an AI video pipeline. ' +
    JSON_ONLY +
    ' Shape: {"title": string, "logline": string, "world": string, "look": string, "arc": string, ' +
    '"visual_bible": {"color_grade": string, "lighting": string, "camera_style": string, "primary_environment": string, "atmosphere": string}, ' +
    '"cta": string, "chapters": [{"chapter": number, "title": string, "world": string, "summary": string}], ' +
    '"beats": [{"beat": number, "label": string, "chapter": number, "visual": string, "narration": string, "kind": string, ' +
    '"camera_distance": string, "camera_movement": string, "visual_connection": string}], ' +
    '"problem": string, "solution": string}. Rules: ' +
    `exactly ${shots} beats numbered from 1 in running order; exactly ${chapters} chapter(s) numbered from 1; ` +
    'every beat\'s "chapter" is one of those chapter numbers, and chapters run in order without jumping back; ' +
    '"title" is under 48 characters; "world" is ONE renderable place under 160 characters; ' +
    '"look" is the camera, lens, lighting and colour language every beat repeats, under 160 characters; ' +
    'establish ONE visual_bible before planning beats: a specific color palette/grade, lighting style, camera style, primary environment, and atmosphere that remain consistent across the whole video; ' +
    `"label" is a one or two word beat name; "visual" is a concrete description of that single ${SHOT_SECONDS}-second ` +
    `shot — setting, subject, action, camera move, lighting — under ${SHOT_PROMPT_MAX - 80} characters and written so a ` +
    'video model can render it; ' +
    `"narration" is the line said over it, under ${SHOT_DIALOGUE_MAX} characters (empty string only for a pure-visual beat); ` +
    '"kind" is one of "character", "avatar", "presenter", "talking_head", "ui", "physics", "broll"; ' +
    '"camera_distance" is exactly "wide", "medium", or "close"; "camera_movement" is exactly "static", "push", "pull", or "pan"; ' +
    '"visual_connection" is a short edit instruction describing the cut from the previous shot into this one (the first beat says how it establishes the sequence); ' +
    'plan a deliberate camera progression, normally wide establishing to medium action to close product detail, without arbitrary jumps; ' +
    'use "avatar", "presenter", or "talking_head" ONLY when a human speaks directly to camera; narration over product footage, an opening image, an environment, or B-roll is always "broll" or "character", never a presenter kind; ' +
    '"problem" and "solution" are one line each and may be empty when the piece is not an ad; ' +
    'the first beat has to hook a scrolling viewer in two seconds and the last beat has to land or call to action. ' +
    NO_TEXT_RULE;

  const user = [
    `Mode: ${modeDef.label} — ${modeBrief[input.mode]}`,
    `Runtime: about ${shots * SHOT_SECONDS} seconds, as ${shots} shots of ${SHOT_SECONDS} seconds.`,
    `Tone: ${tone.label} (${tone.visual})`,
    `Aspect ratio: ${input.aspect}`,
    input.inputs.url ? `The product page this is for: ${input.inputs.url}` : '',
    input.inputs.brief ? `The brief, in the visitor's own words: ${clampText(input.inputs.brief, 1200)}` : '',
    input.visualReferences.length > 0
      ? `They uploaded ${input.visualReferences.length} visual reference${input.visualReferences.length === 1 ? '' : 's'}. Use all of them as a visual reference set while planning, and assign the most relevant one to each beat rather than forcing every image into every shot:\n${input.visualReferences.map((description, index) => `${index + 1}. ${clampText(description, 420)}`).join('\n')}`
      : '',
    input.inputs.character
      ? `The recurring person on camera, identical in every shot: ${input.inputs.character.name} — ${clampText(input.inputs.character.description, 320)}. Never re-describe or replace them.`
      : input.mode === 'faceless'
        ? 'There is no person on camera at all. Do not invent a presenter.'
        : '',
    input.uiStates.length > 0
      ? `The product screens available to move between, by id: ${input.uiStates.map((s) => `${s.id} (${clampText(s.description, 90)})`).join('; ')}`
      : '',
    `Plan exactly ${shots} beats across exactly ${chapters} chapter(s).`,
  ]
    .filter(Boolean)
    .join('\n');

  const parsed = await askJson(MODEL_DIRECTOR, system, user, 4000);
  const built = parsed ? planFromJson(parsed, shots, chapters, input) : null;
  if (built) return built;
  console.warn('[Agentic] the director fell back to the template plan.');
  return buildFallbackPlan({ ...input, shots, chapters });
}

function planFromJson(
  parsed: any,
  shots: number,
  chapters: number,
  input: { mode: ResolvedMode; inputs: ProductionInputs; toneId: string; targetSeconds: number },
): StoryPlan | null {
  const rawBeats: any[] = Array.isArray(parsed.beats) ? parsed.beats : [];
  const kinds: ShotKind[] = ['character', 'avatar', 'presenter', 'talking_head', 'ui', 'physics', 'broll'];
  const distances = ['wide', 'medium', 'close'] as const;
  const movements = ['static', 'push', 'pull', 'pan'] as const;
  const fallbackDistance = (index: number) => index === 0 ? 'wide' : index >= Math.max(1, shots - 2) ? 'close' : 'medium';
  const beats: PlannedBeat[] = rawBeats
    .filter((b) => b && typeof b.visual === 'string' && b.visual.trim())
    .slice(0, shots)
    .map((b, i) => {
      const chapter = Math.max(1, Math.min(chapters, Number(b.chapter) || 1));
      const kind = kinds.find((k) => k === String(b.kind)) || defaultKind(input.mode);
      return {
        index: i + 1,
        label: clampText(String(b.label || `Beat ${i + 1}`), 24),
        visual: clampText(String(b.visual), SHOT_PROMPT_MAX),
        narration: clampText(typeof b.narration === 'string' ? b.narration : '', SHOT_DIALOGUE_MAX),
        chapterIndex: chapter,
        kind,
        cameraDistance: distances.find((value) => value === String(b.camera_distance)) || fallbackDistance(i),
        cameraMovement: movements.find((value) => value === String(b.camera_movement)) || (i === 0 ? 'static' : 'push'),
        visualConnection: clampText(
          String(b.visual_connection || (i === 0 ? 'Establish the visual world.' : `Cut from beat ${i} into this closer view.`)),
          140,
        ),
      };
    });
  if (beats.length === 0) return null;

  // A director that came back short is topped up from the template rather than
  // thrown away — a good 6-beat plan plus 2 templated beats beats no plan.
  const filler = buildFallbackPlan({ ...input, shots, chapters }).beats;
  while (beats.length < shots) {
    const next = filler[beats.length];
    beats.push({ ...next, index: beats.length + 1 });
  }

  const rawChapters: any[] = Array.isArray(parsed.chapters) ? parsed.chapters : [];
  const chapterList: Chapter[] = Array.from({ length: chapters }, (_, i) => {
    const found = rawChapters.find((c) => Number(c && c.chapter) === i + 1) || rawChapters[i] || {};
    return {
      index: i + 1,
      title: clampText(String(found.title || `Chapter ${i + 1}`), 60),
      environmentId: `env_${String(i + 1).padStart(2, '0')}`,
      summary: clampText(String(found.world || found.summary || parsed.world || ''), 240),
    };
  });

  const tone = getTone(input.toneId);
  const rawBible = parsed.visual_bible && typeof parsed.visual_bible === 'object' ? parsed.visual_bible : {};
  const visualBible = {
    colorGrade: clampText(String(rawBible.color_grade || parsed.look || tone.visual), 160),
    lighting: clampText(String(rawBible.lighting || parsed.look || tone.visual), 140),
    cameraStyle: clampText(String(rawBible.camera_style || parsed.look || 'controlled cinematic camera'), 140),
    environment: clampText(String(rawBible.primary_environment || parsed.world || 'one coherent primary location'), 180),
    atmosphere: clampText(String(rawBible.atmosphere || tone.visual), 140),
  };
  const adStates: AdStates | undefined =
    input.mode === 'ad_creative'
      ? {
          problem: clampText(String(parsed.problem || ''), 200),
          solution: clampText(String(parsed.solution || ''), 200),
          uiState: '',
          visualStyle: clampText(String(parsed.look || tone.visual), 200),
          currentCta: clampText(String(parsed.cta || 'Try it today.'), 120),
        }
      : undefined;

  return {
    title: clampText(String(parsed.title || '').trim() || fallbackTitle(input.inputs), 48),
    logline: clampText(String(parsed.logline || ''), 240),
    world: clampText(String(parsed.world || ''), 200),
    look: clampText(String(parsed.look || '').trim() || tone.visual, 200),
    visualBible,
    arc: clampText(String(parsed.arc || ''), 240),
    beats,
    chapters: chapterList,
    adStates,
    cta: clampText(String(parsed.cta || ''), 120),
    fallback: false,
  };
}

function defaultKind(mode: ResolvedMode): ShotKind {
  if (mode === 'ui_motion') return 'ui';
  if (mode === 'avatar') return 'avatar';
  if (mode === 'faceless') return 'broll';
  return 'character';
}

function fallbackTitle(inputs: ProductionInputs): string {
  const brief = (inputs.brief || '').trim();
  if (brief) return clampText(brief, 48);
  if (inputs.url) {
    try {
      return new URL(/^https?:\/\//i.test(inputs.url) ? inputs.url : `https://${inputs.url}`).hostname.replace(
        /^www\./i,
        '',
      );
    } catch {
      /* fall through */
    }
  }
  return 'Your video';
}

/**
 * The templated plan. Used when the director cannot be reached — the shapes
 * below are the five-beat structures that actually work for each mode, sliced
 * to the requested shot count with the hook and the close always kept.
 */
export function buildFallbackPlan(input: {
  mode: ResolvedMode;
  inputs: ProductionInputs;
  toneId: string;
  shots: number;
  chapters: number;
  /** Callers spread their own richer input in; anything extra is ignored. */
  [extra: string]: unknown;
}): StoryPlan {
  const tone = getTone(input.toneId);
  const subject = clampText(input.inputs.brief || fallbackTitle(input.inputs), 110);
  const kind = defaultKind(input.mode);

  const shapes: { label: string; visual: string; narration: string }[] =
    input.mode === 'ad_creative'
      ? [
          { label: 'Hook', visual: `One striking opening image of the moment ${subject} is needed, already in motion, ${tone.visual}.`, narration: 'This is the part nobody warns you about.' },
          { label: 'Problem', visual: `The friction stated visually — the awkward, slow, manual version of ${subject}, close and specific, ${tone.visual}.`, narration: 'It should not be this hard.' },
          { label: 'Turn', visual: `A hard cut into clean, confident imagery: ${subject} working the way it should, bright and effortless.`, narration: 'So here is the version that works.' },
          { label: 'Proof', visual: `One concrete proof beat — the result of ${subject}, shown rather than claimed, crisp detail.`, narration: 'Same job. A fraction of the effort.' },
          { label: 'Land', visual: `Closing image: the product alone in frame, light sweep, calm confident composition, ${tone.visual}.`, narration: 'Start today.' },
        ]
      : input.mode === 'ui_motion'
        ? [
            { label: 'Open', visual: `The product's main screen settles into frame, a slow push-in on the area that matters for ${subject}.`, narration: 'Here is where it starts.' },
            { label: 'Act', visual: `An action is taken on screen and the interface responds — the moment ${subject} becomes obvious.`, narration: 'One tap, and it does the work.' },
            { label: 'Reveal', visual: `The result screen builds in, card by card, camera easing back to take it all in.`, narration: 'And there is your answer.' },
            { label: 'Detail', visual: `A close push into the single most useful detail on the result screen.`, narration: 'This is the part people screenshot.' },
            { label: 'Land', visual: `Pull back to the whole interface, held steady and calm.`, narration: 'That is the whole loop.' },
          ]
        : input.mode === 'avatar'
          ? [
              { label: 'Hook', visual: 'The presenter looks straight into camera and opens with the point.', narration: clampText(`Let me tell you about ${subject}.`, SHOT_DIALOGUE_MAX) },
              { label: 'Setup', visual: 'The presenter, same framing, lays out what is actually going on.', narration: 'Here is what most people get wrong.' },
              { label: 'Turn', visual: 'The presenter leans in slightly, delivering the useful part.', narration: 'The fix is simpler than you think.' },
              { label: 'Proof', visual: 'The presenter, relaxed and certain, gives the concrete example.', narration: 'I have seen it work every time.' },
              { label: 'Land', visual: 'The presenter closes warmly, holding the camera.', narration: 'Give it a go — you will see.' },
            ]
          : [
              { label: 'Hook', visual: `Macro opening image on the object at the heart of ${subject}, shallow depth of field, slow push, ${tone.visual}.`, narration: clampText(`Ever wondered how ${subject} really works?`, SHOT_DIALOGUE_MAX) },
              { label: 'Setup', visual: `A wider view of the world ${subject} lives in — quiet, textured, no people, ${tone.visual}.`, narration: 'Start with the part everyone skips.' },
              { label: 'Build', visual: `Hands and objects at work on ${subject}, rhythmic cuts, close practical detail.`, narration: 'It builds, quietly, one step at a time.' },
              { label: 'Proof', visual: `The visual payoff of ${subject} — one bold clear image, held a beat longer than comfortable.`, narration: 'And this is what that adds up to.' },
              { label: 'Land', visual: `A final settling image of the same world, light falling off, slow fade, ${tone.visual}.`, narration: 'Now you know where to start.' },
            ];

  const chapters: Chapter[] = Array.from({ length: Math.max(1, input.chapters) }, (_, i) => ({
    index: i + 1,
    title: `Chapter ${i + 1}`,
    environmentId: `env_${String(i + 1).padStart(2, '0')}`,
    summary: clampText(subject, 240),
  }));

  const perChapter = Math.ceil(input.shots / chapters.length);
  const beats: PlannedBeat[] = Array.from({ length: input.shots }, (_, i) => {
    // Keep the hook first and the close last; cycle the middle shapes so a long
    // piece still has variety rather than five beats repeated verbatim.
    const shape =
      i === 0
        ? shapes[0]
        : i === input.shots - 1
          ? shapes[shapes.length - 1]
          : shapes[1 + ((i - 1) % Math.max(1, shapes.length - 2))];
    return {
      index: i + 1,
      label: shape.label,
      visual: clampText(shape.visual, SHOT_PROMPT_MAX),
      narration: clampText(shape.narration, SHOT_DIALOGUE_MAX),
      chapterIndex: Math.min(chapters.length, Math.floor(i / perChapter) + 1),
      kind,
      cameraDistance: i === 0 ? 'wide' : i >= Math.max(1, input.shots - 2) ? 'close' : 'medium',
      cameraMovement: i === 0 ? 'static' : i === input.shots - 1 ? 'pull' : 'push',
      visualConnection: i === 0 ? 'Establish the primary visual world.' : `Cut from shot ${i} into a progressively tighter view.`,
    };
  });

  return {
    title: fallbackTitle(input.inputs),
    logline: clampText(subject, 240),
    world: '',
    look: tone.visual,
    visualBible: {
      colorGrade: clampText(tone.visual, 160),
      lighting: clampText(tone.visual, 140),
      cameraStyle: 'controlled cinematic camera with a deliberate wide-to-close progression',
      environment: clampText(subject, 180),
      atmosphere: clampText(tone.visual, 140),
    },
    arc: clampText(subject, 240),
    beats,
    chapters,
    adStates:
      input.mode === 'ad_creative'
        ? { problem: '', solution: '', uiState: '', visualStyle: tone.visual, currentCta: 'Start today.' }
        : undefined,
    cta: input.mode === 'ad_creative' ? 'Start today.' : '',
    fallback: true,
  };
}

// ---------------------------------------------------------------------------
// 3. SHOT PLANNER
// ---------------------------------------------------------------------------
/**
 * Turn the director's beats into the shot list the runner executes. This step
 * is deliberately mechanical rather than another model call: the director
 * already wrote one beat per shot at the engine's clip length, so re-asking a
 * model to "cut" them would only introduce drift between the plan the visitor
 * approved and the shots that actually render.
 */
export function planShots(plan: StoryPlan): ShotState[] {
  return plan.beats.map((beat) => ({
    index: beat.index,
    label: beat.label,
    kind: beat.kind,
    prompt: beat.visual,
    dialogue: beat.narration,
    cameraDistance: beat.cameraDistance,
    cameraMovement: beat.cameraMovement,
    visualConnection: beat.visualConnection,
    chapterIndex: beat.chapterIndex,
    seconds: SHOT_SECONDS,
    status: 'pending' as const,
    continuity: null,
    decision: null,
    engine: null,
    regenCount: 0,
  }));
}

// ---------------------------------------------------------------------------
// 4. CONTINUITY AGENT
// ---------------------------------------------------------------------------
const TRANSITIONS: TransitionKind[] = [
  'LAST_FRAME',
  'MATCH_CUT',
  'MORPH',
  'WHIP_PAN',
  'ZOOM_THROUGH',
  'OBJECT_WIPE',
  'UI_TRANSITION',
  'GRAPHIC_TRANSITION',
  'HARD_CUT',
  'SOUND_BRIDGE',
  'BRIDGE_SHOT',
];

/**
 * WHAT MUST PERSIST INTO THIS SHOT. Answered per shot rather than once per
 * production, because the answer genuinely changes: shot 3 of an ad needs the
 * same face as shot 2, shot 4 needs the product to look identical, and shot 5
 * deliberately needs NOTHING to carry over because the hard cut is the point.
 *
 * The deterministic read runs first and is usually right (it knows the mode,
 * the plan and whether a character master exists). The model call only refines
 * it — and only for the modes where the answer is genuinely ambiguous.
 */
export async function runContinuityAgent(input: {
  shot: ShotState;
  previousShot: ShotState | null;
  mode: ResolvedMode;
  plan: StoryPlan;
  memory: ProductionMemory;
}): Promise<ContinuityNeed> {
  const base = deterministicContinuity(input);
  // Faceless and UI Motion are unambiguous: no face, or all UI. Avatar is
  // always dialogue. Only a character-led story or an ad is worth a call.
  if (input.mode !== 'ad_creative' && input.mode !== 'long_series') return base;

  const parsed = await askJson(
    MODEL_FAST,
    'You are a continuity supervisor on a short video. For ONE shot, decide what must carry over from the shot ' +
      'before it. ' +
      JSON_ONLY +
      ' Shape: {"needs_character": boolean, "needs_dialogue": boolean, "needs_ui": boolean, "needs_physics": boolean, ' +
      '"new_scene": boolean, "deliberate_break": boolean, "must_persist": [string], "transition_in": string}. ' +
      `"transition_in" is one of: ${TRANSITIONS.join(', ')}. ` +
      '"deliberate_break" is true ONLY at a problem-to-solution turn, where a hard visual contrast is the point and ' +
      'continuity should be broken on purpose. "must_persist" is up to four short phrases naming exactly what has to ' +
      'look the same ("the same presenter", "the same kitchen", "the product\'s colour").',
    [
      `The piece: ${clampText(plainPlan(input.plan), 500)}`,
      input.previousShot
        ? `Previous shot (${input.previousShot.label}): ${clampText(input.previousShot.prompt, 300)}`
        : 'This is the FIRST shot — there is nothing before it.',
      `This shot (${input.shot.label}): ${clampText(input.shot.prompt, 300)}`,
      input.shot.dialogue ? `Spoken over it: ${input.shot.dialogue}` : 'Nothing is spoken over it.',
      input.memory.characterMasters.length > 0
        ? `A locked recurring character exists: ${clampText(input.memory.characterMasters[0].description, 220)}`
        : 'There is no recurring character in this piece.',
    ].join('\n'),
    400,
  );
  if (!parsed) return base;

  const transition = TRANSITIONS.find((t) => t === String(parsed.transition_in));
  const persist = Array.isArray(parsed.must_persist)
    ? parsed.must_persist.slice(0, 4).map((p: unknown) => clampText(String(p), 90)).filter(Boolean)
    : base.mustPersist;

  // The character requirement is never loosened by the model: if this
  // production has a locked character and the base read wants them in shot, a
  // "no" here would drop the face reference and undo the whole lock.
  const needsCharacter = base.needsCharacter || parsed.needs_character === true;
  const kind: ShotKind = parsed.needs_ui === true
    ? 'ui'
    : parsed.needs_dialogue === true && needsCharacter
      ? 'dialogue'
      : needsCharacter
        ? 'character'
        : parsed.needs_physics === true
          ? 'physics'
          : 'broll';

  return {
    kind,
    needsCharacter,
    // A model may refine continuity, but it may not turn voiceover into an on-camera presenter.
    needsDialogue: base.needsDialogue,
    needsUI: parsed.needs_ui === true || base.needsUI,
    needsPhysics: parsed.needs_physics === true || base.needsPhysics,
    newScene: parsed.new_scene === true || base.newScene,
    deliberateBreak: parsed.deliberate_break === true,
    mustPersist: persist.length > 0 ? persist : base.mustPersist,
    transitionIn: transition || base.transitionIn,
  };
}

function plainPlan(plan: StoryPlan): string {
  return [plan.title, plan.logline, plan.world].filter(Boolean).join(' — ');
}

/** The read that needs no model: mode, plan position and the masters we hold. */
export function deterministicContinuity(input: {
  shot: ShotState;
  previousShot: ShotState | null;
  mode: ResolvedMode;
  plan: StoryPlan;
  memory: ProductionMemory;
}): ContinuityNeed {
  const { shot, previousShot, mode, memory } = input;
  const beat = input.plan.beats.find((b) => b.index === shot.index);
  const hasCharacter = memory.characterMasters.length > 0;
  const newScene = !previousShot || previousShot.chapterIndex !== shot.chapterIndex;
  const plannedKind = shot.kind || beat?.kind;
  const uiShot = mode === 'ui_motion' || plannedKind === 'ui';
  const dialogueShot = mode === 'avatar' || (!!shot.dialogue && isPresenterShotKind(plannedKind));
  const characterShot = !uiShot && mode !== 'faceless' && (hasCharacter || plannedKind === 'character' || dialogueShot);
  const physicsShot = beat?.kind === 'physics';

  // An ad's problem→solution turn is the one place a break is CORRECT. The
  // label the director gave the beat is the signal, because that is the beat it
  // deliberately wrote as the turn.
  const deliberateBreak =
    mode === 'ad_creative' && /^(turn|solution|reveal|switch)$/i.test(shot.label) && !!previousShot;

  const mustPersist: string[] = [];
  if (characterShot) mustPersist.push('the same person, face and wardrobe');
  if (!newScene && !deliberateBreak) mustPersist.push('the same place and lighting');
  if (memory.productMaster) mustPersist.push(`the product looking exactly like ${memory.productMaster.name}`);
  if (uiShot) mustPersist.push('the real product interface, unchanged');

  const transitionIn: TransitionKind = !previousShot
    ? 'HARD_CUT'
    : deliberateBreak
      ? 'HARD_CUT'
      : uiShot
        ? 'UI_TRANSITION'
        : newScene
          ? 'MATCH_CUT'
          : 'LAST_FRAME';

  return {
    kind: uiShot
      ? 'ui'
      : dialogueShot
        ? isPresenterShotKind(plannedKind)
          ? plannedKind
          : 'avatar'
        : characterShot
          ? 'character'
          : physicsShot
            ? 'physics'
            : 'broll',
    needsCharacter: characterShot,
    needsDialogue: dialogueShot,
    needsUI: uiShot,
    needsPhysics: physicsShot,
    newScene,
    deliberateBreak,
    mustPersist: mustPersist.length > 0 ? mustPersist : ['the same visual style and grade'],
    transitionIn,
  };
}

// ---------------------------------------------------------------------------
// 5. VISUAL METAPHOR AGENT (faceless)
// ---------------------------------------------------------------------------
const VISUAL_STRATEGIES: VisualStrategy[] = [
  'GENERATE_VIDEO',
  'GENERATE_IMAGE_THEN_VIDEO',
  'USE_STOCK',
  'USE_REFERENCE',
  'USE_LAST_FRAME',
  'USE_UI',
  'USE_MOTION_GRAPHIC',
  'USE_TEXT',
  'USE_BRIDGE_SHOT',
];

/**
 * Per narration beat: what should actually be on screen? A faceless explainer
 * that generates a fresh clip for every beat is both expensive and repetitive;
 * some beats want the previous world back, some want a graphic, and some want
 * an existing reference re-used. Falls back to GENERATE_VIDEO, which is always
 * a valid answer.
 */
export async function runVisualMetaphorAgent(input: {
  shot: ShotState;
  previousShot: ShotState | null;
  memory: ProductionMemory;
  hasUI: boolean;
}): Promise<VisualStrategy> {
  if (!input.shot.dialogue && !input.shot.prompt) return 'USE_LAST_FRAME';
  const parsed = await askJson(
    MODEL_FAST,
    'You decide what a single narration beat of a faceless explainer should SHOW. ' +
      JSON_ONLY +
      ' Shape: {"strategy": string, "reason": string}. "strategy" is exactly one of: ' +
      VISUAL_STRATEGIES.join(', ') +
      '. GENERATE_VIDEO for a beat that needs new motion; GENERATE_IMAGE_THEN_VIDEO when a precise composition ' +
      'matters more than the motion; USE_LAST_FRAME when the beat continues the previous image and needs no new ' +
      'world; USE_REFERENCE when an environment we already have is the right picture; USE_MOTION_GRAPHIC for an ' +
      'abstract or numeric idea no camera can film; USE_UI when the beat is about a software screen; USE_STOCK for ' +
      'ordinary real-world footage; USE_BRIDGE_SHOT for a short connective beat between two worlds.',
    [
      `Beat: ${clampText(input.shot.prompt, 300)}`,
      input.shot.dialogue ? `Narration: ${input.shot.dialogue}` : 'No narration.',
      input.previousShot ? `The beat before it: ${clampText(input.previousShot.prompt, 200)}` : 'This is the first beat.',
      input.memory.environments.length > 0
        ? `Environments already generated: ${input.memory.environments.map((e) => e.label).join(', ')}`
        : 'No environments generated yet.',
      input.hasUI ? 'Real product screens are available.' : 'No product screens are available.',
    ].join('\n'),
    250,
  );
  const strategy = VISUAL_STRATEGIES.find((s) => s === String(parsed && parsed.strategy));
  if (!strategy) return 'GENERATE_VIDEO';
  // Two strategies are refused when the material they need does not exist —
  // otherwise the router would route a shot at a reference that is not there.
  if (strategy === 'USE_UI' && !input.hasUI) return 'GENERATE_VIDEO';
  if (strategy === 'USE_REFERENCE' && input.memory.environments.length === 0) return 'GENERATE_VIDEO';
  if (strategy === 'USE_LAST_FRAME' && !input.previousShot) return 'GENERATE_VIDEO';
  return strategy;
}

// ---------------------------------------------------------------------------
// 6. MOTION AGENT (UI Motion)
// ---------------------------------------------------------------------------
const ENTRANCES: MotionSpec['entrance'][] = ['spring_up', 'fade', 'slide_left', 'slide_right', 'scale_in', 'none'];
const EMPHASES: MotionSpec['emphasis'][] = ['none', 'scale_105', 'glow', 'outline'];
const CAMERAS: MotionSpec['camera'][] = ['push_in', 'pull_back', 'pan_left', 'pan_right', 'hold'];

/**
 * Per-element animation for ONE UI shot. Remotion renders exactly what it is
 * told, so this is where the craft lives: which card springs up, how long it
 * waits, what gets emphasised, and how the camera moves over the screen.
 */
export async function runMotionAgent(input: {
  shot: ShotState;
  fromState: UIState | null;
  toState: UIState | null;
}): Promise<MotionSpec[]> {
  const fallback = fallbackMotion(input.shot);
  const parsed = await askJson(
    MODEL_WRITER,
    'You are a motion designer animating a real software screen. ' +
      JSON_ONLY +
      ' Shape: {"elements": [{"element": string, "entrance": string, "duration": number, "delay": number, ' +
      '"emphasis": string, "camera": string}]}. Two to four elements, in the order they should appear. ' +
      `"entrance" is one of ${ENTRANCES.join(', ')}; "emphasis" is one of ${EMPHASES.join(', ')}; ` +
      `"camera" is one of ${CAMERAS.join(', ')} and should be the SAME value on every element (one camera move ` +
      'per shot). "duration" and "delay" are milliseconds; durations 250–900, delays 0–1200, and the delays should ' +
      'stagger so the screen builds rather than popping in at once. "element" names the part of the interface in ' +
      'plain words, e.g. "weak topic card", "score header", "chart".',
    [
      `The shot: ${clampText(input.shot.prompt, 300)}`,
      input.fromState ? `Coming from the "${input.fromState.id}" screen: ${clampText(input.fromState.description, 200)}` : '',
      input.toState ? `Landing on the "${input.toState.id}" screen: ${clampText(input.toState.description, 200)}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    700,
  );

  const rows: any[] = parsed && Array.isArray(parsed.elements) ? parsed.elements : [];
  const specs = rows
    .filter((r) => r && typeof r.element === 'string' && r.element.trim())
    .slice(0, 4)
    .map((r) => ({
      element: clampText(String(r.element), 60),
      entrance: ENTRANCES.find((e) => e === String(r.entrance)) || 'spring_up',
      duration: clampNumber(Number(r.duration), 250, 900, 450),
      delay: clampNumber(Number(r.delay), 0, 1200, 100),
      emphasis: EMPHASES.find((e) => e === String(r.emphasis)) || 'none',
      camera: CAMERAS.find((c) => c === String(r.camera)) || 'push_in',
    }));
  return specs.length > 0 ? specs : fallback;
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function fallbackMotion(shot: ShotState): MotionSpec[] {
  const camera: MotionSpec['camera'] = /pull|wide|back|out/i.test(shot.prompt) ? 'pull_back' : 'push_in';
  return [
    { element: 'screen', entrance: 'fade', duration: 500, delay: 0, emphasis: 'none', camera },
    { element: 'primary card', entrance: 'spring_up', duration: 450, delay: 260, emphasis: 'scale_105', camera },
    { element: 'supporting detail', entrance: 'slide_left', duration: 420, delay: 520, emphasis: 'none', camera },
  ];
}

// ---------------------------------------------------------------------------
// Self-generated references — when the visitor provided nothing
// ---------------------------------------------------------------------------
export interface DetectedReferences {
  characters: { name: string; description: string }[];
  environments: { label: string; description: string }[];
  props: { label: string; description: string }[];
}

/**
 * NOBODY GAVE US A REFERENCE, so the system builds its own before it renders
 * anything: read the script, detect who and what recurs, and describe each one
 * concretely enough to draw. The drawing itself happens in agenticEngines —
 * this step only decides WHAT needs to exist.
 */
export async function detectReferences(input: {
  plan: StoryPlan;
  mode: ResolvedMode;
  character: CharacterRef | null;
}): Promise<DetectedReferences> {
  const script = input.plan.beats
    .map((b) => `${b.index}. ${b.visual}${b.narration ? ` — “${b.narration}”` : ''}`)
    .join('\n');

  const parsed = await askJson(
    MODEL_WRITER,
    'You read a shot list and extract the RECURRING visual elements that must look identical every time they ' +
      'appear, so reference images can be drawn for them first. ' +
      JSON_ONLY +
      ' Shape: {"characters": [{"name": string, "description": string}], ' +
      '"environments": [{"label": string, "description": string}], "props": [{"label": string, "description": string}]}. ' +
      'At most ONE character, at most three environments, at most three props — only things that appear in more than ' +
      'one shot, or that the piece depends on looking right. A "description" is concrete enough for an image model: ' +
      'for a person, an ORIGINAL FICTIONAL person (never a real, famous or recognisable one) with age, build, skin ' +
      'tone, hair, wardrobe and demeanour; for a place, the space, the light and the materials; for a prop, its form, ' +
      'colour and finish. Return empty arrays rather than inventing something the shot list does not contain. ' +
      (input.mode === 'faceless'
        ? 'This piece has NO person on camera, so "characters" must be empty.'
        : ''),
    [
      `The piece: ${plainPlan(input.plan)}`,
      input.plan.look ? `The look: ${input.plan.look}` : '',
      input.character
        ? `A character is already locked, so do NOT return one: ${clampText(input.character.description, 200)}`
        : '',
      `Shot list:\n${clampText(script, 3000)}`,
    ]
      .filter(Boolean)
      .join('\n'),
    1400,
  );

  const list = (value: unknown, nameKey: 'name' | 'label', limit: number) =>
    (Array.isArray(value) ? value : [])
      .filter((r: any) => r && typeof r.description === 'string' && r.description.trim())
      .slice(0, limit)
      .map((r: any) => ({
        [nameKey]: clampText(String(r[nameKey] || r.name || r.label || 'reference'), 48),
        description: clampText(String(r.description), 400),
      })) as any[];

  return {
    characters: input.character || input.mode === 'faceless' ? [] : list(parsed && parsed.characters, 'name', 1),
    environments: list(parsed && parsed.environments, 'label', 3),
    props: list(parsed && parsed.props, 'label', 3),
  };
}
