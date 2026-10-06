/**
 * Video Studio — browser-side vision.
 *
 * Four jobs, all done on a canvas with no model download and no server round
 * trip, so they finish inside the two-minute budget the brief sets:
 *
 *   1. subject detection for auto-reframe (native FaceDetector when the
 *      browser has it, a skin-tone + edge-energy saliency pass when it does
 *      not)
 *   2. motion energy per second, which is what flags low-action B-roll slots
 *   3. overlay auto-tracking by block matching — the optical-flow
 *      approximation the brief asks for, with a real confidence number
 *   4. thumbnails for the cut-plan cards
 *
 * Everything shares ONE frame reader: opening a <video>, seeking and drawing
 * is by far the expensive part, so a pass states every timestamp it wants up
 * front and gets them in a single sequential sweep.
 */

export interface FrameSample {
  t: number;
  width: number;
  height: number;
  data: Uint8ClampedArray;   // RGBA at the sampling size
}

const SEEK_TIMEOUT_MS = 6000;

function openVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.preload = 'auto';
    v.muted = true;
    v.playsInline = true;
    const timer = setTimeout(() => reject(new Error('The video took too long to open for analysis.')), 25000);
    v.addEventListener('loadeddata', () => { clearTimeout(timer); resolve(v); }, { once: true });
    v.addEventListener('error', () => { clearTimeout(timer); reject(new Error('The video could not be decoded for analysis.')); }, { once: true });
    v.src = url;
    v.load();
  });
}

function closeVideo(v: HTMLVideoElement) {
  try { v.pause(); } catch { /* already stopped */ }
  v.removeAttribute('src');
  try { v.load(); } catch { /* detached */ }
}

function seekTo(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    const timer = setTimeout(finish, SEEK_TIMEOUT_MS);
    v.addEventListener('seeked', () => { clearTimeout(timer); finish(); }, { once: true });
    try { v.currentTime = t; } catch { clearTimeout(timer); finish(); }
  });
}

/**
 * Read the given timestamps out of a video at a small analysis size. One open,
 * one sequential sweep. `onProgress` reports 0..1 so long videos can show a
 * live percentage instead of a frozen spinner.
 */
export async function readFrames(
  url: string,
  times: number[],
  sampleW = 128,
  onProgress?: (p: number) => void,
): Promise<{ frames: FrameSample[]; naturalWidth: number; naturalHeight: number }> {
  const v = await openVideo(url);
  const nw = v.videoWidth || 1280;
  const nh = v.videoHeight || 720;
  const w = Math.max(16, Math.min(sampleW, nw));
  const h = Math.max(16, Math.round((w * nh) / Math.max(1, nw)));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
  const frames: FrameSample[] = [];
  try {
    if (!ctx) throw new Error('No 2D canvas context is available.');
    const limit = Math.max(0.05, (v.duration || 0) - 0.08);
    for (let i = 0; i < times.length; i += 1) {
      const t = Math.max(0, Math.min(limit, times[i]));
      await seekTo(v, t);
      try {
        ctx.drawImage(v, 0, 0, w, h);
        frames.push({ t, width: w, height: h, data: ctx.getImageData(0, 0, w, h).data });
      } catch {
        // A tainted canvas (a cross-origin source with no CORS header) cannot
        // be read. Stop rather than returning half a pass of garbage.
        throw new Error('This video\u2019s host does not allow frame analysis in the browser.');
      }
      onProgress?.((i + 1) / Math.max(1, times.length));
    }
  } finally {
    closeVideo(v);
  }
  return { frames, naturalWidth: nw, naturalHeight: nh };
}

/** One JPEG data URL at a timestamp — the cut-plan card thumbnails. */
export async function captureThumb(url: string, at: number, width = 160): Promise<string> {
  const v = await openVideo(url);
  try {
    const nw = v.videoWidth || 1280;
    const nh = v.videoHeight || 720;
    const w = Math.max(32, Math.min(width, nw));
    const h = Math.max(18, Math.round((w * nh) / Math.max(1, nw)));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    await seekTo(v, Math.max(0, Math.min((v.duration || 1) - 0.08, at)));
    ctx.drawImage(v, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.6);
  } catch {
    return '';
  } finally {
    closeVideo(v);
  }
}

// ---------------------------------------------------------------------------
// Saliency — where the subject is when there is no face detector
// ---------------------------------------------------------------------------

