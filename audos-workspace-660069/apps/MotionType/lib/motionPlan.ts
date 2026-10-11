/**
 * MotionType — the animation plan.
 *
 * This module owns the schema, the Claude Opus 5 system prompt, the proxied
 * request and the validator. Nothing downstream of `requestMotionPlan` has to
 * think about the model again: a plan that leaves here is already bounded and
 * already matches the words the user typed.
 *
 * The model reply is untrusted input. Every string that reaches a CSS
 * declaration is matched against an allow-list first, every number is clamped,
 * and a plan whose word sequence is not the user's own is REJECTED rather than
 * repaired — silently swapping in a hardcoded animation would hide a broken
 * generation behind something that looks like it worked.
 */

import { CLAUDE_OPUS } from '../../../lib/aiModels';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const ENTRANCES = [
  'fadeUp',
  'fadeIn',
  'scaleIn',
  'slideLeft',
  'slideRight',
  'glitch',
  'typewriter',
  'blur',
] as const;
export type Entrance = (typeof ENTRANCES)[number];

export const EXITS = ['fadeOut', 'scaleOut', 'slideUp', 'none'] as const;
export type Exit = (typeof EXITS)[number];

export const TEXT_TRANSFORMS = ['uppercase', 'lowercase', 'capitalize', 'none'] as const;
export type TextTransform = (typeof TEXT_TRANSFORMS)[number];

export const STYLE_PRESETS = ['Cinematic', 'Energetic', 'Minimal', 'Dramatic', 'Glitch', 'Elegant'] as const;
export type StylePreset = (typeof STYLE_PRESETS)[number];

export const SPEEDS = ['Slow', 'Normal', 'Fast'] as const;
export type Speed = (typeof SPEEDS)[number];

export const COLOR_THEMES = ['Cosmic', 'Monochrome', 'Fire', 'Ice', 'Gold'] as const;
export type ColorTheme = (typeof COLOR_THEMES)[number];

export interface MotionWord {
  word: string;
  delayMs: number;
  durationMs: number;
  entrance: Entrance;
  exit: Exit;
  fontSize: string;
  fontWeight: string;
  color: string;
  letterSpacing: string;
  textTransform: TextTransform;
  emphasis: boolean;
}

export interface MotionPlan {
  animationName: string;
  durationMs: number;
  background: string;
  words: MotionWord[];
}

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

export const TEXT_MIN = 1;
export const TEXT_MAX = 120;

const PLAN_MIN_MS = 1500;
const PLAN_MAX_MS = 20000;
const WORD_MIN_MS = 150;
const WORD_MAX_MS = 4000;
const MAX_WORDS = 40;

/**
 * The output budget for one plan. The task contract fixes this at 1024; a long
 * sentence can therefore run the model out of room mid-object, which surfaces
 * as a `max_tokens` stop reason and an inline "reply was cut short" error
 * rather than a half-parsed plan.
 */
