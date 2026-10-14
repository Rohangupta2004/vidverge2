// Step 4 — FilmSpec to ComponentPlan.
//
// This is where creative language becomes something a machine can check.
// Everything after this point reads the plan and never the FilmSpec, so a
// plan that validates is a promise that the film is buildable: every
// component exists, every prop is the right type, every asset handle resolves
// and every frame is accounted for.
//
// The repair loop here is cheap on purpose. Fixing a bad plan costs one model
// turn; discovering the same fault after a render costs a render.

import { callModelForJson, errorMessage, OPUS_MODEL } from '../lib/ai-client';
import type { BeatMap } from '../lib/audio';
import {
  COMPONENT_PLAN_CONVENTIONS,
  COMPONENT_PLAN_SYSTEM_PROMPT,
} from '../prompts/component-plan.prompt';
import { handlePropsOf, schemaAsPromptText } from '../sdk/component-schema';
import { CONTAINER_COMPONENTS, isSDKComponent, RENDER_CONSTRAINTS } from '../sdk/component-sdk.types';
import { validateLayerProps } from '../sdk/validate-props';
import type {
  ComponentInstance,
  ComponentPlan,
  SceneComponentPlan,
} from '../types/component-plan.types';
import type { FilmSpec } from '../types/film-spec.types';
import { assetHandles, type ProductContext } from '../types/product-context.types';

/** How many times a failed plan is handed back to the model with its errors. */
const MAX_REPAIR_ATTEMPTS = 2;

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeLayer(raw: unknown): ComponentInstance | null {
  if (!isPlainObject(raw)) return null;
  const component = str(raw.component);
  if (!component) return null;

  const props = isPlainObject(raw.props) ? { ...raw.props } : {};

  // Children arrive as nested ComponentInstance objects on a container. They
  // stay inside props so one shape covers the whole tree, and the code step
  // turns them into JSX children.
  if (Array.isArray(props.children)) {
    const children = (props.children as unknown[])
      .map(normalizeLayer)
      .filter((child): child is ComponentInstance => child !== null);
    if (children.length) props.children = children;
    else delete props.children;
  } else if (props.children !== undefined) {
    delete props.children;
  }

  const layer: ComponentInstance = { component, props };
  const startFrame = Number(raw.startFrame);
  const durationFrames = Number(raw.durationFrames);
  if (isFinite(startFrame) && startFrame > 0) layer.startFrame = Math.round(startFrame);
  if (isFinite(durationFrames) && durationFrames > 0) layer.durationFrames = Math.round(durationFrames);
  return layer;
}

function normalizePlan(raw: unknown, spec: FilmSpec): ComponentPlan {
  const source = isPlainObject(raw) ? raw : {};
  const scenesRaw = Array.isArray(source.scenes) ? source.scenes : [];

  const scenes: SceneComponentPlan[] = scenesRaw.map((entry, index) => {
    const sceneRaw = isPlainObject(entry) ? entry : {};
    const fromSpec = spec.scenes[index];
    const duration = Math.round(Number(sceneRaw.duration_frames));
    return {
      scene_id: str(sceneRaw.scene_id) || fromSpec?.id || ('scene_' + String(index + 1)),
      role: str(sceneRaw.role) || fromSpec?.role || 'product',
      duration_frames: isFinite(duration) && duration > 0
        ? duration
        : (fromSpec?.duration_frames || 90),
      start_frame: 0,   // recomputed below; a model-supplied value is never trusted
      layers: (Array.isArray(sceneRaw.layers) ? sceneRaw.layers : [])
        .map(normalizeLayer)
        .filter((layer): layer is ComponentInstance => layer !== null),
      narration_text: str(sceneRaw.narration_text) || fromSpec?.narration_text || undefined,
      transition_out: str(sceneRaw.transition_out) || fromSpec?.transition_out || undefined,
      warnings: (Array.isArray(sceneRaw.warnings) ? sceneRaw.warnings : []).map(str).filter(Boolean),
    };
  });

  const audioRaw = isPlainObject(source.audio_config) ? source.audio_config : {};

  return rebalanceFrames({
    film_spec_version: str(source.film_spec_version) || spec.version,
    total_frames: spec.total_duration_frames,
    fps: RENDER_CONSTRAINTS.fps,
    width: RENDER_CONSTRAINTS.width,
    height: RENDER_CONSTRAINTS.height,
    scenes,
    audio_config: {
      narration_enabled: Boolean(audioRaw.narration_enabled ?? spec.narration_enabled),
      narration_voice: str(audioRaw.narration_voice) || spec.narration_voice || undefined,
      music_style: str(audioRaw.music_style) || spec.music_style || undefined,
    },
  });
}

