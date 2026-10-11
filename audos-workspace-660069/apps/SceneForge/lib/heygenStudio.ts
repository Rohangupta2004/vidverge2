// The Avatar Studio's HeyGen layer. Everything here talks to the LIVE HeyGen
// v3 API through the workspace proxy — there is no mock catalog, no sample
// avatar and no fabricated video. The proxy injects the account's HeyGen key
// server-side, so no key ever reaches this bundle.
import { WORKSPACE_ID } from './supabase';
import { avatarView, voiceView, type AvatarView, type VoiceView } from './heygenCatalog';
import { gesturePayload, withGestureFallback, type GestureDirection } from './beatPurpose';

export type { AvatarView, VoiceView };

/** A HeyGen proxy failure, carrying enough shape for the UI to react to it. */
export class HeyGenError extends Error {
  status: number;
  /** True when the failure says this workspace has no usable HeyGen key. */
  missingCredential: boolean;
  constructor(message: string, status = 0, missingCredential = false) {
    super(message);
    this.name = 'HeyGenError';
    this.status = status;
    this.missingCredential = missingCredential;
  }
}

function runtimeWorkspaceId(): string {
  return String((window as any).__workspaceDb?.workspaceId || WORKSPACE_ID);
}
function runtimeToken(): string {
  const token = (window as any).__workspaceDb?.token;
  return token ? String(token) : '';
}

// The proxy adds the key server-side, so an account with no HeyGen credential
// fails at the transport with a message about the credential rather than with
// a HeyGen schema error. That is the one failure the customer can actually
// act on, so it gets its own banner instead of a raw error string.
const NO_CREDENTIAL = /(?:api[\s_-]?key|credential)s?[^.]{0,48}?(?:missing|not\s+(?:set|configured|found)|unavailable|required)|no\s+(?:heygen\s+)?(?:api[\s_-]?key|credential)|heygen\s+(?:is\s+)?not\s+configured|unauthoriz|invalid\s+api[\s_-]?key/i;

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

/** One call against the workspace's HeyGen proxy. */
export async function heygen(path: string, init?: RequestInit): Promise<any> {
  const token = runtimeToken();
  let response: Response;
  try {
    response = await fetch(`/api/workspaces/${runtimeWorkspaceId()}/provider-credentials/heygen/proxy/${path.replace(/^\/+/, '')}`, {
      ...init,
      headers: {
        // Content-Type is only sent when there IS a body: a bare GET that
        // advertises JSON makes some transports forward an empty {}, which
        // HeyGen v3 rejects with "Extra inputs are not permitted".
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { 'X-Workspace-DB-Token': token } : {}),
        ...(init?.headers || {}),
      },
    });
  } catch (e: any) {
    throw new HeyGenError(String(e?.message || 'The HeyGen service could not be reached.'));
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.error?.message || payload?.message || (typeof payload?.error === 'string' ? payload.error : '') || `HeyGen request failed (${response.status})`;
    const credentialStatus = response.status === 400 || response.status === 401 || response.status === 403 || response.status === 404;
    throw new HeyGenError(String(detail), response.status, credentialStatus && NO_CREDENTIAL.test(String(detail)));
  }
  return payload;
}

function retryable(error: unknown): boolean {
  const status = Number((error as HeyGenError)?.status) || 0;
  if (status === 429 || (status >= 500 && status < 600)) return true;
  return /network|timed?\s*out|timeout|failed to fetch/i.test(String((error as any)?.message || ''));
}

async function heygenWithRetry(path: string, attempts = 3): Promise<any> {
  for (let attempt = 0; ; attempt += 1) {
    try { return await heygen(path); }
    catch (e) {
      if (attempt >= attempts - 1 || !retryable(e)) throw e;
      await sleep(1200 * (attempt + 1));
    }
  }
}

function pageItems(payload: any): any[] {
  const data = payload?.data ?? payload;
  if (Array.isArray(data)) return data;
  for (const key of ['avatars', 'looks', 'voices', 'items', 'list']) if (Array.isArray(data?.[key])) return data[key];
  return [];
}
function pageToken(payload: any): string {
  const token = payload?.next_token ?? payload?.data?.next_token ?? payload?.next_page_token ?? payload?.data?.next_page_token ?? '';
  return token ? String(token) : '';
}
function entryId(entry: any): string {
  return String(entry?.id ?? entry?.avatar_id ?? entry?.voice_id ?? entry?.look_id ?? '');
}

