// The shared spine of SceneForge's HeyGen suite.
//
// WHAT THIS FILE IS FOR. The studio's original HeyGen layer (lib/heygenStudio)
// covers the two endpoints the platform integration documents in full: the
// avatar/voice catalogs and `POST v3/videos`. The suite built on top of it
// reaches for a much wider set of HeyGen capabilities — brand kits, the Video
// Agent, photo avatars, voice cloning, lipsync, translation, HyperFrames and
// the post-production tools. Those live behind the SAME workspace proxy, but
// the platform catalog does not document them, so this app cannot know in
// advance which of them the workspace's HeyGen plan actually answers.
//
// THE RULE THIS FILE ENFORCES: never present an unavailable capability as a
// broken app. Every call goes through `probe`, which remembers — for the
// session and across reloads — whether an endpoint answered, 404'd, or was
// refused by the plan. A capability that is absent is reported to the UI as
// absent, in words a customer can read, and the surrounding feature hides or
// degrades instead of throwing a raw schema error.
//
// TRANSPORT LIMITS THAT SHAPE EVERY CALL BELOW (from the heygen-video
// integration docs):
//   * The proxy supports GET and POST only — there is no DELETE path, so
//     nothing here ever tries to delete a HeyGen resource.
//   * It forwards the path, query string and a JSON body. It is NOT a
//     multipart transport, so raw bytes can never be POSTed to HeyGen
//     through it. Files therefore go to workspace storage first and HeyGen is
//     handed the resulting public URL (see `registerAsset`).
import { HeyGenError, heygen } from './heygenStudio';
import { uploadFile } from './proxy';

export { HeyGenError, heygen };

export const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

/** Every HeyGen capability the suite reaches for beyond the documented core. */
export type Capability =
  | 'assets'
  | 'brand-kits'
  | 'brand-glossaries'
  | 'video-agents'
  // Narrower than an endpoint: the Video Agent exists, but whether it accepts a
  // ready-made `voice: { type: 'audio' }` source is a separate question and a
  // separate verdict (lib/heygenAgent).
  | 'video-agent-audio'
  | 'avatar-photo'
  | 'avatar-prompt'
  | 'avatar-cinematic'
  | 'avatar-groups'
  | 'voice-clone'
  | 'lipsync'
  | 'translation'
  | 'hyperframes'
  | 'music'
  | 'sfx'
  | 'clipping'
  | 'filler-removal'
  | 'batch';

export type CapabilityState = 'unknown' | 'available' | 'unavailable';

const CAP_KEY = 'sceneforge_heygen_caps_v1';
const CAP_OBSERVATION_KEY = 'sceneforge_heygen_cap_observations_v1';

export interface CapabilityObservation {
  state: CapabilityState;
  /** HeyGen's HTTP status when the probe was rejected; 0 on acceptance. */
  status: number;
  /** The exact rejection, or the accepted job id returned by HeyGen. */
  detail: string;
  observedAt: string;
}

function readRecord<T>(key: string): Record<string, T> {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}
function writeRecord(key: string, value: Record<string, unknown>) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode — the session still works */ }
}

let caps: Record<string, CapabilityState> = readRecord<CapabilityState>(CAP_KEY);
let observations: Record<string, CapabilityObservation> = readRecord<CapabilityObservation>(CAP_OBSERVATION_KEY);
const listeners = new Set<() => void>();

export function capabilityState(capability: Capability): CapabilityState {
  return caps[capability] || 'unknown';
}
export function capabilityObservation(capability: Capability): CapabilityObservation | null {
  return observations[capability] ? { ...observations[capability] } : null;
}
export function allCapabilities(): Record<string, CapabilityState> {
  return { ...caps };
}
export function onCapabilityChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function setCapability(capability: Capability, state: CapabilityState, evidence?: { status?: number; detail?: string }) {
  const stateChanged = caps[capability] !== state;
  const observed = evidence ? {
    state,
    status: Number(evidence.status) || 0,
    detail: String(evidence.detail || ''),
    observedAt: new Date().toISOString(),
  } : null;
  if (!stateChanged && !observed) return;
  if (stateChanged) {
    caps = { ...caps, [capability]: state };
    writeRecord(CAP_KEY, caps);
  }
  if (observed) {
    observations = { ...observations, [capability]: observed };
    writeRecord(CAP_OBSERVATION_KEY, observations);
  }
  listeners.forEach((listener) => { try { listener(); } catch { /* a bad listener must not break a render */ } });
}

