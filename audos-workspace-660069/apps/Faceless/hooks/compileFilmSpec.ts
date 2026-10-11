/**
 * STAGE 9 — compileFilmSpec.
 *
 * The FilmSpec is the single source of truth that flows to the renderer and
 * to both QA stages. Nothing downstream of this point reads loose state: if a
 * value is not in the spec, the renderer does not see it.
 *
 * IMMUTABILITY IS ENFORCED, not merely intended. The returned object is deep
 * frozen, so a revision that tried to patch a beat in place would throw in
 * development rather than quietly produce a film that no longer matches the
 * spec it claims to be. Revisions call reviseFilm, which compiles a NEW spec
 * at version n+1 and leaves version n intact for comparison.
 */

import {
  FacelessError,
  type EditorialTimeline,
  type FilmSpec,
  type MotionPlan,
  type ResolvedAsset,
  type WordTimestamp,
} from '../types/editorial';

export interface CompileFilmSpecInput {
  timeline: EditorialTimeline;
  motionPlan: MotionPlan;
  resolvedAssets: Record<string, ResolvedAsset>;
  narrationUrl: string;
  narrationTimestamps: WordTimestamp[];
  /** Omit for v1. A revision passes the spec it is superseding. */
  previous?: FilmSpec | null;
  revisionNotes?: string[];
}

export function compileFilmSpec(input: CompileFilmSpecInput): FilmSpec {
  if (!input.narrationUrl) {
    throw new FacelessError('A FilmSpec cannot be compiled without narration.', 'compile', 'no_narration');
  }
  if (!input.timeline.beats.length) {
    throw new FacelessError('A FilmSpec cannot be compiled without beats.', 'compile', 'no_beats');
  }

  const spec: FilmSpec = {
    version: (input.previous?.version || 0) + 1,
    filmId: input.timeline.filmId,
    timeline: input.timeline,
    resolvedAssets: { ...input.resolvedAssets },
    motionPlan: input.motionPlan,
    narrationUrl: input.narrationUrl,
    narrationTimestamps: input.narrationTimestamps,
    createdAt: new Date().toISOString(),
    revisionNotes: input.revisionNotes?.length ? [...input.revisionNotes] : undefined,
  };

  return deepFreeze(spec);
}

/** Structural clone first, so freezing a spec never freezes the caller's working objects. */
function deepFreeze<T>(value: T): T {
  const clone = JSON.parse(JSON.stringify(value)) as T;
  freeze(clone);
  return clone;
}

function freeze(value: unknown): void {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
  Object.freeze(value);
  Object.values(value as Record<string, unknown>).forEach(freeze);
}

/** A one-line record of what a spec version is, for the run log and the UI. */
export function describeSpec(spec: FilmSpec): string {
  const resolved = Object.keys(spec.resolvedAssets).length;
  const beats = spec.timeline.beats.length;
  const seconds = spec.timeline.duration.toFixed(1);
  const notes = spec.revisionNotes?.length ? ` — ${spec.revisionNotes.join('; ')}` : '';
  return `FilmSpec v${spec.version}: ${beats} beats over ${seconds}s, ${resolved}/${beats} assets resolved${notes}`;
}
