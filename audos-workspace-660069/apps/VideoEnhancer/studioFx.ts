/**
 * Video Studio — motion, VFX and keying maths.
 *
 * Everything here is a PURE function of time (and a fixed seed), so the browser
 * preview in studioStage.tsx and the server composition in the veh-render hook
 * can run the identical arithmetic and land on the identical frame. Nothing in
 * this file touches the DOM, fetches, or reads a clock — a frame rendered at
 * t = 4.2s looks the same on both sides every single time.
 *
 * Three families live here:
 *   · MOTION   speed ramping, match-cut zoom, camera shake
 *   · VFX      light leaks, VHS, glitch, glow + rays, turbulent displace
 *   · KEYING   chroma key as an SVG filter spec (matrix + transfer + spill)
 *
 * The VFX that need real per-pixel work (glitch slice tearing, turbulent
 * displace, chroma key) are expressed as SVG filter primitives rather than as
 * canvas pixel loops. SVG filters run in the browser AND inside Remotion's
 * headless Chrome, they are deterministic given a seed, and they do not need
 * to read the video back out of a canvas — which would taint on cross-origin
 * footage and break the key entirely.
 */
import { clamp01, easeOutBack, easeOutCubic } from './studioModel';
import type {
  CameraShake, ChromaKeyState, DisplacePresetId, DisplaceState, GlitchState,
  GlowState, LeakPresetId, LeakState, SpeedCurveId, SpeedRamp, VhsState,
  ZoomCut, ZoomIntensityId,
} from './studioModel';
import type { EffectLayer } from './studioStyles';

// ---------------------------------------------------------------------------
// Deterministic noise
// ---------------------------------------------------------------------------

/**
 * Clamp with a fallback. Settings arriving from an older autosaved document
 * can be missing entirely, and a NaN here would silently poison a transform
 * for the whole render — so the fallback is explicit rather than implied.
 * The veh-render hook's `clampN` has the same four-argument shape.
 */
function numIn(v: number | undefined | null, lo: number, hi: number, fb: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fb;
}

/** Reproducible 0..1 hash. The same (n, seed) always gives the same number. */
export function hash01(n: number, seed = 1): number {
  const x = Math.sin(n * 127.1 + seed * 311.7 + 0.137) * 43758.5453123;
  return x - Math.floor(x);
}

/** Smooth value noise in -1..1 — shake and jitter read from this. */
export function noise1(x: number, seed = 1): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  const a = hash01(i, seed) * 2 - 1;
  const b = hash01(i + 1, seed) * 2 - 1;
  return a + (b - a) * u;
}

// ---------------------------------------------------------------------------
// Speed ramping
// ---------------------------------------------------------------------------

export const SPEED_CURVES: { id: SpeedCurveId; label: string; hint: string }[] = [
  { id: 'easeIn', label: 'Ease In', hint: 'Opens in slow motion and accelerates out of the shot' },
  { id: 'easeOut', label: 'Ease Out', hint: 'Runs fast, then settles into slow motion on the last beat' },
  { id: 'punch', label: 'Punch', hint: 'Fast → slow-mo through the middle → fast again' },
  { id: 'custom', label: 'Custom', hint: 'Set the start, middle and end speed yourself' },
];

/**
 * A ramp is a TIME WARP, not a duration change: w(0) = 0 and w(1) = 1 always,
 * so the clip occupies exactly the same slot on the timeline and every cut,
 * caption and overlay downstream of it stays where the creator put it. Only
 * the pace inside the clip moves.
 */
export function warp(ramp: SpeedRamp, p: number): number {
  const x = clamp01(p);
  if (!ramp || !ramp.enabled) return x;
  const k = numIn(ramp.intensity, 0, 0.85, 0.5);
  switch (ramp.curve) {
    case 'easeIn':
      return (1 - k) * x + k * x * x;
    case 'easeOut':
      return (1 - k) * x + k * (2 * x - x * x);
    case 'punch':
      return x + (k * Math.sin(2 * Math.PI * x)) / (2 * Math.PI);
    case 'custom': {
      const total = customIntegral(ramp, 1);
      return total > 0 ? clamp01(customIntegral(ramp, x) / total) : x;
    }
    default:
      return x;
  }
}

