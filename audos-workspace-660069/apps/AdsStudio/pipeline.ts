/**
 * ADS STUDIO — the agentic generation loop and assembly orchestration.
 *
 * Per clip: GENERATE (Veo, avatar-seeded) → INSPECT (Opus vision against the
 * scene plan + script line) → on rejection, ONE auto-regenerate with the
 * inspector's adjusted prompt (max 2 attempts — after the retake the clip is
 * always accepted so the run never loops) → CONTINUITY (Opus reads the final
 * frame; the note is injected into the next clip's [Continuity] clause).
 *
 * A clip failure never crashes the run — it is marked failed and the loop
 * moves on; the Review step regenerates failed clips individually.
 */

import {
  AdsSession, GeneratedClip, ScenePlan, ScriptClip, UploadedAsset,
} from './api';
import { assembleVeoPrompt, continuityNoteFromFrame, inspectClip } from './opus';
import { VEO_MODEL, extractFrame, pollVeo, probeClipDuration, submitVeo } from './veo';
import { buildClipOverlay, recordOverlay, OverlayContext } from './overlays';
import { adFrameSize, assembleAd, AssemblyClip, AssemblyResult } from './assemble';

const BASE_NEGATIVE = 'on-screen text, captions, subtitles, watermarks, logos, UI elements, distorted hands, distorted faces';

export interface ClipRunResult {
  videoUrl: string | null;
  status: GeneratedClip['status'];
  issues: string[];
  attempts: number;
  lastFrameUrl: string | null;
  promptUsed: string;
  /** The ACTUAL model the clip rendered on — recorded, never assumed. */
  modelUsed: string;
  note: string;
  continuityNote: string;
  measuredDurationS: number;
}

/**
 * Generate ONE clip agentically. `previousFrameUrl` is the prior clip's final
 * frame (vision context for the inspector); `continuityNote` is the Opus-read
 * consistency note injected into this clip's prompt.
 */
export async function generateClipAgentic(params: {
  plan: ScenePlan;
  script: ScriptClip;
  aspect: '9:16' | '16:9' | '1:1';
  avatarUrl: string | null;
  continuityNote: string | null;
  previousFrameUrl: string | null;
  promptOverride?: string | null;
  onNote: (n: string) => void;
}): Promise<ClipRunResult> {
  const { plan, script } = params;
  const negative = `${BASE_NEGATIVE}${plan.do_not_show ? `, ${plan.do_not_show}` : ''}`;
  let prompt = params.promptOverride?.trim()
    || assembleVeoPrompt(plan, script.duration_seconds, params.continuityNote);
  let issues: string[] = [];
  let note = '';
  let status: GeneratedClip['status'] = 'accepted';

  const MAX_ATTEMPTS = 2; // initial take + one auto-regenerate
  let videoUrl: string | null = null;
  let attempts = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    attempts = attempt;
    params.onNote(attempt === 1 ? `Clip ${script.clip_number}: filming…` : `Clip ${script.clip_number}: retaking with the adjusted prompt…`);
    try {
      const operationId = await submitVeo({
        prompt,
        negative,
        aspect: params.aspect,
        durationS: script.duration_seconds,
        referenceImageUrl: params.avatarUrl,
      });
      videoUrl = await pollVeo(operationId);
    } catch (e: any) {
      const message = String(e?.message || e);
      if (attempt < MAX_ATTEMPTS && !/billing|declined|402/i.test(message)) {
        issues = [...issues, `Take ${attempt} failed to render: ${message.slice(0, 160)}`];
        params.onNote(`Clip ${script.clip_number}: the take failed (${message.slice(0, 100)}). Trying once more…`);
        continue;
      }
      return { videoUrl: null, status: 'failed', issues: [...issues, message.slice(0, 300)], attempts, lastFrameUrl: null, promptUsed: prompt, modelUsed: VEO_MODEL, note: 'Render failed — regenerate manually.', continuityNote: '', measuredDurationS: 0 };
    }

    // Inspection — frames out, Opus verdict in.
    params.onNote(`Clip ${script.clip_number}: extracting frames for inspection…`);
    let midFrame = ''; let lastFrame = '';
    try { midFrame = await extractFrame(videoUrl, 0.4); } catch { /* inspection degrades */ }
    try { lastFrame = await extractFrame(videoUrl, 'end'); } catch { /* continuity degrades */ }

    params.onNote(`Clip ${script.clip_number}: the director is inspecting the take…`);
    const verdict = await inspectClip({
      plan, script, veoPrompt: prompt,
      frameUrls: [midFrame, lastFrame].filter(Boolean),
      previousFrameUrl: params.previousFrameUrl,
    });

    if (!verdict.accepted && attempt < MAX_ATTEMPTS) {
      issues = [...issues, ...(verdict.issues.length ? verdict.issues : [verdict.regenerate_reason || 'Rejected by inspection.'])];
      note = verdict.regenerate_reason || verdict.issues.join(' · ');
      prompt = verdict.adjusted_prompt?.trim()
        || `${assembleVeoPrompt(plan, script.duration_seconds, params.continuityNote)}\n[Fix]: ${(verdict.regenerate_reason || verdict.issues.join('; ')).slice(0, 220)}`;
      params.onNote(`Clip ${script.clip_number}: rejected (${note.slice(0, 120)}). Auto-regenerating once…`);
      continue;
    }

    // Accepted — or the retake ships regardless (never loop forever).
    status = attempt > 1 ? 'regenerated' : 'accepted';
    if (!verdict.accepted) {
      issues = [...issues, ...verdict.issues];
      note = 'Shipped after the maximum retakes — review and regenerate manually if needed.';
    } else if (attempt > 1) {
      note = 'Auto-regenerated once after inspection, then accepted.';
    }

    let continuity = '';
    if (lastFrame) {
      params.onNote(`Clip ${script.clip_number}: reading the end state for continuity…`);
      continuity = await continuityNoteFromFrame(lastFrame);
    }
    let measured = 0;
    try { measured = await probeClipDuration(videoUrl); } catch { /* planned duration stands */ }

    return { videoUrl, status, issues, attempts, lastFrameUrl: lastFrame || null, promptUsed: prompt, modelUsed: VEO_MODEL, note, continuityNote: continuity, measuredDurationS: measured };
  }

  // Unreachable, but keeps the type checker honest.
  return { videoUrl, status: 'failed', issues, attempts, lastFrameUrl: null, promptUsed: prompt, modelUsed: VEO_MODEL, note: 'Generation did not complete.', continuityNote: '', measuredDurationS: 0 };
}

