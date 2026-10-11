// HyperFrames rendering: the HTML/CSS/JS bundle path.
//
// THE ECONOMY THIS FILE PROTECTS. A HyperFrames bundle is uploaded ONCE and
// then re-rendered with different variables forever. Uploading the zip per
// card — which is the obvious but wrong implementation — would pay an upload
// and a registration on every single card in every film. So the zip's asset
// handle is cached under a key that includes the bundle's own content
// fingerprint (see lib/hyperFrameBundles.bundleCacheKey): the first card of
// the session uploads it, every later card reuses it, and editing a template
// in source invalidates the cache automatically.
import {
  CapabilityUnavailable,
  assetHandle,
  body,
  cacheBlobAsset,
  get,
  jobIdOf,
  post,
  probe,
  sleep,
  statusOf,
  urlOf,
} from './heygenApi';
import { HeyGenError } from './heygenStudio';
import { bundleCacheKey, bundleZip, frameTemplate, type FrameBrandVariables } from './hyperFrameBundles';
import type { AspectRatio, BrandKit, CardTemplateId } from './motionEditor';

/** The brand variables every bundle reads, derived from the editor's kit. */
export function brandVariables(kit: BrandKit): FrameBrandVariables {
  return {
    primary: kit.primary || '#f59e0b',
    accent: kit.accent || '#d97706',
    background: kit.contrast || '#0b1022',
    text: kit.textColor || '#ffffff',
    font: kit.font || 'Inter, system-ui, sans-serif',
    logo: kit.logoUrl || '',
  };
}

/**
 * The asset handle for one template's zip, uploading it the first time only.
 *
 * `cacheBlobAsset` keys on the string passed in, and that key carries the
 * bundle fingerprint, so this is safe to call before every render.
 */
export async function ensureTemplateAsset(id: CardTemplateId): Promise<string> {
  const key = bundleCacheKey(id);
  const { blob } = bundleZip(id);
  const asset = await cacheBlobAsset(key, blob, `${id}.zip`, 'sceneforge-hyperframes');
  return assetHandle(asset);
}

/** Warm every template's upload up front, e.g. on first opening the panel. */
export async function prewarmTemplates(ids: CardTemplateId[]): Promise<void> {
  // Sequential on purpose: four parallel uploads of the same size gain
  // nothing and are far more likely to trip an upload rate limit.
  for (const id of ids) {
    try { await ensureTemplateAsset(id); }
    catch (e) {
      console.warn('[SceneForge] A HyperFrames template could not be pre-uploaded; it will upload on first use.', id, e);
    }
  }
}

export interface FrameRender {
  clipUrl: string;
  renderId: string;
}

/**
 * Render ONE card as an MP4 overlay.
 *
 * Variables are sent as a flat string map — the bundle's own copy fields
 * merged with the brand variables — because that is what the bundle's
 * `readVariables()` consumes. Duration and aspect ratio are sent so the
 * recorder's frame matches the film it will be composited into.
 */
export async function renderFrame(
  id: CardTemplateId,
  variables: Record<string, string>,
  kit: BrandKit,
  aspect: AspectRatio,
  durationSec: number,
): Promise<FrameRender> {
  const assetId = await ensureTemplateAsset(id);
  const payload = {
    asset_id: assetId,
    variables: { ...variables, ...brandVariables(kit) },
    aspect_ratio: aspect,
    duration: Math.max(1, Math.round(durationSec || frameTemplate(id).defaultDuration)),
    output_format: 'mp4',
    // A card is composited OVER the presenter, so an alpha-capable render is
    // preferable where the account supports it. HeyGen ignores the hint when
    // it does not, and the bundle's own filled background covers that case.
    transparent: true,
  };

  const created = await probe('hyperframes', 'HeyGen HyperFrames', () => post('v3/hyperframes/renders', payload));
  const immediate = urlOf(created);
  const renderId = jobIdOf(created);
  if (immediate) return { clipUrl: immediate, renderId };
  if (!renderId) throw new HeyGenError('HyperFrames accepted the card but returned no render id.');

  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleep(3000);
    const status = await get(`v3/hyperframes/renders/${encodeURIComponent(renderId)}`);
    const clipUrl = urlOf(status);
    if (clipUrl) return { clipUrl, renderId };
    const state = statusOf(status);
    if (/^(failed|error|cancell?ed)$/.test(state)) {
      const detail = String(body(status).failure_message || body(status).message || '');
      throw new HeyGenError(detail || 'HyperFrames could not render this card.');
    }
  }
  throw new HeyGenError('The HyperFrames card render did not finish in time.');
}

/** True when the failure is simply "HyperFrames is not on this plan". */
export function frameUnavailable(error: unknown): boolean {
  return error instanceof CapabilityUnavailable;
}
