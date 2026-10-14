import type { Scene } from './supabase';
import { visualKindOf } from './effects';
import { motionFingerprint, normalizeMotionSpec, specFromOverlay, type MotionSpec } from './motionSpec';
import { directionFingerprint, normalizeSceneDirection, type SceneDirection } from './visualTimeline';

/** The exact deterministic spec represented by a scene row. */
export function sceneMotionSpec(scene: Scene): MotionSpec {
  const kind = visualKindOf(scene.visual_kind);
  if (scene.spec && typeof scene.spec === 'object') {
    const spec = normalizeMotionSpec(scene.spec, scene.description);
    if (kind === 'text_overlay' && scene.overlay_config?.text) {
      spec.title = scene.overlay_config.text;
      spec.subtitle = scene.overlay_config.subtext || spec.subtitle;
    }
    return spec;
  }
  const fromOverlay = specFromOverlay(scene.overlay_config, scene.description);
  if (kind !== 'text_overlay' && scene.overlay_config?.assetUrl) fromOverlay.imageUrl = scene.overlay_config.assetUrl;
  return fromOverlay;
}

/** Scene-window duration used by deterministic composition and provider work. */
export function sceneMotionDuration(scene: Scene): number {
  const span = Number(scene.script_end_sec) - Number(scene.script_start_sec);
  return Number.isFinite(span) && span > 0 ? span : 6;
}

/** A direction is usable only while it still describes the current spec. */
export function sceneDirection(scene: Scene): SceneDirection | null {
  const direction = normalizeSceneDirection((scene as Scene & { director_timeline?: unknown }).director_timeline);
  if (!direction) return null;
  if (direction.spec_fingerprint && direction.spec_fingerprint !== motionFingerprint(sceneMotionSpec(scene))) return null;
  return direction;
}

/** Legacy `mg:` fingerprint retained so historical captured clips stay readable. */
export function legacyMotionFingerprint(scene: Scene): string {
  const base = motionFingerprint(sceneMotionSpec(scene));
  const direction = sceneDirection(scene);
  return direction ? `${base}.d${directionFingerprint(direction)}` : base;
}