/**
 * Crawl a whole v3 catalog. Paging follows the response's `next_token` ONLY:
 * v3 has no offset paging and any extra query parameter is rejected with a
 * 400. The page-size ceiling differs per endpoint — `v3/avatars/looks` caps at
 * 50 while `v3/voices` accepts 100 — so the caller passes the right limit.
 * A page that still fails after retries costs the TAIL of the catalog, not
 * all of it, so a partial list keeps the picker usable.
 */
async function crawl(path: string, limit: number, onPage?: (items: any[]) => void): Promise<{ items: any[]; complete: boolean }> {
  const all: any[] = [];
  const seen = new Set<string>();
  let token = '';
  for (let page = 0; page < 60; page += 1) {
    const query = token ? `${path}?limit=${limit}&token=${encodeURIComponent(token)}` : `${path}?limit=${limit}`;
    let payload: any;
    try { payload = await heygenWithRetry(query); }
    catch (e) {
      if (all.length) return { items: all, complete: false };
      throw e;
    }
    let added = 0;
    for (const item of pageItems(payload)) {
      const id = entryId(item) || JSON.stringify(item);
      if (seen.has(id)) continue;
      seen.add(id);
      all.push(item);
      added += 1;
    }
    if (added && onPage) onPage([...all]);
    token = pageToken(payload);
    if (!token || !added) return { items: all, complete: true };
  }
  return { items: all, complete: !token };
}

/** Every avatar look on the account, delivered page by page as it lands. */
export function fetchAvatarLooks(onPage?: (items: any[]) => void) {
  return crawl('v3/avatars/looks', 50, onPage);
}

/**
 * The voice catalog. `v2/voices` carries the rich metadata the picker shows
 * (display name, language, locale, gender, preview audio) while `v3/voices`
 * is the list a `POST /v3/videos` render will actually accept, so the two are
 * merged: v2 supplies the labels, v3 supplies the verdict. If one side fails
 * the other still fills the picker.
 */
export async function fetchVoices(): Promise<{ voices: any[]; v3Checked: boolean }> {
  const [legacy, modern] = await Promise.allSettled([heygenWithRetry('v2/voices'), crawl('v3/voices', 100)]);
  if (legacy.status === 'rejected' && modern.status === 'rejected') throw legacy.reason;
  const legacyItems = legacy.status === 'fulfilled' ? pageItems(legacy.value) : [];
  const modernItems = modern.status === 'fulfilled' ? modern.value.items : [];
  const v3Checked = modern.status === 'fulfilled' && modernItems.length > 0;
  const v3Ids = new Set(modernItems.map(entryId).filter(Boolean));
  const merged = legacyItems.map((voice) => ({ ...voice, v3_supported: v3Checked ? v3Ids.has(entryId(voice)) : true }));
  const known = new Set(legacyItems.map(entryId).filter(Boolean));
  for (const voice of modernItems) {
    const id = entryId(voice);
    if (id && !known.has(id)) merged.push({ ...voice, v3_supported: true });
  }
  return { voices: merged, v3Checked };
}

// ——— Indian avatar curation ———
// HeyGen tags avatars by neither ethnicity nor country, so the India tab is
// assembled from three honest sources, in order of authority:
//   1. CURATED_INDIAN_AVATAR_IDS — look ids confirmed by hand. Add real ids
//      here as they are verified; an id that is not on the account is simply
//      never matched, so a stale entry costs nothing.
//   2. Pins the customer set in this browser (the flag button on a card).
//   3. A metadata heuristic over the avatar's own name, language, accent,
//      region and tags (lib/heygenCatalog).
// No avatar is ever invented, and the tab never hides anything — it filters
// the live catalog and nothing else.
export const CURATED_INDIAN_AVATAR_IDS: string[] = [];

const PIN_KEY = 'sceneforge_studio_indian_pins_v1';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : (parsed as T);
  } catch { return fallback; }
}
function writeJson(key: string, value: unknown) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode or quota — the session still works */ }
}

