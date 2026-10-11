// A looping, live thumbnail of ONE scene's visual.
//
// The scene plan is the thing the customer reviews before paying for two
// renders, so the review has to show the actual graphic rather than describe
// it. This runs the same component the film uses, scaled down, looping on its
// own clock.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SceneSpec } from '../../lib/sceneSpec';
import VisualRouter from '../visuals/VisualRouter';
import { DIRECTOR_THEME } from '../visuals/visualTheme';

const FRAME_W = 1920;
const FRAME_H = 1080;

export interface SceneThumbProps {
  spec: SceneSpec;
  accent?: string;
  /** Freeze on a settled frame instead of looping (cheaper for long lists). */
  still?: boolean;
}

export default function SceneThumb({ spec, accent = DIRECTOR_THEME.accent, still = false }: SceneThumbProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef(0);
  const [scale, setScale] = useState(0.2);
  const [progress, setProgress] = useState(still ? 0.85 : 0);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => setScale(Math.max(0.02, host.clientWidth / FRAME_W));
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (observer) observer.observe(host);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  useEffect(() => {
    if (still) { setProgress(0.85); return; }
    // The loop holds on the settled frame for a beat before restarting, so a
    // scrolling list of thumbnails is readable rather than strobing.
    const cycle = (Math.max(1.6, spec.durationSec) + 1.2) * 1000;
    const started = performance.now();
    const tick = () => {
      const elapsed = (performance.now() - started) % cycle;
      setProgress(Math.min(1, elapsed / (spec.durationSec * 1000)));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [spec.durationSec, spec.scene, still]);

  return (
    <div ref={hostRef} style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', overflow: 'hidden', borderRadius: 12, background: DIRECTOR_THEME.bg }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: FRAME_W, height: FRAME_H, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(1400px 760px at 50% -12%, ${accent}1f, transparent 62%)` }} />
        <VisualRouter spec={spec} progress={progress} accent={accent} />
      </div>
    </div>
  );
}
