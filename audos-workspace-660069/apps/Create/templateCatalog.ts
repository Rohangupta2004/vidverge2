/**
 * VidVerge — THE CREATE PICKER: templates, previews, and the faceless default.
 *
 * WHY THIS FILE EXISTS. Picking a video style used to be picking a word off a
 * row of pills — "Faceless", "Ad", "UI Motion" — and a word is a terrible way to
 * choose a look. Everything a visitor needs in order to choose is here instead:
 * a moving preview of what that style actually produces, the structure it will
 * follow, the length variants it offers, and whether it needs a face at all.
 *
 * FACELESS IS THE DEFAULT, EVERYWHERE. Every template below declares
 * `facelessDefault`, and every one of them is true: nothing in this product may
 * block a visitor behind a character upload. Opting IN to a face is a single
 * toggle (see `faceless` on ProductionInputs), and only the Avatar template
 * treats a presenter as the point of the piece.
 *
 * THE PREVIEWS. Real looping clips are supported (`clipUrl`) and used the moment
 * one exists for a template. Until then each template ships a high-quality still
 * plus a MOTION TREATMENT — a slow ken-burns drift and a light sweep — so the
 * card communicates the style in motion rather than sitting there as a flat
 * thumbnail. Both are drawn by components/PreviewTile.
 */
import type { VideoMode } from './agenticTypes';

/**
 * How a still is animated when there is no clip. `drift` is the ken-burns
 * direction; `sweep` adds a travelling light band; `speed` is the loop length
 * in seconds.
 */
export interface PreviewMotion {
  drift: 'in' | 'out' | 'left' | 'right' | 'up';
  sweep: boolean;
  speed: number;
}

export interface PreviewAsset {
  /** A real looping clip. Preferred, and used as soon as one exists. */
  clipUrl?: string;
  /** The still every template always has. */
  stillUrl: string;
  /** Behind/over the still, so a slow-loading image still reads as the style. */
  gradient: string;
  motion: PreviewMotion;
  /** Spoken alt text — a preview is decoration, but it still has to be legible. */
  alt: string;
}

const ASSETS = 'https://storage.googleapis.com/audos-images/generated-images/agent/workspace-660069';

/**
 * One preview per mode in the picker, keyed by the same ids agenticTypes uses so
 * a new mode cannot be added to the selector without a preview to go with it.
 */
export const MODE_PREVIEWS: Partial<Record<VideoMode, PreviewAsset>> = {
  auto: {
    clipUrl: 'https://storage.googleapis.com/audos-images/generated-videos/models_veo-3.1-generate-preview_operations_q65m9jmtyt9v.mp4',
    stillUrl: `${ASSETS}/img-1788316997838-2wp5od.png`,
    gradient: 'linear-gradient(135deg, rgba(37,99,235,0.55), rgba(45,212,191,0.35))',
    motion: { drift: 'in', sweep: true, speed: 9 },
    alt: 'Several visual styles fanned out, the director choosing between them',
  },
  faceless: {
    stillUrl: `${ASSETS}/img-1788317034757-9kiaki.png`,
    gradient: 'linear-gradient(135deg, rgba(30,58,138,0.6), rgba(13,148,136,0.32))',
    motion: { drift: 'left', sweep: false, speed: 11 },
    alt: 'Hands and objects in silhouette, nobody on camera',
  },
  avatar: {
    stillUrl: `${ASSETS}/img-1788317057803-n437x5.png`,
    gradient: 'linear-gradient(135deg, rgba(59,130,246,0.5), rgba(30,64,175,0.42))',
    motion: { drift: 'in', sweep: false, speed: 10 },
    alt: 'A presenter speaking straight to camera in a dark studio',
  },
  ui_motion: {
    stillUrl: `${ASSETS}/img-1788317085345-zs814i.png`,
    gradient: 'linear-gradient(135deg, rgba(37,99,235,0.5), rgba(96,165,250,0.34))',
    motion: { drift: 'up', sweep: true, speed: 7 },
    alt: 'Product interface cards animating into place',
  },
  ad_creative: {
    stillUrl: `${ASSETS}/img-1788317134237-lxglwg.png`,
    gradient: 'linear-gradient(135deg, rgba(37,99,235,0.58), rgba(14,165,233,0.32))',
    motion: { drift: 'in', sweep: true, speed: 6 },
    alt: 'A product hero shot with a hard light sweep across it',
  },
  long_series: {
    stillUrl: `${ASSETS}/img-1788317225753-45bn55.png`,
    gradient: 'linear-gradient(135deg, rgba(30,58,138,0.55), rgba(19,78,74,0.4))',
    motion: { drift: 'right', sweep: false, speed: 14 },
    alt: 'One landscape shifting through three different lighting worlds',
  },
};

