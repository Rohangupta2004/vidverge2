/**
 * HYBRID DOCUMENTARY — Pipeline B's scripting and visuals.
 *
 * Fifteen four-second beats. Each beat gets a torn-paper collage still, and
 * each still is animated as rigid stop-motion. The two prompt templates below
 * are the look: they are the product, so they live as constants with named
 * slots rather than being re-improvised per beat.
 *
 * MODEL NOTES (verified against the platform catalog, not assumed):
 *  · Scripting runs on `gpt-5.6-terra` with `reasoning_effort: "none"`, which
 *    is what keeps an interactive call at chat speed, and
 *    `max_completion_tokens` — GPT-5.6 rejects the older `max_tokens`.
 *  · Stills go through `POST /api/generate/image`, which manages the image
 *    model server-side. The only model override that endpoint accepts is
 *    `gpt-image-2`, so no model is named here and the platform picks.
 *  · Motion runs on `openrouter/bytedance/seedance-2.0-fast` — the exact
 *    spelling the video proxy's enum accepts, and the id the 9 Oct 2026 engine
 *    sweep verified end to end. It is seed-image-only, which is precisely the
 *    image-to-video shape this pipeline needs.
 */

import type { DocumentaryBeat } from '../types';
import { authHeaders, describePlatformError, EngineStageError } from './runtime';
import { pollGroupA, postGeneration, submitGroupA } from '../../../lib/videoEngineClient';

export const BEAT_COUNT = 15;
export const BEAT_SECONDS = 4;
export const SCRIPT_WORD_TARGET = 150;

export const SCRIPT_MODEL = 'gpt-5.6-terra';
export const MOTION_MODEL = 'openrouter/bytedance/seedance-2.0-fast';

/** How many provider jobs are in flight at once. Fifteen clips one after
 * another would take far longer than the pipeline promises; fifteen at once
 * invites a per-workspace rate limit. */
const CLIP_CONCURRENCY = 3;

/** The collage still. Slots are filled per beat; the rest is the house look. */
export const HERO_FRAME_TEMPLATE =
  "Editorial Vox-style multi-layered paper collage on neutral dark desktop. Center has torn paper border framing [SUBJECT]. Surrounding edges feature polaroid cutouts taped with red masking tape. Secondary paper notes with text '[SUB_TEXT]'. Bold modern title centered: '[MAIN_TITLE]'. Physical torn edges, fibrous paper texture, warm lighting, high contrast. 16:9 ratio.";

/** The motion pass. Rigid paper, locked camera — anything fluid reads as AI. */
export const STOP_MOTION_TEMPLATE =
  "Stop-motion paper collage animation. Progressive build. Elements snap into frame: polaroid cutouts and red tape adhere to borders. Central headline '[MAIN_TITLE]' punches in and locks into a stable, legible hold. Rigid paper movement, zero fluid warping. Static locked camera. 24fps filmic paper animation.";

function fillTemplate(template: string, beat: DocumentaryBeat): string {
  return template
    .split('[SUBJECT]')
    .join(beat.subject)
    .split('[SUB_TEXT]')
    .join(beat.subText)
    .split('[MAIN_TITLE]')
    .join(beat.mainTitle);
}

export function heroFramePrompt(beat: DocumentaryBeat): string {
  return fillTemplate(HERO_FRAME_TEMPLATE, beat);
}

export function stopMotionPrompt(beat: DocumentaryBeat): string {
  return fillTemplate(STOP_MOTION_TEMPLATE, beat);
}

// ---------------------------------------------------------------------------
// Scripting
// ---------------------------------------------------------------------------

const SCRIPT_SYSTEM = [
  'You are a documentary writer in the Vox explainer tradition.',
  'Write exactly ' + BEAT_COUNT + ' sequential beats of ' + BEAT_SECONDS + ' seconds each.',
  'The narration across all beats totals about ' + SCRIPT_WORD_TARGET + ' words, so each beat is roughly 10 words: one spoken sentence.',
  'The beats must read as one continuous argument, not fifteen separate facts. Beat 1 opens the question and beat ' + BEAT_COUNT + ' lands the answer.',
  'Never use an em-dash. Use a full stop or a comma instead.',
  'For every beat also give:',
  '  mainTitle  - two to four words, the headline punched into the collage frame. Title Case.',
  '  subText    - two to five words, the handwritten note taped beside it.',
  '  subject    - the single physical thing the torn-paper border frames, described concretely enough to photograph.',
  'Return JSON only, shaped: { "beats": [{ "narration": "", "mainTitle": "", "subText": "", "subject": "" }] }',
].join('\n');

