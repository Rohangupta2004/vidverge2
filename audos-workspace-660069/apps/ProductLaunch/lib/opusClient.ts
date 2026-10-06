// opusClient — every AI call this app makes, and there are only two:
//
//   1. the SCRIPT pass   (Claude Opus 5, extended thinking on)
//   2. the VISION pass   (Claude Opus 5, reading the rendered contact sheet)
//
// Both run on claude-opus-5 — the frontier tier — through the platform proxy
// at POST /proxy/anthropic/v1/messages. No other model id appears anywhere in
// this app, and there is no mock, no cached sample answer and no deterministic
// fallback script: if the model cannot be reached the creator is told, because
// a canned script pretending to be their launch film is worse than an error.

import {
  OPUS_MODEL,
  type LaunchInput,
  type LaunchScene,
  type LaunchScript,
  type Pacing,
  type TransitionType,
} from './launchTypes';

interface WorkspaceDbBridge { token?: string }

function workspaceToken(): string {
  const bridge = (window as unknown as { __workspaceDb?: WorkspaceDbBridge }).__workspaceDb;
  return String(bridge?.token || '');
}

/** The proxy rejects an anonymous call with 401 before Anthropic is contacted. */
function opusHeaders(): Record<string, string> {
  const token = workspaceToken();
  if (!token) {
    throw new Error('The workspace session is not ready yet — reload the page and try again.');
  }
  return { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token };
}

export type OpusContent = string | Array<Record<string, unknown>>;

interface OpusOptions {
  system?: string;
  maxTokens: number;
  thinkingBudget?: number;
}

interface AnthropicBlock { type?: string; text?: string }
interface AnthropicReply {
  content?: AnthropicBlock[];
  error?: { message?: string };
  code?: string;
  message?: string;
}

/**
 * The thinking shape Opus 5 wants differs between the platform catalog
 * (adaptive thinking plus an effort hint) and the raw Anthropic contract (an
 * explicit token budget). Rather than pick one and lose the whole run to a
 * 400, the call walks the ladder once and remembers which rung this
 * deployment accepted.
 */
type ThinkingShape = 'adaptive' | 'budget' | 'none';
let acceptedShape: ThinkingShape | null = null;

function thinkingFields(shape: ThinkingShape, budget: number): Record<string, unknown> {
  if (shape === 'adaptive') return { thinking: { type: 'adaptive' }, output_config: { effort: 'medium' } };
  if (shape === 'budget') return { thinking: { type: 'enabled', budget_tokens: budget } };
  return {};
}

async function postOpus(
  content: OpusContent,
  options: OpusOptions,
  shape: ThinkingShape,
): Promise<{ ok: boolean; status: number; text: string; error: string }> {
  const body: Record<string, unknown> = {
    model: OPUS_MODEL,
    max_tokens: options.maxTokens,
    messages: [{ role: 'user', content }],
    ...thinkingFields(shape, options.thinkingBudget || 2000),
  };
  if (options.system) body.system = options.system;

  const response = await fetch('/proxy/anthropic/v1/messages', {
    method: 'POST',
    headers: opusHeaders(),
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => null)) as AnthropicReply | null;
  if (!response.ok) {
    const detail = data?.error?.message || data?.message || ('Claude answered HTTP ' + response.status);
    return { ok: false, status: response.status, text: '', error: String(detail) };
  }
  const text = (data?.content || [])
    .filter((block) => block && block.type === 'text')
    .map((block) => String(block.text || ''))
    .join('')
    .trim();
  return { ok: true, status: response.status, text, error: '' };
}

/** One Opus 5 turn. Throws with the proxy's own words when it cannot run. */
export async function callOpus(content: OpusContent, options: OpusOptions): Promise<string> {
  const ladder: ThinkingShape[] = acceptedShape ? [acceptedShape] : ['adaptive', 'budget', 'none'];
  let lastError = '';
  for (const shape of ladder) {
    const attempt = await postOpus(content, options, shape);
    if (attempt.ok) {
      acceptedShape = shape;
      if (!attempt.text) throw new Error('Claude Opus 5 returned an empty answer.');
      return attempt.text;
    }
    lastError = attempt.error;
    // Only a request-shape rejection is worth another rung: a 401, 402, 429 or
    // provider outage means exactly the same thing on every shape.
    const reason = attempt.error.toLowerCase();
    const shapeProblem = attempt.status === 400
      && (reason.indexOf('thinking') >= 0
        || reason.indexOf('output_config') >= 0
        || reason.indexOf('unsupported_field') >= 0
        || reason.indexOf('effort') >= 0);
    if (!shapeProblem) break;
  }
  throw new Error(lastError || 'Claude Opus 5 could not be reached.');
}

