/**
 * Runway — the workspace's single client for the platform's authenticated
 * Runway proxy (`/api/generate/runway/*`).
 *
 * Every app that offers Runway generation imports THIS module instead of
 * writing its own fetch logic:
 *
 *   runwayCapabilities()            live models, recipes, ratios, durations,
 *                                   languages and prices — the source of truth
 *   runwayQuote(params)             exact credit cost BEFORE anything is billed
 *   runwayGenerate(endpoint, body)  submit (idempotent) and get a taskId back
 *   runwayPoll(taskId)              poll with backoff; `uncertain` and
 *                                   `persisting` are kept polling, never
 *                                   resubmitted
 *
 * Contract notes that the UI must respect (see the runway-recipes integration
 * doc): the proxy owns the Runway secret, the pinned workflow versions, wallet
 * billing and durable media storage. Credits are never calculated in app code —
 * the quote endpoint is the only price. Every POST carries a unique
 * Idempotency-Key, so a provider timeout (202 `uncertain`) is polled rather
 * than resubmitted. Only `succeeded` is success, and its media URLs are the
 * durable platform-hosted ones.
 */

import {
  RUNWAY_DISABLED_MESSAGE, RUNWAY_LOCALIZATION_LANGUAGES, RUNWAY_MODELS as RUNWAY_ENGINE_CATALOG,
  RUNWAY_RATIOS, RUNWAY_RECIPES, RUNWAY_VIDEO_MODELS,
} from './videoEngines';
import { poll } from './poll';
import { spaceId, workspaceTokenNow } from './workspace';

const BASE = '/api/generate/runway';

/** Provider credits are priced by the platform catalog at $0.01 per credit. */
const DEFAULT_CREDIT_USD = 0.01;

function win(): any {
  return typeof window === 'undefined' ? {} : (window as any);
}

export function runwayToken(): string {
  return workspaceTokenNow();
}

export function runwayAppId(): string {
  return spaceId();
}

