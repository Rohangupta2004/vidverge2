function seededNoise(seed: number, x: number) {
  const v = Math.sin(seed * 12.9898 + x * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

export default function TornEdge({ seed = 1, width = 400, height = 24 }: { seed?: number; width?: number; height?: number }) {
  const points: string[] = [];
  const steps = 24;
  for (let i = 0; i <= steps; i += 1) {
    const x = (i / steps) * width;
    const jag = (seededNoise(seed, i) - 0.5) * height * 0.9;
    points.push(`${x},${height / 2 + jag}`);
  }
  return (
    <svg width={width} height={height} className="pointer-events-none absolute bottom-0 left-0" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <polyline points={points.join(' ')} fill="none" stroke="rgba(26,18,8,0.35)" strokeWidth="2" />
    </svg>
  );
}
