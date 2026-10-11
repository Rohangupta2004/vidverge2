// PRODUCT GRAPHICS — the beats that show the PRODUCT, rendered by HeyGen
// HyperFrames instead of composited as separate Remotion layers.
//
// WHAT WAS WRONG. A feature card, a stat callout, a step sequence, a UI
// highlight and a comparison table were each drawn as their own layer and then
// composited over the presenter at assembly. Three things went wrong every time:
// the layer and the avatar were scaled by different passes so they never quite
// aligned, z-order between the card and the overlay plate was decided in two
// places, and the graphic's duration came from the template rather than from the
// narration it was explaining.
//
// WHAT HAPPENS NOW. A product-graphic beat is rendered BY HEYGEN as one finished
// overlay clip (lib/heygenFrames → `POST v3/hyperframes/renders`), timed to the
// EDITORIAL beat window — `script_end_sec - script_start_sec`, the seconds the
// narration actually spends on it — and handed to the compositor as a single
// clip. One renderer, one frame, one timing source.
//
// WHAT THIS DOES NOT TOUCH. Charts, timelines, node graphs, branching diagrams
// and kinetic typography are NOT product graphics: they are data visualisation
// and abstract motion, which the GSAP engine does well and HyperFrames would do
// worse. They stay exactly where they were. Nor does anything here touch the
// Remotion assembly compositor or the ElevenLabs → HeyGen voice pipeline.
//
// THE FALLBACK IS THE EXISTING PATH. HyperFrames is capability-gated like every
// other HeyGen extra (lib/heygenApi), so an account without it keeps the
// Remotion/GSAP graphic renderer — same scene, same spec, same timing, drawn the
// old way. Nothing is removed until HeyGen has answered.

import { CapabilityUnavailable, capabilityState } from './heygenApi';
import { renderFrame } from './heygenFrames';
import { brandKitFromWorkspace, type AspectRatio, type BrandKit, type CardTemplateId } from './motionEditor';
import { accentForSpec, motionFingerprint, type MotionKind, type MotionSpec } from './motionSpec';
import { sceneMotionSpec } from './motionCapture';
import { uploadFile } from './proxy';
import { updateScene, type Project, type Scene } from './supabase';

/** The five product primitives, named the way the brief names them. */
export type ProductGraphicKind = 'feature_card' | 'stat_callout' | 'step_sequence' | 'ui_highlight' | 'comparison_table';

// Which motion-graphic layouts ARE product graphics. Deliberately a short list:
// everything absent from it keeps the renderer it already had.
const SPEC_TO_PRODUCT: Partial<Record<MotionKind, ProductGraphicKind>> = {
  list_reveal: 'feature_card',
  big_stat: 'stat_callout',
  flowchart: 'step_sequence',
  annotated_image: 'ui_highlight',
  comparison: 'comparison_table',
};

const TEMPLATE_FOR: Record<ProductGraphicKind, CardTemplateId> = {
  feature_card: 'feature-card',
  stat_callout: 'stat-counter',
  step_sequence: 'step-sequence',
  ui_highlight: 'ui-highlight',
  comparison_table: 'comparison-table',
};

export const PRODUCT_GRAPHIC_LABELS: Record<ProductGraphicKind, string> = {
  feature_card: 'feature card',
  stat_callout: 'stat callout',
  step_sequence: 'step sequence',
  ui_highlight: 'UI highlight',
  comparison_table: 'comparison table',
};

/** Which product primitive this spec is, or null when it is not one. */
export function productGraphicKind(spec: MotionSpec | null | undefined): ProductGraphicKind | null {
  if (!spec) return null;
  const kind = SPEC_TO_PRODUCT[spec.kind];
  if (!kind) return null;
  // A "UI highlight" with no screenshot is just a label on a plate; the GSAP
  // annotated-image renderer handles that case better than an empty frame would.
  if (kind === 'ui_highlight' && !spec.imageUrl) return null;
  // A comparison with one empty side is not a comparison. The orchestrator is
  // told to fill both, but a plan that did not must not render a half table.
  if (kind === 'comparison_table' && (!spec.leftItems?.length || !spec.rightItems?.length)) return null;
  if (kind === 'stat_callout' && !spec.stat) return null;
  if ((kind === 'feature_card' || kind === 'step_sequence') && !spec.items.length) return null;
  return kind;
}