/**
 * Make the frame arithmetic true.
 *
 * The model is asked to make durations sum to the total and usually gets
 * close, but 'close' means a trailing gap of black or a scene clipped
 * mid-animation. Scenes are scaled proportionally and the rounding remainder
 * is given to the last scene, then start frames are recomputed from scratch,
 * so the plan's timeline is arithmetic rather than assertion.
 */
export function rebalanceFrames(plan: ComponentPlan): ComponentPlan {
  const cap = Math.min(plan.total_frames, RENDER_CONSTRAINTS.maxDurationFrames);
  const scenes = plan.scenes.filter((scene) => scene.layers.length > 0 || scene.duration_frames > 0);
  if (!scenes.length) return { ...plan, total_frames: cap, scenes: [] };

  const stated = scenes.reduce((sum, scene) => sum + Math.max(1, scene.duration_frames), 0);
  const factor = stated > 0 ? cap / stated : 1;

  let cursor = 0;
  const adjusted = scenes.map((scene, index) => {
    const isLast = index === scenes.length - 1;
    const scaled = isLast
      ? Math.max(1, cap - cursor)
      : Math.max(15, Math.round(Math.max(1, scene.duration_frames) * factor));
    const placed: SceneComponentPlan = {
      ...scene,
      duration_frames: scaled,
      start_frame: cursor,
      layers: scene.layers.map((layer) => clampLayerTiming(layer, scaled)),
    };
    cursor += scaled;
    return placed;
  });

  return { ...plan, total_frames: cursor, scenes: adjusted };
}

