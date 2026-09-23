/**
 * VIDEO ENGINE CATALOG — the single source of truth for every video/image
 * generation engine the VidVerge apps can call. Used by Creatables and by the
 * engine selectors inside Product Video, SceneForge, Script-to-Video,
 * Video Enhancer and Ads Studio.
 *
 * GROUPS
 *  A — standard platform video proxy   POST /api/veo/generate/video
 *      (Google Omni/Veo, OpenAI Sora, OpenRouter-hosted models)
 *  B — Runway proxy                    POST /api/generate/runway/video
 *      + 7 Runway Recipes              POST /api/generate/runway/recipes/:id
 *  C — Kling (documented, platform key pending → shown as Coming Soon)
 *  D — image companions                POST /api/veo/generate/image
 *                                      POST /api/generate/image
 *
 * Higgsfield endpoints are deliberately absent (founder ruling, 23 Sep 2026).
 */

export type EngineGroup = 'group-a' | 'runway-video' | 'runway-recipe' | 'kling';

export type EngineTier = 'Fast' | 'Standard' | 'Cinematic' | 'Lite' | 'Character' | 'Pro' | 'Recipe';

export type GroupAAspect = '16:9' | '9:16' | '1:1';

// ---------------------------------------------------------------------------
// GROUP A — /api/veo/generate/video models
// ---------------------------------------------------------------------------

export interface GroupAModel {
  group: 'group-a';
  /** EXACT model string the proxy accepts — any typo answers 400. */
  id: string;
  name: string;
  provider: 'Google' | 'OpenAI' | 'ByteDance · OpenRouter' | 'Google · OpenRouter';
  tier: EngineTier;
  blurb: string;
  /** Single seed image (imageData). Every Group A model accepts one. */
  supportsImageData: true;
  /** referenceImages (max 3) — Omni Flash + Veo 3.1 / 3.1 Fast only. */
  supportsReferenceImages: boolean;
  /** On Veo 3.1 models referenceImages is mutually exclusive with
   * imageData AND lastFrameImage. Omni Flash allows refs + imageData. */
  refsExclusiveWithSeed: boolean;
  /** lastFrameImage — Veo 3.1 / 3.1 Fast only (first/last-frame flow). */
  supportsLastFrame: boolean;
  /** '4k' resolution honored — veo-3.1-generate-preview + fast only. */
  supports4k: boolean;
  supportsAudio: boolean;
  supportsNegativePrompt: boolean;
  /** Longest clip known-safe on this model (the proxy normalizes 4–25). */
  maxDurationS: number;
  defaultDurationS: number;
  costHint: string;
}

const gA = (m: Omit<GroupAModel, 'group' | 'supportsImageData' | 'supportsNegativePrompt'>): GroupAModel =>
  ({ group: 'group-a', supportsImageData: true, supportsNegativePrompt: true, ...m });

