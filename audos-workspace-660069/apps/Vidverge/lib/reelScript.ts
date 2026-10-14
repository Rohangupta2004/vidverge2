/**
 * THE REEL SCRIPT — what the voice says over a Pipeline A motion reel.
 *
 * The customer gives a URL and a direction, not a script, so one is written
 * from what the scrape actually found. The same call returns the two flanking
 * badge lines, because they have to agree with the voiceover: the badges are
 * the claims the narration is making, not decoration.
 *
 * This is provider-neutral copywriting, so it runs on `openai-text-generation`
 * at the balanced tier with `reasoning_effort: "none"` — the setting that
 * keeps an interactive call at chat speed. Claude is reserved for the motion
 * engineering, where the brief names it.
 */

import type { BrandKit } from '../types';
import { authHeaders, describePlatformError, EngineStageError, GENERATION_TIMEOUT_MS, isAbortError, timeoutSignal } from './runtime';

const SCRIPT_MODEL = 'gpt-5.6-terra';

/** A 30-second read at roughly 165 words a minute. */
const WORD_TARGET = 80;

export interface ReelScript {
  script: string;
  badges: string[];
}

const SYSTEM = [
  'You write voiceover for short product motion reels.',
  'Return about ' + WORD_TARGET + ' words of narration: spoken English, short sentences, no stage directions, no headings, no lists.',
  'Open on the problem, turn on what the product does, close on what changes for the user.',
  'Never use an em-dash. Never invent a statistic, a customer name, a price or an award.',
  'Only claim what the supplied brand material actually supports.',
  'Also return exactly two badge lines of two to four words each. They are shown on screen beside the product and must match claims the narration makes.',
  'Return JSON only, shaped: { "script": "", "badges": ["", ""] }',
].join('\n');

function clean(text: string): string {
  return String(text || '')
    .replace(/\s*\u2014\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A usable reel even when the model answer is unparseable. */
function fallbackScript(brand: BrandKit, direction: string): ReelScript {
  const name = brand.siteName;
  const line = brand.headline || direction;
  return {
    script: clean(
      `${name}. ${line}. ${brand.subheadline || 'Built to get you from idea to finished in one pass.'} See it for yourself.`,
    ),
    badges: ['Built for speed', 'No setup'],
  };
}

export async function writeReelScript(brand: BrandKit, direction: string): Promise<ReelScript> {
  const brief = [
    'Product: ' + brand.siteName,
    brand.headline ? 'Their headline: ' + brand.headline : '',
    brand.subheadline ? 'Their supporting line: ' + brand.subheadline : '',
    brand.url ? 'Site: ' + brand.url : '',
    '',
    'What the customer asked this reel to do:',
    String(direction || '').trim() || 'Introduce the product and make someone want to try it.',
  ]
    .filter(Boolean)
    .join('\n');

  let response: Response;
  try {
    response = await fetch('/proxy/openai/v1/chat/completions', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        model: SCRIPT_MODEL,
        reasoning_effort: 'none',
        max_completion_tokens: 900,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: brief },
        ],
        stream: false,
      }),
      signal: timeoutSignal(GENERATION_TIMEOUT_MS),
    });
  } catch (error: any) {
    throw new EngineStageError(
      isAbortError(error)
        ? 'The script writer did not answer within 2 minutes. Run the job again.'
        : 'The script writer could not be reached: ' + String(error?.message || error),
      'script',
    );
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new EngineStageError(
      describePlatformError(data, response.status, 'The reel script could not be written'),
      'script',
    );
  }

  const reply = String(data?.choices?.[0]?.message?.content || '');
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start < 0 || end <= start) return fallbackScript(brand, direction);

  let parsed: any;
  try {
    parsed = JSON.parse(reply.slice(start, end + 1));
  } catch {
    return fallbackScript(brand, direction);
  }

  const script = clean(parsed?.script);
  const badges = (Array.isArray(parsed?.badges) ? parsed.badges : [])
    .map((badge: unknown) => clean(String(badge)).slice(0, 32))
    .filter(Boolean);

  if (script.split(/\s+/).length < 20) return fallbackScript(brand, direction);
  const safeBadges = badges.length >= 2 ? badges.slice(0, 2) : fallbackScript(brand, direction).badges;
  return { script, badges: safeBadges };
}
