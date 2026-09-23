/**
 * ADS STUDIO — Veo layer. Clip generation through the platform's
 * schema-validated video proxy (integration: google-veo3):
 *
 *   submit:  POST /api/veo/generate/video       → { operationId }
 *   poll:    GET  /api/veo/status/:operationId  → { status, videoUrl }
 *
 * Model: gemini-omni-flash-preview — the only video model the platform
 * accepts (the retired veo-3.x ids answer 400). The avatar reference image
 * travels as imageData (a public https URL the proxy downloads) so the same
 * presenter opens every clip; textual continuity notes ride inside the prompt.
 *
 * Also holds the browser-side frame utilities the agentic loop needs:
 * last-frame extraction (continuity context for Opus) and duration probing.
 */

import { uploadDataUrl, wsToken } from './api';

/** The exact model id every Ads Studio clip renders on — exported so the
 * pipeline can RECORD the actual model used on each generated clip. */
export const VEO_MODEL = 'gemini-omni-flash-preview';

// The proxy rejects prompts over 1000 characters ("String must contain at
// most 1000 character(s)"), so every prompt is capped BEFORE submission.
// Cuts land on a sentence or word boundary so the prompt still reads whole.
const VEO_PROMPT_MAX = 1000;
export function capVeoText(text: string, max = VEO_PROMPT_MAX): string {
  const t = String(text || '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'));
  if (sentence > max * 0.6) return cut.slice(0, sentence + 1).trim();
  const space = cut.lastIndexOf(' ');
  return (space > 0 ? cut.slice(0, space) : cut).trim();
}

export async function submitVeo(params: {
  prompt: string;
  negative?: string;
  aspect: '9:16' | '16:9' | '1:1';
  durationS: number;
  referenceImageUrl?: string | null;
  /** Exact platform model id — defaults to the proven Omni Flash. */
  model?: string;
}): Promise<string> {
  // The video model renders 4–8s clips; a 10s script clip renders at the 8s cap.
  const duration = Math.min(8, Math.max(4, Math.round(params.durationS || 6)));
  const body: Record<string, unknown> = {
    model: params.model || VEO_MODEL,
    prompt: capVeoText(params.prompt),
    aspectRatio: params.aspect,
    duration,
    generateAudio: true,
    // The default safety level false-positives on seeded reference frames.
    safetyFilterLevel: 'block_only_high',
  };
  if (params.negative) body.negativePrompt = capVeoText(params.negative, 500);
  if (params.referenceImageUrl && /^https:\/\//.test(params.referenceImageUrl)) body.imageData = params.referenceImageUrl;
  let res: Response;
  try {
    res = await fetch('/api/veo/generate/video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': wsToken() },
      body: JSON.stringify(body),
    });
  } catch (e: any) {
    throw new Error(`Could not reach the video service: ${String(e?.message || e)}`);
  }
  const data = await res.json().catch(() => null);
  const operationId = data && (data.operationId || data.operation_id);
  // The proxy can answer 200 OK with a placeholder id prefixed veo_video_error_
  // (or status "failed") when the provider submission itself failed.
  const failed = String(data?.status || '').toLowerCase() === 'failed';
  if (res.ok && typeof operationId === 'string' && operationId && !failed && !operationId.startsWith('veo_video_error_')) {
    return operationId;
  }
  throw new Error(String(data?.errorMessage || data?.error || data?.message || `Veo submit failed (HTTP ${res.status})`));
}

interface VeoStatus { status: 'processing' | 'completed' | 'failed'; videoUrl?: string; error?: string }

async function checkVeo(operationId: string): Promise<VeoStatus> {
  const res = await fetch(`/api/veo/status/${encodeURIComponent(operationId)}`);
  const data = await res.json().catch(() => null);
  if (res.status === 404) return { status: 'failed', error: 'The video service has no record of this render (404). Regenerate the clip.' };
  if (!res.ok) return { status: 'processing', error: String(data?.error || `status HTTP ${res.status}`) };
  const status = String(data?.status || '').toLowerCase();
  if (status === 'completed' && data?.videoUrl) return { status: 'completed', videoUrl: String(data.videoUrl) };
  if (status === 'failed' || status === 'error') return { status: 'failed', error: String(data?.errorMessage || data?.error || 'The render failed at the provider.') };
  return { status: 'processing' };
}

/** Poll a submitted Veo operation to completion; resolves with the clip URL. */
export async function pollVeo(operationId: string, timeoutMs = 8 * 60 * 1000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let misses = 0;
  while (Date.now() < deadline) {
    const st = await checkVeo(operationId);
    if (st.status === 'completed' && st.videoUrl) return st.videoUrl;
    if (st.status === 'failed') throw new Error(st.error || 'The render failed.');
    if (st.error) { misses += 1; if (misses >= 6) throw new Error(`The video service stopped answering: ${st.error}`); }
    else misses = 0;
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error('The render took too long (8 minutes). Regenerate the clip to retry.');
}

// ---------------------------------------------------------------------------
// Frame extraction + duration probing (hidden <video> + canvas)
// ---------------------------------------------------------------------------

function seekTo(video: HTMLVideoElement, t: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => { if (settled) return; settled = true; clearTimeout(giveUp); video.removeEventListener('seeked', onSeeked); resolve(ok); };
    const onSeeked = () => setTimeout(() => finish(true), 80);
    const giveUp = setTimeout(() => finish(false), 8000);
    video.addEventListener('seeked', onSeeked);
    try { video.currentTime = t; } catch { finish(false); }
  });
}

function openVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.preload = 'auto';
    (video as any).playsInline = true;
    const guard = setTimeout(() => reject(new Error('The clip took too long to load for frame capture.')), 60000);
    video.onerror = () => { clearTimeout(guard); reject(new Error('The clip could not be decoded in this browser.')); };
    video.onloadedmetadata = () => { clearTimeout(guard); resolve(video); };
    video.src = url;
  });
}

function releaseVideo(video: HTMLVideoElement) {
  try { video.removeAttribute('src'); video.load(); } catch { /* released */ }
}

export async function probeClipDuration(url: string): Promise<number> {
  const video = await openVideo(url);
  const d = Number(video.duration);
  releaseVideo(video);
  return Number.isFinite(d) && d > 0 ? d : 0;
}

/**
 * Photograph one frame of a clip and upload it as a durable PNG for Opus
 * vision (inspection + continuity). position: seconds from start, or 'end'.
 */
export async function extractFrame(videoUrl: string, position: number | 'end', maxDim = 1280): Promise<string> {
  if (typeof document === 'undefined') throw new Error('Frame capture needs an open browser tab.');
  const video = await openVideo(videoUrl);
  try {
    const duration = Math.max(0.2, Number(video.duration) || 0.2);
    const t = position === 'end' ? Math.max(0, duration - 0.1) : Math.min(Math.max(0, position), duration - 0.05);
    let ok = await seekTo(video, t);
    if (!ok) ok = await seekTo(video, t);
    if (!ok) throw new Error('The clip did not answer the frame seek.');
    const w = Number(video.videoWidth) || 720;
    const h = Number(video.videoHeight) || 1280;
    const scale = Math.min(1, maxDim / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(2, Math.round(w * scale));
    canvas.height = Math.max(2, Math.round(h * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is unavailable.');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    let dataUrl = '';
    try { dataUrl = canvas.toDataURL('image/png'); }
    catch { throw new Error('The clip host blocked frame capture (CORS-tainted canvas).'); }
    return await uploadDataUrl(dataUrl, `ads-frame-${Date.now()}.png`);
  } finally {
    releaseVideo(video);
  }
}
