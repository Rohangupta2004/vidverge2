/**
 * Remotion Studio — PRO MOTION-DESIGN compositions (Product Video 3D).
 *
 * THE MOTION SKILL: `MOTION_SKILL_TSX` is a reusable kinetic library — animated
 * gradient fields with drifting glow blobs, a slow-scrolling grid, orbiting
 * particles, word-by-word kinetic typography, glass feature cards with 3D
 * entrances, a light-sweep browser mockup and a pulsing CTA — embedded into
 * BOTH compositions below, so every video is a scene-based motion-design
 * piece, never a static title card. Modern-SaaS rules baked in: motion and
 * type carry the video; every scene animates continuously; all timing derives
 * from the composition duration (zero hardcoded frame numbers).
 *
 * Sources are submitted VERBATIM to the platform render service via the
 * pv-render-composition server function; everything variable travels in
 * `props`. Only Remotion core primitives (interpolate / interpolateColors /
 * spring-equivalent easings / useCurrentFrame / useVideoConfig / Sequence /
 * AbsoluteFill / Audio / Img) + CSS keyframes — no GSAP, no framer-motion.
 *
 * GEOMETRY: the render service is locked to 30fps 1920x1080; Story Mode
 * renders a centered 608px vertical stage inside that canvas.
 */

export const PV_FPS = 30;

export const PV_LENGTHS = [15, 30, 45, 60] as const;

export const PV_TONES = ['Bold', 'Playful', 'Professional', 'Cinematic', 'Minimal'] as const;

/** Workspace-cached ElevenLabs beds (durable pv_music_tracks URLs). */
export const PV_MUSIC_BEDS = [
  { id: 'inspiring', label: 'Inspiring', url: 'https://storage.googleapis.com/audos-images/workspaces/f24710e5-7c6d-4db4-92b4-c2c235877575/audio/background-music-1790352381300.mp3' },
  { id: 'cinematic-dark', label: 'Cinematic Dark', url: 'https://storage.googleapis.com/audos-images/workspaces/f24710e5-7c6d-4db4-92b4-c2c235877575/audio/background-music-1790352397219.mp3' },
  { id: 'energetic', label: 'Energetic', url: 'https://storage.googleapis.com/audos-images/workspaces/f24710e5-7c6d-4db4-92b4-c2c235877575/audio/background-music-1790352412992.mp3' },
  { id: 'calm', label: 'Calm', url: 'https://storage.googleapis.com/audos-images/workspaces/f24710e5-7c6d-4db4-92b4-c2c235877575/audio/background-music-1790352426863.mp3' },
  { id: 'luxury', label: 'Luxury', url: 'https://storage.googleapis.com/audos-images/workspaces/f24710e5-7c6d-4db4-92b4-c2c235877575/audio/background-music-1790352446075.mp3' },
] as const;

export interface PvCompositionProps {
  productName: string;
  tagline: string;
  features: string[];
  audience: string;
  tone: string;
  accent: string;
  bgFrom: string;
  bgTo: string;
  screenshotUrl: string;
  characterUrl: string;
  backgroundUrl: string;
  voiceoverUrl: string;
  musicUrl: string;
  musicVolume: number;
}

// ---------------------------------------------------------------------------
// THE MOTION SKILL — shared kinetic library (embedded into both templates).
// No backticks / template interpolation inside: it ships as-is to the render.
// ---------------------------------------------------------------------------

