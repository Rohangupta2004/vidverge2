/**
 * VERGE LOADER — Vidverge's branded loading motion: a light beam firing.
 *
 * WHAT THIS REPLACED, AND WHY
 * This component used to draw the logo's shallow "V" and run a spark around it.
 * As a brand mark that worked; as a LOADER it read as a decorative logo
 * animation, and at small sizes the V collapsed into an indistinct gold smudge.
 * It has been replaced with the thing the product actually does: light fired in
 * a straight line. Dense, narrow, luminous beams leave an emitter, cross the
 * frame at different depths and speeds, and bloom where they land.
 *
 * It is deliberately NOT a glowing orb or a particle field — both are the house
 * style of every generic AI dashboard, and neither says anything about video.
 *
 * HOW IT STAYS CHEAP
 * Only `transform` and `opacity` are animated, so every frame is composited on
 * the GPU and nothing re-rasterises. The soft edges come from STATIC linear and
 * radial gradients rather than from SVG blur filters: a Gaussian blur applied
 * to a moving element forces a re-raster every frame, which is exactly the kind
 * of loader that makes an app feel slower than it is. There are five beams, not
 * fifty, and the whole thing is one <svg> with no JavaScript animation loop, no
 * timers and no layout reads.
 *
 * `prefers-reduced-motion` is honoured: the beams stop and the frame settles
 * into a static lit rail, so the component still reads as "busy" without moving.
 *
 * The props are unchanged from the previous implementation on purpose — every
 * existing call site keeps working, including the `amber` and `ink` tone names.
 */
import { useId } from 'react';
import type { CSSProperties } from 'react';

/** The house tone: gold filaments with a hot gold core, per components/theme.ts. */
const BRAND_TONE = { edge: '#D4920A', mid: '#B87808', spark: '#F5C451' } as const;

/**
 * Drawn on top of a brand-filled surface — a gold-gradient button — where a
 * gold beam would disappear into its own background.
 */
const ON_BRAND_TONE = { edge: 'rgba(255,255,255,0.45)', mid: '#FFFFFF', spark: '#FFFFFF' } as const;

// `amber` and `ink` are the names the existing call sites pass.
const TONES = {
  brand: BRAND_TONE,
  onBrand: ON_BRAND_TONE,
  amber: BRAND_TONE,
  ink: ON_BRAND_TONE,
} as const;

export type VergeLoaderTone = keyof typeof TONES;

/**
 * Five beams across the 120-unit-tall artboard.
 *
 * `y` places each one at a different depth; `h` is its thickness and `o` its
 * opacity, and the two move together so a thin faint beam reads as further away
 * than a thick bright one. `dur` and `delay` are staggered by prime-ish
 * fractions so the volley never falls into a visible repeating lockstep — the
 * pattern takes several seconds to come back around.
 */
const BEAMS: Array<{ y: number; h: number; o: number; dur: string; delay: string }> = [
  { y: 44, h: 1, o: 0.35, dur: '1.70s', delay: '-0.95s' },
  { y: 53, h: 1.5, o: 0.6, dur: '1.45s', delay: '-0.35s' },
  { y: 60, h: 2.5, o: 1, dur: '1.25s', delay: '0s' },
  { y: 67, h: 1.5, o: 0.6, dur: '1.55s', delay: '-0.7s' },
  { y: 76, h: 1, o: 0.35, dur: '1.85s', delay: '-1.3s' },
];

// The beam travels from just off the left edge to just past the right one, so
// it enters and exits cleanly instead of appearing mid-frame. Opacity ramps at
// both ends to hide the hand-off.
const LOADER_CSS = `
@keyframes vvlFire {
  0%   { transform: translateX(-78px); opacity: 0; }
  12%  { opacity: 1; }
  88%  { opacity: 1; }
  100% { transform: translateX(206px); opacity: 0; }
}
@keyframes vvlImpact { 0%, 100% { opacity: .12; } 55% { opacity: .55; } }
@keyframes vvlCharge { 0%, 100% { opacity: .45; } 50% { opacity: 1; } }
.vvl-beam { animation: vvlFire linear infinite; will-change: transform, opacity; }
.vvl-impact { animation: vvlImpact 1.25s ease-in-out infinite; }
.vvl-emitter { animation: vvlCharge 1.25s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .vvl-beam { animation: none; transform: translateX(0); opacity: .5; }
  .vvl-impact { animation: none; opacity: .3; }
  .vvl-emitter { animation: none; opacity: .8; }
}
`;

