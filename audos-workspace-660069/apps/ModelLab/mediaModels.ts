/**
 * MODEL LAB — the image and video model catalogue.
 *
 * Every entry here is a model the platform ACTUALLY serves, with the endpoint
 * that serves it. Group A cards are derived from lib/videoEngines.ts so a model
 * id string still lives in exactly one place; Kling, Runway and Higgsfield are
 * described from their integration contracts.
 *
 * AVAILABILITY is not assumed. Each card carries an `availability` key and the
 * lab gates it on a live vv-media-capabilities check — Kling, Runway and
 * Higgsfield all answer 503 when the platform has not configured them, and a
 * card that cannot be called says so instead of failing on submit.
 *
 * NOT ON THIS PLATFORM: Pika and Luma Dream Machine. There is no proxy
 * endpoint and no integration for either, so they are deliberately absent
 * rather than shown as a button that 404s.
 */
import { GROUP_A_MODELS, groupADurationLadder, groupAMinDurationS } from '../../lib/videoEngines';

export type MediaTab = 'images' | 'videos';

export type ModelFamily = 'group-a' | 'kling' | 'runway' | 'higgsfield' | 'openai-image' | 'gemini-image';

/** Which live capability probe gates this card. */
export type AvailabilityKey = 'groupA' | 'kling' | 'runway' | 'higgsfield';

export interface OptionSpec {
  /** Field the generation client reads off the options object. */
  key: 'aspectRatio' | 'duration' | 'resolution' | 'mode' | 'quality' | 'size' | 'seed' | 'generateAudio' | 'style';
  label: string;
  type: 'select' | 'number' | 'toggle';
  options?: Array<{ value: string; label: string }>;
  defaultValue?: string | number | boolean;
  hint?: string;
}

export interface ImageModelCard {
  id: string;
  family: ModelFamily;
  name: string;
  provider: string;
  blurb: string;
  /** What this model is genuinely best at, in one line. */
  bestFor: string;
  sizes: string[];
  costLabel: string;
  accent: string;
  availability: AvailabilityKey;
  options: OptionSpec[];
  /** Known caveat surfaced on the card rather than discovered on submit. */
  caveat?: string;
}

export interface VideoModelCard {
  id: string;
  family: ModelFamily;
  name: string;
  provider: string;
  blurb: string;
  bestFor: string;
  durations: string;
  aspectRatios: string[];
  costLabel: string;
  /** Image-to-video, multi-image, seed support and other special abilities. */
  features: string[];
  accent: string;
  availability: AvailabilityKey;
  options: OptionSpec[];
  caveat?: string;
}

const ratioOptions = (values: string[]) => values.map((v) => ({ value: v, label: v }));

// ---------------------------------------------------------------------------
// IMAGE MODELS
// ---------------------------------------------------------------------------

const IMAGE_RATIOS_FULL = ['1:1', '16:9', '9:16', '3:4', '4:3', '4:5', '5:4'];
const IMAGE_RATIOS_OPENAI = ['1:1', '16:9', '9:16'];

