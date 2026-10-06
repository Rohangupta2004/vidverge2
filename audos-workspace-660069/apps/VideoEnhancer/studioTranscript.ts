/**
 * Video Studio — transcript-first editing.
 *
 * The transcript is the editor's index: every word carries the source seconds
 * it was spoken in, so deleting text is a timeline cut, clicking a word is a
 * seek, and filler removal is just a word selection.
 *
 * TRANSCRIPTION PATH. The platform proxies only chat completions and TTS on
 * `/proxy/openai/*` — `/v1/audio/transcriptions` answers
 * `404 unsupported_endpoint`, so Whisper is reached through the platform's own
 * `/api/generate/transcribe` route instead. That route returns text with no
 * timings, and transcript editing is worthless without them, so the primary
 * path is the word-timestamped route (`deepgram-transcription`) and Whisper is
 * the fallback, with word times reconstructed from the speech envelope.
 */
import { transcribeVideo, type TranscriptWord } from './enhancerCore';
import { decodeAudioMono, detectSilences } from './enhancerExtras';
import { markFillers, newId, type WordToken } from './studioModel';

export interface AudioAnalysis {
  duration: number;
  silences: { start: number; end: number }[];
  /** Fraction of a window that is below the speech floor, sampled per second. */
  quietBySecond: number[];
}

/** Decode the clip's own audio once and keep what every later pass needs. */
export async function analyseAudio(file: File): Promise<AudioAnalysis> {
  const decoded = await decodeAudioMono(file);
  const silences = detectSilences(decoded.samples, decoded.sampleRate, -38, 0.45);
  const seconds = Math.max(1, Math.ceil(decoded.duration));
  const quietBySecond = new Array(seconds).fill(0);
  silences.forEach((s) => {
    for (let sec = Math.floor(s.start); sec < Math.min(seconds, Math.ceil(s.end)); sec += 1) {
      const overlap = Math.min(sec + 1, s.end) - Math.max(sec, s.start);
      if (overlap > 0) quietBySecond[sec] = Math.min(1, quietBySecond[sec] + overlap);
    }
  });
  return { duration: decoded.duration, silences, quietBySecond };
}

/** Speech regions are the complement of the detected silences. */
export function speechRegions(silences: { start: number; end: number }[], duration: number): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let cursor = 0;
  silences.forEach((s) => {
    if (s.start - cursor > 0.12) out.push({ start: cursor, end: s.start });
    cursor = Math.max(cursor, s.end);
  });
  if (duration - cursor > 0.12) out.push({ start: cursor, end: duration });
  return out.length ? out : [{ start: 0, end: duration }];
}

/**
 * Reconstruct per-word timings for a transcript that came back without them,
 * by laying the words across the detected speech regions in proportion to how
 * many characters each region can hold. Far better than spreading words evenly
 * over the whole file, because pauses stay pauses.
 */
export function estimateWordTimes(
  transcript: string,
  regions: { start: number; end: number }[],
  duration: number,
): TranscriptWord[] {
  const words = String(transcript || '').split(/\s+/).map((w) => w.trim()).filter(Boolean);
  if (!words.length) return [];
  const usable = regions.filter((r) => r.end - r.start > 0.15);
  const spans = usable.length ? usable : [{ start: 0, end: Math.max(0.5, duration) }];
  const totalSpan = spans.reduce((n, r) => n + (r.end - r.start), 0);

  const out: TranscriptWord[] = [];
  let wordIdx = 0;
  spans.forEach((region, regionIdx) => {
    const share = (region.end - region.start) / Math.max(0.001, totalSpan);
    const budget = regionIdx === spans.length - 1
      ? words.length - wordIdx
      : Math.max(1, Math.round(words.length * share));
    const slice = words.slice(wordIdx, wordIdx + budget);
    if (!slice.length) return;
    const sliceChars = slice.reduce((n, w) => n + w.length + 1, 0);
    let cursor = region.start;
    slice.forEach((w) => {
      const portion = ((w.length + 1) / Math.max(1, sliceChars)) * (region.end - region.start);
      out.push({ word: w, start: Math.round(cursor * 100) / 100, end: Math.round((cursor + portion) * 100) / 100 });
      cursor += portion;
    });
    wordIdx += slice.length;
  });
  return out;
}