/**
 * Record a verdict the CALLER established rather than one `probe` inferred.
 *
 * `probe` reads HeyGen's own rejections, which is exactly right for a capability
 * that is either present or absent. Some are narrower than an endpoint — the
 * Video Agent answers, but may refuse an audio voice source — and only the call
 * site can tell a refusal of the FIELD from a refusal of the request. This is
 * how that verdict reaches the registry, so the UI can explain it in words and
 * nothing ever retries it.
 */
export function markCapability(capability: Capability, state: CapabilityState, evidence?: { status?: number; detail?: string }) {
  setCapability(capability, state, evidence);
}

/** Forget what we learned, so a plan upgrade is picked up without a reload. */
export function resetCapabilities() {
  caps = {};
  observations = {};
  writeRecord(CAP_KEY, caps);
  writeRecord(CAP_OBSERVATION_KEY, observations);
  listeners.forEach((listener) => { try { listener(); } catch { /* ignore */ } });
}

/**
 * A rejection that means "this endpoint is not part of this account's HeyGen
 * API" rather than "this request was wrong". 404 and 405 are unambiguous. A
 * 400 is only read as absence when HeyGen's own message says the route or
 * field set is unknown — a 400 about a bad parameter is a real bug in the
 * request and must keep surfacing as one.
 */
function meansUnavailable(error: unknown): boolean {
  const status = Number((error as HeyGenError)?.status) || 0;
  if (status === 404 || status === 405 || status === 501) return true;
  if (status === 402 || status === 403) return true;
  const message = String((error as any)?.message || '');
  if (status === 400) return /not\s+found|unknown\s+(?:endpoint|route|path)|no\s+such|unsupported|not\s+supported|invalid\s+url|not\s+(?:permitted|enabled|available)|upgrade/i.test(message);
  return false;
}

/** True when retrying the same request could plausibly succeed. */
export function retryable(error: unknown): boolean {
  const status = Number((error as HeyGenError)?.status) || 0;
  if (status === 429 || (status >= 500 && status < 600)) return true;
  return /network|timed?\s*out|timeout|failed to fetch/i.test(String((error as any)?.message || ''));
}

export class CapabilityUnavailable extends HeyGenError {
  capability: Capability;
  constructor(capability: Capability, label: string, detail: string) {
    super(`${label} is not available on this workspace's HeyGen plan${detail ? ` (HeyGen said: ${detail.slice(0, 140)})` : ''}.`, 0, false);
    this.name = 'CapabilityUnavailable';
    this.capability = capability;
  }
}

/**
 * Run one capability-gated HeyGen call.
 *
 * A capability already known to be absent short-circuits: the request is not
 * sent again and the caller gets a `CapabilityUnavailable` it can render as a
 * calm "not on your plan" note. Anything else is attempted for real, and the
 * outcome teaches the registry.
 */
export async function probe<T>(capability: Capability, label: string, run: () => Promise<T>): Promise<T> {
  if (caps[capability] === 'unavailable') throw new CapabilityUnavailable(capability, label, '');
  try {
    const result = await run();
    setCapability(capability, 'available');
    return result;
  } catch (e) {
    if (meansUnavailable(e)) {
      setCapability(capability, 'unavailable');
      throw new CapabilityUnavailable(capability, label, String((e as any)?.message || ''));
    }
    throw e;
  }
}

