/**
 * Video Studio — the captions layer.
 *
 * Caption LINES are editable text with real timings behind them, so three
 * things have to stay in agreement at all times: the words the creator typed,
 * the per-word timings karaoke highlighting reads, and the SRT the export
 * ships. Everything that keeps those three in step lives here.
 *
 * The design overrides (animation, plate, size, colour, position) are applied
 * in `captionDesign` / `captionWordPaint`, which the browser preview and the
 * veh-render composition both call — one implementation, so a line can never
 * look different in the MP4 than it did on the stage.
 */
import {
  CAPTION_MAX_WORDS_DEFAULT, clamp01, easeOutBack, easeOutCubic, newId,
} from './studioModel';
import type { CaptionCue, CaptionSettings, CaptionWord } from './studioModel';
import { captionWordStyle } from './studioStyles';
import type { CaptionStyleSpec } from './studioStyles';

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

const SCRIPT_TESTS: { code: string; label: string; re: RegExp }[] = [
  { code: 'hi', label: 'Hindi', re: /[\u0900-\u097F]/ },
  { code: 'ar', label: 'Arabic', re: /[\u0600-\u06FF]/ },
  { code: 'ru', label: 'Russian', re: /[\u0400-\u04FF]/ },
  { code: 'ja', label: 'Japanese', re: /[\u3040-\u30FF]/ },
  { code: 'ko', label: 'Korean', re: /[\uAC00-\uD7AF]/ },
  { code: 'zh', label: 'Chinese', re: /[\u4E00-\u9FFF]/ },
  { code: 'he', label: 'Hebrew', re: /[\u0590-\u05FF]/ },
  { code: 'th', label: 'Thai', re: /[\u0E00-\u0E7F]/ },
];

const STOPWORDS: { code: string; label: string; words: string[] }[] = [
  { code: 'en', label: 'English', words: ['the', 'and', 'you', 'that', 'this', 'with', 'for', 'have', 'what', 'just'] },
  { code: 'es', label: 'Spanish', words: ['que', 'de', 'los', 'las', 'para', 'con', 'una', 'por', 'como', 'pero'] },
  { code: 'pt', label: 'Portuguese', words: ['que', 'uma', 'para', 'com', 'não', 'mais', 'você', 'isso', 'como', 'está'] },
  { code: 'fr', label: 'French', words: ['que', 'les', 'des', 'pour', 'avec', 'vous', 'dans', 'pas', 'une', 'cette'] },
  { code: 'de', label: 'German', words: ['und', 'die', 'der', 'das', 'ist', 'nicht', 'mit', 'ein', 'auch', 'wir'] },
  { code: 'it', label: 'Italian', words: ['che', 'per', 'con', 'una', 'questo', 'sono', 'non', 'della', 'come', 'anche'] },
  { code: 'nl', label: 'Dutch', words: ['het', 'een', 'van', 'dat', 'niet', 'zijn', 'voor', 'met', 'maar', 'ook'] },
  { code: 'id', label: 'Indonesian', words: ['yang', 'dan', 'untuk', 'tidak', 'dengan', 'ini', 'itu', 'saya', 'kita', 'bisa'] },
];

export interface DetectedLanguage { code: string; label: string; confident: boolean }

/**
 * Work out the caption language. The transcription service's own answer wins
 * when it gives one; otherwise the script is checked first (a Devanagari
 * transcript is unambiguous) and Latin-script languages are separated by
 * stopword frequency. When nothing scores clearly the answer is 'auto' rather
 * than a confident guess — a wrong language label on an SRT is worse than no
 * label at all.
 */