export const IMAGE_MODEL_CARDS: ImageModelCard[] = [
  {
    id: 'auto',
    family: 'openai-image',
    name: 'GPT Image (managed)',
    provider: 'OpenAI · platform-managed',
    blurb: 'The platform picks the current OpenAI image model (gpt-image-1.5 today) and falls back to Gemini on its own. Synchronous — the URL comes back in the same response.',
    bestFor: 'The default. Photoreal product stills and UI mockups with no model babysitting.',
    sizes: IMAGE_RATIOS_OPENAI,
    costLabel: '≈ $0.04 / image',
    accent: '#166534',
    availability: 'groupA',
    options: [
      { key: 'aspectRatio', label: 'Aspect ratio', type: 'select', options: ratioOptions(IMAGE_RATIOS_OPENAI), defaultValue: '1:1' },
      { key: 'quality', label: 'Quality', type: 'select', options: [{ value: 'standard', label: 'Standard (1K)' }, { value: 'hd', label: 'HD (2K)' }], defaultValue: 'standard' },
    ],
  },
  {
    id: 'gpt-image-2',
    family: 'openai-image',
    name: 'GPT Image 2',
    provider: 'OpenAI',
    blurb: 'Opts into GPT Image 2 explicitly, with gpt-image-1.5 as the automatic fallback for OpenAI-compatible ratios.',
    bestFor: 'When you want the newest OpenAI image model rather than whatever the platform defaults to.',
    sizes: IMAGE_RATIOS_OPENAI,
    costLabel: '≈ $0.04 / image',
    accent: '#B4720A',
    availability: 'groupA',
    caveat: 'Only 1:1, 16:9 and 9:16 — a portrait or print ratio is rejected with 400 unsupported_aspect_ratio.',
    options: [
      { key: 'aspectRatio', label: 'Aspect ratio', type: 'select', options: ratioOptions(IMAGE_RATIOS_OPENAI), defaultValue: '1:1' },
      { key: 'quality', label: 'Quality', type: 'select', options: [{ value: 'standard', label: 'Standard' }, { value: 'hd', label: 'HD' }], defaultValue: 'standard' },
    ],
  },
  {
    id: 'gemini-3.1-flash-image',
    family: 'gemini-image',
    name: 'Gemini 3.1 Flash Image',
    provider: 'Google (Nano Banana 2)',
    blurb: 'Text-to-image and image-to-image from one endpoint, and the only image model here that handles the print ratios 3:4, 4:3, 4:5 and 5:4 natively.',
    bestFor: 'Edits, subject references and any portrait or print shape OpenAI refuses.',
    sizes: IMAGE_RATIOS_FULL,
    costLabel: '≈ $0.067 / image',
    accent: '#C8920A',
    availability: 'groupA',
    options: [
      { key: 'aspectRatio', label: 'Aspect ratio', type: 'select', options: ratioOptions(IMAGE_RATIOS_FULL), defaultValue: '1:1' },
    ],
  },
  {
    id: 'dall-e-3',
    family: 'openai-image',
    name: 'DALL·E 3',
    provider: 'OpenAI',
    blurb: 'The classic DALL·E 3 route on the schema-validated image proxy.',
    bestFor: 'Illustrative and stylised work where DALL·E 3 composition is what you are after.',
    sizes: IMAGE_RATIOS_OPENAI,
    costLabel: '≈ $0.04 / image',
    accent: '#C8920A',
    availability: 'groupA',
    caveat: 'This provider route has been observed returning a failed job with no image. The lab retries on the managed OpenAI route and tells you when it did.',
    options: [
      { key: 'aspectRatio', label: 'Aspect ratio', type: 'select', options: ratioOptions(IMAGE_RATIOS_OPENAI), defaultValue: '1:1' },
    ],
  },
  {
    id: 'popcorn',
    family: 'higgsfield',
    name: 'Higgsfield Popcorn',
    provider: 'Higgsfield',
    blurb: 'Higgsfield\'s general text-to-image model. Asynchronous — the lab polls it for you.',
    bestFor: 'Punchy graphic imagery with a different visual bias to the OpenAI and Google models.',
    sizes: ['1:1', '16:9', '9:16'],
    costLabel: '$0.10 / image',
    accent: '#B45309',
    availability: 'higgsfield',
    options: [
      { key: 'aspectRatio', label: 'Aspect ratio', type: 'select', options: ratioOptions(['1:1', '16:9', '9:16']), defaultValue: '16:9' },
      { key: 'seed', label: 'Seed', type: 'number', hint: 'Same seed plus same prompt reproduces the image.' },
    ],
  },
  {
    id: 'soul-cinema',
    family: 'higgsfield',
    name: 'Higgsfield Soul',
    provider: 'Higgsfield',
    blurb: 'Soul is Higgsfield\'s cinematic, photoreal image model. Cinema, Standard and Character presets.',
    bestFor: 'Film-look stills and consistent characters.',
    sizes: ['1536x1536', '2048x1152', '1152x2048'],
    costLabel: '$0.15 / image ($0.40 for a batch of 4)',
    accent: '#C8920A',
    availability: 'higgsfield',
    options: [
      { key: 'style', label: 'Preset', type: 'select', options: [{ value: 'soul-cinema', label: 'Cinema' }, { value: 'soul-standard', label: 'Standard' }, { value: 'soul-character', label: 'Character' }], defaultValue: 'soul-cinema' },
      { key: 'size', label: 'Size', type: 'select', options: ratioOptions(['1536x1536', '2048x1152', '1152x2048']), defaultValue: '2048x1152' },
      { key: 'quality', label: 'Quality', type: 'select', options: [{ value: '720p', label: '720p' }, { value: '1080p', label: '1080p' }], defaultValue: '1080p' },
      { key: 'seed', label: 'Seed', type: 'number' },
    ],
  },
];

