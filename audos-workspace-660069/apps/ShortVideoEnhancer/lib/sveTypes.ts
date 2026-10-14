/**
 * Short Video Enhancer — Phase 2 edit document.
 *
 * ONE serialisable object describes the whole edit. Everything downstream is a
 * pure function of it: the live preview, the Remotion composition props, the
 * optimisation checklist and the autosaved row in `svenhancer_projects`. That
 * is what makes undo/redo a one-liner — history is just an array of these.
 *
 * Nothing here is baked into pixels. Removing a B-roll clip from `broll`
 * removes it from the exported file; there is no destructive step.
 */

export const SVE_WS_ID = 'f24710e5-7c6d-4db4-92b4-c2c235877575';

/** Native design canvas. The export is always a true 1080x1920 portrait. */
export const DESIGN_W = 1080;
export const DESIGN_H = 1920;
export const FPS = 30;

/** Caption text never crosses this fraction of the frame on either edge. */
export const CAPTION_SAFE_X = 0.08;

export type CaptionPreset = 'bold' | 'gradient' | 'outline' | 'boxed';

/**
 * Which script the caption text is written in.
 *
 * `hinglish` is romanized Hindi mixed with English — "Yaar, yeh video ekdum
 * fire hai!". It is Latin script throughout, so it needs no extra font. The
 * five-tier caption mix runs on either language; what the choice changes is
 * the filler vocabulary the key-word picker skips.
 */
export type CaptionLanguage = 'en' | 'hinglish';

/**
 * The five caption treatments every track mixes, whatever language it is in.
 *
 * `clean` is the baseline — a plain, static white subtitle — and the other
 * four are the deliberate exceptions to it. `lib/sveCaptionTiers.ts` owns
 * what each one looks like and how a track is split across them.
 */
export type CaptionTier = 'clean' | 'kinetic' | 'cinematic' | 'beat' | 'ui';

/**
 * How a track gets its tiers.
 *
 * `auto` runs the 70/20/10 mix across the whole transcript; `manual` starts
 * every line on Tier 1 (clean) and leaves the rest to the creator. Either
 * way, a per-line assignment made in the caption editor wins.
 */
export type CaptionTierMode = 'auto' | 'manual';

export type BrollLayout = 'corner' | 'split' | 'blend';
export type CardKind = 'hook' | 'cta' | 'lower';
export type BrollSource = 'upload' | 'pexels';

export interface CaptionWord {
  text: string;
  /** Seconds from the start of the timeline. */
  start: number;
  end: number;
  /** True when the word model flagged this one as the beat of its line. */
  emphasis?: boolean;
}

/** A run of words shown together. One cue == one on-screen line group. */
export interface CaptionCue {
  id: string;
  start: number;
  end: number;
  words: CaptionWord[];
  /** Which treatment draws this line. Absent means `clean`. */
  tier?: CaptionTier;
}

export interface Gap {
  start: number;
  end: number;
}

export interface BrollClip {
  id: string;
  url: string;
  name: string;
  /** Seconds on the main timeline. */
  start: number;
  end: number;
  layout: BrollLayout;
  /** 0..1, only meaningful for the `blend` layout. */
  opacity: number;
  source: BrollSource;
  /** Set when the clip was auto-pinned to a caption keyword. */
  keyword?: string;
  posterUrl?: string;
}

export interface GraphicCard {
  id: string;
  kind: CardKind;
  title: string;
  subtitle: string;
  start: number;
  end: number;
  color: string;
}

export interface MusicState {
  url: string;
  /** The prompt that produced `url` — editable, then regenerate. */
  prompt: string;
  /** What the analysis pass read out of the footage, for the UI to show. */
  brief: string;
  durationMs: number;
  /** Normalised 0..1 waveform peaks for the preview strip. */
  peaks: number[];
  provider: string;
}

export interface VisionRead {
  sceneType: string;
  objects: string[];
  mood: string;
  palette: string[];
  keyMoments: string[];
  brollTerms: string[];
  calloutText: string[];
  captionAccent: string;
  /** Non-empty when the read could not complete; shown verbatim in the panel. */
  note: string;
}

export interface CaptionDesign {
  preset: CaptionPreset;
  /** English (the default) or Hinglish — romanized Hindi mixed with English. */
  language: CaptionLanguage;
  /** Whether the five tiers are mixed automatically or assigned by hand. */
  tierMode: CaptionTierMode;
  /** Design-pixel size BEFORE auto-fit shrinks it to the safe zone. */
  size: number;
  color: string;
  accent: string;
  /** Fraction of frame height, 0..1, where the caption block is centred. */
  posY: number;
  autoFit: boolean;
  /** Per-word pill behind each word. Never a full-width block. */
  pill: boolean;
  wordsPerCue: number;
  uppercase: boolean;
}