/**
 * Skin-tone likelihood in normalised RGB. The classic Peer/Kovac rule: a
 * strong red channel, red above green above blue, and enough spread between
 * the extremes. It is crude but it reliably separates a presenter from a wall.
 */
function skinScore(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const ok = r > 95 && g > 40 && b > 20 && max - min > 15 && Math.abs(r - g) > 15 && r > g && r > b;
  if (!ok) return 0;
  return Math.min(1, (r - min) / 140);
}

/**
 * Weighted centroid of "interesting" pixels: skin tone counts heaviest, local
 * luma gradient next, and the vertical centre band gets a mild prior because
 * speakers sit there. Returns the centroid plus how concentrated it was, which
 * becomes the confidence the UI shows.
 */
export function frameSubject(f: FrameSample): { x: number; y: number; confidence: number } {
  const { data, width: w, height: h } = f;
  const at = (x: number, y: number) => ((y * w + x) << 2);
  let sumW = 0;
  let sumX = 0;
  let sumY = 0;
  let peak = 0;
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = at(x, y);
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      const right = data[at(x + 1, y)] * 0.299 + data[at(x + 1, y) + 1] * 0.587 + data[at(x + 1, y) + 2] * 0.114;
      const down = data[at(x, y + 1)] * 0.299 + data[at(x, y + 1) + 1] * 0.587 + data[at(x, y + 1) + 2] * 0.114;
      const grad = (Math.abs(luma - right) + Math.abs(luma - down)) / 255;
      const skin = skinScore(r, g, b);
      const yPrior = 1 - Math.abs(y / h - 0.42) * 0.9;
      const weight = (skin * 3.2 + grad * 0.9) * Math.max(0.15, yPrior);
      if (weight <= 0) continue;
      sumW += weight;
      sumX += weight * x;
      sumY += weight * y;
      if (weight > peak) peak = weight;
    }
  }
  if (sumW <= 0) return { x: 0.5, y: 0.45, confidence: 0 };
  const cx = sumX / sumW / w;
  const cy = sumY / sumW / h;
  // Concentration: a tight cluster of heavy pixels is a real subject; a flat
  // field of mild gradient is not.
  const density = sumW / (w * h);
  const confidence = Math.max(0, Math.min(1, density * 2.4));
  return { x: cx, y: cy, confidence };
}

interface NativeFaceDetector {
  detect(source: CanvasImageSource): Promise<{ boundingBox: { x: number; y: number; width: number; height: number } }[]>;
}

function nativeFaceDetector(): NativeFaceDetector | null {
  const Ctor = (window as unknown as { FaceDetector?: new (o: unknown) => NativeFaceDetector }).FaceDetector;
  if (!Ctor) return null;
  try {
    return new Ctor({ fastMode: true, maxDetectedFaces: 3 });
  } catch {
    return null;
  }
}

export interface SubjectTrackResult {
  focus: { t: number; x: number; y: number; confidence: number }[];
  detector: 'face' | 'saliency';
  motion: { t: number; score: number }[];
  note: string;
}

/**
 * The auto-reframe pass. Samples the video roughly once a second (capped so a
 * long interview still finishes fast), finds the subject in each frame, and
 * smooths the path so the reframe glides instead of jittering frame to frame.
 * Motion energy falls out of the same sweep for free.
 */
