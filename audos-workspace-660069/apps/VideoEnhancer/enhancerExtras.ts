/**
 * Video Enhancer — extended editing model + pure helpers.
 *
 * Everything here is browser-native (Web Audio API, canvas 2D, CSS filters)
 * and side-effect free except the audio decoding helpers. No new packages.
 */

// ---------------------------------------------------------------------------
// IDs & option catalogs
// ---------------------------------------------------------------------------

export type CropId = 'source' | '16:9' | '9:16' | '1:1' | '4:5' | '4:3' | '2.35:1';
export type QualityId = '480p' | '720p' | '1080p' | '4k';
export type TextAnim = 'none' | 'typewriter' | 'fadeIn' | 'slideUp' | 'slideLeft' | 'slideRight' | 'bounceIn' | 'zoomIn';
export type RampId = 'none' | 'in' | 'out';
export type TransId = 'none' | 'fade' | 'zoom' | 'slide';
export type CutStyle = 'cut' | 'fade' | 'dissolve' | 'slide';
export type CornerId = 'tl' | 'tr' | 'bl' | 'br';

export const FONT_OPTIONS: { id: string; label: string; css: string }[] = [
  { id: 'inter', label: 'Inter · Sans', css: "'Inter', system-ui, sans-serif" },
  { id: 'montserrat', label: 'Montserrat · Sans', css: "'Montserrat', 'Inter', sans-serif" },
  { id: 'robotoslab', label: 'Roboto Slab · Serif', css: "'Roboto Slab', Georgia, serif" },
  { id: 'playfair', label: 'Playfair Display · Serif', css: "'Playfair Display', Georgia, serif" },
  { id: 'mono', label: 'JetBrains Mono · Mono', css: "'JetBrains Mono', ui-monospace, monospace" },
  { id: 'bebas', label: 'Bebas Neue · Display', css: "'Bebas Neue', Impact, sans-serif" },
  { id: 'anton', label: 'Anton · Display Black', css: "'Anton', Impact, sans-serif" },
  { id: 'oswald', label: 'Oswald · Condensed', css: "'Oswald', 'Inter', sans-serif" },
  { id: 'dmsans', label: 'DM Sans · Sans', css: "'DM Sans', 'Inter', sans-serif" },
  { id: 'geist', label: 'Geist · Sans', css: "'Geist', 'Inter', sans-serif" },
];

export const GOOGLE_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;700;900&family=Montserrat:wght@300;400;700;900&family=Roboto+Slab:wght@300;400;700&family=Playfair+Display:wght@400;700;900&family=JetBrains+Mono:wght@300;400;700&family=Bebas+Neue&family=Anton&family=Oswald:wght@300;400;700&family=DM+Sans:wght@400;500;700;900&family=Geist:wght@400;500;700;900&display=swap';

export function fontCssFor(id: string): string {
  return (FONT_OPTIONS.find((f) => f.id === id) || FONT_OPTIONS[0]).css;
}

export const WEIGHT_OPTIONS: { id: number; label: string }[] = [
  { id: 300, label: 'Light' },
  { id: 400, label: 'Regular' },
  { id: 700, label: 'Bold' },
  { id: 900, label: 'Black' },
];

export const ANIM_OPTIONS: { id: TextAnim; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'typewriter', label: 'Typewriter' },
  { id: 'fadeIn', label: 'Fade In' },
  { id: 'slideUp', label: 'Slide Up' },
  { id: 'slideLeft', label: 'Slide In · Left' },
  { id: 'slideRight', label: 'Slide In · Right' },
  { id: 'bounceIn', label: 'Bounce In' },
  { id: 'zoomIn', label: 'Zoom In' },
];

export const CROP_OPTIONS: { id: CropId; label: string; ratio: number | null }[] = [
  { id: 'source', label: 'Source', ratio: null },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '9:16', label: '9:16 Reels', ratio: 9 / 16 },
  { id: '1:1', label: '1:1 Square', ratio: 1 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '2.35:1', label: '2.35:1 Cine', ratio: 2.35 },
];

