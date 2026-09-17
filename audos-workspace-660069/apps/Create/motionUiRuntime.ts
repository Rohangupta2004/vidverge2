/**
 * VidVerge — MOTION UI: the runtime math.
 *
 * Pure, dependency-free sampling of a Motion Plan at a given time. The in-browser
 * PREVIEW (motionUiPreview.tsx) drives its CSS transforms straight from these
 * functions, and the server composition (motionUiComposition.ts) mirrors the
 * SAME semantics with Remotion's interpolate/spring so preview and final render
 * agree. Keep the two in step: any change to a curve here should be reflected
 * in the composition string, and vice versa.
 *
 * COORDINATE MODEL. World offsets are fractions of the frame: worldX/worldY of
 * 0 sits at the centre, 0.5 is half a frame away. The global camera pans the
 * whole world by its own x/y and zooms by scale, so every layer shares one
 * continuous move — the core of the continuity contract.
 */
import type { AssetLayer, CameraKeyframe, Easing, MotionPlan, TextCue } from './motionUiTypes';
import { clamp } from './motionUiTypes';

/** Linear interpolate with clamped ends. */
export function lerp(t: number, a: number, b: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

export function easeInOutCubic(t: number): number {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function easeOutCubic(t: number): number {
  const x = clamp(t, 0, 1);
  return 1 - Math.pow(1 - x, 3);
}

export function easeInCubic(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * x;
}

/** A light spring-ish overshoot for entrances, 0..~1.05..1. */
export function springish(t: number): number {
  const x = clamp(t, 0, 1);
  // Damped overshoot, settles at 1.
  return 1 - Math.cos(x * Math.PI * 0.5) * Math.exp(-2.2 * x);
}

export function applyEasing(t: number, easing: Easing): number {
  switch (easing) {
    case 'linear':
      return clamp(t, 0, 1);
    case 'ease_in':
      return easeInCubic(t);
    case 'ease_out':
      return easeOutCubic(t);
    case 'spring':
      return springish(t);
    case 'smooth':
    default:
      return easeInOutCubic(t);
  }
}

export interface CameraSample {
  x: number;
  y: number;
  scale: number;
  rotate: number;
}

/**
 * Sample the ONE global camera at time `t` (seconds). Interpolates between the
 * two surrounding keyframes with a smooth curve, so the whole video shares one
 * continuous move and never resets between "scenes".
 */
export function sampleCamera(camera: CameraKeyframe[], t: number, easing: Easing = 'smooth'): CameraSample {
  if (!camera || camera.length === 0) return { x: 0, y: 0, scale: 1, rotate: 0 };
  if (camera.length === 1) {
    const k = camera[0];
    return { x: k.x, y: k.y, scale: k.scale, rotate: k.rotate || 0 };
  }
  const sorted = [...camera].sort((a, b) => a.t - b.t);
  if (t <= sorted[0].t) {
    const k = sorted[0];
    return { x: k.x, y: k.y, scale: k.scale, rotate: k.rotate || 0 };
  }
  const last = sorted[sorted.length - 1];
  if (t >= last.t) return { x: last.x, y: last.y, scale: last.scale, rotate: last.rotate || 0 };
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (t >= a.t && t <= b.t) {
      const span = Math.max(0.0001, b.t - a.t);
      const p = applyEasing((t - a.t) / span, easing);
      return {
        x: lerp(p, a.x, b.x),
        y: lerp(p, a.y, b.y),
        scale: lerp(p, a.scale, b.scale),
        rotate: lerp(p, a.rotate || 0, b.rotate || 0),
      };
    }
  }
  return { x: last.x, y: last.y, scale: last.scale, rotate: last.rotate || 0 };
}

export interface LayerSample {
  visible: boolean;
  opacity: number;
  /** Extra transform on top of the layer's world placement (entrance/exit/float). */
  dx: number;
  dy: number;
  scale: number;
  rotate: number;
}

/** How far (in world fractions) an entrance slides from. */
const SLIDE = 0.35;

/**
 * Sample one asset layer at time `t`. Combines entrance, exit and a continuous
 * idle float so a layer that lives for several seconds keeps subtly moving
 * rather than snapping in and freezing.
 */
export function sampleLayer(layer: AssetLayer, t: number, easing: Easing = 'smooth'): LayerSample {
  const pad = 0.35; // keep drawing a touch beyond its window so exits are smooth
  if (t < layer.start - pad || t > layer.end + pad) {
    return { visible: false, opacity: 0, dx: 0, dy: 0, scale: 1, rotate: 0 };
  }
  const inDur = Math.max(0.15, layer.entranceDur || 0.6);
  const outDur = Math.max(0.15, layer.exitDur || 0.5);
  const sinceStart = t - layer.start;
  const untilEnd = layer.end - t;

  const inP = applyEasing(clamp(sinceStart / inDur, 0, 1), easing);
  const outP = applyEasing(clamp(untilEnd / outDur, 0, 1), 'ease_out');
  const opacity = clamp(Math.min(inP, outP), 0, 1);

  let dx = 0;
  let dy = 0;
  let scale = 1;
  const enter = 1 - inP;
  switch (layer.entrance) {
    case 'slide_left':
      dx = enter * SLIDE;
      break;
    case 'slide_right':
      dx = -enter * SLIDE;
      break;
    case 'slide_up':
      dy = enter * SLIDE;
      break;
    case 'slide_down':
      dy = -enter * SLIDE;
      break;
    case 'scale_in':
      scale = lerp(inP, 0.86, 1);
      break;
    case 'rise':
      dy = enter * 0.14;
      scale = lerp(inP, 0.94, 1);
      break;
    case 'fade':
    case 'none':
    default:
      break;
  }

  // Continuous idle motion over the whole life — keeps the piece alive.
  const life = t - layer.start;
  switch (layer.float) {
    case 'float':
      dy += Math.sin(life * 0.9) * 0.012;
      break;
    case 'drift_left':
      dx -= life * 0.006;
      break;
    case 'drift_right':
      dx += life * 0.006;
      break;
    case 'parallax':
      dx += Math.sin(life * 0.6) * 0.02;
      dy += Math.cos(life * 0.5) * 0.01;
      break;
    case 'none':
    default:
      break;
  }

  return { visible: opacity > 0.001, opacity, dx, dy, scale, rotate: 0 };
}

export interface TextSample {
  visible: boolean;
  opacity: number;
  dy: number;
  scale: number;
  /** 0..1 for progressive (word/char) reveals. */
  reveal: number;
  /** extra letter-spacing in em for tracking_expand. */
  tracking: number;
  /** 0..1 mask wipe for mask_reveal. */
  mask: number;
}

export function sampleText(cue: TextCue, t: number): TextSample {
  if (t < cue.start - 0.3 || t > cue.end + 0.3) {
    return { visible: false, opacity: 0, dy: 0, scale: 1, reveal: 0, tracking: 0, mask: 1 };
  }
  const inDur = 0.6;
  const outDur = 0.4;
  const inP = easeOutCubic(clamp((t - cue.start) / inDur, 0, 1));
  const outP = easeInCubic(clamp((cue.end - t) / outDur, 0, 1));
  const opacity = clamp(Math.min(inP, outP), 0, 1);
  let dy = 0;
  let scale = 1;
  let reveal = 1;
  let tracking = 0;
  let mask = 1;
  switch (cue.animation) {
    case 'slide_up':
      dy = (1 - inP) * 0.06;
      break;
    case 'scale_reveal':
      scale = lerp(inP, 0.8, 1);
      break;
    case 'tracking_expand':
      tracking = (1 - inP) * 0.4;
      break;
    case 'word_reveal':
    case 'char_reveal':
      reveal = easeOutCubic(clamp((t - cue.start) / Math.max(0.4, inDur * 1.4), 0, 1));
      break;
    case 'mask_reveal':
      mask = easeInOutCubic(clamp((t - cue.start) / 0.7, 0, 1));
      break;
    case 'fade':
    default:
      break;
  }
  return { visible: opacity > 0.001, opacity, dy, scale, reveal, tracking, mask };
}

/** Reveal a string progressively for word/char reveals. */
export function revealText(content: string, animation: TextCue['animation'], reveal: number): string {
  if (animation === 'word_reveal') {
    const words = content.split(/\s+/);
    const show = Math.ceil(words.length * clamp(reveal, 0, 1));
    return words.slice(0, Math.max(0, show)).join(' ');
  }
  if (animation === 'char_reveal') {
    const show = Math.ceil(content.length * clamp(reveal, 0, 1));
    return content.slice(0, Math.max(0, show));
  }
  return content;
}

/** Anchor → {x,y} fraction of the safe frame (0..1), before fine offsets. */
export function anchorPosition(anchor: TextCue['anchor']): { x: number; y: number } {
  switch (anchor) {
    case 'top':
      return { x: 0.5, y: 0.16 };
    case 'bottom':
      return { x: 0.5, y: 0.84 };
    case 'left':
      return { x: 0.22, y: 0.5 };
    case 'right':
      return { x: 0.78, y: 0.5 };
    case 'top-left':
      return { x: 0.2, y: 0.18 };
    case 'top-right':
      return { x: 0.8, y: 0.18 };
    case 'bottom-left':
      return { x: 0.2, y: 0.82 };
    case 'bottom-right':
      return { x: 0.8, y: 0.82 };
    case 'center':
    default:
      return { x: 0.5, y: 0.5 };
  }
}

/** Total plan runtime in seconds, floored to something sane. */
export function planSeconds(plan: MotionPlan): number {
  return clamp(plan.duration || 0, 1, 600);
}
