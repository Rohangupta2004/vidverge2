/**
 * STAGE 5 — createVisualPlan.
 *
 * The last stop before money is spent. Three jobs, in this order:
 *
 *   1. NOVELTY. Score every beat against the ones around it and force a visual
 *      deviation wherever a rolling five-beat window flattens out. Doing this
 *      before dispatch is the point — scoring after generation means paying
 *      for the shot you then throw away.
 *   2. COST. The tier hierarchy is a margin rule as much as a craft rule. AI
 *      video is ~$0.40 a clip against ~$0.05 for a generated still, so a
 *      timeline that came back more than 40% tier 5, or over the film's
 *      budget, gets its lowest-impact tier 5 beats downgraded to tier 4.
 *   3. THE MATCH-CUT DAG. A beat that must align geometrically with another
 *      cannot be generated beside it. Beats are sorted into ordered waves:
 *      everything inside a wave is safe to run in parallel, and a wave never
 *      starts until the one before it has resolved.
 */

import type {
  AssetTask,
  AssetTier,
  EditorialTimeline,
  FacelessBeat,
  TierDowngrade,
  VisualPlan,
  VisualType,
} from '../types/editorial';
import { deviateFrom } from './createEditorialTimeline';

/** USD per asset, per tier. Tiers 1–3 are already paid for or free. */
export const TIER_COST: Record<AssetTier, number> = { 1: 0, 2: 0, 3: 0, 4: 0.05, 5: 0.4 };

/** A 60-second film targets under $4.00 of generation. */
export const BUDGET_PER_60S = 4.0;

export const MAX_TIER5_SHARE = 0.4;

const NOVELTY_WINDOW = 5;
const NOVELTY_FLOOR = 0.3;

export function createVisualPlan(timeline: EditorialTimeline): VisualPlan {
  const beats = timeline.beats.map((beat) => ({ ...beat }));

  const noveltyDeviations = applyNoveltyFloor(beats, timeline);
  const noveltyScores = scoreAll(beats);
  beats.forEach((beat) => {
    beat.visualNoveltyScore = noveltyScores[beat.id];
  });

  const downgrades = enforceCost(beats, timeline.duration);
  const waves = resolveMatchCutWaves(beats);

  const waveIndex = new Map<string, number>();
  waves.forEach((wave, index) => wave.forEach((beatId) => waveIndex.set(beatId, index)));

  const tasks: AssetTask[] = beats.map((beat) => ({
    beatId: beat.id,
    tier: beat.assetDecision.tier,
    wave: waveIndex.get(beat.id) ?? 0,
    dependsOnBeatId: beat.assetDecision.matchCutDependencyBeatId,
    visualType: beat.visualType,
    searchQuery: beat.assetDecision.searchQuery,
    generationPrompt: beat.assetDecision.generationPrompt,
    estimatedCost: TIER_COST[beat.assetDecision.tier],
  }));

  return {
    filmId: timeline.filmId,
    tasks,
    waves,
    noveltyScores,
    noveltyDeviations,
    downgrades,
    estimatedCost: round2(tasks.reduce((sum, task) => sum + task.estimatedCost, 0)),
    tierMix: tierMix(beats),
  };
}