// ---------------------------------------------------------------------------
// JSON parsing
// ---------------------------------------------------------------------------

export function extractJson(raw: string): unknown {
  const text = String(raw || '').trim();
  const fence = text.indexOf('```');
  let candidate = text;
  if (fence >= 0) {
    const afterOpen = text.slice(fence + 3).replace(/^json/i, '');
    const close = afterOpen.indexOf('```');
    candidate = close >= 0 ? afterOpen.slice(0, close) : afterOpen;
  }
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Claude Opus 5 did not answer with JSON.');
  return JSON.parse(candidate.slice(start, end + 1));
}

// ---------------------------------------------------------------------------
// 1. The script pass
// ---------------------------------------------------------------------------

const TRANSITIONS: TransitionType[] = ['cut', 'crossfade', 'whip', 'flash'];
const PACINGS: Pacing[] = ['fast', 'medium', 'cinematic'];

const SCRIPT_SYSTEM = [
  'You are the creative director of a launch-film studio. You write kinetic-text launch films:',
  'word-by-word type reveals cut to music, short punchy lines, a mid-roll product shot, and a dark',
  'cinematic outro on the brand name.',
  '',
  'House style, non-negotiable:',
  '- Every line is SHORT. Three to six words. A line that needs a comma is two lines.',
  '- Lines are spoken, not written: the way a founder would say it out loud.',
  '- Mark the one or two words a line turns on by wrapping them in asterisks, like *this*.',
  '- Never invent a statistic, a customer, a price or an award. You only know what you are told.',
  '- Never write launch filler: revolutionary, game-changing, the future of.',
  '- The film is for THIS product only. Nothing you write may be reusable for another product.',
  '',
  'You answer with a single JSON object and nothing else: no prose, no code fence, no commentary.',
].join('\n');

/** Evidence the app could read from the creator's own site, when they gave one. */
export interface SiteEvidence {
  title?: string;
  description?: string;
  headlines?: string[];
  bullets?: string[];
  palette?: string[];
  screenshotUrl?: string;
}

export function buildScriptPrompt(input: LaunchInput, evidence: SiteEvidence | null): string {
  const lines: string[] = [
    'Write the launch film for this product.',
    '',
    'PRODUCT NAME: ' + input.productName.trim(),
    'WHAT IT DOES, in the creator own words: ' + input.whatItDoes.trim(),
  ];
  if (input.audience.trim()) lines.push('TARGET AUDIENCE: ' + input.audience.trim());
  if (input.websiteUrl.trim()) lines.push('WEBSITE: ' + input.websiteUrl.trim());
  lines.push('TONE: ' + input.tone);

  if (evidence) {
    lines.push('', 'READ FROM THEIR OWN SITE (use it, do not contradict it):');
    if (evidence.title) lines.push('- page title: ' + evidence.title);
    if (evidence.description) lines.push('- description: ' + evidence.description);
    if (evidence.headlines && evidence.headlines.length) {
      lines.push('- headlines: ' + evidence.headlines.slice(0, 8).join(' | '));
    }
    if (evidence.bullets && evidence.bullets.length) {
      lines.push('- features: ' + evidence.bullets.slice(0, 10).join(' | '));
    }
    if (evidence.palette && evidence.palette.length) {
      lines.push('- colours used on the site: ' + evidence.palette.slice(0, 6).join(', '));
    }
    if (evidence.screenshotUrl) {
      lines.push('- a real screenshot of their product page is available and WILL be shown mid-film.');
    }
  }

  lines.push(
    '',
    'Structure: 5 to 7 scenes.',
    '  scene 1 opens on the tension their audience actually feels, with no product name yet.',
    '  the middle scenes turn, name the product and show what it does.',
    evidence && evidence.screenshotUrl
      ? '  ONE middle scene must be the product scene: say so in visualDirection using the word dashboard or interface, because that is the scene the real screenshot is composited into.'
      : '  no screenshot is available, so describe product moments as type, never as an image.',
    '  the last scene lands the single call to action.',
    '',
    'Pacing: fast cuts on the strong beats, a slow hold on the payoff line.',
    'durationSeconds is per scene, between 2 and 6, and the whole film must land between 22 and 38 seconds.',
    'transitionType is one of cut, crossfade, whip, flash. Cut on a hard beat, crossfade on a soft one.',
    'wordRevealLines is 1 to 3 short lines per scene; each one animates in word by word.',
    'headline is the scene own big line. subtext is one supporting sentence, or an empty string.',
    'brandColor is a hex colour that suits THIS product, as #RRGGBB.',
    'cta is the closing line that sits under the brand name on the outro: short, four to eight words.',
    '',
    'Answer with exactly this JSON shape:',
    '{',
    '  "title": string,',
    '  "scenes": [{ "sceneNumber": number, "headline": string, "subtext": string,',
    '               "wordRevealLines": string[], "visualDirection": string,',
    '               "durationSeconds": number, "transitionType": string }],',
    '  "cta": string,',
    '  "brandColor": string,',
    '  "pacing": "fast" or "medium" or "cinematic"',
    '}',
  );
  return lines.filter(Boolean).join('\n');
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asLines(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => asString(entry)).filter((entry) => entry.length > 0).slice(0, 4);
}

