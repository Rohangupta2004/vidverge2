// The data layer of the SceneForge Motion Graphics Editor.
//
// The editor is strictly POST-PRODUCTION: a finished HeyGen avatar MP4 is the
// base layer and nothing here ever asks HeyGen to render it again. Everything
// the customer adds — text, brand plates, image B-roll, HyperFrames cards,
// music, captions — is stored as a timed layer in an edit manifest and is
// composited by the platform's server-side ffmpeg/Remotion passes at export.
//
// The manifest is deliberately SPLIT BY LAYER TYPE (text / brand / images /
// cards / music / caption style) and the caption transcript is persisted in
// its own column, so no single JSON blob grows without a bound.

import { defaultCinematicSpec, normalizeCinematicSpec, type CinematicSpec } from './motionPresets';

export type { CinematicSpec };

export type AspectRatio = '9:16' | '16:9';
// 'clip-reveal' and 'mask-wipe' are the cinematic entrances: the type is
// uncovered behind a moving edge rather than faded up. They are real in the
// export too — motionPlates clips the canvas the same way the preview clips
// the DOM — so they are not a preview-only flourish.
export type Anim = 'none' | 'fade' | 'slide-up' | 'typewriter' | 'pop' | 'clip-reveal' | 'mask-wipe';
export const ANIM_VALUES = ['none', 'fade', 'slide-up', 'typewriter', 'pop', 'clip-reveal', 'mask-wipe'] as const;
export type LayerType = 'text' | 'brand' | 'image' | 'card' | 'caption' | 'music' | 'base';

/** The pixel frame each aspect ratio is composited at, server-side. */
export const FRAME: Record<AspectRatio, { w: number; h: number }> = {
  '9:16': { w: 1080, h: 1920 },
  '16:9': { w: 1920, h: 1080 },
};

export const ANIMATIONS: { value: Anim; label: string }[] = [
  { value: 'clip-reveal', label: 'Clip reveal' },
  { value: 'mask-wipe', label: 'Mask wipe' },
  { value: 'fade', label: 'Fade in' },
  { value: 'slide-up', label: 'Slide up' },
  { value: 'typewriter', label: 'Typewriter' },
  { value: 'pop', label: 'Pop' },
  { value: 'none', label: 'Cut on' },
];

// Poppins and Inter lead: they are the two families the editor loads from
// Google Fonts, so they are the only two guaranteed to rasterise into a
// plate exactly as previewed. The rest are system fallbacks.
export const FONTS = ['Poppins', 'Inter', 'Georgia', 'Impact', 'Courier New', 'Trebuchet MS'];

export interface TimedLayer {
  id: string;
  /** Seconds from the start of the base video. */
  start: number;
  /** Seconds the layer stays on screen. */
  duration: number;
  hidden?: boolean;
}

export type TextKind = 'headline' | 'subheadline' | 'caption-box';

export interface TextLayer extends TimedLayer {
  kind: TextKind;
  text: string;
  font: string;
  sizePx: number;
  weight: number;
  color: string;
  align: 'left' | 'center' | 'right';
  /** Normalised centre of the box, 0–1 of the frame. */
  x: number;
  y: number;
  /** Box width as a fraction of the frame width. */
  width: number;
  anim: Anim;
  plate: 'none' | 'pill' | 'bar';
  plateColor: string;
  /** Letter-spacing in em. Cinematic presets track a title wide; 0 is normal. */
  trackingEm?: number;
  /** Soft accent glow under the type — the Neon preset's signature. */
  glow?: boolean;
  /** Second gradient stop for the backdrop. Absent means a flat plateColor. */
  plateGradientTo?: string;
}

export type BrandKind = 'logo' | 'accent-bar' | 'lower-third';

export interface BrandLayer extends TimedLayer {
  kind: BrandKind;
  /** Logo placement / accent-bar edge. */
  corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  logoUrl: string;
  /** Logo width as a fraction of the frame width. */
  scale: number;
  opacity: number;
  color: string;
  accentColor: string;
  /** Lower-third copy. */
  name: string;
  role: string;
  anim: Anim;
  /** Draw the lower-third backdrop as an accent gradient, not a flat box. */
  gradient?: boolean;
}

