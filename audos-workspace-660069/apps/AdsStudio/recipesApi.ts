/**
 * ADS STUDIO — RECIPES data layer.
 *
 * Saved Videos is the one sub-section behind the Recipes tab that needs data
 * from outside the eight-step workflow. The Character Studio and Auto-Write
 * Angle helpers below (the `vv_characters` bible and the five-angle writer) are
 * no longer mounted — the Runway recipes cast and position themselves through
 * lib/adPersona — but they stay here because other VidVerge surfaces read the
 * same character bible and the same angle shape.
 *
 *   Saved Videos       — the workspace video catalog. The browser cannot call
 *                        GET /api/workspaces/:id/videos directly (it answers
 *                        only to a workspace-credentialed caller), so the
 *                        `vv-workspace-videos` server function reads it and
 *                        classifies each row's provider — the catalog itself
 *                        has no provider column.
 */

import { AdAngle, callHook, newId, wsToken } from './api';

// ---------------------------------------------------------------------------
// Character Studio
// ---------------------------------------------------------------------------

export const CHARACTERS_TABLE = 'vv_characters';

export interface VVCharacter {
  id: number;
  name: string;
  description: string | null;
  style: string | null;
  image_url: string | null;
  reference_images: string[] | null;
  created_at?: string;
}

export const STYLE_PRESETS = [
  'Cinematic realistic',
  '3D animated',
  'Documentary',
  'Anime',
  'Paper collage',
  'Noir',
];

export function splitStyleTags(style: string | null | undefined): string[] {
  return (style || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 6);
}

/** Build the portrait prompt from the structured character brief. */
export function buildPortraitPrompt(input: {
  name: string;
  appearance: string;
  personality: string;
  style: string;
}): string {
  const parts: string[] = [];
  parts.push(
    `Character reference portrait of ${input.name || 'an original video character'}, framed chest-up, facing slightly off camera, soft key light, clean dark studio backdrop.`,
  );
  if (input.appearance.trim()) parts.push(`Appearance: ${input.appearance.trim()}.`);
  if (input.personality.trim()) {
    parts.push(`Their personality reads through the pose and expression: ${input.personality.trim()}.`);
  }
  parts.push(
    input.style.trim()
      ? `Visual style: ${input.style.trim()}.`
      : 'Visual style: cinematic, premium video production look.',
  );
  parts.push('One single character, full head fully inside the frame, consistent recognizable design suitable for reuse across many video scenes.');
  return parts.join(' ');
}

/** Pull the appearance / personality halves back out of a saved description. */
export function splitCharacterDescription(description: string | null): { appearance: string; personality: string } {
  const desc = description || '';
  const match = desc.match(/Personality:\s*([\s\S]*)$/);
  if (!match) return { appearance: desc.trim(), personality: '' };
  return { appearance: desc.slice(0, match.index).trim(), personality: match[1].trim() };
}

// ---------------------------------------------------------------------------
// Auto-Write Angle
// ---------------------------------------------------------------------------

export const ANGLE_TONES = ['Professional', 'Playful', 'Urgent', 'Emotional'] as const;
export type AngleTone = (typeof ANGLE_TONES)[number];

export interface WrittenAngle {
  id: string;
  angle_name: string;
  hook: string;
  body: string;
  cta: string;
}

export interface AutoWriteInput {
  product: string;
  audience: string;
  tone: AngleTone;
}

const AUTO_WRITE_SYSTEM = [
  'You are a direct-response copywriter who writes short-form video ad angles.',
  'Write FIVE genuinely different angles — different reason to buy, not five rewrites of one idea.',
  'Each angle has: a hook (ONE spoken opening line, under 14 words, no greeting, no "introducing"),',
  'a body of 2–3 sentences, and a single call to action of at most 8 words.',
  'Never invent a price, a statistic, a review, an award or a guarantee that was not given to you.',
  'Write in plain spoken English — this is read aloud on camera, not printed.',
  'Answer with JSON ONLY, no markdown fence and no commentary, in exactly this shape:',
  '{"angles":[{"name":"...","hook":"...","body":"...","cta":"..."}]}',
].join(' ');

