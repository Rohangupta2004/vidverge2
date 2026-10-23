/**
 * VIDEO MODEL SERVICE — the ONE adapter between the pipeline and the platform's
 * video generation proxies. No other module talks to the video API; the model
 * REGISTRY below (VIDEO_MODELS) is the single place providers/models are
 * configured, so adding or switching a model never touches components.
 *
 *   createVideo          submit ONE clip → { jobId }
 *   getGenerationStatus  poll one job    → { status, videoUrl }
 *   getVideoResult       poll getGenerationStatus to completion → clip URL
 *   uploadReference      file/dataURL/blob → durable public URL (file-storage)
 *   cancelGeneration     abandon a job locally (the proxies have no cancel;
 *                        the poll loop stops and the scene is released)
 *
 * PROVIDERS
 * - 'google'  → POST /api/veo/generate/video + GET /api/veo/status/:id.
 *   Default model: Gemini Omni 1.1 Flash (gemini-omni-1.1-flash). It supports
 *   a seed frame plus up to TEN reference images, and last-frame interpolation.
 *   It is the character/product consistency engine and output caps at 720p.
 * - 'openrouter' → the SAME /api/veo proxy with an openrouter/* model id.
 *   Seedance 2.0 Fast takes one seed. Exact id
 *   openrouter/bytedance/seedance-2.5 accepts 4–30s and either frames or up to
 *   three asset references. These kick off asynchronously: the proxy answers 200
 *   with status 'processing', an operationId and the progress message "Video
 *   generation started. Use the operationId to check status." — an accepted
 *   job to poll, never a failure.
 * - 'runway' → POST /api/generate/runway/video + GET /api/generate/runway/status/:taskId,
 *   straight from the browser: stv-scene-generate has no Runway route, and the
 *   proxy needs its own X-Workspace-DB-Token + per-submit Idempotency-Key.
 *   Runway job ids are stored with a 'runway:' prefix so polling routes
 *   correctly across a reload, exactly like the kling: prefix below. The
 *   registry lists the FULL Runway text-to-video roster from ../runwayRoster
 *   (Gen 4.5, Veo 3.1, Seedance 2.0 / Fast / Mini / 2.5, MiniMax H3 and H3
 *   Max, WAN 3.0 and 3.0 Prime, Grok Imagine Video 1.5, HappyHorse 1.0,
 *   Gemini Omni Flash, plus image-only Gen 4 Turbo).
 *   THAT module owns the id spellings and resolves the platform's own spelling
 *   from GET /api/generate/runway/capabilities, so a submit always carries the
 *   id the proxy actually accepts. A model is refused before the round trip
 *   only when the LIVE catalog was read and did not list it — never on a local
 *   guess.
 * - 'kling' → POST /api/generate/kling/text-to-video (or image-to-video when
 *   a seed frame travels, or /multi-image for a 2–4 reference set) + GET
 *   /api/generate/kling/status/:taskId. Kling durations are the strings
 *   '5' | '10'. Kling job ids are stored with a 'kling:' prefix so status
 *   polling routes to the right endpoint even across a reload (resumeFilm only
 *   has the stored operation id). Kling is a manual browser-authenticated option.
 *
 * AVAILABILITY IS NOT RECORDED HERE. This header used to carry a dated probe
 * log, and every number in it eventually went stale while still reading as
 * current truth — which is how Seedance 2.5 stayed switched off after it went
 * live. The durations and limits below are the DOCUMENTED contracts; for "is
 * this endpoint answering right now?", open the owner-only Health screen in
 * the Video Provider Lab.
 *
 * DURATIONS. Apart from Kling, every provider takes a RANGE rather than a set
 * of fixed lengths, so `supportedDurations` is only the ladder the pickers
 * show. resolveDuration() is the one place a requested length is turned into
 * a submitted one, and it clamps to the provider's real limits instead of
 * rounding onto that ladder.
 */

import { Aspect, ReferenceAsset, uploadBlob, uploadDataUrl } from '../api';
import { capabilityFor, rankReferences } from '../v2Contracts';
import { WORKSPACE_ID, callHook, getWorkspaceToken } from '../../../lib/workspace';
export { S2V_CAPABILITY_REGISTRY_VERSION, S2V_VIDEO_CAPABILITIES } from '../v2Contracts';
export {
  VERGEYE_CAPABILITY_REGISTRY_VERSION, VERGEYE_VIDEO_CAPABILITIES,
  VERGEYE_VIDEO_STYLES, routeVergeyeScene,
} from '../../../lib/vergeyeVideoProduction';
export type { VergeyeRouterMode, VergeyeRoutingDecision, VergeyeRoutingInput, VergeyeVideoStyleId } from '../../../lib/vergeyeVideoProduction';
import { poll } from '../../../lib/poll';
import { checkRunway, runwaySubmitVideo } from '../../../lib/videoEngineClient';
import { authorizeCredits, refundCredits, refundCreditsStrict } from '../../../lib/credits';
import { groupADurationLadder, groupAMinDurationS, groupAModel, type GroupAModel } from '../../../lib/videoEngines';
import {
  RUNWAY_ROSTER, RunwayRosterModel, clampRosterDuration, rosterDurations,
  rosterInputLabel, rosterModel, rosterRatio, rosterState, submitModelId,
  syncRunwayRoster,
} from '../runwayRoster';

// ---------------------------------------------------------------------------
// Central model registry — add or change models HERE and nowhere else.
// ---------------------------------------------------------------------------

export type VideoProvider = 'google' | 'openrouter' | 'kling' | 'runway';

export interface VideoModelConfig {
  /** Registry id — persisted on the film row (s2v_films.video_model). */
  id: string;
  /** Human name shown in the picker. */
  label: string;
  provider: VideoProvider;
  /** Friendly model id shown in the UI. */
  model: string;
  /** The exact model id the platform proxy accepts. */
  apiModel: string;
  /** Clip lengths the pickers OFFER (seconds), and what segmentation targets.
   * This is a ladder for the UI, not a whitelist: unless `discreteDurations`
   * is set the provider takes any whole second between `minDuration` and
   * `safeMaxDuration`, so a length missing from this list is still rendered at
   * exactly what was asked for. */
  supportedDurations: number[];
  /** Shortest clip the provider will render. Absent means "no known floor". */
  minDuration?: number;
  /** Longest duration known-safe on the proxy; longer requests fall back here
   * if the proxy rejects them. */
  safeMaxDuration: number;
  /** True ONLY when the provider's API takes a fixed set of lengths rather
   * than a range — Kling's duration field is literally '5' | '10'. Everything
   * else is a range and must never be rounded onto the ladder above. */
  discreteDurations?: boolean;
  maxReferenceImages: number;
  /** Native generated audio is supported by this exact platform route. */
  audioSupported?: boolean;
  /** The proxy rejects prompts longer than this with a 400. The /api/veo
   * proxy accepts 10,000; Runway's own API caps promptText at 1,000. */
  promptMaxChars: number;
  negativeMaxChars: number;
  /** The model has NO negativePrompt field at all, so negatives must be folded
   * into the prompt text instead (Kling 3.0 Omni). The proxy REJECTS an
   * unsupported field before billing rather than stripping it, so sending one
   * anyway fails the whole render. */
  negativeInPrompt?: boolean;
  /** Whether a request may combine a continuation seed with separate reference
   * images. Seedance 2.5 supports either frames OR 1–3 asset references, not
   * both; Omni supports the combination. */
  referencesWithSeed?: boolean;
  /** The model has a dedicated reference-image route (/multi-image) that takes
   * 2–4 references addressed as @image_1 … @image_4 in the prompt. */
  multiImageRoute?: boolean;
  /** std = 720p, pro = 1080p. Only the Kling roster exposes this. */
  qualityModes?: Array<'std' | 'pro'>;
  /** This render costs materially more than the rest of the roster, so the
   * customer is shown the estimate and confirms it BEFORE anything is
   * submitted. Nothing expensive starts on a single click. */
  requiresCostConfirm?: boolean;
  /** Rough USD per second of finished clip, for that confirmation line. */
  costPerSecondUsd?: number;
  pollIntervalMs: number;
  timeoutMs: number;
  /** True when the model cannot start from a prompt alone — every clip needs
   * a seed frame (Runway Gen 4 Turbo). */
  imageToVideoOnly?: boolean;
  /** How a character reference reaches a model that carries only ONE image.
   * 'character_ref_only' (Seedance): the character reference travels in the
   * SAME `imageData` field as a seed frame, so it is promoted into that slot
   * on a scene that has no previous frame to continue from — and travels as
   * a written appearance note on a scene that does. */
  seedFrame?: 'character_ref_only';
  /** Availability hint surfaced in the picker (undefined = fully available). */
  availabilityNote?: string;
}