// ---------------------------------------------------------------------------
// VIDEO MODELS
// ---------------------------------------------------------------------------

const GROUP_A_ACCENTS: Record<string, string> = {
  'gemini-omni-flash-preview': '#C8920A',
  'veo-3.1-generate-preview': '#C8920A',
  'veo-3.1-fast-generate-preview': '#B4720A',
  'veo-3.0-generate-001': '#C8920A',
  'veo-3.0-fast-generate-001': '#B4720A',
  'veo-2.0-generate-001': '#7A6030',
  'sora-2': '#166534',
  'sora-2-pro': '#B4720A',
  'openrouter/bytedance/seedance-2.0-fast': '#B45309',
  'openrouter/google/veo-3.1': '#C8920A',
  'openrouter/google/veo-3.1-fast': '#B4720A',
  'openrouter/google/veo-3.1-lite': '#7A6030',
};

const GROUP_A_BEST_FOR: Record<string, string> = {
  'gemini-omni-flash-preview': 'Keeping the same face, product or mascot across every scene.',
  'veo-3.1-generate-preview': 'Your hero shot. Cinematic 4K with up to three reference ingredients.',
  'veo-3.1-fast-generate-preview': 'The workhorse — Veo 3.1 quality at a fraction of the wait.',
  'veo-3.0-generate-001': 'Solid previous-generation Veo when you only have a single seed image.',
  'veo-3.0-fast-generate-001': 'Cheap, quick Veo 3.0 drafts.',
  'veo-2.0-generate-001': 'Continuity with older projects that were shot on Veo 2.',
  'sora-2': 'Surreal, stylised and crowded multi-subject scenes.',
  'sora-2-pro': 'The showcase piece you only render once.',
  'openrouter/bytedance/seedance-2.0-fast': 'Volume B-roll at the lowest price on the platform.',
  'openrouter/google/veo-3.1': 'Veo 3.1 via OpenRouter when the direct route is busy.',
  'openrouter/google/veo-3.1-fast': 'Fast Veo 3.1 through OpenRouter.',
  'openrouter/google/veo-3.1-lite': 'The cheapest Veo path there is.',
};

function groupAOptions(model: (typeof GROUP_A_MODELS)[number]): OptionSpec[] {
  const opts: OptionSpec[] = [
    { key: 'aspectRatio', label: 'Aspect ratio', type: 'select', options: ratioOptions(['16:9', '9:16', '1:1']), defaultValue: '16:9' },
    {
      key: 'duration',
      label: 'Duration',
      type: 'select',
      options: groupADurationLadder(model).map((d) => ({ value: String(d), label: `${d}s` })),
      defaultValue: String(model.defaultDurationS),
      hint: `Normalised to the nearest length ${model.name} supports.`,
    },
  ];
  if (model.supports4k) {
    opts.push({
      key: 'resolution',
      label: 'Resolution',
      type: 'select',
      options: [{ value: '720p', label: '720p' }, { value: '1080p', label: '1080p' }, { value: '4k', label: '4K' }],
      defaultValue: '1080p',
    });
  } else {
    opts.push({
      key: 'resolution',
      label: 'Resolution',
      type: 'select',
      options: [{ value: '720p', label: '720p' }, { value: '1080p', label: '1080p' }],
      defaultValue: '720p',
    });
  }
  if (model.supportsAudio) {
    opts.push({ key: 'generateAudio', label: 'Generate audio', type: 'toggle', defaultValue: false });
  }
  return opts;
}

function groupAFeatures(model: (typeof GROUP_A_MODELS)[number]): string[] {
  const features = ['Text-to-video', 'Image-to-video (single seed)'];
  if (model.supportsReferenceImages) features.push('Reference images (max 3)');
  if (model.supportsLastFrame) features.push('Locked last frame');
  if (model.supports4k) features.push('4K');
  if (model.supportsAudio) features.push('Generated audio');
  features.push('Negative prompt');
  return features;
}

const GROUP_A_CARDS: VideoModelCard[] = GROUP_A_MODELS.map((m) => ({
  id: m.id,
  family: 'group-a' as const,
  name: m.name,
  provider: m.provider,
  blurb: m.blurb,
  bestFor: GROUP_A_BEST_FOR[m.id] || m.blurb,
  durations: `${groupAMinDurationS(m)}–${m.maxDurationS}s (default ${m.defaultDurationS}s)`,
  aspectRatios: ['16:9', '9:16', '1:1'],
  costLabel: m.costHint,
  features: groupAFeatures(m),
  accent: GROUP_A_ACCENTS[m.id] || '#7A6030',
  availability: 'groupA' as const,
  options: groupAOptions(m),
}));

