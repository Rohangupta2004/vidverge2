/**
 * progressFill — a bar or ring fills to the value shown in the screenshot.
 * Region roles: metric, panel. Params: { value?: 0–1, variant?: 'bar'|'ring' }.
 * Ease-out, plate dissolve tail. Self-contained.
 */
export function progressFill(frame: number, duration: number, params: any) {
  var settle = 6;
  var value = typeof params.value === 'number' ? Math.min(1, Math.max(0, params.value)) : 0.72;
  var span = Math.max(1, duration - settle - 4);
  var t = Math.min(1, Math.max(0, frame / span));
  var e = 1 - Math.pow(1 - t, 3);
  var out = Math.min(1, Math.max(0, (frame - (duration - settle)) / settle));
  return {
    variant: params.variant === 'ring' ? 'ring' : 'bar',
    fillT: e * value,
    plateOpacity: 1 - out,
    contentOpacity: 1 - out,
  };
}
