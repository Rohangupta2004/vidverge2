// COMPOSITION RUNTIME MATH — the deterministic per-frame math the browser
// preview (components/CompositionPreview) uses to mirror the ONE Remotion
// assembly composition. The render itself runs the equivalent code embedded
// in createAssemblySource (remotion/AssemblyComp); the preview and the render
// consume the SAME buildTimeline segments and the SAME props, and this module
// keeps the interpretation identical on both sides.
//
// KEEP IN SYNC: any change to effect/transition/composition/overlay/caption
// math here must be mirrored in the generated source in AssemblyComp.tsx and
// vice versa — preview → final render consistency is a product guarantee.

import type { TimelineSegment } from './AssemblyComp';
import type { MotionTreatment, PipPosition, SceneOverlayElement } from '../lib/directorPlan';
import type { WordTimestamp } from '../lib/supabase';

export const FPS = 30;

export const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

export function ease(t: number, kind?: string): number {
  t = clamp01(t);
  if (kind === 'ease-in') return t * t;
  if (kind === 'ease-out') return 1 - (1 - t) * (1 - t);
  if (kind === 'ease-in-out') return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  return t;
}

export function dirVec(direction?: string): { x: number; y: number } {
  if (direction === 'right') return { x: 1, y: 0 };
  if (direction === 'up') return { x: 0, y: -1 };
  if (direction === 'down') return { x: 0, y: 1 };
  return { x: -1, y: 0 };
}

export interface FrameStyle { transform: string; opacity: number; filter: string }

/** Mirrors effectStyle in the generated composition source. */
export function effectStyleAt(effect: { preset?: string; intensity?: number; direction?: string; easing?: string } | null | undefined, frame: number, frames: number): FrameStyle {
  const e = effect || {};
  let k = Number(e.intensity); if (!(k > 0)) k = 1; if (k > 2) k = 2;
  const p = ease(frames > 1 ? frame / frames : 1, e.easing || 'ease-in-out');
  const d = dirVec(e.direction);
  const preset = String(e.preset || 'none');
  const style: FrameStyle = { transform: '', opacity: 1, filter: '' };
  if (preset === 'zoom_in') style.transform = `scale(${1 + 0.14 * k * p})`;
  else if (preset === 'zoom_out') style.transform = `scale(${1 + 0.14 * k * (1 - p)})`;
  else if (preset === 'pan_left' || preset === 'pan_right') style.transform = `scale(${1 + 0.08 * k}) translate(${d.x * 3.5 * k * (p - 0.5) * 2}%,0)`;
  else if (preset === 'parallax') style.transform = `scale(${1 + 0.06 * k}) translate(${d.x * 2.5 * k * (p - 0.5) * 2}%,${d.y * 2.5 * k * (p - 0.5) * 2 - 1 * k * p}%)`;
  else if (preset === 'ken_burns') style.transform = `scale(${1 + 0.05 * k + 0.1 * k * p}) translate(${d.x * 2.5 * k * p}%,${d.y * 2.5 * k * p}%)`;
  else if (preset === 'fade') style.opacity = p < 0.22 ? p / 0.22 : p > 0.78 ? (1 - p) / 0.22 : 1;
  else if (preset === 'blur_reveal') style.filter = `blur(${12 * (Number(e.intensity) || 1) * (1 - clamp01(p / 0.4))}px)`;
  else if (preset === 'scale_up') { const su = p < 0.35 ? ease(p / 0.35, 'ease-out') : 1; style.transform = `scale(${0.9 + (0.1 + 0.02 * Math.sin(Math.min(1, su) * Math.PI)) * su * k})`; }
  else if (preset === 'scale_down') { const sd = p < 0.35 ? ease(p / 0.35, 'ease-out') : 1; style.transform = `scale(${1 + 0.12 * k * (1 - sd)})`; }
  else if (preset === 'float') style.transform = `translateY(${Math.sin(frame / 22) * 8 * k}px) scale(${1 + 0.03 * k})`;
  else if (preset === 'push_in') { const pi = p < 0.28 ? ease(p / 0.28, 'ease-out') : 1; style.transform = `translate(${d.x * 30 * (1 - pi)}%,${d.y * 30 * (1 - pi)}%)`; }
  else if (preset === 'push_out') { const po = p > 0.72 ? ease((p - 0.72) / 0.28, 'ease-in') : 0; style.transform = `translate(${d.x * 30 * po}%,${d.y * 30 * po}%)`; }
  return style;
}

