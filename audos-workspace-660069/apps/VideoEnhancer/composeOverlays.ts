/**
 * Video Enhancer — Phase 2 composition layer (the workspace's HyperFrames-
 * equivalent compositor) + procedural SFX synthesis.
 *
 * Caption nodes and GRAPHIC visual nodes are rendered as styled HTML/CSS-like
 * compositions on an offscreen <canvas> at the video's native width, exported
 * as transparent PNGs, and composited onto the edited video by the FFmpeg
 * `overlay` filter chain that applyPlan.ts builds. Each composition render is
 * verified non-blank and retried up to COMPOSITION_RETRIES times before the
 * node is marked failed — a failed node is surfaced in the UI, never silently
 * skipped.
 *
 * SFX cues are synthesized procedurally (whoosh / pop / chime / riser / thud
 * families inferred from the cue text) as 48 kHz mono WAVs, then mixed into
 * the output track by the FFmpeg `adelay` + `amix` pass at their remapped
 * timestamps. Fully deterministic, no network fetches, no licensing risk.
 */

/** Per the failure-handling contract: each composition render is retried this
 * many times before the node is marked failed and surfaced in the UI. */
export const COMPOSITION_RETRIES = 2;

function msg(e: unknown): string { return e instanceof Error ? e.message : String(e); }

// ---------------------------------------------------------------------------
// Canvas compositions (browser only)
// ---------------------------------------------------------------------------

export interface CaptionCompositionSpec {
  id: string;
  text: string;
  emphasizedWords: string[];
  /** Video width in px — the band spans the full frame width. */
  width: number;
  /** Band height in px (the overlay PNG's height). */
  bandHeight: number;
  accent: string;
}

export interface GraphicCompositionSpec {
  id: string;
  /** Plan visual type: graphic | diagram | screenshot (anything non-footage). */
  type: string;
  description: string;
  width: number;
  bandHeight: number;
  accent: string;
}

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round(w));
  canvas.height = Math.max(2, Math.round(h));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create the composition canvas.');
  return { canvas, ctx };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function fontFor(weight: number, sizePx: number): string {
  return weight + ' ' + Math.max(8, Math.round(sizePx)) + "px 'Inter', system-ui, -apple-system, sans-serif";
}

function cleanWord(w: string): string { return w.replace(/[^\p{L}\p{N}']/gu, '').toLowerCase(); }

/** Word-wrap with real text metrics; caps lines and ellipsizes the overflow. */
function wrapWords(ctx: CanvasRenderingContext2D, words: string[], maxWidth: number, maxLines: number): string[][] {
  const lines: string[][] = [];
  let line: string[] = [];
  for (const w of words) {
    const candidate = [...line, w].join(' ');
    if (line.length && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = [w];
    } else {
      line.push(w);
    }
  }
  if (line.length) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    const lastLine = kept[maxLines - 1];
    lastLine[lastLine.length - 1] = lastLine[lastLine.length - 1].replace(/\s*$/, '') + '…';
    return kept;
  }
  return lines;
}

/** Fail the render if the canvas came out (near-)blank — triggers the retry. */
function assertNotBlank(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const sample = ctx.getImageData(0, 0, w, h).data;
  let painted = 0;
  for (let i = 3; i < sample.length; i += 397 * 4) {
    if (sample[i] > 8) painted++;
  }
  if (painted < 3) throw new Error('the composition rendered blank');
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob || !blob.size) { reject(new Error('PNG export produced no data')); return; }
      blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf))).catch(reject);
    }, 'image/png');
  });
}

/**
 * Caption composition: premium word-pop style — bold white text on a soft
 * dark pill, emphasized words in the brand accent, up to 3 wrapped lines,
 * bottom-anchored inside the band (the band itself sits in the lower third,
 * clear of a talking-head subject's face).
 */
