import { useEffect, useState } from 'react';

const FRAME_BARS = [42, 70, 52, 84, 36, 66];

function VideoFrame({ index }: { index: number }) {
  return (
    <div className={`vv-css-frame vv-css-frame-${index + 1}`}>
      <div className="vv-css-frame-edge" aria-hidden />
      <div className="vv-css-frame-screen">
        <span className="vv-css-frame-scene" />
        <span className="vv-css-frame-play">▶</span>
      </div>
      <div className="vv-css-frame-timeline">
        {FRAME_BARS.map((height, bar) => (
          <i key={bar} style={{ height: `${height}%` }} />
        ))}
      </div>
    </div>
  );
}

/**
 * React Three Fiber previously loaded a second React-compatible runtime from
 * esm.sh during module evaluation. When that runtime did not match the host
 * React build the landing page crashed before an error boundary could mount.
 *
 * This scene deliberately uses dependency-free CSS 3D instead: the stacked
 * video frames have perspective, extrusion and continuous rotation, while the
 * data-flat state remains readable in browsers without preserve-3d support.
 */
export function HeroSceneFallback() {
  const [flat, setFlat] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotion = () => setReducedMotion(motionQuery.matches);
    updateMotion();
    motionQuery.addEventListener?.('change', updateMotion);

    const supports3d = typeof CSS !== 'undefined'
      && CSS.supports?.('transform-style', 'preserve-3d')
      && CSS.supports?.('perspective', '800px');
    setFlat(!supports3d);

    return () => motionQuery.removeEventListener?.('change', updateMotion);
  }, []);

  return (
    <div
      className="vv-hero-fallback"
      data-flat={flat ? 'true' : 'false'}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      aria-label="Three floating 3D video preview frames"
    >
      <div className="vv-css-stage" aria-hidden>
        <div className="vv-css-halo vv-css-halo-one" />
        <div className="vv-css-halo vv-css-halo-two" />
        <div className="vv-css-object">
          {[0, 1, 2].map((index) => <VideoFrame key={index} index={index} />)}
          <div className="vv-css-logo-extrusion">
            {[0, 1, 2, 3, 4].map(layer => (
              <span key={layer} style={{ transform: `translateZ(${layer * 7}px)` }}>V</span>
            ))}
          </div>
        </div>
        <div className="vv-css-floor" />
      </div>
    </div>
  );
}

export default function HeroScene() {
  return <HeroSceneFallback />;
}
