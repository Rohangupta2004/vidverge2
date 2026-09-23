/**
 * Video Enhancer — Auto Captions rendering engine.
 *
 * Caption segments themselves (transcription, word-timed grouping, in-place
 * text edits) are the enhancerCore.ts primitives already used elsewhere in
 * the app (transcribeVideo, buildCaptionSegments, retimeSegmentText,
 * CaptionSegment / CaptionWord). This module owns only the STYLE and the
 * canvas draw routine shared by the live preview overlay and the export
 * burn-in, so captions always look identical in both places.
 *
 * Styles are deterministic canvas draws (no LLM code generation, no network
 * call) so captions are instant and never fail to render. The default
 * "brand" style is the VidVerge look: a Charcoal (#121214) pill, Warm White
 * (#F4F2EE) text, and a Coral (#FF6B4A) highlight on the word being spoken.
 */
import type { CaptionSegment, CaptionWord } from './enhancerCore';

// ---------------------------------------------------------------------------
// Brand palette (VidVerge)
// ---------------------------------------------------------------------------

export const BRAND_CHARCOAL = '#121214';
export const BRAND_WARM_WHITE = '#F4F2EE';
export const BRAND_CORAL = '#FF6B4A';

function clamp(v: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, v)); }

// ---------------------------------------------------------------------------
// Style catalog
// ---------------------------------------------------------------------------

export type CaptionStyleId = 'brand' | 'bold' | 'karaoke' | 'minimal';

export const DEFAULT_CAPTION_STYLE: CaptionStyleId = 'brand';

/** Where the caption block sits on the frame — user-changeable. */
export type CaptionPosition = 'top' | 'middle' | 'bottom';
export const DEFAULT_CAPTION_POSITION: CaptionPosition = 'bottom';
export const CAPTION_POSITIONS: { id: CaptionPosition; label: string }[] = [
  { id: 'top', label: 'Top' },
  { id: 'middle', label: 'Middle' },
  { id: 'bottom', label: 'Bottom' },
];

export const CAPTION_STYLES: { id: CaptionStyleId; label: string; hint: string }[] = [
  { id: 'brand', label: 'Brand', hint: 'Charcoal pill, warm white text, coral highlight on the spoken word — the VidVerge look.' },
  { id: 'bold', label: 'Bold Pop', hint: 'Big bold white caps with a heavy shadow — built for social.' },
  { id: 'karaoke', label: 'Karaoke', hint: 'Words light up in coral as they are spoken; unspoken words stay dim.' },
  { id: 'minimal', label: 'Minimal', hint: 'Small, clean, translucent pill that stays out of the way.' },
];

/** The one caption segment active at time t (segments should not overlap). */
export function activeCaptionSegment(segments: CaptionSegment[], t: number): CaptionSegment | null {
  for (const s of segments) {
    if (s.enabled && t >= s.start && t < s.end) return s;
  }
  return null;
}

/** A tiny synthetic segment used to render style swatches in the panel UI. */
export function demoCaptionSegment(): CaptionSegment {
  return {
    id: 'demo',
    start: 0,
    end: 2,
    text: 'Hello World',
    words: [
      { t: 'Hello', s: 0, e: 0.5 },
      { t: 'World', s: 0.6, e: 1.2 },
    ],
    enabled: true,
  };
}

/** Playback time to preview a swatch at — lands mid-word so highlight styles show their effect. */
export const DEMO_CAPTION_T = 0.8;

// ---------------------------------------------------------------------------
// Layout: wrap word tokens (with their own timing) into up to `maxLines` rows
// ---------------------------------------------------------------------------

interface LaidWord { w: CaptionWord; x: number; width: number }
interface Line { words: LaidWord[]; width: number; y: number }

