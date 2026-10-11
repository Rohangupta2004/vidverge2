/**
 * STAGE 6b — generateAssets.
 *
 * Walks the waves the visual plan produced. Inside a wave, beats run in
 * parallel because nothing in it depends on anything else in it. Between
 * waves, the pipeline WAITS — a match-cut beat has to see the frame it is
 * matching before it can be generated, and a blanket parallel fan-out is
 * exactly how a match cut turns into two unrelated shots that happen to be
 * adjacent.
 *
 * Failure policy, in order of preference:
 *   tier 5 fails → fall back to a generated still (the beat survives, cheaper)
 *   tier 4 fails → leave the beat unresolved and say so; the composition
 *                  renders a branded motion card rather than a black frame,
 *                  and creative QA will see it.
 * One dead provider should cost a beat, never the film.
 */

import type {
  AspectId,
  AssetIndex,
  EditorialTimeline,
  FacelessBeat,
  ResolvedAsset,
  VisualPlan,
} from '../types/editorial';
import { selectAssets, stampBeatId } from './selectAssets';
import { generateImageAsset, styleSuffixFrom } from './generateImage';
import { generateVideoAsset } from './generateVideo';
import { stillPromptFrom } from './createVisualPlan';
import { saveGeneratedAsset } from '../lib/filmStore';
import { aspectOf } from '../lib/facelessOptions';

/** Generations in flight at once. High enough to be quick, low enough not to trip the proxy rate limiter. */
const WAVE_CONCURRENCY = 4;

export interface GenerateAssetsInput {
  timeline: EditorialTimeline;
  visualPlan: VisualPlan;
  assetIndex: AssetIndex;
  /** Landscape unless the brief asked for portrait. Reaches every provider. */
  aspect?: AspectId;
  onNote?: (note: string) => void;
  onProgress?: (done: number, total: number) => void;
}

export interface GenerateAssetsResult {
  resolved: Record<string, ResolvedAsset>;
  spend: number;
  unresolved: string[];
  notes: string[];
}

export async function generateAssets(input: GenerateAssetsInput): Promise<GenerateAssetsResult> {
  const { timeline, visualPlan, assetIndex } = input;
  const beats = new Map(timeline.beats.map((beat) => [beat.id, beat]));
  const styleSuffix = styleSuffixFrom(timeline.continuityGuide, input.aspect);

  const resolved: Record<string, ResolvedAsset> = {};
  const notes: string[] = [];
  const unresolved: string[] = [];
  let done = 0;
  const total = timeline.beats.length;

  for (let waveIndex = 0; waveIndex < visualPlan.waves.length; waveIndex += 1) {
    const wave = visualPlan.waves[waveIndex];
    if (waveIndex > 0) {
      input.onNote?.(`Wave ${waveIndex + 1}: ${wave.length} match-cut beat(s) waiting on the shot they align to…`);
    } else {
      input.onNote?.(`Sourcing ${wave.length} independent beats…`);
    }

    const queue = wave.slice();
    const workers = Array.from({ length: Math.min(WAVE_CONCURRENCY, queue.length) }, async () => {
      for (;;) {
        const beatId = queue.shift();
        if (!beatId) return;
        const beat = beats.get(beatId);
        if (!beat) return;

        const outcome = await resolveBeat(timeline.filmId, beat, assetIndex, styleSuffix, resolved, input.aspect);
        if (outcome.asset) resolved[beatId] = outcome.asset;
        else unresolved.push(beatId);
        if (outcome.note) notes.push(outcome.note);

        done += 1;
        input.onProgress?.(done, total);
      }
    });
    await Promise.all(workers);
  }

  return {
    resolved,
    spend: round2(Object.values(resolved).reduce((sum, asset) => sum + (asset.cost || 0), 0)),
    unresolved,
    notes,
  };
}