export const QUALITY_OPTIONS: { id: QualityId; label: string; short: number }[] = [
  { id: '480p', label: '480p', short: 480 },
  { id: '720p', label: '720p HD', short: 720 },
  { id: '1080p', label: '1080p Full HD', short: 1080 },
  { id: '4k', label: '4K Ultra', short: 2160 },
];

export const EMOJI_SET = ['🔥', '✨', '🚀', '😂', '😍', '👀', '💯', '🎬', '🎵', '⚡', '❤️', '👍', '🎉', '😎', '🤯', '💡', '📈', '⭐', '🏆', '💥', '🙌', '😱', '🫶', '🤩'];

// ---------------------------------------------------------------------------
// Editing model
// ---------------------------------------------------------------------------

export interface GradeState { brightness: number; contrast: number; saturation: number; hue: number; temperature: number; tint: number }
export interface DuotoneState { on: boolean; dark: string; light: string }
export interface VignetteState { on: boolean; intensity: number; radius: number }
export interface StyleState {
  cinematic: boolean; vintage: boolean; neon: boolean; bw: boolean;
  grain: boolean; punchIn: boolean; duotone: DuotoneState; vignette: VignetteState;
  /** Film grain overlay strength, 0–100. */
  grainAmount: number;
  /** Neon glow strength, 0–100. */
  neonAmount: number;
}
export interface MotionState { speed: number; ramp: RampId; reverse: boolean }
export interface BlurState { gaussian: number; radial: number; background: number }
export interface TransitionState { tin: TransId; tout: TransId; cutStyle: CutStyle }
export interface BeatState { on: boolean; bpm: number; intensity: number; snapCuts: boolean }

export interface TextLayerState {
  id: string; text: string; font: string; size: number; weight: number;
  color: string; bg: string; bgOpacity: number;
  align: 'left' | 'center' | 'right'; letterSpacing: number; lineHeight: number;
  anim: TextAnim; x: number; y: number; start: number; end: number;
  outlineColor: string; outlineWidth: number;
  shadowColor: string; shadowBlur: number; shadowX: number; shadowY: number;
  visible: boolean;
}

export interface StickerState { id: string; emoji: string; x: number; y: number; size: number; start: number; end: number }
export interface WatermarkState { localUrl: string; url: string; corner: CornerId; size: number; opacity: number }
export interface AudioFxState {
  noiseReduction: boolean; normalize: boolean; originalVolume: number;
  musicLocalUrl: string; musicUrl: string; musicName: string; musicVolume: number;
}

export interface ProjectState {
  grade: GradeState;
  style: StyleState;
  motion: MotionState;
  blur: BlurState;
  transition: TransitionState;
  beat: BeatState;
  layers: TextLayerState[];
  stickers: StickerState[];
  watermark: WatermarkState | null;
  audio: AudioFxState;
  crop: CropId;
  quality: QualityId;
}

/** The api panels use to change project state with undo/redo support. */
export interface EditorApi {
  /** Push the current state onto the undo stack (call once before a slider drag). */
  checkpoint(): void;
  /** Update without recording history (mid-drag updates). */
  silent(up: (p: ProjectState) => ProjectState): void;
  /** Record history, then update (discrete actions: toggles, buttons, selects). */
  commit(up: (p: ProjectState) => ProjectState): void;
  toast(msg: string): void;
}

let uidCounter = 0;
export function uid(prefix: string): string { return prefix + '-' + Date.now().toString(36) + '-' + (uidCounter++); }

