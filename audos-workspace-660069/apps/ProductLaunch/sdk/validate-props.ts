// validate-props — the check that both gates run.
//
// The component plan is validated against this before any code exists, and the
// generated Film.tsx is validated against it again after. Same rules, two
// stages: the first catches a planner that invented a prop, the second catches
// a code step that drifted away from the plan it was given.
//
// Everything here is deterministic. No model is asked whether its own output
// is valid.

import { handlePropsOf, schemaFor, UNIVERSAL_PROPS, type PropSpec } from './component-schema';
import { isSDKComponent } from './component-sdk.types';

export interface PropProblem {
  prop: string;
  message: string;
}

/**
 * Stands in for a prop that is present but whose value could not be read.
 *
 * The code gate reads props out of JSX source, where a value may be any
 * expression. A prop written as {buildThing()} is definitely THERE — so it
 * must satisfy a required-prop check — but its value cannot be judged. Marking
 * it is honest; guessing in either direction is not.
 */
export const UNCHECKED_VALUE = '__audos_unchecked_value__';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value;
}

function hasNumbers(value: unknown, keys: string[]): boolean {
  if (!isPlainObject(value)) return false;
  return keys.every((key) => isFinite(Number(value[key])));
}

function checkValue(prop: string, spec: PropSpec, value: unknown): PropProblem | null {
  const bad = (message: string): PropProblem => ({ prop, message });

  switch (spec.kind) {
    case 'string':
    case 'handle':
      if (typeof value !== 'string' || !value) {
        return bad(prop + ' must be a non-empty string, got ' + describe(value) + '.');
      }
      return null;

    case 'number': {
      const n = Number(value);
      if (typeof value !== 'number' || !isFinite(n)) {
        return bad(prop + ' must be a number, got ' + describe(value) + '.');
      }
      if (spec.min !== undefined && n < spec.min) {
        return bad(prop + ' must be at least ' + String(spec.min) + ', got ' + String(n) + '.');
      }
      if (spec.max !== undefined && n > spec.max) {
        return bad(prop + ' must be at most ' + String(spec.max) + ', got ' + String(n) + '.');
      }
      return null;
    }

    case 'boolean':
      if (typeof value !== 'boolean') {
        return bad(prop + ' must be true or false, got ' + describe(value) + '.');
      }
      return null;

    case 'enum': {
      const allowed = spec.values || [];
      const matches = allowed.some((entry) => String(entry) === String(value));
      if (!matches) {
        return bad(prop + ' must be one of ' + allowed.map((entry) => JSON.stringify(entry)).join(', ')
          + ', got ' + JSON.stringify(value) + '.');
      }
      return null;
    }

    case 'handle-list':
    case 'string-list': {
      if (!Array.isArray(value) || !value.length) {
        return bad(prop + ' must be a non-empty array of strings, got ' + describe(value) + '.');
      }
      if (!value.every((entry) => typeof entry === 'string' && entry)) {
        return bad(prop + ' must contain only non-empty strings.');
      }
      return null;
    }

    case 'number-list':
      if (!Array.isArray(value) || !value.every((entry) => isFinite(Number(entry)))) {
        return bad(prop + ' must be an array of numbers.');
      }
      return null;

    case 'rect':
      if (!hasNumbers(value, ['x', 'y', 'width', 'height'])) {
        return bad(prop + ' must be an object with numeric x, y, width and height (percentages, 0-100).');
      }
      return null;

    case 'point':
      if (!hasNumbers(value, ['x', 'y'])) {
        return bad(prop + ' must be an object with numeric x and y (percentages, 0-100).');
      }
      return null;

    case 'object-list': {
      if (!Array.isArray(value) || !value.length) {
        return bad(prop + ' must be a non-empty array of objects' + (spec.note ? ' shaped ' + spec.note : '') + '.');
      }
      if (!value.every(isPlainObject)) return bad(prop + ' must contain only objects.');
      if (prop === 'path' && !value.every((entry) => hasNumbers(entry, ['x', 'y', 'frame']))) {
        return bad('path entries need numeric x, y and frame.');
      }
      if (prop === 'metrics'
        && !value.every((entry) => typeof (entry as Record<string, unknown>).label === 'string')) {
        return bad('metrics entries need a string label.');
      }
      return null;
    }

    case 'node':
      // children may be a nested ComponentInstance array in a plan, or real JSX
      // in generated code. Both are checked by the caller, not here.
      return null;

    default:
      return null;
  }
}

export interface LayerValidation {
  problems: PropProblem[];
  /** Asset handles this layer references, for the registry check. */
  handles: string[];
}

/**
 * Validate one component's props against the SDK schema.
 *
 * `knownHandles` is optional: pass it to also prove every asset handle the
 * layer names actually exists. Passing undefined skips that check, which is
 * what the code gate wants when it is reading handles out of source text.
 */
export function validateLayerProps(
  component: string,
  props: Record<string, unknown>,
  knownHandles?: string[],
): LayerValidation {
  const problems: PropProblem[] = [];
  const handles: string[] = [];

  if (!isSDKComponent(component)) {
    return {
      problems: [{ prop: '', message: '"' + component + '" is not an SDK component.' }],
      handles,
    };
  }
  const schema = schemaFor(component);
  if (!schema) return { problems, handles };

  for (const name of Object.keys(schema)) {
    const spec = schema[name];
    const value = props[name];
    if (value === undefined || value === null) {
      if (spec.required) {
        problems.push({ prop: name, message: component + ' requires the ' + name + ' prop.' });
      }
      continue;
    }
    if (value === UNCHECKED_VALUE) continue;
    const problem = checkValue(name, spec, value);
    if (problem) problems.push(problem);
  }

  for (const name of Object.keys(props)) {
    if (schema[name] || UNIVERSAL_PROPS.indexOf(name) >= 0) continue;
    problems.push({
      prop: name,
      message: component + ' has no prop named ' + name + '. Valid props: '
        + Object.keys(schema).join(', ') + '.',
    });
  }

  for (const name of handlePropsOf(component)) {
    const value = props[name];
    const list = Array.isArray(value) ? value : [value];
    for (const entry of list) {
      if (typeof entry !== 'string' || !entry || entry === UNCHECKED_VALUE) continue;
      handles.push(entry);
      if (knownHandles && knownHandles.indexOf(entry) < 0) {
        problems.push({
          prop: name,
          message: 'Asset handle "' + entry + '" is not in the registry. Known handles: '
            + (knownHandles.join(', ') || 'none') + '.',
        });
      }
    }
  }

  return { problems, handles };
}