export interface VergeLoaderProps {
  /** Width in pixels. Height follows the 5:3 artboard. */
  size?: number;
  /** Visible text under the mark. Omit for a bare mark. */
  caption?: string;
  /** Screen-reader text announcing what is loading. */
  label?: string;
  tone?: VergeLoaderTone;
  style?: CSSProperties;
}

export default function VergeLoader({
  size = 120,
  caption,
  label = 'Loading',
  tone = 'brand',
  style,
}: VergeLoaderProps) {
  // Unique per instance so several loaders on one page never share gradients.
  const uid = useId().replace(/:/g, '');
  const beamId = `vvlBeam-${uid}`;
  const railId = `vvlRail-${uid}`;
  const bloomId = `vvlBloom-${uid}`;
  const emitId = `vvlEmit-${uid}`;
  const clipId = `vvlClip-${uid}`;
  const colors = TONES[tone];

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'relative',
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: caption ? 16 : 0,
        ...style,
      }}
    >
      <style>{LOADER_CSS}</style>

      <svg
        width={size}
        height={Math.round(size * 0.6)}
        viewBox="0 0 200 120"
        aria-hidden
        focusable="false"
        style={{ display: 'block' }}
      >
        <defs>
          {/*
            The beam itself: a long transparent tail that tightens into a hot
            core at the leading edge. This asymmetry is what makes it read as
            something FIRED rather than a bar sliding across — the light is
            densest where it is going, not in the middle.
          */}
          <linearGradient id={beamId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={colors.edge} stopOpacity="0" />
            <stop offset="55%" stopColor={colors.edge} stopOpacity="0.28" />
            <stop offset="86%" stopColor={colors.mid} stopOpacity="0.85" />
            <stop offset="97%" stopColor={colors.spark} stopOpacity="1" />
            <stop offset="100%" stopColor={colors.spark} stopOpacity="0" />
          </linearGradient>

          {/* The unlit path the beams travel, so the frame has structure at rest. */}
          <linearGradient id={railId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={colors.edge} stopOpacity="0" />
            <stop offset="50%" stopColor={colors.edge} stopOpacity="0.22" />
            <stop offset="100%" stopColor={colors.edge} stopOpacity="0" />
          </linearGradient>

          {/* Where the light lands. A static radial — only its opacity animates. */}
          <radialGradient id={bloomId} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={colors.spark} stopOpacity="0.9" />
            <stop offset="45%" stopColor={colors.mid} stopOpacity="0.35" />
            <stop offset="100%" stopColor={colors.mid} stopOpacity="0" />
          </radialGradient>

          {/* The emitter, pulsing as it charges the next volley. */}
          <linearGradient id={emitId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors.mid} stopOpacity="0" />
            <stop offset="50%" stopColor={colors.spark} stopOpacity="1" />
            <stop offset="100%" stopColor={colors.mid} stopOpacity="0" />
          </linearGradient>

          {/*
            Beams are clipped to the artboard so they cannot bleed over
            neighbouring UI while they enter and leave — which also means this
            svg does not need overflow:visible, and the browser can cull it.
          */}
          <clipPath id={clipId}>
            <rect x="0" y="0" width="200" height="120" />
          </clipPath>
        </defs>

        {/* Resting rail. */}
        <rect x="0" y="59.25" width="200" height="1.5" fill={`url(#${railId})`} />

        <g clipPath={`url(#${clipId})`}>
          {BEAMS.map((beam) => (
            <g
              key={beam.y}
              className="vvl-beam"
              style={{ animationDuration: beam.dur, animationDelay: beam.delay }}
            >
              <rect
                x="0"
                y={beam.y - beam.h / 2}
                width="72"
                height={beam.h}
                fill={`url(#${beamId})`}
                opacity={beam.o}
              />
            </g>
          ))}
        </g>

        {/* Impact bloom at the far side. */}
        <ellipse className="vvl-impact" cx="196" cy="60" rx="26" ry="20" fill={`url(#${bloomId})`} />

        {/* Emitter at the near side. */}
        <rect className="vvl-emitter" x="1" y="40" width="2" height="40" fill={`url(#${emitId})`} />
      </svg>

      {caption ? (
        <span
          style={{
            fontSize: 13,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: tone === 'ink' || tone === 'onBrand' ? '#FFFFFF' : '#9E8B55',
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, 'SF Mono', monospace",
          }}
        >
          {caption}
        </span>
      ) : null}

      <span
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          overflow: 'hidden',
          clip: 'rect(0 0 0 0)',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
    </div>
  );
}
