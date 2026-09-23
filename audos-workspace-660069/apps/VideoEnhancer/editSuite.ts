/**
 * Video Enhancer — editing suite engine.
 *
 * Everything the full editor needs beyond the AI overlay plan:
 *   - Edit state types: trim segments, effects (filters + speed), text
 *     overlays, aspect-ratio presets, audio settings, export options.
 *   - The "needs a graphic?" rule for AI analysis insights: an insight earns
 *     a supporting chart/graphic ONLY when it carries a score, a comparison,
 *     a recommendation, or a multi-step explanation — self-explanatory text
 *     stays text.
 *   - Shared canvas text-overlay renderer (live preview + burn-in export).
 *   - The unified export engine: replays the footage through a canvas +
 *     MediaRecorder pass applying trim/cut segments, speed, color filters,
 *     vignette, aspect-ratio crop, AI overlays, text overlays, the original
 *     audio (adjustable / mutable) and an optional generated music bed.
 */
import { OverlayElement, drawOverlays } from './overlayEngine';
import type { AnalysisInsight } from './overlayEngine';
import type { CaptionSegment } from './enhancerCore';
import { drawCaptionOverlay } from './captionSuite';
import type { CaptionStyleId, CaptionPosition } from './captionSuite';

function msg(e: unknown): string { return e instanceof Error ? e.message : String(e); }
export function clamp(v: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, v)); }

// ---------------------------------------------------------------------------
// Shared editor palette (deep dark base, vibrant accents)
// ---------------------------------------------------------------------------

export const P = {
  bg: '#06080F',
  panel: '#0D1120',
  panelSoft: '#111730',
  card: '#0F1426',
  border: 'rgba(140,155,255,0.15)',
  borderSoft: 'rgba(140,155,255,0.08)',
  text: '#F2F4FF',
  sub: '#AAB2D4',
  muted: '#6E7697',
  blue: '#3D8BFF',
  amber: '#FFB224',
  coral: '#FF6B6B',
  mint: '#34E0B0',
  violet: '#A78BFA',
  cyan: '#22D3EE',
} as const;

// ---------------------------------------------------------------------------
// Edit state types
// ---------------------------------------------------------------------------

export type AspectPreset = 'original' | '16:9' | '9:16' | '1:1' | '4:5';

export const ASPECT_PRESETS: { id: AspectPreset; label: string; ratio: number | null; hint: string }[] = [
  { id: 'original', label: 'Original', ratio: null, hint: 'As uploaded' },
  { id: '16:9', label: '16:9', ratio: 16 / 9, hint: 'YouTube / landscape' },
  { id: '9:16', label: '9:16', ratio: 9 / 16, hint: 'Reels / TikTok / Shorts' },
  { id: '1:1', label: '1:1', ratio: 1, hint: 'Square feed' },
  { id: '4:5', label: '4:5', ratio: 4 / 5, hint: 'Instagram portrait' },
];

export const SPEED_OPTIONS = [0.5, 1, 1.25, 1.5, 2] as const;

/**
 * Backdrop framing: 'gradient' floats the footage on a dark brand gradient,
 * 'blur' floats it on a blurred, darkened echo of itself (the classic
 * background-softening / social frame look). Applied in the live preview and
 * the export identically.
 */
export type BackdropMode = 'none' | 'gradient' | 'blur';

export interface EffectsState {
  brightness: number;  // 0..200, 100 = neutral
  contrast: number;    // 0..200, 100 = neutral
  saturation: number;  // 0..200, 100 = neutral
  blur: number;        // 0..8 px
  vignette: number;    // 0..100 strength
  speed: number;       // one of SPEED_OPTIONS
  /** Optional backdrop framing; older stored edits may omit it. */
  backdrop?: BackdropMode;
}

export const DEFAULT_EFFECTS: EffectsState = { brightness: 100, contrast: 100, saturation: 100, blur: 0, vignette: 0, speed: 1, backdrop: 'none' };