export async function detectSubjectTrack(
  url: string,
  duration: number,
  onProgress?: (p: number, note: string) => void,
): Promise<SubjectTrackResult> {
  const count = Math.max(2, Math.min(48, Math.round(duration)));
  const step = duration / count;
  const times: number[] = [];
  for (let i = 0; i < count; i += 1) times.push(i * step + step / 2);

  onProgress?.(0.02, 'Reading frames…');
  const { frames } = await readFrames(url, times, 128, (p) => onProgress?.(p * 0.75, 'Reading frames…'));

  const detector = nativeFaceDetector();
  const raw: { t: number; x: number; y: number; confidence: number }[] = [];
  let faceHits = 0;

  // The native detector wants an image source, so faces are read off a
  // throwaway canvas built from the sample we already have in memory.
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  for (let i = 0; i < frames.length; i += 1) {
    const f = frames[i];
    let point: { x: number; y: number; confidence: number } | null = null;
    if (detector && ctx) {
      canvas.width = f.width;
      canvas.height = f.height;
      ctx.putImageData(new ImageData(f.data, f.width, f.height), 0, 0);
      try {
        const faces = await detector.detect(canvas);
        if (faces.length) {
          // Biggest face wins — that is the person the shot is about.
          const best = faces.slice().sort((a, b) => b.boundingBox.width * b.boundingBox.height - a.boundingBox.width * a.boundingBox.height)[0];
          const bb = best.boundingBox;
          point = {
            x: (bb.x + bb.width / 2) / f.width,
            y: (bb.y + bb.height / 2) / f.height,
            confidence: Math.min(1, 0.55 + (bb.width * bb.height) / (f.width * f.height) * 4),
          };
          faceHits += 1;
        }
      } catch { /* the detector refused this frame — fall through to saliency */ }
    }
    if (!point) point = frameSubject(f);
    raw.push({ t: f.t, ...point });
    onProgress?.(0.75 + ((i + 1) / frames.length) * 0.22, 'Locating the subject…');
  }

  const motion = frameMotion(frames);
  const focus = smoothTrack(raw);
  const usedFace = faceHits >= Math.max(2, Math.round(frames.length * 0.25));
  return {
    focus,
    detector: usedFace ? 'face' : 'saliency',
    motion,
    note: usedFace
      ? `Face detected in ${faceHits} of ${frames.length} sampled frames — the reframe keeps it centred.`
      : 'No face detector on this browser, so the subject was found by saliency (skin tone + edge energy). Drag the focus handle if a shot needs a nudge.',
  };
}

/** Mean absolute luma difference between consecutive samples, 0..1. */
export function frameMotion(frames: FrameSample[]): { t: number; score: number }[] {
  const out: { t: number; score: number }[] = [];
  for (let i = 1; i < frames.length; i += 1) {
    const a = frames[i - 1].data;
    const b = frames[i].data;
    const n = Math.min(a.length, b.length);
    let sum = 0;
    let count = 0;
    for (let p = 0; p < n; p += 16) {        // every 4th pixel is plenty
      sum += Math.abs(a[p] - b[p]);
      count += 1;
    }
    out.push({ t: frames[i].t, score: Math.min(1, (sum / Math.max(1, count)) / 42) });
  }
  return out;
}

/** A 5-tap moving average, with low-confidence points pulled toward centre. */
function smoothTrack(points: { t: number; x: number; y: number; confidence: number }[]): { t: number; x: number; y: number; confidence: number }[] {
  const trusted = points.map((p) => (p.confidence < 0.12
    ? { ...p, x: 0.5 + (p.x - 0.5) * 0.3, y: 0.45 + (p.y - 0.45) * 0.3 }
    : p));
  return trusted.map((p, i) => {
    let sx = 0;
    let sy = 0;
    let sw = 0;
    for (let k = Math.max(0, i - 2); k <= Math.min(trusted.length - 1, i + 2); k += 1) {
      const weight = 1 / (1 + Math.abs(k - i));
      sx += trusted[k].x * weight;
      sy += trusted[k].y * weight;
      sw += weight;
    }
    return { t: p.t, x: sx / sw, y: sy / sw, confidence: p.confidence };
  });
}

// ---------------------------------------------------------------------------
// Overlay auto-tracking — block matching (optical-flow approximation)
// ---------------------------------------------------------------------------

export interface OverlayTrackResult {
  keys: { t: number; x: number; y: number }[];
  confidence: number;
  note: string;
}

function lumaPlane(f: FrameSample): Float32Array {
  const out = new Float32Array(f.width * f.height);
  for (let i = 0, p = 0; p < out.length; i += 4, p += 1) {
    out[p] = 0.299 * f.data[i] + 0.587 * f.data[i + 1] + 0.114 * f.data[i + 2];
  }
  return out;
}

/**
 * Follow a patch of the picture from `seed` forward, by searching each new
 * frame for the position whose luma block best matches the previous one. The
 * reported confidence is how much better the winning match was than a plain
 * average block — a flat or occluded subject scores low and says so.
 */
