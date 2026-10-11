/**
 * STAGE 10 — validateFilmSpec.
 *
 * Everything checkable before a frame is paid for. A render takes minutes and
 * costs money, so a missing URL or a timeline that does not add up should be
 * caught here, not discovered in mechanical QA.
 *
 * Errors block the render. Warnings do not: a film with one unresolved beat
 * is still worth making, and the branded motion card the composition draws in
 * its place is a readable frame that creative QA can judge.
 */

import type { FilmSpec, ValidationIssue, ValidationResult } from '../types/editorial';

/** The render service is pinned to 30fps, so a frame is 33ms; a tenth of a second is the useful tolerance. */
const DURATION_TOLERANCE = 0.1;

export function validateFilmSpec(spec: FilmSpec): ValidationResult {
  const issues: ValidationIssue[] = [];
  const { timeline, motionPlan, resolvedAssets } = spec;

  if (!/^https?:\/\//i.test(spec.narrationUrl)) {
    issues.push({ code: 'narration_url', message: 'The narration URL is not a usable address.', severity: 'error' });
  }
  if (!spec.narrationTimestamps.length) {
    issues.push({ code: 'no_timestamps', message: 'The spec carries no word timestamps, so nothing can be verified against the narration.', severity: 'error' });
  }

  // Beats must tile the narration exactly. A gap renders as a hole and an
  // overlap renders as two shots fighting over the same second of speech.
  let cursor = 0;
  timeline.beats.forEach((beat, index) => {
    if (Math.abs(beat.narrationStart - cursor) > DURATION_TOLERANCE) {
      issues.push({
        code: 'beat_discontinuity',
        beatId: beat.id,
        message: `Beat ${index} starts at ${beat.narrationStart.toFixed(2)}s but the previous beat ended at ${cursor.toFixed(2)}s.`,
        severity: 'error',
      });
    }
    if (beat.narrationEnd <= beat.narrationStart) {
      issues.push({ code: 'beat_zero_length', beatId: beat.id, message: `Beat ${beat.id} has no duration.`, severity: 'error' });
    }
    cursor = beat.narrationEnd;
  });

  if (Math.abs(cursor - timeline.duration) > DURATION_TOLERANCE) {
    issues.push({
      code: 'duration_mismatch',
      message: `The beats total ${cursor.toFixed(2)}s against a ${timeline.duration.toFixed(2)}s narration.`,
      severity: 'error',
    });
  }

  // Every beat needs a motion-plan shot; an asset is allowed to be missing.
  const shotIds = new Set(motionPlan.shots.map((shot) => shot.beatId));
  timeline.beats.forEach((beat) => {
    if (!shotIds.has(beat.id)) {
      issues.push({ code: 'missing_motion', beatId: beat.id, message: `Beat ${beat.id} has no motion-plan entry.`, severity: 'error' });
    }
    const asset = resolvedAssets[beat.id];
    if (!asset) {
      issues.push({
        code: 'unresolved_asset',
        beatId: beat.id,
        message: `Beat ${beat.id} resolved to no media and will render as a branded motion card.`,
        severity: 'warning',
      });
    } else if (!/^https?:\/\//i.test(asset.url)) {
      issues.push({ code: 'bad_asset_url', beatId: beat.id, message: `Beat ${beat.id} has an unusable asset URL.`, severity: 'error' });
    }
  });

  motionPlan.shots.forEach((shot) => {
    if (shot.durationFrames < 2) {
      issues.push({ code: 'shot_too_short', beatId: shot.beatId, message: `Shot ${shot.beatId} is under two frames long.`, severity: 'error' });
    }
    if (shot.transitionOut && !shot.transitionOut.type) {
      issues.push({ code: 'undefined_transition', beatId: shot.beatId, message: `Shot ${shot.beatId} has a transition with no type.`, severity: 'error' });
    }
    if (shot.transitionOut?.type === 'match_cut' && !shot.transitionOut.destinationElement) {
      issues.push({
        code: 'match_cut_incomplete',
        beatId: shot.beatId,
        message: `Shot ${shot.beatId} declares a match cut without naming the element the next shot matches.`,
        severity: 'warning',
      });
    }
  });

  const planFrames = motionPlan.durationInFrames;
  const expectedFrames = Math.round(timeline.duration * motionPlan.fps);
  if (Math.abs(planFrames - expectedFrames) > motionPlan.fps * DURATION_TOLERANCE) {
    issues.push({
      code: 'frame_count_mismatch',
      message: `The motion plan is ${planFrames} frames against ${expectedFrames} expected from the narration.`,
      severity: 'error',
    });
  }

  return { ok: !issues.some((issue) => issue.severity === 'error'), issues };
}

export function describeValidation(result: ValidationResult): string {
  if (result.ok && !result.issues.length) return 'Spec validated clean.';
  const errors = result.issues.filter((issue) => issue.severity === 'error');
  const warnings = result.issues.filter((issue) => issue.severity === 'warning');
  if (errors.length) return `Spec invalid: ${errors.map((issue) => issue.message).join(' ')}`;
  return `Spec valid with ${warnings.length} warning(s): ${warnings.map((issue) => issue.message).join(' ')}`;
}
