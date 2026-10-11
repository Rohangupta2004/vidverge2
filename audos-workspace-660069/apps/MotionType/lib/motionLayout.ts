/**
 * MotionType — geometry and timing.
 *
 * The CSS preview and the canvas recorder are two renderers of the same plan,
 * so neither is allowed to invent its own positions or its own clock. Both
 * read `layoutWords` and `wordTimings` from here, which is the only reason the
 * recorded .webm resembles what the browser painted.
 *
 * Everything is computed in a virtual 1600x900 stage and emitted as
 * percentages, so the same numbers drive a 480px preview pane and a 1280x720
 * recording canvas.
 */

import { applyTextTransform, lengthToPx } from './motionPlan';
import type { MotionPlan, MotionWord } from './motionPlan';

export const STAGE_W = 1600;
export const STAGE_H = 900;

/** Widest a line may run before it wraps, leaving a margin either side. */
const MAX_LINE_W = 1340;

/** Average glyph advance as a fraction of the font size, for Inter-ish text. */
const GLYPH_RATIO = 0.56;

export interface PlacedWord {
  index: number;
  word: MotionWord;
  /** The text actually drawn, after textTransform. */
  text: string;
  /** Centre of the word, as a percentage of the stage. */
  leftPct: number;
  topPct: number;
  /** Font size in virtual stage pixels. */
  fontPx: number;
  /** Letter spacing in virtual stage pixels. */
  trackingPx: number;
  /** Estimated width in virtual stage pixels. */
  widthPx: number;
}

function clamp(n: number, min: number, max: number): number {
  return n < min ? min : n > max ? max : n;
}

/**
 * Centre the words as a wrapped block.
 *
 * The plan deliberately carries no coordinates — asking a language model for
 * pixel positions produces overlapping piles. It supplies typography and
 * rhythm; the stage decides where that lands, which is what keeps the
 * composition legible and centred however many words arrive.
 */
export function layoutWords(plan: MotionPlan): PlacedWord[] {
  const metrics = plan.words.map(function measure(word) {
    const fontPx = lengthToPx(word.fontSize, 16, STAGE_W, STAGE_H) || 64;
    const trackingPx = lengthToPx(word.letterSpacing, fontPx, STAGE_W, STAGE_H);
    const text = applyTextTransform(word.word, word.textTransform);
    const widthPx = Math.max(fontPx * 0.5, text.length * (fontPx * GLYPH_RATIO + trackingPx));
    return { fontPx, trackingPx, text, widthPx };
  });

  interface Line {
    items: number[];
    width: number;
    height: number;
  }

  const lines: Line[] = [];
  let items: number[] = [];
  let width = 0;
  let height = 0;

  for (let i = 0; i < metrics.length; i++) {
    const m = metrics[i];
    const gap = items.length ? m.fontPx * 0.34 : 0;
    if (items.length && width + gap + m.widthPx > MAX_LINE_W) {
      lines.push({ items, width, height });
      items = [];
      width = 0;
      height = 0;
    }
    width += (items.length ? m.fontPx * 0.34 : 0) + m.widthPx;
    height = Math.max(height, m.fontPx * 1.26);
    items.push(i);
  }
  if (items.length) lines.push({ items, width, height });

  const blockHeight = lines.reduce(function add(sum, line) {
    return sum + line.height;
  }, 0);
  // A block taller than the stage is squeezed rather than clipped, so an
  // over-enthusiastic font size still renders something readable.
  const squeeze = blockHeight > STAGE_H * 0.92 ? (STAGE_H * 0.92) / blockHeight : 1;

  const placed: PlacedWord[] = [];
  let cursorY = (STAGE_H - blockHeight * squeeze) / 2;

  for (let l = 0; l < lines.length; l++) {
    const line = lines[l];
    const lineHeight = line.height * squeeze;
    const centreY = cursorY + lineHeight / 2;
    let cursorX = (STAGE_W - line.width * squeeze) / 2;

    for (let k = 0; k < line.items.length; k++) {
      const index = line.items[k];
      const m = metrics[index];
      const w = m.widthPx * squeeze;
      if (k > 0) cursorX += m.fontPx * 0.34 * squeeze;
      placed.push({
        index,
        word: plan.words[index],
        text: m.text,
        leftPct: clamp(((cursorX + w / 2) / STAGE_W) * 100, 2, 98),
        topPct: clamp((centreY / STAGE_H) * 100, 3, 97),
        fontPx: m.fontPx * squeeze,
        trackingPx: m.trackingPx * squeeze,
        widthPx: w,
      });
      cursorX += w;
    }

    cursorY += lineHeight;
  }

  placed.sort(function byIndex(a, b) {
    return a.index - b.index;
  });
  return placed;
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

export interface WordTiming {
  enterStart: number;
  enterEnd: number;
  /** Equal to `exitEnd` when the word has no exit, so it simply holds. */
  exitStart: number;
  exitEnd: number;
}

/**
 * The sequence clock.
 *
 * The schema gives each word a delay and a duration but never says when it
 * leaves, so the stage sets that rule: a word enters on its own delay, holds,
 * and every exit plays out together in the last slice of the sequence. The
 * plan's own `durationMs` stays the source of truth for the total length —
 * which is also the loop interval, so a loop restarts only after the exits
 * have finished.
 */
export function wordTimings(plan: MotionPlan): WordTiming[] {
  const total = plan.durationMs;
  const exitSpan = clamp(Math.round(total * 0.18), 260, 900);
  const exitStart = Math.max(120, total - exitSpan);

  return plan.words.map(function schedule(word) {
    const enterStart = clamp(word.delayMs, 0, Math.max(0, exitStart - 120));
    const enterEnd = enterStart + clamp(word.durationMs, 120, Math.max(120, exitStart - enterStart));
    return {
      enterStart,
      enterEnd,
      exitStart: word.exit === 'none' ? total : exitStart,
      exitEnd: total,
    };
  });
}

// ---------------------------------------------------------------------------
// Easing
// ---------------------------------------------------------------------------

/** The entrance curve, written once so CSS and canvas agree on it. */
export const ENTER_EASING = 'cubic-bezier(0.22, 0.7, 0.2, 1)';
export const EXIT_EASING = 'cubic-bezier(0.4, 0, 0.9, 0.4)';

function bezier(p1: number, p2: number, t: number): number {
  const u = 1 - t;
  return 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t;
}

/**
 * Solve a one-dimensional cubic bezier for y at a given x. Newton's method
 * with a bisection guard — ten iterations is well inside a frame budget and
 * lands close enough that the canvas and the compositor stay in step.
 */
function solveBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  let t = x;
  for (let i = 0; i < 8; i++) {
    const current = bezier(x1, x2, t) - x;
    if (Math.abs(current) < 0.0005) break;
    const slope =
      3 * (1 - t) * (1 - t) * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t * t * (1 - x2);
    if (Math.abs(slope) < 1e-6) break;
    t -= current / slope;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
  }
  return bezier(y1, y2, t);
}

export function easeEnter(progress: number): number {
  return solveBezier(0.22, 0.7, 0.2, 1, clamp(progress, 0, 1));
}

export function easeExit(progress: number): number {
  return solveBezier(0.4, 0, 0.9, 0.4, clamp(progress, 0, 1));
}
