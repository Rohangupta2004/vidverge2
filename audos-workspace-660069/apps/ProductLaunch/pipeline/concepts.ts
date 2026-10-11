// Step 2 — ProductContext to 2-3 competing FilmSpec drafts.
//
// Text only. No code, no render, no cost beyond one model turn — which is the
// entire point of generating several: concepts are cheap and renders are not,
// so the expensive part of the pipeline should only ever run on the best idea
// the model had, not on its first.

import { callModelForJson, OPUS_MODEL } from '../lib/ai-client';
import {
  CONCEPT_GENERATION_SYSTEM_PROMPT,
  CONCEPT_REVISION_CLAUSE,
  FILM_SPEC_JSON_SHAPE,
} from '../prompts/concept-generation.prompt';
import { isSDKComponent, SDK_COMPONENTS } from '../sdk/component-sdk.types';
import type { CriticOutput } from '../types/critic.types';
import {
  MOTION_INTENSITIES,
  TRANSITION_TYPES,
  TYPOGRAPHY_SCALES,
  TYPOGRAPHY_WEIGHTS,
  type FilmSpec,
  type MotionIntensity,
  type SceneSpec,
  type TransitionType,
} from '../types/film-spec.types';
import { assetHandles, type ProductContext } from '../types/product-context.types';

/** 15s to 30s. Anything outside this is clamped rather than rejected. */
export const MIN_DURATION_FRAMES = 450;
export const MAX_DURATION_FRAMES = 900;

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function strList(value: unknown, limit = 12): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(str).filter(Boolean).slice(0, limit);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const candidate = str(value).toLowerCase() as T;
  return allowed.indexOf(candidate) >= 0 ? candidate : fallback;
}

/**
 * Read a value under any of several key names.
 *
 * The prompt now carries the exact FilmSpec shape, so the first name should
 * always hit. These aliases are the safety net behind it, and they are here
 * because of how this step fails when a key is spelled differently: a scene
 * the reader cannot find keys on is dropped, a draft that loses all its
 * scenes is discarded, and the step then reports 'no usable concept' after
 * minutes of work — with the model's actual answer thrown away. Reading a
 * synonym is always better than losing the film.
 */
function pick(source: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
}

/** The scene list, whether it arrived as an array or as an object keyed by scene id. */
function sceneList(source: Record<string, unknown>): unknown[] {
  const raw = pick(source, 'scenes', 'shots', 'beats', 'scene_list', 'sequence');
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    const map = raw as Record<string, unknown>;
    return Object.keys(map).map((key) => {
      const entry = map[key];
      return entry && typeof entry === 'object' ? { id: key, ...(entry as object) } : entry;
    });
  }
  return [];
}

function looksLikeSpec(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  return pick(source, 'scenes', 'shots', 'beats', 'scene_list', 'sequence') !== undefined
    || pick(source, 'narrative_arc', 'arc') !== undefined;
}

/**
 * Find the concepts in whatever the model wrapped them in — a bare array, a
 * single unwrapped spec, an array under some key it chose for itself, or an
 * object whose values are the concepts.
 */
function conceptList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return [];
  const source = raw as Record<string, unknown>;

  // One spec handed back on its own. Checked FIRST, because a FilmSpec has an
  // array of objects under 'scenes' and the key scan below would otherwise
  // mistake its scenes for the list of concepts.
  if (looksLikeSpec(source)) return [source];

  for (const key of Object.keys(source)) {
    const value = source[key];
    if (Array.isArray(value) && value.some(looksLikeSpec)) return value;
  }

  const values = Object.keys(source).map((key) => source[key]);
  if (values.some(looksLikeSpec)) return values.filter(looksLikeSpec);
  return [source];
}

/** What the model actually sent, for an error message worth reading. */
function describeShape(raw: unknown): string {
  if (Array.isArray(raw)) return 'an array of ' + String(raw.length) + ' item(s)';
  if (raw && typeof raw === 'object') {
    const keys = Object.keys(raw as object);
    return 'an object with ' + String(keys.length) + ' key(s): ' + keys.slice(0, 14).join(', ');
  }
  return 'a ' + typeof raw;
}