const MAX_TOKENS = 1024;

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return n < min ? min : n > max ? max : n;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// CSS value sanitisers
// ---------------------------------------------------------------------------

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const COLOR_FN = /^(?:rgb|rgba|hsl|hsla)\(\s*[0-9a-z.,%/\s+-]*\)$/i;
const GRADIENT_FN = /^(?:linear|radial|conic)-gradient\(\s*[0-9a-z.,%/#()\s+-]*\)$/i;
const LENGTH = /^(-?\d+(?:\.\d+)?)(rem|em|px|vw|vh|%)$/;

const NAMED_COLORS = [
  'white', 'black', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'violet',
  'pink', 'cyan', 'magenta', 'gold', 'silver', 'gray', 'grey', 'crimson', 'teal',
  'navy', 'ivory', 'salmon', 'tomato', 'khaki', 'lime', 'indigo', 'orchid', 'plum',
  'beige', 'azure', 'coral', 'linen', 'snow', 'wheat', 'transparent',
];

/** Anything that could escape a declaration, reach the network or open a tag. */
const DANGEROUS = /url\(|expression|javascript:|@import|[;{}<>"']/i;

export function safeColor(raw: unknown, fallback: string): string {
  const value = String(raw == null ? '' : raw).trim();
  if (!value || value.length > 64 || DANGEROUS.test(value)) return fallback;
  if (HEX.test(value)) return value;
  if (COLOR_FN.test(value)) return value;
  if (NAMED_COLORS.indexOf(value.toLowerCase()) >= 0) return value.toLowerCase();
  return fallback;
}

/** A flat colour or a gradient — the only two things the stage background may be. */
export function safeBackground(raw: unknown, fallback: string): string {
  const value = String(raw == null ? '' : raw).trim();
  if (!value || value.length > 400 || DANGEROUS.test(value)) return fallback;
  if (GRADIENT_FN.test(value)) return value;
  return safeColor(value, fallback);
}

const FONT_SIZE_LIMITS: Record<string, [number, number]> = {
  rem: [0.5, 14],
  em: [0.5, 14],
  px: [8, 240],
  vw: [1, 22],
  vh: [1, 40],
  '%': [20, 900],
};

export function safeFontSize(raw: unknown, fallback: string): string {
  const value = String(raw == null ? '' : raw).trim().toLowerCase();
  const match = LENGTH.exec(value);
  if (!match) return fallback;
  const limits = FONT_SIZE_LIMITS[match[2]];
  if (!limits) return fallback;
  return round2(clamp(Number(match[1]), limits[0], limits[1])) + match[2];
}

const TRACKING_LIMITS: Record<string, [number, number]> = {
  em: [-0.2, 0.8],
  rem: [-0.2, 0.8],
  px: [-12, 40],
};

export function safeLetterSpacing(raw: unknown, fallback: string): string {
  const value = String(raw == null ? '' : raw).trim().toLowerCase();
  if (value === 'normal') return 'normal';
  const match = LENGTH.exec(value);
  if (!match) return fallback;
  const limits = TRACKING_LIMITS[match[2]];
  if (!limits) return fallback;
  return round2(clamp(Number(match[1]), limits[0], limits[1])) + match[2];
}

export function safeFontWeight(raw: unknown, fallback: string): string {
  const value = String(raw == null ? '' : raw).trim().toLowerCase();
  if (value === 'normal') return '400';
  if (value === 'bold') return '700';
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return String(Math.round(clamp(n, 100, 900) / 100) * 100);
}

/** Plain text only — the name is rendered as a React child, never as markup. */
export function safeName(raw: unknown, fallback: string): string {
  const value = String(raw == null ? '' : raw).replace(/[\u0000-\u001f<>]/g, '').trim();
  return value ? value.slice(0, 60) : fallback;
}

/** A length in virtual stage pixels. `emBase` scales em/rem for letter-spacing. */
export function lengthToPx(value: string, emBase: number, stageW: number, stageH: number): number {
  const match = LENGTH.exec(String(value).trim().toLowerCase());
  if (!match) return 0;
  const n = Number(match[1]);
  switch (match[2]) {
    case 'rem':
    case 'em':
      return n * emBase;
    case 'px':
      return n;
    case 'vw':
      return (n / 100) * stageW;
    case 'vh':
      return (n / 100) * stageH;
    default:
      return (n / 100) * emBase;
  }
}

export function applyTextTransform(word: string, transform: TextTransform): string {
  if (transform === 'uppercase') return word.toUpperCase();
  if (transform === 'lowercase') return word.toLowerCase();
  if (transform === 'capitalize') {
    return word.replace(/(^|\s)(\S)/g, function upper(_m, lead: string, ch: string) {
      return lead + ch.toUpperCase();
    });
  }
  return word;
}

// ---------------------------------------------------------------------------
// Theme fallbacks — used only when the model emits an unusable value
// ---------------------------------------------------------------------------

interface ThemeFallback {
  color: string;
  background: string;
}

export const THEME_FALLBACK: Record<ColorTheme, ThemeFallback> = {
  Cosmic: { color: '#e8e4ff', background: '#07070f' },
  Monochrome: { color: '#f5f5f5', background: '#0a0a0a' },
  Fire: { color: '#ffd9a8', background: '#120604' },
  Ice: { color: '#d8f4ff', background: '#04101a' },
  Gold: { color: '#fcd34d', background: '#0d0a04' },
};

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

export function splitWords(text: string): string[] {
  return String(text).trim().split(/\s+/).filter(Boolean);
}

/**
 * Comparison key for "is this still the user's text?". Case and punctuation are
 * ignored so an uppercase or comma-trimmed rendering still passes, but the
 * word itself and its position in the sequence must survive intact.
 */
function wordKey(word: string): string {
  return String(word)
    .toLowerCase()
    .replace(/[^0-9a-z\u00c0-\u024f]+/g, '');
}

function keySequence(words: string[]): string[] {
  return words.map(wordKey).filter(Boolean);
}

// ---------------------------------------------------------------------------
// System prompt (baked in verbatim)
// ---------------------------------------------------------------------------

export const SYSTEM_PROMPT = `You are a professional kinetic typography director. Given text, a style preset, speed and colour theme, return ONLY valid JSON without Markdown or surrounding prose.

Use this schema:

{
"animationName": "string",
"durationMs": 5000,
"background": "CSS colour or gradient",
"words": [
{
"word": "string",
"delayMs": 0,
"durationMs": 800,
"entrance": "fadeUp",
"exit": "fadeOut",
"fontSize": "4rem",
"fontWeight": "700",
"color": "#ffffff",
"letterSpacing": "-0.03em",
"textTransform": "uppercase",
"emphasis": true
}
]
}

Allowed entrance values:
"fadeUp", "fadeIn", "scaleIn", "slideLeft", "slideRight", "glitch", "typewriter", "blur".

Allowed exit values:
"fadeOut", "scaleOut", "slideUp", "none".

Allowed text transforms:
"uppercase", "lowercase", "capitalize", "none".

Creative requirements:

- Generate a visually coherent, professionally art-directed animation.
- Use varied timing and rhythm.
- Give emphasized words stronger visual hierarchy.
- Choose styles, colour and typography consistent with the requested preset.
- Preserve the user's exact text and its original word order.
- Split the supplied text into words without inventing, removing or rewriting content.
- Ensure all words appear within the animation duration.
- Avoid overlapping words unless the visual concept deliberately requires it.
- Keep the composition legible and centred within the canvas.
- Use valid CSS values and bounded, sensible timing values.
- Return a complete animation plan that the renderer can interpret directly.`;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type FailureKind = 'auth' | 'network' | 'http' | 'empty' | 'invalid';

// The `?: undefined` members are deliberate. They let a caller read
// `result.message` or `result.plan` without narrowing the union first, which
// keeps this compiling under a non-strict tsconfig as well as a strict one.
export type PlanResult =
  | { ok: true; plan: MotionPlan; kind?: undefined; message?: undefined }
  | { ok: false; plan?: undefined; kind: FailureKind; message: string };

function fail(kind: FailureKind, message: string): PlanResult {
  return { ok: false, kind, message };
}

/** Strip an optional ```json fence and anything either side of the object. */
export function extractJson(raw: string): string {
  let text = String(raw == null ? '' : raw).trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  if (fenced) text = fenced[1].trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) text = text.slice(first, last + 1);
  return text;
}

/**
 * Turn a parsed reply into a plan, or say why it cannot be one.
 *
 * `sourceText` is the user's own input: the returned word sequence has to match
 * it, or the plan is not an animation of what they asked for.
 */
export function validatePlan(raw: unknown, sourceText: string, theme: ColorTheme): PlanResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return fail('invalid', 'The director returned something that is not an animation plan.');
  }
  const input = raw as Record<string, unknown>;
  const wordsRaw = input.words;
  if (!Array.isArray(wordsRaw) || wordsRaw.length === 0) {
    return fail('invalid', 'The plan arrived without any words to animate.');
  }
  if (wordsRaw.length > MAX_WORDS) {
    return fail('invalid', 'The plan contains more words than the stage can hold.');
  }

  const fallback = THEME_FALLBACK[theme] || THEME_FALLBACK.Cosmic;
  const durationMs = Math.round(clamp(Number(input.durationMs), PLAN_MIN_MS, PLAN_MAX_MS));

  const expected = keySequence(splitWords(sourceText));
  const received = keySequence(wordsRaw.map(function pick(entry) {
    return entry && typeof entry === 'object' ? String((entry as Record<string, unknown>).word || '') : '';
  }));

  if (expected.length !== received.length || expected.some((key, i) => key !== received[i])) {
    return fail(
      'invalid',
      'The director changed your words. Nothing was rendered — retry to get a plan for the exact text you typed.',
    );
  }

  const words: MotionWord[] = [];
  for (let i = 0; i < wordsRaw.length; i++) {
    const entry = wordsRaw[i] as Record<string, unknown>;
    if (!entry || typeof entry !== 'object') {
      return fail('invalid', 'One of the words in the plan is malformed.');
    }
    const word = String(entry.word == null ? '' : entry.word).replace(/[\u0000-\u001f]/g, '').slice(0, 48);
    if (!word.trim()) {
      return fail('invalid', 'One of the words in the plan is empty.');
    }
    const entrance = ENTRANCES.indexOf(entry.entrance as Entrance) >= 0 ? (entry.entrance as Entrance) : 'fadeUp';
    const exit = EXITS.indexOf(entry.exit as Exit) >= 0 ? (entry.exit as Exit) : 'fadeOut';
    const textTransform =
      TEXT_TRANSFORMS.indexOf(entry.textTransform as TextTransform) >= 0
        ? (entry.textTransform as TextTransform)
        : 'none';

    words.push({
      word,
      // A delay past the end of the sequence would hide the word entirely, so
      // it is pulled back inside the timeline instead of being honoured.
      delayMs: Math.round(clamp(Number(entry.delayMs), 0, Math.max(0, durationMs - WORD_MIN_MS))),
      durationMs: Math.round(clamp(Number(entry.durationMs), WORD_MIN_MS, WORD_MAX_MS)),
      entrance,
      exit,
      fontSize: safeFontSize(entry.fontSize, '4rem'),
      fontWeight: safeFontWeight(entry.fontWeight, '700'),
      color: safeColor(entry.color, fallback.color),
      letterSpacing: safeLetterSpacing(entry.letterSpacing, '-0.02em'),
      textTransform,
      emphasis: entry.emphasis === true,
    });
  }

  return {
    ok: true,
    plan: {
      animationName: safeName(input.animationName, 'Untitled Sequence'),
      durationMs,
      background: safeBackground(input.background, fallback.background),
      words,
    },
  };
}

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

export interface PlanRequest {
  text: string;
  style: StylePreset;
  speed: Speed;
  colorTheme: ColorTheme;
}

/** Anthropic replies are a content-block array; concatenate the text blocks. */
function extractContent(payload: unknown): string {
  const data = payload as Record<string, unknown> | null;
  const blocks = data && Array.isArray(data.content) ? (data.content as unknown[]) : [];
  return blocks
    .map(function text(block) {
      const b = block as Record<string, unknown> | null;
      return b && typeof b.text === 'string' ? b.text : '';
    })
    .join('');
}

/**
 * One Claude Opus 5 call through the workspace's authenticated Anthropic proxy.
 *
 * Never throws: every outcome — missing session, dead network, HTTP error,
 * unparseable body, invalid plan — comes back as a PlanResult the UI can show
 * beside a Retry button. The raw reply is logged to the console on a parse or
 * validation failure; the workspace token never is.
 */
export async function requestMotionPlan(request: PlanRequest): Promise<PlanResult> {
  const ws = typeof window === 'undefined' ? null : ((window as any).__workspaceDb as { token?: string } | undefined);
  if (!ws || !ws.token) {
    return fail('auth', 'Workspace authentication is unavailable. Reload the page and try again.');
  }

  let response: Response;
  try {
    response = await fetch('/proxy/anthropic/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-DB-Token': ws.token,
      },
      body: JSON.stringify({
        model: CLAUDE_OPUS,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content:
              'Text: "' + request.text + '" | Style: ' + request.style +
              ' | Speed: ' + request.speed + ' | Colors: ' + request.colorTheme,
          },
        ],
      }),
    });
  } catch (networkError) {
    console.warn('[MotionType] network failure reaching the Anthropic proxy', networkError);
    return fail('network', 'Could not reach the animation director. Check your connection and retry.');
  }

  const payload = await response.json().catch(function noBody() {
    return null;
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      return fail('auth', 'Your workspace session was rejected. Reload the page to sign in again.');
    }
    const detail = payload && (payload as any).error;
    const message = detail && typeof detail.message === 'string' ? detail.message : '';
    console.warn('[MotionType] proxy error', response.status, message || payload);
    return fail(
      'http',
      message
        ? 'The director refused the request: ' + message
        : 'The director could not be reached (HTTP ' + response.status + ').',
    );
  }

  const content = extractContent(payload);
  if (!content.trim()) {
    return fail('empty', 'The director returned an empty reply. Retry to generate the animation.');
  }
  if (payload && (payload as any).stop_reason === 'max_tokens') {
    console.warn('[MotionType] reply truncated at the output cap:', content);
    return fail('invalid', 'The plan was cut short before it finished. Try shorter text, then retry.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(content));
  } catch (parseError) {
    console.warn('[MotionType] reply was not valid JSON. Raw reply:', content);
    return fail('invalid', 'The director replied with something that is not valid JSON. Retry to try again.');
  }

  const result = validatePlan(parsed, request.text, request.colorTheme);
  if (!result.ok) {
    console.warn('[MotionType] plan rejected:', result.message, 'Raw reply:', content);
  }
  return result;
}
