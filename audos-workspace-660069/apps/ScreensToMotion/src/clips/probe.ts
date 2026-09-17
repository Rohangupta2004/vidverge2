/**
 * Clip probe — read a clip's TRUE properties on ingest, never assume them.
 *
 * fps is measured frame-by-frame with requestVideoFrameCallback: mediaTime
 * deltas between presented frames give the exact source frame duration, and
 * the result is snapped to a standard rate only when within tolerance. A clip
 * whose frame rate cannot be measured is REJECTED — conform maths on a
 * guessed fps would reintroduce judder.
 *
 * Ingest limits (Phase 2 §3): MP4/MOV only, at most 4 clips per video,
 * minimum 1080p (shorter edge >= 1080px).
 */
import { CLIP_RULES, type IngestedClip, type ClipSource } from '../types';

export class ClipError extends Error {}

const STANDARD_RATES = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120];
const SNAP_TOLERANCE = 0.025; // 2.5%

export interface ClipMeta { width: number; height: number; durationSeconds: number; fps: number; }

function workspaceToken(): string {
  const token = (window as any).__workspaceDb?.token;
  if (!token) throw new ClipError('Your workspace session is still loading. Wait a moment, then try again.');
  return String(token);
}

function activeWorkspaceId(): string {
  return String((window as any).__workspaceDb?.workspaceId || (window as any).__WORKSPACE_ID__ || '');
}

export function validateClipFile(file: File): void {
  if (!(CLIP_RULES.acceptedTypes as readonly string[]).includes(file.type)) {
    throw new ClipError(`"${file.name}" is ${file.type || 'an unknown type'} — only MP4 and MOV clips are accepted.`);
  }
}

/** Measure true fps + dimensions + duration by playing the clip muted. */
export async function probeClipMeta(url: string, label: string): Promise<ClipMeta> {
  const video = document.createElement('video');
  video.muted = true;
  (video as any).playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  video.src = url;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ClipError(`"${label}" did not load — the clip may be corrupt or unreachable.`)), 20000);
    video.onloadedmetadata = () => { clearTimeout(timer); resolve(); };
    video.onerror = () => { clearTimeout(timer); reject(new ClipError(`"${label}" could not be decoded as video.`)); };
  });

  const width = video.videoWidth;
  const height = video.videoHeight;
  const durationSeconds = Number.isFinite(video.duration) ? video.duration : 0;
  if (!width || !height || !durationSeconds) {
    throw new ClipError(`"${label}" reports no usable dimensions or duration.`);
  }
  if (Math.min(width, height) < CLIP_RULES.minEdge) {
    throw new ClipError(`"${label}" is ${width}x${height} — clips must be at least 1080p (shorter edge >= ${CLIP_RULES.minEdge}px).`);
  }

  const rvfc = (video as any).requestVideoFrameCallback;
  if (typeof rvfc !== 'function') {
    throw new ClipError('This browser cannot measure a clip\'s true frame rate (no requestVideoFrameCallback). Use a Chromium- or Safari-based browser.');
  }

  const deltas: number[] = [];
  const fps = await new Promise<number>((resolve, reject) => {
    let lastMediaTime = -1;
    let done = false;
    const finish = (value?: number, error?: Error) => {
      if (done) return;
      done = true;
      video.pause();
      video.removeAttribute('src');
      video.load();
      error ? reject(error) : resolve(value!);
    };
    const timer = setTimeout(() => {
      if (deltas.length >= 5) settle(); else finish(undefined, new ClipError(`"${label}" — the true frame rate could not be measured.`));
    }, 6000);
    const settle = () => {
      clearTimeout(timer);
      const sorted = [...deltas].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      if (!median || median <= 0) return finish(undefined, new ClipError(`"${label}" — the true frame rate could not be measured.`));
      const raw = 1 / median;
      const snapped = STANDARD_RATES.find((r) => Math.abs(raw - r) / r <= SNAP_TOLERANCE);
      finish(snapped ?? Math.round(raw * 1000) / 1000);
    };
    const onFrame = (_now: number, meta: { mediaTime: number }) => {
      if (done) return;
      if (lastMediaTime >= 0) {
        const delta = meta.mediaTime - lastMediaTime;
        if (delta > 0.0005) deltas.push(delta);
      }
      lastMediaTime = meta.mediaTime;
      if (deltas.length >= 16) { settle(); return; }
      rvfc.call(video, onFrame);
    };
    rvfc.call(video, onFrame);
    video.play().catch(() => finish(undefined, new ClipError(`"${label}" could not be played for frame-rate measurement.`)));
  });

  return { width, height, durationSeconds, fps };
}

/** Upload one local clip file to durable storage, unchanged bytes. */
export async function uploadClip(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file, file.name);
  form.append('workspaceId', activeWorkspaceId());
  form.append('folder', 'screens-to-motion/clips');
  const response = await fetch('/api/upload/file', {
    method: 'POST',
    headers: { 'X-Workspace-DB-Token': workspaceToken() },
    body: form,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.url) throw new ClipError(body?.error || `"${file.name}" could not be uploaded (${response.status}).`);
  return String(body.url);
}

/** Probe a durable URL (uploaded, Veo, or HeyGen output) into an IngestedClip shell. */
export async function probeToClip(url: string, source: ClipSource, label: string, clipId: string): Promise<IngestedClip> {
  const meta = await probeClipMeta(url, label);
  return {
    clipId,
    url,
    width: meta.width,
    height: meta.height,
    fps: meta.fps,
    durationSeconds: meta.durationSeconds,
    source,
    filename: label,
    playbackRate: 1, // set by conformClips
    stats: null,
  };
}

/** Ingest the founder's uploaded clips: validate, upload, probe. Loud on violation. */
export async function ingestClipFiles(files: File[], existingCount: number): Promise<IngestedClip[]> {
  if (files.length + existingCount > CLIP_RULES.maxClips) {
    throw new ClipError(`At most ${CLIP_RULES.maxClips} clips per video — got ${files.length + existingCount}.`);
  }
  const out: IngestedClip[] = [];
  for (let i = 0; i < files.length; i++) {
    validateClipFile(files[i]);
    const url = await uploadClip(files[i]);
    out.push(await probeToClip(url, 'upload', files[i].name, `c${existingCount + i + 1}`));
  }
  return out;
}
