import React from 'react';
import { COLORS } from './theme';

/**
 * Animated light beams radiating out of the center (or the center-bottom edge)
 * of the container. Pure CSS keyframes, opacity-only animation, so the
 * compositor does the work and nothing ticks in JS.
 *
 * Purely decorative: absolutely positioned, pointer-events none, z-index 0.
 */

export interface BeamBackgroundProps {
  /** Beam origin. 'bottom' fans up from the bottom edge, 'center' radiates all round. */
  variant?: 'center' | 'bottom';
  /** Peak opacity of a beam at the top of its pulse. Keep subtle (0.12 default). */
  intensity?: number;
  /** Number of beams. 8-14 reads best. */
  count?: number;
  /** Seconds for one full pulse cycle. */
  duration?: number;
  className?: string;
  style?: React.CSSProperties;
}

export const BEAM_KEYFRAMES = [
  '@keyframes vvBeamPulse {',
  '  0%, 100% { opacity: 0; }',
  '  45% { opacity: var(--vv-beam-peak, 0.14); }',
  '  62% { opacity: calc(var(--vv-beam-peak, 0.14) * 0.6); }',
  '}',
  '@keyframes vvBeamBloom {',
  '  0%, 100% { opacity: 0.5; transform: translate(-50%, -50%) scale(1); }',
  '  50% { opacity: 1; transform: translate(-50%, -50%) scale(1.12); }',
  '}',
  '@media (prefers-reduced-motion: reduce) {',
  '  .vv-beam { animation: none !important; opacity: var(--vv-beam-peak, 0.14); }',
  '  .vv-beam-bloom { animation: none !important; }',
  '}',
].join('\n');

const BeamBackground: React.FC<BeamBackgroundProps> = function BeamBackground({
  variant = 'bottom',
  intensity = 0.12,
  count = 11,
  duration = 7,
  className,
  style,
}) {
  const fromBottom = variant === 'bottom';
  const spread = fromBottom ? 150 : 358;
  const first = fromBottom ? -75 : 0;
  const steps = Math.max(count - 1, 1);

  const beams = [];
  for (let i = 0; i < count; i += 1) {
    beams.push({
      angle: first + (spread / steps) * i,
      delay: ((i * duration) / count / 1.4).toFixed(2),
      length: 58 + ((i * 37) % 40),
      width: i % 3 === 0 ? 2.5 : 1.3,
      peak: i % 3 === 0 ? intensity : intensity * 0.72,
    });
  }

  return (
    <div
      aria-hidden="true"
      className={className}
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: 0,
        ...style,
      }}
    >
      <style>{BEAM_KEYFRAMES}</style>

      <div
        className="vv-beam-bloom"
        style={{
          position: 'absolute',
          left: '50%',
          top: fromBottom ? '100%' : '50%',
          width: 760,
          height: 760,
          transform: 'translate(-50%, -50%)',
          background:
            'radial-gradient(circle, rgba(200,146,10,' +
            (intensity * 1.5).toFixed(3) +
            ') 0%, rgba(224,163,58,' +
            (intensity * 0.65).toFixed(3) +
            ') 40%, rgba(255,253,244,0) 72%)',
          filter: 'blur(14px)',
          animation: 'vvBeamBloom ' + duration * 2.2 + 's ease-in-out infinite',
        }}
      />

      {beams.map(function renderBeam(beam, i) {
        const beamStyle = {
          position: 'absolute',
          left: '50%',
          bottom: fromBottom ? 0 : '50%',
          width: beam.width,
          height: beam.length + '%',
          opacity: 0,
          transformOrigin: 'bottom center',
          transform: 'translateX(-50%) rotate(' + beam.angle + 'deg)',
          background:
            'linear-gradient(to top, rgba(200,146,10,0) 0%, ' +
            COLORS.primary +
            ' 22%, ' +
            COLORS.primaryGlow +
            ' 55%, ' +
            COLORS.accentGlow +
            ' 88%, rgba(224,163,58,0) 100%)',
          filter: 'blur(0.7px)',
          animation:
            'vvBeamPulse ' + duration + 's ease-in-out ' + beam.delay + 's infinite',
        } as React.CSSProperties;
        (beamStyle as Record<string, string>)['--vv-beam-peak'] = String(beam.peak);
        return <div key={i} className="vv-beam" style={beamStyle} />;
      })}
    </div>
  );
};

export default BeamBackground;
