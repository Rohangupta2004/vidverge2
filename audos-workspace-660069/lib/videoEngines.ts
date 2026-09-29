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
 *  C — Kling                           POST /api/generate/kling/text-to-video
 *                                      POST /api/generate/kling/image-to-video
 *  D — image companions                POST /api/veo/generate/image
 *                                      POST /api/generate/image
 *
 * KLING IS LIVE (re-verified 27 Sep 2026): GET /api/generate/kling/models
 * answers 200 with kling-v1, v1-5, v1-6 and v2-master. The `comingSoon: true`
 * flags on KLING_MODELS below are LEFT AS THEY ARE on purpose — Product Video,
 * SceneForge and Script-to-Video gate on them today and flipping them here
 * would silently change those apps. Any surface that wants Kling should do what
 * Ads Studio does: check GET /api/generate/kling/models at runtime and fall
 * back to Omni Flash on 503.
 *
 * Higgsfield endpoints are absent from THIS catalog by founder ruling of
 * 23 Sep 2026. (The retired Model Lab kept a lab-only exception listing
 * Higgsfield and MiniMax Hailuo; that surface is gone — this catalog and the
 * shared EnginePicker are now the single model-selection source.)
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
    // GET /api/generate/runway/capabilities reports mediaType 'image' for this
    // recipe (re-checked 28 Sep 2026) — it localizes a still ad, not a clip.
    outputKind: 'image',
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

/** Shown only on a real 503 generation_disabled. Runway generation was
 * verified ENABLED on 28 Sep 2026 (vv-media-capabilities answered
 * generationEnabled:true and the founder ran a live test), so a 503 now
 * means a transient outage, not a pending rollout. */
export const RUNWAY_DISABLED_MESSAGE = 'Runway is temporarily unavailable (503) — retry shortly or switch to a Veo engine.';

// ---------------------------------------------------------------------------
// RUNWAY MODEL CATALOG — one flat list of every Runway-native option, with
// the route each one actually resolves to.
//
// PROBED LIVE 28 Sep 2026 against the platform API (the full probe log lives
// at the top of lib/runwayAdapter.ts). What the platform really exposes:
//
//   GET  /api/generate/runway/capabilities   200 — models, recipes, prices
//   POST /api/generate/runway/quote          200 — free, unauthenticated
//   POST /api/generate/runway/video          gen4.5 · gen4_turbo
//   POST /api/generate/runway/recipes/:id    the seven allowlisted recipes
//   GET  /api/generate/runway/status/:taskId poll
//
// The video proxy accepts EXACTLY TWO model ids. Quoting act_two, gen4_image
// or gen4_image_turbo answers
//   400 {"error":"model must be one of: gen4.5, gen4_turbo.","code":"invalid_request"}
// so those three are catalogued as UNAVAILABLE instead of being offered as
// working choices — listing them as selectable would only buy the customer a
// 400 at submit time. They stay in the catalog (greyed out, with the reason)
// so the gap is visible rather than silently missing.
//
// Runway IMAGE generation is real; it just is not addressed by a model id.
// The marketing_stock_image and product_campaign_image recipes are the image
// path, so they appear below as recipe-backed image entries.
//
// FULL ROSTER (29 Sep 2026): the catalog now lists Runway's complete announced
// video-model roster (veo3.1, veo3.1_fast, seedance2.5, seedance2, wan3,
// hailuo3, aleph2, gemini_omni_flash, grok_imagine_1_5) alongside gen4.5,
// gen4_turbo and act_two. A LIVE re-probe on 29 Sep 2026 confirmed the proxy
// still accepts exactly gen4.5 and gen4_turbo (quoting any other id answers
// 400 "model must be one of: gen4.5, gen4_turbo"), so the extra entries ship
// available:false with that reason. syncRunwayCatalog() below re-reads
// GET /api/generate/runway/capabilities at runtime and flips entries live —
// with their real modes, ratios, durations and prices — the moment the
// platform lists them. No code change is needed when that happens.
// ---------------------------------------------------------------------------

export type RunwayInputType = 'text' | 'image' | 'both';
export type RunwayOutputType = 'video' | 'image';
export type RunwaySpeed = 'fast' | 'standard';

export interface RunwayModel {
  id: string;
  label: string;
  inputType: RunwayInputType;
  type: RunwayOutputType;
  speed: RunwaySpeed;
  /** False when the proxy rejects this id — such an entry is never submitted. */
  available: boolean;
  /** Why an unavailable entry is greyed out, and what to reach for instead. */
  unavailableReason?: string;
  /** Where an available entry is submitted.
   *  'video'  → POST /api/generate/runway/video with { model: id }
   *  'recipe' → POST /api/generate/runway/recipes/<recipeId>
   *  'none'   → not submittable on this platform. */
  route: 'video' | 'recipe' | 'none';
  recipeId?: RunwayRecipeId;
  /** Pixel-pair ratios this entry accepts (empty = recipe decides). */
  ratios: string[];
  minDurationS?: number;
  maxDurationS?: number;
  defaultDurationS?: number;
  priceNote: string;
  blurb: string;
}

