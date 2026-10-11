// Step 8 — technical QA.
//
// Twenty-four frames, evenly spaced, stitched into ONE grid. The grid is the
// point: a single contact sheet tells a vision model more about pacing,
// repetition and hierarchy than twenty-four separate images can, and it costs
// one model call instead of twenty-four.
//
// The automated checks here are narrow and honest. Blank-frame detection is
// real — it measures pixel variance and a flat tile is flat. Edge-bleed
// detection is a heuristic that flags bright content touching the frame edge,
// which is usually text running out of the safe area. Neither is a verdict:
// they are hints handed to the critic, which is the actual judge.

import { WORKSPACE_ID } from '../lib/platform';
import { RENDER_CONSTRAINTS } from '../sdk/component-sdk.types';

/** How many tiles the sheet is built from. 24 reads as a storyboard. */
export const SHEET_FRAME_COUNT = 24;
export const SHEET_COLUMNS = 6;

/** The platform frame extractor takes a limited number of timestamps per call. */
const FRAMES_PER_CALL = 12;

/** Tile geometry. Small on purpose: the whole sheet has to fit in one request. */
const TILE_WIDTH = 256;
const TILE_HEIGHT = Math.round((TILE_WIDTH * RENDER_CONSTRAINTS.height) / RENDER_CONSTRAINTS.width);
const TILE_GAP = 2;

/**
 * The Anthropic proxy caps a request body, so the sheet is re-encoded down
 * until its base64 fits with room to spare. PNG is tried first and JPEG takes
 * over when a lossless grid of 24 video frames is — as it almost always is —
 * far too big.
 */
const SHEET_BUDGET_CHARS = 150000;

export interface SheetFrame {
  timestamp: number;
  frame: number;
  url: string;
}

export interface QAResult {
  frames: string[];           // 24 frame image URLs sampled evenly
  frameTimestamps: number[];
  frameNumbers: number[];
  contactSheetUrl: string;    // composite of all 24 frames, as a data URL
  columns: number;
  rows: number;
  hasBlankFrames: boolean;
  blankFrameNumbers: number[];
  hasTextOverflow: boolean;   // detected from frames
  overflowFrameNumbers: number[];
  /** Set when the frames could not be read back into a canvas. */
  blockedReason: string;
}

/**
 * Spread the samples across the film without ever asking for the very first
 * or very last instant — ffmpeg lands those on a boundary that may still be
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
      if (!frame?.url) continue;
      const timestamp = Number(frame.timestamp) || 0;
      out.push({
        timestamp,
        frame: Math.round(timestamp * RENDER_CONSTRAINTS.fps),
        url: String(frame.url),
      });
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

interface TileReading {
  blank: boolean;
  edgeBleed: boolean;
}

/**
 * Read one tile out of the stitched canvas.
 *
 * BLANK: the tile's luminance barely varies, so there is nothing on it. A
 * deliberate hold on a flat colour reads the same way, which is why this is a
 * hint for the critic rather than a failure on its own.
 *
 * EDGE BLEED: bright pixels sitting in the outermost 1.5% of the tile. Type
 * that has run out of the safe area looks exactly like this, and it is the
 * one layout fault a still frame can prove.
 */
function readTile(data: Uint8ClampedArray, width: number, height: number): TileReading {
  let min = 255;
  let max = 0;
  let sum = 0;
  let count = 0;
  let edgeHits = 0;

  const margin = Math.max(2, Math.round(width * 0.015));
  const step = 2;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const offset = (y * width + x) * 4;
      const lum = 0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2];
      if (lum < min) min = lum;
      if (lum > max) max = lum;
      sum += lum;
      count += 1;
      const onEdge = x < margin || x >= width - margin;
      if (onEdge && lum > 150) edgeHits += 1;
    }
  }

  const mean = count ? sum / count : 0;
  let variance = 0;
  for (let y = 0; y < height; y += step * 2) {
    for (let x = 0; x < width; x += step * 2) {
      const offset = (y * width + x) * 4;
      const lum = 0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2];
      variance += (lum - mean) * (lum - mean);
    }
  }
  const spread = max - min;

  return {
    blank: spread < 12 && variance < 1,
    edgeBleed: edgeHits > Math.max(8, (height / step) * 0.35),
  };
}