/** Mirrors the KEN BURNS motion-treatment math in the generated source. */
export function kenBurnsStyleAt(motion: MotionTreatment | null | undefined, frame: number, frames: number): FrameStyle {
  if (!motion) return { transform: '', opacity: 1, filter: '' };
  const p = ease(frames > 1 ? frame / frames : 1, motion.easing || 'ease-in-out');
  const scale = motion.scale_from + (motion.scale_to - motion.scale_from) * p;
  const x = (motion.pan_x_pct || 0) * p;
  const y = (motion.pan_y_pct || 0) * p;
  const rot = (motion.rotate_deg || 0) * p;
  return { transform: `scale(${scale}) translate(${x}%,${y}%)${rot ? ` rotate(${rot}deg)` : ''}`, opacity: 1, filter: '' };
}

export interface TransitionFrameStyle { opacity: number; transform: string; clipPath: string }

/** Mirrors transitionStyle in the generated composition source. */
export function transitionStyleAt(segment: Pick<TimelineSegment, 'transitionIn' | 'transitionOut'>, frame: number, frames: number): TransitionFrameStyle {
  const tin = segment.transitionIn || null;
  const tout = segment.transitionOut || null;
  const cap = Math.max(4, Math.floor(frames / 3));
  const inF = Math.min(cap, tin && tin.frames > 0 ? tin.frames : 12);
  const outF = Math.min(cap, tout && tout.frames > 0 ? tout.frames : 12);
  const style: TransitionFrameStyle = { opacity: 1, transform: '', clipPath: '' };
  const apply = (type: string, p: number, entering: boolean, dir?: string) => {
    const q = ease(p, 'ease-in-out');
    const e = 1 - q;
    const v = dirVec(dir || 'right');
    if (type === 'zoom_match_cut') { style.transform += ` scale(${entering ? 1 + 0.16 * e : 1 + 0.12 * e})`; style.opacity *= q; }
    else if (type === 'spatial_collapse') { style.transform += ` scale(${0.62 + 0.38 * q})`; style.opacity *= q; }
    else if (type === 'push_through') { style.transform += ` scale(${entering ? 1.7 - 0.7 * q : 1 + 1.4 * e})`; style.opacity *= q; }
    else if (type === 'slide_context') { const off = 14 * e * (entering ? 1 : -1); style.transform += ` translate(${v.x * off}%,${v.y * off}%)`; style.opacity *= q; }
    else if (type === 'layer_reveal') { const ins = 100 * e; style.clipPath = entering ? `inset(0% 0% ${ins}% 0%)` : `inset(${ins}% 0% 0% 0%)`; style.opacity *= Math.min(1, q * 1.6); }
    else if (type === 'wipe_directional') {
      const ins2 = 100 * e;
      if (v.x > 0) style.clipPath = entering ? `inset(0% ${ins2}% 0% 0%)` : `inset(0% 0% 0% ${ins2}%)`;
      else if (v.x < 0) style.clipPath = entering ? `inset(0% 0% 0% ${ins2}%)` : `inset(0% ${ins2}% 0% 0%)`;
      else if (v.y > 0) style.clipPath = entering ? `inset(${ins2}% 0% 0% 0%)` : `inset(0% 0% ${ins2}% 0%)`;
      else style.clipPath = entering ? `inset(0% 0% ${ins2}% 0%)` : `inset(${ins2}% 0% 0% 0%)`;
      style.opacity *= Math.min(1, q * 2);
    }
    else { style.opacity *= q; }
  };
  if (inF >= 1 && frame < inF) apply(tin ? tin.type : 'crossfade', clamp01(frame / inF), true, tin?.direction);
  else if (outF >= 1 && frames - frame < outF) apply(tout ? tout.type : 'crossfade', clamp01((frames - frame) / outF), false, tout?.direction);
  return style;
}

