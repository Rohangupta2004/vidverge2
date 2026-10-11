// CineAgent — every Audos platform endpoint the pipeline talks to.
//
// All of these are documented platform integrations (verified against the
// integration catalog, not invented):
//   /api/upload/file                      footage + asset upload (≤50MB)
//   /api/upload/image                     base64 image upload (durable URL)
//   /api/generate/video-analysis          Gemini whole-video understanding
//   /api/workspaces/:id/audio/transcribe-timestamped   Deepgram word timings
//   /api/video/frames                     ffmpeg frame extraction
//   /api/video/clip                       ffmpeg trim
//   /api/workspaces/:id/videos/stitch     ffmpeg concat
//   /api/veo/generate/video + status      Seedance 2 / Veo 3.1 / Omni Flash
//   /api/veo/generate/image               Gemini image generation
//   /api/workspaces/:id/audio/music/custom  ElevenLabs / Lyria music
//   /api/workspaces/:id/audio/voiceover   ElevenLabs narration
//   /api/render/remotion + status         server-side Remotion render

import { workspaceToken } from './ai';

export const WORKSPACE_ID = 'f24710e5-7c6d-4db4-92b4-c2c235877575';

function tokenHeaders(): Record<string, string> {
  const token = workspaceToken();
  return token ? { 'X-Workspace-DB-Token': token } : {};
}

function jsonHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', ...tokenHeaders() };
}

async function readJson(response: Response): Promise<any> {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.error?.message || data?.error || data?.message || ('HTTP ' + response.status);
    const err = new Error(String(detail));
    (err as any).status = response.status;
    throw err;
  }
  return data;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * The platform injects window.__workspaceDb asynchronously after the app
 * mounts. Starting a run before the token exists used to surface as a
 * "session not ready / sign in" error on the very first click — wait for the
 * bridge (bounded) before anything that needs it.
 */
export async function waitForWorkspaceBridge(timeoutMs = 10000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (workspaceToken()) return true;
    await sleep(250);
  }
  return Boolean(workspaceToken());
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export const UPLOAD_LIMIT_BYTES = 50 * 1024 * 1024;

export async function uploadFile(file: File | Blob, name: string, folder = 'cineagent'): Promise<{ url: string; key: string }> {
  const form = new FormData();
  form.append('file', file, name);
  form.append('workspaceId', WORKSPACE_ID);
  form.append('folder', folder);
  // Public upload: deliberately NO auth header. The route accepts anonymous
  // public uploads, and sending a stale/half-loaded session token here can
  // turn a working upload into a 401 "sign in" error.
  const response = await fetch('/api/upload/file', { method: 'POST', body: form });
  const data = await readJson(response);
  if (!data?.url) throw new Error('Upload did not return a URL.');
  return { url: String(data.url), key: String(data.key || '') };
}

/** Upload a data: URL image and get a durable public GCS URL back. */
export async function uploadImageDataUrl(dataUrl: string, fileName: string): Promise<string> {
  const response = await fetch('/api/upload/image', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ imageData: dataUrl, fileName }),
  });
  const data = await readJson(response);
  if (!data?.imageUrl) throw new Error('Image upload did not return a URL.');
  return String(data.imageUrl);
}

// ---------------------------------------------------------------------------
// Understanding
// ---------------------------------------------------------------------------

/** Gemini whole-video analysis (multipart; handles up to 2GB / ~1hr). */
export async function analyzeVideoFile(file: File, prompt: string): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  form.append('prompt', prompt);
  const response = await fetch('/api/generate/video-analysis', { method: 'POST', headers: tokenHeaders(), body: form });
  const data = await readJson(response);
  if (data?.success === false) throw new Error(String(data?.error || 'Video analysis failed'));
  return String(data?.result || '');
}

export interface DeepgramWord { word: string; start: number; end: number; confidence?: number }

/** Deepgram nova-3 word-level transcription of an audio blob. */
export async function transcribeTimestamped(audio: Blob, fileName: string): Promise<{ transcript: string; words: DeepgramWord[]; duration: number }> {
  const form = new FormData();
  form.append('audio', audio, fileName);
  const response = await fetch('/api/workspaces/' + WORKSPACE_ID + '/audio/transcribe-timestamped', {
    method: 'POST',
    headers: tokenHeaders(),
    body: form,
  });
  const data = await readJson(response);
  return {
    transcript: String(data?.transcript || ''),
    words: Array.isArray(data?.words) ? data.words : [],
    duration: Number(data?.duration || 0),
  };
}

