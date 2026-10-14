/**
 * AUDIO & WORD SYNC — the narration, and where every word lands.
 *
 * Two calls, in order:
 *   1. ElevenLabs via the managed endpoint → one MP3 on a durable URL.
 *   2. Deepgram nova-3 via `POST /api/workspaces/:id/audio/transcribe-timestamped`
 *      → the word list with per-word start/end.
 *
 * Note the second path: the plain `/api/generate/transcribe` endpoint returns
 * TEXT ONLY and has no timings. Word-level timing is a different integration
 * (`deepgram-transcription`) on the URL above, and it answers in SECONDS —
 * everything downstream works in milliseconds, so the conversion happens here
 * once rather than in each caller.
 *
 * TIMING ALWAYS COMES BACK. Deepgram needs the audio bytes in the request, so
 * the MP3 is fetched from storage first, and a browser that cannot read it
 * cross-origin would otherwise take the whole run down. When the real pass is
 * unavailable the words are spread across the measured duration by length,
 * the result is marked `estimated`, and the UI says so — captions that drift
 * slightly beat no video at all.
 */

import type { AudioToken } from '../types';
import { speak, FALLBACK_VOICE_ID, DEFAULT_VOICE_SETTINGS } from '../../../lib/elevenLabsVoices';
import { describePlatformError, uploadHeaders, workspaceId } from './runtime';

export interface Narration {
  audioUrl: string;
  durationMs: number;
}

export interface WordSync {
  tokens: AudioToken[];
  /** True when the timings were derived from word length, not heard. */
  estimated: boolean;
  reason?: string;
  /** The duration the timings are laid against. */
  durationMs: number;
}

/**
 * The workspace's narration voice. The engine does not expose a voice picker:
 * one recognisable voice across every video is the product, so the id lives
 * here and changes in one place.
 */
export const ENGINE_VOICE_ID = FALLBACK_VOICE_ID;

/** Steadier and less theatrical than the shared default — this is narration,
 * not performance. */
export const NARRATION_VOICE_SETTINGS = {
  ...DEFAULT_VOICE_SETTINGS,
  stability: 0.45,
  style: 0.3,
};

export async function narrate(script: string): Promise<Narration> {
  const spoken = await speak({
    script,
    voiceId: ENGINE_VOICE_ID,
    voiceSettings: NARRATION_VOICE_SETTINGS,
  });
  return { audioUrl: spoken.audioUrl, durationMs: spoken.durationMs };
}

/** ElevenLabs reads roughly 165 words a minute; used only when nothing else
 * reported a length. */
function guessDurationMs(script: string): number {
  const words = script.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1000, Math.round((words / 165) * 60_000));
}

/**
 * Spread the script across `durationMs` in proportion to how long each word
 * takes to say. Word length is a far better proxy for that than word count,
 * so "extraordinary" holds the screen longer than "it".
 */
export function estimateWordTimings(script: string, durationMs: number): AudioToken[] {
  const words = script.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const weights = words.map((word) => Math.max(2, word.replace(/[^\w']/g, '').length));
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const span = Math.max(1000, Math.round(durationMs));
  let cursor = 0;
  return words.map((word, index) => {
    const slice = Math.round((weights[index] / total) * span);
    const start = cursor;
    cursor = Math.min(span, start + slice);
    return { word, start_ms: start, end_ms: cursor };
  });
}

/**
 * Word-level timings for a generated voiceover. `script` and `fallbackMs` are
 * the safety net, not the happy path.
 */
export async function wordTimings(
  audioUrl: string,
  script: string,
  fallbackMs: number,
): Promise<WordSync> {
  const estimateSpan = fallbackMs > 0 ? fallbackMs : guessDurationMs(script);
  const degrade = (reason: string): WordSync => ({
    tokens: estimateWordTimings(script, estimateSpan),
    estimated: true,
    reason,
    durationMs: estimateSpan,
  });

  let audio: Blob;
  try {
    const download = await fetch(audioUrl);
    if (!download.ok) throw new Error(`HTTP ${download.status}`);
    audio = await download.blob();
  } catch (error: any) {
    return degrade(`The voiceover could not be re-read for timing (${String(error?.message || error)}).`);
  }

  const form = new FormData();
  form.append('audio', audio, 'narration.mp3');
  form.append('language', 'en');

  let response: Response;
  try {
    response = await fetch(
      `/api/workspaces/${encodeURIComponent(workspaceId())}/audio/transcribe-timestamped`,
      { method: 'POST', headers: uploadHeaders(), body: form },
    );
  } catch (error: any) {
    return degrade(`The timing service could not be reached (${String(error?.message || error)}).`);
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    return degrade(describePlatformError(data, response.status, 'Word timing was unavailable'));
  }

  const words = Array.isArray(data?.words) ? data.words : [];
  if (!words.length) return degrade('The timing service heard no words in the voiceover.');

  const tokens: AudioToken[] = words
    .map((entry: any) => ({
      word: String(entry?.word || '').trim(),
      start_ms: Math.round(Number(entry?.start) * 1000),
      end_ms: Math.round(Number(entry?.end) * 1000),
    }))
    .filter((token: AudioToken) => Boolean(token.word) && Number.isFinite(token.start_ms) && Number.isFinite(token.end_ms));

  if (!tokens.length) return degrade('The timing service returned no usable word timings.');

  const measured = Math.round(Number(data?.duration) * 1000);
  return {
    tokens,
    estimated: false,
    durationMs: Number.isFinite(measured) && measured > 0 ? measured : estimateSpan,
  };
}

/**
 * The ambient bed the documentary ducks against.
 *
 * Music is a nice-to-have, not a gate: a film with narration and no bed is
 * still a film, so a failure here comes back as an empty URL and the
 * composition simply does not mount that track.
 */
export async function ambientBed(durationMs: number): Promise<string> {
  try {
    const response = await fetch(
      `/api/workspaces/${encodeURIComponent(workspaceId())}/audio/music/preset`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...uploadHeaders() },
        body: JSON.stringify({
          preset: 'cinematic',
          lengthMs: Math.max(3000, Math.min(600_000, Math.round(durationMs))),
        }),
      },
    );
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.audioUrl) return '';
    return String(data.audioUrl);
  } catch {
    return '';
  }
}

/**
 * Frame ranges where someone is speaking, merged across short gaps. The
 * documentary render ducks the music bed against exactly these, so a pause
 * between two words does not pump the ambient track up and back down.
 */
export function speechRanges(tokens: AudioToken[], fps: number): Array<[number, number]> {
  if (!tokens.length) return [];
  const gapFrames = Math.round(fps * 0.4);
  const ranges: Array<[number, number]> = [];
  for (const token of tokens) {
    const from = Math.max(0, Math.floor((token.start_ms / 1000) * fps));
    const to = Math.max(from + 1, Math.ceil((token.end_ms / 1000) * fps));
    const last = ranges[ranges.length - 1];
    if (last && from - last[1] <= gapFrames) last[1] = to;
    else ranges.push([from, to]);
  }
  return ranges;
}