export function readIndianPins(): string[] {
  const stored = readJson<string[]>(PIN_KEY, []);
  return Array.isArray(stored) ? stored.filter((id) => typeof id === 'string') : [];
}
export function toggleIndianPin(avatarId: string): string[] {
  const current = readIndianPins();
  const next = current.includes(avatarId) ? current.filter((id) => id !== avatarId) : [...current, avatarId];
  writeJson(PIN_KEY, next);
  return next;
}

/** True when this look belongs in the India tab. */
export function isIndianAvatar(view: AvatarView, pins: string[]): boolean {
  return view.indian || pins.includes(view.id) || CURATED_INDIAN_AVATAR_IDS.includes(view.id);
}

/** The locale/accent label a voice row shows, read off whatever HeyGen sent. */
export function voiceAccent(voice: any): string {
  return String(voice?.locale || voice?.language_code || voice?.accent || '').trim();
}

function indianEnglish(view: VoiceView): boolean {
  const raw = view.raw || {};
  const locale = String(raw.locale || raw.language_code || '').toLowerCase();
  if (locale.startsWith('en-in')) return true;
  return /indian/i.test(`${view.name} ${view.language}`) && /english/i.test(`${view.language} ${raw.language || ''}`);
}

/**
 * The voice the studio opens on: an Indian-English voice when the account has
 * one (the primary market), then any Indian-language voice, then the first
 * voice HeyGen returned. Returns '' only when the catalog is empty.
 */
export function defaultVoiceId(voices: VoiceView[]): string {
  const usable = voices.filter((view) => view.raw?.v3_supported !== false);
  const pool = usable.length ? usable : voices;
  return (pool.find(indianEnglish) || pool.find((view) => view.indian) || pool[0])?.id || '';
}

export type AvatarEngine = 'avatar_iii' | 'avatar_iv' | 'avatar_v';

/**
 * Resolve the render engine for a look before spending a render on it.
 * Omitting `engine` selects Avatar IV — it does NOT make HeyGen pick an engine
 * the avatar supports — and asking for an engine absent from
 * `supported_api_engines` is a hard 400. Preference order is the documented
 * one: Avatar IV has the broadest support, Avatar V is opt-in and mostly for
 * eligible digital twins, Avatar III is the older stock fallback.
 */
export async function resolveAvatarEngine(avatarId: string): Promise<AvatarEngine> {
  const response = await heygen(`v3/avatars/looks/${encodeURIComponent(avatarId)}`);
  const supported = response?.data?.supported_api_engines || response?.supported_api_engines || [];
  const engine = (['avatar_iv', 'avatar_v', 'avatar_iii'] as const).find((candidate) => supported.includes(candidate));
  if (!engine) throw new HeyGenError('This avatar does not report a supported v3 video engine. Choose another avatar.');
  return engine as AvatarEngine;
}

export type BackgroundMode = 'color' | 'image' | 'original';

export interface VideoRequest {
  avatarId: string;
  voiceId: string;
  script: string;
  speed: number;
  resolution: '720p' | '1080p';
  aspectRatio: '9:16' | '16:9';
  backgroundMode: BackgroundMode;
  backgroundColor: string;
  backgroundImageUrl: string;
  /**
   * A PUBLIC audio url that should drive the avatar's mouth INSTEAD of HeyGen
   * reading `script` in `voiceId` — this is how the ElevenLabs voiceover, not
   * HeyGen's own TTS, performs the line. HeyGen fetches it from its own
   * servers, so a `blob:` url made in this tab can never work.
   */
  audioUrl?: string;
  /** HeyGen's own id for the same audio, when the account registers assets. */
  audioAssetId?: string;
  /**
   * How the presenter should DELIVER this beat (lib/beatPurpose): a hook is
   * expressive, a transition is still. Omit it for a whole-film master, where
   * there is no single beat to perform — the per-beat direction belongs on the
   * per-scene renders, which is where the beats actually are.
   */
  gesture?: GestureDirection | null;
}

export type HeyGenApiVersion = 'v3' | 'v2';

export interface CreatedVideo {
  videoId: string;
  /** Null on the audio-driven path: v3 engines do not apply to it. */
  engine: AvatarEngine | null;
  /** Which status route this render can be polled on. */
  apiVersion: HeyGenApiVersion;
}