/** The brief as the model reads it. Shared with the critic, which judges against it. */
export function describeProductContext(ctx: ProductContext): string {
  const lines: string[] = [];
  lines.push('PRODUCT CONTEXT');
  lines.push('product_name: ' + ctx.product_name);
  lines.push('url: ' + ctx.url);
  lines.push('tagline: ' + ctx.tagline);
  lines.push('category: ' + ctx.product_category);
  lines.push('target_audience: ' + ctx.target_audience);
  lines.push('core_problem: ' + ctx.core_problem);
  lines.push('core_solution: ' + ctx.core_solution);
  lines.push('value_prop_in_one_line: ' + ctx.value_prop_in_one_line);
  if (ctx.pricing_model) lines.push('pricing_model: ' + ctx.pricing_model);
  if (ctx.price_anchors && ctx.price_anchors.length) {
    lines.push('price_anchors: ' + ctx.price_anchors.join(', '));
  }

  lines.push('', 'KEY FEATURES');
  if (ctx.key_features.length) {
    for (const feature of ctx.key_features) {
      lines.push('- ' + feature.name + ': ' + feature.description
        + (feature.asset_handle ? '  [visual: ' + feature.asset_handle + ']' : '  [no visual]'));
    }
  } else {
    lines.push('- none were identifiable on the site');
  }

  lines.push('', 'SOCIAL PROOF');
  if (ctx.social_proof.length) {
    for (const item of ctx.social_proof) {
      lines.push('- [' + item.type + '] ' + item.content
        + (item.film_usable ? '  (usable in film)' : '  (too vague for film)'));
    }
  } else {
    lines.push('- none found');
  }

  lines.push('', 'BRAND');
  lines.push('primary_colors: ' + (ctx.brand.primary_colors.join(', ') || 'none read'));
  lines.push('accent_colors: ' + (ctx.brand.accent_colors.join(', ') || 'none read'));
  lines.push('background_color: ' + ctx.brand.background_color);
  lines.push('text_color: ' + ctx.brand.text_color);
  lines.push('typography_feel: ' + ctx.brand.typography_feel);
  lines.push('visual_style: ' + ctx.brand.visual_style);
  lines.push('design_maturity: ' + ctx.brand.design_maturity);

  lines.push('', 'ASSETS — the only handles that exist');
  if (ctx.assets.length) {
    for (const asset of ctx.assets) {
      lines.push('- ' + asset.handle + ' [' + asset.type + ', quality ' + asset.visual_quality + ']'
        + (asset.source_url ? '' : ' (NO FILE — will draw as missing)')
        + '\n    shows: ' + asset.description
        + '\n    film use: ' + asset.film_usability
        + (asset.suitable_for_roles.length
          ? '\n    suits roles: ' + asset.suitable_for_roles.join(', ')
          : ''));
    }
  } else {
    lines.push('- NONE. This film has no imagery at all and must be carried by typography and motion.');
  }

  lines.push('', 'FILM READINESS');
  lines.push('best_hook_asset: ' + (ctx.best_hook_asset || 'none'));
  lines.push('ui_richness: ' + ctx.ui_richness + ' — ' + ctx.ui_richness_rationale);
  lines.push('extraction_confidence: ' + String(ctx.extraction_confidence));
  lines.push('extraction_gaps: ' + (ctx.extraction_gaps.join(' | ') || 'none flagged'));
  lines.push('manufacture_required: ' + (ctx.manufacture_required.join(' | ') || 'nothing flagged'));
  return lines.join('\n');
}

function normalizeScene(raw: unknown, index: number, validHandles: string[]): SceneSpec | null {
  const source = asRecord(raw);
  const treatment = str(pick(source, 'visual_treatment', 'visual', 'treatment', 'visual_description', 'description'));
  const components = strList(pick(source, 'components', 'sdk_components', 'component_names'), 8)
    .filter(isSDKComponent);
  const beat = str(pick(source, 'narration_beat', 'beat', 'narrative_beat', 'message'));
  const rawRole = str(pick(source, 'role', 'scene_role')).toLowerCase();

  // A scene survives if it says ANYTHING about what happens. Only a genuinely
  // empty object is dropped: a thin scene the planner can still work from is
  // far better than a concept that quietly lost half its film.
  if (!treatment && !components.length && !beat && !rawRole) return null;

  const frames = Math.round(Number(pick(source, 'duration_frames', 'durationFrames', 'frames', 'duration')));
  return {
    id: str(pick(source, 'id', 'scene_id', 'name')) || ('scene_' + String(index + 1)),
    role: rawRole || 'product',
    duration_frames: isFinite(frames) && frames > 0 ? Math.max(30, Math.min(450, frames)) : 90,
    visual_treatment: treatment || beat,
    components,
    narration_beat: beat,
    narration_text: str(pick(source, 'narration_text', 'voiceover', 'line')) || undefined,
    // A handle the model invented is dropped here rather than at render time,
    // where it would be an exception instead of a smaller scene.
    assets_needed: strList(pick(source, 'assets_needed', 'assets', 'asset_handles'), 6)
      .filter((handle) => validHandles.indexOf(handle) >= 0),
    motion_intensity: oneOf<MotionIntensity>(
      pick(source, 'motion_intensity', 'motion'),
      MOTION_INTENSITIES,
      'subtle',
    ),
    transition_out: oneOf<TransitionType>(
      pick(source, 'transition_out', 'transition'),
      TRANSITION_TYPES,
      'cut',
    ),
    notes: str(pick(source, 'notes', 'director_note')) || undefined,
  };
}

