/**
 * DESIGN WITH AI — transcript engine.
 *
 * - Word-timed transcription reuses the Video Enhancer's proven pipeline
 *   (Deepgram word timestamps with browser WAV extraction + plain-text
 *   fallbacks) — imported, not duplicated.
 * - Sentence/paragraph grouping turns raw words into editable, timestamped
 *   segments (pause- and punctuation-aware, larger than caption chunks).
 * - SRT/VTT IMPORT skips retranscription entirely; SRT EXPORT ships the
 *   final transcript alongside the video.
 * - Hand-edited segment text is retimed by distributing words evenly.
 */

import { transcribeVideo } from '../../VideoEnhancer/enhancerCore';
import { DesignSegment, DesignTranscript, DesignWord } from './api';

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Auto transcription (Deepgram word timestamps via the platform)
// ---------------------------------------------------------------------------

export async function autoTranscribe(file: File, onNote?: (n: string) => void): Promise<DesignTranscript> {
  const { transcript, words } = await transcribeVideo(file, onNote);
  const clean: DesignWord[] = (words || [])
    .filter((w) => w && typeof w.word === 'string' && Number.isFinite(w.start) && Number.isFinite(w.end))
    .map((w) => ({ word: String(w.word), start: round2(Number(w.start)), end: round2(Number(w.end)) }));
  if (!clean.length && !transcript.trim()) {
    throw new Error('No speech could be transcribed from this video — you can import an SRT/VTT file instead.');
  }
  if (!clean.length) {
    // Plain-text fallback path: no word timings — one segment covering the video.
    return {
      words: [],
      segments: [{ id: 'seg-0', start: 0, end: 0, text: transcript.trim(), words: [] }],
      source: 'auto',
    };
  }
  return { words: clean, segments: groupIntoSentences(clean), source: 'auto' };
}

// ---------------------------------------------------------------------------
// Sentence grouping — bigger, sentence-shaped segments (not caption chunks)
// ---------------------------------------------------------------------------

export function groupIntoSentences(words: DesignWord[]): DesignSegment[] {
  const groups: DesignWord[][] = [];
  let cur: DesignWord[] = [];
  const flush = () => { if (cur.length) { groups.push(cur); cur = []; } };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    // A long pause starts a new thought even mid-sentence.
    if (prev && w.start - prev.end > 1.1) flush();
    cur.push(w);
    const dur = cur[cur.length - 1].end - cur[0].start;
    const endsSentence = /[.!?]$/.test(w.word);
    if (endsSentence || cur.length >= 26 || dur >= 9) flush();
  }
  flush();
  return groups.map((g, idx) => ({
    id: `seg-${idx}`,
    start: round2(g[0].start),
    end: round2(Math.max(g[g.length - 1].end, g[0].start + 0.3)),
    text: g.map((w) => w.word).join(' '),
    words: g,
  }));
}

/** Re-time a hand-edited segment: distribute the new words evenly. */
export function retimeSegment(seg: DesignSegment, newText: string): DesignSegment {
  const parts = newText.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { ...seg, text: '', words: [] };
  const span = Math.max(0.3, seg.end - seg.start);
  const per = span / parts.length;
  return {
    ...seg,
    text: parts.join(' '),
    words: parts.map((t, i) => ({ word: t, start: round2(seg.start + i * per), end: round2(seg.start + (i + 1) * per) })),
  };
}

/** Rebuild the flat word list after segment edits (keeps everything consistent). */
export function flattenWords(segments: DesignSegment[]): DesignWord[] {
  return segments.flatMap((s) => s.words);
}

// ---------------------------------------------------------------------------
// SRT / VTT import — skips retranscription
// ---------------------------------------------------------------------------

function parseClock(raw: string): number | null {
  // 00:00:04,200 | 00:00:04.200 | 00:04.200 | 04.2
  const m = /^(?:(\d+):)?(?:(\d+):)?(\d+)[.,](\d{1,3})$/.exec(raw.trim());
  if (!m) return null;
  const ms = Number(m[4].padEnd(3, '0'));
  const s = Number(m[3]);
  let min = 0; let hr = 0;
  if (m[1] !== undefined && m[2] !== undefined) { hr = Number(m[1]); min = Number(m[2]); }
  else if (m[1] !== undefined) { min = Number(m[1]); }
  return hr * 3600 + min * 60 + s + ms / 1000;
}