/** The preview for the "Start from a screenshot" entry point on the home screen. */
export const SCREENSHOT_PREVIEW: PreviewAsset = {
  stillUrl: `${ASSETS}/img-1788317327949-kn9czy.png`,
  gradient: 'linear-gradient(135deg, rgba(37,99,235,0.5), rgba(45,212,191,0.3))',
  motion: { drift: 'up', sweep: true, speed: 7 },
  alt: 'Screenshots being read by a scanning light sweep',
};

export function previewFor(mode: string): PreviewAsset {
  return MODE_PREVIEWS[mode as VideoMode] || MODE_PREVIEWS.auto!;
}

/**
 * The classic wizard's eight formats, mapped onto the preview whose look they
 * actually share. They are deliberately not given their own artwork: they are
 * shapes of script rather than distinct engines, so a second set of stills would
 * be eight more generations telling the same visual story.
 */
const VIDEO_TYPE_PREVIEWS: Record<string, VideoMode> = {
  product_ad: 'ad_creative',
  social_reel: 'ad_creative',
  cinematic_story: 'long_series',
  explainer: 'ui_motion',
  testimonial: 'avatar',
  brand_story: 'long_series',
  tutorial: 'ui_motion',
  custom: 'auto',
};

export function previewForVideoType(typeId: string): PreviewAsset {
  return MODE_PREVIEWS[VIDEO_TYPE_PREVIEWS[typeId] || 'auto'] || MODE_PREVIEWS.auto!;
}

// ---------------------------------------------------------------------------
// Length variants
// ---------------------------------------------------------------------------
/**
 * A LENGTH VARIANT is a named runtime a template offers, not a free number. The
 * Ad template's two variants are the actual ad lengths platforms sell —
 * everything else is a distraction — and each one carries the beat map the
 * director plans against.
 *
 * The seconds are shot-aligned: the render engine caps a clip at 8s, so a "15s"
 * ad is two shots (16s) and a "30s" ad is four (32s). Naming them 15 and 30 is
 * what the visitor asked for; the seconds are what actually renders.
 */
export interface LengthVariant {
  id: string;
  /** What the visitor sees: "15s". */
  label: string;
  /** What is actually planned, shot-aligned. */
  seconds: number;
  /** The beat map, in the director's own words. */
  structure: string;
}

export const AD_VARIANTS: LengthVariant[] = [
  {
    id: 'ad_15',
    label: '15s',
    seconds: 16,
    structure:
      'Hook (0–3s): one arresting image that stops the scroll. Problem and solution (3–12s): the friction stated ' +
      'sharply, then a hard cut into the product doing it properly. CTA (12–15s): the product alone in frame, one ' +
      'spoken call to action.',
  },
  {
    id: 'ad_30',
    label: '30s',
    seconds: 32,
    structure:
      'Hook (0–3s): one arresting image that stops the scroll. Problem (3–8s): the friction, close and specific. ' +
      'Solution (8–18s): a hard cut into the product working, then one concrete proof beat. Payoff (18–26s): the ' +
      'result, shown rather than claimed. CTA (26–30s): the product alone in frame, one spoken call to action.',
  },
];