/** `v2Contracts` is the one source of truth for native sound. The picker,
 * request adapter and preview badge all consume this value through the model
 * config instead of maintaining independent provider claims. */
function registryNativeAudio(modelId: string): boolean {
  return capabilityFor(modelId)?.nativeAudio === true;
}

export const VIDEO_MODEL: VideoModelConfig = {
  id: 'omni-1.1-flash',
  label: 'Gemini Omni 1.1 Flash',
  provider: 'google',
  model: 'omni-1.1-flash',
  apiModel: 'gemini-omni-1.1-flash',
  supportedDurations: [2, 3, 4, 5, 6, 7, 8],
  minDuration: 2,
  safeMaxDuration: 8,
  maxReferenceImages: 10,
  audioSupported: registryNativeAudio('gemini-omni-1.1-flash'),
  promptMaxChars: 10000,
  negativeMaxChars: 500,
  pollIntervalMs: 5000,
  timeoutMs: 8 * 60 * 1000,
};

/** Registry ids for Runway entries: legacy films stored 'runway-gen4.5' /
 * 'runway-gen4-turbo' on their rows, so those two keep their historic ids;
 * every other roster model registers as `runway-<roster id>`. */
function runwayRegistryId(catalogId: string): string {
  if (catalogId === 'gen4.5') return 'runway-gen4.5';
  if (catalogId === 'gen4_turbo') return 'runway-gen4-turbo';
  return `runway-${catalogId}`;
}

function runwayConfig(m: RunwayRosterModel): VideoModelConfig {
  const id = runwayRegistryId(m.id);
  // Runway's duration field is a RANGE, not an enum: the proxy answers
  // "duration must be an integer from 2 to 10", so every whole second inside
  // the model's live min/max is offered. The old fixed [4, 5, 6, 8, 10] list
  // silently rounded legal 7s and 9s clips down to the next entry.
  const durations = rosterDurations(m);
  // An image-only model is the only entry that carries a note at build time:
  // real availability is read live and recomputed by the pickers, never frozen
  // into this registry.
  const availabilityNote = m.inputType === 'image'
    ? `${rosterInputLabel(m)} only — it animates a continuation scene’s seed frame. An opening scene has no seed frame, so start the film on a text-capable model such as Gen 4.5.`
    : undefined;
  return {
    id,
    label: m.label,
    provider: 'runway',
    model: id,
    apiModel: m.id,
    ...(m.inputType === 'image' ? { imageToVideoOnly: true } : {}),
    supportedDurations: durations.length ? durations : [m.defaultDurationS],
    minDuration: m.minDurationS,
    safeMaxDuration: m.maxDurationS,
    maxReferenceImages: 0,
    promptMaxChars: 1000,
    negativeMaxChars: 0,
    pollIntervalMs: 5000,
    timeoutMs: 15 * 60 * 1000,
    ...(availabilityNote ? { availabilityNote } : {}),
  };
}

/** Every Runway video model this app can run, in picker order. */
export const RUNWAY_VIDEO_CONFIGS: VideoModelConfig[] = RUNWAY_ROSTER.map(runwayConfig);

export const RUNWAY_GEN_4_5: VideoModelConfig = RUNWAY_VIDEO_CONFIGS.find((m) => m.apiModel === 'gen4.5') || RUNWAY_VIDEO_CONFIGS[0];
export const RUNWAY_GEN_4_TURBO: VideoModelConfig = RUNWAY_VIDEO_CONFIGS.find((m) => m.apiModel === 'gen4_turbo') || RUNWAY_VIDEO_CONFIGS[0];

/**
 * SEEDANCE (OpenRouter, through the /api/veo proxy). Both tiers kick off
 * ASYNCHRONOUSLY: the proxy answers 200 with
 *   { success: true, status: 'processing', operationId,
 *     message: 'Video generation started. Use the operationId to check status.' }
 * That `message` is progress text, never a failure — submitViaHook below (and
 * the stv-scene-generate hook behind it) treat the operationId as an accepted
 * job and poll it. Seedance also runs longer than Omni Flash, which is why it
 * carries its own 10-minute poll budget: getVideoResult must be given this
 * config or the job times out while it is still healthily rendering.
 */
export const SEEDANCE_2_0: VideoModelConfig = {
  id: 'seedance-2.0',
  label: 'Seedance 2.0 Fast',
  provider: 'openrouter',
  model: 'seedance-2.0-fast',
  apiModel: 'openrouter/bytedance/seedance-2.0-fast',
  // Three real 10-second submissions in film #68 each measured 8.041667s.
  // Until the adapter proves a longer result, plan to the measured ceiling so
  // a 30s film becomes 8+8+8+6 instead of three nominal 10s clips totaling 24.2s.
  supportedDurations: [4, 5, 6, 7, 8],
  minDuration: 4,
  safeMaxDuration: 8,
  // ONE image, in the seed-frame field. The character reference takes that
  // slot on an opening scene (see seedFrame below and createVideo).
  maxReferenceImages: 1,
  audioSupported: registryNativeAudio('openrouter/bytedance/seedance-2.0-fast'),
  seedFrame: 'character_ref_only',
  // Seedance accepts a far longer prompt than the old 1000-character cap,
  // which was cutting prepared scene prompts off mid-sentence.
  promptMaxChars: 2500,
  negativeMaxChars: 500,
  pollIntervalMs: 5000,
  timeoutMs: 10 * 60 * 1000,
};

/**
 * SEEDANCE 2.5 — LIVE, and the premium option.
 *
 * This entry used to be switched off and excluded from VIDEO_MODELS because an
 * old probe found no 2.5 spelling in the proxy's model enum. The id it was
 * probing was wrong: the live id is `openrouter/bytedance/seedance-2.5`
 * (not `…-2.5-fast`), it is in the catalog, and it renders.
 *
 * The live platform contract accepts every integer from 4 through 30 seconds.
 * That exact 30-second route was founder-verified, so this registry must never
 * reintroduce the stale 10-second ceiling or the old speculative 39-second cap.
 */
const SEEDANCE_2_5_CAPABILITY = groupAModel('openrouter/bytedance/seedance-2.5')!;
export const SEEDANCE_2_5: VideoModelConfig = {
  id: 'seedance-2.5',
  label: SEEDANCE_2_5_CAPABILITY.name,
  provider: 'openrouter',
  model: 'seedance-2.5',
  apiModel: SEEDANCE_2_5_CAPABILITY.id,
  supportedDurations: groupADurationLadder(SEEDANCE_2_5_CAPABILITY),
  minDuration: groupAMinDurationS(SEEDANCE_2_5_CAPABILITY),
  safeMaxDuration: SEEDANCE_2_5_CAPABILITY.maxDurationS,
  // Either one first frame (+ optional last frame) OR up to three asset
  // references. The proxy rejects frames and references in the same request.
  maxReferenceImages: SEEDANCE_2_5_CAPABILITY.maxReferenceImages,
  audioSupported: registryNativeAudio(SEEDANCE_2_5_CAPABILITY.id),
  referencesWithSeed: false,
  promptMaxChars: 10000,
  // The catalog entry reports no negative-prompt support on this model.
  negativeMaxChars: 0,
  negativeInPrompt: true,
  requiresCostConfirm: true,
  costPerSecondUsd: 0.025,
  pollIntervalMs: 5000,
  timeoutMs: 15 * 60 * 1000,
};

