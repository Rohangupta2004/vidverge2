/**
 * DESIGN WITH AI — shared types, DB access and helpers.
 *
 * A separate, additive mode inside the Product Video app:
 *
 *   Upload video → word-timed transcript (Deepgram; SRT/VTT import skips
 *   retranscription) → Claude Opus 5 analyses transcript + video frames
 *   (talking-head detection, brand) → per-timestamp VISUAL PLAN → GSAP + SVG
 *   overlay motion graphics (compositable overlays — the original video is
 *   NEVER modified) → deterministic transcript sync → agentic quality check
 *   (Opus vision on composited frames, fixes only the flagged graphics) →
 *   live browser preview + editable timeline → canvas + FFmpeg export.
 *
 * Entirely separate from the AI Film / My Videos / Script Mode flows — it
 * reuses their platform plumbing (uploads, hooks, Opus proxy) but shares no
 * state with them. Every stage persists to the design_projects table the
 * moment it lands, so a reload resumes mid-run.
 */

export { T, uploadBlob, uploadDataUrl, callHook, wsToken, appId } from '../film/api';

function wdb(): any {
  const db = typeof window !== 'undefined' ? (window as any).__workspaceDb : null;
  if (!db) throw new Error('Your workspace session is still loading — try again in a moment.');
  return db;
}

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export type DesignStatus = 'draft' | 'transcribing' | 'planning' | 'generating' | 'syncing' | 'checking' | 'ready' | 'error';

export type StylePref = 'auto_brand' | 'minimal' | 'cinematic';
export type Density = 'minimal' | 'balanced' | 'rich';
export type LayoutPref = 'auto' | 'head_right' | 'head_left' | 'head_top' | 'dynamic' | 'full_screen';

export interface DesignWord { word: string; start: number; end: number }

export interface DesignSegment {
  id: string;
  start: number;
  end: number;
  text: string;
  words: DesignWord[];
  speaker?: string | null;
}

export interface DesignTranscript {
  words: DesignWord[];
  segments: DesignSegment[];
  source: 'auto' | 'srt' | 'vtt';
}

/** Where the talking head sits in the frame (fractions of frame size). */
export interface HeadInfo {
  position: 'left' | 'center' | 'right' | 'top' | 'none';
  box?: { x: number; y: number; w: number; h: number } | null;
  confidence?: number;
  notes?: string;
}

export interface DesignPalette { bg: string; ink: string; accent: string; accent2: string }

/** The overlay treatments the deterministic GSAP + SVG engine can render.
 * Graphics-first by design — text-only treatments are for short emphasis. */
export type OverlayTreatment =
  | 'kinetic_type'    // 1-6 punchy words, kinetic typography
  | 'lower_third'     // name/label bar sliding in at the bottom
  | 'stat'            // big animated number (+ ring) for a spoken figure
  | 'bar_chart'       // 2-5 animated bars comparing values
  | 'decay_chart'     // declining curve/bars (e.g. retention over time)
  | 'list_reveal'     // checklist of 2-5 short items
  | 'callout'         // pill + drawn leader line pointing into the frame
  | 'arrow_flow'      // 2-4 step flow with drawn arrows
  | 'icon_badge'      // 1-3 large animated icons with tiny labels
  | 'diagram'         // hub-and-spoke mini diagram
  | 'progress'        // animated progress bar with a percentage
  | 'compare'         // two mini panels: A vs B
  | 'quote_card'      // short quote emphasis
  | 'image_card'      // real screenshot / uploaded asset in a floating card
  | 'broll';          // REAL AI-generated footage cutaway (Omni) — video, not SVG

/** Where the graphic's content block sits — the engine keeps it out of the
 * talking-head safe area automatically. */
export type OverlayPosition = 'left_third' | 'right_third' | 'top_third' | 'bottom_third' | 'lower_third' | 'center' | 'full';

export type AnimIn = 'fade' | 'fade_slide_left' | 'fade_slide_right' | 'fade_slide_up' | 'fade_slide_down' | 'pop' | 'wipe';
export type AnimOut = 'fade' | 'slide_left' | 'slide_right' | 'slide_down' | 'shrink';

/** Names the icon library understands — Opus picks from this list. */
export const ICON_NAMES = [
  'calendar', 'clock', 'chart_up', 'chart_down', 'bolt', 'shield', 'gear',
  'check', 'cross', 'star', 'search', 'brain', 'target', 'rocket', 'dollar',
  'users', 'heart', 'lock', 'bell', 'book', 'bulb', 'phone', 'mail', 'globe',
] as const;
export type IconName = typeof ICON_NAMES[number];

export interface OverlayItem { label: string; sublabel?: string; value?: number; icon?: string }

export interface OverlaySpec {
  title?: string;
  subtitle?: string;
  items?: OverlayItem[];
  stat?: { value: number; prefix?: string; suffix?: string; label?: string };
  icons?: string[];              // icon_badge: names from ICON_NAMES
  imageUrl?: string;             // image_card: a real screenshot / asset URL
  leftTitle?: string; rightTitle?: string;
  leftItems?: string[]; rightItems?: string[];
  percent?: number;              // progress
  palette?: Partial<DesignPalette>;
}

