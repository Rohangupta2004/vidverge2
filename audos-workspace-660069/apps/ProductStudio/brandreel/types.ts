/**
 * BRAND REEL — shared types and brand-theme maths.
 *
 * The Brand Reel flow is four gates: URL → Brand Summary → Storyboard variant
 * → Scene mockups → Remotion render. Every gate passes the SAME two objects
 * forward: a BrandObject (what the client's site says about itself) and, once
 * chosen, a ScriptVariant (how this reel tells it).
 *
 * COLOUR RULE: everything the customer sees inside this flow is themed from
 * the CLIENT's scraped primaryColor, never VidVerge amber. The surrounding
 * Product Studio shell keeps its own LightBeam tokens — only the reel's cards,
 * accents and the rendered video adopt the client palette.
 */

export type VideoKind = 'file' | 'youtube' | 'vimeo' | 'linkedin';

export interface ScrapedVideo {
  kind: VideoKind;
  url: string;
  thumbnail: string;
}

export interface ScrapedImage {
  url: string;
  alt: string;
}

/** The Brand Object — step 1's deliverable, editable in the Brand Summary card. */
export interface BrandObject {
  url: string;
  name: string;
  tagline: string;
  features: string[];
  heroImageUrl: string;
  logoUrl: string;
  primaryColor: string;
  secondaryColor: string;
  fontFamily: string;
  cta: string;
  scrapedVideos: ScrapedVideo[];
  /** Supporting evidence carried alongside the required shape. */
  screenshotUrl: string;
  images: ScrapedImage[];
  audience: string;
  problem: string;
  toneOfVoice: string;
}

/**
 * HOW a scene is drawn. EVERY reel visual is built in code — a browser frame
 * around the customer's OWN screenshot, or a Remotion motion graphic drawn
 * from their brand tokens. We do not ask an image model to invent a product
 * interface: it produces a plausible-looking UI that is not the customer's,
 * which is worse than no picture at all. The director therefore picks a SHAPE
 * from this list and fills in the strings, and the renderer draws it.
 */
export type SceneVisualKind =
  | 'product-ui'
  | 'stat'
  | 'checklist'
  | 'process'
  | 'feature-cards'
  | 'comparison'
  | 'quote'
  | 'kinetic';

export const SCENE_VISUAL_KINDS: SceneVisualKind[] = [
  'product-ui', 'stat', 'checklist', 'process', 'feature-cards', 'comparison', 'quote', 'kinetic',
];

/** Human label for each shape, shown on the storyboard cards. */
export const SCENE_VISUAL_LABEL: Record<SceneVisualKind, string> = {
  'product-ui': 'Product UI',
  stat: 'Big stat',
  checklist: 'Checklist',
  process: 'Process flow',
  'feature-cards': 'Feature cards',
  comparison: 'Before / after',
  quote: 'Pull quote',
  kinetic: 'Kinetic type',
};

export interface SceneVisual {
  kind: SceneVisualKind;
  /** Window title, list heading or attribution — depends on the kind. */
  label: string;
  /** The number for 'stat', the sentence for 'quote'. */
  value: string;
  /** Callout chips, checklist rows, steps, features, or the LEFT comparison column. */
  items: string[];
  /** 'comparison' only — the right-hand column. */
  itemsB: string[];
  /** 'comparison' only — the two column headings. */
  compareFrom: string;
  compareTo: string;
}

export function emptySceneVisual(kind: SceneVisualKind = 'kinetic'): SceneVisual {
  return { kind, label: '', value: '', items: [], itemsB: [], compareFrom: '', compareTo: '' };
}

/**
 * Fall back to a sensible shape when the director did not name one — read off
 * the art-direction note it did write, so an older or partial response still
 * renders something deliberate rather than nothing.
 */
export function inferSceneVisual(
  scene: { visualDescription?: string; headline?: string; bodyText?: string },
  hasImage: boolean,
): SceneVisual {
  const text = `${scene.visualDescription || ''} ${scene.headline || ''} ${scene.bodyText || ''}`.toLowerCase();
  if (/\bbefore\b|\bafter\b|\bversus\b|\bvs\.?\b|instead of/.test(text)) return emptySceneVisual('comparison');
  if (/\d+\s*(%|x\b|hours?|hrs?|minutes?|days?|weeks?)/.test(text)) return emptySceneVisual('stat');
  if (/step|then|workflow|pipeline|process|flow/.test(text)) return emptySceneVisual('process');
  if (/checklist|tick|check off|todo|to-do|done/.test(text)) return emptySceneVisual('checklist');
  if (/quote|testimonial|says|“|"/.test(text)) return emptySceneVisual('quote');
  if (/dashboard|interface|screen|app\b|ui\b|product shot|workspace|panel/.test(text) && hasImage) {
    return emptySceneVisual('product-ui');
  }
  if (/feature|benefit|capabilit/.test(text)) return emptySceneVisual('feature-cards');
  return emptySceneVisual(hasImage ? 'product-ui' : 'kinetic');
}

export interface StoryboardScene {
  sceneNumber: number;
  durationSeconds: number;
  headline: string;
  bodyText: string;
  /** Art-direction note for the human reading the storyboard. Advisory only —
   *  `visual` is what actually gets drawn. */
  visualDescription: string;
  cameraNote: string;
  voiceover: string;
  visual: SceneVisual;
}

/** Matched to the variant's style label — see transitionForStyle(). */
export type TransitionKind = 'crossfade' | 'slide' | 'wipe' | 'cut';

export interface CompositionSettings {
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  aspect: '16:9' | '9:16';
  transition: TransitionKind;
}

export interface ScriptVariant {
  id: string;
  styleLabel: string;
  styleSummary: string;
  totalSeconds: number;
  scenes: StoryboardScene[];
  composition: CompositionSettings;
}

export type MockupStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface SceneMockup {
  sceneNumber: number;
  status: MockupStatus;
  imageUrl: string;
  error: string;
  model: string;
}

// ---------------------------------------------------------------------------
// Brand theme maths — a whole readable palette derived from one client hex.
// ---------------------------------------------------------------------------

export const FALLBACK_PRIMARY = '#2563eb';
export const FALLBACK_SECONDARY = '#0f172a';

export function isHex(value: unknown): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(String(value || '').trim());
}

