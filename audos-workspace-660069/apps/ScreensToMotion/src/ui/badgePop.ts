/**
 * badgePop — a count badge springs in with overshoot (objects may overshoot;
 * the frame never does). Region roles: nav, row. Params: { at? }.
 * Ends pixel-identical via plate dissolve. Self-contained.
 */
export function badgePop(frame: number, duration: number, params: any) {
  var settle = 6;
  var at = typeof params.at === 'number' ? params.at : Math.round(duration * 0.3);
  var span = 16;
  var t = Math.min(1, Math.max(0, (frame - at) / span));
  // underdamped pop: overshoot then settle
  var e = t >= 1 ? 1 : 1 - Math.pow(2, -8 * t) * Math.cos(t * 7);
  var out = Math.min(1, Math.max(0, (frame - (duration - settle)) / settle));
  return {
    scale: Math.max(0, e),
    opacity: Math.min(1, t * 3) * (1 - out),
    plateOpacity: (frame >= at ? 1 : 0) * (1 - out),
    contentOpacity: (1 - out),
  };
}