export function defaultProject(): ProjectState {
  return {
    grade: { brightness: 100, contrast: 100, saturation: 100, hue: 0, temperature: 0, tint: 0 },
    style: {
      cinematic: false, vintage: false, neon: false, bw: false, grain: false, punchIn: false,
      grainAmount: 50, neonAmount: 60,
      duotone: { on: false, dark: '#1E1B4B', light: '#93C5FD' },
      vignette: { on: false, intensity: 45, radius: 58 },
    },
    motion: { speed: 1, ramp: 'none', reverse: false },
    blur: { gaussian: 0, radial: 0, background: 0 },
    transition: { tin: 'none', tout: 'none', cutStyle: 'dissolve' },
    beat: { on: false, bpm: 120, intensity: 35, snapCuts: false },
    layers: [],
    stickers: [],
    watermark: null,
    audio: { noiseReduction: false, normalize: false, originalVolume: 100, musicLocalUrl: '', musicUrl: '', musicName: '', musicVolume: 35 },
    crop: 'source',
    quality: '1080p',
  };
}

export function newTextLayer(duration: number): TextLayerState {
  return {
    id: uid('txt'), text: 'Your text here', font: 'inter', size: 44, weight: 700,
    color: '#FFFFFF', bg: '#000000', bgOpacity: 0,
    align: 'center', letterSpacing: 0, lineHeight: 1.2,
    anim: 'fadeIn', x: 50, y: 50, start: 0, end: Math.max(2, Math.round(duration * 10) / 10),
    outlineColor: '#000000', outlineWidth: 0,
    shadowColor: '#000000', shadowBlur: 12, shadowX: 0, shadowY: 2,
    visible: true,
  };
}

export function newSticker(emoji: string, at: number, duration: number): StickerState {
  return { id: uid('stk'), emoji, x: 78, y: 22, size: 96, start: Math.max(0, Math.round(at * 10) / 10), end: Math.max(1, Math.min(duration, at + 3)) };
}

/** Quick looks — one-tap grade presets (preserves the old preset behaviour). */
export const LOOK_PRESETS: { id: string; label: string; hint: string; apply: (p: ProjectState) => ProjectState }[] = [
  {
    id: 'original', label: 'Original', hint: 'No colour grade — footage exactly as shot.',
    apply: (p) => ({ ...p, grade: defaultProject().grade, style: { ...p.style, cinematic: false, vintage: false, neon: false, bw: false, duotone: { ...p.style.duotone, on: false } } }),
  },
  {
    id: 'cinematic', label: 'Cinematic', hint: 'Deeper contrast, teal push and a 2.35:1 letterbox matte.',
    apply: (p) => ({ ...p, style: { ...p.style, cinematic: true, vintage: false, neon: false, bw: false }, grade: { ...p.grade, contrast: 108, saturation: 112 } }),
  },
  {
    id: 'warm', label: 'Warm', hint: 'Golden-hour warmth — sunny and inviting.',
    apply: (p) => ({ ...p, style: { ...p.style, vintage: false, cinematic: false, neon: false, bw: false }, grade: { ...p.grade, temperature: 45, saturation: 112, brightness: 103 } }),
  },
  {
    id: 'cool', label: 'Cool', hint: 'Crisp blue-leaning grade for tech and night footage.',
    apply: (p) => ({ ...p, style: { ...p.style, vintage: false, cinematic: false, neon: false, bw: false }, grade: { ...p.grade, temperature: -45, saturation: 108, contrast: 104 } }),
  },
  {
    id: 'faded', label: 'Faded', hint: 'Lifted blacks and soft colour — a matte, editorial feel.',
    apply: (p) => ({ ...p, style: { ...p.style, vintage: false, cinematic: false, neon: false, bw: false }, grade: { ...p.grade, brightness: 108, contrast: 86, saturation: 82 } }),
  },
  {
    id: 'vintage', label: 'Vintage', hint: 'Sepia film stock with grain — aged and nostalgic.',
    apply: (p) => ({ ...p, style: { ...p.style, vintage: true, grain: true, cinematic: false, neon: false, bw: false }, grade: { ...p.grade, temperature: 25, saturation: 96 } }),
  },
  {
    id: 'noir', label: 'Noir', hint: 'Punchy black & white.',
    apply: (p) => ({ ...p, style: { ...p.style, bw: true, cinematic: false, vintage: false, neon: false, duotone: { ...p.style.duotone, on: false } }, grade: { ...p.grade, contrast: 118 } }),
  },
  {
    id: 'vivid', label: 'Vivid', hint: 'Saturated, high-energy colour.',
    apply: (p) => ({ ...p, style: { ...p.style, cinematic: false, vintage: false, neon: false, bw: false }, grade: { ...p.grade, saturation: 150, contrast: 108 } }),
  },
];

