// renderPipeline — everything between "the script exists" and "the MP4 has
// been graded". Four platform capabilities, called directly, no mocks:
//
//   ps-brand-scrape     reads the creator's own site and photographs it
//   /api/render/remotion submits the composition and polls for the MP4
//   /api/video/frames    pulls stills back out of the finished file
//   a canvas             stitches those stills into ONE contact sheet
//
// The contact sheet is the Twitter-thread trick: one grid image tells a vision
// model more about pacing and hierarchy than twenty separate frames ever can,
// and it costs one call instead of twenty.

import {
  RENDER_FPS,
  RENDER_HEIGHT,
  RENDER_WIDTH,
  type SheetFrame,
} from './launchTypes';
import type { SiteEvidence } from './opusClient';

export const WORKSPACE_ID = 'f24710e5-7c6d-4db4-92b4-c2c235877575';

// ---------------------------------------------------------------------------
// The creator's own site
// ---------------------------------------------------------------------------

interface ScrapeReply {
  success?: boolean;
  title?: string;
  description?: string;
  headlines?: string[];
  bullets?: string[];
  palette?: Array<{ hex?: string }>;
  themeColor?: string;
  screenshotUrl?: string;
  error?: string;
}

export function normalizeUrl(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
}

/**
 * Read the product page. Entirely optional — a creator who gives no URL simply
 * gets a film written from their own words, and a site that cannot be read is
 * reported as "no screenshot", never as a failed run.
 */
export async function readSite(url: string): Promise<SiteEvidence | null> {
  const target = normalizeUrl(url);
  if (!target) return null;
  try {
    const response = await fetch('/api/hooks/execute/' + WORKSPACE_ID + '/ps-brand-scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: target, screenshot: true, render: true }),
    });
    const data = (await response.json().catch(() => null)) as ScrapeReply | null;
    if (!response.ok || !data || data.success === false) return null;
    const palette = (Array.isArray(data.palette) ? data.palette : [])
      .map((entry) => String(entry?.hex || ''))
      .filter(Boolean)
      .slice(0, 6);
    if (data.themeColor) palette.unshift(String(data.themeColor));
    return {
      title: String(data.title || ''),
      description: String(data.description || ''),
      headlines: Array.isArray(data.headlines) ? data.headlines.map(String) : [],
      bullets: Array.isArray(data.bullets) ? data.bullets.map(String) : [],
      palette,
      screenshotUrl: String(data.screenshotUrl || ''),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Server-side render
// ---------------------------------------------------------------------------

export type RenderPhase = 'pending' | 'rendering' | 'complete' | 'failed';

interface RenderSubmitReply { operationId?: string; error?: string; message?: string }
interface RenderStatusReply { status?: RenderPhase; videoUrl?: string; error?: string }

export async function submitRender(input: {
  compositionTsx: string;
  props: Record<string, unknown>;
  durationInFrames: number;
}): Promise<string> {
  const response = await fetch('/api/render/remotion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspaceId: WORKSPACE_ID,
      compositionTsx: input.compositionTsx,
      props: input.props,
      durationInFrames: Math.min(18000, Math.max(1, Math.round(input.durationInFrames))),
      fps: RENDER_FPS,
      width: RENDER_WIDTH,
      height: RENDER_HEIGHT,
    }),
  });
  const data = (await response.json().catch(() => null)) as RenderSubmitReply | null;
  if (!response.ok || !data?.operationId) {
    throw new Error(String(data?.error || data?.message || 'The render service answered HTTP ' + response.status));
  }
  return String(data.operationId);
}

/** Poll until the file lands. Every tick is a real server answer. */
export async function pollRender(
  operationId: string,
  onTick: (phase: RenderPhase, elapsedMs: number) => void,
  options: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<string> {
  const intervalMs = options.intervalMs || 3000;
  const timeoutMs = options.timeoutMs || 900000;
  const started = Date.now();

  for (;;) {
    const response = await fetch('/api/render/remotion/' + operationId);
    const data = (await response.json().catch(() => null)) as RenderStatusReply | null;
    const phase: RenderPhase = (data?.status as RenderPhase) || 'rendering';
    onTick(phase, Date.now() - started);

    if (phase === 'complete' && data?.videoUrl) return String(data.videoUrl);
    if (phase === 'failed') throw new Error(String(data?.error || 'The render failed.'));
    if (Date.now() - started > timeoutMs) throw new Error('The render is taking longer than expected.');

    await new Promise((resolve) => { window.setTimeout(resolve, intervalMs); });
  }
}

// ---------------------------------------------------------------------------
// Frames -> contact sheet
// ---------------------------------------------------------------------------

/** The platform frame extractor takes at most 20 timestamps per request. */
const FRAMES_PER_CALL = 12;

/** How many tiles the sheet is built from. 24 reads as a storyboard. */
export const SHEET_FRAME_COUNT = 24;

export const SHEET_COLUMNS = 6;

/**
 * Spread the samples across the film without ever asking for the very first or
 * very last instant — ffmpeg lands those on a frame boundary that may still be
 * mid-fade, which reads as a defect that is not there.
 */
export function sampleTimestamps(durationSeconds: number, count = SHEET_FRAME_COUNT): number[] {
  const span = Math.max(1, durationSeconds);
  const first = Math.min(0.25, span * 0.02);
  const last = Math.max(first, span - 0.35);
  const step = count > 1 ? (last - first) / (count - 1) : 0;
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) out.push(Number((first + step * i).toFixed(2)));
  return out;
}