export function normalizeHex(value: unknown, fallback: string): string {
  const raw = String(value || '').trim();
  if (isHex(raw)) return raw.toLowerCase();
  const short = raw.match(/^#([0-9a-fA-F]{3})$/);
  if (short) {
    const c = short[1];
    return `#${c[0]}${c[0]}${c[1]}${c[1]}${c[2]}${c[2]}`.toLowerCase();
  }
  return fallback;
}

export function rgbOf(hex: string): [number, number, number] {
  const h = normalizeHex(hex, FALLBACK_PRIMARY).slice(1);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function toHex(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}

/** Mix `hex` toward white (amount > 0) or black (amount < 0), -1…1. */
export function shade(hex: string, amount: number): string {
  const [r, g, b] = rgbOf(hex);
  const target = amount >= 0 ? 255 : 0;
  const t = Math.abs(amount);
  return `#${toHex(r + (target - r) * t)}${toHex(g + (target - g) * t)}${toHex(b + (target - b) * t)}`;
}

/** rgba() string for the colour at the given alpha — safe inside inline styles. */
export function tint(hex: string, alpha: number): string {
  const [r, g, b] = rgbOf(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

/** WCAG relative luminance, 0 (black) … 1 (white). */
export function luminance(hex: string): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgbOf(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Black or white — whichever stays readable on the given background. */
export function readableOn(hex: string): string {
  return luminance(hex) > 0.45 ? '#0b0f18' : '#ffffff';
}

/**
 * A brand colour scraped off a page is often near-black or near-white (the
 * page's canvas, not its signature colour). Those read as "no accent at all"
 * against a dark studio surface, so nudge them into a usable range.
 */
export function usableAccent(hex: string): string {
  const normalized = normalizeHex(hex, FALLBACK_PRIMARY);
  const l = luminance(normalized);
  if (l < 0.06) return shade(normalized, 0.42);
  if (l > 0.86) return shade(normalized, -0.34);
  return normalized;
}

export interface BrandTheme {
  primary: string;
  primarySoft: string;
  primaryStrong: string;
  onPrimary: string;
  secondary: string;
  surface: string;
  surfaceRaised: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  fontFamily: string;
}

const SYSTEM_STACK = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/**
 * Fonts come off a client's stylesheet as whatever they declared. We cannot
 * load an arbitrary webfont inside the render, so keep the declared family at
 * the head of the stack and let the system fallbacks carry it.
 */
export function fontStack(family: string): string {
  const head = String(family || '').split(',')[0].replace(/["']/g, '').trim();
  if (!head || /^(inherit|initial|unset|var\()/i.test(head)) return `Inter, ${SYSTEM_STACK}`;
  return `'${head}', Inter, ${SYSTEM_STACK}`;
}

export function brandTheme(brand: Pick<BrandObject, 'primaryColor' | 'secondaryColor' | 'fontFamily'>): BrandTheme {
  const primary = usableAccent(normalizeHex(brand.primaryColor, FALLBACK_PRIMARY));
  const secondary = normalizeHex(brand.secondaryColor, FALLBACK_SECONDARY);
  return {
    primary,
    primarySoft: tint(primary, 0.14),
    primaryStrong: shade(primary, -0.22),
    onPrimary: readableOn(primary),
    secondary,
    surface: 'rgba(255,255,255,0.035)',
    surfaceRaised: 'rgba(255,255,255,0.07)',
    border: `1px solid ${tint(primary, 0.22)}`,
    borderStrong: `1px solid ${tint(primary, 0.5)}`,
    text: '#ffffff',
    textMuted: 'rgba(255,255,255,0.62)',
    fontFamily: fontStack(brand.fontFamily),
  };
}

/** Transitions are chosen by the variant's own style label, not at random. */
export function transitionForStyle(styleLabel: string): TransitionKind {
  const s = String(styleLabel || '').toLowerCase();
  if (/fast|cut|punch|rapid/.test(s)) return 'cut';
  if (/cinematic|reveal|story|founder/.test(s)) return 'crossfade';
  if (/demo|walkthrough|feature|product/.test(s)) return 'slide';
  if (/proof|social|testimonial/.test(s)) return 'wipe';
  return 'crossfade';
}

export const REEL_FPS = 30;
/** The platform render service is locked to this geometry. */
export const REEL_WIDTH = 1920;
export const REEL_HEIGHT = 1080;

export function framesFor(seconds: number): number {
  return Math.max(REEL_FPS, Math.round(seconds * REEL_FPS));
}

export function variantDuration(variant: ScriptVariant): number {
  return variant.scenes.reduce((sum, s) => sum + Math.max(1, s.durationSeconds), 0);
}
