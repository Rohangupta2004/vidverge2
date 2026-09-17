/**
 * The 4 motion presets. A preset controls spring config (for entrances),
 * stagger step, transition style, crossfade overlap between scenes, and the
 * pace multiplier applied to plan durations. It NEVER changes layout, crop
 * geometry, or cursor targets — those belong to the plan.
 *
 * Physics rules the presets serve:
 * - all entrances are springs with one config per preset
 * - camera moves use smoothstep over the long window, never springs
 * - anything that scales also fades
 * - overshoot is for objects only, never for the frame
 */
export interface MotionPreset {
  name: 'calm' | 'snappy' | 'cinematic' | 'kinetic';
  damping: number;
  mass: number;
  stiffness: number;
  /** frames between staggered siblings */
  stagger: number;
  /** multiplier on plan durations (<1 = faster) */
  pace: number;
  /** frames of crossfade overlap between scenes */
  crossfade: number;
  transition: 'dissolve' | 'cut' | 'drift';
}

export const MOTION_PRESETS: Record<string, MotionPreset> = {
  calm:      { name: 'calm',      damping: 200, mass: 0.7,  stiffness: 120, stagger: 9,  pace: 1.0,  crossfade: 12, transition: 'dissolve' },
  snappy:    { name: 'snappy',    damping: 22,  mass: 0.4,  stiffness: 170, stagger: 4,  pace: 0.78, crossfade: 6,  transition: 'cut' },
  cinematic: { name: 'cinematic', damping: 200, mass: 1.5,  stiffness: 90,  stagger: 13, pace: 1.28, crossfade: 18, transition: 'drift' },
  kinetic:   { name: 'kinetic',   damping: 11,  mass: 0.35, stiffness: 210, stagger: 3,  pace: 0.68, crossfade: 4,  transition: 'cut' },
};

export function presetFor(name: string): MotionPreset {
  return MOTION_PRESETS[name] || MOTION_PRESETS.snappy;
}