/** The variants a mode offers, or an empty list when its length is free-form. */
export function variantsFor(mode: string): LengthVariant[] {
  if (mode === 'ad_creative') return AD_VARIANTS;
  return [];
}

export function variantForSeconds(mode: string, seconds: number): LengthVariant | null {
  const variants = variantsFor(mode);
  if (variants.length === 0) return null;
  return (
    variants.find((variant) => variant.seconds === seconds) ||
    variants.reduce((closest, variant) =>
      Math.abs(variant.seconds - seconds) < Math.abs(closest.seconds - seconds) ? variant : closest,
    )
  );
}

/** The beat map the director is handed for a mode at a given runtime. */
export function structureFor(mode: string, seconds: number): string {
  const variant = variantForSeconds(mode, seconds);
  return variant ? variant.structure : '';
}

// ---------------------------------------------------------------------------
// The templates, as the Create picker shows them
// ---------------------------------------------------------------------------
/**
 * EVERY TEMPLATE IS ON THE FIRST SCREEN. There is no "more" menu and no second
 * page: a template a visitor cannot see is a template that does not exist, so
 * the picker renders this whole list, previews and all, on first load.
 */
export interface CreateTemplate {
  mode: VideoMode;
  /** The card's own name, which may be friendlier than the mode label. */
  title: string;
  /** One line under the title. */
  blurb: string;
  /** The structure line shown on the card, for templates that have one. */
  structure: string;
  /** Faceless unless the visitor opts in — true for every template but Avatar. */
  facelessDefault: boolean;
  /** True when a face is the entire point, so the toggle starts opted-in. */
  presenterLed: boolean;
  variants: LengthVariant[];
  /** Shown as a small pill on the card. */
  engineNote: string;
}

export const CREATE_TEMPLATES: CreateTemplate[] = [
  {
    mode: 'auto',
    title: 'AUTO',
    blurb: 'Read my brief and pick the template for me.',
    structure: '',
    facelessDefault: true,
    presenterLed: false,
    variants: [],
    engineNote: 'Agent picks',
  },
  {
    mode: 'ad_creative',
    title: 'Ad Creative',
    blurb: 'A scroll-stopping social ad from your product URL or a mockup.',
    structure: 'Hook → problem and solution → CTA',
    facelessDefault: true,
    presenterLed: false,
    variants: AD_VARIANTS,
    engineNote: 'Omni Flash',
  },
  {
    mode: 'ui_motion',
    title: 'UI Motion',
    blurb: 'Your real product screens, animated state to state.',
    structure: 'Screen → action → result → detail',
    facelessDefault: true,
    presenterLed: false,
    variants: [],
    engineNote: 'Deterministic UI',
  },
  {
    mode: 'faceless',
    title: 'Faceless',
    blurb: 'Narration over B-roll, with nobody on camera.',
    structure: 'Hook → setup → build → proof → land',
    facelessDefault: true,
    presenterLed: false,
    variants: [],
    engineNote: 'Omni Flash',
  },
  {
    mode: 'avatar',
    title: 'Avatar',
    blurb: 'One presenter delivering the lines, consistent in every shot.',
    structure: 'Hook → setup → turn → proof → land',
    facelessDefault: false,
    presenterLed: true,
    variants: [],
    engineNote: 'Needs a face',
  },
  {
    mode: 'long_series',
    title: 'Long Series',
    blurb: 'Up to five minutes, planned as chapters and chained shot by shot.',
    structure: 'Chapters, each one its own visual world',
    facelessDefault: true,
    presenterLed: false,
    variants: [],
    engineNote: 'Omni Flash',
  },
];

export function templateFor(mode: string): CreateTemplate {
  return CREATE_TEMPLATES.find((template) => template.mode === mode) || CREATE_TEMPLATES[0];
}

/**
 * Whether picking this template should turn the faceless default OFF. Only the
 * Avatar template does, because a presenter IS the piece there; every other
 * template leaves faceless on and lets the visitor opt in.
 */
export function facelessDefaultFor(mode: string): boolean {
  return templateFor(mode).facelessDefault;
}
