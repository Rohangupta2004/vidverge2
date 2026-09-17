/**
 * callout — a typographic label on a leader line anchored to a region edge.
 * Params: { regionId, text, side?: 'left'|'right'|'top'|'bottom', icon? }.
 * Text is transcription or plan copy — the label never covers interface
 * pixels; it sits in the margin beside the anchor. The optional icon enters
 * one stagger step before the label. Self-contained.
 */
export function callout(frame: number, duration: number, params: any, ctx: any) {
  var target = (ctx && ctx.target) || [0.3, 0.3, 0.4, 0.4];
  var side = params.side || 'right';
  var stagger = (ctx && ctx.preset && ctx.preset.stagger) || 6;
  var lineSpan = 14;
  var tLine = Math.min(1, Math.max(0, frame / lineSpan));
  var tIcon = Math.min(1, Math.max(0, (frame - lineSpan) / 14));
  var tText = Math.min(1, Math.max(0, (frame - lineSpan - stagger) / 12));
  var outStart = Math.max(1, duration - 16);
  var alive = 1 - Math.min(1, Math.max(0, (frame - outStart) / 10));
  var smooth = function (v: number) { return v * v * (3 - 2 * v); };
  return {
    target: target,
    side: side,
    lineT: smooth(tLine) * alive,
    iconT: smooth(tIcon) * alive,
    textT: smooth(tText) * alive,
    textRise: (1 - smooth(tText)) * 10,
  };
}
