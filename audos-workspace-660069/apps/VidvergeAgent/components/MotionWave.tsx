import { useEffect, useRef } from 'react';
import type { AgentState } from '../types';

/**
 * The wave is the agent's identity: a bundle of parallel light trails that fall
 * into a smooth V and rise again, with a bright segment travelling along the
 * main path. Pure SVG + CSS keyframes - no video, canvas or animation library.
 */
const WAVE_D =
  'M0,114 C140,102 250,88 350,124 C420,150 470,200 520,204 C580,209 640,168 730,136 C850,94 1030,92 1200,100';

const TRAILS: Array<{ offset: number; opacity: number; width: number }> = [
  { offset: -13, opacity: 0.2, width: 1 },
  { offset: -7, opacity: 0.35, width: 1 },
  { offset: 0, opacity: 1, width: 1.8 },
  { offset: 7, opacity: 0.6, width: 1.1 },
  { offset: 14, opacity: 0.22, width: 1 },
];

const WAVE_CSS = `
.vva-wave {
  position: relative;
  width: 100%;
  height: 100%;
  --vv-travel: 4.4s;
  --vv-breath: 7s;
  --vv-shimmer: 5.2s;
}
.vva-wave svg { display: block; width: 100%; height: 100%; }
.vva-wave path { fill: none; stroke-linecap: round; stroke-linejoin: round; }

.vva-trails { animation: vva-breathe var(--vv-breath) ease-in-out infinite; }
.vva-trail-main { animation: vva-shimmer var(--vv-shimmer) ease-in-out infinite; }

.vva-trail-alt { opacity: 0; transition: opacity 600ms ease; }

.vva-spark {
  stroke-dasharray: 58 942;
  stroke-dashoffset: 0;
  animation: vva-travel var(--vv-travel) linear infinite;
}
.vva-spark-glow { opacity: 0.42; }
.vva-spark-core { opacity: 0.95; }

.vva-sweep {
  stroke-dasharray: 1000 1000;
  stroke-dashoffset: 1000;
  opacity: 0;
}
.vva-sweep-run { animation: vva-sweep 1500ms cubic-bezier(0.22, 0.61, 0.36, 1) forwards; }

.vva-wave[data-state='working'] {
  --vv-travel: 1.5s;
  --vv-breath: 3.2s;
  --vv-shimmer: 1.8s;
}
.vva-wave[data-state='working'] .vva-spark-glow { opacity: 0.85; stroke-width: 6; }
.vva-wave[data-state='working'] .vva-spark-core { stroke-width: 2.3; }

.vva-wave[data-state='completed'] .vva-spark { opacity: 0.2; }

.vva-wave[data-state='error'] { --vv-travel: 6.5s; --vv-breath: 5.5s; }
.vva-wave[data-state='error'] .vva-trail-alt {
  opacity: 0.7;
  animation: vva-error-pulse 3.2s ease-in-out infinite;
}
.vva-wave[data-state='error'] .vva-spark-core { stroke: var(--vv-error, #f87171); }
.vva-wave[data-state='error'] .vva-spark-glow { stroke: var(--vv-error, #f87171); opacity: 0.28; }

.vva-wave.vva-calm { --vv-travel: 11s; --vv-breath: 14s; --vv-shimmer: 12s; }
.vva-wave.vva-calm .vva-spark-glow { opacity: 0.22; }

@keyframes vva-travel {
  from { stroke-dashoffset: 0; }
  to { stroke-dashoffset: -1000; }
}
@keyframes vva-breathe {
  0%, 100% { opacity: 0.74; }
  50% { opacity: 1; }
}
@keyframes vva-shimmer {
  0%, 100% { opacity: 0.78; }
  50% { opacity: 1; }
}
@keyframes vva-sweep {
  0% { stroke-dashoffset: 1000; opacity: 0; }
  14% { opacity: 1; }
  55% { stroke-dashoffset: 0; opacity: 1; }
  100% { stroke-dashoffset: 0; opacity: 0; }
}
@keyframes vva-error-pulse {
  0%, 100% { opacity: 0.32; }
  50% { opacity: 0.78; }
}
@media (prefers-reduced-motion: reduce) {
  .vva-trails,
  .vva-trail-main,
  .vva-spark,
  .vva-trail-alt,
  .vva-sweep-run { animation: none; }
}
`;

