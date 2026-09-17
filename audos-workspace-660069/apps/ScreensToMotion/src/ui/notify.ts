/**
 * notify — a toast slides in from a frame edge, holds, and slides out.
 * FRAME-anchored (not region-anchored): it lives in the margin/scrim area and
 * never covers interface pixels, so it needs no plate; it simply must be gone
 * by the rest tail. Params: { text, side?: 'top'|'bottom' }. Self-contained.
 */
export function notify(frame: number, duration: number, params: any) {
  var inSpan = 12;
  var outSpan = 12;
  var gone = duration - 8; // fully out before the scene's rest tail
  var outStart = gone - outSpan;
  var tIn = Math.min(1, Math.max(0, frame / inSpan));
  var tOut = Math.min(1, Math.max(0, (frame - outStart) / outSpan));
  var eIn = 1 - Math.pow(1 - tIn, 3);
  var eOut = tOut * tOut * (3 - 2 * tOut);
  return {
    side: params.side === 'top' ? 'top' : 'bottom',
    slideT: eIn * (1 - eOut),
    opacity: Math.min(1, tIn * 2) * (1 - eOut),
    plateOpacity: 0,
    contentOpacity: eIn * (1 - eOut),
  };
}