/**
 * Every FilmSpec the pipeline holds has been through here, whether it came
 * from the concept step or from a revision. A spec that reaches the component
 * planner is therefore guaranteed to name only real components, only real
 * asset handles and a duration the renderer will accept.
 */
export function normalizeFilmSpec(raw: unknown, ctx: ProductContext, index: number): FilmSpec | null {
  const source = asRecord(raw);
  const validHandles = assetHandles(ctx);
  const rawScenes = sceneList(source);
  const scenes = rawScenes
    .map((scene, sceneIndex) => normalizeScene(scene, sceneIndex, validHandles))
    .filter((scene): scene is SceneSpec => scene !== null)
    .slice(0, 10);
  if (!scenes.length) return null;

  const typographyRaw = asRecord(pick(source, 'typography_system', 'typography'));

  const statedTotal = Math.round(Number(pick(source, 'total_duration_frames', 'total_frames')));
  const sceneTotal = scenes.reduce((sum, scene) => sum + scene.duration_frames, 0);
  const total = Math.max(
    MIN_DURATION_FRAMES,
    Math.min(MAX_DURATION_FRAMES, isFinite(statedTotal) && statedTotal > 0 ? statedTotal : sceneTotal),
  );

  const risks = strList(source.risks, 8);
  // A component name the model invented is dropped by normalizeScene, which
  // would otherwise silently shrink a scene. Saying so in risks keeps the
  // concept score honest about what was lost.
  const askedFor = rawScenes.reduce((names: string[], scene) => names.concat(
    strList(pick(asRecord(scene), 'components', 'sdk_components', 'component_names'), 8),
  ), []);
  const dropped = askedFor.filter((name) => !isSDKComponent(name));
  if (dropped.length) {
    risks.push('Referenced components that are not in the SDK and were dropped: ' + dropped.join(', '));
  }

  return {
    version: '1.0',
    generated_at: new Date().toISOString(),

    product_name: str(source.product_name) || ctx.product_name,
    product_url: str(source.product_url) || ctx.url,
    target_audience: str(source.target_audience) || ctx.target_audience,
    core_value_prop: str(source.core_value_prop) || ctx.value_prop_in_one_line,
    key_features: strList(source.key_features, 8).length
      ? strList(source.key_features, 8)
      : ctx.key_features.map((feature) => feature.name),
    brand_colors: strList(source.brand_colors, 6).length
      ? strList(source.brand_colors, 6)
      : ctx.brand.primary_colors.concat(ctx.brand.accent_colors).slice(0, 4),

    narrative_arc: str(pick(source, 'narrative_arc', 'arc')) || 'unnamed arc',
    total_duration_frames: total,
    typography_system: {
      scale: oneOf(typographyRaw.scale, TYPOGRAPHY_SCALES, 'product'),
      weight: oneOf(typographyRaw.weight, TYPOGRAPHY_WEIGHTS, 'heavy'),
      primary_typeface: str(typographyRaw.primary_typeface) || undefined,
    },
    color_story: str(pick(source, 'color_story', 'colour_story')),
    visual_language: str(pick(source, 'visual_language', 'visual_style')),

    scenes,

    narration_enabled: Boolean(source.narration_enabled),
    narration_voice: str(source.narration_voice) || undefined,
    music_style: oneOf(
      pick(source, 'music_style', 'music'),
      ['tension', 'momentum', 'minimal', 'cinematic', 'none'] as const,
      'none',
    ),

    concept_score: (() => {
      const score = Number(pick(source, 'concept_score', 'score'));
      if (!isFinite(score)) return 0.5;
      return Math.max(0, Math.min(1, score));
    })(),
    concept_rationale: str(pick(source, 'concept_rationale', 'rationale'))
      || ('Concept ' + String(index + 1)),
    risks,
  };
}

