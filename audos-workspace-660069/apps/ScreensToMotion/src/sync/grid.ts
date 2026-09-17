/**
 * Beat sync grid — pure frame math shared by the planner post-pass, the
 * validator, and the fixtures.
 *
 * Grid rules (Phase 2 §6):
 * - frames per beat = fps * 60 / bpm (fractional is fine — cuts land on the
 *   ROUNDED beat frame, so every cut is within ±1 frame of the true beat).
 * - every scene duration is quantised to whole beats (4, 6, 8, 12 preferred),
 *   never raw frames.
 * - cuts sit within ±1 frame of a beat; larger scene changes (a footage↔UI
 *   boundary) land on a bar line (4 beats).
 * - landOn "settle": animations FINISH on the beat — every UI op's entrance is
 *   offset backwards by its rise time so the spring settles exactly on the
 *   downbeat.
 * - no music → implied tempo 90–110bpm, quantised the same way.
 */
import type { VideoPlan, PlanScene, SyncSpec } from '../types';

/** Preferred whole-beat scene lengths, in beats. */
const BEAT_LADDER = [2, 3, 4, 6, 8, 12, 16];
const BEATS_PER_BAR = 4;

export function framesPerBeat(fps: number, bpm: number): number {
  return (fps * 60) / bpm;
}

/** Frame index of beat k on the grid (rounded — this IS the grid). */
export function frameAtBeat(k: number, fps: number, sync: SyncSpec): number {
  return Math.round(k * framesPerBeat(fps, sync.bpm) + (sync.offsetMs / 1000) * fps);
}

/** Default grid when no music is supplied: implied tempo, mid 90–110. */
export function impliedSync(): SyncSpec {
  return { bpm: 100, offsetMs: 0, snap: 'beat', landOn: 'settle' };
}

function nearestLadderBeats(rawBeats: number): number {
  let best = BEAT_LADDER[0];
  for (const b of BEAT_LADDER) {
    if (Math.abs(b - rawBeats) < Math.abs(best - rawBeats)) best = b;
  }
  return best;
}

const isClip = (s: PlanScene) => (s as any).kind === 'clip';

/**
 * Quantise every scene to whole beats and re-derive frame durations from
 * successive grid frames, so cumulative cut positions sit exactly on rounded
 * beat frames. Footage↔UI boundaries are extended to the next bar line.
 */
export function applyBeatGrid(plan: VideoPlan, fps: number): void {
  const sync = plan.sync;
  if (!sync) return;
  let beatCursor = 0;
  const scenes = plan.scenes;
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    let beats = nearestLadderBeats(scene.duration / framesPerBeat(fps, sync.bpm));
    const next = scenes[i + 1];
    const footageBoundary = !!next && isClip(scene) !== isClip(next);
    if (sync.snap === 'bar' || footageBoundary) {
      const endBeat = beatCursor + beats;
      const barEnd = Math.max(beatCursor + BEATS_PER_BAR, Math.round(endBeat / BEATS_PER_BAR) * BEATS_PER_BAR);
      beats = barEnd - beatCursor;
    }
    const start = frameAtBeat(beatCursor, fps, sync);
    const end = frameAtBeat(beatCursor + beats, fps, sync);
    scene.duration = end - start;
    beatCursor += beats;
  }
}

/**
 * landOn "settle": move every UI op so its END (at + duration) lands on the
 * nearest beat inside the scene — the entrance is offset backwards by the
 * op's rise time. Preserves the validator's no-overlap ordering.
 */
export function settleUiOnBeats(plan: VideoPlan, fps: number): void {
  const sync = plan.sync;
  if (!sync || sync.landOn !== 'settle') return;
  let sceneStart = 0;
  for (const scene of plan.scenes) {
    const ui = (scene as any).ui;
    if (!isClip(scene) && Array.isArray(ui)) {
      let minAt = 0;
      for (const op of ui) {
        const absEnd = sceneStart + op.at + op.duration;
        const k = Math.round((absEnd - (sync.offsetMs / 1000) * fps) / framesPerBeat(fps, sync.bpm));
        const beatEnd = frameAtBeat(k, fps, sync);
        let at = beatEnd - sceneStart - op.duration;
        at = Math.max(minAt, Math.min(at, scene.duration - op.duration - 8));
        if (at >= 0) op.at = at;
        minAt = op.at + op.duration;
      }
    }
    sceneStart += scene.duration;
  }
}

export interface GridIssue { scene: string | null; message: string; }

/** Acceptance check: every cut within ±1 frame of a beat when sync is on. */
export function checkBeatAlignment(plan: VideoPlan, fps: number): GridIssue[] {
  const sync = plan.sync;
  if (!sync) return [];
  const issues: GridIssue[] = [];
  let cut = 0;
  for (let i = 0; i < plan.scenes.length - 1; i++) {
    cut += plan.scenes[i].duration;
    const k = Math.round((cut - (sync.offsetMs / 1000) * fps) / framesPerBeat(fps, sync.bpm));
    const nearest = frameAtBeat(k, fps, sync);
    const off = Math.abs(cut - nearest);
    if (off > 1) {
      issues.push({ scene: plan.scenes[i].id, message: `cut at frame ${cut} is ${off} frames off the beat grid — quantise scene durations to whole beats` });
    }
  }
  return issues;
}