/** A layer may not start after its scene ends or outlive it. */
function clampLayerTiming(layer: ComponentInstance, sceneFrames: number): ComponentInstance {
  const out: ComponentInstance = { ...layer };
  if (out.startFrame !== undefined) {
    out.startFrame = Math.max(0, Math.min(sceneFrames - 1, out.startFrame));
  }
  if (out.durationFrames !== undefined) {
    const start = out.startFrame || 0;
    out.durationFrames = Math.max(1, Math.min(sceneFrames - start, out.durationFrames));
  }
  const children = out.props?.children;
  if (Array.isArray(children)) {
    out.props = {
      ...out.props,
      children: (children as ComponentInstance[]).map((child) => clampLayerTiming(child, sceneFrames)),
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const PIXEL_UI_COMPONENTS = ['BrowserFrame', 'Dashboard', 'Morph', 'FloatingUI', 'Grid', 'FullBleed', 'Screenshot'];

function validateLayer(
  layer: ComponentInstance,
  sceneId: string,
  knownHandles: string[],
  ctx: ProductContext,
  errors: string[],
  path: string,
): void {
  const where = sceneId + ' / ' + path + ' (' + layer.component + ')';

  if (PIXEL_UI_COMPONENTS.indexOf(layer.component) >= 0) {
    errors.push(where + ': screenshot pixels are reference-only. Use SemanticUI, or ProductImage/Logo for non-UI imagery.');
  }
  if (!isSDKComponent(layer.component)) {
    errors.push(where + ': "' + layer.component + '" is not an SDK component.');
    return;
  }
  if (layer.component === 'SemanticUI') {
    const referenceId = str(layer.props?.referenceId);
    const reference = ctx.ui_references.find((entry) => entry.id === referenceId);
    if (!reference) {
      errors.push(where + ': SemanticUI referenceId "' + referenceId + '" was not reconstructed from a real screenshot.');
    } else {
      const expected = {
        screenName: reference.screen_name,
        elements: reference.elements,
        background: reference.background,
        surface: reference.surface,
        textColor: reference.text,
        accent: reference.accent,
      };
      for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
        if (JSON.stringify(layer.props?.[key]) !== JSON.stringify(expected[key])) {
          errors.push(where + ': SemanticUI.' + key + ' must match reference "' + referenceId + '" exactly.');
        }
      }
    }
  }

  const children = layer.props?.children;
  const propsWithoutChildren = { ...layer.props };
  delete propsWithoutChildren.children;

  const result = validateLayerProps(layer.component, propsWithoutChildren, knownHandles);
  for (const problem of result.problems) errors.push(where + ': ' + problem.message);

  if (Array.isArray(children) && children.length) {
    if (CONTAINER_COMPONENTS.indexOf(layer.component as never) < 0) {
      errors.push(where + ' was given children but does not accept them. Containers are: '
        + CONTAINER_COMPONENTS.join(', ') + '.');
      return;
    }
    (children as ComponentInstance[]).forEach((child, index) => {
      validateLayer(child, sceneId, knownHandles, ctx, errors, path + '.children[' + String(index) + ']');
    });
  }
}

export function alignPlanToBeats(plan: ComponentPlan, beatMap?: BeatMap): ComponentPlan {
  const strong = (beatMap?.beats || []).filter((beat) => beat.strength >= 0.7 || beat.kind !== 'beat');
  if (!strong.length || plan.scenes.length < 2) return plan;
  const boundaries: number[] = [];
  let cursor = 0;
  for (let i = 0; i < plan.scenes.length - 1; i += 1) {
    cursor += plan.scenes[i].duration_frames;
    const candidates = strong.filter((beat) => beat.frame > (boundaries[i - 1] || 0) + 15 && beat.frame < plan.total_frames - 15);
    const nearest = candidates.sort((a, b) => Math.abs(a.frame - cursor) - Math.abs(b.frame - cursor))[0];
    boundaries.push(nearest && Math.abs(nearest.frame - cursor) <= 24 ? nearest.frame : cursor);
  }
  const scenes = plan.scenes.map((scene, index) => {
    const start = index === 0 ? 0 : boundaries[index - 1];
    const end = index === plan.scenes.length - 1 ? plan.total_frames : boundaries[index];
    const duration = Math.max(1, end - start);
    return { ...scene, start_frame: start, duration_frames: duration, layers: scene.layers.map((layer) => clampLayerTiming(layer, duration)) };
  });
  return { ...plan, scenes };
}

function collectPlanUsage(plan: ComponentPlan): { handles: string[]; uiReferences: string[] } {
  const handles: string[] = [];
  const uiReferences: string[] = [];
  const add = (list: string[], value: unknown): void => {
    if (typeof value === 'string' && value && list.indexOf(value) < 0) list.push(value);
  };
  const visit = (layer: ComponentInstance): void => {
    for (const prop of handlePropsOf(layer.component)) {
      const value = layer.props?.[prop];
      if (Array.isArray(value)) value.forEach((entry) => add(handles, entry));
      else add(handles, value);
    }
    if (layer.component === 'SemanticUI') add(uiReferences, layer.props?.referenceId);
    const children = layer.props?.children;
    if (Array.isArray(children)) (children as ComponentInstance[]).forEach(visit);
  };
  plan.scenes.forEach((scene) => scene.layers.forEach(visit));
  return { handles, uiReferences };
}

export function validateComponentPlan(plan: ComponentPlan, ctx: ProductContext): string[] {
  const errors: string[] = [];
  const knownHandles = assetHandles(ctx);

  if (!plan.scenes.length) {
    errors.push('The plan has no scenes.');
    return errors;
  }
  if (plan.total_frames > RENDER_CONSTRAINTS.maxDurationFrames) {
    errors.push('total_frames ' + String(plan.total_frames) + ' exceeds the '
      + String(RENDER_CONSTRAINTS.maxDurationFrames) + '-frame cap.');
  }

  let expectedStart = 0;
  for (const scene of plan.scenes) {
    if (!scene.layers.length) {
      errors.push(scene.scene_id + ': has no layers, so it would render as black.');
    }
    if (scene.start_frame !== expectedStart) {
      errors.push(scene.scene_id + ': start_frame is ' + String(scene.start_frame)
        + ' but the scenes before it end at ' + String(expectedStart) + '.');
    }
    expectedStart += scene.duration_frames;

    scene.layers.forEach((layer, index) => {
      validateLayer(layer, scene.scene_id, knownHandles, ctx, errors, 'layers[' + String(index) + ']');
    });
  }

  if (expectedStart !== plan.total_frames) {
    errors.push('Scene durations sum to ' + String(expectedStart)
      + ' but total_frames is ' + String(plan.total_frames) + '.');
  }

  const usage = collectPlanUsage(plan);
  const requiredAssets = ctx.assets.filter((asset) => asset.handle === 'uploaded_logo' || asset.handle === 'uploaded_product_image');
  for (const asset of requiredAssets) {
    if (usage.handles.indexOf(asset.handle) < 0) {
      errors.push('Creator-uploaded asset "' + asset.handle + '" must survive into the film unchanged via '
        + (asset.type === 'logo' ? 'Logo.' : 'ProductImage.'));
    }
  }
  const requiredUi = ctx.ui_references.filter((reference) => reference.source_handle === 'uploaded_ui_reference');
  for (const reference of requiredUi) {
    if (usage.uiReferences.indexOf(reference.id) < 0) {
      errors.push('Creator-uploaded screenshot reference "' + reference.id
        + '" must survive as a SemanticUI reconstruction with its stable data-ui-id elements.');
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

function buildUserMessage(spec: FilmSpec, ctx: ProductContext, beatMap?: BeatMap): string {
  const handles = assetHandles(ctx);
  return [
    'FILM SPEC (the creative brief you are translating)',
    JSON.stringify(spec, null, 2),
    '',
    'SDK COMPONENT TYPES — the only components and props that exist',
    schemaAsPromptText(),
    '',
    COMPONENT_PLAN_CONVENTIONS,
    '',
    'RENDERABLE ASSET REGISTRY — screenshot handles are deliberately absent',
    handles.length
      ? handles.map((handle) => {
        const asset = ctx.assets.find((entry) => entry.handle === handle);
        return '  ' + handle + (asset ? '  — ' + asset.description : '')
          + (asset && !asset.source_url ? '  [NO FILE: will draw as a missing-asset plate]' : '');
      }).join('\n')
      : '  none — this film has no non-UI imagery, so use typography and SemanticUI only',
    '',
    'SEMANTIC UI REFERENCES — use SemanticUI with these exact fields; never embed the screenshot source:',
    ctx.ui_references.length ? JSON.stringify(ctx.ui_references, null, 2) : '  none',
    '',
    'BEAT MAP — scene boundaries and high-energy events should land on strong frames:',
    beatMap ? JSON.stringify({ bpm: beatMap.bpm, beats: beatMap.beats.filter((beat) => beat.strength >= 0.7) }, null, 2) : '  unavailable',
    '',
    'Scene durations must sum to exactly ' + String(spec.total_duration_frames) + ' frames at '
    + String(RENDER_CONSTRAINTS.fps) + 'fps.',
    'Answer with the ComponentPlan JSON object and nothing else.',
  ].join('\n');
}

export interface ComponentPlanOptions {
  onProgress?: (detail: string, attempt: number) => void;
  signal?: AbortSignal;
  beatMap?: BeatMap;
}

export async function generateComponentPlan(
  spec: FilmSpec,
  ctx: ProductContext,
  options: ComponentPlanOptions = {},
): Promise<ComponentPlan> {
  const report = options.onProgress || (() => undefined);
  const base = buildUserMessage(spec, ctx, options.beatMap);

  let plan: ComponentPlan | null = null;
  let errors: string[] = [];

  for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt += 1) {
    const message = attempt === 0
      ? base
      : [
        base,
        '',
        'YOUR PREVIOUS PLAN FAILED VALIDATION. Fix exactly these and resend the WHOLE plan:',
        errors.map((error) => '- ' + error).join('\n'),
        '',
        'Do not drop a layer or a scene to make an error go away — correct the value instead.',
      ].join('\n');

    report(
      attempt === 0 ? 'Translating the concept into typed components…' : 'Repairing ' + String(errors.length) + ' plan error(s)…',
      attempt,
    );

    try {
      plan = alignPlanToBeats(normalizePlan(
        await callModelForJson<unknown>(message, {
          system: COMPONENT_PLAN_SYSTEM_PROMPT,
          model: OPUS_MODEL,
          maxTokens: 8192,
          signal: options.signal,
        }),
        spec,
      ), options.beatMap);
    } catch (error) {
      if (attempt === MAX_REPAIR_ATTEMPTS) throw error;
      errors = [errorMessage(error)];
      continue;
    }

    errors = validateComponentPlan(plan, ctx);
    if (!errors.length) return plan;
  }

  // A plan that still fails validation cannot safely reach a paid render.
  // In particular, screenshot pixels or a dropped creator asset must never be
  // papered over by the deterministic code printer.
  if (!plan) throw new Error('The component plan could not be built.');
  throw new Error('The component plan still has ' + String(errors.length)
    + ' validation error(s) after repair: ' + errors.slice(0, 6).join(' '));
}
