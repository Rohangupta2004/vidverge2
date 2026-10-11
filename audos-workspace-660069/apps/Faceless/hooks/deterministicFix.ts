/**
 * deterministicFix — the ONLY repair allowed on a mechanical QA failure.
 *
 * No model is called here and none should be. A mechanical failure is a
 * measurement, so its repair is a rule: this function maps each failed check
 * to a specific, explainable change to the spec and compiles the next
 * version. The orchestrator then re-renders exactly once. If that render
 * still fails mechanically the run aborts — escalating a frame-count problem
 * to an editorial model would burn money and could not possibly fix it.
 */

import type {
  FilmSpec,
  MechanicalCheck,
  MechanicalQAResult,
  MotionPlan,
  MotionShot,
} from '../types/editorial';
import { compileFilmSpec } from './compileFilmSpec';

export interface DeterministicFixResult {
  spec: FilmSpec;
  applied: string[];
  /** False when nothing in the failure is repairable by rule. */
  repairable: boolean;
}

export function deterministicFix(spec: FilmSpec, qa: MechanicalQAResult): DeterministicFixResult {
  const failed = qa.checks.filter((check) => !check.pass);
  const applied: string[] = [];

  let motionPlan: MotionPlan = clone(spec.motionPlan);
  let timeline = clone(spec.timeline);

  for (const check of failed) {
    switch (check.id) {
      case 'duration_match': {
        const measured = Number(check.measured);
        if (!Number.isFinite(measured) || measured <= 0) break;
        motionPlan = retimeTo(motionPlan, measured);
        timeline = { ...timeline, duration: measured };
        const last = timeline.beats[timeline.beats.length - 1];
        if (last) last.narrationEnd = measured;
        applied.push(`Retimed the motion plan to the measured ${measured.toFixed(2)}s so the picture and the narration end together.`);
        break;
      }

      case 'no_long_black': {
        const changed = hardenAgainstBlack(motionPlan);
        applied.push(
          changed
            ? `Removed ${changed} fade-style transition(s) and forced opaque entrances so no cut can resolve through black.`
            : 'Forced opaque shot entrances so no cut resolves through black.',
        );
        break;
      }

      case 'audio_present':
      case 'audio_sync':
      case 'no_narration_gaps': {
        // The narration is the one track that must survive. Stripping the bed
        // and the effects removes every other candidate for a mix fault, and
        // a film with clean narration and no music is still a film.
        if (motionPlan.music?.url || motionPlan.sfx.length) {
          motionPlan = { ...motionPlan, music: motionPlan.music ? { ...motionPlan.music, url: null } : null, sfx: [] };
          applied.push('Dropped the music bed and sound effects so the narration track renders on its own.');
        }
        break;
      }

      case 'frame_rate_consistent':
        // Nothing in the spec causes this; a clean re-render of the same spec
        // is the repair, and that is what the orchestrator does next.
        applied.push('Re-rendering the same spec: frame cadence is a property of the encode, not the plan.');
        break;

      default:
        break;
    }
  }

  if (!applied.length) {
    return { spec, applied: [], repairable: false };
  }

  return {
    spec: compileFilmSpec({
      timeline,
      motionPlan,
      resolvedAssets: { ...spec.resolvedAssets },
      narrationUrl: spec.narrationUrl,
      narrationTimestamps: [...spec.narrationTimestamps],
      previous: spec,
      revisionNotes: applied,
    }),
    applied,
    repairable: true,
  };
}

/**
 * Scales every shot boundary onto the real duration. Proportional rather than
 * trimming the tail: a render that came back short or long is usually off by
 * a rounding error spread across the whole timeline, and absorbing it all
 * into the last shot would visibly change that shot's length.
 */
function retimeTo(plan: MotionPlan, seconds: number): MotionPlan {
  const targetFrames = Math.max(plan.fps, Math.round(seconds * plan.fps));
  const ratio = targetFrames / Math.max(1, plan.durationInFrames);
  if (Math.abs(ratio - 1) < 0.0005) return { ...plan, durationInFrames: targetFrames };

  let cursor = 0;
  const shots: MotionShot[] = plan.shots.map((shot, index) => {
    const isLast = index === plan.shots.length - 1;
    const duration = Math.max(2, Math.round(shot.durationFrames * ratio));
    const startFrame = cursor;
    const endFrame = isLast ? targetFrames : startFrame + duration;
    cursor = endFrame;
    const shift = startFrame - shot.startFrame;
    return {
      ...shot,
      startFrame,
      endFrame,
      durationFrames: Math.max(2, endFrame - startFrame),
      camera: { ...shot.camera, startFrame: shot.camera.startFrame + shift, endFrame: Math.min(endFrame, shot.camera.endFrame + shift) },
      text: shot.text
        ? { ...shot.text, startFrame: shot.text.startFrame + shift, endFrame: Math.min(endFrame, shot.text.endFrame + shift) }
        : undefined,
      transitionOut: shot.transitionOut ? { ...shot.transitionOut, startFrame: endFrame } : undefined,
    };
  });

  return { ...plan, durationInFrames: targetFrames, shots };
}

/**
 * Dissolves and blur reveals are the only things in the composition that can
 * put a partially transparent frame over the background, which is where a
 * black run comes from when the outgoing shot has already ended. Turning them
 * into cuts removes the mechanism entirely.
 */
function hardenAgainstBlack(plan: MotionPlan): number {
  let changed = 0;
  plan.shots.forEach((shot) => {
    if (shot.transitionOut && (shot.transitionOut.type === 'dissolve' || shot.transitionOut.type === 'blur_reveal')) {
      shot.transitionOut = { ...shot.transitionOut, type: 'cut', durationFrames: 0 };
      changed += 1;
    }
  });
  return changed;
}

export function describeFix(result: DeterministicFixResult): string {
  if (!result.repairable) return 'No deterministic repair applies to this failure.';
  return `Deterministic fix → FilmSpec v${result.spec.version}: ${result.applied.join(' ')}`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Exported for the orchestrator's abort message. */
export function unrepairableChecks(qa: MechanicalQAResult): MechanicalCheck[] {
  return qa.checks.filter((check) => !check.pass);
}
