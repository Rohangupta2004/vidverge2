// PROVIDER REGISTRY & HEALTH — the single place SceneForge answers three
// questions the UI must never guess at:
//
//   1. WHICH providers can this workspace actually use right now?
//      `probeProviders()` asks the platform (vv-media-capabilities for the
//      Runway / Kling / Higgsfield catalogues, the HeyGen credential proxy
//      for the presenter) instead of trusting a hardcoded list. A provider
//      that is not configured is reported as 'unconfigured' WITH a setup
//      note — the picker greys it out and explains why; it never crashes and
//      never silently falls back to a different engine.
//
//   2. WHY did a generation fail? `describeProviderFailure` turns a raw
//      rejection into the specific sentence the brief asks for — "HeyGen API
//      returned 429 - rate limited, try again in 60s" — naming the provider,
//      the status and the recovery, never "Error generating".
//
//   3. WHAT will this cost before anything is spent? `estimateGeneration`
//      prices a run from the scene windows against the workspace credit rule
//      (1 credit = 1 second of finished video) plus the provider's own
//      per-clip cost hint, so the customer sees the bill BEFORE pressing
//      Generate All.

import { GROUP_A_MODELS, HIGGSFIELD_VIDEO_MODELS, KLING_MODELS, RUNWAY_MODELS, groupAModel, isRunwayModel, videoEngine } from '../../../lib/videoEngines';
import { WORKSPACE_ID } from './supabase';

export type ProviderState = 'available' | 'unconfigured' | 'degraded' | 'unknown';
export type ProviderRole = 'scene' | 'presenter';

export interface ProviderMeta {
  /** The exact model/engine id the generation call sends. */
  id: string;
  label: string;
  vendor: string;
  role: ProviderRole;
  /** Longest clip the provider will render in one call. */
  maxDurationS: number;
  /** Rough USD per clip, from the engine catalogue. Display only. */
  costHint: string;
  /** True when the provider can carry a character reference across scenes —
   * the basis for the character-consistency badge. */
  characterRef: boolean;
  blurb: string;
}

export interface ProviderStatus extends ProviderMeta {
  state: ProviderState;
  /** Plain-English reason shown in the picker when the provider is not usable. */
  note: string;
}

/** The scene-clip engines SceneForge offers, newest/most useful first. */
const SCENE_PROVIDER_IDS = [
  'gemini-omni-flash-preview',
  'veo-3.1-fast-generate-preview',
  'veo-3.1-generate-preview',
  'veo-3.0-fast-generate-001',
  'sora-2',
  'openrouter/bytedance/seedance-2.0-fast',
  'kling-v1-5',
  'kling-v2-master',
  'minimax-hailuo-02',
  'dop-turbo',
];

function klingMeta(id: string): ProviderMeta | null {
  const model = KLING_MODELS.find((m) => m.id === id);
  if (!model) return null;
  return {
    id: model.id,
    label: model.name,
    vendor: 'Kling',
    role: 'scene',
    maxDurationS: 10,
    costHint: 'from $0.25 / 5s (std)',
    characterRef: false,
    blurb: model.blurb,
  };
}

function higgsfieldMeta(id: string): ProviderMeta | null {
  const model = HIGGSFIELD_VIDEO_MODELS.find((m) => m.id === id);
  if (!model) return null;
  return {
    id: model.id,
    label: model.name,
    vendor: 'Higgsfield',
    role: 'scene',
    maxDurationS: 15,
    costHint: '≈ $1.00 / clip',
    characterRef: false,
    blurb: model.blurb,
  };
}

function groupAMeta(id: string): ProviderMeta | null {
  const model = groupAModel(id);
  if (!model) return null;
  return {
    id: model.id,
    label: model.name,
    vendor: model.provider,
    role: 'scene',
    maxDurationS: model.maxDurationS,
    costHint: model.costHint,
    characterRef: model.supportsReferenceImages,
    blurb: model.blurb,
  };
}

export const HEYGEN_PROVIDER: ProviderMeta = {
  id: 'heygen',
  label: 'HeyGen',
  vendor: 'HeyGen',
  role: 'presenter',
  maxDurationS: 600,
  costHint: 'billed per rendered minute',
  characterRef: true,
  blurb: 'Avatar presenter master — the narration spine every scene is composited against.',
};

