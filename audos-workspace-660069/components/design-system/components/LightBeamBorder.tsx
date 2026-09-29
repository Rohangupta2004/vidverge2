/**
 * LightBeamBorder — a 1px border with a beam that travels the border path.
 *
 * The beam is an SVG rect stroke animated with stroke-dasharray /
 * stroke-dashoffset, so it follows the rounded corners exactly: top → right
 * → bottom → left. `pathLength=100` normalises the perimeter, which is what
 * lets one dash pattern work at any container size without measuring.
 *
 * Two synchronised strokes make the light directional: a 16-unit gold body,
 * and a 4-unit white-hot core sitting at the body's leading edge (the core's
 * dash pattern starts with a 12-unit gap, so both share one offset and one
 * speed while the core still leads).
 *
 * Dormant it renders nothing but the static border — an inactive container
 * must be completely still.
 */
import type { CSSProperties, ReactNode } from 'react';
import { colors, beamVariants } from '../tokens/colors';
import type { BeamVariant } from '../tokens/colors';
import { radii, radiiPx } from '../tokens/radii';
import { useBeamStyles, useRiveSlot } from '../animations/useBeamAnimation';

export interface LightBeamBorderProps {
  riveSrc?: string;
  /** Run the beam. Dormant borders never animate. */
  active?: boolean;
  /** Keep looping while active (inputs on focus). Default: one pass. */
  loop?: boolean;
  radius?: number;
  variant?: BeamVariant;
  state?: 'idle' | 'processing' | 'complete' | 'error';
  durationMs?: number;
  /** Wrap content, or leave empty to overlay a positioned parent. */
  children?: ReactNode;
  /** Paint the resting 1px border too (off when the parent already has one). */
  showRestingBorder?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Extra key that restarts the pass (e.g. a run id). */
  runKey?: string | number;
}

export default function LightBeamBorder({
  riveSrc, active = false, loop = false, radius = radiiPx.lg, variant = 'info', state,
  durationMs, children, showRestingBorder = true, className, style, runKey,
}: LightBeamBorderProps) {
  useBeamStyles();
  const rive = useRiveSlot(riveSrc);
  const v = state === 'error' ? beamVariants.error : state === 'complete' ? beamVariants.success : beamVariants[variant];
  const ms = durationMs ?? (loop ? 1800 : 1100);
  const timing = ms + 'ms linear ' + (loop ? 'infinite' : '1 both');

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        borderRadius: radius,
        border: showRestingBorder ? '1px solid ' + (active ? colors.borderActive : colors.borderSubtle) : undefined,
        transition: 'border-color 0.2s ease',
        ...style,
      }}
    >
      {children}
      {rive.active ? (
        <rive.Rive src={riveSrc} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
      ) : active ? (
        <svg
          key={'trace-' + String(runKey ?? '') + '-' + (loop ? 'loop' : 'once')}
          aria-hidden='true'
          style={{ position: 'absolute', top: 0.5, left: 0.5, right: 0.5, bottom: 0.5, pointerEvents: 'none', overflow: 'visible' }}
        >
          <rect
            data-lb-anim='border-body'
            x={0}
            y={0}
            width='100%'
            height='100%'
            rx={radius}
            ry={radius}
            pathLength={100}
            fill='none'
            stroke={v.body}
            strokeWidth={1}
            strokeDasharray='16 84'
            style={{ strokeDashoffset: 100, animation: 'lb-borderTrace ' + timing, filter: 'drop-shadow(0 0 4px ' + colors.beamGlow + ')' }}
          />
          <rect
            data-lb-anim='border-core'
            x={0}
            y={0}
            width='100%'
            height='100%'
            rx={radius}
            ry={radius}
            pathLength={100}
            fill='none'
            stroke={v.core}
            strokeWidth={1.4}
            strokeDasharray='0 12 4 84'
            style={{ strokeDashoffset: 100, animation: 'lb-borderTrace ' + timing }}
          />
        </svg>
      ) : null}
    </div>
  );
}

/** Shared resting surface for anything wrapped in a LightBeam border. */
export const glassSurface: CSSProperties = {
  background: colors.bgGlass,
  borderRadius: radii.lg,
};
