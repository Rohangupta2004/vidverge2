/**
 * tabSlide — the active pill slides between tabs while the content area
 * cross-dissolves. Region role: nav. Params: { fromIndex?, toIndex?, tabs?,
 * at? }. The end state is the screenshot's own active tab (plate dissolve).
 * Self-contained.
 */
export function tabSlide(frame: number, duration: number, params: any) {
  var settle = 6;
  var at = typeof params.at === 'number' ? params.at : Math.round(duration * 0.3);
  var tabs = typeof params.tabs === 'number' ? Math.max(2, Math.min(5, params.tabs)) : 3;
  var fromIndex = typeof params.fromIndex === 'number' ? params.fromIndex : 0;
  var toIndex = typeof params.toIndex === 'number' ? params.toIndex : tabs - 1;
  var span = 14;
  var t = Math.min(1, Math.max(0, (frame - at) / span));
  var e = t * t * (3 - 2 * t);
  var out = Math.min(1, Math.max(0, (frame - (duration - settle)) / settle));
  return {
    tabs: tabs,
    pillT: fromIndex + (toIndex - fromIndex) * e,
    dissolveT: e,
    plateOpacity: 1 - out,
    contentOpacity: 1 - out,
  };
}