/** dw/dp — the instantaneous playback multiplier at progress `p`. */
export function warpRate(ramp: SpeedRamp, p: number): number {
  const x = clamp01(p);
  if (!ramp || !ramp.enabled) return 1;
  const k = numIn(ramp.intensity, 0, 0.85, 0.5);
  switch (ramp.curve) {
    case 'easeIn':
      return (1 - k) + 2 * k * x;
    case 'easeOut':
      return (1 - k) + k * (2 - 2 * x);
    case 'punch':
      return 1 + k * Math.cos(2 * Math.PI * x);
    case 'custom': {
      const total = customIntegral(ramp, 1);
      return total > 0 ? customSpeed(ramp, x) / total : 1;
    }
    default:
      return 1;
  }
}

/** The custom curve is piecewise linear between three speed handles. */
function customSpeed(ramp: SpeedRamp, x: number): number {
  const s0 = numIn(ramp.startSpeed, 0.2, 4, 1);
  const s1 = numIn(ramp.midSpeed, 0.2, 4, 1);
  const s2 = numIn(ramp.endSpeed, 0.2, 4, 1);
  return x < 0.5 ? s0 + (s1 - s0) * (x * 2) : s1 + (s2 - s1) * (x * 2 - 1);
}

function customIntegral(ramp: SpeedRamp, x: number): number {
  const s0 = numIn(ramp.startSpeed, 0.2, 4, 1);
  const s1 = numIn(ramp.midSpeed, 0.2, 4, 1);
  const s2 = numIn(ramp.endSpeed, 0.2, 4, 1);
  const c = clamp01(x);
  if (c <= 0.5) return s0 * c + (s1 - s0) * c * c;
  const first = s0 * 0.5 + (s1 - s0) * 0.25;
  const u = c - 0.5;
  return first + s1 * u + (s2 - s1) * u * u;
}

/** Human-readable “0.6× → 1.8×” summary for the ramp controls. */
export function rampRange(ramp: SpeedRamp): { min: number; max: number } {
  let min = Infinity;
  let max = 0;
  for (let i = 0; i <= 20; i += 1) {
    const r = warpRate(ramp, i / 20);
    min = Math.min(min, r);
    max = Math.max(max, r);
  }
  return { min: Number.isFinite(min) ? min : 1, max: max || 1 };
}

// ---------------------------------------------------------------------------
// Match cut / zoom transition
// ---------------------------------------------------------------------------

export const ZOOM_INTENSITIES: { id: ZoomIntensityId; label: string; amount: number }[] = [
  { id: 'low', label: 'Low', amount: 0.09 },
  { id: 'medium', label: 'Medium', amount: 0.2 },
  { id: 'high', label: 'High', amount: 0.38 },
];

export function zoomAmount(id: ZoomIntensityId): number {
  return (ZOOM_INTENSITIES.find((z) => z.id === id) || ZOOM_INTENSITIES[1]).amount;
}

/**
 * The scale + motion blur that play across the cut at the head of a clip.
 * `spring()` in Remotion and `easeOutBack` here are the same shape: a quick
 * settle with a little overshoot, which is what sells a match cut.
 */
export function zoomCutAt(z: ZoomCut, localT: number, clipDuration: number): { scale: number; blur: number } {
  if (!z || !z.enabled) return { scale: 1, blur: 0 };
  const amount = zoomAmount(z.intensity);
  const win = numIn(clipDuration * 0.16, 0.18, 0.6, 0.35);
  const p = clamp01(localT / win);
  if (p >= 1) return { scale: 1, blur: 0 };
  const from = z.direction === 'out' ? 1 - amount * 0.6 : 1 + amount;
  const e = easeOutBack(p);
  return {
    scale: from + (1 - from) * e,
    blur: (1 - easeOutCubic(p)) * amount * 34,
  };
}

// ---------------------------------------------------------------------------
// Camera shake
// ---------------------------------------------------------------------------

export const SHAKE_FREQUENCIES: { id: CameraShake['frequency']; label: string; hz: number }[] = [
  { id: 'subtle', label: 'Subtle', hz: 2.4 },
  { id: 'medium', label: 'Medium', hz: 6 },
  { id: 'intense', label: 'Intense', hz: 12.5 },
];

export function shakeHz(id: CameraShake['frequency']): number {
  return (SHAKE_FREQUENCIES.find((f) => f.id === id) || SHAKE_FREQUENCIES[1]).hz;
}

/**
 * Translate + rotate for one frame. Offsets are px against a 1080-tall stage;
 * the caller scales them by the real stage height. The slight scale-up stops
 * the shake from exposing the edge of the frame.
 */