export interface ImageLayer extends TimedLayer {
  url: string;
  label: string;
  transition: 'fade' | 'zoom-in' | 'slide';
  fit: 'cover' | 'contain';
}

// The HyperFrame bundles (lib/hyperFrameBundles). The first four are the
// editor's original cards; the last three exist because SceneForge's PRODUCT
// graphic beats are routed through HyperFrames rather than drawn as separate
// Remotion layers (lib/productGraphics) — a step sequence, a UI highlight and a
// comparison table are the three product primitives the first four could not
// express. Adding ids is additive: every card already saved in a project keeps
// its own template.
export type CardTemplateId =
  | 'feature-card'
  | 'stat-counter'
  | 'product-cta'
  | 'quote-card'
  | 'step-sequence'
  | 'ui-highlight'
  | 'comparison-table';

export interface CardLayer extends TimedLayer {
  template: CardTemplateId;
  variables: Record<string, string>;
  /** The independently rendered clip (HeyGen HyperFrames) or plate (fallback). */
  clipUrl: string;
  renderedBy: '' | 'hyperframes' | 'plate';
  renderError: string;
  /** 'overlay' holds the card over the presenter and never moves the timeline;
   *  'insert' cuts it INTO the film and lengthens it (stitch path). */
  placement: 'overlay' | 'insert';
}

export interface MusicLayer {
  enabled: boolean;
  url: string;
  prompt: string;
  volume: number;
  fadeInSec: number;
  fadeOutSec: number;
  /** Drop the avatar's own audio and run music only. */
  replaceOriginalAudio: boolean;
  durationMs: number;
}

export interface CaptionStyle {
  enabled: boolean;
  burnIn: boolean;
  font: string;
  sizePx: number;
  color: string;
  plate: 'none' | 'pill';
  plateColor: string;
  position: 'bottom' | 'middle' | 'top';
  maxCharsPerLine: number;
}

export interface CaptionSegment {
  id: string;
  start: number;
  end: number;
  text: string;
}

export type ColorGrade = 'neutral' | 'warm' | 'cool' | 'cinematic' | 'brand';
export type Pacing = 'fast_cut' | 'slow_reveal';

export interface EditManifest {
  version: 2;
  text: TextLayer[];
  brand: BrandLayer[];
  images: ImageLayer[];
  cards: CardLayer[];
  music: MusicLayer;
  captionStyle: CaptionStyle;
  directives: { colorGrade: ColorGrade; pacing: Pacing };
  /**
   * The cinematic story block: five copy fields, a preset, an accent and one
   * shared timing triple. It is NOT a parallel render path — it compiles
   * down into the `text` and `brand` arrays above (lib/motionPresets), so
   * everything downstream composites it without knowing it exists.
   */
  cinematic: CinematicSpec;
}

export interface BrandKit {
  name: string;
  logoUrl: string;
  primary: string;
  accent: string;
  contrast: string;
  textColor: string;
  font: string;
}

/** One editor session: the base video plus everything layered on top of it. */
export interface EditorJob {
  /** vv_heygen_renders.id — absent until the first save. */
  rowId: number | null;
  videoId: string;
  title: string;
  baseVideoUrl: string;
  posterUrl: string;
  aspectRatio: AspectRatio;
  durationSec: number;
  script: string;
  avatarId: string;
  avatarName: string;
  voiceId: string;
  voiceName: string;
  manifest: EditManifest;
  captions: CaptionSegment[];
  brandKit: BrandKit;
  finalVideoUrl: string;
  renderJob: RenderJob | null;
  lastSavedAt: string;
}

export type RenderStepId = 'cards' | 'stitch' | 'plates' | 'overlay' | 'audio';
export type RenderStepState = 'pending' | 'running' | 'done' | 'skipped' | 'failed';

export interface RenderStep {
  id: RenderStepId;
  label: string;
  state: RenderStepState;
  detail?: string;
  output?: string;
}

export interface RenderJob {
  status: 'queued' | 'running' | 'pending' | 'complete' | 'failed';
  steps: RenderStep[];
  videoUrl?: string;
  error?: string;
  note?: string;
  operationId?: string;
  startedAt?: string;
  finishedAt?: string;
}

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function clampTime(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(Math.max(0, max), Math.round(value * 100) / 100));
}

