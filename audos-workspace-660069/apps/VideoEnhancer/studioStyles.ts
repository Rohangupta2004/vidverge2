/**
 * Video Studio — the visual language shared by the preview and the render.
 *
 * Caption presets, text-layer animation curves and visual-effect descriptors
 * all live here as DATA plus pure functions of time. The browser preview
 * (studioStage.tsx) and the server composition (the veh-render hook) run the
 * same maths over the same descriptors, which is what makes the preview an
 * honest picture of the exported file rather than a mood board.
 *
 * Sizes are expressed against a 1080-pixel-tall stage and scaled by the real
 * stage height at draw time, so a preset looks identical at 720p, 1080p and 4K
 * and in every aspect ratio.
 */
import type { CaptionStyleId, EntranceAnim, ExitAnim, VisualEffectId } from './studioModel';
import { clamp01, easeOutBack, easeOutCubic, easeInCubic } from './studioModel';

export type CaptionMode = 'plain' | 'karaoke' | 'word' | 'gradient' | 'glow';

export interface CaptionStyleSpec {
  id: CaptionStyleId;
  label: string;
  hint: string;
  /** Font size as a fraction of stage height. */
  sizeRatio: number;
  weight: number;
  uppercase: boolean;
  fontId: string;
  color: string;
  activeColor: string;
  inactiveColor: string;
  background: string;
  radius: number;
  padX: number;
  padY: number;
  outlineWidth: number;
  outlineColor: string;
  shadow: string;
  letterSpacing: number;
  lineHeight: number;
  mode: CaptionMode;
}

/**
 * Fourteen presets. Each one is a different answer to “what should the viewer’s
 * eye do”, not a recolour of the same card.
 */
