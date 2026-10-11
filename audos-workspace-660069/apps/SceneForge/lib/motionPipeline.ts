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
//
// TWO RENDERERS, ONE DECISION. A beat that shows the PRODUCT — a feature card, a
// stat callout, a step sequence, a UI highlight, a comparison table — is rendered
// by HeyGen as one HyperFrames overlay clip timed to the narration window
// (lib/productGraphics), because compositing those as separate Remotion layers is
// what produced the misalignment and z-order problems. Everything else — charts,
// timelines, diagrams, maps, kinetic typography — keeps the GSAP capture. An
// account without HyperFrames keeps the GSAP capture for both.

import { directScene, fallbackDirection, reviseSceneDirection } from '../agents/motionDirector';
import { generateSceneMotionClip, sceneDirection, sceneMotionDuration, sceneMotionSpec, type MotionClipResult } from './motionCapture';
import { runSceneVisualQa, skippedQaReport, type SceneQaReport } from './visualQa';
import { describeError } from './heygenApi';
import { hyperFramesRuledOut, isProductGraphicBeat, renderProductGraphic, type ProductGraphicResult } from './productGraphics';
import { alternativeKindsFor, dominantKindOf, planVariety, recastDominant, type VarietyEntry } from './visualBudget';
import { updateScene, type Project, type Scene } from './supabase';
import { sceneNeedsGeneration } from './sceneState';
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
  /** Set when HeyGen HyperFrames rendered the beat instead of the GSAP capture. */
  productGraphic?: ProductGraphicResult | null;
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
 * Render a product-graphic beat through HeyGen HyperFrames, or return null.
 *
 * Null means "not a product beat, or HeyGen could not do it" — both of which end
 * in the GSAP capture below. HyperFrames being absent from a plan is not a
 * failure the customer has to solve, and one refused render is not either: the
 * beat is drawn the old way and the reason is reported rather than swallowed.
 */
async function tryProductGraphic(project: Project, scene: Scene, options: MotionProduceOptions): Promise<ProductGraphicResult | null> {
  if (!isProductGraphicBeat(sceneMotionSpec(scene)) || hyperFramesRuledOut()) return null;
  try {
    return await renderProductGraphic(project, scene, { force: options.force, onNote: options.onNote });
  } catch (e) {
    options.onNote?.(`Scene ${scene.scene_index}: HeyGen HyperFrames could not render this product graphic (${describeError(e)}), so it was drawn with the built-in graphic renderer instead.`);
    console.warn('[SceneForge] A product-graphic beat fell back to the Remotion/GSAP renderer.', e);
    return null;
  }
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

  // The product-graphic route comes first: when HeyGen renders this beat there is
  // no GSAP capture to make, and no directed-layer count to inspect either — the
  // frame came from a fixed bundle, so the complexity check is skipped and the
  // inspector only looks for a broken or empty frame.
  const product = await tryProductGraphic(project, working, options);
  if (product) {
    const report = options.qa === false
      ? skippedQaReport('QA disabled for this run')
      : await runSceneVisualQa(working, product.videoUrl, aspect, 1, { skipComplexity: true });
    await persistQa(working, report);
    return {
      videoUrl: product.videoUrl,
      fingerprint: product.fingerprint,
      qa: report,
      scene: { ...working, render_url: product.videoUrl, video_prompt: product.fingerprint, status: 'ready' },
      productGraphic: product,
    };
  }

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
  return { videoUrl: made.videoUrl, fingerprint: made.fingerprint, qa: report, scene: working, productGraphic: null };
}

// ---------------------------------------------------------------------------
// FILM-LEVEL VARIETY — the other half of the one-dominant-visual rule.
//
// The per-beat budget (lib/visualBudget) makes every scene readable. On its own
// it also makes every scene the SAME, because the safest single visual for a
// headline is always a headline: ten disciplined beats in a row is a slideshow.
// So once every motion scene has been directed, their dominant visuals are
// compared ACROSS the film and a beat that would be the third in a row of its
// kind is re-cast as something its own content can genuinely carry.
//
// This costs no extra model calls: each scene is directed here with the same one
// call `produceMotionScene` would have made, and the directions are handed back
// on the returned rows so nothing is directed twice.
// ---------------------------------------------------------------------------