export function effectsAreNeutral(fx: EffectsState): boolean {
  return fx.brightness === 100 && fx.contrast === 100 && fx.saturation === 100 && fx.blur === 0 && fx.vignette === 0 && fx.speed === 1 && (!fx.backdrop || fx.backdrop === 'none');
}

/**
 * Paint the backdrop frame behind a contained video. 'blur' draws a blurred,
 * darkened cover-scaled echo of the current frame; 'gradient' (and any blur
 * failure) draws the deep VidVerge gradient with a soft brand glow.
 */
export function drawBackdropFrame(ctx: CanvasRenderingContext2D, W: number, H: number, video: HTMLVideoElement, mode: BackdropMode): void {
  if (mode === 'blur' && video.videoWidth && video.videoHeight) {
    try {
      const s = Math.max(W / video.videoWidth, H / video.videoHeight) * 1.12;
      const bw = video.videoWidth * s, bh = video.videoHeight * s;
      ctx.save();
      ctx.filter = 'blur(' + Math.max(12, Math.round(Math.min(W, H) * 0.035)) + 'px) brightness(0.5) saturate(1.15)';
      ctx.drawImage(video, (W - bw) / 2, (H - bh) / 2, bw, bh);
      ctx.restore();
      return;
    } catch { /* fall through to the gradient */ }
  }
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#101A30');
  g.addColorStop(0.55, '#0A0F1E');
  g.addColorStop(1, '#1B1340');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, H * 0.35, Math.min(W, H) * 0.1, W / 2, H * 0.4, Math.max(W, H) * 0.7);
  glow.addColorStop(0, 'rgba(61,139,255,0.16)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
}

/** CSS/canvas filter string for the current effect settings (vignette drawn separately). */
export function filterCss(fx: EffectsState): string {
  const parts: string[] = [];
  if (fx.brightness !== 100) parts.push('brightness(' + (fx.brightness / 100) + ')');
  if (fx.contrast !== 100) parts.push('contrast(' + (fx.contrast / 100) + ')');
  if (fx.saturation !== 100) parts.push('saturate(' + (fx.saturation / 100) + ')');
  if (fx.blur > 0) parts.push('blur(' + fx.blur + 'px)');
  return parts.length ? parts.join(' ') : 'none';
}

export interface TextOverlayItem {
  id: string;
  text: string;
  /** Normalized center position (0..1 of the full source frame). */
  x: number;
  y: number;
  /** Font size as a fraction of frame height (0.02 .. 0.14). */
  size: number;
  color: string;
  start: number;
  end: number;
}

export const TEXT_COLORS = ['#FFFFFF', '#3D8BFF', '#FFB224', '#FF6B6B', '#34E0B0', '#A78BFA'];

export function newTextOverlay(at: number, duration: number): TextOverlayItem {
  return {
    id: 'txt-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
    text: 'Your text',
    x: 0.5,
    y: 0.82,
    size: 0.055,
    color: '#FFFFFF',
    start: Math.max(0, Math.round(at * 10) / 10),
    end: Math.min(Math.max(0.5, duration), Math.round((at + 3) * 10) / 10),
  };
}

// ---------------------------------------------------------------------------
// Trim / cut segment model
// ---------------------------------------------------------------------------

export interface TrimSegmentInfo { key: string; start: number; end: number; kept: boolean }

/**
 * Derive the ordered segment list from the in/out points plus split positions.
 * Splits outside (in, out) are ignored. Segment identity is its rounded time
 * range, so toggles survive unrelated split edits.
 */
export function buildSegments(inPoint: number, outPoint: number, splits: number[], removedKeys: string[]): TrimSegmentInfo[] {
  const lo = Math.max(0, Math.min(inPoint, outPoint));
  const hi = Math.max(lo + 0.1, Math.max(inPoint, outPoint));
  const bounds = [lo, ...splits.filter((s) => s > lo + 0.05 && s < hi - 0.05).sort((a, b) => a - b), hi];
  const removed = new Set(removedKeys);
  const out: TrimSegmentInfo[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const start = Math.round(bounds[i] * 100) / 100;
    const end = Math.round(bounds[i + 1] * 100) / 100;
    if (end - start < 0.05) continue;
    const key = start.toFixed(2) + '-' + end.toFixed(2);
    out.push({ key, start, end, kept: !removed.has(key) });
  }
  return out;
}

