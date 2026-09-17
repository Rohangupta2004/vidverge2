/**
 * Client-side clip finishing for VidVerge videos. It does three jobs:
 *
 * 1. MERGING A LONG VIDEO / SERIES (still the everyday use). Those modes render
 *    one job per scene and need the clips joined into a single deliverable MP4.
 *    stitchAndUploadClips now detects silence only at each scene boundary,
 *    keeps up to two seconds on either side, normalizes the resulting streams,
 *    and uploads the final cut to durable GCS storage.
 *
 * 2. RECOVERING AUDIO ON VEO-ERA JOBS (legacy). Renders now come from Kling,
 *    which generates picture only, so there is no soundtrack to recover and the
 *    hooks answer `audio: "silent"` — remuxAndAttachAudio simply never runs for
 *    them. It still exists for videos made while Veo was the engine: those clips
 *    each carried a native AAC track, but BOTH platform stitchers (the
 *    long-video pipeline's own stitchedUrl and
 *    POST /api/workspaces/:id/videos/stitch) return video-only MP4s because the
 *    ffmpeg concat drops every input audio stream (verified Aug 8 2026, reported
 *    as a platform bug), and the Remotion render endpoint can't be used as a
 *    fallback stitcher either — it returns other workspaces' videos as your
 *    output (also verified + reported). So the browser was the only place left
 *    that could rebuild those cuts with their real audio, which it does by
 *    concatenating the original clips and attaching the result to the job
 *    through check-video-status.
 *
 * 3. FINALIZING PRODUCT ADS. When the server renderer cannot verify an overlay
 *    output, the Create app burns the exact product name, feature line and CTA
 *    into each image-to-video clip here, concatenates them, uploads the MP4,
 *    and attaches the standard Video Jobs delivery fields.
 *
 * NOTE: this drives the @ffmpeg/core WASM module directly on the main thread
 * instead of the @ffmpeg/ffmpeg worker wrapper: the wrapper's worker cannot be
 * constructed from a CDN origin (verified — the classWorkerURL blob route
 * fails), while a stream-copy remux is far too quick to need a worker anyway.
 */

// jsdelivr (not unpkg): the platform's CSP script-src allow-list includes
// cdn.jsdelivr.net and esm.sh but not unpkg.com — the header is report-only
// today, but a dynamic import from unpkg would break the day it is enforced.
const CORE_JS = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js';
const CORE_WASM = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.wasm';

/** Refuse to buffer more than this much clip data in memory (upload cap is 50MB). */
export const MAX_TOTAL_BYTES = 45 * 1024 * 1024;

let corePromise: Promise<any> | null = null;
let activeFfmpegLog: string[] | null = null;

async function getCore(): Promise<any> {
  if (!corePromise) {
    corePromise = (async () => {
      // Cross-origin dynamic import of the ESM core (jsdelivr serves CORS).
      const createFFmpegCore = (await import(/* @vite-ignore */ CORE_JS)).default;
      if (typeof createFFmpegCore !== 'function') {
        throw new Error('ffmpeg core module did not export a factory');
      }
      // The core resolves its .wasm from the hash payload of
      // mainScriptUrlOrBlob — the same contract the official worker uses.
      return await createFFmpegCore({
        mainScriptUrlOrBlob: `${CORE_JS}#${btoa(JSON.stringify({ wasmURL: CORE_WASM }))}`,
        print: (line: string) => activeFfmpegLog?.push(String(line)),
        printErr: (line: string) => activeFfmpegLog?.push(String(line)),
      });
    })().catch((e) => {
      corePromise = null; // allow a retry on the next call
      throw e;
    });
  }
  return corePromise;
}

const MAX_BOUNDARY_SILENCE_SECONDS = 2;
const SILENCE_THRESHOLD = '-50dB';

interface BoundaryTrim {
  startSec: number;
  endSec: number;
}