export interface GradeState {
  brightness: number;
  contrast: number;
  saturation: number;
  highlights: number;
  shadows: number;
  temperature: number;
  tint: number;
  sharpness: number;
  filter: string;
}

export interface AudioMix {
  /** Original video audio, 0..100. The brief pins the default at 100. */
  original: number;
  /** Generated music, 0..100. Sits UNDER the original at 25 by default. */
  music: number;
  /** Seconds of fade at the head and tail of the whole mix. */
  fadeIn: number;
  fadeOut: number;
}

/**
 * The frame the creator is composing for. The master always renders 1080x1920
 * — the render service accepts nothing else — so this is the safe-frame the
 * preview draws and the crop the export variants are cut to.
 */
export type ShortAspect = '9:16' | '1:1' | '4:5' | '16:9';

export const SHORT_ASPECTS: { id: ShortAspect; label: string; ratio: number; blurb: string }[] = [
  { id: '9:16', label: '9:16', ratio: 9 / 16, blurb: 'TikTok · Reels · Shorts' },
  { id: '1:1', label: '1:1', ratio: 1, blurb: 'Square feed post' },
  { id: '4:5', label: '4:5', ratio: 4 / 5, blurb: 'Instagram portrait' },
  { id: '16:9', label: '16:9', ratio: 16 / 9, blurb: 'YouTube · landscape' },
];

export function shortAspectRatio(a: ShortAspect): number {
  return (SHORT_ASPECTS.find((x) => x.id === a) || SHORT_ASPECTS[0]).ratio;
}

/** One animation key on the base clip, in seconds from its head. */
export interface SveKeyframe {
  t: number;
  opacity: number;
  scale: number;
  x: number;   // -0.5..0.5 of the frame width
  y: number;   // -0.5..0.5 of the frame height
}

export type SveMotionKind =
  | 'none' | 'kenBurns' | 'pushIn' | 'pullOut' | 'panLeft' | 'panRight'
  | 'tiltUp' | 'parallax' | 'shake' | 'pulse';

export const SVE_MOTION_PRESETS: { id: SveMotionKind; label: string; blurb: string }[] = [
  { id: 'kenBurns', label: 'Ken Burns', blurb: 'Slow drift + zoom' },
  { id: 'pushIn', label: 'Push In', blurb: 'Steady scale up' },
  { id: 'pullOut', label: 'Pull Out', blurb: 'Steady scale down' },
  { id: 'panLeft', label: 'Pan Left', blurb: 'Horizontal drift' },
  { id: 'panRight', label: 'Pan Right', blurb: 'Horizontal drift' },
  { id: 'tiltUp', label: 'Tilt Up', blurb: 'Vertical drift' },
  { id: 'parallax', label: 'Parallax', blurb: 'Zoom + opposing drift' },
  { id: 'shake', label: 'Shake', blurb: 'Handheld jitter' },
  { id: 'pulse', label: 'Pulse', blurb: 'Breathes on the beat' },
  { id: 'none', label: 'None', blurb: 'Clear all motion' },
];

/**
 * Keyframes for one motion preset over `len` seconds. Shake and Pulse are
 * written as many small keys rather than a procedural function so the render
 * service reproduces exactly the movement the preview showed.
 */
