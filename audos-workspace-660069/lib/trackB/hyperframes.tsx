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
 * Safety rules the inlined copies must keep obeying (render-service gates):
 * no URLs in source, no fetch / browser globals / timers, no Math.random or
 * Date.now — deterministic frame-driven motion only. The inlined copies also
 * avoid template literals because they live inside JS template strings in the
 * two server functions.
 */
import React from 'react';
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

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
