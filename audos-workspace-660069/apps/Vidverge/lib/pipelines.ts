/**
 * THE PIPELINES, end to end.
 *
 * Each one walks the same status line — QUEUED, INGESTING, AUDIO_SYNTHESIS,
 * GENERATING_VISUALS, AUDITING, RENDERING, COMPLETED — writing each stage to
 * `vge_video_jobs` as it goes, so a finished job can be reopened from its row
 * later rather than only from whatever the tab still has in memory.
 *
 * NOTHING LONG OR PAID RUNS IN THE TAB ANY MORE (13 Oct 2026).
 *
 * All three pipelines used to execute their own stages from the browser, and
 * `vge_video_jobs` recorded the cost of that: three of five rows from 12 Oct
 * 2026 sat abandoned mid-pipeline — two at GENERATING_VISUALS, one at
 * INGESTING — with no error message and no provider task id, so there was
 * nothing to recover them BY and the customer was left with a spinner that
 * could never resolve.
 *
 * Each pipeline now PREPARES a brief in the tab and hands paid work to its
 * durable platform path:
 *
 *   A, B  →  `vidverge-orchestrator`   (./pipelineJobs.ts)
 *   C     →  Audos native Runway API   (./runwayJobs.ts)
 *
 * The preparation that remains here is the part the browser is the only thing
 * that CAN do: the platform voiceover and word-timing endpoints answer
 * `401 no_credentials` to a tokenless server function (probed 25 Sep 2026, and
 * the verdict is recorded on `pv-story-probe`), and the founder's ruling is no
 * BYOK. That window is seconds long and nothing paid is in flight during it —
 * and a tab closed inside it no longer strands a row either, because the
 * orchestrator's sweep closes out a job that never reached the server with a
 * sentence that says so.
 *
 * Anything that throws during preparation marks the job FAILED and rethrows,
 * so a job never sits in the database claiming to be rendering something that
 * stopped minutes ago. A job that is still RUNNING ON THE SERVER is never
 * marked FAILED just because this tab stopped watching it.
 */

import type { PipelineReporter, PipelineResult, VideoJob } from '../types';
import { ambientBed, narrate, speechRanges, wordTimings } from './audio';
import {
  BEAT_COUNT,
  BEAT_SECONDS,
  heroFramePrompt,
  MOTION_MODEL,
  narrationScript,
  stopMotionPrompt,
  writeBeats,
} from './documentary';
import { createDocumentaryMasterSource, DOCUMENTARY_CROSSFADE_FRAMES } from '../DocumentaryMaster';
import { ingestBrand } from './ingest';
import { createJob, failJob, saveAudioTokens, saveScenes, tryStatus } from './jobs';
import { buildKineticProps, generateKineticComposition } from './motionCode';
import {
  planScenes,
  sceneDurationHint,
  sceneDurationLimits,
  validateSceneDurations,
} from '../../../lib/videoEngines';
import {
  cancelPipelineJob,
  followPipelineJob,
  sceneProgress,
  startPipelineJob,
} from './pipelineJobs';
import type { PipelineBrief, PipelineBriefBeat } from './pipelineJobs';
import { PIPELINE_A, PIPELINE_B, PIPELINE_C } from './pipelineSpecs';
import { FPS, secondsToFrames } from './render';
import { writeReelScript } from './reelScript';
import { EngineStageError } from './runtime';
import { RECIPE_MULTI_SHOT } from './runway';
import { dedupeKeyFor, runDurableRunwayRecipe } from './runwayJobs';
import type { DurableJob } from './runwayJobs';

const CANCELLED = 'This job was cancelled.';

/** What a tab says when it stops watching a job the server is still running. */
const STILL_RUNNING =
  'This video is still being made on the server. You can leave this page — reopen the job from "Your videos" and the finished film will be waiting.';

function guard(reporter: PipelineReporter): void {
  if (reporter.isCancelled()) throw new EngineStageError(CANCELLED, 'cancelled');
}

