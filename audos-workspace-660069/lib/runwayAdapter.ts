/**
 * RUNWAY ADAPTER — one entry point every VidVerge app calls to generate with
 * a Runway-native model, so no app builds its own Runway body again.
 *
 * ===========================================================================
 * LIVE ENDPOINT PROBE — 28 Sep 2026, against the Audos platform API
 * ===========================================================================
 * WORKS:
 *   GET  /api/generate/runway/capabilities    200 · apiVersion 2024-11-06,
 *        creditUsd 0.01, models [gen4.5, gen4_turbo], the 7 pinned recipes
 *   POST /api/generate/runway/quote           200 · free, no auth, no billing,
 *        no provider work — the preflight used below
 *   POST /api/generate/runway/video           submit (needs the workspace token)
 *   POST /api/generate/runway/recipes/:id     submit one of the 7 recipes
 *   GET  /api/generate/runway/status/:taskId  poll
 *
 * DOES NOT EXIST (probed, 404 "API route not found"):
 *   GET  /api/generate/runway/models
 *   GET  /api/workspaces/:workspaceId/runway/models
 *   POST /api/generate/runway/image
 * And POST /api/veo/generate/video rejects model 'runway-gen4' with
 * invalid_enum_value — the Veo proxy never routes to Runway.
 *
 * MODEL SURFACE: re-probed 29 Sep 2026 — the video proxy still accepts exactly
 * two ids (gen4.5, gen4_turbo). Quoting any other id (act_two, veo3.1,
 * seedance2.5, hailuo3, …) answers
 *   400 {"error":"model must be one of: gen4.5, gen4_turbo.","code":"invalid_request"}
 * The catalog now lists Runway's FULL announced roster, and this adapter
 * refreshes availability from GET /api/generate/runway/capabilities
 * (syncRunwayCatalog) before every quote/submit, so a roster model starts
 * working here the moment the platform lists it — and is refused locally
 * (with the reason and a working alternative) until then, instead of
 * spending a round trip on a guaranteed 400.
 * Runway image output goes through the marketing_stock_image and
 * product_campaign_image recipes, which is what runway_stock_image and
 * runway_campaign_image in the catalog resolve to.
 *
 * AUTH: the same header every other Audos provider uses —
 * 'X-Workspace-DB-Token': window.__workspaceDb?.token. Submitting without it
 * answers 400 workspace_required. Every POST also carries a fresh
 * Idempotency-Key (handled inside lib/videoEngineClient.ts).
 */

import {
  EngineError, isPublicHttpsUrl, pollRunway,
  runwayQuote as postRunwayQuote, runwaySubmitRecipe, runwaySubmitVideo,
} from './videoEngineClient';
import {
  RunwayModel, clampRunwayDuration, runwayModel, runwayRoute,
  runwayUnsupportedMessage, runwayVideoRatio, syncRunwayCatalog,
} from './videoEngines';

export interface RunwayGenerateParams {
  /** A Runway catalog id: gen4.5, gen4_turbo, runway_stock_image, … */
  model: string;
  prompt?: string;
  /** Public HTTPS URL. Image-to-video seed, or a recipe's product image. */
  image?: string | null;
  /** Optional locked last frame (gen4.5 image-to-video only). */
  lastFrameImage?: string | null;
  /** Seconds. Clamped to the model's own range. */
  duration?: number;
  /** '16:9' / '9:16' / '1:1' shorthand or a Runway pixel pair — both work. */
  aspectRatio?: string;
  /** marketing_stock_image only. */
  quality?: 'low' | 'medium' | 'high';
  outputCount?: number;
  onStatus?: (status: string) => void;
  isCancelled?: () => boolean;
  timeoutMs?: number;
}

export interface RunwayGenerateResult {
  taskId: string;
  mediaUrls: string[];
  kind: 'video' | 'image';
  model: string;
  raw: any;
}

/**
 * A Runway failure the customer can act on. `switchModels` is true whenever
 * retrying the same request would fail the same way, which is the signal for
 * a surface to say "pick another engine" rather than offering Retry.
 */
export class RunwayUnavailable extends Error {
  code: string;
  status: number;
  switchModels: boolean;
  constructor(message: string, opts: { code?: string; status?: number; switchModels?: boolean } = {}) {
    super(message);
    this.name = 'RunwayUnavailable';
    this.code = opts.code || 'runway_error';
    this.status = opts.status || 0;
    this.switchModels = opts.switchModels !== false;
  }
}

function asRunwayFailure(e: unknown, model: string): RunwayUnavailable {
  if (e instanceof RunwayUnavailable) return e;
  if (e instanceof EngineError) {
    // 4xx means these inputs will never succeed on this model; 5xx and
    // network faults are worth the same request again.
    const clientFault = e.status >= 400 && e.status < 500;
    const label = runwayModel(model)?.label || model;
    const suffix = clientFault && e.code !== 'insufficient_funds'
      ? ` Switch to another engine or adjust the inputs — ${label} will keep refusing this request.`
      : '';
    return new RunwayUnavailable(`${e.message}${suffix}`, { code: e.code, status: e.status, switchModels: clientFault });
  }
  return new RunwayUnavailable(String((e as any)?.message || e || 'Runway generation failed.'), { code: 'unknown', switchModels: false });
}