function parseAngleJson(raw: string): WrittenAngle[] {
  const text = String(raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The copywriter did not answer with usable JSON.');
  const parsed = JSON.parse(text.slice(start, end + 1));
  const list = Array.isArray(parsed?.angles) ? parsed.angles : [];
  const angles = list
    .map((a: any, i: number): WrittenAngle => ({
      id: newId('wa'),
      angle_name: String(a?.name || `Angle ${i + 1}`).trim(),
      hook: String(a?.hook || '').trim(),
      body: String(a?.body || '').trim(),
      cta: String(a?.cta || '').trim(),
    }))
    .filter((a: WrittenAngle) => a.hook && a.body);
  if (!angles.length) throw new Error('The copywriter returned no usable angles — try again.');
  return angles;
}

/** Five ad angles from gpt-5.6-terra (balanced tier, chat-speed latency). */
export async function autoWriteAngles(input: AutoWriteInput): Promise<WrittenAngle[]> {
  const token = wsToken();
  if (!token) throw new Error('Your workspace session is still loading — try again in a moment.');

  const user = [
    `Product / offer: ${input.product.trim()}`,
    `Target audience: ${input.audience.trim() || 'the product’s natural buyer — infer it from the product'}`,
    `Tone: ${input.tone}`,
    '',
    'Write the five angles now.',
  ].join('\n');

  const res = await fetch('/proxy/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
    body: JSON.stringify({
      model: 'gpt-5.6-terra',
      reasoning_effort: 'none',
      max_completion_tokens: 2400,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: AUTO_WRITE_SYSTEM },
        { role: 'user', content: user },
      ],
      stream: false,
    }),
  });
  const data: any = await res.json().catch(() => null);
  if (!res.ok) {
    const code = data?.code ? ` [${data.code}]` : '';
    throw new Error(`${String(data?.error?.message || data?.error || `The copywriter could not be reached (HTTP ${res.status}).`)}${code}`);
  }
  return parseAngleJson(String(data?.choices?.[0]?.message?.content || ''));
}

/**
 * Turn a written angle into the workflow's own AdAngle so "Use in a new ad"
 * drops it straight into Step 3 with everything the script writer reads.
 */
export function writtenAngleToAdAngle(angle: WrittenAngle, input: AutoWriteInput): AdAngle {
  return {
    id: newId('angle'),
    angle_name: angle.angle_name,
    angle_type: `${input.tone} · Auto-Write`,
    core_idea: angle.body,
    target_audience_state: input.audience.trim(),
    hook: angle.hook,
    problem: '',
    mechanism: '',
    desired_outcome: '',
    proof_opportunity: '',
    creative_direction: `${input.tone.toLowerCase()} delivery. Close on: ${angle.cta}`,
  };
}

// ---------------------------------------------------------------------------
// Angle -> Script (the optional pre-step in front of the Runway recipes)
//
// This is the SAME two creative moves the eight-step workflow makes at Step 3
// and Step 4 - pick an angle, then write the clip script under hard per-clip
// word limits - adapted to run standalone in front of a recipe. The workflow's
// own Opus implementation is untouched and keeps running exactly as it did;
// this is a copy the Recipes surface can use without entering the eight-step
// session.
// ---------------------------------------------------------------------------

export interface ScriptClip {
  id: string;
  beat: string;
  line: string;
  durationS: number;
  visual: string;
}

/** The workflow's per-duration word ceilings, kept verbatim. */
export const CLIP_WORD_LIMIT: Record<number, number> = { 4: 9, 6: 13, 8: 17, 10: 22 };

const SCRIPT_SYSTEM = [
  'You write short-form direct-response video ad scripts that get filmed by an AI video model.',
  'Structure the ad as Hook, Problem, Solution, Proof, then a single CTA - four to six clips, no more.',
  'HARD WORD LIMITS by clip duration: 4s = 9 words, 6s = 13 words, 8s = 17 words, 10s = 22 words. Never exceed them.',
  'Each clip also needs a VISUAL: one sentence describing what the camera sees. Physical, filmable, no on-screen text.',
  'Never invent a price, a statistic, a review, an award or a guarantee that was not given to you.',
  'Answer with strict JSON ONLY, no markdown fence and no commentary: a single object with one key, clips,',
  'whose value is an array of objects each carrying the keys beat, line, duration and visual.',
  'duration is a number and must be one of 4, 6, 8 or 10.',
].join(' ');