// v2 takes an explicit pixel `dimension` where v3 takes `resolution` plus
// `aspect_ratio`, so the studio's own resolution choice is translated rather
// than dropped — picking 720p must not silently render 1080p.
function dimensionFor(aspectRatio: '9:16' | '16:9', resolution: '720p' | '1080p'): { width: number; height: number } {
  const long = resolution === '720p' ? 1280 : 1920;
  const short = resolution === '720p' ? 720 : 1080;
  return aspectRatio === '9:16' ? { width: short, height: long } : { width: long, height: short };
}

// The v2 avatar catalog, read at most once per session. It is the set of ids
// `POST /v2/video/generate` will accept, which is NOT guaranteed to be the
// same set as the v3 looks catalog.
let v2AvatarIds: Set<string> | null = null;

async function knownV2Avatars(): Promise<Set<string> | null> {
  if (v2AvatarIds) return v2AvatarIds;
  try {
    const payload = await heygen('v2/avatars');
    const data = payload?.data ?? payload;
    const rows = [
      ...(Array.isArray(data?.avatars) ? data.avatars : []),
      ...(Array.isArray(data?.talking_photos) ? data.talking_photos : []),
      ...(Array.isArray(data) ? data : []),
    ];
    const ids = new Set(rows.map((entry: any) => String(entry?.avatar_id ?? entry?.id ?? entry?.talking_photo_id ?? '')).filter(Boolean));
    if (!ids.size) return null;
    v2AvatarIds = ids;
    return ids;
  } catch {
    // An unreadable catalog must not block a render. HeyGen itself is the
    // authority and rejects an unusable id with its own message.
    return null;
  }
}

/**
 * True when this look can take a ready-made audio track. Unknown counts as
 * supported: the picker should not hide a presenter on a guess.
 */
export async function avatarSupportsAudioVoice(avatarId: string): Promise<boolean> {
  if (!avatarId) return false;
  const known = await knownV2Avatars();
  return !known || known.has(avatarId);
}

/**
 * Submit a render whose VOICE IS A FINISHED AUDIO TRACK.
 *
 * `POST /v3/videos` only takes `script` + `voice_id` — it has no audio voice
 * source at all — so the audio path goes through the still-live v2 endpoint,
 * whose nested `voice` object accepts `{ type: 'audio' }`. That is the whole
 * point of the ElevenLabs pipeline: HeyGen's TTS is never invoked, and the
 * Indian voice the customer auditioned is the one on the finished lips.
 *
 * A v2-created render is polled on `v1/video_status.get`, never on
 * `v3/videos/:id` — which is why CreatedVideo reports its api version.
 */
async function createAudioDrivenVideo(request: VideoRequest): Promise<CreatedVideo> {
  const audioAssetId = String(request.audioAssetId || '').trim();
  const audioUrl = String(request.audioUrl || '').trim();
  if (!audioAssetId && !/^https?:\/\//i.test(audioUrl)) {
    throw new HeyGenError('HeyGen pulls the voice track from its own servers, so it needs a public audio link. This voiceover was not stored anywhere HeyGen can reach.');
  }
  const known = await knownV2Avatars();
  if (known && !known.has(request.avatarId)) {
    throw new HeyGenError('This look is missing from HeyGen\u2019s v2 avatar catalog, and that is the only endpoint that accepts a ready-made audio track as the voice. Pick another presenter, or switch the voice back to HeyGen voices for this look.');
  }
  const imageUrl = request.backgroundImageUrl.trim();
  const background = request.backgroundMode === 'image' && imageUrl
    ? { type: 'image', url: imageUrl }
    : request.backgroundMode === 'color'
      ? { type: 'color', value: request.backgroundColor }
      : null;
  // The gesture fields are attempted and, if HeyGen refuses them on this
  // account, dropped once and remembered — a beat's delivery is worth asking
  // for, and never worth losing a paid render over.
  const created = await withGestureFallback((withGesture) => heygen('v2/video/generate', {
    method: 'POST',
    body: JSON.stringify({
      video_inputs: [{
        character: { type: 'avatar', avatar_id: request.avatarId, avatar_style: 'normal' },
        voice: audioAssetId ? { type: 'audio', audio_asset_id: audioAssetId } : { type: 'audio', audio_url: audioUrl },
        ...(background ? { background } : {}),
        ...(withGesture ? gesturePayload(request.gesture) : {}),
      }],
      dimension: dimensionFor(request.aspectRatio, request.resolution),
    }),
  }));
  const videoId = created?.data?.video_id || created?.video_id;
  if (!videoId) throw new HeyGenError('HeyGen accepted the audio-driven request but did not return a video id.');
  return { videoId: String(videoId), engine: null, apiVersion: 'v2' };
}