const MOTION_SKILL_TSX = `
import React from 'react';
import { AbsoluteFill, Audio, Img, interpolate, interpolateColors, useCurrentFrame, useVideoConfig } from 'remotion';

const SANS = 'Inter, system-ui, -apple-system, sans-serif';
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const back = (t) => { const c1 = 1.70158; const c3 = c1 + 1; const x = clamp01(t) - 1; return 1 + c3 * x * x * x + c1 * x * x; };
const cubic = (t) => 1 - Math.pow(1 - clamp01(t), 3);
const expo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp01(t)));
const alpha = (hex, aa) => hex + aa; // #rrggbb + '33'

// Scene wrapper: cinematic enter (rise + fade) and exit (fade + drift).
function SceneShell({ local, len, fps, children }) {
  const enter = expo(local / (0.5 * fps));
  const exit = clamp01((len - local) / (0.35 * fps));
  return (
    <AbsoluteFill style={{ opacity: Math.min(enter, exit), transform: 'translateY(' + ((1 - enter) * 46 - (1 - exit) * 24) + 'px)' }}>
      {children}
    </AbsoluteFill>
  );
}

// Living background: color drift + two floating glow blobs + scrolling grid + vignette.
function MotionBg({ frame, total, from, to, accent }) {
  const base = interpolateColors(frame, [0, Math.max(1, total)], [from, to]);
  const x1 = Math.sin(frame / 47) * 12; const y1 = Math.cos(frame / 61) * 9;
  const x2 = Math.cos(frame / 53) * 14; const y2 = Math.sin(frame / 41) * 11;
  return (
    <AbsoluteFill style={{ backgroundColor: base }}>
      <div style={{ position: 'absolute', left: (14 + x1) + '%', top: (8 + y1) + '%', width: '52%', height: '52%', borderRadius: '50%', background: 'radial-gradient(circle, ' + alpha(accent, '30') + ' 0%, transparent 62%)', filter: 'blur(36px)' }} />
      <div style={{ position: 'absolute', right: (8 + x2) + '%', bottom: (4 + y2) + '%', width: '46%', height: '46%', borderRadius: '50%', background: 'radial-gradient(circle, rgba(59,130,246,0.16) 0%, transparent 62%)', filter: 'blur(44px)' }} />
      <AbsoluteFill style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)', backgroundSize: '72px 72px', backgroundPosition: '0px ' + (-(frame * 0.22) % 72) + 'px', opacity: 0.55 }} />
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at center, transparent 52%, rgba(0,0,0,0.6) 100%)' }} />
    </AbsoluteFill>
  );
}

// Orbiting accent particles (CTA moments).
function Orbits({ frame, accent, rx, ry }) {
  const dots = [0, 1, 2, 3, 4, 5];
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {dots.map((i) => {
        const a = frame / 40 + (i * Math.PI) / 3;
        return <div key={i} style={{ position: 'absolute', left: 'calc(50% + ' + Math.cos(a) * rx + 'px)', top: 'calc(50% + ' + Math.sin(a) * ry + 'px)', width: 7 - (i % 3), height: 7 - (i % 3), borderRadius: 99, background: i % 2 ? accent : '#ffffff', opacity: 0.5 + 0.4 * Math.sin(a * 2), boxShadow: '0 0 12px ' + accent }} />;
      })}
    </div>
  );
}

// Word-by-word kinetic typography — overshoot pop, rise, alternate tilt.
function Kinetic({ text, local, size, accent, every, weight, upper }) {
  const words = String(text || '').split(/\\s+/).filter(Boolean).slice(0, 16);
  return (
    <div style={{ textAlign: 'center' }}>
      {words.map((w, i) => {
        const p = clamp01((local - i * 4) / 11);
        return (
          <span key={i} style={{ display: 'inline-block', margin: '0 ' + Math.round(size * 0.14) + 'px', color: (i + 1) % (every || 3) === 0 ? accent : '#ffffff', fontSize: size, fontWeight: weight || 900, letterSpacing: -size * 0.03, textTransform: upper ? 'uppercase' : 'none', opacity: p, transform: 'scale(' + (0.35 + back(p) * 0.65) + ') translateY(' + (1 - cubic(p)) * size * 0.5 + 'px) rotate(' + (1 - p) * (i % 2 ? 3.5 : -3.5) + 'deg)', textShadow: '0 8px 40px rgba(0,0,0,0.75)' }}>
            {w}
          </span>
        );
      })}
    </div>
  );
}

// Eyebrow pill (INTRODUCING / WHY IT WINS / ...).
function Eyebrow({ label, local, fps, accent }) {
  const p = back(clamp01(local / (0.4 * fps)));
  return (
    <div style={{ display: 'inline-block', opacity: clamp01(p * 2), transform: 'translateY(' + (1 - p) * -34 + 'px)', border: '1px solid ' + alpha(accent, '66'), background: alpha(accent, '1f'), color: accent, borderRadius: 999, padding: '8px 26px', fontSize: 22, fontWeight: 800, letterSpacing: 5, textTransform: 'uppercase' }}>
      {label}
    </div>
  );
}

// Glass feature card with 3D entrance + breathing glow + growing accent bar.
function FeatureCard({ text, local, fps, index, accent, width, size }) {
  const p = back(clamp01((local - index * 9) / (0.55 * fps)));
  const bar = cubic(clamp01((local - index * 9 - 6) / 14));
  const breathe = 0.5 + 0.5 * Math.sin(local / 17 + index * 1.4);
  return (
    <div style={{ width: width, opacity: clamp01(p * 1.6), transform: 'perspective(900px) translateY(' + (1 - p) * 110 + 'px) rotateX(' + (1 - p) * 22 + 'deg)', background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 20, padding: Math.round(size * 0.8) + 'px ' + Math.round(size * 0.9) + 'px', boxShadow: '0 24px 60px rgba(0,0,0,0.45), 0 0 ' + Math.round(14 + breathe * 22) + 'px ' + alpha(accent, '24'), backdropFilter: 'blur(8px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(size * 0.55) }}>
        <div style={{ width: Math.round(size * 1.15), height: Math.round(size * 1.15), borderRadius: 12, background: 'linear-gradient(135deg, ' + accent + ' 0%, #d97706 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1a1205', fontWeight: 900, fontSize: Math.round(size * 0.62), flexShrink: 0, boxShadow: '0 0 16px ' + alpha(accent, '55') }}>
          {index + 1}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: '#ffffff', fontSize: size, fontWeight: 700, lineHeight: 1.3 }}>{text}</div>
          <div style={{ height: 3, width: (bar * 100) + '%', background: accent, borderRadius: 2, marginTop: Math.round(size * 0.3), boxShadow: '0 0 10px ' + accent }} />
        </div>
      </div>
    </div>
  );
}

// Browser mockup with camera push-in, light sweep and floating chips.
function Showcase({ url, name, local, len, fps, accent, width, chips }) {
  const rise = back(clamp01(local / (0.6 * fps)));
  const push = 1 + cubic(clamp01(local / Math.max(1, len))) * 0.06;
  const sweep = interpolate(local, [0.3 * fps, 1.6 * fps], [-30, 130], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'relative', width: width, transform: 'translateY(' + (1 - rise) * 320 + 'px) scale(' + push + ')', opacity: clamp01(rise * 1.5) }}>
      <div style={{ borderRadius: 20, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.16)', boxShadow: '0 60px 140px rgba(0,0,0,0.7), 0 0 60px ' + alpha(accent, '1f'), background: '#0d1220' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '13px 18px', background: 'rgba(255,255,255,0.06)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <span style={{ width: 12, height: 12, borderRadius: 99, background: '#ff5f57' }} />
          <span style={{ width: 12, height: 12, borderRadius: 99, background: '#febc2e' }} />
          <span style={{ width: 12, height: 12, borderRadius: 99, background: '#28c840' }} />
          <span style={{ marginLeft: 12, flex: 1, background: 'rgba(255,255,255,0.08)', borderRadius: 8, color: 'rgba(255,255,255,0.55)', fontSize: 14, padding: '5px 14px' }}>{String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '')}.com</span>
        </div>
        <div style={{ position: 'relative', aspectRatio: '16 / 9', background: '#0b0f18', overflow: 'hidden' }}>
          {url ? <Img src={url} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} /> : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 30, fontWeight: 700 }}>{name}</div>
          )}
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: sweep + '%', width: '18%', background: 'linear-gradient(105deg, transparent 0%, rgba(255,255,255,0.22) 50%, transparent 100%)', transform: 'skewX(-14deg)' }} />
        </div>
      </div>
      {(chips || []).slice(0, 3).map((chip, i) => {
        const cp = back(clamp01((local - (0.7 + i * 0.25) * fps) / (0.5 * fps)));
        const bob = Math.sin(local / 22 + i * 2.1) * 9;
        const side = i % 2 === 0;
        return (
          <div key={i} style={{ position: 'absolute', top: (12 + i * 30) + '%', left: side ? '-11%' : undefined, right: side ? undefined : '-11%', opacity: clamp01(cp * 1.4), transform: 'translateY(' + ((1 - cp) * 60 + bob) + 'px) scale(' + (0.6 + cp * 0.4) + ')', background: 'rgba(10,14,26,0.85)', border: '1px solid ' + alpha(accent, '59'), color: '#fff', borderRadius: 999, padding: '10px 20px', fontSize: 19, fontWeight: 700, boxShadow: '0 12px 34px rgba(0,0,0,0.5), 0 0 14px ' + alpha(accent, '2e'), whiteSpace: 'nowrap' }}>
            <span style={{ color: accent, marginRight: 8 }}>●</span>{chip}
          </div>
        );
      })}
    </div>
  );
}

// CTA button — rise + continuous glow pulse + shine sweep.
function GlowBtn({ label, local, fps, accent, size }) {
  const rise = back(clamp01(local / (0.5 * fps)));
  const pulse = 0.5 + 0.5 * Math.sin(local / 9);
  const shine = ((local * 1.6) % 160) - 30;
  return (
    <div style={{ position: 'relative', display: 'inline-block', overflow: 'hidden', opacity: clamp01(rise * 1.6), transform: 'translateY(' + (1 - rise) * 80 + 'px)', background: 'linear-gradient(135deg, ' + accent + ' 0%, #d97706 100%)', color: '#1a1205', fontSize: size, fontWeight: 900, padding: Math.round(size * 0.62) + 'px ' + Math.round(size * 1.9) + 'px', borderRadius: 999, boxShadow: '0 0 ' + Math.round(24 + pulse * 42) + 'px ' + alpha(accent, '8c') }}>
      {label}
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: shine + '%', width: '22%', background: 'linear-gradient(105deg, transparent 0%, rgba(255,255,255,0.5) 50%, transparent 100%)', transform: 'skewX(-16deg)' }} />
    </div>
  );
}
`;

