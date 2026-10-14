/**
 * MotionType — preview recording.
 *
 * A DOM subtree cannot be handed to a canvas, so this is a SECOND renderer of
 * the same plan: it reads the identical layout, the identical timings and the
 * identical easing curves as the CSS preview and repaints them with the 2D
 * API, then records that canvas with MediaRecorder.
 *
 * It is a faithful reconstruction, not a screen capture. Opacity, translation,
 * scale, skew, blur, the typewriter wipe and the glitch split all survive;
 * anything the browser does to real text that the 2D API cannot restate
 * (sub-pixel kerning, font synthesis, the compositor's own blur quality) will
 * differ slightly. The UI says so rather than claiming a pixel-exact match.
 */

import type { MotionPlan } from './motionPlan';
import { STAGE_W, easeEnter, easeExit, wordTimings } from './motionLayout';
import type { PlacedWord } from './motionLayout';

// ---------------------------------------------------------------------------
// Keyframe tables — the numeric twin of motionCss.ts
// ---------------------------------------------------------------------------

interface Stop {
  t: number;
  o?: number;
  dx?: number;
  dy?: number;
  s?: number;
  b?: number;
  sk?: number;
  r?: number;
}

interface WordState {
  opacity: number;
  dx: number;
  dy: number;
  scale: number;
  blur: number;
  skew: number;
  reveal: number;
}

const IDENTITY: WordState = { opacity: 1, dx: 0, dy: 0, scale: 1, blur: 0, skew: 0, reveal: 1 };

const ENTRANCE_STOPS: Record<string, Stop[]> = {
  fadeUp: [{ t: 0, o: 0, dy: 34 }, { t: 1, o: 1, dy: 0 }],
  fadeIn: [{ t: 0, o: 0 }, { t: 1, o: 1 }],
  scaleIn: [{ t: 0, o: 0, s: 0.72 }, { t: 1, o: 1, s: 1 }],
  slideLeft: [{ t: 0, o: 0, dx: -78 }, { t: 1, o: 1, dx: 0 }],
  slideRight: [{ t: 0, o: 0, dx: 78 }, { t: 1, o: 1, dx: 0 }],
  glitch: [
    { t: 0, o: 0, dx: -12, dy: 0, sk: 16 },
    { t: 0.18, o: 1, dx: 14, dy: -2, sk: -12 },
    { t: 0.34, o: 0.45, dx: -9, dy: 3, sk: 9 },
    { t: 0.52, o: 1, dx: 7, dy: -3, sk: -5 },
    { t: 0.74, o: 0.8, dx: -3, dy: 1, sk: 2 },
    { t: 1, o: 1, dx: 0, dy: 0, sk: 0 },
  ],
  typewriter: [{ t: 0, o: 1, r: 0 }, { t: 1, o: 1, r: 1 }],
  blur: [{ t: 0, o: 0, b: 16 }, { t: 1, o: 1, b: 0 }],
};

const EXIT_STOPS: Record<string, Stop[]> = {
  fadeOut: [{ t: 0, o: 1 }, { t: 1, o: 0 }],
  scaleOut: [{ t: 0, o: 1, s: 1 }, { t: 1, o: 0, s: 1.24 }],
  slideUp: [{ t: 0, o: 1, dy: 0 }, { t: 1, o: 0, dy: -52 }],
};

function read(stop: Stop, key: keyof Stop, fallback: number): number {
  const value = stop[key];
  return typeof value === 'number' ? value : fallback;
}

/**
 * Interpolate a stop table at linear progress `p`.
 *
 * CSS applies the timing function BETWEEN keyframes rather than across the
 * whole animation, so the segment is found on the linear clock and the easing
 * is applied inside it. For a two-stop table that reduces to easing the whole
 * run, which is exactly what the browser does.
 */
