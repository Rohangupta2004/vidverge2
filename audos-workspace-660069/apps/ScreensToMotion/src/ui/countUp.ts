/**
 * countUp — the metric already in the screenshot counts from 0 to its value,
 * tabular figures, ease-out. Region role: metric. Plate-matched: a plate in
 * the sampled ring colour covers the true pixels, the animated number plays
 * on top, and the plate dissolves out over the final 6 frames so the frame
 * ends pixel-identical to the source crop. Self-contained.
 */
export function countUp(frame: number, duration: number, params: any) {
  var settle = 6; // plate dissolve tail
  var span = Math.max(1, duration - settle - 4);
  var t = Math.min(1, Math.max(0, frame / span));
  var e = 1 - Math.pow(1 - t, 3); // ease-out cubic
  var out = Math.min(1, Math.max(0, (frame - (duration - settle)) / settle));
  return {
    progress: e,             // 0..1 of the target value
    plateOpacity: 1 - out,   // dissolve to true pixels
    contentOpacity: 1 - out,
  };
}