// ---------------------------------------------------------------------------
// UI MODE (16:9) — scene-based motion-design SaaS launch film:
//   HOOK (kinetic type) → FEATURES (3D glass cards) → SHOWCASE (light-sweep
//   mockup + floating chips) → CTA (pulsing glow + orbiting particles),
// all over a living animated background. Timing = fractions of the duration.
// ---------------------------------------------------------------------------

export const UI_MODE_TSX = MOTION_SKILL_TSX + `
export default function Composition(props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const accent = props.accent || '#f59e0b';
  const name = String(props.productName || 'Your product');
  const tagline = String(props.tagline || '');
  const features = (Array.isArray(props.features) ? props.features : []).map(String).slice(0, 5);

  const s1 = Math.round(durationInFrames * 0.24);
  const s2 = Math.round(durationInFrames * 0.28);
  const s3 = Math.round(durationInFrames * 0.26);
  const s4 = durationInFrames - s1 - s2 - s3;
  const f2 = frame - s1;
  const f3 = frame - s1 - s2;
  const f4 = frame - s1 - s2 - s3;

  return (
    <AbsoluteFill style={{ fontFamily: SANS, overflow: 'hidden' }}>
      <MotionBg frame={frame} total={durationInFrames} from={String(props.bgFrom || '#080c14')} to={String(props.bgTo || '#131b33')} accent={accent} />

      {frame < s1 ? (
        <SceneShell local={frame} len={s1} fps={fps}>
          <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: '0 120px' }}>
            <Eyebrow label={'Introducing'} local={frame} fps={fps} accent={accent} />
            <div style={{ marginTop: 34 }}>
              <Kinetic text={name} local={frame - Math.round(0.25 * fps)} size={132} accent={accent} every={2} upper={true} />
            </div>
            {tagline ? (
              <div style={{ marginTop: 26 }}>
                <Kinetic text={tagline} local={frame - Math.round(0.7 * fps)} size={40} accent={accent} every={3} weight={600} />
              </div>
            ) : null}
            <div style={{ height: 5, width: cubic(clamp01((frame - 1.4 * fps) / (0.5 * fps))) * 460, background: accent, borderRadius: 999, marginTop: 30, boxShadow: '0 0 22px ' + accent }} />
          </AbsoluteFill>
        </SceneShell>
      ) : null}

      {frame >= s1 && frame < s1 + s2 ? (
        <SceneShell local={f2} len={s2} fps={fps}>
          <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: '0 150px' }}>
            <Eyebrow label={'Why ' + name} local={f2} fps={fps} accent={accent} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 26, marginTop: 44, width: '100%', maxWidth: 1150 }}>
              {(features.length ? features : [tagline || name]).map((f, i) => (
                <FeatureCard key={i} text={f} local={f2 - Math.round(0.3 * fps)} fps={fps} index={i} accent={accent} width={'100%'} size={30} />
              ))}
            </div>
          </AbsoluteFill>
        </SceneShell>
      ) : null}

      {frame >= s1 + s2 && frame < s1 + s2 + s3 ? (
        <SceneShell local={f3} len={s3} fps={fps}>
          <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
            <Showcase url={props.screenshotUrl} name={name} local={f3} len={s3} fps={fps} accent={accent} width={1060} chips={features} />
          </AbsoluteFill>
        </SceneShell>
      ) : null}

      {frame >= s1 + s2 + s3 ? (
        <SceneShell local={f4} len={Math.max(1, s4)} fps={fps}>
          <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '0 160px' }}>
            <Orbits frame={frame} accent={accent} rx={430} ry={230} />
            <Kinetic text={name} local={f4} size={104} accent={accent} every={2} upper={true} />
            {tagline ? <div style={{ color: accent, fontSize: 34, fontWeight: 600, marginTop: 18, opacity: clamp01((f4 - 0.4 * fps) / (0.3 * fps)) }}>{tagline}</div> : null}
            <div style={{ marginTop: 44 }}>
              <GlowBtn label={'Try ' + name + ' today'} local={f4 - Math.round(0.5 * fps)} fps={fps} accent={accent} size={32} />
            </div>
          </AbsoluteFill>
        </SceneShell>
      ) : null}

      {props.voiceoverUrl ? <Audio src={props.voiceoverUrl} /> : null}
      {props.musicUrl ? <Audio src={props.musicUrl} volume={props.musicVolume == null ? 0.25 : props.musicVolume} loop /> : null}
    </AbsoluteFill>
  );
}
`;

