/**
 * lift — crops a region and floats it above the blurred full screen with a
 * two-part shadow (tight contact + wide soft) at 1.08 scale.
 * Params: { regionId, blur?: px, shadow?: 0–1 }.
 * Background blur ramps 0 → 8px over the lift's duration. Springs enter the
 * lifted card (objects may overshoot; the frame never does).
 * Mutually exclusive with parallax. Self-contained pure data function.
 */
export function lift(frame: number, duration: number, params: any, ctx: any) {
  var maxBlur = typeof params.blur === 'number' ? params.blur : 8;
  var shadow = typeof params.shadow === 'number' ? params.shadow : 0.5;
  var inSpan = Math.min(24, Math.max(8, Math.round(duration * 0.2)));
  var t = Math.min(1, Math.max(0, frame / inSpan));
  // critically-damped-ish enter with a small object overshoot
  var e = 1 - Math.pow(1 - t, 3);
  var overshoot = Math.sin(Math.min(1, t) * Math.PI) * 0.012;
  var rampT = Math.min(1, Math.max(0, frame / Math.max(1, duration - 8)));
  return {
    liftScale: 1 + (0.08 + overshoot) * e,
    liftOpacity: Math.min(1, t * 1.6),
    bgBlur: maxBlur * rampT,
    contactShadow: shadow * e,
    softShadow: shadow * 0.6 * e,
  };
}