/** POST JSON to a HeyGen path through the proxy. */
export function post(path: string, body: unknown): Promise<any> {
  return heygen(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
}
export function get(path: string): Promise<any> {
  return heygen(path);
}

/** The payload HeyGen wraps results in varies by endpoint; unwrap it once. */
export function body(payload: any): any {
  return payload?.data ?? payload ?? {};
}
export function listOf(payload: any): any[] {
  const data = body(payload);
  if (Array.isArray(data)) return data;
  for (const key of ['items', 'list', 'results', 'data', 'avatars', 'looks', 'voices', 'groups', 'tracks', 'clips', 'options', 'effects', 'scenes', 'languages']) {
    if (Array.isArray(data?.[key])) return data[key];
  }
  return [];
}
/** The job id HeyGen handed back, whatever it chose to call it. */
export function jobIdOf(payload: any): string {
  const data = body(payload);
  return String(
    data.video_id || data.render_id || data.task_id || data.job_id || data.translation_id
    || data.agent_id || data.session_id || data.batch_id || data.id || '',
  );
}
/** The finished asset URL, whatever it chose to call it. */
export function urlOf(payload: any): string {
  const data = body(payload);
  return String(data.video_url || data.output_url || data.audio_url || data.url || data.download_url || data.result_url || '');
}
export function statusOf(payload: any): string {
  const data = body(payload);
  return String(data.status || data.state || '').toLowerCase();
}
export function errorOf(payload: any): string {
  const data = body(payload);
  const failure = data.error;
  if (failure && typeof failure === 'object') return [failure.code, failure.message, failure.detail].filter(Boolean).join(': ');
  return [data.failure_code, data.failure_message || failure, data.message].filter(Boolean).join(': ');
}

const DONE = /^(completed|complete|success|succeeded|done|ready|finished)$/;
const FAILED = /^(failed|error|cancell?ed|rejected)$/;

export interface PollResult { url: string; payload: any }
export interface PollOptions {
  /** Called with 0–1 progress estimate so a caller can drive a bar. */
  onTick?: (elapsedSec: number, status: string) => void;
  intervalMs?: number;
  timeoutMs?: number;
  label?: string;
}

/**
 * Poll a HeyGen job to a terminal state.
 *
 * HeyGen's job endpoints disagree about both the status vocabulary and where
 * the output URL lands, so the terminal test is "a URL appeared" OR "status
 * reads as done/failed" rather than one exact string. A job that returns a
 * URL immediately never costs a second request.
 */
export async function pollJob(path: string, options: PollOptions = {}): Promise<PollResult> {
  const interval = Math.max(1500, options.intervalMs || 4000);
  const timeout = Math.max(interval * 2, options.timeoutMs || 10 * 60 * 1000);
  const label = options.label || 'This job';
  const startedAt = Date.now();
  let misses = 0;
  for (;;) {
    if (Date.now() - startedAt > timeout) {
      throw new HeyGenError(`${label} did not finish within ${Math.round(timeout / 60000)} minutes. It may still complete in HeyGen.`);
    }
    let payload: any;
    try {
      payload = await get(path);
      misses = 0;
    } catch (e) {
      misses += 1;
      // A dropped status read is a hiccup, not a dead job. A job is only
      // abandoned after five consecutive unreadable polls.
      if (misses >= 5 || !retryable(e)) throw e;
      await sleep(interval);
      continue;
    }
    const url = urlOf(payload);
    const status = statusOf(payload);
    if (url && !FAILED.test(status)) return { url, payload };
    if (FAILED.test(status)) throw new HeyGenError(errorOf(payload) || `${label} failed in HeyGen.`);
    if (DONE.test(status) && !url) throw new HeyGenError(`${label} finished but HeyGen returned no output URL.`);
    options.onTick?.(Math.round((Date.now() - startedAt) / 1000), status || 'processing');
    await sleep(interval);
  }
}

// ——— Asset pre-caching ———
//
// Otto's brief asks that a file never be uploaded twice in a session. The key
// is a content fingerprint rather than the file name, so the same bytes picked
// twice — or picked again under a different name — resolve to the cached id.
//
// Two-step by necessity: the HeyGen proxy carries JSON, not multipart, so the
// bytes go to workspace storage (which the app already uses for background
// images) and HeyGen is then asked to register that URL. When HeyGen has no
// asset-registration endpoint on this plan the public URL IS the usable
// handle, and every call site here accepts a URL, so nothing is lost.

export interface CachedAsset {
  /** HeyGen's asset id when the account registers assets; '' otherwise. */
  assetId: string;
  /** Always set: the durable workspace-storage URL for these bytes. */
  url: string;
  name: string;
  contentType: string;
  sizeBytes: number;
}

const ASSET_KEY = 'sceneforge_heygen_assets_v1';
const assetCache = new Map<string, CachedAsset>();

(function hydrateAssetCache() {
  try {
    const raw = window.localStorage.getItem(ASSET_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    Object.entries(parsed || {}).forEach(([key, value]) => {
      const asset = value as CachedAsset;
      if (asset && asset.url) assetCache.set(key, asset);
    });
  } catch { /* a corrupt cache simply starts empty */ }
})();

function persistAssetCache() {
  try {
    const out: Record<string, CachedAsset> = {};
    assetCache.forEach((value, key) => { out[key] = value; });
    window.localStorage.setItem(ASSET_KEY, JSON.stringify(out));
  } catch { /* quota — the in-memory cache still dedupes this session */ }
}

/**
 * A stable fingerprint for a file's CONTENT. `crypto.subtle` is unavailable in
 * the hook sandbox but present in every browser this app runs in; when it is
 * missing (insecure origin) the size/name/mtime triple is a good enough key
 * for in-session dedupe.
 */
export async function fileFingerprint(file: File): Promise<string> {
  try {
    const subtle = (window as any).crypto?.subtle;
    if (subtle) {
      const digest = await subtle.digest('SHA-256', await file.arrayBuffer());
      return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
    }
  } catch { /* fall through to the cheap key */ }
  return `${file.size}-${file.lastModified}-${file.name}`.replace(/\s+/g, '_');
}

/** Ask HeyGen to register an already-public URL and return its asset id. */
async function registerAssetUrl(url: string, contentType: string): Promise<string> {
  const created = await probe('assets', 'HeyGen asset registration', () => post('v3/assets', { url, content_type: contentType }));
  const id = String(body(created).asset_id || body(created).id || '');
  if (!id) throw new HeyGenError('HeyGen accepted the asset but returned no asset id.');
  return id;
}

/**
 * Ask HeyGen to adopt an already-public audio URL as one of its own assets,
 * so an audio-driven render can carry `audio_asset_id` rather than a link.
 *
 * Returns '' when the account has no asset registry. That is NOT a failure
 * and is deliberately not thrown: `POST /v2/video/generate` accepts a plain
 * `audio_url`, so the public URL is already a working voice source and the
 * asset id is only ever an optimisation.
 *
 * There is no byte-upload path from a Space app, and this is why. HeyGen's
 * own upload endpoint lives on `upload.heygen.com` and takes raw bytes; the
 * workspace proxy forwards JSON to `api.heygen.com` only, and a server
 * function cannot stand in for it either — the proxy answers a hook
 * `401 Same-origin request required`, and the hook sandbox has no Buffer,
 * no FormData and no HeyGen credential. Registering a URL is the whole of
 * what is reachable, and it is enough.
 */
export async function registerAudioAsset(url: string, contentType = 'audio/mpeg'): Promise<string> {
  if (!url) return '';
  try { return await registerAssetUrl(url, contentType); }
  catch { return ''; }
}

/**
 * Upload once, reuse forever. Returns the cached entry when these exact bytes
 * were already uploaded in this browser.
 */
export async function cacheAsset(file: File, folder = 'sceneforge-heygen'): Promise<CachedAsset> {
  const key = await fileFingerprint(file);
  const hit = assetCache.get(key);
  if (hit) return hit;

  const uploaded = await uploadFile(file, folder);
  let assetId = '';
  try {
    assetId = await registerAssetUrl(uploaded.url, uploaded.contentType || file.type);
  } catch (e) {
    // No asset registry on this plan is fine — the URL is the handle. Any
    // other failure is also non-fatal here for the same reason, so it is
    // logged rather than thrown and the caller still gets usable bytes.
    if (!(e instanceof CapabilityUnavailable)) {
      console.warn('[SceneForge] HeyGen did not register this asset; using its storage URL instead.', e);
    }
  }
  const asset: CachedAsset = {
    assetId,
    url: uploaded.url,
    name: file.name,
    contentType: uploaded.contentType || file.type,
    sizeBytes: file.size,
  };
  assetCache.set(key, asset);
  persistAssetCache();
  return asset;
}

/** Register raw generated bytes (e.g. a HyperFrames zip) under a fixed key. */
export async function cacheBlobAsset(key: string, blob: Blob, filename: string, folder = 'sceneforge-heygen'): Promise<CachedAsset> {
  const hit = assetCache.get(key);
  if (hit) return hit;
  const asset = await cacheAsset(new File([blob], filename, { type: blob.type || 'application/octet-stream' }), folder);
  assetCache.set(key, asset);
  persistAssetCache();
  return asset;
}

export function cachedAssets(): CachedAsset[] {
  return Array.from(assetCache.values());
}
export function forgetAssets() {
  assetCache.clear();
  try { window.localStorage.removeItem(ASSET_KEY); } catch { /* ignore */ }
}

/** The id generation calls should carry for an asset: HeyGen's, else the URL. */
export function assetHandle(asset: CachedAsset): string {
  return asset.assetId || asset.url;
}

/** A readable one-line reason for any failure this layer can produce. */
export function describeError(error: unknown): string {
  if (error instanceof CapabilityUnavailable) return error.message;
  if (error instanceof HeyGenError && error.missingCredential) {
    return 'This workspace has no usable HeyGen API key yet. Add it in Settings and reopen the studio.';
  }
  return String((error as any)?.message || error || 'Something went wrong talking to HeyGen.');
}
