/**
 * Video Studio — the preview stage.
 *
 * One component composites everything the viewer will see, in the order the
 * export composites it:
 *
 *   chroma background → text marked “behind subject” → the keyed / graded
 *   picture (with its crop, reframe, speed ramp, match-cut zoom and camera
 *   shake) → clip and global effect layers → light leaks, VHS and glitch →
 *   b-roll video overlays → image overlays → text layers → captions → the
 *   transition plate.
 *
 * It draws from the same descriptors the server render uses (studioStyles,
 * studioFx, studioCaptionKit), so the stage is a faithful preview rather than
 * an approximation. The three effects that need real per-pixel work — chroma
 * key, turbulent displace and glitch slice tearing — are SVG filters, which
 * run identically here and inside Remotion's headless Chrome and never have
 * to read frames back out of a canvas (that would taint on cross-origin
 * footage and kill the key outright).
 *
 * Overlays and text layers are draggable here — the stage reports normalised
 * positions back so the inspector and the stage never disagree.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import {
  CaptionCue, CaptionSettings, EditDoc, GlowState, Overlay, StudioClip,
  TextLayer, VideoOverlay, VisualEffectId, aspectRatio, clamp01, clipFilterCss,
  clipMotion, defaultChroma, defaultVfx, focusAt, focusObjectPosition, fontCss,
  keyframeAt, overlaySourceTime, timelineDuration, trackAt,
} from './studioModel';
import {
  CaptionStyleSpec, captionStyle, captionTop, effectLayers, textAnimState,
  transitionState,
} from './studioStyles';
import {
  chromaSpec, displaceSpec, glitchSpec, glowShadow, leakLayers, overlayBox,
  rayLayers, shakeAt, vhsFrame, vhsLayers, zoomCutAt,
} from './studioFx';
import { captionDesign, captionLineAnim, captionWordPaint } from './studioCaptionKit';

/** Natural aspect ratio of an overlay image, measured once and cached. */
const aspectCache = new Map<string, number>();

function useImageAspect(url: string): number {
  const [ratio, setRatio] = useState(() => aspectCache.get(url) || 1);
  useEffect(() => {
    if (!url) return;
    const cached = aspectCache.get(url);
    if (cached) { setRatio(cached); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    let live = true;
    img.onload = () => {
      const r = img.naturalWidth > 0 && img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 1;
      aspectCache.set(url, r);
      if (live) setRatio(r);
    };
    img.src = url;
    return () => { live = false; };
  }, [url]);
  return ratio;
}

/** A stable suffix so two stages on one page cannot share a filter id. */
function useFilterScope(): string {
  const ref = useRef('');
  if (!ref.current) ref.current = Math.random().toString(36).slice(2, 8);
  return ref.current;
}

function LayerStack({ layers, keyPrefix }: { layers: { background: string; opacity: number; blend: string; extra?: Record<string, string | number> }[]; keyPrefix: string }) {
  return (
    <>
      {layers.map((layer, i) => (
        <div
          key={`${keyPrefix}-${i}`}
          style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background: layer.background,
            opacity: layer.opacity,
            mixBlendMode: layer.blend as CSSProperties['mixBlendMode'],
            ...(layer.extra as CSSProperties),
          }}
        />
      ))}
    </>
  );
}

function EffectOverlays({ ids, t, duration }: { ids: VisualEffectId[]; t: number; duration: number }) {
  return <LayerStack keyPrefix="fx" layers={ids.flatMap((id) => effectLayers(id, t, duration))} />;
}

// ---------------------------------------------------------------------------
// B-roll video overlays
// ---------------------------------------------------------------------------

