// GEMINI VISION — INLINE SILENT AUTO-CORRECTION
//
// One shared implementation for every video app in this space. After a clip or
// still is generated, its first frame is shown to Gemini Vision with a single
// yes/no question: does this look broken, corrupted, all-black or completely
// off-topic? A "yes" silently re-runs the SAME generation once; anything else
// (a "no", an unreachable model, an undecodable file, a timeout) marks the
// asset READY immediately.
//
// The whole module is invisible to the customer: it never throws, never
// changes a spinner, never writes a badge and never blocks a pipeline. Its
// worst case is a no-op.
//
// TWO ROUTES, IN ORDER:
//   1. POST /proxy/openai/v1/chat/completions with model 'gemini-2.5-flash'.
//   2. POST /api/generate/vision — the platform's own Gemini Vision endpoint,
//      which takes bare base64 and answers { success, result }.
// Route 1 is tried first because it is the documented contract for this check;
// the chat proxy only forwards its own approved model list, so route 2 is what
// actually answers today. Both are best-effort and both failing is fine.

const CHAT_ENDPOINT = '/proxy/openai/v1/chat/completions';
const VISION_ENDPOINT = '/api/generate/vision';
const PRIMARY_MODEL = 'gemini-2.5-flash';

const QUESTION = 'Does this video clip look broken, corrupted, all-black, or completely off-topic? Reply YES or NO only.';

/** Hard ceilings — a slow check must never become a slow pipeline. */
const FRAME_TIMEOUT_MS = 12_000;
const MODEL_TIMEOUT_MS = 15_000;
/** The thumbnail is only ever used for a yes/no judgement, so it stays small. */
const THUMB_MAX_WIDTH = 512;
const THUMB_QUALITY = 0.6;

const isVideoUrl = (value: string) => /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(value);

function workspaceToken(): string {
  if (typeof window === 'undefined') return '';
  return String((window as any).__workspaceDb?.token || '');
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('vision check timed out')), ms);
    work.then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      (error) => { window.clearTimeout(timer); reject(error); },
    );
  });
}

function canvasToJpeg(source: CanvasImageSource, width: number, height: number): string {
  const scale = Math.min(1, THUMB_MAX_WIDTH / Math.max(1, width));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round(width * scale));
  canvas.height = Math.max(2, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas unavailable');
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', THUMB_QUALITY);
}

async function videoFrameDataUrl(url: string): Promise<string> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  if (!url.startsWith('blob:')) video.crossOrigin = 'anonymous';
  video.style.cssText = 'position:fixed;left:-99999px;top:0;width:240px;opacity:0;pointer-events:none;';
  document.body.appendChild(video);
  try {
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error('clip could not be decoded'));
    });
    // A browser capture reports Infinity until it is seeked once; sampling a
    // little way in also skips a legitimate fade-from-black opening frame.
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 4;
    const at = Math.min(Math.max(0.1, duration * 0.12), Math.max(0.1, duration - 0.05));
    video.currentTime = at;
    await new Promise<void>((resolve) => { video.onseeked = () => resolve(); });
    return canvasToJpeg(video, video.videoWidth || 640, video.videoHeight || 360);
  } finally {
    video.remove();
  }
}

async function imageDataUrl(url: string): Promise<string> {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('image could not be loaded'));
    image.src = url;
  });
  return canvasToJpeg(image, image.naturalWidth || 640, image.naturalHeight || 360);
}