/** Mirrors compositionFrameStyle in the generated source — percent-based so the preview scales. */
export function compositionCardStyle(comp: { mode?: string; position?: string; scale?: number } | null | undefined): Record<string, string | number> {
  const mode = String(comp?.mode || '');
  const scale = Number(comp?.scale);
  const base: Record<string, string | number> = { position: 'absolute', aspectRatio: '16 / 9', borderRadius: '2.2%', overflow: 'hidden', boxShadow: '0 24px 70px rgba(0,0,0,0.55)', border: '2px solid rgba(148,163,184,0.35)' };
  if (mode === 'central') {
    const cw = scale > 0 ? Math.min(0.8, Math.max(0.5, scale)) : 0.62;
    base.width = `${cw * 100}%`;
    base.left = `${((1 - cw) / 2) * 100}%`;
    base.top = '16%';
    return base;
  }
  const w = scale > 0 ? Math.min(0.5, Math.max(0.22, scale)) : 0.34;
  base.width = `${w * 100}%`;
  const pos = String(comp?.position || 'lower_third');
  if (pos === 'left' || pos === 'top_left' || pos === 'bottom_left') base.left = '4%'; else base.right = '4%';
  if (pos === 'top_left' || pos === 'top_right') base.top = '7%';
  else if (pos === 'left' || pos === 'right') { base.top = '50%'; base.transform = 'translateY(-50%)'; }
  else base.bottom = '9%';
  return base;
}

/** Mirrors pipStyle in the generated source: the presenter's picture-in-picture card. */
export function pipCardStyle(pip: { position: PipPosition; scale: number } | undefined): Record<string, string | number> {
  const scale = pip && pip.scale > 0 ? Math.min(0.34, Math.max(0.16, pip.scale)) : 0.24;
  const pos = pip?.position || 'bottom_right';
  const style: Record<string, string | number> = { position: 'absolute', width: `${scale * 100}%`, aspectRatio: '16 / 9', borderRadius: '1.6%', overflow: 'hidden', boxShadow: '0 18px 50px rgba(0,0,0,0.6)', border: '2px solid rgba(255,255,255,0.28)', zIndex: 30 };
  if (pos === 'top_left' || pos === 'top_right') style.top = '6%'; else style.bottom = '7%';
  if (pos === 'top_left' || pos === 'bottom_left') style.left = '4%'; else style.right = '4%';
  return style;
}

// ---------------------------------------------------------------------------
// Editable overlay elements — animation math (mirrors OverlayElements in the
// generated source).
// ---------------------------------------------------------------------------

export interface OverlayFrameState {
  visible: boolean;
  opacity: number;
  transform: string;
  /** 0–1 draw progress for arrow/circle strokes. */
  draw: number;
}

const OVERLAY_ANIM_FRAMES = 9;

