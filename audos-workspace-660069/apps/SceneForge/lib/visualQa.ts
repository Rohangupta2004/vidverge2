// VISUAL QA PIPELINE — after a motion scene is rendered, key frames are
// extracted from the actual clip (25% / 50% / 75% plus the entrance and exit
// windows), downscaled, and shown to claude-opus-5 through the workspace
// vision proxy. The inspector checks what a motion-design reviewer would:
// blank frames, clipped or colliding elements, unreadable text, covered
// faces, wrong z-order, missing assets, mistimed or mechanical animation.
// The verdict is stored on the scene (qa_report) so the board can show
// pass/fail, and a FAIL feeds the Motion Director's revision pass — the
// auto-fix half of the loop (lib/motionPipeline), max 2 retries before the
// scene is flagged for human review with the concrete reasons.
//
// Hard constraint: the Anthropic proxy caps request bodies at 256 KB, so
// frames are captured small (≤640px wide JPEG) and dropped from the middle
// outward when the batch would exceed the budget.

import { claudeVisionJson, type VisionImage } from './proxy';
import type { Scene } from './supabase';
import { sceneMotionSpec } from './motionCapture';

export interface QaIssue { code: string; severity: 'fail' | 'warn'; detail: string }

export interface SceneQaReport {
  status: 'pass' | 'flagged' | 'skipped';
  pass: boolean;
  /** How many render attempts this verdict covers (1 = first render passed). */
  attempts: number;
  frames: number;
  issues: QaIssue[];
  summary: string;
  checkedAt: string;
}

const QA_MODEL = 'claude-opus-5';
const FRAME_MAX_WIDTH = 640;
const FRAME_QUALITY = 0.55;
// Total base64 budget across all frames — leaves generous headroom under the
// proxy's 256 KB request-body ceiling for the JSON envelope and task text.
const MAX_FRAMES_BASE64 = 150_000;
// Key sampling points: entrance (just after transition-in), quarter, half,
// three-quarter, and the exit window.
const FRAME_FRACTIONS = [0.08, 0.25, 0.5, 0.75, 0.92];

