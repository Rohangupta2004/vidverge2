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
import {
  COMPONENT_PLAN_CONVENTIONS,
  COMPONENT_PLAN_SYSTEM_PROMPT,
} from '../prompts/component-plan.prompt';
import { schemaAsPromptText } from '../sdk/component-schema';
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

function validateLayer(
  layer: ComponentInstance,
  sceneId: string,
  knownHandles: string[],
  errors: string[],
  path: string,
): void {
  const where = sceneId + ' / ' + path + ' (' + layer.component + ')';

  if (!isSDKComponent(layer.component)) {
    errors.push(where + ': "' + layer.component + '" is not an SDK component.');
    return;
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
      validateLayer(child, sceneId, knownHandles, errors, path + '.children[' + String(index) + ']');
    });
  }
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
      validateLayer(layer, scene.scene_id, knownHandles, errors, 'layers[' + String(index) + ']');
    });
  }

  if (expectedStart !== plan.total_frames) {
    errors.push('Scene durations sum to ' + String(expectedStart)
      + ' but total_frames is ' + String(plan.total_frames) + '.');
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

function buildUserMessage(spec: FilmSpec, ctx: ProductContext): string {
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
    'ASSET REGISTRY — the only handles that resolve',
    handles.length
      ? handles.map((handle) => {
        const asset = ctx.assets.find((entry) => entry.handle === handle);
        return '  ' + handle + (asset ? '  — ' + asset.description : '')
          + (asset && !asset.source_url ? '  [NO FILE: will draw as a missing-asset plate]' : '');
      }).join('\n')
      : '  none — this film has no imagery, so use typography and motion components only',
    '',
    'Scene durations must sum to exactly ' + String(spec.total_duration_frames) + ' frames at '
    + String(RENDER_CONSTRAINTS.fps) + 'fps.',
    'Answer with the ComponentPlan JSON object and nothing else.',
  ].join('\n');
}

export interface ComponentPlanOptions {
  onProgress?: (detail: string, attempt: number) => void;
  signal?: AbortSignal;
}

export async function generateComponentPlan(
  spec: FilmSpec,
  ctx: ProductContext,
  options: ComponentPlanOptions = {},
): Promise<ComponentPlan> {
  const report = options.onProgress || (() => undefined);
  const base = buildUserMessage(spec, ctx);

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
      plan = normalizePlan(
        await callModelForJson<unknown>(message, {
          system: COMPONENT_PLAN_SYSTEM_PROMPT,
          model: OPUS_MODEL,
          maxTokens: 8192,
          signal: options.signal,
        }),
        spec,
      );
    } catch (error) {
      if (attempt === MAX_REPAIR_ATTEMPTS) throw error;
      errors = [errorMessage(error)];
      continue;
    }

    errors = validateComponentPlan(plan, ctx);
    if (!errors.length) return plan;
  }

  // Out of repair attempts. The plan is returned with its faults recorded on
  // the scenes rather than thrown away: the compile gate downstream will see
  // the same problems, and a half-valid plan the creator can read beats an
  // exception that tells them nothing.
  if (!plan) throw new Error('The component plan could not be built.');
  const unresolved = errors.slice();
  return {
    ...plan,
    scenes: plan.scenes.map((scene, index) => (index === 0
      ? { ...scene, warnings: (scene.warnings || []).concat(unresolved) }
      : scene)),
  };
}