/**
 * KLING — the live roster: kling-3.0-omni, kling-3.0, kling-2.6 and
 * kling-2.5-turbo. The retired ids (kling-v2-master and the whole v1
 * generation) are gone from this registry; the proxy answers a retired id by
 * substituting the operation default and disclosing it in `modelFallback`,
 * which is why nothing here should ever request one.
 *
 * DURATION IS THE STRING '5' OR '10', and that is the platform PROXY's
 * contract, not Kling's upstream capability. Omni upstream does 3–15s with
 * native audio and 4K; the proxy exposes none of that and REJECTS the
 * unsupported field before billing rather than ignoring it. So every entry
 * here stays at the two documented lengths and sends no audio field — a wider
 * upstream capability is not proxy support.
 */
function klingConfig(input: {
  id: string;
  label: string;
  maxReferenceImages?: number;
  multiImageRoute?: boolean;
  negativeInPrompt?: boolean;
  costPerSecondUsd?: number;
}): VideoModelConfig {
  return {
    id: input.id,
    label: input.label,
    provider: 'kling',
    model: input.id,
    apiModel: input.id,
    supportedDurations: [5, 10],
    minDuration: 5,
    discreteDurations: true,
    safeMaxDuration: 10,
    maxReferenceImages: input.maxReferenceImages ?? 0,
    audioSupported: registryNativeAudio(input.id),
    qualityModes: ['std', 'pro'],
    promptMaxChars: 2500,
    negativeMaxChars: input.negativeInPrompt ? 0 : 2500,
    ...(input.negativeInPrompt ? { negativeInPrompt: true } : {}),
    ...(input.multiImageRoute ? { multiImageRoute: true } : {}),
    ...(input.costPerSecondUsd ? { costPerSecondUsd: input.costPerSecondUsd } : {}),
    pollIntervalMs: 5000,
    timeoutMs: 10 * 60 * 1000,
  };
}

export const KLING_3_0_OMNI: VideoModelConfig = klingConfig({
  id: 'kling-3.0-omni',
  label: 'Kling 3.0 Omni',
  maxReferenceImages: 4,
  multiImageRoute: true,
  // Omni rejects a separate negativePrompt — negatives belong in the prompt.
  negativeInPrompt: true,
  costPerSecondUsd: 0.084,
});
export const KLING_3_0: VideoModelConfig = klingConfig({ id: 'kling-3.0', label: 'Kling 3.0', maxReferenceImages: 1, costPerSecondUsd: 0.084 });
export const KLING_2_6: VideoModelConfig = klingConfig({ id: 'kling-2.6', label: 'Kling 2.6', maxReferenceImages: 1, costPerSecondUsd: 0.042 });
export const KLING_2_5_TURBO: VideoModelConfig = klingConfig({ id: 'kling-2.5-turbo', label: 'Kling 2.5 Turbo', maxReferenceImages: 1, costPerSecondUsd: 0.042 });

/** The route Kling's reference-image workflow lives on. */
export const KLING_MULTI_IMAGE_PATH = '/api/generate/kling/multi-image';

/** Negatives every Omni prompt carries, since the model takes no
 * negativePrompt field of its own. */
export const KLING_OMNI_INLINE_NEGATIVES =
  'no extra fingers, no warped hands, no distorted faces, no on-screen text, no watermark, no logo overlay';

/** `@image_1 … @image_4` — how a prompt addresses the reference images on the
 * multi-image route. Kling's own reference ids are image_1, image_2, … */
export function klingImageTokens(count: number): string[] {
  const n = Math.max(0, Math.min(4, Math.round(Number(count) || 0)));
  return Array.from({ length: n }, (_, i) => `@image_${i + 1}`);
}

/**
 * The exact request Kling's reference-image route wants.
 *
 * Opening scenes on Kling 3.0 Omni use this request when they have 2–4 valid
 * references and no continuation frame. Continuation scenes deliberately stay
 * on image-to-video because /multi-image accepts references only and cannot
 * also carry the previous shot's last frame.
 *
 * Returns null when there is no valid 2–4 reference set to send.
 */
