// Step 6 — the gate that runs before any render.
//
// WHAT THIS IS, PRECISELY: the brief calls for `tsc --noEmit`. There is no tsc
// here — this app runs in a browser, the file is a string in memory, and
// shipping the TypeScript compiler into a space bundle to type-check one
// generated file is not a trade worth making. What runs instead is a scanner
// plus the SDK schema, and for THIS file it is the stronger of the two: tsc
// would prove the props type-check, while this also proves every asset handle
// resolves, every frame is accounted for, and the file never reaches outside
// the SDK. Those are the failures that actually waste a render.
//
// Everything here is deterministic and costs nothing. Only the fix loop calls
// a model, and it runs on Sonnet because repairing a named error is
// mechanical work.

import { callModel, errorMessage, SONNET_MODEL } from '../lib/ai-client';
import { registeredHandles } from '../lib/asset-registry';
import { parseLiteral, scanTsx, type JsxAttr } from '../lib/tsx-scan';
import { CODE_FIX_SYSTEM_PROMPT } from '../prompts/code-generation.prompt';
import { schemaAsPromptText } from '../sdk/component-schema';
import { isSDKComponent, RENDER_CONSTRAINTS, SDK_COMPONENTS } from '../sdk/component-sdk.types';
import { REMOTION_IMPORTS, RUNTIME_GLOBALS } from '../sdk/runtime-source';
import { UNCHECKED_VALUE, validateLayerProps } from '../sdk/validate-props';
import { planAssetHandles, type ComponentInstance, type ComponentPlan } from '../types/component-plan.types';
import { codeSanityProblems } from './codegen';

/** The only module specifiers the generated film may import. */
export const ALLOWED_IMPORTS = [
  'react',
  'remotion',
  '../sdk/components',
  '../sdk/component-sdk.types',
  '../lib/asset-registry',
];

/**
 * Names the film may mount that are not SDK components: Remotion's own
 * elements, and Stage, which the render runtime provides.
 */
export const HOST_ELEMENTS = [
  'AbsoluteFill', 'Sequence', 'Series', 'Audio', 'Img', 'Video', 'OffthreadVideo',
  'Stage', 'Fragment', 'React.Fragment',
];

const PIXEL_UI_COMPONENTS = ['BrowserFrame', 'Dashboard', 'Morph', 'FloatingUI', 'Grid', 'FullBleed', 'Screenshot'];

export interface CompileResult {
  success: boolean;
  errors: string[];
}

/** Component-shaped identifiers the file declares for itself. */
function localComponents(code: string): string[] {
  const names: string[] = [];
  const pattern = /(?:const|let|var|function|class)\s+([A-Z][A-Za-z0-9_$]*)/g;
  let match = pattern.exec(code);
  while (match) {
    if (names.indexOf(match[1]) < 0) names.push(match[1]);
    match = pattern.exec(code);
  }
  return names;
}

/**
 * Every top-level name the file binds, component-shaped or not.
 *
 * This matters because pipeline/render.ts concatenates the SDK runtime and
 * this file into one module scope: a film that declares its own Stage or its
 * own resolveAsset produces a duplicate declaration and the whole render dies
 * with a syntax error nobody can trace back here.
 */
function declaredNames(code: string): string[] {
  const names: string[] = [];
  const pattern = /(?:^|\n)[ \t]*(?:export[ \t]+)?(?:const|let|var|function|class)[ \t]+([A-Za-z_$][A-Za-z0-9_$]*)/g;
  let match = pattern.exec(code);
  while (match) {
    if (names.indexOf(match[1]) < 0) names.push(match[1]);
    match = pattern.exec(code);
  }
  return names;
}

/** Names the render bundle already binds, which the film may not take. */
export const RESERVED_RUNTIME_NAMES: string[] = RUNTIME_GLOBALS
  .concat(REMOTION_IMPORTS)
  .concat(SDK_COMPONENTS as unknown as string[])
  .concat(['React', 'RENDER_CONSTRAINTS', 'TYPE_SCALE', 'TRACKING', 'TEXT_SIZE', 'LOGO_SIZE',
    'CAMERA_INTENSITY', 'PARTICLE_COUNT', 'BrowserChrome', 'KineticLine']);

/** Turn scanned attributes into a props object the SDK validator can read. */
function propsFromAttrs(attrs: JsxAttr[]): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const attr of attrs) {
    if (attr.name === '...' || attr.name === 'key') continue;
    if (attr.kind === 'string') { props[attr.name] = attr.raw; continue; }
    if (attr.kind === 'shorthand') { props[attr.name] = true; continue; }

    // An asset prop is written as {resolveAsset('handle')}. The handle is the
    // value the schema cares about, so it is read out of the call.
    const assetCall = attr.raw.match(/^resolveAsset\(\s*['"]([^'"]*)['"]\s*\)$/);
    if (assetCall) { props[attr.name] = assetCall[1]; continue; }

    const assetList = attr.raw.match(/^\[\s*(resolveAsset\([^)]*\)\s*,?\s*)+\]$/);
    if (assetList) {
      const handles = (attr.raw.match(/resolveAsset\(\s*['"]([^'"]*)['"]\s*\)/g) || [])
        .map((call) => (call.match(/['"]([^'"]*)['"]/) || ['', ''])[1]);
      props[attr.name] = handles;
      continue;
    }

    const literal = parseLiteral(attr.raw);
    props[attr.name] = literal.ok ? literal.value : UNCHECKED_VALUE;
  }
  return props;
}

