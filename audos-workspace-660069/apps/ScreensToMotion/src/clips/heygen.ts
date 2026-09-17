/**
 * HeyGen presenter (Phase 2 §11, Presenter Mix route only — never the Create
 * app). HeyGen is a native platform integration: everything goes through the
 * same-origin proxy `/api/workspaces/:id/provider-credentials/heygen/proxy/*`,
 * which injects the key server-side. No API key ever touches this code.
 *
 * Flow:
 *  1. Generate a character image with HeyGen's own photo-avatar generator
 *     (api.heygen.com, so it is proxy-reachable AND its image_key can seed an
 *     avatar group — an externally generated image cannot, because HeyGen's
 *     asset-upload host is not proxied).
 *  2. The app shows the image for approval; on approval an avatar group is
 *     created from the approved image_key.
 *  3. The talking-photo look renders a 1920x1080 landscape avatar clip that
 *     enters the timeline as a normal clip scene (conformed, graded, cut on
 *     the beat grid) with audio "duck" — the presenter's voice is the point.
 *
 * Fallback: if photo-avatar generation is unavailable on this HeyGen plan,
 * fall back to the first landscape-capable stock look from the v3 catalog.
 */
import type { IngestedClip } from '../types';
import { probeToClip } from './probe';

export class HeyGenError extends Error {}

function workspaceId(): string {
  return String((window as any).__workspaceDb?.workspaceId || (window as any).__WORKSPACE_ID__ || '');
}

async function heygen(path: string, init?: RequestInit): Promise<any> {
  const response = await fetch(
    `/api/workspaces/${workspaceId()}/provider-credentials/heygen/proxy/${path.replace(/^\/+/, '')}`,
    { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body?.error?.message || body?.message || (typeof body?.error === 'string' ? body.error : null) || `HeyGen request failed (${response.status}).`;
    throw new HeyGenError(message);
  }
  return body;
}

export interface CharacterCandidate {
  imageUrl: string;
  imageKey: string | null;
  /** 'photo-avatar' candidates can seed an avatar group; 'stock-look' cannot. */
  kind: 'photo-avatar' | 'stock-look';
  stockLookId?: string;
}

/** Step 1 — generate a presenter character image for in-app approval. */
export async function generateCharacterImage(brief: string, onProgress?: (message: string) => void): Promise<CharacterCandidate> {
  onProgress?.('Generating a presenter character…');
  try {
    const created = await heygen('v2/photo_avatar/photo/generate', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Screens to Motion presenter',
        age: 'Young Adult',
        gender: 'Woman',
        ethnicity: 'Unspecified',
        orientation: 'horizontal',
        pose: 'half_body',
        style: 'Realistic',
        appearance: `Professional, friendly product presenter for this brief: ${brief.slice(0, 240)}. Studio lighting, plain dark background, chest-up, facing camera. No text or logos anywhere in frame.`,
      }),
    });
    const generationId = created?.data?.generation_id || created?.generation_id;
    if (!generationId) throw new HeyGenError('HeyGen did not return a generation id for the character image.');
    for (let attempt = 0; attempt < 60; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      const status = await heygen(`v2/photo_avatar/generation/${encodeURIComponent(String(generationId))}`);
      const data = status?.data || status;
      const state = String(data?.status || '').toLowerCase();
      onProgress?.(`Character image ${state || 'processing'}…`);
      if (state === 'success' || state === 'completed') {
        const url = data?.image_url_list?.[0] || data?.image_url;
        const key = data?.image_key_list?.[0] || data?.image_key || null;
        if (!url) throw new HeyGenError('HeyGen finished but returned no character image.');
        return { imageUrl: String(url), imageKey: key ? String(key) : null, kind: 'photo-avatar' };
      }
      if (state === 'failed' || state === 'error') throw new HeyGenError(data?.msg || data?.error || 'HeyGen character image generation failed.');
    }
    throw new HeyGenError('HeyGen character image generation timed out.');
  } catch (caught) {
    // Fallback: stock look from the v3 catalog (approval still happens in-app).
    onProgress?.('Photo-avatar generation unavailable — selecting a stock presenter look…');
    const looks = await heygen('v3/avatars/looks?limit=50');
    const list: any[] = looks?.data || [];
    const landscape = list.find((l) => (l?.preferred_orientation || 'landscape') === 'landscape' && Array.isArray(l?.supported_api_engines) && l.supported_api_engines.length > 0) || list[0];
    if (!landscape?.id) throw caught instanceof Error ? caught : new HeyGenError('No HeyGen avatar looks are available.');
    return {
      imageUrl: String(landscape.preview_image_url || landscape.image_url || ''),
      imageKey: null,
      kind: 'stock-look',
      stockLookId: String(landscape.id),
    };
  }
}

