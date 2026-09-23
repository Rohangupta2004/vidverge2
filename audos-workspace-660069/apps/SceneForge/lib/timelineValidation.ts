// TIMELINE VALIDATION — the deterministic gate between "the scenes look done"
// and "a production render is submitted". Runs in assemble() BEFORE the
// portrait FFmpeg composite or the landscape Remotion submission; an invalid
// timeline REJECTS the render with concrete reasons instead of paying for a
// broken film. No LLM — every check is mechanical.
//
// Checked (per the Director-layer contract):
//  * durations — no negative, zero or NaN scene windows; boundaries inside
//    the film (small tolerance past the avatar master's tail);
//  * overlaps — middle scenes must not overlap each other (the avatar base
//    legitimately fills every gap, so gaps are NOT errors);
//  * assets — every scene that needs media has a valid, REACHABLE https URL;
//    failed/mid-generation scenes block; stale motion captures (spec edited
//    after the clip was recorded) block;
//  * generation — scenes stamped with a different generation_id than the
//    project's current one are flagged (no stale generation leaks);
//  * presenter — every scene resolves to an EXPLICIT presenter state; PIP
//    configuration must be sane;
//  * overlays — well-formed, timed inside their scene window, explicit
//    z-order;
//  * music — when the Director requires music, the bed must exist (or the
//    mix step will run after assembly — surfaced as a warning, not an error)
//    and its URL must be reachable when present;
//  * captions — caption rendering needs word timestamps.

import type { Project, Scene } from './supabase';
import type { TimelineSegment } from '../remotion/AssemblyComp';
import { sceneKind, sceneSettled } from './sceneState';
import { effectivePresenterState, normalizeOverlays, planOf } from './directorPlan';

export interface TimelineValidationReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  checked_at: string;
  draft_version: number;
  segments: number;
}

const isHttpUrl = (value?: string | null) => /^https?:\/\//i.test(String(value || ''));

/** Measure a remote asset without downloading it. null = could not measure (CORS/network) — never a failure by itself. */
async function assetBytes(url: string): Promise<number | null> {
  try {
    const response = await fetch(url, { headers: { Range: 'bytes=0-0' } });
    if (response.status === 404 || response.status === 410) return 0;
    const contentRange = response.headers.get('content-range');
    const total = contentRange ? Number(contentRange.split('/')[1]) : NaN;
    if (Number.isFinite(total) && total >= 0) return total;
    const length = Number(response.headers.get('content-length'));
    if (response.ok && Number.isFinite(length)) return length;
    return response.ok ? null : 0;
  } catch { return null; }
}