const RW_VIDEO_RATIOS = ['1280:720', '720:1280', '1104:832', '832:1104', '960:960', '1584:672'];

/** Roster entries the platform proxy does not accept yet (re-probed live
 * 29 Sep 2026: the quote endpoint answers 400 "model must be one of: gen4.5,
 * gen4_turbo" for every one of them). They are catalogued so every picker
 * shows the full Runway roster with an honest reason, and syncRunwayCatalog()
 * flips them selectable the moment the capabilities endpoint lists them. */
const rwRoster = (m: { id: string; label: string; inputType: RunwayInputType; speed?: RunwaySpeed; blurb: string; alt: string }): RunwayModel => ({
  id: m.id,
  label: m.label,
  inputType: m.inputType,
  type: 'video',
  speed: m.speed || 'standard',
  available: false,
  route: 'none',
  ratios: RW_VIDEO_RATIOS,
  minDurationS: 2,
  maxDurationS: 10,
  defaultDurationS: 5,
  priceNote: 'priced by the live Runway quote once the platform lists it',
  unavailableReason: `The Audos Runway proxy accepts only the models its live capabilities catalog lists (today: gen4.5 and gen4_turbo — submitting ${m.id} answers 400 invalid_request). This entry unlocks automatically when the platform adds it; until then ${m.alt}.`,
  blurb: m.blurb,
});

