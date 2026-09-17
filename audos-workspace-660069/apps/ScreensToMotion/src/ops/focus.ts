/**
 * focus — animates the viewport from the full screen down to one region's
 * bbox, holds, and (optionally) settles. Params: { regionId, hold?: frames,
 * ease?: 'smooth' }. The scene resolves the region bbox into ctx.target
 * ([x,y,w,h] normalised). Returns a viewport the Scene maps to
 * scale + translate. Never combined with cursor. Self-contained.
 */
export function focus(frame: number, duration: number, params: any, ctx: any) {
  var target = (ctx && ctx.target) || [0.25, 0.25, 0.5, 0.5];
  var hold = typeof params.hold === 'number' ? params.hold : 30;
  var travel = Math.max(1, duration - hold - 8);
  var t = Math.min(1, Math.max(0, frame / travel));
  var s = t * t * (3 - 2 * t);
  // pad the crop 8% so the region breathes; clamp inside the frame
  var padW = target[2] * 0.08, padH = target[3] * 0.08;
  var x = Math.max(0, target[0] - padW), y = Math.max(0, target[1] - padH);
  var w = Math.min(1 - x, target[2] + padW * 2), h = Math.min(1 - y, target[3] + padH * 2);
  return {
    scale: 1, x: 0, y: 0, rotateY: 0, originX: 0.5, originY: 0.5, sweep: 0,
    viewport: [
      0 + x * s,
      0 + y * s,
      1 + (w - 1) * s,
      1 + (h - 1) * s,
    ],
  };
}