function sample(stops: Stop[], p: number, ease: (n: number) => number): WordState {
  const clamped = p < 0 ? 0 : p > 1 ? 1 : p;
  let a = stops[0];
  let b = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (clamped >= stops[i].t && clamped <= stops[i + 1].t) {
      a = stops[i];
      b = stops[i + 1];
      break;
    }
  }
  const span = b.t - a.t;
  const local = span <= 0 ? 1 : ease((clamped - a.t) / span);
  function mix(key: keyof Stop, fallback: number): number {
    const from = read(a, key, fallback);
    const to = read(b, key, fallback);
    return from + (to - from) * local;
  }
  return {
    opacity: mix('o', 1),
    dx: mix('dx', 0),
    dy: mix('dy', 0),
    scale: mix('s', 1),
    blur: mix('b', 0),
    skew: mix('sk', 0),
    reveal: mix('r', 1),
  };
}

/** The state of one word at time `t` in the sequence, in milliseconds. */
export function stateAt(entry: PlacedWord, timing: { enterStart: number; enterEnd: number; exitStart: number; exitEnd: number }, t: number): WordState {
  const word = entry.word;
  const enterStops = ENTRANCE_STOPS[word.entrance] || ENTRANCE_STOPS.fadeIn;

  if (t < timing.enterStart) {
    // CSS fill-mode `both` holds the 0% frame before the delay elapses.
    return sample(enterStops, 0, easeEnter);
  }
  if (t < timing.enterEnd) {
    const span = Math.max(1, timing.enterEnd - timing.enterStart);
    return sample(enterStops, (t - timing.enterStart) / span, easeEnter);
  }
  if (word.exit === 'none' || t < timing.exitStart) {
    return IDENTITY;
  }
  const exitStops = EXIT_STOPS[word.exit];
  if (!exitStops) return IDENTITY;
  const span = Math.max(1, timing.exitEnd - timing.exitStart);
  return sample(exitStops, (t - timing.exitStart) / span, easeExit);
}

// ---------------------------------------------------------------------------
// Background
// ---------------------------------------------------------------------------

/** Split on top-level commas so `rgba(0, 0, 0, 1)` survives intact. */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseStop(token: string, index: number, count: number): { color: string; offset: number } {
  const match = /^(.*?)\s+(-?\d+(?:\.\d+)?)%$/.exec(token.trim());
  if (match) {
    const offset = Number(match[2]) / 100;
    return { color: match[1].trim(), offset: offset < 0 ? 0 : offset > 1 ? 1 : offset };
  }
  return { color: token.trim(), offset: count <= 1 ? 0 : index / (count - 1) };
}

/**
 * Repaint the plan's background on a canvas. Linear and radial gradients are
 * reconstructed; anything else is treated as a flat colour, and an unusable
 * value falls back to the stage black rather than leaving the frame empty.
 */
export function paintBackground(
  ctx: CanvasRenderingContext2D,
  background: string,
  width: number,
  height: number,
): void {
  const fallback = '#0D0B05';
  ctx.save();
  ctx.fillStyle = fallback;

  const match = /^(linear|radial|conic)-gradient\(([\s\S]*)\)$/i.exec(String(background).trim());
  if (!match) {
    // An invalid assignment is ignored by the canvas, leaving the fallback.
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
    return;
  }

  const kind = match[1].toLowerCase();
  const tokens = splitTopLevel(match[2]);
  let angle = 180;
  if (tokens.length && /^(-?\d+(?:\.\d+)?deg|to\s)/i.test(tokens[0])) {
    const head = tokens.shift() as string;
    const deg = /^(-?\d+(?:\.\d+)?)deg$/i.exec(head.trim());
    if (deg) {
      angle = Number(deg[1]);
    } else {
      const dir = head.toLowerCase();
      angle = dir.indexOf('top') >= 0 ? 0 : dir.indexOf('right') >= 0 ? 90 : dir.indexOf('left') >= 0 ? 270 : 180;
    }
  }

  const stops = tokens.map(function toStop(token, i) {
    return parseStop(token, i, tokens.length);
  });

  if (stops.length === 0) {
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
    return;
  }

  let gradient: CanvasGradient;
  if (kind === 'linear') {
    // CSS measures the gradient line clockwise from "to top".
    const radians = ((angle - 90) * Math.PI) / 180;
    const length = Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians));
    const cx = width / 2;
    const cy = height / 2;
    gradient = ctx.createLinearGradient(
      cx - (Math.cos(radians) * length) / 2,
      cy - (Math.sin(radians) * length) / 2,
      cx + (Math.cos(radians) * length) / 2,
      cy + (Math.sin(radians) * length) / 2,
    );
  } else {
    gradient = ctx.createRadialGradient(
      width / 2,
      height / 2,
      0,
      width / 2,
      height / 2,
      Math.max(width, height) / 1.4,
    );
  }

  let added = 0;
  stops.forEach(function add(stop) {
    try {
      gradient.addColorStop(stop.offset, stop.color);
      added++;
    } catch (unusableColor) {
      // A stop the canvas cannot parse is skipped; the rest still render.
    }
  });

  if (added > 0) ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Frame rendering
