/**
 * Product Video — the script and image-prompt writer.
 *
 * Every AI text call in this module goes to Claude through the Anthropic proxy.
 * No call site here names a model: each one declares the kind of work it is and
 * `selectModel` (lib/aiModels) resolves the tier, so scripts get the frontier
 * model and prompt lines get the balanced one without a hardcoded string in
 * this file. No OpenAI model is used for any writing task here.
 *
 * A script is written as STRUCTURE, not a wall of prose:
 *
 *   { title, hook, scenes: [{ visual, voiceover }], cta }
 *
 * That shape is what makes the rest of the quality bar reachable — the hook is
 * a field the writer has to fill deliberately, each scene carries its own
 * vivid visual direction next to the line it belongs to, the CTA cannot be
 * forgotten, and the SCENE COUNT is budgeted from the customer's target length
 * (15s = 1-2 scenes, 30s = 3-4, 60s = 5-6) instead of whatever the model felt
 * like. The customer reviews and edits that structure, scene by scene, and
 * must approve it before a single frame is rendered.
 */
import { claudeText, selectModel, type ClaudeModel, type TaskType } from '../../lib/aiModels';
import {
  NARRATION_PUNCTUATION_RULES,
  SHARED_SCRIPT_RULES,
  sceneBudget,
  type VideoStyle,
} from './videoStyles';
import { countWords, sanitizeNarration } from './clipStyleTemplate';

/**
 * The writer tiers, derived from the shared policy rather than declared here.
 * `script` is frontier work; a prompt line is not.
 */
export const SCRIPT_MODEL: ClaudeModel = selectModel('prompt_writing');
export const SCRIPT_MODEL_FRONTIER: ClaudeModel = selectModel('script');

/** Narration pacing: ~2.5 spoken words per second. */
export const WORDS_PER_SECOND = 2.5;

export interface ScriptScene {
  /** The vivid, specific visual direction for this scene. */
  visual: string;
  /** The words the narrator says over it. */
  voiceover: string;
}

export interface StyledScript {
  title: string;
  /** The opening line — must land within three seconds. */
  hook: string;
  scenes: ScriptScene[];
  /** The closing call to action. */
  cta: string;
}

export function emptyScript(): StyledScript {
  return { title: '', hook: '', scenes: [], cta: '' };
}

// ---------------------------------------------------------------------------
// Claude plumbing
// ---------------------------------------------------------------------------

interface ClaudeCall {
  /** The kind of work, which is what picks the model. */
  task: TaskType;
  system: string;
  user: string;
  maxTokens?: number;
  /** Set only when the customer explicitly asked for the frontier writer. */
  model?: ClaudeModel;
}

async function askClaude({ task, system, user, maxTokens = 4096, model }: ClaudeCall): Promise<string> {
  return claudeText({ task, system, user, maxTokens, model });
}

function extractJson(raw: string, open: '{' | '[', close: '}' | ']'): string {
  const cleaned = raw.replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf(open);
  const end = cleaned.lastIndexOf(close);
  if (start < 0 || end <= start) throw new Error('The AI reply came back in an unexpected format — try again.');
  return cleaned.slice(start, end + 1);
}

// ---------------------------------------------------------------------------
// Narration cleanup
// ---------------------------------------------------------------------------

/**
 * Light cleanup for styles whose narration keeps ordinary punctuation: strip
 * markdown, stage directions and emoji, but keep the commas that give the TTS
 * voice its natural pauses.
 */
