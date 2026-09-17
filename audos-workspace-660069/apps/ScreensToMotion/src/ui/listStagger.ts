/**
 * listStagger — the region is sliced into rows which re-enter one by one
 * (slide + fade, spring-like ease-out). Region roles: row, card.
 * Params: { rows?: number }. Anything that moves also fades. Ends
 * pixel-identical: each row lands exactly on its source pixels and the
 * plates dissolve over the last 6 frames. Self-contained.
 */
export function listStagger(frame: number, duration: number, params: any, ctx: any) {
  var settle = 6;
  var stagger = (ctx && ctx.preset && ctx.preset.stagger) || 6;
  var rows = typeof params.rows === 'number' ? Math.max(2, Math.min(7, params.rows)) : 4;
  var span = Math.max(6, Math.round(duration * 0.28));
  var out = Math.min(1, Math.max(0, (frame - (duration - settle)) / settle));
  var rowT = [];
  for (var i = 0; i < rows; i++) {
    var local = Math.min(1, Math.max(0, (frame - i * stagger) / span));
    rowT.push(1 - Math.pow(1 - local, 3));
  }
  return { rows: rows, rowT: rowT, rise: 14, plateOpacity: 1 - out, contentOpacity: 1 - out };
}