// ---------------------------------------------------------------------------
// CSS filter builder — combines grade + stylistic + blur into one string used
// identically by the live preview and the server render.
// ---------------------------------------------------------------------------

export function buildFilter(grade: GradeState, style: StyleState, blur: BlurState): string {
  const f: string[] = [];
  if (grade.brightness !== 100) f.push('brightness(' + (grade.brightness / 100).toFixed(3) + ')');
  if (grade.contrast !== 100) f.push('contrast(' + (grade.contrast / 100).toFixed(3) + ')');
  if (grade.saturation !== 100) f.push('saturate(' + (grade.saturation / 100).toFixed(3) + ')');
  if (grade.hue !== 0) f.push('hue-rotate(' + grade.hue + 'deg)');
  const t = grade.temperature / 100;
  if (t > 0.01) { f.push('sepia(' + (0.3 * t).toFixed(3) + ')', 'hue-rotate(' + (-8 * t).toFixed(1) + 'deg)', 'saturate(' + (1 + 0.15 * t).toFixed(3) + ')'); }
  else if (t < -0.01) { f.push('hue-rotate(' + (18 * -t).toFixed(1) + 'deg)', 'brightness(' + (1 + 0.03 * -t).toFixed(3) + ')'); }
  const ti = grade.tint / 100;
  if (Math.abs(ti) > 0.01) f.push('hue-rotate(' + (ti * 14).toFixed(1) + 'deg)');
  if (style.bw || style.duotone.on) f.push('grayscale(1)');
  if (style.vintage) f.push('sepia(0.32)', 'saturate(0.88)', 'contrast(0.94)', 'brightness(1.06)');
  if (style.neon) {
    const k = Math.max(0, Math.min(1, (typeof style.neonAmount === 'number' ? style.neonAmount : 60) / 100));
    f.push('saturate(' + (1 + 0.6 * k).toFixed(3) + ')', 'contrast(' + (1 + 0.18 * k).toFixed(3) + ')', 'brightness(' + (1 + 0.08 * k).toFixed(3) + ')');
  }
  if (style.cinematic) f.push('contrast(1.06)', 'saturate(1.1)');
  if (blur.gaussian > 0) f.push('blur(' + blur.gaussian + 'px)');
  return f.length ? f.join(' ') : 'none';
}

export function hexToRgba(hex: string, alpha: number): string {
  const h = (hex || '#000000').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full || '000000', 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 'rgba(' + r + ',' + g + ',' + b + ',' + Math.max(0, Math.min(1, alpha)) + ')';
}

// ---------------------------------------------------------------------------
// Output geometry
// ---------------------------------------------------------------------------

function even(n: number): number { return Math.max(2, Math.round(n / 2) * 2); }

export function outputDims(crop: CropId, quality: QualityId, srcW: number, srcH: number): { width: number; height: number } {
  const opt = CROP_OPTIONS.find((c) => c.id === crop);
  const ratio = opt && opt.ratio ? opt.ratio : (srcW > 0 && srcH > 0 ? srcW / srcH : 16 / 9);
  const short = (QUALITY_OPTIONS.find((q) => q.id === quality) || QUALITY_OPTIONS[2]).short;
  if (ratio >= 1) return { width: even(short * ratio), height: even(short) };
  return { width: even(short), height: even(short / ratio) };
}

