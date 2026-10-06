/**
 * Short Video Enhancer — the dmux caption engine.
 *
 * Word-by-word timing, cue grouping, silence detection and safe-zone auto-fit.
 * Everything here is pure: the live preview and the Remotion composition are
 * handed the SAME cue list, so what a creator scrubs through is what renders.
 *
 * Timing has two sources, in order of preference:
 *   1. word-level timestamps from the platform's Deepgram transcription,
 *   2. an even split across the clip when no timing is available.
 * `timingSource` on the document records which one was used so the UI can say
 * so rather than implying the captions are speech-locked when they are not.
 */

import {
  CAPTION_SAFE_X, DESIGN_W, clamp,
  type CaptionCue, type CaptionLanguage, type CaptionWord, type EditDoc, type Gap,
} from './sveTypes';
import { CAPTION_CHAR_ADVANCE, tierStyle } from './sveCaptionTiers';
import { isStopWord } from './sveHinglish';

/** A pause longer than this reads as a real gap, not inter-word spacing. */
export const SILENCE_GAP_S = 0.45;

export function splitWords(text: string): string[] {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w.length > 0);
}

/**
 * Distribute words evenly across `duration`, weighting each word by its length
 * so a long word holds the screen longer than "a". Used only when the
 * transcription service gave no timestamps.
 */
export function evenTimings(text: string, duration: number): CaptionWord[] {
  const tokens = splitWords(text);
  const total = Math.max(0.5, Number(duration) || 0);
  if (!tokens.length) return [];
  const weights = tokens.map((w) => Math.max(2, w.length));
  const sum = weights.reduce((a, b) => a + b, 0);
  let cursor = 0;
  return tokens.map((word, i) => {
    const span = (weights[i] / sum) * total;
    const start = cursor;
    cursor += span;
    return { text: word, start, end: Math.min(total, cursor) };
  });
}

/** Clamp a transcription word track into the clip and drop anything degenerate. */
export function normaliseWords(words: CaptionWord[], duration: number): CaptionWord[] {
  const total = Math.max(0.1, Number(duration) || 0);
  return (Array.isArray(words) ? words : [])
    .filter((w) => w && typeof w.text === 'string' && w.text.trim().length > 0)
    .map((w) => ({
      text: w.text.trim(),
      start: clamp(w.start, 0, total),
      end: clamp(w.end, 0, total),
      emphasis: !!w.emphasis,
    }))
    .filter((w) => w.end > w.start)
    .sort((a, b) => a.start - b.start);
}

/**
 * Pauses between spoken words. A cue never runs across one — `buildCues`
 * breaks on a real pause — so a caption line always ends where the speaker
 * stopped, and the gaps themselves are drawn on the AUDIO track so the
 * creator can see where the clip wants tightening.
 */
export function detectSilences(words: CaptionWord[], duration: number): Gap[] {
  const gaps: Gap[] = [];
  const total = Math.max(0, Number(duration) || 0);
  if (!words.length) return total > 0 ? [{ start: 0, end: total }] : [];
  if (words[0].start > SILENCE_GAP_S) gaps.push({ start: 0, end: words[0].start });
  for (let i = 1; i < words.length; i++) {
    const gap = words[i].start - words[i - 1].end;
    if (gap >= SILENCE_GAP_S) gaps.push({ start: words[i - 1].end, end: words[i].start });
  }
  const last = words[words.length - 1].end;
  if (total - last > SILENCE_GAP_S) gaps.push({ start: last, end: total });
  return gaps;
}

export function isSilentAt(silences: Gap[], t: number): boolean {
  return silences.some((g) => t >= g.start && t < g.end);
}

/**
 * Group the word track into on-screen cues. A cue breaks on a real pause, on
 * sentence-ending punctuation, or once it reaches `wordsPerCue` — so a line
 * never runs past the point where the speaker stopped.
 */
export function buildCues(words: CaptionWord[], wordsPerCue: number): CaptionCue[] {
  const limit = Math.max(1, Math.min(6, Math.round(wordsPerCue) || 3));
  const cues: CaptionCue[] = [];
  let current: CaptionWord[] = [];

  const flush = () => {
    if (!current.length) return;
    cues.push({
      id: 'cue-' + cues.length,
      start: current[0].start,
      end: current[current.length - 1].end,
      words: current,
    });
    current = [];
  };

  for (let i = 0; i < words.length; i++) {
    current.push(words[i]);
    const next = words[i + 1];
    const endsSentence = /[.!?…]$/.test(words[i].text);
    const pauseAhead = next ? next.start - words[i].end >= SILENCE_GAP_S : true;
    if (current.length >= limit || endsSentence || pauseAhead) flush();
  }
  flush();
  return cues;
}

/**
 * Shrink the type until the widest cue fits between the safe margins.
 *
 * Width is estimated from character count rather than measured, because the
 * same number has to hold in the browser preview and in the render container
 * where no measuring DOM exists. `CAPTION_CHAR_ADVANCE` is the measured
 * average advance of the heavy sans stack this app ships at weight 900; the
 * estimate runs slightly wide, which errs toward never clipping.
 *
 * This is the size ORDINARY DIALOGUE gets — Tier 1. A cinematic or beat line
 * asks for a multiple of it, and `fitTierSize` caps that line individually
 * rather than shrinking the whole track to accommodate one big one.
 */