export function buildKlingMultiImageRequest(input: {
  prompt: string;
  referenceUrls: string[];
  durationS: number;
  mode?: 'std' | 'pro';
  config?: VideoModelConfig;
}): { path: string; body: Record<string, unknown> } | null {
  const cfg = input.config || KLING_3_0_OMNI;
  const images = (input.referenceUrls || [])
    .map((url) => String(url || '').trim())
    .filter((url) => /^https:\/\//.test(url))
    .slice(0, 4);
  if (images.length < 2) return null;
  // EXACTLY the documented field set. The route takes `images`, `prompt`,
  // `model`, `mode` and `duration` — and the proxy rejects an unsupported
  // field before billing rather than dropping it, so nothing extra (an aspect
  // ratio, a negative prompt, a start frame) may ride along here.
  return {
    path: KLING_MULTI_IMAGE_PATH,
    body: {
      model: cfg.apiModel,
      images,
      prompt: capText(klingReferencePrompt(input.prompt, images.length), cfg.promptMaxChars),
      mode: input.mode || 'std',
      duration: String(resolveDuration(input.durationS, cfg)),
    },
  };
}

/** Name the references in the prompt so the model knows which image is which. */
export function klingReferencePrompt(prompt: string, referenceCount: number): string {
  const tokens = klingImageTokens(referenceCount);
  if (!tokens.length) return String(prompt || '').trim();
  return [
    String(prompt || '').trim(),
    `Reference images: ${tokens.join(', ')}. Keep every referenced subject identical to its image — same face, same wardrobe, same product.`,
  ].filter(Boolean).join('\n\n');
}

/** Fold negatives into the prompt for a model with no negativePrompt field. */
function withInlineNegatives(prompt: string, negative?: string, baseline?: string): string {
  const parts = [String(negative || '').trim(), String(baseline || '').trim()].filter(Boolean);
  if (!parts.length) return String(prompt || '').trim();
  return `${String(prompt || '').trim()}\n\nAvoid: ${parts.join(', ')}.`;
}

/** USD estimate for one clip on this model, or null when it is not priced here. */
export function estimateClipCostUsd(config: VideoModelConfig, seconds: number): number | null {
  const rate = Number(config.costPerSecondUsd);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return Math.round(rate * Math.max(1, Math.round(Number(seconds) || 0)) * 100) / 100;
}

/**
 * The sentence a confirmation dialog shows before an expensive render. Returns
 * null for a model that needs no confirmation, so a caller can simply branch
 * on it rather than knowing which models are premium.
 */
export function costConfirmMessage(config: VideoModelConfig, seconds: number, clips = 1): string | null {
  if (!config.requiresCostConfirm) return null;
  const perClip = estimateClipCostUsd(config, seconds);
  const shots = Math.max(1, Math.round(Number(clips) || 1));
  const total = perClip === null ? null : Math.round(perClip * shots * 100) / 100;
  const money = total === null
    ? 'It is the most expensive engine on the roster'
    : `That is about $${total.toFixed(2)}${shots > 1 ? ` for ${shots} clips` : ''}`;
  return `${config.label} is the premium long-form engine (${config.minDuration}–${config.safeMaxDuration}s per clip). `
    + `${money} at ${Math.round(seconds)}s per clip. Render it?`;
}

const openRouterVeo = (id: string, label: string, duration = 8): VideoModelConfig => ({
  id,
  label,
  provider: 'openrouter',
  model: id,
  apiModel: id,
  supportedDurations: Array.from({ length: Math.max(1, duration - 1) }, (_, i) => i + 2),
  minDuration: 2,
  safeMaxDuration: duration,
  maxReferenceImages: 0,
  promptMaxChars: 10000,
  negativeMaxChars: 500,
  pollIntervalMs: 5000,
  timeoutMs: 10 * 60 * 1000,
});

/** Real Veo 3.1 exists only on these OpenRouter ids. Each accepts one seed
 * image and no referenceImages. None is allowed to claim 4K. */
export const VEO_31 = openRouterVeo('openrouter/google/veo-3.1', 'Veo 3.1');
export const VEO_31_FAST = openRouterVeo('openrouter/google/veo-3.1-fast', 'Veo 3.1 Fast');
export const VEO_31_LITE = openRouterVeo('openrouter/google/veo-3.1-lite', 'Veo 3.1 Lite', 6);

/** Selectable models, ordered by the guided studio's recommendations.
 * Retired preview aliases are excluded. */
export const VIDEO_MODELS: VideoModelConfig[] = [
  SEEDANCE_2_5, KLING_3_0_OMNI, KLING_3_0, SEEDANCE_2_0,
  KLING_2_6, KLING_2_5_TURBO, VIDEO_MODEL, VEO_31, VEO_31_FAST, VEO_31_LITE,
  ...RUNWAY_VIDEO_CONFIGS,
];

/** The engine a NEW unattended film starts on. Gemini Omni is currently the
 * only proxy the scheduled server runner can submit without persisting a
 * visitor credential. Seedance 2.5 remains selectable with its verified 4–30s
 * contract, but Start explains the platform auth limitation instead of making
 * a false closed-browser promise. */
export const DEFAULT_FILM_MODEL: VideoModelConfig = VIDEO_MODEL;

/**
 * Where a film goes when its chosen engine cannot run the shot — one step at a
 * time, best-quality-first, ending on the engine that has always worked.
 *
 * Each rung is a genuinely different model, so a retry has a real chance of a
 * different answer instead of spending twice for the same refusal.
 */
export const MODEL_FALLBACK_CHAIN: VideoModelConfig[] = [
  // Required policy: Kling Omni fails → Gemini Omni Flash, and then STOP.
  // Seedance 2.5 is never entered without explicit creator consent.
  KLING_3_0_OMNI, VIDEO_MODEL,
];

/** The next engine to try after `config`, or null at the end of the chain. */
export function fallbackVideoModel(config: VideoModelConfig | null | undefined): VideoModelConfig | null {
  const id = String(config?.id || '');
  const index = MODEL_FALLBACK_CHAIN.findIndex((m) => m.id === id);
  if (index < 0) return MODEL_FALLBACK_CHAIN[0] || null;
  return MODEL_FALLBACK_CHAIN[index + 1] || null;
}

/** A config for a Group A catalog model that has its own duration floor and is
 * not in the registry above — built from the live catalog
 * entry so the range the picker shows is the range a clip is requested at. It
 * rides the same single-seed-image OpenRouter path as Seedance 2.0. */
function catalogGroupAConfig(model: GroupAModel): VideoModelConfig {
  return {
    id: model.id,
    label: model.name,
    provider: 'openrouter',
    model: model.id,
    apiModel: model.id,
    supportedDurations: groupADurationLadder(model),
    minDuration: groupAMinDurationS(model),
    safeMaxDuration: model.maxDurationS,
    maxReferenceImages: 1,
    seedFrame: 'character_ref_only',
    promptMaxChars: 10000,
    negativeMaxChars: 500,
    pollIntervalMs: 5000,
    timeoutMs: 15 * 60 * 1000,
  };
}

/** Resolve a stored model id (s2v_films.video_model) onto its config.
 * Unknown/null ids fall back to the default so old films keep working. */
export function resolveVideoModel(id?: string | null): VideoModelConfig {
  const key = String(id || '');
  const byId = VIDEO_MODELS.find((m) => m.id === key);
  if (byId) return byId;
  const byApi = VIDEO_MODELS.find((m) => m.apiModel === key);
  if (byApi) return { ...byApi, apiModel: key };
  const catalog = groupAModel(key);
  if (catalog && catalog.minDurationS !== undefined) return catalogGroupAConfig(catalog);
  return VIDEO_MODEL;
}

/** Snap a duration onto a length the model definitely lists, rounding UP so a
 * clip is never silently shortened — only the longest listed length caps it. */
export function snapDuration(seconds: number, config: VideoModelConfig = VIDEO_MODEL): number {
  const listed = [...config.supportedDurations].sort((a, b) => a - b);
  if (!listed.length) return Math.max(1, Math.round(Number(seconds)) || 1);
  const wanted = Math.round(Number(seconds)) || listed[0];
  const longer = listed.find((d) => d >= wanted);
  return longer === undefined ? listed[listed.length - 1] : longer;
}

/**
 * THE duration a clip is actually requested at — the single place the length
 * the customer (or their pasted script) asked for becomes the number a
 * provider is sent.
 *
 * It shortens a clip ONLY when the provider genuinely cannot render it longer:
 *   · Kling's API takes the literal strings '5' and '10', so it still snaps —
 *     upward — onto that set.
 *   · Every other provider takes a RANGE. Runway answers "duration must be an
 *     integer from 2 to 10", and the /api/veo proxy accepts any integer 4–25
 *     and normalizes it to the chosen model's nearest real length server-side.
 *     For those the exact ask passes straight through, bounded only by the
 *     model's own minimum and maximum.
 *
 * Nothing else in this app may re-round a duration: a "| 7 sec" scene renders
 * at 7 seconds, not at the 6 the old nearest-value ladder produced.
 */
export function resolveDuration(seconds: number, config: VideoModelConfig = VIDEO_MODEL): number {
  const min = Math.max(1, Number(config.minDuration) || 1);
  const max = Math.max(min, Number(config.safeMaxDuration) || min);
  const asked = Math.round(Number(seconds));
  const wanted = Number.isFinite(asked) && asked > 0 ? asked : (config.supportedDurations[0] || min);
  const bounded = Math.max(min, Math.min(max, wanted));
  return config.discreteDurations ? snapDuration(bounded, config) : bounded;
}

/** Cap text at the proxy's hard limit, cutting on a sentence/word boundary so
 * a truncated prompt still reads complete. */
export function capText(text: string, max: number): string {
  const t = String(text || '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'));
  if (sentence > max * 0.6) return cut.slice(0, sentence + 1).trim();
  const space = cut.lastIndexOf(' ');
  return (space > 0 ? cut.slice(0, space) : cut).trim();
}

