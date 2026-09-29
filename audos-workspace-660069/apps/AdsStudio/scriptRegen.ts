/**
 * ADS STUDIO — SCRIPT REGENERATION (🔄 Regen Script).
 *
 * One call to claude-sonnet-5 on the platform Anthropic proxy
 * (POST /proxy/anthropic/v1/messages) returns a complete, production-ready
 * short-form ad script as structured JSON: hook, problem, solution, proof,
 * CTA and a per-scene shot list with the exact voiceover and B-roll.
 *
 * Contract notes from integrations/anthropic-text-generation/docs.md:
 *   · claude-sonnet-5 MUST send thinking: { type: 'disabled' } — it otherwise
 *     uses adaptive thinking and stalls before the first token.
 *   · max_tokens is REQUIRED and capped at 8192.
 *   · NEVER send temperature / top_p / top_k — Claude 5 rejects them with 400.
 *   · `system` is a top-level string, not a message.
 *   · stream: true forwards Anthropic's SSE sequence unchanged.
 *
 * Streaming is attempted first so the editor fills in live; any streaming
 * failure falls back to the plain request rather than failing the regen.
 */

import { ClipDuration, ScriptClip, WORD_LIMITS, wordCount, wsToken } from './api';
import { extractJson } from './opus';

const MODEL = 'claude-sonnet-5';

/**
 * The ad copywriter brief, injected verbatim. Do not paraphrase it: the exact
 * output contract below is what the scene-card mapping downstream relies on.
 */
export const SCRIPT_REGEN_SYSTEM = `You are an elite performance ad copywriter. Your job is to write a complete, production-ready ad script for a short-form video ad (15–60 seconds).

Output format — you MUST follow this exactly:
{
  "hook": "Opening line spoken by on-camera character (max 8 words, pattern interrupt or bold claim)",
  "problem": "1–2 sentences describing the pain point the audience feels viscerally",
  "solution": "2–3 sentences explaining what the product does and why it is uniquely effective",
  "proof": "1 concrete result, statistic, or social proof statement",
  "cta": "Exact call-to-action line (max 10 words, urgency or scarcity)",
  "visual_directions": [
    { "scene": 1, "duration": 5, "shot": "description of what the camera sees", "voiceover": "exact words spoken", "broll": "what B-roll to show if any" },
    { "scene": 2, "duration": 10, "shot": "...", "voiceover": "...", "broll": "..." },
    { "scene": 3, "duration": 10, "shot": "...", "voiceover": "...", "broll": "..." },
    { "scene": 4, "duration": 5, "shot": "...", "voiceover": "...", "broll": "..." }
  ],
  "total_seconds": 30,
  "platform": "Instagram Reels / TikTok",
  "tone": "energetic and direct"
}

Rules:
- Every scene must have an explicit shot description the video AI can use as a prompt.
- B-roll descriptions must be visual and specific, never vague.
- The hook must create an immediate pattern interrupt in the first 2 seconds.
- Never use corporate language — write as if a real person is talking.
- The CTA must have exactly one action the viewer should take.
- Tailor everything to the product and target audience provided.`;

export interface VisualDirection {
  scene: number;
  duration: number;
  shot: string;
  voiceover: string;
  broll: string;
}

export interface AdScriptJson {
  hook: string;
  problem: string;
  solution: string;
  proof: string;
  cta: string;
  visual_directions: VisualDirection[];
  total_seconds: number;
  platform: string;
  tone: string;
}

export interface ScriptRegenInput {
  product_name: string;
  product_description: string;
  target_audience: string;
  /** 15 | 30 | 60 — the selected ad length. */
  ad_duration: number;
  /** Reels / TikTok / YouTube Shorts. */
  platform: string;
  /** Extra grounding so the copy never invents proof. */
  offer_cta?: string;
  proof_elements?: string[];
  pain_points?: string[];
  customer_language?: string[];
}

function headers(): Record<string, string> {
  const token = wsToken();
  if (!token) throw new Error('Your workspace session is still loading — try again in a moment.');
  return { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token };
}

function requestBody(input: ScriptRegenInput, stream: boolean): string {
  return JSON.stringify({
    model: MODEL,
    max_tokens: 8192,
    // Required for Sonnet 5 — adaptive thinking would stall the first token.
    thinking: { type: 'disabled' },
    system: SCRIPT_REGEN_SYSTEM,
    messages: [{ role: 'user', content: JSON.stringify(input, null, 2) }],
    stream,
  });
}

async function errorFrom(res: Response): Promise<Error> {
  const data = await res.json().catch(() => null);
  const code = data?.code ? ` [${data.code}]` : '';
  const message = data?.error?.message
    || (typeof data?.error === 'string' ? data.error : '')
    || `The copywriter did not answer (HTTP ${res.status})`;
  return new Error(`${message}${code}`);
}

/** Non-streaming request — the fallback, and the path used when the browser
 * gives us no readable response body. */
async function requestPlain(input: ScriptRegenInput): Promise<string> {
  const res = await fetch('/proxy/anthropic/v1/messages', {
    method: 'POST', headers: headers(), body: requestBody(input, false),
  });
  if (!res.ok) throw await errorFrom(res);
  const data = await res.json().catch(() => null);
  return (Array.isArray(data?.content) ? data.content : [])
    .filter((b: any) => b?.type === 'text')
    .map((b: any) => String(b.text || ''))
    .join('');
}

/**
 * Streaming request. Anthropic's event sequence is forwarded unchanged, so the
 * text arrives as content_block_delta / text_delta events.
 */
