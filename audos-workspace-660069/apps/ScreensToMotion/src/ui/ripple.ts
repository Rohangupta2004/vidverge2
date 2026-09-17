/**
 * ripple — a click ripple under the cursor on press. Region role: cta.
 * The one UI op a cursor-accent scene fires after its click (budget rule).
 * Params: { at: frame (should equal the cursor's clickAt) }. Leaves no trace:
 * fully faded before the rest tail, no plate needed. Self-contained.
 */
export function ripple(frame: number, duration: number, params: any) {
  var at = typeof params.at === 'number' ? params.at : Math.round(duration * 0.5);
  var span = 20;
  var t = Math.min(1, Math.max(0, (frame - at) / span));
  var e = 1 - Math.pow(1 - t, 2);
  return {
    radiusT: e,
    opacity: t > 0 ? (1 - t) * 0.5 : 0,
    plateOpacity: 0,
    contentOpacity: t > 0 ? 1 - t : 0,
  };
}