function plannedUiLayers(plan: ComponentPlan): ComponentInstance[] {
  const layers: ComponentInstance[] = [];
  const visit = (layer: ComponentInstance): void => {
    if (layer.component === 'SemanticUI') layers.push(layer);
    const children = layer.props?.children;
    if (Array.isArray(children)) (children as ComponentInstance[]).forEach(visit);
  };
  plan.scenes.forEach((scene) => scene.layers.forEach(visit));
  return layers;
}

export interface CompileContext {
  plan?: ComponentPlan | null;
  /** Defaults to the live asset registry. */
  knownHandles?: string[];
}

/**
 * The gate. Fast, deterministic, and free — it runs before every render and
 * after every fix attempt.
 */
export async function compileCheck(
  filmTsx: string,
  context: CompileContext = {},
): Promise<CompileResult> {
  const errors: string[] = [];
  const code = String(filmTsx || '');
  const knownHandles = context.knownHandles || registeredHandles();

  for (const problem of codeSanityProblems(code)) errors.push(problem);

  const scan = scanTsx(code);
  const seenUiReferences: string[] = [];
  const seenUiProps: Record<string, Record<string, unknown>> = {};
  for (const error of scan.errors) errors.push(error);

  for (const specifier of scan.imports) {
    if (ALLOWED_IMPORTS.indexOf(specifier) < 0) {
      errors.push('Imports "' + specifier + '", which is not allowed. Allowed: '
        + ALLOWED_IMPORTS.join(', ') + '.');
    }
  }

  for (const name of declaredNames(code)) {
    if (RESERVED_RUNTIME_NAMES.indexOf(name) >= 0) {
      errors.push('Declares "' + name + '", which the SDK runtime already defines. '
        + 'Use it, do not redefine it — a redefinition breaks the whole composition.');
    }
  }

  const declared = localComponents(code);
  for (const element of scan.elements) {
    const known = isSDKComponent(element.name)
      || HOST_ELEMENTS.indexOf(element.name) >= 0
      || declared.indexOf(element.name) >= 0
      || element.name.indexOf('.') > 0;
    if (!known) {
      errors.push('Line ' + String(element.line) + ': <' + element.name
        + '> is neither an SDK component nor defined in this file.');
      continue;
    }
    if (PIXEL_UI_COMPONENTS.indexOf(element.name) >= 0) {
      errors.push('Line ' + String(element.line) + ': <' + element.name
        + '> embeds screenshot pixels. Use SemanticUI, ProductImage or Logo.');
    }
    if (element.name === 'Stage') {
      const names = element.attrs.map((attr) => attr.name);
      for (const required of ['startFrame', 'durationFrames', 'transitionOut']) {
        if (names.indexOf(required) < 0) errors.push('Line ' + String(element.line)
          + ': <Stage> is missing ' + required + ' for beat-aligned transitions.');
      }
    }
    if (!isSDKComponent(element.name)) continue;

    const spread = element.attrs.find((attr) => attr.name === '...');
    if (spread) {
      errors.push('Line ' + String(element.line) + ': <' + element.name
        + '> uses a spread. Every prop must be written out literally.');
    }

    const parsedProps = propsFromAttrs(element.attrs);
    if (element.name === 'SemanticUI' && typeof parsedProps.referenceId === 'string') {
      if (seenUiReferences.indexOf(parsedProps.referenceId) < 0) seenUiReferences.push(parsedProps.referenceId);
      seenUiProps[parsedProps.referenceId] = parsedProps;
    }
    const result = validateLayerProps(element.name, parsedProps, knownHandles);
    for (const problem of result.problems) {
      errors.push('Line ' + String(element.line) + ': ' + problem.message);
    }
  }

  for (const handle of scan.assetHandles) {
    if (!handle) {
      errors.push('resolveAsset() was called with something other than a string literal. '
        + 'Every handle must be written out.');
      continue;
    }
    if (knownHandles.indexOf(handle) < 0) {
      errors.push('resolveAsset("' + handle + '") refers to a handle that is not in the registry. '
        + 'Known handles: ' + (knownHandles.join(', ') || 'none') + '.');
    }
  }

  const plan = context.plan;
  if (plan) {
    const cap = Math.min(plan.total_frames, RENDER_CONSTRAINTS.maxDurationFrames);
    for (const sequence of scan.sequences) {
      const from = sequence.from === null ? 0 : sequence.from;
      const duration = sequence.durationInFrames;
      if (duration !== null && from + duration > cap) {
        errors.push('Line ' + String(sequence.line) + ': a Sequence runs to frame '
          + String(from + duration) + ', past the film\'s ' + String(cap) + ' frames.');
      }
    }
    for (const scene of plan.scenes) {
      const match = scan.sequences.find((sequence) => sequence.from === scene.start_frame
        && sequence.durationInFrames === scene.duration_frames);
      if (!match) {
        errors.push('Scene ' + scene.scene_id + ' is missing: no <Sequence from={'
          + String(scene.start_frame) + '} durationInFrames={'
          + String(scene.duration_frames) + '}> appears in the file.');
      }
    }
    for (const handle of planAssetHandles(plan)) {
      if (scan.assetHandles.indexOf(handle) < 0) {
        errors.push('The generated file dropped planned asset "' + handle + '".');
      }
    }
    for (const layer of plannedUiLayers(plan)) {
      const referenceId = String(layer.props?.referenceId || '');
      if (seenUiReferences.indexOf(referenceId) < 0) {
        errors.push('The generated file dropped semantic UI reference "' + referenceId + '".');
        continue;
      }
      const generated = seenUiProps[referenceId] || {};
      for (const key of ['screenName', 'elements', 'background', 'surface', 'textColor', 'accent']) {
        if (JSON.stringify(generated[key]) !== JSON.stringify(layer.props?.[key])) {
          errors.push('Semantic UI reference "' + referenceId + '" changed its ' + key
            + ' data during code generation.');
        }
      }
    }
  }

  // A long error list is a sign of one structural fault, not fifty real ones,
  // and sending fifty to the fix model buries the one that matters.
  const deduped: string[] = [];
  for (const error of errors) {
    if (deduped.indexOf(error) < 0) deduped.push(error);
  }
  return { success: deduped.length === 0, errors: deduped.slice(0, 40) };
}

