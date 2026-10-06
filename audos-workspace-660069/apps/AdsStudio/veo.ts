/**
 * ADS STUDIO — Veo layer. Clip generation through the platform's
 * schema-validated video proxy (integration: google-veo3):
 *
 *   submit:  POST /api/veo/generate/video       → { operationId }
 *   poll:    GET  /api/veo/status/:operationId  → { status, videoUrl }
 *
 * Model: gemini-omni-flash-preview — the only video model the platform
 * accepts (the retired veo-3.x ids answer 400).
 *
 * CHARACTER CONSISTENCY (the Script-to-Video mechanism). Two images travel
 * with every clip and resolveClipReferences below splits them across the
 * fields the chosen engine actually accepts:
 *   - the LOCKED presenter reference — the same image on every clip of a run,
 *     sent as referenceImages on engines that take them (Omni Flash);
 *   - the previous clip's final frame — sent as imageData, so clip N+1 starts
 *     from where clip N ended.
 * Textual continuity notes ride inside the prompt alongside them.
 *
 * Also holds the browser-side frame utilities the agentic loop needs:
 * last-frame extraction (continuity context for Opus) and duration probing.
 */

import { uploadDataUrl } from './api';
import {
  engineLabelOf, generateWithOmniFlash, isModelRejection,
} from '../../lib/omniFallback';
import { pollGroupA, submitGroupA } from '../../lib/videoEngineClient';
import { APP_IDS, OMNI_FLASH_MODEL } from '../../lib/appIds';
import { groupAModel, isRunwayModel } from '../../lib/videoEngines';
import { generateVideoClip, integrationForEngineId, type VideoIntegrationId } from '../../lib/videoIntegrations';

/** The default model an Ads Studio clip renders on — exported so the pipeline
 * can RECORD the actual model used on each generated clip.
 *
 * `gemini-omni-flash-preview` is the only Omni Flash spelling the proxy's model
 * enum accepts; a versioned id answers 400 invalid_enum_value. */
// TODO: upgrade to 1.1 when platform key is confirmed
export const VEO_MODEL = OMNI_FLASH_MODEL;

// The proxy rejects prompts over 1000 characters ("String must contain at
// most 1000 character(s)"), so every prompt is capped BEFORE submission.
// Cuts land on a sentence or word boundary so the prompt still reads whole.
const VEO_PROMPT_MAX = 1000;
export function capVeoText(text: string, max = VEO_PROMPT_MAX): string {
  const t = String(text || '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'));
  if (sentence > max * 0.6) return cut.slice(0, sentence + 1).trim();
  const space = cut.lastIndexOf(' ');
  return (space > 0 ? cut.slice(0, space) : cut).trim();
}

/** The two continuity images one clip can be generated against. */
export interface ClipReferences {
  /** The LOCKED presenter reference — the SAME image on every clip of a run
   * (the uploaded avatar, or the portrait cast once for this ad). */
  characterImageUrl?: string | null;
  /** The previous clip's final frame, seeding this clip so the actor, wardrobe
   * and set carry over instead of being invented again. */
  seedImageUrl?: string | null;
}

