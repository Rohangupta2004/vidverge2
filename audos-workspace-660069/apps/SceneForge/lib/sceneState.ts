import type { Scene } from './supabase';
import { visualKindOf, type VisualKind } from './effects';
import { hasFreshMotionClip } from './motionCapture';

export const isVideoUrl = (url?: string | null) => /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(String(url || ''));

/**
 * How a scene is produced. 'legacy' is a pre-rework scene that carries its own
 * bespoke Remotion code: it keeps working exactly as before (its render_url,
 * video or still, plays in the final composition), but no new code is ever
 * written for it.
 */
export type SceneKind = VisualKind | 'legacy';
export function sceneKind(scene: Scene): SceneKind {
  if (!scene.visual_kind && scene.remotion_code) return 'legacy';
  return visualKindOf(scene.visual_kind);
}

/** The still a scene would show (its own render when that render is not a video, or the picked asset). */
export function sceneStillUrl(scene: Scene): string {
  if (scene.render_url && !isVideoUrl(scene.render_url)) return scene.render_url;
  if (scene.overlay_config?.showAsset !== false && scene.overlay_config?.assetUrl) return scene.overlay_config.assetUrl;
  return '';
}

/**
 * "Settled" = assembly needs nothing more from this scene. Mirrors the
 * sceneforge-v2 server function's sceneSettled so board, checks and server
 * progress agree:
 *  - skipped scenes are settled (they are simply out of the film),
 *  - a scene mid-generation or in error is not settled (error is resolved by
 *    one click: retry, switch type, or skip),
 *  - ai_video scenes settle when their generated clip exists,
 *  - motion_graphic / text_overlay scenes settle when the motion-graphics
 *    engine has captured a clip of the CURRENT spec (an edited spec always
 *    re-captures — stale text is never shipped),
 *  - image scenes settle when they have a still,
 *  - legacy text_graphics scenes settle immediately — their overlay is
 *    composed inside the final assembly render, nothing to pre-render,
 *  - legacy coded scenes settle once they have any visual.
 */
export function sceneSettled(scene: Scene): boolean {
  if (scene.status === 'skipped') return true;
  if (scene.status === 'generating' || scene.status === 'error') return false;
  const kind = sceneKind(scene);
  if (kind === 'ai_video') return isVideoUrl(scene.render_url);
  // An over-avatar text overlay is composed directly at final assembly (the
  // presenter stays visible underneath), so there is no clip to capture.
  if (kind === 'text_overlay' && scene.overlay_config?.overAvatar === true) return true;
  if (kind === 'motion_graphic' || kind === 'text_overlay') return hasFreshMotionClip(scene);
  if (kind === 'image') return Boolean(sceneStillUrl(scene));
  if (kind === 'legacy') return Boolean(scene.render_url);
  return true;
}

/** True when the batch generator still has something to produce for the scene. */
export function sceneNeedsGeneration(scene: Scene): boolean {
  if (scene.status === 'skipped') return false;
  const kind = sceneKind(scene);
  if (kind === 'ai_video') return !isVideoUrl(scene.render_url);
  // Over-avatar text overlays are composed at assembly — nothing to capture.
  if (kind === 'text_overlay' && scene.overlay_config?.overAvatar === true) return false;
  if (kind === 'motion_graphic' || kind === 'text_overlay') return !hasFreshMotionClip(scene);
  if (kind === 'image') return !sceneStillUrl(scene);
  if (kind === 'legacy') return !scene.render_url;
  // Legacy text/graphics: only when the scene wants a visual asset it doesn't have.
  const wantsAsset = scene.overlay_config?.showAsset !== false;
  const hasVisual = Boolean(scene.render_url || scene.overlay_config?.assetUrl);
  return wantsAsset && !hasVisual && Boolean(scene.image_prompts?.length || scene.description);
}
