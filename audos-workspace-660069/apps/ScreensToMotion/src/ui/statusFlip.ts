/**
 * statusFlip — a status pill changes label and colour (e.g. pending →
 * confirmed). Region roles: row, card. Params: { fromText, toText, at? }.
 * The final pill matches the screenshot's own pixels (plate dissolve).
 * Self-contained.
 */
export function statusFlip(frame: number, duration: number, params: any) {
  var settle = 6;
  var at = typeof params.at === 'number' ? params.at : Math.round(duration * 0.4);
  var span = 12;
  var t = Math.min(1, Math.max(0, (frame - at) / span));
  var e = t * t * (3 - 2 * t);
  var out = Math.min(1, Math.max(0, (frame - (duration - settle)) / settle));
  return {
    flipT: e,           // 0 = from-state, 1 = to-state
    popScale: 1 + Math.sin(e * Math.PI) * 0.06,
    plateOpacity: 1 - out,
    contentOpacity: 1 - out,
  };
}
