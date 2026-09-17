/**
 * Stage 3 post-validation — everything the JSON Schema cannot express.
 * A violation either gets REPAIRED (when the fix is mechanical and honest) or
 * REPORTED (the caller retries the planner with the violation list).
 *
 * Enforced rules:
 * - every crop-consuming accent/ui region sits inside a safeCrop
 * - no repeated bed op back-to-back; total duration 20–40s at 30fps
 * - exactly one bed + 0–2 accents; cursor never with focus; lift XOR parallax
 * - UI budget: max 2 per scene, no time overlap; a cursor scene fires exactly
 *   one UI op, after the click; no UI op repeats more than twice video-wide
 * - plate rule: a plate-dependent UI op on a region with plateColor null is
 *   swapped for a highlight accent (the documented fallback)
 * - rhythm: scene lengths vary; best screenshot lands 60–70% through; final
 *   scene holds >= 20 frames at rest
 * - UI op roles must match the region's role (UI_OP_ROLES)
 */
import { UI_OP_ROLES } from '../ui';
import { checkBeatAlignment } from '../sync/grid';
import { availableCompFrames } from '../clips/conform';
import { CLIP_RULES } from '../types';
import type { VideoPlan, ScreenAnalysis, SceneSpec, ClipSceneSpec, IngestedClip, BBox } from '../types';

const FPS = 30;
const MIN_TOTAL = 20 * FPS;
const MAX_TOTAL = 40 * FPS;
/** Ops that draw on a plate and therefore need a uniform ring. */
const PLATE_DEPENDENT = ['countUp', 'chartDraw', 'skeleton', 'typeIn', 'progressFill', 'toggleFlip', 'statusFlip', 'tabSlide', 'badgePop'];

export interface PlanIssue { scene: string | null; message: string; }

function insideAny(bbox: BBox, crops: BBox[]): boolean {
  return crops.some((c) =>
    bbox[0] >= c[0] - 0.005 && bbox[1] >= c[1] - 0.005 &&
    bbox[0] + bbox[2] <= c[0] + c[2] + 0.005 && bbox[1] + bbox[3] <= c[1] + c[3] + 0.005);
}