export function sveMotionKeys(kind: SveMotionKind, len: number, amount: number, bpm = 0): SveKeyframe[] {
  const a = clamp(amount, 0, 1);
  const end = Math.max(0.3, len);
  const flat = { opacity: 1, scale: 1, x: 0, y: 0 };
  if (kind === 'kenBurns') {
    return [
      { t: 0, ...flat, x: -0.02 * a },
      { t: end, ...flat, scale: 1 + 0.1 * a, x: 0.02 * a, y: -0.015 * a },
    ];
  }
  if (kind === 'pushIn') return [{ t: 0, ...flat }, { t: end, ...flat, scale: 1 + 0.18 * a }];
  if (kind === 'pullOut') return [{ t: 0, ...flat, scale: 1 + 0.18 * a }, { t: end, ...flat }];
  if (kind === 'panLeft') {
    return [
      { t: 0, ...flat, scale: 1 + 0.08 * a, x: 0.07 * a },
      { t: end, ...flat, scale: 1 + 0.08 * a, x: -0.07 * a },
    ];
  }
  if (kind === 'panRight') {
    return [
      { t: 0, ...flat, scale: 1 + 0.08 * a, x: -0.07 * a },
      { t: end, ...flat, scale: 1 + 0.08 * a, x: 0.07 * a },
    ];
  }
  if (kind === 'tiltUp') {
    return [
      { t: 0, ...flat, scale: 1 + 0.08 * a, y: 0.07 * a },
      { t: end, ...flat, scale: 1 + 0.08 * a, y: -0.07 * a },
    ];
  }
  if (kind === 'parallax') {
    return [
      { t: 0, ...flat, scale: 1 + 0.14 * a, x: 0.05 * a, y: -0.03 * a },
      { t: end / 2, ...flat, scale: 1 + 0.04 * a },
      { t: end, ...flat, scale: 1 + 0.14 * a, x: -0.05 * a, y: 0.03 * a },
    ];
  }
  if (kind === 'shake') {
    const keys: SveKeyframe[] = [];
    const steps = Math.min(240, Math.max(8, Math.round(end * 8)));
    for (let i = 0; i <= steps; i += 1) {
      // A fixed pseudo-random walk: the same clip always shakes the same way.
      const seed = Math.sin(i * 12.9898) * 43758.5453;
      const r1 = seed - Math.floor(seed);
      const r2 = (seed * 1.37) - Math.floor(seed * 1.37);
      keys.push({
        t: (end * i) / steps,
        opacity: 1,
        scale: 1 + 0.02 * a,
        x: (r1 - 0.5) * 0.02 * a,
        y: (r2 - 0.5) * 0.02 * a,
      });
    }
    return keys;
  }
  if (kind === 'pulse') {
    const period = bpm > 0 ? 60 / bpm : 1.2;
    const beats = Math.max(2, Math.round(end / period));
    const keys: SveKeyframe[] = [];
    for (let i = 0; i <= beats; i += 1) {
      keys.push({ t: (end * i) / beats, opacity: 1, scale: i % 2 === 0 ? 1 : 1 + 0.06 * a, x: 0, y: 0 });
    }
    return keys;
  }
  return [];
}

/** The interpolated motion state at `t` seconds. */
export function sveKeyframeAt(keys: SveKeyframe[] | undefined, t: number): SveKeyframe | null {
  const list = keys || [];
  if (!list.length) return null;
  if (list.length === 1 || t <= list[0].t) return list[0];
  if (t >= list[list.length - 1].t) return list[list.length - 1];
  for (let i = 1; i < list.length; i += 1) {
    if (t <= list[i].t) {
      const a = list[i - 1];
      const b = list[i];
      const p = clamp((t - a.t) / Math.max(0.0001, b.t - a.t), 0, 1);
      const mix = (x: number, y: number) => x + (y - x) * p;
      return {
        t,
        opacity: mix(a.opacity, b.opacity),
        scale: mix(a.scale, b.scale),
        x: mix(a.x, b.x),
        y: mix(a.y, b.y),
      };
    }
  }
  return list[list.length - 1];
}

export interface EditDoc {
  title: string;
  /** Durable https URL of the uploaded source. Empty until the upload lands. */
  sourceUrl: string;
  sourceName: string;
  durationS: number;
  srcW: number;
  srcH: number;
  captionsEnabled: boolean;
  /** Flat word track — the single source of truth for caption timing. */
  words: CaptionWord[];
  /** Plain transcript, editable; re-timed into `words` when it changes. */
  transcript: string;
  /** Where the timing came from, shown in the UI so nobody is misled. */
  timingSource: 'transcript' | 'even' | 'none';
  silences: Gap[];
  caption: CaptionDesign;
  /**
   * Per-line tier assignments made in the caption editor, keyed by the cue's
   * start time (`cueKey` in `lib/sveCaptionTiers.ts`). An absent key means
   * the line takes whatever the automatic mix gives it.
   */
  captionTiers: Record<string, CaptionTier>;
  /** Per-line index of the word that pops, keyed the same way. */
  captionEmphasis: Record<string, number>;
  grade: GradeState;
  audio: AudioMix;
  music: MusicState;
  broll: BrollClip[];
  cards: GraphicCard[];
  vision: VisionRead | null;
  /** The frame being composed for. The master still renders 1080x1920. */
  aspect: ShortAspect;
  /** Which motion preset wrote `keyframes`, so the UI can show it selected. */
  motionKind: SveMotionKind;
  motionAmount: number;
  /** Camera animation on the base clip — previewed and rendered. */
  keyframes: SveKeyframe[];
  /** Fade the first and last moments so a looping player has no hard jump. */
  smoothLoop: boolean;
  /** Measured tempo, 0 until the clip has been analysed. */
  bpm: number;
  beatSync: boolean;
}

