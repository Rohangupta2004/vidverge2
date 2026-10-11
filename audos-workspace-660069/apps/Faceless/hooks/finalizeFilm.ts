/**
 * STAGE 15 — finalizeFilm.
 *
 * Marks the output ready and assembles the record of how it was made: which
 * spec version shipped, what the tier mix actually came out as against the
 * target, and what it cost. The first successful render is immediately ready.
 */

import {
  FacelessError,
  type AssetTier,
  type CreativeQAResult,
  type FilmSpec,
  type FinalFilm,
  type MechanicalQAResult,
} from '../types/editorial';

export interface FinalizeFilmInput {
  mp4Url: string;
  spec: FilmSpec;
  mechanicalQA?: MechanicalQAResult | null;
  creativeQA?: CreativeQAResult | null;
  revisionsUsed?: number;
  estimatedCost?: number;
}

export function finalizeFilm(input: FinalizeFilmInput): FinalFilm {
  if (!/^https?:\/\//i.test(input.mp4Url)) {
    throw new FacelessError('finalizeFilm was given no usable video URL.', 'finalize', 'no_url');
  }

  const tierMix = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<AssetTier, number>;
  Object.values(input.spec.resolvedAssets).forEach((asset) => {
    tierMix[asset.tier] += 1;
  });

  const spent =
    typeof input.estimatedCost === 'number'
      ? input.estimatedCost
      : Object.values(input.spec.resolvedAssets).reduce((sum, asset) => sum + (asset.cost || 0), 0);

  return {
    filmId: input.spec.filmId,
    mp4Url: input.mp4Url,
    durationSeconds: input.spec.timeline.duration,
    mode: input.spec.timeline.mode,
    specVersion: input.spec.version,
    beatCount: input.spec.timeline.beats.length,
    tierMix,
    estimatedCost: Math.round(spent * 100) / 100,
    narrationUrl: input.spec.narrationUrl,
    mechanicalQA: input.mechanicalQA || null,
    creativeQA: input.creativeQA || null,
    revisionsUsed: input.revisionsUsed || 0,
    finalizedAt: new Date().toISOString(),
  };
}

/** The line the app shows under the finished player. */
export function describeFinalFilm(film: FinalFilm): string {
  const mix = [1, 2, 3, 4, 5]
    .filter((tier) => film.tierMix[tier as AssetTier] > 0)
    .map((tier) => `${film.tierMix[tier as AssetTier]}×T${tier}`)
    .join(' ');
  return `${film.beatCount} beats over ${film.durationSeconds.toFixed(1)}s · ${mix} · $${film.estimatedCost.toFixed(2)} · FilmSpec v${film.specVersion}`;
}