export const CAPTION_STYLES: CaptionStyleSpec[] = [
  {
    id: 'minimal', label: 'Minimal', hint: 'White text, no background — gets out of the way',
    sizeRatio: 0.042, weight: 600, uppercase: false, fontId: 'inter',
    color: '#ffffff', activeColor: '#ffffff', inactiveColor: 'rgba(255,255,255,0.92)',
    background: 'transparent', radius: 0, padX: 0, padY: 0,
    outlineWidth: 0, outlineColor: '#000000', shadow: '0 2px 14px rgba(0,0,0,0.75)',
    letterSpacing: 0, lineHeight: 1.25, mode: 'plain',
  },
  {
    id: 'bold', label: 'Bold', hint: 'Black block, white type — maximum legibility',
    sizeRatio: 0.05, weight: 800, uppercase: false, fontId: 'inter',
    color: '#ffffff', activeColor: '#ffffff', inactiveColor: '#ffffff',
    background: 'rgba(0,0,0,0.9)', radius: 10, padX: 30, padY: 14,
    outlineWidth: 0, outlineColor: '#000000', shadow: 'none',
    letterSpacing: 0, lineHeight: 1.2, mode: 'plain',
  },
  {
    id: 'gradient', label: 'Gradient', hint: 'Animated colour sweep travelling through the line',
    sizeRatio: 0.056, weight: 900, uppercase: true, fontId: 'montserrat',
    color: '#ffffff', activeColor: '#ffffff', inactiveColor: '#ffffff',
    background: 'transparent', radius: 0, padX: 0, padY: 0,
    outlineWidth: 0, outlineColor: '#000000', shadow: '0 4px 22px rgba(0,0,0,0.6)',
    letterSpacing: -0.5, lineHeight: 1.16, mode: 'gradient',
  },
  {
    id: 'karaoke', label: 'Karaoke', hint: 'Each word lights up exactly as it is spoken',
    sizeRatio: 0.05, weight: 800, uppercase: false, fontId: 'inter',
    color: '#ffffff', activeColor: '#f59e0b', inactiveColor: 'rgba(255,255,255,0.45)',
    background: 'rgba(0,0,0,0.3)', radius: 12, padX: 24, padY: 12,
    outlineWidth: 0, outlineColor: '#000000', shadow: '0 3px 16px rgba(0,0,0,0.7)',
    letterSpacing: 0, lineHeight: 1.2, mode: 'karaoke',
  },
  {
    id: 'tiktok', label: 'TikTok Pop', hint: 'Huge display type, word-by-word, hard drop shadow',
    sizeRatio: 0.072, weight: 900, uppercase: true, fontId: 'anton',
    color: '#ffffff', activeColor: '#ffe14d', inactiveColor: '#ffffff',
    background: 'transparent', radius: 0, padX: 0, padY: 0,
    outlineWidth: 4, outlineColor: '#000000', shadow: '0 8px 0 rgba(0,0,0,0.55)',
    letterSpacing: -1, lineHeight: 1.08, mode: 'word',
  },
  {
    id: 'neon', label: 'Neon Glow', hint: 'Glowing outline that blooms on the spoken word',
    sizeRatio: 0.055, weight: 800, uppercase: true, fontId: 'oswald',
    color: '#ffffff', activeColor: '#22d3ee', inactiveColor: 'rgba(255,255,255,0.85)',
    background: 'transparent', radius: 0, padX: 0, padY: 0,
    outlineWidth: 0, outlineColor: '#0e7490', shadow: '0 0 18px #22d3ee, 0 0 42px rgba(34,211,238,0.6)',
    letterSpacing: 1, lineHeight: 1.2, mode: 'glow',
  },
  {
    id: 'cinematic', label: 'Cinematic', hint: 'Subtitle discipline — lower third, quiet, letterspaced',
    sizeRatio: 0.036, weight: 500, uppercase: false, fontId: 'inter',
    color: '#f5f5f4', activeColor: '#f5f5f4', inactiveColor: '#f5f5f4',
    background: 'rgba(0,0,0,0.42)', radius: 4, padX: 22, padY: 10,
    outlineWidth: 0, outlineColor: '#000000', shadow: '0 1px 8px rgba(0,0,0,0.9)',
    letterSpacing: 0.6, lineHeight: 1.35, mode: 'plain',
  },
  {
    id: 'handwritten', label: 'Handwritten', hint: 'Casual script — vlogs and personal pieces',
    sizeRatio: 0.068, weight: 700, uppercase: false, fontId: 'caveat',
    color: '#fffbeb', activeColor: '#fbbf24', inactiveColor: '#fffbeb',
    background: 'transparent', radius: 0, padX: 0, padY: 0,
    outlineWidth: 2, outlineColor: 'rgba(0,0,0,0.65)', shadow: '0 4px 16px rgba(0,0,0,0.6)',
    letterSpacing: 0.5, lineHeight: 1.15, mode: 'karaoke',
  },
  {
    id: 'creator', label: 'Creator Punch', hint: 'Warm social captions with an amber active-word punch',
    sizeRatio: 0.064, weight: 900, uppercase: true, fontId: 'montserrat',
    color: '#ffffff', activeColor: '#ffd66e', inactiveColor: '#ffffff',
    background: 'rgba(6,9,14,0.68)', radius: 18, padX: 28, padY: 13,
    outlineWidth: 2, outlineColor: '#06090e', shadow: '0 7px 24px rgba(0,0,0,0.7)',
    letterSpacing: -0.7, lineHeight: 1.08, mode: 'word',
  },
  {
    id: 'newsroom', label: 'Newsroom', hint: 'Broadcast lower-third discipline with timed red emphasis',
    sizeRatio: 0.043, weight: 800, uppercase: false, fontId: 'inter',
    color: '#f8fafc', activeColor: '#fb7185', inactiveColor: 'rgba(248,250,252,0.58)',
    background: 'rgba(8,15,28,0.92)', radius: 3, padX: 26, padY: 12,
    outlineWidth: 0, outlineColor: '#000000', shadow: '0 3px 14px rgba(0,0,0,0.78)',
    letterSpacing: 0.25, lineHeight: 1.2, mode: 'karaoke',
  },
  {
    id: 'comic', label: 'Comic Burst', hint: 'Bright outlined words that spring in like a comic panel',
    sizeRatio: 0.066, weight: 900, uppercase: true, fontId: 'anton',
    color: '#fff7a8', activeColor: '#ff5ca8', inactiveColor: '#fff7a8',
    background: 'transparent', radius: 0, padX: 0, padY: 0,
    outlineWidth: 4, outlineColor: '#27104a', shadow: '5px 6px 0 rgba(39,16,74,0.78)',
    letterSpacing: 0.3, lineHeight: 1.05, mode: 'word',
  },
  {
    id: 'luxury', label: 'Luxury Gold', hint: 'Editorial serif captions with restrained gold word highlighting',
    sizeRatio: 0.048, weight: 700, uppercase: false, fontId: 'playfair',
    color: '#fff9e8', activeColor: '#ffd66e', inactiveColor: 'rgba(255,249,232,0.48)',
    background: 'rgba(9,8,6,0.62)', radius: 2, padX: 30, padY: 14,
    outlineWidth: 0, outlineColor: '#000000', shadow: '0 4px 22px rgba(0,0,0,0.8)',
    letterSpacing: 0.7, lineHeight: 1.24, mode: 'karaoke',
  },
  {
    id: 'gaming', label: 'Gaming HUD', hint: 'Condensed neon captions that energise each spoken word',
    sizeRatio: 0.058, weight: 800, uppercase: true, fontId: 'oswald',
    color: '#f0fff8', activeColor: '#4ade80', inactiveColor: 'rgba(240,255,248,0.68)',
    background: 'rgba(2,12,9,0.58)', radius: 8, padX: 24, padY: 11,
    outlineWidth: 1, outlineColor: '#052e16', shadow: '0 0 16px #22c55e, 0 0 38px rgba(34,197,94,0.55)',
    letterSpacing: 1.2, lineHeight: 1.12, mode: 'glow',
  },
  {
    id: 'desi', label: 'Desi Bold', hint: 'Unicode-safe Hindi and Hinglish captions with saffron timing highlights',
    sizeRatio: 0.058, weight: 800, uppercase: false, fontId: 'notoDevanagari',
    color: '#ffffff', activeColor: '#ffb21a', inactiveColor: 'rgba(255,255,255,0.5)',
    background: 'rgba(10,12,16,0.78)', radius: 16, padX: 28, padY: 13,
    outlineWidth: 1, outlineColor: '#241503', shadow: '0 4px 18px rgba(0,0,0,0.75)',
    letterSpacing: 0, lineHeight: 1.28, mode: 'karaoke',
  },
];