const KLING_PER_SECOND: Record<string, { std: number; pro: number }> = {
  'kling-3.0-omni': { std: 0.084, pro: 0.112 },
  'kling-3.0': { std: 0.084, pro: 0.112 },
  'kling-2.6': { std: 0.042, pro: 0.070 },
  'kling-2.5-turbo': { std: 0.042, pro: 0.070 },
};

const KLING_CARDS: VideoModelCard[] = [
  {
    id: 'kling-3.0-omni',
    family: 'kling',
    name: 'Kling 3.0 Omni',
    provider: 'Kuaishou Kling',
    blurb: 'Kling\'s omni multimodal flagship: prompt, first/last frame and 2-4 reference images in one request, with native audio.',
    bestFor: 'The strongest character and style consistency Kling offers, from up to 4 reference images.',
    durations: '5s or 10s',
    aspectRatios: ['16:9', '9:16', '1:1'],
    costLabel: '$0.084 / s (std) / $0.112 / s (pro)',
    features: ['Text-to-video', 'Image-to-video', '2-4 reference images', 'Native audio', 'Camera control', 'Seed'],
    accent: '#C8920A',
    availability: 'kling',
    options: [
      { key: 'aspectRatio', label: 'Aspect ratio', type: 'select', options: ratioOptions(['16:9', '9:16', '1:1']), defaultValue: '16:9' },
      { key: 'duration', label: 'Duration', type: 'select', options: [{ value: '5', label: '5s' }, { value: '10', label: '10s' }], defaultValue: '5' },
      { key: 'mode', label: 'Mode', type: 'select', options: [{ value: 'std', label: 'Standard' }, { value: 'pro', label: 'Pro' }], defaultValue: 'std' },
      { key: 'seed', label: 'Seed', type: 'number' },
    ],
  },
  {
    id: 'kling-3.0',
    family: 'kling',
    name: 'Kling 3.0',
    provider: 'Kuaishou Kling',
    blurb: 'Kling\'s current flagship: text-to-video and image-to-video with multi-shot prompts and native audio.',
    bestFor: 'The highest-fidelity Kling output, especially human motion.',
    durations: '5s or 10s',
    aspectRatios: ['16:9', '9:16', '1:1'],
    costLabel: '$0.084 / s (std) / $0.112 / s (pro)',
    features: ['Text-to-video', 'Image-to-video', 'Multi-shot prompts', 'Native audio', 'Camera control', 'Seed'],
    accent: '#C8920A',
    availability: 'kling',
    options: [
      { key: 'aspectRatio', label: 'Aspect ratio', type: 'select', options: ratioOptions(['16:9', '9:16', '1:1']), defaultValue: '16:9' },
      { key: 'duration', label: 'Duration', type: 'select', options: [{ value: '5', label: '5s' }, { value: '10', label: '10s' }], defaultValue: '5' },
      { key: 'mode', label: 'Mode', type: 'select', options: [{ value: 'std', label: 'Standard' }, { value: 'pro', label: 'Pro' }], defaultValue: 'std' },
      { key: 'seed', label: 'Seed', type: 'number' },
    ],
  },
  {
    id: 'kling-2.6',
    family: 'kling',
    name: 'Kling 2.6',
    provider: 'Kuaishou Kling',
    blurb: 'The current-generation Kling tier - balanced text-to-video and image-to-video with native audio.',
    bestFor: 'The everyday Kling pick when 3.0 is more than you need.',
    durations: '5s or 10s',
    aspectRatios: ['16:9', '9:16', '1:1'],
    costLabel: '$0.042 / s (std) / $0.070 / s (pro)',
    features: ['Text-to-video', 'Image-to-video', 'Native audio', 'Camera control', 'Seed'],
    accent: '#B4720A',
    availability: 'kling',
    options: [
      { key: 'aspectRatio', label: 'Aspect ratio', type: 'select', options: ratioOptions(['16:9', '9:16', '1:1']), defaultValue: '16:9' },
      { key: 'duration', label: 'Duration', type: 'select', options: [{ value: '5', label: '5s' }, { value: '10', label: '10s' }], defaultValue: '5' },
      { key: 'mode', label: 'Mode', type: 'select', options: [{ value: 'std', label: 'Standard' }, { value: 'pro', label: 'Pro' }], defaultValue: 'std' },
      { key: 'seed', label: 'Seed', type: 'number' },
    ],
  },
  {
    id: 'kling-2.5-turbo',
    family: 'kling',
    name: 'Kling 2.5 Turbo',
    provider: 'Kuaishou Kling',
    blurb: 'The fast tier of the current Kling API - text-to-video and image-to-video, silent.',
    bestFor: 'Cheap, quick Kling clips on a budget.',
    durations: '5s or 10s',
    aspectRatios: ['16:9', '9:16', '1:1'],
    costLabel: '$0.042 / s (std) / $0.070 / s (pro)',
    features: ['Text-to-video', 'Image-to-video', 'Camera control', 'Seed'],
    accent: '#7A6030',
    availability: 'kling',
    options: [
      { key: 'aspectRatio', label: 'Aspect ratio', type: 'select', options: ratioOptions(['16:9', '9:16', '1:1']), defaultValue: '16:9' },
      { key: 'duration', label: 'Duration', type: 'select', options: [{ value: '5', label: '5s' }, { value: '10', label: '10s' }], defaultValue: '5' },
      { key: 'mode', label: 'Mode', type: 'select', options: [{ value: 'std', label: 'Standard' }, { value: 'pro', label: 'Pro' }], defaultValue: 'std' },
      { key: 'seed', label: 'Seed', type: 'number' },
    ],
  },
];

