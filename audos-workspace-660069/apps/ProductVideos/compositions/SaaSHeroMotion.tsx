// Product Videos — SaaSHeroMotion: the 25-second AI Ad Director composition.
//
// One fixed, deterministic 1920x1080 @ 30fps commercial (750 frames) built
// from the Director bundle (lib/director.ts): a Problem-First 3-beat cut —
//   Beat 1 (0–5s)   hook       relatable frustration, kinetic headline
//   Beat 2 (5–18s)  solution   the scraped UI screenshot on a 3D stage
//   Beat 3 (18–25s) cta        value payoff + call-to-action pulse
//
// HARD RULES BAKED IN (do not soften them):
// - 3D ISOMETRIC DEPTH: the screenshot sits in a perspective(1200px) stage,
//   spring()-settled rotateX/rotateY/scale with a continuous subtle gyro
//   drift. No element in the film is ever fully stationary.
// - GLASSMORPHISM LIGHT SWEEP: an absolute overlay running
//   linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.25) 50%,
//   transparent 70%) across the card, driven by the frame counter, standing
//   in for a moving studio lighting reflection pass.
// - BACKGROUND PLATE: a photoreal out-of-focus Veo 3 clip (OffthreadVideo,
//   muted, tiled to cover 25s) — Veo renders ATMOSPHERE ONLY, never UI. When
//   no plate exists the film ships on a drifting cinematic gradient instead.
// - KINETIC SUBTITLES: word-by-word captions; the word being spoken right now
//   carries a yellow highlight pill, snapped to Deepgram millisecond stamps.
// - AUDIO DUCKING: the music bed drops -12 dB (x0.251) while the voiceover
//   speaks and returns to full volume for the CTA.
//
// THE LIVE COPY OF THIS TEMPLATE IS INLINED IN THE pv-ad-director SERVER
// FUNCTION (hook code cannot import workspace files). This file is the
// canonical readable source — change BOTH together.
//
// The generated TSX imports only from 'remotion' + react and is a pure
// function of useCurrentFrame(): no CSS animations, timers, randomness,
// fetch, or window/document access.

export const AD_FPS = 30;
export const AD_DURATION_FRAMES = 750; // 25 seconds, fixed

// The Problem-First beat grid, in frames. Fixed by the format, not the VO.
export const AD_BEAT_GRID = [
  { id: 'hook' as const, from: 0, durationFrames: 150 },
  { id: 'solution' as const, from: 150, durationFrames: 390 },
  { id: 'cta' as const, from: 540, durationFrames: 210 },
];

export interface AdWordStamp {
  word: string;
  /** Milliseconds from the start of the FILM (not the segment). */
  startMs: number;
  endMs: number;
}

export interface AdBeat {
  id: 'hook' | 'solution' | 'cta';
  narration: string;
  subtitle: string;
  voUrl: string | null;
  voDurationMs: number;
}

export interface SaaSHeroMotionInput {
  title: string;
  tagline: string;
  ctaText: string;
  ctaUrl: string;
  accent?: string | null;
  logoUrl?: string | null;
  screenshotUrl: string;
  /** Veo 3 ambient plate MP4 (16:9). null → cinematic gradient fallback. */
  backdropUrl: string | null;
  musicUrl: string | null;
  beats: AdBeat[];
  words: AdWordStamp[];
}

const msToFrame = (ms: number) => Math.round((Number(ms) / 1000) * AD_FPS);
const clampFrame = (f: number) => Math.max(0, Math.min(AD_DURATION_FRAMES - 1, f));

interface CaptionWord { word: string; startFrame: number; endFrame: number; }
interface CaptionLine { from: number; to: number; words: CaptionWord[]; }

/** Group the timestamped words into caption lines: max 5 words, never across a beat boundary. */
export function buildCaptionLines(words: AdWordStamp[]): CaptionLine[] {
  const stamped: CaptionWord[] = (words || [])
    .filter((w) => w && String(w.word || '').trim())
    .map((w) => ({
      word: String(w.word).trim(),
      startFrame: clampFrame(msToFrame(w.startMs)),
      endFrame: clampFrame(Math.max(msToFrame(w.endMs), msToFrame(w.startMs) + 4)),
    }))
    .sort((a, b) => a.startFrame - b.startFrame);
  if (!stamped.length) return [];

  const boundaries = AD_BEAT_GRID.map((b) => b.from).slice(1);
  const lines: CaptionLine[] = [];
  let current: CaptionWord[] = [];
  const flush = () => {
    if (!current.length) return;
    lines.push({
      from: Math.max(0, current[0].startFrame - 3),
      to: clampFrame(current[current.length - 1].endFrame + 10),
      words: current,
    });
    current = [];
  };
  for (const word of stamped) {
    const crossesBeat = current.length > 0 && boundaries.some(
      (b) => current[0].startFrame < b && word.startFrame >= b,
    );
    if (current.length >= 5 || crossesBeat) flush();
    current.push(word);
  }
  flush();
  // A line never lingers into the next line's opening.
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (lines[i].to > lines[i + 1].from) lines[i].to = lines[i + 1].from;
  }
  return lines;
}

