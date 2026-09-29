// Product Videos — media pipeline: AI stills, chroma-key background removal,
// durable uploads, ElevenLabs voiceover, and the shared five-track music bed
// cache. Story Mode uses none of this any more — it runs entirely in the
// runStoryModePipeline server function; what is left here serves UI Mode.
//
// IMAGE ROUTE (fixed 25 Sep 2026). Stills come from the platform's
// synchronous /api/generate/image proxy. The previous route —
// /api/veo/generate/image with model 'dall-e-3' — is broken platform-side:
// it answers HTTP 200 with { operationId: 'dalle3_image_error_<ts>',
// status: 'failed', message: 'Image generation in progress' } and no image,
// so every generation threw that response's own `message`. That is the exact
// text stored on the first failed Story Mode project.

import { MUSIC_TRACKS } from './prompts';
import { silentAutoCorrect } from '../../../lib/geminiVisionCheck';

const FALLBACK_WORKSPACE_ID = 'f24710e5-7c6d-4db4-92b4-c2c235877575';

export function workspaceToken(): string {
  const token = (window as any).__workspaceDb?.token;
  if (!token) {
    throw new Error('Your workspace session is still loading. Wait a moment, then try again.');
  }
  return String(token);
}

export function activeWorkspaceId(): string {
  return String(
    (window as any).__workspaceDb?.workspaceId ||
      (window as any).__WORKSPACE_ID__ ||
      FALLBACK_WORKSPACE_ID,
  );
}

function apiError(body: any, fallback: string): string {
  const value = body?.error?.message || body?.error || body?.message || body?.errorMessage;
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

// ---------------------------------------------------------------------------
// Scene stills
// ---------------------------------------------------------------------------

export async function generateSceneImage(
  prompt: string,
  aspectRatio: '16:9' | '9:16' | '1:1',
): Promise<string> {
  const draw = async (): Promise<string> => {
    const response = await fetch('/api/generate/image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-DB-Token': workspaceToken(),
        'X-App-Id': String((window as any).__APP_ID__ || (window as any).__SPACE_ID__ || ''),
      },
      body: JSON.stringify({ prompt: prompt.slice(0, 3600), aspectRatio, quality: 'standard' }),
    });
    const body = await response.json().catch(() => null);
    if (response.status === 402) {
      throw new Error('Your workspace wallet needs funds before images can be generated.');
    }
    const imageUrl = body?.imageUrl || body?.url || body?.image_url;
    if (!response.ok || !imageUrl) {
      throw new Error(apiError(body, `Image generation failed (${response.status}).`));
    }
    return String(imageUrl);
  };

  const drawn = await draw();
  // Silent Gemini glance: a still that comes back broken, black or off-topic
  // is drawn once more. Invisible to the customer, and never a blocker.
  const settled = await silentAutoCorrect({ source: drawn, regenerate: draw });
  return settled.url || drawn;
}

// Persist a provider-hosted (possibly short-lived) image onto the platform's
// durable GCS bucket. Best effort: when the source blocks a browser fetch the
// original URL is kept — it is always valid long enough for the immediate render.
export async function persistImage(url: string, fileName: string): Promise<string> {
  if (url.startsWith('https://storage.googleapis.com/')) return url;
  try {
    const dataUrl = url.startsWith('data:') ? url : await fetchAsDataUrl(url);
    const response = await fetch('/api/upload/image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-DB-Token': workspaceToken(),
        'X-App-Id': String((window as any).__APP_ID__ || (window as any).__SPACE_ID__ || ''),
      },
      body: JSON.stringify({ imageData: dataUrl, fileName }),
    });
    const body = await response.json().catch(() => null);
    if (response.ok && body?.imageUrl) return String(body.imageUrl);
  } catch (error) {
    console.warn('[Product Videos] Could not persist a generated image; using the source URL.', error);
  }
  return url;
}

