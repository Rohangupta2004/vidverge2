/**
 * VIDEO ENGINE CATALOG — the single source of truth for every video/image
 * generation engine the VidVerge apps can call. Used by Creatables and by the
 * engine selectors inside Product Video, SceneForge, Script-to-Video,
 * Video Enhancer and Ads Studio.
 *
 * GROUPS
 *  A — standard platform video proxy   POST /api/veo/generate/video
 *      (Google Omni/Veo and OpenRouter-hosted models)
 *  B — Runway proxy                    POST /api/generate/runway/video
 *      + 7 Runway Recipes              POST /api/generate/runway/recipes/:id
 *  C — Kling                           POST /api/generate/kling/text-to-video
 *                                      POST /api/generate/kling/image-to-video
 *  D — image companions                POST /api/veo/generate/image
 *                                      POST /api/generate/image
 *
 * KLING IS LIVE (verified 14 Oct 2026 — the founder's credit pack is active,
 * superseding the 9 Oct note that said KLING_API_KEY was missing: a real
 * submit now reaches Kling's API and bills/refunds correctly). Two facts:
 *  1. kling-v2-master is DISCONTINUED upstream — a live submit answers 502
 *     wrapping "Kling API error (404, code 1203): The model 'kling-v2-master'
 *     has been discontinued". Never offer it as runnable.
 *  2. Kling's own API docs (kling.ai/document-api, read 14 Oct 2026) now use
 *     model-scoped endpoints with a NEW roster — kling-2.5-turbo, kling-2.6,
 *     kling-3.0 and kling-3.0-omni — alongside the legacy kling-v1* ids.
 *     GET /api/generate/kling/models is still a STATIC list (it still names
 *     v2-master), so it is NOT a liveness oracle — only a submit tells the
 *     truth. The platform proxy docs also say an id the proxy does not
 *     recognise falls back to its default with a modelFallback note, so any
 *     result surface must print the model that actually rendered.
 *
 * Higgsfield video models live in HIGGSFIELD_VIDEO_MODELS below (native
 * /api/generate/higgsfield/* proxy). Live sweep 13 Oct 2026: Hailuo 02 and
 * the three DoP models rendered real clips end to end. Six Higgsfield
 * marketplace ids (genjutsu, kling-3.0, minimax-h3, wan-3.0-prime,
 * seedance-2.5, seedance-2.0) were trialled the same day and REMOVED: the
 * proxy does not route them — a submit answers 200 but silently falls back
 * to minimax-hailuo-02 and bills for it. Re-add an id only after a live
 * submit accepts it as itself. Also: Higgsfield refuses inline (data:)
 * source images today — stage the image to a public URL first (the shared
 * client does this automatically).
 *
 * REMOVED 13 Oct 2026 — the ids the 9 Oct 2026 sweep confirmed broken are no
 * longer catalogued at all: sora-2, sora-2-pro, veo-3.0-generate-001,
 * veo-3.0-fast-generate-001 and veo-2.0-generate-001 (the proxy answered 200
 * with a synthetic *_error_* id instead of a real job) and
 * openrouter/bytedance/seedance-2.5-fast (hard 400 — not in the proxy model
 * enum). They are gone from GROUP_A_MODELS and every list derived from it.
 *
 * CORRECTED 13 Oct 2026 (second pass) from the platform integration catalog,
 * integrations/image-and-video-generation/docs.md, which is the authoritative
 * contract for /api/veo/generate/video. Three things this file had wrong:
 *
 *   1. THE OMNI ID IS VERSIONED NOW. `gemini-omni-1.1-flash` is the proxy's
 *      default and the id to use in new code. This file carried a TODO saying
 *      the enum had no versioned spelling; it does.
 *   2. THE VEO 3.1 PREVIEW IDS ARE ALIASES, NOT ENGINES. The catalog states
 *      that the retired ids — the Veo 3.x / 2.0 previews, Sora 2 and the Omni
 *      Flash preview — are still accepted and "every one of them is served by
 *      gemini-omni-1.1-flash". So the pickers were offering three names for
 *      one model, and the "up to 4K" promise on two of them was unreachable:
 *      Omni output caps at 720p. They are kept here with `aliasOf` set, so a
 *      saved selection still routes, and filtered out of every list a customer
 *      chooses from. REAL Veo 3.1 is still reachable through the separate,
 *      NOT-retired `openrouter/google/veo-3.1*` enum entries.
 *   3. OMNI TAKES TEN REFERENCE IMAGES, not three. The flat `refs > 3` check
 *      was discarding the character-consistency headroom this workspace picked
 *      Omni for.
 *
 * None of that was re-probed: a sweep spends the wallet, and a catalog that
 * names its own retirements does not need a paid confirmation to be believed.
 *
 * See ENGINE_HEALTH near the bottom of this file for the per-model outcome of
 * that sweep — which ids actually produced a clip, and which ones the proxy
 * refused.
 */

export type EngineGroup = 'group-a' | 'runway-video' | 'runway-recipe' | 'kling' | 'higgsfield';

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
  /** referenceImages at all. See `maxReferenceImages` for how many. */
  supportsReferenceImages: boolean;
  /** How many referenceImages the proxy accepts. Omni 1.1 takes TEN — the
   * live Interactions API image cap — which is what makes it the character
   * and product consistency engine. */
  maxReferenceImages: number;
  /** True when referenceImages cannot be combined with imageData /
   * lastFrameImage. Omni allows refs + a seed. */
  refsExclusiveWithSeed: boolean;
  /** lastFrameImage (first/last-frame interpolation). */
  supportsLastFrame: boolean;
  /** '4k' resolution actually honored. See FOUR_K_MODELS. */
  supports4k: boolean;
  supportsAudio: boolean;
  supportsNegativePrompt: boolean;
  /** Longest clip known-safe on this model (the proxy normalizes 4–25). */
  maxDurationS: number;
  defaultDurationS: number;
  costHint: string;
  /**
   * Set when the proxy accepts this id only for backwards compatibility and
   * serves it on ANOTHER model. Such an entry is kept so a saved selection
   * still routes, but it is never offered as a distinct choice and never
   * claims a capability the model it resolves to does not have.
   */
  aliasOf?: string;
}

const gA = (
  m: Omit<GroupAModel, 'group' | 'supportsImageData' | 'supportsNegativePrompt' | 'maxReferenceImages'>
    & { maxReferenceImages?: number },
): GroupAModel =>
  ({ group: 'group-a', supportsImageData: true, supportsNegativePrompt: true, maxReferenceImages: 0, ...m });

