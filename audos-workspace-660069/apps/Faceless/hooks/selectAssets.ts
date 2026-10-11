/**
 * STAGE 6a — selectAssets.
 *
 * Tiers 1–3 only. This is where the cost hierarchy is actually spent: before
 * any beat is allowed to generate, it has to be shown that nothing the
 * workspace already owns, and nothing in the stock library, can carry the
 * narration at that moment.
 *
 * Returns null when nothing suitable exists, which is the signal that the beat
 * falls through to generateAssets. Returning a nearly-right clip to save a
 * nickel is the wrong trade and this stage does not make it: the match
 * threshold in queryAssetIndex is deliberately strict.
 */

import type {
  AspectId,
  AssetIndex,
  FacelessBeat,
  ResolvedAsset,
  StockClip,
} from '../types/editorial';
import { queryAssetIndex } from './buildAssetIndex';
import { searchBroll, stockQueryFrom } from './searchBroll';

export interface SelectAssetsInput {
  beat: FacelessBeat;
  assetIndex: AssetIndex;
  /** Decides which orientation the stock search asks for. */
  aspect?: AspectId;
}

/**
 * The brief types this as returning an AssetDecision; what the pipeline needs
 * downstream is the resolved media, so it returns the decision's outcome — a
 * ResolvedAsset — or null. The beat's AssetDecision is unchanged and remains
 * the record of why this tier was chosen.
 */
export async function selectAssets(input: SelectAssetsInput): Promise<ResolvedAsset | null> {
  const { beat, assetIndex } = input;
  const beatDuration = beat.narrationEnd - beat.narrationStart;
  const query = stockQueryFrom(beat.assetDecision.searchQuery, beat.visualIntent);

  // Tier 1 — footage this workspace already owns.
  const ownedFootage = queryAssetIndex(assetIndex, query, { kinds: ['video'] });
  if (ownedFootage.length) {
    const best = ownedFootage[0].asset;
    return {
      beatId: beat.id,
      tier: 1,
      url: best.url,
      duration: best.durationSeconds || beatDuration,
      type: 'video',
      cost: 0,
      provider: best.source,
      width: best.width,
      height: best.height,
    };
  }

  // Tier 3 before Tier 2 when the beat wants a UI screenshot: a real capture
  // of the real product always beats a stock photograph of a laptop.
  const wantsUi = beat.visualType === 'ui_screenshot';
  if (wantsUi) {
    const screenshot = pickStill(assetIndex, query, ['screenshot', 'image', 'graphic']);
    if (screenshot) return screenshot;
  }

  // Tier 2 — stock. Only for beats whose visual is a real-world thing; a
  // diagram or a chart has no stock equivalent and asking for one is how a
  // film ends up with a photograph of a whiteboard instead of a diagram.
  if (beat.assetDecision.tier <= 2 && usesRealWorldImagery(beat)) {
    const clips = await searchBroll(query, 6, input.aspect);
    const best = pickBestClip(clips, beatDuration);
    if (best) {
      return {
        beatId: beat.id,
        tier: 2,
        url: best.url,
        duration: best.durationSeconds || beatDuration,
        type: best.kind === 'video' ? 'video' : 'image',
        cost: 0,
        provider: best.provider,
        width: best.width,
        height: best.height,
      };
    }
  }

  // Tier 3 — any existing still that matches.
  if (!wantsUi) {
    const still = pickStill(assetIndex, query, ['image', 'screenshot', 'graphic']);
    if (still) return still;
  }

  return null;
}

function pickStill(
  assetIndex: AssetIndex,
  query: string,
  kinds: ('image' | 'screenshot' | 'graphic')[],
): ResolvedAsset | null {
  const matches = queryAssetIndex(assetIndex, query, { kinds });
  if (!matches.length) return null;
  const best = matches[0].asset;
  return {
    beatId: '',
    tier: 3,
    url: best.url,
    duration: 0,
    type: best.kind === 'graphic' ? 'graphic' : 'image',
    cost: 0,
    provider: best.source,
    width: best.width,
    height: best.height,
  };
}

function usesRealWorldImagery(beat: FacelessBeat): boolean {
  return (
    beat.visualType === 'broll_stock' ||
    beat.visualType === 'image_archive' ||
    beat.visualType === 'broll_generated' ||
    beat.visualType === 'mixed'
  );
}

/**
 * A clip that comfortably covers the beat is worth more than a closer textual
 * match that runs out halfway through it, because a shortfall becomes a loop
 * the viewer can see.
 */
function pickBestClip(clips: StockClip[], beatDuration: number): StockClip | null {
  if (!clips.length) return null;
  const covering = clips.filter((clip) => !clip.durationSeconds || clip.durationSeconds >= beatDuration);
  return (covering.length ? covering : clips)[0];
}

/** selectAssets returns stills without a beat id; the caller stamps it. */
export function stampBeatId(asset: ResolvedAsset | null, beatId: string): ResolvedAsset | null {
  return asset ? { ...asset, beatId } : null;
}
