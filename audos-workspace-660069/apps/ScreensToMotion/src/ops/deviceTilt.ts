/**
 * deviceTilt — subtle 3D Y rotation with one light sweep at 6% white.
 * Params: { angle?: number (deg), sweepAt?: number (frame the sweep peaks) }.
 * One glass sweep per video is allowed, and only on deviceTilt.
 * Smoothstep camera easing, 8-frame rest tail. Self-contained.
 */
export function deviceTilt(frame: number, duration: number, params: any) {
  var angle = typeof params.angle === 'number' ? params.angle : 7;
  var sweepAt = typeof params.sweepAt === 'number' ? params.sweepAt : Math.round(duration * 0.45);
  var window = Math.max(1, duration - 8);
  var t = Math.min(1, Math.max(0, frame / window));
  var s = t * t * (3 - 2 * t);
  var sweepSpan = 22;
  var sw = 1 - Math.min(1, Math.abs(frame - sweepAt) / sweepSpan);
  return {
    scale: 1.02,
    x: 0, y: 0,
    rotateY: -angle / 2 + angle * s,
    originX: 0.5, originY: 0.5,
    sweep: Math.max(0, sw * sw) * 0.06, // 6% white, eased peak
  };
}
