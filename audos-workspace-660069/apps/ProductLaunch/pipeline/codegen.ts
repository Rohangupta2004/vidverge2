// Step 5 — ComponentPlan to Film.tsx.
//
// The model writes the file. It is given the plan, the SDK types and the house
// rules, and nothing else — it never sees the FilmSpec, so it cannot
// reinterpret the creative and quietly produce a different film than the one
// that was approved.
//
// emitFilmCodeFromPlan below is NOT a mock and NOT a template. It is a
// deterministic printer for a plan that has already been validated, used only
// when the model's own attempts have failed the compile gate every time. It
// renders the SAME plan with the SAME props; what it loses is the model's
// judgement about how to arrange them. Shipping the plan beats shipping an
// error, and the creator is told which path produced the file.

import { callModel, OPUS_MODEL } from '../lib/ai-client';
import {
  CODE_GENERATION_HOUSE_RULES,
  CODE_GENERATION_SYSTEM_PROMPT,
} from '../prompts/code-generation.prompt';
import { handlePropsOf, schemaAsPromptText } from '../sdk/component-schema';
import { CONTAINER_COMPONENTS, RENDER_CONSTRAINTS } from '../sdk/component-sdk.types';
import type { ComponentInstance, ComponentPlan } from '../types/component-plan.types';

/** Pull the file out of a fenced answer, tolerating a missing fence. */
export function extractCodeBlock(raw: string): string {
  const text = String(raw || '');
  const open = text.indexOf('```');
  if (open < 0) return text.trim();
  const afterOpen = text.slice(open + 3).replace(/^(tsx|typescript|ts|jsx|javascript|js)\n/i, '');
  const close = afterOpen.indexOf('```');
  return (close >= 0 ? afterOpen.slice(0, close) : afterOpen).trim();
}

/** The quick checks worth running before the real gate. */
export function codeSanityProblems(code: string): string[] {
  const problems: string[] = [];
  if (!code.trim()) problems.push('The model returned no code at all.');
  if (code.indexOf('export default') < 0) {
    problems.push('The file has no default export. The last statement must be '
      + '"export default <RootComponentName>;".');
  } else if (!/export\s+default\s+[A-Za-z_$][A-Za-z0-9_$]*\s*;?\s*$/.test(code)) {
    problems.push('The default export must be the final named statement: export default <RootComponentName>;');
  }
  if (code.indexOf('registerRoot') < 0) {
    problems.push('The file never calls registerRoot.');
  }
  if (code.indexOf('console.log') >= 0) problems.push('The file contains console.log.');
  if (/https?:\/\//.test(code.replace(/^\s*\/\/.*$/gm, ''))) {
    problems.push('The file contains a hardcoded URL. Every asset must go through resolveAsset(handle).');
  }
  return problems;
}

function buildUserMessage(plan: ComponentPlan): string {
  return [
    'COMPONENT PLAN',
    JSON.stringify(plan, null, 2),
    '',
    'SDK COMPONENT TYPES',
    schemaAsPromptText(),
    '',
    CODE_GENERATION_HOUSE_RULES,
    '',
    'RENDER CONSTRAINTS: ' + String(RENDER_CONSTRAINTS.width) + 'x' + String(RENDER_CONSTRAINTS.height)
    + ' at ' + String(RENDER_CONSTRAINTS.fps) + 'fps, ' + String(plan.total_frames)
    + ' frames total, hard cap ' + String(RENDER_CONSTRAINTS.maxDurationFrames) + '.',
    'Write Film.tsx now. One code block, no explanation.',
  ].join('\n');
}

export interface CodegenOptions {
  signal?: AbortSignal;
}

export async function generateFilmCode(
  plan: ComponentPlan,
  options: CodegenOptions = {},
): Promise<string> {
  const answer = await callModel(buildUserMessage(plan), {
    system: CODE_GENERATION_SYSTEM_PROMPT,
    model: OPUS_MODEL,
    maxTokens: 8192,
    signal: options.signal,
  });
  const code = extractCodeBlock(answer);
  if (!code) throw new Error('The code step returned no file.');
  return code;
}

// ---------------------------------------------------------------------------
// Deterministic printer
// ---------------------------------------------------------------------------

function indent(depth: number): string {
  return '  '.repeat(depth);
}

function jsxAttrs(layer: ComponentInstance): string {
  const handleProps = handlePropsOf(layer.component);
  const parts: string[] = [];

  for (const name of Object.keys(layer.props || {})) {
    if (name === 'children') continue;
    const value = layer.props[name];
    if (value === undefined || value === null) continue;

    if (handleProps.indexOf(name) >= 0) {
      if (Array.isArray(value)) {
        parts.push(name + '={[' + value.map((entry) => 'resolveAsset(' + JSON.stringify(String(entry)) + ')').join(', ') + ']}');
      } else {
        parts.push(name + '={resolveAsset(' + JSON.stringify(String(value)) + ')}');
      }
      continue;
    }
    if (typeof value === 'string') {
      parts.push(name + '=' + JSON.stringify(value));
      continue;
    }
    if (typeof value === 'boolean') {
      parts.push(value ? name : name + '={false}');
      continue;
    }
    parts.push(name + '={' + JSON.stringify(value) + '}');
  }
  return parts.length ? ' ' + parts.join(' ') : '';
}