export function shakeAt(s: CameraShake, t: number): { x: number; y: number; rot: number; scale: number } {
  if (!s || !s.enabled || s.intensity <= 0) return { x: 0, y: 0, rot: 0, scale: 1 };
  const amp = clamp01(s.intensity / 100);
  const hz = shakeHz(s.frequency);
  const seed = s.seed || 1;
  return {
    x: noise1(t * hz, seed) * amp * 30,
    y: noise1(t * hz + 37.1, seed + 1) * amp * 24,
    rot: noise1(t * hz * 0.7 + 71.3, seed + 2) * amp * 1.8,
    scale: 1 + amp * 0.06,
  };
}

// ---------------------------------------------------------------------------
// Light leaks and lens flares
// ---------------------------------------------------------------------------

/**
 * Five built-in leaks. They are CSS gradient descriptors rather than bundled
 * PNG/WebM plates on purpose: a gradient is resolution-independent, costs no
 * asset hosting, and — because the server composition reads the same
 * descriptor — renders byte-identically into the MP4. A bundled plate under
 * public/ could not do that: the compiler never copies public/ into the page,
 * and the render service has no route to it.
 */
export const LIGHT_LEAKS: { id: LeakPresetId; label: string; hint: string }[] = [
  { id: 'amberSweep', label: 'Amber Sweep', hint: 'Warm analogue leak drifting across the frame' },
  { id: 'crimsonFlare', label: 'Crimson Flare', hint: 'Deep red bloom from the top corner' },
  { id: 'sunsetBand', label: 'Sunset Band', hint: 'Horizontal orange-to-magenta band rising through the shot' },
  { id: 'cyanPrism', label: 'Cyan Prism', hint: 'Cool anamorphic streak with a prism edge' },
  { id: 'goldenBurst', label: 'Golden Burst', hint: 'Centred golden flare with a hard star core' },
];

/** The window the leak plays inside, in seconds. */
export function leakWindow(state: LeakState, duration: number): { start: number; end: number } {
  const d = Math.max(0.6, duration);
  const span = numIn(d * 0.22, 0.9, 2.4, 1.6);
  if (state.trigger === 'start') return { start: 0, end: span };
  if (state.trigger === 'end') return { start: Math.max(0, d - span), end: d };
  if (state.trigger === 'mid') return { start: Math.max(0, d / 2 - span / 2), end: Math.min(d, d / 2 + span / 2) };
  return { start: 0, end: d };
}

export function leakLayers(state: LeakState, t: number, duration: number): EffectLayer[] {
  if (!state || !state.enabled) return [];
  const win = leakWindow(state, duration);
  let p: number;
  if (state.trigger === 'loop') {
    p = (t % 6) / 6;
  } else {
    if (t < win.start || t > win.end) return [];
    p = clamp01((t - win.start) / Math.max(0.2, win.end - win.start));
  }
  // A sine envelope so the leak always arrives and leaves, never snaps on.
  const env = Math.sin(clamp01(p) * Math.PI) * clamp01(state.intensity / 100);
  if (env <= 0.01) return [];
  const blend = state.blend === 'add' ? 'plus-lighter' : 'screen';
  const sweep = p * 140 - 20;

  switch (state.presetId) {
    case 'crimsonFlare':
      return [
        {
          background: `radial-gradient(ellipse at ${78 - p * 18}% ${12 + p * 10}%, rgba(255,86,70,0.72) 0%, rgba(214,38,60,0.3) 22%, rgba(140,20,50,0) 58%)`,
          opacity: env, blend,
        },
        {
          background: 'linear-gradient(200deg, rgba(255,120,90,0.26) 0%, rgba(255,120,90,0) 46%)',
          opacity: env * 0.8, blend,
        },
      ];
    case 'sunsetBand':
      return [{
        background: `linear-gradient(0deg, rgba(255,120,40,0) ${Math.max(0, sweep - 24)}%, rgba(255,150,70,0.5) ${sweep}%, rgba(236,72,153,0.34) ${sweep + 12}%, rgba(255,90,30,0) ${sweep + 34}%)`,
        opacity: env, blend,
      }];
    case 'cyanPrism':
      return [
        {
          background: `linear-gradient(104deg, rgba(34,211,238,0) ${Math.max(0, sweep - 20)}%, rgba(34,211,238,0.44) ${sweep}%, rgba(167,139,250,0.3) ${sweep + 9}%, rgba(34,211,238,0) ${sweep + 26}%)`,
          opacity: env, blend,
        },
        {
          background: `radial-gradient(circle at ${30 + p * 36}% 48%, rgba(224,255,255,0.4) 0%, rgba(34,211,238,0) 26%)`,
          opacity: env * 0.7, blend,
        },
      ];
    case 'goldenBurst':
      return [
        {
          background: 'radial-gradient(circle at 50% 46%, rgba(255,246,214,0.85) 0%, rgba(255,196,96,0.34) 10%, rgba(255,170,60,0) 42%)',
          opacity: env, blend,
        },
        {
          background: 'linear-gradient(90deg, rgba(255,226,150,0) 26%, rgba(255,232,180,0.46) 50%, rgba(255,226,150,0) 74%)',
          opacity: env * 0.75, blend,
        },
        {
          background: 'linear-gradient(0deg, rgba(255,226,150,0) 34%, rgba(255,240,200,0.3) 50%, rgba(255,226,150,0) 66%)',
          opacity: env * 0.6, blend,
        },
      ];
    default:
      return [
        {
          background: `linear-gradient(118deg, rgba(255,120,40,0) ${Math.max(0, sweep - 28)}%, rgba(255,160,70,0.52) ${sweep}%, rgba(255,90,30,0) ${sweep + 30}%)`,
          opacity: env, blend,
        },
        {
          background: `radial-gradient(ellipse at ${20 + p * 60}% 28%, rgba(255,226,150,0.4) 0%, rgba(255,186,90,0) 36%)`,
          opacity: env * 0.72, blend,
        },
      ];
  }
}

