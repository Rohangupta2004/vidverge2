/**
 * Tier 4 — generateImage.
 *
 * ~$0.05 a frame, and the workhorse of a well-made faceless video: a still
 * that a camera move brings to life reads as deliberate, where an AI video
 * clip of the same idea reads as an AI video clip. The visual plan downgrades
 * expensive beats into this path on purpose.
 *
 * The call goes through the faceless-assets server function rather than
 * straight to the image proxy. That is not ceremony: the platform image proxy
 * writes a generation row keyed on the caller's app id, and a space app id
 * violates its own foreign key there, so the request has to be made without
 * that header and the resulting data: URL re-hosted for a durable address.
 * All of that belongs server-side.
 */

import { FacelessError, type AspectId, type ResolvedAsset } from '../types/editorial';
import { callHook } from '../lib/platform';
import { aspectOf } from '../lib/facelessOptions';

const STAGE = 'assets' as const;

export const IMAGE_COST = 0.05;

export interface GenerateImageOptions {
  /** Continuity text appended so every still in the film shares one look. */
  styleSuffix?: string;
  aspectRatio?: '16:9' | '9:16' | '1:1';
}

export async function generateImage(prompt: string, options: GenerateImageOptions = {}): Promise<string> {
  const text = composePrompt(prompt, options.styleSuffix);
  if (text.length < 12) {
    throw new FacelessError('An image prompt needs more than a few words.', STAGE, 'prompt_too_short');
  }

  const out = await callHook<{ imageUrl?: string }>(
    'faceless-assets',
    { op: 'image', prompt: text, aspect: options.aspectRatio || '16:9' },
    STAGE,
  );
  const url = String(out.imageUrl || '');
  if (!/^https?:\/\//i.test(url)) {
    throw new FacelessError('Image generation returned no durable URL.', STAGE, 'no_image');
  }
  return url;
}

export async function generateImageAsset(
  beatId: string,
  prompt: string,
  options: GenerateImageOptions = {},
): Promise<ResolvedAsset> {
  const url = await generateImage(prompt, options);
  return { beatId, tier: 4, url, duration: 0, type: 'image', cost: IMAGE_COST, provider: 'gemini-image' };
}

/**
 * The style suffix is what stops twelve separately-generated stills from
 * looking like twelve different films. It carries the continuity guide, and
 * it always ends with the no-text instruction: any lettering the model paints
 * in would collide with the real, re-renderable text layer.
 */
export function composePrompt(prompt: string, styleSuffix?: string): string {
  const base = String(prompt || '').trim();
  const suffix = String(styleSuffix || '').trim();
  return [base, suffix, 'No text, no words, no lettering, no watermark, no logos anywhere in the image.']
    .filter(Boolean)
    .join(' ')
    .slice(0, 3600);
}

/**
 * One sentence of look, reused on every generated frame in the film. The
 * framing clause comes from the chosen aspect ratio: a portrait film asked
 * for widescreen compositions comes back with the subject cropped out of its
 * own frame.
 */
export function styleSuffixFrom(
  continuity: { colorStory: string; visualMotif: string },
  aspect?: AspectId,
): string {
  return `Colour story: ${continuity.colorStory}. Recurring motif: ${continuity.visualMotif}. ${aspectOf(aspect).framingHint}`;
}