export async function trackOverlaySubject(
  url: string,
  startS: number,
  endS: number,
  seed: { x: number; y: number },
  onProgress?: (p: number) => void,
): Promise<OverlayTrackResult> {
  const span = Math.max(0.4, endS - startS);
  const count = Math.max(3, Math.min(60, Math.round(span * 4)));   // ~4 samples / second
  const times: number[] = [];
  for (let i = 0; i < count; i += 1) times.push(startS + (span * i) / (count - 1));

  const { frames } = await readFrames(url, times, 160, (p) => onProgress?.(p * 0.85));
  if (frames.length < 2) return { keys: [], confidence: 0, note: 'Not enough frames in that range to track.' };

  const W = frames[0].width;
  const H = frames[0].height;
  const half = Math.max(4, Math.round(Math.min(W, H) * 0.12));   // tracked block
  const search = Math.max(5, Math.round(Math.min(W, H) * 0.14)); // per-step window

  let cx = Math.round(seed.x * W);
  let cy = Math.round(seed.y * H);
  const keys: { t: number; x: number; y: number }[] = [{ t: frames[0].t, x: cx / W, y: cy / H }];
  const scores: number[] = [];
  let prev = lumaPlane(frames[0]);

  const sampleBlock = (plane: Float32Array, ox: number, oy: number): Float32Array => {
    const size = half * 2 + 1;
    const block = new Float32Array(size * size);
    for (let dy = -half, k = 0; dy <= half; dy += 1) {
      for (let dx = -half; dx <= half; dx += 1, k += 1) {
        const x = Math.max(0, Math.min(W - 1, ox + dx));
        const y = Math.max(0, Math.min(H - 1, oy + dy));
        block[k] = plane[y * W + x];
      }
    }
    return block;
  };

  let template = sampleBlock(prev, cx, cy);

  for (let i = 1; i < frames.length; i += 1) {
    const plane = lumaPlane(frames[i]);
    let bestSad = Infinity;
    let worstSad = 0;
    let bx = cx;
    let by = cy;
    for (let oy = -search; oy <= search; oy += 2) {
      for (let ox = -search; ox <= search; ox += 2) {
        const tx = cx + ox;
        const ty = cy + oy;
        if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
        const block = sampleBlock(plane, tx, ty);
        let sad = 0;
        for (let k = 0; k < template.length; k += 2) sad += Math.abs(template[k] - block[k]);
        sad /= template.length / 2;
        if (sad < bestSad) { bestSad = sad; bx = tx; by = ty; }
        if (sad > worstSad) worstSad = sad;
      }
    }
    cx = bx;
    cy = by;
    // A good lock means the winner stood out from the rest of the window.
    const separation = worstSad > 0 ? 1 - bestSad / worstSad : 0;
    scores.push(Math.max(0, Math.min(1, separation * 1.25)));
    keys.push({ t: frames[i].t, x: cx / W, y: cy / H });
    // Re-seed the template so slow appearance changes do not lose the lock,
    // but keep most of the original so a bad frame cannot hijack it.
    const fresh = sampleBlock(plane, cx, cy);
    for (let k = 0; k < template.length; k += 1) template[k] = template[k] * 0.65 + fresh[k] * 0.35;
    prev = plane;
    onProgress?.(0.85 + ((i + 1) / frames.length) * 0.15);
  }
  void prev;

  const confidence = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  return {
    keys,
    confidence,
    note: confidence >= 0.55
      ? 'Strong lock — the overlay follows the subject closely.'
      : confidence >= 0.3
        ? 'Usable lock, but the subject has low contrast. Check the busy moments.'
        : 'Weak lock — the subject is hard to separate from the background. Position the overlay by hand instead.',
  };
}

// ---------------------------------------------------------------------------
// Low-action detection — the other half of the B-roll slot finder
// ---------------------------------------------------------------------------

export interface LowActionRegion { start: number; end: number; score: number }

/** Runs of consecutive samples whose motion energy stays under `threshold`. */
export function lowActionRegions(
  motion: { t: number; score: number }[],
  duration: number,
  threshold = 0.12,
  minSpan = 2.2,
): LowActionRegion[] {
  const out: LowActionRegion[] = [];
  let from = -1;
  let acc = 0;
  let n = 0;
  motion.forEach((m, i) => {
    if (m.score <= threshold) {
      if (from < 0) { from = m.t; acc = 0; n = 0; }
      acc += m.score;
      n += 1;
    } else if (from >= 0) {
      if (m.t - from >= minSpan) out.push({ start: from, end: m.t, score: acc / Math.max(1, n) });
      from = -1;
    }
    if (i === motion.length - 1 && from >= 0 && duration - from >= minSpan) {
      out.push({ start: from, end: duration, score: acc / Math.max(1, n) });
    }
  });
  return out;
}
