// component-schema — the SDK prop types, mirrored into data.
//
// WHY THIS FILE EXISTS: TypeScript types are erased at build time, so nothing
// at runtime can read component-sdk.types.ts. The compile gate and the
// component-plan validator both need to know, for a component name Opus just
// wrote, which props exist, which are required, and which string literals a
// union actually accepts. That knowledge has to be data.
//
// This file and component-sdk.types.ts are two views of ONE contract. Change
// a prop in one and change it in the other — verifySchemaCoverage() below
// catches a component added to SDK_COMPONENTS and forgotten here, which is the
// drift that actually happens.

import { SDK_COMPONENTS, type SDKComponentName } from './component-sdk.types';

export type PropKind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'handle'        // an asset handle — must resolve through the registry
  | 'handle-list'
  | 'string-list'
  | 'rect'          // { x, y, width, height, label? }
  | 'point'         // { x, y }
  | 'number-list'
  | 'object-list'   // metrics, cursor paths
  | 'node';         // children

export interface PropSpec {
  kind: PropKind;
  required?: boolean;
  /** Allowed literals for an 'enum' prop. Numbers are compared loosely. */
  values?: Array<string | number>;
  /** Inclusive bounds for a 'number' prop, when the type comment states one. */
  min?: number;
  max?: number;
  note?: string;
}

export type ComponentSchema = Record<string, PropSpec>;

const rect: PropSpec = { kind: 'rect' };
const point: PropSpec = { kind: 'point' };
const color: PropSpec = { kind: 'string' };
const node: PropSpec = { kind: 'node' };

