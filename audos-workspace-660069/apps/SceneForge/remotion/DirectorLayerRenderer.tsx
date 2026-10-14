import React from 'react';
import { AbsoluteFill, Img, interpolate, useCurrentFrame } from 'remotion';
import type { DirectedLayer, SceneDirection } from '../lib/visualTimeline';

const W = 1920;
const H = 1080;

function zoneRect(zone: string): { x: number; y: number; w: number; h: number } {
  if (zone === 'top') return { x: 0.1, y: 0.06, w: 0.8, h: 0.18 };
  if (zone === 'upper') return { x: 0.12, y: 0.2, w: 0.76, h: 0.2 };
  if (zone === 'lower') return { x: 0.1, y: 0.62, w: 0.8, h: 0.22 };
  if (zone === 'bottom_safe') return { x: 0.08, y: 0.78, w: 0.84, h: 0.14 };
  if (zone === 'left') return { x: 0.04, y: 0.28, w: 0.42, h: 0.44 };
  if (zone === 'right') return { x: 0.54, y: 0.28, w: 0.42, h: 0.44 };
  if (zone === 'full') return { x: 0.05, y: 0.08, w: 0.9, h: 0.84 };
  return { x: 0.15, y: 0.22, w: 0.7, h: 0.56 };
}

function layerOpacity(layer: DirectedLayer, tSec: number): number {
  const start = layer.entrance?.at ?? 0;
  const inDur = 0.45;
  const end = layer.exit?.at ?? 999;
  if (tSec < start) return 0;
  const inP = Math.min(1, (tSec - start) / inDur);
  const outP = tSec > end ? Math.max(0, 1 - (tSec - end) / 0.35) : 1;
  return inP * outP;
}

export interface DirectorLayerRendererProps {
  layer: DirectedLayer;
  frame: number;
  fps: number;
  camera?: SceneDirection['camera'];
  durationSec: number;
}

/** Remotion-side renderer for one Motion Director layer (video_backed_graphic compositor). */
export function DirectorLayerRenderer({ layer, frame, fps, camera, durationSec }: DirectorLayerRendererProps) {
  const tSec = frame / fps;
  const opacity = layerOpacity(layer, tSec);
  if (opacity <= 0.01) return null;
  const depth = typeof (layer as DirectedLayer & { depth_z?: number }).depth_z === 'number'
    ? Math.min(1, Math.max(0, (layer as DirectedLayer & { depth_z?: number }).depth_z!))
    : 0.5;
  const cam = camera || { move: 'none' as const, intensity: 1 };
  const p = durationSec > 0 ? Math.min(1, tSec / durationSec) : 0;
  let camX = 0;
  let camY = 0;
  let camScale = 1;
  const k = Math.min(1.5, Math.max(0.25, cam.intensity ?? 1));
  const speed = 0.2 + 0.8 * (1 - depth);
  if (cam.move === 'push_in') camScale = 1 + 0.08 * speed * k * p;
  else if (cam.move === 'pull_back') camScale = 1 + 0.08 * speed * k * (1 - p);
  else if (cam.move === 'drift_left' || cam.move === 'drift_right') {
    const sign = cam.move === 'drift_left' ? -1 : 1;
    camX = sign * 0.04 * speed * k * (p - 0.5) * 2 * W;
  }
  const zOffset = depth * -300;
  const parallaxX = camX;
  const parallaxY = camY;
  const rect = zoneRect(layer.zone);
  const content = layer.content || {};
  const text = String(content.text || content.leftTitle || '').trim();
  const sub = String(content.subtext || '').trim();
  const imageUrl = content.imageUrl;
  const isMetric = layer.type === 'Metric' || layer.type === 'Chart';
  const style: React.CSSProperties = {
    position: 'absolute',
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.w * 100}%`,
    minHeight: `${rect.h * 20}%`,
    opacity,
    zIndex: layer.zIndex,
    transform: `translateX(${parallaxX}px) translateY(${parallaxY}px) translateZ(${zOffset}px) scale(${camScale})`,
    transformStyle: 'preserve-3d',
    fontFamily: "'Inter', system-ui, sans-serif",
    color: '#fff',
    pointerEvents: 'none',
  };
  if (imageUrl && (layer.type === 'ImageCard' || layer.type === 'ProductUI')) {
    return (
      <div style={style}>
        <Img src={imageUrl} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 16 }} />
      </div>
    );
  }
  if (isMetric && content.value != null) {
    return (
      <div style={{ ...style, textAlign: 'center' }}>
        <div style={{ fontSize: 72, fontWeight: 900, lineHeight: 1 }}>{content.prefix || ''}{content.value}{content.suffix || ''}</div>
        {text ? <div style={{ marginTop: 12, fontSize: 28, fontWeight: 600 }}>{text}</div> : null}
      </div>
    );
  }
  if (!text && !sub) return null;
  const headlineSize = layer.type === 'KineticHeadline' ? 64 : 42;
  const wipe = layer.type === 'KineticHeadline'
    ? interpolate(frame, [Math.round((layer.entrance?.at ?? 0) * fps), Math.round(((layer.entrance?.at ?? 0) + 0.35) * fps)], [0, 100], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    : 100;
  return (
    <div style={style}>
      <div style={{ clipPath: `inset(0 0 ${100 - wipe}% 0)` }}>
        <div style={{ fontSize: headlineSize, fontWeight: 800, lineHeight: 1.1, textShadow: '0 4px 24px rgba(0,0,0,0.75)' }}>{text}</div>
        {sub ? <div style={{ marginTop: 10, fontSize: 26, fontWeight: 500, opacity: 0.92 }}>{sub}</div> : null}
      </div>
    </div>
  );
}

export function VideoBackedGraphicStack({
  backgroundUrl,
  layers,
  camera,
  durationSec,
  fps = 30,
}: {
  backgroundUrl: string;
  layers: DirectedLayer[];
  camera?: SceneDirection['camera'];
  durationSec: number;
  fps?: number;
}) {
  const frame = useCurrentFrame();
  const p = durationSec > 0 ? Math.min(1, frame / fps / durationSec) : 0;
  const bgScale = 1 + 0.02 * p;
  const sorted = [...layers].sort((a, b) => (a.depth_z ?? 0.5) - (b.depth_z ?? 0.5));
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: `scale(${bgScale})`, transformOrigin: 'center' }}>
        <video src={backgroundUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted playsInline />
      </AbsoluteFill>
      <AbsoluteFill style={{ perspective: '1200px', transformStyle: 'preserve-3d' }}>
        {sorted.map((layer) => (
          <DirectorLayerRenderer key={layer.id} layer={layer} frame={frame} fps={fps} camera={camera} durationSec={durationSec} />
        ))}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