// ---------------------------------------------------------------------------
// VHS
// ---------------------------------------------------------------------------

/** The colour shift and vertical tracking jitter applied to the picture. */
export function vhsFrame(state: VhsState, t: number): { filter: string; translateY: number } {
  if (!state || !state.enabled) return { filter: '', translateY: 0 };
  const k = clamp01(state.intensity / 100);
  const hue = noise1(t * 1.6, 11) * 9 * k;
  const jitter = (noise1(t * 14, 13) + (hash01(Math.floor(t * 9), 17) > 0.86 ? noise1(t * 60, 19) * 3 : 0)) * k * 5;
  return {
    filter: `hue-rotate(${hue.toFixed(2)}deg) saturate(${(1 + k * 0.55).toFixed(3)}) contrast(${(1 + k * 0.1).toFixed(3)})`,
    translateY: jitter,
  };
}

export function vhsLayers(state: VhsState, t: number): EffectLayer[] {
  if (!state || !state.enabled) return [];
  const k = clamp01(state.intensity / 100);
  if (k <= 0.01) return [];
  // The tracking band crawls down the frame the way a worn tape does.
  const band = ((t * 12) % 130) - 15;
  return [
    {
      background: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.42) 0px, rgba(0,0,0,0.42) 1px, rgba(255,255,255,0) 1px, rgba(255,255,255,0) 3px)',
      opacity: 0.55 * k, blend: 'normal',
    },
    {
      background: 'linear-gradient(90deg, rgba(255,0,80,0.2) 0%, rgba(255,0,80,0) 18%, rgba(0,255,220,0) 82%, rgba(0,255,220,0.2) 100%)',
      opacity: 0.8 * k, blend: 'screen',
    },
    {
      background: `linear-gradient(0deg, rgba(255,255,255,0) ${Math.max(0, band - 4)}%, rgba(255,255,255,0.16) ${band}%, rgba(255,255,255,0) ${band + 5}%)`,
      opacity: 0.9 * k, blend: 'screen',
    },
  ];
}

// ---------------------------------------------------------------------------
// Glitch
// ---------------------------------------------------------------------------

/**
 * Glitch fires in bursts, not continuously — a permanent tear reads as a
 * broken player rather than a style. Each ~0.9s block either has a burst or
 * does not, decided by the seeded hash, so the pattern is identical in the
 * preview and in the export.
 */
export function glitchBurst(state: GlitchState, t: number): number {
  if (!state || !state.enabled) return 0;
  const k = clamp01(state.intensity / 100);
  if (k <= 0.01) return 0;
  const block = Math.floor(t / 0.9);
  const chance = 0.3 + k * 0.45;
  if (hash01(block, 23) > chance) return 0;
  const at = (block + hash01(block, 29) * 0.7) * 0.9;
  const len = 0.07 + hash01(block, 31) * 0.13;
  const local = t - at;
  if (local < 0 || local > len) return 0;
  // Square-ish envelope with a quick fall so the tear snaps rather than fades.
  return k * (1 - Math.pow(clamp01(local / len), 3));
}