/** The beats as the plan left them — novelty deviations and tier downgrades applied. */
export function applyPlanToTimeline(timeline: EditorialTimeline, plan: VisualPlan): EditorialTimeline {
  const byId = new Map(plan.tasks.map((task) => [task.beatId, task]));
  const deviations = new Map(plan.noveltyDeviations.map((entry) => [entry.beatId, entry.to]));
  return {
    ...timeline,
    beats: timeline.beats.map((beat) => {
      const task = byId.get(beat.id);
      return {
        ...beat,
        visualType: deviations.get(beat.id) || beat.visualType,
        visualNoveltyScore: plan.noveltyScores[beat.id],
        assetDecision: task ? { ...beat.assetDecision, tier: task.tier } : beat.assetDecision,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Novelty
// ---------------------------------------------------------------------------

/**
 * Novelty is how different a beat is from the three before it, across the
 * three axes a viewer actually notices: what kind of visual it is, how the
 * camera moves, and whether the described image is the same idea again.
 */
export function noveltyScore(beat: FacelessBeat, previous: FacelessBeat[]): number {
  const recent = previous.slice(-3);
  if (!recent.length) return 1;

  const typeRepeats = recent.filter((other) => other.visualType === beat.visualType).length;
  const typeScore = 1 - typeRepeats / recent.length;

  const cameraRepeats = recent.filter((other) => other.camera.type === beat.camera.type).length;
  const cameraScore = 1 - (cameraRepeats / recent.length) * 0.6;

  const intentScore = 1 - Math.max(...recent.map((other) => intentOverlap(beat.visualIntent, other.visualIntent)));

  return round2(Math.max(0, Math.min(1, typeScore * 0.5 + cameraScore * 0.2 + intentScore * 0.3)));
}

function intentOverlap(a: string, b: string): number {
  const tokens = (value: string) =>
    new Set(
      String(value || '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length > 3),
    );
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  left.forEach((token) => {
    if (right.has(token)) shared += 1;
  });
  return shared / Math.min(left.size, right.size);
}

function scoreAll(beats: FacelessBeat[]): Record<string, number> {
  const scores: Record<string, number> = {};
  beats.forEach((beat, index) => {
    scores[beat.id] = noveltyScore(beat, beats.slice(0, index));
  });
  return scores;
}

/**
 * Walks every five-beat window. When one averages below the floor the film has
 * gone visually flat, so the weakest beat in that window is pushed onto a
 * different visual type and the window is rescored before moving on.
 */
function applyNoveltyFloor(
  beats: FacelessBeat[],
  timeline: EditorialTimeline,
): VisualPlan['noveltyDeviations'] {
  const deviations: VisualPlan['noveltyDeviations'] = [];
  if (beats.length < NOVELTY_WINDOW) return deviations;

  for (let start = 0; start + NOVELTY_WINDOW <= beats.length; start += 1) {
    let scores = scoreAll(beats);
    const window = beats.slice(start, start + NOVELTY_WINDOW);
    const average = window.reduce((sum, beat) => sum + scores[beat.id], 0) / NOVELTY_WINDOW;
    if (average >= NOVELTY_FLOOR) continue;

    // The hook is never the beat we rewrite: it is the one beat whose visual
    // was chosen under the strictest constraints in the whole film.
    const candidates = window.filter((beat) => !beat.isHook);
    if (!candidates.length) continue;
    const weakest = candidates.reduce((worst, beat) => (scores[beat.id] < scores[worst.id] ? beat : worst));
    const from: VisualType = weakest.visualType;
    const to = deviateFrom(from, timeline.mode);
    if (to === from) continue;

    weakest.visualType = to;
    deviations.push({
      beatId: weakest.id,
      from,
      to,
      reason: `Beats ${start + 1}–${start + NOVELTY_WINDOW} averaged ${average.toFixed(2)} novelty, below the ${NOVELTY_FLOOR} floor.`,
    });
    scores = scoreAll(beats);
  }

  return deviations;
}

// ---------------------------------------------------------------------------
// Cost enforcement
// ---------------------------------------------------------------------------

/**
 * Lowest impact first: never the hook, never a reveal or an emotional beat,
 * shortest beats before longer ones. A two-second beat loses almost nothing by
 * becoming an animated still; a six-second reveal does.
 */
function impactRank(beat: FacelessBeat): number {
  if (beat.isHook) return 1000;
  const purposeWeight =
    beat.narrativePurpose === 'reveal' ? 300 :
    beat.narrativePurpose === 'emotion' ? 220 :
    beat.narrativePurpose === 'contrast' ? 160 : 0;
  const seconds = beat.narrationEnd - beat.narrationStart;
  return purposeWeight + seconds * 10;
}

export function enforceCost(beats: FacelessBeat[], duration: number): TierDowngrade[] {
  const downgrades: TierDowngrade[] = [];
  const budget = Math.max(1.5, (duration / 60) * BUDGET_PER_60S);

  const tier5 = () => beats.filter((beat) => beat.assetDecision.tier === 5);
  const spend = () => beats.reduce((sum, beat) => sum + TIER_COST[beat.assetDecision.tier], 0);
  const nextToDowngrade = () =>
    tier5()
      .slice()
      .sort((a, b) => impactRank(a) - impactRank(b))[0];

  // Rule 1: AI video is never more than 40% of the film.
  const maxTier5 = Math.floor(beats.length * MAX_TIER5_SHARE);
  while (tier5().length > maxTier5) {
    const beat = nextToDowngrade();
    if (!beat) break;
    downgrades.push(downgrade(beat, `AI video was ${tier5().length} of ${beats.length} beats, over the ${Math.round(MAX_TIER5_SHARE * 100)}% ceiling.`));
  }

  // Rule 2: the film still has to come in under budget.
  while (spend() > budget && tier5().length) {
    const beat = nextToDowngrade();
    if (!beat) break;
    downgrades.push(downgrade(beat, `Estimated spend $${spend().toFixed(2)} was over the $${budget.toFixed(2)} budget for a ${Math.round(duration)}s film.`));
  }

  return downgrades;
}

function downgrade(beat: FacelessBeat, reason: string): TierDowngrade {
  const from = beat.assetDecision.tier;
  beat.assetDecision = {
    ...beat.assetDecision,
    tier: 4,
    // The generation prompt was written for a moving shot. Reframing it as a
    // single decisive frame is what makes the downgrade survivable.
    generationPrompt: stillPromptFrom(beat.assetDecision.generationPrompt, beat.visualIntent),
    rationale: `${beat.assetDecision.rationale} — downgraded to a generated still by cost enforcement: ${reason}`,
  };
  // A still needs a camera move to stay alive, so a static beat gets one.
  if (beat.camera.type === 'data_static') {
    beat.camera = { type: 'establishing_push', startScale: 1.0, endScale: 1.06, durationMs: beat.camera.durationMs };
  }
  return { beatId: beat.id, from, to: 4, reason };
}

export function stillPromptFrom(videoPrompt: string | undefined, visualIntent: string): string {
  const base = String(videoPrompt || visualIntent || '').trim();
  const stripped = base.replace(/\b(slow motion|camera (pans?|pushes?|tracks?|dollies)|moving|motion|animated|timelapse)\b/gi, '').replace(/\s{2,}/g, ' ').trim();
  return `${stripped || visualIntent}. A single decisive frame, composed to hold on screen while the camera moves across it.`.slice(0, 900);
}

// ---------------------------------------------------------------------------
// Match-cut DAG
// ---------------------------------------------------------------------------

/**
 * Kahn's algorithm over the dependency edges. Returns ordered waves: beats in
 * the same wave have no dependency on each other and may be dispatched in
 * parallel; a later wave waits for the earlier one because its asset has to be
 * generated to match a frame that does not exist yet.
 */
export function resolveMatchCutWaves(beats: FacelessBeat[]): string[][] {
  const ids = new Set(beats.map((beat) => beat.id));
  const dependency = new Map<string, string | null>();
  beats.forEach((beat) => {
    const dep = beat.assetDecision.matchCutDependencyBeatId;
    dependency.set(beat.id, dep && ids.has(dep) && dep !== beat.id ? dep : null);
  });

  const waves: string[][] = [];
  const placed = new Set<string>();
  let remaining = beats.map((beat) => beat.id);

  while (remaining.length) {
    const wave = remaining.filter((id) => {
      const dep = dependency.get(id);
      return !dep || placed.has(dep);
    });
    if (!wave.length) {
      // A cycle can only come from a malformed plan. Rather than deadlock, the
      // remaining beats are released as one wave and their dependencies are
      // dropped — a weaker match cut beats a pipeline that never dispatches.
      remaining.forEach((id) => dependency.set(id, null));
      waves.push(remaining.slice());
      break;
    }
    wave.forEach((id) => placed.add(id));
    waves.push(wave);
    remaining = remaining.filter((id) => !placed.has(id));
  }

  return waves;
}

// ---------------------------------------------------------------------------

function tierMix(beats: FacelessBeat[]): Record<AssetTier, number> {
  const mix = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<AssetTier, number>;
  beats.forEach((beat) => {
    mix[beat.assetDecision.tier] += 1;
  });
  return mix;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