function BrollOverlayLayer({
  overlay, playhead, isPlaying, volume, selected, onPick,
}: {
  overlay: VideoOverlay;
  playhead: number;
  isPlaying: boolean;
  volume: number;
  selected: boolean;
  onPick: (id: string) => void;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const visible = playhead >= overlay.start && playhead < overlay.end;
  const src = overlay.previewUrl || overlay.url;

  // The cutaway is slaved to the main playhead rather than playing freely:
  // it is nudged back into place whenever it drifts more than a few frames,
  // which is what keeps a scrub or a seek from desynchronising it.
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (!visible) {
      if (!v.paused) v.pause();
      v.muted = true;
      if (gainRef.current && audioContextRef.current) {
        gainRef.current.gain.setValueAtTime(0, audioContextRef.current.currentTime);
      }
      return;
    }
    const want = overlaySourceTime(overlay, playhead);
    if (Math.abs(v.currentTime - want) > 0.22) {
      try { v.currentTime = want; } catch { /* not seekable yet */ }
    }
    const local = Math.max(0, playhead - overlay.start);
    const remaining = Math.max(0, overlay.end - playhead);
    const fadeIn = Math.min(1, local / Math.max(0.01, overlay.audioFadeIn || 0.3));
    const fadeOut = Math.min(1, remaining / Math.max(0.01, overlay.audioFadeOut || 0.5));
    const targetGain = overlay.muted ? 0 : volume * Math.min(fadeIn, fadeOut);
    if (!gainRef.current && !overlay.muted) {
      try {
        const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioContextCtor) {
          const context = new AudioContextCtor();
          const source = context.createMediaElementSource(v);
          const gain = context.createGain();
          source.connect(gain);
          gain.connect(context.destination);
          audioContextRef.current = context;
          sourceRef.current = source;
          gainRef.current = gain;
          v.volume = 1;
          v.muted = false;
        }
      } catch { /* browser will fall back to media-element volume */ }
    }
    if (gainRef.current && audioContextRef.current) {
      v.muted = false;
      const now = audioContextRef.current.currentTime;
      gainRef.current.gain.cancelScheduledValues(now);
      gainRef.current.gain.setValueAtTime(gainRef.current.gain.value, now);
      gainRef.current.gain.linearRampToValueAtTime(targetGain, now + 0.08);
      if (isPlaying && audioContextRef.current.state === 'suspended') void audioContextRef.current.resume();
    } else {
      v.muted = overlay.muted;
      v.volume = targetGain;
    }
    if (isPlaying && v.paused) void v.play().catch(() => undefined);
    if (!isPlaying && !v.paused) v.pause();
  }, [isPlaying, overlay, playhead, visible, volume]);

  useEffect(() => {
    const v = ref.current;
    return () => {
      if (v && !v.paused) v.pause();
      try { void audioContextRef.current?.close(); } catch { /* already closed */ }
    };
  }, []);

  if (!src) return null;

  const box = overlayBox(overlay.position, overlay.scale);
  const isPip = overlay.position !== 'full';
  // The last third of a fade-out cutaway dips to black, exactly as the
  // assembly renderer does on the server.
  const fade = overlay.fadeOut ? clamp01((overlay.end - playhead) / 0.45) : 1;

  return (
    <div
      onPointerDown={(e) => { e.stopPropagation(); onPick(overlay.id); }}
      style={{
        display: visible ? 'block' : 'none',
        position: 'absolute',
        left: `${box.left * 100}%`,
        top: `${box.top * 100}%`,
        width: `${box.width * 100}%`,
        height: `${box.height * 100}%`,
        opacity: overlay.opacity * fade,
        borderRadius: isPip ? overlay.radius : 0,
        overflow: 'hidden',
        boxShadow: isPip ? '0 6px 26px rgba(0,0,0,0.5)' : undefined,
        outline: selected ? '1.5px dashed rgba(34,197,94,0.95)' : 'none',
        outlineOffset: 2,
        cursor: 'pointer',
      }}
    >
      <video ref={ref} src={src} playsInline preload="auto" style={{ width: '100%', height: '100%', objectFit: 'cover', background: '#000' }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Image overlays — SVG masking gives real feathering, inversion and polygons
// ---------------------------------------------------------------------------

function OverlayLayer({
  overlay, stageW, stageH, playhead, selected, onPick, onMove, onResize, onTransformStart,
}: {
  overlay: Overlay;
  stageW: number;
  stageH: number;
  playhead: number;
  selected: boolean;
  onPick: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, width: number) => void;
  onTransformStart: () => void;
}) {
  const measured = useImageAspect(overlay.url);
  const imgAspect = measured !== 1 ? measured : overlay.aspect || 1;
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null);
  const transformStartedRef = useRef(false);

  const visible = overlay.alwaysOn || (playhead >= overlay.start && playhead <= overlay.end);
  if (!visible || !overlay.url) return null;

  const tracked = trackAt(overlay.track, playhead);
  const cx = tracked ? tracked.x : overlay.x;
  const cy = tracked ? tracked.y : overlay.y;

  const bw = Math.max(8, overlay.w * stageW);
  const bh = Math.max(8, bw / Math.max(0.05, imgAspect));
  const left = cx * stageW - bw / 2;
  const top = cy * stageH - bh / 2;

  const mask = overlay.mask;
  const maskId = `vsmask-${overlay.id}`;
  const blurId = `vsblur-${overlay.id}`;
  const feather = (mask.feather / 100) * Math.min(bw, bh) * 0.5;
  const p0 = mask.points[0] || { x: 0.1, y: 0.1 };
  const p1 = mask.points[1] || { x: 0.9, y: 0.9 };
  const rx = Math.min(p0.x, p1.x) * bw;
  const ry = Math.min(p0.y, p1.y) * bh;
  const rw = Math.max(2, Math.abs(p1.x - p0.x) * bw);
  const rh = Math.max(2, Math.abs(p1.y - p0.y) * bh);
  const shapeFill = mask.invert ? '#000' : '#fff';
  const plateFill = mask.invert ? '#fff' : '#000';

  let shape: JSX.Element | null = null;
  if (mask.shape === 'rect') {
    shape = <rect x={rx} y={ry} width={rw} height={rh} fill={shapeFill} filter={feather > 0.4 ? `url(#${blurId})` : undefined} />;
  } else if (mask.shape === 'ellipse') {
    shape = <ellipse cx={rx + rw / 2} cy={ry + rh / 2} rx={rw / 2} ry={rh / 2} fill={shapeFill} filter={feather > 0.4 ? `url(#${blurId})` : undefined} />;
  } else if (mask.shape === 'poly' && mask.points.length >= 3) {
    const pts = mask.points.map((p) => `${(clamp01(p.x) * bw).toFixed(1)},${(clamp01(p.y) * bh).toFixed(1)}`).join(' ');
    shape = <polygon points={pts} fill={shapeFill} filter={feather > 0.4 ? `url(#${blurId})` : undefined} />;
  }
  const masked = Boolean(shape);

  const onDown = (e: ReactPointerEvent) => {
    e.stopPropagation();
    onPick(overlay.id);
    if (overlay.track.enabled) return;   // a tracked overlay is driven by the path
    transformStartedRef.current = false;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const host = (e.currentTarget as HTMLElement).parentElement;
    const rect = host?.getBoundingClientRect();
    dragRef.current = {
      dx: rect ? e.clientX - (rect.left + left + bw / 2) : 0,
      dy: rect ? e.clientY - (rect.top + top + bh / 2) : 0,
    };
  };
  const onMoveEvt = (e: ReactPointerEvent) => {
    const resize = resizeRef.current;
    if (resize) {
      const delta = (e.clientX - resize.startX) / Math.max(1, stageW);
      const nextWidth = Math.max(0.03, Math.min(1, resize.startW + delta));
      if (Math.abs(nextWidth - overlay.w) < 0.0005) return;
      if (!transformStartedRef.current) { onTransformStart(); transformStartedRef.current = true; }
      onResize(overlay.id, nextWidth);
      return;
    }
    const d = dragRef.current;
    if (!d) return;
    const host = (e.currentTarget as HTMLElement).parentElement;
    if (!host) return;
    const r = host.getBoundingClientRect();
    const nextX = clamp01((e.clientX - d.dx - r.left) / Math.max(1, r.width));
    const nextY = clamp01((e.clientY - d.dy - r.top) / Math.max(1, r.height));
    if (Math.abs(nextX - overlay.x) < 0.0005 && Math.abs(nextY - overlay.y) < 0.0005) return;
    if (!transformStartedRef.current) { onTransformStart(); transformStartedRef.current = true; }
    onMove(overlay.id, nextX, nextY);
  };
  const onResizeDown = (e: ReactPointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onPick(overlay.id);
    if (overlay.track.enabled) return;
    transformStartedRef.current = false;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    resizeRef.current = { startX: e.clientX, startW: overlay.w };
  };
  const onUp = () => { dragRef.current = null; resizeRef.current = null; transformStartedRef.current = false; };

  return (
    <div
      onPointerDown={onDown}
      onPointerMove={onMoveEvt}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      style={{
        position: 'absolute', left, top, width: bw, height: bh,
        opacity: overlay.opacity,
        mixBlendMode: overlay.blend as CSSProperties['mixBlendMode'],
        transform: `rotate(${overlay.rotation}deg)`,
        cursor: overlay.track.enabled ? 'not-allowed' : 'move',
        outline: selected ? '1.5px dashed rgba(245,158,11,0.9)' : 'none',
        outlineOffset: 2,
        touchAction: 'none',
      }}
    >
      <svg width={bw} height={bh} viewBox={`0 0 ${bw} ${bh}`} style={{ display: 'block', pointerEvents: 'none' }}>
        {masked ? (
          <defs>
            <filter id={blurId} x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation={Math.max(0.4, feather)} />
            </filter>
            <mask id={maskId} maskUnits="userSpaceOnUse" x={0} y={0} width={bw} height={bh}>
              <rect x={0} y={0} width={bw} height={bh} fill={plateFill} />
              {shape}
            </mask>
          </defs>
        ) : null}
        <image
          href={overlay.url}
          x={0}
          y={0}
          width={bw}
          height={bh}
          preserveAspectRatio="xMidYMid meet"
          mask={masked ? `url(#${maskId})` : undefined}
        />
      </svg>
      {selected ? (
        <>
          <span style={{ position: 'absolute', left: 0, top: -24, padding: '3px 7px', borderRadius: 5, background: 'rgba(6,9,14,.9)', border: '1px solid rgba(245,162,10,.45)', color: '#FDE68A', fontSize: 9.5, fontWeight: 800, whiteSpace: 'nowrap', pointerEvents: 'none' }}>
            {Math.round(overlay.w * 100)}% · drag to move
          </span>
          <button
            type="button"
            aria-label={`Resize ${overlay.label}`}
            title="Drag to resize overlay"
            onPointerDown={onResizeDown}
            style={{ position: 'absolute', right: -8, bottom: -8, width: 18, height: 18, padding: 0, borderRadius: 5, cursor: overlay.track.enabled ? 'not-allowed' : 'nwse-resize', background: '#F5A20A', border: '2px solid #06090E', boxShadow: '0 2px 10px rgba(0,0,0,.55)', touchAction: 'none' }}
          />
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Animated text layers
// ---------------------------------------------------------------------------

/** The glow that applies to a layer: its own override, else the global one. */
export function effectiveGlow(layer: TextLayer, global: GlowState): GlowState | null {
  if (layer.glow && layer.glow.enabled) return layer.glow;
  if (global && global.enabled) return global;
  return null;
}

function TextLayerView({
  layer, stageH, playhead, selected, glow, onPick, onMove, onTransformStart,
}: {
  layer: TextLayer;
  stageH: number;
  playhead: number;
  selected: boolean;
  glow: GlowState | null;
  onPick: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onTransformStart: () => void;
}) {
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const transformStartedRef = useRef(false);
  if (playhead < layer.start || playhead > layer.end) return null;
  const duration = Math.max(0.2, layer.end - layer.start);
  const t = playhead - layer.start;
  const a = textAnimState(layer.entrance, layer.exit, t, duration, layer.animDuration);
  const scalePx = stageH / 1080;
  const shown = layer.entrance === 'typewriter'
    ? layer.text.slice(0, Math.max(0, Math.round(layer.text.length * a.typed)))
    : layer.text;

  const baseShadow = layer.shadowBlur > 0
    ? `0 ${Math.round(3 * scalePx)}px ${Math.round(layer.shadowBlur * scalePx)}px ${layer.shadowColor}`
    : '';
  const glowCss = glow ? glowShadow(glow.color, glow.intensity, scalePx) : '';
  const textShadow = [baseShadow, glowCss].filter(Boolean).join(', ') || 'none';
  const rays = glow ? rayLayers(glow, playhead) : [];

  const onDown = (e: ReactPointerEvent) => {
    e.stopPropagation();
    onPick(layer.id);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const host = (e.currentTarget as HTMLElement).parentElement;
    const r = host?.getBoundingClientRect();
    dragRef.current = {
      dx: r ? e.clientX - (r.left + layer.x * r.width) : 0,
      dy: r ? e.clientY - (r.top + layer.y * r.height) : 0,
    };
    transformStartedRef.current = false;
  };
  const onMoveEvt = (e: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const host = (e.currentTarget as HTMLElement).parentElement;
    if (!host) return;
    const r = host.getBoundingClientRect();
    const nextX = clamp01((e.clientX - drag.dx - r.left) / Math.max(1, r.width));
    const nextY = clamp01((e.clientY - drag.dy - r.top) / Math.max(1, r.height));
    if (Math.abs(nextX - layer.x) < 0.0005 && Math.abs(nextY - layer.y) < 0.0005) return;
    if (!transformStartedRef.current) { onTransformStart(); transformStartedRef.current = true; }
    onMove(layer.id, nextX, nextY);
  };
  const onUp = () => { dragRef.current = null; transformStartedRef.current = false; };

  return (
    <div
      onPointerDown={onDown}
      onPointerMove={onMoveEvt}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      style={{
        position: 'absolute',
        left: `${layer.x * 100}%`,
        top: `${layer.y * 100}%`,
        transform: `translate(-50%, -50%) translate(${a.translateX * scalePx + a.glitch}px, ${a.translateY * scalePx}px) scale(${a.scale})`,
        opacity: a.opacity,
        maxWidth: '88%',
        textAlign: layer.align,
        color: layer.color,
        fontFamily: fontCss(layer.fontId),
        fontSize: Math.max(10, layer.size * scalePx),
        fontWeight: layer.weight,
        lineHeight: 1.12,
        WebkitTextStroke: layer.outlineWidth > 0 ? `${Math.max(0.5, layer.outlineWidth * scalePx)}px ${layer.outlineColor}` : undefined,
        paintOrder: 'stroke fill',
        textShadow,
        cursor: 'move',
        whiteSpace: 'pre-wrap',
        outline: selected ? '1.5px dashed rgba(245,158,11,0.95)' : 'none',
        outlineOffset: 4,
        touchAction: 'none',
        userSelect: 'none',
      }}
    >
      {rays.length ? (
        <div style={{ position: 'absolute', left: '50%', top: '50%', width: '340%', height: '340%', transform: 'translate(-50%, -50%)', pointerEvents: 'none' }}>
          <LayerStack keyPrefix={`ray-${layer.id}`} layers={rays} />
        </div>
      ) : null}
      <span style={{ position: 'relative' }}>
        {shown}
        {layer.entrance === 'typewriter' && a.typed < 1 ? <span style={{ opacity: 0.7 }}>|</span> : null}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Captions
// ---------------------------------------------------------------------------

export function CaptionBlock({
  cue, settings, stageH, playhead, interactive, onWordClick,
}: {
  cue: CaptionCue;
  settings: CaptionSettings;
  stageH: number;
  playhead: number;
  interactive?: boolean;
  onWordClick?: (t: number) => void;
}) {
  const baseSpec: CaptionStyleSpec = captionStyle(settings.styleId);
  const spec: CaptionStyleSpec = settings.activeColor
    ? { ...baseSpec, activeColor: settings.activeColor }
    : baseSpec;
  const scalePx = stageH / 1080;
  const size = Math.max(10, spec.sizeRatio * stageH * settings.sizeScale);
  const t = Math.max(0, playhead - cue.start);
  const words = cue.words.length ? cue.words : [{ text: cue.text, start: cue.start, end: cue.end }];
  const fontFamily = fontCss(settings.fontId || spec.fontId);
  const outline = settings.outlineWidth > 0 ? settings.outlineWidth : spec.outlineWidth;
  const design = captionDesign(settings, spec);
  const line = captionLineAnim(settings, t);

  return (
    <div
      style={{
        display: design.fullWidth ? 'block' : 'inline-block',
        width: design.fullWidth ? '100%' : undefined,
        maxWidth: design.fullWidth ? '100%' : '86%',
        textAlign: 'center',
        background: design.background,
        borderRadius: design.radius * (design.radius > 100 ? 1 : scalePx),
        padding: `${design.padY * scalePx}px ${design.padX * scalePx}px`,
        fontFamily,
        fontSize: size,
        fontWeight: spec.weight,
        fontStyle: settings.italic ? 'italic' : 'normal',
        lineHeight: spec.lineHeight,
        letterSpacing: spec.letterSpacing * scalePx,
        textTransform: settings.uppercase || spec.uppercase ? 'uppercase' : 'none',
        opacity: line.opacity,
        transform: `translateY(${line.translateY * scalePx}px) scale(${line.scale})`,
        pointerEvents: interactive ? 'auto' : 'none',
      }}
    >
      {words.map((w, i) => {
        const ws = captionWordPaint(settings, spec, w, cue.start, t, i);
        const gradientStyle: CSSProperties = ws.gradient
          ? { backgroundImage: ws.gradient, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }
          : { color: settings.color && spec.mode === 'plain' && settings.animation === 'preset' ? settings.color : ws.color };
        return (
          <span
            key={`${cue.id}-${i}`}
            onClick={interactive && onWordClick ? () => onWordClick(w.start) : undefined}
            style={{
              display: 'inline-block',
              margin: `0 ${0.14 * size * 0.4}px`,
              transform: `scale(${ws.scale})`,
              opacity: ws.opacity,
              textShadow: ws.gradient ? 'none' : ws.shadow,
              WebkitTextStroke: outline > 0 && !ws.gradient ? `${Math.max(0.5, outline * scalePx)}px ${settings.outlineColor || spec.outlineColor}` : undefined,
              paintOrder: 'stroke fill',
              cursor: interactive ? 'pointer' : 'default',
              ...gradientStyle,
            }}
          >
            {w.text}
          </span>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The stage
// ---------------------------------------------------------------------------

export interface StageSelection {
  overlayId: string | null;
  textId: string | null;
  brollId?: string | null;
}

export default function StudioStage(props: {
  doc: EditDoc;
  activeClip: StudioClip | null;
  playhead: number;
  sourceT: number;
  clipLocalT: number;
  videoRef: { current: HTMLVideoElement | null };
  selection: StageSelection;
  onPickOverlay: (id: string | null) => void;
  onPickText: (id: string | null) => void;
  onMoveOverlay: (id: string, x: number, y: number) => void;
  onResizeOverlay: (id: string, width: number) => void;
  onOverlayTransformStart: () => void;
  onMoveText: (id: string, x: number, y: number) => void;
  onTextTransformStart: () => void;
  onTogglePlay: () => void;
  /** Draw the reframe focus crosshair (shown while the reframe panel is open). */
  showFocus?: boolean;
  /** Needed so b-roll cutaways start and stop with the main transport. */
  isPlaying?: boolean;
  volume?: number;
  previewFit?: 'fit' | 'fill';
  onPickBroll?: (id: string | null) => void;
}) {
  const { doc, activeClip, playhead, sourceT, clipLocalT } = props;
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const scope = useFilterScope();

  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const en of entries) setSize({ w: en.contentRect.width, h: en.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const stageW = size.w || 640;
  const stageH = size.h || Math.round(stageW / aspectRatio(doc.aspect));
  const scalePx = stageH / 1080;
  const totalDuration = Math.max(1, timelineDuration(doc.clips));
  const frame = Math.round(playhead * 30);

  const crop = activeClip ? activeClip.crop : { x: 0, y: 0, w: 1, h: 1 };
  const focus = focusAt(doc.reframe, sourceT);
  const clipEffects = activeClip ? activeClip.effects : [];
  const clipDuration = activeClip ? Math.max(0.3, (activeClip.out - activeClip.in) / Math.max(0.25, activeClip.adjust.speed)) : 1;
  const baseFilter = clipFilterCss(
    activeClip ? activeClip.adjust : {
      brightness: 100,
      contrast: 100,
      saturation: 100,
      highlights: 0,
      shadows: 0,
      temperature: 0,
      tint: 0,
      speed: 1,
      reverse: false,
    },
    doc.grade,
    clipEffects,
  );

  // ---- motion -------------------------------------------------------------
  const motion = clipMotion(activeClip);
  const zoom = zoomCutAt(motion.zoomCut, clipLocalT, clipDuration);
  const shake = shakeAt(motion.shake, clipLocalT);
  const keyframe = activeClip ? keyframeAt(activeClip.keyframes, clipLocalT) : null;

  // ---- VFX ----------------------------------------------------------------
  // Guarded: a project autosaved before the effects system shipped has no vfx
  // or chroma block, and the stage must still draw it.
  const vfx = doc.vfx || defaultVfx();
  const vhs = vhsFrame(vfx.vhs, playhead);
  const glitch = glitchSpec(vfx.glitch, playhead, frame);
  const displace = displaceSpec(vfx.displace, playhead);
  const chromaState = doc.chroma || defaultChroma();
  const chroma = useMemo(() => chromaSpec(chromaState), [chromaState]);

  const chromaId = `vs-ck-${scope}`;
  const displaceId = `vs-dp-${scope}`;
  const glitchId = `vs-gl-${scope}`;

  // The transition belonging to the clip the playhead is inside, while the
  // playhead is still within its window.
  const trans = activeClip?.transitionIn;
  const transP = trans ? clamp01(clipLocalT / Math.max(0.05, trans.duration)) : 1;
  const tState = trans && transP < 1 ? transitionState(trans.id, transP) : null;

  // Filter order matters: key the ORIGINAL pixels first, then distort, then
  // grade. Keying a graded frame would chase the matte every time the
  // creator nudges saturation.
  const filterChain = [
    chroma ? `url(#${chromaId})` : '',
    displace ? `url(#${displaceId})` : '',
    glitch ? `url(#${glitchId})` : '',
    baseFilter === 'none' ? '' : baseFilter,
    vhs.filter,
    zoom.blur > 0.2 ? `blur(${zoom.blur.toFixed(2)}px)` : '',
    tState && tState.filter !== 'none' ? tState.filter : '',
  ].filter(Boolean).join(' ') || 'none';

  const pictureTransform = [
    tState ? tState.transform : '',
    keyframe ? `translate(${(keyframe.x * 100).toFixed(3)}%, ${(keyframe.y * 100).toFixed(3)}%) scale(${keyframe.scale.toFixed(4)})` : '',
    `translate(${(shake.x * scalePx).toFixed(2)}px, ${((shake.y + vhs.translateY) * scalePx).toFixed(2)}px)`,
    `rotate(${shake.rot.toFixed(3)}deg)`,
    `scale(${(zoom.scale * shake.scale).toFixed(4)})`,
  ].filter((s) => s && s !== 'none').join(' ');

  const cue: CaptionCue | null = doc.captions.find((c) => playhead >= c.start && playhead <= c.end) || null;
  const capTop = captionTop(doc.captionSettings.position, doc.captionSettings.offsetY);

  // “Behind subject” only means something when the subject actually has a
  // matte, which today is the chroma key. Without one the layer draws in its
  // normal place rather than silently vanishing.
  const depthReady = Boolean(chroma);
  const behindText = depthReady ? doc.textLayers.filter((l) => l.behindSubject) : [];
  const frontText = depthReady ? doc.textLayers.filter((l) => !l.behindSubject) : doc.textLayers;

  const renderText = (layer: TextLayer) => (
    <TextLayerView
      key={layer.id}
      layer={layer}
      stageH={stageH}
      playhead={playhead}
      selected={props.selection.textId === layer.id}
      glow={effectiveGlow(layer, vfx.textGlow)}
      onPick={props.onPickText}
      onMove={props.onMoveText}
      onTransformStart={props.onTextTransformStart}
    />
  );

  return (
    <div
      ref={boxRef}
      onPointerDown={() => { props.onPickOverlay(null); props.onPickText(null); props.onPickBroll?.(null); }}
      onClick={(event) => { if (event.target === event.currentTarget) props.onTogglePlay(); }}
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: `${aspectRatio(doc.aspect)}`,
        maxHeight: '100%',
        background: '#000',
        overflow: 'hidden',
        borderRadius: 8,
      }}
    >
      {/* Filter definitions. Zero-sized so they never take layout. */}
      <svg width={0} height={0} style={{ position: 'absolute', pointerEvents: 'none' }} aria-hidden="true">
        <defs>
          {chroma ? (
            <filter id={chromaId} colorInterpolationFilters="sRGB">
              <feColorMatrix type="matrix" values={chroma.keyMatrix.join(' ')} result="ckKey" />
              <feComponentTransfer in="ckKey" result="ckMatte">
                <feFuncA type="linear" slope={chroma.slope} intercept={chroma.intercept} />
              </feComponentTransfer>
              {chroma.spillOn ? (
                <feColorMatrix in="ckMatte" type="matrix" values={chroma.spillMatrix.join(' ')} />
              ) : null}
            </filter>
          ) : null}

          {displace ? (
            <filter id={displaceId} x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
              <feTurbulence
                type={displace.type as 'turbulence' | 'fractalNoise'}
                baseFrequency={displace.baseFrequency}
                numOctaves={displace.octaves}
                seed={displace.seed}
                stitchTiles="stitch"
                result="dpNoise"
              />
              <feOffset in="dpNoise" dx={displace.dx} dy={displace.dy} result="dpMoved" />
              <feDisplacementMap in="SourceGraphic" in2="dpMoved" scale={displace.scale} xChannelSelector="R" yChannelSelector="G" />
            </filter>
          ) : null}

          {glitch ? (
            /* A near-zero X frequency with a high Y frequency makes the noise
               constant across each row, so the displacement map tears the
               picture into horizontal slices that each slide by a different
               amount. The R/B offsets add the chromatic split. */
            <filter id={glitchId} x="-12%" y="0%" width="124%" height="100%" colorInterpolationFilters="sRGB">
              <feTurbulence type="fractalNoise" baseFrequency="0.00001 0.24" numOctaves={1} seed={glitch.seed} result="glNoise" />
              <feComponentTransfer in="glNoise" result="glRows">
                <feFuncG type="table" tableValues="0.5 0.5" />
              </feComponentTransfer>
              <feDisplacementMap in="SourceGraphic" in2="glRows" scale={glitch.scale} xChannelSelector="R" yChannelSelector="G" result="glTorn" />
              <feColorMatrix in="glTorn" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="glRed" />
              <feOffset in="glRed" dx={glitch.split} result="glRedShift" />
              <feColorMatrix in="glTorn" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0" result="glCyan" />
              <feOffset in="glCyan" dx={-glitch.split} result="glCyanShift" />
              <feBlend in="glRedShift" in2="glCyanShift" mode="screen" />
            </filter>
          ) : null}
        </defs>
      </svg>

      {/* Chroma background plate — what shows through the removed screen. */}
      {chroma ? (
        <div
          style={{
            position: 'absolute', inset: 0,
            background: chromaState.background === 'image' && chromaState.backgroundUrl
              ? `center / cover no-repeat url(${JSON.stringify(chromaState.backgroundUrl)})`
              : chromaState.backgroundColor,
          }}
        />
      ) : null}

      {/* Depth compositing: text that sits behind the keyed subject. */}
      {behindText.map(renderText)}

      {/* Picture: the crop window is implemented by oversizing and offsetting
          the element inside an overflow-hidden box, then cover-fitting with
          the reframe focus as the object position. */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        {/* No crossOrigin attribute on purpose: the effects are SVG filters,
            which never read the frame back out, so demanding CORS headers
            from the storage bucket would only risk breaking playback. */}
        <video
          ref={props.videoRef}
          playsInline
          style={{
            pointerEvents: 'none',
            position: 'absolute',
            width: `${100 / Math.max(0.05, crop.w)}%`,
            height: `${100 / Math.max(0.05, crop.h)}%`,
            left: `${(-crop.x * 100) / Math.max(0.05, crop.w)}%`,
            top: `${(-crop.y * 100) / Math.max(0.05, crop.h)}%`,
            objectFit: props.previewFit === 'fit' ? 'contain' : 'cover',
            objectPosition: focusObjectPosition(focus),
            filter: filterChain,
            opacity: (activeClip ? activeClip.opacity : 1) * (keyframe ? keyframe.opacity : 1) * (tState ? tState.opacity : 1),
            transform: pictureTransform || undefined,
            cursor: 'pointer',
          }}
        />
      </div>

      <EffectOverlays ids={doc.globalEffects} t={playhead} duration={totalDuration} />
      <EffectOverlays ids={clipEffects} t={clipLocalT} duration={clipDuration} />
      <LayerStack keyPrefix="leak" layers={leakLayers(vfx.leak, playhead, totalDuration)} />
      <LayerStack keyPrefix="vhs" layers={vhsLayers(vfx.vhs, playhead)} />

      {(doc.videoOverlays || []).map((o) => (
        <BrollOverlayLayer
          key={o.id}
          overlay={o}
          playhead={playhead}
          isPlaying={props.isPlaying === true}
          volume={props.volume == null ? 1 : props.volume}
          selected={props.selection.brollId === o.id}
          onPick={(id) => props.onPickBroll?.(id)}
        />
      ))}

      {doc.overlays.map((o) => (
        <OverlayLayer
          key={o.id}
          overlay={o}
          stageW={stageW}
          stageH={stageH}
          playhead={playhead}
          selected={props.selection.overlayId === o.id}
          onPick={props.onPickOverlay}
          onMove={props.onMoveOverlay}
          onResize={props.onResizeOverlay}
          onTransformStart={props.onOverlayTransformStart}
        />
      ))}

      {frontText.map(renderText)}

      {cue ? (
        <div
          style={{
            position: 'absolute', left: 0, right: 0, top: `${capTop * 100}%`,
            display: 'flex', justifyContent: 'center', transform: 'translateY(-50%)',
            pointerEvents: 'none', padding: '0 5%',
          }}
        >
          <CaptionBlock cue={cue} settings={doc.captionSettings} stageH={stageH} playhead={playhead} />
        </div>
      ) : null}

      {tState?.overlay ? (
        <div
          style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background: tState.overlay.background,
            opacity: tState.overlay.opacity,
            mixBlendMode: tState.overlay.blend as CSSProperties['mixBlendMode'],
          }}
        />
      ) : null}

      {props.showFocus ? (
        <div
          title="Auto-reframe focus"
          style={{
            position: 'absolute', left: `${focus.x * 100}%`, top: `${focus.y * 100}%`,
            width: 34, height: 34, marginLeft: -17, marginTop: -17, borderRadius: '50%',
            border: '2px solid rgba(245,158,11,0.95)', boxShadow: '0 0 0 1px rgba(0,0,0,0.5), 0 0 18px rgba(245,158,11,0.5)',
            pointerEvents: 'none',
          }}
        />
      ) : null}
    </div>
  );
}