const RUNWAY_CARDS: VideoModelCard[] = [
  {
    id: 'gen4.5',
    family: 'runway',
    name: 'Runway Gen-4.5',
    provider: 'Runway',
    blurb: 'Runway\'s flagship. Text-to-video, or image-to-video when you supply a public HTTPS frame.',
    bestFor: 'Commercial-grade motion and the widest choice of frame shapes.',
    durations: '2–10s (default 5s)',
    aspectRatios: ['1280:720', '720:1280', '1104:832', '832:1104', '960:960', '1584:672'],
    costLabel: '≈ $0.12 / second',
    features: ['Text-to-video', 'Image-to-video', 'Six pixel-pair ratios', 'Idempotent submits'],
    accent: '#B4720A',
    availability: 'runway',
    caveat: 'Runway wants pixel-pair ratios such as 1280:720, not the 16:9 shorthand. Text-to-video accepts landscape and portrait only.',
    options: [
      { key: 'aspectRatio', label: 'Ratio', type: 'select', options: ratioOptions(['1280:720', '720:1280']), defaultValue: '1280:720', hint: 'Text-to-video supports these two; image-to-video unlocks all six.' },
      { key: 'duration', label: 'Duration', type: 'select', options: [2, 4, 5, 8, 10].map((d) => ({ value: String(d), label: `${d}s` })), defaultValue: '5' },
    ],
  },
  {
    id: 'gen4_turbo',
    family: 'runway',
    name: 'Runway Gen-4 Turbo',
    provider: 'Runway',
    blurb: 'Image-to-video only, and the cheapest way on the platform to bring one still to life.',
    bestFor: 'Animating a single product photo for pennies.',
    durations: '2–10s (default 5s)',
    aspectRatios: ['1280:720', '720:1280', '1104:832', '832:1104', '960:960', '1584:672'],
    costLabel: '≈ $0.05 / second',
    features: ['Image-to-video only', 'Six pixel-pair ratios', 'Idempotent submits'],
    accent: '#B4720A',
    availability: 'runway',
    caveat: 'Needs a public HTTPS image URL — this model has no text-to-video path.',
    options: [
      { key: 'aspectRatio', label: 'Ratio', type: 'select', options: ratioOptions(['1280:720', '720:1280', '1104:832', '832:1104', '960:960', '1584:672']), defaultValue: '1280:720' },
      { key: 'duration', label: 'Duration', type: 'select', options: [2, 4, 5, 8, 10].map((d) => ({ value: String(d), label: `${d}s` })), defaultValue: '5' },
    ],
  },
];

