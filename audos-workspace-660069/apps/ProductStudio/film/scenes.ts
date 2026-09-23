/**
 * CAPTURED SCENES — the deterministic (non-generative-video) scene builders
 * of the Ad Director pipeline. Each returns a BuiltAnimation the capture
 * layer records to a real clip in the browser:
 *
 *   - mockup:  the user's REAL screenshot inside a phone/laptop/browser frame
 *              (generative video is never asked to recreate a UI), plus the
 *              Ad Director's cursor/click/callout interaction layer for
 *              PRODUCT_UI / UI_ANIMATION scenes
 *   - graphic: exact-text motion graphics that EXPLAIN ideas (flows, compares,
 *              timelines, diagrams, stats — GSAP + SVG, no Remotion)
 *   - asset:   an Asset Generator image treated with cinematic motion and
 *              deterministic labels
 *
 * SCENE DURATION IS VOICE-DERIVED: the orchestrator sets scene.duration_s
 * from the measured narration audio before any build happens here.
 *
 * Every captured scene can carry the film's ambient MOTION-DESIGN BACKDROP —
 * injected into the same SVG so it renders behind the main content.
 */

import type { GraphicSpec, MockupSpec } from '../../ScriptToVideo/api';
import { buildGraphic, inlineGraphicImages } from '../../ScriptToVideo/pipeline/graphics';
import { buildMockup, inlineMockupImages } from '../../ScriptToVideo/pipeline/mockup';
import type { BuiltAnimation } from '../../ScriptToVideo/pipeline/capture';
import { AssetSceneSpec, Film, FilmScene, frameSize } from './api';
import { MotionPalette, injectMotionBackdrop } from './motion';
import { injectCursorAnimation } from './uiMotion';

/** The film's brand palette — the single source every captured scene and
 * motion layer derives from, so the whole film reads as ONE brand. */
export function brandPalette(film: Film): MotionPalette {
  const c = film.brief?.brand?.colors || null;
  return {
    bg: (c?.background && /^#/.test(c.background)) ? String(c.background) : '#0E0F14',
    ink: (c?.text && /^#/.test(c.text)) ? String(c.text) : '#F2F1ED',
    accent: (c?.primary && /^#/.test(c.primary)) ? String(c.primary) : '#FF6B4A',
    accent2: (c?.accent && /^#/.test(c.accent)) ? String(c.accent) : ((c?.secondary && /^#/.test(c.secondary)) ? String(c.secondary) : '#E8A33C'),
  };
}

function assetToGraphicSpec(spec: AssetSceneSpec, assetUrl: string, P: MotionPalette): GraphicSpec {
  const labels = Array.isArray(spec.labels) ? spec.labels.filter((l) => l && l.text) : [];
  const palette = { bg: P.bg, ink: P.ink, accent: P.accent, accent2: P.accent2, ...(spec.palette || {}) };
  if (labels.length > 1) {
    return {
      treatment: 'annotated',
      backdropUrl: assetUrl,
      title: spec.headline || undefined,
      items: labels.map((l) => ({ label: String(l.text) })),
      palette,
      texture: 'none',
      duration_s: spec.duration_s,
    } as GraphicSpec;
  }
  return {
    treatment: 'documentary_card',
    backdropUrl: assetUrl,
    title: spec.headline || labels[0]?.text || '',
    palette,
    texture: 'none',
    duration_s: spec.duration_s,
  } as GraphicSpec;
}

/**
 * Build the animation for a captured (non-Veo) scene. Asset scenes must have
 * their image resolved first — the orchestrator runs the cached Asset
 * Generator and stores the URL in layer_urls.asset before calling this.
 */
export async function buildCapturedScene(film: Film, scene: FilmScene): Promise<BuiltAnimation> {
  const aspect = (film.aspect_ratio || '16:9') as '16:9' | '9:16';
  const { W, H } = frameSize(aspect);
  const P = brandPalette(film);
  const durationS = Math.min(14, Math.max(3, Number(scene.duration_s) || 6));
  let built: BuiltAnimation;

  if (scene.source === 'mockup') {
    const raw = { ...(scene.spec as MockupSpec & { cursor?: { action?: 'click' | 'move' | 'scroll' | 'type'; callout?: string } }) };
    if (!raw.screenshot_url) raw.screenshot_url = (film.screenshots || [])[0] || film.brief?.site_screenshot_url || '';
    if (!raw.screenshot_url) throw new Error('This product-UI scene has no real screenshot — upload one (or provide the product URL) and regenerate the scene.');
    if (!raw.palette) raw.palette = { bg: P.bg, ink: P.ink, accent: P.accent, accent2: P.accent2 };
    const inlined = await inlineMockupImages(raw);
    built = await buildMockup(inlined, W, H, durationS);
    // The interaction layer: PRODUCT_UI / UI_ANIMATION scenes get a real
    // travelling cursor (click/type/scroll) and an optional callout label.
    const vt = String(scene.visual_type || '');
    const wantsCursor = !!raw.cursor || vt === 'UI_ANIMATION' || vt === 'PRODUCT_UI';
    if (wantsCursor) {
      injectCursorAnimation({
        svg: built.svg,
        timeline: built.timeline,
        durationSec: built.durationSec,
        device: (raw.device === 'phone' || raw.device === 'laptop') ? raw.device : 'browser',
        hasHeadline: !!raw.headline,
        focus: raw.focus || null,
        cursor: raw.cursor || { action: vt === 'UI_ANIMATION' ? 'click' : 'move' },
        accent: (raw.palette && raw.palette.accent) || P.accent,
        W, H,
      });
    }
  } else if (scene.source === 'asset') {
    const spec = scene.spec as AssetSceneSpec;
    const assetUrl = scene.layer_urls?.asset || spec.asset_url || '';
    if (!assetUrl) throw new Error('This asset scene has no image yet — regenerate the scene.');
    const gspec = assetToGraphicSpec(spec, assetUrl, P);
    const inlined = await inlineGraphicImages(gspec);
    built = buildGraphic(inlined, W, H, durationS, scene.scene_key);
  } else {
    const gspec = { ...(scene.spec as GraphicSpec) };
    if (!gspec.treatment) (gspec as any).treatment = 'kinetic_type';
    if (!gspec.palette) gspec.palette = { bg: P.bg, ink: P.ink, accent: P.accent, accent2: P.accent2 };
    // BEFORE/AFTER scenes always read as a labelled transformation.
    if (scene.visual_type === 'BEFORE_AFTER' && gspec.treatment === 'compare') {
      if (!gspec.leftTitle) gspec.leftTitle = 'Before';
      if (!gspec.rightTitle) gspec.rightTitle = 'After';
    }
    const inlined = await inlineGraphicImages(gspec);
    built = buildGraphic(inlined, W, H, durationS, scene.scene_key);
  }

  // Ambient motion-design backdrop — same SVG, same recording pass.
  const paletteForMotion = { ...P, ...((scene.spec as any)?.palette || {}) } as MotionPalette;
  injectMotionBackdrop(built.svg, built.timeline, scene.motion, paletteForMotion, W, H, built.durationSec);
  return built;
}
