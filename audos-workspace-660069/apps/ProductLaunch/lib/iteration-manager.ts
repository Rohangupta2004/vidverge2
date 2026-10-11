// iteration-manager — loop control.
//
// Every render costs real money and real minutes, so the decision to spend
// another one is made here and nowhere else. The threshold exists because a
// critic will almost always find SOMETHING: the question is never 'is this
// perfect' but 'is the next render likely to move the score enough to be worth
// paying for'.

import type { CriticOutput } from '../types/critic.types';

export const IMPROVEMENT_THRESHOLD = 0.08;   // stop if delta < this
export const MAX_ITERATIONS = 3;

/** At or above this, with nothing critical outstanding, the film ships. */
export const GOOD_ENOUGH_SCORE = 0.75;

export interface IterationDecision {
  shouldContinue: boolean;
  reason: string;
}

export function shouldContinueIteration(
  critic: CriticOutput,
  iteration: number,
): IterationDecision {
  if (critic.shippable) return { shouldContinue: false, reason: 'shippable' };
  if (iteration >= MAX_ITERATIONS) return { shouldContinue: false, reason: 'max_iterations_reached' };
  if (!critic.recommend_another_iteration) {
    return { shouldContinue: false, reason: critic.stop_reason ?? 'critic_says_stop' };
  }
  if (critic.improvement_delta !== null && critic.improvement_delta < IMPROVEMENT_THRESHOLD) {
    return { shouldContinue: false, reason: 'marginal_gain_below_threshold' };
  }
  // Only critical issues force another iteration if delta is borderline
  const hasCriticalIssues = critic.scene_assessments.some((s) => s.fix_priority === 'critical')
    || critic.film_level_issues.some((i) => i.priority === 'critical');
  if (!hasCriticalIssues && critic.overall_score >= GOOD_ENOUGH_SCORE) {
    return { shouldContinue: false, reason: 'good_enough_no_critical_issues' };
  }
  return { shouldContinue: true, reason: 'continuing_iteration' };
}

/**
 * A reason code turned into the sentence shown beside the final video. The
 * creator should always be able to see WHY the loop stopped where it did.
 */
export function explainDecision(reason: string): string {
  if (reason === 'shippable') return 'The critic marked this cut shippable.';
  if (reason === 'max_iterations_reached') {
    return 'Stopped at the ' + String(MAX_ITERATIONS) + '-iteration ceiling.';
  }
  if (reason === 'marginal_gain_below_threshold' || reason === 'marginal_gain_too_low') {
    return 'The last revision moved the score by less than '
      + String(IMPROVEMENT_THRESHOLD) + ', so another render would not pay for itself.';
  }
  if (reason === 'good_enough_no_critical_issues') {
    return 'Scored above ' + String(GOOD_ENOUGH_SCORE) + ' with nothing critical outstanding.';
  }
  if (reason === 'fundamental_concept_issue') {
    return 'The critic judged this a concept problem rather than an execution one — '
      + 'another render of the same concept would not fix it.';
  }
  if (reason === 'critic_says_stop') return 'The critic did not recommend another iteration.';
  if (reason === 'continuing_iteration') return 'Revising and re-rendering.';
  return reason;
}

/**
 * The delta for this pass. Null on the first iteration — and a null must never
 * be coerced to zero, which would read as 'no improvement' and stop the loop
 * before it had run twice.
 */
export function computeDelta(current: number, previous: number | null): number | null {
  if (previous === null || previous === undefined) return null;
  return Math.round((current - previous) * 1000) / 1000;
}

export interface IterationRecord {
  iteration: number;
  videoUrl: string;
  critic: CriticOutput;
  decision: IterationDecision;
}

/** The best cut seen so far — a revision is allowed to score WORSE than its parent. */
export function bestIteration(history: IterationRecord[]): IterationRecord | null {
  let best: IterationRecord | null = null;
  for (const record of history) {
    if (!best || record.critic.overall_score > best.critic.overall_score) best = record;
  }
  return best;
}