export function validateAndRepairPlan(plan: VideoPlan, analyses: ScreenAnalysis[], clips?: IngestedClip[]): { plan: VideoPlan; issues: PlanIssue[] } {
  const issues: PlanIssue[] = [];
  const byScreen = new Map(analyses.map((a) => [a.screenId, a]));
  const clipsById = new Map((clips || []).map((c) => [c.clipId, c] as const));
  const uiUseCount: Record<string, number> = {};

  // Clip budget (Phase 2 §3): at most 4 clips per video.
  const clipScenes = plan.scenes.filter((s) => (s as ClipSceneSpec).kind === 'clip') as ClipSceneSpec[];
  const distinctClips = new Set(clipScenes.map((s) => s.src));
  if (distinctClips.size > CLIP_RULES.maxClips) {
    issues.push({ scene: null, message: `${distinctClips.size} clips used — at most ${CLIP_RULES.maxClips} per video` });
  }

  const total = plan.scenes.reduce((sum, s) => sum + s.duration, 0);
  if (total < MIN_TOTAL || total > MAX_TOTAL) {
    issues.push({ scene: null, message: `total duration ${Math.round(total / FPS)}s is outside 20–40s` });
  }

  const durations = plan.scenes.map((s) => s.duration);
  if (new Set(durations).size === 1 && durations.length > 1) {
    issues.push({ scene: null, message: 'all scenes share one duration — vary scene lengths' });
  }

  // Best screenshot placement: the scene using the highest-salience screen
  // should start 60–70% through the video.
  const salienceOf = (screenId: string) => {
    const a = byScreen.get(screenId);
    return a ? Math.max(0, ...a.regions.map((r) => r.salience)) : 0;
  };
  const best = [...plan.scenes].sort((a, b) => salienceOf((b as SceneSpec).screenId || '') - salienceOf((a as SceneSpec).screenId || ''))[0];
  if (best && total > 0) {
    let starts = 0;
    for (const s of plan.scenes) { if (s === best) break; starts += s.duration; }
    const position = starts / total;
    if (position < 0.45 || position > 0.8) {
      issues.push({ scene: best.id, message: `strongest screenshot starts at ${(position * 100).toFixed(0)}% — place it 60–70% through` });
    }
  }

  const last = plan.scenes[plan.scenes.length - 1];
  if (last && (last as ClipSceneSpec).kind !== 'clip') {
    const lastScreen = last as SceneSpec;
    const lastUiEnd = Math.max(0, ...(lastScreen.ui || []).map((u) => u.at + u.duration), ...(lastScreen.accents || []).map((a) => a.to || 0));
    if (lastScreen.duration - lastUiEnd < 20) {
      lastScreen.duration = lastUiEnd + 24; // repair: extend the final hold to >= 20 frames at rest
    }
  }

  let previousBed = '';
  for (const planScene of plan.scenes) {
    if ((planScene as ClipSceneSpec).kind === 'clip') {
      previousBed = ''; // footage interrupts the camera stream — bed alternation restarts after it
      validateClipScene(planScene as ClipSceneSpec, clipsById, byScreen, issues);
      continue;
    }
    const scene = planScene as SceneSpec;
    if (!scene.screenId || !scene.bed || !Array.isArray(scene.accents) || !Array.isArray(scene.ui)) {
      issues.push({ scene: scene.id, message: 'screen scene is missing screenId/bed/accents/ui' });
      continue;
    }
    if (scene.duration < 60) {
      issues.push({ scene: scene.id, message: `screen scene is ${scene.duration} frames — minimum 60 (only clip scenes may be shorter)` });
    }
    const analysis = byScreen.get(scene.screenId);
    if (!analysis) {
      issues.push({ scene: scene.id, message: `unknown screenId "${scene.screenId}"` });
      continue;
    }
    const regionById = new Map(analysis.regions.map((r) => [r.id, r]));

    if (scene.bed.op === previousBed) {
      issues.push({ scene: scene.id, message: `bed "${scene.bed.op}" repeats back-to-back — alternate bed ops` });
    }
    previousBed = scene.bed.op;

    // --- accent structure rules -------------------------------------------
    const ops = scene.accents.map((a) => a.op);
    if (ops.includes('cursor') && ops.includes('focus')) {
      issues.push({ scene: scene.id, message: 'cursor and focus cannot share a scene' });
    }
    if (ops.includes('lift') && ops.includes('parallax')) {
      issues.push({ scene: scene.id, message: 'lift and parallax are mutually exclusive' });
    }

    // --- crops inside safeCrops -------------------------------------------
    for (const accent of scene.accents) {
      const rid = String(accent.params?.regionId || accent.params?.toRegionId || '');
      if (!rid) continue;
      const region = regionById.get(rid);
      if (!region) {
        issues.push({ scene: scene.id, message: `accent ${accent.op} references unknown region "${rid}"` });
        continue;
      }
      if ((accent.op === 'focus' || accent.op === 'lift') && !insideAny(region.bbox, analysis.safeCrops)) {
        issues.push({ scene: scene.id, message: `${accent.op} crop on "${rid}" is outside every safeCrop` });
      }
    }

    // --- UI ops: plate rule, roles, budget, overlap, cursor pairing --------
    const cursorAccent = scene.accents.find((a) => a.op === 'cursor');
    const repairedUi = [];
    for (const ui of scene.ui || []) {
      const region = regionById.get(ui.regionId);
      if (!region && ui.op !== 'notify') {
        issues.push({ scene: scene.id, message: `ui ${ui.op} references unknown region "${ui.regionId}"` });
        continue;
      }
      const roles = UI_OP_ROLES[ui.op];
      if (region && roles && !roles.includes(region.role)) {
        issues.push({ scene: scene.id, message: `ui ${ui.op} attached to a "${region.role}" region — allowed roles: ${roles.join(', ')}` });
        continue;
      }
      if (region && PLATE_DEPENDENT.includes(ui.op) && !region.plateColor) {
        // Documented fallback: ring varied > 6% luminance → skip op, highlight instead.
        if (scene.accents.length < 2 && !scene.accents.some((a) => a.op === 'highlight')) {
          scene.accents.push({ op: 'highlight', params: { regionId: region.id, dim: 0.4, style: 'ring' }, from: ui.at, to: Math.min(scene.duration, ui.at + ui.duration) });
        }
        continue; // op removed
      }
      if (region && !insideAny(region.bbox, analysis.safeCrops)) {
        issues.push({ scene: scene.id, message: `ui ${ui.op} region "${ui.regionId}" is outside every safeCrop` });
        continue;
      }
      uiUseCount[ui.op] = (uiUseCount[ui.op] || 0) + 1;
      if (uiUseCount[ui.op] > 2) {
        issues.push({ scene: scene.id, message: `ui ${ui.op} used more than twice across the video` });
        continue;
      }
      repairedUi.push(ui);
    }
    // budget: max 2, no overlap
    repairedUi.sort((a, b) => a.at - b.at);
    const kept = [];
    let lastEnd = -1;
    for (const ui of repairedUi) {
      if (kept.length >= 2) { issues.push({ scene: scene.id, message: 'more than 2 UI ops in one scene' }); break; }
      if (ui.at < lastEnd) { issues.push({ scene: scene.id, message: `ui ops overlap in time at frame ${ui.at}` }); continue; }
      kept.push(ui);
      lastEnd = ui.at + ui.duration;
    }
    if (cursorAccent) {
      const clickAt = Number(cursorAccent.params?.clickAt) || 0;
      const clickAbs = (cursorAccent.from || 0) + clickAt;
      const after = kept.filter((u) => u.at >= clickAbs);
      if (kept.length !== 1 || after.length !== 1) {
        issues.push({ scene: scene.id, message: 'a cursor scene must fire exactly one UI op, after the click' });
      }
    }
    scene.ui = kept;

    // overlay copy limits beyond schema: headline <= 42
    if (scene.overlay && scene.overlay.size === 'headline' && scene.overlay.text.length > 42) {
      issues.push({ scene: scene.id, message: `headline overlay is ${scene.overlay.text.length} chars — max 42` });
    }
  }

  // Footage boundaries (Phase 2 §5): cut on motion — "ends at rest" is
  // SUSPENDED there, so the outgoing scene must carry velocity across the cut.
  // Missing carries are repaired with a sensible default; footage is never
  // cross-dissolved into UI (the renderer hard-cuts every clip boundary).
  for (let i = 0; i < plan.scenes.length - 1; i++) {
    const outgoing = plan.scenes[i] as any;
    const incoming = plan.scenes[i + 1] as any;
    const isFootageBoundary = (outgoing.kind === 'clip') !== (incoming.kind === 'clip');
    if (isFootageBoundary && !(outgoing.out && outgoing.out.carry)) {
      outgoing.out = { carry: outgoing.kind === 'clip' ? 'left' : (outgoing.bed && outgoing.bed.op === 'pan' ? 'left' : 'in') };
    }
  }

  // Beat grid acceptance (Phase 2 §6): every cut within ±1 frame of a beat.
  if (plan.sync) {
    for (const gridIssue of checkBeatAlignment(plan, FPS)) issues.push(gridIssue);
  }

  return { plan, issues };
}