const publicImage = (url?: string | null): string | null =>
  (typeof url === 'string' && /^https:\/\//.test(url) ? url : null);

/**
 * Split the locked presenter and the chained frame across the fields the
 * chosen engine accepts (combining rules live in lib/videoEngines):
 * - Omni Flash takes referenceImages AND a seed, so the presenter rides as a
 *   reference on every clip while the previous final frame seeds this one.
 * - Every other engine takes ONE image: the chain frame when there is one,
 *   the locked presenter otherwise.
 */
export function resolveClipReferences(model: string, refs: ClipReferences): {
  imageData: string | null;
  referenceImages: { imageData: string; referenceType: 'asset' }[];
} {
  const character = publicImage(refs.characterImageUrl);
  const seed = publicImage(refs.seedImageUrl);
  const spec = groupAModel(model || VEO_MODEL);
  const carriesBoth = Boolean(spec && spec.supportsReferenceImages && !spec.refsExclusiveWithSeed);
  return {
    imageData: seed || character,
    referenceImages: carriesBoth && character ? [{ imageData: character, referenceType: 'asset' }] : [],
  };
}

export async function submitVeo(params: ClipReferences & {
  prompt: string;
  negative?: string;
  aspect: '9:16' | '16:9' | '1:1';
  durationS: number;
  /** Legacy alias for characterImageUrl. */
  referenceImageUrl?: string | null;
  /** Group A model id. Runway ids never reach here — renderAdClip routes
   * those to the Runway proxy instead. */
  model?: string;
  creditKey?: string;
}): Promise<{ operationId: string; creditKey?: string }> {
  // The video model renders 4–8s clips; a 10s script clip renders at the 8s cap.
  const duration = Math.min(8, Math.max(4, Math.round(params.durationS || 6)));
  const model = params.model || VEO_MODEL;
  const refs = resolveClipReferences(model, {
    characterImageUrl: params.characterImageUrl ?? params.referenceImageUrl,
    seedImageUrl: params.seedImageUrl,
  });
  const kick = await submitGroupA({
    appId: APP_IDS.adsStudio,
    model,
    prompt: capVeoText(params.prompt),
    negativePrompt: params.negative ? capVeoText(params.negative, 500) : undefined,
    aspectRatio: params.aspect,
    duration,
    generateAudio: true,
    imageData: refs.imageData || undefined,
    referenceImages: refs.referenceImages.length ? refs.referenceImages : undefined,
    creditKey: params.creditKey,
  });
  return { operationId: kick.operationId, creditKey: kick.creditKey };
}

/** Poll a submitted Veo operation to completion; resolves with the clip URL. */
export async function pollVeo(operationId: string, timeoutMs = 8 * 60 * 1000, creditKey?: string): Promise<string> {
  return pollGroupA(operationId, { timeoutMs, creditKey, appId: APP_IDS.adsStudio });
}

/**
 * Render ONE ad clip on whichever engine the customer picked, and report the
 * model it actually rendered on.
 *
 * Runway ids go to the platform's Runway proxy through the shared adapter:
 * /api/veo/generate/video rejects them outright (invalid_enum_value), and the
 * Runway proxy speaks a different body — promptText, pixel-pair ratio, and an
 * Idempotency-Key per submit. Everything else keeps the proven Veo path.
 *
 * NO ENGINE IS A DEAD END. Every entry in the picker is selectable now, so an
 * engine the platform does not accept today (most of the Runway roster, and
 * Kling while its key is pending) is caught here and re-filmed on Omni Flash;
 * `fallbackFrom` carries the engine the customer chose so the surface can say
 * what happened. A failure that is NOT a model rejection — an empty wallet, a
 * cancellation, a provider outage — is raised as itself.
 */
export async function renderAdClip(params: ClipReferences & {
  model: string;
  /** Native Audos integration — routes through lib/videoIntegrations when set. */
  integration?: VideoIntegrationId;
  prompt: string;
  negative?: string;
  aspect: '9:16' | '16:9' | '1:1';
  durationS: number;
  /** Legacy alias for characterImageUrl. */
  referenceImageUrl?: string | null;
  creditKey?: string;
}): Promise<{ videoUrl: string; modelUsed: string; fallbackFrom?: string }> {
  const requested = params.model || VEO_MODEL;
  const integration = params.integration || integrationForEngineId(requested);

  const viaOmniFlash = async () => {
    const out = await generateWithOmniFlash({
      appId: APP_IDS.adsStudio,
      prompt: params.prompt,
      negativePrompt: params.negative,
      aspect: params.aspect,
      durationSeconds: params.durationS,
      seedImageUrl: params.seedImageUrl,
      referenceImageUrl: params.characterImageUrl ?? params.referenceImageUrl,
    });
    return { videoUrl: out.videoUrl, modelUsed: out.model, fallbackFrom: engineLabelOf(requested) };
  };

  if (integration === 'heygen-video') {
    throw new Error('HeyGen films avatar videos — pick a scene provider (Image & Video, Veo, Kling, Higgsfield, or Runway) for ad clips.');
  }

  const refs = resolveClipReferences(requested, {
    characterImageUrl: params.characterImageUrl ?? params.referenceImageUrl,
    seedImageUrl: params.seedImageUrl,
  });

  try {
    const videoUrl = await generateVideoClip({
      integration,
      model: requested,
      prompt: params.prompt,
      aspectRatio: params.aspect,
      duration: params.durationS,
      imageData: refs.imageData,
      referenceImages: refs.referenceImages.length ? refs.referenceImages : null,
      appId: 'ads-studio',
    });
    return { videoUrl, modelUsed: requested };
  } catch (e) {
    const mayOmniFallback = integration === 'image-and-video-generation'
      || integration === 'google-veo3'
      || integration === 'runway-recipes'
      || isRunwayModel(requested);
    if (!mayOmniFallback || requested === VEO_MODEL || !isModelRejection(e)) throw e;
    try { return await viaOmniFlash(); } catch { throw e; }
  }
}

// ---------------------------------------------------------------------------
// Frame extraction + duration probing (hidden <video> + canvas)
// ---------------------------------------------------------------------------

function seekTo(video: HTMLVideoElement, t: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => { if (settled) return; settled = true; clearTimeout(giveUp); video.removeEventListener('seeked', onSeeked); resolve(ok); };
    const onSeeked = () => setTimeout(() => finish(true), 80);
    const giveUp = setTimeout(() => finish(false), 8000);
    video.addEventListener('seeked', onSeeked);
    try { video.currentTime = t; } catch { finish(false); }
  });
}

function openVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.preload = 'auto';
    (video as any).playsInline = true;
    const guard = setTimeout(() => reject(new Error('The clip took too long to load for frame capture.')), 60000);
    video.onerror = () => { clearTimeout(guard); reject(new Error('The clip could not be decoded in this browser.')); };
    video.onloadedmetadata = () => { clearTimeout(guard); resolve(video); };
    video.src = url;
  });
}

function releaseVideo(video: HTMLVideoElement) {
  try { video.removeAttribute('src'); video.load(); } catch { /* released */ }
}

export async function probeClipDuration(url: string): Promise<number> {
  const video = await openVideo(url);
  const d = Number(video.duration);
  releaseVideo(video);
  return Number.isFinite(d) && d > 0 ? d : 0;
}

/**
 * Photograph one frame of a clip and upload it as a durable PNG for Opus
 * vision (inspection + continuity). position: seconds from start, or 'end'.
 */
export async function extractFrame(videoUrl: string, position: number | 'end', maxDim = 1280): Promise<string> {
  if (typeof document === 'undefined') throw new Error('Frame capture needs an open browser tab.');
  const video = await openVideo(videoUrl);
  try {
    const duration = Math.max(0.2, Number(video.duration) || 0.2);
    const t = position === 'end' ? Math.max(0, duration - 0.1) : Math.min(Math.max(0, position), duration - 0.05);
    let ok = await seekTo(video, t);
    if (!ok) ok = await seekTo(video, t);
    if (!ok) throw new Error('The clip did not answer the frame seek.');
    const w = Number(video.videoWidth) || 720;
    const h = Number(video.videoHeight) || 1280;
    const scale = Math.min(1, maxDim / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(2, Math.round(w * scale));
    canvas.height = Math.max(2, Math.round(h * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is unavailable.');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    let dataUrl = '';
    try { dataUrl = canvas.toDataURL('image/png'); }
    catch { throw new Error('The clip host blocked frame capture (CORS-tainted canvas).'); }
    return await uploadDataUrl(dataUrl, `ads-frame-${Date.now()}.png`);
  } finally {
    releaseVideo(video);
  }
}