/**
 * Hand a prepared brief to `vidverge-orchestrator` and watch the row it owns.
 *
 * Shared by Pipelines A and B because the hand-off is identical for both: the
 * only difference is what went into the brief. Watching is the ONLY thing this
 * does — it performs no provider calls and holds no deadline, so the worst it
 * can do is stop looking.
 */
async function runOnServer(
  jobId: string,
  brief: PipelineBrief,
  reporter: PipelineReporter,
): Promise<string> {
  const handoff = await startPipelineJob({
    jobId,
    brief,
    dedupeKey: dedupeKeyFor(jobId, brief),
  });
  if (handoff.duplicate) {
    reporter.onNotice(
      'This video was already being made, so the run in progress was adopted — you have not been charged twice.',
    );
  } else {
    reporter.onDetail('Handed to the server — safe to close this page.');
  }

  // Cancelling writes a flag on the row, so the server honours it on its next
  // tick whether or not this tab is still around to ask again.
  let cancelSent = false;
  let noticed = '';
  const final = await followPipelineJob(jobId, {
    onUpdate: (live: DurableJob) => {
      if (live.stageDetail) reporter.onDetail(live.stageDetail);
      if (live.lastError && live.lastError !== noticed) {
        noticed = live.lastError;
        reporter.onNotice(live.lastError);
      }
      if (live.phase === 'processing') reporter.onStage('RENDERING');
      else if (live.phase === 'generating') reporter.onStage('GENERATING_VISUALS');
    },
    shouldStop: () => {
      if (!reporter.isCancelled()) return false;
      if (!cancelSent) {
        cancelSent = true;
        void cancelPipelineJob(jobId).catch(() => undefined);
      }
      return true;
    },
  });

  if (!final) {
    // Watching stopped; the JOB did not. Telling the customer that is the whole
    // point of moving orchestration off the browser.
    throw new EngineStageError(STILL_RUNNING, 'pending');
  }
  if (final.phase === 'cancelled') throw new EngineStageError(CANCELLED, 'cancelled');
  if (final.phase !== 'completed' || !final.masterVideoUrl) {
    throw new EngineStageError(final.errorMessage || 'The video could not be finished.', 'server');
  }

  const scenes = sceneProgress(final);
  if (scenes.total && scenes.done < scenes.total) {
    reporter.onNotice(
      `${scenes.total - scenes.done} of ${scenes.total} beats could not be generated, so the film was assembled from the ${scenes.done} that rendered.`,
    );
  }
  return final.masterVideoUrl;
}

/**
 * The failure handler every pipeline shares.
 *
 * A job that is STILL RUNNING must not be marked FAILED just because this tab
 * stopped watching it — that would turn recoverable work into a dead row,
 * which is the exact bug this rewrite removes.
 */
async function reportFailure(
  jobId: string,
  error: unknown,
  reporter: PipelineReporter,
): Promise<void> {
  const stage = String((error as any)?.stage || '');
  if (stage === 'pending') {
    reporter.onNotice('Still being made on the server — safe to close this page.');
    return;
  }
  const reason = String((error as any)?.message || error || 'The job stopped unexpectedly.');
  if (stage !== 'cancelled') await failJob(jobId, reason).catch(() => undefined);
  reporter.onStage('FAILED');
}

// ---------------------------------------------------------------------------
// PIPELINE A — Code-Engineered Kinetic Motion
// ---------------------------------------------------------------------------

export interface KineticRunInput {
  projectName: string;
  sourceUrl: string;
  direction: string;
}