function lightCleanNarration(raw: string): string {
  return String(raw || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\*+/g, '')
    .replace(/^\s*(?:VO|V\.O\.|NARRATOR|VOICEOVER)\s*:\s*/i, '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[\u{1F000}-\u{1FFFF}\u{2190}-\u{27BF}\u{FE0F}]/gu, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Clip Style and Documentary read as archival narration, where the strict
 * full-stop-only contract keeps the TTS delivery even. The other styles keep
 * ordinary punctuation.
 */
export function sanitizeForStyle(style: VideoStyle, raw: string): string {
  return style.id === 'clip' || style.id === 'documentary'
    ? sanitizeNarration(raw)
    : lightCleanNarration(raw);
}

/** The full narration read by the voice: hook, every scene line, then the CTA. */
export function scriptNarration(script: StyledScript, style: VideoStyle): string {
  const parts = [script.hook, ...script.scenes.map((s) => s.voiceover), script.cta]
    .map((s) => sanitizeForStyle(style, s || ''))
    .filter(Boolean);
  return sanitizeForStyle(style, parts.join(' '));
}

export function scriptWordCount(script: StyledScript, style: VideoStyle): number {
  return countWords(scriptNarration(script, style));
}

// ---------------------------------------------------------------------------
// Script generation
// ---------------------------------------------------------------------------

function punctuationBlock(style: VideoStyle): string {
  return style.id === 'clip' || style.id === 'documentary'
    ? 'NARRATION PUNCTUATION (strict for this style):\n- ' + NARRATION_PUNCTUATION_RULES.join('\n- ')
    : 'NARRATION PUNCTUATION: ordinary sentence punctuation is fine — the commas give the voice its pauses. No emoji, no markdown, no stage directions, no speaker labels.';
}

export interface ScriptRequest {
  style: VideoStyle;
  /** Everything known about the product, or the customer's typed description. */
  productContext: string;
  /** The customer's target video length in seconds. */
  targetSeconds: number;
  /** True when productContext is the customer's own typed English description. */
  fromDescription: boolean;
  /** Optional steer from the customer on a regenerate. */
  steer?: string;
  /** Use the frontier writer instead of the balanced one. */
  frontier?: boolean;
}

/**
 * Write the script for one styled run. Returns the reviewable structure — the
 * caller shows it to the customer for approval before anything is rendered.
 */
export async function generateStyledScript(req: ScriptRequest): Promise<StyledScript> {
  const { style, targetSeconds, fromDescription } = req;
  const budget = sceneBudget(targetSeconds);
  const targetWords = Math.max(12, Math.round(targetSeconds * WORDS_PER_SECOND));
  const perScene = Math.max(6, Math.round(targetWords / Math.max(1, budget.max)));

  const system = [
    'You are a senior advertising scriptwriter who writes short product films that people actually watch to the end. You write for the ear, not the page.',
    '',
    'STYLE: ' + style.name,
    'TONE: ' + style.scriptTone,
    '',
    'RULES — every one of them, no exceptions:',
    '- ' + SHARED_SCRIPT_RULES.join('\n- '),
    '- ' + style.scriptRules.join('\n- '),
    '',
    punctuationBlock(style),
    '',
    'VISUAL DIRECTIONS: ' + style.visualDirectionRule,
    'Each scene visual must be SPECIFIC and SHOOTABLE — name the actual subject, the actual setting, the actual light. "A person using the app" is a failure. "Hands scrolling a pricing table on a laptop at a kitchen table, morning light from the left" is right.',
    '',
    'LENGTH DISCIPLINE: the film runs about ' + targetSeconds + ' seconds, which is roughly ' + targetWords + ' spoken words in total at two and a half words per second. Write EXACTLY ' + budget.min + ' to ' + budget.max + ' scenes — no more, no fewer — and keep each scene voiceover near ' + perScene + ' words. The hook and the call to action are counted inside that total.',
    '',
    'Reply with ONLY a JSON object, no prose before or after, exactly this shape:',
    '{"title":"short internal title","hook":"the opening line","scenes":[{"visual":"the visual direction","voiceover":"the words said over it"}],"cta":"the closing call to action"}',
  ].join('\n');

  const user = [
    fromDescription
      ? 'THE CUSTOMER TYPED THIS DESCRIPTION OF THE VIDEO THEY WANT. It is both the brief and the creative direction — honour its specifics and do not replace its idea with your own:'
      : 'PRODUCT BRIEF (use its real specifics — actual features, numbers and problems):',
    req.productContext.slice(0, 4000),
    req.steer ? '\nTHE CUSTOMER ALSO ASKED FOR THIS ON THIS REWRITE:\n' + req.steer.slice(0, 600) : '',
    '\nWrite the script now.',
  ].filter(Boolean).join('\n');

  const raw = await askClaude({
    // Writing the film's script is frontier work; the optional `frontier` flag
    // is now only a floor, since 'script' already resolves to the top tier.
    task: 'script',
    system,
    user,
    maxTokens: 4096,
    model: req.frontier ? SCRIPT_MODEL_FRONTIER : undefined,
  });
  return normalizeScript(raw, style, budget);
}

function normalizeScript(raw: string, style: VideoStyle, budget: { min: number; max: number }): StyledScript {
  const parsed = JSON.parse(extractJson(raw, '{', '}'));
  const scenes: ScriptScene[] = (Array.isArray(parsed?.scenes) ? parsed.scenes : [])
    .filter((s: any) => s && typeof s.voiceover === 'string' && s.voiceover.trim())
    .slice(0, budget.max)
    .map((s: any) => ({
      visual: String(s.visual || '').replace(/\s+/g, ' ').trim(),
      voiceover: sanitizeForStyle(style, String(s.voiceover)),
    }));
  if (!scenes.length) throw new Error('The script came back with no scenes — try again.');
  const script: StyledScript = {
    title: String(parsed?.title || '').replace(/\s+/g, ' ').trim().slice(0, 140),
    hook: sanitizeForStyle(style, String(parsed?.hook || '')),
    scenes,
    cta: sanitizeForStyle(style, String(parsed?.cta || '')),
  };
  // The hook and the CTA are the two lines the whole quality bar rests on, so
  // neither may arrive empty: fall back rather than ship a film that opens or
  // closes on nothing.
  if (!script.hook) script.hook = script.scenes[0].voiceover;
  if (!script.cta) script.cta = 'See what it does for you.';
  return script;
}

// ---------------------------------------------------------------------------
// Beats — the 1 clip : 1 beat unit the render pipeline consumes
// ---------------------------------------------------------------------------

export interface StyledBeat {
  code: string;
  /** Scene this beat belongs to (-1 = the hook, -2 = the call to action). */
  sceneIndex: number;
  /** The scene's visual direction — grounds this beat's image prompt. */
  visual: string;
  text: string;
  wordCount: number;
  startSec: number;
}

export function beatCode(index: number): string {
  return 'B' + String(index + 1).padStart(3, '0');
}

function chunkWords(text: string, perBeat: number): string[] {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out: string[] = [];
  for (let i = 0; i < words.length; i += perBeat) out.push(words.slice(i, i + perBeat).join(' '));
  // A trailing scrap shorter than a third of a beat reads as a stutter — fold
  // it back into the beat before it.
  if (out.length > 1 && countWords(out[out.length - 1]) < Math.max(2, Math.round(perBeat / 3))) {
    const tail = out.pop() as string;
    out[out.length - 1] = out[out.length - 1] + ' ' + tail;
  }
  return out;
}

/**
 * Turn the approved script into beats. Every clip is exactly the style's
 * `clipSeconds`, so a scene whose line runs longer than one beat becomes
 * several consecutive beats that all inherit the SAME visual direction — which
 * is what keeps a scene looking like one scene instead of unrelated frames.
 */
export function beatsFromScript(script: StyledScript, style: VideoStyle): StyledBeat[] {
  const per = Math.max(4, style.wordsPerBeat);
  const units: { sceneIndex: number; visual: string; text: string }[] = [];

  const push = (sceneIndex: number, visual: string, line: string) => {
    for (const text of chunkWords(line, per)) units.push({ sceneIndex, visual, text });
  };

  const firstVisual = script.scenes[0]?.visual || '';
  const lastVisual = script.scenes[script.scenes.length - 1]?.visual || firstVisual;
  push(-1, firstVisual, script.hook);
  script.scenes.forEach((s, i) => push(i, s.visual, s.voiceover));
  push(-2, lastVisual, script.cta);

  let running = 0;
  return units.map((u, i) => {
    const beat: StyledBeat = {
      code: beatCode(i),
      sceneIndex: u.sceneIndex,
      visual: u.visual,
      text: u.text,
      wordCount: countWords(u.text),
      startSec: running,
    };
    running += style.clipSeconds;
    return beat;
  });
}

/** Where a beat sits in the film, for the review table. */
export function beatSceneLabel(beat: StyledBeat): string {
  if (beat.sceneIndex === -1) return 'Hook';
  if (beat.sceneIndex === -2) return 'Call to action';
  return 'Scene ' + (beat.sceneIndex + 1);
}

// ---------------------------------------------------------------------------
// Per-beat image prompt lines
// ---------------------------------------------------------------------------

/**
 * One image-prompt line per beat, written by Claude against the style's own
 * image rules. The global style lock and negative prompt are NOT repeated in
 * the lines — buildStyledImagePrompt appends them once per frame.
 */
export async function generateBeatPrompts(
  style: VideoStyle,
  beats: StyledBeat[],
  productContext: string,
): Promise<string[]> {
  const beatLines = beats
    .map((b) => b.code + ' | ' + beatSceneLabel(b) + ' | visual direction: ' + (b.visual || '(none given)') + ' | narration: ' + b.text)
    .join('\n');

  const system = [
    'You write image-generation prompt lines for one styled product film. A global STYLE LOCK already covers the entire look (medium, lighting, palette, grade, texture, aspect ratio) and is appended to every line automatically — NEVER repeat any of it in your lines.',
    '',
    'STYLE: ' + style.name,
    '',
    'Rules for every line:',
    '- 25 to 40 words, tight and concrete, a single line with no line breaks inside it.',
    '- ' + style.imagePromptRules.join('\n- '),
    '- Each beat belongs to a scene and arrives with that scene visual direction. Consecutive beats from the SAME scene must depict the same place, subject and light — vary only what the narration has moved on to. Never invent a new location mid-scene.',
  ].join('\n');

  const user = [
    'PRODUCT / DESCRIPTION:',
    productContext.slice(0, 2500),
    '',
    'BEATS (code | position | visual direction | narration):',
    beatLines,
    '',
    'Write exactly one prompt line per beat. Reply with ONLY a JSON array of objects, in beat order, exactly this shape: [{ "code": "B001", "prompt": "..." }]',
  ].join('\n');

  const raw = await askClaude({ task: 'prompt_writing', system, user, maxTokens: 8192 });
  const parsed = JSON.parse(extractJson(raw, '[', ']'));
  if (!Array.isArray(parsed) || !parsed.length) throw new Error('The AI returned no prompt lines — try again.');

  const byCode = new Map<string, string>();
  for (const item of parsed) {
    if (item && typeof item.code === 'string' && typeof item.prompt === 'string') {
      byCode.set(item.code.trim().toUpperCase(), item.prompt.replace(/\s+/g, ' ').trim());
    }
  }
  const lines = beats.map((b, i) => byCode.get(b.code) || byCode.get(beatCode(i)) || '');
  const missing = lines.reduce((n, l) => n + (l ? 0 : 1), 0);
  if (missing > 0) {
    throw new Error(missing + ' beat prompt' + (missing === 1 ? '' : 's') + ' came back empty — regenerate.');
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Music brief
// ---------------------------------------------------------------------------

/**
 * A one-sentence background-music brief matched to the finished script and to
 * the style's own musical register. The style default is the fallback, so a
 * proxy hiccup never blocks music generation.
 */
export async function suggestMusicPrompt(style: VideoStyle, narration: string): Promise<string> {
  try {
    const raw = await askClaude({
      task: 'short_gen',
      system:
        'You brief instrumental background music for short films in one sentence. Name the genre, the mood, the tempo in beats per minute, and the instrumentation. No quotes, no preamble, no explanation.',
      user:
        'STYLE: ' + style.name + '\nThe house register for this style is: ' + style.musicPrompt +
        '\n\nStay inside that register but tune it to this specific script:\n' + narration.slice(0, 1800),
      maxTokens: 300,
    });
    const line = raw.replace(/^["'\s]+|["'\s]+$/g, '').replace(/\s+/g, ' ').trim();
    return line.length >= 20 ? line.slice(0, 600) : style.musicPrompt;
  } catch {
    return style.musicPrompt;
  }
}
