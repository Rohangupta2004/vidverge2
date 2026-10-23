/**
 * Shared Remotion scene components.
 *
 * These are the pieces every generated scene is assembled from, so a model
 * writing a scene composes `<Title/>`, `<Caption/>`, `<Chart/>` rather than
 * re-inventing layout and easing each time. That keeps generated TSX small,
 * compilable, and on-brand.
 *
 * `KIT_SOURCE` at the bottom is the same code as a string. `vv-render-job`
 * prepends it to generated scene TSX, because the render service compiles one
 * self-contained file and cannot resolve a workspace import.
 */

import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export type Aspect = '9:16' | '16:9' | '1:1';

export const BRAND = {
  gold: '#E8B646',
  goldSoft: '#F3D389',
  ink: '#0A0A0B',
  inkSoft: '#141417',
  line: 'rgba(232,182,70,0.22)',
  text: '#F6F5F2',
  textMuted: 'rgba(246,245,242,0.64)',
  display: '"Inter", "Helvetica Neue", Arial, sans-serif',
} as const;

/** Safe area as a fraction of the stage. Nothing readable goes outside it. */
export const SAFE = { x: 0.08, y: 0.1 } as const;

export const STAGE: Record<Aspect, { width: number; height: number }> = {
  '9:16': { width: 1080, height: 1920 },
  '16:9': { width: 1920, height: 1080 },
  '1:1': { width: 1080, height: 1080 },
};

/** Ease a value in over `frames`, held at 1 afterwards. */
export function useEnter(delay = 0, frames = 18): number {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: Math.max(0, frame - delay), fps, config: { damping: 200, stiffness: 120 }, durationInFrames: frames });
}

/**
 * Root for every scene. Lays out at the aspect's true pixel size and scales
 * that stage into the fixed 1920x1080 render frame, so one composition is
 * correct at 9:16, 16:9 and 1:1 without rewriting any layout.
 */
export const Stage: React.FC<{ aspect?: Aspect; background?: string; children?: React.ReactNode }> = ({
  aspect = '9:16',
  background = BRAND.ink,
  children,
}) => {
  const stage = STAGE[aspect] || STAGE['9:16'];
  const scale = Math.min(1920 / stage.width, 1080 / stage.height);
  return (
    <AbsoluteFill style={{ background: BRAND.ink }}>
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: stage.width,
          height: stage.height,
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: 'center center',
          overflow: 'hidden',
          background,
          fontFamily: BRAND.display,
          color: BRAND.text,
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
};

/** The light-beam motif, used for loaders, progress and empty states. */
export const LightBeam: React.FC<{ delay?: number; height?: number; width?: string }> = ({ delay = 0, height = 3, width = '62%' }) => {
  const t = useEnter(delay, 26);
  return (
    <div style={{ width, height, borderRadius: height, overflow: 'hidden', background: 'rgba(255,255,255,0.06)' }}>
      <div
        style={{
          height: '100%',
          width: `${Math.round(t * 100)}%`,
          background: `linear-gradient(90deg, transparent, ${BRAND.gold} 40%, ${BRAND.goldSoft} 70%, transparent)`,
          boxShadow: `0 0 24px ${BRAND.gold}`,
        }}
      />
    </div>
  );
};

export const Title: React.FC<{ text: string; kicker?: string; delay?: number; align?: 'left' | 'center'; size?: number }> = ({
  text,
  kicker,
  delay = 0,
  align = 'left',
  size = 96,
}) => {
  const t = useEnter(delay);
  return (
    <div
      style={{
        position: 'absolute',
        left: `${SAFE.x * 100}%`,
        right: `${SAFE.x * 100}%`,
        top: `${SAFE.y * 100}%`,
        textAlign: align,
        opacity: t,
        transform: `translateY(${(1 - t) * 28}px)`,
      }}
    >
      {kicker ? (
        <div style={{ color: BRAND.gold, fontSize: size * 0.26, letterSpacing: 4, textTransform: 'uppercase', marginBottom: 18, fontWeight: 600 }}>
          {kicker}
        </div>
      ) : null}
      <div style={{ fontSize: size, lineHeight: 1.05, fontWeight: 700, letterSpacing: -2 }}>{text}</div>
      <div style={{ marginTop: 28 }}>
        <LightBeam delay={delay + 6} />
      </div>
    </div>
  );
};

export const LowerThird: React.FC<{ name: string; role?: string; delay?: number }> = ({ name, role, delay = 0 }) => {
  const t = useEnter(delay);
  return (
    <div
      style={{
        position: 'absolute',
        left: `${SAFE.x * 100}%`,
        bottom: `${SAFE.y * 100}%`,
        padding: '20px 30px',
        background: 'rgba(10,10,11,0.82)',
        borderLeft: `4px solid ${BRAND.gold}`,
        borderRadius: 8,
        opacity: t,
        transform: `translateX(${(1 - t) * -40}px)`,
      }}
    >
      <div style={{ fontSize: 40, fontWeight: 700 }}>{name}</div>
      {role ? <div style={{ fontSize: 26, color: BRAND.textMuted, marginTop: 6 }}>{role}</div> : null}
    </div>
  );
};

/**
 * Word-group caption. Two to three words a line is the readable default on a
 * phone; `emphasis` words are picked out in brand gold.
 */
export const Caption: React.FC<{ text: string; emphasis?: string[]; delay?: number; bottom?: number }> = ({
  text,
  emphasis = [],
  delay = 0,
  bottom = 0.22,
}) => {
  const t = useEnter(delay, 10);
  const hot = new Set(emphasis.map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, '')));
  return (
    <div
      style={{
        position: 'absolute',
        left: `${SAFE.x * 100}%`,
        right: `${SAFE.x * 100}%`,
        bottom: `${bottom * 100}%`,
        textAlign: 'center',
        fontSize: 64,
        fontWeight: 800,
        lineHeight: 1.15,
        textShadow: '0 4px 24px rgba(0,0,0,0.85)',
        opacity: t,
        transform: `scale(${0.94 + t * 0.06})`,
      }}
    >
      {text.split(/\s+/).map((word, i) => (
        <span key={i} style={{ color: hot.has(word.toLowerCase().replace(/[^a-z0-9]/g, '')) ? BRAND.gold : BRAND.text, marginRight: 14 }}>
          {word}
        </span>
      ))}
    </div>
  );
};