// ---------------------------------------------------------------------------

let letterSpacingSupported: boolean | null = null;

function supportsLetterSpacing(ctx: CanvasRenderingContext2D): boolean {
  if (letterSpacingSupported === null) {
    letterSpacingSupported = 'letterSpacing' in ctx;
  }
  return letterSpacingSupported;
}

function drawWord(
  ctx: CanvasRenderingContext2D,
  entry: PlacedWord,
  state: WordState,
  width: number,
  height: number,
  scale: number,
): void {
  if (state.opacity <= 0.004 || state.reveal <= 0) return;

  const word = entry.word;
  const fontPx = Math.max(1, entry.fontPx * scale);

  ctx.save();
  ctx.globalAlpha = state.opacity;
  if (state.blur > 0.2) ctx.filter = 'blur(' + (state.blur * scale).toFixed(2) + 'px)';
  ctx.font = word.fontWeight + ' ' + fontPx.toFixed(2) + "px Inter, system-ui, sans-serif";
  if (supportsLetterSpacing(ctx)) {
    (ctx as any).letterSpacing = (entry.trackingPx * scale).toFixed(2) + 'px';
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = word.color;

  const full = ctx.measureText(entry.text).width;
  const visible =
    state.reveal >= 1 ? entry.text : entry.text.slice(0, Math.ceil(entry.text.length * state.reveal));

  ctx.translate((entry.leftPct / 100) * width + state.dx * scale, (entry.topPct / 100) * height + state.dy * scale);
  if (state.scale !== 1) ctx.scale(state.scale, state.scale);
  if (state.skew) ctx.transform(1, 0, Math.tan((-state.skew * Math.PI) / 180), 1, 0, 0);

  // The glitch entrance splits into colour fringes in CSS through its skew and
  // jitter; the canvas approximates that with two additive offset passes.
  if (word.entrance === 'glitch' && Math.abs(state.skew) > 0.5) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = state.opacity * 0.45;
    ctx.fillStyle = '#22d3ee';
    ctx.fillText(visible, -full / 2 - state.skew * 0.6, 0);
    ctx.fillStyle = '#f472b6';
    ctx.fillText(visible, -full / 2 + state.skew * 0.6, 0);
    ctx.restore();
  }

  if (word.emphasis) {
    ctx.shadowColor = word.color;
    ctx.shadowBlur = fontPx * 0.5;
  }
  ctx.fillText(visible, -full / 2, 0);
  ctx.restore();
}

/** Paint the whole stage at time `t` (ms into the sequence). */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  plan: MotionPlan,
  placed: PlacedWord[],
  timings: ReturnType<typeof wordTimings>,
  t: number,
  width: number,
  height: number,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  paintBackground(ctx, plan.background, width, height);
  const scale = width / STAGE_W;
  for (let i = 0; i < placed.length; i++) {
    const entry = placed[i];
    drawWord(ctx, entry, stateAt(entry, timings[entry.index], t), width, height, scale);
  }
}

// ---------------------------------------------------------------------------
// MediaRecorder
// ---------------------------------------------------------------------------

export interface RecorderSupport {
  supported: boolean;
  mimeType: string;
  reason: string;
}

const MIME_CANDIDATES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