/**
 * CANONICAL OMNI ID (corrected 13 Oct 2026 from the platform integration
 * catalog, `integrations/image-and-video-generation/docs.md`).
 *
 * This file used to carry `// TODO: upgrade to 1.1 when platform key is
 * confirmed` and a note that the proxy's enum listed no versioned Omni id.
 * The catalog now documents the opposite, and it is the authoritative contract
 * for `/api/veo/generate/video`:
 *
 *   · `gemini-omni-1.1-flash` is the DEFAULT and the id to use in new code.
 *   · It accepts up to TEN referenceImages (not three), refs combined with an
 *     imageData seed, lastFrameImage interpolation, and `videoData` editing.
 *   · "Retired model ids still work" — the Veo 3.x / 2.0 previews, Sora 2 AND
 *     the Omni Flash preview are still accepted, but every one of them is
 *     SERVED BY `gemini-omni-1.1-flash`.
 *
 * That last line is why the entries below changed rather than simply gaining a
 * sibling. `veo-3.1-generate-preview` and `veo-3.1-fast-generate-preview` are
 * not separate engines on this platform any more: they are aliases, so the
 * picker was offering three names for one model, and the "up to 4K" promise on
 * two of them was unachievable — Omni output is capped at 720p. The 9 Oct
 * sweep recorded them as `working` because a clip came back; a clip coming back
 * from a DIFFERENT model is not the same thing as the model existing.
 *
 * Not re-probed here: the sweep spends the wallet, and a catalog contract that
 * explicitly names its own retirements does not need a paid confirmation.
 */
export const OMNI_MODEL_ID = 'gemini-omni-1.1-flash';

