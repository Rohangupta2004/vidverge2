import React from 'react';

/**
 * Subtle gold dot grid that sits behind app content. 20px spacing, 1px dots,
 * faded out towards the edges with a radial mask so it never fights the
 * content column.
 *
 * Decorative only: absolutely positioned, pointer-events none, z-index 0.
 */

export interface GridOverlayProps {
  /** Dot pitch in px. */
  spacing?: number;
  /** Dot color. Defaults to the brand gold at 14%. */
  color?: string;
  /** Overall layer opacity. */
  opacity?: number;
  className?: string;
  style?: React.CSSProperties;
}

const GridOverlay: React.FC<GridOverlayProps> = function GridOverlay({
  spacing = 20,
  color = 'rgba(180,120,0,0.14)',
  opacity = 1,
  className,
  style,
}) {
  const mask =
    'radial-gradient(ellipse 85% 70% at 50% 35%, #000 0%, rgba(0,0,0,0.55) 55%, transparent 100%)';

  return (
    <div
      aria-hidden="true"
      className={className}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 0,
        opacity,
        backgroundImage: 'radial-gradient(' + color + ' 1px, transparent 1px)',
        backgroundSize: spacing + 'px ' + spacing + 'px',
        backgroundPosition: 'center center',
        WebkitMaskImage: mask,
        maskImage: mask,
        ...style,
      }}
    />
  );
};

export default GridOverlay;
