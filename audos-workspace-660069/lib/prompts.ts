/**
 * SHARED PROMPT BUILDER — the one place a generation prompt is composed for
 * the VidVerge video apps.
 *
 * The rule this file exists to enforce: nothing short, nothing vague. A
 * three-word scene description produces a three-word-quality clip, so every
 * request carries the subject, the character, the visual style, the platform
 * framing, the mood, the brand colours, the product and an explicit list of
 * artefacts to avoid.
 *
 * Budgets live in lib/videoEngines.ts (PROMPT_BUDGET / NEGATIVE_BUDGET) and
 * the callers cap against the engine that is actually rendering — a long
 * prompt is the goal, an over-budget one is a 400.
 */

export interface DetailedPromptParams {
  /** What happens in the scene. */
  sceneDescription: string;
  /** Who is in the scene — the locked character description. */
  characterDesc: string;
  /** Visual style / aesthetic. */
  style: string;
  /** Instagram Reels, TikTok, YouTube Shorts, … */
  platform: string;
  /** energetic, calm, professional, … */
  mood: string;
  /** e.g. "gold (#f5b936) and dark (#1a1205)". */
  brandColors?: string;
  productName?: string;
  /** Hook scenes get the stop-the-scroll instruction. */
  isHook?: boolean;
}

/** True for the vertical short-form platforms, which want tight 9:16 framing. */
function isVertical(platform: string): boolean {
  return /reel|tiktok|short|vertical|9:16/i.test(String(platform || ''));
}

export function buildDetailedPrompt(params: DetailedPromptParams): string {
  const hookPrefix = params.isHook
    ? 'HOOK SCENE — must stop the scroll in 2 seconds. '
    : '';
  const platform = String(params.platform || 'Instagram Reels');
  const framing = isVertical(platform)
    ? '9:16 vertical format, tight framing, face fills upper third'
    : '16:9 horizontal format, wide shot with product visible';
  return [
    `${hookPrefix}${params.sceneDescription}.`,
    `Character: ${params.characterDesc}, facing camera, speaking directly to viewer, natural confident expression.`,
    `Visual style: ${params.style}, shot on professional camera, cinematic color grade.`,
    `Platform: ${platform} — ${framing}.`,
    `Mood: ${params.mood}. Lighting: soft key light, clean background or relevant environment.`,
    params.brandColors ? `Brand accent colors visible in environment or wardrobe: ${params.brandColors}.` : '',
    params.productName ? `Product featured: ${params.productName} — clearly visible and in use.` : '',
    'No text overlays in video. No jump cuts mid-scene. Smooth natural motion. Photo-realistic rendering.',
    'No stock-footage look. No green screen artifacts. No blurry faces.',
  ].filter(Boolean).join(' ');
}

/**
 * The negative prompt every clip carries. Kling takes it as `negativePrompt`;
 * the Group A proxy takes it as `negativePrompt` too (capped at
 * NEGATIVE_BUDGET). Scene-specific exclusions are appended by the caller.
 */
export const AD_NEGATIVE_PROMPT =
  'blurry, distorted face, extra limbs, text overlays, watermark, low quality, jerky motion, '
  + 'cartoon, anime, stock footage, green screen artifacts, inconsistent character, different person between scenes';

/** Merge the standing negative prompt with a scene's own exclusions. */
export function negativePromptWith(extra?: string | null): string {
  const tail = String(extra || '').trim();
  return tail ? `${AD_NEGATIVE_PROMPT}, ${tail}` : AD_NEGATIVE_PROMPT;
}

/**
 * The consistency clause repeated on EVERY scene of one ad: the same face,
 * hair, wardrobe and lighting across cuts is stated as an instruction as well
 * as carried by the reference images.
 */
export function characterLockClause(characterDesc: string): string {
  const who = String(characterDesc || '').trim();
  if (!who) return '';
  return `Consistent character: ${who}. Maintain exact same face, hair, clothing, lighting across all scenes. `
    + 'Do not change character appearance.';
}

/** The product-screen ("screen recording" substitute) zoom prompt. */
export const PRODUCT_SCREEN_PROMPT =
  'Smooth cinematic zoom into the center of the screen, product UI visible, professional lighting, '
  + 'no people, clean motion';
