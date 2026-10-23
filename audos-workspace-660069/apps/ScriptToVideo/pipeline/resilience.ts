/**
 * 400-RESILIENCE — what to do when a video provider refuses the REQUEST.
 *
 * A 400 from a generation proxy is a statement about the wording of the
 * prompt, not about the film. The pipeline answers it in three steps, and
 * EVERY step carries the same aspect ratio, duration, references, negative
 * prompt and credit key — only the wording, and finally the provider, change:
 *
 *   1. submit the director's prompt exactly as written
 *   2. submit a REPHRASED prompt — same scenes, same actions, same characters,
 *      same visual elements, different sentence structure
 *   3. submit the rephrased prompt to the next provider in the chain
 *
 * A refusal that is NOT about the request (an empty wallet, a rate limit, a
 * provider the platform has not configured) is never rephrased — rewording
 * would not help and would waste a round trip.
 */
import { askOpus } from './opus';
import { VIDEO_MODEL } from './videoModelService';
import type { VideoModelConfig } from './videoModelService';

/** Failures no amount of rewording can fix. Checked FIRST. */
const NOT_A_WORDING_PROBLEM = /insufficient|wallet|balance is too low|top up|rate.?limit|\b429\b|\b402\b|not configured|provider key|temporarily unavailable|\b50\d\b|timed? out|cancelled/i;

/** The shapes a request-level refusal arrives in, including the sentences
 * videoModelService's own classifySubmitError wraps them in. */
const WORDING_PROBLEM = /\b400\b|rejected this request|invalid request|invalid_enum|unsupported|prompt is too long|safety filter|moderation|content policy|blocked/i;

export function isBadRequest(error: unknown): boolean {
  const text = String((error as any)?.message || error || '');
  if (!text) return false;
  if (NOT_A_WORDING_PROBLEM.test(text)) return false;
  return WORDING_PROBLEM.test(text);
}

const REPHRASE_SYSTEM = [
  'You rewrite AI video-generation prompts that a provider refused to accept.',
  'ABSOLUTE RULE: preserve the FULL original meaning. Every scene, every action, every character description, every piece of wardrobe, every camera move, every lighting note, every environment detail and every beat in the original MUST still be present in your rewrite.',
  'Do NOT simplify. Do NOT shorten. Do NOT drop detail. Do NOT summarise. Do NOT add anything new.',
  'Change ONLY the sentence structure and the choice of words — describe exactly the same shot a different way.',
  'Stay under 950 characters.',
  'Reply with the rewritten prompt text ONLY: no preamble, no explanation, no quotation marks, no markdown.',
].join(' ');

/**
 * Rephrase a refused prompt WITHOUT losing content. A rewrite that comes back
 * dramatically shorter than the original has simplified rather than rephrased,
 * so it is discarded and the original is kept — a shorter prompt would change
 * the shot, which is exactly what this must never do.
 */
export async function rephraseVideoPrompt(prompt: string, refusal: string): Promise<string> {
  const original = String(prompt || '').trim();
  if (!original) return original;
  const user = [
    'The video provider refused this prompt with:',
    String(refusal || 'no reason given').slice(0, 400),
    '',
    'Original prompt:',
    original,
    '',
    'Rewrite it now, keeping every single element.',
  ].join('\n');
  const rewritten = String(await askOpus({ system: REPHRASE_SYSTEM, user, maxTokens: 16000, effort: 'xhigh' }))
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/```$/, '')
    .replace(/^["'“]|["'”]$/g, '')
    .trim();
  if (!rewritten) return original;
  if (rewritten.length < Math.round(original.length * 0.6)) return original;
  return rewritten;
}

/**
 * The providers to try after the film's own engine refused the request, in
 * preference order. An image-to-video-only model is never offered to a scene
 * that has no seed frame — it could not render it at all.
 */
export function fallbackChain(current: VideoModelConfig, opts: { hasSeedFrame: boolean; durationS: number }): VideoModelConfig[] {
  // Required paid fallback policy: Kling fails → Gemini Omni Flash with a
  // logged switch. If Omni fails, stop and ask before Seedance 2.5. Retired
  // Kling ids and unrelated Runway models must never be entered silently.
  return current.provider === 'kling' && Number(opts.durationS || 0) <= VIDEO_MODEL.safeMaxDuration ? [VIDEO_MODEL] : [];
}