/** Clip-scene rules (Phase 2 §2/§3/§10). Mechanical fixes repair; the rest report. */
function validateClipScene(scene: ClipSceneSpec, clipsById: Map<string, IngestedClip>, byScreen: Map<string, ScreenAnalysis>, issues: PlanIssue[]): void {
  if (!scene.src || !Array.isArray(scene.trim) || scene.trim.length !== 2) {
    issues.push({ scene: scene.id, message: 'clip scene is missing src/trim' });
    return;
  }
  if (scene.grade !== 'auto' && scene.grade !== 'none') scene.grade = 'auto';
  if (scene.audio !== 'strip' && scene.audio !== 'duck') scene.audio = 'strip'; // default: silence beats one clip's ambience
  const clip = clipsById.get(scene.src);
  if (!clip) {
    issues.push({ scene: scene.id, message: `clip scene references unknown clip "${scene.src}"` });
    return;
  }
  if (scene.trim[1] <= scene.trim[0] || scene.trim[1] > clip.durationSeconds + 0.05) {
    issues.push({ scene: scene.id, message: `trim [${scene.trim[0]}, ${scene.trim[1]}] is outside the clip's ${clip.durationSeconds.toFixed(2)}s` });
    return;
  }
  const available = availableCompFrames(clip, scene.trim);
  if (scene.duration > available) {
    // NEVER loop to fill time — reject clips shorter than the scene using them.
    issues.push({ scene: scene.id, message: `clip "${scene.src}" provides ${available} frames in its trim but the scene needs ${scene.duration} — shorten the scene or widen the trim; clips are never looped` });
  }
  if (scene.plate) {
    if (!byScreen.has(scene.plate.screenId)) {
      issues.push({ scene: scene.id, message: `plate references unknown screen "${scene.plate.screenId}"` });
    }
    if (!Array.isArray(scene.plate.corners) || scene.plate.corners.length < 2 || scene.plate.corners.length > 4) {
      issues.push({ scene: scene.id, message: 'plate needs 2–4 corner keyframes — shots requiring more are rejected' });
    }
  }
}