export const RUNWAY_MODELS: RunwayModel[] = [
  {
    id: 'gen4.5', label: 'Runway Gen 4.5', inputType: 'both', type: 'video', speed: 'standard',
    available: true, route: 'video', ratios: RW_VIDEO_RATIOS,
    minDurationS: 2, maxDurationS: 10, defaultDurationS: 5,
    priceNote: '12 credits / second (≈ $0.12/s)',
    blurb: 'Runway flagship. Text-to-video (1280:720 or 720:1280) or image-to-video on all six ratios; image-to-video still needs a prompt.',
  },
  {
    id: 'gen4_turbo', label: 'Runway Gen 4 Turbo', inputType: 'image', type: 'video', speed: 'fast',
    available: true, route: 'video', ratios: RW_VIDEO_RATIOS,
    minDurationS: 2, maxDurationS: 10, defaultDurationS: 5,
    priceNote: '5 credits / second (≈ $0.05/s)',
    blurb: 'Image-to-video only, and the cheapest way to animate a single still.',
  },
  rwRoster({
    id: 'veo3.1', label: 'Runway Veo 3.1', inputType: 'both',
    blurb: 'Google Veo 3.1 served through Runway — text-to-video or image-to-video.',
    alt: 'use Veo 3.1 in the Google group of the same picker, which runs today',
  }),
  rwRoster({
    id: 'veo3.1_fast', label: 'Runway Veo 3.1 Fast', inputType: 'both', speed: 'fast',
    blurb: 'The faster Veo tier through Runway — text-to-video or image-to-video.',
    alt: 'use Veo 3.1 Fast in the Google group of the same picker, which runs today',
  }),
  rwRoster({
    id: 'seedance2.5', label: 'Runway Seedance 2.5', inputType: 'both',
    blurb: 'High-quality Seedance through Runway — text, image or video input.',
    alt: 'use Seedance 2.0 Fast in the Google/OpenRouter group of the same picker',
  }),
  rwRoster({
    id: 'seedance2', label: 'Runway Seedance 2', inputType: 'both',
    blurb: 'The stable Seedance tier through Runway — text, image or video input.',
    alt: 'use Seedance 2.0 Fast in the Google/OpenRouter group of the same picker',
  }),
  rwRoster({
    id: 'wan3', label: 'Runway Wan 3', inputType: 'both',
    blurb: 'Wan 3 through Runway — text-to-video or image-to-video.',
    alt: 'use Runway Gen 4.5 or a Veo engine',
  }),
  rwRoster({
    id: 'hailuo3', label: 'Runway Hailuo 3', inputType: 'both',
    blurb: 'MiniMax Hailuo 3 through Runway — text, image or video input.',
    alt: 'use Runway Gen 4.5 or a Veo engine',
  }),
  rwRoster({
    id: 'aleph2', label: 'Runway Aleph 2', inputType: 'image',
    blurb: 'Video-to-video transformation with ProRes support — feeds existing footage plus text/image direction.',
    alt: 'use the Product Swap recipe (Ads Studio → Recipes), the platform\u2019s real video-to-video path',
  }),
  rwRoster({
    id: 'gemini_omni_flash', label: 'Runway Gemini Omni Flash', inputType: 'both', speed: 'fast',
    blurb: 'Gemini Omni Flash served through Runway — fast and efficient; text, image or video input.',
    alt: 'use Gemini Omni Flash in the Google group of the same picker, which runs today',
  }),
  rwRoster({
    id: 'grok_imagine_1_5', label: 'Runway Grok Imagine 1.5', inputType: 'both',
    blurb: 'xAI Grok Imagine 1.5 through Runway — text-to-video or image-to-video.',
    alt: 'use Runway Gen 4.5 or a Veo engine',
  }),
  {
    id: 'act_two', label: 'Runway Act Two', inputType: 'image', type: 'video', speed: 'standard',
    available: false, route: 'none', ratios: [],
    unavailableReason: 'The Audos Runway proxy accepts only gen4.5 and gen4_turbo — act_two answers 400 invalid_request. For motion on a character image use Gen 4 Turbo, or the UGC Creator recipe for a performing presenter.',
    priceNote: 'not priced — not exposed by the platform proxy',
    blurb: 'Motion/action transfer onto a character image. Not reachable through Audos today.',
  },
  {
    id: 'gen4_image', label: 'Runway Gen 4 Image', inputType: 'both', type: 'image', speed: 'standard',
    available: false, route: 'none', ratios: [],
    unavailableReason: 'The Audos Runway proxy has no image model route — gen4_image answers 400 invalid_request and POST /api/generate/runway/image is a 404. Use Runway Stock Image or Runway Campaign Images below, which are the platform\u2019s real Runway image path.',
    priceNote: 'not priced — not exposed by the platform proxy',
    blurb: 'Runway text/image-to-image. Not reachable through Audos today.',
  },
  {
    id: 'gen4_image_turbo', label: 'Runway Gen 4 Image Turbo', inputType: 'both', type: 'image', speed: 'fast',
    available: false, route: 'none', ratios: [],
    unavailableReason: 'Same as Gen 4 Image — no image model route exists on the Audos Runway proxy (400 invalid_request). Runway Stock Image at quality \u201clow\u201d is the fast, cheap stand-in (1 credit per output).',
    priceNote: 'not priced — not exposed by the platform proxy',
    blurb: 'Fast Runway image generation. Not reachable through Audos today.',
  },
  {
    id: 'runway_stock_image', label: 'Runway Stock Image', inputType: 'both', type: 'image', speed: 'fast',
    available: true, route: 'recipe', recipeId: 'marketing_stock_image', ratios: [],
    priceNote: '8 credits processing + 1 / 5 / 20 per output (low / medium / high)',
    blurb: 'Runway image generation via the marketing_stock_image recipe — a prompt, an optional reference image, and 1–4 outputs.',
  },
  {
    id: 'runway_campaign_image', label: 'Runway Campaign Images', inputType: 'image', type: 'image', speed: 'standard',
    available: true, route: 'recipe', recipeId: 'product_campaign_image', ratios: [],
    priceNote: '36 credits / output × 4 = 144 credits (≈ $1.44)',
    blurb: 'Four coordinated campaign images from one product image plus direction, via the product_campaign_image recipe.',
  },
];

export function runwayModel(id: string | null | undefined): RunwayModel | null {
  return RUNWAY_MODELS.find((m) => m.id === String(id || '')) || null;
}

/** True for any Runway-native id in the catalog, available or not. Callers
 * use this to decide that a generation belongs on the Runway proxy rather
 * than on /api/veo/generate/video. */
export function isRunwayModel(id: string | null | undefined): boolean {
  return !!runwayModel(id);
}

/** True only when the id is one the platform proxy will actually accept. */
export function isRunwayModelAvailable(id: string | null | undefined): boolean {
  return runwayModel(id)?.available === true;
}

export const RUNWAY_VIDEO_MODEL_IDS = RUNWAY_MODELS.filter((m) => m.available && m.type === 'video').map((m) => m.id);
export const RUNWAY_IMAGE_MODEL_IDS = RUNWAY_MODELS.filter((m) => m.available && m.type === 'image').map((m) => m.id);

/** Human wording for a Runway model's accepted inputs — the helper text every
 * picker shows next to the model name. */
export function runwayInputLabel(m: Pick<RunwayModel, 'inputType' | 'type'>): string {
  const out = m.type === 'video' ? 'video' : 'image';
  if (m.inputType === 'both') return `Text or image → ${out}`;
  if (m.inputType === 'text') return `Text → ${out}`;
  return `Image → ${out}`;
}