export const SDK_SCHEMA: Record<SDKComponentName, ComponentSchema> = {
  // ── UI ──
  BrowserFrame: {
    screenshot: { kind: 'handle', required: true },
    url: { kind: 'string' },
    zoom: { kind: 'number', min: 0.5, max: 2 },
    animateIn: { kind: 'boolean' },
    highlight: rect,
    theme: { kind: 'enum', values: ['light', 'dark'] },
  },
  Dashboard: {
    screenshot: { kind: 'handle' },
    metrics: { kind: 'object-list', note: '{ label, value, trend? }' },
    animateCounters: { kind: 'boolean' },
    highlightRegion: { kind: 'enum', values: ['top-left', 'top-right', 'center', 'full'] },
  },
  Cursor: {
    path: { kind: 'object-list', required: true, note: '{ x, y, frame }' },
    clickFrames: { kind: 'number-list' },
    style: { kind: 'enum', values: ['default', 'pointer', 'text'] },
  },
  Highlight: {
    target: { ...rect, required: true },
    color,
    pulse: { kind: 'boolean' },
    label: { kind: 'string' },
  },
  Tooltip: {
    text: { kind: 'string', required: true },
    position: { ...point, required: true },
    appearsAtFrame: { kind: 'number' },
  },
  SemanticUI: {
    referenceId: { kind: 'string', required: true },
    screenName: { kind: 'string', required: true },
    elements: { kind: 'object-list', required: true, note: '{ id, type, label, value?, x, y, width, height }' },
    background: color,
    surface: color,
    textColor: color,
    accent: color,
    focusId: { kind: 'string' },
    beatReactive: { kind: 'boolean' },
  },

  // ── TYPOGRAPHY ──
  MassiveType: {
    text: { kind: 'string', required: true },
    scale: { kind: 'enum', values: ['viewport', 'massive', 'editorial', 'display'] },
    weight: { kind: 'enum', values: [100, 400, 700, 900] },
    color,
    animateIn: { kind: 'enum', values: ['rise', 'fall', 'scale', 'reveal', 'none'] },
    tracking: { kind: 'enum', values: ['tight', 'normal', 'wide', 'ultra'] },
    align: { kind: 'enum', values: ['left', 'center', 'right'] },
  },
  KineticText: {
    lines: { kind: 'string-list', required: true },
    staggerFrames: { kind: 'number' },
    motion: { kind: 'enum', values: ['rise', 'fall', 'split', 'cascade', 'typewriter'] },
    emphasis: { kind: 'string-list' },
    color,
    size: { kind: 'enum', values: ['sm', 'md', 'lg', 'xl'] },
  },
  WordReveal: {
    text: { kind: 'string', required: true },
    revealStyle: { kind: 'enum', values: ['word', 'char', 'line'] },
    color,
    durationFrames: { kind: 'number' },
  },
  SplitText: {
    text: { kind: 'string', required: true },
    splitAxis: { kind: 'enum', values: ['horizontal', 'vertical'] },
    gapPx: { kind: 'number' },
    animateDirection: { kind: 'enum', values: ['apart', 'together'] },
  },
  TypeOn: {
    text: { kind: 'string', required: true },
    cursorVisible: { kind: 'boolean' },
    charsPerFrame: { kind: 'number' },
  },

  // ── MOTION ──
  Parallax: {
    depth: { kind: 'number', min: 0, max: 1 },
    direction: { kind: 'enum', values: ['up', 'down', 'left', 'right'] },
    children: node,
  },
  Camera: {
    motion: {
      kind: 'enum',
      required: true,
      values: ['push-in', 'pull-back', 'drift-left', 'drift-right', 'orbit'],
    },
    intensity: { kind: 'enum', values: ['subtle', 'moderate', 'dramatic'] },
    durationFrames: { kind: 'number' },
    children: node,
  },
  Zoom: {
    from: { kind: 'number', required: true },
    to: { kind: 'number', required: true },
    origin: point,
    easing: { kind: 'enum', values: ['linear', 'ease-in', 'ease-out', 'spring', 'snap'] },
    children: node,
  },
  BlurMask: {
    intensity: { kind: 'number', min: 0, max: 20 },
    animateIn: { kind: 'boolean' },
    durationFrames: { kind: 'number' },
    children: node,
  },
  Morph: {
    fromScreenshot: { kind: 'handle', required: true },
    toScreenshot: { kind: 'handle', required: true },
    durationFrames: { kind: 'number' },
    style: { kind: 'enum', values: ['crossfade', 'wipe', 'distort'] },
  },
  Particle: {
    density: { kind: 'enum', values: ['sparse', 'medium', 'dense'] },
    behavior: { kind: 'enum', values: ['drift', 'explode', 'orbit', 'rain'] },
    color,
    size: { kind: 'number' },
  },

  // ── COMPOSITION ──
  SplitScreen: {
    direction: { kind: 'enum', values: ['horizontal', 'vertical'] },
    ratio: { kind: 'number', min: 0, max: 1 },
    gap: { kind: 'number' },
    labelLeft: { kind: 'string' },
    labelRight: { kind: 'string' },
    children: node,
  },
  FloatingUI: {
    screenshot: { kind: 'handle', required: true },
    float: { kind: 'enum', values: ['subtle', 'breathing', 'drift'] },
    shadow: { kind: 'boolean' },
    cornerRadius: { kind: 'number' },
  },
  Perspective: {
    rotateX: { kind: 'number' },
    rotateY: { kind: 'number' },
    depth: { kind: 'number' },
    children: node,
  },
  Grid: {
    columns: { kind: 'number', required: true },
    gap: { kind: 'number' },
    items: { kind: 'handle-list', required: true },
    animateIn: { kind: 'enum', values: ['stagger', 'simultaneous'] },
  },
  FullBleed: {
    screenshot: { kind: 'handle', required: true },
    overlay: { kind: 'string' },
    blur: { kind: 'number' },
  },

  // ── MEDIA ──
  Screenshot: {
    src: { kind: 'handle', required: true },
    fit: { kind: 'enum', values: ['cover', 'contain', 'fill'] },
    cornerRadius: { kind: 'number' },
    shadow: { kind: 'boolean' },
    border: { kind: 'string' },
  },
  Logo: {
    src: { kind: 'handle', required: true },
    size: { kind: 'enum', values: ['sm', 'md', 'lg', 'xl'] },
    animateIn: { kind: 'enum', values: ['fade', 'scale', 'none'] },
  },
  ProductImage: {
    src: { kind: 'handle', required: true },
    fit: { kind: 'enum', values: ['cover', 'contain'] },
    cornerRadius: { kind: 'number' },
    shadow: { kind: 'boolean' },
    uiId: { kind: 'string' },
  },
  MetricCounter: {
    value: { kind: 'number', required: true },
    label: { kind: 'string', required: true },
    prefix: { kind: 'string' },
    suffix: { kind: 'string' },
    durationFrames: { kind: 'number' },
    color,
  },
};

