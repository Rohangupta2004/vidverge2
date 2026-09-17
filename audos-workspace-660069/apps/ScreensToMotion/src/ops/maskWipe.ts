/**
 * maskWipe — reveals the NEXT screenshot behind a moving soft edge.
 * Params: { angle?: deg, softness?: px }. The Scene supplies the incoming
 * image; this op only computes the wipe geometry. Smoothstep, 8-frame rest
 * tail (the wipe fully resolves before the tail). Self-contained.
 */
export function maskWipe(frame: number, duration: number, params: any) {
  var angle = typeof params.angle === 'number' ? params.angle : 18;
  var softness = typeof params.softness === 'number' ? params.softness : 90;
  var window = Math.max(1, duration - 8);
  var t = Math.min(1, Math.max(0, frame / window));
  var s = t * t * (3 - 2 * t);
  return {
    angle: angle,
    softness: softness,
    // wipe travels from -softness beyond the left edge to full cover
    progress: s,
  };
}