function stripEmDashes(text: string): string {
  return String(text || '')
    .replace(/\s*\u2014\s*/g, ', ')
    .replace(/\s*--\s*/g, ', ')
    .trim();
}

function parseBeats(reply: string): DocumentaryBeat[] {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  let parsed: any;
  try {
    parsed = JSON.parse(reply.slice(start, end + 1));
  } catch {
    return [];
  }
  const raw = Array.isArray(parsed?.beats) ? parsed.beats : Array.isArray(parsed) ? parsed : [];
  return raw
    .map((entry: any, index: number) => ({
      index,
      narration: stripEmDashes(entry?.narration),
      mainTitle: stripEmDashes(entry?.mainTitle).slice(0, 48),
      subText: stripEmDashes(entry?.subText).slice(0, 48),
      subject: stripEmDashes(entry?.subject).slice(0, 140),
    }))
    .filter((beat: DocumentaryBeat) => Boolean(beat.narration && beat.mainTitle && beat.subject));
}

/** The fifteen beats for a topic. Throws rather than returning a short film. */
export async function writeBeats(topic: string): Promise<DocumentaryBeat[]> {
  const response = await fetch('/proxy/openai/v1/chat/completions', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      model: SCRIPT_MODEL,
      reasoning_effort: 'none',
      max_completion_tokens: 2400,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SCRIPT_SYSTEM },
        { role: 'user', content: 'Topic: ' + String(topic || '').trim() },
      ],
      stream: false,
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new EngineStageError(
      describePlatformError(data, response.status, 'The script could not be written'),
      'script',
    );
  }
  const reply = String(data?.choices?.[0]?.message?.content || '');
  const beats = parseBeats(reply);
  if (beats.length < BEAT_COUNT) {
    throw new EngineStageError(
      'The script came back with ' + beats.length + ' beats instead of ' + BEAT_COUNT + '. Try the topic again, or make it more specific.',
      'script',
    );
  }
  return beats.slice(0, BEAT_COUNT).map((beat, index) => ({ ...beat, index }));
}

export function narrationScript(beats: DocumentaryBeat[]): string {
  return beats.map((beat) => beat.narration).join(' ');
}

// ---------------------------------------------------------------------------
// Hero frames
// ---------------------------------------------------------------------------

/**
 * One collage still. The endpoint is synchronous and answers with a durable
 * GCS URL, which is what both the preview and the motion pass need — a data:
 * URL would be too large to keep on the scene row.
 */
export async function generateHeroFrame(beat: DocumentaryBeat): Promise<string> {
  const { res, data } = await postGeneration('/api/generate/image', {
    prompt: heroFramePrompt(beat),
    aspectRatio: '16:9',
    quality: 'hd',
  });
  if (!res.ok || !data?.imageUrl) {
    throw new EngineStageError(
      describePlatformError(data, res.status, 'Beat ' + (beat.index + 1) + ' could not be illustrated'),
      'hero_frame',
    );
  }
  return String(data.imageUrl);
}

// ---------------------------------------------------------------------------
// Stop-motion
// ---------------------------------------------------------------------------

/**
 * Animate one still. `imageData` accepts an https URL and the proxy fetches
 * the bytes itself, so the GCS URL goes straight through.
 *
 * No `appId` is named deliberately. The proxy records each job against a row
 * in the platform's own `apps` table, and naming an id it has no row for trips
 * a foreign key BEFORE the clip is generated. Staying silent lets the proxy
 * resolve the caller from the session, which is the configuration proven to
 * work on this platform (see lib/videoEngineClient.ts).
 */
export async function animateFrame(
  beat: DocumentaryBeat,
  frameUrl: string,
  isCancelled?: () => boolean,
  onProgress?: (pct: number) => void,
): Promise<string> {
  const kickoff = await submitGroupA({
    model: MOTION_MODEL,
    prompt: stopMotionPrompt(beat),
    aspectRatio: '16:9',
    duration: BEAT_SECONDS,
    generateAudio: false,
    imageData: frameUrl,
  });
  return pollGroupA(kickoff.operationId, {
    creditKey: kickoff.creditKey,
    isCancelled,
    onProgress,
  });
}

/**
 * Run `work` over every item with a bounded number in flight. Fifteen provider
 * jobs one after another would blow the pipeline's latency target; fifteen at
 * once invites a per-workspace rate limit.
 */
export async function mapWithConcurrency<TIn, TOut>(
  items: TIn[],
  limit: number,
  work: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  const results = new Array<TOut>(items.length);
  let cursor = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await work(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

export const CLIP_BATCH_SIZE = CLIP_CONCURRENCY;
