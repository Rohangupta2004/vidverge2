/**
 * scrollSim — translates a tall screenshot upward with inertia in and out
 * (simulated scroll). Params: { distance?: number (0–1 of image height),
 * easing?: 'inertia' }. Inertia = smootherstep (zero velocity AND zero
 * acceleration at both ends), rest tail of 8 frames. Self-contained.
 */
export function scrollSim(frame: number, duration: number, params: any, ctx: any) {
  var distance = typeof params.distance === 'number' ? params.distance : 0.3;
  var imgH = ctx && ctx.imgH ? ctx.imgH : 1080;
  var viewH = ctx && ctx.height ? ctx.height : 1080;
  var maxTravel = Math.max(0, imgH * (ctx && ctx.fitScale ? ctx.fitScale : 1) - viewH);
  var travel = Math.min(distance * imgH, maxTravel > 0 ? maxTravel : distance * viewH * 0.6);
  var window = Math.max(1, duration - 8);
  var t = Math.min(1, Math.max(0, frame / window));
  var s = t * t * t * (t * (t * 6 - 15) + 10); // smootherstep: inertia in/out
  return { scale: 1.0, x: 0, y: -travel * s, rotateY: 0, originX: 0.5, originY: 0, sweep: 0 };
}