export function captionStyle(id: CaptionStyleId): CaptionStyleSpec {
  return CAPTION_STYLES.find((s) => s.id === id) || CAPTION_STYLES[0];
}

/** Where the caption block sits, as a fraction of stage height. */
export function captionTop(position: 'top' | 'center' | 'bottom', offsetY: number): number {
  const base = position === 'top' ? 0.1 : position === 'center' ? 0.45 : 0.78;
  return clamp01(base + offsetY);
}

/**
 * Per-word styling for a caption at local time `t` (seconds into the cue).
 * One function, used by both the preview and the render, so karaoke timing
 * cannot drift between them.
 */
export function captionWordStyle(
  spec: CaptionStyleSpec,
  word: { start: number; end: number },
  cueStart: number,
  t: number,
  index: number,
): { color: string; scale: number; opacity: number; shadow: string; gradient: string | null } {
  const local = cueStart + t;
  const spoken = local >= word.start;
  const active = local >= word.start && local <= word.end + 0.06;
  const since = local - word.start;

  if (spec.mode === 'karaoke') {
    return {
      color: spoken ? spec.activeColor : spec.inactiveColor,
      scale: 1, opacity: 1, shadow: spec.shadow, gradient: null,
    };
  }
  if (spec.mode === 'word') {
    // Word-by-word reveal with an overshoot pop on the live word.
    const reveal = clamp01(since / 0.12);
    const pop = active ? 1 + 0.12 * (1 - easeOutCubic(clamp01(since / 0.22))) : 1;
    return {
      color: active ? spec.activeColor : spec.inactiveColor,
      scale: spoken ? pop : 0.86 + 0.14 * easeOutBack(reveal),
      opacity: spoken ? 1 : reveal,
      shadow: spec.shadow, gradient: null,
    };
  }
  if (spec.mode === 'glow') {
    return {
      color: active ? spec.activeColor : spec.inactiveColor,
      scale: 1, opacity: 1,
      shadow: spoken ? spec.shadow : '0 2px 10px rgba(0,0,0,0.8)',
      gradient: null,
    };
  }
  if (spec.mode === 'gradient') {
    // A hue sweep that walks along the line over time.
    const phase = (t * 0.9 + index * 0.12) % 1;
    const hue = Math.round(phase * 360);
    return {
      color: spec.color, scale: 1, opacity: 1, shadow: spec.shadow,
      gradient: `linear-gradient(90deg, hsl(${hue} 92% 62%) 0%, hsl(${(hue + 60) % 360} 92% 68%) 50%, hsl(${(hue + 130) % 360} 92% 62%) 100%)`,
    };
  }
  // Plain editorial presets still animate: every word settles gently from
  // translucent to fully readable at its measured timestamp.
  const reveal = clamp01(since / 0.2);
  return {
    color: spec.color,
    scale: spoken ? 0.97 + 0.03 * easeOutCubic(reveal) : 0.97,
    opacity: spoken ? 0.42 + 0.58 * easeOutCubic(reveal) : 0.28,
    shadow: spec.shadow,
    gradient: null,
  };
}