export interface StudioTranscript {
  transcript: string;
  words: WordToken[];
  duration: number;
  /** True when the timings came from the word-timestamped service rather than
   * being reconstructed — the UI says which, because precision differs. */
  exactTimings: boolean;
  note: string;
}

function toTokens(words: TranscriptWord[]): WordToken[] {
  return markFillers(words.map((w) => ({
    id: newId('w'),
    text: w.word,
    start: w.start,
    end: Math.max(w.start + 0.05, w.end),
    filler: false,
    removed: false,
  })));
}

/**
 * Transcribe a clip for the studio. Word timings first; when the service can
 * only return text, the speech envelope we already computed for silence
 * detection is reused to place the words.
 */
export async function transcribeForStudio(
  file: File,
  audio: AudioAnalysis | null,
  onNote?: (note: string) => void,
): Promise<StudioTranscript> {
  const res = await transcribeVideo(file, onNote);
  if (res.words.length) {
    return {
      transcript: res.transcript || res.words.map((w) => w.word).join(' '),
      words: toTokens(res.words),
      duration: res.duration || audio?.duration || 0,
      exactTimings: true,
      note: `${res.words.length} words transcribed with word-accurate timing.`,
    };
  }
  if (!res.transcript.trim()) {
    return { transcript: '', words: [], duration: audio?.duration || 0, exactTimings: false, note: 'No speech was found in this footage.' };
  }
  const duration = res.duration || audio?.duration || 0;
  const regions = speechRegions(audio?.silences || [], duration);
  const estimated = estimateWordTimes(res.transcript, regions, duration);
  return {
    transcript: res.transcript,
    words: toTokens(estimated),
    duration,
    exactTimings: false,
    note: 'Word-level timing was unavailable, so the words were aligned to the speech envelope. Timings are close but not frame-exact — nudge a caption if one lands early.',
  };
}

// ---------------------------------------------------------------------------
// Transcript editing
// ---------------------------------------------------------------------------

/** Mark a span of words removed (a transcript text deletion). */
export function removeWords(words: WordToken[], ids: string[]): WordToken[] {
  const set = new Set(ids);
  return words.map((w) => (set.has(w.id) ? { ...w, removed: true } : w));
}

export function restoreWords(words: WordToken[], ids: string[]): WordToken[] {
  const set = new Set(ids);
  return words.map((w) => (set.has(w.id) ? { ...w, removed: false } : w));
}

/** Sentence boundaries, so "delete this sentence" is one gesture. */
export function sentenceRanges(words: WordToken[]): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  let from = 0;
  words.forEach((w, i) => {
    if (/[.!?]$/.test(w.text) || i === words.length - 1) {
      out.push({ from, to: i });
      from = i + 1;
    }
  });
  return out.filter((r) => r.to >= r.from);
}

/** Word ids for every detected filler that is still in the edit. */
export function fillerIds(words: WordToken[]): string[] {
  return words.filter((w) => w.filler && !w.removed).map((w) => w.id);
}

export function fillerCounts(words: WordToken[]): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  words.filter((w) => w.filler && !w.removed).forEach((w) => {
    const key = w.text.replace(/[^\p{L}\p{N}']/gu, '').toLowerCase() || w.text;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

/** Words that survive the edit, in order — what captions are rebuilt from. */
export function keptWords(words: WordToken[]): WordToken[] {
  return words.filter((w) => !w.removed);
}

/** The transcript as the viewer will hear it. */
export function keptTranscript(words: WordToken[]): string {
  return keptWords(words).map((w) => w.text).join(' ');
}
