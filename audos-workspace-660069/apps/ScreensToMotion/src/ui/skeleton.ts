/**
 * skeleton — placeholder blocks shimmer, then resolve into the real content.
 * Region role: any. Params: { blocks?: number }. The "real content" is the
 * source pixels themselves: the skeleton plate fades away over the final 6
 * frames, which IS the resolve. Self-contained.
 */
export function skeleton(frame: number, duration: number, params: any) {
  var settle = 6;
  var resolveStart = Math.max(1, duration - settle - 10);
  var shimmer = (Math.sin(frame / 7) + 1) / 2;
  var resolveT = Math.min(1, Math.max(0, (frame - resolveStart) / (settle + 10)));
  var r = resolveT * resolveT * (3 - 2 * resolveT);
  return {
    blocks: typeof params.blocks === 'number' ? Math.max(2, Math.min(6, params.blocks)) : 3,
    shimmer: shimmer * (1 - r),
    plateOpacity: 1 - r,
    contentOpacity: 1 - r,
  };
}