// ---------------------------------------------------------------------------
// Text-layer animation
// ---------------------------------------------------------------------------

export interface TextAnimState {
  opacity: number;
  translateX: number;   // px at a 1080-tall stage
  translateY: number;
  scale: number;
  /** 0..1 — how much of the string the typewriter has typed. */
  typed: number;
  /** Glitch slice offset in px, 0 when not glitching. */
  glitch: number;
}

export function textAnimState(
  entrance: EntranceAnim,
  exit: ExitAnim,
  t: number,
  duration: number,
  animDuration: number,
): TextAnimState {
  const inD = Math.max(0.08, Math.min(animDuration, duration * 0.5));
  const outD = Math.max(0.08, Math.min(animDuration, duration * 0.4));
  const p = clamp01(t / inD);                            // entrance progress
  const q = clamp01((duration - t) / outD);              // 1 until the exit starts
  const state: TextAnimState = { opacity: 1, translateX: 0, translateY: 0, scale: 1, typed: 1, glitch: 0 };

  switch (entrance) {
    case 'typewriter': state.typed = p; break;
    case 'fadeIn': state.opacity = easeOutCubic(p); break;
    case 'slideUp': state.translateY = (1 - easeOutCubic(p)) * 110; state.opacity = clamp01(p * 2); break;
    case 'slideDown': state.translateY = (1 - easeOutCubic(p)) * -110; state.opacity = clamp01(p * 2); break;
    case 'slideLeft': state.translateX = (1 - easeOutCubic(p)) * 180; state.opacity = clamp01(p * 2); break;
    case 'slideRight': state.translateX = (1 - easeOutCubic(p)) * -180; state.opacity = clamp01(p * 2); break;
    case 'scalePop': state.scale = 0.42 + easeOutBack(p) * 0.58; state.opacity = clamp01(p * 2.4); break;
    case 'glitch':
      state.opacity = p < 1 ? (Math.sin(t * 46) > -0.35 ? 1 : 0.25) : 1;
      state.glitch = p < 1 ? (1 - p) * 16 * (Math.sin(t * 31) > 0 ? 1 : -1) : 0;
      break;
    default: break;
  }

  switch (exit) {
    case 'fadeOut': state.opacity = Math.min(state.opacity, easeOutCubic(q)); break;
    case 'slideOut': state.translateY += (1 - q) * -130; state.opacity = Math.min(state.opacity, clamp01(q * 1.6)); break;
    case 'scaleDown': state.scale *= 0.6 + 0.4 * q; state.opacity = Math.min(state.opacity, clamp01(q * 1.6)); break;
    default: break;
  }
  return state;
}

// ---------------------------------------------------------------------------
// Visual effects — declarative layers drawn over the picture
// ---------------------------------------------------------------------------

export interface EffectLayer {
  /** CSS background shorthand for an absolutely positioned overlay. */
  background: string;
  opacity: number;
  blend: string;
  /** Extra CSS to merge in (transform, background-position for grain drift). */
  extra?: Record<string, string | number>;
}

export const GRAIN_DATA_URI =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='220' height='220' filter='url(%23n)' opacity='0.55'/></svg>\")";

/**
 * The overlay layers for an effect at local time `t` inside a clip of length
 * `duration`. Returning descriptors (rather than JSX) is what lets the server
 * composition reuse the identical maths.
 */