/** Static catalogue: every provider SceneForge knows how to drive. */
export function providerCatalogue(): ProviderMeta[] {
  const scene = SCENE_PROVIDER_IDS.map((id) => groupAMeta(id) || klingMeta(id) || higgsfieldMeta(id)).filter(Boolean) as ProviderMeta[];
  const runway = RUNWAY_MODELS
    .filter((model) => model.type === 'video' && model.route === 'video')
    .slice(0, 3)
    .map((model): ProviderMeta => ({
      id: model.id,
      label: model.label,
      vendor: 'Runway',
      role: 'scene',
      maxDurationS: model.maxDurationS || 10,
      costHint: model.priceNote || 'billed per second',
      characterRef: false,
      blurb: model.blurb || 'Runway video generation.',
    }));
  return [...scene, ...runway, HEYGEN_PROVIDER];
}

export function providerMeta(id: string | null | undefined): ProviderMeta | null {
  const wanted = String(id || '');
  if (wanted === 'heygen') return HEYGEN_PROVIDER;
  return klingMeta(wanted) || higgsfieldMeta(wanted) || providerCatalogue().find((entry) => entry.id === wanted) || null;
}

/** The provider's display name, used in every error sentence. */
export function providerLabel(id: string | null | undefined): string {
  return providerMeta(id)?.label || videoEngine(String(id || ''))?.label || String(id || 'the video provider');
}

// ---------------------------------------------------------------------------
// Availability probe
// ---------------------------------------------------------------------------

const CAPABILITIES_HOOK = `/api/hooks/execute/${'workspace-660069'}/vv-media-capabilities`;
const HEYGEN_PROBE = `/api/workspaces/${WORKSPACE_ID}/provider-credentials/heygen/proxy/v3/avatars/looks?limit=1`;
const PROBE_TTL_MS = 5 * 60 * 1000;

let probeCache: { at: number; statuses: ProviderStatus[] } | null = null;
let probeInFlight: Promise<ProviderStatus[]> | null = null;

function token(): string {
  if (typeof window === 'undefined') return '';
  return String((window as any).__workspaceDb?.token || '');
}

async function probeRunway(): Promise<{ state: ProviderState; note: string }> {
  try {
    const auth = token();
    const response = await fetch(CAPABILITIES_HOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(auth ? { 'X-Workspace-DB-Token': auth } : {}) },
      body: JSON.stringify({}),
    });
    const payload = await response.json().catch(() => null);
    const data = payload && payload.response !== undefined ? payload.response : payload;
    const runway = data?.runway;
    if (!runway) return { state: 'unknown', note: 'The platform did not report Runway availability — it will be tried live if you pick it.' };
    if (runway.available) return { state: 'available', note: '' };
    return {
      state: 'unconfigured',
      note: `Runway is not configured on this workspace right now (the platform answered ${runway.status || 'unavailable'}). Pick a Veo or Omni Flash engine, or ask Otto to enable Runway.`,
    };
  } catch {
    return { state: 'unknown', note: 'Runway availability could not be checked — it will be tried live if you pick it.' };
  }
}

async function probeKling(): Promise<{ state: ProviderState; note: string }> {
  try {
    const auth = token();
    const response = await fetch('/api/generate/kling/models', { headers: auth ? { 'X-Workspace-DB-Token': auth } : undefined });
    if (response.ok) return { state: 'available', note: '' };
    if (response.status === 503) return { state: 'unconfigured', note: 'Kling is not configured on this workspace — pick Veo/Omni or ask Otto to enable Kling.' };
    return { state: 'degraded', note: `Kling catalogue answered ${response.status} — generation may fail until it recovers.` };
  } catch {
    return { state: 'unknown', note: 'Kling availability could not be checked — it will be tried live if you pick it.' };
  }
}

async function probeHiggsfield(): Promise<{ state: ProviderState; note: string }> {
  try {
    const auth = token();
    const response = await fetch('/api/generate/higgsfield/models', { headers: auth ? { 'X-Workspace-DB-Token': auth } : undefined });
    if (response.ok) return { state: 'available', note: '' };
    if (response.status === 503) return { state: 'unconfigured', note: 'Higgsfield is not configured on this workspace.' };
    return { state: 'degraded', note: `Higgsfield catalogue answered ${response.status}.` };
  } catch {
    return { state: 'unknown', note: 'Higgsfield could not be probed — it will be tried live if selected.' };
  }
}

async function probeHeyGen(): Promise<{ state: ProviderState; note: string }> {
  try {
    const response = await fetch(HEYGEN_PROBE);
    if (response.ok) return { state: 'available', note: '' };
    if (response.status === 401 || response.status === 403) {
      return { state: 'unconfigured', note: 'HeyGen credentials are not connected to this workspace. Ask Otto to add the HeyGen API key, then reopen this panel — no other step is needed.' };
    }
    if (response.status === 404) {
      return { state: 'unconfigured', note: 'This workspace has no HeyGen provider credential yet, so avatar presenters are unavailable. Scene clips still generate normally.' };
    }
    if (response.status === 429) return { state: 'degraded', note: 'HeyGen is rate-limiting this workspace right now. Avatar renders will work again shortly.' };
    return { state: 'degraded', note: `HeyGen answered ${response.status} on the catalogue probe — avatar renders may fail until it recovers.` };
  } catch {
    return { state: 'unknown', note: 'HeyGen could not be reached for a status check — it will be tried live.' };
  }
}

