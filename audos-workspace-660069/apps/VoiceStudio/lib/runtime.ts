// Voice Studio's runtime plumbing: workspace identity, byte wrangling for the
// binary audio the ElevenLabs endpoints return, and workspace file upload.
// Nothing in here talks to a provider — that lives in elevenlabs.ts / heygen.ts.

export const WORKSPACE_ID = 'f24710e5-7c6d-4db4-92b4-c2c235877575';

export function workspaceId(): string {
  return String((window as any).__workspaceDb?.workspaceId || (window as any).__WORKSPACE_ID__ || WORKSPACE_ID);
}

/**
 * The published bundle's workspace token. Every paid platform endpoint and the
 * secrets proxy reject an anonymous call with 401 `no_credentials` before the
 * provider is contacted, so a missing token has to fail loudly here rather
 * than turning into an unexplained 401 three frames later.
 */
export function workspaceToken(): string {
  const token = (window as any).__workspaceDb?.token;
  if (!token) throw new Error('Your workspace session is not ready yet. Refresh the page and try again.');
  return String(token);
}

export function hasWorkspaceToken(): boolean {
  return Boolean((window as any).__workspaceDb?.token);
}

export const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export function base64ToBytes(base64: string): Uint8Array {
  const clean = String(base64 || '').replace(/^data:[^;]+;base64,/, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Raw PCM has no container, so a browser <audio> element cannot play it and a
 * downloaded .pcm file opens in nothing. Wrapping the samples in a 44-byte
 * WAV header makes the same bytes playable and downloadable without
 * re-encoding anything.
 */
export function pcmToWav(pcm: Uint8Array, sampleRate: number): Blob {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + pcm.byteLength, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono — ElevenLabs PCM output is single channel
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate at 16 bits mono
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, pcm.byteLength, true);
  return new Blob([header, pcm], { type: 'audio/wav' });
}

export function blobFromBase64(base64: string, mime: string): Blob {
  return new Blob([base64ToBytes(base64)], { type: mime });
}

/**
 * Release the bytes behind a previous blob: URL when a new generation replaces
 * it. Without this, every re-generate in a session leaks the whole audio file.
 */
export function revokeBlobUrl(url: string | undefined | null) {
  if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
}

export function download(url: string, filename: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/** Download a remote asset through a blob so the browser saves it instead of navigating to it. */
export async function downloadRemote(url: string, filename: string) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(String(response.status));
    const objectUrl = URL.createObjectURL(await response.blob());
    download(objectUrl, filename);
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch {
    // A cross-origin asset that refuses a fetch can still be opened directly.
    window.open(url, '_blank', 'noopener');
  }
}

export function fileToBase64(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(new Error('That file could not be read.'));
    reader.readAsDataURL(file);
  });
}

export interface UploadedFile {
  url: string;
  key: string;
  contentType: string;
  bytes: number;
}

/**
 * Put a file in workspace storage and get a permanent public URL back. Two
 * things in this app need a URL rather than bytes: ElevenLabs dubbing reads
 * its source from `source_url`, and HeyGen reads a custom voice track from
 * `audio_url`. 50MB is the real ceiling for space app code.
 */
export async function uploadToWorkspace(file: File | Blob, filename: string, folder = 'voice-studio'): Promise<UploadedFile> {
  const form = new FormData();
  form.append('file', file, filename);
  form.append('workspaceId', workspaceId());
  form.append('folder', folder);
  const response = await fetch('/api/upload/file', { method: 'POST', body: form });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result?.url) {
    throw new Error(result?.error || `Upload failed (${response.status}).`);
  }
  return {
    url: String(result.url),
    key: String(result.key || ''),
    contentType: String(result.contentType || (file as File).type || ''),
    bytes: Number(result.bytes) || (file as File).size || 0,
  };
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatClock(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeLocal(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A private-mode browser with no storage quota must not break a render.
  }
}
