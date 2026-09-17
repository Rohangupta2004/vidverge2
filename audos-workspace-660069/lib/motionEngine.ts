/**
 * motionEngine — the shared motion vocabulary every generated scene uses.
 * (Planned as src/motionEngine.ts; the platform compiler only accepts shared
 * modules under lib/, so this is the canonical location.)
 *
 * CANONICAL SOURCE. Scene compositions are rendered server-side by the
 * platform's Remotion service, which accepts exactly ONE compositionTsx string
 * per render — imports between workspace files cannot cross that boundary.
 * The sceneforge-run server function therefore inlines a byte-equivalent JS
 * copy of these helpers (MOTION_PRELUDE) into every generated scene before
 * submitting it. If you change a helper here, mirror the change there.
 *
 * The house animation style is 12fps-on-30fps: every animated value is snapped
 * through posterizeTime so motion steps like hand-made stop-motion instead of
 * gliding, then layered with boil, drift and spring energy.
 */

/** The render service's fixed frame rate. All helpers assume it. */
export const BASE_FPS = 30;

/**
 * Snap a frame number to a lower effective frame rate (default 12fps).
 * `posterizeTime(frame)` inside useCurrentFrame-driven math is what makes
 * motion "step" — feed the returned value into interpolate/sin instead of the
 * raw frame.
 */
export function posterizeTime(frame: number, fps = 12): number {
  const step = BASE_FPS / Math.max(1, fps);
  return Math.floor(frame / step) * step;
}

/**
 * Character boil — the hand-drawn wobble that keeps a still cut-out alive.
 * Layered sines at unrelated frequencies, sampled on posterized time so the
 * boil pops at 12fps. Returns a value in roughly [-amplitude, +amplitude].
 */
export function boilWobble(frame: number, amplitude = 2, frequency = 0.35): number {
  const t = posterizeTime(frame);
  return (
    Math.sin(t * frequency) * amplitude * 0.6 +
    Math.sin(t * frequency * 2.7 + 1.3) * amplitude * 0.3 +
    Math.sin(t * frequency * 5.1 + 4.2) * amplitude * 0.1
  );
}

/**
 * Parallax drift — a slow, constant slide for background/mid layers.
 * speed is pixels per frame (use small values: 0.05–0.4). Snapped to 12fps so
 * even the drift steps with the house style.
 */
export function slowDrift(frame: number, speed = 0.1): number {
  return posterizeTime(frame) * speed;
}

/**
 * Ping-pong oscillator — rises 0→1 over the first half of `period` frames and
 * falls back 1→0 over the second half, forever. Multiply into scale/rotation
 * for breathing and sway.
 */
export function pingpong(frame: number, period = 120): number {
  const p = Math.max(2, period);
  const t = (((frame % p) + p) % p) / p;
  return t < 0.5 ? t * 2 : 2 - t * 2;
}

/**
 * Spring pop-in — a closed-form damped spring from 0 to 1 starting at
 * `startFrame`. stiffness sets the speed, damping the settle; the default pair
 * overshoots slightly (the collage "slap-down") before settling on 1.
 * Sampled on posterized time so entrances step at 12fps like everything else.
 */
export function springEntrance(frame: number, startFrame = 0, stiffness = 120, damping = 12): number {
  if (frame < startFrame) return 0;
  const local = posterizeTime(Math.max(0, frame - startFrame));
  const t = local / BASE_FPS;
  const omega = Math.sqrt(Math.max(1, stiffness));
  const zeta = Math.min(0.999, damping / (2 * omega));
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  const decay = Math.exp(-zeta * omega * t);
  const v = 1 - decay * (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t));
  return Math.abs(1 - v) < 0.001 ? 1 : v;
}
