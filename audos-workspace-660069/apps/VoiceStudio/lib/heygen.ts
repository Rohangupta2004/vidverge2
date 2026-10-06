// The HeyGen half of the avatar pipeline. Everything goes through the
// workspace's HeyGen proxy, which injects the account's X-Api-Key server-side,
// so no HeyGen key ever reaches this bundle.
//
// The default pipeline is "ElevenLabs writes the voice, HeyGen lip-syncs an
// avatar to it". That requires HeyGen's legacy v2 request because the strict v3
// schema still has no field for caller-supplied audio. A second, explicit mode
// uses HeyGen's own voice catalog and the supported v3 script + voice_id shape,
// so this tab has a path that survives the announced v1/v2 retirement.
import { workspaceId, workspaceToken } from './runtime';

export class HeyGenError extends Error {
  status: number;
  /** True when the failure says this workspace has no usable HeyGen credential. */
  missingCredential: boolean;
  constructor(message: string, status = 0, missingCredential = false) {
    super(message);
    this.name = 'HeyGenError';
    this.status = status;
    this.missingCredential = missingCredential;
  }
}

const NO_CREDENTIAL = /(?:api[\s_-]?key|credential)s?[^.]{0,48}?(?:missing|not\s+(?:set|configured|found)|unavailable|required)|no\s+(?:heygen\s+)?(?:api[\s_-]?key|credential)|heygen\s+(?:is\s+)?not\s+configured|unauthoriz|invalid\s+api[\s_-]?key/i;

async function heygen(path: string, init?: RequestInit): Promise<any> {
  const token = (window as any).__workspaceDb?.token;
  let response: Response;
  try {
    response = await fetch(`/api/workspaces/${workspaceId()}/provider-credentials/heygen/proxy/${path.replace(/^\/+/, '')}`, {
      ...init,
      headers: {
        // Content-Type only when there IS a body: a bare GET that advertises
        // JSON makes some transports forward an empty {}, which HeyGen rejects.
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { 'X-Workspace-DB-Token': String(token) } : {}),
        ...(init?.headers || {}),
      },
    });
  } catch (e: any) {
    throw new HeyGenError(String(e?.message || 'HeyGen could not be reached.'));
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail =
      payload?.error?.message ||
      payload?.message ||
      (typeof payload?.error === 'string' ? payload.error : '') ||
      `HeyGen request failed (${response.status}).`;
    const credentialStatus = [400, 401, 403, 404].indexOf(response.status) >= 0;
    throw new HeyGenError(String(detail), response.status, credentialStatus && NO_CREDENTIAL.test(String(detail)));
  }
  return payload;
}

// ---------------------------------------------------------------- avatars ----

export type HeyGenApiVersion = 'v2' | 'v3';
export type AvatarVoiceMode = 'elevenlabs' | 'heygen';

export interface AvatarCard {
  id: string;
  name: string;
  gender?: string;
  previewImage?: string;
  previewVideo?: string;
  /** A talking photo rather than a studio avatar — HeyGen keys it differently on v2 renders. */
  talkingPhoto: boolean;
  indian: boolean;
  apiVersion: HeyGenApiVersion;
}

/**
 * HeyGen tags no ethnicity or region on an avatar, so the Indian tab is matched
 * on what each look's own name says. Anything the match misses can be pinned
 * by hand from the card, which is the only honest way to curate a list the
 * provider does not label.
 */
const INDIAN_AVATAR_HINT =
  /\b(ind|india|indian|hindi|desi|bollywood|mumbai|delhi|punjab|tamil|telugu|bengali|marathi|gujarati|kerala|aarav|aditi|aditya|akash|amit|ananya|anil|anjali|anita|arjun|aryan|deepak|dev|dhruv|diya|gaurav|ishaan|kabir|kavya|kiran|krish|lakshmi|manish|meera|neha|nikhil|nisha|pooja|prakash|priya|radha|raj|rahul|ravi|riya|rohan|rohit|sanjay|shreya|simran|sneha|sunita|tara|vikram|vivek|yash|zara)\b/i;

export type AvatarOverrides = Record<string, boolean>;

function avatarIsIndian(name: string, id: string, overrides: AvatarOverrides): boolean {
  if (typeof overrides[id] === 'boolean') return overrides[id];
  return INDIAN_AVATAR_HINT.test(String(name || ''));
}

function pageItems(payload: any): any[] {
  const data = payload?.data ?? payload;
  if (Array.isArray(data)) return data;
  for (const key of ['avatars', 'looks', 'voices', 'items', 'list']) {
    if (Array.isArray(data?.[key])) return data[key];
  }
  return [];
}

function pageToken(payload: any): string {
  const token = payload?.next_token ?? payload?.data?.next_token ?? payload?.next_page_token ?? payload?.data?.next_page_token ?? '';
  return token ? String(token) : '';
}