export function effectLayers(id: VisualEffectId, t: number, duration: number): EffectLayer[] {
  switch (id) {
    case 'vignette':
      return [{
        background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 52%, rgba(0,0,0,0.62) 100%)',
        opacity: 1, blend: 'normal',
      }];
    case 'bloom':
      return [{
        background: 'radial-gradient(ellipse at 50% 42%, rgba(255,246,214,0.3) 0%, rgba(255,246,214,0) 62%)',
        opacity: 1, blend: 'screen',
      }];
    case 'filmGrain': {
      const shift = Math.round((t * 240) % 220);
      return [{
        background: GRAIN_DATA_URI,
        opacity: 0.1, blend: 'overlay',
        extra: { backgroundPosition: `${shift}px ${(shift * 1.7) % 220}px`, backgroundRepeat: 'repeat' },
      }];
    }
    case 'flash': {
      // One bright beat at the head of the clip, gone in a third of a second.
      const a = Math.max(0, 1 - t / 0.32);
      return a <= 0.01 ? [] : [{ background: '#ffffff', opacity: a * 0.82, blend: 'screen' }];
    }
    case 'lensFlare': {
      const drift = (t / Math.max(0.5, duration)) * 26;
      return [
        {
          background: `radial-gradient(circle at ${64 + drift}% 30%, rgba(255,226,150,0.55) 0%, rgba(255,186,90,0.22) 14%, rgba(255,160,60,0) 38%)`,
          opacity: 1, blend: 'screen',
        },
        {
          background: `linear-gradient(100deg, rgba(255,255,255,0) 38%, rgba(255,232,180,0.3) ${48 + drift / 2}%, rgba(255,255,255,0) 62%)`,
          opacity: 0.8, blend: 'screen',
        },
      ];
    }
    case 'lightLeak': {
      const sweep = (t / Math.max(0.8, duration)) * 120 - 20;
      return [{
        background: `linear-gradient(118deg, rgba(255,120,40,0) ${Math.max(0, sweep - 26)}%, rgba(255,150,60,0.4) ${sweep}%, rgba(255,90,30,0) ${sweep + 30}%)`,
        opacity: 1, blend: 'screen',
      }];
    }
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Transitions — what happens across a cut point
// ---------------------------------------------------------------------------

export interface TransitionState {
  /** Opacity of the incoming shot, 0..1. */
  opacity: number;
  /** Transform applied to the incoming shot. */
  transform: string;
  /** CSS filter applied to the incoming shot. */
  filter: string;
  /** An overlay drawn on top of the cut (flash, black dip, glitch slices). */
  overlay: { background: string; opacity: number; blend: string } | null;
}

/** `p` runs 0 → 1 across the transition window. */
export function transitionState(id: string, p: number): TransitionState {
  const e = easeOutCubic(clamp01(p));
  const base: TransitionState = { opacity: 1, transform: 'none', filter: 'none', overlay: null };
  switch (id) {
    case 'crossfade':
      return { ...base, opacity: e };
    case 'whipPan':
      return {
        ...base,
        opacity: clamp01(p * 2.2),
        transform: `translateX(${(1 - e) * 42}%)`,
        filter: `blur(${(1 - e) * 18}px)`,
      };
    case 'flashCut':
      return {
        ...base,
        opacity: clamp01(p * 3),
        overlay: { background: '#ffffff', opacity: Math.sin(clamp01(p) * Math.PI) * 0.9, blend: 'screen' },
      };
    case 'dipToBlack':
      return {
        ...base,
        opacity: 1,
        overlay: { background: '#000000', opacity: Math.sin(clamp01(p) * Math.PI), blend: 'normal' },
      };
    case 'glitchCut': {
      const jitter = (1 - e) * 14;
      return {
        ...base,
        opacity: clamp01(p * 2.4),
        transform: `translateX(${Math.sin(p * 34) * jitter}px)`,
        filter: `saturate(${1 + (1 - e) * 1.6}) contrast(${1 + (1 - e) * 0.5})`,
        overlay: {
          background: `repeating-linear-gradient(0deg, rgba(255,0,80,0.18) 0px, rgba(0,255,220,0.18) ${2 + jitter}px, transparent ${4 + jitter}px, transparent ${10 + jitter}px)`,
          opacity: 1 - e, blend: 'screen',
        },
      };
    }
    case 'zoomPunch':
      return { ...base, opacity: clamp01(p * 2.6), transform: `scale(${1.4 - 0.4 * e})` };
    case 'spin':
      return {
        ...base,
        opacity: clamp01(p * 1.8),
        transform: `rotate(${(1 - e) * -28}deg) scale(${1.18 - 0.18 * e})`,
        filter: `blur(${(1 - e) * 10}px)`,
      };
    default:
      return base;
  }
}

export { clamp01, easeOutBack, easeOutCubic, easeInCubic };