/**
 * Live provider status for the picker. Group A (/api/veo/generate/video) is
 * the platform's baseline proxy and has no catalogue endpoint, so it is
 * reported available; Runway and HeyGen are genuinely probed. Cached for five
 * minutes; concurrent callers share one probe.
 */
export function probeProviders(options: { force?: boolean } = {}): Promise<ProviderStatus[]> {
  if (!options.force) {
    if (probeInFlight) return probeInFlight;
    if (probeCache && Date.now() - probeCache.at < PROBE_TTL_MS) return Promise.resolve(probeCache.statuses);
  }
  const attempt = (async (): Promise<ProviderStatus[]> => {
    const [runway, heygen, kling, higgsfield] = await Promise.all([probeRunway(), probeHeyGen(), probeKling(), probeHiggsfield()]);
    const statuses = providerCatalogue().map((meta): ProviderStatus => {
      if (meta.id === 'heygen') return { ...meta, ...heygen };
      if (isRunwayModel(meta.id)) return { ...meta, ...runway };
      if (meta.vendor === 'Kling') return { ...meta, ...kling };
      if (meta.vendor === 'Higgsfield') return { ...meta, ...higgsfield };
      return { ...meta, state: 'available', note: '' };
    });
    probeCache = { at: Date.now(), statuses };
    return statuses;
  })().finally(() => { probeInFlight = null; });
  probeInFlight = attempt;
  return attempt;
}

// ---------------------------------------------------------------------------
// Specific failures
// ---------------------------------------------------------------------------

/**
 * A provider rejection that KEPT its evidence. The generation paths throw
 * this instead of a bare Error so the board can say which provider failed,
 * with which status, and what to do — rather than spinning forever or
 * printing "Error generating".
 */
export class ProviderError extends Error {
  provider: string;
  providerLabel: string;
  status?: number;
  code?: string;
  retryAfterSeconds?: number;
  sceneIndex?: number;
  constructor(message: string, options: { provider: string; status?: number; code?: string; retryAfterSeconds?: number; sceneIndex?: number } ) {
    super(message);
    this.name = 'ProviderError';
    this.provider = options.provider;
    this.providerLabel = providerLabel(options.provider);
    this.status = options.status;
    this.code = options.code;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.sceneIndex = options.sceneIndex;
  }
}

function statusOf(error: any): number | undefined {
  if (Number.isFinite(Number(error?.status))) return Number(error.status);
  const match = String(error?.message || error || '').match(/\b(4\d{2}|5\d{2})\b/);
  return match ? Number(match[1]) : undefined;
}

function retryAfterOf(error: any): number | undefined {
  const direct = Number(error?.retryAfterSeconds);
  if (Number.isFinite(direct) && direct > 0) return Math.round(direct);
  const match = String(error?.message || error || '').match(/retry[- ]after[:\s]+(\d+)/i);
  return match ? Number(match[1]) : undefined;
}

/**
 * The sentence the customer reads when a provider refuses. Always names the
 * provider and the status, and always ends with the concrete next step.
 */