export function detectLanguage(transcript: string, reported?: string): DetectedLanguage {
  const given = String(reported || '').trim().slice(0, 8).toLowerCase();
  if (given && given !== 'auto') {
    const code = given.split(/[-_]/)[0];
    const known = STOPWORDS.find((s) => s.code === code) || SCRIPT_TESTS.find((s) => s.code === code);
    return { code, label: known ? known.label : code.toUpperCase(), confident: true };
  }
  const text = String(transcript || '');
  if (!text.trim()) return { code: 'auto', label: 'Undetected', confident: false };

  for (const s of SCRIPT_TESTS) {
    if (s.re.test(text)) return { code: s.code, label: s.label, confident: true };
  }

  const tokens = text.toLowerCase().split(/[^\p{L}']+/u).filter(Boolean);
  if (tokens.length < 8) return { code: 'auto', label: 'Undetected', confident: false };
  const counts = new Map<string, number>();
  tokens.forEach((t) => counts.set(t, (counts.get(t) || 0) + 1));

  let best = { code: 'auto', label: 'Undetected', score: 0 };
  STOPWORDS.forEach((lang) => {
    const score = lang.words.reduce((n, w) => n + (counts.get(w) || 0), 0);
    if (score > best.score) best = { code: lang.code, label: lang.label, score };
  });
  const share = best.score / tokens.length;
  if (share < 0.012) return { code: 'auto', label: 'Undetected', confident: false };
  return { code: best.code, label: best.label, confident: share > 0.03 };
}

export function languageLabel(code: string): string {
  if (!code || code === 'auto') return 'Undetected';
  const known = STOPWORDS.find((s) => s.code === code) || SCRIPT_TESTS.find((s) => s.code === code);
  return known ? known.label : code.toUpperCase();
}

// ---------------------------------------------------------------------------
// Editing a caption line
// ---------------------------------------------------------------------------

/**
 * Re-time a cue after its text was edited inline.
 *
 * Words the creator did not touch keep their measured timing — that is what
 * stops karaoke highlighting from drifting every time a typo is fixed. Only
 * genuinely new words get a timing, and they are laid across whatever gap is
 * left in proportion to how long they are to say.
 */
export function retimeCue(cue: CaptionCue, nextText: string): CaptionCue {
  const text = String(nextText).replace(/\s+/g, ' ').trim();
  const parts = text ? text.split(' ') : [];
  if (!parts.length) return { ...cue, text: '', words: [] };

  const old = cue.words.length
    ? cue.words
    : [{ text: cue.text, start: cue.start, end: cue.end }];
  const start = cue.start;
  const end = Math.max(cue.start + 0.25, cue.end);

  // Keep the timing of any word that is still in the same slot.
  const kept: (CaptionWord | null)[] = parts.map((p, i) => {
    const o = old[i];
    return o && o.text.toLowerCase() === p.toLowerCase() ? { ...o, text: p } : null;
  });

  const words: CaptionWord[] = [];
  let cursor = start;
  for (let i = 0; i < parts.length; i += 1) {
    const hit = kept[i];
    if (hit && hit.start >= cursor - 0.01 && hit.end <= end + 0.01) {
      words.push(hit);
      cursor = hit.end;
      continue;
    }
    // Find the next anchored word so the gap can be shared out fairly.
    let nextAnchor = end;
    let runEnd = parts.length;
    for (let j = i + 1; j < parts.length; j += 1) {
      const k = kept[j];
      if (k && k.start > cursor) { nextAnchor = k.start; runEnd = j; break; }
    }
    const run = parts.slice(i, runEnd);
    const chars = run.reduce((n, w) => n + w.length + 1, 0);
    const span = Math.max(0.12 * run.length, nextAnchor - cursor);
    run.forEach((w) => {
      const share = ((w.length + 1) / Math.max(1, chars)) * span;
      words.push({ text: w, start: Number(cursor.toFixed(3)), end: Number((cursor + share).toFixed(3)) });
      cursor += share;
    });
    i = runEnd - 1;
  }

  const last = words[words.length - 1];
  return {
    ...cue,
    text,
    end: Math.max(end, last ? last.end : end),
    words,
  };
}

/** Move a cue in time, dragging its word timings with it. */
export function shiftCue(cue: CaptionCue, nextStart: number, nextEnd: number): CaptionCue {
  const start = Math.max(0, nextStart);
  const end = Math.max(start + 0.2, nextEnd);
  const oldSpan = Math.max(0.05, cue.end - cue.start);
  const k = (end - start) / oldSpan;
  return {
    ...cue,
    start,
    end,
    words: cue.words.map((w) => ({
      text: w.text,
      start: Number((start + (w.start - cue.start) * k).toFixed(3)),
      end: Number((start + (w.end - cue.start) * k).toFixed(3)),
    })),
  };
}

/** Split one long line in two at a word boundary. */
export function splitCue(cue: CaptionCue, atWord: number): CaptionCue[] {
  const i = Math.max(1, Math.min(cue.words.length - 1, Math.round(atWord)));
  if (cue.words.length < 2) return [cue];
  const a = cue.words.slice(0, i);
  const b = cue.words.slice(i);
  return [
    { id: cue.id, text: a.map((w) => w.text).join(' '), start: cue.start, end: a[a.length - 1].end, words: a },
    { id: newId('cue'), text: b.map((w) => w.text).join(' '), start: b[0].start, end: cue.end, words: b },
  ];
}

/** Fuse a line into the one before it. */
export function mergeCues(a: CaptionCue, b: CaptionCue): CaptionCue {
  const words = [...a.words, ...b.words];
  return {
    id: a.id,
    text: `${a.text} ${b.text}`.replace(/\s+/g, ' ').trim(),
    start: Math.min(a.start, b.start),
    end: Math.max(a.end, b.end),
    words,
  };
}

/** The cue the playhead is inside, or the next one coming up. */
export function activeCueIndex(cues: CaptionCue[], t: number): number {
  for (let i = 0; i < cues.length; i += 1) {
    if (t >= cues[i].start && t <= cues[i].end) return i;
  }
  return -1;
}

export function captionMaxWords(s: CaptionSettings): number {
  const n = Math.round(Number(s && s.maxWords));
  return Number.isFinite(n) ? Math.max(2, Math.min(12, n)) : CAPTION_MAX_WORDS_DEFAULT;
}

// ---------------------------------------------------------------------------
// Design overrides — shared by the preview and the render
// ---------------------------------------------------------------------------

function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return `rgba(0,0,0,${clamp01(alpha).toFixed(3)})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${clamp01(alpha).toFixed(3)})`;
}

export interface CaptionDesign {
  background: string;
  radius: number;
  padX: number;
  padY: number;
  /** True when the plate should stretch the full caption width (the bar). */
  fullWidth: boolean;
}

/** The plate behind the line, after the creator's override is applied. */
export function captionDesign(settings: CaptionSettings, spec: CaptionStyleSpec): CaptionDesign {
  const mode = settings.background || 'preset';
  if (mode === 'preset') {
    return { background: spec.background, radius: spec.radius, padX: spec.padX, padY: spec.padY, fullWidth: false };
  }
  if (mode === 'none') return { background: 'transparent', radius: 0, padX: 0, padY: 0, fullWidth: false };
  const fill = withAlpha(settings.backgroundColor || '#000000', mode === 'pill' ? Math.max(0.6, settings.backgroundOpacity) : settings.backgroundOpacity);
  if (mode === 'pill') return { background: fill, radius: 999, padX: 34, padY: 16, fullWidth: false };
  return { background: fill, radius: 6, padX: 40, padY: 16, fullWidth: true };
}

export interface CaptionLineAnim { opacity: number; translateY: number; scale: number }

/** Whole-line entrance, used when the override asks for a fade. */
export function captionLineAnim(settings: CaptionSettings, tInCue: number): CaptionLineAnim {
  if (settings.animation !== 'fade' && settings.animation !== 'dissolve') return { opacity: 1, translateY: 0, scale: 1 };
  const p = clamp01(tInCue / (settings.animation === 'dissolve' ? 0.48 : 0.26));
  const e = easeOutCubic(p);
  return { opacity: e, translateY: (1 - e) * 26, scale: 0.97 + 0.03 * e };
}

/**
 * Per-word paint. When the creator leaves the animation on 'preset' this is
 * exactly the preset's own behaviour; the three overrides reinterpret the same
 * word timings without touching the preset's typography.
 */
export function captionWordPaint(
  settings: CaptionSettings,
  spec: CaptionStyleSpec,
  word: { start: number; end: number },
  cueStart: number,
  t: number,
  index: number,
): { color: string; scale: number; opacity: number; shadow: string; gradient: string | null } {
  const anim = settings.animation || 'preset';
  if (anim === 'preset') return captionWordStyle(spec, word, cueStart, t, index);

  const local = cueStart + t;
  const spoken = local >= word.start;
  const active = local >= word.start && local <= word.end + 0.06;
  const since = local - word.start;

  if (anim === 'karaoke') {
    return {
      color: spoken ? spec.activeColor : spec.inactiveColor,
      scale: 1, opacity: 1, shadow: spec.shadow, gradient: null,
    };
  }
  if (anim === 'pop' || anim === 'bounce') {
    const reveal = clamp01(since / (anim === 'bounce' ? 0.2 : 0.12));
    const pop = active
      ? anim === 'bounce'
        ? 1 + Math.sin(clamp01(since / 0.32) * Math.PI) * 0.18
        : 1 + 0.14 * (1 - easeOutCubic(clamp01(since / 0.22)))
      : 1;
    return {
      color: active ? spec.activeColor : spec.inactiveColor,
      scale: spoken ? pop : 0.84 + 0.16 * easeOutBack(reveal),
      opacity: spoken ? 1 : reveal,
      shadow: spec.shadow, gradient: null,
    };
  }
  // 'fade' and 'dissolve' animate the whole line, so every word paints flat.
  return { color: spec.color, scale: 1, opacity: 1, shadow: spec.shadow, gradient: null };
}

// ---------------------------------------------------------------------------
// Persistence (ve_captions)
// ---------------------------------------------------------------------------

interface WorkspaceDbLike { from?: (table: string) => any }

function workspaceDb(): WorkspaceDbLike | null {
  if (typeof window === 'undefined') return null;
  const db = (window as unknown as { __workspaceDb?: WorkspaceDbLike }).__workspaceDb;
  return db && typeof db.from === 'function' ? db : null;
}

export interface CaptionTrackRow {
  rowId: number | null;
  projectId: number | null;
  title: string;
  sourceUrl: string;
  language: string;
  cues: CaptionCue[];
  settings: CaptionSettings;
  srt: string;
  durationS: number;
}

/**
 * Upsert the caption track into `ve_captions`. Returns the row id so the next
 * save updates instead of inserting. Failure is non-fatal on purpose: the
 * caption track also travels inside the project JSON, so a database hiccup
 * must never cost the creator their edit.
 */
export async function saveCaptionTrack(track: CaptionTrackRow): Promise<number | null> {
  const db = workspaceDb();
  if (!db || !db.from || !track.cues.length) return track.rowId;
  const row = {
    project_id: track.projectId,
    title: track.title.slice(0, 160) || 'Caption track',
    source_url: track.sourceUrl.slice(0, 1024),
    language: (track.language || 'auto').slice(0, 12),
    cue_count: track.cues.length,
    duration_s: Number(track.durationS.toFixed(2)),
    cues: track.cues.map((c) => ({
      id: c.id,
      text: c.text,
      start: Number(c.start.toFixed(3)),
      end: Number(c.end.toFixed(3)),
      words: c.words.map((w) => ({ text: w.text, start: Number(w.start.toFixed(3)), end: Number(w.end.toFixed(3)) })),
    })),
    settings: track.settings,
    srt: track.srt.slice(0, 200000),
    edited_at: new Date().toISOString(),
  };
  if (track.rowId == null) {
    const res = await db.from('ve_captions').insert(row);
    const id = res?.data?.[0]?.id ?? res?.data?.id ?? res?.id;
    return id == null ? null : Number(id);
  }
  await db.from('ve_captions').update(track.rowId, row);
  return track.rowId;
}