export function isProductGraphicBeat(spec: MotionSpec | null | undefined): boolean {
  return productGraphicKind(spec) !== null;
}

/** True once HeyGen has told us HyperFrames is not on this account's plan. */
export function hyperFramesRuledOut(): boolean {
  return capabilityState('hyperframes') === 'unavailable';
}

// ——— Timing ———

const sec = (value: unknown) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : 0; };

/**
 * The seconds this beat is on screen, taken from the EDITORIAL timeline.
 *
 * The scene's window is `script_start_sec → script_end_sec`: the narration the
 * graphic exists to explain. A template's `defaultDuration` is an arbitrary
 * number by comparison, and using it is how a four-second explanation ended up
 * under a six-second card.
 */
export function beatWindowSec(scene: Scene, spec?: MotionSpec | null): number {
  const window = Math.max(0, sec(scene.script_end_sec) - sec(scene.script_start_sec));
  const fallback = sec(spec?.durationSec) || 5;
  return Math.round(Math.min(20, Math.max(2, window || fallback)) * 10) / 10;
}

// ——— Freshness ———
//
// The marker keeps the `mg:` prefix the rest of the pipeline tests for
// (lib/motionSpec.isMotionFingerprint) while still being distinguishable from a
// GSAP capture, so switching renderers re-renders rather than silently reusing a
// clip that was drawn the other way.

const PRODUCT_MARKER = 'hf';

export function productGraphicFingerprint(spec: MotionSpec, kind: ProductGraphicKind, durationSec: number): string {
  return `${motionFingerprint(spec)}:${PRODUCT_MARKER}:${kind}:${Math.round(durationSec * 10)}`;
}

export function isProductGraphicFingerprint(value?: string | null): boolean {
  return /:hf:/.test(String(value || ''));
}

function isVideo(url: string): boolean {
  return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url);
}

/** True when the scene already carries a HyperFrames clip of exactly this beat. */
export function hasFreshProductGraphic(scene: Scene, fingerprint: string): boolean {
  return isVideo(String(scene.render_url || '')) && String(scene.video_prompt || '') === fingerprint;
}

// ——— Spec → HyperFrame variables ———

const text = (value: unknown, max = 160) => String(value == null ? '' : value).trim().slice(0, max);

/**
 * The bundle variables for one product beat.
 *
 * Every string comes verbatim from the MotionSpec, which is the deterministic
 * text source for the whole pipeline — the renderer changed, the words did not.
 */
export function productGraphicVariables(spec: MotionSpec, kind: ProductGraphicKind): Record<string, string> {
  const items = Array.isArray(spec.items) ? spec.items : [];
  switch (kind) {
    case 'feature_card':
      return {
        headline: text(spec.title || spec.subtitle, 110),
        bullet1: text(items[0]?.label, 120),
        bullet2: text(items[1]?.label, 120),
        bullet3: text(items[2]?.label, 120),
      };
    case 'stat_callout':
      return {
        stat: text(spec.stat?.value, 24),
        prefix: text(spec.stat?.prefix, 12),
        suffix: text(spec.stat?.suffix, 16),
        label: text(spec.stat?.label || spec.title, 120),
      };
    case 'step_sequence':
      return {
        headline: text(spec.title, 110),
        // Five steps is the bundle's ceiling; the spec's own ceiling is six, so a
        // sixth step is carried into the fifth row rather than dropped silently.
        step1: text(items[0]?.label, 120),
        step2: text(items[1]?.label, 120),
        step3: text(items[2]?.label, 120),
        step4: text(items[3]?.label, 120),
        step5: text(items.slice(4).map((item) => item.label).filter(Boolean).join(' \u00b7 '), 120),
      };
    case 'ui_highlight':
      return {
        image: String(spec.imageUrl || ''),
        label: text(items[0]?.label || spec.title, 110),
        detail: text(items[0]?.sublabel || spec.subtitle, 180),
        // The spec has no coordinates, so the highlight sits just below centre —
        // where a product screenshot's primary action almost always is.
        focusX: '50',
        focusY: '52',
      };
    case 'comparison_table': {
      const left = spec.leftItems || [];
      const right = spec.rightItems || [];
      return {
        leftTitle: text(spec.leftTitle, 60),
        rightTitle: text(spec.rightTitle, 60),
        left1: text(left[0], 120),
        right1: text(right[0], 120),
        left2: text(left[1], 120),
        right2: text(right[1], 120),
        left3: text(left[2], 120),
        right3: text(right[2], 120),
        left4: text(left.slice(3).join(' \u00b7 '), 120),
        right4: text(right.slice(3).join(' \u00b7 '), 120),
      };
    }
    default:
      return {};
  }
}