/**
 * The eight grades, as CSS filter chains. The SAME string is applied to the
 * preview `<video>` and handed to the Remotion composition, so a look can
 * never read one way in the editor and another in the export.
 */
export const FILTER_GRADES: Record<string, { swatch: string; css: string }> = {
  None: { swatch: 'linear-gradient(135deg,#221E0A,#110E07)', css: 'none' },
  Cinematic: { swatch: 'linear-gradient(135deg,#0F2840,#D29B62)', css: 'contrast(1.12) saturate(1.08) sepia(0.12)' },
  Moody: { swatch: 'linear-gradient(135deg,#15120A,#4A2D02)', css: 'contrast(1.18) saturate(0.82) brightness(0.94)' },
  Warm: { swatch: 'linear-gradient(135deg,#7C2D12,#F59E0B)', css: 'saturate(1.18) sepia(0.2) brightness(1.04)' },
  Cool: { swatch: 'linear-gradient(135deg,#0C4A6E,#67E8F9)', css: 'saturate(1.1) hue-rotate(-12deg) brightness(1.02)' },
  Vintage: { swatch: 'linear-gradient(135deg,#4D3C2A,#D6B889)', css: 'sepia(0.35) contrast(0.95) saturate(0.9)' },
  'B&W': { swatch: 'linear-gradient(135deg,#080808,#D4D4D8)', css: 'grayscale(1) contrast(1.1)' },
  Vivid: { swatch: 'linear-gradient(135deg,#DB2777,#B87808 48%,#06B6D4)', css: 'saturate(1.45) contrast(1.08)' },
  Matte: { swatch: 'linear-gradient(135deg,#3F3F46,#A1A1AA)', css: 'contrast(0.92) saturate(0.86) brightness(1.04)' },
  Fade: { swatch: 'linear-gradient(135deg,#6B7280,#E5E7EB)', css: 'contrast(0.86) brightness(1.08) saturate(0.82)' },
  Neon: { swatch: 'linear-gradient(135deg,#B87808,#22D3EE)', css: 'saturate(1.5) contrast(1.14) hue-rotate(-10deg) brightness(1.04)' },
  Film: { swatch: 'linear-gradient(135deg,#1C1917,#A8A29E)', css: 'contrast(1.08) saturate(1.06) sepia(0.08)' },
  Retro: { swatch: 'linear-gradient(135deg,#4D3C2A,#E8B35F)', css: 'sepia(0.4) saturate(0.9) contrast(0.96) hue-rotate(-8deg)' },
  'Lo-Fi': { swatch: 'linear-gradient(135deg,#44403C,#F0B429)', css: 'sepia(0.28) saturate(0.74) contrast(0.92) brightness(1.03)' },
};

/** Which family each grade belongs to, for the Effects tab's category pills. */
export const FILTER_CATEGORIES: Record<string, 'cinematic' | 'retro' | 'modern' | 'minimal'> = {
  None: 'minimal',
  Cinematic: 'cinematic',
  Moody: 'cinematic',
  Warm: 'modern',
  Cool: 'modern',
  Vintage: 'retro',
  'B&W': 'cinematic',
  Vivid: 'modern',
  Matte: 'minimal',
  Fade: 'minimal',
  Neon: 'modern',
  Film: 'cinematic',
  Retro: 'retro',
  'Lo-Fi': 'retro',
};

export const CAPTION_PRESETS: { id: CaptionPreset; label: string; hint: string }[] = [
  { id: 'bold', label: 'Bold Sans', hint: 'Heavy sans, hard shadow' },
  { id: 'gradient', label: 'Gradient', hint: 'Accent gradient fill' },
  { id: 'outline', label: 'Outlined', hint: 'Thick stroke, no fill tint' },
  { id: 'boxed', label: 'Boxed', hint: 'Per-word pill, 40% dark' },
];

/**
 * Vidverge blue — the one colour that breaks the white.
 *
 * Every caption is white by default. This accent is reserved for emphasis
 * moments: the key word of a kinetic line, the key word of a cinematic hook,
 * and the digits of a timeline line. Nothing else takes it, which is what
 * makes it read as emphasis rather than as decoration.
 */
export const CAPTION_ACCENT_VIDVERGE = '#3B82F6';

export const CAPTION_LANGUAGES: { id: CaptionLanguage; label: string; hint: string }[] = [
  { id: 'en', label: 'English', hint: 'English captions — the five-tier mix applies either way' },
  { id: 'hinglish', label: 'Hinglish', hint: 'Romanized Hindi mixed with English — adds the Hindi filler list the key-word picker skips' },
];

