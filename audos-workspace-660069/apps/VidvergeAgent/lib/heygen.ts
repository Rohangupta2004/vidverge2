/**
 * HeyGen client for the Vidverge Agent hub.
 *
 * Every call is made server-side: either through the workspace secrets proxy
 * (the founder's own `HEYGEN_API_KEY`) or through the platform's HeyGen
 * provider-credential proxy. No key value ever reaches this file.
 *
 * The transport is probed once and latched, so a workspace that has only one
 * of the two configured does not pay for a double round trip on every call.
 */

export const HEYGEN_NOT_CONNECTED = 'HeyGen not connected — skipping avatar options.';

/** Proxy rejections that mean the key is unusable as configured, not that the request was wrong. */
const CONFIG_FAILURE_CODES = new Set(['unknown_secret', 'no_allowed_hosts', 'host_not_allowed']);

export type HeygenVerdict = 'missing' | 'rejected' | 'host-not-allowed';

/** Thrown only when HeyGen cannot be reached at all — callers fall back to the keyless flow. */
export class HeygenUnavailableError extends Error {
  verdict: HeygenVerdict;

  constructor(verdict: HeygenVerdict, message: string) {
    super(message);
    this.name = 'HeygenUnavailableError';
    this.verdict = verdict;
  }
}

type Transport = 'secrets' | 'platform';

interface HeygenRequest {
  path: string;
  method?: 'GET' | 'POST';
  json?: unknown;
}

let activeTransport: Transport | null = null;
let latchedUnavailable: HeygenUnavailableError | null = null;

function runtime(): { workspaceId: string; token: string } {
  const db = (window as any).__workspaceDb;
  return {
    workspaceId: String(db?.workspaceId || (window as any).__WORKSPACE_ID__ || ''),
    token: String(db?.token || ''),
  };
}

function upstreamMessage(body: any, status: number): string {
  const detail =
    body?.error?.message ||
    body?.data?.error?.message ||
    (typeof body?.error === 'string' ? body.error : '') ||
    body?.message ||
    '';
  return detail ? `HeyGen returned ${status}: ${String(detail).slice(0, 200)}` : `HeyGen returned ${status}.`;
}