export function detectRecorderSupport(): RecorderSupport {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { supported: false, mimeType: '', reason: 'Recording is only available in a browser.' };
  }
  const canvasProto = typeof HTMLCanvasElement === 'undefined' ? null : HTMLCanvasElement.prototype;
  if (!canvasProto || typeof (canvasProto as any).captureStream !== 'function') {
    return { supported: false, mimeType: '', reason: 'This browser cannot capture a canvas as a video stream.' };
  }
  if (typeof (window as any).MediaRecorder === 'undefined') {
    return { supported: false, mimeType: '', reason: 'This browser does not provide MediaRecorder.' };
  }
  const Recorder = (window as any).MediaRecorder;
  let mimeType = '';
  if (typeof Recorder.isTypeSupported === 'function') {
    for (let i = 0; i < MIME_CANDIDATES.length; i++) {
      if (Recorder.isTypeSupported(MIME_CANDIDATES[i])) {
        mimeType = MIME_CANDIDATES[i];
        break;
      }
    }
  }
  if (!mimeType) {
    return { supported: false, mimeType: '', reason: 'This browser cannot encode WebM video.' };
  }
  return { supported: true, mimeType, reason: '' };
}

export interface RecordOptions {
  plan: MotionPlan;
  placed: PlacedWord[];
  width?: number;
  height?: number;
  fps?: number;
  onProgress?: (ratio: number) => void;
}

/** Trailing frames so the last exit is fully encoded before the stream ends. */
const TAIL_MS = 320;

/**
 * Render the plan to an offscreen canvas and record it.
 *
 * Resolves with the encoded clip, rejects with a readable reason. The stream
 * tracks, the recorder and the animation frame are released on every path, so
 * an aborted or failed attempt never leaves a capture running.
 */
export function recordPlan(options: RecordOptions): Promise<{ blob: Blob; mimeType: string }> {
  const support = detectRecorderSupport();
  if (!support.supported) {
    return Promise.reject(new Error(support.reason));
  }

  const width = options.width || 1280;
  const height = options.height || 720;
  const fps = options.fps || 30;
  const { plan, placed } = options;
  const timings = wordTimings(plan);
  const total = plan.durationMs;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return Promise.reject(new Error('This browser did not provide a 2D canvas context.'));
  }

  return new Promise(function run(resolve, reject) {
    let stream: MediaStream;
    let recorder: any;
    let frame = 0;
    let settled = false;

    function cleanup(): void {
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      if (stream) {
        stream.getTracks().forEach(function stop(track) {
          try {
            track.stop();
          } catch (alreadyStopped) {
            /* the track had already ended */
          }
        });
      }
    }

    function failWith(error: Error): void {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    }

    try {
      stream = (canvas as any).captureStream(fps) as MediaStream;
      recorder = new (window as any).MediaRecorder(stream, {
        mimeType: support.mimeType,
        videoBitsPerSecond: 6_000_000,
      });
    } catch (startError) {
      failWith(new Error('The browser refused to start a recording of the preview.'));
      return;
    }

    const chunks: BlobPart[] = [];
    recorder.ondataavailable = function collect(event: any) {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = function onError() {
      failWith(new Error('The recorder stopped unexpectedly.'));
    };
    recorder.onstop = function onStop() {
      if (settled) return;
      settled = true;
      cleanup();
      const blob = new Blob(chunks, { type: support.mimeType.split(';')[0] });
      if (blob.size === 0) {
        reject(new Error('The recording came back empty.'));
        return;
      }
      resolve({ blob, mimeType: support.mimeType });
    };

    // Paint frame zero before starting so the clip never opens on a blank frame.
    drawFrame(ctx, plan, placed, timings, 0, width, height);

    try {
      recorder.start(100);
    } catch (startError) {
      failWith(new Error('The browser refused to start a recording of the preview.'));
      return;
    }

    const started = performance.now();
    function tick(): void {
      if (settled) return;
      const elapsed = performance.now() - started;
      drawFrame(ctx as CanvasRenderingContext2D, plan, placed, timings, Math.min(elapsed, total), width, height);
      if (options.onProgress) options.onProgress(Math.min(1, elapsed / total));
      if (elapsed >= total + TAIL_MS) {
        frame = 0;
        try {
          recorder.stop();
        } catch (stopError) {
          failWith(new Error('The recording could not be finished cleanly.'));
        }
        return;
      }
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
  });
}

/** Turn the animation name into a safe download filename. */
export function filenameFor(plan: MotionPlan): string {
  const slug = plan.animationName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return 'motiontype-' + (slug || 'animation') + '.webm';
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Revoked on a delay: Safari reads the href after the click returns.
  setTimeout(function release() {
    URL.revokeObjectURL(url);
  }, 10000);
}