export function keptRanges(segments: TrimSegmentInfo[]): { start: number; end: number }[] {
  return segments.filter((s) => s.kept).map((s) => ({ start: s.start, end: s.end }));
}

export function keptDuration(segments: TrimSegmentInfo[]): number {
  return segments.reduce((acc, s) => acc + (s.kept ? s.end - s.start : 0), 0);
}

// ---------------------------------------------------------------------------
// Analysis insight → graphic rule
// ---------------------------------------------------------------------------

export type InsightGraphic =
  | { kind: 'score'; score: number }
  | { kind: 'compare'; before: string; after: string }
  | { kind: 'steps'; steps: string[] }
  | { kind: 'recommendation'; recommendation: string }
  | null;

/**
 * The lightweight conditional rule from the product spec: an analysis item
 * earns a supporting graphic ONLY when it contains a score, a comparison, a
 * recommendation, or a multi-step explanation. Self-explanatory findings
 * ("Good pacing", "Clear audio") render as text only.
 */
export function insightGraphic(ins: AnalysisInsight): InsightGraphic {
  if (Number.isFinite(ins.score as number)) return { kind: 'score', score: clamp(Number(ins.score), 0, 100) };
  if (ins.compare && ins.compare.before && ins.compare.after) return { kind: 'compare', before: ins.compare.before, after: ins.compare.after };
  if (Array.isArray(ins.steps) && ins.steps.length >= 2) return { kind: 'steps', steps: ins.steps.slice(0, 4) };
  if (ins.recommendation) return { kind: 'recommendation', recommendation: ins.recommendation };
  const t = String(ins.text || '');
  const scoreMatch = t.match(/\b(\d{1,3})\s*(?:\/\s*(\d{1,3})|%|percent\b|out of\s+(\d{1,3}))/i);
  if (scoreMatch) {
    const raw = Number(scoreMatch[1]);
    const denom = Number(scoreMatch[2] || scoreMatch[3] || 0);
    const score = denom > 0 ? (raw / denom) * 100 : raw;
    if (Number.isFinite(score)) return { kind: 'score', score: clamp(Math.round(score), 0, 100) };
  }
  if (/\b(vs\.?|versus|compared (?:to|with)|before and after|rather than)\b/i.test(t)) {
    return { kind: 'compare', before: 'Current', after: 'Suggested' };
  }
  if (/\b(should|recommend|consider|try (?:a|to|adding)|needs? (?:a|to|more)|would benefit)\b/i.test(t)) {
    return { kind: 'recommendation', recommendation: t };
  }
  if (/\b(first[,.]|then\b|next[,.]|finally\b|step \d)\b/i.test(t) || /\b\d\.\s/.test(t)) {
    const parts = t.split(/(?:[.;]\s+|\bthen\b|\bnext\b|\bfinally\b)/i).map((s) => s.trim()).filter((s) => s.length > 3).slice(0, 4);
    if (parts.length >= 2) return { kind: 'steps', steps: parts };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Text overlay canvas renderer (shared by live preview and burn-in export)
// ---------------------------------------------------------------------------

export interface TextHitRect { x: number; y: number; w: number; h: number }

export function drawTextOverlays(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  t: number,
  texts: TextOverlayItem[],
  hitRects?: Map<string, TextHitRect> | null,
  selectedId?: string | null,
): void {
  if (hitRects) hitRects.clear();
  for (const item of texts) {
    if (!item.text || t < item.start || t > item.end) continue;
    const fs = Math.max(10, Math.round(H * clamp(item.size, 0.02, 0.16)));
    ctx.font = '800 ' + fs + "px 'Inter', system-ui, sans-serif";
    const tw = Math.min(W * 0.94, ctx.measureText(item.text).width);
    const cx = clamp(item.x, 0.02, 0.98) * W;
    const cy = clamp(item.y, 0.03, 0.97) * H;
    const x = clamp(cx - tw / 2, 4, Math.max(4, W - tw - 4));
    const alpha = clamp(Math.min((t - item.start) / 0.25, (item.end - t) / 0.25, 1), 0, 1);
    ctx.globalAlpha = alpha;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, fs * 0.12);
    ctx.strokeStyle = 'rgba(4,6,12,0.72)';
    ctx.strokeText(item.text, x, cy, W * 0.94);
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = fs * 0.22;
    ctx.fillStyle = item.color;
    ctx.fillText(item.text, x, cy, W * 0.94);
    ctx.shadowBlur = 0;
    if (hitRects) hitRects.set(item.id, { x: x - 8, y: cy - fs * 0.75, w: tw + 16, h: fs * 1.5 });
    if (selectedId === item.id) {
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.strokeRect(x - 10, cy - fs * 0.85, tw + 20, fs * 1.7);
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
  }
}

/** Draw the vignette overlay (strength 0..100) onto the canvas. */
export function drawVignette(ctx: CanvasRenderingContext2D, W: number, H: number, strength: number): void {
  if (strength <= 0) return;
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,' + (0.62 * clamp(strength, 0, 100) / 100).toFixed(3) + ')');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

// ---------------------------------------------------------------------------
// Aspect-ratio crop math
// ---------------------------------------------------------------------------

export interface CropRect { cx: number; cy: number; cw: number; ch: number }

/** Centered cover-crop of the source frame for the chosen aspect preset. */
export function computeCrop(vw: number, vh: number, aspect: AspectPreset): CropRect {
  const preset = ASPECT_PRESETS.find((a) => a.id === aspect);
  if (!preset || preset.ratio === null || !vw || !vh) return { cx: 0, cy: 0, cw: vw, ch: vh };
  const srcRatio = vw / vh;
  let cw = vw, ch = vh;
  if (srcRatio > preset.ratio) cw = vh * preset.ratio;
  else ch = vw / preset.ratio;
  return { cx: (vw - cw) / 2, cy: (vh - ch) / 2, cw, ch };
}

// ---------------------------------------------------------------------------
// Export format / quality
// ---------------------------------------------------------------------------

export type ExportFormat = 'auto' | 'mp4' | 'webm';
export type ExportQuality = 'high' | 'standard' | 'compact';

export const QUALITY_OPTIONS: { id: ExportQuality; label: string; hint: string; bitrate: number }[] = [
  { id: 'high', label: 'High', hint: 'Max detail · biggest file', bitrate: 12_000_000 },
  { id: 'standard', label: 'Standard', hint: 'Balanced · recommended', bitrate: 8_000_000 },
  { id: 'compact', label: 'Compact', hint: 'Smaller file · quicker save', bitrate: 4_000_000 },
];

function firstSupported(candidates: string[]): string {
  for (const m of candidates) {
    try { if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m; } catch { /* keep looking */ }
  }
  return '';
}

const MP4_MIMES = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4'];
const WEBM_MIMES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

export function mp4Supported(): boolean { return !!firstSupported(MP4_MIMES); }

export function pickExportMime(format: ExportFormat): { mime: string; extension: 'mp4' | 'webm' } | null {
  if (format === 'mp4') { const m = firstSupported(MP4_MIMES); return m ? { mime: m, extension: 'mp4' } : null; }
  if (format === 'webm') { const m = firstSupported(WEBM_MIMES); return m ? { mime: m, extension: 'webm' } : null; }
  const m4 = firstSupported(MP4_MIMES);
  if (m4) return { mime: m4, extension: 'mp4' };
  const wb = firstSupported(WEBM_MIMES);
  return wb ? { mime: wb, extension: 'webm' } : null;
}

// ---------------------------------------------------------------------------
// Unified export engine
// ---------------------------------------------------------------------------

export interface SfxExportCue { id: string; at: number; volume: number; blob: Blob }

export interface RenderJobOptions {
  /** Kept segments, sorted, non-overlapping, in original-timeline seconds. */
  segments: { start: number; end: number }[];
  effects: EffectsState;
  overlays: OverlayElement[];
  texts: TextOverlayItem[];
  aspect: AspectPreset;
  muteOriginal: boolean;
  /** Original audio gain 0..1 (ignored when muted). */
  originalVolume: number;
  /** Optional generated music bed — mixed under/over the original audio. */
  music: { blob: Blob; volume: number } | null;
  /** Optional auto-generated captions — burned in at the same position as the live preview. */
  captions: { segments: CaptionSegment[]; styleId: CaptionStyleId; position?: CaptionPosition } | null;
  /** One-shot sound-effect cues, fired the instant playback crosses their moment. */
  sfx: SfxExportCue[];
  format: ExportFormat;
  quality: ExportQuality;
}

export interface RenderJobResult { blob: Blob; mimeType: string; extension: string }

function waitVideoEvent(el: HTMLVideoElement, ok: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      el.removeEventListener(ok, onOk);
      el.removeEventListener('error', onErr);
      window.clearTimeout(timer);
      if (err) reject(err); else resolve();
    };
    const onOk = () => finish();
    const onErr = () => finish(new Error('The browser could not decode this video.'));
    const timer = window.setTimeout(() => finish(new Error('Timed out waiting for the video to ' + ok + '.')), timeoutMs);
    el.addEventListener(ok, onOk);
    el.addEventListener('error', onErr);
  });
}

