/**
 * Video Enhancer NLE — shared model, constants and server-hook transport.
 *
 * The editor is a timeline NLE (preview / tools + properties / 3-track
 * timeline). All heavy computation runs in server functions:
 *   veh-gemini-describe  — frame analysis (vision model via the AI proxy)
 *   veh-broll-generate   — prompt → Omni Flash clip (server submit + poll)
 *   veh-render           — the whole edit → platform Remotion render → MP4
 */
import { LB, LB_TRACKS } from '../../components/LightBeam';

export { LB, LB_TRACKS };

export function nleAppId(): string {
  if (typeof window === 'undefined') return 'workspace-660069';
  return String((window as any).__APP_ID__ || (window as any).__SPACE_ID__ || 'workspace-660069');
}

export function nleToken(): string {
  if (typeof window === 'undefined') return '';
  return String((window as any).__workspaceDb?.token || '');
}

/** POST a server hook and unwrap the { response, _meta } envelope. */
export async function callHook(name: string, payload: Record<string, unknown>): Promise<any> {
  const res = await fetch(`/api/hooks/execute/${nleAppId()}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(nleToken() ? { 'X-Workspace-DB-Token': nleToken() } : {}),
    },
    body: JSON.stringify(payload),
  });
  const raw = await res.json().catch(() => null);
  const data = raw && typeof raw === 'object' && raw.response !== undefined && raw._meta !== undefined ? raw.response : raw;
  if (!res.ok) throw new Error(String(data?.error || `The ${name} service answered HTTP ${res.status}.`));
  return data || {};
}

// ---------------------------------------------------------------------------
// Timeline model
// ---------------------------------------------------------------------------

export type TrackId = 'video' | 'audio' | 'captions';

export interface NleClip {
  id: string;
  label: string;
  url: string;              // durable https URL (export) — may equal previewUrl
  previewUrl: string;       // blob: or https URL the <video> plays
  sourceDuration: number;   // seconds of source footage
  in: number;               // trim in-point (source seconds)
  out: number;              // trim out-point (source seconds)
  speed: number;            // 0.5 | 1 | 1.5 | 2
  opacity: number;          // 0..1
  text: string;             // text overlay burned during this clip
  textSize: number;
  textColor: string;
  kind: 'source' | 'broll';
}

export interface NleCaption { id: string; text: string; start: number; end: number }

export interface GeminiAnalysis {
  subject: string;
  dominantColors: string[];
  backgroundType: string;
  lightingStyle: string;
  mood: string;
  suggestedEnhancements: string[];
}

export function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
}

/** A clip's length on the timeline (trims + speed applied). */
export function clipTimelineLength(c: NleClip): number {
  return Math.max(0.05, (c.out - c.in) / Math.max(0.1, c.speed));
}

export function timelineDuration(clips: NleClip[]): number {
  return clips.reduce((n, c) => n + clipTimelineLength(c), 0);
}

/** Map a timeline position onto (clip index, source-seconds within it). */
export function locate(clips: NleClip[], t: number): { index: number; sourceT: number; clipStart: number } | null {
  let cursor = 0;
  for (let i = 0; i < clips.length; i += 1) {
    const len = clipTimelineLength(clips[i]);
    if (t < cursor + len || i === clips.length - 1) {
      const within = Math.max(0, Math.min(len, t - cursor));
      return { index: i, sourceT: clips[i].in + within * clips[i].speed, clipStart: cursor };
    }
    cursor += len;
  }
  return null;
}

export function clipStartOnTimeline(clips: NleClip[], index: number): number {
  let cursor = 0;
  for (let i = 0; i < index; i += 1) cursor += clipTimelineLength(clips[i]);
  return cursor;
}

// ---------------------------------------------------------------------------
// Property vocabularies
// ---------------------------------------------------------------------------

export const SPEED_OPTIONS = [0.5, 1, 1.5, 2] as const;

export const COLOR_GRADES = [
  { id: 'none', label: 'None', css: 'none' },
  { id: 'film', label: 'Film', css: 'contrast(1.08) saturate(1.12) sepia(0.10) brightness(1.02)' },
  { id: 'kodak', label: 'Kodak', css: 'contrast(1.05) saturate(1.28) hue-rotate(-5deg) brightness(1.04)' },
  { id: 'tealorange', label: 'Teal+Orange', css: 'contrast(1.12) saturate(1.25) hue-rotate(8deg)' },
  { id: 'bw', label: 'BW', css: 'grayscale(1) contrast(1.15)' },
] as const;
export type ColorGradeId = (typeof COLOR_GRADES)[number]['id'];

/** Style Transfer looks — preview filter + the export grade each maps onto. */
export const STYLE_TRANSFERS = [
  { id: 'cinematic', label: 'Cinematic', css: 'contrast(1.12) saturate(1.25) hue-rotate(8deg)', grade: 'tealorange' as ColorGradeId },
  { id: 'vibrant', label: 'Vibrant', css: 'contrast(1.05) saturate(1.28) hue-rotate(-5deg) brightness(1.04)', grade: 'kodak' as ColorGradeId },
  { id: 'dark', label: 'Dark', css: 'contrast(1.15) saturate(1.05) brightness(0.9)', grade: 'film' as ColorGradeId },
  { id: 'vintage', label: 'Vintage', css: 'contrast(1.08) saturate(1.12) sepia(0.10) brightness(1.02)', grade: 'film' as ColorGradeId },
  { id: 'minimal', label: 'Minimal', css: 'none', grade: 'none' as ColorGradeId },
] as const;

/** Workspace-cached ElevenLabs beds (pv_music_tracks — durable GCS URLs). */
export const MUSIC_BEDS = [
  { id: 'inspiring', label: 'Inspiring', url: 'https://storage.googleapis.com/audos-images/workspaces/f24710e5-7c6d-4db4-92b4-c2c235877575/audio/background-music-1790352381300.mp3' },
  { id: 'cinematic-dark', label: 'Cinematic Dark', url: 'https://storage.googleapis.com/audos-images/workspaces/f24710e5-7c6d-4db4-92b4-c2c235877575/audio/background-music-1790352397219.mp3' },
  { id: 'energetic', label: 'Energetic', url: 'https://storage.googleapis.com/audos-images/workspaces/f24710e5-7c6d-4db4-92b4-c2c235877575/audio/background-music-1790352412992.mp3' },
  { id: 'calm', label: 'Calm', url: 'https://storage.googleapis.com/audos-images/workspaces/f24710e5-7c6d-4db4-92b4-c2c235877575/audio/background-music-1790352426863.mp3' },
  { id: 'luxury', label: 'Luxury', url: 'https://storage.googleapis.com/audos-images/workspaces/f24710e5-7c6d-4db4-92b4-c2c235877575/audio/background-music-1790352446075.mp3' },
] as const;
export type MusicBedId = (typeof MUSIC_BEDS)[number]['id'] | 'none';

// ---------------------------------------------------------------------------
// Captions — transcript words → estimated timecodes → chunked captions
// ---------------------------------------------------------------------------

/** Split a pasted transcript into ~4-word captions spread evenly over the
 * timeline duration (words / total seconds estimation). */
export function estimateCaptions(transcript: string, totalSeconds: number): NleCaption[] {
  const words = String(transcript || '').split(/\s+/).map((w) => w.trim()).filter(Boolean);
  if (!words.length || totalSeconds <= 0) return [];
  const perWord = totalSeconds / words.length;
  const captions: NleCaption[] = [];
  const CHUNK = 4;
  for (let i = 0; i < words.length; i += CHUNK) {
    const chunk = words.slice(i, i + CHUNK);
    const start = i * perWord;
    const end = Math.min(totalSeconds, (i + chunk.length) * perWord);
    captions.push({ id: newId('cap'), text: chunk.join(' '), start, end: Math.max(start + 0.4, end) });
  }
  return captions;
}

// ---------------------------------------------------------------------------
// Frame capture — draw the video to a canvas at ~1s for Gemini Describe
// ---------------------------------------------------------------------------

export function captureFrameBase64(srcUrl: string, atSeconds = 1): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.preload = 'auto';
    v.muted = true;
    let settled = false;
    const fail = (m: string) => { if (!settled) { settled = true; cleanup(); reject(new Error(m)); } };
    const cleanup = () => { v.removeAttribute('src'); try { v.load(); } catch { /* no-op */ } };
    const timer = setTimeout(() => fail('The frame could not be captured (timeout).'), 20000);
    v.addEventListener('error', () => { clearTimeout(timer); fail('The video could not be decoded for frame capture.'); });
    v.addEventListener('loadedmetadata', () => {
      const t = Math.min(Math.max(0.1, atSeconds), Math.max(0.1, (v.duration || 2) - 0.05));
      const onSeeked = () => {
        try {
          const scale = Math.min(1, 1280 / Math.max(1, v.videoWidth));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(2, Math.round(v.videoWidth * scale));
          canvas.height = Math.max(2, Math.round(v.videoHeight * scale));
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('No 2D canvas context.');
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          clearTimeout(timer);
          settled = true;
          cleanup();
          resolve({ base64: dataUrl.split(',')[1] || '', mimeType: 'image/jpeg' });
        } catch (e: any) {
          clearTimeout(timer);
          fail(String(e?.message || e));
        }
      };
      v.addEventListener('seeked', onSeeked, { once: true });
      try { v.currentTime = t; } catch { onSeeked(); }
    });
    v.src = srcUrl;
  });
}

export function fmtTimecode(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Output format
// ---------------------------------------------------------------------------

export type AspectId = '16:9' | '9:16';

// ---------------------------------------------------------------------------
// Effects — proper grade controls, previewed live and applied identically in
// the server render (veh-render composes the same CSS filter string).
// ---------------------------------------------------------------------------

export interface NleEffects {
  brightness: number;  // 50..160, 100 = neutral
  contrast: number;    // 50..160
  saturation: number;  // 0..200
  blur: number;        // 0..12 px
  vignette: number;    // 0..100
}

export const DEFAULT_NLE_EFFECTS: NleEffects = { brightness: 100, contrast: 100, saturation: 100, blur: 0, vignette: 0 };

export function effectsFilterCss(e: NleEffects): string {
  const f: string[] = [];
  if (e.brightness !== 100) f.push(`brightness(${(e.brightness / 100).toFixed(3)})`);
  if (e.contrast !== 100) f.push(`contrast(${(e.contrast / 100).toFixed(3)})`);
  if (e.saturation !== 100) f.push(`saturate(${(e.saturation / 100).toFixed(3)})`);
  if (e.blur > 0) f.push(`blur(${e.blur}px)`);
  return f.join(' ');
}

// ---------------------------------------------------------------------------
// Kinetic motion graphics — quality-first presets for short-form content.
// The preview (nleGraphics.tsx) and the export composition (veh-render) run
// the SAME progress math, so what you see is what renders.
// ---------------------------------------------------------------------------

export type GraphicKind = 'hook' | 'pop' | 'lowerthird' | 'stat' | 'cta';
export type GraphicPosition = 'top' | 'center' | 'lower';

export interface MotionGraphic {
  id: string;
  kind: GraphicKind;
  text: string;
  sub: string;
  value: number;       // stat count-up target
  start: number;       // timeline seconds
  duration: number;    // seconds
  accent: string;
  position: GraphicPosition;
}

export const GRAPHIC_PRESETS: { kind: GraphicKind; label: string; hint: string }[] = [
  { kind: 'hook', label: 'Hook Title', hint: 'Word-by-word kinetic headline with an accent underline sweep' },
  { kind: 'pop', label: 'Keyword Pop', hint: 'Punchy 1–3 word overshoot pop with an amber glow' },
  { kind: 'lowerthird', label: 'Lower Third', hint: 'Name + handle slide-in on a growing accent bar' },
  { kind: 'stat', label: 'Big Stat', hint: 'Count-up number in a glowing ring with a label' },
  { kind: 'cta', label: 'CTA Banner', hint: 'Follow / subscribe pill rising in with a pulsing glow' },
];

export function newGraphic(kind: GraphicKind, at: number): MotionGraphic {
  const base = { id: newId('gfx'), kind, start: Math.max(0, Math.round(at * 10) / 10), accent: '#f59e0b', value: 0 };
  switch (kind) {
    case 'hook': return { ...base, text: 'STOP SCROLLING', sub: '', duration: 2.6, position: 'top' };
    case 'pop': return { ...base, text: 'WAIT FOR IT', sub: '', duration: 1.6, position: 'center' };
    case 'lowerthird': return { ...base, text: 'Your Name', sub: '@yourhandle', duration: 3.5, position: 'lower' };
    case 'stat': return { ...base, text: '+', sub: 'creators already in', value: 4900, duration: 3, position: 'center' };
    default: return { ...base, text: 'FOLLOW', sub: 'for more like this', duration: 3, position: 'lower' };
  }
}

/** Shared easing — identical curves in preview and render. */
export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const easeOutBack = (t: number) => { const c1 = 1.70158; const c3 = c1 + 1; const x = clamp01(t) - 1; return 1 + c3 * x * x * x + c1 * x * x; };
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);

// ---------------------------------------------------------------------------
// Cut helpers — split-at-playhead and silence-cut (AI Edit)
// ---------------------------------------------------------------------------

/** Split one clip at a SOURCE time into two clips. Returns a new list (or the
 * original when the split point is too close to an edge). */
export function splitClipAt(clips: NleClip[], id: string, sourceT: number): NleClip[] {
  const i = clips.findIndex((c) => c.id === id);
  if (i < 0) return clips;
  const c = clips[i];
  if (sourceT - c.in < 0.2 || c.out - sourceT < 0.2) return clips;
  const a: NleClip = { ...c, id: newId('clip'), out: sourceT };
  const b: NleClip = { ...c, id: newId('clip'), in: sourceT };
  return [...clips.slice(0, i), a, b, ...clips.slice(i + 1)];
}

/** Replace one clip with subclips covering only the KEPT source ranges — the
 * silence-cut edit. Ranges outside the clip's trim window are clamped away. */
export function replaceClipWithRanges(clips: NleClip[], id: string, keeps: { start: number; end: number }[]): NleClip[] {
  const i = clips.findIndex((c) => c.id === id);
  if (i < 0) return clips;
  const c = clips[i];
  const subs: NleClip[] = [];
  keeps.forEach((r) => {
    const s = Math.max(c.in, r.start);
    const e = Math.min(c.out, r.end);
    if (e - s >= 0.35) subs.push({ ...c, id: newId('clip'), in: s, out: e, label: c.label });
  });
  if (!subs.length) return clips;
  return [...clips.slice(0, i), ...subs, ...clips.slice(i + 1)];
}

/** Map a SOURCE-time (of the given source url) onto the timeline, or null when
 * that moment was cut away. */
export function sourceToTimeline(clips: NleClip[], previewUrl: string, srcT: number): number | null {
  let cursor = 0;
  for (const c of clips) {
    const len = clipTimelineLength(c);
    if (c.previewUrl === previewUrl && srcT >= c.in - 0.05 && srcT <= c.out + 0.05) {
      const within = Math.max(0, Math.min(c.out, srcT) - c.in) / Math.max(0.1, c.speed);
      return cursor + Math.min(within, len);
    }
    cursor += len;
  }
  return null;
}