/** Local validation — returns the reason this request cannot be sent, or null. */
export function validateRunwayRequest(params: RunwayGenerateParams): string | null {
  const m = runwayModel(params.model);
  if (!m) return `"${params.model}" is not a Runway model.`;
  if (!m.available) return runwayUnsupportedMessage(params.model);
  const prompt = String(params.prompt || '').trim();
  const image = String(params.image || '').trim();
  if (image && !isPublicHttpsUrl(image)) {
    return 'Runway only accepts public HTTPS reference images — upload the file first so it gets a public URL.';
  }
  if (m.inputType === 'image' && m.type === 'video' && !image) {
    return `${m.label} is image-to-video only — add a source image, or switch to Gen 4.5 for a text-only prompt.`;
  }
  if (m.id === 'runway_campaign_image' && !image) {
    return 'Runway Campaign Images needs a product image to build the set around.';
  }
  if (m.id === 'gen4.5' && image && prompt.length < 1) {
    return 'Gen 4.5 image-to-video still needs a prompt describing the motion you want.';
  }
  if (m.type === 'image' && prompt.length < 1) return 'Describe the image you want Runway to generate.';
  if (m.id === 'gen4.5' && !image && prompt.length < 1) return 'Describe the clip you want Runway to generate.';
  return null;
}

/** Build the exact proxy body for a request. Exported so a surface can quote
 * or log precisely what it is about to submit. */
export function buildRunwayBody(params: RunwayGenerateParams): Record<string, any> {
  const m = runwayModel(params.model) as RunwayModel;
  const route = runwayRoute(params.model);
  const prompt = String(params.prompt || '').trim();
  const image = String(params.image || '').trim();

  if (route.kind === 'recipe') {
    if (route.recipeId === 'marketing_stock_image') {
      const body: Record<string, any> = { prompt, quality: params.quality || 'high' };
      if (image) body.referenceImage = { uri: image };
      if (params.outputCount) body.outputCount = Math.max(1, Math.min(4, Math.round(params.outputCount)));
      return body;
    }
    return { image: { uri: image }, prompt };
  }

  const imageToVideo = Boolean(image);
  const body: Record<string, any> = {
    model: m.id,
    ratio: runwayVideoRatio(params.aspectRatio, m.id, imageToVideo),
    duration: clampRunwayDuration(params.duration, m.id),
  };
  if (prompt) body.promptText = prompt;
  if (imageToVideo) {
    body.mode = 'image-to-video';
    // promptImage is a bounded HTTPS string, or an ordered frame array when a
    // last frame is locked. It is deliberately NOT a { uri } object here —
    // only recipe media fields use that shape.
    const lastFrame = String(params.lastFrameImage || '').trim();
    body.promptImage = lastFrame && isPublicHttpsUrl(lastFrame)
      ? [{ uri: image, position: 'first' }, { uri: lastFrame, position: 'last' }]
      : image;
  }
  return body;
}

/** FREE price check — no auth, no billing, no provider work. Returns null
 * when the request is not quotable (the reason is in `error`). */
export async function quoteRunway(params: RunwayGenerateParams): Promise<{ ok: boolean; priceUsd?: number; credits?: number; error?: string }> {
  await syncRunwayCatalog(); // availability is live — never throws, cached 5 min
  const violation = validateRunwayRequest(params);
  if (violation) return { ok: false, error: violation };
  const route = runwayRoute(params.model);
  const body = buildRunwayBody(params);
  const quoteBody = route.kind === 'recipe' ? { recipeId: route.recipeId, ...body } : body;
  const q = await postRunwayQuote(quoteBody);
  return { ok: q.ok, priceUsd: q.priceUsd, credits: q.credits, error: q.error };
}

/**
 * Submit a Runway generation and wait for its durable media.
 * Throws RunwayUnavailable — `switchModels` tells the surface whether to
 * offer Retry or to push the customer at a different engine.
 */
export async function generateWithRunway(params: RunwayGenerateParams): Promise<RunwayGenerateResult> {
  await syncRunwayCatalog(); // availability is live — never throws, cached 5 min
  const violation = validateRunwayRequest(params);
  if (violation) throw new RunwayUnavailable(violation, { code: 'unsupported_model', status: 400, switchModels: true });

  const route = runwayRoute(params.model);
  const body = buildRunwayBody(params);

  try {
    const kickoff = route.kind === 'recipe' && route.recipeId
      ? await runwaySubmitRecipe(route.recipeId, body)
      : await runwaySubmitVideo(body);

    if (kickoff.uncertain && !kickoff.taskId) {
      throw new RunwayUnavailable(
        'Runway could not confirm this submission. It has NOT been charged twice — wait a moment and check the task rather than submitting again.',
        { code: 'runway_uncertain', status: 202, switchModels: false },
      );
    }

    const result = await pollRunway(kickoff.taskId, {
      onStatus: params.onStatus,
      isCancelled: params.isCancelled,
      timeoutMs: params.timeoutMs,
    });

    if (!result.mediaUrls.length) {
      throw new RunwayUnavailable('Runway reported success but returned no media.', { code: 'no_media', status: 200, switchModels: false });
    }
    return {
      taskId: kickoff.taskId,
      mediaUrls: result.mediaUrls,
      kind: route.outputKind,
      model: params.model,
      raw: result.raw,
    };
  } catch (e) {
    throw asRunwayFailure(e, params.model);
  }
}

/** Convenience for surfaces that only ever want one asset back. */
export async function generateOneWithRunway(params: RunwayGenerateParams): Promise<string> {
  const result = await generateWithRunway(params);
  return result.mediaUrls[0];
}