function parseScriptJson(raw: string): ScriptClip[] {
  const text = String(raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The script writer did not answer with usable JSON.');
  const parsed = JSON.parse(text.slice(start, end + 1));
  const list = Array.isArray(parsed?.clips) ? parsed.clips : [];
  const clips = list
    .map((c: any, i: number): ScriptClip => {
      const wanted = Number(c?.duration) || 6;
      const durationS = [4, 6, 8, 10].indexOf(wanted) >= 0 ? wanted : 6;
      return {
        id: newId('clip'),
        beat: String(c?.beat || `Clip ${i + 1}`).trim(),
        line: String(c?.line || '').trim(),
        durationS,
        visual: String(c?.visual || '').trim(),
      };
    })
    .filter((c: ScriptClip) => c.line || c.visual);
  if (!clips.length) throw new Error('The script writer returned no usable clips - try again.');
  return clips.slice(0, 6);
}

/** Words in a clip line, for the live limit badge. */
export function clipWords(line: string): number {
  return String(line || '').split(/\s+/).filter(Boolean).length;
}

export function clipOverLimit(clip: ScriptClip): boolean {
  return clipWords(clip.line) > (CLIP_WORD_LIMIT[clip.durationS] || 22);
}

/** Write the clip script for one chosen angle. */
export async function writeAngleScript(input: { product: string; audience: string; angle: WrittenAngle }): Promise<ScriptClip[]> {
  const token = wsToken();
  if (!token) throw new Error('Your workspace session is still loading - try again in a moment.');

  const user = [
    `Product / offer: ${input.product.trim()}`,
    `Target audience: ${input.audience.trim() || 'infer it from the product'}`,
    `Angle: ${input.angle.angle_name}`,
    `Hook to open on: ${input.angle.hook}`,
    `Angle body: ${input.angle.body}`,
    `Close on: ${input.angle.cta}`,
    '',
    'Write the clip script now.',
  ].join('\n');

  const res = await fetch('/proxy/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
    body: JSON.stringify({
      model: 'gpt-5.6-terra',
      reasoning_effort: 'none',
      max_completion_tokens: 2400,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SCRIPT_SYSTEM },
        { role: 'user', content: user },
      ],
      stream: false,
    }),
  });
  const data: any = await res.json().catch(() => null);
  if (!res.ok) {
    const code = data?.code ? ` [${data.code}]` : '';
    throw new Error(`${String(data?.error?.message || data?.error || `The script writer could not be reached (HTTP ${res.status}).`)}${code}`);
  }
  return parseScriptJson(String(data?.choices?.[0]?.message?.content || ''));
}

// ---------------------------------------------------------------------------
// Saved Videos (workspace video catalog)
// ---------------------------------------------------------------------------

export interface SavedVideo {
  id: string;
  url: string;
  prompt: string;
  /** Derived server-side: runway | veo | gemini | sora | kling | heygen | stitched | remotion | other. */
  provider: string;
  source: string;
  aspectRatio: string;
  status: string;
  createdAt: string | null;
}

export interface SavedVideoPage {
  videos: SavedVideo[];
  /** How many catalog rows fall into each provider, before filtering. */
  counts: Record<string, number>;
  total: number;
  matched: number;
}

export async function listWorkspaceVideos(provider: string, limit = 120): Promise<SavedVideoPage> {
  const data = await callHook('vv-workspace-videos', { provider, limit });
  return {
    videos: Array.isArray(data?.videos) ? data.videos : [],
    counts: (data?.counts && typeof data.counts === 'object') ? data.counts : {},
    total: Number(data?.total) || 0,
    matched: Number(data?.matched) || 0,
  };
}

export const PROVIDER_LABELS: Record<string, string> = {
  runway: 'Runway',
  veo: 'Veo',
  gemini: 'Omni Flash',
  sora: 'Sora',
  kling: 'Kling',
  heygen: 'HeyGen',
  stitched: 'Assembled',
  remotion: 'Rendered',
  other: 'Other',
};

export function providerLabel(id: string): string {
  return PROVIDER_LABELS[id] || id;
}

/** "26 Sep 2026 · 10:59" — the catalog stores ISO timestamps. */
export function formatVideoDate(iso: string | null): string {
  if (!iso) return 'Date unknown';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Date unknown';
  const date = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time}`;
}

/**
 * A poster for a catalog clip without spending an ffmpeg frame extraction on
 * every card: the media fragment makes the browser decode and paint the frame
 * at 0.1s as the element's own first paint.
 */
export function posterSrc(url: string): string {
  return url.indexOf('#') >= 0 ? url : `${url}#t=0.1`;
}

export function shortPrompt(prompt: string, max = 110): string {
  const text = String(prompt || '').trim();
  if (!text) return 'No prompt recorded';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