/** Extract PNG stills at the given source timestamps (≤20 per call). */
export async function extractFrames(videoUrl: string, timestamps: number[]): Promise<{ timestamp: number; url: string }[]> {
  const out: { timestamp: number; url: string }[] = [];
  for (let i = 0; i < timestamps.length; i += 20) {
    const batch = timestamps.slice(i, i + 20);
    const response = await fetch('/api/video/frames', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ videoUrl, timestamps: batch, workspaceId: WORKSPACE_ID }),
    });
    const data = await readJson(response);
    (data?.frames || []).forEach((f: any) => {
      if (f?.url) out.push({ timestamp: Number(f.timestamp), url: String(f.url) });
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cutting / assembly (ffmpeg)
// ---------------------------------------------------------------------------

export async function trimClip(videoUrl: string, startSec: number, endSec: number): Promise<{ url: string; durationSec: number }> {
  const response = await fetch('/api/video/clip', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ videoUrlOrKey: videoUrl, startSec, endSec, workspaceId: WORKSPACE_ID }),
  });
  const data = await readJson(response);
  if (!data?.success || !data?.url) throw new Error(String(data?.error || 'Clip failed'));
  return { url: String(data.url), durationSec: Number(data.durationSec || endSec - startSec) };
}

export async function stitchClips(videoUrls: string[]): Promise<string> {
  const response = await fetch('/api/workspaces/' + WORKSPACE_ID + '/videos/stitch', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ videoUrls }),
  });
  const data = await readJson(response);
  if (!data?.success || !data?.stitchedUrl) throw new Error(String(data?.error || 'Stitch failed'));
  return String(data.stitchedUrl);
}

// ---------------------------------------------------------------------------
// Generation (video / image)
// ---------------------------------------------------------------------------

/** Documented model ids on /api/veo/generate/video, in fallback order per preference. */
export const VIDEO_MODEL_LADDERS: Record<string, string[]> = {
  seedance: ['openrouter/bytedance/seedance-2.0-fast', 'veo-3.1-fast-generate-preview', 'gemini-omni-flash-preview'],
  'veo-fast': ['veo-3.1-fast-generate-preview', 'openrouter/bytedance/seedance-2.0-fast', 'gemini-omni-flash-preview'],
  veo: ['veo-3.1-generate-preview', 'veo-3.1-fast-generate-preview', 'openrouter/bytedance/seedance-2.0-fast'],
  omni: ['gemini-omni-flash-preview', 'veo-3.1-fast-generate-preview', 'openrouter/bytedance/seedance-2.0-fast'],
};

export interface VideoGenRequest {
  prompt: string;
  model: string;
  durationSec?: number;
  imageData?: string;          // seed frame (base64 / data: / https URL)
  videoData?: string;          // seed video clip URL — Omni Flash video-to-video
  generateAudio?: boolean;
}

export async function startVideoGeneration(req: VideoGenRequest): Promise<string> {
  const body: Record<string, unknown> = {
    model: req.model,
    prompt: req.prompt,
    aspectRatio: '16:9',
    duration: Math.max(4, Math.min(8, Math.round(req.durationSec || 6))),
    generateAudio: Boolean(req.generateAudio),
    resolution: '1080p',
  };
  if (req.imageData) body.imageData = req.imageData;
  if (req.videoData) body.videoData = req.videoData;
  const response = await fetch('/api/veo/generate/video', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(body),
  });
  const data = await readJson(response);
  if (!data?.operationId) throw new Error(String(data?.error || 'Video generation did not start'));
  return String(data.operationId);
}

export async function pollVideoGeneration(operationId: string, timeoutMs = 360000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const response = await fetch('/api/veo/status/' + encodeURIComponent(operationId), { headers: tokenHeaders() });
    const data = await response.json().catch(() => null);
    if (data?.status === 'completed' && data?.videoUrl) return String(data.videoUrl);
    if (data?.status === 'failed') throw new Error(String(data?.errorMessage || 'Video generation failed'));
    await sleep(5000);
  }
  throw new Error('Video generation timed out.');
}

