// THE VISUAL BUDGET — ONE dominant visual + ONE supporting layer. More than two
// layers is a production error, not a creative choice.
//
// WHY THIS FILE EXISTS. The Motion Director (agents/motionDirector) is good at
// generating layers and bad at stopping: left alone it stacks a headline, a card,
// a glow, an arrow, a circle and a drifting backdrop onto a four-second beat, and
// the viewer has nowhere to look. The director prompt now states the rule, but a
// prompt is a request — this module is the enforcement:
//
//   1. `auditVisualBudget` counts what the director actually returned.
//   2. A violation is RE-PROMPTED once with the concrete count, so the director
//      fixes its own plan rather than having it silently trimmed.
//   3. `enforceVisualBudget` is the deterministic last resort, so a model that
//      keeps over-layering still renders a readable scene.
//   4. `COMPLEXITY_VIOLATION` (lib/visualQa) catches anything that reaches a
//      rendered frame anyway.
//
// WHAT DOES NOT COUNT. A background plate and a bottom-safe caption are not
// competing elements — they are the floor and the subtitle. The budget governs
// the layers a viewer reads as CONTENT: the hero, and at most one layer that
// supports it.
//
// AND THE OPPOSITE FAILURE. A constraint applied scene after scene produces ten
// identical beats, which is its own kind of unwatchable. So the budget ships with
// a FILM-LEVEL variety pass: the per-beat rule decides how MANY layers, and the
// variety pass decides that consecutive beats do not all lead with the same KIND
// of dominant visual.

import type { DirectedLayer, DirectedRole, EntranceStyle, PrimitiveType, SceneDirection } from './visualTimeline';
import type { MotionSpec } from './motionSpec';

export interface VisualBudget {
  /** How many layers may claim the viewer's attention. One. */
  maxDominant: number;
  /** How many layers may support that one. One. */
  maxSupporting: number;
  /** Roles that are scene furniture rather than competing content. */
  exemptRoles: DirectedRole[];
}

export const DEFAULT_VISUAL_BUDGET: VisualBudget = {
  maxDominant: 1,
  maxSupporting: 1,
  exemptRoles: ['background', 'caption'],
};

/** The rule, in the exact words the director prompt and the QA flag both use. */
export const VISUAL_BUDGET_RULE = 'ONE dominant visual + ONE supporting layer. More than two layers is a production error, not a creative choice.';

/** How many content layers a rendered scene may carry before QA flags it. */
export const MAX_MEANINGFUL_LAYERS = DEFAULT_VISUAL_BUDGET.maxDominant + DEFAULT_VISUAL_BUDGET.maxSupporting;

export interface BudgetViolation {
  code: 'too_many_dominant' | 'too_many_supporting' | 'no_dominant';
  detail: string;
}

export interface BudgetVerdict {
  ok: boolean;
  dominant: DirectedLayer[];
  supporting: DirectedLayer[];
  exempt: DirectedLayer[];
  /** dominant + supporting — the count a viewer actually reads. */
  meaningful: number;
  violations: BudgetViolation[];
}

function isExempt(layer: DirectedLayer, budget: VisualBudget): boolean {
  return budget.exemptRoles.includes(layer.role);
}

/** A layer claims the frame when it says so, by role or by emphasis. */
function isDominant(layer: DirectedLayer): boolean {
  return layer.role === 'main' || layer.emphasis === 'dominant';
}

/** The layers a viewer reads as content — everything the budget governs. */
export function meaningfulLayers(direction: SceneDirection | null | undefined, budget: VisualBudget = DEFAULT_VISUAL_BUDGET): DirectedLayer[] {
  const layers = Array.isArray(direction?.layers) ? direction!.layers : [];
  return layers.filter((layer) => !isExempt(layer, budget));
}

/**
 * Count one directed scene against the budget. Pure — nothing is modified, so
 * the same verdict can drive a re-prompt, a deterministic trim and a QA flag.
 */