/** One compositable overlay graphic on the timeline. */
export interface DesignGraphic {
  id: string;
  start: number;                 // seconds into the video
  end: number;
  narration_ref: string;         // the spoken words this graphic supports
  visual_concept: string;        // what it communicates and why
  treatment: OverlayTreatment;
  position: OverlayPosition;
  anim_in: AnimIn;
  anim_out: AnimOut;
  scale: number;                 // 0.5 .. 1.4 content scale
  opacity: number;               // 0.2 .. 1
  spec: OverlaySpec;
  enabled: boolean;
  /** Omni footage cutaway — true ONLY when actual video footage is needed. */
  use_omni?: boolean;
  /** The detailed Omni prompt Opus wrote for this cue (no on-screen text). */
  omni_prompt?: string | null;
  /** The generated footage clip, composited over the video at this window. */
  clip_url?: string | null;
  clip_error?: string | null;
  /** Bumped on every edit/regenerate so preview + export caches rebuild. */
  rev: number;
}

export interface DesignPlan {
  creative_direction: string;
  palette: DesignPalette;
  notes?: string[];
}

export interface QaIssue { graphic_id: string; issue: string; fix_hint?: string; fixed?: boolean }
export interface QaReport { pass: boolean; checked_at: string; issues: QaIssue[]; summary?: string }

export interface DesignAsset { url: string; shows: string }

export interface DesignBrand {
  colors?: { primary?: string | null; secondary?: string | null; accent?: string | null; background?: string | null; text?: string | null };
  typography?: { style?: string | null; heading_font?: string | null } | null;
  tone_of_voice?: string | null;
  product_name?: string | null;
}

export interface DesignProject {
  id: number;
  title: string | null;
  video_url: string | null;
  video_w: number | null;
  video_h: number | null;
  video_duration_s: number | null;
  transcript: DesignTranscript | null;
  product_url: string | null;
  style: StylePref | null;
  density: Density | null;
  layout_pref: LayoutPref | null;
  head: HeadInfo | null;
  brand: DesignBrand | null;
  assets: DesignAsset[] | null;
  plan: DesignPlan | null;
  graphics: DesignGraphic[] | null;
  status: DesignStatus | null;
  stage_note: string | null;
  qa: QaReport | null;
  final_video_url: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// WorkspaceDB access (browser SDK — session-scoped rows)
// ---------------------------------------------------------------------------

export const designDb = {
  async list(): Promise<DesignProject[]> {
    const { data } = await wdb().from('design_projects').orderBy('created_at', 'desc').limit(100).get();
    return Array.isArray(data) ? data : [];
  },
  async get(id: number): Promise<DesignProject | null> {
    const { data } = await wdb().from('design_projects').getById(id);
    return (data as DesignProject) || null;
  },
  async create(row: Partial<DesignProject>): Promise<DesignProject> {
    const res = await wdb().from('design_projects').insert(row);
    const created = res?.data?.[0] || res?.data || res;
    if (!created?.id) {
      const all = await this.list();
      if (all[0]?.id) return all[0];
      throw new Error('The design project could not be created.');
    }
    return created as DesignProject;
  },
  async update(id: number, patch: Partial<DesignProject>): Promise<void> {
    await wdb().from('design_projects').update(id, { ...patch, updated_at: new Date().toISOString() });
  },
  async remove(id: number): Promise<void> {
    await wdb().from('design_projects').delete(id);
  },
};

// ---------------------------------------------------------------------------
// Stages (the progress rail mirrors the agentic pipeline)
// ---------------------------------------------------------------------------

export const DESIGN_STAGES: { id: DesignStatus; label: string }[] = [
  { id: 'planning', label: 'Generating Visual Plan' },
  { id: 'generating', label: 'Creating Graphics' },
  { id: 'syncing', label: 'Syncing to Transcript' },
  { id: 'checking', label: 'Quality Check' },
];

export function designStageIndex(status: DesignStatus | null): number {
  const i = DESIGN_STAGES.findIndex((s) => s.id === status);
  if (i >= 0) return i;
  return status === 'ready' ? DESIGN_STAGES.length : -1;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function newGraphicId(): string {
  return `dg_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

export function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Composited frame geometry for a project (capped for preview + export). */
export function designFrameSize(p: Pick<DesignProject, 'video_w' | 'video_h'>): { W: number; H: number } {
  const w = Number(p.video_w) || 1920;
  const h = Number(p.video_h) || 1080;
  const cap = 1920 / Math.max(w, h);
  const scale = Math.min(1, cap);
  return { W: Math.max(2, Math.round(w * scale / 2) * 2), H: Math.max(2, Math.round(h * scale / 2) * 2) };
}

export const DEFAULT_PALETTE: DesignPalette = { bg: '#101418', ink: '#F5F3EE', accent: '#FF6B4A', accent2: '#7FD4B4' };

export function paletteFromBrand(brand: DesignBrand | null | undefined): DesignPalette {
  const c = brand?.colors || null;
  const hex = (v: unknown, fb: string) => (typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : fb);
  return {
    bg: hex(c?.background, DEFAULT_PALETTE.bg),
    ink: hex(c?.text, DEFAULT_PALETTE.ink),
    accent: hex(c?.primary, DEFAULT_PALETTE.accent),
    accent2: hex(c?.accent, hex(c?.secondary, DEFAULT_PALETTE.accent2)),
  };
}

/** Probe a video file locally for duration + dimensions before upload. */
export function probeVideoFile(file: File): Promise<{ duration: number; w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    const guard = setTimeout(() => { URL.revokeObjectURL(url); reject(new Error('The video took too long to read.')); }, 30000);
    v.onloadedmetadata = () => {
      clearTimeout(guard);
      const out = { duration: Number(v.duration) || 0, w: Number(v.videoWidth) || 0, h: Number(v.videoHeight) || 0 };
      URL.revokeObjectURL(url);
      v.removeAttribute('src');
      resolve(out);
    };
    v.onerror = () => { clearTimeout(guard); URL.revokeObjectURL(url); reject(new Error('This file could not be read as a video.')); };
    v.src = url;
  });
}