export async function validateTimeline(project: Project, scenes: Scene[], timeline: TimelineSegment[]): Promise<TimelineValidationReport> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const plan = planOf(project);
  const filmSec = Number(project.avatar_duration_sec || project.estimated_duration_sec || project.target_length_sec) || 0;
  const active = scenes.filter((scene) => scene.status !== 'skipped').sort((a, b) => Number(a.script_start_sec) - Number(b.script_start_sec));

  // --- segment sanity -------------------------------------------------------
  if (!timeline.length) errors.push('The timeline is empty — there is nothing to render.');
  timeline.forEach((segment) => {
    if (!Number.isFinite(segment.frames) || segment.frames < 1) errors.push(`A ${segment.type} segment at ${segment.startSec}s has an invalid duration (${segment.frames} frames).`);
    if (!Number.isFinite(segment.startFrame) || segment.startFrame < 0) errors.push(`A ${segment.type} segment has an invalid start (${segment.startFrame}).`);
  });

  // --- scene windows ---------------------------------------------------------
  active.forEach((scene, index) => {
    const start = Number(scene.script_start_sec);
    const end = Number(scene.script_end_sec);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      errors.push(`Scene ${scene.scene_index}'s window is invalid (${start}s → ${end}s).`);
      return;
    }
    if (start < 0) errors.push(`Scene ${scene.scene_index} starts before the film (${start}s).`);
    if (filmSec > 0 && end > filmSec + 1.5) warnings.push(`Scene ${scene.scene_index} runs ${(end - filmSec).toFixed(1)}s past the avatar master — the composition extends the film to cover it.`);
    const prev = index > 0 ? active[index - 1] : null;
    if (prev && start < Number(prev.script_end_sec) - 0.05) errors.push(`Scene ${scene.scene_index} overlaps scene ${prev.scene_index} (${start.toFixed(2)}s < ${Number(prev.script_end_sec).toFixed(2)}s).`);
  });

  // --- per-scene media, generation, presenter, overlays ----------------------
  for (const scene of active) {
    const kind = sceneKind(scene);
    if (scene.status === 'error') errors.push(`Scene ${scene.scene_index} is in an error state — retry, switch its type, or skip it before rendering.`);
    else if (scene.status === 'generating') errors.push(`Scene ${scene.scene_index} is still generating — wait for it to settle before rendering.`);
    else if (!sceneSettled(scene)) {
      const why = (kind === 'motion_graphic' || kind === 'text_overlay') && scene.render_url
        ? 'its spec was edited after the stored clip was captured (stale capture)'
        : 'its media is missing';
      errors.push(`Scene ${scene.scene_index} is not settled — ${why}.`);
    }

    // Asset URL shape + reachability (only for scenes that carry media).
    const url = String(scene.render_url || '');
    if (url) {
      if (!isHttpUrl(url)) errors.push(`Scene ${scene.scene_index}'s media URL is not a valid https address.`);
      else {
        const bytes = await assetBytes(url);
        if (bytes === 0) errors.push(`Scene ${scene.scene_index}'s media URL is unreachable or empty — regenerate that scene before rendering.`);
        else if (bytes !== null && bytes < 1024) errors.push(`Scene ${scene.scene_index}'s media file is only ${bytes} bytes — a broken capture; regenerate it before rendering.`);
      }
    }

    // Generation stamps: a scene from another generation must not silently ride along.
    const projectGen = String((project as any).generation_id || '');
    const sceneGen = String((scene as any).generation_id || '');
    if (projectGen && sceneGen && sceneGen !== projectGen) errors.push(`Scene ${scene.scene_index} belongs to generation ${sceneGen.slice(0, 18)}…, not the current plan — replan or regenerate it.`);
    else if (projectGen && !sceneGen) warnings.push(`Scene ${scene.scene_index} predates generation stamping — its media is used as-is.`);

    // Presenter state is ALWAYS explicit at validation time (derived when the
    // plan predates the field); PIP must be sane.
    const presenter = effectivePresenterState(scene);
    if (presenter.video === 'pip') {
      if (!presenter.pip) errors.push(`Scene ${scene.scene_index} asks for a picture-in-picture presenter but has no PIP configuration.`);
      else if (presenter.pip.scale < 0.1 || presenter.pip.scale > 0.5) errors.push(`Scene ${scene.scene_index}'s PIP scale ${presenter.pip.scale} is out of range.`);
      if (kind !== 'ai_video' && kind !== 'image') warnings.push(`Scene ${scene.scene_index} uses PIP over a ${kind} visual — unusual, but rendered as asked.`);
    }

    // Overlay elements: normalized shape, timing inside the window, explicit z.
    const windowSec = Math.max(0, Number(scene.script_end_sec) - Number(scene.script_start_sec));
    const overlays = normalizeOverlays((scene as any).overlays, String(scene.scene_index));
    const rawCount = Array.isArray((scene as any).overlays) ? ((scene as any).overlays as unknown[]).length : 0;
    if (rawCount > overlays.length) warnings.push(`Scene ${scene.scene_index}: ${rawCount - overlays.length} malformed overlay element(s) were dropped.`);
    overlays.forEach((overlay) => {
      if (overlay.start_offset_sec >= windowSec) errors.push(`Overlay "${overlay.text || overlay.type}" on scene ${scene.scene_index} starts after its scene window ends.`);
      else if (overlay.start_offset_sec + overlay.duration_sec > windowSec + 0.05) warnings.push(`Overlay "${overlay.text || overlay.type}" on scene ${scene.scene_index} runs past the scene window — it is clamped at render.`);
      if (!Number.isFinite(overlay.z_index)) errors.push(`Overlay "${overlay.text || overlay.type}" on scene ${scene.scene_index} has no z-order.`);
    });
  }

  // --- music -----------------------------------------------------------------
  const music = plan?.music;
  if (music?.required) {
    if (!project.music_url) warnings.push('The Director calls for music, and no bed exists yet — generate and mix it in Step 7 after assembly.');
  }
  if (project.music_url) {
    if (!isHttpUrl(project.music_url)) errors.push('The stored music bed URL is not a valid https address.');
    else {
      const bytes = await assetBytes(project.music_url);
      if (bytes === 0) errors.push('The stored music bed is unreachable — regenerate the music before mixing.');
    }
  }

  // --- captions --------------------------------------------------------------
  if (plan?.captions && !(Array.isArray(project.word_timestamps) && project.word_timestamps.length)) {
    warnings.push('Captions are enabled but the avatar render returned no word timestamps — captions are skipped.');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    checked_at: new Date().toISOString(),
    draft_version: plan?.draft_version || 1,
    segments: timeline.length,
  };
}
