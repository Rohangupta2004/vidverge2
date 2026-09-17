/**
 * chartDraw — bars grow from the baseline, or a line draws left→right,
 * over a plate covering the chart region. Region roles: media, panel.
 * Params: { variant?: 'bars' | 'line', bars?: number }. Ends pixel-identical
 * via the 6-frame plate dissolve. Self-contained.
 */
export function chartDraw(frame: number, duration: number, params: any, ctx: any) {
  var settle = 6;
  var stagger = (ctx && ctx.preset && ctx.preset.stagger) || 5;
  var bars = typeof params.bars === 'number' ? Math.max(3, Math.min(8, params.bars)) : 5;
  var span = Math.max(1, duration - settle - stagger * bars - 2);
  var out = Math.min(1, Math.max(0, (frame - (duration - settle)) / settle));
  var heights = [];
  for (var i = 0; i < bars; i++) {
    var local = Math.min(1, Math.max(0, (frame - i * stagger) / span));
    heights.push(1 - Math.pow(1 - local, 3));
  }
  var lineT = Math.min(1, Math.max(0, frame / Math.max(1, duration - settle - 2)));
  return {
    variant: params.variant === 'line' ? 'line' : 'bars',
    barT: heights,
    lineT: lineT * lineT * (3 - 2 * lineT),
    plateOpacity: 1 - out,
    contentOpacity: 1 - out,
  };
}