export const BROLL_LAYOUTS: { id: BrollLayout; label: string; hint: string }[] = [
  { id: 'corner', label: 'Corner PiP', hint: '25% size, top-right' },
  { id: 'split', label: 'Side-by-Side', hint: '50/50 vertical split' },
  { id: 'blend', label: 'Full Overlay', hint: '60% opacity blend' },
];

export function newId(prefix: string): string {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

export function emptyDoc(): EditDoc {
  return {
    title: 'Untitled short',
    sourceUrl: '',
    sourceName: '',
    durationS: 0,
    srcW: DESIGN_W,
    srcH: DESIGN_H,
    captionsEnabled: true,
    words: [],
    transcript: '',
    timingSource: 'none',
    silences: [],
    captionTiers: {},
    captionEmphasis: {},
    caption: {
      preset: 'bold',
      language: 'en',
      tierMode: 'auto',
      size: 92,
      color: '#FFFFFF',
      accent: CAPTION_ACCENT_VIDVERGE,
      posY: 0.74,
      autoFit: true,
      pill: false,
      wordsPerCue: 3,
      uppercase: true,
    },
    grade: {
      brightness: 0,
      contrast: 0,
      saturation: 0,
      highlights: 0,
      shadows: 0,
      temperature: 0,
      tint: 0,
      sharpness: 0,
      filter: 'None',
    },
    audio: { original: 100, music: 25, fadeIn: 0, fadeOut: 0 },
    music: { url: '', prompt: '', brief: '', durationMs: 0, peaks: [], provider: '' },
    broll: [],
    cards: [],
    vision: null,
    aspect: '9:16',
    motionKind: 'none',
    motionAmount: 0.6,
    keyframes: [],
    smoothLoop: false,
    bpm: 0,
    beatSync: false,
  };
}

/** Keep only the per-line tier assignments this build still understands. */
function tierMap(raw: unknown): Record<string, CaptionTier> {
  const out: Record<string, CaptionTier> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const known = ['clean', 'kinetic', 'cinematic', 'beat', 'ui'];
  for (const key of Object.keys(raw as Record<string, unknown>)) {
    const value = String((raw as Record<string, unknown>)[key]);
    if (known.indexOf(value) >= 0) out[key] = value as CaptionTier;
  }
  return out;
}

/** The same guard for the per-line emphasis word index. */
function emphasisMap(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const key of Object.keys(raw as Record<string, unknown>)) {
    const index = Number((raw as Record<string, unknown>)[key]);
    if (Number.isInteger(index) && index >= 0) out[key] = index;
  }
  return out;
}

/**
 * Fill in anything a stored document predates, so reopening an older autosave
 * lands in a fully formed Phase 2 editor instead of crashing on a missing key.
 */
export function hydrateDoc(raw: unknown): EditDoc {
  const base = emptyDoc();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const d = raw as Partial<EditDoc>;
  const caption = { ...base.caption, ...(d.caption || {}) };
  return {
    ...base,
    ...d,
    // A stored document predating the language selector, or one carrying a
    // value this build does not know, lands on English rather than on a tier
    // table lookup that would miss. The same guard covers the tier mode.
    caption: {
      ...caption,
      language: caption.language === 'hinglish' ? 'hinglish' : 'en',
      tierMode: caption.tierMode === 'manual' ? 'manual' : 'auto',
    },
    captionTiers: tierMap(d.captionTiers),
    captionEmphasis: emphasisMap(d.captionEmphasis),
    grade: { ...base.grade, ...(d.grade || {}) },
    audio: { ...base.audio, ...(d.audio || {}) },
    music: { ...base.music, ...(d.music || {}) },
    words: Array.isArray(d.words) ? d.words : [],
    silences: Array.isArray(d.silences) ? d.silences : [],
    broll: Array.isArray(d.broll) ? d.broll : [],
    cards: Array.isArray(d.cards) ? d.cards : [],
    vision: d.vision && typeof d.vision === 'object' ? (d.vision as VisionRead) : null,
    aspect: d.aspect || base.aspect,
    motionKind: d.motionKind || base.motionKind,
    motionAmount: Number.isFinite(d.motionAmount) ? (d.motionAmount as number) : base.motionAmount,
    keyframes: Array.isArray(d.keyframes) ? d.keyframes : [],
    smoothLoop: d.smoothLoop === true,
    bpm: Number.isFinite(d.bpm) ? (d.bpm as number) : 0,
    beatSync: d.beatSync === true,
  };
}

export function clamp(v: number, lo: number, hi: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Number(seconds) || 0);
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
}

export function formatBytes(bytes: number): string {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}
