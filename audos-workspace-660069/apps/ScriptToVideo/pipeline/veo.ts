/**
 * VEO LAYER — cinematic scene generation through the platform's schema-validated
 * proxy (integration: google-veo3).
 *
 *   submit:  POST /api/veo/generate/video   → { operationId }
 *   poll:    GET  /api/veo/status/:operationId → { status, videoUrl }
 *
 * Model: gemini-omni-flash-preview is the ONLY video model the platform still
 * accepts — the veo-3.x model ids are retired and the proxy answers them with
 * 400 "Invalid request parameters". This mirrors the platform's generate-video
 * server hook, which pins the same model and never falls back away from it.
 *
 * Continuity mechanism: a scene whose spec sets seed_from_previous receives the
 * PREVIOUS scene's extracted last frame as its image seed (imageData accepts a
 * public https URL — the proxy downloads it), and the Opus-written prompt folds
 * in the extracted visual attributes. That is how character/lighting/setting
 * carry across cuts without any saved-character machinery. NOTE: Omni does NOT
 * support lastFrameImage (the proxy 400s it), so the seed frame always travels
 * as imageData — the opening frame of the new shot.
 */

import { Aspect } from '../api';
import { APP_IDS, OMNI_FLASH_MODEL } from '../../../lib/appIds';
import { generationHeaders, postGeneration } from '../../../lib/videoEngineClient';

const VEO_MODEL = OMNI_FLASH_MODEL;

// The platform Veo proxy accepts 10–10,000 characters and forwards the prompt
// to the provider unchanged, so every prompt is capped at that ceiling BEFORE
// submission. Cuts land on a sentence or word boundary so a truncated prompt
// still reads complete.
const VEO_PROMPT_MAX = 10000;
export function capVeoText(text: string, max = VEO_PROMPT_MAX): string {
  const t = String(text || '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'));
  if (sentence > max * 0.6) return cut.slice(0, sentence + 1).trim();
  const space = cut.lastIndexOf(' ');
  return (space > 0 ? cut.slice(0, space) : cut).trim();
}

export interface VeoSubmission { operationId: string; model: string }

export async function submitVeo(params: {
  prompt: string;
  negative?: string;
  aspect: Aspect;
  durationS: number;
  seedImageUrl?: string | null;
}): Promise<VeoSubmission> {
  // The proxy's documented range is an integer 4–25, normalized server-side
  // to the nearest length the chosen model really supports — so the caller's
  // number goes through instead of being clipped to an 8-second ceiling here.
  const duration = Math.min(25, Math.max(4, Math.round(params.durationS || 8)));
  const body: Record<string, unknown> = {
    model: VEO_MODEL,
    prompt: capVeoText(params.prompt),
    aspectRatio: params.aspect,
    duration,
    generateAudio: true,
    // Blocks only genuinely high-confidence violations — the default level
    // false-positives on seeded continuity frames (same as the server hook).
    safetyFilterLevel: 'block_only_high',
  };
  if (params.negative) body.negativePrompt = capVeoText(params.negative, 500);
  if (params.seedImageUrl && /^https:\/\//.test(params.seedImageUrl)) body.imageData = params.seedImageUrl;
  let res: Response;
  let data: any;
  try {
    ({ res, data } = await postGeneration('/api/veo/generate/video', body, APP_IDS.scriptToVideo));
  } catch (e: any) {
    throw new Error(`Could not reach the video service: ${String(e?.message || e)}`);
  }
  const operationId = data && (data.operationId || data.operation_id);
  // The proxy can answer 200 OK with a placeholder id prefixed veo_video_error_
  // (or status: "failed") when the provider submission itself failed — treating
  // that as success would leave the scene polling a 404 forever.
  // success:true + operationId (status 'processing') is an accepted async job to
  // poll; its `message` ("Video generation started…") is progress text, not an error.
  const failed = data?.success === false || String(data?.status || '').toLowerCase() === 'failed';
  if (res.ok && typeof operationId === 'string' && operationId && !failed && !operationId.startsWith('veo_video_error_') && !operationId.startsWith('openrouter_error_')) {
    return { operationId, model: VEO_MODEL };
  }
  const reason = data?.errorMessage || data?.error || (data?.success === false || !res.ok ? data?.message : '');
  throw new Error(String(reason || `Veo submit failed (HTTP ${res.status})`));
}

export interface VeoStatus { status: 'processing' | 'completed' | 'failed'; videoUrl?: string; progress?: number; error?: string }

export async function checkVeo(operationId: string): Promise<VeoStatus> {
  const res = await fetch(`/api/veo/status/${encodeURIComponent(operationId)}`, { headers: generationHeaders(APP_IDS.scriptToVideo) });
  const data = await res.json().catch(() => null);
  if (res.status === 404) return { status: 'failed', error: 'The video service has no record of this render (404). Regenerate the scene.' };
  if (!res.ok) return { status: 'processing', error: String(data?.error || `status HTTP ${res.status}`) };
  const status = String(data?.status || '').toLowerCase();
  if (status === 'completed' && data?.videoUrl) return { status: 'completed', videoUrl: String(data.videoUrl), progress: 100 };
  if (status === 'failed' || status === 'error') return { status: 'failed', error: String(data?.errorMessage || data?.error || 'The render failed at the provider.') };
  return { status: 'processing', progress: Number(data?.progress) || undefined };
}

/**
 * Poll a submitted Veo operation to completion. Resolves with the clip URL or
 * throws with the provider's own reason. Hard ceiling keeps a dead operation
 * from hanging a scene forever — scene independence means the user can always
 * regenerate just this scene.
 */
export async function pollVeo(operationId: string, opts: { onProgress?: (p: number) => void; timeoutMs?: number } = {}): Promise<string> {
  const deadline = Date.now() + (opts.timeoutMs || 8 * 60 * 1000);
  let misses = 0;
  while (Date.now() < deadline) {
    const st = await checkVeo(operationId);
    if (st.status === 'completed' && st.videoUrl) return st.videoUrl;
    if (st.status === 'failed') throw new Error(st.error || 'The render failed.');
    if (st.error) { misses += 1; if (misses >= 6) throw new Error(`The video service stopped answering: ${st.error}`); }
    else misses = 0;
    if (opts.onProgress && typeof st.progress === 'number') opts.onProgress(st.progress);
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error('The render took too long (8 minutes). Regenerate the scene to retry.');
}