export function autoFitSize(cues: CaptionCue[], requested: number, uppercase: boolean): number {
  if (!cues.length) return requested;
  const safeWidth = DESIGN_W * (1 - CAPTION_SAFE_X * 2);
  const longest = cues.reduce((max, cue) => {
    const line = cue.words.map((w) => (uppercase ? w.text.toUpperCase() : w.text)).join(' ');
    return Math.max(max, line.length);
  }, 0);
  if (longest <= 0) return requested;
  const fits = safeWidth / (longest * CAPTION_CHAR_ADVANCE);
  return Math.max(34, Math.min(requested, Math.floor(fits)));
}

/**
 * The cue on screen at `t`, or null between cues. The window runs past the
 * cue's end by its tier's tail fade — a fifth of a second for ordinary
 * dialogue, and zero for a beat line, which cuts rather than fades.
 */
export function cueAt(cues: CaptionCue[], t: number): CaptionCue | null {
  for (const cue of cues) {
    if (t >= cue.start - 0.0001 && t <= cue.end + tierStyle(cue.tier).tailS) return cue;
  }
  return null;
}

/** Re-derive the word track after the creator edits the transcript by hand. */
export function retimeFromTranscript(doc: EditDoc, transcript: string): CaptionWord[] {
  const tokens = splitWords(transcript);
  const existing = doc.words;
  if (!tokens.length) return [];
  // Keep the measured timings while the creator is only fixing spelling.
  if (existing.length === tokens.length) {
    return tokens.map((text, i) => ({ ...existing[i], text }));
  }
  return evenTimings(transcript, doc.durationS);
}

/**
 * Caption keywords worth pinning B-roll to: the longest content words, minus
 * the usual filler. Returned in timeline order with the moment each is spoken.
 *
 * The filler list follows the caption language, so a Hinglish track does not
 * offer to pin a cutaway to "karna" or "tumhari" — those are long enough to
 * beat the four-character test but carry nothing to illustrate.
 */
export function keywordMoments(
  words: CaptionWord[],
  language: CaptionLanguage = 'en',
  limit = 8,
): { word: string; at: number }[] {
  const seen = new Set<string>();
  const hits: { word: string; at: number; score: number }[] = [];
  for (const w of words) {
    const clean = w.text.toLowerCase().replace(/[^a-z0-9']/g, '');
    if (clean.length < 4 || isStopWord(clean, language) || seen.has(clean)) continue;
    seen.add(clean);
    hits.push({ word: clean, at: w.start, score: clean.length + (w.emphasis ? 6 : 0) });
  }
  return hits
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .sort((a, b) => a.at - b.at)
    .map(({ word, at }) => ({ word, at }));
}

// ---------------------------------------------------------------------------
// Sidecar subtitle files
// ---------------------------------------------------------------------------

/** `HH:MM:SS` plus milliseconds, with the separator each format wants. */
function stamp(seconds: number, msSeparator: ',' | '.'): string {
  const total = Math.max(0, Number(seconds) || 0);
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = Math.floor(total % 60);
  const ms = Math.round((total - Math.floor(total)) * 1000);
  return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + ':'
    + String(ss).padStart(2, '0') + msSeparator + String(Math.min(999, ms)).padStart(3, '0');
}

/**
 * The cue list as plain subtitle rows.
 *
 * The text is written EXACTLY as the transcript holds it. Uppercase is a
 * visual treatment of the burnt-in track, not part of the words, and a sidecar
 * file is read by players, search indexes and screen readers that are all
 * better served by the real casing. Romanized Hindi is Latin script, so a
 * Hinglish line needs no encoding beyond the UTF-8 both formats already are.
 */
function subtitleRows(cues: CaptionCue[]): { start: number; end: number; text: string }[] {
  return cues
    .map((cue) => ({
      start: cue.start,
      // A zero-length cue is invisible in every player, so give the shortest
      // ones the 0.4s floor the format conventionally uses.
      end: Math.max(cue.start + 0.4, cue.end),
      text: cue.words.map((w) => String(w.text || '').trim()).filter(Boolean).join(' ').trim(),
    }))
    .filter((row) => row.text.length > 0);
}

export function captionsToSrt(cues: CaptionCue[]): string {
  const rows = subtitleRows(cues);
  if (!rows.length) return '';
  return rows
    .map((row, i) => (i + 1) + '\n'
      + stamp(row.start, ',') + ' --> ' + stamp(row.end, ',') + '\n'
      + row.text + '\n')
    .join('\n');
}

export function captionsToVtt(cues: CaptionCue[]): string {
  const rows = subtitleRows(cues);
  if (!rows.length) return '';
  return 'WEBVTT\n\n' + rows
    .map((row) => stamp(row.start, '.') + ' --> ' + stamp(row.end, '.') + '\n' + row.text + '\n')
    .join('\n');
}