// ---------------------------------------------------------------------------
// LIVE RUNWAY CATALOG SYNC — GET /api/generate/runway/capabilities is the
// platform's source of truth for which Runway model ids the proxy accepts.
// syncRunwayCatalog() folds its answer into RUNWAY_MODELS in place: listed
// entries become selectable (with live modes/ratios/durations/prices) and
// unlisted ones stay greyed out with the reason. Pickers subscribe through
// subscribeRunwayCatalog so they re-render when the roster moves.
// ---------------------------------------------------------------------------

export type RunwayCatalogListener = () => void;

let rwSyncPromise: Promise<boolean> | null = null;
let rwSyncedAt = 0;
let rwRevision = 0;
const rwListeners = new Set<RunwayCatalogListener>();

/** Bumps every time a capabilities payload is applied — cheap re-render key. */
export function runwayCatalogRevision(): number { return rwRevision; }

export function subscribeRunwayCatalog(listener: RunwayCatalogListener): () => void {
  rwListeners.add(listener);
  return () => { rwListeners.delete(listener); };
}

function notifyRunwayCatalog(): void {
  rwRevision += 1;
  rwListeners.forEach((fn) => { try { fn(); } catch { /* a listener's error never blocks the rest */ } });
}

function liveInputType(modeIds: string[]): RunwayInputType | null {
  const t2v = modeIds.indexOf('text-to-video') >= 0;
  const i2v = modeIds.indexOf('image-to-video') >= 0 || modeIds.indexOf('video-to-video') >= 0;
  if (t2v && i2v) return 'both';
  if (t2v) return 'text';
  if (i2v) return 'image';
  return null;
}

/** Fold one live capabilities payload into RUNWAY_MODELS. Only video-route
 * entries move — the recipe-backed image entries are governed by the recipes
 * list, which the platform pins server-side. */
export function applyRunwayCapabilities(raw: any): void {
  const nodes: any[] = Array.isArray(raw?.models) ? raw.models : [];
  if (!nodes.length) return;
  const live = new Map<string, any>();
  nodes.forEach((n) => { const id = String(n?.id || n?.model || ''); if (id) live.set(id, n); });
  const liveIds = Array.from(live.keys());
  for (const m of RUNWAY_MODELS) {
    if (m.type !== 'video' || m.route === 'recipe') continue;
    const node = live.get(m.id);
    if (node) {
      m.available = true;
      m.route = 'video';
      m.unavailableReason = undefined;
      const modes: any[] = Array.isArray(node.modes) ? node.modes : [];
      const modeIds = modes.map((x: any) => String(x?.id || x || ''));
      const input = liveInputType(modeIds);
      if (input) m.inputType = input;
      const ratios: string[] = [];
      let minD: number | undefined; let maxD: number | undefined; let defD: number | undefined;
      modes.forEach((x: any) => {
        (Array.isArray(x?.ratios) ? x.ratios : []).forEach((r: any) => {
          if (typeof r === 'string' && ratios.indexOf(r) < 0) ratios.push(r);
        });
        const d = x?.duration || {};
        if (Number.isFinite(Number(d.min))) minD = minD === undefined ? Number(d.min) : Math.min(minD, Number(d.min));
        if (Number.isFinite(Number(d.max))) maxD = maxD === undefined ? Number(d.max) : Math.max(maxD, Number(d.max));
        if (Number.isFinite(Number(d.default))) defD = Number(d.default);
      });
      if (ratios.length) m.ratios = ratios;
      if (minD !== undefined) m.minDurationS = minD;
      if (maxD !== undefined) m.maxDurationS = maxD;
      if (defD !== undefined) m.defaultDurationS = defD;
      const cps = Number(node.creditsPerSecond);
      if (Number.isFinite(cps) && cps > 0) m.priceNote = `${cps} credits / second (≈ $${(cps * 0.01).toFixed(2)}/s)`;
    } else {
      m.available = false;
      m.route = 'none';
      if (!m.unavailableReason) {
        m.unavailableReason = `The Audos Runway proxy is not listing ${m.label} right now (live models: ${liveIds.join(', ') || 'none'}). It unlocks here automatically the moment the platform adds it.`;
      }
    }
  }
  // The derived id lists are exported consts — refresh their contents in place.
  RUNWAY_VIDEO_MODEL_IDS.length = 0;
  RUNWAY_MODELS.filter((m) => m.available && m.type === 'video').forEach((m) => RUNWAY_VIDEO_MODEL_IDS.push(m.id));
  RUNWAY_IMAGE_MODEL_IDS.length = 0;
  RUNWAY_MODELS.filter((m) => m.available && m.type === 'image').forEach((m) => RUNWAY_IMAGE_MODEL_IDS.push(m.id));
}