export function auditVisualBudget(direction: SceneDirection | null | undefined, budget: VisualBudget = DEFAULT_VISUAL_BUDGET): BudgetVerdict {
  const layers = Array.isArray(direction?.layers) ? direction!.layers : [];
  const exempt = layers.filter((layer) => isExempt(layer, budget));
  const content = layers.filter((layer) => !isExempt(layer, budget));
  const dominant = content.filter(isDominant);
  const supporting = content.filter((layer) => !isDominant(layer));
  const violations: BudgetViolation[] = [];

  if (dominant.length > budget.maxDominant) {
    violations.push({
      code: 'too_many_dominant',
      detail: `${dominant.length} layers claim to be dominant (${dominant.map((layer) => `${layer.id}:${layer.type}`).join(', ')}). Exactly ${budget.maxDominant} may.`,
    });
  }
  if (supporting.length > budget.maxSupporting) {
    violations.push({
      code: 'too_many_supporting',
      detail: `${supporting.length} supporting layers (${supporting.map((layer) => `${layer.id}:${layer.type}`).join(', ')}). At most ${budget.maxSupporting} may support the hero.`,
    });
  }
  // A scene whose only layers are a backdrop and a caption has no hero at all;
  // that is a hole in the film, not a restrained composition.
  if (!dominant.length && content.length) {
    violations.push({ code: 'no_dominant', detail: 'No layer is marked dominant, so nothing in this beat is the thing the viewer is meant to look at.' });
  }

  return { ok: violations.length === 0, dominant, supporting, exempt, meaningful: content.length, violations };
}

/** The correction the director is re-prompted with. Concrete, not a scolding. */
export function budgetConstraintPrompt(verdict: BudgetVerdict): string {
  const lines = [
    `VISUAL BUDGET VIOLATION. ${VISUAL_BUDGET_RULE}`,
    `Your plan returned ${verdict.meaningful} content layers: ${verdict.dominant.length} dominant and ${verdict.supporting.length} supporting.`,
    ...verdict.violations.map((violation) => `- ${violation.code}: ${violation.detail}`),
    'Return the SAME scene again with exactly ONE layer at role "main" / emphasis "dominant" and AT MOST ONE other content layer, chosen because it makes the hero clearer. Background plates and bottom-safe captions do not count against the budget. Do not satisfy this by shrinking or stacking layers — DELETE the ones you cannot justify, and keep every string and number of the surviving layers exactly as the spec has them.',
  ];
  return lines.join('\n');
}

// How a supporting layer earns the one slot available: typography that names
// what the hero is beats a callout that points at it, which beats a generic
// support card, which beats ambient decoration.
const SUPPORT_PRIORITY: Record<string, number> = {
  typography: 0,
  callout: 1,
  support: 2,
};

function supportRank(layer: DirectedLayer): number {
  const byRole = SUPPORT_PRIORITY[layer.role] ?? 3;
  // Pure decoration (a glow with nothing to glow behind) always goes last.
  const decorative = layer.type === 'Glow' || layer.type === 'Pointer' ? 1 : 0;
  return byRole * 2 + decorative;
}

/**
 * Bring a direction inside the budget deterministically: keep the first
 * dominant layer, keep the single best-justified supporting layer, keep the
 * background and captions, drop the rest. Returns the SAME object when nothing
 * needed cutting, and records every cut in `adjustments` so a trimmed scene
 * explains itself instead of quietly losing elements.
 */
