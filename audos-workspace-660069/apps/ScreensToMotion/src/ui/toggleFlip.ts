/**
 * toggleFlip — a switch/checkbox flips with the row tint following it.
 * Region role: row. Params: { at?: frame }. Spring-flavoured knob travel with
 * object overshoot; ends pixel-identical (the final state matches the
 * screenshot, plate dissolves). Self-contained.
 */
export function toggleFlip(frame: number, duration: number, params: any) {
  var settle = 6;
  var at = typeof params.at === 'number' ? params.at : Math.round(duration * 0.35);
  var span = 14;
  var t = Math.min(1, Math.max(0, (frame - at) / span));
  var e = 1 - Math.pow(1 - t, 3);
  var overshoot = Math.sin(t * Math.PI) * 0.08;
  var out = Math.min(1, Math.max(0, (frame - (duration - settle)) / settle));
  return {
    knobT: Math.min(1, e + overshoot),
    tintT: e,
    plateOpacity: 1 - out,
    contentOpacity: 1 - out,
  };
}