async function resolveVoiceId(): Promise<string> {
  const voices = await heygen('v3/voices?limit=100');
  const list: any[] = voices?.data || [];
  const english = list.find((v) => /english/i.test(String(v?.language || ''))) || list[0];
  if (!english?.voice_id) throw new HeyGenError('No HeyGen voices are available.');
  return String(english.voice_id);
}

/** Steps 3–4 — after approval, render the landscape avatar clip and probe it. */
export async function renderAvatarClip(
  approved: CharacterCandidate,
  script: string,
  clipId: string,
  onProgress?: (message: string) => void,
): Promise<IngestedClip> {
  const voiceId = await resolveVoiceId();
  let videoId: string;
  let pollPath: (id: string) => string;
  let readStatus: (body: any) => { state: string; url: string | null; error: string | null };

  if (approved.kind === 'photo-avatar' && approved.imageKey) {
    onProgress?.('Creating the avatar from your approved character…');
    const group = await heygen('v2/photo_avatar/avatar_group/create', {
      method: 'POST',
      body: JSON.stringify({ name: `stm-presenter-${Date.now()}`, image_key: approved.imageKey }),
    });
    const talkingPhotoId = group?.data?.group_id || group?.data?.id || group?.group_id || group?.id;
    if (!talkingPhotoId) throw new HeyGenError('HeyGen did not return an avatar id for the approved character.');
    onProgress?.('Rendering the presenter clip (this takes a few minutes)…');
    const created = await heygen('v2/video/generate', {
      method: 'POST',
      body: JSON.stringify({
        video_inputs: [{
          character: { type: 'talking_photo', talking_photo_id: String(talkingPhotoId) },
          voice: { type: 'text', input_text: script, voice_id: voiceId, speed: 1.0 },
          background: { type: 'color', value: '#0f172a' },
        }],
        dimension: { width: 1920, height: 1080 },
      }),
    });
    videoId = String(created?.data?.video_id || created?.video_id || '');
    pollPath = (id) => `v1/video_status.get?video_id=${encodeURIComponent(id)}`;
    readStatus = (body) => {
      const data = body?.data || {};
      return { state: String(data?.status || '').toLowerCase(), url: data?.video_url ? String(data.video_url) : null, error: data?.error ? (data.error.message || JSON.stringify(data.error)) : null };
    };
  } else {
    // Stock-look fallback: v3 videos, landscape.
    const lookId = approved.stockLookId!;
    const look = await heygen(`v3/avatars/looks/${encodeURIComponent(lookId)}`);
    const supported: string[] = look?.data?.supported_api_engines || look?.supported_api_engines || [];
    const engine = ['avatar_iv', 'avatar_v', 'avatar_iii'].find((candidate) => supported.includes(candidate));
    if (!engine) throw new HeyGenError('The selected stock avatar does not support a v3 video engine.');
    onProgress?.('Rendering the presenter clip (this takes a few minutes)…');
    const created = await heygen('v3/videos', {
      method: 'POST',
      body: JSON.stringify({
        type: 'avatar',
        avatar_id: lookId,
        engine: { type: engine },
        script,
        voice_id: voiceId,
        voice_settings: { speed: 1.0 },
        resolution: '1080p',
        aspect_ratio: '16:9',
        fit: 'cover',
        background: { type: 'color', value: '#0f172a' },
        output_format: 'mp4',
      }),
    });
    videoId = String(created?.data?.video_id || created?.video_id || '');
    pollPath = (id) => `v3/videos/${encodeURIComponent(id)}`;
    readStatus = (body) => {
      const data = body?.data || {};
      return { state: String(data?.status || '').toLowerCase(), url: data?.video_url ? String(data.video_url) : null, error: data?.failure_message ? `${data.failure_code || ''} ${data.failure_message}`.trim() : null };
    };
  }

  if (!videoId) throw new HeyGenError('HeyGen did not return a video id.');
  for (let attempt = 0; attempt < 150; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 6000));
    const status = await heygen(pollPath(videoId));
    const { state, url, error } = readStatus(status);
    onProgress?.(`Presenter clip ${state || 'processing'}…`);
    if ((state === 'completed' || state === 'complete') && url) {
      onProgress?.('Measuring the presenter clip’s true frame rate…');
      return await probeToClip(url, 'heygen', 'presenter.mp4', clipId);
    }
    if (state === 'failed' || state === 'error') throw new HeyGenError(error || 'The HeyGen render failed.');
  }
  throw new HeyGenError('The HeyGen render timed out.');
}
