// MOTION PRODUCTION PIPELINE — the directed path a motion_graphic /
// text_overlay scene takes from plan to READY:
//
//   OPUS MOTION DIRECTOR (agents/motionDirector)
//        ↓ Visual Timeline JSON (persisted on scene.director_timeline)
//   GSAP DIRECTED CAPTURE (lib/motionCapture → lib/motionPrimitives)
//        ↓ real clip, uploaded
//   VISUAL QA (lib/visualQa — Opus vision over extracted key frames)
//        ↓ pass → READY (qa_report: pass)
//        ↓ fail → the director REVISES the timeline against the concrete
//                 issues and the scene re-renders — at most 2 retries —
//                 then it is flagged for human review with the reasons.
//
// Every step degrades instead of blocking: a failed director call uses the
// deterministic fallback direction, unavailable QA records 'skipped', and a
// flagged scene still ships its best render (the board shows the flag).

import { directScene, fallbackDirection, reviseSceneDirection } from '../agents/motionDirector';
import { generateSceneMotionClip, sceneDirection, sceneMotionDuration, sceneMotionSpec, type MotionClipResult } from './motionCapture';
import { runSceneVisualQa, skippedQaReport, type SceneQaReport } from './visualQa';
import { updateScene, type Project, type Scene } from './supabase';
import { effectiveComposition, visualKindOf } from './effects';
import type { SceneDirection } from './visualTimeline';

const MAX_QA_RETRIES = 2;

export interface SceneNeighbors { prevKind?: string | null; nextKind?: string | null }

export interface MotionProduceOptions {
  force?: boolean;
  onProgress?: (fraction: number) => void;
  onNote?: (note: string) => void;
  neighbors?: SceneNeighbors;
  /** false skips the QA loop (used nowhere by default — QA is the standard). */
  qa?: boolean;
}

export interface MotionProduceResult {
  videoUrl: string;
  fingerprint: string;
  qa: SceneQaReport;
  scene: Scene;
}

/**
 * Make sure the scene carries a CURRENT Motion Director timeline (directed
 * against the current spec). Directs via Opus when missing/stale; falls back
 * to the deterministic direction so production never stalls on the director.
 */
export async function ensureSceneDirection(project: Project, scene: Scene, neighbors: SceneNeighbors = {}): Promise<Scene> {
  if (sceneDirection(scene)) return scene;
  const spec = sceneMotionSpec(scene);
  const aspect: '16:9' | '9:16' = project.aspect_ratio === '9:16' ? '9:16' : '16:9';
  const durationSec = sceneMotionDuration(scene);
  const kind = visualKindOf(scene.visual_kind);
  const composition = effectiveComposition(kind, scene.overlay_config, spec.kind);
  let direction: SceneDirection;
  try {
    direction = await directScene({
      description: String(scene.description || ''),
      narrationSegment: String((scene as Scene & { narration_segment?: string }).narration_segment || ''),
      motionNotes: String(scene.motion_notes || ''),
      visualKind: kind,
      spec,
      durationSec,
      aspect,
      compositionMode: composition?.mode || 'fullscreen',
      prevKind: neighbors.prevKind,
      nextKind: neighbors.nextKind,
    });
  } catch (directorError) {
    console.warn('[SceneForge] Motion director unavailable — using the deterministic fallback direction.', directorError);
    direction = fallbackDirection(spec, durationSec, aspect);
  }
  await updateScene(scene.id, { director_timeline: direction as unknown as Record<string, unknown> }, scene.project_id).catch(() => undefined);
  return { ...scene, director_timeline: direction as unknown as Record<string, unknown> };
}

async function persistQa(scene: Scene, report: SceneQaReport) {
  await updateScene(scene.id, { qa_report: report as unknown as Record<string, unknown> }, scene.project_id).catch(() => undefined);
}

/**
 * Produce one motion scene end to end: direct → capture → QA → auto-fix.
 * Resolves with the best clip produced; a scene that still fails QA after the
 * retries resolves FLAGGED (clip kept, reasons stored) rather than throwing —
 * a capture that cannot record at all still throws, exactly like before.
 */
export async function produceMotionScene(project: Project, scene: Scene, options: MotionProduceOptions = {}): Promise<MotionProduceResult> {
  const aspect: '16:9' | '9:16' = project.aspect_ratio === '9:16' ? '9:16' : '16:9';
  let working = await ensureSceneDirection(project, scene, options.neighbors || {});
  let made: MotionClipResult = await generateSceneMotionClip(project, working, { force: options.force, onProgress: options.onProgress });

  // A reused clip that already passed QA needs no re-inspection.
  const priorQa = (working as Scene & { qa_report?: SceneQaReport | null }).qa_report;
  if (made.reused && priorQa && priorQa.status === 'pass') {
    return { videoUrl: made.videoUrl, fingerprint: made.fingerprint, qa: priorQa, scene: working };
  }

  if (options.qa === false) {
    const report = skippedQaReport('QA disabled for this run');
    await persistQa(working, report);
    return { videoUrl: made.videoUrl, fingerprint: made.fingerprint, qa: report, scene: working };
  }

  let report = await runSceneVisualQa(working, made.blob || made.videoUrl, aspect, 1);
  for (let retry = 1; retry <= MAX_QA_RETRIES && report.status === 'flagged'; retry += 1) {
    // Auto-fix: the director revises its own timeline against the inspector's
    // concrete issues, then the scene re-renders from the revised direction.
    options.onNote?.(`Scene ${scene.scene_index}: visual QA found ${report.issues.length} issue${report.issues.length === 1 ? '' : 's'} — revising the direction and re-rendering (fix ${retry} of ${MAX_QA_RETRIES})`);
    let revised: SceneDirection | null = null;
    try {
      revised = await reviseSceneDirection({
        spec: sceneMotionSpec(working),
        direction: sceneDirection(working) || fallbackDirection(sceneMotionSpec(working), sceneMotionDuration(working), aspect),
        issues: report.issues,
        aspect,
        durationSec: sceneMotionDuration(working),
      });
    } catch (reviseError) {
      console.warn('[SceneForge] QA revision call failed — keeping the current render.', reviseError);
      break;
    }
    await updateScene(working.id, { director_timeline: revised as unknown as Record<string, unknown> }, working.project_id).catch(() => undefined);
    working = { ...working, director_timeline: revised as unknown as Record<string, unknown> };
    made = await generateSceneMotionClip(project, working, { force: true, onProgress: options.onProgress });
    report = await runSceneVisualQa(working, made.blob || made.videoUrl, aspect, retry + 1);
  }

  await persistQa(working, report);
  return { videoUrl: made.videoUrl, fingerprint: made.fingerprint, qa: report, scene: working };
}