// ---------------------------------------------------------------------------
// Web Audio analysis — decode, waveform peaks, silence detection, BPM
// ---------------------------------------------------------------------------

export interface DecodedAudio { samples: Float32Array; sampleRate: number; duration: number }

/** Decode any audio/video file to mono PCM at a light analysis rate (browser-side, no ffmpeg). */
export async function decodeAudioMono(file: File | Blob, targetRate = 8000): Promise<DecodedAudio> {
  const buf = await file.arrayBuffer();
  const AC: any = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AC) throw new Error('This browser cannot decode audio locally.');
  const ctx = new AC();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(buf.slice(0));
  } finally {
    try { ctx.close(); } catch { /* no-op */ }
  }
  const frames = Math.max(1, Math.ceil(decoded.duration * targetRate));
  const off = new OfflineAudioContext(1, frames, targetRate);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start(0);
  const rendered = await off.startRendering();
  return { samples: rendered.getChannelData(0), sampleRate: targetRate, duration: decoded.duration };
}

/** Max-abs amplitude per bucket, for canvas waveform drawing. */
export function computePeaks(samples: Float32Array, buckets = 1200): Float32Array {
  const out = new Float32Array(buckets);
  if (!samples.length) return out;
  const per = samples.length / buckets;
  for (let b = 0; b < buckets; b++) {
    const s = Math.floor(b * per), e = Math.min(samples.length, Math.floor((b + 1) * per) + 1);
    let m = 0;
    for (let i = s; i < e; i++) { const a = Math.abs(samples[i]); if (a > m) m = a; }
    out[b] = m;
  }
  return out;
}

export interface SilenceRegion { start: number; end: number }

/**
 * Detect regions whose RMS level stays below thresholdDb for at least minDur
 * seconds. 25 ms RMS windows with a 10 ms hop.
 */
export function detectSilences(samples: Float32Array, sampleRate: number, thresholdDb: number, minDur: number): SilenceRegion[] {
  const win = Math.max(8, Math.round(sampleRate * 0.025));
  const hop = Math.max(4, Math.round(sampleRate * 0.010));
  const regions: SilenceRegion[] = [];
  let silentFrom = -1;
  const nWin = Math.max(0, Math.floor((samples.length - win) / hop) + 1);
  for (let w = 0; w <= nWin; w++) {
    const s = w * hop;
    const e = Math.min(samples.length, s + win);
    if (s >= samples.length) break;
    let sum = 0;
    for (let i = s; i < e; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / Math.max(1, e - s));
    const db = 20 * Math.log10(rms + 1e-8);
    const tSec = s / sampleRate;
    if (db < thresholdDb) {
      if (silentFrom < 0) silentFrom = tSec;
    } else if (silentFrom >= 0) {
      if (tSec - silentFrom >= minDur) regions.push({ start: round2(silentFrom), end: round2(tSec) });
      silentFrom = -1;
    }
  }
  const endT = samples.length / sampleRate;
  if (silentFrom >= 0 && endT - silentFrom >= minDur) regions.push({ start: round2(silentFrom), end: round2(endT) });
  return regions;
}

/** Rough BPM estimate from the onset-energy autocorrelation (60–180 BPM). Returns 0 when inconclusive. */
export function estimateBpm(samples: Float32Array, sampleRate: number): number {
  const hop = Math.max(8, Math.round(sampleRate * 0.02)); // 50 env frames / second
  const envRate = sampleRate / hop;
  const n = Math.floor(samples.length / hop);
  if (n < envRate * 4) return 0;
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    const s = i * hop, e = Math.min(samples.length, s + hop);
    for (let j = s; j < e; j++) sum += samples[j] * samples[j];
    env[i] = sum;
  }
  const onset = new Float32Array(n);
  for (let i = 1; i < n; i++) onset[i] = Math.max(0, env[i] - env[i - 1]);
  const minLag = Math.max(2, Math.round(envRate * 60 / 180));
  const maxLag = Math.round(envRate * 60 / 60);
  let bestLag = 0, bestScore = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let score = 0;
    for (let i = 0; i + lag < n; i++) score += onset[i] * onset[i + lag];
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }
  if (!bestLag || bestScore <= 0) return 0;
  return Math.round(60 * envRate / bestLag);
}