const HIGGSFIELD_CARDS: VideoModelCard[] = [
  {
    id: 'minimax-hailuo-02',
    family: 'higgsfield',
    name: 'MiniMax Hailuo 02',
    provider: 'MiniMax via Higgsfield',
    blurb: 'MiniMax\'s Hailuo 02 text-to-video, reached through the Higgsfield proxy so no MiniMax key is needed.',
    bestFor: 'Expressive character motion and a distinctly different look to Veo or Sora.',
    durations: '1–15s where the model supports it',
    aspectRatios: ['16:9', '9:16'],
    costLabel: '$1.00 / video',
    features: ['Text-to-video', 'Seed'],
    accent: '#B45309',
    availability: 'higgsfield',
    options: [
      { key: 'aspectRatio', label: 'Aspect ratio', type: 'select', options: ratioOptions(['16:9', '9:16']), defaultValue: '16:9' },
      { key: 'duration', label: 'Duration', type: 'select', options: [4, 6, 8, 10].map((d) => ({ value: String(d), label: `${d}s` })), defaultValue: '6' },
      { key: 'seed', label: 'Seed', type: 'number' },
    ],
  },
  {
    id: 'dop-turbo',
    family: 'higgsfield',
    name: 'Higgsfield DoP',
    provider: 'Higgsfield',
    blurb: 'Higgsfield\'s director-of-photography model: animates one input image with real camera motion. Turbo, Standard and Lite tiers.',
    bestFor: 'Putting a camera move on a still you already have.',
    durations: 'Model-defined clip length',
    aspectRatios: ['Inherits the input image'],
    costLabel: '$1.00 / video',
    features: ['Image-to-video only', 'Camera motion presets', 'Seed'],
    accent: '#C8920A',
    availability: 'higgsfield',
    caveat: 'Image-to-video only — supply a public image URL or a base64 frame.',
    options: [
      { key: 'style', label: 'Tier', type: 'select', options: [{ value: 'dop-turbo', label: 'Turbo (fast)' }, { value: 'dop-standard', label: 'Standard (best)' }, { value: 'dop-lite', label: 'Lite (cheapest)' }], defaultValue: 'dop-turbo' },
      { key: 'seed', label: 'Seed', type: 'number' },
    ],
  },
];

export const VIDEO_MODEL_CARDS: VideoModelCard[] = [
  ...GROUP_A_CARDS,
  ...KLING_CARDS,
  ...RUNWAY_CARDS,
  ...HIGGSFIELD_CARDS,
];

/** Card groups, in the order the Videos tab renders them. */
export const VIDEO_GROUPS: Array<{ id: ModelFamily; label: string; note: string }> = [
  { id: 'group-a', label: 'Google Veo · OpenAI Sora · Gemini · Seedance', note: 'POST /api/veo/generate/video — the platform\'s baseline video proxy.' },
  { id: 'kling', label: 'Kling', note: 'POST /api/generate/kling/text-to-video · image-to-video · multi-image.' },
  { id: 'runway', label: 'Runway', note: 'POST /api/generate/runway/video — needs an Idempotency-Key on every submit.' },
  { id: 'higgsfield', label: 'Higgsfield · MiniMax', note: 'POST /api/generate/higgsfield/video · image-to-video.' },
];

export const IMAGE_GROUPS: Array<{ id: ModelFamily; label: string; note: string }> = [
  { id: 'openai-image', label: 'OpenAI', note: 'POST /api/generate/image and /api/veo/generate/image, via the vv-image-generate hook.' },
  { id: 'gemini-image', label: 'Google Gemini', note: 'POST /api/veo/generate/image — the only route with native print ratios.' },
  { id: 'higgsfield', label: 'Higgsfield', note: 'POST /api/generate/higgsfield/image and /soul.' },
];

export function imageModel(id: string): ImageModelCard | null {
  return IMAGE_MODEL_CARDS.find((m) => m.id === id) || null;
}

export function videoModel(id: string): VideoModelCard | null {
  return VIDEO_MODEL_CARDS.find((m) => m.id === id) || null;
}

/** Best-effort cost estimate for the chosen model and options. */
export function estimateCost(card: ImageModelCard | VideoModelCard, options: Record<string, string>): string {
  const seconds = Number(options.duration) || 0;
  if (card.family === 'runway' && seconds > 0) {
    const perSecond = card.id === 'gen4_turbo' ? 0.05 : 0.12;
    return `≈ $${(perSecond * seconds).toFixed(2)} for ${seconds}s`;
  }
  if (card.family === 'kling' && seconds > 0) {
    const pro = options.mode === 'pro';
    const rates = KLING_PER_SECOND[card.id];
    const perSecond = rates ? (pro ? rates.pro : rates.std) : (pro ? 0.070 : 0.042);
    return `≈ $${(perSecond * seconds).toFixed(2)} for ${seconds}s ${pro ? 'pro' : 'std'}`;
  }
  return card.costLabel;
}