async function resolveBeat(
  filmId: string,
  beat: FacelessBeat,
  assetIndex: AssetIndex,
  styleSuffix: string,
  alreadyResolved: Record<string, ResolvedAsset>,
  aspect?: AspectId,
): Promise<{ asset: ResolvedAsset | null; note?: string }> {
  const beatSeconds = beat.narrationEnd - beat.narrationStart;

  // Tiers 1–3 first, always. Even a beat the director marked tier 4 gets one
  // look at what the workspace already owns — free and on-brand beats paid.
  if (beat.assetDecision.tier <= 3) {
    try {
      const selected = stampBeatId(await selectAssets({ beat, assetIndex, aspect }), beat.id);
      if (selected) return { asset: selected };
    } catch (error: any) {
      return {
        asset: await generateFallbackStill(filmId, beat, styleSuffix, aspect),
        note: `Beat ${beat.id}: the tier ${beat.assetDecision.tier} search failed (${short(error)}), so it was generated as a still instead.`,
      };
    }
    // Nothing suitable existed. That is exactly what tier 4 is for.
    return {
      asset: await generateFallbackStill(filmId, beat, styleSuffix, aspect),
      note: `Beat ${beat.id}: nothing in the workspace or stock matched, so it fell through to a generated still.`,
    };
  }

  if (beat.assetDecision.tier === 5) {
    const reference = matchCutReference(beat, alreadyResolved);
    try {
      const prompt = beat.assetDecision.generationPrompt || beat.visualIntent;
      const asset = await generateVideoAsset(beat.id, prompt, {
        durationSeconds: beatSeconds,
        styleSuffix,
        aspect,
        referenceImageUrl: reference,
      });
      return { asset: await persistGenerated(filmId, beat, asset, prompt) };
    } catch (error: any) {
      const still = await generateFallbackStill(filmId, beat, styleSuffix, aspect);
      return {
        asset: still,
        note: `Beat ${beat.id}: AI video failed (${short(error)}), so the beat shipped as a generated still with its camera move intact.`,
      };
    }
  }

  return { asset: await generateFallbackStill(filmId, beat, styleSuffix, aspect) };
}

async function generateFallbackStill(
  filmId: string,
  beat: FacelessBeat,
  styleSuffix: string,
  aspect?: AspectId,
): Promise<ResolvedAsset | null> {
  const prompt = beat.assetDecision.generationPrompt
    || stillPromptFrom(undefined, beat.visualIntent);
  try {
    const asset = await generateImageAsset(beat.id, prompt, {
      styleSuffix,
      aspectRatio: aspectOf(aspect).providerRatio,
    });
    return await persistGenerated(filmId, beat, asset, prompt);
  } catch {
    // Unresolved on purpose: the composition draws a branded motion card for
    // this beat, which is a readable frame rather than a hole in the film.
    return null;
  }
}

async function persistGenerated(
  filmId: string,
  beat: FacelessBeat,
  asset: ResolvedAsset,
  prompt: string,
): Promise<ResolvedAsset> {
  try {
    await saveGeneratedAsset({ filmId, beat, asset, prompt });
  } catch (error) {
    // The media itself is already paid for and usable. A catalog write failure
    // must not discard it or make the whole film fail.
    console.warn(`[Faceless] could not index generated asset for beat ${beat.id}:`, error);
  }
  return asset;
}

/**
 * The source beat's resolved frame, handed to the video model as a reference
 * so the two halves of a match cut share geometry. Only a still works as a
 * reference image; a source beat that is itself a clip has no single frame to
 * offer here, and the composition's continuous camera carries the cut instead.
 */
function matchCutReference(beat: FacelessBeat, resolved: Record<string, ResolvedAsset>): string | undefined {
  const dependency = beat.assetDecision.matchCutDependencyBeatId;
  if (!dependency) return undefined;
  const source = resolved[dependency];
  return source && source.type === 'image' ? source.url : undefined;
}

function short(error: unknown): string {
  return String((error as any)?.message || error || 'unknown error').slice(0, 140);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