/** Props every layer may carry regardless of component, set by the plan not the model. */
export const UNIVERSAL_PROPS = ['key', 'style', 'className'];

export function schemaFor(component: string): ComponentSchema | null {
  return Object.prototype.hasOwnProperty.call(SDK_SCHEMA, component)
    ? SDK_SCHEMA[component as SDKComponentName]
    : null;
}

export function requiredPropsOf(component: string): string[] {
  const schema = schemaFor(component);
  if (!schema) return [];
  return Object.keys(schema).filter((name) => schema[name].required);
}

/** Every prop across the SDK whose value must resolve through the asset registry. */
export function handlePropsOf(component: string): string[] {
  const schema = schemaFor(component);
  if (!schema) return [];
  return Object.keys(schema).filter((name) => {
    const kind = schema[name].kind;
    return kind === 'handle' || kind === 'handle-list';
  });
}

/**
 * Names in SDK_COMPONENTS with no schema entry, and vice versa. Should always
 * be empty — it is checked once at pipeline start so drift surfaces as a
 * pipeline error rather than as a mystery validation pass.
 */
export function verifySchemaCoverage(): string[] {
  const problems: string[] = [];
  for (const name of SDK_COMPONENTS) {
    if (!schemaFor(name)) problems.push('SDK component "' + name + '" has no schema entry.');
  }
  for (const name of Object.keys(SDK_SCHEMA)) {
    if ((SDK_COMPONENTS as readonly string[]).indexOf(name) < 0) {
      problems.push('Schema entry "' + name + '" is not in SDK_COMPONENTS.');
    }
  }
  return problems;
}

/**
 * The SDK, rendered as the compact type listing that goes into the component-plan
 * and code-generation prompts. Generated from the schema so the prompt can never
 * drift away from what the validator will actually enforce.
 */
export function schemaAsPromptText(): string {
  const lines: string[] = [];
  for (const name of SDK_COMPONENTS) {
    const schema = SDK_SCHEMA[name];
    const props = Object.keys(schema).map((prop) => {
      const spec = schema[prop];
      let type: string = spec.kind;
      if (spec.kind === 'enum' && spec.values) type = spec.values.map((v) => JSON.stringify(v)).join('|');
      if (spec.kind === 'handle') type = 'AssetHandle';
      if (spec.kind === 'handle-list') type = 'AssetHandle[]';
      if (spec.kind === 'string-list') type = 'string[]';
      if (spec.kind === 'number-list') type = 'number[]';
      if (spec.kind === 'rect') type = '{x,y,width,height,label?}';
      if (spec.kind === 'point') type = '{x,y}';
      if (spec.kind === 'object-list') type = 'Array<' + (spec.note || 'object') + '>';
      if (spec.kind === 'node') type = 'ReactNode';
      const bounds = spec.min !== undefined || spec.max !== undefined
        ? ' /* ' + String(spec.min ?? '') + '..' + String(spec.max ?? '') + ' */'
        : '';
      return prop + (spec.required ? '' : '?') + ': ' + type + bounds;
    });
    lines.push(name + ' { ' + props.join('; ') + ' }');
  }
  return lines.join('\n');
}