export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const frac = Math.floor(((Number(seconds) || 0) - total) * 10);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}.${frac}`;
}

export function layerEnd(layer: TimedLayer): number {
  return Math.max(layer.start + 0.1, layer.start + layer.duration);
}

export function isLive(layer: TimedLayer, t: number): boolean {
  return !layer.hidden && t >= layer.start - 0.001 && t <= layerEnd(layer) + 0.001;
}

/**
 * How far INTO a layer the playhead is, 0–1 across the entrance animation.
 * Entrances run over 0.45s and the same curve drives the live preview and the
 * 16:9 Remotion export, so what the customer scrubs is what renders.
 */
export const ENTRANCE_SEC = 0.45;
export function entranceProgress(layer: TimedLayer, t: number): number {
  const into = t - layer.start;
  if (into <= 0) return 0;
  return Math.max(0, Math.min(1, into / ENTRANCE_SEC));
}
export function exitProgress(layer: TimedLayer, t: number): number {
  const left = layerEnd(layer) - t;
  if (left >= ENTRANCE_SEC) return 0;
  return Math.max(0, Math.min(1, 1 - left / ENTRANCE_SEC));
}

export function brandKitFromWorkspace(overrides: Partial<BrandKit> = {}): BrandKit {
  return {
    name: 'VidVerge',
    logoUrl: 'https://storage.googleapis.com/audos-images/attachments/general/c0902809-6dc4-4e0c-b04e-1f60e01b31e6.png',
    primary: '#f59e0b',
    accent: '#fbbf24',
    contrast: '#080c14',
    textColor: '#f8fafc',
    font: 'Inter',
    ...overrides,
  };
}

export function defaultManifest(kit: BrandKit): EditManifest {
  return {
    version: 2,
    text: [],
    brand: [],
    images: [],
    cards: [],
    music: { enabled: false, url: '', prompt: '', volume: 0.22, fadeInSec: 1.2, fadeOutSec: 1.6, replaceOriginalAudio: false, durationMs: 0 },
    captionStyle: { enabled: false, burnIn: true, font: kit.font, sizePx: 54, color: '#ffffff', plate: 'pill', plateColor: 'rgba(8,12,20,0.72)', position: 'bottom', maxCharsPerLine: 32 },
    directives: { colorGrade: 'neutral', pacing: 'fast_cut' },
    cinematic: defaultCinematicSpec(kit),
  };
}

// ——— Layer factories ———

export function newTextLayer(kind: TextKind, kit: BrandKit, at: number, duration = 3): TextLayer {
  const headline = kind === 'headline';
  return {
    id: uid('text'),
    kind,
    start: at,
    duration,
    text: headline ? 'Your headline here' : kind === 'subheadline' ? 'A supporting line' : 'Caption text',
    font: kit.font,
    sizePx: headline ? 92 : kind === 'subheadline' ? 58 : 44,
    weight: headline ? 800 : 600,
    color: headline ? kit.textColor : kit.accent,
    align: 'center',
    x: 0.5,
    y: headline ? 0.18 : kind === 'subheadline' ? 0.28 : 0.82,
    width: 0.84,
    anim: headline ? 'slide-up' : 'fade',
    plate: kind === 'caption-box' ? 'pill' : 'none',
    plateColor: 'rgba(8,12,20,0.72)',
  };
}

export function newBrandLayer(kind: BrandKind, kit: BrandKit, at: number, duration: number): BrandLayer {
  return {
    id: uid('brand'),
    kind,
    start: at,
    duration,
    corner: kind === 'logo' ? 'top-right' : 'bottom-left',
    logoUrl: kit.logoUrl,
    scale: 0.18,
    opacity: kind === 'logo' ? 0.9 : 1,
    color: kit.textColor,
    accentColor: kit.primary,
    name: kit.name,
    role: 'Founder',
    anim: 'fade',
  };
}

export function newImageLayer(url: string, label: string, at: number, duration = 3.5): ImageLayer {
  return { id: uid('img'), url, label, start: at, duration, transition: 'fade', fit: 'cover' };
}

export function newCardLayer(template: CardTemplateId, variables: Record<string, string>, at: number, duration = 4): CardLayer {
  return { id: uid('card'), template, variables, start: at, duration, clipUrl: '', renderedBy: '', renderError: '', placement: 'overlay' };
}

export function newCaptionSegment(start: number, end: number, text: string): CaptionSegment {
  return { id: uid('cap'), start, end, text };
}

// ——— Normalisation ———
// A manifest read back from the database may have been written by an older
// build, so every field is defaulted rather than trusted.

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}
function numOr(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function one<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function normalizeManifest(raw: unknown, kit: BrandKit): EditManifest {
  const base = defaultManifest(kit);
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const text = Array.isArray(input.text) ? input.text.slice(0, 40).map((entry: any) => {
    const template = newTextLayer(one(entry?.kind, ['headline', 'subheadline', 'caption-box'] as const, 'headline'), kit, numOr(entry?.start, 0));
    return {
      ...template,
      id: str(entry?.id, template.id),
      start: numOr(entry?.start, 0),
      duration: Math.max(0.3, numOr(entry?.duration, 3)),
      hidden: Boolean(entry?.hidden),
      text: typeof entry?.text === 'string' ? entry.text : template.text,
      font: str(entry?.font, template.font),
      sizePx: Math.max(12, numOr(entry?.sizePx, template.sizePx)),
      weight: Math.max(300, Math.min(900, numOr(entry?.weight, template.weight))),
      color: str(entry?.color, template.color),
      align: one(entry?.align, ['left', 'center', 'right'] as const, 'center'),
      x: Math.max(0, Math.min(1, numOr(entry?.x, template.x))),
      y: Math.max(0, Math.min(1, numOr(entry?.y, template.y))),
      width: Math.max(0.1, Math.min(1, numOr(entry?.width, template.width))),
      anim: one(entry?.anim, ANIM_VALUES, template.anim),
      plate: one(entry?.plate, ['none', 'pill', 'bar'] as const, template.plate),
      plateColor: str(entry?.plateColor, template.plateColor),
      trackingEm: Math.max(-0.1, Math.min(0.5, numOr(entry?.trackingEm, 0))),
      glow: Boolean(entry?.glow),
      plateGradientTo: str(entry?.plateGradientTo),
    } as TextLayer;
  }) : [];
  const brand = Array.isArray(input.brand) ? input.brand.slice(0, 20).map((entry: any) => {
    const template = newBrandLayer(one(entry?.kind, ['logo', 'accent-bar', 'lower-third'] as const, 'logo'), kit, numOr(entry?.start, 0), Math.max(0.3, numOr(entry?.duration, 4)));
    return {
      ...template,
      id: str(entry?.id, template.id),
      hidden: Boolean(entry?.hidden),
      corner: one(entry?.corner, ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const, template.corner),
      logoUrl: str(entry?.logoUrl, template.logoUrl),
      scale: Math.max(0.04, Math.min(0.6, numOr(entry?.scale, template.scale))),
      opacity: Math.max(0.05, Math.min(1, numOr(entry?.opacity, template.opacity))),
      color: str(entry?.color, template.color),
      accentColor: str(entry?.accentColor, template.accentColor),
      name: typeof entry?.name === 'string' ? entry.name : template.name,
      role: typeof entry?.role === 'string' ? entry.role : template.role,
      anim: one(entry?.anim, ANIM_VALUES, template.anim),
      gradient: Boolean(entry?.gradient),
    } as BrandLayer;
  }) : [];
  const images = Array.isArray(input.images) ? input.images.slice(0, 40).filter((entry: any) => str(entry?.url)).map((entry: any) => ({
    id: str(entry?.id, uid('img')),
    url: String(entry.url),
    label: typeof entry?.label === 'string' ? entry.label : 'Overlay',
    start: numOr(entry?.start, 0),
    duration: Math.max(0.3, numOr(entry?.duration, 3)),
    hidden: Boolean(entry?.hidden),
    transition: one(entry?.transition, ['fade', 'zoom-in', 'slide'] as const, 'fade'),
    fit: one(entry?.fit, ['cover', 'contain'] as const, 'cover'),
  } as ImageLayer)) : [];
  const cards = Array.isArray(input.cards) ? input.cards.slice(0, 20).map((entry: any) => ({
    id: str(entry?.id, uid('card')),
    template: one(entry?.template, ['feature-card', 'stat-counter', 'product-cta', 'quote-card'] as const, 'feature-card'),
    variables: entry?.variables && typeof entry.variables === 'object' ? entry.variables : {},
    start: numOr(entry?.start, 0),
    duration: Math.max(0.5, numOr(entry?.duration, 4)),
    hidden: Boolean(entry?.hidden),
    clipUrl: str(entry?.clipUrl),
    renderedBy: one(entry?.renderedBy, ['', 'hyperframes', 'plate'] as const, ''),
    renderError: str(entry?.renderError),
    placement: one(entry?.placement, ['overlay', 'insert'] as const, 'overlay'),
  } as CardLayer)) : [];
  const music = input.music && typeof input.music === 'object' ? {
    enabled: Boolean(input.music.enabled),
    url: str(input.music.url),
    prompt: typeof input.music.prompt === 'string' ? input.music.prompt : '',
    volume: Math.max(0, Math.min(1, numOr(input.music.volume, base.music.volume))),
    fadeInSec: Math.max(0, Math.min(8, numOr(input.music.fadeInSec, base.music.fadeInSec))),
    fadeOutSec: Math.max(0, Math.min(8, numOr(input.music.fadeOutSec, base.music.fadeOutSec))),
    replaceOriginalAudio: Boolean(input.music.replaceOriginalAudio),
    durationMs: Math.max(0, numOr(input.music.durationMs, 0)),
  } : base.music;
  const captionStyle = input.captionStyle && typeof input.captionStyle === 'object' ? {
    enabled: Boolean(input.captionStyle.enabled),
    burnIn: input.captionStyle.burnIn !== false,
    font: str(input.captionStyle.font, base.captionStyle.font),
    sizePx: Math.max(16, Math.min(140, numOr(input.captionStyle.sizePx, base.captionStyle.sizePx))),
    color: str(input.captionStyle.color, base.captionStyle.color),
    plate: one(input.captionStyle.plate, ['none', 'pill'] as const, 'pill'),
    plateColor: str(input.captionStyle.plateColor, base.captionStyle.plateColor),
    position: one(input.captionStyle.position, ['bottom', 'middle', 'top'] as const, 'bottom'),
    maxCharsPerLine: Math.max(14, Math.min(60, numOr(input.captionStyle.maxCharsPerLine, base.captionStyle.maxCharsPerLine))),
  } : base.captionStyle;
  const directives = {
    colorGrade: one(input.directives?.colorGrade, ['neutral', 'warm', 'cool', 'cinematic', 'brand'] as const, 'neutral'),
    pacing: one(input.directives?.pacing, ['fast_cut', 'slow_reveal'] as const, 'fast_cut'),
  };
  return { version: 2, text, brand, images, cards, music, captionStyle, directives, cinematic: normalizeCinematicSpec(input.cinematic, kit) };
}

export function normalizeCaptions(raw: unknown): CaptionSegment[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 600).map((entry: any) => ({
    id: str(entry?.id, uid('cap')),
    start: Math.max(0, numOr(entry?.start, 0)),
    end: Math.max(0.2, numOr(entry?.end, numOr(entry?.start, 0) + 1.5)),
    text: typeof entry?.text === 'string' ? entry.text : '',
  })).filter((segment) => segment.text.trim().length > 0);
}

export function manifestLayerCount(manifest: EditManifest, captions: CaptionSegment[]): number {
  return manifest.text.length + manifest.brand.length + manifest.images.length + manifest.cards.length
    + (manifest.music.enabled && manifest.music.url ? 1 : 0)
    + (manifest.captionStyle.enabled && captions.length ? 1 : 0);
}

// ——— Persistence (vv_heygen_renders) ———
// The HeyGen render ledger carries one row per avatar video, keyed by the
// unique HeyGen video id, so reopening the editor on the same video restores
// the layer stack. `render_job` and `final_video_url` are server-only columns:
// only the sceneforge-composite-video function writes them.

const TABLE = 'vv_heygen_renders';

function client(): any {
  const db = (window as any).__workspaceDb;
  if (!db) throw new Error('The Motion Editor needs the workspace data runtime. Refresh and try again.');
  return db;
}
function rows(result: any): any[] {
  if (!result) return [];
  if (Array.isArray(result.data)) return result.data;
  if (result.data) return [result.data];
  return [];
}

export interface JobSeed {
  videoId: string;
  baseVideoUrl: string;
  posterUrl?: string;
  aspectRatio: AspectRatio;
  durationSec?: number;
  script?: string;
  avatarId?: string;
  avatarName?: string;
  voiceId?: string;
  voiceName?: string;
  title?: string;
}

function jobFromRow(row: any, seed: JobSeed, kit: BrandKit): EditorJob {
  const storedKit = row?.brand_kit && typeof row.brand_kit === 'object' ? brandKitFromWorkspace(row.brand_kit) : kit;
  return {
    rowId: Number.isFinite(Number(row?.id)) ? Number(row.id) : null,
    videoId: str(row?.video_id, seed.videoId),
    title: str(row?.title, seed.title || 'Avatar video'),
    baseVideoUrl: str(seed.baseVideoUrl, str(row?.video_url)),
    posterUrl: str(seed.posterUrl, str(row?.thumbnail_url)),
    aspectRatio: one(row?.aspect_ratio, ['9:16', '16:9'] as const, seed.aspectRatio),
    durationSec: numOr(seed.durationSec, numOr(row?.duration_sec, 0)),
    script: str(seed.script, str(row?.script)),
    avatarId: str(seed.avatarId, str(row?.avatar_id)),
    avatarName: str(seed.avatarName, str(row?.avatar_name)),
    voiceId: str(seed.voiceId, str(row?.voice_id)),
    voiceName: str(seed.voiceName, str(row?.voice_name)),
    manifest: normalizeManifest(row?.edit_manifest, storedKit),
    captions: normalizeCaptions(row?.captions),
    brandKit: storedKit,
    finalVideoUrl: str(row?.final_video_url),
    renderJob: row?.render_job && typeof row.render_job === 'object' ? (row.render_job as RenderJob) : null,
    lastSavedAt: str(row?.last_saved_at),
  };
}

/** Read the editor state for one HeyGen video, or a fresh session when none exists. */
export async function loadJob(seed: JobSeed, kit: BrandKit): Promise<EditorJob> {
  if (!seed.videoId) return jobFromRow(null, seed, kit);
  let row: any = null;
  try {
    const result = await client().from(TABLE).eq('video_id', seed.videoId).limit(1).get();
    row = rows(result)[0] || null;
  } catch (e) {
    // A read failure must not strand the customer in front of a blank editor:
    // the session still opens, it just starts from an empty layer stack.
    console.warn('[SceneForge] the saved edit manifest could not be read', e);
  }
  return jobFromRow(row, seed, kit);
}

export interface SaveResult { rowId: number | null; savedAt: string }

/** Persist the layer stack. Returns the row id so later saves update in place. */
export async function saveJob(job: EditorJob): Promise<SaveResult> {
  const savedAt = new Date().toISOString();
  const payload: Record<string, unknown> = {
    title: job.title,
    aspect_ratio: job.aspectRatio,
    duration_sec: Math.round(job.durationSec * 100) / 100,
    brand_kit: job.brandKit,
    edit_manifest: job.manifest,
    captions: job.captions,
    hyperframe_cards: job.manifest.cards.map((card) => ({ id: card.id, template: card.template, variables: card.variables, clip_url: card.clipUrl, rendered_by: card.renderedBy, at_sec: card.start, duration_sec: card.duration, placement: card.placement })),
    last_saved_at: savedAt,
    app: 'sceneforge-avatar-studio',
  };
  if (job.rowId) {
    await client().from(TABLE).update(job.rowId, payload);
    return { rowId: job.rowId, savedAt };
  }
  // The ledger existed before the editor did: its NOT NULL columns describe
  // the HeyGen render itself, so they are filled from the job being edited.
  const inserted = await client().from(TABLE).insert({
    video_id: job.videoId,
    api_version: 'v3',
    script: job.script || '',
    avatar_id: job.avatarId || '',
    avatar_name: job.avatarName || '',
    voice_id: job.voiceId || null,
    voice_name: job.voiceName || null,
    status: 'completed',
    video_url: job.baseVideoUrl,
    thumbnail_url: job.posterUrl || null,
    ...payload,
  });
  const row = rows(inserted)[0] || inserted;
  const rowId = Number.isFinite(Number(row?.id)) ? Number(row.id) : null;
  return { rowId, savedAt };
}

export function relativeSaved(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return new Date(then).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
