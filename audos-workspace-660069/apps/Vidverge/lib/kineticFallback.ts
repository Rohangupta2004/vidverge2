/**
 * THE DETERMINISTIC KINETIC COMPOSITION.
 *
 * Pipeline A asks Claude to engineer the motion. When what comes back does not
 * pass the audit — truncated output, an import the render farm cannot resolve,
 * no default export — this composition renders instead. It obeys the same
 * 3-Object Rule and reads the same props, so the customer gets a real branded
 * reel rather than an error, and the only thing lost is the bespoke choreography.
 *
 * It is written as source text for the same reason as every other composition
 * here: the render service compiles one standalone string and cannot import
 * from this workspace.
 */

export const KINETIC_FALLBACK_SOURCE = String.raw`
import React from 'react';
import { AbsoluteFill, Audio, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

const STAGE_W = 1080;
const STAGE_H = 1920;

const Particles = ({ accent }: { accent: string }) => {
  const frame = useCurrentFrame();
  const dots = [];
  for (let i = 0; i < 28; i += 1) {
    const column = i % 7;
    const row = Math.floor(i / 7);
    const drift = Math.sin((frame + i * 11) / 34) * 14;
    dots.push(
      <div
        key={i}
        style={{
          position: 'absolute',
          left: 90 + column * 150,
          top: 240 + row * 380 + drift,
          width: 5,
          height: 5,
          borderRadius: 999,
          background: accent,
          opacity: 0.16 + (i % 4) * 0.05,
        }}
      />,
    );
  }
  return <AbsoluteFill>{dots}</AbsoluteFill>;
};

const Badge = ({ label, side, accent, delay }: any) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - delay, fps, config: { damping: 12, mass: 0.5 } });
  const offset = interpolate(enter, [0, 1], [side === 'left' ? -160 : 160, 0]);
  return (
    <div
      style={{
        position: 'absolute',
        top: 1180,
        left: side === 'left' ? 90 : undefined,
        right: side === 'right' ? 90 : undefined,
        transform: 'translateX(' + offset + 'px)',
        opacity: enter,
        padding: '18px 30px',
        borderRadius: 18,
        border: '1px solid ' + accent + '55',
        background: 'rgba(255,255,255,0.04)',
        color: '#f5f5f7',
        fontSize: 32,
        fontWeight: 600,
        letterSpacing: '-0.01em',
        maxWidth: 380,
      }}
    >
      {label}
    </div>
  );
};

const Hero = ({ brand, accent }: any) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - 6, fps, config: { damping: 12, mass: 0.5 } });
  const scale = interpolate(enter, [0, 1], [0.82, 1]);
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 420,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 34,
        padding: '0 96px',
        transform: 'scale(' + scale * 0.7 + ')',
        transformOrigin: 'center top',
        opacity: enter,
      }}
    >
      {brand.logoUrl ? (
        <Img src={brand.logoUrl} style={{ maxWidth: 420, maxHeight: 160, objectFit: 'contain' }} />
      ) : null}
      <div
        style={{
          color: '#ffffff',
          fontSize: 108,
          lineHeight: 1.04,
          fontWeight: 800,
          textAlign: 'center',
          letterSpacing: '-0.035em',
        }}
      >
        {brand.headline || brand.name}
      </div>
      <div style={{ color: accent, fontSize: 44, fontWeight: 600, textAlign: 'center' }}>
        {brand.subheadline || ''}
      </div>
    </div>
  );
};

const Subtitles = ({ words, accent }: any) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const nowMs = (frame / fps) * 1000;
  const windowStart = Math.max(0, nowMs - 1400);
  const visible = words.filter((w: any) => w.end_ms >= windowStart && w.start_ms <= nowMs + 900).slice(0, 10);
  return (
    <div
      style={{
        position: 'absolute',
        left: 90,
        right: 90,
        bottom: 240,
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: '12px 16px',
      }}
    >
      {visible.map((w: any, index: number) => {
        const active = nowMs >= w.start_ms && nowMs <= w.end_ms;
        return (
          <span
            key={String(w.start_ms) + '-' + index}
            style={{
              display: 'inline-block',
              transform: active ? 'scale(1.1)' : 'scale(1)',
              color: active ? accent : '#e9e9f2',
              fontSize: 52,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              transition: 'none',
            }}
          >
            {w.word}
          </span>
        );
      })}
    </div>
  );
};

export default function KineticReel(props: any) {
  const brand = props.brand || {};
  const colors = Array.isArray(brand.colors) && brand.colors.length ? brand.colors : ['#D4920A', '#F0B429'];
  const accent = colors[0];
  const deep = colors[colors.length - 1] || '#0D0B05';
  const words = Array.isArray(props.words) ? props.words : [];
  const badges = Array.isArray(props.badges) && props.badges.length >= 2 ? props.badges : ['Built for speed', 'Zero setup'];
  const scale = Math.min(props.frame_width / STAGE_W, props.frame_height / STAGE_H);

  return (
    <AbsoluteFill style={{ backgroundColor: '#0D0B05', alignItems: 'center', justifyContent: 'center' }}>
      <div
        style={{
          width: STAGE_W,
          height: STAGE_H,
          transform: 'scale(' + scale + ')',
          position: 'relative',
          overflow: 'hidden',
          backgroundColor: deep,
          borderLeft: '1px solid rgba(255,255,255,0.06)',
          borderRight: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <Particles accent={accent} />
        <Hero brand={brand} accent={accent} />
        <Badge label={badges[0]} side="left" accent={accent} delay={16} />
        <Badge label={badges[1]} side="right" accent={accent} delay={24} />
        <Subtitles words={words} accent={accent} />
      </div>
      {props.voiceover_url ? <Audio src={props.voiceover_url} volume={1} /> : null}
    </AbsoluteFill>
  );
}
`;
