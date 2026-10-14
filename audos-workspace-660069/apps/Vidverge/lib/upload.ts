/**
 * ASSET UPLOAD — one helper every upload control in this app calls.
 *
 * Runway only accepts PUBLIC HTTPS reference URLs: a file picked off the
 * customer's machine is never sent to the provider as bytes, it is parked on
 * platform storage first and only the returned URL travels.
 *
 * The endpoints below are the platform's file-storage routes, used exactly as
 * the workspace's existing helper (`lib/runway.ts` → `runwayUpload`) uses them:
 *
 *   images  POST /api/upload/image   base64 JSON, answers `imageUrl`
 *   other   POST /api/upload/file    multipart, answers `url`
 *
 * There is no `/api/workspaces/:id/assets` route — the two above are the only
 * app-callable public upload surfaces.
 */

import { workspaceId } from './runtime';

/** The product's own guard, checked before a byte is read off disk. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_UPLOAD_LABEL = '10MB';
export const TOO_LARGE_MESSAGE = `File too large (max ${MAX_UPLOAD_LABEL})`;

function appId(): string {
  if (typeof window === 'undefined') return '';
  const w = window as any;
  return String(w.__APP_ID__ || w.__SPACE_ID__ || '');
}

export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

async function readJson(response: Response): Promise<any> {
  const text = await response.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 300) };
  }
}

/** Runway rejects non-HTTPS, credential-bearing and port-bearing references
 * before any provider work, so an unusable URL is caught here instead. */
export function isUsableReference(url: string): boolean {
  return /^https:\/\/[^\s@]+$/i.test(String(url || '').trim());
}

export function isImageUrl(url: string): boolean {
  return /\.(png|jpe?g|webp|gif|avif|bmp|heic)(\?|$)/i.test(String(url || ''));
}

export function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov|m4v|avi)(\?|$)/i.test(String(url || ''));
}

/**
 * Park a picked file on platform storage and return its durable public HTTPS
 * URL. Throws with a sentence worth showing the customer.
 */
export async function uploadAsset(file: File): Promise<string> {
  if (!file) throw new Error('No file was selected.');
  if (file.size > MAX_UPLOAD_BYTES) throw new Error(TOO_LARGE_MESSAGE);

  const safeName = file.name.replace(/[^\w.-]+/g, '_') || 'upload';
  const url =
    file.type.indexOf('image/') === 0 ? await uploadImage(file, safeName) : await uploadFile(file, safeName);

  if (!isUsableReference(url)) {
    throw new Error('The upload returned an address Runway cannot read. Try a different file.');
  }
  return url;
}

async function uploadImage(file: File, safeName: string): Promise<string> {
  const dataUrl = await readAsDataUrl(file);
  let response: Response;
  try {
    response = await fetch('/api/upload/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Id': appId() },
      body: JSON.stringify({ imageData: dataUrl, fileName: safeName }),
    });
  } catch (error: any) {
    throw new Error(`The upload could not be reached (${String(error?.message || error)}).`);
  }
  const data = await readJson(response);
  const url = data && (data.imageUrl || data.url);
  if (!response.ok || typeof url !== 'string' || !url) {
    throw new Error(String(data?.error || `Image upload failed (HTTP ${response.status}).`));
  }
  return url;
}

async function uploadFile(file: File, safeName: string): Promise<string> {
  const form = new FormData();
  form.append('file', new File([file], safeName, { type: file.type || 'application/octet-stream' }));
  form.append('workspaceId', workspaceId());
  form.append('folder', 'vidverge-runway');

  let response: Response;
  try {
    response = await fetch('/api/upload/file', { method: 'POST', body: form });
  } catch (error: any) {
    throw new Error(`The upload could not be reached (${String(error?.message || error)}).`);
  }
  const data = await readJson(response);
  if (!response.ok || !data?.url) {
    throw new Error(String(data?.error || `File upload failed (HTTP ${response.status}).`));
  }
  return String(data.url);
}