export const Counter: React.FC<{ to: number; label?: string; prefix?: string; suffix?: string; delay?: number }> = ({
  to,
  label,
  prefix = '',
  suffix = '',
  delay = 0,
}) => {
  const t = useEnter(delay, 34);
  const value = Math.round(to * t);
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontSize: 200, fontWeight: 800, color: BRAND.gold, letterSpacing: -6 }}>
        {prefix}
        {value.toLocaleString()}
        {suffix}
      </div>
      {label ? <div style={{ fontSize: 38, color: BRAND.textMuted, marginTop: 10 }}>{label}</div> : null}
    </div>
  );
};

export const Chart: React.FC<{ data: { label: string; value: number }[]; delay?: number; height?: number }> = ({
  data,
  delay = 0,
  height = 520,
}) => {
  const t = useEnter(delay, 30);
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div
      style={{
        position: 'absolute',
        left: `${SAFE.x * 100}%`,
        right: `${SAFE.x * 100}%`,
        top: '50%',
        transform: 'translateY(-50%)',
        height,
        display: 'flex',
        alignItems: 'flex-end',
        gap: 26,
      }}
    >
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, textAlign: 'center' }}>
          <div
            style={{
              height: Math.max(6, (d.value / max) * (height - 90) * t),
              borderRadius: 10,
              background: `linear-gradient(180deg, ${BRAND.goldSoft}, ${BRAND.gold})`,
              boxShadow: `0 0 34px ${BRAND.line}`,
            }}
          />
          <div style={{ marginTop: 16, fontSize: 28, color: BRAND.textMuted }}>{d.label}</div>
        </div>
      ))}
    </div>
  );
};

/**
 * Phone or laptop shell around a real product screenshot.
 *
 * Product UI is always a real screenshot in a mockup — never text a video
 * model was asked to draw, which it cannot spell.
 */
export const DeviceMockup: React.FC<{
  src: string;
  device?: 'phone' | 'laptop';
  delay?: number;
  zoom?: number;
  pan?: { x: number; y: number };
}> = ({ src, device = 'phone', delay = 0, zoom = 1.06, pan = { x: 0, y: 0 } }) => {
  const t = useEnter(delay, 30);
  const frame = useCurrentFrame();
  const drift = interpolate(frame, [0, 240], [0, 1], { extrapolateRight: 'clamp' });
  const isPhone = device === 'phone';
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: t,
      }}
    >
      <div
        style={{
          width: isPhone ? 620 : 1340,
          height: isPhone ? 1280 : 840,
          borderRadius: isPhone ? 64 : 22,
          padding: isPhone ? 18 : 16,
          background: BRAND.inkSoft,
          border: `2px solid ${BRAND.line}`,
          boxShadow: '0 60px 140px rgba(0,0,0,0.65)',
          overflow: 'hidden',
          transform: `scale(${0.96 + t * 0.04})`,
        }}
      >
        <div style={{ width: '100%', height: '100%', borderRadius: isPhone ? 48 : 10, overflow: 'hidden', background: '#000' }}>
          <img
            src={src}
            alt=""
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              objectPosition: 'top center',
              transform: `scale(${1 + (zoom - 1) * drift}) translate(${pan.x * drift}%, ${pan.y * drift}%)`,
            }}
          />
        </div>
      </div>
    </div>
  );
};

/** Cross-fade / dip-to-black between two beats inside one composition. */
export const Transition: React.FC<{ at: number; frames?: number; kind?: 'fade' | 'dip' }> = ({ at, frames = 12, kind = 'fade' }) => {
  const frame = useCurrentFrame();
  const half = frames / 2;
  const opacity = interpolate(frame, [at - half, at, at + half], [0, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill
      style={{ background: kind === 'dip' ? '#000' : BRAND.ink, opacity, pointerEvents: 'none' }}
    />
  );
};