async function fetchAsDataUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download image (${response.status}).`);
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read image bytes.'));
    reader.readAsDataURL(blob);
  });
}

// ---------------------------------------------------------------------------
// In-canvas background removal (chroma key on the near-white backdrop)
// ---------------------------------------------------------------------------
//
// The image generator renders an isolated subject on a plain solid white
// background; the pixels are keyed out in-canvas (alpha 0 above the white
// threshold, a feathered edge below it) and the transparent PNG is stored
// durably on GCS. If the source blocks canvas access (no CORS), the original
// opaque image is used — the scene still layers, just without transparency.
//
// Story Mode no longer calls this: it runs without a tab, so the server
// pipeline uses remove.bg when a REMOVE_BG_API_KEY exists and otherwise keys
// the same white field out inside the Remotion composition with an SVG
// luminance filter cut to these exact thresholds (232 / 205).

export async function removeWhiteBackground(imageUrl: string): Promise<string> {
  try {
    const image = await loadImage(imageUrl);
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) return imageUrl;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const data = pixels.data;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const brightness = Math.min(r, g, b);
      const spread = Math.max(r, g, b) - brightness;
      if (brightness > 232 && spread < 26) {
        data[i + 3] = 0;
      } else if (brightness > 205 && spread < 30) {
        // Feather the edge so the cutout doesn't halo.
        data[i + 3] = Math.round(((232 - brightness) / 27) * 255);
      }
    }
    context.putImageData(pixels, 0, 0);
    const dataUrl = canvas.toDataURL('image/png');
    return await persistImage(dataUrl, `pv-cutout-${Date.now()}.png`);
  } catch (error) {
    console.warn('[Product Videos] Background removal skipped (image not canvas-readable).', error);
    return imageUrl;
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load image for background removal.'));
    image.src = url;
  });
}

// ---------------------------------------------------------------------------
// User uploads (mockup / character reference)
// ---------------------------------------------------------------------------

export async function uploadUserImage(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file, file.name);
  form.append('workspaceId', activeWorkspaceId());
  form.append('folder', 'product-videos');
  const response = await fetch('/api/upload/file', {
    method: 'POST',
    headers: { 'X-Workspace-DB-Token': workspaceToken() },
    body: form,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.url) {
    throw new Error(apiError(body, `Could not upload ${file.name}.`));
  }
  return String(body.url);
}

// ---------------------------------------------------------------------------
// ElevenLabs voiceover (per-scene segments with measured durations)
// ---------------------------------------------------------------------------

export interface VoiceSegment {
  text: string;
  audioUrl: string;
  durationMs: number;
}

export async function generateVoiceover(lines: string[]): Promise<VoiceSegment[]> {
  const response = await fetch(
    `/api/workspaces/${activeWorkspaceId()}/audio/voiceover/segments`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': workspaceToken() },
      body: JSON.stringify({ segments: lines.map((text) => ({ text })), fps: 30 }),
    },
  );
  const body = await response.json().catch(() => null);
  if (response.status === 402) {
    throw new Error('Your workspace wallet needs funds before the voiceover can be recorded.');
  }
  if (!response.ok || !Array.isArray(body?.segments)) {
    throw new Error(apiError(body, `Voiceover generation failed (${response.status}).`));
  }
  return body.segments.map((segment: any, index: number) => ({
    text: String(segment?.text ?? lines[index] ?? ''),
    audioUrl: String(segment?.audioUrl || ''),
    durationMs: Number(segment?.durationMs || 0),
  }));
}

// ---------------------------------------------------------------------------
// Music: five pre-generated instrumental tracks, cached workspace-wide
// ---------------------------------------------------------------------------
//
// Track 0 Inspiring · 1 Cinematic Dark · 2 Energetic · 3 Calm/Ambient ·
// 4 Brand Luxury. Each track is generated ONCE (first session that needs it
// pays once), stored as a durable GCS MP3 URL in the shared pv_music_tracks
// table, and reused by every later video via <Audio src={...} /> in the
// Remotion composition.

export interface MusicTrack {
  trackIndex: number;
  name: string;
  audioUrl: string;
  durationMs: number;
}

function dbClient(): any {
  const db = (window as any).__workspaceDb;
  if (!db) throw new Error('The workspace data client is still loading. Try again in a moment.');
  return db;
}

export async function listCachedTracks(): Promise<MusicTrack[]> {
  const { data } = await dbClient().from('pv_music_tracks', { shared: true }).limit(50).get();
  const rows = Array.isArray(data) ? data : [];
  const byIndex = new Map<number, MusicTrack>();
  for (const row of rows) {
    const index = Number(row?.track_index);
    if (!byIndex.has(index) && row?.audio_url) {
      byIndex.set(index, {
        trackIndex: index,
        name: String(row.name || MUSIC_TRACKS[index]?.name || `Track ${index}`),
        audioUrl: String(row.audio_url),
        durationMs: Number(row.duration_ms || 0),
      });
    }
  }
  return Array.from(byIndex.values()).sort((a, b) => a.trackIndex - b.trackIndex);
}

export async function ensureMusicTrack(trackIndex: number): Promise<MusicTrack> {
  const definition = MUSIC_TRACKS[trackIndex] || MUSIC_TRACKS[0];
  const cached = await listCachedTracks();
  const hit = cached.find((track) => track.trackIndex === definition.index);
  if (hit) return hit;

  const response = await fetch(
    `/api/workspaces/${activeWorkspaceId()}/audio/music/custom`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': workspaceToken() },
      body: JSON.stringify({ prompt: definition.prompt, lengthMs: 62000, instrumental: true }),
    },
  );
  const body = await response.json().catch(() => null);
  if (response.status === 402) {
    throw new Error('Your workspace wallet needs funds before the music bed can be generated.');
  }
  if (!response.ok || !body?.audioUrl) {
    throw new Error(apiError(body, `Music generation failed (${response.status}).`));
  }

  const track: MusicTrack = {
    trackIndex: definition.index,
    name: definition.name,
    audioUrl: String(body.audioUrl),
    durationMs: Number(body.durationMs || 62000),
  };
  try {
    await dbClient().from('pv_music_tracks', { shared: true }).insert({
      track_index: track.trackIndex,
      name: track.name,
      prompt: definition.prompt,
      audio_url: track.audioUrl,
      duration_ms: track.durationMs,
    });
  } catch (error) {
    // A concurrent session may have cached the same slot first — the track URL
    // in hand is still valid for this render.
    console.warn('[Product Videos] Could not cache the music track (already cached?).', error);
  }
  return track;
}

// Fire-and-forget: make sure all five tracks exist so later videos pick any
// mood instantly. Called once per app load; each missing track is generated
// sequentially to stay gentle on the wallet and rate limits.
let warmupStarted = false;
export function warmUpMusicLibrary(): void {
  if (warmupStarted) return;
  warmupStarted = true;
  (async () => {
    try {
      const cached = await listCachedTracks();
      for (const definition of MUSIC_TRACKS) {
        if (!cached.some((track) => track.trackIndex === definition.index)) {
          await ensureMusicTrack(definition.index);
        }
      }
    } catch (error) {
      console.warn('[Product Videos] Music library warm-up paused:', error);
    }
  })();
}