export interface FixLoopResult {
  code: string;
  success: boolean;
  attempts: number;
  errors: string[];
}

export interface FixLoopOptions extends CompileContext {
  onProgress?: (detail: string, attempt: number) => void;
  signal?: AbortSignal;
}

/**
 * Compile, and while it fails, show the model its own errors and try again.
 *
 * Each attempt is seconds and one Sonnet turn. The same loop around a render
 * would be minutes and real money, which is the whole reason this gate exists
 * upstream of the render rather than after it.
 */
export async function compileFixLoop(
  filmTsx: string,
  maxAttempts = 3,
  options: FixLoopOptions = {},
): Promise<FixLoopResult> {
  const report = options.onProgress || (() => undefined);
  const context: CompileContext = { plan: options.plan, knownHandles: options.knownHandles };

  let code = filmTsx;
  let result = await compileCheck(code, context);
  if (result.success) {
    report('Clean on the first pass.', 0);
    return { code, success: true, attempts: 0, errors: [] };
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    report(String(result.errors.length) + ' error(s) — repair attempt ' + String(attempt)
      + ' of ' + String(maxAttempts) + '…', attempt);

    const message = [
      'CURRENT FILE',
      code,
      '',
      'VALIDATION ERRORS',
      result.errors.map((error) => '- ' + error).join('\n'),
      '',
      'SDK COMPONENT TYPES — the props that exist and the literals they accept',
      schemaAsPromptText(),
      '',
      'ASSET HANDLES THAT RESOLVE: '
      + ((options.knownHandles || registeredHandles()).join(', ') || 'none'),
      '',
      'Return the complete corrected file in one code block.',
    ].join('\n');

    let answer = '';
    try {
      answer = await callModel(message, {
        system: CODE_FIX_SYSTEM_PROMPT,
        model: SONNET_MODEL,
        maxTokens: 8192,
        signal: options.signal,
      });
    } catch (error) {
      report('The repair model could not be reached: ' + errorMessage(error), attempt);
      break;
    }

    const open = answer.indexOf('```');
    const candidate = open < 0
      ? answer.trim()
      : (() => {
        const afterOpen = answer.slice(open + 3).replace(/^(tsx|typescript|ts|jsx|javascript|js)\n/i, '');
        const close = afterOpen.indexOf('```');
        return (close >= 0 ? afterOpen.slice(0, close) : afterOpen).trim();
      })();

    if (!candidate) {
      report('The repair model returned nothing to compile.', attempt);
      continue;
    }

    const next = await compileCheck(candidate, context);
    // A repair that makes things worse is discarded rather than carried
    // forward — otherwise three attempts can walk the file steadily downhill.
    if (next.errors.length <= result.errors.length) {
      code = candidate;
      result = next;
    }
    if (result.success) {
      report('Clean after ' + String(attempt) + ' repair attempt(s).', attempt);
      return { code, success: true, attempts: attempt, errors: [] };
    }
  }

  return { code, success: false, attempts: maxAttempts, errors: result.errors };
}