interface FramesReply { frames?: Array<{ timestamp?: number; url?: string }>; error?: string }

export async function extractFrames(
  videoUrl: string,
  timestamps: number[],
  onProgress?: (done: number, total: number) => void,
): Promise<SheetFrame[]> {
  const out: SheetFrame[] = [];
  for (let i = 0; i < timestamps.length; i += FRAMES_PER_CALL) {
    const batch = timestamps.slice(i, i + FRAMES_PER_CALL);
    const response = await fetch('/api/video/frames', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoUrl, timestamps: batch, workspaceId: WORKSPACE_ID }),
    });
    const data = (await response.json().catch(() => null)) as FramesReply | null;
    if (!response.ok) {
      throw new Error(String(data?.error || 'Frame extraction answered HTTP ' + response.status));
    }
    for (const frame of data?.frames || []) {
      if (frame?.url) out.push({ timestamp: Number(frame.timestamp) || 0, url: String(frame.url) });
    }
    if (onProgress) onProgress(Math.min(timestamps.length, i + batch.length), timestamps.length);
  }
  out.sort((a, b) => a.timestamp - b.timestamp);
  return out;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('A frame could not be loaded.'));
    image.src = url;
  });
}

/** Tile geometry. Small on purpose: the whole sheet has to fit in one request. */
const TILE_WIDTH = 256;
const TILE_HEIGHT = Math.round((TILE_WIDTH * RENDER_HEIGHT) / RENDER_WIDTH);
const TILE_GAP = 2;

/**
 * The Anthropic proxy caps a request body at 256 KB and the conversation at
 * 200,000 characters, so the sheet is re-encoded down until its base64 fits
 * with room to spare. PNG is tried first and JPEG takes over when a lossless
 * grid of twenty-four video frames is — as it almost always is — far too big.
 */
const SHEET_BUDGET_CHARS = 150000;

export interface ContactSheet {
  dataUrl: string;
  columns: number;
  rows: number;
  frames: SheetFrame[];
  /** Set when the frames could not be read back into a canvas. */
  blockedReason: string;
}

export async function buildContactSheet(frames: SheetFrame[]): Promise<ContactSheet> {
  const columns = Math.min(SHEET_COLUMNS, Math.max(1, frames.length));
  const rows = Math.max(1, Math.ceil(frames.length / columns));
  const empty: ContactSheet = { dataUrl: '', columns, rows, frames, blockedReason: '' };
  if (!frames.length) return { ...empty, blockedReason: 'No frames were returned.' };

  let images: HTMLImageElement[];
  try {
    images = await Promise.all(frames.map((frame) => loadImage(frame.url)));
  } catch {
    return { ...empty, blockedReason: 'The frames could not be read back into the page.' };
  }

  const canvas = document.createElement('canvas');
  canvas.width = columns * TILE_WIDTH + (columns + 1) * TILE_GAP;
  canvas.height = rows * TILE_HEIGHT + (rows + 1) * TILE_GAP;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { ...empty, blockedReason: 'This browser has no 2D canvas.' };

  ctx.fillStyle = '#05060A';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  images.forEach((image, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    ctx.drawImage(
      image,
      TILE_GAP + column * (TILE_WIDTH + TILE_GAP),
      TILE_GAP + row * (TILE_HEIGHT + TILE_GAP),
      TILE_WIDTH,
      TILE_HEIGHT,
    );
  });

  const attempts: Array<[string, number]> = [
    ['image/png', 1],
    ['image/jpeg', 0.72],
    ['image/jpeg', 0.55],
    ['image/jpeg', 0.4],
  ];
  for (const [type, quality] of attempts) {
    let dataUrl = '';
    try {
      dataUrl = canvas.toDataURL(type, quality);
    } catch {
      // A single cross-origin frame taints the canvas; the vision pass then
      // falls back to sending the frame URLs themselves.
      return { ...empty, blockedReason: 'The frames are cross-origin, so the sheet could not be exported.' };
    }
    if (dataUrl.length <= SHEET_BUDGET_CHARS) {
      return { dataUrl, columns, rows, frames, blockedReason: '' };
    }
  }
  return { ...empty, blockedReason: 'The stitched sheet was too large to send.' };
}