/** Crawl a v3 catalog by its documented next_token, never by offset. */
async function crawlV3(path: string, limit: number): Promise<any[]> {
  const all: any[] = [];
  const seen = new Set<string>();
  let token = '';
  for (let page = 0; page < 60; page += 1) {
    const query = token ? `${path}?limit=${limit}&token=${encodeURIComponent(token)}` : `${path}?limit=${limit}`;
    const payload = await heygen(query);
    let added = 0;
    for (const item of pageItems(payload)) {
      const id = String(item?.id ?? item?.look_id ?? item?.avatar_id ?? item?.voice_id ?? '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      all.push(item);
      added += 1;
    }
    token = pageToken(payload);
    if (!token || !added) break;
  }
  return all;
}

/**
 * v2 supplies the ids accepted by caller-audio renders. v3 supplies look ids
 * for the native HeyGen-voice mode; the two catalogs are intentionally not
 * mixed because an id accepted by one generation API may be rejected by the
 * other.
 */
export async function listAvatars(overrides: AvatarOverrides, apiVersion: HeyGenApiVersion = 'v2'): Promise<AvatarCard[]> {
  if (apiVersion === 'v3') {
    const looks = await crawlV3('v3/avatars/looks', 50);
    return looks
      .map((raw: any): AvatarCard => {
        const id = String(raw?.id ?? raw?.look_id ?? raw?.avatar_id ?? '');
        const name = String(raw?.name ?? raw?.avatar_name ?? raw?.display_name ?? 'Avatar');
        const avatarType = String(raw?.avatar_type ?? raw?.type ?? '').toLowerCase();
        return {
          id,
          name,
          gender: raw?.gender ? String(raw.gender) : undefined,
          previewImage: raw?.preview_image_url || raw?.preview_image || raw?.thumbnail_url || raw?.image_url || undefined,
          previewVideo: raw?.preview_video_url || raw?.preview_video || undefined,
          talkingPhoto: avatarType.includes('photo'),
          indian: avatarIsIndian(name, id, overrides),
          apiVersion: 'v3',
        };
      })
      .filter((entry) => entry.id)
      .sort((a, b) => Number(b.indian) - Number(a.indian) || a.name.localeCompare(b.name));
  }

  const payload = await heygen('v2/avatars');
  const data = payload?.data || payload || {};
  const avatars: AvatarCard[] = (Array.isArray(data.avatars) ? data.avatars : []).map((raw: any) => {
    const id = String(raw?.avatar_id || '');
    const name = String(raw?.avatar_name || 'Avatar');
    return {
      id,
      name,
      gender: raw?.gender ? String(raw.gender) : undefined,
      previewImage: raw?.preview_image_url ? String(raw.preview_image_url) : undefined,
      previewVideo: raw?.preview_video_url ? String(raw.preview_video_url) : undefined,
      talkingPhoto: false,
      indian: avatarIsIndian(name, id, overrides),
      apiVersion: 'v2',
    };
  });
  const photos: AvatarCard[] = (Array.isArray(data.talking_photos) ? data.talking_photos : []).map((raw: any) => {
    const id = String(raw?.talking_photo_id || '');
    const name = String(raw?.talking_photo_name || 'Talking photo');
    return {
      id,
      name,
      previewImage: raw?.preview_image_url ? String(raw.preview_image_url) : undefined,
      talkingPhoto: true,
      indian: avatarIsIndian(name, id, overrides),
      apiVersion: 'v2',
    };
  });
  const all = [...avatars, ...photos].filter((entry) => entry.id);
  return all.sort((a, b) => Number(b.indian) - Number(a.indian) || a.name.localeCompare(b.name));
}

export interface HeyGenVoiceCard {
  id: string;
  name: string;
  language?: string;
  gender?: string;
  previewAudio?: string;
}

/** Voices accepted by POST /v3/videos, paged independently of ElevenLabs. */
export async function listHeyGenVoices(): Promise<HeyGenVoiceCard[]> {
  const voices = await crawlV3('v3/voices', 100);
  return voices
    .map((raw: any): HeyGenVoiceCard => ({
      id: String(raw?.voice_id ?? raw?.id ?? ''),
      name: String(raw?.name ?? raw?.voice_name ?? raw?.display_name ?? 'HeyGen voice'),
      language: raw?.language || raw?.language_code || raw?.locale || undefined,
      gender: raw?.gender ? String(raw.gender) : undefined,
      previewAudio: raw?.preview_audio_url || raw?.preview_audio || raw?.preview_url || undefined,
    }))
    .filter((voice) => voice.id)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ------------------------------------------------------------------ render ----

export type Orientation = 'landscape' | 'portrait';

export const DIMENSIONS: Record<Orientation, { width: number; height: number; label: string; aspectRatio: '16:9' | '9:16' }> = {
  landscape: { width: 1280, height: 720, label: 'Landscape 16:9', aspectRatio: '16:9' },
  portrait: { width: 1080, height: 1920, label: 'Portrait 9:16', aspectRatio: '9:16' },
};

export interface CreatedVideo {
  videoId: string;
  apiVersion: HeyGenApiVersion;
}

export async function resolveAvatarEngine(avatarId: string): Promise<'avatar_iii' | 'avatar_iv' | 'avatar_v'> {
  const response = await heygen(`v3/avatars/looks/${encodeURIComponent(avatarId)}`);
  const supported = response?.data?.supported_api_engines || response?.supported_api_engines || [];
  const engine = (['avatar_iv', 'avatar_v', 'avatar_iii'] as const).find((candidate) => supported.includes(candidate));
  if (!engine) throw new HeyGenError('This avatar does not report a supported v3 video engine. Choose another presenter.');
  return engine;
}

/** Submit either the default caller-audio v2 render or the native-voice v3 render. */
export async function createAvatarVideo(options: {
  avatar: AvatarCard;
  mode?: AvatarVoiceMode;
  audioUrl?: string;
  script?: string;
  voiceId?: string;
  speed?: number;
  orientation: Orientation;
  backgroundColor: string;
}): Promise<CreatedVideo> {
  const dimension = DIMENSIONS[options.orientation];

  if (options.mode === 'heygen') {
    const script = String(options.script || '').trim();
    const voiceId = String(options.voiceId || '').trim();
    if (!script || !voiceId) throw new HeyGenError('Choose a HeyGen voice and write a script before rendering.');
    const engine = await resolveAvatarEngine(options.avatar.id);
    const payload = await heygen('v3/videos', {
      method: 'POST',
      body: JSON.stringify({
        type: 'avatar',
        avatar_id: options.avatar.id,
        engine: { type: engine },
        script,
        voice_id: voiceId,
        voice_settings: { speed: Math.min(1.5, Math.max(0.5, Number(options.speed) || 1)) },
        resolution: '1080p',
        aspect_ratio: dimension.aspectRatio,
        fit: 'cover',
        background: { type: 'color', value: options.backgroundColor },
        output_format: 'mp4',
      }),
    });
    const videoId = String(payload?.data?.video_id || payload?.video_id || '');
    if (!videoId) throw new HeyGenError('HeyGen accepted the v3 render but returned no data.video_id.');
    return { videoId, apiVersion: 'v3' };
  }

  const audioUrl = String(options.audioUrl || '').trim();
  if (!/^https?:\/\//i.test(audioUrl)) throw new HeyGenError('HeyGen needs a public audio link for the ElevenLabs voice track.');
  const character = options.avatar.talkingPhoto
    ? { type: 'talking_photo', talking_photo_id: options.avatar.id }
    : { type: 'avatar', avatar_id: options.avatar.id, avatar_style: 'normal' };
  const payload = await heygen('v2/video/generate', {
    method: 'POST',
    body: JSON.stringify({
      video_inputs: [
        {
          character,
          voice: { type: 'audio', audio_url: audioUrl },
          background: { type: 'color', value: options.backgroundColor },
        },
      ],
      dimension: { width: dimension.width, height: dimension.height },
    }),
  });
  const videoId = String(payload?.data?.video_id || payload?.video_id || '');
  if (!videoId) throw new HeyGenError('HeyGen accepted the render but returned no video_id.');
  return { videoId, apiVersion: 'v2' };
}

export interface VideoStatus {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  videoUrl?: string;
  thumbnailUrl?: string;
  durationSec?: number;
  error?: string;
}

/** Poll on the status route that matches the endpoint which created the render. */
export async function videoStatus(videoId: string, apiVersion: HeyGenApiVersion = 'v2'): Promise<VideoStatus> {
  const id = encodeURIComponent(videoId);
  const payload = apiVersion === 'v3' ? await heygen(`v3/videos/${id}`) : await heygen(`v1/video_status.get?video_id=${id}`);
  const data = payload?.data || payload || {};
  const raw = String(data?.status || 'processing').toLowerCase();
  const status: VideoStatus['status'] =
    raw === 'completed' ? 'completed' : raw === 'failed' ? 'failed' : raw === 'pending' || raw === 'waiting' ? 'pending' : 'processing';
  const legacyFailure = data?.error;
  const v3Failure = [data?.failure_code, data?.failure_message].filter(Boolean).join(': ');
  return {
    status,
    videoUrl: data?.video_url ? String(data.video_url) : undefined,
    thumbnailUrl: data?.thumbnail_url ? String(data.thumbnail_url) : undefined,
    durationSec: Number(data?.duration) || undefined,
    error: apiVersion === 'v3' ? v3Failure || undefined : legacyFailure ? String(legacyFailure?.message || legacyFailure?.detail || legacyFailure) : undefined,
  };
}

export function heygenNotConfiguredMessage(): string {
  return 'This workspace has no usable HeyGen API key, so avatar rendering is unavailable. Ask Otto to connect your HeyGen key, then reload this tab.';
}

export { heygen };

/** Kept here so both the avatar tab and any future caller agree on the token check. */
export function heygenReady(): boolean {
  try {
    workspaceToken();
    return true;
  } catch {
    return false;
  }
}
