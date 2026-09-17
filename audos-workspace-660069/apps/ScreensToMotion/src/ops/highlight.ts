/**
 * highlight — an animated bracket/ring draws around a region while everything
 * outside dims. Params: { regionId, dim?: 0–1, style?: 'ring' | 'bracket' }.
 * Also the universal fallback when a UI motion op's plate ring varies more
 * than 6% luminance. Self-contained.
 */
export function highlight(frame: number, duration: number, params: any, ctx: any) {
  var dim = typeof params.dim === 'number' ? params.dim : 0.42;
  var style = params.style === 'bracket' ? 'bracket' : 'ring';
  var target = (ctx && ctx.target) || [0.3, 0.3, 0.4, 0.4];
  var inSpan = 16;
  var outStart = Math.max(inSpan, duration - 20);
  var tIn = Math.min(1, Math.max(0, frame / inSpan));
  var tOut = Math.min(1, Math.max(0, (frame - outStart) / 12));
  var draw = tIn * tIn * (3 - 2 * tIn);
  var alive = 1 - tOut * tOut * (3 - 2 * tOut);
  return {
    target: target,
    style: style,
    drawT: draw,           // stroke draw-on 0..1
    dim: dim * draw * alive,
    ringOpacity: draw * alive,
  };
}