const SEEDANCE_2_5_RATIOS = new Set(['16:9', '4:3', '1:1', '3:4', '9:16', '21:9']);
const SEEDANCE_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function portableSeedanceImage(value: unknown): string {
  const image = String(value || '').trim();
  if (!image || /^blob:|^file:|^http:\/\//i.test(image)) return '';
  if (/^\/api\/private-files\//i.test(image) || /\/private-uploads\//i.test(image) || /^https:\/\/(?:localhost|127\.0\.0\.1)(?:[:/]|$)/i.test(image)) return '';
  if (/^https:\/\//i.test(image) || /^data:image\/(?:png|jpeg|webp);base64,/i.test(image)) return image;
  return /^[A-Za-z0-9+/=\s]{256,}$/.test(image) ? image.replace(/\s+/g, '') : '';
}

function seedanceMime(value: unknown, imageData: string): string | undefined {
  const explicit = String(value || '').toLowerCase();
  if (SEEDANCE_IMAGE_MIMES.has(explicit)) return explicit;
  const dataMime = /^data:(image\/(?:png|jpeg|webp));base64,/i.exec(imageData)?.[1]?.toLowerCase();
  if (dataMime && SEEDANCE_IMAGE_MIMES.has(dataMime)) return dataMime;
  const path = imageData.split(/[?#]/)[0].toLowerCase();
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.webp')) return 'image/webp';
  if (path.endsWith('.png')) return 'image/png';
  return undefined;
}

/** Final model-specific allowlist before the request crosses the billing gate. */
export function sanitizeVideoRequestBody(config: VideoModelConfig, input: Record<string, unknown>): Record<string, unknown> {
  if (config.id !== SEEDANCE_2_5.id && config.apiModel !== SEEDANCE_2_5.apiModel) {
    return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== ''));
  }
  const allowed = new Set(['model', 'prompt', 'aspectRatio', 'duration', 'resolution', 'generateAudio', 'enhancePrompt', 'imageData', 'lastFrameImage', 'referenceImages']);
  const body = Object.fromEntries(Object.entries(input).filter(([key, value]) => allowed.has(key) && value !== undefined && value !== '')) as Record<string, unknown>;
  body.model = SEEDANCE_2_5.apiModel;
  body.prompt = capText(String(body.prompt || ''), SEEDANCE_2_5.promptMaxChars);
  body.duration = Math.max(4, Math.min(30, Math.round(Number(body.duration) || 8)));
  body.aspectRatio = SEEDANCE_2_5_RATIOS.has(String(body.aspectRatio)) ? String(body.aspectRatio) : '16:9';
  body.resolution = body.resolution === '480p' ? '480p' : '720p';
  body.generateAudio = body.generateAudio !== false;

  const refs = (Array.isArray(body.referenceImages) ? body.referenceImages : []).flatMap((entry: any) => {
    const imageData = portableSeedanceImage(entry?.imageData);
    if (!imageData) return [];
    const mimeType = seedanceMime(entry?.mimeType, imageData);
    return [{ imageData, ...(mimeType ? { mimeType } : {}), referenceType: 'asset' }];
  }).slice(0, 3);
  const firstFrame = portableSeedanceImage(body.imageData);
  const lastData = portableSeedanceImage((body.lastFrameImage as any)?.imageData);
  if (firstFrame) {
    // A continuity frame is mandatory; optional asset references must never
    // displace it when an upstream caller accidentally supplies both routes.
    delete body.referenceImages;
    body.imageData = firstFrame;
    if (lastData) {
      const mimeType = seedanceMime((body.lastFrameImage as any)?.mimeType, lastData);
      body.lastFrameImage = { imageData: lastData, ...(mimeType ? { mimeType } : {}) };
    } else delete body.lastFrameImage;
  } else if (refs.length) {
    body.referenceImages = refs;
    delete body.imageData;
    delete body.lastFrameImage;
  } else {
    delete body.referenceImages;
    delete body.imageData;
    delete body.lastFrameImage;
  }
  return body;
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export interface CreateVideoParams {
  prompt: string;
  negative?: string;
  aspect: Aspect;
  durationS: number;
  /** first_frame → seed image (continuation); reference → reference image. */
  referenceAssets?: ReferenceAsset[] | null;
  model?: VideoModelConfig;
  /** Stable scene-row key reused across retries so one clip is never billed twice. */
  creditKey?: string;
  /** Film-level Audio choice. False forbids generated audio on every supporting model. */
  generateAudio?: boolean;
  /** Called after the exact provider body is built and before it is sent. */
  onRequestBuilt?: (evidence: VideoRequestEvidence) => void | Promise<void>;
}

export interface VideoRequestEvidence {
  built_at: string;
  model: string;
  frame_chain: {
    source_scene_id?: number;
    source_scene_index?: number;
    method?: string;
    at_second?: number;
    url?: string;
    status: 'first_scene' | 'sent' | 'continued_without';
  };
  references_used: ReferenceAsset[];
  dropped: Array<ReferenceAsset & { dropReason: string }>;
}

export interface VideoJob {
  jobId: string;
  model: string;
  excludedOptionalReferences?: ReferenceAsset[];
  requestEvidence: VideoRequestEvidence;
  warning?: string;
}

export interface VideoJobStatus {
  status: 'processing' | 'completed' | 'failed';
  videoUrl?: string;
  progress?: number;
  error?: string;
}

const cancelled = new Set<string>();

/**
 * AUTHENTICATED GENERATION: every submit and status check goes through the
 * stv-scene-generate server function while this browser tab is open. callHook
 * first authorizes the stable scene key through vv-credits; the function then
 * verifies that email-owned ledger receipt and forwards the visitor token only
 * to Kling/Seedance. Those providers cannot run from closed-tab Start because
 * server functions have no
 * workspace-level service credential. Gemini Omni keeps its unattended path.
 */
async function callGenerateHook(payload: Record<string, unknown>): Promise<any> {
  try {
    return await callHook('stv-scene-generate', payload);
  } catch (e: any) {
    throw new Error(`Could not reach the video service: ${String(e?.message || e)}`);
  }
}

function providerMessage(data: any): string {
  const value = data?.errorMessage || data?.error?.message || data?.error || data?.message || data?.code || '';
  const headline = typeof value === 'string'
    ? value.trim()
    : value && typeof value === 'object'
      ? String(value.message || value.error || value.code || '').trim()
      : '';
  const details = data?.details || data?.error?.details || data?.data?.details || data?.issues;
  const detailText = Array.isArray(details)
    ? details.map((item: any) => {
      const path = Array.isArray(item?.path) ? item.path.join('.') : String(item?.path || 'request');
      return `${path}: ${String(item?.message || item?.error || item?.code || 'invalid value')}`;
    }).join(' | ')
    : details && typeof details === 'object'
      ? (() => { try { return JSON.stringify(details); } catch { return String(details); } })()
      : String(details || '').trim();
  return [headline, detailText].filter(Boolean).join(' — ');
}

function classifySubmitError(status: number, data: any): string {
  // Preserve a stable code and the raw provider reason on the scene row. The
  // board renders the first sentence for customers and keeps this suffix only
  // inside its Technical details disclosure.
  const code = String(data?.code || data?.error?.code || data?.data?.code || '').trim();
  const raw = providerMessage(data) || (() => { try { return JSON.stringify(data || {}); } catch { return ''; } })();
  const technical = ` Technical details: code=${code || 'provider_error'}; http=${status || 'unknown'}; raw=${String(raw || 'No provider detail returned.').slice(0, 1200)}`;
  const message = (publicMessage: string) => `${publicMessage}${technical}`;
  if (code === 'cast_approval_required') return message('Approve every retained character sheet, or confirm that no cast is needed, before Start.');
  if (code === 'workspace_service_credential_unavailable') return message('This model needs your current signed-in workspace session. Keep this tab open and retry this scene; closed-tab Start cannot authenticate it.');
  if (status === 401 || status === 403 || /billing_http_(?:401|403)|no_credentials|workspace session|unauth|credential|token/i.test(`${code} ${raw}`)) return message('Sign-in session expired — refresh and retry. No render was submitted.');
  if (code === 'insufficient_credits' || /\binsufficient_credits\b/i.test(raw)) return message('You do not have enough Vidverge credits for this scene. Add credits, then retry; no paid render was started.');
  if (/^billing[_-]/i.test(code)) return message('Vidverge credit authorization could not be confirmed, so no render was submitted. Retry after refreshing your signed-in session.');
  if (status === 402 || /workspace wallet|wallet balance|provider wallet/i.test(raw)) return message('The studio provider wallet needs funding before this render can start. The scene credit authorization was refunded.');
  if (status === 429 || /rate.?limit|quota/i.test(raw)) return message('The video provider is rate-limited. Wait briefly, then retry this scene or switch models.');
  if (/blocked|safety|likeness|moderation/i.test(raw)) return message('The provider blocked this scene on safety or likeness checks. Regenerate the prompt or adjust its references before retrying.');
  if (status === 400 || /unsupported field|invalid request|prompt.*too long/i.test(raw)) return message('The provider rejected these scene settings before rendering. Review the prompt, duration, and references, then retry.');
  if (/not configured/i.test(raw)) return message('This model is not available in this workspace. Choose another model and retry this scene.');
  if ([500, 502, 503, 504].includes(status) || /outage|service unavailable|upstream/i.test(raw)) return message('The video provider is temporarily unavailable. Retry shortly or switch models.');
  return message('The video provider rejected this scene. Review Technical details before another paid attempt.');
}

/** Submit one generation through the server hook. The hook applies the
 * duration fallback and rejects placeholder failure ids itself. */
async function submitViaHook(provider: VideoProvider, body: Record<string, unknown>, safeMaxDuration: number, creditKey?: string): Promise<{ ok: true; jobId: string; warning?: string; referenceFallback?: boolean } | { ok: false; status: number; data: any }> {
  const key = String(creditKey || '').trim();
  const seconds = Math.max(1, Math.round(Number(body.duration) || 0));
  if (!key) throw new Error('A stable scene credit key is required before video submission.');
  try {
    await authorizeCredits({ seconds, entryKey: key, source: 'script-to-video', note: `${provider} scene clip` });
  } catch (error: any) {
    if (error?.code === 'insufficient_credits') throw new Error(`insufficient_credits: ${String(error?.message || error)}`);
    throw error;
  }

  let out: any;
  try {
    out = await callGenerateHook({ op: 'submit', provider, body, safeMaxDuration, creditKey: key });
  } catch (error) {
    await refundCreditsStrict(key, 'The Script-to-Video gateway did not accept the scene submit');
    throw error;
  }
  // success:true + operationId (status 'processing') is an accepted async job:
  // the caller polls it. Only an explicit failure is surfaced as an error.
  const acceptedStatus = out?.status === 'submitted' || out?.status === 'processing';
  if (out?.success !== false && acceptedStatus && typeof out.operationId === 'string' && out.operationId) {
    return {
      ok: true,
      jobId: String(out.operationId),
      warning: out?.warning ? String(out.warning) : undefined,
      referenceFallback: out?.referenceFallback === true,
    };
  }
  await refundCreditsStrict(key, 'The provider rejected the scene before returning a job id');
  const detail = out?.data && typeof out.data === 'object'
    ? { ...out, ...out.data }
    : { ...out, data: out?.data || null };
  return { ok: false, status: Number(out?.httpStatus) || 0, data: detail };
}

export const VideoModelService = {
  config: VIDEO_MODEL,
  models: VIDEO_MODELS,

  /** Submit ONE clip generation. Reference priority is decided upstream by the
   * director — this method only transports what it is given. */
  async createVideo(params: CreateVideoParams): Promise<VideoJob> {
    const cfg = params.model || VIDEO_MODEL;
    // The length the caller asked for, bounded only by what this provider can
    // actually render — never rounded down onto a UI ladder.
    const duration = resolveDuration(params.durationS, cfg);
    const assets = (params.referenceAssets || []).filter((a) => a && /^https:\/\//.test(String(a.url || '')) && !a.storyboardOnly && a.type !== 'storyboard');
    const seed = assets.find((a) => a.role === 'first_frame') || null;
    // Only Gemini Omni can combine the mandatory continuity frame with asset
    // references. Every other connected route reserves its image capacity for
    // the continuity frame on scene N>=2; identity remains in prompt text.
    const combinesSeedAndReferences = cfg.id === VIDEO_MODEL.id;
    const referenceBudget = Math.max(0, seed ? (combinesSeedAndReferences ? cfg.maxReferenceImages - 1 : 0) : cfg.maxReferenceImages);
    const ranked = rankReferences(assets.filter((a) => a.role === 'reference'), referenceBudget);
    const refs = ranked.included;
    const routeImageLimit = seed && !combinesSeedAndReferences ? 1 : cfg.maxReferenceImages;
    const capDropped = [...ranked.criticalOverflow, ...ranked.excludedOptional]
      .sort((a, b) => Number(a.priority || 0) - Number(b.priority || 0))
      .map((asset) => ({
      ...asset,
      dropReason: `${cfg.label} accepts ${routeImageLimit} image input${routeImageLimit === 1 ? '' : 's'} on this route; continuity and higher-priority on-screen identities were kept first.`,
    }));
    const buildEvidence = (used: ReferenceAsset[]): VideoRequestEvidence => ({
      built_at: new Date().toISOString(),
      model: cfg.apiModel,
      frame_chain: seed?.type === 'continuity-frame'
        ? { source_scene_id: seed.sourceSceneId, source_scene_index: seed.sourceSceneIndex, method: seed.method, at_second: seed.atSecond, url: seed.url, status: 'sent' }
        : { status: 'first_scene' },
      references_used: used,
      dropped: capDropped,
    });
    let lastEvidence: VideoRequestEvidence | null = null;
    const recordEvidence = async (used: ReferenceAsset[]): Promise<VideoRequestEvidence> => {
      const evidence = buildEvidence(used);
      lastEvidence = evidence;
      await params.onRequestBuilt?.(evidence);
      return evidence;
    };
    const completedJob = (jobId: string, used: ReferenceAsset[], warning?: string): VideoJob => ({
      jobId,
      model: cfg.model,
      excludedOptionalReferences: capDropped,
      requestEvidence: lastEvidence || buildEvidence(used),
      ...(warning ? { warning } : {}),
    });
    const recordReferenceFallback = async (removed: ReferenceAsset[]): Promise<void> => {
      const evidence = buildEvidence([]);
      evidence.dropped = [
        ...evidence.dropped,
        ...removed.map((asset) => ({ ...asset, dropReason: 'The provider rejected the reference-image request before rendering, so the one safe retry was submitted without image guidance.' })),
      ];
      lastEvidence = evidence;
      await params.onRequestBuilt?.(evidence);
    };

    if (cfg.provider === 'runway') {
      // Availability is live: the roster is refreshed from
      // GET /api/generate/runway/capabilities (cached, never throws). A model
      // is refused before the round trip ONLY when that read succeeded and did
      // not list it — an unreadable catalog lets the submit through so the
      // proxy answers for itself instead of a stale local guess blocking it.
      await syncRunwayRoster();
      const live = rosterModel(cfg.apiModel);
      if (live && !live.available && rosterState() === 'live') {
        throw new Error(live.unavailableReason || `${cfg.label} is not enabled on the Audos Runway proxy right now — pick another model for this film.`);
      }
      const seedUrl = String(seed?.url || '');
      const imageOnly = live ? live.inputType === 'image' : Boolean(cfg.imageToVideoOnly);
      if (imageOnly && !seedUrl) {
        throw new Error(`${cfg.label} only animates an existing frame, and this scene has none. Render the opening scene on a text-capable model (Runway Gen 4.5 or Omni Flash) — image-to-video models can carry the continuations.`);
      }
      const runwayBody: Record<string, unknown> = {
        // The platform's own spelling of the id whenever the live catalog
        // supplied one — the canonical roster id otherwise.
        model: live ? submitModelId(live) : cfg.apiModel,
        promptText: capText(params.prompt, cfg.promptMaxChars),
        ratio: rosterRatio(params.aspect, live, Boolean(seedUrl)),
        // The live catalog's own min/max has the last word over the
        // build-time registry copy, but it clamps — it never snaps.
        duration: clampRosterDuration(duration, live),
      };
      if (seedUrl) {
        runwayBody.mode = 'image-to-video';
        // promptImage is a bounded HTTPS string here, not a { uri } object —
        // that shape belongs to the recipe media fields.
        runwayBody.promptImage = seedUrl;
      }
      try {
        await recordEvidence(seed ? [seed] : []);
        const kickoff = await runwaySubmitVideo(runwayBody, { seconds: duration, creditKey: params.creditKey });
        return completedJob(`runway:${kickoff.taskId}`, seed ? [seed] : []);
      } catch (e: any) {
        throw new Error(classifySubmitError(Number(e?.status) || 0, { error: String(e?.message || e) }));
      }
    }

    if (cfg.provider === 'kling') {
      // Kling wants durations as the strings '5' | '10'; a seed frame routes
      // the hook to the image-to-video endpoint.
      //
      // THE START FRAME IS A CONTINUATION. A scene that continues from the
      // previous shot sends that shot's last frame as imageData, which is what
      // makes two cuts read as one take. Kling cannot combine that frame with
      // asset references on this route, so scene-specific identity descriptions
      // remain in the prompt. On scene 1 only, a character sheet may occupy the
      // first-frame slot, or Omni may use its dedicated 2–4 reference route.
      const refUrls = refs.map((r) => String(r.url));
      // Omni's dedicated route is only for an opening scene: a continuation
      // must preserve the previous shot's last frame on image-to-video.
      if (cfg.multiImageRoute && !seed && refUrls.length >= 2) {
        let multiPrompt = String(params.prompt || '');
        if (cfg.negativeInPrompt) {
          multiPrompt = withInlineNegatives(multiPrompt, params.negative, KLING_OMNI_INLINE_NEGATIVES);
        }
        const multiImage = buildKlingMultiImageRequest({
          prompt: multiPrompt,
          referenceUrls: refUrls,
          durationS: duration,
          mode: 'std',
          config: cfg,
        });
        if (multiImage) {
          await recordEvidence(refs);
          const attempt = await submitViaHook('kling', multiImage.body, cfg.safeMaxDuration, params.creditKey);
          if (!attempt.ok) throw new Error(classifySubmitError(attempt.status, attempt.data));
          return completedJob(attempt.jobId, refs);
        }
      }
      const startFrame = String(seed?.url || '') || (refUrls.length ? refUrls[0] : '');
      const startFrameAsset = seed || (refs[0] ? { ...refs[0], role: 'first_frame' as const } : null);
      const described = seed ? refUrls.length : Math.max(0, refUrls.length - 1);
      let prompt = cfg.multiImageRoute && described >= 1
        ? klingReferencePrompt(params.prompt, described)
        : String(params.prompt || '');
      // Omni has no negativePrompt field — the proxy rejects it before billing
      // — so its negatives are folded into the prompt instead.
      if (cfg.negativeInPrompt) {
        prompt = withInlineNegatives(prompt, params.negative, KLING_OMNI_INLINE_NEGATIVES);
      }
      const klingBody: Record<string, unknown> = {
        model: cfg.apiModel,
        prompt: capText(prompt, cfg.promptMaxChars),
        mode: 'std',
        duration: String(duration),
        aspectRatio: params.aspect,
      };
      if (params.negative && !cfg.negativeInPrompt) {
        klingBody.negativePrompt = capText(params.negative, cfg.negativeMaxChars);
      }
      if (startFrame) {
        // Kling image-to-video derives shape from the image and its documented
        // body does not accept aspectRatio. Sending it causes a 400 before
        // billing; only text-to-video carries the ratio field.
        klingBody.imageData = startFrame;
        delete klingBody.aspectRatio;
      }
      await recordEvidence(startFrameAsset ? [startFrameAsset] : []);
      const attempt = await submitViaHook('kling', klingBody, cfg.safeMaxDuration, params.creditKey);
      if (!attempt.ok) throw new Error(classifySubmitError(attempt.status, attempt.data));
      return completedJob(attempt.jobId, startFrameAsset ? [startFrameAsset] : []);
    }

    const body: Record<string, unknown> = {
      model: cfg.apiModel,
      prompt: capText(params.prompt, cfg.promptMaxChars),
      aspectRatio: params.aspect,
      duration,
      // Blocks only genuinely high-confidence violations — the default level
      // false-positives on seeded continuity frames.
      safetyFilterLevel: 'block_only_high',
    };
    // The saved film-level Audio choice reaches every supporting model call.
    // Seedance 2.5 and Gemini Omni both accept generateAudio; unsupported
    // routes never receive the field (Kling rejects it before billing).
    if (cfg.audioSupported) body.generateAudio = params.generateAudio !== false;
    if (params.negative && cfg.negativeInPrompt) {
      // No negativePrompt field on this model — fold it into the prompt rather
      // than sending a field the proxy rejects before billing.
      body.prompt = capText(withInlineNegatives(String(body.prompt || ''), params.negative), cfg.promptMaxChars);
    } else if (params.negative) {
      body.negativePrompt = capText(params.negative, cfg.negativeMaxChars);
    }
    if (seed) body.imageData = seed.url;
    else if (cfg.provider === 'openrouter' && refs[0] && cfg.id !== SEEDANCE_2_5.id) {
      // Seedance 2.0 Fast takes one seed image. Seedance 2.5 is different: an
      // opening scene can carry up to three asset references (below).
      body.imageData = refs[0].url;
    }
    if (refs.length && cfg.id === SEEDANCE_2_5.id && !seed) {
      body.referenceImages = refs.slice(0, 3).map((r) => ({ imageData: r.url, referenceType: 'asset' }));
      body.generateAudio = params.generateAudio !== false;
      body.resolution = '720p';
    } else if (refs.length && cfg.provider !== 'openrouter' && (cfg.referencesWithSeed !== false || !seed)) {
      body.referenceImages = refs.map((r) => ({ imageData: r.url, referenceType: 'asset' }));
    }

    const sanitizedBody = sanitizeVideoRequestBody(cfg, body);
    const usedInputs: ReferenceAsset[] = [];
    if (sanitizedBody.imageData && seed) usedInputs.push(seed);
    if (sanitizedBody.referenceImages) usedInputs.push(...refs.slice(0, Array.isArray(sanitizedBody.referenceImages) ? sanitizedBody.referenceImages.length : 0));
    else if (!seed && sanitizedBody.imageData && refs[0]) usedInputs.push({ ...refs[0], role: 'first_frame' });
    await recordEvidence(usedInputs);
    // The hook retries once at safeMaxDuration when a long clip is rejected,
    // then once without image guidance when a 400 names reference inputs.
    const attempt = await submitViaHook(cfg.provider, sanitizedBody, cfg.safeMaxDuration, params.creditKey);
    if (!attempt.ok) throw new Error(classifySubmitError(attempt.status, attempt.data));
    if (attempt.referenceFallback) await recordReferenceFallback(usedInputs);
    return completedJob(attempt.jobId, attempt.referenceFallback ? [] : usedInputs, attempt.warning);
  },

  /** One status check for a running job, answered by the server hook. Kling
   * jobs carry a 'kling:' prefix on their stored id, so polling routes
   * correctly even after a reload (the hook reads the prefix). */
  async getGenerationStatus(jobId: string, opts: { creditKey?: string; model?: VideoModelConfig } = {}): Promise<VideoJobStatus> {
    if (jobId.indexOf('runway:') === 0) {
      try {
        const result = await checkRunway(jobId.slice('runway:'.length));
        if (result.status === 'succeeded' && result.mediaUrls.length) {
          return { status: 'completed', videoUrl: result.mediaUrls[0], progress: 100 };
        }
        if (result.status === 'failed' || result.status === 'cancelled') {
          const reason = String(result.raw?.error?.message || result.raw?.error || 'no successful output');
          if (opts.creditKey) void refundCredits(opts.creditKey, `Runway ended ${result.status}`);
          return { status: 'failed', error: `Runway ended this clip ${result.status}: ${reason}. The credits were refunded automatically.` };
        }
        // 'uncertain' and 'persisting' keep polling on purpose and are NEVER
        // resubmitted, so neither counts as an error here.
        return { status: 'processing' };
      } catch (e: any) {
        return { status: 'processing', error: String(e?.message || e) };
      }
    }
    let out: any;
    try {
      out = await callGenerateHook({ op: 'status', operationId: jobId, creditKey: opts.creditKey });
    } catch (e: any) {
      return { status: 'processing', error: String(e?.message || e) };
    }
    const status = String(out?.status || '').toLowerCase();
    if (status === 'completed' && out?.videoUrl) return { status: 'completed', videoUrl: String(out.videoUrl), progress: 100 };
    if (status === 'failed') {
      if (opts.creditKey) await refundCreditsStrict(opts.creditKey, 'The render failed at the provider');
      return { status: 'failed', error: classifySubmitError(Number(out?.httpStatus) || 0, out) };
    }
    // Anything else is still running. 'processing' with a progress message
    // such as "Use the operationId to check status" is the normal Seedance /
    // OpenRouter kickoff answer, so it must never reach the board as an error.
    return { status: 'processing', progress: Number(out?.progress) || undefined, error: out?.error ? String(out.error) : undefined };
  },

  /** Poll a job to completion; resolves with the clip URL or throws with the
   * provider's reason. Times out so a dead job never hangs a scene forever. */
  async getVideoResult(jobId: string, opts: { onProgress?: (p: number) => void; timeoutMs?: number; creditKey?: string; model?: VideoModelConfig } = {}): Promise<string> {
    // The FILM's own model decides how patiently its job is polled. Seedance
    // kicks off asynchronously and routinely needs longer than Omni Flash's
    // eight minutes — polling it on another model's budget is what turned a
    // healthy in-progress render into a "took too long" failure.
    const cfg = opts.model || (jobId.indexOf('runway:') === 0 ? RUNWAY_GEN_4_5 : VIDEO_MODEL);
    const timeout = opts.timeoutMs || cfg.timeoutMs;
    try {
      const result = await poll(async () => {
        if (cancelled.has(jobId)) { cancelled.delete(jobId); throw new Error('This generation was cancelled.'); }
        const status = await this.getGenerationStatus(jobId, { creditKey: opts.creditKey, model: cfg });
        if (status.status === 'processing' && status.error) throw new Error(`The video service stopped answering: ${status.error}`);
        return status;
      }, {
        interval: cfg.pollIntervalMs,
        timeout,
        tolerateErrors: 6,
        until: (status) => status.status === 'completed' || status.status === 'failed',
        onTick: (status) => {
          if (opts.onProgress && typeof status.progress === 'number') opts.onProgress(status.progress);
        },
      });
      if (result.status === 'failed' || !result.videoUrl) throw new Error(result.error || 'The render failed.');
      return result.videoUrl;
    } catch (e: any) {
      if (e?.name === 'PollTimeoutError') {
        throw new Error(`The render took too long (${Math.round(timeout / 60000)} minutes). Retry the scene.`);
      }
      throw e;
    }
  },

  /** Targeted EXISTING-VIDEO edit through Gemini Omni 1.1 Flash. Generation
   * and editing are separate operations in the capability registry. The live
   * edit adapter accepts at most 8s, so a longer source is deterministically
   * trimmed to [0,8], edited, and stitched to the untouched [8,end] remainder. */
  async editVideo(params: {
    sourceUrl: string;
    instruction: string;
    aspect: Aspect;
    durationS: number;
    creditKey: string;
    generateAudio?: boolean;
  }): Promise<{ videoUrl: string; operationId: string; model: string; editedWindowSec: number; preservedRemainderSec: number; assembledFromWindow: boolean; boundaryEvidence: string }> {
    if (!/^https:\/\//.test(String(params.sourceUrl || ''))) throw new Error('The selected clip has no durable source video URL.');
    const sourceDuration = Number(params.durationS) || 0;
    if (sourceDuration < 2) throw new Error('Omni existing-video edits require at least a 2-second source clip.');
    const instruction = capText(String(params.instruction || '').trim(), VIDEO_MODEL.promptMaxChars);
    if (!instruction) throw new Error('Describe the exact change you want in this clip.');
    const editWindow = Math.min(VIDEO_MODEL.safeMaxDuration, sourceDuration);
    const token = await getWorkspaceToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(token ? { 'X-Workspace-DB-Token': token } : {}) };
    let editableUrl = params.sourceUrl;
    let remainderUrl = '';
    if (sourceDuration > editWindow + 0.05) {
      const trim = async (startSec: number, endSec: number) => {
        const res = await fetch('/api/video/clip', {
          method: 'POST', headers,
          body: JSON.stringify({ videoUrlOrKey: params.sourceUrl, startSec, endSec, workspaceId: WORKSPACE_ID }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || data?.success === false || !/^https:\/\//.test(String(data?.url || ''))) throw new Error(String(data?.error || `The ${startSec.toFixed(1)}–${endSec.toFixed(1)}s edit segment could not be prepared.`));
        return String(data.url);
      };
      [editableUrl, remainderUrl] = await Promise.all([trim(0, editWindow), trim(editWindow, sourceDuration)]);
    }
    const attempt = await submitViaHook('google', {
      model: VIDEO_MODEL.apiModel,
      prompt: [instruction, `Edit only this supplied 00:00–00:${String(Math.round(editWindow)).padStart(2, '0')} window. Preserve duration, aspect ratio, audio, characters and every unmentioned detail exactly.`].join('\n\n'),
      videoData: editableUrl,
      videoMimeType: 'video/mp4',
      aspectRatio: params.aspect,
      duration: Math.round(editWindow),
      resolution: '720p',
      generateAudio: params.generateAudio !== false,
    }, VIDEO_MODEL.safeMaxDuration, params.creditKey);
    if (!attempt.ok) throw new Error(classifySubmitError(attempt.status, attempt.data));
    const editedUrl = await this.getVideoResult(attempt.jobId, { model: VIDEO_MODEL, creditKey: params.creditKey });
    if (!remainderUrl) {
      return { videoUrl: editedUrl, operationId: attempt.jobId, model: VIDEO_MODEL.apiModel, editedWindowSec: editWindow, preservedRemainderSec: 0, assembledFromWindow: false, boundaryEvidence: 'The entire source fit the verified edit window.' };
    }
    const stitch = await fetch(`/api/workspaces/${WORKSPACE_ID}/videos/stitch`, {
      method: 'POST', headers, body: JSON.stringify({ videoUrls: [editedUrl, remainderUrl] }),
    });
    const stitched = await stitch.json().catch(() => null);
    const videoUrl = String(stitched?.stitchedUrl || '');
    if (!stitch.ok || stitched?.success === false || !/^https:\/\//.test(videoUrl)) throw new Error(String(stitched?.error || 'The edited window completed, but it could not be spliced to the untouched remainder. The original is still unchanged.'));
    let boundaryEvidence = 'Splice completed; review audio and visual continuity at the edit boundary.';
    try {
      const probe = await fetch('/api/video/frames', {
        method: 'POST', headers,
        body: JSON.stringify({ videoUrl, timestamps: [Math.max(0.1, editWindow - 0.1), editWindow + 0.1], workspaceId: WORKSPACE_ID }),
      });
      const evidence = await probe.json().catch(() => null);
      if (probe.ok && Array.isArray(evidence?.frames) && evidence.frames.length === 2) boundaryEvidence = `Frames extracted on both sides of the ${editWindow.toFixed(1)}s splice; human audio/visual review is still required.`;
    } catch { /* boundary evidence is best-effort; the verified MP4 remains available */ }
    return { videoUrl, operationId: attempt.jobId, model: VIDEO_MODEL.apiModel, editedWindowSec: editWindow, preservedRemainderSec: Math.max(0, sourceDuration - editWindow), assembledFromWindow: true, boundaryEvidence };
  },

  /** Upload a reference image (File/Blob or data: URL) → durable public URL. */
  async uploadReference(input: File | Blob | string, fileName = `s2v-ref-${Date.now()}.png`): Promise<string> {
    if (typeof input === 'string') {
      if (/^https:\/\//.test(input)) return input; // already durable
      if (input.startsWith('data:')) return uploadDataUrl(input, fileName);
      throw new Error('A reference must be a file, a data: URL, or an https URL.');
    }
    return uploadBlob(input, fileName);
  },

  /** Abandon a running job: the poll loop stops and the scene is released.
   * (The platform proxies expose no provider-side cancel.) */
  cancelGeneration(jobId: string): void {
    if (jobId) cancelled.add(jobId);
  },
};