// ---------------------------------------------------------------------------
// Overlay recording + final assembly for one ad (main ad or a variation)
// ---------------------------------------------------------------------------

export interface ResolvedClip {
  plan: ScenePlan;
  script: ScriptClip;
  videoUrl: string;
  durationS: number | null;
}

export async function assembleWithOverlays(params: {
  clips: ResolvedClip[];
  session: Pick<AdsSession, 'screenshots' | 'productImages' | 'generatedAssets' | 'logo' | 'offerCta' | 'aspect'>;
  reviewQuote: string;
  fileTag?: string;
  onProgress: (note: string, fraction: number) => void;
  onLog?: (line: string) => void;
}): Promise<AssemblyResult> {
  const { W, H } = adFrameSize(params.session.aspect);
  const ctx: OverlayContext = {
    screenshots: params.session.screenshots,
    productImages: params.session.productImages,
    generatedAssets: params.session.generatedAssets,
    logo: params.session.logo,
    offerCta: params.session.offerCta,
    reviewQuote: params.reviewQuote,
  };
  const assemblyClips: AssemblyClip[] = [];
  for (let i = 0; i < params.clips.length; i += 1) {
    const rc = params.clips[i];
    params.onProgress(`Recording overlays for clip ${i + 1} of ${params.clips.length}…`, (i / params.clips.length) * 0.35);
    let overlayBlob: Blob | null = null;
    try {
      const dur = Number(rc.durationS) || rc.script.duration_seconds;
      const built = await buildClipOverlay(rc.plan, rc.script, ctx, W, H, dur);
      if (built.hasContent) overlayBlob = await recordOverlay(built, W, H);
    } catch (e: any) {
      params.onProgress(`Clip ${i + 1}: the overlay could not be recorded (${String(e?.message || e).slice(0, 90)}) — shipping the plain clip.`, (i / params.clips.length) * 0.35);
    }
    assemblyClips.push({ clipNumber: rc.script.clip_number, url: rc.videoUrl, overlayBlob, durationS: rc.durationS });
  }
  return assembleAd(assemblyClips, params.session.aspect, {
    fileTag: params.fileTag,
    onLog: params.onLog,
    onProgress: (note, f) => params.onProgress(note, 0.35 + f * 0.65),
  });
}