/**
 * Submit one avatar render. `POST /v3/videos` rejects every unknown field, so
 * this payload carries the documented contract and nothing else — no v2
 * `dimension`, no `video_inputs`, no nested `voice`.
 *
 * A request carrying audio is handed to the v2 path above instead, because
 * v3 has nowhere to put it.
 */
export async function createAvatarVideo(request: VideoRequest): Promise<CreatedVideo> {
  if (request.audioUrl || request.audioAssetId) return createAudioDrivenVideo(request);
  const engine = await resolveAvatarEngine(request.avatarId);
  const imageUrl = request.backgroundImageUrl.trim();
  const background = request.backgroundMode === 'image' && imageUrl
    ? { type: 'image', url: imageUrl }
    : request.backgroundMode === 'color'
      ? { type: 'color', value: request.backgroundColor }
      : null;
  const bodyFor = (withGesture: boolean) => ({
    type: 'avatar',
    avatar_id: request.avatarId,
    engine: { type: engine },
    script: request.script.trim(),
    voice_id: request.voiceId,
    voice_settings: { speed: Math.min(1.5, Math.max(0.5, Number(request.speed) || 1)) },
    resolution: request.resolution,
    aspect_ratio: request.aspectRatio,
    // Portrait masters must FILL the frame: 'contain' letterboxes the
    // presenter and those bars are burned into the pixels forever.
    fit: 'cover',
    ...(background ? { background } : {}),
    output_format: 'mp4',
    // v3 rejects unknown fields outright, so the gesture direction is offered
    // and withdrawn once if this account will not take it.
    ...(withGesture ? gesturePayload(request.gesture) : {}),
  });
  const created = await withGestureFallback((withGesture) => heygen('v3/videos', { method: 'POST', body: JSON.stringify(bodyFor(withGesture)) }));
  const videoId = created?.data?.video_id || created?.video_id;
  if (!videoId) throw new HeyGenError('HeyGen accepted the request but did not return a video id.');
  return { videoId: String(videoId), engine, apiVersion: 'v3' };
}

export interface VideoStatus {
  status: string;
  videoUrl: string;
  thumbnailUrl: string;
  duration: number;
  error: string;
}

// A v3-created render is polled on `v3/videos/:id`; the `v1/video_status.get`
// envelope is the legacy path kept for v2-created renders. The first endpoint
// that answers is remembered, so the fallback is never paid for twice.
let statusRoute: 'v3' | 'v1' | '' = '';

function fromV3(payload: any): VideoStatus {
  const video = payload?.data || payload || {};
  return {
    status: String(video.status || 'processing'),
    videoUrl: String(video.video_url || ''),
    thumbnailUrl: String(video.thumbnail_url || ''),
    duration: Number(video.duration) || 0,
    error: [video.failure_code, video.failure_message].filter(Boolean).join(': '),
  };
}
function fromV1(payload: any): VideoStatus {
  const video = payload?.data || payload || {};
  const failure = video.error;
  const detail = failure && typeof failure === 'object'
    ? [failure.code, failure.message, failure.detail].filter(Boolean).join(': ')
    : String(failure || '');
  return {
    status: String(video.status || 'processing'),
    videoUrl: String(video.video_url || ''),
    thumbnailUrl: String(video.thumbnail_url || ''),
    duration: Number(video.duration) || 0,
    error: detail,
  };
}

export async function fetchVideoStatus(videoId: string, apiVersion?: HeyGenApiVersion): Promise<VideoStatus> {
  const id = encodeURIComponent(videoId);
  // A caller that KNOWS how the render was created skips the probe entirely:
  // a v2 render does not exist on the v3 route and vice versa, and the
  // remembered `statusRoute` is a single global that cannot describe both at
  // once once a session mixes the two paths.
  if (apiVersion === 'v2') return fromV1(await heygen(`v1/video_status.get?video_id=${id}`));
  if (apiVersion === 'v3') return fromV3(await heygen(`v3/videos/${id}`));
  if (statusRoute === 'v1') return fromV1(await heygen(`v1/video_status.get?video_id=${id}`));
  try {
    const payload = await heygen(`v3/videos/${id}`);
    statusRoute = 'v3';
    return fromV3(payload);
  } catch (e) {
    if (statusRoute === 'v3' || (e as HeyGenError)?.missingCredential || retryable(e)) throw e;
    const payload = await heygen(`v1/video_status.get?video_id=${id}`);
    statusRoute = 'v1';
    return fromV1(payload);
  }
}