// ---------------------------------------------------------------------------
// STORY MODE (9:16) — vertical motion-design: living background (AI backdrop
// with parallax when provided), kinetic hook, feature pills cascade, floating
// mockup with sweep, CTA pulse + orbiting particles. Same skill library.
// ---------------------------------------------------------------------------

export const STORY_MODE_TSX = MOTION_SKILL_TSX + `
const STAGE_W = 608; // 1080 * 9/16 — the vertical stage inside the 16:9 frame

export default function Composition(props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const accent = props.accent || '#f59e0b';
  const name = String(props.productName || 'Your product');
  const tagline = String(props.tagline || '');
  const features = (Array.isArray(props.features) ? props.features : []).map(String).slice(0, 4);

  const s1 = Math.round(durationInFrames * 0.28);
  const s2 = Math.round(durationInFrames * 0.3);
  const s3 = Math.round(durationInFrames * 0.24);
  const s4 = durationInFrames - s1 - s2 - s3;
  const f2 = frame - s1;
  const f3 = frame - s1 - s2;
  const f4 = frame - s1 - s2 - s3;
  const bgShift = interpolate(frame, [0, durationInFrames], [-20, 20]);
  const characterIn = back(clamp01((frame - fps) / (0.8 * fps)));
  const mockupFloat = Math.sin(frame / 30) * 8;

  return (
    <AbsoluteFill style={{ backgroundColor: '#04060c', alignItems: 'center', justifyContent: 'center', fontFamily: SANS }}>
      <div style={{ position: 'relative', width: STAGE_W, height: 1080, overflow: 'hidden', background: '#080c14' }}>
        {props.backgroundUrl ? (
          <Img src={props.backgroundUrl} style={{ position: 'absolute', top: 0, left: -30, width: STAGE_W + 60, height: 1080, objectFit: 'cover', transform: 'translateX(' + bgShift + 'px) scale(1.06)' }} />
        ) : null}
        <div style={{ position: 'absolute', inset: 0 }}>
          <MotionBg frame={frame} total={durationInFrames} from={props.backgroundUrl ? 'rgba(4,6,12,0)' : String(props.bgFrom || '#080c14')} to={props.backgroundUrl ? 'rgba(4,6,12,0)' : String(props.bgTo || '#131b33')} accent={accent} />
        </div>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(4,6,12,0.3) 0%, rgba(4,6,12,0.66) 74%, rgba(4,6,12,0.92) 100%)' }} />

        {props.characterUrl ? (
          <Img src={props.characterUrl} style={{ position: 'absolute', bottom: 0, left: '50%', width: STAGE_W * 0.86, transform: 'translateX(-50%) translateY(' + (1 - characterIn) * 420 + 'px)', objectFit: 'contain' }} />
        ) : null}

        {frame < s1 ? (
          <SceneShell local={frame} len={s1} fps={fps}>
            <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: '0 26px' }}>
              <Eyebrow label={'Introducing'} local={frame} fps={fps} accent={accent} />
              <div style={{ marginTop: 26 }}>
                <Kinetic text={name} local={frame - Math.round(0.25 * fps)} size={66} accent={accent} every={2} upper={true} />
              </div>
              {tagline ? <div style={{ marginTop: 20 }}><Kinetic text={tagline} local={frame - Math.round(0.7 * fps)} size={30} accent={accent} every={3} weight={600} /></div> : null}
            </AbsoluteFill>
          </SceneShell>
        ) : null}

        {frame >= s1 && frame < s1 + s2 ? (
          <SceneShell local={f2} len={s2} fps={fps}>
            <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: '0 34px' }}>
              <Eyebrow label={'Why ' + name} local={f2} fps={fps} accent={accent} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginTop: 32, width: '100%' }}>
                {(features.length ? features : [tagline || name]).map((f, i) => (
                  <FeatureCard key={i} text={f} local={f2 - Math.round(0.3 * fps)} fps={fps} index={i} accent={accent} width={'100%'} size={22} />
                ))}
              </div>
            </AbsoluteFill>
          </SceneShell>
        ) : null}

        {frame >= s1 + s2 && frame < s1 + s2 + s3 ? (
          <SceneShell local={f3} len={s3} fps={fps}>
            <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ transform: 'translateY(' + mockupFloat + 'px)', width: '82%' }}>
                <Showcase url={props.screenshotUrl} name={name} local={f3} len={s3} fps={fps} accent={accent} width={'100%'} chips={[]} />
              </div>
            </AbsoluteFill>
          </SceneShell>
        ) : null}

        {frame >= s1 + s2 + s3 ? (
          <SceneShell local={f4} len={Math.max(1, s4)} fps={fps}>
            <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '0 30px' }}>
              <Orbits frame={frame} accent={accent} rx={210} ry={330} />
              <Kinetic text={name} local={f4} size={58} accent={accent} every={2} upper={true} />
              <div style={{ marginTop: 30 }}>
                <GlowBtn label={'Get started'} local={f4 - Math.round(0.4 * fps)} fps={fps} accent={accent} size={26} />
              </div>
            </AbsoluteFill>
          </SceneShell>
        ) : null}
      </div>

      {props.voiceoverUrl ? <Audio src={props.voiceoverUrl} /> : null}
      {props.musicUrl ? <Audio src={props.musicUrl} volume={props.musicVolume == null ? 0.22 : props.musicVolume} loop /> : null}
    </AbsoluteFill>
  );
}
`;
