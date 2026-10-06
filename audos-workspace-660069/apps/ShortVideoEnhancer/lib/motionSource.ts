/**
 * Short Video Enhancer — the MOTION ENGINE source.
 *
 * This is deliberately a string, not a module: the exact same text is
 *   (a) transpiled by sucrase and mounted in the in-app Remotion <Player />
 *       (lib/player.ts), and
 *   (b) submitted to the platform Remotion render service (lib/composition.ts).
 *
 * There is therefore ONE implementation of every easing curve, transition,
 * caption animation and motion-graphic primitive, and the preview cannot drift
 * from the render — it is literally the same code running in both places. The
 * only difference between the two is the canvas resolution, and the engine
 * lays everything out in 1080x1920 design pixels and scales that stage
 * uniformly, so framing is identical at either size.
 *
 * Constraints this text must respect: no template literals and no imports
 * beyond `remotion` / `react`, because it travels inside a JSON body and is
 * compiled in isolation.
 */

export const SVE_MOTION_SOURCE = `
const DESIGN_W = 1080;
const DESIGN_H = 1920;

const FONT_CSS = '@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Anton&family=Bebas+Neue&family=Montserrat:wght@400;600;800;900&family=Oswald:wght@400;600;700&family=Playfair+Display:wght@400;700;900&family=DM+Sans:wght@400;500;700;900&family=JetBrains+Mono:wght@400;700&display=swap");';

const FONT_FAMILIES = {
  inter: "'Inter', system-ui, -apple-system, sans-serif",
  anton: "'Anton', Impact, sans-serif",
  bebas: "'Bebas Neue', Impact, sans-serif",
  montserrat: "'Montserrat', 'Inter', sans-serif",
  oswald: "'Oswald', 'Inter', sans-serif",
  playfair: "'Playfair Display', Georgia, serif",
  dmsans: "'DM Sans', 'Inter', sans-serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
};
function fontCss(id) { return FONT_FAMILIES[id] || FONT_FAMILIES.inter; }

function num(v, fb) { const n = Number(v); return Number.isFinite(n) ? n : fb; }
function clamp01(v) { return Math.max(0, Math.min(1, num(v, 0))); }
function clampN(v, lo, hi) { return Math.max(lo, Math.min(hi, num(v, lo))); }
function lerp(a, b, t) { return a + (b - a) * t; }

// --- easing -----------------------------------------------------------------
function ease(id, raw) {
  const t = clamp01(raw);
  if (id === 'linear') return t;
  if (id === 'easeIn') return t * t * t;
  if (id === 'easeInOut') return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  if (id === 'expoOut') return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
  if (id === 'back') { const c1 = 1.70158; const c3 = c1 + 1; const x = t - 1; return 1 + c3 * x * x * x + c1 * x * x; }
  if (id === 'spring') {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return 1 - Math.pow(2, -9 * t) * Math.cos(t * 13.5);
  }
  return 1 - Math.pow(1 - t, 3);
}

function windowProgress(frame, from, frames) {
  if (!frames || frames <= 0) return 1;
  return clamp01((frame - from) / frames);
}

// --- keyframes --------------------------------------------------------------
// A keyframed channel replaces that channel's ramp for the layer's whole life.
// The curve maths below is the same as lib/model.ts's keyEase, so the little
// graph in the keyframe editor is showing the real interpolation.

function keyEase(id, raw) {
  const t = clamp01(raw);
  if (id === 'linear') return t;
  if (id === 'easeIn') return t * t * t;
  if (id === 'easeOut') return 1 - Math.pow(1 - t, 3);
  if (id === 'easeInOut') return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  if (id === 'spring') {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return 1 - Math.pow(2, -9 * t) * Math.cos(t * 13.5);
  }
  return t;
}

function sortedKeys(keys) {
  return keys.slice().sort(function (a, b) { return num(a.t, 0) - num(b.t, 0); });
}

function sampleKeys(keys, t, fb) {
  if (!Array.isArray(keys) || !keys.length) return fb;
  const ks = sortedKeys(keys);
  if (t <= num(ks[0].t, 0)) return num(ks[0].v, fb);
  const last = ks[ks.length - 1];
  if (t >= num(last.t, 0)) return num(last.v, fb);
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i];
    const b = ks[i + 1];
    const at = num(a.t, 0);
    const bt = num(b.t, 0);
    if (t >= at && t <= bt) {
      return lerp(num(a.v, fb), num(b.v, fb), keyEase(a.easing, (t - at) / Math.max(0.0001, bt - at)));
    }
  }
  return fb;
}

function hexRgb(hex) {
  let h = String(hex || '').replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt((h + '000000').slice(0, 6), 16);
  if (!Number.isFinite(n)) return { r: 0, g: 0, b: 0 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function hex2(v) {
  const s = Math.round(clampN(v, 0, 255)).toString(16);
  return s.length < 2 ? '0' + s : s;
}

function mixHex(a, b, p) {
  const x = hexRgb(a);
  const y = hexRgb(b);
  const t = clamp01(p);
  return '#' + hex2(lerp(x.r, y.r, t)) + hex2(lerp(x.g, y.g, t)) + hex2(lerp(x.b, y.b, t));
}

function sampleKeyColor(keys, t, fb) {
  if (!Array.isArray(keys) || !keys.length) return fb;
  const ks = sortedKeys(keys);
  if (t <= num(ks[0].t, 0)) return ks[0].c || fb;
  const last = ks[ks.length - 1];
  if (t >= num(last.t, 0)) return last.c || fb;
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i];
    const b = ks[i + 1];
    const at = num(a.t, 0);
    const bt = num(b.t, 0);
    if (t >= at && t <= bt) {
      return mixHex(a.c || fb, b.c || fb, keyEase(a.easing, (t - at) / Math.max(0.0001, bt - at)));
    }
  }
  return fb;
}

// --- deterministic scatter --------------------------------------------------
// A particle field has to look IDENTICAL in the preview and in the render, and
// those run in different processes, frame by frame. So nothing here may call
// Math.random: every particle derives its position, size and phase from the
// layer's own seed through this hash, which makes the field reproducible and
// makes 'reshuffle' a one-number edit rather than a re-roll.
function rand01(seed, index, salt) {
  let h = ((num(seed, 1) | 0) * 374761393 + (index | 0) * 668265263 + (salt | 0) * 2246822519) >>> 0;
  h = ((h ^ (h >>> 13)) * 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function randRange(seed, index, salt, lo, hi) {
  return lo + (hi - lo) * rand01(seed, index, salt);
}

/** How many elements a scattered primitive draws, clamped to something sane. */
function particleCount(g, fallback) {
  return Math.max(1, Math.min(90, Math.round(num(g && g.count, fallback))));
}

// --- the opening hook -------------------------------------------------------
/**
 * Frame-exact state of the hook, in ABSOLUTE timeline seconds. The hook owns
 * the first 1-3 seconds: it scales in on a back curve, pushes gently for its
 * whole life, and lifts off at the end so it hands over to the footage rather
 * than cutting to it.
 */
function hookState(hook, t) {
  const dur = Math.max(0.3, num(hook && hook.duration, 1.8));
  const local = clampN(t, 0, dur);
  const inDur = Math.min(0.5, dur * 0.42);
  const outDur = Math.min(0.34, dur * 0.3);
  const intro = ease('back', clamp01(local / inDur));
  const outro = clamp01((dur - local) / outDur);
  return {
    dur: dur,
    local: local,
    life: clamp01(local / dur),
    live: t >= -0.001 && t <= dur + 0.001,
    intro: intro,
    outro: outro,
    opacity: clamp01(clamp01(local / Math.max(0.06, inDur * 0.55)) * outro),
    // The 'slight camera push' the Statement hook is built around — shared by
    // all three templates so they feel like one family.
    push: 1 + Math.max(0, num(hook && hook.push, 0.12)) * ease('easeOut', clamp01(local / dur)),
  };
}

/** Per-word reveal for a hook that lands its words one at a time. */
function hookWordState(index, total, s) {
  const span = Math.max(0.12, s.dur * 0.62);
  const step = span / Math.max(1, total);
  const a = clamp01((s.local - index * step) / Math.max(0.08, step * 1.6));
  const e = ease('expoOut', a);
  return { opacity: clamp01(a / 0.35) * s.outro, ty: (1 - e) * 46, scale: 0.72 + 0.28 * e };
}

// --- colour grade -----------------------------------------------------------
function gradeFilter(id) {
  if (id === 'cinematic') return 'contrast(1.12) saturate(1.16) brightness(1.02) hue-rotate(-5deg)';
  if (id === 'warm') return 'sepia(0.2) saturate(1.24) contrast(1.05) brightness(1.04)';
  if (id === 'cool') return 'saturate(1.1) contrast(1.08) hue-rotate(10deg) brightness(0.99)';
  if (id === 'bw') return 'grayscale(1) contrast(1.16)';
  if (id === 'vivid') return 'saturate(1.5) contrast(1.1)';
  return '';
}

// --- reframe + camera -------------------------------------------------------
function focusAt(reframe, srcT) {
  const rf = reframe || {};
  if (rf.mode === 'center') return { x: 0.5, y: 0.5 };
  if (rf.mode === 'manual') return { x: clampN(rf.x, 0.08, 0.92), y: clampN(rf.y, 0.08, 0.92) };
  const track = Array.isArray(rf.focus) ? rf.focus : [];
  if (!track.length) return { x: clampN(rf.x, 0.08, 0.92), y: clampN(rf.y, 0.08, 0.92) };
  if (srcT <= track[0].t) return { x: clampN(track[0].x, 0.08, 0.92), y: clampN(track[0].y, 0.08, 0.92) };
  const last = track[track.length - 1];
  if (srcT >= last.t) return { x: clampN(last.x, 0.08, 0.92), y: clampN(last.y, 0.08, 0.92) };
  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i];
    const b = track[i + 1];
    if (srcT >= a.t && srcT <= b.t) {
      const span = Math.max(0.0001, b.t - a.t);
      const p = ease('easeInOut', (srcT - a.t) / span);
      return { x: clampN(lerp(a.x, b.x, p), 0.08, 0.92), y: clampN(lerp(a.y, b.y, p), 0.08, 0.92) };
    }
  }
  return { x: 0.5, y: 0.42 };
}

const CAMERA_SPECS = {
  wide: { zoom: 1, dx: 0, dy: 0, blend: 0.6 },
  medium: { zoom: 1.32, dx: 0, dy: -0.06, blend: 0.6 },
  closeUp: { zoom: 1.78, dx: 0, dy: -0.11, blend: 0.6 },
  punchIn: { zoom: 2.1, dx: 0, dy: -0.13, blend: 0.22 },
  sideCropLeft: { zoom: 1.45, dx: -0.14, dy: -0.04, blend: 0.6 },
  sideCropRight: { zoom: 1.45, dx: 0.14, dy: -0.04, blend: 0.6 },
};
function cameraSpecOf(angle) { return CAMERA_SPECS[angle] || CAMERA_SPECS.wide; }

function cameraAt(segments, t) {
  const segs = Array.isArray(segments) ? segments : [];
  if (!segs.length) return CAMERA_SPECS.wide;
  const keys = [{ t: 0, spec: CAMERA_SPECS.wide, blend: 0.4 }];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const spec = cameraSpecOf(s.angle);
    keys.push({ t: num(s.start, 0), spec: spec, blend: num(s.blend, spec.blend) });
    const next = segs[i + 1];
    const endT = num(s.end, 0);
    if (!next || num(next.start, 0) > endT + 0.02) keys.push({ t: endT, spec: CAMERA_SPECS.wide, blend: 0.5 });
  }
  keys.sort(function (a, b) { return a.t - b.t; });
  let idx = 0;
  for (let i = 0; i < keys.length; i++) if (t >= keys[i].t - 0.0001) idx = i;
  const cur = keys[idx];
  const prev = keys[Math.max(0, idx - 1)];
  const blend = Math.max(0.05, num(cur.blend, 0.5));
  const p = ease('easeInOut', (t - cur.t) / blend);
  return {
    zoom: lerp(prev.spec.zoom, cur.spec.zoom, p),
    dx: lerp(prev.spec.dx, cur.spec.dx, p),
    dy: lerp(prev.spec.dy, cur.spec.dy, p),
  };
}

// --- subject geometry: depth compositing and tracked graphics ---------------

const DEFAULT_SUBJECT = { x: 0.5, y: 0.56, w: 0.64, h: 0.9 };

function subjectBoxAt(subject, srcT) {
  const s = subject || {};
  const bs = Array.isArray(s.boxes) ? s.boxes : [];
  const fb = s.box || DEFAULT_SUBJECT;
  if (s.mode === 'manual' || !bs.length) return fb;
  if (srcT <= num(bs[0].t, 0)) return bs[0];
  const last = bs[bs.length - 1];
  if (srcT >= num(last.t, 0)) return last;
  for (let i = 0; i < bs.length - 1; i++) {
    const a = bs[i];
    const b = bs[i + 1];
    const at = num(a.t, 0);
    const bt = num(b.t, 0);
    if (srcT >= at && srcT <= bt) {
      const p = (srcT - at) / Math.max(0.0001, bt - at);
      return {
        x: lerp(num(a.x, 0.5), num(b.x, 0.5), p),
        y: lerp(num(a.y, 0.56), num(b.y, 0.56), p),
        w: lerp(num(a.w, 0.64), num(b.w, 0.64), p),
        h: lerp(num(a.h, 0.9), num(b.h, 0.9), p),
      };
    }
  }
  return fb;
}

/** Frame-exact state of one placed clip: source time, camera and crop anchor. */
function clipFrameState(c, absFrame, fps) {
  const local = absFrame - num(c.from, 0);
  const srcT = (num(c.startFrom, 0) + local * num(c.speed, 1)) / fps;
  const contentT = clampN((local - num(c.contentOffset, 0)) / fps, 0, num(c.contentFrames, fps) / fps);
  const cam = cameraAt(c.camera, contentT);
  const f = focusAt(c.reframe, srcT);
  return {
    srcT: srcT,
    contentT: contentT,
    px: clampN(f.x + cam.dx, 0.06, 0.94),
    py: clampN(f.y + cam.dy, 0.06, 0.94),
    zoom: Math.max(1, cam.zoom),
  };
}

/**
 * Where a normalised SOURCE point lands on the design canvas.
 *
 * This mirrors exactly what the browser does to the video element: object-fit
 * cover at object-position px/py, then scale(zoom) about that same point.
 * Anchor and transform origin are the SAME point, so it does not move under the
 * zoom - which is what keeps a tracked graphic pinned to the subject at every
 * simulated angle.
 */
function projectSourcePoint(c, st, sx, sy, cw, ch) {
  const srcW = Math.max(1, num(c.srcW, 1920));
  const srcH = Math.max(1, num(c.srcH, 1080));
  const cover = Math.max(cw / srcW, ch / srcH);
  const dw = srcW * cover;
  const dh = srcH * cover;
  const ox = cw * st.px;
  const oy = ch * st.py;
  return {
    x: ox + ((cw - dw) * st.px + clamp01(sx) * dw - ox) * st.zoom,
    y: oy + ((ch - dh) * st.py + clamp01(sy) * dh - oy) * st.zoom,
    spanX: dw * st.zoom,
    spanY: dh * st.zoom,
  };
}

function subjectCanvasBox(c, st, cw, ch) {
  const s = c.subject || {};
  const b = subjectBoxAt(s, st.srcT);
  const pt = projectSourcePoint(c, st, num(b.x, 0.5), num(b.y, 0.56), cw, ch);
  return {
    cx: pt.x,
    cy: pt.y,
    w: Math.max(40, num(b.w, 0.64) * pt.spanX * Math.max(0.4, num(s.padX, 1.1))),
    h: Math.max(40, num(b.h, 0.9) * pt.spanY * Math.max(0.4, num(s.padY, 1.05))),
  };
}

/** The clip whose KEPT CONTENT covers this absolute frame. */
function activeClipAt(clips, absFrame) {
  if (!Array.isArray(clips) || !clips.length) return null;
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    const s = num(c.from, 0) + num(c.contentOffset, 0);
    if (absFrame >= s - 0.5 && absFrame < s + num(c.contentFrames, 1)) return c;
  }
  return clips[clips.length - 1];
}

/**
 * The cutout mask for the subject copy, in design-stage pixels. Ellipse and
 * column feather with a gradient; the rounded box is a hard-edged cutout with a
 * corner radius that grows with the feather setting.
 */
function subjectMaskStyle(shape, box, feather, cw, ch) {
  const rx = Math.max(12, box.w / 2);
  const ry = Math.max(12, box.h / 2);
  const f = clamp01(feather);
  if (shape === 'rounded') {
    const l = Math.max(0, box.cx - rx);
    const r = Math.max(0, cw - (box.cx + rx));
    const tp = Math.max(0, box.cy - ry);
    const bt = Math.max(0, ch - (box.cy + ry));
    const radius = Math.round(Math.min(rx, ry) * (0.16 + 0.48 * f));
    return {
      clipPath: 'inset(' + Math.round(tp) + 'px ' + Math.round(r) + 'px ' + Math.round(bt) + 'px ' + Math.round(l) + 'px round ' + radius + 'px)',
    };
  }
  if (shape === 'column') {
    const l = clamp01((box.cx - rx) / cw) * 100;
    const r = clamp01((box.cx + rx) / cw) * 100;
    const soft = Math.max(0.5, (r - l) * f * 0.5);
    const grad = 'linear-gradient(to right, rgba(0,0,0,0) ' + Math.max(0, l - soft).toFixed(2) + '%, rgba(0,0,0,1) ' +
      l.toFixed(2) + '%, rgba(0,0,0,1) ' + r.toFixed(2) + '%, rgba(0,0,0,0) ' + Math.min(100, r + soft).toFixed(2) + '%)';
    return { WebkitMaskImage: grad, maskImage: grad, WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat' };
  }
  const solid = Math.max(8, Math.round((1 - f) * 100));
  const grad = 'radial-gradient(ellipse ' + Math.round(rx) + 'px ' + Math.round(ry) + 'px at ' +
    Math.round(box.cx) + 'px ' + Math.round(box.cy) + 'px, rgba(0,0,0,1) 0%, rgba(0,0,0,1) ' + solid +
    '%, rgba(0,0,0,0) 100%)';
  return { WebkitMaskImage: grad, maskImage: grad, WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat' };
}

/** Cutout treatment: outline, glow and contact shadow on the subject copy. */
function subjectFxFilter(fx, accentFallback) {
  const out = [];
  const outline = Math.max(0, num(fx && fx.outline, 0));
  if (outline > 0) {
    const col = (fx && fx.outlineColor) || '#FFFFFF';
    const r = Math.max(1, Math.round(outline));
    out.push('drop-shadow(' + r + 'px 0 0 ' + col + ')');
    out.push('drop-shadow(-' + r + 'px 0 0 ' + col + ')');
    out.push('drop-shadow(0 ' + r + 'px 0 ' + col + ')');
    out.push('drop-shadow(0 -' + r + 'px 0 ' + col + ')');
  }
  const glow = Math.max(0, num(fx && fx.glow, 0));
  if (glow > 0) out.push('drop-shadow(0 0 ' + Math.round(glow) + 'px ' + ((fx && fx.glowColor) || accentFallback) + ')');
  const shadow = Math.max(0, num(fx && fx.shadow, 0));
  if (shadow > 0) out.push('drop-shadow(0 ' + Math.round(shadow * 0.6) + 'px ' + Math.round(shadow) + 'px rgba(0,0,0,0.55))');
  return out.join(' ');
}

// --- transitions ------------------------------------------------------------
function transitionState(type, side, raw, dir, shape) {
  const p = clamp01(raw);
  const st = { opacity: 1, transform: '', filter: '', clipPath: '' };
  const sx = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
  const sy = dir === 'up' ? -1 : dir === 'down' ? 1 : 0;
  const ax = (sx === 0 && sy === 0) ? -1 : sx;
  const ay = (sx === 0 && sy === 0) ? 0 : sy;

  if (type === 'zoom') {
    if (side === 'out') { st.transform = 'scale(' + (1 + 0.8 * p).toFixed(4) + ')'; st.opacity = 1 - clamp01((p - 0.3) / 0.45); }
    else { st.transform = 'scale(' + (1.55 - 0.55 * p).toFixed(4) + ')'; st.opacity = clamp01(p / 0.4); }
    return st;
  }
  if (type === 'whipPan') {
    if (side === 'out') {
      st.transform = 'translate(' + (-ax * 130 * p).toFixed(2) + '%,' + (-ay * 130 * p).toFixed(2) + '%)';
      st.filter = 'blur(' + (52 * p).toFixed(1) + 'px)';
      st.opacity = 1 - clamp01((p - 0.62) / 0.38);
    } else {
      st.transform = 'translate(' + (ax * 130 * (1 - p)).toFixed(2) + '%,' + (ay * 130 * (1 - p)).toFixed(2) + '%)';
      st.filter = 'blur(' + (52 * (1 - p)).toFixed(1) + 'px)';
      st.opacity = clamp01(p / 0.25);
    }
    return st;
  }
  if (type === 'motionBlur') {
    if (side === 'out') {
      st.transform = 'translate(' + (-ax * 20 * p).toFixed(2) + '%,' + (-ay * 20 * p).toFixed(2) + '%) scale(' + (1 + 0.08 * p).toFixed(4) + ')';
      st.filter = 'blur(' + (40 * p).toFixed(1) + 'px)';
      st.opacity = 1 - Math.pow(p, 1.4);
    } else {
      st.transform = 'translate(' + (ax * 20 * (1 - p)).toFixed(2) + '%,' + (ay * 20 * (1 - p)).toFixed(2) + '%) scale(' + (1 + 0.08 * (1 - p)).toFixed(4) + ')';
      st.filter = 'blur(' + (40 * (1 - p)).toFixed(1) + 'px)';
      st.opacity = Math.pow(p, 0.6);
    }
    return st;
  }
  if (type === 'push') {
    if (side === 'out') st.transform = 'translate(' + (-ax * 100 * p).toFixed(2) + '%,' + (-ay * 100 * p).toFixed(2) + '%)';
    else st.transform = 'translate(' + (ax * 100 * (1 - p)).toFixed(2) + '%,' + (ay * 100 * (1 - p)).toFixed(2) + '%)';
    return st;
  }
  if (type === 'slide') {
    if (side === 'out') { st.transform = 'scale(' + (1 - 0.04 * p).toFixed(4) + ')'; st.filter = 'brightness(' + (1 - 0.25 * p).toFixed(3) + ')'; }
    else st.transform = 'translate(' + (ax * 100 * (1 - p)).toFixed(2) + '%,' + (ay * 100 * (1 - p)).toFixed(2) + '%)';
    return st;
  }
  if (type === 'scale') {
    if (side === 'out') { st.transform = 'scale(' + (1 - 0.14 * p).toFixed(4) + ')'; st.opacity = 1 - clamp01((p - 0.2) / 0.5); }
    else { st.transform = 'scale(' + (0.2 + 0.8 * p).toFixed(4) + ')'; st.opacity = clamp01(p / 0.28); }
    return st;
  }
  if (type === 'spin') {
    if (side === 'out') { st.transform = 'rotate(' + (-32 * p).toFixed(2) + 'deg) scale(' + (1 - 0.38 * p).toFixed(4) + ')'; st.opacity = 1 - clamp01((p - 0.15) / 0.6); }
    else { st.transform = 'rotate(' + (34 * (1 - p)).toFixed(2) + 'deg) scale(' + (0.62 + 0.38 * p).toFixed(4) + ')'; st.opacity = clamp01(p / 0.35); }
    return st;
  }
  if (type === 'glitch') {
    const peak = 1 - Math.abs(p - 0.5) * 2;
    const jitter = Math.sin(p * 47) * 1.6 * peak;
    st.filter = 'saturate(' + (1 + 0.9 * peak).toFixed(3) + ') contrast(1.1)';
    if (side === 'out') { st.transform = 'translateX(' + jitter.toFixed(3) + '%)'; st.opacity = p < 0.52 ? 1 : 0; }
    else { st.transform = 'translateX(' + (-jitter).toFixed(3) + '%)'; st.opacity = p < 0.52 ? 0 : 1; }
    return st;
  }
  if (type === 'lightSweep') {
    const peak = 1 - Math.abs(p - 0.5) * 2;
    st.filter = 'brightness(' + (1 + 0.55 * peak).toFixed(3) + ')';
    st.opacity = side === 'out' ? 1 - clamp01((p - 0.42) / 0.3) : clamp01((p - 0.38) / 0.34);
    return st;
  }
  if (type === 'maskReveal') {
    if (side === 'in') {
      if (shape === 'bar') {
        const inset = ((1 - p) * 100).toFixed(2);
        if (dir === 'up') st.clipPath = 'inset(' + inset + '% 0% 0% 0%)';
        else if (dir === 'down') st.clipPath = 'inset(0% 0% ' + inset + '% 0%)';
        else if (dir === 'right') st.clipPath = 'inset(0% ' + inset + '% 0% 0%)';
        else st.clipPath = 'inset(0% 0% 0% ' + inset + '%)';
      } else if (shape === 'diagonal') {
        const e = p * 220 - 60;
        st.clipPath = 'polygon(0% 0%, ' + e.toFixed(2) + '% 0%, ' + (e - 60).toFixed(2) + '% 100%, 0% 100%)';
      } else {
        st.clipPath = 'circle(' + (p * 82).toFixed(2) + '% at 50% 50%)';
      }
      st.transform = 'scale(' + (1.08 - 0.08 * p).toFixed(4) + ')';
    } else {
      st.filter = 'brightness(' + (1 - 0.2 * p).toFixed(3) + ')';
    }
    return st;
  }
  st.opacity = side === 'out' ? 1 - p : p;
  return st;
}

// --- captions ---------------------------------------------------------------
const WORD_ANIM_S = 0.26;

const CAPTION_STYLE_SPECS = {
  normal: { size: 1, weight: 600, upper: false, tracking: 0 },
  bold: { size: 1.06, weight: 900, upper: false, tracking: -0.5 },
  huge: { size: 1.74, weight: 900, upper: true, tracking: -2.5 },
  highlighted: { size: 1.04, weight: 800, upper: false, tracking: -0.5 },
  animated: { size: 1.04, weight: 800, upper: false, tracking: 0 },
  differentFont: { size: 1.1, weight: 700, upper: false, tracking: 0 },
  differentColor: { size: 1.02, weight: 800, upper: false, tracking: -0.5 },
  kinetic: { size: 1.18, weight: 900, upper: true, tracking: -1.5 },
};

function wordState(cue, w, t) {
  const spec = CAPTION_STYLE_SPECS[w.style] || CAPTION_STYLE_SPECS.normal;
  const base = num(cue.baseSize, 74);
  const started = t >= num(w.start, 0) - 0.0001;
  const animDur = w.anim === 'charByChar' ? Math.max(WORD_ANIM_S, String(w.text || '').length * 0.035) : WORD_ANIM_S;
  const a = started ? clamp01((t - num(w.start, 0)) / animDur) : 0;
  const out = {
    fontSize: base * spec.size,
    fontWeight: spec.weight,
    upper: spec.upper,
    tracking: spec.tracking,
    fontFamily: fontCss(w.style === 'differentFont' ? (w.font || 'anton') : cue.font),
    color: cue.color || '#FFFFFF',
    background: 'transparent',
    highlight: 0,
    opacity: started ? 1 : 0,
    tx: 0,
    ty: 0,
    scale: 1,
    rotate: 0,
    blur: 0,
    charReveal: 1,
  };
  if (w.style === 'differentColor') out.color = w.color || cue.accent || '#F59E0B';
  if (w.style === 'highlighted') { out.color = '#0B0D12'; out.highlight = 1; out.background = w.color || cue.accent || '#F59E0B'; }
  if (w.style === 'huge') out.color = w.color || cue.accent || '#F59E0B';
  if (!started) return out;

  const anim = w.anim || 'wordByWord';
  if (anim === 'wordByWord') out.opacity = ease('easeOut', a / 0.6);
  else if (anim === 'charByChar') out.charReveal = a;
  else if (anim === 'pop') { const e = ease('back', a); out.scale = 0.58 + 0.42 * e; out.opacity = clamp01(a / 0.35); }
  else if (anim === 'bounce') { const e = ease('spring', a); out.scale = 0.7 + 0.3 * e; out.ty = (1 - e) * 26; out.opacity = clamp01(a / 0.3); }
  else if (anim === 'slideUp') { const e = ease('expoOut', a); out.ty = (1 - e) * 48; out.opacity = clamp01(a / 0.4); }
  else if (anim === 'slideIn') { const e = ease('expoOut', a); out.tx = (1 - e) * 72; out.opacity = clamp01(a / 0.4); }
  else if (anim === 'blurIn') { const e = ease('easeOut', a); out.blur = (1 - e) * 18; out.opacity = clamp01(a / 0.5); }
  else if (anim === 'scale') { const e = ease('expoOut', a); out.scale = 0.02 + 0.98 * e; out.opacity = clamp01(a / 0.25); }
  else if (anim === 'highlightSweep') { out.highlight = ease('easeInOut', a); out.background = w.color || cue.accent || '#F59E0B'; out.color = a > 0.45 ? '#0B0D12' : (cue.color || '#FFFFFF'); }
  else if (anim === 'trackingReveal') { const e = ease('expoOut', a); out.tracking = out.tracking + (1 - e) * 26; out.opacity = clamp01(a / 0.4); }
  else if (anim === 'punchIn') { const e = ease('expoOut', a); out.scale = 1.5 - 0.5 * e; out.opacity = clamp01(a / 0.2); }

  if (w.style === 'kinetic') {
    const k = ease('spring', a);
    out.ty += (1 - k) * -34;
    out.rotate = (1 - k) * -5;
    out.scale *= 0.9 + 0.1 * k;
  }
  if (w.shake) {
    const decay = Math.max(0, 1 - a / 0.8);
    out.rotate += Math.sin(a * 46) * 3.2 * decay;
    out.tx += Math.sin(a * 61) * 5 * decay;
  }
  return out;
}

// --- motion graphics --------------------------------------------------------
function rampAt(r, p) {
  const from = num(r && r.from, 0);
  const to = num(r && r.to, from);
  return lerp(from, to, p);
}

function graphicState(g, t) {
  const start = num(g.start, 0);
  const end = Math.max(start + 0.1, num(g.end, start + 1));
  const span = end - start;
  const local = clampN(t - start, 0, span);
  const life = clamp01(local / span);
  const inDur = Math.max(0.05, Math.min(num(g.inDur, 0.4), span * 0.7));
  const outDur = Math.max(0.05, Math.min(num(g.outDur, 0.3), span * 0.7));
  const eased = ease(g.easing || 'expoOut', life);
  const draw = ease(g.easing || 'expoOut', local / inDur);
  const fadeIn = clamp01(local / Math.max(0.08, inDur * 0.7));
  const fadeOut = 1 - clamp01((local - (span - outDur)) / outDur);
  const keys = g.keys || {};
  const baseScale = rampAt(g.scale, eased) * (0.92 + 0.08 * draw);
  const st = {
    life: life,
    draw: draw,
    x: num(g.x, DESIGN_W / 2) + rampAt(g.dx, eased),
    y: num(g.y, DESIGN_H / 2) + rampAt(g.dy, eased),
    scaleX: baseScale,
    scaleY: baseScale,
    rotation: rampAt(g.rotation, eased),
    opacity: rampAt(g.opacity, life) * fadeIn * fadeOut,
    blur: rampAt(g.blur, life) + (1 - draw) * 2,
    color: g.color || '#F59E0B',
    keyed: false,
  };

  // A keyframed channel takes the channel over completely - including the
  // reveal fades on opacity, so an explicit curve is exactly what you see.
  if (keys.x && keys.x.length) { st.x = sampleKeys(keys.x, t, st.x); st.keyed = true; }
  if (keys.y && keys.y.length) { st.y = sampleKeys(keys.y, t, st.y); st.keyed = true; }
  if (keys.scaleX && keys.scaleX.length) { st.scaleX = sampleKeys(keys.scaleX, t, st.scaleX); st.keyed = true; }
  if (keys.scaleY && keys.scaleY.length) { st.scaleY = sampleKeys(keys.scaleY, t, st.scaleY); st.keyed = true; }
  if (keys.rotation && keys.rotation.length) { st.rotation = sampleKeys(keys.rotation, t, st.rotation); st.keyed = true; }
  if (keys.opacity && keys.opacity.length) { st.opacity = sampleKeys(keys.opacity, t, st.opacity); st.keyed = true; }
  if (keys.blur && keys.blur.length) { st.blur = sampleKeys(keys.blur, t, st.blur); st.keyed = true; }
  if (keys.color && keys.color.length) { st.color = sampleKeyColor(keys.color, t, st.color); st.keyed = true; }

  // A malformed curve must never reach the DOM as NaN.
  st.x = num(st.x, num(g.x, DESIGN_W / 2));
  st.y = num(st.y, num(g.y, DESIGN_H / 2));
  st.scaleX = clampN(num(st.scaleX, 1), 0.01, 12);
  st.scaleY = clampN(num(st.scaleY, 1), 0.01, 12);
  st.rotation = num(st.rotation, 0);
  st.opacity = clamp01(num(st.opacity, 1));
  st.blur = clampN(num(st.blur, 0), 0, 120);
  return st;
}

/**
 * The live position of a graphic, after tracking. A tracked layer is pinned to
 * the subject point of whichever clip is on screen; 'strength' below 1 blends
 * between the layer's own position and the tracked one, which reads as lag.
 */
function graphicPosition(g, s, t, frame, fps, clips, cw, ch) {
  const tr = g.track;
  if (!tr || !tr.target || tr.target === 'none') return { x: s.x, y: s.y, tracked: false };
  if (tr.from != null && t < num(tr.from, 0) - 0.001) return { x: s.x, y: s.y, tracked: false };
  if (tr.to != null && t > num(tr.to, 0) + 0.001) return { x: s.x, y: s.y, tracked: false };
  const c = activeClipAt(clips, frame);
  if (!c) return { x: s.x, y: s.y, tracked: false };
  const fs = clipFrameState(c, frame, fps);
  const b = subjectBoxAt(c.subject || {}, fs.srcT);
  const sy = tr.target === 'product' ? clamp01(num(b.y, 0.56) + num(b.h, 0.9) * 0.18) : num(b.y, 0.56);
  const pt = projectSourcePoint(c, fs, num(b.x, 0.5), sy, cw, ch);
  const k = clamp01(num(tr.strength, 1));
  return {
    x: lerp(s.x, pt.x + num(tr.offsetX, 0), k),
    y: lerp(s.y, pt.y + num(tr.offsetY, 0), k),
    tracked: true,
  };
}
`;
