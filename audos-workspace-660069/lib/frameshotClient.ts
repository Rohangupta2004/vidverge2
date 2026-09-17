/**
 * Browser-side fallback for the pipeline's mandatory server-side ffmpeg frame
 * extraction. The server's /api/video/frames path is primary; while a run is
 * on screen, this courier can still provide the exact final frame plus a dense
 * 4–6 frame sample of the last second when that service is temporarily down.
 *
 * A hidden <video crossOrigin="anonymous"> seeks through the tail timestamps,
 * draws each frame at a 720p cap, exports lossless PNG, uploads through
 * /api/upload/image, and hands the durable URLs to `attach_frames`.
 *
 * Any HTTPS clip is attempted. If its host does not grant canvas CORS access,
 * `toDataURL` throws a specific error that the run screen shows to the user.
 * Capture never resolves with a partial set: fewer than four durable frames is
 * an explicit failure, so the courier can retry while the request is active and
 * the server never advances without a real last frame and ending-state data.
 */

export interface CapturedFrame { t: number; url: string }

function appId(): string {
  if (typeof window === 'undefined') return 'workspace-660069';
  return String((window as any).__APP_ID__ || (window as any).__SPACE_ID__ || 'workspace-660069');
}

/** Attempt every HTTPS clip; browser CORS enforcement decides whether it is paintable. */
export function canCaptureFrames(videoUrl: unknown): boolean {
  return typeof videoUrl === 'string' && videoUrl.startsWith('https://');
}

async function uploadFrame(dataUrl: string, fileName: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch('/api/upload/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Id': appId() },
      body: JSON.stringify({ imageData: dataUrl, fileName }),
    });
  } catch (error: any) {
    throw new Error(`Tail-frame upload could not reach storage: ${String(error?.message || error || 'network error')}`);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(String(data?.error || `Tail-frame upload failed (HTTP ${res.status}).`));
  const url = data && (data.imageUrl || data.url);
  if (typeof url !== 'string' || !url.startsWith('https://')) throw new Error('Tail-frame upload returned no durable image URL.');
  return url;
}

function seekTo(video: HTMLVideoElement, t: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let frameCallbackId: number | null = null;
    const frameVideo = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
      cancelVideoFrameCallback?: (id: number) => void;
    };
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(giveUp);
      video.removeEventListener('seeked', onSeeked);
      if (frameCallbackId !== null && frameVideo.cancelVideoFrameCallback) {
        frameVideo.cancelVideoFrameCallback(frameCallbackId);
      }
      resolve(ok);
    };
    const onSeeked = () => {
      if (frameVideo.requestVideoFrameCallback) {
        frameCallbackId = frameVideo.requestVideoFrameCallback(() => finish(true));
      } else {
        // `seeked` is the background-safe fallback; requestAnimationFrame is
        // intentionally avoided because browsers pause it in background tabs.
        setTimeout(() => finish(true), 80);
      }
    };
    const giveUp = setTimeout(() => finish(false), 8000);
    video.addEventListener('seeked', onSeeked);
    try { video.currentTime = t; } catch { finish(false); }
  });
}

/**
 * Photograph the final ~1 second of a clip. Four to six analysis frames are
 * returned and the final sample is exactly 0.1s from the end, mirroring:
 * ffmpeg -sseof -0.1 -i shot.mp4 -frames:v 1 last.png
 */
export async function captureFrames(videoUrl: string, count = 6, maxDim = 1280): Promise<CapturedFrame[]> {
  if (typeof document === 'undefined') throw new Error('Browser tail-frame capture is unavailable outside an open video tab.');
  if (!canCaptureFrames(videoUrl)) throw new Error('Browser tail-frame capture requires a public HTTPS clip URL.');
  return new Promise<CapturedFrame[]>((resolve, reject) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.preload = 'auto';
    (video as any).playsInline = true;
    let finished = false;
    const finish = (frames: CapturedFrame[], error?: unknown) => {
      if (finished) return;
      finished = true;
      clearTimeout(guard);
      try { video.removeAttribute('src'); video.load(); } catch { /* released */ }
      if (error) reject(error instanceof Error ? error : new Error(String(error)));
      else resolve(frames);
    };
    // Six seeks and six capped PNG uploads can legitimately exceed 45 seconds
    // on a slow connection. Keep the guard above that worst case.
    const guard = setTimeout(() => finish([], new Error('Browser tail-frame capture timed out before four frames were uploaded.')), 90000);
    video.onerror = () => finish([], new Error(`The generated clip could not be decoded in this browser${video.error?.message ? `: ${video.error.message}` : '.'}`));
    video.onloadedmetadata = async () => {
      try {
        const duration = Number(video.duration);
        if (!Number.isFinite(duration) || duration <= 0) throw new Error('The generated clip reported no usable duration.');
        const d = Math.max(0.5, duration);
        const requested = Number.isFinite(count) ? Math.floor(count) : 6;
        const tailCount = Math.max(4, Math.min(6, requested));
        const tailStart = Math.max(0, d - 1);
        const tailEnd = Math.max(0, d - 0.1);
        const spread = Array.from({ length: tailCount }, (_, i) =>
          tailStart + ((tailEnd - tailStart) * i) / Math.max(1, tailCount - 1)
        );
        const stamps = spread
          .map((t) => Math.min(Math.max(0, t), Math.max(0, d - 0.05)))
          .filter((v, i, a) => a.indexOf(v) === i)
          .slice(0, Math.max(1, count))
          .sort((a, b) => a - b);
        const w = Number(video.videoWidth) || 720;
        const h = Number(video.videoHeight) || 1280;
        const landscape = w >= h;
        const widthCap = Math.min(maxDim, landscape ? 1280 : 720);
        const heightCap = Math.min(maxDim, landscape ? 720 : 1280);
        const scale = Math.min(1, widthCap / w, heightCap / h);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(2, Math.round(w * scale));
        canvas.height = Math.max(2, Math.round(h * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('This browser could not create a canvas for tail-frame capture.');
        const out: CapturedFrame[] = [];
        for (const t of stamps) {
          // A decoder can miss one seek while it warms up. Retry once instead
          // of silently dropping that sample from the mandatory four-frame set.
          let ok = await seekTo(video, t);
          if (!ok) ok = await seekTo(video, t);
          if (!ok) continue;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          let dataUrl = '';
          try {
            dataUrl = canvas.toDataURL('image/png');
          } catch {
            throw new Error('The clip host blocked browser frame capture (CORS-tainted canvas).');
          }
          const url = await uploadFrame(dataUrl, `frameshot-${Date.now()}-${Math.round(t * 100)}.png`);
          out.push({ t: Math.round(t * 100) / 100, url });
        }
        if (out.length < 4) {
          throw new Error(`Browser tail-frame capture produced ${out.length} of the required 4 frames after retrying failed seeks.`);
        }
        finish(out);
      } catch (error) {
        finish([], error);
      }
    };
    video.src = videoUrl;
  });
}