function printLayer(layer: ComponentInstance, depth: number): string {
  const children = Array.isArray(layer.props?.children)
    ? (layer.props.children as ComponentInstance[])
    : [];
  const canHoldChildren = CONTAINER_COMPONENTS.indexOf(layer.component as never) >= 0;
  const pad = indent(depth);

  let element: string;
  if (canHoldChildren && children.length) {
    element = pad + '<' + layer.component + jsxAttrs(layer) + '>\n'
      + children.map((child) => printLayer(child, depth + 1)).join('\n') + '\n'
      + pad + '</' + layer.component + '>';
  } else {
    element = pad + '<' + layer.component + jsxAttrs(layer) + ' />';
  }

  if (layer.startFrame === undefined && layer.durationFrames === undefined) return element;

  const from = layer.startFrame || 0;
  const duration = layer.durationFrames === undefined
    ? ''
    : ' durationInFrames={' + String(layer.durationFrames) + '}';
  return pad + '<Sequence from={' + String(from) + '}' + duration + '>\n'
    + printLayer({ ...layer, startFrame: undefined, durationFrames: undefined }, depth + 1) + '\n'
    + pad + '</Sequence>';
}

function componentIdentifier(sceneId: string, index: number): string {
  const cleaned = String(sceneId || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const safe = cleaned && /^[A-Za-z]/.test(cleaned) ? cleaned : 'Scene_' + String(index + 1);
  return 'Scene_' + safe.charAt(0).toUpperCase() + safe.slice(1);
}

function usedComponents(plan: ComponentPlan): string[] {
  const names: string[] = [];
  const visit = (layer: ComponentInstance): void => {
    if (names.indexOf(layer.component) < 0) names.push(layer.component);
    const children = layer.props?.children;
    if (Array.isArray(children)) (children as ComponentInstance[]).forEach(visit);
  };
  for (const scene of plan.scenes) scene.layers.forEach(visit);
  return names.sort();
}

/**
 * Print a validated plan as Film.tsx. Deterministic: the same plan always
 * produces byte-identical source, which is what makes it a safe fallback.
 */
export function emitFilmCodeFromPlan(plan: ComponentPlan): string {
  const components = usedComponents(plan);
  const sceneFns = plan.scenes.map((scene, index) => {
    const name = componentIdentifier(scene.scene_id, index);
    const body = scene.layers.length
      ? scene.layers.map((layer) => printLayer(layer, 3)).join('\n')
      : indent(3) + '<MassiveType text="" scale="display" animateIn="none" />';
    return [
      '// ' + scene.scene_id + ' — ' + scene.role + ', ' + String(scene.duration_frames) + ' frames',
      'const ' + name + ': React.FC = () => (',
      indent(1) + '<Stage startFrame={' + String(scene.start_frame) + '} durationFrames={'
        + String(scene.duration_frames) + '} transitionOut=' + JSON.stringify(scene.transition_out || 'cut') + '>',
      body,
      indent(1) + '</Stage>',
      ');',
    ].join('\n');
  });

  const sequences = plan.scenes.map((scene, index) => {
    const name = componentIdentifier(scene.scene_id, index);
    return indent(2) + '<Sequence from={' + String(scene.start_frame) + '} durationInFrames={'
      + String(scene.duration_frames) + '}>\n'
      + indent(3) + '<' + name + ' />\n'
      + indent(2) + '</Sequence>';
  });

  return [
    '// Film.tsx — printed from a validated ComponentPlan.',
    '// ' + String(plan.scenes.length) + ' scenes, ' + String(plan.total_frames) + ' frames at '
    + String(plan.fps) + 'fps.',
    '',
    "import React from 'react';",
    "import { AbsoluteFill, Sequence, registerRoot } from 'remotion';",
    'import {',
    components.map((name) => indent(1) + name + ',').join('\n'),
    "} from '../sdk/components';",
    "import { RENDER_CONSTRAINTS } from '../sdk/component-sdk.types';",
    "import { resolveAsset } from '../lib/asset-registry';",
    '',
    'export const TOTAL_FRAMES = ' + String(plan.total_frames) + ';',
    'export const FPS = RENDER_CONSTRAINTS.fps;',
    '',
    sceneFns.join('\n\n'),
    '',
    'const Film: React.FC = () => (',
    indent(1) + '<AbsoluteFill>',
    sequences.join('\n'),
    indent(1) + '</AbsoluteFill>',
    ');',
    '',
    'registerRoot(Film);',
    '',
    'export default Film;',
    '',
  ].join('\n');
}
