/**
 * cursor — an eased pointer travels to a region, presses, emits a click
 * ripple, and triggers a state swap. Params: { toRegionId, clickAt: frame,
 * swapTo?: string }. Entrances are springs; the pointer path itself uses a
 * long-window ease so it reads as a hand, not physics. Never combined with
 * focus in the same scene. Self-contained.
 */
export function cursor(frame: number, duration: number, params: any, ctx: any) {
  var clickAt = typeof params.clickAt === 'number' ? params.clickAt : Math.round(duration * 0.5);
  var target = (ctx && ctx.target) || [0.5, 0.5, 0.1, 0.1];
  var tx = target[0] + target[2] / 2, ty = target[1] + target[3] / 2;
  var startX = 0.82, startY = 0.9; // enters from lower right, off the content
  var travel = Math.max(1, clickAt - 6);
  var t = Math.min(1, Math.max(0, frame / travel));
  var s = t * t * (3 - 2 * t);
  var press = frame >= clickAt - 3 && frame < clickAt + 4;
  var rippleT = frame < clickAt ? 0 : Math.min(1, (frame - clickAt) / 18);
  return {
    x: startX + (tx - startX) * s,
    y: startY + (ty - startY) * s,
    visible: frame < duration - 8 ? 1 : 0,
    press: press ? 1 : 0,
    scale: press ? 0.88 : 1,
    rippleT: rippleT,
    rippleOpacity: rippleT > 0 ? (1 - rippleT) * 0.55 : 0,
    swapped: frame >= clickAt ? 1 : 0,
  };
}