export const GROUP_A_MODELS: GroupAModel[] = [
  gA({
    id: OMNI_MODEL_ID, name: 'Gemini Omni 1.1 Flash', provider: 'Google', tier: 'Character',
    blurb: 'Character and product consistency engine — send the same reference images with every scene (up to ten) and the same face, product or mascot carries across every cut. References combine with a seed frame, and a locked last frame interpolates the motion between two stills. Output caps at 720p.',
    supportsReferenceImages: true, maxReferenceImages: 10, refsExclusiveWithSeed: false,
    supportsLastFrame: true, supports4k: false, supportsAudio: true,
    maxDurationS: 8, defaultDurationS: 8,
    costHint: '≈ $0.40 / clip',
  }),
  gA({
    id: 'gemini-omni-flash-preview', name: 'Gemini Omni Flash (preview id)', provider: 'Google', tier: 'Character',
    blurb: 'The pre-1.1 Omni spelling. Still accepted, and served by Gemini Omni 1.1 Flash — pick that instead.',
    aliasOf: OMNI_MODEL_ID,
    supportsReferenceImages: true, maxReferenceImages: 10, refsExclusiveWithSeed: false,
    supportsLastFrame: true, supports4k: false, supportsAudio: true,
    maxDurationS: 8, defaultDurationS: 8,
    costHint: '≈ $0.40 / clip',
  }),
  gA({
    id: 'veo-3.1-generate-preview', name: 'Veo 3.1 (retired id)', provider: 'Google', tier: 'Cinematic',
    blurb: 'Retired platform-side. Still accepted, and served by Gemini Omni 1.1 Flash — so it is not a separate engine, and it does not render 4K.',
    aliasOf: OMNI_MODEL_ID,
    supportsReferenceImages: true, maxReferenceImages: 10, refsExclusiveWithSeed: false,
    supportsLastFrame: true, supports4k: false, supportsAudio: true,
    maxDurationS: 8, defaultDurationS: 8,
    costHint: '≈ $0.40 / clip',
  }),
  gA({
    id: 'veo-3.1-fast-generate-preview', name: 'Veo 3.1 Fast (retired id)', provider: 'Google', tier: 'Fast',
    blurb: 'Retired platform-side. Still accepted, and served by Gemini Omni 1.1 Flash — so it is not a separate engine, and it does not render 4K.',
    aliasOf: OMNI_MODEL_ID,
    supportsReferenceImages: true, maxReferenceImages: 10, refsExclusiveWithSeed: false,
    supportsLastFrame: true, supports4k: false, supportsAudio: true,
    maxDurationS: 8, defaultDurationS: 8,
    costHint: '≈ $0.40 / clip',
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

/**
 * Models whose 4K request is actually honored.
 *
 * EMPTY, deliberately (corrected 13 Oct 2026). This list used to name the two
 * `veo-3.1-*-generate-preview` ids, and every surface that read it offered the
 * customer a 4K toggle on them. Those ids are retired platform-side and served
 * by `gemini-omni-1.1-flash`, whose output is capped at 720p, so the toggle
 * promised a resolution that could not arrive. The integration catalog says
 * `"4k"` is "honored only on some OpenRouter models" without naming which, and
 * an unnamed maybe is not something to sell — so nothing claims 4K here until
 * one id is confirmed to deliver it.
 */
export const FOUR_K_MODELS: string[] = [];

/** True for an id the proxy only accepts for compatibility and serves on
 * another model. A picker lists these last, or not at all. */
export function isAliasEngine(id: string | null | undefined): boolean {
  return Boolean(groupAModel(id)?.aliasOf);
}

/** The id a selection really runs on — itself, unless it is a retired alias. */
export function resolveEngineId(id: string | null | undefined): string {
  const model = groupAModel(id);
  return model?.aliasOf || model?.id || String(id || '');
}

/**
 * COMBINING RULES — enforced client-side before submit (the proxy enforces
 * them server-side with a 400). Returns a human-readable violation or null.
 *   1. Veo 3.1 / 3.1 Fast: referenceImages XOR (imageData / lastFrameImage)
 *   2. Veo 3.1 / 3.1 Fast: imageData + lastFrameImage = first/last-frame flow (valid)
 *   3. Omni Flash: referenceImages + imageData OK; lastFrameImage never
 *   4. OpenRouter-hosted models: imageData only
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
  if (prompt.length > 10000) return 'The prompt is over the 10,000-character limit.';
  const refs = (inputs.referenceImages || []).length;
  const seed = Boolean(inputs.imageData);
  const last = Boolean(inputs.lastFrameImage);
  // The cap is per-model, not a flat three. Omni 1.1 accepts ten, and holding
  // it to three was quietly throwing away the character-consistency headroom
  // this workspace chose Omni for in the first place.
  if (refs > 0 && !m.supportsReferenceImages) return `${m.name} does not support reference images — use a single seed image instead.`;
  if (refs > m.maxReferenceImages) {
    return `${m.name} accepts at most ${m.maxReferenceImages} reference image${m.maxReferenceImages === 1 ? '' : 's'}.`;
  }
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
// ROSTER POLICY (revised 13 Oct 2026): ONLY MODELS THAT WORK ARE LISTED.
//
// This catalog previously also carried twelve Runway ids the proxy does not
// accept (veo3.1, veo3.1_fast, seedance2.5, seedance2, wan3, hailuo3, aleph2,
// gemini_omni_flash, grok_imagine_1_5, act_two, gen4_image, gen4_image_turbo)
// as greyed-out `available:false` entries, on the theory that showing the gap
// was better than hiding it. In practice that filled every model picker in the
// product with a dozen rows a customer can never choose, which reads as a
// broken tool rather than an honest one — so they are gone, and the only
// Runway entries here are the ones a submit actually succeeds on:
//
//   gen4.5      text-to-video + image-to-video   12 credits/s
//   gen4_turbo  image-to-video ONLY               5 credits/s
//   plus the two REAL recipe-backed image paths (marketing_stock_image,
//   product_campaign_image), which are not addressed by a model id at all.
//
// NOTHING IS LOST BY REMOVING THEM. applyRunwayCapabilities() below now ADDS
// any model the live capabilities endpoint reports and this file has never
// heard of, so a model the platform switches on still appears by itself, with
// its real modes, ratios, durations and prices, and still needs no code
// change. The difference is that an id nobody serves is simply absent instead
// of occupying a row in every picker.
//
// Probe history behind the two survivors: GET /api/generate/runway/capabilities
// answered 200 with exactly gen4.5 and gen4_turbo on 29 Sep and again on
// 9 Oct 2026; every other spelling answers 400 "model must be one of: gen4.5,
// gen4_turbo", and gen4_turbo additionally answers 400 on a text-only quote.
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

/**
 * Shape a model the LIVE capabilities endpoint reported but this file does not
 * know about, so the roster can grow without a code change. Deliberately
 * conservative: the entry is created disabled, and applyRunwayCapabilities
 * immediately fills in the real modes, ratios, durations and price from the
 * same payload that produced it.
 */
const rwDiscovered = (id: string): RunwayModel => ({
  id,
  label: `Runway ${id}`,
  inputType: 'both',
  type: 'video',
  speed: 'standard',
  available: false,
  route: 'none',
  ratios: RW_VIDEO_RATIOS,
  minDurationS: 2,
  maxDurationS: 10,
  defaultDurationS: 5,
  priceNote: 'priced by the live Runway quote',
  blurb: 'Reported live by the platform\u2019s Runway capabilities catalog.',
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

/**
 * Runway ids this catalog used to list and no longer does (see ROSTER POLICY
 * above). They are kept ONLY so a stale selection — a saved project, a stored
 * picker preference, a half-finished draft — is still recognised as a Runway
 * request and answered with runwayUnsupportedMessage(), instead of falling
 * through `isRunwayModel() === false` and being routed to the Google video
 * proxy, which would answer 400 for an id it has never heard of.
 */
const RETIRED_RUNWAY_IDS = [
  'veo3.1', 'veo3.1_fast', 'seedance2.5', 'seedance2', 'wan3', 'hailuo3',
  'aleph2', 'gemini_omni_flash', 'grok_imagine_1_5', 'act_two',
  'gen4_image', 'gen4_image_turbo',
];

export function isRetiredRunwayModel(id: string | null | undefined): boolean {
  return RETIRED_RUNWAY_IDS.indexOf(String(id || '')) >= 0;
}

/** True for any Runway-native id — listed today, or one this catalog has
 * retired. Callers use this to decide that a generation belongs on the Runway
 * proxy rather than on /api/veo/generate/video. */
export function isRunwayModel(id: string | null | undefined): boolean {
  return !!runwayModel(id) || isRetiredRunwayModel(id);
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
  // A model the platform serves but this file has never heard of is ADDED
  // rather than ignored. That is what lets the static roster stay honest
  // (working models only) without freezing it: the loop below then fills in
  // the new entry's real modes, ratios, durations and price from this payload.
  liveIds.forEach((id) => {
    if (!RUNWAY_MODELS.some((m) => m.id === id)) RUNWAY_MODELS.push(rwDiscovered(id));
  });
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
  if (m?.unavailableReason) return m.unavailableReason;
  if (isRetiredRunwayModel(id)) {
    return `Runway “${String(id)}” is not served on this platform. The Runway models that work here are Gen 4.5 (text or image to video) and Gen 4 Turbo (image to video) — pick one of those, or a Veo engine.`;
  }
  return 'That Runway model is not available on this platform — pick another engine.';
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
// GROUP C — Kling (LIVE since 14 Oct 2026 via credit pack; v2-master
// discontinued upstream; new 2.5/2.6/3.0 roster unverified through the proxy)
// ---------------------------------------------------------------------------

export interface KlingModel {
  group: 'kling';
  id: string;
  name: string;
  tier: EngineTier;
  blurb: string;
  /** When true a general picker greys the model out (unverified through the
   *  platform proxy, or discontinued). The Video Provider Lab deliberately
   *  ignores this flag so the founder can test every id. */
  comingSoon?: boolean;
  /** Kling retired this id upstream — a submit is a guaranteed 502. */
  discontinued?: boolean;
  /** std/pro quality modes (legacy model_name roster only — the 2.5+ ids take no mode). */
  modes?: Array<'std' | 'pro'>;
  /** Clip lengths offered through the platform proxy (its contract is "5" | "10"). */
  durations?: number[];
  /** The model renders native audio upstream (the proxy exposes no audio field yet). */
  audio?: boolean;
}

export const KLING_COMING_SOON_MESSAGE =
  'Kling is LIVE on this platform as of 14 Oct 2026 (credit pack active), but this model is not yet verified '
  + 'end to end through the proxy, so general pickers keep it greyed until a Video Provider Lab run proves it. '
  + 'Note: kling-v2-master is permanently discontinued upstream (502 wrapping Kling API error 404, code 1203); '
  + "Kling's current ids are kling-2.5-turbo, kling-2.6, kling-3.0 and kling-3.0-omni.";

// The roster mixes the two Kling API generations. The NEW ids (kling-2.5-turbo
// and later) come from Kling's own API docs, read live 14 Oct 2026 at
// kling.ai/document-api (model-scoped endpoints such as
// /text-to-video/kling-2.5-turbo); the kling-v1* ids are the legacy
// model_name roster the platform proxy's static catalogue lists. The key is
// LIVE (credit pack, 14 Oct 2026), but every entry stays comingSoon — greyed
// in general pickers — until a Video Provider Lab run proves that id end to
// end, because the proxy may substitute its default for ids it does not
// recognise. kling-v2-master is discontinued upstream: permanently dead, not
// pending.
export const KLING_MODELS: KlingModel[] = [
  { group: 'kling', id: 'kling-3.0-omni', name: 'Kling 3.0 Omni', tier: 'Cinematic', comingSoon: true,
    durations: [5, 10], audio: true,
    blurb: "Kling's omni multi-modal flagship (14 Oct 2026 API docs): prompt, first/last frame, reference images and source-video inputs; native audio; up to 4K and 3–15s upstream. Untested through the platform proxy — prove it in the Video Provider Lab." },
  { group: 'kling', id: 'kling-3.0', name: 'Kling 3.0', tier: 'Cinematic', comingSoon: true,
    durations: [5, 10], audio: true,
    blurb: 'Current Kling flagship: text-to-video and image-to-video with native audio, multi-shot prompts, up to 4K and 3–15s upstream. Untested through the platform proxy.' },
  { group: 'kling', id: 'kling-2.6', name: 'Kling 2.6', tier: 'Standard', comingSoon: true,
    durations: [5, 10], audio: true,
    blurb: 'Kling 2.6 text-to-video and image-to-video with native audio ("native"/"off"), 720p/1080p, 5s/10s. Untested through the platform proxy.' },
  { group: 'kling', id: 'kling-2.5-turbo', name: 'Kling 2.5 Turbo', tier: 'Fast', comingSoon: true,
    durations: [5, 10],
    blurb: 'Fast tier of the current Kling API: text-to-video and image-to-video, 720p/1080p, 5s/10s, silent. Untested through the platform proxy.' },
  { group: 'kling', id: 'kling-v2-master', name: 'Kling v2 Master', tier: 'Cinematic', comingSoon: true, discontinued: true,
    modes: ['std'], durations: [5, 10],
    blurb: 'DISCONTINUED upstream: a live 14 Oct 2026 submit answered 502 wrapping Kling API error (404, code 1203) "has been discontinued". Use Kling 2.6 or 3.0 instead.' },
  { group: 'kling', id: 'kling-v1-6', name: 'Kling v1.6', tier: 'Standard', comingSoon: true,
    modes: ['std', 'pro'], durations: [5, 10],
    blurb: 'Legacy roster — balanced Kling generation, text-to-video and image-to-video, std/pro modes. May be retired upstream like v2-master; verify in the lab.' },
  { group: 'kling', id: 'kling-v1-5', name: 'Kling v1.5', tier: 'Standard', comingSoon: true,
    modes: ['std', 'pro'], durations: [5, 10],
    blurb: 'Legacy roster — the proxy default tier; text-to-video, image-to-video and Elements, std/pro modes.' },
  { group: 'kling', id: 'kling-v1', name: 'Kling v1', tier: 'Lite', comingSoon: true,
    modes: ['std', 'pro'], durations: [5, 10],
    blurb: 'Legacy roster — first-generation Kling, std/pro modes.' },
];

export interface HiggsfieldVideoModel {
  group: 'higgsfield';
  id: string;
  name: string;
  tier: EngineTier;
  blurb: string;
  mode: 'text-to-video' | 'image-to-video';
}

export const HIGGSFIELD_VIDEO_MODELS: HiggsfieldVideoModel[] = [
  {
    group: 'higgsfield', id: 'minimax-hailuo-02', name: 'Hailuo 02 (text-to-video)', tier: 'Cinematic', mode: 'text-to-video',
    blurb: 'MiniMax Hailuo cinematic text-to-video via /api/generate/higgsfield/video.',
  },
  {
    group: 'higgsfield', id: 'dop-turbo', name: 'DoP Turbo (image-to-video)', tier: 'Fast', mode: 'image-to-video',
    blurb: 'Fast camera-motion animation from a seed image.',
  },
  {
    group: 'higgsfield', id: 'dop-standard', name: 'DoP Standard (image-to-video)', tier: 'Standard', mode: 'image-to-video',
    blurb: 'Higher-quality DoP image-to-video.',
  },
  {
    group: 'higgsfield', id: 'dop-lite', name: 'DoP Lite (image-to-video)', tier: 'Lite', mode: 'image-to-video',
    blurb: 'Fastest / cheapest DoP path.',
  },
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
    return { engineId: OMNI_MODEL_ID, group: 'group-a', name: 'Gemini Omni 1.1 Flash', reason: 'Best for character consistency — the same face across every scene, from up to ten reference images sent with each one.' };
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
    return { engineId: VEO_31, group: 'group-a', name: 'Veo 3.1 (OpenRouter)', reason: 'Veo 3.1 is suited to surreal, stylized and complex multi-subject scenes, and OpenRouter is where real Veo 3.1 lives on this platform.' };
  }
  // One image, cheapest image-to-video.
  if (images === 1 && (input.budgetSensitive || has(/cheap|budget|low.?cost|inexpensive/))) {
    if (runwayOk) return { engineId: 'gen4_turbo', group: 'runway-video', name: 'Runway Gen 4 Turbo', reason: 'One image + lowest price image-to-video: Gen 4 Turbo at $0.05/second.', caveat: RUNWAY_CAVEAT };
    return { engineId: VEO_31, group: 'group-a', name: 'Veo 3.1 (OpenRouter)', reason: 'Runway is unavailable right now — Veo 3.1 is the best image-to-video fallback.' };
  }
  // Lowest-cost Veo.
  if (has(/cheapest veo|lowest.?cost veo|veo.*cheap/)) {
    return { engineId: 'openrouter/google/veo-3.1-lite', group: 'group-a', name: 'Veo 3.1 Lite (OpenRouter)', reason: 'The lowest-cost Veo path on the platform.' };
  }
  // Fast cheap B-roll, no image / budget-sensitive anything.
  if ((images === 0 && has(/b.?roll|filler|background (footage|clips)|quick clips?|fast|cheap/)) || input.budgetSensitive) {
    return { engineId: 'openrouter/bytedance/seedance-2.0-fast', group: 'group-a', name: 'Seedance 2.0 Fast', reason: 'Fast, cheap B-roll with solid quality — the budget pick for any content type.' };
  }
  // Cinematic hero with brand references. Reference images are an OMNI
  // capability on this platform — the OpenRouter Veo ids take a seed frame and
  // nothing else — so a brief carrying several brand images goes to Omni, and
  // only a text-led cinematic brief goes to Veo.
  if (images > 1) {
    return { engineId: OMNI_MODEL_ID, group: 'group-a', name: 'Gemini Omni 1.1 Flash', reason: 'Several brand images to stay on-model: Omni 1.1 is the only engine here that takes reference images (up to ten) alongside a seed frame.' };
  }
  if (has(/cinematic|hero|4k|premium|film|trailer|epic/)) {
    return { engineId: VEO_31, group: 'group-a', name: 'Veo 3.1 (OpenRouter)', reason: 'Hero cinematic quality for a text-led brief. Note that reference images are not available on this path — pick Omni 1.1 if the shot must match supplied brand assets.' };
  }
  // Image-to-video default when an image exists.
  if (images >= 1) {
    if (runwayOk) return { engineId: 'gen4_turbo', group: 'runway-video', name: 'Runway Gen 4 Turbo', reason: 'You have one image — Gen 4 Turbo is the cheapest way to bring it to life.', caveat: RUNWAY_CAVEAT };
    return { engineId: OMNI_MODEL_ID, group: 'group-a', name: 'Gemini Omni 1.1 Flash', reason: 'Runway is unavailable right now — Omni 1.1 animates a seed frame and can hold the subject steady with reference images.' };
  }
  // Default all-rounder.
  return { engineId: OMNI_MODEL_ID, group: 'group-a', name: 'Gemini Omni 1.1 Flash', reason: 'The platform default: the best quality-to-speed all-rounder, with audio and reference images available when the brief grows.' };
}

// ---------------------------------------------------------------------------
// Misc shared helpers
// ---------------------------------------------------------------------------

/** Cap text at a proxy limit on a sentence/word boundary. The proxy accepts
 *  10,000 characters and forwards them unchanged. */
export function capPromptText(text: string, max = 10000): string {
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
    case 'Cinematic': return { bg: 'rgba(245,158,11,0.16)', fg: '#FBBF24' };
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

export type EngineFamily = 'veo' | 'gemini' | 'seedance';

/** Quality tiers used by ModelBadge chips: Ultra / Cinema / Fast / Standard. */
export type EngineQualityTier = 'ultra' | 'cinema' | 'fast' | 'standard';

const QUALITY_TIER_BY_ID: Record<string, EngineQualityTier> = {
  'gemini-omni-1.1-flash': 'cinema',
  'openrouter/bytedance/seedance-2.0-fast': 'fast',
  'openrouter/google/veo-3.1': 'ultra',
  'openrouter/google/veo-3.1-fast': 'cinema',
  'openrouter/google/veo-3.1-lite': 'standard',
};

function engineFamilyOf(id: string): EngineFamily {
  if (id.includes('seedance')) return 'seedance';
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

/** NOTE: Kling went live 14 Oct 2026 (credit pack) but rides its own
 * /api/generate/kling/* proxy — see KLING_MODELS; it is not a Group A engine.
 * HeyGen is configured but unused here. Higgsfield is excluded by founder
 * ruling. None of them belong in this list. */
export const VIDEO_ENGINES: VideoEngine[] = GROUP_A_MODELS
  // Retired aliases are REACHABLE (a saved selection still routes) but never
  // OFFERED: a picker showing three names for one model reads as a broken tool.
  .filter((m) => !m.aliasOf)
  .map((m) => ({
    id: m.id,
    label: m.name,
    tier: QUALITY_TIER_BY_ID[m.id] || 'standard',
    family: engineFamilyOf(m.id),
    supportsRef: m.supportsReferenceImages,
    supports4k: m.supports4k,
    maxDurationS: m.maxDurationS,
    defaultDurationS: m.defaultDurationS,
  }));

/** The platform's own default, and this workspace's consistency engine. */
export const DEFAULT_ENGINE_ID = OMNI_MODEL_ID;

export function videoEngine(id: string | null | undefined): VideoEngine | null {
  const wanted = String(id || '');
  const direct = VIDEO_ENGINES.find((e) => e.id === wanted);
  if (direct) return direct;
  // A retired alias is no longer IN this list, but a stored selection still
  // names one. Resolving it keeps every label, badge and duration lookup
  // working instead of coming back null and rendering a blank chip.
  const resolved = resolveEngineId(wanted);
  return resolved && resolved !== wanted
    ? VIDEO_ENGINES.find((e) => e.id === resolved) || null
    : null;
}

/**
 * AUTO-RETRY FALLBACK CHAIN (global UX rule): when a generation fails after
 * one same-engine retry, step down one tier — ultra → cinema → fast →
 * seedance — and try once more. Returns null when there is nowhere left to go.
 */
export function fallbackEngineFor(id: string): string | null {
  // A retired alias falls back from the model it REALLY runs on, so the step
  // down is a genuine change of engine rather than the same one twice.
  const e = videoEngine(resolveEngineId(id)) || videoEngine(id);
  if (!e) return DEFAULT_ENGINE_ID;
  if (e.id === 'openrouter/bytedance/seedance-2.0-fast') return null;
  switch (e.tier) {
    case 'ultra': return 'openrouter/google/veo-3.1-fast';
    case 'cinema': return e.id === OMNI_MODEL_ID
      ? 'openrouter/bytedance/seedance-2.0-fast'
      : OMNI_MODEL_ID;
    case 'fast':
    case 'standard':
      return 'openrouter/bytedance/seedance-2.0-fast';
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// ENGINE HEALTH — the 9 Oct 2026 end-to-end sweep, as data.
//
// One minimal paid generation per model (shortest duration, 720p, audio off),
// polled to a terminal state. Selectors use this to warn before a customer
// picks a model the platform is currently refusing, instead of letting them
// discover it at submit time. It is a SNAPSHOT, not a gate: nothing is hidden
// or blocked on it, and a model marked 'broken' is still selectable because
// these outages have flipped both ways before.
// ---------------------------------------------------------------------------

export type EngineHealth = 'working' | 'broken' | 'rejected' | 'unconfigured';

export const ENGINE_HEALTH_CHECKED_AT = '2026-10-09';

export const ENGINE_HEALTH: Record<string, { health: EngineHealth; note: string }> = {
  'gemini-omni-1.1-flash': { health: 'working', note: 'The platform default for /api/veo/generate/video. The 9 Oct 2026 sweep reached it through its older ids and got finished clips back; the integration catalog names it the id to use in new code.' },
  'gemini-omni-flash-preview': { health: 'working', note: 'Accepted, but served by gemini-omni-1.1-flash — it is the same model under an older name.' },
  'veo-3.1-generate-preview': { health: 'working', note: 'Accepted, but retired: the platform serves it on gemini-omni-1.1-flash, so it is not a separate engine and it does not render 4K.' },
  'veo-3.1-fast-generate-preview': { health: 'working', note: 'Accepted, but retired: the platform serves it on gemini-omni-1.1-flash, so it is not a separate engine and it does not render 4K.' },
  'openrouter/bytedance/seedance-2.0-fast': { health: 'working', note: 'Verified 9 Oct 2026 — returned a finished clip.' },
  'openrouter/google/veo-3.1': { health: 'working', note: 'Verified 9 Oct 2026 — returned a finished clip.' },
  'openrouter/google/veo-3.1-fast': { health: 'working', note: 'Verified 9 Oct 2026 — returned a finished clip.' },
  'openrouter/google/veo-3.1-lite': { health: 'working', note: 'Verified 9 Oct 2026 — returned a finished clip.' },
  'minimax-hailuo-02': { health: 'working', note: 'Re-verified live 13 Oct 2026 — returned a finished clip. Duration must be 6 or 10 seconds.' },
  'dop-turbo': { health: 'working', note: 'Re-verified live 13 Oct 2026 — returned a finished clip from a source image (public URL; inline data: images are refused upstream today).' },
  'dop-standard': { health: 'working', note: 'Re-verified live 13 Oct 2026 — rendered from a source image (public URL; inline data: images are refused upstream today).' },
  'dop-lite': { health: 'working', note: 'Re-verified live 13 Oct 2026 — rendered from a source image (public URL; inline data: images are refused upstream today).' },
  // Kling: the key went LIVE 14 Oct 2026 (credit pack). Only kling-v2-master
  // has a live post-key observation; the other Kling ids (legacy v1* and the
  // new 2.5/2.6/3.0 roster) carry no health row until the Video Provider Lab
  // proves them in the browser, where the workspace credential exists.
  'kling-v2-master': { health: 'rejected', note: 'Discontinued upstream — a live 14 Oct 2026 submit answered 502 wrapping Kling API error (404, code 1203) "The model has been discontinued". The static /models catalogue still lists it; do not trust that.' },
};

export function engineHealth(id: string | null | undefined): { health: EngineHealth; note: string } | null {
  return ENGINE_HEALTH[String(id || '')] || null;
}

/** The short warning a selector shows next to a model the last sweep could not
 *  run, or null when the model is fine (or was never swept). */
export function engineHealthWarning(id: string | null | undefined): string | null {
  const entry = engineHealth(id);
  return entry && entry.health !== 'working' ? entry.note : null;
}

/**
 * Whether a model selector should offer this id as a normal choice.
 *
 * An id the sweep never covered counts as available — ENGINE_HEALTH is a
 * snapshot of what was probed, not an allow-list, so a new engine must not be
 * greyed out just because nobody has probed it yet. Only an id the sweep
 * actually caught failing comes back false.
 */
export function isEngineAvailable(id: string | null | undefined): boolean {
  const entry = engineHealth(id);
  return !entry || entry.health === 'working';
}

/** The badge a selector shows on an unavailable model, or null when it is fine. */
export function engineAvailabilityBadge(
  id: string | null | undefined,
): { label: string; title: string } | null {
  const entry = engineHealth(id);
  if (!entry || entry.health === 'working') return null;
  const label = entry.health === 'unconfigured' ? 'Not connected' : 'Unavailable';
  return { label, title: entry.note };
}

/**
 * The engines to reach for first, best quality last-verified-working first.
 * Anything the sweep caught failing is excluded outright.
 */
export const PREFERRED_WORKING_ENGINES: string[] = [
  'openrouter/google/veo-3.1',
  OMNI_MODEL_ID,
  'openrouter/google/veo-3.1-fast',
  'openrouter/bytedance/seedance-2.0-fast',
  'openrouter/google/veo-3.1-lite',
].filter((id) => isEngineAvailable(id) && !isAliasEngine(id));

/**
 * Up to `limit` working engines to offer after a failure, named the way a
 * customer would recognise them ("Veo 3.1 Fast"), never as raw proxy ids.
 * The one that just failed is excluded.
 */
export function suggestWorkingEngines(failedId?: string | null, limit = 2): Array<{ id: string; name: string }> {
  const failed = String(failedId || '');
  return PREFERRED_WORKING_ENGINES.filter((id) => id !== failed)
    .slice(0, limit)
    .map((id) => ({ id, name: groupAModel(id)?.name || id }));
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
// SCENE DURATION LIMITS AND SCENE PLANNING (added 13 Oct 2026).
//
// THE PROBLEM THIS SOLVES. Every generation model here has a hard per-clip
// ceiling — 8s on Omni Flash and the Veo 3.1 family, 10s on Seedance and the
// Runway video models — but a script's natural scene is whatever length the
// script says. Asking for a 14-second scene does not produce a 14-second clip:
// it produces a provider rejection, or worse, a clip that silently drops the
// end of the dialogue. And an agent left to choose freely picks a scene count
// from nowhere in particular, so the same brief yields 4 scenes one time and
// 30 the next.
//
// So duration is treated as a CONSTRAINT SOLVED BEFORE SUBMIT, in one place,
// against the chosen model's real capability:
//
//   sceneDurationLimits()  what this model actually accepts
//   planScenes()           a bounded, whole-second plan that sums to the total
//   validateSceneDurations() the pre-submit check, with readable violations
//   splitSegmentForModel() divides an over-long beat into coherent parts
//
// These are GUARDRAILS, not a creative policy. Nothing here decides what a
// scene is about, how it is shot or how many beats a story wants — a planning
// agent still does that, and then runs its plan through these functions so its
// creative choice is expressed in durations the provider will actually honour.
// ---------------------------------------------------------------------------

export interface SceneDurationLimits {
  minS: number;
  maxS: number;
  defaultS: number;
  /** Where the numbers came from, for a UI that shows the customer the rule. */
  source: string;
}

/** The conservative floor used when a model id is unknown to this catalog. */
const FALLBACK_SCENE_LIMITS: SceneDurationLimits = {
  minS: 2,
  maxS: 8,
  defaultS: 6,
  source: 'Unrecognised model — the safe 8-second ceiling every engine here supports.',
};

/**
 * What ONE scene may be on this model. Reads the same catalog entries the
 * selectors read, so a UI limit and a submit limit can never drift apart.
 */
export function sceneDurationLimits(modelId: string | null | undefined): SceneDurationLimits {
  const groupA = groupAModel(modelId);
  if (groupA) {
    return {
      minS: 2,
      maxS: groupA.maxDurationS,
      defaultS: groupA.defaultDurationS,
      source: `${groupA.name} generates clips up to ${groupA.maxDurationS}s.`,
    };
  }
  const runwayVideo = runwayVideoModel(modelId as any);
  if (runwayVideo) {
    return {
      minS: runwayVideo.minDurationS,
      maxS: runwayVideo.maxDurationS,
      defaultS: runwayVideo.defaultDurationS,
      source: `${runwayVideo.name} accepts any whole second from ${runwayVideo.minDurationS}s to ${runwayVideo.maxDurationS}s.`,
    };
  }
  const runway = runwayModel(modelId);
  if (runway && runway.maxDurationS) {
    return {
      minS: runway.minDurationS ?? 2,
      maxS: runway.maxDurationS,
      defaultS: runway.defaultDurationS ?? Math.min(5, runway.maxDurationS),
      source: `${runway.label} accepts ${runway.minDurationS ?? 2}–${runway.maxDurationS}s per clip.`,
    };
  }
  return FALLBACK_SCENE_LIMITS;
}

/**
 * Build limits for a model this catalog does not list, from whatever ceiling
 * the calling surface's own registry knows.
 *
 * Script-to-Video, SceneForge and Ads Studio each carry a model registry of
 * their own (Kling ids, native-integration ids, provider ids the Group A list
 * has never heard of). Without this, those surfaces would either get the
 * conservative 8-second fallback — under-reporting a model that really does
 * 10 — or go back to inventing their own duration rules, which is the drift
 * this contract exists to end. So the limits SHAPE stays the single thing
 * every surface validates against, while the number may come from the
 * registry that actually knows it.
 */
export function sceneDurationLimitsFrom(input: {
  modelId?: string | null;
  modelName?: string | null;
  maxS: number;
  minS?: number;
  defaultS?: number;
}): SceneDurationLimits {
  // A model this catalog DOES know always wins: those numbers are probe-verified.
  const known = groupAModel(input.modelId)
    || runwayVideoModel(input.modelId as any)
    || runwayModel(input.modelId);
  if (known) return sceneDurationLimits(input.modelId);

  const maxS = Math.max(1, Math.round(Number(input.maxS) || FALLBACK_SCENE_LIMITS.maxS));
  const minS = Math.max(1, Math.min(maxS, Math.round(Number(input.minS) || FALLBACK_SCENE_LIMITS.minS)));
  const defaultS = Math.max(minS, Math.min(maxS, Math.round(Number(input.defaultS) || Math.min(maxS, 6))));
  const name = String(input.modelName || input.modelId || 'This model').trim();
  return { minS, maxS, defaultS, source: `${name} generates clips up to ${maxS}s.` };
}

/**
 * The sentence a form shows under a duration control, from limits already in
 * hand. Separated from `sceneDurationHint` so a surface using
 * `sceneDurationLimitsFrom` shows the customer the SAME wording rather than
 * writing its own.
 */
export function formatSceneDurationHint(limits: SceneDurationLimits): string {
  return `${limits.minS}–${limits.maxS}s per scene (default ${limits.defaultS}s). ${limits.source}`;
}

/** The sentence a form shows under a duration control. */
export function sceneDurationHint(modelId: string | null | undefined): string {
  return formatSceneDurationHint(sceneDurationLimits(modelId));
}

export interface ScenePlanInput {
  modelId?: string | null;
  /** The finished video's length. Scene length is derived from it, not equal to it. */
  totalDurationS: number;
  /** An agent's or a customer's intended scene count. Honoured when it fits. */
  requestedSceneCount?: number | null;
  /** Hard ceiling on scenes, so "AI mode" cannot return an unbounded plan. */
  maxScenes?: number;
  minScenes?: number;
}

export interface PlannedScene {
  index: number;
  durationS: number;
}

export interface ScenePlan {
  scenes: PlannedScene[];
  /** The total the plan actually covers — may be less than requested; see notes. */
  totalDurationS: number;
  limits: SceneDurationLimits;
  /** Every adjustment made, in words worth showing. Never a silent change. */
  notes: string[];
}

export const DEFAULT_MAX_SCENES = 12;

/**
 * Turn "I want N seconds of video on model M" into a plan of whole-second
 * scenes that each fit the model and together sum EXACTLY to the covered total.
 *
 * The scene count is derived, never hardcoded: the minimum number of scenes
 * that can carry the total is the floor, the caller's request is honoured when
 * it fits between that floor and the ceiling, and the ceiling is what stops an
 * agent returning sixty scenes for a thirty-second ad. Any clamp is reported
 * in `notes` rather than applied quietly.
 */
export function planScenes(input: ScenePlanInput): ScenePlan {
  const limits = sceneDurationLimits(input.modelId);
  const notes: string[] = [];
  const maxScenes = Math.max(1, Math.floor(input.maxScenes ?? DEFAULT_MAX_SCENES));
  const minScenes = Math.max(1, Math.min(maxScenes, Math.floor(input.minScenes ?? 1)));

  let total = Math.round(Number(input.totalDurationS));
  if (!Number.isFinite(total) || total <= 0) {
    total = limits.defaultS;
    notes.push(`No total length was given, so one ${limits.defaultS}s scene is planned.`);
  }

  // The fewest scenes that can carry the total without any scene exceeding the
  // model's ceiling, and the most that can carry it without falling under the
  // model's floor.
  const fewestPossible = Math.ceil(total / limits.maxS);
  const mostUseful = Math.max(1, Math.floor(total / limits.minS));

  let count = fewestPossible;
  const requested = Math.floor(Number(input.requestedSceneCount));
  if (Number.isFinite(requested) && requested > 0) {
    count = requested;
    if (count < fewestPossible) {
      notes.push(
        `${requested} scene${requested === 1 ? '' : 's'} cannot carry ${total}s on this model `
        + `(${limits.maxS}s per scene), so ${fewestPossible} scenes are used instead.`,
      );
      count = fewestPossible;
    }
    if (count > mostUseful) {
      notes.push(
        `${requested} scenes would leave each one under the ${limits.minS}s minimum, `
        + `so ${mostUseful} scenes are used instead.`,
      );
      count = mostUseful;
    }
  }

  count = Math.max(minScenes, Math.min(maxScenes, count));

  // A total too long for the scene ceiling is REDUCED and said out loud. The
  // alternative is submitting a duration the provider refuses.
  const coverable = count * limits.maxS;
  if (total > coverable) {
    notes.push(
      `${total}s needs more than the ${maxScenes}-scene limit allows on this model, `
      + `so the video is planned at ${coverable}s. Raise the scene limit or pick a `
      + `longer-clip model to go further.`,
    );
    total = coverable;
  }
  const floorable = count * limits.minS;
  if (total < floorable) {
    notes.push(`${total}s is shorter than ${count} scenes can be, so ${floorable}s is planned.`);
    total = floorable;
  }

  // Whole seconds that sum exactly: the base length for every scene, with the
  // remainder handed out one second at a time to the earliest scenes.
  const base = Math.floor(total / count);
  let remainder = total - base * count;
  const scenes: PlannedScene[] = [];
  for (let index = 0; index < count; index += 1) {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    scenes.push({
      index,
      durationS: Math.max(limits.minS, Math.min(limits.maxS, base + extra)),
    });
  }

  return { scenes, totalDurationS: scenes.reduce((sum, s) => sum + s.durationS, 0), limits, notes };
}

/**
 * The PRE-SUBMIT check. Returns a readable violation for each problem and an
 * empty array when the plan is safe to send. Call this before paying for a
 * generation, not after the provider has refused it.
 */
export function validateSceneDurations(
  modelId: string | null | undefined,
  durations: number[],
  opts: {
    expectedTotalS?: number | null;
    maxScenes?: number;
    /** Limits from `sceneDurationLimitsFrom`, for a model this catalog does
     * not list. Omit it and the catalog's own limits are used. */
    limits?: SceneDurationLimits;
  } = {},
): string[] {
  const limits = opts.limits || sceneDurationLimits(modelId);
  const maxScenes = Math.max(1, Math.floor(opts.maxScenes ?? DEFAULT_MAX_SCENES));
  const problems: string[] = [];

  if (!durations.length) return ['The plan has no scenes.'];
  if (durations.length > maxScenes) {
    problems.push(`${durations.length} scenes exceeds the ${maxScenes}-scene limit for this workflow.`);
  }

  durations.forEach((raw, index) => {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      problems.push(`Scene ${index + 1} has no duration.`);
      return;
    }
    if (!Number.isInteger(value)) {
      problems.push(`Scene ${index + 1} is ${value}s — durations must be whole seconds.`);
    }
    if (value > limits.maxS) {
      problems.push(
        `Scene ${index + 1} is ${value}s, over this model's ${limits.maxS}s ceiling. `
        + `Split it into ${Math.ceil(value / limits.maxS)} scenes instead.`,
      );
    }
    if (value < limits.minS) {
      problems.push(`Scene ${index + 1} is ${value}s, under this model's ${limits.minS}s minimum.`);
    }
  });

  const expected = Number(opts.expectedTotalS);
  if (Number.isFinite(expected) && expected > 0) {
    const sum = durations.reduce((total, value) => total + (Number(value) || 0), 0);
    if (sum !== Math.round(expected)) {
      problems.push(`The scene durations add up to ${sum}s but the video is set to ${Math.round(expected)}s.`);
    }
  }

  return problems;
}

export interface SegmentPart {
  text: string;
  durationS: number;
}

/**
 * Divide one over-long beat into parts the model can actually generate.
 *
 * The text is split at SENTENCE boundaries and, failing that, at clause
 * boundaries, so each part is still a coherent thing to film. Nothing is
 * truncated: every word in the input appears in exactly one part — losing the
 * back half of a line of dialogue to a duration cap is the failure this
 * function exists to prevent. Returns a single part when the beat already fits.
 */
export function splitSegmentForModel(
  modelId: string | null | undefined,
  text: string,
  durationS: number,
): SegmentPart[] {
  const limits = sceneDurationLimits(modelId);
  const total = Math.max(limits.minS, Math.round(Number(durationS) || limits.defaultS));
  const body = String(text || '').trim();

  if (total <= limits.maxS) return [{ text: body, durationS: total }];

  const plan = planScenes({
    modelId,
    totalDurationS: total,
    maxScenes: Math.ceil(total / limits.minS),
  });
  const parts = plan.scenes.length;

  // Sentences first; clauses only if the beat is one long sentence.
  let pieces = body.match(/[^.!?\u2026]+[.!?\u2026]+|[^.!?\u2026]+$/g) || [];
  if (pieces.length < parts) {
    pieces = body.split(/(?<=[,;:—])\s+/).filter(Boolean);
  }
  if (!pieces.length) pieces = [body];

  // Hand the pieces out in proportion to each part's share of the duration, so
  // a longer part carries more of the line.
  const out: SegmentPart[] = [];
  let cursor = 0;
  plan.scenes.forEach((scene, index) => {
    const remainingParts = parts - index;
    const remainingPieces = pieces.length - cursor;
    const take = index === parts - 1
      ? remainingPieces
      : Math.max(1, Math.round(remainingPieces / remainingParts));
    const slice = pieces.slice(cursor, cursor + take).join(' ').trim();
    cursor += take;
    out.push({ text: slice || body, durationS: scene.durationS });
  });

  return out;
}

// ---------------------------------------------------------------------------
// SHOT-INTENT ROUTING (master plan §6/§43, added 28 Sep 2026).
// One shared answer to "which engine should THIS shot use?", so routing
// logic never gets hard-coded into an isolated page again. Purely additive:
// nothing above changed, and no app behaviour changes until a surface calls it.
//
// Grounded in PROBE-VERIFIED platform behaviour. Re-verified end to end on
// 9 Oct 2026 with one real minimal generation per model, which INVERTED two of
// the previous findings — OpenRouter recovered and Sora broke — so the notes
// below replace the 28 Sep ones rather than sitting alongside them:
//  · WORKING, clip returned: gemini-omni-flash-preview,
//    veo-3.1-generate-preview, veo-3.1-fast-generate-preview, and EVERY
//    openrouter/* id in the enum (seedance-2.0-fast, veo-3.1, veo-3.1-fast,
//    veo-3.1-lite). The managed POST /api/generate/video works too.
//  · REMOVED FROM THE CATALOG (13 Oct 2026): sora-2, sora-2-pro,
//    veo-3.0-generate-001, veo-3.0-fast-generate-001 and veo-2.0-generate-001
//    (the proxy answered 200 with a synthetic *_error_* id instead of a real
//    operation) plus openrouter/bytedance/seedance-2.5-fast (hard 400 — not in
//    the proxy enum). They no longer exist in GROUP_A_MODELS, so no route or
//    fallback chain names them.
//  · RUNWAY: live. The free quote answers 200 with a real price, so routes stay
//    ON by default; pass runwayEnabled:false only after a submit answered 503
//    this session. The paid submit needs a browser X-Workspace-DB-Token.
//  · KLING: LIVE as of 14 Oct 2026 (credit pack active). kling-v2-master is
//    discontinued upstream (502 wrapping Kling 404 code 1203). Kling's own
//    docs now list kling-2.5-turbo / 2.6 / 3.0 / 3.0-omni; none are verified
//    through the platform proxy yet, and GET /api/generate/kling/models is
//    still a static list — never gate Kling on that catalogue call.
//  · HIGGSFIELD: verified WORKING (Hailuo 02 text-to-video and all three DoP
//    image-to-video models returned clips). It is excluded from VIDEO_ENGINES
//    because that list is Group-A-only — reach it through
//    lib/videoIntegrations.ts, which routes it correctly.
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
  /** True only after a Kling submit worked this session. The key is LIVE as of
   * 14 Oct 2026 (credit pack), but kling-v2-master is discontinued upstream and
   * no other Kling id is proven through the proxy yet, so undefined still
   * counts as FALSE. The /models catalogue is static — never gate on it. */
  klingEnabled?: boolean;
  /** OpenRouter submits were re-verified working on 9 Oct 2026 (Seedance 2.0
   * Fast and all three OpenRouter Veo ids each returned a real operation and a
   * finished clip), so undefined now counts as TRUE — the same convention
   * runwayEnabled uses. Pass false only after an openrouter/* submit came back
   * with a synthetic openrouter_error_* id this session. */
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

// The four engines that are genuinely DISTINCT on this platform. The
// `veo-3.1-*-generate-preview` ids are not among them: they are retired
// aliases the proxy serves on Omni 1.1, so routing a "cinematic Veo" shot to
// one of them delivered an Omni clip while telling the customer it was Veo.
// Real Veo 3.1 is reachable — through OpenRouter, which is a separate enum
// entry and not retired.
const OMNI = OMNI_MODEL_ID;
const VEO_31 = 'openrouter/google/veo-3.1';
const VEO_31_FAST = 'openrouter/google/veo-3.1-fast';
const SEEDANCE = 'openrouter/bytedance/seedance-2.0-fast';

export function routeShotIntent(intent: ShotIntent, avail: EngineAvailability = {}): ShotRoute {
  switch (intent) {
    case 'ui_demo':
      return {
        kind: 'code', engineId: null, fallbackChain: [],
        reason: 'Product UI is recreated deterministically — real screenshot (or coded interface skeleton) inside an animated device/browser mockup with cursor, clicks and highlights, rendered through Remotion. Generative video is never asked to draw an interface.',
      };
    case 'cinematic_hero':
      return {
        kind: 'engine', engineId: VEO_31, fallbackChain: [VEO_31_FAST, OMNI, SEEDANCE],
        reason: 'Real Veo 3.1 via OpenRouter for a text-led cinematic hero shot. This path accepts one seed image, no reference images, and does not promise 4K.',
      };
    case 'fast_broll':
      return avail.openRouterHealthy !== false
        ? { kind: 'engine', engineId: SEEDANCE, fallbackChain: [OMNI, VEO_31_FAST], reason: 'Seedance 2.0 Fast is the cheapest, fastest B-roll engine, and it was re-verified end to end on 9 Oct 2026.' }
        : { kind: 'engine', engineId: OMNI, fallbackChain: [VEO_31_FAST], reason: 'An openrouter/* submit came back as a synthetic openrouter_error_* id this session, so Omni Flash takes the fast B-roll work — the same route veh-broll-generate uses.' };
    case 'character_consistency':
      return {
        kind: 'engine', engineId: OMNI, fallbackChain: [VEO_31],
        reason: 'Omni Flash: reference images + seed image together — the same face/mascot carries across every scene.',
      };
    case 'product_consistency':
      return {
        kind: 'engine', engineId: OMNI, fallbackChain: [VEO_31, VEO_31_FAST],
        reason: 'Omni 1.1 is the only engine here that accepts reference images (up to ten, combinable with a seed frame), so it is the product-consistency route.',
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
        kind: 'engine', engineId: VEO_31, fallbackChain: [VEO_31_FAST, OMNI],
        reason: 'Veo 3.1 carries surreal, stylized and complex multi-subject scenes — strong prompt adherence for dream logic, crowds and impossible physics.',
      };
    case 'video_to_video':
      return avail.runwayEnabled !== false
        ? { kind: 'recipe', engineId: 'product_swap', fallbackChain: [], reason: 'Runway product_swap performs a real video transformation (reference video + product swap).' }
        : { kind: 'unavailable', engineId: null, fallbackChain: [], reason: 'Runway answered 503 this session, and no other enabled provider performs true video-to-video (Kling has no video-to-video route on the platform proxy, Higgsfield founder-excluded). Do NOT fake it with text-to-video — retry Runway shortly or offer Video Enhancer\u2019s editorial treatments (real transforms of the real footage) instead.' };
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
