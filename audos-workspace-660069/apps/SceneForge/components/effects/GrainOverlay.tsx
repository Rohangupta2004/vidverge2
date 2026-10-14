export default function GrainOverlay({ opacity = 0.04 }: { opacity?: number }) {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
      <filter id="sf-grain">
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="4" stitchTiles="stitch" />
        <feDisplacementMap in="SourceGraphic" scale="6" />
      </filter>
      <rect width="100%" height="100%" filter="url(#sf-grain)" opacity={opacity} />
    </svg>
  );
}