export function normalizeScript(raw: unknown, input: LaunchInput): LaunchScript {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rawScenes = Array.isArray(source.scenes) ? source.scenes : [];

  const scenes: LaunchScene[] = rawScenes
    .map((entry, index) => {
      const scene = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
      const transition = asString(scene.transitionType).toLowerCase() as TransitionType;
      const headline = asString(scene.headline);
      const wordRevealLines = asLines(scene.wordRevealLines);
      if (!headline && !wordRevealLines.length) return null;
      const scenePlan: LaunchScene = {
        sceneNumber: index + 1,
        headline,
        subtext: asString(scene.subtext),
        wordRevealLines,
        visualDirection: asString(scene.visualDirection),
        durationSeconds: Number(scene.durationSeconds) > 0 ? Number(scene.durationSeconds) : 3,
        transitionType: TRANSITIONS.indexOf(transition) >= 0 ? transition : 'cut',
      };
      return scenePlan;
    })
    .filter((scene): scene is LaunchScene => scene !== null)
    .slice(0, 9);

  if (!scenes.length) throw new Error('Claude Opus 5 returned a script with no usable scenes.');

  const pacing = asString(source.pacing).toLowerCase() as Pacing;
  return {
    title: asString(source.title) || input.productName.trim(),
    scenes,
    cta: asString(source.cta),
    brandColor: asString(source.brandColor),
    pacing: PACINGS.indexOf(pacing) >= 0 ? pacing : 'medium',
  };
}

export async function generateLaunchScript(
  input: LaunchInput,
  evidence: SiteEvidence | null,
): Promise<LaunchScript> {
  const answer = await callOpus(buildScriptPrompt(input, evidence), {
    system: SCRIPT_SYSTEM,
    maxTokens: 4096,
    thinkingBudget: 2000,
  });
  return normalizeScript(extractJson(answer), input);
}

// ---------------------------------------------------------------------------
// 2. The vision pass — one contact sheet, one verdict
// ---------------------------------------------------------------------------

const SHEET_QUESTION = [
  'Analyse this video contact sheet. Every tile is a frame of the same launch film, in order,',
  'left to right then top to bottom.',
  'Rate: text readability, pacing, visual hierarchy, brand alignment.',
  'Judge the film, not the grid: tiles that look alike mean a held beat, which may be correct.',
  'Return JSON only: { "score": 0-10, "issues": [], "suggestions": [] }',
].join(' ');

export interface SheetVerdict {
  score: number;
  issues: string[];
  suggestions: string[];
}

function normalizeVerdict(raw: unknown): SheetVerdict {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const score = Number(source.score);
  const list = (value: unknown): string[] => (Array.isArray(value)
    ? value.map((entry) => asString(entry)).filter(Boolean).slice(0, 8)
    : []);
  return {
    score: Number.isFinite(score) ? Math.min(10, Math.max(0, score)) : 0,
    issues: list(source.issues),
    suggestions: list(source.suggestions),
  };
}

/**
 * Send the stitched sheet when the browser could read the frames back, and the
 * individual frame URLs when it could not — a cross-origin frame cannot be
 * read out of a canvas, and a tainted canvas must never silently become no
 * review at all.
 */
export async function analyzeContactSheet(sheet: {
  dataUrl: string;
  frameUrls: string[];
}): Promise<SheetVerdict> {
  const blocks: Array<Record<string, unknown>> = [];

  if (sheet.dataUrl) {
    const comma = sheet.dataUrl.indexOf(',');
    const header = sheet.dataUrl.slice(0, comma);
    const mediaType = header.indexOf('image/png') >= 0 ? 'image/png' : 'image/jpeg';
    blocks.push({
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: sheet.dataUrl.slice(comma + 1) },
    });
  } else {
    for (const url of sheet.frameUrls.slice(0, 8)) {
      blocks.push({ type: 'image', source: { type: 'url', url } });
    }
  }

  if (!blocks.length) throw new Error('There were no frames to analyse.');
  blocks.push({ type: 'text', text: SHEET_QUESTION });

  const answer = await callOpus(blocks, { maxTokens: 1024, thinkingBudget: 1024 });
  return normalizeVerdict(extractJson(answer));
}
