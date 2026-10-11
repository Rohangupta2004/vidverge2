// Step 3 — pick the concept the rest of the pipeline will pay for.
//
// The score comes from the model, so this step's job is not to re-judge the
// creative — it is to notice when the best-scoring concept is best only on
// paper. A concept that leans on assets flagged manufacture_required will
// score well and then render as a film full of empty plates, and the critic
// will blame the execution. Catching that here is much cheaper.

import { hasAsset, resolveAsset } from '../lib/asset-registry';
import { scenesFrameTotal, type FilmSpec } from '../types/film-spec.types';
import type { ProductContext } from '../types/product-context.types';

export interface ConceptAudit {
  spec: FilmSpec;
  /** Fraction of scenes whose named assets all resolve to a real file, 0–1. */
  asset_coverage: number;
  /** Scenes that name an asset with no captured file behind it. */
  scenes_with_missing_assets: string[];
  /** Scenes that name no asset at all — fine for typography, not for a product beat. */
  type_only_scenes: string[];
  /** How far the scene durations drift from the stated total. */
  frame_drift: number;
  warnings: string[];
}

function resolvesToFile(handle: string): boolean {
  if (!hasAsset(handle)) return false;
  try {
    return Boolean(resolveAsset(handle));
  } catch {
    return false;
  }
}

export function auditConcept(spec: FilmSpec, ctx: ProductContext): ConceptAudit {
  const missing: string[] = [];
  const typeOnly: string[] = [];
  let covered = 0;

  for (const scene of spec.scenes) {
    if (!scene.assets_needed.length) {
      typeOnly.push(scene.id);
      covered += 1;   // a deliberately typographic scene is not an asset failure
      continue;
    }
    const allResolve = scene.assets_needed.every(resolvesToFile);
    if (allResolve) covered += 1;
    else missing.push(scene.id);
  }

  const coverage = spec.scenes.length ? covered / spec.scenes.length : 0;
  const drift = Math.abs(scenesFrameTotal(spec) - spec.total_duration_frames);

  const warnings: string[] = [];
  if (missing.length) {
    warnings.push(
      String(missing.length) + ' scene(s) need an asset that has no captured file: '
      + missing.join(', ') + '. They will render as missing-asset plates.',
    );
  }
  // A product beat with nothing to show is the specific failure the critic
  // cannot distinguish from a bad execution, so it is named here instead.
  const productBeatsWithoutVisuals = spec.scenes.filter(
    (scene) => (scene.role === 'product' || scene.role === 'proof')
      && !scene.assets_needed.length,
  );
  if (productBeatsWithoutVisuals.length && ctx.ui_richness !== 'low') {
    warnings.push(
      'The product beat shows no captured UI even though this site had usable screenshots: '
      + productBeatsWithoutVisuals.map((scene) => scene.id).join(', ') + '.',
    );
  }
  if (ctx.manufacture_required.length && coverage < 0.6) {
    warnings.push(
      'This concept depends heavily on material the extraction flagged as manufacture_required: '
      + ctx.manufacture_required.slice(0, 3).join('; ') + '.',
    );
  }
  if (drift > 30) {
    warnings.push(
      'Scene durations sum to ' + String(scenesFrameTotal(spec)) + ' frames but the concept states '
      + String(spec.total_duration_frames) + '. The plan step will rebalance them.',
    );
  }
  if (!spec.risks.length) {
    warnings.push('The concept lists no risks, which usually means they were not considered.');
  }

  return {
    spec,
    asset_coverage: Math.round(coverage * 100) / 100,
    scenes_with_missing_assets: missing,
    type_only_scenes: typeOnly,
    frame_drift: drift,
    warnings,
  };
}

export function auditConcepts(concepts: FilmSpec[], ctx: ProductContext): ConceptAudit[] {
  return concepts.map((spec) => auditConcept(spec, ctx));
}

/**
 * The winner is the highest concept_score, as specified — the model's judgement
 * is not second-guessed. The one exception is a tie, which is broken by asset
 * coverage: between two equally good ideas, take the one the available footage
 * can actually execute.
 */
export function selectBestConcept(concepts: FilmSpec[], ctx: ProductContext): FilmSpec {
  if (!concepts.length) throw new Error('There are no concepts to choose between.');
  const audits = auditConcepts(concepts, ctx);
  const ranked = audits.slice().sort((a, b) => {
    const byScore = b.spec.concept_score - a.spec.concept_score;
    if (Math.abs(byScore) > 0.001) return byScore;
    return b.asset_coverage - a.asset_coverage;
  });
  return ranked[0].spec;
}