async function viaSecretsProxy({ path, method = 'GET', json }: HeygenRequest): Promise<any> {
  const { workspaceId, token } = runtime();
  if (!workspaceId || !token) throw new HeygenUnavailableError('missing', HEYGEN_NOT_CONNECTED);

  const payload: Record<string, unknown> = {
    method,
    url: `https://api.heygen.com/${path.replace(/^\/+/, '')}`,
    headers: { 'X-Api-Key': '{{secrets.HEYGEN_API_KEY}}' },
  };
  if (method !== 'GET' && json !== undefined) payload.json = json;

  const response = await fetch(`/api/workspaces/${workspaceId}/secrets/proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
    body: JSON.stringify(payload),
  });
  const envelope = await response.json().catch(() => null);

  if (!response.ok) {
    const code = String(envelope?.code || '');
    if (CONFIG_FAILURE_CODES.has(code)) {
      throw code === 'unknown_secret'
        ? new HeygenUnavailableError('missing', HEYGEN_NOT_CONNECTED)
        : new HeygenUnavailableError(
            'host-not-allowed',
            'HEYGEN_API_KEY is not allowed to call api.heygen.com — add that host to the key.',
          );
    }
    throw new Error(`HeyGen request failed (${code || response.status}).`);
  }

  const status = Number(envelope?.status || 0);
  if (status === 401 || status === 403) {
    throw new HeygenUnavailableError('rejected', 'HeyGen rejected the stored HEYGEN_API_KEY.');
  }
  const body = envelope?.encoding === 'base64' ? null : envelope?.body;
  if (status >= 400) throw new Error(upstreamMessage(body, status));
  return body;
}

async function viaPlatformProxy({ path, method = 'GET', json }: HeygenRequest): Promise<any> {
  const { workspaceId, token } = runtime();
  if (!workspaceId) throw new HeygenUnavailableError('missing', HEYGEN_NOT_CONNECTED);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['X-Workspace-DB-Token'] = token;

  const response = await fetch(
    `/api/workspaces/${workspaceId}/provider-credentials/heygen/proxy/${path.replace(/^\/+/, '')}`,
    {
      method,
      headers,
      body: method === 'GET' || json === undefined ? undefined : JSON.stringify(json),
    },
  );
  const body = await response.json().catch(() => null);

  if (response.status === 401 || response.status === 403) {
    throw new HeygenUnavailableError('rejected', 'HeyGen rejected this workspace credential.');
  }
  if (!response.ok) throw new Error(upstreamMessage(body, response.status));
  return body;
}

async function heygenRequest(request: HeygenRequest): Promise<any> {
  if (latchedUnavailable) throw latchedUnavailable;

  const order: Transport[] = activeTransport ? [activeTransport] : ['secrets', 'platform'];
  let lastError: unknown = null;

  for (const transport of order) {
    try {
      const body = await (transport === 'secrets' ? viaSecretsProxy(request) : viaPlatformProxy(request));
      activeTransport = transport;
      return body;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof HeygenUnavailableError) latchedUnavailable = lastError;
  throw lastError instanceof Error ? lastError : new Error('HeyGen request failed.');
}

export function heygenErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof HeygenUnavailableError) return error.message;
  const message = error instanceof Error ? error.message : '';
  return message || fallback;
}

/* ------------------------------------------------------------------ catalog */

export interface HeygenAvatar {
  id: string;
  name: string;
  previewImage: string;
  gender: string;
  kind: 'avatar' | 'photo';
}

export interface HeygenVoice {
  id: string;
  name: string;
  language: string;
  gender: string;
  previewAudio: string;
}

function toAvatar(row: any, kind: 'avatar' | 'photo'): HeygenAvatar {
  return {
    id: String(row?.avatar_id ?? row?.talking_photo_id ?? row?.id ?? ''),
    name: String(row?.avatar_name || row?.talking_photo_name || row?.name || row?.display_name || 'Untitled character'),
    previewImage: String(row?.preview_image_url || row?.image_url || row?.thumbnail_url || row?.preview_url || ''),
    gender: String(row?.gender || '').trim(),
    kind,
  };
}

function toVoice(row: any): HeygenVoice {
  const language = [row?.language, row?.locale, row?.accent]
    .map((part: unknown) => String(part || '').trim())
    .filter(Boolean);
  return {
    id: String(row?.voice_id ?? row?.id ?? ''),
    name: String(row?.name || row?.display_name || 'Untitled voice'),
    language: Array.from(new Set(language)).join(' · ') || 'Language unlabelled',
    gender: String(row?.gender || '').trim(),
    previewAudio: String(row?.preview_audio || row?.preview_url || row?.sample_url || ''),
  };
}

export async function listHeygenAvatars(): Promise<HeygenAvatar[]> {
  const body = await heygenRequest({ path: 'v2/avatars' });
  const data = body?.data ?? body;
  const avatars = Array.isArray(data?.avatars) ? data.avatars : [];
  const photos = Array.isArray(data?.talking_photos) ? data.talking_photos : [];
  const flat = !avatars.length && !photos.length && Array.isArray(data) ? data : [];

  return [
    ...avatars.map((row: any) => toAvatar(row, 'avatar')),
    ...photos.map((row: any) => toAvatar(row, 'photo')),
    ...flat.map((row: any) => toAvatar(row, 'avatar')),
  ]
    .filter((avatar) => avatar.id)
    .sort(
      (a, b) =>
        Number(Boolean(b.previewImage)) - Number(Boolean(a.previewImage)) || a.name.localeCompare(b.name),
    );
}

export async function listHeygenVoices(): Promise<HeygenVoice[]> {
  const body = await heygenRequest({ path: 'v2/voices' });
  const data = body?.data ?? body;
  const rows = Array.isArray(data?.voices) ? data.voices : Array.isArray(data) ? data : [];
  return rows
    .map(toVoice)
    .filter((voice: HeygenVoice) => voice.id)
    .sort((a: HeygenVoice, b: HeygenVoice) => a.name.localeCompare(b.name));
}

/* --------------------------------------------------------------- generation */

export type HeygenApiVersion = 'v3' | 'v2';

export interface HeygenRenderTicket {
  videoId: string;
  api: HeygenApiVersion;
}

export interface HeygenRenderStatus {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  videoUrl: string;
  thumbnailUrl: string;
  error: string;
}

/** v3 engine ids in the order the integration docs recommend trying them. */
const V3_ENGINES = ['avatar_iv', 'avatar_v', 'avatar_iii'];

/**
 * v3 rejects an engine the look does not list, so the engine is always read
 * from the look itself. A look that cannot be resolved falls back to v2.
 */
async function resolveLook(avatarId: string): Promise<{ engine: string; defaultVoiceId: string } | null> {
  try {
    const body = await heygenRequest({ path: `v3/avatars/looks/${encodeURIComponent(avatarId)}` });
    const look = body?.data ?? body;
    const supported: string[] = Array.isArray(look?.supported_api_engines)
      ? look.supported_api_engines.map((value: unknown) => String(value))
      : [];
    const engine = V3_ENGINES.find((candidate) => supported.includes(candidate));
    if (!engine) return null;
    return { engine, defaultVoiceId: String(look?.default_voice_id || '') };
  } catch (error) {
    if (error instanceof HeygenUnavailableError) throw error;
    return null;
  }
}

function readVideoId(body: any): string {
  return String(body?.data?.video_id || body?.video_id || body?.data?.id || '');
}

export async function createHeygenVideo(input: {
  avatarId: string;
  voiceId?: string;
  script: string;
}): Promise<HeygenRenderTicket> {
  const script = input.script.trim();
  if (!script) throw new Error('Write the script or brief the character should say.');

  const look = await resolveLook(input.avatarId);
  const voiceId = input.voiceId || look?.defaultVoiceId || '';

  if (look) {
    try {
      const body = await heygenRequest({
        method: 'POST',
        path: 'v3/videos',
        json: {
          type: 'avatar',
          avatar_id: input.avatarId,
          engine: { type: look.engine },
          script,
          ...(voiceId ? { voice_id: voiceId, voice_settings: { speed: 1.0 } } : {}),
          resolution: '1080p',
          aspect_ratio: '9:16',
          fit: 'cover',
          output_format: 'mp4',
        },
      });
      const videoId = readVideoId(body);
      if (videoId) return { videoId, api: 'v3' };
    } catch (error) {
      if (error instanceof HeygenUnavailableError) throw error;
    }
  }

  if (!voiceId) {
    throw new Error('Pick a HeyGen voice — this character has no default voice to fall back on.');
  }

  const body = await heygenRequest({
    method: 'POST',
    path: 'v2/video/generate',
    json: {
      video_inputs: [
        {
          character: { type: 'avatar', avatar_id: input.avatarId, avatar_style: 'normal' },
          voice: { type: 'text', input_text: script, voice_id: voiceId, speed: 1.0 },
        },
      ],
      dimension: { width: 1080, height: 1920 },
    },
  });
  const videoId = readVideoId(body);
  if (!videoId) throw new Error('HeyGen accepted the render but returned no video id.');
  return { videoId, api: 'v2' };
}

export async function getHeygenVideoStatus(ticket: HeygenRenderTicket): Promise<HeygenRenderStatus> {
  const body = await heygenRequest({
    path:
      ticket.api === 'v3'
        ? `v3/videos/${encodeURIComponent(ticket.videoId)}`
        : `v1/video_status.get?video_id=${encodeURIComponent(ticket.videoId)}`,
  });
  const data = body?.data ?? body ?? {};
  const raw = String(data?.status || 'pending').toLowerCase();
  const status: HeygenRenderStatus['status'] =
    raw === 'completed' || raw === 'done' || raw === 'success'
      ? 'completed'
      : raw === 'failed' || raw === 'error'
        ? 'failed'
        : raw === 'processing'
          ? 'processing'
          : 'pending';

  const failure =
    data?.failure_message ||
    data?.error?.message ||
    (typeof data?.error === 'string' ? data.error : '') ||
    '';

  return {
    status,
    videoUrl: String(data?.video_url || ''),
    thumbnailUrl: String(data?.thumbnail_url || ''),
    error: String(failure || ''),
  };
}