const withTimeout = <T,>(work: Promise<T>, ms: number, what: string): Promise<T> => new Promise<T>((resolve, reject) => {
  const timer = window.setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)}s`)), ms);
  work.then((value) => { window.clearTimeout(timer); resolve(value); }, (error) => { window.clearTimeout(timer); reject(error); });
});

/**
 * Extract downscaled JPEG frames from a rendered clip. Prefers a local Blob
 * (the capture path hands the recorded bytes over directly — no CORS); a
 * remote URL is tried with crossOrigin, and any failure (tainted canvas,
 * codec, network) returns [] so QA degrades to 'skipped' instead of failing
 * the scene.
 */
export async function extractClipFrames(source: Blob | string, fractions: number[] = FRAME_FRACTIONS): Promise<{ frames: VisionImage[]; atFractions: number[] }> {
  const url = typeof source === 'string' ? source : URL.createObjectURL(source);
  const revoke = typeof source === 'string' ? null : url;
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  if (typeof source === 'string') video.crossOrigin = 'anonymous';
  video.preload = 'auto';
  video.style.cssText = 'position:fixed;left:-99999px;top:0;width:320px;pointer-events:none;opacity:0;';
  document.body.appendChild(video);
  try {
    video.src = url;
    await withTimeout(new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error('The clip could not be decoded for QA.'));
    }), 15_000, 'Loading the clip for QA');
    // WebM captures report Infinity duration until seeked to the end once.
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      video.currentTime = 1e6;
      await withTimeout(new Promise<void>((resolve) => { video.onseeked = () => resolve(); }), 8_000, 'Measuring the clip').catch(() => undefined);
    }
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 6;
    const scale = Math.min(1, FRAME_MAX_WIDTH / Math.max(1, video.videoWidth));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(2, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(2, Math.round(video.videoHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return { frames: [], atFractions: [] };
    const frames: VisionImage[] = [];
    const atFractions: number[] = [];
    for (const fraction of fractions) {
      const at = Math.min(duration - 0.05, Math.max(0.05, duration * fraction));
      video.currentTime = at;
      await withTimeout(new Promise<void>((resolve) => { video.onseeked = () => resolve(); }), 8_000, 'Seeking the clip');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', FRAME_QUALITY);
      const base64 = dataUrl.split(',')[1] || '';
      if (base64) { frames.push({ data: base64, mediaType: 'image/jpeg' }); atFractions.push(Math.round(fraction * 100)); }
    }
    // Budget guard: drop middle frames first — the entrance and exit frames
    // carry the most QA signal (transitions, timing).
    let total = frames.reduce((sum, frame) => sum + frame.data.length, 0);
    while (total > MAX_FRAMES_BASE64 && frames.length > 2) {
      const middle = Math.floor(frames.length / 2);
      frames.splice(middle, 1);
      atFractions.splice(middle, 1);
      total = frames.reduce((sum, frame) => sum + frame.data.length, 0);
    }
    if (total > MAX_FRAMES_BASE64) return { frames: [], atFractions: [] };
    return { frames, atFractions };
  } catch {
    return { frames: [], atFractions: [] };
  } finally {
    video.remove();
    if (revoke) URL.revokeObjectURL(revoke);
  }
}

const QA_SYSTEM = 'You are a meticulous senior motion designer doing frame QA on ONE rendered motion-graphics scene from a documentary explainer. You see a handful of key frames sampled across the scene. Judge like a professional reviewing agency work: real defects fail, taste differences do not. Return strict JSON only.';

const QA_CHECKS = `Inspect the frames for these DEFECTS (each found defect becomes an issue with a short machine code):
- blank_frame: a mid-scene frame that is essentially blank/black with no content.
- clipped_element: text or graphics cut off by the frame edge or by a container.
- collision: elements overlapping so either becomes hard to read.
- unreadable_text: text too small at this frame size, or too low-contrast against its background.
- covered_face: a graphic sitting over a person's face (when a person is visible).
- z_order: an element visibly rendered above/below the wrong layer (e.g. label hidden behind a card).
- missing_asset: an obviously empty placeholder box/frame where an image should be.
- timing: comparing the sampled frames in order, an element that should persist is already gone, or nothing has appeared long after the scene started.
- mechanical: the layout/motion evidence looks programmatically assembled (everything centered in one column, uniform spacing with no hierarchy, no dominant element).
Severity: 'fail' when a viewer would notice the defect; 'warn' for minor polish notes. PASS the scene when there are no 'fail' issues. Expected content is provided — also FAIL (code content_mismatch) if a headline/number visibly differs from the expected strings.`;

interface QaVerdictRaw { pass?: boolean; issues?: { code?: string; severity?: string; detail?: string }[]; summary?: string }

/**
 * Run one vision inspection over extracted frames. Throws on proxy errors —
 * the caller decides whether to degrade to 'skipped'.
 */
export async function inspectSceneFrames(scene: Scene, frames: VisionImage[], atFractions: number[], aspect: '16:9' | '9:16'): Promise<{ pass: boolean; issues: QaIssue[]; summary: string }> {
  const spec = sceneMotionSpec(scene);
  const expected = {
    title: spec.title || '',
    subtitle: spec.subtitle || '',
    stat: spec.stat ? `${spec.stat.prefix || ''}${spec.stat.value}${spec.stat.suffix || ''} ${spec.stat.label || ''}`.trim() : '',
    items: spec.items.map((item) => item.label),
    kind: spec.kind,
  };
  const task = `${QA_CHECKS}\nSCENE CONTEXT: aspect ${aspect}; layout kind "${expected.kind}"; the frames were sampled at ${atFractions.map((p) => `${p}%`).join(', ')} of the scene, in order.\nEXPECTED CONTENT (must appear, verbatim): ${JSON.stringify(expected)}\nReturn strict JSON: {"pass":boolean,"issues":[{"code":string,"severity":"fail"|"warn","detail":string}],"summary":string}`;
  const raw = await claudeVisionJson<QaVerdictRaw>(QA_SYSTEM, task, frames, QA_MODEL, 1600);
  const issues: QaIssue[] = (Array.isArray(raw.issues) ? raw.issues : [])
    .map((issue) => ({ code: String(issue?.code || 'defect').slice(0, 40), severity: issue?.severity === 'warn' ? 'warn' as const : 'fail' as const, detail: String(issue?.detail || '').slice(0, 300) }))
    .filter((issue) => issue.detail)
    .slice(0, 10);
  const hardFails = issues.some((issue) => issue.severity === 'fail');
  return { pass: raw.pass === true && !hardFails, issues, summary: String(raw.summary || (hardFails ? 'Visual defects found.' : 'Scene passed visual QA.')).slice(0, 400) };
}

/** A skipped-QA report — QA could not run (frames unavailable, proxy down);
 * the scene ships as rendered, and the reason is recorded. */
export function skippedQaReport(reason: string, attempts = 1): SceneQaReport {
  return { status: 'skipped', pass: true, attempts, frames: 0, issues: [], summary: `QA skipped: ${reason}`.slice(0, 300), checkedAt: new Date().toISOString() };
}

/**
 * Full QA of one rendered scene clip. Never throws: an unavailable inspector
 * degrades to a 'skipped' report rather than blocking the pipeline.
 */
export async function runSceneVisualQa(scene: Scene, source: Blob | string, aspect: '16:9' | '9:16', attempts: number): Promise<SceneQaReport> {
  const { frames, atFractions } = await extractClipFrames(source);
  if (!frames.length) return skippedQaReport('frames could not be extracted from the clip in this browser', attempts);
  try {
    const verdict = await inspectSceneFrames(scene, frames, atFractions, aspect);
    return {
      status: verdict.pass ? 'pass' : 'flagged',
      pass: verdict.pass,
      attempts,
      frames: frames.length,
      issues: verdict.issues,
      summary: verdict.summary,
      checkedAt: new Date().toISOString(),
    };
  } catch (error: any) {
    return skippedQaReport(String(error?.message || error).slice(0, 200), attempts);
  }
}