function mediaDuration(log: string): number {
  const match = log.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

/**
 * Run ffmpeg's audio detector without changing the clip. Only silence touching
 * the requested scene boundary is considered: a first clip can lose tail
 * silence, a last clip can lose head silence, and middle clips can lose both.
 * Interior pauses never participate. Each trimmed edge retains exactly two
 * seconds, so transitions can breathe without carrying a long dead gap.
 */
function detectBoundaryTrim(
  core: any,
  name: string,
  trimHead: boolean,
  trimTail: boolean,
): BoundaryTrim | null {
  activeFfmpegLog = [];
  core.exec(
    '-i', name,
    '-af', `silencedetect=noise=${SILENCE_THRESHOLD}:d=0.15`,
    '-f', 'null', '-'
  );
  const rc = core.ret;
  const log = activeFfmpegLog.join('\n');
  activeFfmpegLog = null;
  core.reset();
  if (rc !== 0) return null;

  const duration = mediaDuration(log);
  if (!(duration > 0)) return null;
  const starts = Array.from(log.matchAll(/silence_start:\s*([0-9.]+)/g)).map((m) => Number(m[1]));
  const ends = Array.from(log.matchAll(/silence_end:\s*([0-9.]+)/g)).map((m) => Number(m[1]));
  let startSec = 0;
  let endSec = duration;

  if (trimHead && starts.length && ends.length && starts[0] <= 0.15) {
    const head = Math.max(0, ends[0]);
    if (head > MAX_BOUNDARY_SILENCE_SECONDS) {
      startSec = head - MAX_BOUNDARY_SILENCE_SECONDS;
    }
  }

  if (trimTail && starts.length) {
    const tailStart = starts[starts.length - 1];
    const reportedTailEnd = ends.length >= starts.length ? ends[ends.length - 1] : duration;
    if (reportedTailEnd >= duration - 0.2) {
      const tail = duration - tailStart;
      if (tail > MAX_BOUNDARY_SILENCE_SECONDS) {
        endSec = duration - (tail - MAX_BOUNDARY_SILENCE_SECONDS);
      }
    }
  }

  return startSec > 0.01 || endSec < duration - 0.01 ? { startSec, endSec } : null;
}

/** Download the clips, cap silence at scene boundaries, and preserve internal audio. */
export async function stitchClipsWithAudio(
  clipUrls: string[],
  maxTotalBytes: number = MAX_TOTAL_BYTES,
): Promise<Blob> {
  if (!Array.isArray(clipUrls) || clipUrls.length < 2) {
    throw new Error('need at least 2 clips to stitch');
  }
  const core = await getCore();

  const names: string[] = [];
  let total = 0;
  let listTxt = '';
  try {
    for (let i = 0; i < clipUrls.length; i++) {
      const res = await fetch(clipUrls[i]);
      if (!res.ok) throw new Error(`clip ${i} download failed: HTTP ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      total += buf.byteLength;
      if (total > maxTotalBytes) throw new Error('clips exceed the in-browser stitch size limit');
      const sourceName = `rlclip${i}.mp4`;
      core.FS.writeFile(sourceName, buf);
      names.push(sourceName);

      let concatName = sourceName;
      const trim = detectBoundaryTrim(
        core,
        sourceName,
        i > 0,
        i < clipUrls.length - 1,
      );
      if (trim) {
        const trimmedName = `rltrim${i}.mp4`;
        activeFfmpegLog = [];
        core.exec(
          '-ss', trim.startSec.toFixed(3),
          '-to', trim.endSec.toFixed(3),
          '-i', sourceName,
          '-c:v', 'libx264',
          '-preset', 'veryfast',
          '-crf', '20',
          '-c:a', 'aac',
          '-b:a', '192k',
          '-movflags', '+faststart',
          trimmedName,
        );
        const trimRc = core.ret;
        activeFfmpegLog = null;
        core.reset();
        if (trimRc === 0) {
          concatName = trimmedName;
          names.push(trimmedName);
        } else {
          try { core.FS.unlink(trimmedName); } catch { /* no partial output */ }
        }
      }

      listTxt += `file '${concatName}'\n`;
    }
    core.FS.writeFile('rllist.txt', new TextEncoder().encode(listTxt));
    names.push('rllist.txt');

    // Boundary trimming can re-encode only the clips whose edge silence was
    // too long. Normalize the final concat so a trimmed clip and an untouched
    // clip cannot fail merely because their H.264/AAC parameters differ.
    core.exec(
      '-f', 'concat', '-safe', '0', '-i', 'rllist.txt',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
      'rlout.mp4',
    );
    const rc = core.ret;
    core.reset();
    if (rc !== 0) throw new Error(`ffmpeg concat failed (rc=${rc})`);

    const data: Uint8Array = core.FS.readFile('rlout.mp4');
    names.push('rlout.mp4');
    if (!data || data.byteLength < 1024) throw new Error('concat produced an empty file');
    return new Blob([data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)], {
      type: 'video/mp4',
    });
  } finally {
    for (const n of names) {
      try {
        core.FS.unlink(n);
      } catch {
        /* already gone */
      }
    }
  }
}

export interface StitchUploadParams {
  clipUrls: string[];
  /** Workspace UUID — namespaces the upload. Omitted when unknown. */
  workspaceUuid?: string | null;
  /** File name of the uploaded MP4 (defaults to a timestamped vidverge name). */
  fileName?: string;
  maxTotalBytes?: number;
  onStage?: (stage: 'stitching' | 'uploading') => void;
}

/**
 * Concat the clips in the browser (audio preserved) and upload the result to
 * durable GCS storage. Returns the public URL. Used both by the single-job
 * audio remux below and by Long Video projects, which stitch the clips of
 * several separate renders into one deliverable MP4.
 */
export async function stitchAndUploadClips(params: StitchUploadParams): Promise<string> {
  const { clipUrls, workspaceUuid, fileName, maxTotalBytes, onStage } = params;

  onStage?.('stitching');
  const blob = await stitchClipsWithAudio(clipUrls, maxTotalBytes ?? MAX_TOTAL_BYTES);

  onStage?.('uploading');
  const form = new FormData();
  form.append('file', blob, fileName || `reelio-${Date.now()}.mp4`);
  if (workspaceUuid) form.append('workspaceId', workspaceUuid);
  form.append('folder', 'videos');
  const upRes = await fetch('/api/upload/file', { method: 'POST', body: form });
  const upData = await upRes.json().catch(() => null);
  if (!upRes.ok || !upData?.success || typeof upData.url !== 'string') {
    throw new Error(`upload failed: HTTP ${upRes.status}`);
  }
  return upData.url;
}

export interface ProductAdFinalizeParams {
  clipUrls: string[];
  productName: string;
  featureLines: string[];
  cta: string;
  brandColor?: string;
  workspaceUuid?: string | null;
  jobId: string;
  onStage?: (stage: 'overlaying' | 'stitching' | 'uploading') => void;
}

function drawWrappedText(
  context: CanvasRenderingContext2D,
  value: string,
  centerX: number,
  startY: number,
  maxWidth: number,
  lineHeight: number,
): void {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  lines.slice(0, 3).forEach((item, index) => context.fillText(item, centerX, startY + index * lineHeight));
}

async function productAdOverlayPng(
  productName: string,
  feature: string,
  cta: string,
  brandColor: string,
): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable for Product Ad overlays');

  const top = context.createLinearGradient(0, 0, 0, 330);
  top.addColorStop(0, 'rgba(0,0,0,0.76)');
  top.addColorStop(1, 'rgba(0,0,0,0)');
  context.fillStyle = top;
  context.fillRect(0, 0, canvas.width, 330);
  const bottom = context.createLinearGradient(0, 700, 0, 1080);
  bottom.addColorStop(0, 'rgba(0,0,0,0)');
  bottom.addColorStop(1, 'rgba(0,0,0,0.82)');
  context.fillStyle = bottom;
  context.fillRect(0, 700, canvas.width, 380);

  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#ffffff';
  context.shadowColor = 'rgba(0,0,0,0.95)';
  context.shadowBlur = 18;
  context.shadowOffsetY = 4;
  context.font = '800 76px Inter, Arial, sans-serif';
  drawWrappedText(context, productName, 960, 112, 1640, 82);

  context.font = '700 58px Inter, Arial, sans-serif';
  drawWrappedText(context, feature, 960, 500, 1540, 68);

  const ctaText = String(cta || 'Learn more').trim();
  context.font = '800 42px Inter, Arial, sans-serif';
  const pillWidth = Math.min(900, Math.max(300, context.measureText(ctaText).width + 110));
  context.shadowBlur = 0;
  context.fillStyle = /^#[0-9a-f]{6}$/i.test(brandColor) ? brandColor : '#2563eb';
  context.beginPath();
  context.roundRect(960 - pillWidth / 2, 912, pillWidth, 94, 47);
  context.fill();
  context.fillStyle = '#ffffff';
  context.shadowColor = 'rgba(0,0,0,0.8)';
  context.shadowBlur = 10;
  context.shadowOffsetY = 2;
  context.fillText(ctaText, 960, 959);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Could not create Product Ad overlay')), 'image/png');
  });
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Reliable fallback for the platform Remotion verifier: burn exact copy into
 * each completed image-to-video clip, concatenate the normalized results, and
 * upload one durable MP4. Product Ad clips are generated without audio, so the
 * boundary-silence policy is a no-op here; standard sound-bearing scene flows
 * use stitchClipsWithAudio's boundary detector above.
 */
export async function finalizeProductAdInBrowser(params: ProductAdFinalizeParams): Promise<string> {
  const {
    clipUrls,
    productName,
    featureLines,
    cta,
    brandColor = '#2563eb',
    workspaceUuid,
    jobId,
    onStage,
  } = params;
  if (!Array.isArray(clipUrls) || clipUrls.length < 2) throw new Error('Product Ad needs at least two completed clips');

  const core = await getCore();
  const names: string[] = [];
  let total = 0;
  let concatList = '';
  try {
    onStage?.('overlaying');
    for (let index = 0; index < clipUrls.length; index++) {
      const response = await fetch(clipUrls[index]);
      if (!response.ok) throw new Error(`Product Ad clip ${index + 1} download failed: HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      total += bytes.byteLength;
      if (total > MAX_TOTAL_BYTES) throw new Error('Product Ad clips exceed the in-browser finalization limit');

      const sourceName = `pa-source-${index}.mp4`;
      const overlayName = `pa-overlay-${index}.png`;
      const outputName = `pa-scene-${index}.mp4`;
      core.FS.writeFile(sourceName, bytes);
      core.FS.writeFile(
        overlayName,
        await productAdOverlayPng(
          productName,
          featureLines[index % Math.max(1, featureLines.length)] || '',
          cta,
          brandColor,
        ),
      );
      names.push(sourceName, overlayName);

      activeFfmpegLog = [];
      core.exec(
        '-i', sourceName,
        '-i', overlayName,
        '-filter_complex', '[1:v][0:v]scale2ref=w=main_w:h=main_h[ov][base];[base][ov]overlay=0:0:shortest=1[v]',
        '-map', '[v]',
        '-map', '0:a?',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '20',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-movflags', '+faststart',
        outputName,
      );
      const rc = core.ret;
      activeFfmpegLog = null;
      core.reset();
      if (rc !== 0) throw new Error(`Product Ad overlay ${index + 1} failed (rc=${rc})`);
      names.push(outputName);
      concatList += `file '${outputName}'\n`;
    }

    onStage?.('stitching');
    core.FS.writeFile('pa-list.txt', new TextEncoder().encode(concatList));
    names.push('pa-list.txt');
    core.exec(
      '-f', 'concat', '-safe', '0', '-i', 'pa-list.txt',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
      'pa-final.mp4',
    );
    const stitchRc = core.ret;
    core.reset();
    if (stitchRc !== 0) throw new Error(`Product Ad concat failed (rc=${stitchRc})`);
    const output: Uint8Array = core.FS.readFile('pa-final.mp4');
    names.push('pa-final.mp4');
    if (!output || output.byteLength < 1024) throw new Error('Product Ad concat produced an empty MP4');

    onStage?.('uploading');
    const form = new FormData();
    form.append(
      'file',
      new Blob([output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength)], { type: 'video/mp4' }),
      `product-ad-${jobId}.mp4`,
    );
    if (workspaceUuid) form.append('workspaceId', workspaceUuid);
    form.append('folder', 'videos');
    const uploaded = await fetch('/api/upload/file', { method: 'POST', body: form });
    const data = await uploaded.json().catch(() => null);
    if (!uploaded.ok || !data?.success || typeof data.url !== 'string') {
      throw new Error(data?.error || `Product Ad upload failed: HTTP ${uploaded.status}`);
    }
    return data.url;
  } finally {
    activeFfmpegLog = null;
    for (const name of names) {
      try { core.FS.unlink(name); } catch { /* already removed */ }
    }
  }
}

export interface AttachAudioParams {
  /** Space id, e.g. "workspace-660069" (used for the hook execute alias). */
  spaceId: string;
  /** Workspace UUID — the hook reports it as `workspace_uuid`; namespaces the upload. */
  workspaceUuid: string;
  jobId: string;
  clipUrls: string[];
  /** Visitor session id, forwarded so the hook's session-scoped lookup matches. */
  sessionId: string | null;
  onStage?: (stage: 'stitching' | 'uploading' | 'attaching') => void;
}

/**
 * Full pipeline: remux the clips with their native audio, upload the result to
 * durable storage, and attach it to the job. Returns the attached URL, or
 * throws — the caller falls back to the (video-only) fast cut on failure.
 */
export async function remuxAndAttachAudio(params: AttachAudioParams): Promise<string> {
  const { spaceId, workspaceUuid, jobId, clipUrls, sessionId, onStage } = params;

  const uploadedUrl = await stitchAndUploadClips({
    clipUrls,
    workspaceUuid,
    fileName: `reelio-${jobId}.mp4`,
    onStage: (stage) => onStage?.(stage),
  });

  onStage?.('attaching');
  const scoped = spaceId.startsWith('workspace-') ? spaceId : `workspace-${spaceId}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (sessionId) headers['X-Session-Id'] = sessionId;
  const attachRes = await fetch(`/api/hooks/execute/${scoped}/check-video-status`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ job_id: jobId, attach_stitched_url: uploadedUrl }),
  });
  const attachData = await attachRes.json().catch(() => null);
  if (!attachRes.ok || !attachData?.success) {
    throw new Error(`attach failed: HTTP ${attachRes.status}`);
  }
  return uploadedUrl;
}