export function enforceVisualBudget(direction: SceneDirection, budget: VisualBudget = DEFAULT_VISUAL_BUDGET): SceneDirection {
  const verdict = auditVisualBudget(direction, budget);
  if (verdict.ok) return direction;

  const keptDominant = verdict.dominant.slice(0, budget.maxDominant);
  // No dominant layer at all: promote the strongest support rather than render
  // a beat with no hero.
  if (!keptDominant.length && verdict.supporting.length) {
    const promoted = [...verdict.supporting].sort((a, b) => supportRank(a) - supportRank(b))[0];
    keptDominant.push({ ...promoted, role: 'main', emphasis: 'dominant' });
  }
  const keptSupporting = verdict.supporting
    .filter((layer) => !keptDominant.some((kept) => kept.id === layer.id))
    .sort((a, b) => supportRank(a) - supportRank(b))
    .slice(0, budget.maxSupporting);

  const keepIds = new Set([...keptDominant, ...keptSupporting, ...verdict.exempt].map((layer) => layer.id));
  const dropped = direction.layers.filter((layer) => !keepIds.has(layer.id));
  const layers = direction.layers
    .filter((layer) => keepIds.has(layer.id))
    .map((layer) => {
      const promoted = keptDominant.find((kept) => kept.id === layer.id);
      return promoted ? { ...layer, role: promoted.role, emphasis: promoted.emphasis } : layer;
    })
    // A callout whose target was just cut would point at nothing.
    .map((layer) => (layer.targetLayerId && !keepIds.has(layer.targetLayerId) ? { ...layer, targetLayerId: undefined } : layer));

  const adjustments = [
    ...(direction.adjustments || []),
    ...(dropped.length
      ? [`Visual budget: dropped ${dropped.length} competing layer${dropped.length === 1 ? '' : 's'} (${dropped.map((layer) => layer.id).join(', ')}) to keep one dominant visual and one supporting layer.`]
      : []),
  ].slice(0, 12);

  return { ...direction, layers, adjustments };
}

// ——— Film-level variety ———
//
// The budget decides how many layers a beat carries. This decides that beat 4
// does not lead with the same KIND of visual as beats 2 and 3 — the difference
// between a disciplined film and a slideshow.

export type DominantKind = 'text' | 'data' | 'graphic' | 'image' | 'avatar_only';

export const DOMINANT_KINDS: DominantKind[] = ['text', 'data', 'graphic', 'image', 'avatar_only'];

const PRIMITIVE_KIND: Record<PrimitiveType, DominantKind> = {
  SmartText: 'text',
  KineticHeadline: 'text',
  Caption: 'text',
  Metric: 'data',
  Chart: 'data',
  ProgressIndicator: 'data',
  TimelineRail: 'graphic',
  Comparison: 'graphic',
  Diagram: 'graphic',
  FlowChart: 'graphic',
  Map: 'graphic',
  Callout: 'graphic',
  Arrow: 'graphic',
  Pointer: 'graphic',
  Highlight: 'graphic',
  Glow: 'graphic',
  Logo: 'graphic',
  DeviceMockup: 'image',
  BrowserMockup: 'image',
  ProductUI: 'image',
  ImageCard: 'image',
  VideoLayer: 'image',
};

/** Which primitives can carry each kind, strongest first. */
const KIND_PRIMITIVES: Record<DominantKind, PrimitiveType[]> = {
  text: ['KineticHeadline', 'SmartText'],
  data: ['Metric', 'Chart'],
  graphic: ['FlowChart', 'Diagram', 'Comparison', 'TimelineRail'],
  image: ['ImageCard', 'DeviceMockup', 'BrowserMockup'],
  avatar_only: [],
};

export function dominantLayerOf(direction: SceneDirection | null | undefined): DirectedLayer | null {
  return auditVisualBudget(direction).dominant[0] || null;
}

/** The kind of visual this beat leads with. No hero at all reads as avatar-only. */
export function dominantKindOf(direction: SceneDirection | null | undefined): DominantKind {
  const layer = dominantLayerOf(direction);
  if (!layer) return 'avatar_only';
  return PRIMITIVE_KIND[layer.type] || 'graphic';
}

/**
 * The kinds this scene's CONTENT could genuinely carry. Re-casting a headline as
 * a chart when the spec has no numbers would render an empty chart, so variety
 * is only ever offered within what the spec can actually show.
 */
