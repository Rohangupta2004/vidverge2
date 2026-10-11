// SCENE SPEC — the one data structure the whole Director pipeline turns on.
//
// The architecture is deliberately data-driven and subject-agnostic:
//
//     script -> LLM visual director -> SceneSpec[] -> Remotion -> MP4
//
// Nothing in this module knows anything about SaaS, biology, history or
// finance. The LLM reads the narration and decides which of the ten visual
// grammars explains it best; every downstream component (the browser preview
// in components/visuals, the server composition in remotion/sceneForgeSource)
// renders whatever the spec says and nothing else. Adding subject knowledge
// here would break the promise that the system works for ANY explainer.
import { workspaceToken } from './proxy';

/** The visual grammars the director may choose from. */
export type VisualType =
  | 'text_reveal'      // dramatic text/numbers: "365 DAYS", "1947"
  | 'diagram'          // organs, systems, science diagrams
  | 'timeline'         // historical events drawn left to right
  | 'chart'            // bar/line growth chart (compound interest etc)
  | 'orbit'            // circular/orbital path animations
  | 'flow'             // A -> B -> C with animated particles
  | 'map'              // geographic callout
  | 'image_kenburns'   // archival/B-roll image with pan+zoom
  | 'callout'          // label pointing to element
  | 'highlight';       // highlight keyword or number in caption

export const VISUAL_TYPES: VisualType[] = [
  'text_reveal', 'diagram', 'timeline', 'chart', 'orbit', 'flow', 'map', 'image_kenburns', 'callout', 'highlight',
];

/** Where the HeyGen narrator sits while this segment plays. */
export type AvatarPlacement = 'small_right' | 'small_left' | 'hidden' | 'full';

export const AVATAR_PLACEMENTS: AvatarPlacement[] = ['small_right', 'small_left', 'hidden', 'full'];

export interface SceneVisual {
  type: VisualType;
  /** The things on screen, e.g. ['heart', 'blood', 'arteries']. */
  elements: string[];
  /** Free-text motion hint, e.g. 'blood_flow', 'orbit_path', 'line'. */
  animation?: string;
  /** The dramatic caption burned into the graphic, e.g. '365 DAYS'. */
  label?: string;
  /** 'left_to_right' | 'top_to_bottom' | 'clockwise' | 'counter_clockwise'. */
  direction?: string;
  /** Chart series, e.g. [10000, 11000, 12100, 13310]. */
  dataPoints?: number[];
  /** What picture an image_kenburns scene should show. */
  imagePrompt?: string;
  /**
   * Resolved by lib/visualAssets AFTER analysis — never written by the LLM.
   * An image_kenburns scene with no url falls back to a typographic plate
   * rather than rendering an empty frame.
   */
  imageUrl?: string;
  /** Credit line for a stock photo, shown small in the corner. */
  imageCredit?: string;
}

export interface SceneSpec {
  scene: number;
  /** Approximate start time inside the narration, in seconds. */
  startSec: number;
  durationSec: number;
  /** The sentence(s) being spoken over this visual. */
  narration: string;
  visual: SceneVisual;
  avatar: AvatarPlacement;
  /** Short on-screen subtitle for the caption bar. */
  caption?: string;
}

/** Words per second used to estimate a spoken script's runtime (~150 wpm). */
export const WORDS_PER_SECOND = 2.5;

/** No segment shorter than this: a visual that flashes past explains nothing. */
export const MIN_SCENE_SEC = 1.6;
/** Nor longer than this: a single graphic held too long goes dead. */
export const MAX_SCENE_SEC = 14;

export function estimateScriptSeconds(script: string): number {
  const words = String(script || '').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(4, Math.round(words / WORDS_PER_SECOND));
}

const asArray = (value: unknown): any[] => (Array.isArray(value) ? value : []);

function asVisualType(value: unknown): VisualType {
  const raw = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return (VISUAL_TYPES as string[]).includes(raw) ? (raw as VisualType) : 'text_reveal';
}

function asAvatar(value: unknown): AvatarPlacement {
  const raw = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return (AVATAR_PLACEMENTS as string[]).includes(raw) ? (raw as AvatarPlacement) : 'small_right';
}

function asNumbers(value: unknown): number[] | undefined {
  const points = asArray(value)
    .map((entry) => (typeof entry === 'object' && entry ? Number((entry as any).value ?? (entry as any).y) : Number(entry)))
    .filter((entry) => Number.isFinite(entry));
  return points.length >= 2 ? points.slice(0, 12) : undefined;
}