/**
 * The displacement spec for one glitching frame. A near-zero X frequency with
 * a high Y frequency makes feTurbulence produce constant-value horizontal
 * bands, so feDisplacementMap tears the picture into slices that each shift by
 * a different amount — real slice distortion, not a gradient pretending.
 */
export function glitchSpec(state: GlitchState, t: number, frame: number): { seed: number; scale: number; split: number } | null {
  const amp = glitchBurst(state, t);
  if (amp <= 0.01) return null;
  return {
    seed: (frame % 97) + 1,
    scale: 18 + amp * 90,
    split: amp * 9,
  };
}

// ---------------------------------------------------------------------------
// Deep glow and rays (text treatment)
// ---------------------------------------------------------------------------

/** Layered text-shadow: a tight core, a mid bloom and a wide halo. */
export function glowShadow(color: string, intensity: number, scale = 1): string {
  const k = clamp01(intensity / 100);
  if (k <= 0.01) return '';
  const a = Math.max(1, Math.round(6 * k * scale));
  const b = Math.max(2, Math.round(20 * k * scale));
  const c = Math.max(4, Math.round(52 * k * scale));
  return `0 0 ${a}px ${color}, 0 0 ${b}px ${color}, 0 0 ${c}px ${color}`;
}

/** The pulsing radial rays drawn behind a glowing text layer. */
export function rayLayers(state: GlowState, t: number): EffectLayer[] {
  if (!state || !state.enabled || !state.rays) return [];
  const k = clamp01(state.intensity / 100);
  const pulse = 0.62 + 0.38 * Math.sin(t * 2.1);
  const spin = (t * 9) % 360;
  return [
    {
      background: `radial-gradient(circle at 50% 50%, ${state.color} 0%, rgba(0,0,0,0) 46%)`,
      opacity: 0.3 * k * pulse, blend: 'screen',
    },
    {
      background: `repeating-conic-gradient(from ${spin.toFixed(1)}deg at 50% 50%, ${state.color} 0deg, rgba(0,0,0,0) 5deg, rgba(0,0,0,0) 18deg)`,
      opacity: 0.2 * k * pulse, blend: 'screen',
      extra: { maskImage: 'radial-gradient(circle at 50% 50%, #000 0%, transparent 62%)', WebkitMaskImage: 'radial-gradient(circle at 50% 50%, #000 0%, transparent 62%)' },
    },
  ];
}

// ---------------------------------------------------------------------------
// Turbulent displace
// ---------------------------------------------------------------------------

export const DISPLACE_PRESETS: {
  id: DisplacePresetId; label: string; hint: string;
  type: 'fractalNoise' | 'turbulence';
  freqX: number; freqY: number; octaves: number;
  driftX: number; driftY: number; maxScale: number;
}[] = [
  { id: 'heatWave', label: 'Heat Wave', hint: 'Fine vertical shimmer rising off hot ground', type: 'fractalNoise', freqX: 0.012, freqY: 0.034, octaves: 2, driftX: 0, driftY: -110, maxScale: 26 },
  { id: 'underwater', label: 'Underwater', hint: 'Slow caustic ripple drifting sideways', type: 'fractalNoise', freqX: 0.021, freqY: 0.013, octaves: 3, driftX: 34, driftY: 16, maxScale: 38 },
  { id: 'liquid', label: 'Liquid', hint: 'Heavy rolling distortion, like film through water', type: 'turbulence', freqX: 0.007, freqY: 0.009, octaves: 4, driftX: 20, driftY: -12, maxScale: 56 },
];

export function displacePreset(id: DisplacePresetId) {
  return DISPLACE_PRESETS.find((p) => p.id === id) || DISPLACE_PRESETS[0];
}

/**
 * feTurbulence is a real Perlin field, so the displacement is genuine noise
 * rather than a sine approximation. The field is held at one seed and SLID by
 * feOffset instead of being re-seeded, which is what makes it flow smoothly
 * from frame to frame instead of boiling.
 */
export function displaceSpec(state: DisplaceState, t: number): {
  type: string; baseFrequency: string; octaves: number; seed: number;
  dx: number; dy: number; scale: number;
} | null {
  if (!state || !state.enabled) return null;
  const k = clamp01(state.intensity / 100);
  if (k <= 0.01) return null;
  const p = displacePreset(state.presetId);
  return {
    type: p.type,
    baseFrequency: `${p.freqX} ${p.freqY}`,
    octaves: p.octaves,
    seed: 7,
    dx: Number((p.driftX * t).toFixed(2)),
    dy: Number((p.driftY * t).toFixed(2)),
    scale: Number((p.maxScale * k).toFixed(2)),
  };
}