function idempotencyKey(): string {
  try {
    const c = win().crypto;
    if (c && typeof c.randomUUID === 'function') return String(c.randomUUID());
  } catch { /* fall through to the timestamp form */ }
  return `rw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export interface RunwayFailure extends Error {
  code?: string;
  status?: number;
}

function fail(message: string, code: string, status: number): never {
  const e = new Error(message) as RunwayFailure;
  e.code = code;
  e.status = status;
  throw e;
}

function messageFrom(data: any, status: number): { message: string; code: string } {
  const raw = data && data.error;
  const message = typeof raw === 'string' ? raw : String(raw?.message || data?.message || '');
  const code = String((raw && typeof raw === 'object' ? raw.code : '') || data?.code || '');
  if (code === 'generation_disabled' || code === 'provider_unavailable') {
    return { message: message || RUNWAY_DISABLED_MESSAGE, code };
  }
  if (/insufficient/i.test(code)) {
    return { message: message || 'The workspace wallet does not hold enough credit for this generation.', code };
  }
  if (code === 'idempotency_conflict') {
    return { message: message || 'That request was already submitted with different inputs — change something and try again.', code };
  }
  if (status === 503) {
    return { message: message || 'Runway is unavailable right now — try again shortly.', code: code || 'unavailable' };
  }
  return { message: message || `Runway answered HTTP ${status}.`, code: code || 'runway_error' };
}

async function readJson(res: Response): Promise<any> {
  const text = await res.text().catch(() => '');
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { error: text.slice(0, 300) }; }
}

// ---------------------------------------------------------------------------
// Shape normalisation
//
// The capabilities payload is owned by the platform and may grow fields, so
// everything below reads defensively: a shape this client does not recognise
// degrades to the documented catalog defaults instead of throwing.
// ---------------------------------------------------------------------------

function asArray(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    return Object.keys(value).map((k) => {
      const entry = value[k];
      return entry && typeof entry === 'object' ? { id: k, ...entry } : { id: k, value: entry };
    });
  }
  return [];
}

/** Breadth-first search for the first array living under any of `keys`. */
function findArray(root: any, keys: string[]): any[] {
  const queue: any[] = [root];
  let guard = 0;
  while (queue.length && guard++ < 400) {
    const node = queue.shift();
    if (!node || typeof node !== 'object') continue;
    for (const key of keys) {
      const hit = (node as any)[key];
      if (Array.isArray(hit) && hit.length) return hit;
    }
    for (const key of Object.keys(node)) {
      const child = (node as any)[key];
      if (child && typeof child === 'object') queue.push(child);
    }
  }
  return [];
}

function strings(values: any[]): string[] {
  const out: string[] = [];
  values.forEach((v) => {
    const s = typeof v === 'string' ? v : typeof v?.id === 'string' ? v.id : typeof v?.value === 'string' ? v.value : '';
    if (s && out.indexOf(s) < 0) out.push(s);
  });
  return out;
}

function numbers(values: any[]): number[] {
  const out: number[] = [];
  values.forEach((v) => {
    const n = typeof v === 'number' ? v : Number(v?.seconds ?? v?.duration ?? v?.value ?? NaN);
    if (Number.isFinite(n) && out.indexOf(n) < 0) out.push(n);
  });
  return out.sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Catalog defaults — used only to keep a form usable when capabilities is
// unreachable or omits a list. Anything the live response DOES return always
// wins over these.
// ---------------------------------------------------------------------------

/** Runway ratios are pixel pairs, not "16:9" shorthand. Labels and fallbacks
 * come from the workspace's own engine catalog so the two never drift apart. */
export const RUNWAY_RATIO_LABELS: Record<string, string> = RUNWAY_RATIOS.reduce(
  (acc: Record<string, string>, r) => { acc[r.value] = r.label; return acc; },
  {} as Record<string, string>,
);

const FALLBACK_RATIOS = RUNWAY_RATIOS.map((r) => r.value);
const FALLBACK_DURATIONS = [4, 5, 6, 8, 10];
const FALLBACK_LANGUAGES: { code: string; label: string }[] =
  RUNWAY_LOCALIZATION_LANGUAGES.map((l) => ({ code: l.code, label: l.label }));

export function ratioLabel(ratio: string): string {
  return RUNWAY_RATIO_LABELS[ratio] || ratio;
}

/**
 * The catalog entry for a recipe or base model, straight from
 * lib/videoEngines.ts. This is documentation, NOT pricing authority — the
 * quote endpoint is the only price a customer is ever shown as final.
 */
export function catalogRecipeInfo(id: string) {
  const r = RUNWAY_RECIPES.filter((x) => x.id === id)[0];
  return r ? { name: r.name, purpose: r.purpose, inputsNote: r.inputsNote, priceNote: r.priceNote, outputKind: r.outputKind } : null;
}

export function catalogVideoModelInfo(id: string) {
  const m = RUNWAY_VIDEO_MODELS.filter((x) => x.id === id)[0];
  if (m) {
    return {
      name: m.name,
      blurb: m.blurb,
      tier: m.tier,
      textToVideo: m.textToVideo,
      t2vRatios: m.t2vRatios,
      i2vRatios: m.i2vRatios,
      durations: `${m.minDurationS}–${m.maxDurationS}s (default ${m.defaultDurationS}s)`,
      priceNote: `≈ $${m.pricePerSecondUsd.toFixed(2)} / second`,
    };
  }
  // Roster entries beyond the two detailed legacy configs — read from the
  // shared engine catalog so every Runway model id resolves to real copy.
  const c = RUNWAY_ENGINE_CATALOG.filter((x) => x.id === id && x.type === 'video')[0];
  if (!c) return null;
  return {
    name: c.label,
    blurb: c.blurb,
    tier: c.speed === 'fast' ? 'Fast' : 'Cinematic',
    textToVideo: c.inputType !== 'image',
    t2vRatios: c.inputType === 'image' ? [] : c.ratios,
    i2vRatios: c.ratios,
    durations: `${c.minDurationS ?? 2}–${c.maxDurationS ?? 10}s (default ${c.defaultDurationS ?? 5}s)`,
    priceNote: c.priceNote,
  };
}

// ---------------------------------------------------------------------------
// Modes — the nine things a customer can actually ask Runway for
// ---------------------------------------------------------------------------

export type RunwayRecipeId =
  | 'product_ad'
  | 'product_swap'
  | 'product_ugc'
  | 'multi_shot_video'
  | 'ad_localization'
  | 'marketing_stock_image'
  | 'product_campaign_image';

export type RunwayModeId = RunwayRecipeId | 'text_to_video' | 'image_to_video';

/** Any Runway base-model id from the shared engine catalog (gen4.5,
 * gen4_turbo, veo3.1, seedance2.5, …). Which ids are actually submittable is
 * decided by the live capabilities response, never by this type. */
export type RunwayVideoModel = string;

/** The roster for the two base-model modes, read live from the shared engine
 * catalog — newly enabled Runway models appear here without a code change.
 * Pass `availableOnly: true` to keep only ids the platform accepts today. */
export function runwayModeModels(mode: RunwayModeId, opts: { availableOnly?: boolean } = {}): string[] {
  if (mode !== 'text_to_video' && mode !== 'image_to_video') return [];
  return RUNWAY_ENGINE_CATALOG
    .filter((m) => m.type === 'video' && m.route !== 'recipe')
    .filter((m) => (mode === 'text_to_video'
      ? (m.inputType === 'text' || m.inputType === 'both')
      : (m.inputType === 'image' || m.inputType === 'both')))
    .filter((m) => (opts.availableOnly ? m.available : true))
    .map((m) => m.id);
}

export interface RunwayModeDef {
  id: RunwayModeId;
  label: string;
  blurb: string;
  /** What the customer has to bring, in plain English. */
  inputs: string;
  kind: 'video' | 'image';
  recipeId?: RunwayRecipeId;
  /** Documentation only. The selectable roster comes from runwayModeModels(),
   * which reads the live engine catalog — never from a list pinned here. */
  models?: RunwayVideoModel[];
}

export const RUNWAY_MODES: RunwayModeDef[] = [
  {
    id: 'product_ad', label: 'Product Ad', recipeId: 'product_ad', kind: 'video',
    blurb: 'A polished product advertisement built from your product and a line of creative direction.',
    inputs: 'Product name and description, a product image, and the tone you want.',
  },
  {
    id: 'product_swap', label: 'Video → Video', recipeId: 'product_swap', kind: 'video',
    blurb: 'Replace the product inside an ad you already have, keeping the shot, motion and pacing.',
    inputs: 'The source video, an image of the replacement product, and optionally the original product.',
  },
  {
    id: 'product_ugc', label: 'UGC Video', recipeId: 'product_ugc', kind: 'video',
    blurb: 'Creator-style product footage that reads as a real person talking about your product.',
    inputs: 'A product image, a creator reference image, and the persona or script direction.',
  },
  {
    id: 'multi_shot_video', label: 'Multi-Shot', recipeId: 'multi_shot_video', kind: 'video',
    blurb: 'Several directed shots composed into one continuous video.',
    inputs: 'Three to five shot descriptions plus an overall style, duration and ratio.',
  },
  {
    id: 'ad_localization', label: 'Ad Localization', recipeId: 'ad_localization', kind: 'image',
    blurb: 'Localize an existing still ad into another language, keeping the creative intact.',
    inputs: 'The source ad image and the target language.',
  },
  {
    id: 'product_campaign_image', label: 'Campaign Images', recipeId: 'product_campaign_image', kind: 'image',
    blurb: 'A coordinated set of campaign images around one product and one theme.',
    inputs: 'A product image and the campaign direction. Returns several images.',
  },
  {
    id: 'marketing_stock_image', label: 'Stock Image', recipeId: 'marketing_stock_image', kind: 'image',
    blurb: 'Commercial marketing imagery generated to a brief instead of licensed from a library.',
    inputs: 'A description of the image and the quality level. Returns several images.',
  },
  {
    id: 'text_to_video', label: 'Text → Video', kind: 'video',
    blurb: 'A fresh clip generated straight from a written prompt, on any model in the roster.',
    inputs: 'A prompt, a duration and an aspect ratio.',
  },
  {
    id: 'image_to_video', label: 'Image → Video', kind: 'video',
    blurb: 'Animate a still image — Gen-4.5 for fidelity, Gen-4 Turbo when speed matters, or any other roster model.',
    inputs: 'An image, a motion prompt, a duration and an aspect ratio.',
  },
];

export function runwayMode(id: RunwayModeId): RunwayModeDef {
  return RUNWAY_MODES.filter((m) => m.id === id)[0] || RUNWAY_MODES[0];
}

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

export interface RunwayModelInfo {
  id: string;
  label: string;
  modes: string[];
  durations: number[];
  ratios: string[];
  price: string;
  raw: any;
}

export interface RunwayRecipeInfo {
  id: string;
  label: string;
  description: string;
  fields: string[];
  outputs: number;
  price: string;
  version: string;
  raw: any;
}

export interface RunwayCapabilities {
  available: boolean;
  /** Populated when the proxy says generation is off, or the fetch failed. */
  reason: string;
  models: RunwayModelInfo[];
  recipes: RunwayRecipeInfo[];
  ratios: string[];
  durations: number[];
  languages: { code: string; label: string }[];
  creditUsd: number;
  raw: any;
}

function priceText(node: any, creditUsd: number): string {
  if (!node || typeof node !== 'object') return '';
  const credits = node.credits ?? node.creditCost ?? node.cost ?? node.price?.credits;
  if (typeof credits === 'number' && Number.isFinite(credits)) {
    return `${credits} credits (≈ $${(credits * creditUsd).toFixed(2)})`;
  }
  const min = node.minCredits ?? node.credits?.min ?? node.price?.min;
  const max = node.maxCredits ?? node.credits?.max ?? node.price?.max;
  if (Number.isFinite(Number(min)) && Number.isFinite(Number(max))) {
    return `${min}–${max} credits (≈ $${(Number(min) * creditUsd).toFixed(2)}–$${(Number(max) * creditUsd).toFixed(2)})`;
  }
  if (typeof node.price === 'string') return node.price;
  return '';
}

function normaliseCapabilities(raw: any): RunwayCapabilities {
  const creditUsd = Number(raw?.creditUsd ?? raw?.creditPriceUsd ?? raw?.pricing?.usdPerCredit) || DEFAULT_CREDIT_USD;

  const modelNodes = asArray(raw?.models ?? raw?.video?.models ?? findArray(raw, ['models']));
  const models: RunwayModelInfo[] = modelNodes.map((m: any) => {
    const id = String(m?.id || m?.model || m?.name || m?.value || '');
    return {
      id,
      label: String(m?.label || m?.displayName || id),
      modes: strings(asArray(m?.modes ?? m?.supportedModes ?? m?.tasks)),
      durations: numbers(asArray(m?.durations ?? m?.duration ?? m?.supportedDurations)),
      ratios: strings(asArray(m?.ratios ?? m?.ratio ?? m?.supportedRatios ?? m?.resolutions)),
      price: priceText(m, creditUsd),
      raw: m,
    };
  }).filter((m: RunwayModelInfo) => !!m.id);

  const recipeNodes = asArray(raw?.recipes ?? findArray(raw, ['recipes']));
  const recipes: RunwayRecipeInfo[] = recipeNodes.map((r: any) => {
    const id = String(r?.id || r?.recipeId || r?.name || '');
    const declaredInputs = r?.inputs && !Array.isArray(r.inputs) && typeof r.inputs === 'object'
      ? [...asArray(r.inputs.required), ...asArray(r.inputs.optional)]
      : asArray(r?.fields ?? r?.inputs ?? r?.required ?? r?.inputFields);
    const fields = strings(declaredInputs);
    return {
      id,
      label: String(r?.label || r?.displayName || id.replace(/_/g, ' ')),
      description: String(r?.description || ''),
      fields,
      outputs: Number(r?.outputs ?? r?.outputCount ?? r?.imageCount ?? 0) || 0,
      price: priceText(r, creditUsd),
      version: String(r?.version || ''),
      raw: r,
    };
  }).filter((r: RunwayRecipeInfo) => !!r.id);

  const ratioPool = strings(findArray(raw, ['ratios', 'supportedRatios', 'resolutions']));
  const ratios = ratioPool.length
    ? ratioPool
    : (models.reduce((acc: string[], m) => acc.concat(m.ratios), []).filter((v, i, a) => a.indexOf(v) === i));

  const durationPool = numbers(findArray(raw, ['durations', 'supportedDurations']));
  const durations = durationPool.length
    ? durationPool
    : numbers(models.reduce((acc: number[], m) => acc.concat(m.durations), []));

  const languageNodes = findArray(raw, ['languages', 'targetLanguages', 'locales', 'supportedLanguages']);
  const languages = languageNodes.length
    ? languageNodes.map((l: any) => {
      const code = String(typeof l === 'string' ? l : l?.code || l?.id || l?.value || '');
      const known = FALLBACK_LANGUAGES.filter((f) => f.code === code)[0];
      return { code, label: String((typeof l === 'object' && (l?.label || l?.name)) || known?.label || code) };
    }).filter((l: { code: string }) => !!l.code)
    : FALLBACK_LANGUAGES;

  return {
    available: true,
    reason: '',
    models,
    recipes,
    ratios: ratios.length ? ratios : FALLBACK_RATIOS,
    durations: durations.length ? durations : FALLBACK_DURATIONS,
    languages,
    creditUsd,
    raw,
  };
}

function offlineCapabilities(reason: string): RunwayCapabilities {
  return {
    available: false,
    reason,
    models: [],
    recipes: [],
    ratios: FALLBACK_RATIOS,
    durations: FALLBACK_DURATIONS,
    languages: FALLBACK_LANGUAGES,
    creditUsd: DEFAULT_CREDIT_USD,
    raw: null,
  };
}

let capabilitiesCache: Promise<RunwayCapabilities> | null = null;

/** Live models, recipes, versions and prices. Cached for the page session —
 * pass `{ refresh: true }` to re-ask the proxy. */
export function runwayCapabilities(opts: { refresh?: boolean } = {}): Promise<RunwayCapabilities> {
  if (opts.refresh) capabilitiesCache = null;
  if (capabilitiesCache) return capabilitiesCache;
  capabilitiesCache = (async () => {
    try {
      const res = await fetch(`${BASE}/capabilities`, {
        headers: runwayToken() ? { 'X-Workspace-DB-Token': runwayToken() } : undefined,
      });
      const data = await readJson(res);
      if (!res.ok) return offlineCapabilities(messageFrom(data, res.status).message);
      return normaliseCapabilities(data);
    } catch (e: any) {
      return offlineCapabilities(String(e?.message || e || 'Could not reach the Runway service.'));
    }
  })();
  return capabilitiesCache;
}

/** True when the live capabilities actually list this mode. Anything not
 * returned is disabled in the UI rather than failing on submit. */
export function modeSupported(caps: RunwayCapabilities, id: RunwayModeId): boolean {
  if (!caps.available) return false;
  const def = runwayMode(id);
  if (def.recipeId) {
    if (!caps.recipes.length) return true; // capabilities omitted the list — let the quote decide
    return caps.recipes.some((r) => r.id === def.recipeId);
  }
  if (!caps.models.length) return true;
  return runwayModeModels(id).some((m) => caps.models.some((cm) => cm.id === m));
}

export function modelSupported(caps: RunwayCapabilities, model: string): boolean {
  if (!caps.models.length) return true;
  return caps.models.some((m) => m.id === model);
}

// ---------------------------------------------------------------------------
// Quote
// ---------------------------------------------------------------------------

export interface RunwayQuote {
  credits: number;
  usd: number;
  outputs: number;
  label: string;
  raw: any;
}

/** Validate a prospective request and return its exact cost. ALWAYS call this
 * before submitting — credits are never computed in app code. */
export async function runwayQuote(params: Record<string, any>, creditUsd = DEFAULT_CREDIT_USD): Promise<RunwayQuote> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/quote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(runwayToken() ? { 'X-Workspace-DB-Token': runwayToken() } : {}),
      },
      body: JSON.stringify(params),
    });
  } catch (e: any) {
    return fail(String(e?.message || 'Could not reach the Runway service.'), 'network', 0);
  }
  const data = await readJson(res);
  if (!res.ok) {
    const { message, code } = messageFrom(data, res.status);
    return fail(message, code, res.status);
  }
  const node = data?.quote && typeof data.quote === 'object' ? data.quote : data;
  const credits = Number(node?.credits ?? node?.creditCost ?? node?.cost ?? 0) || 0;
  const usd = Number(node?.usd ?? node?.usdCost ?? node?.priceUsd ?? 0) || credits * creditUsd;
  const outputs = Number(node?.outputs ?? node?.outputCount ?? node?.imageCount ?? 1) || 1;
  const label = credits
    ? `${credits} credits (≈ $${usd.toFixed(2)})${outputs > 1 ? ` · ${outputs} outputs` : ''}`
    : 'Quoted by Runway';
  return { credits, usd, outputs, label, raw: data };
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

export interface RunwaySubmission {
  taskId: string;
  status: string;
  raw: any;
}

/**
 * Submit a generation. `endpoint` is either `video` or `recipes/<recipeId>`
 * (a leading `/api/generate/runway/` is accepted too). A 202 `uncertain`
 * answer is returned like any other — poll it, never resubmit it.
 */
export async function runwayGenerate(
  endpoint: string,
  body: Record<string, any>,
  options: { idempotencyKey?: string } = {},
): Promise<RunwaySubmission> {
  const path = endpoint.indexOf('/api/') === 0 ? endpoint : `${BASE}/${endpoint.replace(/^\/+/, '')}`;
  const token = runwayToken();
  if (!token) return fail('You need to be signed in before Runway can generate anything.', 'no_credentials', 401);
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-DB-Token': token,
        'Idempotency-Key': options.idempotencyKey || idempotencyKey(),
      },
      body: JSON.stringify(body),
    });
  } catch (e: any) {
    return fail(String(e?.message || 'Could not reach the Runway service.'), 'network', 0);
  }
  const data = await readJson(res);
  if (!res.ok && res.status !== 202) {
    const { message, code } = messageFrom(data, res.status);
    return fail(message, code, res.status);
  }
  const taskId = String(data?.taskId || data?.id || data?.task?.id || '');
  if (!taskId) return fail('Runway accepted the request but returned no task to follow.', 'no_task', res.status);
  return { taskId, status: String(data?.status || 'queued'), raw: data };
}

export function runwaySubmitRecipe(
  recipeId: RunwayRecipeId,
  body: Record<string, any>,
  options: { idempotencyKey?: string } = {},
): Promise<RunwaySubmission> {
  return runwayGenerate(`recipes/${encodeURIComponent(recipeId)}`, body, options);
}

export function runwaySubmitVideo(
  body: Record<string, any>,
  options: { idempotencyKey?: string } = {},
): Promise<RunwaySubmission> {
  return runwayGenerate('video', body, options);
}

// ---------------------------------------------------------------------------
// Poll
// ---------------------------------------------------------------------------

export interface RunwayResult {
  taskId: string;
  status: string;
  mediaUrls: string[];
  mediaIds: string[];
  kind: 'video' | 'image' | 'unknown';
  raw: any;
}

const VIDEO_RE = /\.(mp4|webm|mov|m4v)(\?|$)/i;
const IMAGE_RE = /\.(png|jpe?g|webp|gif|avif)(\?|$)/i;

function collectUrls(node: any): string[] {
  const out: string[] = [];
  const visit = (value: any, depth: number) => {
    if (depth > 6 || value == null) return;
    if (typeof value === 'string') {
      if (/^https?:\/\//i.test(value) && out.indexOf(value) < 0) out.push(value);
      return;
    }
    if (Array.isArray(value)) { value.forEach((v) => visit(v, depth + 1)); return; }
    if (typeof value === 'object') {
      ['url', 'uri', 'href', 'mediaUrl', 'publicUrl', 'downloadUrl'].forEach((k) => visit((value as any)[k], depth + 1));
    }
  };
  ['output', 'outputs', 'media', 'mediaUrls', 'assets', 'results', 'urls'].forEach((key) => {
    if (node && typeof node === 'object' && (node as any)[key] !== undefined) visit((node as any)[key], 0);
  });
  if (!out.length && node && typeof node === 'object') visit((node as any).result, 0);
  return out;
}

function collectIds(node: any): string[] {
  const out: string[] = [];
  const push = (v: any) => { const s = String(v || ''); if (s && out.indexOf(s) < 0) out.push(s); };
  ['mediaIds', 'mediaId', 'assetIds'].forEach((key) => {
    const v = node && typeof node === 'object' ? (node as any)[key] : null;
    if (Array.isArray(v)) v.forEach(push);
    else if (v) push(v);
  });
  const media = node && typeof node === 'object' ? (node as any).media : null;
  if (Array.isArray(media)) media.forEach((m: any) => { if (m && typeof m === 'object') push(m.id || m.mediaId); });
  return out;
}

function resultFrom(taskId: string, data: any): RunwayResult {
  const mediaUrls = collectUrls(data);
  const videoish = mediaUrls.some((u) => VIDEO_RE.test(u));
  const imageish = mediaUrls.some((u) => IMAGE_RE.test(u));
  return {
    taskId,
    status: String(data?.status || ''),
    mediaUrls,
    mediaIds: collectIds(data),
    kind: videoish ? 'video' : imageish ? 'image' : 'unknown',
    raw: data,
  };
}

/** Terminal-but-not-success states. `failed` and `cancelled` settle a refund;
 * `refund_pending` / `refund_uncertain` are still non-success. */
const DEAD_STATUSES = ['failed', 'cancelled', 'canceled'];

/** Kept polling on purpose: `uncertain` means provider acceptance cannot be
 * reconciled yet and MUST NOT be resubmitted; `persisting` means the media is
 * still being written to durable storage. */
const PATIENT_STATUSES = ['uncertain', 'persisting'];

export interface RunwayPollOptions {
  onStatus?: (status: string, elapsedMs: number) => void;
  /** Set `.cancelled = true` to stop polling (the task itself keeps running). */
  signal?: { cancelled: boolean };
  /** Give up waiting after this long. Defaults to 15 minutes. */
  maxMs?: number;
}

interface RunwayPollState {
  response?: Response;
  data?: any;
  networkError?: any;
  cancelled?: boolean;
  elapsedMs: number;
}

/**
 * Poll a task until it settles. Exponential backoff 500ms → 8s.
 * `uncertain` and `persisting` keep polling silently and NEVER trigger a
 * second submission. Only `succeeded` resolves; everything else throws.
 */
export async function runwayPoll(taskId: string, opts: RunwayPollOptions = {}): Promise<RunwayResult> {
  const started = Date.now();
  const maxMs = opts.maxMs ?? 15 * 60 * 1000;
  let lastStatus = '';
  let callbackFailed = false;
  let callbackError: unknown;

  const state = await poll<RunwayPollState>(async () => {
    if (opts.signal?.cancelled) return { cancelled: true, elapsedMs: Date.now() - started };

    try {
      const response = await fetch(`${BASE}/status/${encodeURIComponent(taskId)}`, {
        headers: { 'X-Workspace-DB-Token': runwayToken() },
      });
      const data = await readJson(response);
      return { response, data, elapsedMs: Date.now() - started };
    } catch (networkError: any) {
      // A dropped poll is not a dead task — back off and ask again.
      return { networkError, elapsedMs: Date.now() - started };
    }
  }, {
    interval: 500,
    backoff: 2,
    maxInterval: 8000,
    // runwayPoll owns its exact timeout messages and network-error mapping.
    timeout: Number.POSITIVE_INFINITY,
    onTick: (current) => {
      if (!current.response?.ok) return;
      const status = String(current.data?.status || '');
      if (status && status !== lastStatus) {
        lastStatus = status;
        try {
          opts.onStatus?.(status, current.elapsedMs);
        } catch (error) {
          callbackFailed = true;
          callbackError = error;
        }
      }
    },
    until: (current) => {
      if (callbackFailed || current.cancelled) return true;
      if (current.networkError) return current.elapsedMs > maxMs;
      if (!current.response?.ok) return true;
      const status = String(current.data?.status || '');
      return status === 'succeeded'
        || DEAD_STATUSES.indexOf(status) >= 0
        || current.elapsedMs > maxMs;
    },
  });

  if (callbackFailed) throw callbackError;
  if (state.cancelled) return fail('Generation was cancelled in the app — the Runway task may still finish.', 'cancelled_locally', 0);
  if (state.networkError) return fail(String(state.networkError?.message || 'Lost contact with the Runway service.'), 'network', 0);

  const res = state.response as Response;
  const data = state.data;
  if (!res.ok) {
    const { message, code } = messageFrom(data, res.status);
    return fail(message, code, res.status);
  }

  const status = String(data?.status || '');
  if (status === 'succeeded') {
    const result = resultFrom(taskId, data);
    if (!result.mediaUrls.length) return fail('Runway reported success but returned no media.', 'no_media', 200);
    return result;
  }

  if (DEAD_STATUSES.indexOf(status) >= 0) {
    const detail = String(data?.error?.message || data?.error || '');
    return fail(`Runway ${status === 'failed' ? 'could not finish this generation' : 'cancelled this generation'}${detail ? `: ${detail}` : '.'}`, status, 200);
  }

  const patient = PATIENT_STATUSES.indexOf(status) >= 0;
  return fail(
    patient
      ? `This generation is taking longer than expected (still ${status}). It has NOT been charged twice — check back shortly rather than submitting again.`
      : `This generation is still ${status || 'running'} after ${Math.round(maxMs / 60000)} minutes. Check back shortly.`,
    'timeout', 0,
  );
}

/** Human wording for the proxy's task statuses. */
export function statusText(status: string): string {
  switch (status) {
    case 'admitting': return 'Checking your balance…';
    case 'charged': return 'Reserved — handing the job to Runway…';
    case 'submitting': return 'Submitting to Runway…';
    case 'queued': return 'Queued at Runway…';
    case 'running': return 'Generating…';
    case 'throttled': return 'Waiting for a Runway slot…';
    case 'persisting': return 'Finalizing — saving your media…';
    case 'uncertain': return 'Waiting on Runway to confirm — nothing is being resubmitted…';
    case 'succeeded': return 'Done.';
    default: return status ? `${status.charAt(0).toUpperCase()}${status.slice(1)}…` : 'Working…';
  }
}

// ---------------------------------------------------------------------------
// Reference media
//
// Runway only accepts public HTTPS reference URLs, so anything a customer picks
// off their machine is parked on platform storage first.
// ---------------------------------------------------------------------------

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

/** Upload a picked file and return its durable public HTTPS URL. */
export async function runwayUpload(file: File): Promise<string> {
  const safeName = file.name.replace(/[^\w.-]+/g, '_');
  if (file.type.indexOf('image/') === 0) {
    const dataUrl = await readAsDataUrl(file);
    const res = await fetch('/api/upload/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Id': runwayAppId() },
      body: JSON.stringify({ imageData: dataUrl, fileName: safeName }),
    });
    const data = await readJson(res);
    const url = data && (data.imageUrl || data.url);
    if (!res.ok || typeof url !== 'string') throw new Error(String(data?.error || `Image upload failed (HTTP ${res.status}).`));
    return url;
  }
  const form = new FormData();
  form.append('file', new File([file], safeName, { type: file.type || 'application/octet-stream' }));
  form.append('folder', 'runway');
  const res = await fetch('/api/upload/file', { method: 'POST', body: form });
  const data = await readJson(res);
  if (!res.ok || !data?.url) throw new Error(String(data?.error || `File upload failed (HTTP ${res.status}).`));
  return String(data.url);
}

/** Runway rejects non-HTTPS, credential-bearing and port-bearing references
 * before any provider work, so the UI checks the obvious cases first. */
export function isUsableReference(url: string): boolean {
  return /^https:\/\/[^\s@]+$/i.test(String(url || '').trim());
}