function layoutWords(ctx: CanvasRenderingContext2D, words: CaptionWord[], fallbackText: string, maxW: number, maxLines: number): { lines: Line[]; lineH: number; fs: number } {
  const tokens: CaptionWord[] = words.length
    ? words
    : fallbackText.split(/\s+/).filter(Boolean).map((t) => ({ t, s: 0, e: 0 }));
  const fs = Number(ctx.font.match(/(\d+(?:\.\d+)?)px/)?.[1]) || 24;
  const spaceW = ctx.measureText(' ').width || fs * 0.28;
  const rows: CaptionWord[][] = [[]];
  let rowWidth = 0;
  for (const w of tokens) {
    const ww = ctx.measureText(w.t).width;
    const addW = rowWidth > 0 ? ww + spaceW : ww;
    if (rowWidth + addW > maxW && rowWidth > 0) {
      rows.push([w]);
      rowWidth = ww;
    } else {
      rows[rows.length - 1].push(w);
      rowWidth += addW;
    }
  }
  const kept = rows.filter((r) => r.length).slice(0, maxLines);
  const lineH = fs * 1.32;
  const lines: Line[] = kept.map((row, i) => {
    let x = 0;
    const laid: LaidWord[] = row.map((w) => {
      const width = ctx.measureText(w.t).width;
      const item: LaidWord = { w, x, width };
      x += width + spaceW;
      return item;
    });
    return { words: laid, width: Math.max(0, x - spaceW), y: i * lineH };
  });
  return { lines, lineH, fs };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rad = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// Draw
// ---------------------------------------------------------------------------

/**
 * Draw the active caption segment for time `t` onto (0,0,W,H) canvas
 * coordinates — anchored to the bottom of whatever frame the caller is
 * rendering (the visible/cropped preview area, or the export canvas), so
 * captions always sit correctly regardless of aspect-ratio cropping.
 */
export function drawCaptionOverlay(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  t: number,
  segments: CaptionSegment[],
  styleId: CaptionStyleId,
  position: CaptionPosition = DEFAULT_CAPTION_POSITION,
): void {
  const seg = activeCaptionSegment(segments, t);
  if (!seg || (!seg.text.trim() && !seg.words.length)) return;
  try {
    drawSegment(ctx, W, H, t, seg, styleId, position);
  } catch { /* a bad caption frame must never break the preview or export */ }
}

function drawSegment(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, seg: CaptionSegment, styleId: CaptionStyleId, position: CaptionPosition): void {
  const bold = styleId === 'bold';
  const minimal = styleId === 'minimal';
  const highlightSpoken = styleId === 'brand' || styleId === 'karaoke';

  const fs = Math.max(11, Math.round(H * (bold ? 0.052 : minimal ? 0.032 : 0.042)));
  ctx.font = (bold ? '900 ' : '800 ') + fs + "px 'Inter', system-ui, -apple-system, sans-serif";
  ctx.textBaseline = 'alphabetic';

  const wordsSource = seg.words;
  const renderWords: CaptionWord[] = bold && wordsSource.length ? wordsSource.map((w) => ({ ...w, t: w.t.toUpperCase() })) : wordsSource;
  const fallbackText = bold ? seg.text.toUpperCase() : seg.text;

  const maxW = W * 0.84;
  const { lines, lineH } = layoutWords(ctx, renderWords, fallbackText, maxW, 2);
  if (!lines.length) return;

  const blockW = Math.max(...lines.map((l) => l.width), 1);
  const blockH = lines.length * lineH;
  const padX = minimal ? fs * 0.85 : fs * 1.05;
  const padY = minimal ? fs * 0.5 : fs * 0.62;
  const boxW = Math.min(W - 8, blockW + padX * 2);
  const boxH = blockH + padY * 2 - (lineH - fs);
  const bx = clamp(W / 2 - boxW / 2, 4, Math.max(4, W - boxW - 4));
  // The block anchors where the user chose — top, middle or bottom — in both
  // the live preview and the export burn-in.
  const by = position === 'top' ? H * 0.08 : position === 'middle' ? (H - boxH) / 2 : H * 0.86 - boxH;

  if (!bold) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = minimal ? 'rgba(18,18,20,0.6)' : 'rgba(18,18,20,0.88)'; // Charcoal, translucent
    roundRect(ctx, bx, by, boxW, boxH, fs * 0.55);
    ctx.fill();
  }

  const textTop = by + padY;
  ctx.shadowBlur = 0;
  for (const line of lines) {
    const lineStartX = W / 2 - line.width / 2;
    const baselineY = textTop + line.y + fs * 0.86;
    for (const lw of line.words) {
      const hasTiming = lw.w.e > 0;
      const spoken = hasTiming ? t >= lw.w.s : true;
      const active = hasTiming ? (t >= lw.w.s && t <= lw.w.e + 0.06) : false;

      let color = BRAND_WARM_WHITE;
      ctx.shadowBlur = 0;
      if (bold) {
        color = '#FFFFFF';
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = fs * 0.22;
      } else if (highlightSpoken) {
        color = spoken ? BRAND_CORAL : (styleId === 'karaoke' ? 'rgba(244,242,238,0.55)' : BRAND_WARM_WHITE);
      } else if (minimal) {
        color = 'rgba(244,242,238,0.94)';
      }

      const cx = lineStartX + lw.x + lw.width / 2;
      if (active) {
        ctx.save();
        ctx.translate(cx, baselineY - fs * 0.32);
        ctx.scale(1.06, 1.06);
        ctx.translate(-cx, -(baselineY - fs * 0.32));
      }
      ctx.fillStyle = color;
      ctx.fillText(lw.w.t, lineStartX + lw.x, baselineY);
      if (active) ctx.restore();
    }
  }
  ctx.shadowBlur = 0;
}
