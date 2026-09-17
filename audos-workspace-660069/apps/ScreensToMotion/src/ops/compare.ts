/**
 * compare — two screenshots split-screen, both pushing inward slowly.
 * Params: { screenA, screenB, split?: 0–1 (divider position) }.
 * Both halves ease with smoothstep and rest for the final 8 frames.
 * Self-contained.
 */
export function compare(frame: number, duration: number, params: any) {
  var split = typeof params.split === 'number' ? params.split : 0.5;
  var window = Math.max(1, duration - 8);
  var t = Math.min(1, Math.max(0, frame / window));
  var s = t * t * (3 - 2 * t);
  var dividerIn = Math.min(1, Math.max(0, frame / 14));
  return {
    split: split,
    scaleA: 1.0 + 0.05 * s,
    scaleB: 1.0 + 0.05 * s,
    dividerT: dividerIn * dividerIn * (3 - 2 * dividerIn),
  };
}
