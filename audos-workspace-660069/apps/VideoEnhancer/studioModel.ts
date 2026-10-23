/**
 * Video Studio — the whole editor's data model and pure helpers.
 *
 * Everything in this file is serialisable data or a side-effect-free function.
 * One `EditDoc` describes the complete edit, which makes three things fall out
 * for free: undo/redo is a stack of docs, autosave is one JSON column, and the
 * server render is handed the same shape the browser previewed.
 *
 * Transport (callHook) and the timeline primitives that predate the studio
 * rework are reused from nleCore so there is a single implementation of each.
 */
import { WORKSPACE_ID } from '../../lib/workspace';
import { LB, callHook, nleToken } from './nleCore';

export { LB, callHook, nleToken };

export const WORKSPACE_UUID = WORKSPACE_ID;

export function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
}

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const easeOutBack = (t: number) => { const c1 = 1.70158; const c3 = c1 + 1; const x = clamp01(t) - 1; return 1 + c3 * x * x * x + c1 * x * x; };
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
export const easeInCubic = (t: number) => Math.pow(clamp01(t), 3);

export function fmtTimecode(sec: number, withFrames = false): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const base = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  if (!withFrames) return base;
  return `${base}:${String(Math.floor((sec % 1) * 30)).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Output formats
// ---------------------------------------------------------------------------

export type AspectId = '16:9' | '9:16' | '1:1' | '4:5';

export const ASPECTS: { id: AspectId; label: string; blurb: string; ratio: number }[] = [
  { id: '16:9', label: '16:9', blurb: 'YouTube · landscape', ratio: 16 / 9 },
  { id: '9:16', label: '9:16', blurb: 'TikTok · Reels · Shorts', ratio: 9 / 16 },
  { id: '1:1', label: '1:1', blurb: 'Feed square', ratio: 1 },
  { id: '4:5', label: '4:5', blurb: 'Instagram portrait', ratio: 4 / 5 },
];

export function aspectRatio(a: AspectId): number {
  return (ASPECTS.find((x) => x.id === a) || ASPECTS[0]).ratio;
}

export type ResolutionId = '720p' | '1080p' | '4k';

/**
 * The platform render service is pinned to a 1920x1080 canvas and the portrait
 * up-convert accepts only 1080x1920, so 1080p is the one resolution that can
 * actually be delivered today. The other two stay in the model (and are shown
 * as unavailable rather than hidden) so the day the renderer accepts other
 * geometries this becomes a one-line change.
 */
export const RESOLUTIONS: { id: ResolutionId; label: string; short: number; available: boolean; note: string }[] = [
  { id: '720p', label: '720p', short: 720, available: false, note: 'The platform renderer is fixed at 1920x1080 — 720p is not offered.' },
  { id: '1080p', label: '1080p', short: 1080, available: true, note: '' },
  { id: '4k', label: '4K', short: 2160, available: false, note: 'The platform renderer is fixed at 1920x1080 — 4K is not available from it.' },
];

/** Even-numbered output geometry for an aspect + resolution (H.264 needs even). */
export function outputDims(aspect: AspectId, res: ResolutionId): { width: number; height: number } {
  const short = (RESOLUTIONS.find((r) => r.id === res) || RESOLUTIONS[1]).short;
  const ratio = aspectRatio(aspect);
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return ratio >= 1
    ? { width: even(short * ratio), height: even(short) }
    : { width: even(short), height: even(short / ratio) };
}

// ---------------------------------------------------------------------------
// Tracks — the colour language of the timeline
// ---------------------------------------------------------------------------

export type TrackId = 'raw' | 'cut' | 'broll' | 'overlay' | 'caption' | 'fx';

export const TRACK_COLORS: Record<TrackId, string> = {
  raw: '#57534E',      // grey — untouched footage
  cut: '#1D4ED8',      // blue — cut / trimmed
  broll: '#166534',    // green — b-roll
  overlay: '#C8920A',  // amber — overlays and text
  caption: '#A16207',  // yellow — captions
  fx: '#C2410C',       // orange — effects and transitions
};

export const TRACK_ROWS: { id: TrackId; label: string; hint: string }[] = [
  { id: 'raw', label: 'Video', hint: 'Grey is raw footage, blue is cut, green is B-roll' },
  { id: 'broll', label: 'B-roll', hint: 'Detected gaps you can fill or generate into' },
  { id: 'overlay', label: 'Overlay', hint: 'Logos, images and animated text layers' },
  { id: 'caption', label: 'Captions', hint: 'Word-timed captions from the transcript' },
  { id: 'fx', label: 'FX', hint: 'Transitions on cut points and visual effects' },
];

// ---------------------------------------------------------------------------
// Clips
// ---------------------------------------------------------------------------

/** Per-clip colour / speed adjustments. 100 is neutral on the legacy sliders; 0 on the advanced trims. */
export interface Adjust {
  brightness: number;   // 50..160
  contrast: number;     // 50..160
  saturation: number;   // 0..200
  highlights: number;   // -50..50
  shadows: number;      // -50..50
  temperature: number;  // -50..50
  tint: number;         // -50..50
  speed: number;        // 0.25..4
  reverse: boolean;
}

export const NEUTRAL_ADJUST: Adjust = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  highlights: 0,
  shadows: 0,
  temperature: 0,
  tint: 0,
  speed: 1,
  reverse: false,
};

/** Normalised crop window (0..1 of the source frame). */
export interface CropRect { x: number; y: number; w: number; h: number }

export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };

// ---- per-clip motion: speed ramping, match-cut zoom, camera shake ---------

export type SpeedCurveId = 'easeIn' | 'easeOut' | 'punch' | 'custom';

/**
 * A ramp never changes how long the clip runs — it redistributes the source
 * time inside the same slot. See `warp()` in studioFx for why that matters.
 */
export interface SpeedRamp {
  enabled: boolean;
  curve: SpeedCurveId;
  /** 0..0.85 — how far the curve bends away from constant speed. */
  intensity: number;
  /** Custom curve handles, as playback multipliers. */
  startSpeed: number;
  midSpeed: number;
  endSpeed: number;
}

export type ZoomIntensityId = 'low' | 'medium' | 'high';

export interface ZoomCut {
  enabled: boolean;
  intensity: ZoomIntensityId;
  direction: 'in' | 'out';
}

export interface CameraShake {
  enabled: boolean;
  /** 0..100. */
  intensity: number;
  frequency: 'subtle' | 'medium' | 'intense';
  /** Fixed per clip so the shake is reproducible in the export. */
  seed: number;
}

export interface ClipMotion {
  ramp: SpeedRamp;
  zoomCut: ZoomCut;
  shake: CameraShake;
}

export function defaultMotion(): ClipMotion {
  return {
    ramp: { enabled: false, curve: 'punch', intensity: 0.5, startSpeed: 1.6, midSpeed: 0.5, endSpeed: 1.6 },
    zoomCut: { enabled: false, intensity: 'medium', direction: 'in' },
    shake: { enabled: false, intensity: 35, frequency: 'medium', seed: 1 },
  };
}

/** Motion for a clip that predates the motion system (autosaved docs). */
export function clipMotion(c: { motion?: ClipMotion } | null | undefined): ClipMotion {
  const m = c && c.motion;
  if (!m) return defaultMotion();
  const base = defaultMotion();
  return {
    ramp: { ...base.ramp, ...(m.ramp || {}) },
    zoomCut: { ...base.zoomCut, ...(m.zoomCut || {}) },
    shake: { ...base.shake, ...(m.shake || {}) },
  };
}

export function motionActive(m: ClipMotion): boolean {
  return Boolean(m.ramp.enabled || m.zoomCut.enabled || (m.shake.enabled && m.shake.intensity > 0));
}

export type SubjectMood = 'energetic' | 'calm' | 'dramatic' | 'playful';

export interface SubjectProfile {
  subjectType: string;
  dominantColor: string;
  backgroundDescription: string;
  mood: SubjectMood;
  frameUrls: string[];
  detectedAt: string;
}

/**
 * One animation key on a clip. `t` is seconds from the clip's own head, so a
 * trim or a reorder moves the whole animation with the shot instead of
 * stranding it at an absolute timeline second.
 */
export interface ClipKeyframe {
  t: number;
  opacity: number;   // 0..1
  scale: number;     // 1 is untouched
  x: number;         // -0.5..0.5 of the frame width
  y: number;         // -0.5..0.5 of the frame height
}

export interface StudioClip {
  id: string;
  label: string;
  url: string;             // durable https URL — what the render reads
  previewUrl: string;      // blob: or https URL — what the player reads
  sourceDuration: number;
  in: number;              // source seconds
  out: number;             // source seconds
  opacity: number;         // 0..1
  muted: boolean;
  adjust: Adjust;
  crop: CropRect;
  cropAspect: AspectId | 'free';
  cropLocked: boolean;
  kind: 'raw' | 'cut' | 'broll';
  effects: VisualEffectId[];
  transitionIn: { id: TransitionId; duration: number } | null;
  motion: ClipMotion;
  /** Opacity / scale / position keys, sorted by `t`. Empty means no animation. */
  keyframes: ClipKeyframe[];
  /** Gemini Flash result from the 25% / 75% source frames. */
  subject: SubjectProfile | null;
}

/** The interpolated animation state of a clip at `localT` seconds into it. */
export function keyframeAt(keys: ClipKeyframe[] | undefined, localT: number): ClipKeyframe | null {
  const list = (keys || []).slice().sort((a, b) => a.t - b.t);
  if (list.length === 0) return null;
  if (list.length === 1 || localT <= list[0].t) return list[0];
  if (localT >= list[list.length - 1].t) return list[list.length - 1];
  for (let i = 1; i < list.length; i += 1) {
    if (localT <= list[i].t) {
      const a = list[i - 1];
      const b = list[i];
      const p = clamp01((localT - a.t) / Math.max(0.0001, b.t - a.t));
      const mix = (x: number, y: number) => x + (y - x) * p;
      return {
        t: localT,
        opacity: mix(a.opacity, b.opacity),
        scale: mix(a.scale, b.scale),
        x: mix(a.x, b.x),
        y: mix(a.y, b.y),
      };
    }
  }
  return list[list.length - 1];
}

export function newClip(patch: Partial<StudioClip> & { previewUrl: string; sourceDuration: number }): StudioClip {
  return {
    id: newId('clip'),
    label: 'Clip',
    url: '',
    opacity: 1,
    muted: false,
    in: 0,
    out: patch.sourceDuration,
    adjust: { ...NEUTRAL_ADJUST },
    crop: { ...FULL_CROP },
    cropAspect: 'free',
    cropLocked: true,
    kind: 'raw',
    effects: [],
    transitionIn: null,
    motion: defaultMotion(),
    keyframes: [],
    subject: null,
    ...patch,
  };
}

export function clipLength(c: StudioClip): number {
  return Math.max(0.05, (c.out - c.in) / Math.max(0.25, c.adjust.speed));
}

export function timelineDuration(clips: StudioClip[]): number {
  return clips.reduce((n, c) => n + clipLength(c), 0);
}

export function clipStart(clips: StudioClip[], index: number): number {
  let cursor = 0;
  for (let i = 0; i < index; i += 1) cursor += clipLength(clips[i]);
  return cursor;
}

/** Timeline second → which clip, and where inside its source. */
export function locate(clips: StudioClip[], t: number): { index: number; sourceT: number; start: number } | null {
  let cursor = 0;
  for (let i = 0; i < clips.length; i += 1) {
    const len = clipLength(clips[i]);
    if (t < cursor + len || i === clips.length - 1) {
      const within = clampN(t - cursor, 0, len);
      return { index: i, sourceT: clips[i].in + within * clips[i].adjust.speed, start: cursor };
    }
    cursor += len;
  }
  return null;
}

/** Source second of `previewUrl` → timeline second, or null when it was cut away. */
export function sourceToTimeline(clips: StudioClip[], previewUrl: string, srcT: number): number | null {
  let cursor = 0;
  for (const c of clips) {
    const len = clipLength(c);
    if (c.previewUrl === previewUrl && srcT >= c.in - 0.05 && srcT <= c.out + 0.05) {
      const within = clampN(Math.min(c.out, srcT) - c.in, 0, c.out - c.in) / Math.max(0.25, c.adjust.speed);
      return cursor + Math.min(within, len);
    }
    cursor += len;
  }
  return null;
}

export function splitClipAt(clips: StudioClip[], id: string, sourceT: number): StudioClip[] {
  const i = clips.findIndex((c) => c.id === id);
  if (i < 0) return clips;
  const c = clips[i];
  if (sourceT - c.in < 0.15 || c.out - sourceT < 0.15) return clips;
  const a: StudioClip = { ...c, id: newId('clip'), out: sourceT, kind: 'cut', effects: [...c.effects] };
  const b: StudioClip = { ...c, id: newId('clip'), in: sourceT, kind: 'cut', effects: [...c.effects], transitionIn: null };
  return [...clips.slice(0, i), a, b, ...clips.slice(i + 1)];
}

/** Replace one clip with the subclips that cover only the kept source ranges. */
export function keepRanges(clips: StudioClip[], id: string, keeps: { start: number; end: number }[]): StudioClip[] {
  const i = clips.findIndex((c) => c.id === id);
  if (i < 0) return clips;
  const c = clips[i];
  const subs: StudioClip[] = [];
  keeps.forEach((r) => {
    const s = Math.max(c.in, r.start);
    const e = Math.min(c.out, r.end);
    if (e - s >= 0.2) subs.push({ ...c, id: newId('clip'), in: s, out: e, kind: 'cut', effects: [...c.effects], transitionIn: null });
  });
  if (!subs.length) return clips;
  if (c.transitionIn) subs[0] = { ...subs[0], transitionIn: c.transitionIn };
  return [...clips.slice(0, i), ...subs, ...clips.slice(i + 1)];
}

/**
 * Cut a set of SOURCE ranges out of every clip that plays `previewUrl` — the
 * primitive behind transcript editing, filler removal and silence removal.
 * Ranges are merged first so overlapping deletions cannot shred the timeline.
 */
export function cutSourceRanges(clips: StudioClip[], previewUrl: string, ranges: { start: number; end: number }[]): StudioClip[] {
  const merged = mergeRanges(ranges);
  if (!merged.length) return clips;
  const out: StudioClip[] = [];
  let changed = false;
  clips.forEach((c) => {
    if (c.previewUrl !== previewUrl) { out.push(c); return; }
    const keeps: { start: number; end: number }[] = [];
    let cursor = c.in;
    merged.forEach((r) => {
      if (r.end <= c.in || r.start >= c.out) return;
      if (r.start - cursor > 0.08) keeps.push({ start: cursor, end: r.start });
      cursor = Math.max(cursor, r.end);
    });
    if (c.out - cursor > 0.08) keeps.push({ start: cursor, end: c.out });
    if (keeps.length === 1 && Math.abs(keeps[0].start - c.in) < 0.01 && Math.abs(keeps[0].end - c.out) < 0.01) {
      out.push(c);
      return;
    }
    changed = true;
    keeps.forEach((k, idx) => {
      out.push({
        ...c,
        id: newId('clip'),
        in: k.start,
        out: k.end,
        kind: 'cut',
        effects: [...c.effects],
        transitionIn: idx === 0 ? c.transitionIn : null,
      });
    });
  });
  return changed ? out : clips;
}

/**
 * Put a cut source range back. Transcript editing has to be reversible, and a
 * rebuild-from-scratch would throw away the creator's splits, reorders and
 * inserted b-roll — so a restore is done incrementally: extend the clip that
 * ends where the range begins, or the one that begins where it ends, or insert
 * a new clip between the two that bracket it.
 */
export function restoreSourceRanges(
  clips: StudioClip[],
  previewUrl: string,
  ranges: { start: number; end: number }[],
): StudioClip[] {
  const template = clips.find((c) => c.previewUrl === previewUrl);
  if (!template) return clips;
  let next = clips.slice();

  mergeRanges(ranges).forEach((range) => {
    const touchesEnd = next.findIndex((c) => c.previewUrl === previewUrl && Math.abs(c.out - range.start) < 0.12);
    if (touchesEnd >= 0) {
      next = next.map((c, i) => (i === touchesEnd ? { ...c, out: Math.max(c.out, range.end) } : c));
      return;
    }
    const touchesStart = next.findIndex((c) => c.previewUrl === previewUrl && Math.abs(c.in - range.end) < 0.12);
    if (touchesStart >= 0) {
      next = next.map((c, i) => (i === touchesStart ? { ...c, in: Math.min(c.in, range.start) } : c));
      return;
    }
    // Nothing adjacent — slot a fresh clip in front of the first source clip
    // that starts after the restored range.
    const before = next.findIndex((c) => c.previewUrl === previewUrl && c.in >= range.end - 0.12);
    const fresh: StudioClip = {
      ...template,
      id: newId('clip'),
      in: range.start,
      out: range.end,
      kind: 'cut',
      effects: [...template.effects],
      transitionIn: null,
    };
    if (before < 0) next = [...next, fresh];
    else next = [...next.slice(0, before), fresh, ...next.slice(before)];
  });

  return mergeAdjacent(next, previewUrl);
}

/** Fuse neighbouring clips of the same source whose trims are contiguous. */
export function mergeAdjacent(clips: StudioClip[], previewUrl: string): StudioClip[] {
  const out: StudioClip[] = [];
  clips.forEach((c) => {
    const prev = out[out.length - 1];
    const fusable = prev
      && prev.previewUrl === previewUrl
      && c.previewUrl === previewUrl
      && Math.abs(prev.out - c.in) < 0.12
      && prev.adjust.speed === c.adjust.speed
      && prev.adjust.reverse === c.adjust.reverse
      && !c.transitionIn;
    if (fusable) out[out.length - 1] = { ...prev, out: c.out };
    else out.push(c);
  });
  return out;
}

export function mergeRanges(ranges: { start: number; end: number }[]): { start: number; end: number }[] {
  const sorted = ranges
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end - r.start > 0.02)
    .sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  sorted.forEach((r) => {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end + 0.02) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  });
  return merged;
}

// ---------------------------------------------------------------------------
// Transcript — every word is time-linked and individually removable
// ---------------------------------------------------------------------------

export interface WordToken {
  id: string;
  text: string;
  start: number;   // SOURCE seconds of the transcript's source clip
  end: number;
  filler: boolean;
  removed: boolean;
}

/** The filler vocabulary the brief names, plus the stutters that read the same. */
export const FILLER_PATTERNS: { label: string; re: RegExp }[] = [
  { label: 'um', re: /^(um+|umm+)$/i },
  { label: 'uh', re: /^(uh+|uhh+|er+|erm+)$/i },
  { label: 'like', re: /^like$/i },
  { label: 'you know', re: /^you$/i },        // phrase-matched below
  { label: 'basically', re: /^basically$/i },
  { label: 'actually', re: /^actually$/i },
  { label: 'literally', re: /^literally$/i },
  { label: 'sort of', re: /^sort$/i },        // phrase-matched below
  { label: 'i mean', re: /^i$/i },            // phrase-matched below
];

const PHRASE_FILLERS: string[][] = [['you', 'know'], ['sort', 'of'], ['kind', 'of'], ['i', 'mean']];

function bareWord(s: string): string {
  return s.replace(/[^\p{L}\p{N}']/gu, '').toLowerCase();
}

/**
 * Flag filler words and filler phrases. "like" is only a filler when it is not
 * doing grammatical work ("looks like this", "I like it"), so it has to be
 * judged from its neighbours rather than matched on its own.
 */
export function markFillers(words: WordToken[]): WordToken[] {
  const bare = words.map((w) => bareWord(w.text));
  const flagged = new Array(words.length).fill(false);

  PHRASE_FILLERS.forEach((phrase) => {
    for (let i = 0; i + phrase.length <= bare.length; i += 1) {
      let hit = true;
      for (let j = 0; j < phrase.length; j += 1) if (bare[i + j] !== phrase[j]) { hit = false; break; }
      if (hit) for (let j = 0; j < phrase.length; j += 1) flagged[i + j] = true;
    }
  });

  const SOLO = /^(um+|umm+|uh+|uhh+|er+|erm+|hmm+|basically|actually|literally)$/;
  const LIKE_SAFE_BEFORE = new Set(['looks', 'look', 'feels', 'feel', 'sounds', 'sound', 'seems', 'seem', 'just', 'something', 'anything', 'nothing', 'i', 'we', 'you', 'they', 'he', 'she', 'dont', 'didnt', 'would', 'll']);

  return words.map((w, i) => {
    let filler = flagged[i];
    const b = bare[i];
    if (!filler && SOLO.test(b)) filler = true;
    if (!filler && b === 'like') {
      const prev = bare[i - 1] || '';
      const gapBefore = i > 0 ? w.start - words[i - 1].end : 0;
      // A standalone "like" surrounded by a hesitation beat, or one that is not
      // following a verb/pronoun that needs it, is the verbal tic.
      filler = !LIKE_SAFE_BEFORE.has(prev) || gapBefore > 0.22;
    }
    return { ...w, filler };
  });
}

/** Source ranges for the words a transcript edit removed, padded to cut cleanly. */
export function removedWordRanges(words: WordToken[], padS = 0.04): { start: number; end: number }[] {
  return mergeRanges(words.filter((w) => w.removed).map((w) => ({ start: Math.max(0, w.start - padS), end: w.end + padS })));
}

// ---------------------------------------------------------------------------
// Captions
// ---------------------------------------------------------------------------

export interface CaptionWord { text: string; start: number; end: number }

export interface CaptionCue {
  id: string;
  text: string;
  start: number;   // TIMELINE seconds
  end: number;
  words: CaptionWord[];
}

export const CAPTION_MAX_WORDS_DEFAULT = 6;

/**
 * Group word tokens into readable cues. Lines break on a natural phrase edge
 * first — a long pause or clause-ending punctuation — and only fall back to
 * the word/second ceiling when the speaker never gives one.
 */
export function groupWordsIntoCues(
  words: { text: string; start: number; end: number }[],
  maxWords = CAPTION_MAX_WORDS_DEFAULT,
): { text: string; start: number; end: number; words: CaptionWord[] }[] {
  const cap = Math.max(2, Math.min(12, Math.round(maxWords) || CAPTION_MAX_WORDS_DEFAULT));
  const groups: { text: string; start: number; end: number }[][] = [];
  let cur: { text: string; start: number; end: number }[] = [];
  const flush = () => { if (cur.length) { groups.push(cur); cur = []; } };
  words.forEach((w) => {
    const prev = cur[cur.length - 1];
    if (prev && w.start - prev.end > 0.55) flush();
    cur.push(w);
    const span = cur[cur.length - 1].end - cur[0].start;
    const endsClause = /[.!?,;:]$/.test(w.text);
    if (cur.length >= cap || span >= 2.8 || (endsClause && cur.length >= 2)) flush();
  });
  flush();
  return groups.map((g) => ({
    text: g.map((w) => w.text).join(' '),
    start: g[0].start,
    end: Math.max(g[g.length - 1].end + 0.06, g[0].start + 0.35),
    words: g.map((w) => ({ text: w.text, start: w.start, end: w.end })),
  }));
}

/**
 * Rebuild the caption track from the surviving transcript words, mapped onto
 * the CURRENT timeline. Words whose moment was cut away simply drop out, so
 * captions can never describe footage that is no longer there.
 */
export function captionsFromWords(
  clips: StudioClip[],
  previewUrl: string,
  words: WordToken[],
  maxWords = CAPTION_MAX_WORDS_DEFAULT,
): CaptionCue[] {
  const timed: { text: string; start: number; end: number }[] = [];
  words.filter((w) => !w.removed).forEach((w) => {
    const start = sourceToTimeline(clips, previewUrl, w.start);
    if (start == null) return;
    const end = sourceToTimeline(clips, previewUrl, w.end);
    timed.push({
      text: w.text,
      start,
      end: end == null ? start + Math.max(0.08, w.end - w.start) : Math.max(start + 0.08, end),
    });
  });
  if (!timed.length) return [];
  return groupWordsIntoCues(timed, maxWords).map((g) => ({ id: newId('cue'), ...g }));
}

export type CaptionStyleId = 'minimal' | 'bold' | 'gradient' | 'karaoke' | 'tiktok' | 'neon' | 'cinematic' | 'handwritten' | 'creator' | 'newsroom' | 'comic' | 'luxury' | 'gaming' | 'desi';
export type CaptionPosition = 'top' | 'center' | 'bottom';
/** How a caption line arrives: a soft fade, an overshoot pop, or word-by-word. */
export type CaptionAnimationId = 'preset' | 'fade' | 'dissolve' | 'pop' | 'bounce' | 'karaoke';
/** The plate drawn behind the line. */
export type CaptionBackgroundId = 'preset' | 'none' | 'pill' | 'bar';

export const CAPTION_ANIMATIONS: { id: CaptionAnimationId; label: string; hint: string }[] = [
  { id: 'preset', label: 'Preset default', hint: 'Whatever the chosen style does out of the box' },
  { id: 'fade', label: 'Fade in', hint: 'The whole line eases up into place' },
  { id: 'dissolve', label: 'Dissolve', hint: 'A slower, cinematic opacity dissolve' },
  { id: 'pop', label: 'Pop', hint: 'Each word overshoots in as it is spoken' },
  { id: 'bounce', label: 'Bounce', hint: 'Each word lands with a springy bounce' },
  { id: 'karaoke', label: 'Karaoke', hint: 'The current word lights up while the rest stay dim' },
];

export const CAPTION_BACKGROUNDS: { id: CaptionBackgroundId; label: string }[] = [
  { id: 'preset', label: 'Preset default' },
  { id: 'none', label: 'None' },
  { id: 'pill', label: 'Solid pill' },
  { id: 'bar', label: 'Translucent bar' },
];

export interface CaptionSettings {
  styleId: CaptionStyleId;
  fontId: string;
  sizeScale: number;       // 0.6..1.8 multiplier on the preset size
  color: string;
  /** Optional spoken-word color for karaoke/highlight presets. */
  activeColor: string;
  outlineColor: string;
  outlineWidth: number;    // 0..6 px at 1080p
  shadowBlur: number;      // 0..40
  position: CaptionPosition;
  offsetY: number;         // -0.3..0.3 of stage height, draggable override
  uppercase: boolean;
  italic: boolean;
  burnIn: boolean;
  /** Overrides the preset's own reveal behaviour when it is not 'preset'. */
  animation: CaptionAnimationId;
  background: CaptionBackgroundId;
  backgroundColor: string;
  backgroundOpacity: number;   // 0..1
  /** Words per caption line when the track is rebuilt from the transcript. */
  maxWords: number;
}

export const CAPTION_FONTS: { id: string; label: string; css: string }[] = [
  { id: 'inter', label: 'Inter', css: "'Inter', system-ui, sans-serif" },
  { id: 'anton', label: 'Anton · Display', css: "'Anton', Impact, sans-serif" },
  { id: 'bebas', label: 'Bebas Neue', css: "'Bebas Neue', Impact, sans-serif" },
  { id: 'montserrat', label: 'Montserrat', css: "'Montserrat', 'Inter', sans-serif" },
  { id: 'roboto', label: 'Roboto', css: "'Roboto', 'Inter', sans-serif" },
  { id: 'impact', label: 'Impact', css: "Impact, 'Anton', sans-serif" },
  { id: 'oswald', label: 'Oswald · Condensed', css: "'Oswald', 'Inter', sans-serif" },
  { id: 'playfair', label: 'Playfair · Serif', css: "'Playfair Display', Georgia, serif" },
  { id: 'caveat', label: 'Caveat · Handwritten', css: "'Caveat', 'Segoe Script', cursive" },
  { id: 'mono', label: 'JetBrains Mono', css: "'JetBrains Mono', ui-monospace, monospace" },
  { id: 'notoDevanagari', label: 'Noto Sans Devanagari · Hindi', css: "'Noto Sans Devanagari', 'Nirmala UI', Mangal, sans-serif" },
];

export const STUDIO_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&family=Roboto:wght@400;700;900&family=Anton&family=Bebas+Neue&family=Montserrat:wght@500;700;800;900&family=Oswald:wght@400;600;700&family=Playfair+Display:ital,wght@0,500;0,700;1,500;1,700&family=Caveat:wght@500;700&family=JetBrains+Mono:wght@500;700&family=Noto+Sans+Devanagari:wght@500;600;700;800;900&display=swap';

export function fontCss(id: string): string {
  return (CAPTION_FONTS.find((f) => f.id === id) || CAPTION_FONTS[0]).css;
}

export function defaultCaptionSettings(): CaptionSettings {
  return {
    styleId: 'tiktok', fontId: 'anton', sizeScale: 1, color: '#ffffff', activeColor: '#ffe14d',
    outlineColor: '#000000', outlineWidth: 3, shadowBlur: 18,
    position: 'bottom', offsetY: 0, uppercase: true, italic: false, burnIn: true,
    animation: 'preset', background: 'preset',
    backgroundColor: '#000000', backgroundOpacity: 0.55,
    maxWords: CAPTION_MAX_WORDS_DEFAULT,
  };
}

/** Fill in fields an older autosaved doc never had. */
export function withCaptionDefaults(s: Partial<CaptionSettings> | null | undefined): CaptionSettings {
  return { ...defaultCaptionSettings(), ...(s || {}) };
}

/** Timeline cues → SRT text (download or hand to an editor). */
export function buildSrt(cues: CaptionCue[]): string {
  const stamp = (s: number) => {
    const ms = Math.max(0, Math.round(s * 1000));
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const sec = Math.floor((ms % 60000) / 1000);
    const milli = ms % 1000;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(milli).padStart(3, '0')}`;
  };
  return cues
    .slice()
    .sort((a, b) => a.start - b.start)
    .map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(Math.max(c.end, c.start + 0.3))}\n${c.text.trim()}\n`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Animated text layers
// ---------------------------------------------------------------------------

export type EntranceAnim = 'none' | 'typewriter' | 'fadeIn' | 'slideUp' | 'slideDown' | 'slideLeft' | 'slideRight' | 'scalePop' | 'glitch';
export type ExitAnim = 'none' | 'fadeOut' | 'slideOut' | 'scaleDown';

export const ENTRANCE_ANIMS: { id: EntranceAnim; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'typewriter', label: 'Typewriter' },
  { id: 'fadeIn', label: 'Fade In' },
  { id: 'slideUp', label: 'Slide Up' },
  { id: 'slideDown', label: 'Slide Down' },
  { id: 'slideLeft', label: 'Slide Left' },
  { id: 'slideRight', label: 'Slide Right' },
  { id: 'scalePop', label: 'Scale Pop' },
  { id: 'glitch', label: 'Glitch' },
];

export const EXIT_ANIMS: { id: ExitAnim; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'fadeOut', label: 'Fade Out' },
  { id: 'slideOut', label: 'Slide Out' },
  { id: 'scaleDown', label: 'Scale Down' },
];

/** Deep glow + pulsing rays, the treatment the VFX tab applies to text. */
export interface GlowState {
  enabled: boolean;
  intensity: number;   // 0..100
  color: string;
  rays: boolean;
}

export function defaultGlow(): GlowState {
  return { enabled: false, intensity: 55, color: '#f59e0b', rays: false };
}

export interface TextLayer {
  id: string;
  text: string;
  start: number;     // timeline seconds
  end: number;
  x: number;         // 0..1 of stage width (centre of the block)
  y: number;         // 0..1 of stage height
  fontId: string;
  size: number;      // px at a 1080-tall stage
  weight: number;
  color: string;
  outlineColor: string;
  outlineWidth: number;
  shadowColor: string;
  shadowBlur: number;
  entrance: EntranceAnim;
  exit: ExitAnim;
  animDuration: number;
  align: 'left' | 'center' | 'right';
  /** Depth compositing: draw this layer behind the keyed subject. */
  behindSubject: boolean;
  glow: GlowState;
}

export function newTextLayer(at: number, duration = 3): TextLayer {
  return {
    id: newId('txt'), text: 'Your headline', start: Math.max(0, Math.round(at * 10) / 10), end: Math.max(0.6, at + duration),
    x: 0.5, y: 0.26, fontId: 'anton', size: 92, weight: 900, color: '#ffffff',
    outlineColor: '#000000', outlineWidth: 0, shadowColor: 'rgba(0,0,0,0.85)', shadowBlur: 24,
    entrance: 'scalePop', exit: 'fadeOut', animDuration: 0.5, align: 'center',
    behindSubject: false, glow: defaultGlow(),
  };
}

/** A text layer from an autosaved doc that predates glow / depth compositing. */
export function withTextDefaults(l: TextLayer): TextLayer {
  return { ...l, behindSubject: l.behindSubject === true, glow: { ...defaultGlow(), ...(l.glow || {}) } };
}

// ---------------------------------------------------------------------------
// Overlays — logo / image layers with masking, blending and auto-tracking
// ---------------------------------------------------------------------------

export type BlendMode = 'normal' | 'screen' | 'multiply' | 'overlay' | 'soft-light';

export const BLEND_MODES: { id: BlendMode; label: string }[] = [
  { id: 'normal', label: 'Normal' },
  { id: 'screen', label: 'Screen' },
  { id: 'multiply', label: 'Multiply' },
  { id: 'overlay', label: 'Overlay' },
  { id: 'soft-light', label: 'Soft Light' },
];

export type MaskShape = 'none' | 'rect' | 'ellipse' | 'poly';

export interface OverlayMask {
  shape: MaskShape;
  /** Normalised points, relative to the overlay's own box. rect/ellipse read
   * points[0] (top-left) and points[1] (bottom-right); poly reads them all. */
  points: { x: number; y: number }[];
  feather: number;   // 0..40 (% of the overlay's short edge)
  invert: boolean;
}

export function defaultMask(): OverlayMask {
  return { shape: 'none', points: [{ x: 0.12, y: 0.12 }, { x: 0.88, y: 0.88 }], feather: 8, invert: false };
}

/** A tracked path the overlay follows — produced by studioVision. */
export interface TrackPath {
  enabled: boolean;
  /** Keyframes in timeline seconds; x/y are the subject centre, 0..1. */
  keys: { t: number; x: number; y: number }[];
  confidence: number;   // 0..1, averaged match quality
  status: 'idle' | 'tracking' | 'ready' | 'failed';
  note: string;
}

export function emptyTrack(): TrackPath {
  return { enabled: false, keys: [], confidence: 0, status: 'idle', note: '' };
}

export interface Overlay {
  id: string;
  label: string;
  url: string;
  x: number;        // 0..1 centre
  y: number;
  w: number;        // 0..1 of stage width
  /** The image's natural width / height, measured on add. The server render
   * cannot inspect the file, so the box height is derived from this. */
  aspect: number;
  opacity: number;
  rotation: number;
  blend: BlendMode;
  alwaysOn: boolean;
  start: number;    // timeline seconds (used when alwaysOn is false)
  end: number;
  mask: OverlayMask;
  track: TrackPath;
}

export function newOverlay(url: string, label: string, duration: number): Overlay {
  return {
    id: newId('ovl'), label, url, x: 0.84, y: 0.14, w: 0.16, aspect: 1, opacity: 1, rotation: 0,
    blend: 'normal', alwaysOn: true, start: 0, end: Math.max(2, duration),
    mask: defaultMask(), track: emptyTrack(),
  };
}

/** Interpolate a tracked path at a timeline second. */
export function trackAt(track: TrackPath, t: number): { x: number; y: number } | null {
  if (!track.enabled || track.keys.length === 0) return null;
  const keys = track.keys;
  if (t <= keys[0].t) return { x: keys[0].x, y: keys[0].y };
  if (t >= keys[keys.length - 1].t) return { x: keys[keys.length - 1].x, y: keys[keys.length - 1].y };
  for (let i = 1; i < keys.length; i += 1) {
    if (t <= keys[i].t) {
      const a = keys[i - 1];
      const b = keys[i];
      const p = (t - a.t) / Math.max(0.0001, b.t - a.t);
      return { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// B-roll video overlays — a second picture composited over the main footage
// ---------------------------------------------------------------------------

export type OverlayPosition = 'full' | 'pipTopRight' | 'pipBottomLeft' | 'pipTopLeft' | 'pipBottomRight';

export interface VideoOverlay {
  id: string;
  label: string;
  /** Durable https URL — what the render reads. */
  url: string;
  /** blob: or https URL — what the preview plays. */
  previewUrl: string;
  sourceDuration: number;
  /** In / out point INSIDE the b-roll file, in source seconds. */
  sourceIn: number;
  sourceOut: number;
  /** When it appears on the main timeline, in timeline seconds. */
  start: number;
  end: number;
  position: OverlayPosition;
  /** PiP box width as a fraction of the stage (ignored when position is full). */
  scale: number;
  opacity: number;
  radius: number;      // px at a 1080-tall stage, PiP corner rounding
  muted: boolean;
  /** Duck the main track while this audible cutaway is on screen. */
  duckMain: boolean;
  /** Main-track gain while ducked, 0.1–0.5. */
  duckVolume: number;
  /** Web Audio fades, also passed to the server render. */
  audioFadeIn: number;
  audioFadeOut: number;
  /** Dip the cutaway to black as it ends — maps to the assembly `fade_out`. */
  fadeOut: boolean;
}

export function newVideoOverlay(patch: Partial<VideoOverlay> & { previewUrl: string; sourceDuration: number }): VideoOverlay {
  const dur = Math.max(0.4, patch.sourceDuration);
  return {
    id: newId('bro'),
    label: 'B-roll',
    url: '',
    sourceIn: 0,
    sourceOut: dur,
    start: 0,
    end: dur,
    position: 'full',
    scale: 0.34,
    opacity: 1,
    radius: 18,
    muted: false,
    duckMain: true,
    duckVolume: 0.2,
    audioFadeIn: 0.3,
    audioFadeOut: 0.5,
    fadeOut: false,
    ...patch,
  };
}

/** Seconds of the b-roll file to show at a timeline second (it loops if short). */
export function overlaySourceTime(o: VideoOverlay, timelineT: number): number {
  const span = Math.max(0.1, o.sourceOut - o.sourceIn);
  const local = Math.max(0, timelineT - o.start);
  return o.sourceIn + (local % span);
}

// ---------------------------------------------------------------------------
// Chroma key
// ---------------------------------------------------------------------------

export interface ChromaKeyState {
  enabled: boolean;
  /** The colour being removed. Green and blue screens are the usual two. */
  color: string;
  /** 0..1 — how much of the colour range counts as the key. */
  tolerance: number;
  /** 0..1 — how soft the matte edge is. */
  softness: number;
  /** 0..1 — how hard the key colour is pulled back out of the edges. */
  spill: number;
  background: 'color' | 'image';
  backgroundColor: string;
  backgroundUrl: string;
}

export function defaultChroma(): ChromaKeyState {
  return {
    enabled: false, color: '#00ff00', tolerance: 0.45, softness: 0.3, spill: 0.6,
    background: 'color', backgroundColor: '#101826', backgroundUrl: '',
  };
}

// ---------------------------------------------------------------------------
// Whole-video VFX stack
// ---------------------------------------------------------------------------

export type LeakPresetId = 'amberSweep' | 'crimsonFlare' | 'sunsetBand' | 'cyanPrism' | 'goldenBurst';

export interface LeakState {
  enabled: boolean;
  presetId: LeakPresetId;
  /** Where in the video the leak fires. */
  trigger: 'start' | 'mid' | 'end' | 'loop';
  blend: 'screen' | 'add';
  intensity: number;   // 0..100
}

export interface VhsState { enabled: boolean; intensity: number }
export interface GlitchState { enabled: boolean; intensity: number }

export type DisplacePresetId = 'heatWave' | 'underwater' | 'liquid';

export interface DisplaceState {
  enabled: boolean;
  presetId: DisplacePresetId;
  intensity: number;   // 0..100
}

export interface VfxState {
  leak: LeakState;
  vhs: VhsState;
  glitch: GlitchState;
  displace: DisplaceState;
  /** The glow treatment offered to every text layer from the VFX tab. */
  textGlow: GlowState;
}

export function defaultVfx(): VfxState {
  return {
    leak: { enabled: false, presetId: 'amberSweep', trigger: 'start', blend: 'screen', intensity: 70 },
    vhs: { enabled: false, intensity: 50 },
    glitch: { enabled: false, intensity: 50 },
    displace: { enabled: false, presetId: 'heatWave', intensity: 45 },
    textGlow: defaultGlow(),
  };
}

/** Fill in a VFX stack from an autosaved doc that predates it. */
export function withVfxDefaults(v: Partial<VfxState> | null | undefined): VfxState {
  const base = defaultVfx();
  if (!v) return base;
  return {
    leak: { ...base.leak, ...(v.leak || {}) },
    vhs: { ...base.vhs, ...(v.vhs || {}) },
    glitch: { ...base.glitch, ...(v.glitch || {}) },
    displace: { ...base.displace, ...(v.displace || {}) },
    textGlow: { ...base.textGlow, ...(v.textGlow || {}) },
  };
}

export function vfxActive(v: VfxState): boolean {
  return Boolean(v.leak.enabled || v.vhs.enabled || v.glitch.enabled || v.displace.enabled || v.textGlow.enabled);
}

// ---------------------------------------------------------------------------
// Auto-reframe
// ---------------------------------------------------------------------------

export interface ReframeState {
  mode: 'auto' | 'center' | 'manual';
  /** Subject keyframes in SOURCE seconds of the primary clip, x/y in 0..1. */
  focus: { t: number; x: number; y: number; confidence: number }[];
  manualX: number;
  manualY: number;
  status: 'idle' | 'detecting' | 'ready' | 'failed';
  note: string;
  detector: '' | 'face' | 'saliency';
}

export function defaultReframe(): ReframeState {
  return { mode: 'auto', focus: [], manualX: 0.5, manualY: 0.42, status: 'idle', note: '', detector: '' };
}

/** The focus point to centre on at a given source second. */
export function focusAt(r: ReframeState, srcT: number): { x: number; y: number } {
  if (r.mode === 'center') return { x: 0.5, y: 0.5 };
  if (r.mode === 'manual' || !r.focus.length) return { x: r.manualX, y: r.manualY };
  const f = r.focus;
  if (srcT <= f[0].t) return { x: f[0].x, y: f[0].y };
  if (srcT >= f[f.length - 1].t) return { x: f[f.length - 1].x, y: f[f.length - 1].y };
  for (let i = 1; i < f.length; i += 1) {
    if (srcT <= f[i].t) {
      const a = f[i - 1];
      const b = f[i];
      const p = (srcT - a.t) / Math.max(0.0001, b.t - a.t);
      return { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p };
    }
  }
  return { x: 0.5, y: 0.5 };
}

/**
 * `object-position` for a cover-cropped video so the focus point stays in
 * frame. CSS object-position already works in "percentage of the overflow",
 * which is exactly the remapping a reframe needs.
 */
export function focusObjectPosition(focus: { x: number; y: number }): string {
  return `${(clamp01(focus.x) * 100).toFixed(2)}% ${(clamp01(focus.y) * 100).toFixed(2)}%`;
}

// ---------------------------------------------------------------------------
// Visual effects, colour grades and transitions
// ---------------------------------------------------------------------------

export type VisualEffectId = 'lensFlare' | 'lightLeak' | 'vignette' | 'bloom' | 'flash' | 'filmGrain';

export const VISUAL_EFFECTS: { id: VisualEffectId; label: string; hint: string }[] = [
  { id: 'lensFlare', label: 'Lens Flare', hint: 'Anamorphic streak with a warm core' },
  { id: 'lightLeak', label: 'Light Leak', hint: 'Analogue amber leak drifting across the frame' },
  { id: 'vignette', label: 'Vignette', hint: 'Darkened corners that push the eye to the middle' },
  { id: 'bloom', label: 'Bloom', hint: 'Soft halation on the highlights' },
  { id: 'flash', label: 'Flash', hint: 'One-frame white flash at the clip head' },
  { id: 'filmGrain', label: 'Film Grain', hint: 'Fine 35 mm grain texture' },
];

export type GradeId = 'none' | 'cinematic' | 'warm' | 'cool' | 'bw' | 'vintage';

export const GRADES: { id: GradeId; label: string; css: string }[] = [
  { id: 'none', label: 'None', css: '' },
  { id: 'cinematic', label: 'Cinematic', css: 'contrast(1.12) saturate(1.22) hue-rotate(8deg)' },
  { id: 'warm', label: 'Warm', css: 'sepia(0.18) saturate(1.24) contrast(1.05) brightness(1.04)' },
  { id: 'cool', label: 'Cool', css: 'saturate(1.1) contrast(1.08) hue-rotate(-12deg) brightness(1.02)' },
  { id: 'bw', label: 'B&W', css: 'grayscale(1) contrast(1.16)' },
  { id: 'vintage', label: 'Vintage', css: 'sepia(0.3) saturate(0.86) contrast(0.95) brightness(1.06)' },
];

export function gradeCss(id: GradeId): string {
  return (GRADES.find((g) => g.id === id) || GRADES[0]).css;
}

/** The CSS filter string for a clip — adjustments, then the global grade. */
export function clipFilterCss(adjust: Adjust, grade: GradeId, effects: VisualEffectId[]): string {
  const f: string[] = [];
  const highlights = clampN(Number(adjust.highlights) || 0, -50, 50);
  const shadows = clampN(Number(adjust.shadows) || 0, -50, 50);
  const temperature = clampN(Number(adjust.temperature) || 0, -50, 50);
  const tint = clampN(Number(adjust.tint) || 0, -50, 50);
  if (adjust.brightness !== 100) f.push(`brightness(${(adjust.brightness / 100).toFixed(3)})`);
  if (adjust.contrast !== 100) f.push(`contrast(${(adjust.contrast / 100).toFixed(3)})`);
  if (adjust.saturation !== 100) f.push(`saturate(${(adjust.saturation / 100).toFixed(3)})`);
  if (highlights) {
    f.push(`brightness(${(1 + highlights / 500).toFixed(3)})`);
    f.push(`contrast(${(1 + highlights / 250).toFixed(3)})`);
  }
  if (shadows) {
    f.push(`brightness(${(1 + shadows / 250).toFixed(3)})`);
    f.push(`contrast(${(1 - shadows / 500).toFixed(3)})`);
  }
  const chromaMix = Math.min(0.35, (Math.abs(temperature) + Math.abs(tint)) * 0.0035);
  const hue = temperature * -0.24 + tint * 0.36;
  if (chromaMix > 0.0001) f.push(`sepia(${chromaMix.toFixed(3)})`);
  if (Math.abs(hue) > 0.001) f.push(`hue-rotate(${hue.toFixed(2)}deg)`);
  if (effects.includes('bloom')) f.push('brightness(1.06) saturate(1.1)');
  const g = gradeCss(grade);
  if (g) f.push(g);
  return f.length ? f.join(' ') : 'none';
}

export type TransitionId = 'crossfade' | 'whipPan' | 'flashCut' | 'dipToBlack' | 'glitchCut' | 'zoomPunch' | 'spin';

export const TRANSITIONS: { id: TransitionId; label: string; hint: string; defaultDuration: number }[] = [
  { id: 'crossfade', label: 'Crossfade', hint: 'Classic dissolve between the two shots', defaultDuration: 0.5 },
  { id: 'whipPan', label: 'Whip Pan', hint: 'Fast horizontal swish with motion blur', defaultDuration: 0.35 },
  { id: 'flashCut', label: 'Flash Cut', hint: 'White bloom on the cut', defaultDuration: 0.25 },
  { id: 'dipToBlack', label: 'Dip to Black', hint: 'Through black — a scene change', defaultDuration: 0.6 },
  { id: 'glitchCut', label: 'Glitch Cut', hint: 'RGB tear and offset slices', defaultDuration: 0.3 },
  { id: 'zoomPunch', label: 'Zoom Punch', hint: 'Scale slam into the next shot', defaultDuration: 0.35 },
  { id: 'spin', label: 'Spin', hint: 'Rotational blur-through', defaultDuration: 0.5 },
];

// ---------------------------------------------------------------------------
// B-roll slots — detected holes in the edit
// ---------------------------------------------------------------------------

export interface BrollSlot {
  id: string;
  start: number;        // timeline seconds
  end: number;
  cause: 'silence' | 'pause' | 'lowAction';
  reason: string;
  prompt: string;
  status: 'open' | 'generating' | 'filled' | 'failed';
  clipUrl: string;
  error: string;
}

// ---------------------------------------------------------------------------
// The agentic cut plan — reviewable edit cards
// ---------------------------------------------------------------------------

export type CardType = 'trim' | 'filler' | 'silence' | 'caption' | 'effect' | 'broll' | 'reframe' | 'text' | 'transition';

export const CARD_META: Record<CardType, { label: string; color: string; track: TrackId }> = {
  trim: { label: 'Trim', color: TRACK_COLORS.cut, track: 'cut' },
  filler: { label: 'Remove filler', color: TRACK_COLORS.cut, track: 'cut' },
  silence: { label: 'Cut silence', color: TRACK_COLORS.cut, track: 'cut' },
  caption: { label: 'Captions', color: TRACK_COLORS.caption, track: 'caption' },
  effect: { label: 'Effect', color: TRACK_COLORS.fx, track: 'fx' },
  broll: { label: 'B-roll', color: TRACK_COLORS.broll, track: 'broll' },
  reframe: { label: 'Reframe', color: TRACK_COLORS.fx, track: 'fx' },
  text: { label: 'Text', color: TRACK_COLORS.overlay, track: 'overlay' },
  transition: { label: 'Transition', color: TRACK_COLORS.fx, track: 'fx' },
};

export interface EditCard {
  id: string;
  type: CardType;
  /** SOURCE seconds of the transcript clip — mapped onto the timeline on apply. */
  start: number;
  end: number;
  title: string;
  reason: string;
  /** Predicted watch-time retention across this segment, 0..100. */
  retention: number;
  thumbnail: string;   // data: URL, stripped before autosave
  status: 'pending' | 'accepted' | 'rejected' | 'applied' | 'failed';
  note: string;
  /** Type-specific instructions the apply step reads. */
  payload: Record<string, unknown>;
}

/**
 * Retention estimate for a segment, used when the model declines to score one.
 * Short, dense, speech-forward segments hold attention; dead air and long
 * monotone stretches lose it. Deliberately simple and explainable — it is
 * shown to the creator as a percentage they can sanity-check.
 */
export function estimateRetention(opts: {
  durationS: number;
  wordsPerSecond: number;
  silenceShare: number;   // 0..1 of the segment that is dead air
  motionScore: number;    // 0..1 visual change
  positionShare: number;  // 0..1 how far into the video the segment sits
}): number {
  const pace = clamp01(opts.wordsPerSecond / 3.2);              // ~3 w/s is lively
  const brevity = clamp01(1 - (opts.durationS - 3) / 24);       // long holds drift
  const quiet = 1 - clamp01(opts.silenceShare * 1.6);
  const motion = clamp01(opts.motionScore);
  const decay = 1 - clamp01(opts.positionShare) * 0.28;         // natural drop-off
  const score = (0.34 * pace + 0.2 * brevity + 0.26 * quiet + 0.2 * motion) * decay;
  return Math.round(clampN(28 + score * 68, 5, 99));
}

export function retentionColor(pct: number): string {
  if (pct >= 70) return '#166534';
  if (pct >= 45) return '#B45309';
  return '#991B1B';
}

// ---------------------------------------------------------------------------
// The document — one serialisable object describing the whole edit
// ---------------------------------------------------------------------------

export type MusicStyleId = 'auto' | 'uptempo' | 'ambient' | 'cinematic' | 'playful' | 'none';

export interface EditDoc {
  clips: StudioClip[];
  words: WordToken[];
  transcriptSource: string;   // previewUrl the word times belong to
  transcript: string;
  captions: CaptionCue[];
  captionSettings: CaptionSettings;
  /** ISO 639-1 detected from the transcription, or 'auto' when undetermined. */
  captionLanguage: string;
  textLayers: TextLayer[];
  overlays: Overlay[];
  /** B-roll video layers composited over the main footage. */
  videoOverlays: VideoOverlay[];
  brollSlots: BrollSlot[];
  cards: EditCard[];
  grade: GradeId;
  globalEffects: VisualEffectId[];
  vfx: VfxState;
  chroma: ChromaKeyState;
  aspect: AspectId;
  resolution: ResolutionId;
  reframe: ReframeState;
  musicBedId: string;
  musicUrl: string;
  musicVolume: number;
  musicStyle: MusicStyleId;
  musicPrompt: string;
  musicVariation: number;
  title: string;
}

export function emptyDoc(): EditDoc {
  return {
    clips: [], words: [], transcriptSource: '', transcript: '',
    captions: [], captionSettings: defaultCaptionSettings(), captionLanguage: 'auto',
    textLayers: [], overlays: [], videoOverlays: [], brollSlots: [], cards: [],
    grade: 'none', globalEffects: [], vfx: defaultVfx(), chroma: defaultChroma(),
    aspect: '16:9', resolution: '1080p',

    reframe: defaultReframe(), musicBedId: 'none', musicUrl: '', musicVolume: 0.28,
    musicStyle: 'auto', musicPrompt: '', musicVariation: 1,
    title: 'Untitled edit',
  };
}

/**
 * Normalise a doc that came back from autosave. Rows written before the
 * effects system shipped have no `vfx`, `chroma`, `videoOverlays` or per-clip
 * `motion`, and the editor must not crash on them.
 */
export function hydrateDoc(doc: EditDoc): EditDoc {
  return {
    ...emptyDoc(),
    ...doc,
    clips: (doc.clips || []).map((c) => ({
      ...c,
      adjust: { ...NEUTRAL_ADJUST, ...(c.adjust || {}) },
      motion: clipMotion(c),
      keyframes: Array.isArray(c.keyframes) ? c.keyframes : [],
      subject: c.subject || null,
    })),
    captionSettings: withCaptionDefaults(doc.captionSettings),
    captionLanguage: doc.captionLanguage || 'auto',
    textLayers: (doc.textLayers || []).map(withTextDefaults),
    videoOverlays: (doc.videoOverlays || []).map((o) => ({
      ...o,
      muted: typeof o.muted === 'boolean' ? o.muted : false,
      duckMain: typeof o.duckMain === 'boolean' ? o.duckMain : true,
      duckVolume: Number.isFinite(o.duckVolume) ? o.duckVolume : 0.2,
      audioFadeIn: Number.isFinite(o.audioFadeIn) ? o.audioFadeIn : 0.3,
      audioFadeOut: Number.isFinite(o.audioFadeOut) ? o.audioFadeOut : 0.5,
    })),
    vfx: withVfxDefaults(doc.vfx),
    chroma: { ...defaultChroma(), ...(doc.chroma || {}) },
    musicStyle: doc.musicStyle || 'auto',
    musicPrompt: doc.musicPrompt || '',
    musicVariation: Number.isFinite(doc.musicVariation) ? doc.musicVariation : 1,
  };
}

/** Drop the heavy, regenerable fields before a doc goes into the database. */
export function serialiseDoc(doc: EditDoc): EditDoc {
  return {
    ...doc,
    clips: doc.clips.map((c) => ({ ...c, previewUrl: /^https:/.test(c.previewUrl) ? c.previewUrl : c.url })),
    videoOverlays: (doc.videoOverlays || []).map((o) => ({ ...o, previewUrl: /^https:/.test(o.previewUrl) ? o.previewUrl : o.url })),
    cards: doc.cards.map((c) => ({ ...c, thumbnail: '' })),
    words: doc.words.slice(0, 6000),
  };
}

export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