export const GROUP_A_MODELS: GroupAModel[] = [
  gA({
    id: 'gemini-omni-flash-preview', name: 'Gemini Omni Flash', provider: 'Google', tier: 'Character',
    blurb: 'Character consistency champion — send the same reference images with every scene and the same face, product or mascot carries across cuts. Refs + seed image may combine.',
    supportsReferenceImages: true, refsExclusiveWithSeed: false, supportsLastFrame: false,
    supports4k: false, supportsAudio: true, maxDurationS: 8, defaultDurationS: 8,
    costHint: '≈ $0.40 / clip',
  }),
  gA({
    id: 'veo-3.1-generate-preview', name: 'Veo 3.1', provider: 'Google', tier: 'Cinematic',
    blurb: 'Hero cinematic quality up to 4K. Ingredients workflow: up to 3 reference images OR a first-frame seed + locked last frame (the two groups are mutually exclusive).',
    supportsReferenceImages: true, refsExclusiveWithSeed: true, supportsLastFrame: true,
    supports4k: true, supportsAudio: true, maxDurationS: 8, defaultDurationS: 8,
    costHint: '≈ $0.40–0.80 / clip',
  }),
  gA({
    id: 'veo-3.1-fast-generate-preview', name: 'Veo 3.1 Fast', provider: 'Google', tier: 'Fast',
    blurb: 'Same Veo 3.1 ingredient rules, faster and cheaper — the workhorse for quality-with-turnaround. 4K capable.',
    supportsReferenceImages: true, refsExclusiveWithSeed: true, supportsLastFrame: true,
    supports4k: true, supportsAudio: true, maxDurationS: 8, defaultDurationS: 8,
    costHint: '≈ $0.25–0.50 / clip',
  }),
  gA({
    id: 'veo-3.0-generate-001', name: 'Veo 3.0', provider: 'Google', tier: 'Standard',
    blurb: 'Solid previous-generation Veo. Single seed image only — no reference images, no last frame.',
    supportsReferenceImages: false, refsExclusiveWithSeed: false, supportsLastFrame: false,
    supports4k: false, supportsAudio: true, maxDurationS: 8, defaultDurationS: 8,
    costHint: '≈ $0.40 / clip',
  }),
  gA({
    id: 'veo-3.0-fast-generate-001', name: 'Veo 3.0 Fast', provider: 'Google', tier: 'Fast',
    blurb: 'Faster, cheaper Veo 3.0. Seed image only.',
    supportsReferenceImages: false, refsExclusiveWithSeed: false, supportsLastFrame: false,
    supports4k: false, supportsAudio: true, maxDurationS: 8, defaultDurationS: 8,
    costHint: '≈ $0.20 / clip',
  }),
  gA({
    id: 'veo-2.0-generate-001', name: 'Veo 2.0', provider: 'Google', tier: 'Standard',
    blurb: 'Legacy Veo — kept for continuity with older projects. Seed image only.',
    supportsReferenceImages: false, refsExclusiveWithSeed: false, supportsLastFrame: false,
    supports4k: false, supportsAudio: false, maxDurationS: 8, defaultDurationS: 6,
    costHint: '≈ $0.30 / clip',
  }),
  gA({
    id: 'sora-2', name: 'Sora 2', provider: 'OpenAI', tier: 'Cinematic',
    blurb: 'OpenAI Sora — strongest at surreal, stylized and complex multi-subject scenes. Single seed image only.',
    supportsReferenceImages: false, refsExclusiveWithSeed: false, supportsLastFrame: false,
    supports4k: false, supportsAudio: true, maxDurationS: 12, defaultDurationS: 8,
    costHint: '≈ $0.50 / clip',
  }),
  gA({
    id: 'sora-2-pro', name: 'Sora 2 Pro', provider: 'OpenAI', tier: 'Pro',
    blurb: 'Higher-quality Sora tier for showcase pieces. Single seed image only.',
    supportsReferenceImages: false, refsExclusiveWithSeed: false, supportsLastFrame: false,
    supports4k: false, supportsAudio: true, maxDurationS: 12, defaultDurationS: 8,
    costHint: '≈ $1.00+ / clip',
  }),
  gA({
    id: 'openrouter/bytedance/seedance-2.0-fast', name: 'Seedance 2.0 Fast', provider: 'ByteDance · OpenRouter', tier: 'Fast',
    blurb: 'Fast, cheap B-roll machine. Seed image only — reference images and last frame answer 400 on OpenRouter models.',
    supportsReferenceImages: false, refsExclusiveWithSeed: false, supportsLastFrame: false,
    supports4k: false, supportsAudio: false, maxDurationS: 10, defaultDurationS: 6,
    costHint: 'lowest cost / clip',
  }),
  gA({
    id: 'openrouter/google/veo-3.1', name: 'Veo 3.1 (OpenRouter)', provider: 'Google · OpenRouter', tier: 'Cinematic',
    blurb: 'Veo 3.1 routed through OpenRouter. Seed image only on this path — no ingredients.',
    supportsReferenceImages: false, refsExclusiveWithSeed: false, supportsLastFrame: false,
    supports4k: false, supportsAudio: false, maxDurationS: 8, defaultDurationS: 8,
    costHint: '≈ $0.40 / clip',
  }),
  gA({
    id: 'openrouter/google/veo-3.1-fast', name: 'Veo 3.1 Fast (OpenRouter)', provider: 'Google · OpenRouter', tier: 'Fast',
    blurb: 'Fast Veo 3.1 via OpenRouter. Seed image only.',
    supportsReferenceImages: false, refsExclusiveWithSeed: false, supportsLastFrame: false,
    supports4k: false, supportsAudio: false, maxDurationS: 8, defaultDurationS: 8,
    costHint: '≈ $0.25 / clip',
  }),
  gA({
    id: 'openrouter/google/veo-3.1-lite', name: 'Veo 3.1 Lite (OpenRouter)', provider: 'Google · OpenRouter', tier: 'Lite',
    blurb: 'The lowest-cost Veo path. Seed image only.',
    supportsReferenceImages: false, refsExclusiveWithSeed: false, supportsLastFrame: false,
    supports4k: false, supportsAudio: false, maxDurationS: 8, defaultDurationS: 6,
    costHint: 'cheapest Veo output',
  }),
];