function asStrings(value: unknown, limit: number): string[] {
  return asArray(value)
    .map((entry) => (typeof entry === 'object' && entry ? String((entry as any).label ?? (entry as any).name ?? '') : String(entry ?? '')))
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function clampSec(value: unknown, fallback: number): number {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return fallback;
  return Math.min(MAX_SCENE_SEC, Math.max(MIN_SCENE_SEC, seconds));
}

/**
 * Coerce one raw LLM object into a SceneSpec that every renderer can trust.
 * Nothing is rejected for being imperfect — a malformed field is replaced by
 * a sane default, because a slightly-wrong graphic beats a failed render.
 */
export function normalizeSceneSpec(raw: any, index: number): SceneSpec {
  const visual = (raw && typeof raw.visual === 'object' && raw.visual) || {};
  const type = asVisualType(visual.type ?? raw?.visualType);
  const narration = String(raw?.narration ?? raw?.text ?? '').trim();
  const label = String(visual.label ?? '').trim();
  const caption = String(raw?.caption ?? '').trim();
  return {
    scene: Number.isFinite(Number(raw?.scene)) ? Number(raw.scene) : index + 1,
    startSec: Math.max(0, Number(raw?.startSec) || 0),
    durationSec: clampSec(raw?.durationSec, 4),
    narration,
    visual: {
      type,
      elements: asStrings(visual.elements, 8),
      ...(visual.animation ? { animation: String(visual.animation).trim().slice(0, 48) } : {}),
      ...(label ? { label: label.slice(0, 48) } : {}),
      ...(visual.direction ? { direction: String(visual.direction).trim().slice(0, 32) } : {}),
      ...(asNumbers(visual.dataPoints) ? { dataPoints: asNumbers(visual.dataPoints) } : {}),
      ...(visual.imagePrompt ? { imagePrompt: String(visual.imagePrompt).trim().slice(0, 400) } : {}),
      ...(typeof visual.imageUrl === 'string' && /^https?:\/\//.test(visual.imageUrl) ? { imageUrl: visual.imageUrl } : {}),
      ...(visual.imageCredit ? { imageCredit: String(visual.imageCredit).trim().slice(0, 80) } : {}),
    },
    avatar: asAvatar(raw?.avatar),
    caption: (caption || narration).slice(0, 140),
  };
}

/**
 * Make a list of specs into a CONTIGUOUS timeline. The model's own startSec
 * values are only approximate and frequently overlap or leave holes; the
 * narration is one continuous take, so the scene order is authoritative and
 * each scene starts exactly where the previous one ended. Durations are kept
 * as written — that is the model's pacing judgement.
 */
export function sequenceSpecs(specs: SceneSpec[]): SceneSpec[] {
  let cursor = 0;
  return [...specs]
    .sort((a, b) => a.startSec - b.startSec || a.scene - b.scene)
    .map((spec, index) => {
      const next = { ...spec, scene: index + 1, startSec: Number(cursor.toFixed(3)) };
      cursor += spec.durationSec;
      return next;
    });
}

export function totalDurationSec(specs: SceneSpec[]): number {
  return specs.reduce((sum, spec) => sum + spec.durationSec, 0);
}

/**
 * Stretch or compress the plan onto the narration's REAL runtime.
 *
 * The director estimates timing from word counts; HeyGen then reports the
 * actual length of the rendered narration. Without this the visuals drift
 * further out of sync with every scene — the single most visible failure in
 * an explainer. Scaling every duration by the same factor keeps the
 * director's relative pacing intact while locking the end of the last scene
 * to the end of the speech.
 */
export function fitSpecsToDuration(specs: SceneSpec[], actualSec: number): SceneSpec[] {
  const planned = totalDurationSec(specs);
  if (!specs.length || !(actualSec > 0) || !(planned > 0)) return specs;
  const scale = actualSec / planned;
  // A wild mismatch means the narration is not the script that was analysed;
  // stretching 3x would produce frozen graphics, so the plan is left alone.
  if (scale < 0.25 || scale > 4) return specs;
  return sequenceSpecs(specs.map((spec) => ({ ...spec, durationSec: Number((spec.durationSec * scale).toFixed(3)) })));
}

/** The spec playing at a given second, or null past the end. */
export function activeSpecAt(specs: SceneSpec[], seconds: number): SceneSpec | null {
  for (const spec of specs) {
    if (seconds >= spec.startSec && seconds < spec.startSec + spec.durationSec) return spec;
  }
  return specs.length ? specs[specs.length - 1] : null;
}

/** 0..1 through a single scene at a given absolute second. */
export function progressWithin(spec: SceneSpec, seconds: number): number {
  const value = (seconds - spec.startSec) / Math.max(0.001, spec.durationSec);
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

// ——— The visual director ———

const DIRECTOR_SYSTEM = [
  'You are a visual director for educational videos. For each narration segment, decide what animation or graphic would best help the viewer understand what the narrator is saying. Think like a documentary filmmaker.',
  '',
  'You work on ANY subject — history, science, biology, finance, geography, technology, sport, art. Never assume the script is about software or a product.',
  '',
  'Split the narration into segments that each carry ONE idea. A segment is usually one or two sentences and runs 3-8 seconds. Short, punchy lines deserve their own short segment; a dense explanation deserves a longer one. Never leave a sentence out and never invent narration that is not in the script — the segments, read in order, must reproduce the script word for word.',
  '',
  'Choose the visual type that genuinely explains the line:',
  '- text_reveal: a number or short phrase IS the point ("365 DAYS", "1947", "14,641"). Put the exact words in visual.label.',
  '- diagram: a thing with parts (heart and arteries, an engine, a cell). elements lists the parts, most important first.',
  '- timeline: dated events in order. Each element is one event written as "YEAR Label", e.g. "1947 Independence".',
  '- chart: quantities that change. dataPoints carries the real numbers in order; elements carries their labels if they have any.',
  '- orbit: one thing circling another (Earth and Sun, electron and nucleus, a satellite). elements is [centre, orbiter].',
  '- flow: a sequence or cycle, A to B to C (lungs to blood to cell, water cycle, a supply chain). elements are the stages in order; animation names what travels, e.g. "oxygen" or "water".',
  '- map: a place matters. elements[0] is the place name.',
  '- image_kenburns: only when a photograph is genuinely the best explanation (archival moments, real places, real artefacts). Write imagePrompt as a plain description of the photo.',
  '- callout: pointing at one specific detail and naming it. label is the name, elements[0] is what is being pointed at.',
  '- highlight: the spoken words themselves carry the weight and one word or number should flare. label is that word.',
  '',
  'Vary the types. A film that is ten text_reveals in a row is a failure. Reach for image_kenburns at most a quarter of the time.',
  '',
  'Decide where the narrator sits for each segment:',
  '- full: the narrator alone, no graphic. Use it for the opening line and the closing line.',
  '- small_right or small_left: the narrator as a small corner inset over the graphic. This is the normal case. Alternate sides occasionally; keep the narrator on the side away from the busy part of the graphic.',
  '- hidden: the graphic alone, narration continues over it. Use it when the graphic needs the whole frame.',
  '',
  'caption is a SHORT subtitle for the segment — at most 90 characters, the spoken line trimmed, not a paraphrase.',
  '',
  'Reply with JSON only, in exactly this shape:',
  '{"scenes":[{"scene":1,"startSec":0,"durationSec":5,"narration":"...","visual":{"type":"text_reveal","elements":["..."],"animation":"...","label":"...","direction":"left_to_right","dataPoints":[1,2],"imagePrompt":"..."},"avatar":"small_right","caption":"..."}]}',
  'Omit any optional visual field that does not apply. Do not wrap the JSON in markdown.',
].join('\n');

export interface AnalyzeOptions {
  /** The narration's real runtime when it is already known (HeyGen reports it). */
  targetDurationSec?: number;
  /** Extra direction from the customer, e.g. "keep it playful". */
  notes?: string;
  model?: string;
  signal?: AbortSignal;
}

export class DirectorError extends Error {
  code: string;
  constructor(message: string, code = 'director_failed') {
    super(message);
    this.name = 'DirectorError';
    this.code = code;
  }
}

function firstJsonBlock(text: string): string | null {
  const trimmed = String(text || '').replace(/```(?:json)?/gi, '').trim();
  const start = trimmed.search(/[{[]/);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (escaped) { escaped = false; continue; }
    if (inString) {
      if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0) return trimmed.slice(start, i + 1);
    }
  }
  return trimmed.slice(start);
}

/**
 * STEP 1 OF THE PIPELINE. Read the whole narration and return the timed
 * visual plan for it.
 *
 * Runs on the frontier text model deliberately: deciding which of ten
 * grammars explains a sentence, and extracting the numbers and event labels
 * that grammar needs, is exactly the consequential multi-step judgement the
 * balanced tier is not for.
 */
export async function analyzeScriptForVisuals(script: string, options: AnalyzeOptions = {}): Promise<SceneSpec[]> {
  const text = String(script || '').trim();
  if (text.length < 20) throw new DirectorError('Write a few more sentences of narration before analysing it.', 'script_too_short');
  const seconds = options.targetDurationSec && options.targetDurationSec > 0
    ? Math.round(options.targetDurationSec)
    : estimateScriptSeconds(text);

  const user = [
    `The narration runs about ${seconds} seconds end to end. Plan segments that add up to roughly that.`,
    options.notes ? `Direction from the film-maker: ${options.notes}` : '',
    '',
    'NARRATION:',
    text.slice(0, 12000),
  ].filter(Boolean).join('\n');

  let response: Response;
  try {
    response = await fetch('/proxy/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': workspaceToken() },
      body: JSON.stringify({
        model: options.model || 'gpt-5.6-sol',
        reasoning_effort: 'medium',
        max_completion_tokens: 8192,
        response_format: { type: 'json_object' },
        stream: false,
        messages: [
          { role: 'system', content: DIRECTOR_SYSTEM },
          { role: 'user', content: user },
        ],
      }),
      signal: options.signal,
    });
  } catch (e: any) {
    if (options.signal?.aborted) throw new DirectorError('Analysis was cancelled.', 'cancelled');
    throw new DirectorError(`The visual director could not be reached: ${String(e?.message || e)}`, 'network');
  }

  const payload = await response.json().catch(() => ({} as any));
  if (!response.ok) {
    const code = String(payload?.code || '');
    const detail = payload?.error?.message || payload?.message || `HTTP ${response.status}`;
    if (code === 'no_credentials' || response.status === 401) {
      throw new DirectorError('Your workspace session is not ready yet. Refresh the page and try again.', 'no_credentials');
    }
    if (response.status === 429) throw new DirectorError('The director model is rate-limited right now. Wait a moment and analyse again.', 'rate_limited');
    throw new DirectorError(`The visual director refused the script: ${String(detail).slice(0, 200)}`, code || 'rejected');
  }

  const content = String(payload?.choices?.[0]?.message?.content || '').trim();
  const block = firstJsonBlock(content);
  if (!block) throw new DirectorError('The visual director returned no plan. Try analysing again.', 'empty');
  let parsed: any;
  try { parsed = JSON.parse(block); }
  catch {
    console.error('[SceneForge Director] unparsable plan', { preview: content.slice(0, 600) });
    throw new DirectorError('The visual director returned an unreadable plan. Try analysing again.', 'invalid_json');
  }
  const rows = Array.isArray(parsed) ? parsed : asArray(parsed?.scenes ?? parsed?.segments ?? parsed?.plan);
  if (!rows.length) throw new DirectorError('The visual director produced no segments for this script.', 'empty');
  return sequenceSpecs(rows.map(normalizeSceneSpec));
}

/**
 * A plan written without any model call. Used only when the director fails
 * and the customer still wants to see something: the script is cut into
 * sentence groups and every segment is a highlight of its own words. It is
 * honestly worse than a directed plan and the UI says so.
 */
export function fallbackPlan(script: string): SceneSpec[] {
  // Split on sentence enders by hand. A lookbehind regex would read better,
  // but a regex LITERAL containing one is a parse-time SyntaxError on older
  // Safari — which would take the whole space bundle down, not just this app.
  const flat = String(script || '').replace(/\s+/g, ' ').trim();
  const sentences: string[] = [];
  let current = '';
  for (const character of flat) {
    current += character;
    if (character === '.' || character === '!' || character === '?') {
      sentences.push(current.trim());
      current = '';
    }
  }
  if (current.trim()) sentences.push(current.trim());
  const groups: string[] = [];
  for (let i = 0; i < sentences.length; i += 2) groups.push(sentences.slice(i, i + 2).join(' '));
  return sequenceSpecs(groups.map((narration, index) => normalizeSceneSpec({
    scene: index + 1,
    durationSec: clampSec(estimateScriptSeconds(narration), 4),
    narration,
    visual: { type: index === 0 ? 'text_reveal' : 'highlight', elements: [], label: '' },
    avatar: index === 0 ? 'full' : index % 2 ? 'small_left' : 'small_right',
    caption: narration,
  }, index)));
}