/**
 * Ask the platform which Runway models are live and fold the answer into the
 * catalog. Cached for 5 minutes; concurrent callers share one in-flight fetch.
 * A failed fetch changes nothing — the probe-verified static flags stay
 * authoritative. Resolves true when a capabilities payload was applied.
 */
export function syncRunwayCatalog(opts: { force?: boolean } = {}): Promise<boolean> {
  const fresh = rwSyncedAt > 0 && Date.now() - rwSyncedAt < 5 * 60 * 1000;
  if (!opts.force) {
    if (rwSyncPromise) return rwSyncPromise;
    if (fresh) return Promise.resolve(true);
  }
  const attempt = (async () => {
    try {
      const token = typeof window !== 'undefined' ? String((window as any).__workspaceDb?.token || '') : '';
      const res = await fetch('/api/generate/runway/capabilities', {
        headers: token ? { 'X-Workspace-DB-Token': token } : undefined,
      });
      if (!res.ok) return false;
      const raw = await res.json().catch(() => null);
      if (!raw) return false;
      applyRunwayCapabilities(raw);
      rwSyncedAt = Date.now();
      notifyRunwayCatalog();
      return true;
    } catch {
      return false;
    } finally {
      rwSyncPromise = null;
    }
  })();
  rwSyncPromise = attempt;
  return attempt;
}

export interface RunwayRoute {
  kind: 'video' | 'recipe' | 'unsupported';
  /** Absolute path to POST to, or null when unsupported. */
  path: string | null;
  /** The `model` field for a video submit. */
  model?: string;
  recipeId?: RunwayRecipeId;
  outputKind: RunwayOutputType;
  reason?: string;
}

/** The single place that turns a Runway model id into an Audos endpoint. */
export function runwayRoute(id: string | null | undefined): RunwayRoute {
  const m = runwayModel(id);
  if (!m) return { kind: 'unsupported', path: null, outputKind: 'video', reason: `"${String(id || '')}" is not a Runway model.` };
  if (!m.available || m.route === 'none') {
    return { kind: 'unsupported', path: null, outputKind: m.type, reason: m.unavailableReason || `${m.label} is not available on this platform.` };
  }
  if (m.route === 'recipe' && m.recipeId) {
    return { kind: 'recipe', path: `/api/generate/runway/recipes/${encodeURIComponent(m.recipeId)}`, recipeId: m.recipeId, outputKind: m.type };
  }
  return { kind: 'video', path: '/api/generate/runway/video', model: m.id, outputKind: m.type };
}

/** The sentence a surface shows when a customer lands on an unavailable
 * Runway entry — it always names a working alternative. */
export function runwayUnsupportedMessage(id: string | null | undefined): string {
  const m = runwayModel(id);
  return m?.unavailableReason || 'That Runway model is not available on this platform — pick another engine.';
}

/**
 * Runway wants pixel pairs, not "16:9". Accepts either form and returns a
 * ratio the chosen model actually allows (falling back to its first legal
 * ratio rather than letting the proxy answer 400).
 */
export function toRunwayRatio(aspect: string | null | undefined, modelId?: string | null): string {
  const allowed = runwayModel(modelId)?.ratios?.length ? (runwayModel(modelId) as RunwayModel).ratios : RW_VIDEO_RATIOS;
  const raw = String(aspect || '').trim();
  if (allowed.indexOf(raw) >= 0) return raw;
  const byShorthand: Record<string, string> = {
    '16:9': '1280:720', '9:16': '720:1280', '1:1': '960:960',
    '4:3': '1104:832', '3:4': '832:1104', '21:9': '1584:672',
    '4:5': '832:1104', '5:4': '1104:832',
  };
  const mapped = byShorthand[raw];
  if (mapped && allowed.indexOf(mapped) >= 0) return mapped;
  // A pixel pair we do not recognise: keep its orientation.
  const parts = raw.split(':').map(Number);
  if (parts.length === 2 && parts.every((n) => Number.isFinite(n) && n > 0)) {
    const portrait = parts[1] > parts[0];
    const square = Math.abs(parts[0] - parts[1]) / Math.max(parts[0], parts[1]) < 0.05;
    const guess = square ? '960:960' : portrait ? '720:1280' : '1280:720';
    if (allowed.indexOf(guess) >= 0) return guess;
  }
  return allowed[0];
}

/** gen4.5 text-to-video accepts ONLY these two pairs; every wider ratio is
 * image-to-video only and answers 400 on a text-only submit. */
export const RUNWAY_T2V_RATIOS = ['1280:720', '720:1280'];