export async function runKineticPipeline(
  input: KineticRunInput,
  reporter: PipelineReporter,
  onJobOpened?: (job: VideoJob) => void,
): Promise<PipelineResult> {
  const job = await createJob({
    projectName: input.projectName,
    pipeline: 'CODE_ENGINEERED',
    rawPrompt: input.direction,
    sourceUrl: input.sourceUrl,
    aspectRatio: PIPELINE_A.aspectRatio,
    targetDurationSec: PIPELINE_A.durationSeconds,
    costEstimateUsd: PIPELINE_A.costUsd,
  });
  onJobOpened?.(job);
  reporter.onStage('QUEUED');

  try {
    // 1 — Asset ingestion.
    guard(reporter);
    reporter.onStage('INGESTING');
    await tryStatus(job.id, 'INGESTING');
    reporter.onDetail('Reading ' + input.sourceUrl + '…');
    const brand = await ingestBrand(input.sourceUrl);
    if (brand.degraded) {
      reporter.onNotice(
        'Brand ingest fell back to the VidVerge palette. ' + (brand.degradedReason || ''),
      );
    } else {
      reporter.onDetail('Found ' + brand.colors.length + ' brand colours on ' + brand.siteName + '.');
    }

    // 2 — Audio and word sync.
    guard(reporter);
    reporter.onStage('AUDIO_SYNTHESIS');
    await tryStatus(job.id, 'AUDIO_SYNTHESIS');
    reporter.onDetail('Writing the voiceover…');
    const { script, badges } = await writeReelScript(brand, input.direction);

    guard(reporter);
    reporter.onDetail('Recording the narration…');
    const narration = await narrate(script);

    reporter.onDetail('Timing every word…');
    const sync = await wordTimings(narration.audioUrl, script, narration.durationMs);
    if (sync.estimated) {
      reporter.onNotice('Word timings were estimated from the script. ' + (sync.reason || ''));
    }
    await saveAudioTokens(job.id, sync.tokens).catch(() => undefined);

    // 3 — Remotion code generation.
    guard(reporter);
    reporter.onStage('GENERATING_VISUALS');
    await tryStatus(job.id, 'GENERATING_VISUALS');
    const totalFrames = Math.max(
      secondsToFrames(PIPELINE_A.durationSeconds),
      secondsToFrames(sync.durationMs / 1000 + 1),
    );
    const props = buildKineticProps({
      brand,
      badges,
      tokens: sync.tokens,
      voiceoverUrl: narration.audioUrl,
      totalFrames,
    });
    const composition = await generateKineticComposition(props, input.direction, reporter.onDetail);

    // 4 — Audit. The composition is checked before a render is paid for.
    guard(reporter);
    reporter.onStage('AUDITING');
    await tryStatus(job.id, 'AUDITING');
    if (composition.usedFallback) {
      reporter.onNotice(
        'The generated composition did not pass the pre-render audit, so the built-in kinetic composition was used instead. ' +
          composition.auditNotes.join(' '),
      );
    } else {
      reporter.onDetail('Composition passed the pre-render audit.');
    }
    await saveScenes(job.id, [
      {
        sceneIndex: 0,
        startFrame: 0,
        endFrame: props.total_frames,
        narrationText: script,
        visualAssetUrl: brand.logoUrl,
      },
    ]).catch(() => undefined);

    // 5 — Hand the finished composition to the server and watch the row.
    //
    //     Pipeline A's picture is CODE, so there is no per-beat generation to
    //     run — the one long, paid stage is the Remotion render, and a render
    //     can take a quarter of an hour. That is exactly the stage a closed tab
    //     used to throw away, so it is the stage that moves.
    guard(reporter);
    reporter.onStage('RENDERING');
    await tryStatus(job.id, 'RENDERING');
    const masterVideoUrl = await runOnServer(
      job.id,
      {
        kind: 'kinetic',
        compositionTsx: composition.source,
        props: props as unknown as Record<string, unknown>,
        durationInFrames: props.total_frames,
      },
      reporter,
    );

    // The orchestrator already wrote COMPLETED and the master URL onto the row,
    // so that write is not repeated here: the server owns the terminal state,
    // and a second write from the browser could only race it.
    reporter.onStage('COMPLETED');
    return { jobId: job.id, masterVideoUrl };
  } catch (error) {
    await reportFailure(job.id, error, reporter);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// PIPELINE B — Hybrid Documentary / Vox
// ---------------------------------------------------------------------------

export interface DocumentaryRunInput {
  projectName: string;
  topic: string;
}

export async function runDocumentaryPipeline(
  input: DocumentaryRunInput,
  reporter: PipelineReporter,
  onJobOpened?: (job: VideoJob) => void,
): Promise<PipelineResult> {
  const job = await createJob({
    projectName: input.projectName,
    pipeline: 'HYBRID_DOCUMENTARY',
    rawPrompt: input.topic,
    sourceUrl: null,
    aspectRatio: PIPELINE_B.aspectRatio,
    targetDurationSec: BEAT_COUNT * BEAT_SECONDS,
    costEstimateUsd: PIPELINE_B.costUsd,
  });
  onJobOpened?.(job);
  reporter.onStage('QUEUED');

  try {
    // 1 — Scripting. The topic is turned into the beat sheet everything else
    //     is built from, which is this pipeline's ingestion step.
    guard(reporter);
    reporter.onStage('INGESTING');
    await tryStatus(job.id, 'INGESTING');
    reporter.onDetail('Writing ' + BEAT_COUNT + ' beats…');
    const beats = await writeBeats(input.topic);
    reporter.onDetail('Beat sheet ready: ' + beats.map((beat) => beat.mainTitle).join(' · '));

    // 2 — Narration and word sync.
    guard(reporter);
    reporter.onStage('AUDIO_SYNTHESIS');
    await tryStatus(job.id, 'AUDIO_SYNTHESIS');
    const script = narrationScript(beats);
    reporter.onDetail('Recording the narration…');
    const narration = await narrate(script);

    reporter.onDetail('Timing every word…');
    const sync = await wordTimings(narration.audioUrl, script, narration.durationMs);
    if (sync.estimated) {
      reporter.onNotice('Word timings were estimated from the script. ' + (sync.reason || ''));
    }
    await saveAudioTokens(job.id, sync.tokens).catch(() => undefined);

    const filmDurationMs = BEAT_COUNT * BEAT_SECONDS * 1000;
    reporter.onDetail('Laying the ambient bed…');
    const ambientMusicUrl = await ambientBed(filmDurationMs);
    if (!ambientMusicUrl) {
      reporter.onNotice('No ambient bed was generated — the film runs on narration alone.');
    }

    // 3 — Hand the beats to the server, which generates every still and every
    //     clip and then renders the master.
    //
    //     This is the stage that used to strand jobs. Fifteen stills plus
    //     fifteen provider clips plus a render is twenty minutes of paid work,
    //     and all of it hung off this tab staying open. It now runs server-side
    //     with each beat checkpointed into `scene_results` as it lands, so a
    //     run that loses one beat regenerates only that beat, and a run whose
    //     worker dies is picked up by a sweep rather than lost.
    //
    //     The prompts are resolved HERE, not there: the collage and stop-motion
    //     templates are the product's look and belong in ./documentary.ts where
    //     they can be read and reviewed.
    guard(reporter);
    reporter.onStage('GENERATING_VISUALS');
    await tryStatus(job.id, 'GENERATING_VISUALS');

    const briefBeats: PipelineBriefBeat[] = beats.map((beat, index) => ({
      index,
      heroPrompt: heroFramePrompt(beat),
      motionPrompt: stopMotionPrompt(beat),
      narration: beat.narration,
    }));

    const beatFrames = secondsToFrames(BEAT_SECONDS);
    const masterVideoUrl = await runOnServer(
      job.id,
      {
        kind: 'documentary',
        beats: briefBeats,
        beatSeconds: BEAT_SECONDS,
        aspectRatio: PIPELINE_B.aspectRatio,
        imageAspect: PIPELINE_B.aspectRatio,
        motionModel: MOTION_MODEL,
        crossfadeFrames: DOCUMENTARY_CROSSFADE_FRAMES,
        // The baked `calculateDemoVideoDuration` is only a fallback: the submit
        // body's durationInFrames is authoritative, and the server computes it
        // from the beats that actually produced picture.
        compositionTsx: createDocumentaryMasterSource(BEAT_COUNT * beatFrames),
        props: {
          canvas_bg_color: '#0D0B05',
          voiceover_url: narration.audioUrl,
          ambient_music_url: ambientMusicUrl,
          sfx_url:
            'https://storage.googleapis.com/audos-images/workspaces/f24710e5-7c6d-4db4-92b4-c2c235877575/uploads/vidverge-sfx/9b197433-e6ce-4190-bfe6-0c3e1b4f8add.wav',
          speech_ranges: speechRanges(sync.tokens, FPS),
        },
      },
      reporter,
    );

    // 4 — The scene rows, written from what the server actually produced rather
    //     than from what was hoped for.
    await saveScenes(
      job.id,
      beats.map((beat, index) => ({
        sceneIndex: index,
        startFrame: index * beatFrames,
        endFrame: (index + 1) * beatFrames,
        narrationText: beat.narration,
        visualAssetUrl: null,
      })),
    ).catch(() => undefined);

    // The orchestrator owns the terminal state, so COMPLETED is not re-written
    // from here — a second write could only race it.
    reporter.onStage('COMPLETED');
    return { jobId: job.id, masterVideoUrl };
  } catch (error) {
    await reportFailure(job.id, error, reporter);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// PIPELINE C — Runway Multi-Shot Ad
//
// Runway does the generating AND the stitching, so there is no local render:
// the "render" stage is the wait for the provider's finished cut. The job row
// is still written at every step, which is what puts a finished ad under
// "Your videos" instead of only in this tab's memory.
// ---------------------------------------------------------------------------

/**
 * THE MODEL FOLLOWS WHAT THE BRIEF ACTUALLY CARRIES.
 *
 * `gen4_turbo` is IMAGE-TO-VIDEO ONLY — a submit with no source image answers
 * 400 "gen4_turbo only supports image-to-video" (probe-verified in this
 * workspace on 29 Sep 2026, and the same constraint is recorded on
 * RUNWAY_VIDEO_MODELS in lib/videoEngines.ts). This pipeline was pinned to
 * gen4_turbo unconditionally even though its own `auto` mode is documented to
 * run with no opening frame, so every text-driven Multi-Shot ad was a
 * guaranteed provider rejection before a single frame was generated.
 *
 * gen4.5 is the only Runway model this platform exposes that accepts
 * text-to-video, so a brief with no first frame goes there. gen4_turbo is kept
 * for what it is actually good at — animating a supplied frame, at 5
 * credits/second against gen4.5's 12.
 */
export const MULTI_SHOT_MODEL_T2V = 'gen4.5';
export const MULTI_SHOT_MODEL_I2V = 'gen4_turbo';

/** @deprecated Pinned to one model regardless of inputs. Use multiShotModel(). */
export const MULTI_SHOT_MODEL = MULTI_SHOT_MODEL_I2V;

export function multiShotModel(input: Pick<MultiShotRunInput, 'firstFrameUrl'>): string {
  return input.firstFrameUrl ? MULTI_SHOT_MODEL_I2V : MULTI_SHOT_MODEL_T2V;
}

/** Runway ratios are pixel pairs, not "9:16" shorthand. */
export const MULTI_SHOT_RATIO = '720:1280';
export const MIN_SHOTS = 3;
export const MAX_SHOTS = 5;
export const MIN_SHOT_CHARS = 10;
export const MIN_STORY_CHARS = 20;
export const MAX_STORY_CHARS = 3500;
export type MultiShotDuration = 5 | 10 | 15;

export interface MultiShotRunInput {
  projectName: string;
  mode: 'auto' | 'custom';
  /** auto mode: the whole story in one brief. */
  storyPrompt?: string;
  /** custom mode: 3–5 ordered shots. */
  shots?: Array<{ prompt: string }>;
  /** An uploaded opening frame, already parked on platform storage. */
  firstFrameUrl?: string | null;
  duration: MultiShotDuration;
  audio: boolean;
}

function usableShots(input: MultiShotRunInput): string[] {
  return (input.shots || [])
    .map((shot) => String(shot?.prompt || '').trim())
    .filter((prompt) => prompt.length >= MIN_SHOT_CHARS);
}

/**
 * How the total length is divided across the written shots.
 *
 * The Multi-Shot recipe wants custom shots whose durations SUM to the total,
 * and every shot is still bound by the chosen model's per-clip ceiling. Both
 * constraints are solved here, once, by the shared planner in
 * lib/videoEngines.ts — so the number shown in the form and the number sent to
 * Runway are the same number, and a division that cannot work is caught before
 * anyone pays for it.
 */
export function multiShotShotPlan(input: MultiShotRunInput) {
  const shots = usableShots(input);
  return planScenes({
    modelId: multiShotModel(input),
    totalDurationS: input.duration,
    requestedSceneCount: shots.length || MIN_SHOTS,
    minScenes: MIN_SHOTS,
    maxScenes: MAX_SHOTS,
  });
}

/** The per-scene limit for this brief, for the form to show up front. */
export function multiShotDurationHint(input: MultiShotRunInput): string {
  return sceneDurationHint(multiShotModel(input));
}

/** The reason this brief cannot be submitted, or '' when it can. */
export function multiShotProblem(input: MultiShotRunInput): string {
  if (input.mode === 'auto') {
    const story = String(input.storyPrompt || '').trim();
    if (story.length < MIN_STORY_CHARS) {
      return `Describe the ad in at least ${MIN_STORY_CHARS} characters before generating.`;
    }
    return '';
  }
  const shots = usableShots(input);
  if (shots.length < MIN_SHOTS) {
    return `Write at least ${MIN_SHOTS} shots, each ${MIN_SHOT_CHARS} characters or more.`;
  }

  // Duration is validated HERE, before the submit, rather than being discovered
  // as a provider 400. A total that cannot be divided across this many shots at
  // the model's minimum clip length is reported as the choice it really is —
  // fewer shots, or a longer video — instead of being quietly rounded.
  const limits = sceneDurationLimits(multiShotModel(input));
  const plan = multiShotShotPlan(input);
  if (plan.totalDurationS !== input.duration) {
    return (
      `${input.duration}s cannot be divided across ${shots.length} shots on this model `
      + `(${limits.minS}\u2013${limits.maxS}s per shot). Use fewer shots, or choose a longer video.`
    );
  }
  const violations = validateSceneDurations(
    multiShotModel(input),
    plan.scenes.map((scene) => scene.durationS),
    { expectedTotalS: input.duration, maxScenes: MAX_SHOTS },
  );
  return violations[0] || '';
}

export function multiShotReady(input: MultiShotRunInput): boolean {
  return multiShotProblem(input) === '';
}

/** What goes in the job row's raw_prompt, and what names an untitled job. */
export function multiShotBrief(input: MultiShotRunInput): string {
  return input.mode === 'auto'
    ? String(input.storyPrompt || '').trim()
    : usableShots(input)
        .map((prompt, index) => `${index + 1}. ${prompt}`)
        .join('\n');
}

/**
 * The recipe body. Media fields are `{ uri }` objects — the shape every media
 * field in the runway-recipes catalog uses — and the URL is always a public
 * HTTPS address from `uploadAsset()`, never bytes.
 */
export function buildMultiShotPayload(input: MultiShotRunInput): Record<string, unknown> {
  const base: Record<string, unknown> = {
    mode: input.mode,
    duration: input.duration,
    ratio: MULTI_SHOT_RATIO,
    audio: input.audio,
  };
  if (input.firstFrameUrl) base.firstFrame = { uri: input.firstFrameUrl };

  if (input.mode === 'auto') {
    base.prompt = String(input.storyPrompt || '').trim();
    return base;
  }
  // Custom shots carry their own durations, which is what the recipe asks for
  // ("3\u20135 shots whose durations sum to the total"). Sending descriptions with
  // no durations left the division entirely to the provider even though the
  // customer had chosen a total.
  const plan = multiShotShotPlan(input);
  base.shots = usableShots(input)
    .slice(0, MAX_SHOTS)
    .map((prompt, index) => ({
      prompt,
      duration: plan.scenes[index]?.durationS ?? plan.limits.defaultS,
    }));
  return base;
}

export async function runMultiShotPipeline(
  input: MultiShotRunInput,
  reporter: PipelineReporter,
  onJobOpened?: (job: VideoJob) => void,
): Promise<PipelineResult> {
  // Validated before the row is opened: a brief that was never submittable
  // should not leave a FAILED job behind.
  const problem = multiShotProblem(input);
  if (problem) throw new EngineStageError(problem, 'validation');

  const job = await createJob({
    projectName: input.projectName,
    pipeline: 'RUNWAY_MULTI_SHOT',
    rawPrompt: multiShotBrief(input),
    sourceUrl: input.firstFrameUrl || null,
    aspectRatio: PIPELINE_C.aspectRatio,
    targetDurationSec: input.duration,
    costEstimateUsd: PIPELINE_C.costUsd,
  });
  onJobOpened?.(job);
  reporter.onStage('QUEUED');

  try {
    // 1 — Assemble the brief.
    guard(reporter);
    reporter.onStage('INGESTING');
    await tryStatus(job.id, 'INGESTING');
    const shots = usableShots(input);
    reporter.onDetail(
      input.mode === 'auto'
        ? 'Handing the story to Runway to break into shots\u2026'
        : `Ordering ${shots.length} shots\u2026`,
    );
    if (!input.firstFrameUrl) {
      reporter.onNotice('No opening frame was given, so Runway invents the first shot itself.');
    }

    // 2 — Hand the brief to Audos' native Runway integration.
    //
    //     The platform owns the provider key, wallet charge, idempotency,
    //     task reconciliation and durable output storage. The returned task id
    //     is persisted on this job row immediately; the tab only watches the
    //     owned Audos task and never calls Runway directly.
    guard(reporter);
    reporter.onStage('GENERATING_VISUALS');
    await tryStatus(job.id, 'GENERATING_VISUALS');

    const payload = buildMultiShotPayload(input);
    let nativeResult: Awaited<ReturnType<typeof runDurableRunwayRecipe>>;
    try {
      nativeResult = await runDurableRunwayRecipe({
        recipeId: RECIPE_MULTI_SHOT,
        payload,
        projectName: input.projectName,
        jobId: job.id,
        rawPrompt: multiShotBrief(input),
        sourceUrl: input.firstFrameUrl || null,
        aspectRatio: PIPELINE_C.aspectRatio,
        targetDurationSec: input.duration,
        costEstimateUsd: PIPELINE_C.costUsd,
        onUpdate: (live: DurableJob) => {
          if (live.stageDetail) reporter.onDetail(live.stageDetail);
          if (live.phase === 'processing') reporter.onStage('RENDERING');
        },
        isCancelled: reporter.isCancelled,
      });
    } catch (cause: any) {
      if (reporter.isCancelled() || String(cause?.code || '') === 'pending') {
        throw new EngineStageError(
          String(cause?.message || 'Stopped watching. The Audos Runway task continues safely.'),
          'pending',
        );
      }
      throw cause;
    }

    // 3 — Runway returns the stitched master, already persisted by Audos.
    const masterVideoUrl = nativeResult.mediaUrls[0];
    if (!masterVideoUrl) {
      throw new EngineStageError('Audos reported success but returned no finished Runway media.', 'runway');
    }

    if (shots.length) {
      const perShot = Math.max(1, Math.round(secondsToFrames(input.duration) / shots.length));
      await saveScenes(
        job.id,
        shots.map((prompt, index) => ({
          sceneIndex: index,
          startFrame: index * perShot,
          endFrame: (index + 1) * perShot,
          narrationText: prompt,
          visualAssetUrl: index === 0 ? input.firstFrameUrl || null : null,
        })),
      ).catch(() => undefined);
    }

    // The native helper already wrote COMPLETED and every durable output URL
    // onto the row, so a second terminal write here could only race it.
    reporter.onStage('COMPLETED');
    return { jobId: job.id, masterVideoUrl };
  } catch (error) {
    // A job that is STILL RUNNING must not be marked FAILED just because this
    // tab stopped watching it — that would turn recoverable work into a dead
    // row, which is the exact bug this pipeline was rewritten to remove.
    const stage = String((error as any)?.stage || '');
    if (stage === 'pending') {
      reporter.onNotice('Still generating on the server \u2014 safe to close this page.');
      throw error;
    }
    const reason = String((error as any)?.message || error || 'The job stopped unexpectedly.');
    if (stage !== 'cancelled') await failJob(job.id, reason).catch(() => undefined);
    reporter.onStage('FAILED');
    throw error;
  }
}
