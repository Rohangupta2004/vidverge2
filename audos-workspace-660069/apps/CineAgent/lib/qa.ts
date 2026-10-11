// CineAgent — quality assurance on the ACTUAL rendered file.
//
// Two layers, different failure paths:
//   mechanical — measured in the browser: the file loads, plays, and its
//     duration matches the plan. A mechanical failure is an execution bug,
//     not a taste call, so it never goes to a model.
//   creative  — Claude Opus vision reads real frames of the finished render
//     against the plan it wrote and names concrete defects with fixes.

import type { EditPlan, QAReport, RenderPlan } from './types';
import { extractFrames, measureVideo } from './platform';
import { reviewCut } from './director';
import { computeTiming } from './plan';

export async function runQA(
  outputUrl: string,
  plan: EditPlan,
  renderPlan: RenderPlan,
  attempt: number,
  onNote: (note: string) => void,
): Promise<QAReport> {
  // --- mechanical ------------------------------------------------------------
  const expected = computeTiming(plan).duration;
  let measuredDuration = 0;
  let playable = false;
  try {
    const measured = await measureVideo(outputUrl);
    measuredDuration = measured.duration;
    playable = measured.duration > 0.5 && measured.width > 0;
  } catch {
    playable = false;
  }
  const durationOk = playable && Math.abs(measuredDuration - expected) <= Math.max(1.5, expected * 0.03);
  if (!playable) {
    return {
      attempt,
      score: 0,
      shippable: false,
      summary: 'The rendered file could not be loaded or has no video stream.',
      defects: [{ severity: 'critical', where: 'file', issue: 'Output is not playable', action: 'retime' }],
      mechanical: { durationOk: false, playable: false, measuredDuration, expectedDuration: expected },
    };
  }
  onNote('Mechanical check: ' + measuredDuration.toFixed(1) + 's rendered (expected ' + expected.toFixed(1) + 's).');

  // --- creative --------------------------------------------------------------
  // Sample frames across the cut, biased toward overlay midpoints (where
  // graphics can go wrong) and the ending.
  const samples = new Set<number>();
  const n = Math.min(10, Math.max(6, Math.round(measuredDuration / 20)));
  for (let i = 0; i < n; i += 1) samples.add(round1((measuredDuration * (i + 0.5)) / n));
  plan.overlays.slice(0, 6).forEach((o) => samples.add(round1(Math.min(measuredDuration - 0.2, o.at + o.duration / 2))));
  samples.add(round1(Math.max(0.2, measuredDuration - 1)));
  const timestamps = [...samples].filter((t) => t >= 0 && t < measuredDuration).sort((a, b) => a - b).slice(0, 16);

  let frames: { t: number; url: string }[] = [];
  try {
    const extracted = await extractFrames(outputUrl, timestamps);
    frames = extracted.map((f) => ({ t: f.timestamp, url: f.url }));
  } catch {
    frames = [];
  }
  if (!frames.length) {
    // Vision review impossible — ship on mechanical health alone, honestly noted.
    return {
      attempt,
      score: durationOk ? 0.7 : 0.4,
      shippable: durationOk,
      summary: 'Frames could not be extracted for visual review; the file is playable'
        + (durationOk ? ' and the duration matches the plan.' : ' but the duration is off.'),
      defects: durationOk ? [] : [{ severity: 'major', where: 'file', issue: 'Duration mismatch', action: 'retime' }],
      mechanical: { durationOk, playable, measuredDuration, expectedDuration: expected },
    };
  }

  onNote('Reviewing ' + frames.length + ' frames of the finished cut…');
  const verdict = await reviewCut(frames, plan, { duration: measuredDuration, expected });
  const criticals = verdict.defects.filter((d) => d.severity === 'critical');
  return {
    attempt,
    score: verdict.score,
    shippable: verdict.shippable && durationOk && criticals.length === 0,
    summary: verdict.summary,
    defects: durationOk ? verdict.defects : [
      { severity: 'major', where: 'file', issue: 'Rendered duration ' + measuredDuration.toFixed(1) + 's vs planned ' + expected.toFixed(1) + 's', action: 'retime' },
      ...verdict.defects,
    ],
    mechanical: { durationOk, playable, measuredDuration, expectedDuration: expected },
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