export function overlayStateAt(overlay: SceneOverlayElement, sceneFrame: number, sceneFrames: number): OverlayFrameState {
  const startF = Math.round(overlay.start_offset_sec * FPS);
  const durF = Math.max(6, Math.min(sceneFrames - startF, Math.round(overlay.duration_sec * FPS)));
  const local = sceneFrame - startF;
  if (local < 0 || local >= durF) return { visible: false, opacity: 0, transform: '', draw: 0 };
  const inP = clamp01(local / OVERLAY_ANIM_FRAMES);
  const outP = clamp01((durF - local) / OVERLAY_ANIM_FRAMES);
  let opacity = 1; let transform = ''; let draw = 1;
  const animIn = overlay.anim_in || 'rise';
  if (animIn === 'fade') opacity *= ease(inP, 'ease-out');
  else if (animIn === 'rise') { opacity *= ease(inP, 'ease-out'); transform += ` translateY(${(1 - ease(inP, 'ease-out')) * 18}px)`; }
  else if (animIn === 'pop') { const q = ease(inP, 'ease-out'); opacity *= q; transform += ` scale(${0.72 + 0.28 * q + 0.05 * Math.sin(q * Math.PI)})`; }
  else if (animIn === 'draw') { draw = ease(clamp01(local / (OVERLAY_ANIM_FRAMES * 2)), 'ease-in-out'); opacity *= Math.min(1, inP * 2); }
  const animOut = overlay.anim_out || 'fade';
  if (animOut === 'fade') opacity *= ease(outP, 'ease-out');
  else if (animOut === 'rise') { opacity *= ease(outP, 'ease-out'); transform += ` translateY(${-(1 - ease(outP, 'ease-out')) * 12}px)`; }
  else if (animOut === 'pop') { const q = ease(outP, 'ease-out'); opacity *= q; transform += ` scale(${0.85 + 0.15 * q})`; }
  return { visible: true, opacity, transform: transform.trim(), draw };
}

// ---------------------------------------------------------------------------
// Captions — word timestamps → timed lower-third chunks (mirrors Captions in
// the generated source).
// ---------------------------------------------------------------------------

export interface CaptionChunk { text: string; start: number; end: number }

export function captionChunks(words: WordTimestamp[] | null | undefined, maxWords = 5, maxSpanSec = 2.8): CaptionChunk[] {
  const rows = (Array.isArray(words) ? words : []).filter((word) => word && Number.isFinite(Number(word.start)) && Number.isFinite(Number(word.end)) && String(word.word || '').trim());
  const chunks: CaptionChunk[] = [];
  let bucket: WordTimestamp[] = [];
  const flush = () => {
    if (!bucket.length) return;
    chunks.push({ text: bucket.map((w) => String(w.word).trim()).join(' '), start: Number(bucket[0].start), end: Number(bucket[bucket.length - 1].end) });
    bucket = [];
  };
  rows.forEach((word) => {
    if (bucket.length && (bucket.length >= maxWords || Number(word.end) - Number(bucket[0].start) > maxSpanSec || Number(word.start) - Number(bucket[bucket.length - 1].end) > 0.9)) flush();
    bucket.push(word);
  });
  flush();
  return chunks.slice(0, 2000);
}

export function captionAt(chunks: CaptionChunk[], tSec: number): CaptionChunk | null {
  for (let i = 0; i < chunks.length; i += 1) {
    if (tSec >= chunks[i].start - 0.05 && tSec <= chunks[i].end + 0.25) return chunks[i];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Music ducking — the browser preview mirrors the mix composition's volume
// automation (sceneforge-v2 mixSource): duck under speech, bed in the gaps.
// ---------------------------------------------------------------------------

export function speechWindows(words: WordTimestamp[] | null | undefined): [number, number][] {
  const rows = Array.isArray(words) ? words : [];
  const out: [number, number][] = [];
  for (const word of rows) {
    const start = Number(word?.start); const end = Number(word?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const last = out[out.length - 1];
    if (last && start - last[1] < 0.8) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out.slice(0, 500);
}

export function musicVolumeAt(windows: [number, number][], tSec: number, duck = 0.12, bed = 0.3): number {
  if (!windows.length) return duck;
  const inSpeech = (t: number) => windows.some((w) => t >= w[0] - 0.15 && t <= w[1] + 0.3);
  let mix = 0;
  for (let i = -2; i <= 2; i += 1) { if (inSpeech(tSec + i * 0.12)) mix += 1; }
  mix /= 5;
  return Math.max(0, bed + (duck - bed) * mix);
}