// ---------------------------------------------------------------------------
// Chroma key
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return [0, 1, 0];
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

export interface ChromaSpec {
  /** 4x5 feColorMatrix: identity RGB, alpha replaced by the key distance. */
  keyMatrix: number[];
  /** feFuncA type="linear" — turns the key distance into tolerance + softness. */
  slope: number;
  intercept: number;
  /** 4x5 feColorMatrix that pulls the key colour back out of the edges. */
  spillMatrix: number[];
  spillOn: boolean;
}

/**
 * Build the SVG filter numbers for a key colour.
 *
 * The key distance is a chroma difference: project the pixel onto the key
 * colour's own chroma axis (the colour minus its grey component). Pure key
 * colour scores 1, every neutral scores 0, and an unrelated hue scores
 * negative and clamps away — which is why a green key leaves warm skin tones
 * completely alone.
 */
export function chromaSpec(ck: ChromaKeyState): ChromaSpec | null {
  if (!ck || !ck.enabled) return null;
  const [r, g, b] = hexToRgb(ck.color);
  const mean = (r + g + b) / 3;
  let d: [number, number, number] = [r - mean, g - mean, b - mean];
  let dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  if (dd < 0.004) {
    // A near-grey “key colour” has no chroma to key on — fall back to green.
    d = [-1 / 3, 2 / 3, -1 / 3];
    dd = 2 / 3;
  }
  const gain = 1 / dd;
  const w = [d[0] * gain, d[1] * gain, d[2] * gain];

  const tolerance = clamp01(ck.tolerance);
  const softness = clamp01(ck.softness);
  const hi = numIn(1 - 0.88 * tolerance, 0.08, 1, 0.5);
  const lo = Math.max(0, hi - (0.02 + 0.62 * softness));
  const span = Math.max(0.02, hi - lo);

  const spill = clamp01(ck.spill);
  const sm = (i: number, j: number) => (i === j ? 1 : 0) - spill * w[i] * d[j];

  return {
    keyMatrix: [
      1, 0, 0, 0, 0,
      0, 1, 0, 0, 0,
      0, 0, 1, 0, 0,
      w[0], w[1], w[2], 0, 0,
    ].map((n) => Number(n.toFixed(5))),
    slope: Number((-1 / span).toFixed(5)),
    intercept: Number((hi / span).toFixed(5)),
    spillMatrix: [
      sm(0, 0), sm(0, 1), sm(0, 2), 0, 0,
      sm(1, 0), sm(1, 1), sm(1, 2), 0, 0,
      sm(2, 0), sm(2, 1), sm(2, 2), 0, 0,
      0, 0, 0, 1, 0,
    ].map((n) => Number(n.toFixed(5))),
    spillOn: spill > 0.01,
  };
}

// ---------------------------------------------------------------------------
// B-roll overlay geometry
// ---------------------------------------------------------------------------

export const OVERLAY_POSITIONS: { id: string; label: string; hint: string }[] = [
  { id: 'full', label: 'Full frame', hint: 'The cutaway covers the whole shot' },
  { id: 'pipTopRight', label: 'PiP · top right', hint: 'Small inset in the top-right corner' },
  { id: 'pipBottomLeft', label: 'PiP · bottom left', hint: 'Small inset in the bottom-left corner' },
  { id: 'pipTopLeft', label: 'PiP · top left', hint: 'Small inset in the top-left corner' },
  { id: 'pipBottomRight', label: 'PiP · bottom right', hint: 'Small inset in the bottom-right corner' },
];

/** Normalised box (0..1 of the stage) for an overlay position. */
export function overlayBox(position: string, scale: number): { left: number; top: number; width: number; height: number } {
  if (position === 'full') return { left: 0, top: 0, width: 1, height: 1 };
  const w = numIn(scale, 0.12, 0.7, 0.32);
  const h = w;
  const pad = 0.04;
  switch (position) {
    case 'pipTopLeft': return { left: pad, top: pad, width: w, height: h };
    case 'pipBottomLeft': return { left: pad, top: 1 - pad - h, width: w, height: h };
    case 'pipBottomRight': return { left: 1 - pad - w, top: 1 - pad - h, width: w, height: h };
    default: return { left: 1 - pad - w, top: pad, width: w, height: h };
  }
}