/** Generate an image; returns a DURABLE GCS URL (data: URLs are re-uploaded). */
export async function generateImage(prompt: string, aspectRatio: '16:9' | '9:16' | '1:1' = '16:9'): Promise<string> {
  const response = await fetch('/api/veo/generate/image', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ model: 'gemini-3.1-flash-image', prompt, aspectRatio }),
  });
  const data = await readJson(response);
  const imageUrl = String(data?.imageUrl || data?.url || '');
  if (!imageUrl) throw new Error(String(data?.error || 'Image generation failed'));
  if (imageUrl.indexOf('data:') === 0) {
    return uploadImageDataUrl(imageUrl, 'cineagent-' + Date.now() + '.jpg');
  }
  return imageUrl;
}

// ---------------------------------------------------------------------------
// Audio generation
// ---------------------------------------------------------------------------

export async function generateMusic(prompt: string, lengthMs: number): Promise<string> {
  const response = await fetch('/api/workspaces/' + WORKSPACE_ID + '/audio/music/custom', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      prompt,
      lengthMs: Math.max(5000, Math.min(600000, Math.round(lengthMs))),
      instrumental: true,
    }),
  });
  const data = await readJson(response);
  if (!data?.audioUrl) throw new Error(String(data?.error || 'Music generation failed'));
  return String(data.audioUrl);
}

export async function generateVoiceover(text: string, voiceId?: string): Promise<{ url: string; durationMs: number }> {
  const response = await fetch('/api/workspaces/' + WORKSPACE_ID + '/audio/voiceover', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(voiceId ? { script: text, voiceId } : { script: text }),
  });
  const data = await readJson(response);
  if (!data?.audioUrl) throw new Error(String(data?.error || 'Voiceover failed'));
  return { url: String(data.audioUrl), durationMs: Number(data.estimatedDurationMs || 0) };
}

// ---------------------------------------------------------------------------
// Remotion rendering
// ---------------------------------------------------------------------------

export async function submitRender(compositionTsx: string, props: unknown, durationInFrames: number): Promise<string> {
  const response = await fetch('/api/render/remotion', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      workspaceId: WORKSPACE_ID,
      compositionTsx,
      props,
      durationInFrames: Math.max(30, Math.min(17990, Math.round(durationInFrames))),
      fps: 30,
      width: 1920,
      height: 1080,
    }),
  });
  const data = await readJson(response);
  if (!data?.operationId) throw new Error(String(data?.error || 'Render did not start'));
  return String(data.operationId);
}

export async function pollRender(
  operationId: string,
  onTick?: (status: string) => void,
  timeoutMs = 2400000,
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const response = await fetch('/api/render/remotion/' + encodeURIComponent(operationId), { headers: tokenHeaders() });
    const data = await response.json().catch(() => null);
    const status = String(data?.status || 'pending');
    if (onTick) onTick(status);
    if (status === 'complete' && data?.videoUrl) return String(data.videoUrl);
    if (status === 'failed') throw new Error(String(data?.error || 'Render failed'));
    await sleep(4000);
  }
  throw new Error('Render timed out.');
}

/**
 * Convert a 1920x1080 master whose portrait content sits centered at full
 * height into a TRUE 1080x1920 MP4. The platform overlay endpoint cover-scales
 * (force_original_aspect_ratio=increase + center crop) and explicitly supports
 * an empty overlay list for exactly this re-encode.
 */
export async function portraitReencode(masterUrl: string, durationSec: number): Promise<string> {
  const response = await fetch('/api/workspaces/' + WORKSPACE_ID + '/videos/overlay', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      base_video_url: masterUrl,
      overlays: [],
      dimensions: { width: 1080, height: 1920 },
      output_format: 'mp4',
      duration_seconds: Math.max(1, Math.round(durationSec)),
    }),
  });
  const data = await readJson(response);
  if (!data?.success || !data?.overlayUrl) throw new Error(String(data?.error || 'Portrait re-encode failed'));
  return String(data.overlayUrl);
}

// ---------------------------------------------------------------------------
// Output verification helpers
// ---------------------------------------------------------------------------

/** Load a video URL in the browser and measure its real duration. */
export function measureVideo(url: string): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('video');
    el.preload = 'metadata';
    el.crossOrigin = 'anonymous';
    const timer = setTimeout(() => reject(new Error('Could not read the video metadata.')), 30000);
    el.onloadedmetadata = () => {
      clearTimeout(timer);
      resolve({ duration: el.duration || 0, width: el.videoWidth || 0, height: el.videoHeight || 0 });
    };
    el.onerror = () => {
      clearTimeout(timer);
      reject(new Error('The video could not be loaded for verification.'));
    };
    el.src = url;
  });
}