export function groupAModel(id: string | null | undefined): GroupAModel | null {
  return GROUP_A_MODELS.find((m) => m.id === String(id || '')) || null;
}

/** Models whose 4K request is actually honored. */
export const FOUR_K_MODELS = ['veo-3.1-generate-preview', 'veo-3.1-fast-generate-preview'];

/**
 * COMBINING RULES — enforced client-side before submit (the proxy enforces
 * them server-side with a 400). Returns a human-readable violation or null.
 *   1. Veo 3.1 / 3.1 Fast: referenceImages XOR (imageData / lastFrameImage)
 *   2. Veo 3.1 / 3.1 Fast: imageData + lastFrameImage = first/last-frame flow (valid)
 *   3. Omni Flash: referenceImages + imageData OK; lastFrameImage never
 *   4. Sora / OpenRouter / Veo 3.0 / 2.0: imageData only
 */
export function validateGroupAInputs(modelId: string, inputs: {
  prompt?: string;
  imageData?: string | null;
  referenceImages?: unknown[] | null;
  lastFrameImage?: unknown | null;
}): string | null {
  const m = groupAModel(modelId);
  if (!m) return `Unknown model "${modelId}".`;
  const prompt = String(inputs.prompt || '').trim();
  if (prompt.length < 10) return 'The prompt needs at least 10 characters.';
  if (prompt.length > 1000) return 'The prompt is over the 1000-character limit.';
  const refs = (inputs.referenceImages || []).length;
  const seed = Boolean(inputs.imageData);
  const last = Boolean(inputs.lastFrameImage);
  if (refs > 3) return 'At most 3 reference images are allowed.';
  if (refs > 0 && !m.supportsReferenceImages) return `${m.name} does not support reference images — use a single seed image instead.`;
  if (last && !m.supportsLastFrame) return `${m.name} does not support a last-frame image.`;
  if (refs > 0 && m.refsExclusiveWithSeed && (seed || last)) {
    return `${m.name}: reference images are mutually exclusive with the seed image and last frame — pick one workflow.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// GROUP B — Runway base video models + Recipes
// ---------------------------------------------------------------------------

/** Pixel-pair ratio strings Runway expects (NOT '16:9' shorthand). */
export interface RunwayRatio { value: string; label: string }

export const RUNWAY_RATIOS: RunwayRatio[] = [
  { value: '1280:720', label: 'Landscape 16:9 → 1280:720' },
  { value: '720:1280', label: 'Portrait 9:16 → 720:1280' },
  { value: '1104:832', label: 'Landscape 4:3 → 1104:832' },
  { value: '832:1104', label: 'Portrait 3:4 → 832:1104' },
  { value: '960:960', label: 'Square 1:1 → 960:960' },
  { value: '1584:672', label: 'Ultrawide 21:9 → 1584:672' },
];

export interface RunwayVideoModel {
  group: 'runway-video';
  id: 'gen4.5' | 'gen4_turbo';
  name: string;
  tier: EngineTier;
  blurb: string;
  /** Text-to-video supported (gen4.5 only). */
  textToVideo: boolean;
  /** Ratios valid for text-to-video. */
  t2vRatios: string[];
  /** Ratios valid for image-to-video. */
  i2vRatios: string[];
  minDurationS: number;
  maxDurationS: number;
  defaultDurationS: number;
  pricePerSecondUsd: number;
}

export const RUNWAY_VIDEO_MODELS: RunwayVideoModel[] = [
  {
    group: 'runway-video', id: 'gen4.5', name: 'Runway Gen 4.5', tier: 'Cinematic',
    blurb: 'Runway flagship. Text-to-video (promptText + ratio + duration) or image-to-video (adds promptImage).',
    textToVideo: true,
    t2vRatios: ['1280:720', '720:1280'],
    i2vRatios: ['1280:720', '720:1280', '1104:832', '832:1104', '960:960', '1584:672'],
    minDurationS: 2, maxDurationS: 10, defaultDurationS: 5,
    pricePerSecondUsd: 0.12,
  },
  {
    group: 'runway-video', id: 'gen4_turbo', name: 'Runway Gen 4 Turbo', tier: 'Fast',
    blurb: 'Image-to-video ONLY — requires promptImage. The cheapest way to animate one image.',
    textToVideo: false,
    t2vRatios: [],
    i2vRatios: ['1280:720', '720:1280', '1104:832', '832:1104', '960:960', '1584:672'],
    minDurationS: 2, maxDurationS: 10, defaultDurationS: 5,
    pricePerSecondUsd: 0.05,
  },
];

export function runwayVideoModel(id: string | null | undefined): RunwayVideoModel | null {
  return RUNWAY_VIDEO_MODELS.find((m) => m.id === id) || null;
}

/** The 22 ad_localization target languages. */
export const RUNWAY_LOCALIZATION_LANGUAGES = [
  { code: 'ar', label: 'Arabic' }, { code: 'zh', label: 'Chinese (Simplified)' },
  { code: 'zh-Hant', label: 'Chinese (Traditional)' }, { code: 'nl', label: 'Dutch' },
  { code: 'en', label: 'English' }, { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' }, { code: 'el', label: 'Greek' },
  { code: 'hi', label: 'Hindi' }, { code: 'id', label: 'Indonesian' },
  { code: 'it', label: 'Italian' }, { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' }, { code: 'pl', label: 'Polish' },
  { code: 'pt', label: 'Portuguese' }, { code: 'ru', label: 'Russian' },
  { code: 'es', label: 'Spanish' }, { code: 'sv', label: 'Swedish' },
  { code: 'th', label: 'Thai' }, { code: 'tr', label: 'Turkish' },
  { code: 'uk', label: 'Ukrainian' }, { code: 'vi', label: 'Vietnamese' },
];

export type RunwayRecipeId =
  | 'product_ad' | 'product_swap' | 'product_ugc' | 'multi_shot_video'
  | 'ad_localization' | 'marketing_stock_image' | 'product_campaign_image';

export interface RunwayRecipe {
  group: 'runway-recipe';
  id: RunwayRecipeId;
  name: string;
  purpose: string;
  /** One-line note on the required inputs. */
  inputsNote: string;
  priceNote: string;
  outputKind: 'video' | 'image';
}

export const RUNWAY_RECIPES: RunwayRecipe[] = [
  {
    group: 'runway-recipe', id: 'product_ad', name: 'Product Ad',
    purpose: 'A complete polished product advertisement auto-assembled from your product photos.',
    inputsNote: '1–10 product images (+ up to 4 style images), ratio, 4–15s, optional audio',
    priceNote: '200 credits base (4s) + 36 / extra second (≈ $2.00 + $0.36/s)',
    outputKind: 'video',
  },
  {
    group: 'runway-recipe', id: 'product_swap', name: 'Product Swap',
    purpose: 'Replace the product inside an existing video with your product.',
    inputsNote: 'reference video + original product image + 1–10 new product images',
    priceNote: '212 credits base + 36 / second (≈ $2.12 + $0.36/s)',
    outputKind: 'video',
  },
  {
    group: 'runway-recipe', id: 'product_ugc', name: 'UGC Creator',
    purpose: 'A UGC-style testimonial ad: your creator character presents your product.',
    inputsNote: 'character image + product image, portrait ratio, 4–15s (default 15)',
    priceNote: '192 credits base + 36 / second (≈ $1.92 + $0.36/s)',
    outputKind: 'video',
  },
  {
    group: 'runway-recipe', id: 'multi_shot_video', name: 'Multi-Shot Video',
    purpose: 'Several directed shots auto-cut into one video.',
    inputsNote: "mode 'auto' + prompt, or 'custom' + 3–5 shots whose durations sum to the total",
    priceNote: '13 credits / s (SD) or 17 / s (HD)',
    outputKind: 'video',
  },
  {
    group: 'runway-recipe', id: 'ad_localization', name: 'Ad Localization',
    purpose: 'Localize an existing ad into one of 22 languages.',
    inputsNote: 'reference image + target language',
    priceNote: 'fixed 21 credits (≈ $0.21)',
    outputKind: 'video',
  },
  {
    group: 'runway-recipe', id: 'marketing_stock_image', name: 'Stock Image',
    purpose: 'Generate marketing stock imagery from a commercial prompt.',
    inputsNote: 'prompt (+ optional reference image), 1–4 outputs, quality low/medium/high',
    priceNote: '8 credits processing + 1 / 5 / 20 per output by quality',
    outputKind: 'image',
  },
  {
    group: 'runway-recipe', id: 'product_campaign_image', name: 'Campaign Images',
    purpose: 'A coordinated 4-image campaign set from one product image + direction.',
    inputsNote: 'product image + prompt',
    priceNote: '36 credits / output × 4 outputs = 144 (≈ $1.44)',
    outputKind: 'image',
  },
];

export function runwayRecipe(id: string | null | undefined): RunwayRecipe | null {
  return RUNWAY_RECIPES.find((r) => r.id === id) || null;
}

/** The friendly message every surface shows on 503 generation_disabled. */
export const RUNWAY_DISABLED_MESSAGE = 'Runway generation is being enabled — check back soon.';

// ---------------------------------------------------------------------------
// GROUP C — Kling (documented, platform key pending → Coming Soon, disabled)
// ---------------------------------------------------------------------------

export interface KlingModel {
  group: 'kling';
  id: string;
  name: string;
  tier: EngineTier;
  blurb: string;
  comingSoon: true;
}

export const KLING_COMING_SOON_MESSAGE =
  'Kling is being configured on the platform — it will activate automatically when ready.';

export const KLING_MODELS: KlingModel[] = [
  { group: 'kling', id: 'kling-v2-master', name: 'Kling v2 Master', tier: 'Cinematic', comingSoon: true,
    blurb: 'Best Kling quality. Text-to-video, image-to-video, multi-image, video-extend and lip-sync. Modes std/pro, durations "5"/"10".' },
  { group: 'kling', id: 'kling-v1-6', name: 'Kling v1.6', tier: 'Standard', comingSoon: true,
    blurb: 'Balanced Kling generation — text-to-video and image-to-video.' },
  { group: 'kling', id: 'kling-v1-5', name: 'Kling v1.5', tier: 'Standard', comingSoon: true,
    blurb: 'Earlier Kling tier — text-to-video and image-to-video.' },
  { group: 'kling', id: 'kling-v1', name: 'Kling v1', tier: 'Lite', comingSoon: true,
    blurb: 'First-generation Kling.' },
];

export function isKlingModel(id: string | null | undefined): boolean {
  return KLING_MODELS.some((m) => m.id === id);
}

// ---------------------------------------------------------------------------
// GROUP D — image companions
// ---------------------------------------------------------------------------

export interface ImageModel {
  id: 'gemini-3.1-flash-image' | 'dall-e-3' | 'gpt-image-2';
  name: string;
  endpoint: '/api/veo/generate/image' | '/api/generate/image';
  aspectRatios: string[];
  supportsEdit: boolean;
  note: string;
}

/** NEVER use gemini-2.5-flash-image-preview — retired; calls come back failed. */
export const IMAGE_MODELS: ImageModel[] = [
  {
    id: 'gemini-3.1-flash-image', name: 'Gemini 3.1 Flash Image', endpoint: '/api/veo/generate/image',
    aspectRatios: ['1:1', '16:9', '9:16', '3:4', '4:3', '4:5', '5:4'],
    supportsEdit: true,
    note: 'Text-to-image AND image edits (editImageData, base64 without the data: prefix). All 7 ratios.',
  },
  {
    id: 'dall-e-3', name: 'DALL·E 3', endpoint: '/api/veo/generate/image',
    aspectRatios: ['1:1', '16:9', '9:16'],
    supportsEdit: false,
    note: 'Text-to-image only. 1:1 / 16:9 / 9:16 only — other ratios answer 400.',
  },
  {
    id: 'gpt-image-2', name: 'GPT Image 2', endpoint: '/api/generate/image',
    aspectRatios: ['1:1', '16:9', '9:16'],
    supportsEdit: false,
    note: 'Via /api/generate/image with quality standard/hd; returns a durable GCS imageUrl.',
  },
];

// ---------------------------------------------------------------------------
// SMART RECOMMENDATION — "✨ Recommend for me"
// ---------------------------------------------------------------------------

export interface RecommendInput {
  prompt: string;
  hasCharacterImage?: boolean;
  hasProductImages?: boolean;
  imageCount?: number;
  durationS?: number;
  budgetSensitive?: boolean;
  /** True when a Runway submit already answered 503 this session. */
  runwayUnavailable?: boolean;
}

export interface Recommendation {
  engineId: string;
  group: EngineGroup;
  name: string;
  reason: string;
  /** Runway picks carry the 503 caveat so the UI can surface it. */
  caveat?: string;
}

const RUNWAY_CAVEAT = 'Runway may still be being enabled on the platform — if the submit answers 503, fall back to a Veo engine.';

export function recommendEngine(input: RecommendInput): Recommendation {
  const p = String(input.prompt || '').toLowerCase();
  const images = Number(input.imageCount) || 0;
  const has = (re: RegExp) => re.test(p);
  const runwayOk = !input.runwayUnavailable;

  // Character photo + product photo → UGC testimonial ad.
  if (runwayOk && input.hasCharacterImage && input.hasProductImages) {
    return { engineId: 'product_ugc', group: 'runway-recipe', name: 'Runway UGC Creator', reason: 'You have a character photo and a product photo — the UGC recipe builds a creator-style testimonial ad from exactly those two inputs.', caveat: RUNWAY_CAVEAT };
  }
  // Character consistency.
  if (input.hasCharacterImage || has(/same (face|person|character)|consistent (face|character|person)|persona|mascot|recurring character|across (every |all )?scenes?/)) {
    return { engineId: 'gemini-omni-flash-preview', group: 'group-a', name: 'Gemini Omni Flash', reason: 'Best for character consistency — same face across every scene via reference images.' };
  }
  // Product photos + wants a finished polished ad.
  if (runwayOk && input.hasProductImages && has(/\bad\b|advert|commercial|promo|polished|campaign/)) {
    return { engineId: 'product_ad', group: 'runway-recipe', name: 'Runway Product Ad', reason: 'You have product photos and want a finished ad — this recipe auto-assembles a complete polished product advertisement.', caveat: RUNWAY_CAVEAT };
  }
  // Multiple shots auto-cut.
  if (has(/multi.?shot|several shots|multiple (shots|scenes) .*(one|single) video|auto.?cut|shot list/)) {
    if (runwayOk) return { engineId: 'multi_shot_video', group: 'runway-recipe', name: 'Runway Multi-Shot Video', reason: 'Multiple directed shots auto-cut into one video is exactly what this recipe does.', caveat: RUNWAY_CAVEAT };
  }
  // Surreal / stylized / complex multi-subject.
  if (has(/surreal|dream|stylized|abstract|impossible|morph|fantastical|multi.?subject|crowd of|complex scene/)) {
    return { engineId: 'sora-2', group: 'group-a', name: 'Sora 2', reason: 'Sora 2 is the strongest engine for surreal, stylized and complex multi-subject scenes.' };
  }
  // One image, cheapest image-to-video.
  if (images === 1 && (input.budgetSensitive || has(/cheap|budget|low.?cost|inexpensive/))) {
    if (runwayOk) return { engineId: 'gen4_turbo', group: 'runway-video', name: 'Runway Gen 4 Turbo', reason: 'One image + lowest price image-to-video: Gen 4 Turbo at $0.05/second.', caveat: RUNWAY_CAVEAT };
    return { engineId: 'veo-3.1-generate-preview', group: 'group-a', name: 'Veo 3.1', reason: 'Runway is unavailable right now — Veo 3.1 is the best image-to-video fallback.' };
  }
  // Lowest-cost Veo.
  if (has(/cheapest veo|lowest.?cost veo|veo.*cheap/)) {
    return { engineId: 'openrouter/google/veo-3.1-lite', group: 'group-a', name: 'Veo 3.1 Lite (OpenRouter)', reason: 'The lowest-cost Veo path on the platform.' };
  }
  // Fast cheap B-roll, no image / budget-sensitive anything.
  if ((images === 0 && has(/b.?roll|filler|background (footage|clips)|quick clips?|fast|cheap/)) || input.budgetSensitive) {
    return { engineId: 'openrouter/bytedance/seedance-2.0-fast', group: 'group-a', name: 'Seedance 2.0 Fast', reason: 'Fast, cheap B-roll with solid quality — the budget pick for any content type.' };
  }
  // Cinematic hero / 4K / brand references.
  if (has(/cinematic|hero|4k|premium|film|trailer|epic/) || images > 1) {
    return { engineId: 'veo-3.1-generate-preview', group: 'group-a', name: 'Veo 3.1', reason: 'Hero cinematic quality with 4K and brand reference images (up to 3 ingredients).' };
  }
  // Image-to-video default when an image exists.
  if (images >= 1) {
    if (runwayOk) return { engineId: 'gen4_turbo', group: 'runway-video', name: 'Runway Gen 4 Turbo', reason: 'You have one image — Gen 4 Turbo is the cheapest way to bring it to life.', caveat: RUNWAY_CAVEAT };
    return { engineId: 'veo-3.1-generate-preview', group: 'group-a', name: 'Veo 3.1', reason: 'Runway is unavailable right now — Veo 3.1 handles image-to-video beautifully.' };
  }
  // Default all-rounder.
  return { engineId: 'veo-3.1-fast-generate-preview', group: 'group-a', name: 'Veo 3.1 Fast', reason: 'The best quality-to-speed all-rounder for a text-only brief.' };
}

// ---------------------------------------------------------------------------
// Misc shared helpers
// ---------------------------------------------------------------------------

/** Cap text at a proxy limit on a sentence/word boundary. */
export function capPromptText(text: string, max = 1000): string {
  const t = String(text || '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'));
  if (sentence > max * 0.6) return cut.slice(0, sentence + 1).trim();
  const space = cut.lastIndexOf(' ');
  return (space > 0 ? cut.slice(0, space) : cut).trim();
}

/** Tier badge → color pair used by all selectors. */
export function tierColor(tier: EngineTier): { bg: string; fg: string } {
  switch (tier) {
    case 'Fast': return { bg: 'rgba(45,212,191,0.16)', fg: '#2DD4BF' };
    case 'Cinematic': return { bg: 'rgba(168,85,247,0.16)', fg: '#C084FC' };
    case 'Character': return { bg: 'rgba(232,163,60,0.16)', fg: '#E8A33C' };
    case 'Lite': return { bg: 'rgba(148,163,184,0.16)', fg: '#94A3B8' };
    case 'Pro': return { bg: 'rgba(59,130,246,0.16)', fg: '#60A5FA' };
    case 'Recipe': return { bg: 'rgba(34,197,94,0.16)', fg: '#4ADE80' };
    default: return { bg: 'rgba(148,163,184,0.14)', fg: '#CBD5E1' };
  }
}