export function buildSaaSHeroMotion(input: SaaSHeroMotionInput): { tsx: string; durationInFrames: number } {
  const beats = AD_BEAT_GRID.map((slot, index) => {
    const beat = input.beats[index] || ({} as AdBeat);
    const voFrames = beat.voDurationMs ? Math.min(msToFrame(beat.voDurationMs) + 6, AD_DURATION_FRAMES - slot.from) : 0;
    return {
      id: slot.id,
      from: slot.from,
      durationFrames: slot.durationFrames,
      subtitle: String(beat.subtitle || ''),
      voUrl: beat.voUrl || null,
      voFrames,
    };
  });

  const duckWindows = beats
    .filter((b) => b.voUrl && b.voFrames > 0)
    .map((b) => ({ from: b.from, to: Math.min(b.from + b.voFrames, AD_DURATION_FRAMES) }));

  const payload = JSON.stringify({
    title: input.title,
    tagline: input.tagline,
    ctaText: input.ctaText,
    ctaUrl: String(input.ctaUrl || '').replace(/^https?:\/\//i, '').replace(/\/$/, ''),
    accent: input.accent || null,
    logoUrl: input.logoUrl || null,
    screenshotUrl: input.screenshotUrl,
    backdropUrl: input.backdropUrl || null,
    musicUrl: input.musicUrl || null,
    beats,
    captionLines: buildCaptionLines(input.words),
    duckWindows,
  });

  const tsx = `import React from 'react';
import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

const DATA: any = ${payload};

const FPS = 30;
const DURATION = ${AD_DURATION_FRAMES};
const FONT = "'Inter', 'Geist', system-ui, -apple-system, sans-serif";
const SPRING_CONFIG = { damping: 15, stiffness: 120, mass: 0.8 };
const SNAP_CONFIG = { damping: 16, stiffness: 210, mass: 0.6 };
const HIGHLIGHT = '#FFD84D'; // the kinetic-subtitle yellow

// ---------------------------------------------------------------------------
// Audio ducking: music sits at MUSIC_BASE and drops -12 dB (x0.251) inside
// every voiceover window, ramping over 12 frames, back to full for the CTA.
// ---------------------------------------------------------------------------
const MUSIC_BASE = 0.5;
const DUCKED = MUSIC_BASE * 0.251;
const RAMP = 12;
function musicVolume(frame: number): number {
  let volume = MUSIC_BASE;
  for (const w of DATA.duckWindows) {
    if (frame >= w.from - RAMP && frame <= w.to + RAMP) {
      const fadeIn = interpolate(frame, [w.from - RAMP, w.from], [MUSIC_BASE, DUCKED], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
      const fadeOut = interpolate(frame, [w.to, w.to + RAMP], [DUCKED, MUSIC_BASE], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
      // Inside the window both clamped ramps sit at DUCKED; in the entry ramp
      // fadeIn is descending, in the exit ramp fadeOut is rising — so the
      // window's own level is always max(fadeIn, fadeOut).
      volume = Math.min(volume, Math.max(fadeIn, fadeOut));
    }
  }
  return volume;
}

// ---------------------------------------------------------------------------
// Background plate: the photoreal Veo clip, muted, tiled to cover the film,
// under a slow zoom so it never sits still. Gradient fallback when absent.
// ---------------------------------------------------------------------------
const PLATE_TILE = 236; // trim the 8s clip tail so a frozen last frame never shows
const BackdropPlate: React.FC = () => {
  const frame = useCurrentFrame();
  const zoom = interpolate(frame, [0, DURATION], [1.06, 1.16], { extrapolateRight: 'clamp' });
  if (!DATA.backdropUrl) {
    const glowX = 50 + Math.sin(frame * 0.008) * 16;
    const glowY = 34 + Math.cos(frame * 0.006) * 8;
    return (
      <AbsoluteFill style={{ background: '#05070C' }}>
        <AbsoluteFill style={{ background: 'radial-gradient(1100px 640px at ' + glowX + '% ' + glowY + '%, rgba(99,102,241,0.20), transparent 65%)' }} />
        <AbsoluteFill style={{ background: 'radial-gradient(900px 520px at ' + (100 - glowX) + '% 82%, rgba(245,185,54,0.08), transparent 60%)' }} />
        <AbsoluteFill style={{ background: 'radial-gradient(circle at 50% 42%, transparent 34%, rgba(3,4,9,0.78) 100%)' }} />
      </AbsoluteFill>
    );
  }
  const tiles = Math.ceil(DURATION / PLATE_TILE);
  return (
    <AbsoluteFill style={{ background: '#05070C' }}>
      <AbsoluteFill style={{ transform: 'scale(' + zoom + ')' }}>
        {Array.from({ length: tiles }).map((_, i) => (
          <Sequence key={i} from={i * PLATE_TILE} durationInFrames={PLATE_TILE}>
            <OffthreadVideo
              muted
              src={DATA.backdropUrl}
              style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'brightness(0.52) saturate(1.06) blur(2px)' }}
            />
          </Sequence>
        ))}
      </AbsoluteFill>
      <AbsoluteFill style={{ background: 'radial-gradient(circle at 50% 42%, transparent 30%, rgba(3,4,9,0.74) 100%)' }} />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// Glassmorphism light sweep — the moving studio reflection pass.
// ---------------------------------------------------------------------------
const LightSweep: React.FC = () => {
  const frame = useCurrentFrame();
  const x = interpolate(frame % 132, [0, 132], [-130, 130]);
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', borderRadius: 26, pointerEvents: 'none', zIndex: 5 }}>
      <div
        style={{
          position: 'absolute',
          top: '-25%',
          bottom: '-25%',
          left: '-40%',
          width: '180%',
          background: 'linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.25) 50%, transparent 70%)',
          transform: 'translateX(' + x + '%)',
        }}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// The 3D isometric hero card: the scraped screenshot on a perspective stage.
// Teased small and out of focus through the hook, spring-settles to center
// for the solution beat, recedes for the CTA — with continuous gyro drift.
// ---------------------------------------------------------------------------
const HeroCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: Math.max(0, frame - 150), fps, config: SPRING_CONFIG });
  const recede = spring({ frame: Math.max(0, frame - 540), fps, config: SPRING_CONFIG });

  const driftY = Math.sin(frame * 0.045) * 6;
  const gyroY = Math.sin(frame * 0.031) * 2.4;
  const gyroX = Math.cos(frame * 0.023) * 1.7;

  const scale = 0.6 + enter * 0.4 - recede * 0.16;
  const rotY = (1 - enter) * 30 - 8 + gyroY;
  const rotX = (1 - enter) * 16 + 7 + gyroX;
  const y = (1 - enter) * 70 + recede * 148 + driftY;
  const blur = (1 - enter) * 7;
  const opacity = 0.4 + enter * 0.6 - recede * 0.28;

  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', zIndex: 20 }}>
      <div
        style={{
          position: 'relative',
          width: 1240,
          height: 720,
          opacity,
          filter: blur > 0.3 ? 'blur(' + blur + 'px)' : undefined,
          transform:
            'perspective(1200px) translateY(' + y + 'px) rotateX(' + rotX + 'deg) rotateY(' + rotY + 'deg) scale(' + scale + ')',
          transformStyle: 'preserve-3d',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 26,
            overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.16)',
            background: '#0D1220',
            boxShadow: '0 60px 160px rgba(0,0,0,0.65), 0 24px 60px rgba(0,0,0,0.5)',
          }}
        >
          <Img src={DATA.screenshotUrl} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center' }} />
          {/* static glass sheen on the top edge */}
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(255,255,255,0.10) 0%, transparent 22%)', pointerEvents: 'none' }} />
          <LightSweep />
        </div>
        {/* projected floor reflection so the card sits IN the scene */}
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            height: '42%',
            marginTop: 18,
            borderRadius: 26,
            overflow: 'hidden',
            opacity: 0.16 * enter,
            transform: 'scaleY(-1)',
            WebkitMaskImage: 'linear-gradient(180deg, transparent 30%, rgba(0,0,0,0.9) 100%)',
            maskImage: 'linear-gradient(180deg, transparent 30%, rgba(0,0,0,0.9) 100%)',
          }}
        >
          <Img src={DATA.screenshotUrl} style={{ width: '100%', height: '238%', objectFit: 'cover', objectPosition: 'top center' }} />
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// Kinetic word-by-word subtitles, snapped to the millisecond word stamps.
// The word being spoken RIGHT NOW carries the yellow highlight pill.
// ---------------------------------------------------------------------------
const KineticSubtitles: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const line = DATA.captionLines.find((l: any) => frame >= l.from && frame < l.to);
  if (!line) return null;
  return (
    <div style={{ position: 'absolute', left: 140, right: 140, bottom: 78, textAlign: 'center', zIndex: 80 }}>
      {line.words.map((w: any, i: number) => {
        const pop = spring({ frame: Math.max(0, frame - w.startFrame), fps, config: SNAP_CONFIG });
        const speakingNow = frame >= w.startFrame && frame < w.endFrame;
        const spoken = frame >= w.endFrame;
        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              margin: '0 6px',
              padding: '7px 15px',
              borderRadius: 13,
              fontFamily: FONT,
              fontWeight: 800,
              fontSize: 44,
              letterSpacing: '-0.01em',
              color: speakingNow ? '#141005' : spoken ? '#F5F5F5' : 'rgba(240,240,240,0.55)',
              background: speakingNow ? HIGHLIGHT : 'rgba(6,8,15,0.62)',
              boxShadow: speakingNow ? '0 8px 30px rgba(255,216,77,0.45)' : '0 6px 20px rgba(0,0,0,0.45)',
              opacity: 0.3 + pop * 0.7,
              transform: 'translateY(' + (1 - pop) * 16 + 'px) scale(' + (0.9 + pop * 0.1 + (speakingNow ? 0.05 : 0)) + ')',
            }}
          >
            {w.word}
          </span>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Beat overlays
// ---------------------------------------------------------------------------
const KineticHeadline: React.FC<{ text: string; size?: number; delay?: number }> = ({ text, size, delay }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = String(text).split(' ').filter(Boolean);
  return (
    <div style={{ textAlign: 'center' }}>
      {words.map((word, index) => {
        const progress = spring({ frame: Math.max(0, frame - (delay || 0) - index * 5), fps, config: SPRING_CONFIG });
        return (
          <span
            key={index}
            style={{
              display: 'inline-block',
              margin: '0 16px',
              fontFamily: FONT,
              fontSize: size || 96,
              fontWeight: 800,
              letterSpacing: '-0.03em',
              color: '#F5F6FA',
              textShadow: '0 10px 40px rgba(0,0,0,0.75)',
              opacity: progress,
              transform: 'translateY(' + (1 - progress) * 42 + 'px)',
            }}
          >
            {word}
          </span>
        );
      })}
    </div>
  );
};

const HookBeat: React.FC = () => {
  const frame = useCurrentFrame();
  const exit = interpolate(frame, [122, 148], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const drift = Math.sin(frame * 0.05) * 4;
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: 160, opacity: exit, zIndex: 40 }}>
      <div style={{ transform: 'translateY(' + (drift - 40) + 'px)' }}>
        <KineticHeadline text={DATA.beats[0].subtitle || DATA.title} size={104} />
      </div>
    </AbsoluteFill>
  );
};

const SolutionBeat: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const chipIn = spring({ frame: Math.max(0, frame - 10), fps, config: SPRING_CONFIG });
  const capIn = spring({ frame: Math.max(0, frame - 26), fps, config: SPRING_CONFIG });
  const exit = interpolate(frame, [366, 388], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const chipDrift = Math.sin((frame + 40) * 0.04) * 3;
  return (
    <AbsoluteFill style={{ opacity: exit, zIndex: 40 }}>
      <div
        style={{
          position: 'absolute',
          top: 64 + chipDrift,
          left: 0,
          right: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          opacity: chipIn,
          transform: 'translateY(' + (1 - chipIn) * -30 + 'px)',
        }}
      >
        {DATA.logoUrl ? (
          <Img src={DATA.logoUrl} style={{ width: 52, height: 52, objectFit: 'contain', filter: 'drop-shadow(0 6px 18px rgba(0,0,0,0.6))' }} />
        ) : null}
        <span style={{ fontFamily: FONT, fontSize: 40, fontWeight: 800, letterSpacing: '-0.02em', color: '#F5F6FA', textShadow: '0 8px 30px rgba(0,0,0,0.7)' }}>
          {DATA.title}
        </span>
      </div>
      <div
        style={{
          position: 'absolute',
          top: 140,
          left: 0,
          right: 0,
          textAlign: 'center',
          fontFamily: FONT,
          fontSize: 27,
          fontWeight: 600,
          color: 'rgba(240,240,240,0.72)',
          textShadow: '0 6px 20px rgba(0,0,0,0.7)',
          opacity: capIn,
          transform: 'translateY(' + (1 - capIn) * 20 + 'px)',
        }}
      >
        {DATA.beats[1].subtitle || DATA.tagline}
      </div>
    </AbsoluteFill>
  );
};

const CtaBeat: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const titleIn = spring({ frame: Math.max(0, frame - 6), fps, config: SPRING_CONFIG });
  const pillIn = spring({ frame: Math.max(0, frame - 22), fps, config: SPRING_CONFIG });
  const pulse = 1 + Math.sin(frame * 0.11) * 0.028;
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'flex-start', paddingTop: 120, gap: 30, zIndex: 40 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, opacity: titleIn, transform: 'translateY(' + (1 - titleIn) * 34 + 'px)' }}>
        {DATA.logoUrl ? (
          <Img src={DATA.logoUrl} style={{ width: 76, height: 76, objectFit: 'contain', filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.6))' }} />
        ) : null}
        <span style={{ fontFamily: FONT, fontSize: 78, fontWeight: 800, letterSpacing: '-0.03em', color: '#F5F6FA', textShadow: '0 12px 44px rgba(0,0,0,0.75)' }}>
          {DATA.title}
        </span>
      </div>
      <div style={{ fontFamily: FONT, fontSize: 30, fontWeight: 600, color: 'rgba(240,240,240,0.75)', textShadow: '0 6px 22px rgba(0,0,0,0.7)', opacity: titleIn }}>
        {DATA.beats[2].subtitle || DATA.tagline}
      </div>
      <div style={{ opacity: pillIn, transform: 'scale(' + (0.85 + pillIn * 0.15) * pulse + ')' }}>
        <div
          style={{
            padding: '22px 52px',
            borderRadius: 999,
            background: 'linear-gradient(90deg, #FFD84D, #F5B936)',
            color: '#1A1205',
            fontFamily: FONT,
            fontSize: 38,
            fontWeight: 800,
            letterSpacing: '-0.01em',
            boxShadow: '0 22px 70px rgba(245,185,54,0.5)',
          }}
        >
          {DATA.ctaText || DATA.ctaUrl}
        </div>
      </div>
      {DATA.ctaUrl ? (
        <div style={{ fontFamily: FONT, fontSize: 26, fontWeight: 700, color: 'rgba(240,240,240,0.6)', letterSpacing: '0.02em', opacity: pillIn }}>
          {DATA.ctaUrl}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

// Breathing vignette on top of everything visual — nothing sits still.
const FilmVignette: React.FC = () => {
  const frame = useCurrentFrame();
  const breathe = 0.62 + Math.sin(frame * 0.02) * 0.05;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', zIndex: 90 }}>
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 50% 46%, transparent 44%, rgba(0,0,0,' + breathe + ') 100%)' }} />
    </AbsoluteFill>
  );
};

export default function MotionVideo() {
  return (
    <AbsoluteFill style={{ background: '#05070C', overflow: 'hidden', fontFamily: FONT }}>
      {DATA.musicUrl ? <Audio src={DATA.musicUrl} volume={(f: number) => musicVolume(f)} /> : null}
      {DATA.beats.map((beat: any) =>
        beat.voUrl && beat.voFrames > 0 ? (
          <Sequence key={'vo-' + beat.id} from={beat.from} durationInFrames={Math.min(beat.voFrames, DURATION - beat.from)}>
            <Audio src={beat.voUrl} />
          </Sequence>
        ) : null,
      )}
      <BackdropPlate />
      <HeroCard />
      <Sequence from={0} durationInFrames={150}>
        <HookBeat />
      </Sequence>
      <Sequence from={150} durationInFrames={390}>
        <SolutionBeat />
      </Sequence>
      <Sequence from={540} durationInFrames={210}>
        <CtaBeat />
      </Sequence>
      <KineticSubtitles />
      <FilmVignette />
    </AbsoluteFill>
  );
}

export const calculateDemoVideoDuration = () => ${AD_DURATION_FRAMES};
`;

  return { tsx, durationInFrames: AD_DURATION_FRAMES };
}
