/**
 * Stage 1 — Ingest. Reject loudly on violation:
 * - PNG/JPEG only, 2–12 files, min 1600px width, brief 40–600 chars.
 * Normalisation:
 * - createImageBitmap applies EXIF rotation; redrawing to a canvas both strips
 *   the EXIF block and converts to the canvas's sRGB space.
 * - true pixel dimensions are recorded from the normalised bitmap.
 * The normalised PNG is uploaded to durable storage (file-storage
 * integration) so the render service can fetch it by URL.
 */
import { INGEST_RULES, type IngestedScreen } from '../types';

export class IngestError extends Error {}

export function validateBrief(brief: string): string {
  const clean = brief.replace(/\s+/g, ' ').trim();
  if (clean.length < INGEST_RULES.briefMinChars) {
    throw new IngestError(`The brief is too short — ${clean.length} characters. Write at least ${INGEST_RULES.briefMinChars} so the planner knows what the product does.`);
  }
  if (clean.length > INGEST_RULES.briefMaxChars) {
    throw new IngestError(`The brief is too long — ${clean.length} characters. Keep it under ${INGEST_RULES.briefMaxChars}.`);
  }
  return clean;
}

export function validateFileSet(files: File[]): void {
  if (files.length < INGEST_RULES.minFiles) throw new IngestError(`At least ${INGEST_RULES.minFiles} screenshots are required — got ${files.length}.`);
  if (files.length > INGEST_RULES.maxFiles) throw new IngestError(`At most ${INGEST_RULES.maxFiles} screenshots are allowed — got ${files.length}.`);
  for (const file of files) {
    if (!(INGEST_RULES.acceptedTypes as readonly string[]).includes(file.type)) {
      throw new IngestError(`"${file.name}" is ${file.type || 'an unknown type'} — only PNG and JPEG screenshots are accepted.`);
    }
  }
}

function workspaceToken(): string {
  const token = (window as any).__workspaceDb?.token;
  if (!token) throw new IngestError('Your workspace session is still loading. Wait a moment, then try again.');
  return String(token);
}

function activeWorkspaceId(): string {
  return String((window as any).__workspaceDb?.workspaceId || (window as any).__WORKSPACE_ID__ || '');
}

/** EXIF-strip + sRGB-normalise one screenshot and return canvas + dimensions. */
export async function normalizeImage(file: File): Promise<{ canvas: HTMLCanvasElement; width: number; height: number }> {
  // createImageBitmap honours EXIF orientation; drawing to a canvas discards
  // all metadata and lands the pixels in the canvas's sRGB space.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image', colorSpaceConversion: 'default' });
  if (bitmap.width < INGEST_RULES.minWidth) {
    bitmap.close();
    throw new IngestError(`"${file.name}" is ${bitmap.width}px wide — screenshots must be at least ${INGEST_RULES.minWidth}px so crops stay sharp at 1080p.`);
  }
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
  if (!ctx) throw new IngestError('Canvas 2D is unavailable in this browser.');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { canvas, width: canvas.width, height: canvas.height };
}

async function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new IngestError('The normalised PNG could not be encoded.'))), 'image/png');
  });
}

export async function uploadNormalized(canvas: HTMLCanvasElement, filename: string): Promise<string> {
  const blob = await canvasToPng(canvas);
  const form = new FormData();
  form.append('file', blob, filename.replace(/\.[a-z]+$/i, '') + '.png');
  form.append('workspaceId', activeWorkspaceId());
  form.append('folder', 'screens-to-motion');
  const response = await fetch('/api/upload/file', {
    method: 'POST',
    headers: { 'X-Workspace-DB-Token': workspaceToken() },
    body: form,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.url) throw new IngestError(body?.error || `"${filename}" could not be uploaded (${response.status}).`);
  return String(body.url);
}

export interface IngestResult {
  screen: IngestedScreen;
  /** Kept alive for stage 2 plate-ring sampling and vision downscaling. */
  canvas: HTMLCanvasElement;
}

export async function ingestFiles(files: File[], brief: string): Promise<{ screens: IngestResult[]; brief: string }> {
  const cleanBrief = validateBrief(brief);
  validateFileSet(files);
  const screens: IngestResult[] = [];
  for (let i = 0; i < files.length; i++) {
    const { canvas, width, height } = await normalizeImage(files[i]);
    const url = await uploadNormalized(canvas, files[i].name);
    screens.push({ canvas, screen: { screenId: `s${i + 1}`, url, width, height, filename: files[i].name } });
  }
  return { screens, brief: cleanBrief };
}