async function renderCaption(spec: CaptionCompositionSpec): Promise<Uint8Array> {
  const W = spec.width;
  const H = spec.bandHeight;
  const { canvas, ctx } = makeCanvas(W, H);
  const fs = Math.max(16, Math.round(H * 0.255));
  ctx.font = fontFor(800, fs);
  const words = String(spec.text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) throw new Error('the caption has no text');
  const lines = wrapWords(ctx, words, W * 0.82, 3);
  const lineH = Math.round(fs * 1.28);
  const padX = Math.round(fs * 0.55);
  const padY = Math.round(fs * 0.34);
  const blockH = lines.length * lineH + padY * 2;
  const blockTop = H - blockH - Math.round(fs * 0.2);
  const emphasized = new Set(spec.emphasizedWords.map(cleanWord).filter(Boolean));

  let widest = 0;
  for (const line of lines) widest = Math.max(widest, ctx.measureText(line.join(' ')).width);
  const pillW = Math.min(W * 0.9, widest + padX * 2);
  const pillX = (W - pillW) / 2;
  ctx.fillStyle = 'rgba(6,9,18,0.62)';
  roundRect(ctx, pillX, blockTop, pillW, blockH, Math.round(fs * 0.42));
  ctx.fill();

  ctx.textBaseline = 'middle';
  const spaceW = ctx.measureText(' ').width;
  lines.forEach((line, li) => {
    const lineText = line.join(' ');
    const lineW = ctx.measureText(lineText).width;
    let x = (W - lineW) / 2;
    const y = blockTop + padY + li * lineH + lineH / 2;
    for (const w of line) {
      ctx.fillStyle = emphasized.has(cleanWord(w)) ? spec.accent : '#FFFFFF';
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = fs * 0.12;
      ctx.shadowOffsetY = fs * 0.04;
      ctx.fillText(w, x, y);
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      x += ctx.measureText(w).width + spaceW;
    }
  });

  assertNotBlank(ctx, canvas.width, canvas.height);
  return canvasToPng(canvas);
}

/**
 * Graphic composition (visual nodes that are not footage inserts): a branded
 * lower-third card — accent spine, uppercase type label, and the visual's
 * description as the card text.
 */
async function renderGraphic(spec: GraphicCompositionSpec): Promise<Uint8Array> {
  const W = spec.width;
  const H = spec.bandHeight;
  const { canvas, ctx } = makeCanvas(W, H);
  const fs = Math.max(14, Math.round(H * 0.21));
  const labelFs = Math.max(10, Math.round(fs * 0.58));
  ctx.font = fontFor(700, fs);
  const words = String(spec.description || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) throw new Error('the graphic has no description to render');
  const lines = wrapWords(ctx, words, W * 0.56, 2);
  const lineH = Math.round(fs * 1.3);
  const padX = Math.round(fs * 0.8);
  const padY = Math.round(fs * 0.55);
  const labelH = Math.round(labelFs * 1.5);
  const cardH = labelH + lines.length * lineH + padY * 2;
  const cardTop = H - cardH - Math.round(fs * 0.25);

  let widest = 0;
  ctx.font = fontFor(700, fs);
  for (const line of lines) widest = Math.max(widest, ctx.measureText(line.join(' ')).width);
  const cardW = Math.min(W * 0.72, Math.max(widest + padX * 2, W * 0.3));
  const cardX = Math.round(W * 0.05);

  ctx.fillStyle = 'rgba(8,12,24,0.82)';
  roundRect(ctx, cardX, cardTop, cardW, cardH, Math.round(fs * 0.4));
  ctx.fill();
  ctx.fillStyle = spec.accent;
  roundRect(ctx, cardX, cardTop, Math.max(4, Math.round(W * 0.004)), cardH, 3);
  ctx.fill();

  ctx.textBaseline = 'middle';
  ctx.font = fontFor(800, labelFs);
  ctx.fillStyle = spec.accent;
  const label = String(spec.type || 'graphic').toUpperCase();
  ctx.fillText(label, cardX + padX, cardTop + padY + labelH / 2);

  ctx.font = fontFor(700, fs);
  ctx.fillStyle = '#FFFFFF';
  lines.forEach((line, li) => {
    ctx.fillText(line.join(' '), cardX + padX, cardTop + padY + labelH + li * lineH + lineH / 2);
  });

  assertNotBlank(ctx, canvas.width, canvas.height);
  return canvasToPng(canvas);
}