export function describeProviderFailure(provider: string, error: unknown, context: { sceneIndex?: number } = {}): string {
  const label = providerLabel(provider);
  const raw = String((error as any)?.message || error || 'the request failed');
  const status = statusOf(error);
  const retry = retryAfterOf(error);
  const where = context.sceneIndex ? `Scene ${context.sceneIndex}: ` : '';

  if (/abort|cancell?ed/i.test(raw) && !status) return `${where}${label} generation was cancelled. Nothing was charged for the cancelled clip.`;
  if (status === 429 || /rate.?limit/i.test(raw)) {
    return `${where}${label} API returned 429 - rate limited, try again in ${retry || 60}s. Everything already generated is kept.`;
  }
  if (status === 402 || /insufficient|credit balance|payment required/i.test(raw)) {
    return `${where}${label} API returned 402 - the workspace wallet does not have enough balance for this clip. Top up the wallet, then press Retry on this scene.`;
  }
  if (status === 401 || status === 403 || /no_credentials|unauthori[sz]ed|forbidden/i.test(raw)) {
    return `${where}${label} API returned ${status || 401} - this workspace has no working credential for ${label}. Pick a different provider in the top bar, or ask Otto to connect ${label}.`;
  }
  if (status === 404) {
    return `${where}${label} API returned 404 - that model is not served on this workspace. Pick a different provider in the top bar.`;
  }
  if (status === 400 || status === 422) {
    return `${where}${label} API returned ${status} and rejected the request: ${raw.slice(0, 220)} Edit the scene prompt or switch this scene to Text/Graphics.`;
  }
  if (status === 503) {
    return `${where}${label} API returned 503 - the provider is not configured or is temporarily down. Switch provider in the top bar, or retry in a few minutes.`;
  }
  if (status && status >= 500) {
    return `${where}${label} API returned ${status} - a provider-side failure. Your completed scenes are safe; press Retry on this scene shortly.`;
  }
  if (/timed?\s*out|timeout/i.test(raw)) {
    return `${where}${label} did not return a clip in time. The job may still be running on their side - press Retry, or switch this scene to Text/Graphics to keep the beat.`;
  }
  if (/network|failed to fetch|load failed/i.test(raw)) {
    return `${where}${label} could not be reached from this browser (network error). Check the connection and press Retry.`;
  }
  return `${where}${label} could not generate this scene: ${raw.slice(0, 240)}`;
}

// ---------------------------------------------------------------------------
// Cost estimate
// ---------------------------------------------------------------------------

export interface GenerationEstimate {
  /** Scenes that will actually be generated (already-made clips are free). */
  clips: number;
  /** Total seconds of finished video the run produces. */
  seconds: number;
  /** Workspace credits: the wallet charges 1 credit per second of finished video. */
  credits: number;
  /** Rough provider spend, when the catalogue publishes a per-clip number. */
  usdLow: number;
  usdHigh: number;
  costHint: string;
  providerLabel: string;
}

function usdRange(costHint: string): [number, number] {
  const numbers = (costHint.match(/\d+(?:\.\d+)?/g) || []).map(Number).filter((n) => n > 0 && n < 100);
  if (!numbers.length) return [0, 0];
  return [numbers[0], numbers[numbers.length - 1]];
}

/**
 * What a Generate All run will cost, computed from the scene windows BEFORE
 * anything is submitted. `windows` are the per-scene lengths in seconds for
 * the scenes that still need a clip.
 */
export function estimateGeneration(windows: number[], provider: string): GenerationEstimate {
  const meta = providerMeta(provider);
  const costHint = meta?.costHint || '';
  const [low, high] = usdRange(costHint);
  const clips = windows.length;
  const seconds = windows.reduce((total, span) => total + Math.max(1, Math.round(span || 0)), 0);
  return {
    clips,
    seconds,
    credits: Math.ceil(seconds),
    usdLow: Math.round(low * clips * 100) / 100,
    usdHigh: Math.round(high * clips * 100) / 100,
    costHint,
    providerLabel: meta?.label || providerLabel(provider),
  };
}

/** One line for the Generate All button's confirmation strip. */
export function describeEstimate(estimate: GenerationEstimate): string {
  if (!estimate.clips) return 'Every scene already has its clip — Generate All will not spend anything.';
  const spend = estimate.usdHigh > 0
    ? ` · roughly $${estimate.usdLow.toFixed(2)}${estimate.usdHigh > estimate.usdLow ? `–$${estimate.usdHigh.toFixed(2)}` : ''} of ${estimate.providerLabel} time`
    : '';
  return `${estimate.clips} clip${estimate.clips === 1 ? '' : 's'} · ${estimate.seconds}s of finished video · about ${estimate.credits} credit${estimate.credits === 1 ? '' : 's'}${spend}. Estimated before the run — you are only charged for clips that actually render.`;
}

/** Per-scene wait estimate, used by the "Generating scene 2 of 4" readout. */
export function estimateSecondsPerClip(provider: string): number {
  const meta = providerMeta(provider);
  if (!meta) return 90;
  if (meta.role === 'presenter') return 240;
  if (/fast|lite|seedance/i.test(meta.label)) return 55;
  if (/sora|3\.1$/i.test(meta.label)) return 120;
  return 90;
}

/** Human "about 2m 30s left" from a seconds count. */
export function humanDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

/** Every scene provider that is known-usable right now, for the picker. */
export function usableSceneProviders(statuses: ProviderStatus[]): ProviderStatus[] {
  return statuses.filter((entry) => entry.role === 'scene' && entry.state !== 'unconfigured');
}

export const DEFAULT_SCENE_PROVIDER = GROUP_A_MODELS[0]?.id || 'gemini-omni-flash-preview';