// ——— History ———
// The last five finished renders, per workspace, in this browser. HeyGen's
// own library is the system of record; this is the quick way back to what the
// customer just made.
export interface HistoryEntry {
  videoId: string;
  videoUrl: string;
  thumbnailUrl: string;
  script: string;
  avatarName: string;
  voiceName: string;
  aspectRatio: string;
  createdAt: string;
}

export const HISTORY_LIMIT = 5;
const historyKey = () => `sceneforge_studio_history_v1:${runtimeWorkspaceId()}`;

export function readHistory(): HistoryEntry[] {
  const stored = readJson<HistoryEntry[]>(historyKey(), []);
  return Array.isArray(stored) ? stored.filter((entry) => entry && entry.videoUrl).slice(0, HISTORY_LIMIT) : [];
}
export function pushHistory(entry: HistoryEntry): HistoryEntry[] {
  const next = [entry, ...readHistory().filter((old) => old.videoId !== entry.videoId)].slice(0, HISTORY_LIMIT);
  writeJson(historyKey(), next);
  return next;
}
export function clearHistory(): HistoryEntry[] {
  writeJson(historyKey(), []);
  return [];
}

/**
 * Polish a script with the workspace AI proxy. The reply replaces the script
 * only when it comes back as usable spoken text — a refusal or an empty
 * answer leaves what the customer wrote untouched.
 */
export async function improveScript(script: string, maxChars: number): Promise<string> {
  const token = runtimeToken();
  if (!token) throw new Error('Your workspace session is not ready yet. Try again in a moment.');
  const response = await fetch('/proxy/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
    body: JSON.stringify({
      model: 'gpt-5.6-terra',
      reasoning_effort: 'none',
      max_completion_tokens: 1200,
      stream: false,
      messages: [
        {
          role: 'system',
          content: [
            'You rewrite scripts that a HeyGen presenter avatar will read aloud, word for word.',
            'Keep the speaker\u2019s meaning, facts and intent. Make it clearer, warmer and easier to listen to: short spoken sentences, a hook in the first line, one clear close.',
            'Write only the spoken words. No headings, no markdown, no stage directions, no speaker labels, no emoji.',
            `Stay under ${maxChars} characters.`,
            'Reply with the rewritten script and nothing else.',
          ].join(' '),
        },
        { role: 'user', content: script },
      ],
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.error?.message || payload?.message || `The script assistant is unavailable (${response.status}).`;
    throw new Error(String(detail));
  }
  const text = String(payload?.choices?.[0]?.message?.content || '').trim().replace(/^```[a-z]*\s*|\s*```$/gi, '').trim();
  if (!text) throw new Error('The script assistant returned an empty rewrite. Your script is unchanged.');
  return text.slice(0, maxChars);
}

/**
 * Save the finished MP4. HeyGen serves it from another origin, where the
 * `download` attribute is ignored, so the bytes are fetched and handed to the
 * browser as a blob; if that read is blocked the file opens in a new tab
 * instead of failing silently.
 */
export async function downloadVideo(url: string, filename: string, refreshUrl?: () => Promise<string>): Promise<string> {
  let source = url;
  let refreshed = false;
  for (;;) {
    let response: Response;
    try { response = await fetch(source); }
    catch {
      // A cross-origin browser block is not evidence that the signature
      // expired. Preserve the existing open-in-a-tab fallback in that case.
      window.open(source, '_blank', 'noopener');
      return source;
    }
    if (!response.ok && refreshUrl && !refreshed) {
      source = await refreshUrl();
      refreshed = true;
      continue;
    }
    if (!response.ok) {
      window.open(source, '_blank', 'noopener');
      return source;
    }
    try {
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
      return source;
    } catch {
      window.open(source, '_blank', 'noopener');
      return source;
    }
  }
}

export { avatarView, voiceView };