let waveInstances = 0;

interface MotionWaveProps {
  state?: AgentState;
  calm?: boolean;
  className?: string;
}

export default function MotionWave({ state = 'idle', calm = false, className = '' }: MotionWaveProps) {
  const sweepRef = useRef<SVGPathElement | null>(null);
  const idRef = useRef('');
  if (!idRef.current) {
    waveInstances += 1;
    idRef.current = `vvw${waveInstances}`;
  }
  const uid = idRef.current;

  // The completed sweep is a one-shot animation, so it has to be re-armed every
  // time the state lands on 'completed' - removing the class and forcing a
  // reflow before adding it back is what restarts it.
  useEffect(() => {
    const el = sweepRef.current;
    if (!el) return;
    el.classList.remove('vva-sweep-run');
    if (state !== 'completed') return;
    void el.getBoundingClientRect();
    el.classList.add('vva-sweep-run');
  }, [state]);

  return (
    <div data-state={state} className={`vva-wave${calm ? ' vva-calm' : ''} ${className}`}>
      <style>{WAVE_CSS}</style>
      <svg viewBox="0 0 1200 240" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id={`${uid}-trail`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="var(--vv-gold, #D4920A)" stopOpacity="0" />
            <stop offset="20%" stopColor="var(--vv-gold, #D4920A)" stopOpacity="0.65" />
            <stop offset="52%" stopColor="var(--vv-accent-light, #FFD168)" stopOpacity="1" />
            <stop offset="82%" stopColor="var(--vv-gold-light, #F0B429)" stopOpacity="0.6" />
            <stop offset="100%" stopColor="var(--vv-gold, #D4920A)" stopOpacity="0" />
          </linearGradient>
          <filter id={`${uid}-glow`} x="-15%" y="-150%" width="130%" height="400%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
          <filter id={`${uid}-soft`} x="-15%" y="-150%" width="130%" height="400%">
            <feGaussianBlur stdDeviation="2.2" />
          </filter>
        </defs>

        <g className="vva-trails">
          {TRAILS.map((trail) => (
            <path
              key={trail.offset}
              className={trail.offset === 0 ? 'vva-trail vva-trail-main' : 'vva-trail'}
              d={WAVE_D}
              transform={`translate(0 ${trail.offset})`}
              stroke={`url(#${uid}-trail)`}
              strokeWidth={trail.width}
              opacity={trail.opacity}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>

        <path
          className="vva-trail-alt"
          d={WAVE_D}
          transform="translate(0 7)"
          stroke="var(--vv-error, #f87171)"
          strokeWidth={1.4}
          vectorEffect="non-scaling-stroke"
        />

        <path
          className="vva-spark vva-spark-glow"
          d={WAVE_D}
          pathLength={1000}
          stroke="var(--vv-gold, #D4920A)"
          strokeWidth={4}
          filter={`url(#${uid}-glow)`}
          vectorEffect="non-scaling-stroke"
        />
        <path
          className="vva-spark vva-spark-core"
          d={WAVE_D}
          pathLength={1000}
          stroke="var(--vv-accent-light, #FFD168)"
          strokeWidth={1.9}
          filter={`url(#${uid}-soft)`}
          vectorEffect="non-scaling-stroke"
        />

        <path
          ref={sweepRef}
          className="vva-sweep"
          d={WAVE_D}
          pathLength={1000}
          stroke="var(--vv-accent-light, #FFD168)"
          strokeWidth={2.2}
          filter={`url(#${uid}-soft)`}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
