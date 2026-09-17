/**
 * push — the default bed. Slow scale 1.00 → 1.06 around an origin.
 * Camera moves use smoothstep on the long window, never springs, and the
 * final 8 frames are held at rest (zero velocity on every layer).
 * Params: { from?: number, to?: number, origin?: [x, y] } (origin normalised).
 *
 * Self-contained pure function — it is embedded byte-for-byte into the
 * rendered Remotion composition via Function.prototype.toString, so it must
 * not reference anything outside its own body.
 */
export function push(frame: number, duration: number, params: any) {
  var from = typeof params.from === 'number' ? params.from : 1.0;
  var to = typeof params.to === 'number' ? params.to : 1.06;
  var origin = Array.isArray(params.origin) ? params.origin : [0.5, 0.5];
  var window = Math.max(1, duration - 8); // rest tail: last 8 frames frozen
  var t = Math.min(1, Math.max(0, frame / window));
  var s = t * t * (3 - 2 * t); // smoothstep
  return {
    scale: from + (to - from) * s,
    x: 0, y: 0, rotateY: 0,
    originX: origin[0], originY: origin[1],
    sweep: 0,
  };
}