export interface ConceptOptions {
  /** Set on a second round after the critic found a concept-level problem. */
  previousCritique?: CriticOutput | null;
  previousArc?: string;
  onProgress?: (detail: string) => void;
  signal?: AbortSignal;
}

interface ConceptAttempt {
  specs: FilmSpec[];
  /** What the model actually answered with, for the error when nothing is usable. */
  shape: string;
  /** Scenes found per draft BEFORE normalisation dropped any. */
  sceneCounts: number[];
}

function buildConceptRequest(
  ctx: ProductContext,
  options: ConceptOptions,
  count: number,
): string {
  const parts: string[] = [describeProductContext(ctx)];

  if (options.previousCritique) {
    parts.push(CONCEPT_REVISION_CLAUSE);
    parts.push('THE CONCEPT THAT FAILED: ' + String(options.previousArc || 'unnamed'));
    parts.push('CRITIQUE\nsingle_biggest_problem: '
      + options.previousCritique.single_biggest_problem
      + '\ndirector_note: ' + options.previousCritique.director_note
      + '\nfilm_level_issues:\n'
      + options.previousCritique.film_level_issues
        .map((issue) => '- [' + issue.priority + '] ' + issue.dimension + ': ' + issue.finding
          + ' -> ' + issue.fix_instruction)
        .join('\n'));
  }

  parts.push(
    'VALID ASSET HANDLES: ' + (assetHandles(ctx).join(', ') || 'none'),
    'VALID SDK COMPONENT NAMES: ' + SDK_COMPONENTS.join(', '),
    FILM_SPEC_JSON_SHAPE,
    count === 1
      ? 'Answer with a JSON array containing EXACTLY ONE FilmSpec object — your single '
        + 'strongest concept for this product — and nothing else.'
      : 'Answer with a JSON array of 2 or 3 FilmSpec objects and nothing else.',
  );
  return parts.join('\n\n');
}

async function requestConcepts(
  ctx: ProductContext,
  options: ConceptOptions,
  count: number,
): Promise<ConceptAttempt> {
  const raw = await callModelForJson<unknown>(buildConceptRequest(ctx, options, count), {
    system: CONCEPT_GENERATION_SYSTEM_PROMPT,
    model: OPUS_MODEL,
    maxTokens: 8192,
    signal: options.signal,
  });

  const list = conceptList(raw);
  return {
    specs: list
      .map((entry, index) => normalizeFilmSpec(entry, ctx, index))
      .filter((spec): spec is FilmSpec => spec !== null)
      .sort((a, b) => b.concept_score - a.concept_score),
    shape: describeShape(raw),
    sceneCounts: list.map((entry) => sceneList(asRecord(entry)).length),
  };
}

export async function generateConcepts(
  ctx: ProductContext,
  options: ConceptOptions = {},
): Promise<FilmSpec[]> {
  const report = options.onProgress || (() => undefined);

  const first = await requestConcepts(ctx, options, 3);
  if (first.specs.length) return first.specs.slice(0, 3);

  // Nothing readable came back, even though the answer parsed as JSON. Asking
  // for ONE concept makes the reply a fraction of the size, which rules out
  // both ways a valid-JSON answer can still be unusable: an array that ran out
  // of room part-way through, and a wrapper shape the reader could not see
  // through. One good concept beats a failed run — the selection step is
  // perfectly happy with a list of one.
  report('The first draft came back with no readable scenes — asking Opus for a single concept instead…');
  const salvage = await requestConcepts(ctx, options, 1);
  if (salvage.specs.length) return salvage.specs;

  throw new Error(
    'Opus returned no usable concept. It answered with ' + first.shape
    + ', and every draft came back without scenes this app could read'
    + (first.sceneCounts.length
      ? ' (scenes found per draft: ' + first.sceneCounts.join(', ') + ')'
      : '')
    + '. Asking for a single concept did not help either. Retrying is worth one go.',
  );
}
