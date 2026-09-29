/**
 * LightBeamTransition — the route/view change.
 *
 * A 2px beam sweeps the full width at ~30% from the top in 0.25s whenever
 * `routeKey` changes. Fast by design: it marks the change, it never gates it.
 *
 * The children stay MOUNTED across the sweep. Unmounting the outgoing view
 * for a quarter second would tear down in-flight uploads, polling loops and
 * player state in these apps, so the light travels over the change instead of
 * blocking it.
 */
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { colors, beamVariants } from '../tokens/colors';
import type { BeamVariant } from '../tokens/colors';
import { beamGradient, beamGlow } from '../animations/beamKeyframes';
import { useBeamStyles, useRiveSlot } from '../animations/useBeamAnimation';

export interface LightBeamTransitionProps {
  riveSrc?: string;
  /** Change this to fire a sweep (the active tab id, screen name, step number). */
  routeKey: string | number;
  children?: ReactNode;
  /** Distance from the top of the wrapper. */
  offsetTop?: string;
  durationMs?: number;
  variant?: BeamVariant;
  /** Sweep on the very first render too. Off by default. */
  sweepOnMount?: boolean;
  className?: string;
  style?: CSSProperties;
}

export default function LightBeamTransition({
  riveSrc, routeKey, children, offsetTop = '30%', durationMs = 250,
  variant = 'info', sweepOnMount = false, className, style,
}: LightBeamTransitionProps) {
  useBeamStyles();
  const rive = useRiveSlot(riveSrc);
  const [sweep, setSweep] = useState(sweepOnMount ? 1 : 0);
  const previous = useRef(routeKey);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (previous.current === routeKey) return;
    previous.current = routeKey;
    setSweep((n) => n + 1);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSweep(0), durationMs + 40);
  }, [routeKey, durationMs]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const v = beamVariants[variant];

  return (
    <div className={className} style={{ position: 'relative', ...style }}>
      {children}
      {sweep > 0 ? (
        rive.active ? (
          <rive.Rive src={riveSrc} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 60 }} />
        ) : (
          <div
            key={'sweep-' + sweep}
            aria-hidden='true'
            style={{ position: 'absolute', left: 0, right: 0, top: offsetTop, height: 2, overflow: 'hidden', pointerEvents: 'none', zIndex: 60 }}
          >
            <div
              data-lb-anim='transition'
              style={{
                position: 'absolute', inset: 0,
                background: beamGradient({ core: v.core, body: v.body, trail: v.trail, bodyWidth: 120, trailWidth: 48 }),
                boxShadow: beamGlow(v.body, 14),
                animation: 'lb-beamTravel ' + durationMs + 'ms linear 1 both',
                willChange: 'transform, opacity',
              }}
            />
          </div>
        )
      ) : null}
    </div>
  );
}

/** The resting page surface every transition sweeps across. */
export const transitionSurface: CSSProperties = { background: colors.bgPrimary, color: colors.textPrimary };