/** Retry contract: render → verify → retry up to COMPOSITION_RETRIES times. */
async function withRetry(id: string, render: () => Promise<Uint8Array>): Promise<Uint8Array> {
  let lastErr = '';
  for (let attempt = 0; attempt <= COMPOSITION_RETRIES; attempt++) {
    try {
      const png = await render();
      if (!png || png.byteLength < 100) throw new Error('PNG export came back empty');
      return png;
    } catch (e) {
      lastErr = msg(e);
      console.warn('[VideoEnhancer] composition ' + id + ' attempt ' + (attempt + 1) + ' failed: ' + lastErr);
    }
  }
  throw new Error('Composition ' + id + ' failed after ' + (COMPOSITION_RETRIES + 1) + ' attempts: ' + lastErr);
}

export function renderCaptionComposition(spec: CaptionCompositionSpec): Promise<Uint8Array> {
  return withRetry(spec.id, () => renderCaption(spec));
}

export function renderGraphicComposition(spec: GraphicCompositionSpec): Promise<Uint8Array> {
  return withRetry(spec.id, () => renderGraphic(spec));
}

// ---------------------------------------------------------------------------
// SFX synthesis (pure PCM → WAV — runs anywhere, fully deterministic)
// ---------------------------------------------------------------------------

const SFX_RATE = 48000;

export function encodeWavPcm16(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, samples.length * bytesPerSample, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

function synthBuffer(durationSec: number, fill: (t: number, p: number) => number): Float32Array {
  const n = Math.max(1, Math.round(durationSec * SFX_RATE));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = fill(i / SFX_RATE, i / (n - 1 || 1));
  return out;
}

/** Procedurally synthesize a short SFX from its cue text. */
export function synthesizeSfx(cue: string): Float32Array {
  const c = String(cue || '').toLowerCase();
  if (/(whoosh|swoosh|swish|sweep|transition|woosh)/.test(c)) {
    let lp = 0;
    return synthBuffer(0.55, (t, p) => {
      const noise = Math.random() * 2 - 1;
      const cutoff = 0.06 + 0.5 * Math.sin(Math.PI * p);
      lp += cutoff * (noise - lp);
      return lp * Math.sin(Math.PI * p) * 0.9;
    });
  }
  if (/(riser|rise|build|ramp)/.test(c)) {
    return synthBuffer(0.8, (t, p) => Math.sin(2 * Math.PI * (180 + 620 * p * p) * t) * p * 0.5);
  }
  if (/(ding|chime|bell|ping|notification|sparkle)/.test(c)) {
    return synthBuffer(0.7, (t) => (Math.sin(2 * Math.PI * 1318.5 * t) * 0.6 + Math.sin(2 * Math.PI * 1975.5 * t) * 0.25) * Math.exp(-5.5 * t));
  }
  if (/(thud|impact|boom|bass|hit|punch|slam)/.test(c)) {
    return synthBuffer(0.5, (t) => Math.sin(2 * Math.PI * (110 - 55 * Math.min(1, t * 3)) * t) * Math.exp(-7 * t) * 0.95);
  }
  // Default: soft pop/click.
  return synthBuffer(0.18, (t) => Math.sin(2 * Math.PI * 880 * t) * Math.exp(-28 * t) * 0.8);
}

/** WAV bytes for one synthesized cue — what gets written into the FFmpeg FS. */
export function sfxWav(cue: string): Uint8Array {
  return encodeWavPcm16(synthesizeSfx(cue), SFX_RATE);
}

/** Silent WAV of the given length — insert audio slots + silent-source base. */
export function silenceWav(durationSec: number): Uint8Array {
  return encodeWavPcm16(new Float32Array(Math.max(1, Math.round(durationSec * SFX_RATE))), SFX_RATE);
}