async function requestStreamed(input: ScriptRegenInput, onDelta: (full: string) => void): Promise<string> {
  const res = await fetch('/proxy/anthropic/v1/messages', {
    method: 'POST', headers: headers(), body: requestBody(input, true),
  });
  if (!res.ok) throw await errorFrom(res);
  if (!res.body) throw new Error('The streaming response carried no body.');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let done = false;

  const consume = (line: string) => {
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload) return;
    let event: any;
    try { event = JSON.parse(payload); } catch { return; /* keep-alive or partial */ }
    if (event?.type === 'error') throw new Error(String(event?.error?.message || 'The copywriter stream failed.'));
    if (event?.type === 'message_stop') { done = true; return; }
    if (event?.type === 'content_block_delta' && event?.delta?.type === 'text_delta') {
      text += String(event.delta.text || '');
      onDelta(text);
    }
  };

  while (!done) {
    const { done: finished, value } = await reader.read();
    if (finished) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) { consume(line); if (done) break; }
  }
  buffer += decoder.decode();
  for (const line of buffer.split('\n')) { if (!done) consume(line); }
  if (!text.trim()) throw new Error('The copywriter stream ended without any text.');
  return text;
}

function str(value: unknown, cap: number): string {
  return String(value == null ? '' : value).trim().slice(0, cap);
}

function cleanJson(raw: any, input: ScriptRegenInput): AdScriptJson {
  const rows: VisualDirection[] = (Array.isArray(raw?.visual_directions) ? raw.visual_directions : [])
    .map((row: any, i: number) => ({
      scene: Number(row?.scene) || i + 1,
      duration: Math.max(2, Math.min(15, Number(row?.duration) || 5)),
      shot: str(row?.shot, 700),
      voiceover: str(row?.voiceover, 400),
      broll: str(row?.broll, 500),
    }))
    .filter((row: VisualDirection) => row.shot || row.voiceover)
    .slice(0, 7);
  if (!rows.length) throw new Error('The copywriter returned no scenes — run the regen again.');
  return {
    hook: str(raw?.hook, 220),
    problem: str(raw?.problem, 600),
    solution: str(raw?.solution, 800),
    proof: str(raw?.proof, 400),
    cta: str(raw?.cta, 220),
    visual_directions: rows,
    total_seconds: Math.max(10, Math.min(75, Number(raw?.total_seconds) || input.ad_duration)),
    platform: str(raw?.platform, 80) || input.platform,
    tone: str(raw?.tone, 80) || 'energetic and direct',
  };
}

/**
 * Regenerate the ad script. `onDelta` receives the raw text as it streams so
 * the editor can show progress; the parsed JSON is the return value.
 */
export async function regenerateAdScript(
  input: ScriptRegenInput,
  onDelta?: (partial: string) => void,
): Promise<AdScriptJson> {
  let text = '';
  try {
    text = await requestStreamed(input, (partial) => { try { onDelta?.(partial); } catch { /* UI only */ } });
  } catch (streamFailure: any) {
    // A stream that never started, or a body this browser cannot read, is not
    // a reason to fail the regen — ask again without streaming.
    text = await requestPlain(input);
    if (!text.trim()) throw streamFailure;
  }
  return cleanJson(extractJson<any>(text), input);
}

// ---------------------------------------------------------------------------
// Mapping the structured script onto Ads Studio's scene cards
// ---------------------------------------------------------------------------

const DURATIONS: ClipDuration[] = [4, 6, 8, 10];

/**
 * Pick the clip length this line can legally occupy. Ads Studio enforces hard
 * per-duration word limits (4s→9 · 6s→13 · 8s→17 · 10s→22) and blocks
 * "Approve script" while any line is over, so the shortest duration the line
 * FITS is chosen rather than the duration the copywriter asked for. A line
 * longer than 22 words still lands on 10s and stays visibly flagged for the
 * founder to trim — silently truncating someone's copy would be worse.
 */
function durationFor(line: string, wanted: number): ClipDuration {
  const words = wordCount(line);
  const fits = DURATIONS.filter((d) => words <= WORD_LIMITS[d]);
  if (!fits.length) return 10;
  const asked = DURATIONS.reduce((best, d) => (
    Math.abs(d - wanted) < Math.abs(best - wanted) ? d : best
  ), DURATIONS[0]);
  return fits.includes(asked) ? asked : fits[0];
}

const ROLES = ['Hook', 'Problem', 'Solution', 'Proof', 'Benefit', 'CTA'];

function roleFor(index: number, total: number): string {
  if (index === 0) return 'Hook';
  if (index === total - 1) return 'CTA';
  return ROLES[Math.min(index, ROLES.length - 2)] || `Scene ${index + 1}`;
}

/** The regenerated script as Ads Studio clip cards. */
export function scriptFromAdScript(json: AdScriptJson): ScriptClip[] {
  const rows = json.visual_directions;
  return rows.map((row, i) => {
    const line = row.voiceover || (i === 0 ? json.hook : i === rows.length - 1 ? json.cta : '');
    return {
      clip_number: i + 1,
      clip_role: roleFor(i, rows.length),
      duration_seconds: durationFor(line, row.duration),
      spoken_line: line,
      word_count: wordCount(line),
      visual_concept: row.shot,
      overlay_idea: row.broll,
      emotion: json.tone,
    };
  });
}

/**
 * The per-scene visual brief the video engine renders: the shot the camera
 * sees plus the B-roll to show. Fed to buildDetailedPrompt() as its
 * sceneDescription, so it is never the whole prompt on its own.
 */
export function sceneBriefs(json: AdScriptJson): string[] {
  return json.visual_directions.map((row) => (
    [row.shot, row.broll ? `B-roll: ${row.broll}` : ''].filter(Boolean).join('. ')
  ));
}
