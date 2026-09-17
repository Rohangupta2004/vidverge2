/**
 * typeIn — the region's transcribed text types in behind a blinking caret at
 * reading speed. Region roles: headline, form. Params: { text } (transcription
 * only — never generated copy). Ends pixel-identical via plate dissolve.
 * Self-contained.
 */
export function typeIn(frame: number, duration: number, params: any) {
  var settle = 6;
  var text = String(params.text || '');
  var chars = Math.max(1, text.length);
  // reading speed: ~1.4 chars per frame at 30fps ≈ 42 chars/sec cap
  var perChar = Math.max(0.7, Math.min(2.2, (duration - settle - 12) / chars));
  var visible = Math.min(chars, Math.floor(frame / perChar));
  var caretOn = Math.floor(frame / 16) % 2 === 0 ? 1 : 0;
  var out = Math.min(1, Math.max(0, (frame - (duration - settle)) / settle));
  return {
    visibleChars: visible,
    caret: (visible < chars ? 1 : caretOn) * (1 - out),
    plateOpacity: 1 - out,
    contentOpacity: 1 - out,
  };
}