export interface ContactSheet {
  dataUrl: string;
  columns: number;
  rows: number;
  blankIndexes: number[];
  overflowIndexes: number[];
  blockedReason: string;
}

export async function buildContactSheet(frames: SheetFrame[]): Promise<ContactSheet> {
  const columns = Math.min(SHEET_COLUMNS, Math.max(1, frames.length));
  const rows = Math.max(1, Math.ceil(frames.length / columns));
  const empty: ContactSheet = {
    dataUrl: '', columns, rows, blankIndexes: [], overflowIndexes: [], blockedReason: '',
  };
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

  const blankIndexes: number[] = [];
  const overflowIndexes: number[] = [];
  try {
    images.forEach((_image, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const tile = ctx.getImageData(
        TILE_GAP + column * (TILE_WIDTH + TILE_GAP),
        TILE_GAP + row * (TILE_HEIGHT + TILE_GAP),
        TILE_WIDTH,
        TILE_HEIGHT,
      );
      const reading = readTile(tile.data, TILE_WIDTH, TILE_HEIGHT);
      if (reading.blank) blankIndexes.push(index);
      if (reading.edgeBleed) overflowIndexes.push(index);
    });
  } catch {
    // A cross-origin frame taints the canvas: the pixels cannot be read and
    // neither can the sheet be exported. Both fall back below.
    return { ...empty, blockedReason: 'The frames are cross-origin, so they could not be inspected.' };
  }

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
      return {
        ...empty,
        blankIndexes,
        overflowIndexes,
        blockedReason: 'The frames are cross-origin, so the sheet could not be exported.',
      };
    }
    if (dataUrl.length <= SHEET_BUDGET_CHARS) {
      return { dataUrl, columns, rows, blankIndexes, overflowIndexes, blockedReason: '' };
    }
  }
  return {
    ...empty,
    blankIndexes,
    overflowIndexes,
    blockedReason: 'The stitched sheet was too large to send.',
  };
}

export interface QAOptions {
  frameCount?: number;
  onProgress?: (detail: string) => void;
}

export async function runTechnicalQA(
  videoUrl: string,
  options: QAOptions = {},
): Promise<QAResult> {
  const report = options.onProgress || (() => undefined);
  const totalFrames = options.frameCount || RENDER_CONSTRAINTS.fps * 20;
  const seconds = totalFrames / RENDER_CONSTRAINTS.fps;

  report('Pulling ' + String(SHEET_FRAME_COUNT) + ' frames out of the file…');
  const frames = await extractFrames(videoUrl, sampleTimestamps(seconds), (done, total) => {
    report('Extracted ' + String(done) + ' of ' + String(total) + ' frames…');
  });

  if (!frames.length) throw new Error('No frames could be extracted from the rendered file.');

  report('Stitching the contact sheet…');
  const sheet = await buildContactSheet(frames);

  return {
    frames: frames.map((frame) => frame.url),
    frameTimestamps: frames.map((frame) => frame.timestamp),
    frameNumbers: frames.map((frame) => frame.frame),
    contactSheetUrl: sheet.dataUrl,
    columns: sheet.columns,
    rows: sheet.rows,
    hasBlankFrames: sheet.blankIndexes.length > 0,
    blankFrameNumbers: sheet.blankIndexes.map((index) => frames[index]?.frame ?? 0),
    hasTextOverflow: sheet.overflowIndexes.length > 0,
    overflowFrameNumbers: sheet.overflowIndexes.map((index) => frames[index]?.frame ?? 0),
    blockedReason: sheet.blockedReason,
  };
}