/** The ratio to send for a Runway VIDEO submit, honouring the narrower
 * text-to-video list when no source image travels with the request. */
export function runwayVideoRatio(aspect: string | null | undefined, modelId: string, imageToVideo: boolean): string {
  const ratio = toRunwayRatio(aspect, modelId);
  if (imageToVideo || RUNWAY_T2V_RATIOS.indexOf(ratio) >= 0) return ratio;
  const parts = ratio.split(':').map(Number);
  return parts[1] > parts[0] ? '720:1280' : '1280:720';
}

/** Clamp a requested clip length to what the chosen Runway model allows. */
export function clampRunwayDuration(seconds: number | null | undefined, modelId?: string | null): number {
  const m = runwayModel(modelId);
  const min = m?.minDurationS ?? 2;
  const max = m?.maxDurationS ?? 10;
  const fallback = m?.defaultDurationS ?? 5;
  const n = Math.round(Number(seconds));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(min, Math.min(max, n));
}

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

const RUNWAY_CAVEAT = 'Runway generation is enabled (verified 28 Sep 2026) — in the rare case a submit answers 503, fall back to a Veo engine.';

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

// ---------------------------------------------------------------------------
// VIDEO_ENGINES — flat cross-app engine list (LightBeam upgrade, Sep 2026).
// DERIVED from GROUP_A_MODELS above so there is still exactly ONE place a
// model id string lives. Use this constant everywhere a simple
// { id, label, tier, family } list is needed (selectors, badges, routing).
// ---------------------------------------------------------------------------

export type EngineFamily = 'veo' | 'gemini' | 'sora' | 'seedance';

/** Quality tiers used by ModelBadge chips: Ultra / Cinema / Fast / Standard. */
export type EngineQualityTier = 'ultra' | 'cinema' | 'fast' | 'standard';

const QUALITY_TIER_BY_ID: Record<string, EngineQualityTier> = {
  'veo-3.1-generate-preview': 'ultra',
  'veo-3.1-fast-generate-preview': 'cinema',
  'veo-3.0-generate-001': 'cinema',
  'veo-3.0-fast-generate-001': 'fast',
  'veo-2.0-generate-001': 'standard',
  'gemini-omni-flash-preview': 'fast',
  'sora-2': 'cinema',
  'sora-2-pro': 'ultra',
  'openrouter/bytedance/seedance-2.0-fast': 'fast',
  'openrouter/google/veo-3.1': 'ultra',
  'openrouter/google/veo-3.1-fast': 'cinema',
  'openrouter/google/veo-3.1-lite': 'standard',
};

function engineFamilyOf(id: string): EngineFamily {
  if (id.includes('seedance')) return 'seedance';
  if (id.startsWith('sora')) return 'sora';
  if (id.startsWith('gemini')) return 'gemini';
  return 'veo';
}

export interface VideoEngine {
  id: string;
  label: string;
  tier: EngineQualityTier;
  family: EngineFamily;
  supportsRef: boolean;
  supports4k: boolean;
  maxDurationS: number;
  defaultDurationS: number;
}

/** NOTE: Kling is platform-disabled (missing API key). HeyGen is configured
 * but unused here. Higgsfield is excluded by founder ruling. None of them
 * belong in this list. */
export const VIDEO_ENGINES: VideoEngine[] = GROUP_A_MODELS.map((m) => ({
  id: m.id,
  label: m.name,
  tier: QUALITY_TIER_BY_ID[m.id] || 'standard',
  family: engineFamilyOf(m.id),
  supportsRef: m.supportsReferenceImages,
  supports4k: m.supports4k,
  maxDurationS: m.maxDurationS,
  defaultDurationS: m.defaultDurationS,
}));

export const DEFAULT_ENGINE_ID = 'veo-3.1-fast-generate-preview';

export function videoEngine(id: string | null | undefined): VideoEngine | null {
  return VIDEO_ENGINES.find((e) => e.id === String(id || '')) || null;
}

/**
 * AUTO-RETRY FALLBACK CHAIN (global UX rule): when a generation fails after
 * one same-engine retry, step down one tier — ultra → cinema → fast →
 * seedance — and try once more. Returns null when there is nowhere left to go.
 */
export function fallbackEngineFor(id: string): string | null {
  const e = videoEngine(id);
  if (!e) return DEFAULT_ENGINE_ID;
  if (e.id === 'openrouter/bytedance/seedance-2.0-fast') return null;
  switch (e.tier) {
    case 'ultra': return 'veo-3.1-fast-generate-preview';
    case 'cinema': return 'veo-3.0-fast-generate-001';
    case 'fast':
    case 'standard':
      return 'openrouter/bytedance/seedance-2.0-fast';
    default: return null;
  }
}

