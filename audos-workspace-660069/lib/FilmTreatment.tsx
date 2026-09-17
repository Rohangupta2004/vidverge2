/**
 * FilmTreatment — the reusable analog-film wrapper every generated scene
 * renders inside. (Planned as src/FilmTreatment.tsx; the platform compiler
 * only accepts shared modules under lib/, so this is the canonical location.)
 *
 * Wraps any Remotion scene with, in stacking order:
 *   1. colour grade  — saturate / contrast / sepia / brightness CSS filter
 *   2. gate weave    — stepped 12fps wiggle, ~5px travel, 1.012 safety scale
 *   3. grain         — multiply-blended turbulence, 55% opacity (grainOpacity)
 *   4. grunge        — color-burn texture pass, 16% opacity
 *   5. scan lines    — 1.6px black lines, 16% opacity, 8px repeat, 0.7px blur
 *   6. vignette      — radial ellipse 92%×82% at 50%/48%, clear → black edges
 * Every layer has an on/off toggle prop; the grade values are all props.
 *
 * CANONICAL SOURCE. The platform's Remotion renderer compiles a SINGLE
 * composition file, so generated scene code cannot import from this module —
 * the sceneforge-run server function inlines a byte-equivalent untyped JS copy
 * (FILM_TREATMENT_SRC) into every composition it emits. Change it here first,
 * then mirror it there.
 */
import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { posterizeTime } from './motionEngine';

export interface FilmTreatmentProps {
  children?: React.ReactNode;
  /** Layer toggles — all default ON. */
  scanLines?: boolean;
  grain?: boolean;
  grunge?: boolean;
  vignette?: boolean;
  grade?: boolean;
  gateWeave?: boolean;
  /** Grain multiply opacity (default 0.55). */
  grainOpacity?: number;
  /** Colour grade values. */
  saturate?: number;
  contrast?: number;
  sepia?: number;
  brightness?: number;
}

// Deterministic SVG turbulence textures (no network, no randomness at render
// time — the noise seed is baked into the data URI).
const GRAIN_URI = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="240" height="240" filter="url(%23n)"/></svg>'
);
const GRUNGE_URI = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="420" height="420"><filter id="g"><feTurbulence type="turbulence" baseFrequency="0.035" numOctaves="3" seed="11" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="420" height="420" filter="url(%23g)"/></svg>'
);

/** Deterministic pseudo-random in [-1, 1] from an integer step. */
function jitter(step: number, salt: number): number {
  const x = Math.sin(step * 12.9898 + salt * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

export default function FilmTreatment(props: FilmTreatmentProps) {
  const {
    children,
    scanLines = true,
    grain = true,
    grunge = true,
    vignette = true,
    grade = true,
    gateWeave = true,
    grainOpacity = 0.55,
    saturate = 0.88,
    contrast = 1.06,
    sepia = 0.12,
    brightness = 0.96,
  } = props;
  const frame = useCurrentFrame();
  // Gate weave: stepped wiggle at 12fps, ~5px total travel, plus the 1.012
  // safety scale so the weave never exposes the frame edge.
  const step = posterizeTime(frame) / 2.5;
  const wx = gateWeave ? jitter(step, 1) * 2.5 : 0;
  const wy = gateWeave ? jitter(step, 2) * 2.5 : 0;
  // Grain crawls: reposition the noise tile on every 12fps step.
  const gx = Math.floor((jitter(step, 3) + 1) * 120);
  const gy = Math.floor((jitter(step, 4) + 1) * 120);

  return (
    <AbsoluteFill style={{ background: '#000', overflow: 'hidden' }}>
      {/* the scene, graded and gate-weaving */}
      <AbsoluteFill
        style={{
          transform: gateWeave ? 'translate(' + wx.toFixed(2) + 'px, ' + wy.toFixed(2) + 'px) scale(1.012)' : undefined,
          filter: grade
            ? 'saturate(' + saturate + ') contrast(' + contrast + ') sepia(' + sepia + ') brightness(' + brightness + ')'
            : undefined,
        }}
      >
        {children}
      </AbsoluteFill>

      {grain ? (
        <AbsoluteFill
          style={{
            pointerEvents: 'none',
            mixBlendMode: 'multiply',
            opacity: grainOpacity,
            backgroundImage: 'url("' + GRAIN_URI + '")',
            backgroundRepeat: 'repeat',
            backgroundPosition: gx + 'px ' + gy + 'px',
          }}
        />
      ) : null}

      {grunge ? (
        <AbsoluteFill
          style={{
            pointerEvents: 'none',
            mixBlendMode: 'color-burn',
            opacity: 0.16,
            backgroundImage: 'url("' + GRUNGE_URI + '")',
            backgroundRepeat: 'repeat',
            backgroundSize: '420px 420px',
          }}
        />
      ) : null}

      {scanLines ? (
        <AbsoluteFill
          style={{
            pointerEvents: 'none',
            opacity: 0.16,
            filter: 'blur(0.7px)',
            backgroundImage: 'repeating-linear-gradient(to bottom, rgba(0,0,0,1) 0px, rgba(0,0,0,1) 1.6px, rgba(0,0,0,0) 1.6px, rgba(0,0,0,0) 8px)',
          }}
        />
      ) : null}

      {vignette ? (
        <AbsoluteFill
          style={{
            pointerEvents: 'none',
            background: 'radial-gradient(ellipse 92% 82% at 50% 48%, rgba(0,0,0,0) 58%, rgba(0,0,0,0.28) 82%, rgba(0,0,0,0.72) 100%)',
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
}