function stripTags(text: string): string {
  return text.replace(/<[^>]*>/g, '').replace(/\{[^}]*\}/g, '').trim();
}

/**
 * Parse an SRT or VTT file's text into a transcript. Cue words get evenly
 * distributed timings inside their cue — accurate enough for graphic sync.
 * Speaker labels ("NAME:" prefixes or <v Name> tags) are preserved.
 */
export function parseSubtitles(raw: string): DesignTranscript {
  const isVtt = /^\ufeff?WEBVTT/m.test(raw);
  const text = raw.replace(/^\ufeff/, '').replace(/\r/g, '');
  const blocks = text.split(/\n\n+/);
  const segments: DesignSegment[] = [];

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const timeIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeIdx < 0) continue;
    const [a, b] = lines[timeIdx].split('-->').map((s) => s.trim().split(/\s/)[0]);
    const start = parseClock(a);
    const end = parseClock(b);
    if (start == null || end == null || end <= start) continue;

    let speaker: string | null = null;
    let body = lines.slice(timeIdx + 1).join(' ');
    const vTag = /<v\s+([^>]+)>/i.exec(body);
    if (vTag) speaker = vTag[1].trim();
    body = stripTags(body);
    const namePrefix = /^([A-Z][A-Za-z .'-]{1,24}):\s+(.*)$/.exec(body);
    if (namePrefix) { speaker = speaker || namePrefix[1]; body = namePrefix[2]; }
    if (!body) continue;

    const parts = body.split(/\s+/).filter(Boolean);
    const per = Math.max(0.05, (end - start) / Math.max(1, parts.length));
    segments.push({
      id: `seg-${segments.length}`,
      start: round2(start),
      end: round2(end),
      text: parts.join(' '),
      words: parts.map((t, i) => ({ word: t, start: round2(start + i * per), end: round2(start + (i + 1) * per) })),
      speaker,
    });
  }

  if (!segments.length) throw new Error('No cues could be read from this subtitle file — is it a valid SRT or VTT?');
  segments.sort((x, y) => x.start - y.start);
  segments.forEach((s, i) => { s.id = `seg-${i}`; });
  return { words: flattenWords(segments), segments, source: isVtt ? 'vtt' : 'srt' };
}

// ---------------------------------------------------------------------------
// SRT export
// ---------------------------------------------------------------------------

function srtClock(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const rem = ms % 1000;
  const p = (n: number, len = 2) => String(n).padStart(len, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(rem, 3)}`;
}

export function toSrt(segments: DesignSegment[]): string {
  return segments
    .filter((s) => s.text.trim())
    .map((s, i) => `${i + 1}\n${srtClock(s.start)} --> ${srtClock(s.end)}\n${s.speaker ? `${s.speaker}: ` : ''}${s.text}`)
    .join('\n\n') + '\n';
}

export function downloadText(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ---------------------------------------------------------------------------
// Deterministic graphic → transcript sync
// ---------------------------------------------------------------------------

/**
 * Snap a planned time range onto the transcript: if the narration reference
 * text is found, align to those exact word timestamps; otherwise clamp to the
 * nearest segment boundaries. Pure and deterministic — no AI in this step.
 */
export function snapToTranscript(
  start: number,
  end: number,
  narrationRef: string,
  transcript: DesignTranscript,
  videoDuration: number,
): { start: number; end: number } {
  const dur = Math.max(1, videoDuration || 1);
  let s = Math.min(Math.max(0, start), dur - 0.5);
  let e = Math.min(Math.max(s + 0.8, end), dur);

  const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
  const ref = norm(narrationRef);
  const words = transcript.words;

  if (ref && words.length) {
    const refParts = ref.split(' ').filter(Boolean);
    if (refParts.length >= 2) {
      const wordNorms = words.map((w) => norm(w.word));
      // Find the reference phrase in the word stream (first match wins).
      outer: for (let i = 0; i <= wordNorms.length - refParts.length; i += 1) {
        for (let j = 0; j < refParts.length; j += 1) {
          if (wordNorms[i + j] !== refParts[j]) continue outer;
        }
        s = words[i].start;
        e = Math.max(words[i + refParts.length - 1].end, s + 1.2);
        break;
      }
    }
  }

  // Keep the graphic on screen a beat longer than the words, within bounds.
  e = Math.min(dur, Math.max(e, s + 1.2) + 0.35);
  s = Math.max(0, Math.round(s * 100) / 100);
  e = Math.round(e * 100) / 100;
  return { start: s, end: e };
}