/** Tier badge colors for the flat quality tiers (LightBeam palette). */
export function qualityTierColor(tier: EngineQualityTier): { bg: string; fg: string } {
  switch (tier) {
    case 'ultra': return { bg: 'rgba(245,158,11,0.18)', fg: '#fbbf24' };
    case 'cinema': return { bg: 'rgba(245,158,11,0.12)', fg: '#f59e0b' };
    case 'fast': return { bg: 'rgba(45,212,191,0.14)', fg: '#2DD4BF' };
    default: return { bg: 'rgba(148,163,184,0.14)', fg: '#94A3B8' };
  }
}

// ---------------------------------------------------------------------------
// SHOT-INTENT ROUTING (master plan §6/§43, added 28 Sep 2026).
// One shared answer to "which engine should THIS shot use?", so routing
// logic never gets hard-coded into an isolated page again. Purely additive:
// nothing above changed, and no app behaviour changes until a surface calls it.
//
// Grounded in PROBE-VERIFIED platform behaviour (docs/IMPLEMENTATION_MAP.md §4):
//  · WORKING today: gemini-omni-flash-preview, veo-3.1-generate-preview,
//    veo-3.1-fast-generate-preview, Sora 2/Pro.
//  · BROKEN platform-side (synthetic *_error_* ids): every openrouter/* model
//    including Seedance 2.0 Fast, plus veo-3.0/2.0 — only routed when the
//    caller has SEEN a submit succeed this session (availability flag).
//  · RUNWAY: generation ENABLED — verified 28 Sep 2026 (vv-media-capabilities
//    answered generationEnabled:true and the founder ran a live test). Runway
//    routes are therefore ON by default; pass runwayEnabled:false only after
//    a submit answered 503 this session. Kling submits still need the
//    platform KLING_API_KEY — keep Kling gated on a live check.
//  · EXCLUDED: Higgsfield, by founder ruling of 23 Sep 2026.
//  · UI is CODE: a product-interface shot is never sent to generative video.
// ---------------------------------------------------------------------------

export type ShotIntent =
  | 'cinematic_hero'        // premium establishing / money shot
  | 'fast_broll'            // volume cutaways, lifestyle filler
  | 'ui_demo'               // product UI / dashboard demonstration
  | 'character_consistency' // same face/mascot across scenes
  | 'product_consistency'   // same physical product across scenes
  | 'motion_background'     // abstract ambient plate behind foreground graphics
  | 'stills_to_motion'      // animate one existing image
  | 'surreal_stylized'      // dream logic, crowds, complex multi-subject
  | 'video_to_video'        // transform existing footage (restyle / swap)
  | 'finished_product_ad'   // one-call polished ad deliverable
  | 'ugc_testimonial'       // creator-style testimonial
  | 'multi_shot';           // several directed shots auto-cut together

export interface EngineAvailability {
  /** Runway generation is enabled platform-side (verified 28 Sep 2026), so
   * undefined counts as TRUE. Pass false only after a submit answered 503
   * this session. */
  runwayEnabled?: boolean;
  /** True only after GET /api/generate/kling/models answered 200 AND a submit worked. */
  klingEnabled?: boolean;
  /** True only after an openrouter/* submit returned a REAL operation id this session. */
  openRouterHealthy?: boolean;
}

export interface ShotRoute {
  /** 'engine' = Group A / Runway base model · 'recipe' = Runway recipe ·
   * 'code' = build it deterministically (Remotion/GSAP mockup — no generative
   * video at all) · 'unavailable' = no honest path exists; never fake it. */
  kind: 'engine' | 'recipe' | 'code' | 'unavailable';
  engineId: string | null;
  /** Ordered next-best Group A engines when the primary fails
   * (after one same-engine retry — the global fallback UX rule). */
  fallbackChain: string[];
  reason: string;
}

const OMNI = 'gemini-omni-flash-preview';
const VEO_31 = 'veo-3.1-generate-preview';
const VEO_31_FAST = 'veo-3.1-fast-generate-preview';
const SEEDANCE = 'openrouter/bytedance/seedance-2.0-fast';