/**
 * Replay the footage once through a canvas + MediaRecorder pass, applying the
 * full edit: trim/cut segments (skipped in place), playback speed, color
 * filters + vignette, aspect crop, AI overlays, text overlays, adjustable or
 * muted original audio, and an optional looping music bed.
 */
export async function renderEditedVideo(
  source: Blob,
  opts: RenderJobOptions,
  onProgress?: (p: number) => void,
  onNote?: (n: string) => void,
): Promise<RenderJobResult> {
  const picked = pickExportMime(opts.format);
  if (!picked) throw new Error(opts.format === 'mp4' ? 'This browser cannot record MP4 — switch the format to WebM or Auto.' : 'This browser cannot record video (MediaRecorder unsupported).');

  const kept = opts.segments
    .map((s) => ({ start: Math.max(0, s.start), end: Math.max(0, s.end) }))
    .filter((s) => s.end - s.start > 0.05)
    .sort((a, b) => a.start - b.start);
  if (!kept.length) throw new Error('Everything is trimmed away — keep at least one segment before exporting.');
  const totalKept = kept.reduce((acc, s) => acc + (s.end - s.start), 0);

  const url = URL.createObjectURL(source);
  const video = document.createElement('video');
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  let acx: any = null;
  let canvasStream: MediaStream | null = null;
  try {
    await waitVideoEvent(video, 'loadedmetadata', 12000);
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (!duration || !video.videoWidth) throw new Error('The video has no readable duration or dimensions.');

    const vw = video.videoWidth, vh = video.videoHeight;
    const crop = computeCrop(vw, vh, opts.aspect);
    const scale = Math.min(1, 1920 / Math.max(crop.cw, crop.ch));
    const W = Math.max(2, Math.round(crop.cw * scale));
    const H = Math.max(2, Math.round(crop.ch * scale));
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create the export canvas.');

    // ---- Audio graph: original (gain), optional music bed, optional SFX cues ----
    const audioTracks: MediaStreamTrack[] = [];
    let musicSrc: AudioBufferSourceNode | null = null;
    let dest: any = null;
    const sfxBuffers = new Map<string, AudioBuffer>();
    const sfxFired = new Set<string>();
    const wantsOriginal = !opts.muteOriginal && opts.originalVolume > 0.001;
    const wantsMusic = !!opts.music;
    const wantsSfx = Array.isArray(opts.sfx) && opts.sfx.length > 0;
    if (wantsOriginal || wantsMusic || wantsSfx) {
      try {
        const AC: any = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (AC) {
          acx = new AC();
          dest = acx.createMediaStreamDestination();
          if (wantsOriginal) {
            const srcNode = acx.createMediaElementSource(video);
            const gOrig = acx.createGain();
            gOrig.gain.value = clamp(opts.originalVolume, 0, 1);
            srcNode.connect(gOrig);
            gOrig.connect(dest);
          } else {
            video.muted = true;
          }
          if (wantsMusic && opts.music) {
            onNote?.('Decoding the music bed…');
            const buf = await acx.decodeAudioData(await opts.music.blob.arrayBuffer());
            musicSrc = acx.createBufferSource();
            musicSrc.buffer = buf;
            musicSrc.loop = true;
            const gMusic = acx.createGain();
            gMusic.gain.value = clamp(opts.music.volume, 0, 1);
            musicSrc.connect(gMusic);
            gMusic.connect(dest);
          }
          if (wantsSfx) {
            onNote?.('Decoding sound effects…');
            for (const cue of opts.sfx) {
              try { sfxBuffers.set(cue.id, await acx.decodeAudioData(await cue.blob.arrayBuffer())); }
              catch { /* a broken clip is simply skipped */ }
            }
          }
          for (const tr of dest.stream.getAudioTracks()) audioTracks.push(tr);
          if (acx.state === 'suspended') await acx.resume();
        } else {
          video.muted = true;
        }
      } catch (e) {
        console.warn('[VideoEnhancer] export continues without audio: ' + msg(e));
        video.muted = true;
      }
    } else {
      video.muted = true;
    }

    canvasStream = (canvas as any).captureStream ? (canvas as any).captureStream(30) : null;
    if (!canvasStream) throw new Error('This browser cannot capture a canvas stream.');
    const mixed = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]);
    const bitrate = (QUALITY_OPTIONS.find((q) => q.id === opts.quality) || QUALITY_OPTIONS[1]).bitrate;
    const rec = new MediaRecorder(mixed, { mimeType: picked.mime, videoBitsPerSecond: bitrate, audioBitsPerSecond: 160_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise<void>((resolve) => { rec.onstop = () => resolve(); });

    const activeOverlays = opts.overlays.filter((e) => e.enabled);
    const fCss = filterCss(opts.effects);
    const fullW = vw * scale, fullH = vh * scale;
    const offX = -crop.cx * scale, offY = -crop.cy * scale;
    // Backdrop framing: the full frame floats contained on the backdrop with a
    // small margin; overlays and texts stay anchored to the footage itself.
    const backdrop: BackdropMode = opts.effects.backdrop && opts.effects.backdrop !== 'none' ? opts.effects.backdrop : 'none';
    const fitScale = backdrop !== 'none' ? Math.min((W * 0.92) / vw, (H * 0.92) / vh) : 0;
    const fitW = vw * fitScale, fitH = vh * fitScale;
    const fitX = (W - fitW) / 2, fitY = (H - fitH) / 2;

    const paint = () => {
      if (backdrop !== 'none') {
        drawBackdropFrame(ctx, W, H, video, backdrop);
        ctx.save();
        if (fCss !== 'none') ctx.filter = fCss;
        ctx.drawImage(video, 0, 0, vw, vh, fitX, fitY, fitW, fitH);
        ctx.restore();
        drawVignette(ctx, W, H, opts.effects.vignette);
        ctx.save();
        ctx.translate(fitX, fitY);
        drawOverlays(ctx, fitW, fitH, video.currentTime, activeOverlays);
        drawTextOverlays(ctx, fitW, fitH, video.currentTime, opts.texts);
        ctx.restore();
      } else {
        ctx.save();
        if (fCss !== 'none') ctx.filter = fCss;
        ctx.drawImage(video, crop.cx, crop.cy, crop.cw, crop.ch, 0, 0, W, H);
        ctx.restore();
        drawVignette(ctx, W, H, opts.effects.vignette);
        ctx.save();
        ctx.translate(offX, offY);
        drawOverlays(ctx, fullW, fullH, video.currentTime, activeOverlays);
        drawTextOverlays(ctx, fullW, fullH, video.currentTime, opts.texts);
        ctx.restore();
      }
      if (opts.captions && opts.captions.segments.length) {
        drawCaptionOverlay(ctx, W, H, video.currentTime, opts.captions.segments, opts.captions.styleId, opts.captions.position);
      }
    };

    // One-shot SFX cues fire the instant real-time playback crosses their moment —
    // this mirrors the live preview exactly, so export timing always matches.
    const fireSfxAt = (time: number) => {
      if (!wantsSfx || !dest || !acx) return;
      for (const cue of opts.sfx) {
        if (sfxFired.has(cue.id) || time < cue.at) continue;
        sfxFired.add(cue.id);
        const buf = sfxBuffers.get(cue.id);
        if (!buf) continue;
        try {
          const src = acx.createBufferSource();
          src.buffer = buf;
          const g = acx.createGain();
          g.gain.value = clamp(cue.volume, 0, 1);
          src.connect(g);
          g.connect(dest);
          src.start();
        } catch { /* a failed one-shot must never interrupt the export */ }
      }
    };

    let segIdx = 0;
    let doneTime = 0;
    let finished = false;
    let seeking = false;
    let finishPlayback: () => void = () => undefined;
    const playbackDone = new Promise<void>((resolve) => { finishPlayback = () => { if (!finished) { finished = true; resolve(); } }; });
    video.onended = () => finishPlayback();

    const tick = () => {
      if (finished) return;
      const seg = kept[segIdx];
      const t = video.currentTime;
      fireSfxAt(t);
      if (!seeking && seg && t >= seg.end - 0.04) {
        doneTime += seg.end - seg.start;
        segIdx++;
        if (segIdx >= kept.length) { finishPlayback(); return; }
        seeking = true;
        const nextStart = kept[segIdx].start;
        const onSeeked = () => { seeking = false; video.removeEventListener('seeked', onSeeked); };
        video.addEventListener('seeked', onSeeked);
        video.currentTime = nextStart;
      } else {
        paint();
        const cur = kept[Math.min(segIdx, kept.length - 1)];
        const inSeg = cur ? clamp(t - cur.start, 0, cur.end - cur.start) : 0;
        onProgress?.(clamp((doneTime + inSeg) / totalKept, 0, 0.995));
      }
      if ((video as any).requestVideoFrameCallback) (video as any).requestVideoFrameCallback(tick);
      else requestAnimationFrame(tick);
    };

    // Seek to the first kept moment before recording starts.
    if (kept[0].start > 0.05) {
      video.currentTime = kept[0].start;
      await waitVideoEvent(video, 'seeked', 8000);
    }
    video.playbackRate = clamp(opts.effects.speed || 1, 0.25, 4);
    paint();
    rec.start(500);
    try { if (musicSrc) musicSrc.start(); } catch { /* already started */ }
    await video.play();
    tick();
    await playbackDone;
    video.pause();
    paint();
    await new Promise((r) => { setTimeout(r, 240); });
    rec.stop();
    await stopped;
    try { if (musicSrc) musicSrc.stop(); } catch { /* no-op */ }
    const blob = new Blob(chunks, { type: picked.mime.split(';')[0] });
    if (!blob.size) throw new Error('The export produced no data — try again.');
    onProgress?.(1);
    return { blob, mimeType: picked.mime.split(';')[0], extension: picked.extension };
  } finally {
    try { if (acx) acx.close(); } catch { /* no-op */ }
    try { if (canvasStream) canvasStream.getTracks().forEach((tr: MediaStreamTrack) => tr.stop()); } catch { /* no-op */ }
    URL.revokeObjectURL(url);
  }
}