function isMotionScene(scene: Scene): boolean {
  const kind = visualKindOf(scene.visual_kind);
  return kind !== 'ai_video' && kind !== 'image';
}

function neighborsOf(rows: Scene[], index: number): SceneNeighbors {
  return {
    prevKind: index > 0 ? visualKindOf(rows[index - 1].visual_kind) : null,
    nextKind: index + 1 < rows.length ? visualKindOf(rows[index + 1].visual_kind) : null,
  };
}

/**
 * Direct the motion scenes that still need producing, then vary the film's
 * dominant visuals across ALL of them.
 *
 * COSTS NOTHING EXTRA. A scene that already carries a direction is read for free
 * and counts toward the film's rhythm. A scene that does not is directed only if
 * it still needs producing — the same single call its own production would make,
 * moved earlier so the comparison can happen before anything renders. A settled
 * scene with no stored direction (a legacy row) is counted where possible and
 * never re-directed for the sake of a rhythm pass.
 *
 * AND NOTHING FINISHED IS INVALIDATED. Re-casting a dominant visual changes the
 * direction, which changes the capture fingerprint — so only scenes that are
 * going to be rendered anyway are ever re-cast. A finished clip is left alone.
 *
 * Returns the scenes with their directions attached, in the order given. Never
 * throws: a film that cannot be directed up front is produced scene by scene
 * exactly as before.
 */
export async function ensureFilmVariety(project: Project, scenes: Scene[], onNote?: (note: string) => void): Promise<Scene[]> {
  const rows = [...scenes].sort((a, b) => a.scene_index - b.scene_index);
  const directed = new Map<string, Scene>();
  const pending = new Set<string>();

  for (let index = 0; index < rows.length; index += 1) {
    const scene = rows[index];
    if (!isMotionScene(scene) || scene.status === 'skipped') continue;
    const needsWork = sceneNeedsGeneration(scene);
    if (needsWork) pending.add(scene.id);
    if (sceneDirection(scene)) { directed.set(scene.id, scene); continue; }
    if (!needsWork) continue;
    try {
      directed.set(scene.id, await ensureSceneDirection(project, scene, neighborsOf(rows, index)));
    } catch (e) {
      // One undirectable scene must not cost the whole variety pass.
      console.warn('[SceneForge] A scene could not be directed during the film variety pass.', scene.scene_index, e);
    }
  }

  const ordered = rows.filter((scene) => directed.has(scene.id)).map((scene) => directed.get(scene.id)!);
  // Two beats in a row cannot be monotonous; three is the first count worth acting on.
  if (ordered.length >= 3) {
    const entries: VarietyEntry[] = ordered.map((scene) => ({
      key: scene.id,
      kind: dominantKindOf(sceneDirection(scene)),
      // A scene that is not being rendered this run offers no alternatives, so
      // the pass reads its kind for rhythm but never rewrites it.
      alternatives: pending.has(scene.id) ? alternativeKindsFor(sceneMotionSpec(scene)) : [],
    }));
    for (const change of planVariety(entries)) {
      const scene = directed.get(change.key);
      const direction = scene ? sceneDirection(scene) : null;
      if (!scene || !direction) continue;
      const recast = recastDominant(direction, change.to);
      if (recast === direction) continue;
      await updateScene(scene.id, { director_timeline: recast as unknown as Record<string, unknown> }, scene.project_id).catch(() => undefined);
      directed.set(scene.id, { ...scene, director_timeline: recast as unknown as Record<string, unknown> });
      onNote?.(`Scene ${scene.scene_index}: ${change.reason}`);
    }
  }

  return scenes.map((scene) => directed.get(scene.id) || scene);
}