/** The brand the frame renders in: the workspace kit, accented by the spec. */
export function productGraphicBrand(spec: MotionSpec, project?: Project | null): BrandKit {
  return brandKitFromWorkspace({
    accent: accentForSpec(spec, String(project?.topic || '')),
    // The compositor's own backdrop, so a HyperFrame cuts into the film rather
    // than arriving as a card from somewhere else.
    contrast: '#0A0F1E',
  });
}

// ——— Rendering ———

/**
 * Re-host a finished HeyGen clip on workspace storage.
 *
 * HeyGen serves media from CloudFront with a signed `Expires`, and a scene's
 * `render_url` has to still resolve when the film is assembled hours later. A
 * browser that refuses the cross-origin read keeps HeyGen's URL — the clip is
 * correct right now, and the assembly has its own link-refresh path — so a CORS
 * policy never costs the render.
 */
async function durableClipUrl(url: string, filename: string, folder: string): Promise<string> {
  try {
    const response = await fetch(url);
    if (!response.ok) return url;
    const blob = await response.blob();
    if (!blob.size) return url;
    const stored = await uploadFile(new File([blob], filename, { type: blob.type || 'video/mp4' }), folder);
    return stored.url || url;
  } catch {
    return url;
  }
}

export interface ProductGraphicResult {
  videoUrl: string;
  fingerprint: string;
  kind: ProductGraphicKind;
  template: CardTemplateId;
  /** The editorial beat window this frame was rendered to, in seconds. */
  durationSec: number;
  reused: boolean;
}

export interface ProductGraphicOptions {
  force?: boolean;
  onNote?: (note: string) => void;
}

/**
 * Render one product-graphic beat through HeyGen HyperFrames and persist it onto
 * the scene exactly as the capture path does.
 *
 * Throws `CapabilityUnavailable` when the account has no HyperFrames endpoint —
 * the caller's signal to draw the beat the old way — and throws whatever HeyGen
 * said for any other failure, which the caller also treats as "fall back" rather
 * than as a dead scene.
 */
export async function renderProductGraphic(project: Project, scene: Scene, options: ProductGraphicOptions = {}): Promise<ProductGraphicResult> {
  const spec = sceneMotionSpec(scene);
  const kind = productGraphicKind(spec);
  if (!kind) throw new Error(`Scene ${scene.scene_index} is not a product-graphic beat.`);
  if (hyperFramesRuledOut()) throw new CapabilityUnavailable('hyperframes', 'HeyGen HyperFrames', '');

  const template = TEMPLATE_FOR[kind];
  const durationSec = beatWindowSec(scene, spec);
  const fingerprint = productGraphicFingerprint(spec, kind, durationSec);
  if (!options.force && hasFreshProductGraphic(scene, fingerprint)) {
    return { videoUrl: String(scene.render_url), fingerprint, kind, template, durationSec, reused: true };
  }

  const aspect: AspectRatio = project.aspect_ratio === '9:16' ? '9:16' : '16:9';
  options.onNote?.(`Scene ${scene.scene_index}: rendering the ${PRODUCT_GRAPHIC_LABELS[kind]} as a HeyGen HyperFrame (${durationSec}s, timed to the narration)`);
  const render = await renderFrame(template, productGraphicVariables(spec, kind), productGraphicBrand(spec, project), aspect, durationSec);
  const videoUrl = await durableClipUrl(render.clipUrl, `scene-${scene.scene_index}-${kind}.mp4`, `sceneforge-v2/${project.id}/hyperframes`);
  await updateScene(scene.id, { render_url: videoUrl, video_prompt: fingerprint, status: 'ready' }, scene.project_id).catch(() => undefined);
  return { videoUrl, fingerprint, kind, template, durationSec, reused: false };
}