async function blobFrameDataUrl(blob: Blob): Promise<string> {
  const objectUrl = URL.createObjectURL(blob);
  try {
    return blob.type.startsWith('image/')
      ? await imageDataUrl(objectUrl)
      : await videoFrameDataUrl(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** A small JPEG data URL of the asset's first usable frame, or '' when it cannot be read. */
export async function thumbnailDataUrl(source: string | Blob): Promise<string> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return '';
  try {
    if (typeof source !== 'string') return await withTimeout(blobFrameDataUrl(source), FRAME_TIMEOUT_MS);
    if (!source) return '';
    if (source.startsWith('data:image/')) return source;
    const work = isVideoUrl(source) || source.startsWith('blob:')
      ? videoFrameDataUrl(source)
      : imageDataUrl(source);
    return await withTimeout(work, FRAME_TIMEOUT_MS);
  } catch {
    return '';
  }
}

function saysYes(answer: unknown): boolean {
  return /^\s*yes\b/i.test(String(answer || ''));
}

async function askThroughChatProxy(dataUrl: string): Promise<boolean | null> {
  const token = workspaceToken();
  if (!token) return null;
  const response = await fetch(CHAT_ENDPOINT, {
    method: 'POST',
    headers: {
      'X-Workspace-DB-Token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: PRIMARY_MODEL,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUrl } },
          { type: 'text', text: QUESTION },
        ],
      }],
      max_tokens: 5,
    }),
  });
  if (!response.ok) return null;
  const body = await response.json().catch(() => null);
  const answer = body?.choices?.[0]?.message?.content;
  if (typeof answer !== 'string' || !answer.trim()) return null;
  return saysYes(answer);
}

async function askThroughVisionEndpoint(dataUrl: string): Promise<boolean | null> {
  const [meta, base64] = dataUrl.split(',');
  if (!base64) return null;
  const mimeType = /data:([^;]+)/.exec(meta || '')?.[1] || 'image/jpeg';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = workspaceToken();
  if (token) headers['X-Workspace-DB-Token'] = token;
  const appId = String((window as any).__APP_ID__ || (window as any).__SPACE_ID__ || '');
  if (appId) headers['X-App-Id'] = appId;
  const response = await fetch(VISION_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({ prompt: QUESTION, image: base64, mimeType }),
  });
  if (!response.ok) return null;
  const body = await response.json().catch(() => null);
  if (!body || body.success === false) return null;
  const answer = body.result ?? body.text ?? body.description;
  if (typeof answer !== 'string' || !answer.trim()) return null;
  return saysYes(answer);
}

/**
 * True only when the model positively says the asset is broken. An
 * unreachable model, an unreadable file or any other fault answers false —
 * the asset is trusted and shipped.
 */
export async function looksBroken(source: string | Blob): Promise<boolean> {
  try {
    const dataUrl = await thumbnailDataUrl(source);
    if (!dataUrl) return false;
    const primary = await withTimeout(askThroughChatProxy(dataUrl), MODEL_TIMEOUT_MS).catch(() => null);
    if (typeof primary === 'boolean') return primary;
    const secondary = await withTimeout(askThroughVisionEndpoint(dataUrl), MODEL_TIMEOUT_MS).catch(() => null);
    return secondary === true;
  } catch {
    return false;
  }
}

export interface SilentCorrectionInput {
  /** The asset that was just produced: a durable URL, a blob: URL, or the bytes. */
  source: string | Blob;
  /** The URL to keep when nothing is re-generated (defaults to `source` when it is a string). */
  url?: string;
  /** Re-runs the IDENTICAL generation. Called at most once, only on a positive "broken" verdict. */
  regenerate?: () => Promise<string>;
}

export interface SilentCorrectionResult {
  /** Always a usable URL: the replacement when one was produced, otherwise the original. */
  url: string;
  /** True when the check ran, said "broken", and a replacement was generated. */
  corrected: boolean;
}

/**
 * The Part 3 contract, in one call: check the asset, re-generate once if it
 * looks broken, and mark it READY either way. Never throws, never blocks, and
 * leaves nothing behind in the UI.
 */
export async function silentAutoCorrect(input: SilentCorrectionInput): Promise<SilentCorrectionResult> {
  const original = input.url || (typeof input.source === 'string' ? input.source : '');
  try {
    if (!(await looksBroken(input.source))) return { url: original, corrected: false };
    if (!input.regenerate) return { url: original, corrected: false };
    const replacement = await input.regenerate();
    return replacement ? { url: replacement, corrected: true } : { url: original, corrected: false };
  } catch {
    return { url: original, corrected: false };
  }
}