// ---------------------------------------------------------------------------
// EDL (edit decision list) — non-destructive silence cuts
// ---------------------------------------------------------------------------

export interface EdlSegment { from: number; to: number }

function round2(n: number): number { return Math.round(n * 100) / 100; }

/** Shrink each included silence region by the keep-padding, clamp, drop empties, merge overlaps. */
export function buildCuts(regions: SilenceRegion[], padMs: number, duration: number): SilenceRegion[] {
  const pad = Math.max(0, padMs) / 1000;
  const cuts = regions
    .map((r) => ({ start: Math.max(0, r.start + pad), end: Math.min(duration, r.end - pad) }))
    .filter((r) => r.end - r.start > 0.04)
    .sort((a, b) => a.start - b.start);
  const merged: SilenceRegion[] = [];
  for (const c of cuts) {
    const last = merged[merged.length - 1];
    if (last && c.start <= last.end + 0.01) last.end = Math.max(last.end, c.end);
    else merged.push({ ...c });
  }
  return merged;
}

/** The complement of the cuts: the segments of the source that stay in the output. */
export function buildKeeps(duration: number, cuts: SilenceRegion[]): EdlSegment[] {
  const keeps: EdlSegment[] = [];
  let cursor = 0;
  for (const c of cuts) {
    if (c.start - cursor > 0.04) keeps.push({ from: round2(cursor), to: round2(c.start) });
    cursor = Math.max(cursor, c.end);
  }
  if (duration - cursor > 0.04) keeps.push({ from: round2(cursor), to: round2(duration) });
  return keeps.length ? keeps : [{ from: 0, to: round2(duration) }];
}

export function keptDuration(keeps: EdlSegment[]): number {
  return keeps.reduce((acc, k) => acc + Math.max(0, k.to - k.from), 0);
}

/** Map a source-time position to its output-time position given cuts + speed. */
export function mapSrcToOut(t: number, keeps: EdlSegment[], speed: number): number {
  let acc = 0;
  for (const k of keeps) {
    if (t <= k.from) break;
    if (t <= k.to) { acc += t - k.from; break; }
    acc += k.to - k.from;
  }
  return acc / Math.max(0.01, speed);
}

export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m > 0) return m + 'm ' + String(s).padStart(2, '0') + 's';
  return (Math.round(sec * 10) / 10) + 's';
}

// ---------------------------------------------------------------------------
// Waveform drawing (canvas 2D)
// ---------------------------------------------------------------------------

export function drawWaveform(
  canvas: HTMLCanvasElement,
  peaks: Float32Array | null,
  duration: number,
  cuts: SilenceRegion[],
): void {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!peaks || !peaks.length || duration <= 0) return;
  const mid = h / 2;
  const inCut = (tt: number) => cuts.some((c) => tt >= c.start && tt < c.end);
  for (let x = 0; x < w; x++) {
    const tt = (x / w) * duration;
    const bucket = Math.min(peaks.length - 1, Math.floor((x / w) * peaks.length));
    const amp = Math.max(0.02, Math.min(1, peaks[bucket] * 1.6));
    const bh = Math.max(1, amp * (h - 6));
    ctx.fillStyle = inCut(tt) ? 'rgba(248,113,113,0.85)' : 'rgba(96,165,250,0.85)';
    ctx.fillRect(x, mid - bh / 2, 1, bh);
  }
}
