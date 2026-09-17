/**
 * pan — lateral travel across a wide screenshot at fixed scale.
 * Params: { fromX?: number, toX?: number, scale?: number } — fromX/toX are
 * normalised horizontal offsets (-0.5..0.5 of the overscan travel range).
 * Smoothstep easing; final 8 frames at rest. Self-contained (see push.ts).
 */
export function pan(frame: number, duration: number, params: any, ctx: any) {
  var fromX = typeof params.fromX === 'number' ? params.fromX : -0.5;
  var toX = typeof params.toX === 'number' ? params.toX : 0.5;
  var scale = typeof params.scale === 'number' ? params.scale : 1.12;
  var travel = (ctx && ctx.width ? ctx.width : 1920) * 0.06;
  var window = Math.max(1, duration - 8);
  var t = Math.min(1, Math.max(0, frame / window));
  var s = t * t * (3 - 2 * t);
  return {
    scale: scale,
    x: (fromX + (toX - fromX) * s) * travel,
    y: 0, rotateY: 0, originX: 0.5, originY: 0.5, sweep: 0,
  };
}
