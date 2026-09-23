/**
 * HyperFrames — Track B's motion-primitive library for Product Video
 * compositions (dependency-light by design: remotion + react only).
 *
 * These are the reusable animated building blocks every Track B film is
 * composed from, instead of one-off bespoke Remotion code per scene:
 *   - entrances:        FadeIn, SlideIn, ScaleReveal
 *   - kinetic type:     TextReveal (per-word staggered reveal)
 *   - image motion:     KenBurnsImage (slow zoom / parallax drift, cropped
 *                       with object-fit cover on a focal position so
 *                       screenshots stay READABLE — never tiny, never
 *                       stretched to the wrong aspect)
 *   - product framing:  DeviceFrame (brand-tinted browser-chrome mockup),
 *                       ScreenshotShowcase (the full screenshot treatment:
 *                       device frame + spring entrance + cover-cropped
 *                       viewport + continuing Ken Burns drift)
 *   - text over image:  Scrim (legibility gradient), SceneTextOverlay
 *                       (composed brand typography — headline + caption —
 *                       with staggered entrance, for AI-generated scene
 *                       images that contain no text of their own)
 *
 * SELF-CONTAINED RENDER CONTRACT: the platform's Remotion renderer compiles a
 * SINGLE composition file, so generated/queued composition sources can NOT
 * import from this module. The trackb-orchestrator film-shell assembler
 * (FILM_SHELL_HEADER) and the trackb-render built-in template
 * (COMPOSITION_SOURCE) both INLINE an untyped JS copy of this exact primitive
 * set into every composition they emit. This file is the canonical, typed
 * source of truth — when you change a primitive here, port the change into:
 *   - trackb-orchestrator → FILM_SHELL_HEADER  (assembled LLM compositions)
 *   - trackb-render       → COMPOSITION_SOURCE (built-in fallback template)
 *
 * PRODUCT DEMO PRIMITIVES (premium SaaS demo treatment): the second half of
 * this file defines the cinematic-camera / product-stage / demo-cursor /
 * interaction / highlight / caption / transition set that renders scenes
 * planned by lib/trackB/productDemo.ts (the ONE timeline source of truth —
 * every timing there is a fraction of the scene's duration_s, so retiming a
 * scene retimes all of it). These are inlined ONLY into trackb-render's
 * COMPOSITION_SOURCE — the orchestrator's FILM_SHELL_HEADER is deliberately
 * NOT extended, because demo-mode films always render on the deterministic
 * built-in template (LLM-compiled compositions never reference this set).
 *
 * Safety rules the inlined copies must keep obeying (render-service gates):
 * no URLs in source, no fetch / browser globals / timers, no Math.random or
 * Date.now — deterministic frame-driven motion only. The inlined copies also
 * avoid template literals because they live inside JS template strings in the
 * two server functions.
 */
import React from 'react';
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

import {
  type DemoSceneSpec, type DemoCameraState,
  cameraAt, cursorAt, activeHighlight, transitionPhase, demoClamp01, demoEase,
} from './productDemo';

/** Brand tokens — always sourced from the project's extracted/user-confirmed brand kit, never hardcoded. */
export interface BrandTokens {
  primary?: string | null;
  secondary?: string | null;
  accent?: string | null;
  background?: string | null;
  text?: string | null;
  /** CSS font-family stack (checklist.brand_kit.typography.font_stack). */
  font?: string | null;
}

export type SlideDirection = 'left' | 'right' | 'top' | 'bottom';
export type ShowcaseEntrance = 'left' | 'right' | 'bottom' | 'scale';
export type OverlayPosition = 'lower-third' | 'center' | 'split-left';
export type ScrimDirection = 'top' | 'bottom' | 'left' | 'right';

/** Deterministic no-oscillation spring shared by every entrance primitive. */
export const HF_SPRING = { damping: 200, stiffness: 90 } as const;

export const clamp01 = (v: unknown): number => Math.max(0, Math.min(1, Number(v) || 0));
export const safeFrames = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n) : 90; };
const hfNum = (v: unknown, fallback: number): number => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };

export interface FadeInProps {
  delay?: number;
  duration?: number;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

/** Frame-driven fade-in wrapper. */
export const FadeIn: React.FC<FadeInProps> = ({ delay, duration, style, children }) => {
  const frame = useCurrentFrame();
  const p = clamp01(interpolate(frame - hfNum(delay, 0), [0, Math.max(1, hfNum(duration, 18))], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
  return <div style={Object.assign({}, style, { opacity: p })}>{children}</div>;
};

export interface SlideInProps {
  delay?: number;
  /** The edge the content enters FROM. */
  from?: SlideDirection;
  distance?: number;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

/** Spring slide + fade entrance. */
export const SlideIn: React.FC<SlideInProps> = ({ delay, from, distance, style, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = clamp01(spring({ frame: frame - hfNum(delay, 0), fps: fps, config: HF_SPRING }));
  const dist = hfNum(distance, 120);
  const dir = from || 'left';
  const x = dir === 'left' ? -(1 - p) * dist : dir === 'right' ? (1 - p) * dist : 0;
  const y = dir === 'top' ? -(1 - p) * dist : dir === 'bottom' ? (1 - p) * dist : 0;
  return <div style={Object.assign({}, style, { opacity: p, transform: 'translate(' + x + 'px, ' + y + 'px)' })}>{children}</div>;
};

export interface ScaleRevealProps {
  delay?: number;
  /** Starting scale (grows to 1). */
  initial?: number;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

/** Spring scale-up + fade reveal. */
export const ScaleReveal: React.FC<ScaleRevealProps> = ({ delay, initial, style, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = clamp01(spring({ frame: frame - hfNum(delay, 0), fps: fps, config: HF_SPRING }));
  const s0 = hfNum(initial, 0.92);
  return <div style={Object.assign({}, style, { opacity: p, transform: 'scale(' + (s0 + (1 - s0) * p) + ')' })}>{children}</div>;
};

export interface TextRevealProps {
  text?: string | null;
  delay?: number;
  /** Frames between successive words. */
  stagger?: number;
  style?: React.CSSProperties;
}

/** Per-word staggered kinetic text entrance (rise + fade per word). */
export const TextReveal: React.FC<TextRevealProps> = ({ text, delay, stagger, style }) => {
  const frame = useCurrentFrame();
  const words = String(text == null ? '' : text).split(' ').filter(Boolean);
  const base = hfNum(delay, 0);
  const step = Math.max(0.5, hfNum(stagger, 3));
  // LONG-TEXT GUARD: long headlines step the font size down instead of
  // overflowing their layout zone — text wraps or shrinks, never clips
  // mid-word and never collides with neighbouring zones by construction.
  const chars = words.join(' ').length;
  const shrink = chars > 110 ? 0.56 : chars > 80 ? 0.68 : chars > 55 ? 0.82 : 1;
  const styleIn = style || {};
  const fsIn = Number(styleIn.fontSize);
  const safeStyle = Object.assign(
    {},
    styleIn,
    {
      maxWidth: styleIn.maxWidth != null ? styleIn.maxWidth : '100%',
      lineHeight: styleIn.lineHeight != null ? styleIn.lineHeight : 1.1,
      overflowWrap: 'break-word' as const,
    },
    Number.isFinite(fsIn) && shrink < 1 ? { fontSize: Math.round(fsIn * shrink) } : null,
  );
  return (
    <div style={safeStyle}>
      {words.map((w, i) => {
        const p = clamp01(interpolate(frame - base - i * step, [0, 16], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
        return (
          <span key={i} style={{ display: 'inline-block', marginRight: '0.28em', opacity: p, transform: 'translateY(' + ((1 - p) * 28) + 'px)' }}>{w}</span>
        );
      })}
    </div>
  );
};

export interface KenBurnsImageProps {
  src?: string | null;
  /** Starting zoom (default 1.02). */
  from?: number;
  /** Ending zoom (default 1.1). */
  to?: number;
  driftX?: number;
  driftY?: number;
  /** CSS object-position focal anchor (default 'center top' — screenshots read best anchored to their top). */
  focal?: string;
  style?: React.CSSProperties;
}

/**
 * Continuing slow zoom / parallax drift over an image, cropped with
 * object-fit cover on a focal position so content stays readable and is
 * never stretched to a wrong aspect ratio. Duration comes from the
 * enclosing <Sequence> via useVideoConfig().
 */
export const KenBurnsImage: React.FC<KenBurnsImageProps> = ({ src, from, to, driftX, driftY, focal, style }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const dur = safeFrames(durationInFrames);
  const zoom = interpolate(frame, [0, dur], [hfNum(from, 1.02), hfNum(to, 1.1)], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const dx = interpolate(frame, [0, dur], [0, hfNum(driftX, 0)], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const dy = interpolate(frame, [0, dur], [0, hfNum(driftY, 0)], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  if (!src) return null;
  return <Img src={src} style={Object.assign({ width: '100%', height: '100%', objectFit: 'cover', objectPosition: focal || 'center top', transform: 'translate(' + dx + 'px, ' + dy + 'px) scale(' + zoom + ')' }, style)} />;
};

export interface DeviceFrameProps {
  brand?: BrandTokens | null;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

/** Brand-tinted browser-chrome mockup: traffic-light control dots + address bar; children fill the viewport. */
export const DeviceFrame: React.FC<DeviceFrameProps> = ({ brand, style, children }) => {
  const b = brand || {};
  const primary = b.primary || '#6d5efc';
  const chromeText = b.text || '#f8fafc';
  return (
    <div style={Object.assign({ borderRadius: 24, overflow: 'hidden', border: '2px solid ' + primary + '3d', boxShadow: '0 60px 140px -40px ' + primary + '66', background: b.background || '#090b14' }, style)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '13px 18px', background: primary + '1f', borderBottom: '1px solid ' + primary + '2e' }}>
        <span style={{ width: 13, height: 13, borderRadius: 999, background: b.accent || primary }} />
        <span style={{ width: 13, height: 13, borderRadius: 999, background: b.secondary || primary }} />
        <span style={{ width: 13, height: 13, borderRadius: 999, background: chromeText, opacity: 0.35 }} />
        <span style={{ flex: 1, maxWidth: 420, height: 16, borderRadius: 999, background: chromeText, opacity: 0.12, marginLeft: 12 }} />
      </div>
      {children}
    </div>
  );
};

export interface ScreenshotShowcaseProps {
  src?: string | null;
  brand?: BrandTokens | null;
  delay?: number;
  /** Entrance: slide from an edge, or 'scale' for a spring scale-up reveal. */
  from?: ShowcaseEntrance;
  /** Focal crop anchor (default 'center top'). */
  focal?: string;
  /** Viewport height/width ratio (default 0.625 — a 16:10 browser viewport). */
  ratio?: number;
  /** Ending zoom of the continuing drift (default 1.08). */
  zoomTo?: number;
  style?: React.CSSProperties;
}

/**
 * The complete screenshot treatment: browser-chrome device frame, spring
 * entrance, a fixed-ratio viewport cropped with object-fit cover on a
 * sensible focal position, and a slow continuing Ken Burns drift — so a
 * product screenshot always reads as intentional motion design, never a
 * flat pasted static image, never tiny, never stretched.
 */
export const ScreenshotShowcase: React.FC<ScreenshotShowcaseProps> = ({ src, brand, delay, from, focal, ratio, zoomTo, style }) => {
  const r = Math.max(0.3, Math.min(1.4, hfNum(ratio, 0.625)));
  const framed = (
    <DeviceFrame brand={brand}>
      <div style={{ position: 'relative', width: '100%', paddingTop: (r * 100) + '%', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
          <KenBurnsImage src={src} from={1} to={hfNum(zoomTo, 1.08)} focal={focal || 'center top'} />
        </div>
      </div>
    </DeviceFrame>
  );
  if (from === 'scale') return <ScaleReveal delay={delay} initial={0.9} style={style}>{framed}</ScaleReveal>;
  return <SlideIn delay={delay} from={from || 'right'} distance={140} style={style}>{framed}</SlideIn>;
};

export interface ScrimProps {
  /** Scrim colour — pass the brand background token. */
  color?: string | null;
  /** The edge the scrim darkens toward (default 'bottom'). */
  direction?: ScrimDirection;
  /** Peak opacity 0..1 (default 0.82). */
  strength?: number;
  style?: React.CSSProperties;
}

/** Legibility gradient behind text placed over imagery. */
export const Scrim: React.FC<ScrimProps> = ({ color, direction, strength, style }) => {
  const c = color || '#090b14';
  let a = Math.round(clamp01(strength == null ? 0.82 : strength) * 255).toString(16);
  if (a.length < 2) a = '0' + a;
  const to = direction || 'bottom';
  const angle = to === 'top' ? '0deg' : to === 'left' ? '270deg' : to === 'right' ? '90deg' : '180deg';
  return <div style={Object.assign({ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none', background: 'linear-gradient(' + angle + ', ' + c + '00 42%, ' + c + a + ' 100%)' }, style)} />;
};

export interface SceneTextOverlayProps {
  /** This scene's OWN script headline — synced to the scene's voiceover beat. */
  headline?: string | null;
  /** This scene's OWN script caption. */
  caption?: string | null;
  brand?: BrandTokens | null;
  delay?: number;
  position?: OverlayPosition;
  style?: React.CSSProperties;
}

/**
 * Composed, brand-styled text overlay for scenes whose visual is an
 * AI-generated image (which contains no text by design): brand font stack +
 * brand colours only, a legibility scrim, a staggered per-word headline
 * entrance and a delayed caption — deliberate typography that feels part of
 * the visual, never a plain subtitle bar.
 */
export const SceneTextOverlay: React.FC<SceneTextOverlayProps> = ({ headline, caption, brand, delay, position, style }) => {
  const frame = useCurrentFrame();
  const b = brand || {};
  const base = hfNum(delay, 6);
  const font = b.font || 'Inter, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
  const capIn = clamp01(interpolate(frame - base, [14, 34], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
  const barIn = clamp01(interpolate(frame - base, [6, 28], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
  const pos = position || 'lower-third';
  const wrap: React.CSSProperties = pos === 'center'
    ? { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '0 200px' }
    : pos === 'split-left'
      ? { position: 'absolute', left: 110, top: 0, bottom: 0, width: 780, display: 'flex', flexDirection: 'column', justifyContent: 'center' }
      : { position: 'absolute', left: 120, right: 120, bottom: 96 };
  return (
    <AbsoluteFill style={Object.assign({ fontFamily: font }, style)}>
      <Scrim color={b.background || '#090b14'} direction={pos === 'split-left' ? 'left' : 'bottom'} strength={pos === 'center' ? 0.6 : 0.85} />
      <div style={wrap}>
        <TextReveal text={headline || ''} delay={base} stagger={2.5} style={{ color: b.text || '#f8fafc', fontSize: pos === 'center' ? 96 : 72, lineHeight: 1.06, fontWeight: 900, letterSpacing: '-0.02em', maxWidth: 1240, textShadow: '0 4px 40px ' + (b.background || '#090b14') + 'cc' }} />
        {caption ? <p style={{ margin: '22px 0 0', color: b.text || '#f8fafc', opacity: 0.78 * capIn, fontSize: 36, lineHeight: 1.4, fontWeight: 500, maxWidth: 980, transform: 'translateY(' + ((1 - capIn) * 24) + 'px)' }}>{caption}</p> : null}
        <div style={{ marginTop: 30, height: 7, borderRadius: 999, width: Math.max(1, Math.round(210 * barIn)), background: 'linear-gradient(90deg, ' + (b.primary || '#6d5efc') + ', ' + (b.accent || b.primary || '#22d3ee') + ')' }} />
      </div>
    </AbsoluteFill>
  );
};

// ===========================================================================
// PRODUCT DEMO PRIMITIVE SET — the premium SaaS-demo treatment. Each
// component is a pure presentation of the productDemo timeline evaluated at
// t (the 0..1 fraction of the scene): the composition passes t = frame/dur,
// so ALL timing flows from the scene's duration_s and nothing else.
// ===========================================================================

/** Aspect-aware stage geometry — where the product surface sits in the frame. */
export function demoStageLayout(width: number, height: number): { surfW: number; surfH: number; ratio: number; portrait: boolean; square: boolean } {
  const ratio = 0.625;
  const w = Math.max(1, Number(width) || 1920);
  const h = Math.max(1, Number(height) || 1080);
  const portrait = h > w * 1.1;
  const square = !portrait && h > w * 0.8;
  const maxW = portrait ? w * 0.92 : square ? w * 0.84 : w * 0.72;
  const maxH = portrait ? h * 0.5 : square ? h * 0.58 : h * 0.74;
  const surfW = Math.min(maxW, maxH / ratio);
  return { surfW, surfH: surfW * ratio, ratio, portrait, square };
}

export interface CinematicCameraProps {
  /** Evaluated camera state (productDemo.cameraAt). */
  state: DemoCameraState;
  surfW: number;
  surfH: number;
  children?: React.ReactNode;
}

/**
 * The cinematic camera rig: scale + translate + roll from the evaluated
 * camera state, plus a subtle perspective tilt derived from the translation
 * so pushes and pans read as depth moves, never flat slides.
 */
export const CinematicCamera: React.FC<CinematicCameraProps> = ({ state, surfW, surfH, children }) => {
  const tx = -state.x * surfW * state.scale;
  const ty = -state.y * surfH * state.scale;
  const rotY = state.x * -5;
  const rotX = state.y * 4;
  return (
    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', perspective: 1400 }}>
      <div style={{ transform: 'translate(' + tx + 'px, ' + ty + 'px) scale(' + state.scale + ') rotate(' + state.rotate + 'deg) rotateY(' + rotY + 'deg) rotateX(' + rotX + 'deg)', transformStyle: 'preserve-3d' }}>
        {children}
      </div>
    </div>
  );
};

export interface ProductStageProps {
  brand?: BrandTokens | null;
  /** Camera state — the background parallaxes at a fraction of the camera move. */
  state: DemoCameraState;
  width: number;
  height: number;
  children?: React.ReactNode;
}

/**
 * The stage the product performs on: brand-toned ambient light, a soft key
 * gradient, depth parallax (background moves slower than the camera) and a
 * vignette — controlled lighting and depth without glow overuse.
 */
export const ProductStage: React.FC<ProductStageProps> = ({ brand, state, width, height, children }) => {
  const b = brand || {};
  const bg = b.background || '#090b14';
  const primary = b.primary || '#6d5efc';
  const accent = b.accent || '#22d3ee';
  const px = -state.x * width * 0.06;
  const py = -state.y * height * 0.06;
  return (
    <AbsoluteFill style={{ backgroundColor: bg, overflow: 'hidden' }}>
      <AbsoluteFill style={{ transform: 'translate(' + px + 'px, ' + py + 'px) scale(1.12)', background: 'radial-gradient(120% 90% at 30% 0%, ' + primary + '26, transparent 60%), radial-gradient(90% 70% at 85% 90%, ' + accent + '1a, transparent 55%)' }} />
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, transparent 55%, ' + bg + 'b3 100%)' }} />
      {children}
      <AbsoluteFill style={{ pointerEvents: 'none', background: 'radial-gradient(130% 100% at 50% 45%, transparent 62%, ' + bg + 'cc 100%)' }} />
    </AbsoluteFill>
  );
};

export interface ProductSurfaceProps {
  src?: string | null;
  brand?: BrandTokens | null;
  surfW: number;
  surfH: number;
  /** Scene fraction 0..1 — drives the entrance sheen and scroll drift. */
  t: number;
  /** Vertical content drift for scroll scenes (fraction of surface height). */
  scrollDrift?: number;
  children?: React.ReactNode;
}

/**
 * The product itself: the screenshot inside the brand-tinted device frame
 * with a controlled shadow, a one-time light sheen on entrance, an optional
 * scroll drift, and a subtle floor reflection — depth and polish with a
 * clean visual hierarchy.
 */
export const ProductSurface: React.FC<ProductSurfaceProps> = ({ src, brand, surfW, surfH, t, scrollDrift, children }) => {
  const b = brand || {};
  const bg = b.background || '#090b14';
  const sheen = demoClamp01((t - 0.06) / 0.3);
  const drift = (Number(scrollDrift) || 0) * demoEase(demoClamp01((t - 0.3) / 0.45));
  const objPos = 'center ' + Math.round(drift * 100) + '%';
  return (
    <div style={{ position: 'relative', width: surfW }}>
      <DeviceFrame brand={brand} style={{ boxShadow: '0 ' + Math.round(surfH * 0.09) + 'px ' + Math.round(surfH * 0.22) + 'px -' + Math.round(surfH * 0.07) + 'px rgba(0,0,0,0.6)' }}>
        <div style={{ position: 'relative', width: '100%', height: surfH, overflow: 'hidden' }}>
          {src ? <Img src={src} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: objPos }} /> : null}
          {sheen > 0 && sheen < 1 ? (
            <div style={{ position: 'absolute', top: '-20%', bottom: '-20%', width: '34%', left: (sheen * 160 - 40) + '%', transform: 'rotate(14deg)', background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.10), transparent)', pointerEvents: 'none' }} />
          ) : null}
          {children}
        </div>
      </DeviceFrame>
      <div aria-hidden style={{ position: 'absolute', top: '100%', left: '4%', right: '4%', height: surfH * 0.18, transform: 'scaleY(-1)', opacity: 0.16, overflow: 'hidden', borderRadius: 24, pointerEvents: 'none' }}>
        {src ? <Img src={src} style={{ width: '100%', height: surfH, objectFit: 'cover', objectPosition: 'center top' }} /> : null}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'linear-gradient(0deg, ' + bg + '00 0%, ' + bg + ' 88%)' }} />
      </div>
    </div>
  );
};

export interface DemoCursorViewProps {
  spec: DemoSceneSpec;
  t: number;
  surfW: number;
  surfH: number;
  accent?: string | null;
}

/**
 * The demo cursor — always travels between waypoints (productDemo.cursorAt
 * interpolates every position, so it can never teleport), presses with a
 * scale dip, and emits a click ripple while pressed.
 */
export const DemoCursorView: React.FC<DemoCursorViewProps> = ({ spec, t, surfW, surfH, accent }) => {
  const c = cursorAt(spec, t);
  if (!c || !c.visible) return null;
  const size = Math.max(22, Math.round(surfW * 0.026));
  const scale = c.press ? 0.82 : 1;
  return (
    <div style={{ position: 'absolute', left: c.x * surfW - size * 0.22, top: c.y * surfH - size * 0.1, pointerEvents: 'none', zIndex: 5 }}>
      {c.press ? (
        <span style={{ position: 'absolute', left: -size * 0.6, top: -size * 0.6, width: size * 1.6, height: size * 1.6, borderRadius: 999, border: '2px solid ' + (accent || '#22d3ee'), opacity: 0.7, transform: 'scale(1.25)' }} />
      ) : null}
      <svg width={size} height={size} viewBox="0 0 24 24" style={{ transform: 'scale(' + scale + ')', filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.55))' }}>
        <path d="M5 2 L5 19 L9.5 15.4 L12.4 21.6 L15.2 20.3 L12.3 14.2 L18 13.6 Z" fill="#ffffff" stroke="#0b0d16" strokeWidth="1.4" />
      </svg>
    </div>
  );
};

export interface HighlightFXProps {
  spec: DemoSceneSpec;
  t: number;
  brand?: BrandTokens | null;
}

/**
 * Feature emphasis: a spotlight (background dims around the target) or an
 * accent outline. Only the currently demonstrated feature gets strong
 * emphasis — no glow spam, entrances and exits are eased.
 */
export const HighlightFX: React.FC<HighlightFXProps> = ({ spec, t, brand }) => {
  const h = activeHighlight(spec, t);
  if (!h) return null;
  const b = brand || {};
  const bg = b.background || '#090b14';
  const accent = b.accent || b.primary || '#22d3ee';
  const fadeIn = demoClamp01((t - h.from) / 0.06);
  const fadeOut = demoClamp01((h.to - t) / 0.08);
  const on = Math.min(fadeIn, fadeOut);
  const cx = (h.target.x + h.target.w / 2) * 100;
  const cy = (h.target.y + h.target.h / 2) * 100;
  const rx = Math.max(h.target.w, 0.12) * 115;
  return (
    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 3 }}>
      {h.style === 'spotlight' ? (
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: on, background: 'radial-gradient(' + rx + '% ' + (rx * 1.4) + '% at ' + cx + '% ' + cy + '%, transparent 42%, ' + bg + '99 100%)' }} />
      ) : null}
      <div style={{ position: 'absolute', left: (h.target.x * 100) + '%', top: (h.target.y * 100) + '%', width: (h.target.w * 100) + '%', height: (h.target.h * 100) + '%', borderRadius: 10, border: '2px solid ' + accent, opacity: on * (h.style === 'outline' ? 0.95 : 0.65), boxShadow: '0 0 0 4px ' + accent + '22', transform: 'scale(' + (1 + (1 - on) * 0.06) + ')' }} />
    </div>
  );
};

export interface InteractionFXProps {
  spec: DemoSceneSpec;
  t: number;
  brand?: BrandTokens | null;
  surfW: number;
  surfH: number;
}

/**
 * The UI's response to the cursor: press-darken + depress on click/open,
 * a sliding toggle knob, a typing caret with a growing underline, a drag
 * ghost that follows the cursor, and a scroll thumb — each anchored to the
 * event's target rect and timed entirely by the scene timeline.
 */
export const InteractionFX: React.FC<InteractionFXProps> = ({ spec, t, brand, surfW, surfH }) => {
  const e = spec.events.find((ev) => t >= ev.at - 0.02 && t <= ev.end + 0.06) || null;
  if (!e) return null;
  const b = brand || {};
  const primary = b.primary || '#6d5efc';
  const accent = b.accent || '#22d3ee';
  const p = demoClamp01((t - e.at) / Math.max(0.0001, e.end - e.at));
  const rect: React.CSSProperties = { position: 'absolute', left: (e.target.x * 100) + '%', top: (e.target.y * 100) + '%', width: (e.target.w * 100) + '%', height: (e.target.h * 100) + '%' };
  const press = t >= e.at && p < 0.35;
  const nodes: React.ReactNode[] = [];
  if (e.action === 'click' || e.action === 'open' || e.action === 'select' || e.action === 'close' || e.action === 'expand' || e.action === 'zoom') {
    nodes.push(<div key="press" style={{ ...rect, borderRadius: 10, background: 'rgba(0,0,0,' + (press ? 0.2 : 0) + ')', transform: 'scale(' + (press ? 0.975 : 1) + ')', transition: 'none' }} />);
    if (p > 0.1 && p < 0.85) {
      const rp = demoEase((p - 0.1) / 0.75);
      nodes.push(<span key="ripple" style={{ position: 'absolute', left: ((e.target.x + e.target.w / 2) * 100) + '%', top: ((e.target.y + e.target.h / 2) * 100) + '%', width: 12 + rp * surfW * 0.09, height: 12 + rp * surfW * 0.09, marginLeft: -(12 + rp * surfW * 0.09) / 2, marginTop: -(12 + rp * surfW * 0.09) / 2, borderRadius: 999, border: '2px solid ' + accent, opacity: (1 - rp) * 0.8 }} />);
    }
  } else if (e.action === 'toggle') {
    const knob = demoEase(demoClamp01((p - 0.2) / 0.5));
    nodes.push(
      <div key="toggle" style={{ ...rect, borderRadius: 999, background: knob > 0.5 ? primary : 'rgba(120,130,150,0.5)', border: '1px solid rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center' }}>
        <span style={{ display: 'block', width: '42%', height: '82%', margin: '0 4%', borderRadius: 999, background: '#ffffff', transform: 'translateX(' + (knob * 120) + '%)', boxShadow: '0 1px 4px rgba(0,0,0,0.4)' }} />
      </div>,
    );
  } else if (e.action === 'type') {
    const tw = demoEase(demoClamp01(p / 0.9));
    const caretOn = Math.floor(t * 24) % 2 === 0;
    nodes.push(
      <div key="type" style={{ ...rect, borderRadius: 8, border: '1.5px solid ' + primary, background: 'rgba(255,255,255,0.05)' }}>
        <span style={{ position: 'absolute', left: (6 + tw * 60) + '%', top: '18%', bottom: '18%', width: 2, background: caretOn ? '#ffffff' : 'transparent' }} />
        <span style={{ position: 'absolute', left: '4%', bottom: -6, height: 3, width: (tw * 88) + '%', borderRadius: 999, background: accent }} />
      </div>,
    );
  } else if ((e.action === 'drag' || e.action === 'drop') && e.target2) {
    const dp = demoEase(demoClamp01((p - 0.15) / 0.7));
    const gx = e.target.x + (e.target2.x - e.target.x) * dp;
    const gy = e.target.y + (e.target2.y - e.target.y) * dp;
    nodes.push(<div key="ghost" style={{ position: 'absolute', left: (gx * 100) + '%', top: (gy * 100) + '%', width: (e.target.w * 100) + '%', height: (e.target.h * 100) + '%', borderRadius: 10, border: '2px dashed ' + accent, background: accent + '1f', opacity: 0.9 }} />);
  } else if (e.action === 'scroll') {
    const sp = demoEase(demoClamp01(p));
    nodes.push(<span key="thumb" style={{ position: 'absolute', right: 4, top: (12 + sp * 55) + '%', width: 5, height: '18%', borderRadius: 999, background: 'rgba(255,255,255,0.4)' }} />);
  } else if (e.action === 'hover') {
    nodes.push(<div key="hover" style={{ ...rect, borderRadius: 10, border: '1.5px solid ' + accent + 'aa', background: accent + '14' }} />);
  }
  return <div style={{ position: 'absolute', top: 0, left: 0, width: surfW, height: surfH, pointerEvents: 'none', zIndex: 4 }}>{nodes}</div>;
};

export interface SceneCaptionProps {
  text?: string | null;
  brand?: BrandTokens | null;
  /** Caption window in scene fractions. */
  window: { from: number; to: number };
  t: number;
  portrait?: boolean;
}

/**
 * Short on-screen messaging — a brand-typography pill in the safe area,
 * animated independently but timed by the same scene timeline. The product
 * stays the hero: one line, never a wall of text.
 */
export const SceneCaption: React.FC<SceneCaptionProps> = ({ text, brand, window: win, t, portrait }) => {
  const line = String(text || '').trim();
  if (!line) return null;
  const b = brand || {};
  const enter = demoEase(demoClamp01((t - win.from) / 0.07));
  const exit = demoEase(demoClamp01((win.to - t) / 0.07));
  const on = Math.min(enter, exit);
  if (on <= 0) return null;
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: portrait ? '12%' : '7%', display: 'flex', justifyContent: 'center', pointerEvents: 'none', opacity: on, transform: 'translateY(' + ((1 - on) * 26) + 'px)' }}>
      <span style={{ maxWidth: '72%', padding: '14px 26px', borderRadius: 999, background: (b.background || '#090b14') + 'd9', border: '1px solid ' + (b.primary || '#6d5efc') + '55', color: b.text || '#f8fafc', fontFamily: b.font || 'Inter, sans-serif', fontWeight: 700, fontSize: portrait ? 30 : 34, lineHeight: 1.3, textAlign: 'center', boxShadow: '0 12px 40px rgba(0,0,0,0.35)' }}>{line}</span>
    </div>
  );
};

export interface SceneTransitionShellProps {
  spec: DemoSceneSpec;
  t: number;
  children?: React.ReactNode;
}

/**
 * Premium scene transitions, chained across cuts (scene N's exit kind is
 * scene N+1's entry kind): 'camera' continues the push through the cut,
 * 'expand' scales the surface up as if a panel becomes the next scene,
 * 'focus' racks focus (blur + dim) across the cut, 'fade' only bookends the
 * film — never a generic mid-film crossfade.
 */
export const SceneTransitionShell: React.FC<SceneTransitionShellProps> = ({ spec, t, children }) => {
  const ph = transitionPhase(t, 0.1);
  let opacity = 1;
  let scale = 1;
  let blur = 0;
  if (ph.enter < 1) {
    const e = demoEase(ph.enter);
    if (spec.transitionIn === 'camera') { scale = 1.1 - e * 0.1; opacity = 0.25 + e * 0.75; }
    else if (spec.transitionIn === 'expand') { scale = 1.16 - e * 0.16; opacity = 0.3 + e * 0.7; }
    else if (spec.transitionIn === 'focus') { blur = (1 - e) * 10; opacity = 0.35 + e * 0.65; }
    else { opacity = e; }
  }
  if (ph.exit < 1) {
    const x = demoEase(ph.exit);
    if (spec.transitionOut === 'camera') { scale *= 1 + (1 - x) * 0.08; opacity = Math.min(opacity, 0.2 + x * 0.8); }
    else if (spec.transitionOut === 'expand') { scale *= 1 + (1 - x) * 0.14; opacity = Math.min(opacity, 0.25 + x * 0.75); }
    else if (spec.transitionOut === 'focus') { blur = Math.max(blur, (1 - x) * 9); opacity = Math.min(opacity, 0.3 + x * 0.7); }
    else { opacity = Math.min(opacity, x); }
  }
  return (
    <AbsoluteFill style={{ opacity, transform: 'scale(' + scale + ')', filter: blur > 0.2 ? 'blur(' + blur.toFixed(1) + 'px)' : undefined }}>
      {children}
    </AbsoluteFill>
  );
};

export interface DemoDebugOverlayProps {
  rows: { label: string; value: string }[];
}

/** Developer-only state readout (rendered when the render is queued with debug=true). */
export const DemoDebugOverlay: React.FC<DemoDebugOverlayProps> = ({ rows }) => (
  <div style={{ position: 'absolute', top: 14, left: 14, zIndex: 50, padding: '10px 14px', borderRadius: 10, background: 'rgba(3,6,14,0.82)', border: '1px solid rgba(255,255,255,0.18)', color: '#d9fdd3', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 15, lineHeight: 1.55, pointerEvents: 'none' }}>
    {rows.map((r, i) => (
      <div key={i}><span style={{ color: '#8aa4c0' }}>{r.label}: </span>{r.value}</div>
    ))}
  </div>
);
