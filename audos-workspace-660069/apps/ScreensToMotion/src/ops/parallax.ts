/**
 * parallax — splits the screen into background / mid / lifted card moving at
 * different rates. Params: { layers?: string[] (region ids back-to-front),
 * depth?: number (0–1 strength) }. Anything that scales also fades slightly
 * at the edges of its travel. Mutually exclusive with lift. Self-contained.
 */
export function parallax(frame: number, duration: number, params: any) {
  var depth = typeof params.depth === 'number' ? params.depth : 0.5;
  var window = Math.max(1, duration - 8);
  var t = Math.min(1, Math.max(0, frame / window));
  var s = t * t * (3 - 2 * t);
  var drift = (s - 0.5) * 2; // -1..1 across the scene
  return {
    // per-layer multipliers, back to front; Scene maps them onto layers
    rates: [0.35 * depth, 0.7 * depth, 1.15 * depth],
    drift: drift,
    travelPx: 26,
    frontScale: 1.02 + 0.02 * s,
  };
}