export function routeShotIntent(intent: ShotIntent, avail: EngineAvailability = {}): ShotRoute {
  switch (intent) {
    case 'ui_demo':
      return {
        kind: 'code', engineId: null, fallbackChain: [],
        reason: 'Product UI is recreated deterministically — real screenshot (or coded interface skeleton) inside an animated device/browser mockup with cursor, clicks and highlights (Remotion/GSAP). Generative video is never asked to draw an interface.',
      };
    case 'cinematic_hero':
      return {
        kind: 'engine', engineId: VEO_31, fallbackChain: [VEO_31_FAST, 'sora-2', OMNI],
        reason: 'Veo 3.1: hero cinematic quality, 4K, up to 3 reference ingredients or a locked last frame.',
      };
    case 'fast_broll':
      return avail.openRouterHealthy
        ? { kind: 'engine', engineId: SEEDANCE, fallbackChain: [OMNI, VEO_31_FAST], reason: 'Seedance 2.0 Fast is the cheapest fastest B-roll engine and a submit succeeded this session.' }
        : { kind: 'engine', engineId: OMNI, fallbackChain: [VEO_31_FAST], reason: 'OpenRouter submits are broken platform-side (synthetic openrouter_error_* ids), so Omni Flash is the proven fast B-roll route — the same one veh-broll-generate uses.' };
    case 'character_consistency':
      return {
        kind: 'engine', engineId: OMNI, fallbackChain: [VEO_31],
        reason: 'Omni Flash: reference images + seed image together — the same face/mascot carries across every scene.',
      };
    case 'product_consistency':
      return {
        kind: 'engine', engineId: VEO_31, fallbackChain: [VEO_31_FAST, OMNI],
        reason: 'Veo 3.1 asset-reference ingredients keep the real product on-model in generated footage.',
      };
    case 'motion_background':
      return {
        kind: 'engine', engineId: VEO_31_FAST, fallbackChain: [OMNI],
        reason: 'Veo 3.1 Fast is the proven ambient-plate route (pv-ad-director backdrop stage). Backgrounds must support foreground readability — plan safe text/UI zones with the foreground, and degrade to a brand gradient rather than overpowering it.',
      };
    case 'stills_to_motion':
      return avail.runwayEnabled !== false
        ? { kind: 'engine', engineId: 'gen4_turbo', fallbackChain: [VEO_31_FAST, OMNI], reason: 'Runway Gen 4 Turbo at $0.05/s is the cheapest image-to-video once enabled.' }
        : { kind: 'engine', engineId: VEO_31_FAST, fallbackChain: [OMNI], reason: 'Runway answered 503 this session — Veo 3.1 Fast animates a single seed image (imageData) as the fallback; gen4_turbo resumes when Runway recovers.' };
    case 'surreal_stylized':
      return {
        kind: 'engine', engineId: 'sora-2', fallbackChain: [VEO_31],
        reason: 'Sora 2 is strongest for surreal, stylized and complex multi-subject scenes.',
      };
    case 'video_to_video':
      return avail.runwayEnabled !== false
        ? { kind: 'recipe', engineId: 'product_swap', fallbackChain: [], reason: 'Runway product_swap performs a real video transformation (reference video + product swap).' }
        : { kind: 'unavailable', engineId: null, fallbackChain: [], reason: 'Runway answered 503 this session, and no other enabled provider performs true video-to-video (Kling key missing, Higgsfield founder-excluded). Do NOT fake it with text-to-video — retry Runway shortly or offer Video Enhancer\u2019s editorial treatments (real transforms of the real footage) instead.' };
    case 'finished_product_ad':
      return avail.runwayEnabled !== false
        ? { kind: 'recipe', engineId: 'product_ad', fallbackChain: [], reason: 'Runway product_ad assembles a complete polished advertisement from product photos in one call.' }
        : { kind: 'engine', engineId: OMNI, fallbackChain: [VEO_31_FAST], reason: 'Run the Ads Studio agentic pipeline (Opus director + Omni clips + GSAP overlays + FFmpeg assembly); the one-call recipe activates when Runway is enabled.' };
    case 'ugc_testimonial':
      return avail.runwayEnabled !== false
        ? { kind: 'recipe', engineId: 'product_ugc', fallbackChain: [], reason: 'Runway UGC Creator builds a creator-style testimonial from a character photo + product photo.' }
        : { kind: 'engine', engineId: OMNI, fallbackChain: [VEO_31], reason: 'Omni Flash with the character photo as a reference image keeps the same presenter across takes.' };
    case 'multi_shot':
      return avail.runwayEnabled !== false
        ? { kind: 'recipe', engineId: 'multi_shot_video', fallbackChain: [], reason: 'Runway multi_shot_video auto-cuts several directed shots into one video.' }
        : { kind: 'engine', engineId: OMNI, fallbackChain: [VEO_31_FAST], reason: 'Per-scene Omni renders with frame-chained continuity (extract the last frame, seed the next shot), stitched server-side — the proven Script-to-Video pattern.' };
    default:
      return { kind: 'engine', engineId: DEFAULT_ENGINE_ID, fallbackChain: [OMNI], reason: 'Unknown intent — the quality-to-speed all-rounder.' };
  }
}
