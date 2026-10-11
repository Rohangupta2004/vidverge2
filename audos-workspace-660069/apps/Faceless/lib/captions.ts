/**
 * FACELESS — caption cues.
 *
 * Subtitles for the player, not for the render. The film's own text layer is
 * editorial — it says things the narration does not — whereas these are the
 * narration itself, chunked small enough to read in one glance and timed off
 * the same word timestamps every cut in the film is anchored to.
 *
 * Two sources of timing, in order of preference:
 *   1. The measured word timestamps from the narration stage. Exact.
 *   2. An even spread across the known duration, weighted by word length.
 *      Approximate, and only used when the run has no timestamps (a resumed
 *      row, or a film whose transcription step was unavailable).
 */

import type { WordTimestamp } from '../types/editorial';

/** Short enough to read at a glance on a phone. */
export const WORDS_PER_CUE = 10;

export interface CaptionCue {
  index: number;
  text: string;
  start: number;
  end: number;
}

/**
 * Chunks never cross a sentence end, because a pill that reads "...the ocean
 * floor. And the map" is harder to parse than two short ones.
 */
function shouldBreakAfter(word: string): boolean {
  return /[.!?\u2026]["'\u201d\u2019)]?$/.test(word);
}

export function cuesFromTimestamps(words: WordTimestamp[]): CaptionCue[] {
  const usable = (Array.isArray(words) ? words : []).filter(
    (word) => word && word.word && Number.isFinite(word.start) && Number.isFinite(word.end),
  );
  if (!usable.length) return [];

  const cues: CaptionCue[] = [];
  let bucket: WordTimestamp[] = [];

  const flush = () => {
    if (!bucket.length) return;
    cues.push({
      index: cues.length,
      text: bucket.map((word) => word.word).join(' '),
      start: bucket[0].start,
      end: Math.max(bucket[bucket.length - 1].end, bucket[0].start + 0.4),
    });
    bucket = [];
  };

  for (const word of usable) {
    bucket.push(word);
    if (bucket.length >= WORDS_PER_CUE || (bucket.length >= 4 && shouldBreakAfter(word.word))) flush();
  }
  flush();

  return cues;
}

export function cuesFromScript(script: string, durationSeconds: number): CaptionCue[] {
  const words = String(script || '').split(/\s+/).filter(Boolean);
  if (!words.length || !(durationSeconds > 0)) return [];

  const weights = words.map((word) => Math.max(2, word.replace(/[^\p{L}\p{N}]+/gu, '').length) + 1.5);
  const total = weights.reduce((sum, weight) => sum + weight, 0);

  const cues: CaptionCue[] = [];
  let cursor = 0;
  let bucket: string[] = [];
  let bucketStart = 0;

  const flush = (end: number) => {
    if (!bucket.length) return;
    cues.push({
      index: cues.length,
      text: bucket.join(' '),
      start: Math.round(bucketStart * 1000) / 1000,
      end: Math.round(Math.max(end, bucketStart + 0.4) * 1000) / 1000,
    });
    bucket = [];
  };

  for (let i = 0; i < words.length; i += 1) {
    if (!bucket.length) bucketStart = cursor;
    bucket.push(words[i]);
    cursor += (weights[i] / total) * durationSeconds;
    if (bucket.length >= WORDS_PER_CUE || (bucket.length >= 4 && shouldBreakAfter(words[i]))) flush(cursor);
  }
  flush(cursor);

  return cues;
}

/** Timestamps when they exist, the even spread when they do not. */
export function buildCaptionCues(
  words: WordTimestamp[] | null | undefined,
  script: string,
  durationSeconds: number,
): CaptionCue[] {
  const measured = cuesFromTimestamps(words || []);
  if (measured.length) return measured;
  return cuesFromScript(script, durationSeconds);
}

/**
 * Linear scan rather than a binary search on purpose: this runs on every
 * `timeupdate` (roughly four times a second) over a list that is tens of
 * entries long, and the previous index makes the common case a single compare.
 */
export function cueAt(cues: CaptionCue[], seconds: number, previousIndex = 0): number {
  if (!cues.length) return -1;
  const at = (index: number) => {
    const cue = cues[index];
    return cue && seconds >= cue.start && seconds < cue.end;
  };
  if (at(previousIndex)) return previousIndex;
  if (at(previousIndex + 1)) return previousIndex + 1;
  for (let i = 0; i < cues.length; i += 1) {
    if (at(i)) return i;
  }
  return -1;
}