export function alternativeKindsFor(spec: MotionSpec | null | undefined): DominantKind[] {
  const out: DominantKind[] = [];
  const items = Array.isArray(spec?.items) ? spec!.items : [];
  const hasNumbers = Boolean(spec?.stat) || items.some((item) => Number.isFinite(Number(item?.value)));
  if (hasNumbers) out.push('data');
  if (items.length >= 2) out.push('graphic');
  if (spec?.imageUrl) out.push('image');
  // Typography is the one treatment every spec can carry, because the title and
  // subtitle are always strings.
  if (spec?.title || spec?.subtitle) out.push('text');
  return out;
}

export interface VarietyEntry {
  /** The caller's own key — a scene id. */
  key: string;
  kind: DominantKind;
  /** Kinds this scene could honestly be re-cast as (`alternativeKindsFor`). */
  alternatives: DominantKind[];
}

export interface VarietyChange {
  key: string;
  from: DominantKind;
  to: DominantKind;
  reason: string;
}

/** Beats in a row that may lead with the same kind before the film goes flat. */
export const MAX_SAME_DOMINANT_RUN = 2;

/**
 * Walk the film and break up runs of identical dominant visuals.
 *
 * Deliberately conservative: it acts only on the THIRD consecutive beat of a
 * kind, picks only a kind the scene's own content supports, and never picks the
 * kind the next beat already leads with (which would just move the run along).
 * A scene with no honest alternative is left exactly as the director planned it.
 */
export function planVariety(entries: VarietyEntry[]): VarietyChange[] {
  const changes: VarietyChange[] = [];
  const resolved = entries.map((entry) => entry.kind);
  let run = 0;

  entries.forEach((entry, index) => {
    const previous = index > 0 ? resolved[index - 1] : null;
    run = previous === resolved[index] ? run + 1 : 0;
    if (run < MAX_SAME_DOMINANT_RUN) return;

    const next = index + 1 < entries.length ? resolved[index + 1] : null;
    const candidate = entry.alternatives.find((kind) => kind !== resolved[index] && kind !== next && kind !== 'avatar_only');
    if (!candidate) return;

    changes.push({
      key: entry.key,
      from: resolved[index],
      to: candidate,
      reason: `${MAX_SAME_DOMINANT_RUN + 1} beats in a row led with a ${resolved[index]} visual, so this one leads with ${candidate} instead and the film keeps its rhythm.`,
    });
    resolved[index] = candidate;
    run = 0;
  });

  return changes;
}

/**
 * Re-cast a direction's dominant layer as a different KIND of visual, keeping
 * its zone, timing and purpose. Returns the same object when the kind is already
 * right or no primitive can carry it.
 */
export function recastDominant(direction: SceneDirection, kind: DominantKind): SceneDirection {
  const hero = dominantLayerOf(direction);
  if (!hero) return direction;
  const candidates = KIND_PRIMITIVES[kind] || [];
  const type = candidates.find((primitive) => primitive !== hero.type) || candidates[0];
  if (!type || type === hero.type) return direction;
  // The entrance has to suit the new primitive: a counter counts up, a diagram
  // draws itself, a still is masked in, type springs.
  const style: EntranceStyle = kind === 'data'
    ? (type === 'Metric' ? 'countup' : 'draw')
    : kind === 'graphic' ? 'draw' : kind === 'image' ? 'mask' : 'spring';
  const layers = direction.layers.map((layer) => (layer.id === hero.id
    ? { ...layer, type, entrance: { ...layer.entrance, style } }
    : layer));
  const adjustments = [
    ...(direction.adjustments || []),
    `Film variety: this beat's dominant visual was re-cast as ${kind} (${type}) so consecutive scenes do not all look alike.`,
  ].slice(0, 12);
  return { ...direction, layers, adjustments };
}
