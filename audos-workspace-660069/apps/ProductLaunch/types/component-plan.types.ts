// ComponentPlan — the hand-off between creative and engineering.
//
// The code step never reads the FilmSpec. It reads this: concrete, typed
// component instances with concrete props and absolute frame positions. That
// separation is what makes the compile gate meaningful — a plan can be checked
// against the SDK schema before a single line of TSX exists.

export interface ComponentInstance {
  component: string;   // must be a valid SDK component name
  props: Record<string, unknown>;
  startFrame?: number; // relative to scene start
  durationFrames?: number;
}

export interface SceneComponentPlan {
  scene_id: string;
  role: string;
  duration_frames: number;
  start_frame: number;   // absolute frame in the composition
  layers: ComponentInstance[];  // ordered back-to-front
  narration_text?: string;
  transition_out?: string;
  /** Filled by the planner when a FilmSpec component could not be given valid props. */
  warnings?: string[];
}

export interface ComponentPlan {
  film_spec_version: string;
  total_frames: number;
  fps: number;
  width: number;
  height: number;
  scenes: SceneComponentPlan[];
  audio_config?: {
    narration_enabled: boolean;
    narration_voice?: string;
    music_style?: string;
  };
}

/** Every warning the planner raised, flattened with its scene for display. */
export function planWarnings(plan: ComponentPlan): Array<{ scene_id: string; warning: string }> {
  const out: Array<{ scene_id: string; warning: string }> = [];
  for (const scene of plan.scenes) {
    for (const warning of scene.warnings || []) out.push({ scene_id: scene.scene_id, warning });
  }
  return out;
}

/** Props whose value is an asset handle rather than free text. */
export const ASSET_HANDLE_PROPS = ['src', 'screenshot', 'fromScreenshot', 'toScreenshot', 'items'];

/** Every asset handle the plan actually references, de-duplicated, in first-use order. */
export function planAssetHandles(plan: ComponentPlan): string[] {
  const seen: string[] = [];
  const add = (value: unknown): void => {
    if (typeof value === 'string' && value && seen.indexOf(value) < 0) seen.push(value);
  };
  const visit = (layer: ComponentInstance): void => {
    const props = layer.props || {};
    for (const key of ASSET_HANDLE_PROPS) {
      const value = props[key];
      if (Array.isArray(value)) value.forEach(add);
      else add(value);
    }
    const children = props.children;
    if (Array.isArray(children)) (children as ComponentInstance[]).forEach(visit);
  };
  for (const scene of plan.scenes) scene.layers.forEach(visit);
  return seen;
}
