/**
 * Blank-plate corner pin (Phase 2 §10) — solve the homography from the
 * screenshot's four corners to the tracked screen quad and emit it as a CSS
 * matrix3d; corner keyframes are linearly interpolated (2–4 keyframes for
 * constrained shots — more than 4 is rejected by plan validation).
 *
 * Both functions are SELF-CONTAINED pure functions (no captured scope) so the
 * composition assembler can embed them byte-for-byte via
 * Function.prototype.toString, exactly like the camera/UI ops.
 */

/**
 * Homography mapping the rect (0,0)-(srcW,srcH) onto the four tracked corner
 * points (normalised 0–1 within a boxW x boxH clip box). Returns a CSS
 * 'matrix3d(…)' string for use with transformOrigin '0 0', or null when the
 * quad is degenerate.
 */
export function plateMatrix3d(
  srcW: number,
  srcH: number,
  corners: { tl: number[]; tr: number[]; br: number[]; bl: number[] },
  boxW: number,
  boxH: number,
): string | null {
  var src = [[0, 0], [srcW, 0], [srcW, srcH], [0, srcH]];
  var dst = [
    [corners.tl[0] * boxW, corners.tl[1] * boxH],
    [corners.tr[0] * boxW, corners.tr[1] * boxH],
    [corners.br[0] * boxW, corners.br[1] * boxH],
    [corners.bl[0] * boxW, corners.bl[1] * boxH],
  ];
  // 8 DLT equations in h0..h7 (h8 = 1), solved by Gauss-Jordan w/ partial pivot.
  var A: number[][] = [];
  for (var i = 0; i < 4; i++) {
    var x = src[i][0], y = src[i][1], u = dst[i][0], v = dst[i][1];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (var col = 0; col < 8; col++) {
    var pivot = col;
    for (var r = col + 1; r < 8; r++) if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
    if (Math.abs(A[pivot][col]) < 1e-9) return null;
    var swap = A[col]; A[col] = A[pivot]; A[pivot] = swap;
    for (var rr = 0; rr < 8; rr++) {
      if (rr === col) continue;
      var factor = A[rr][col] / A[col][col];
      for (var cc = col; cc < 9; cc++) A[rr][cc] -= factor * A[col][cc];
    }
  }
  var h: number[] = [];
  for (var k = 0; k < 8; k++) h.push(A[k][8] / A[k][k]);
  // Column-major CSS matrix3d with the projective terms in the 4th row.
  var m = [h[0], h[3], 0, h[6], h[1], h[4], 0, h[7], 0, 0, 1, 0, h[2], h[5], 0, 1];
  return 'matrix3d(' + m.join(',') + ')';
}

/**
 * Linear interpolation between plate corner keyframes ({ at, tl, tr, br, bl }
 * sorted by at), clamped at both ends.
 */
export function interpolatePlateCorners(
  keys: Array<{ at: number; tl: number[]; tr: number[]; br: number[]; bl: number[] }>,
  frame: number,
): { at: number; tl: number[]; tr: number[]; br: number[]; bl: number[] } | null {
  if (!keys || keys.length === 0) return null;
  if (keys.length === 1 || frame <= keys[0].at) return keys[0];
  var last = keys[keys.length - 1];
  if (frame >= last.at) return last;
  for (var i = 0; i < keys.length - 1; i++) {
    var a = keys[i], b = keys[i + 1];
    if (frame >= a.at && frame <= b.at) {
      var t = (frame - a.at) / Math.max(1, b.at - a.at);
      var mix = function (p: number[], q: number[]) { return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]; };
      return { at: frame, tl: mix(a.tl, b.tl), tr: mix(a.tr, b.tr), br: mix(a.br, b.br), bl: mix(a.bl, b.bl) };
    }
  }
  return last;
}
