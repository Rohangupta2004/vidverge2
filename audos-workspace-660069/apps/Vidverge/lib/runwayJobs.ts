/**
 * AUDOS-NATIVE RUNWAY CLIENT.
 *
 * Every Runway Recipe is submitted through /api/generate/runway/*, the native
 * platform integration that owns the provider secret, workspace-wallet charge,
 * idempotency, task reconciliation and durable media storage. The browser never
 * calls api.runwayml.com and never needs a workspace RUNWAY_API_KEY.
 *
 * A vge_video_jobs row mirrors each native task so VidVerge can list the work
 * and recover the platform task id after a refresh. Polling only watches the
 * Audos task; stopping the watch never submits a replacement or discards it.
 */

import {
  attachRunwayTask,
  completeRunwayJob,
  createJob,
  failJob,
  getJob,
  tryStatus,
} from './jobs';
import type { VideoJob } from '../types';
import type { RunwayRecipeId } from './runway';
import {
  runwayCapabilities,
  runwayPoll,
  runwayQuote,
  runwaySubmitRecipe,
  statusText,
} from '../../../lib/runway';
import type { RunwayRecipeId as NativeRunwayRecipeId } from '../../../lib/runway';
import {
  sceneDurationLimits,
  sceneDurationLimitsFrom,
  validateSceneDurations,
} from '../../../lib/videoEngines';

export type JobPhase =
  | 'queued'
  | 'planning'
  | 'generating'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface DurableJob {
  jobId: string;
  status: string;
  phase: JobPhase;
  stageDetail: string | null;
  masterVideoUrl: string | null;
  errorMessage: string | null;
  lastError: string | null;
  attempts: number;
  maxAttempts: number;
  providerTaskId: string | null;
  sceneResults: Array<{ index: number; status: string; url?: string; error?: string }> | null;
  cancelRequested: boolean;
}

export const TERMINAL_PHASES: JobPhase[] = ['completed', 'failed', 'cancelled'];

export function isTerminal(phase: JobPhase): boolean {
  return TERMINAL_PHASES.indexOf(phase) >= 0;
}

export const PHASE_LABELS: Record<JobPhase, string> = {
  queued: 'Queued',
  planning: 'Planning the shots',
  generating: 'Generating',
  processing: 'Saving durable media',
  completed: 'Ready',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export class DurableJobError extends Error {
  code: string;
  constructor(message: string, code = 'runway_native_error') {
    super(message);
    this.name = 'DurableJobError';
    this.code = code;
  }
}

function phaseFromStatus(status: string): JobPhase {
  const value = String(status || '').toUpperCase();
  if (value === 'COMPLETED') return 'completed';
  if (value === 'FAILED') return 'failed';
  if (value === 'RENDERING' || value === 'AUDITING') return 'processing';
  if (value === 'INGESTING') return 'planning';
  if (value === 'QUEUED') return 'queued';
  return 'generating';
}

function toDurable(job: VideoJob, patch: Partial<DurableJob> = {}): DurableJob {
  return {
    jobId: job.id,
    status: job.status,
    phase: phaseFromStatus(job.status),
    stageDetail: null,
    masterVideoUrl: job.master_video_url,
    errorMessage: job.error_message || null,
    lastError: null,
    attempts: 1,
    maxAttempts: 1,
    providerTaskId: job.provider_task_id || null,
    sceneResults: job.scene_results || null,
    cancelRequested: false,
    ...patch,
  };
}

export interface RunwayAvailabilityVerdict {
  verdict: 'available' | 'generation-disabled' | 'provider-unavailable' | 'transient';
  ok: boolean;
  message: string;
}

/** Free native availability check. No provider work and no wallet charge. */
export async function checkRunwayNative(refresh = false): Promise<RunwayAvailabilityVerdict> {
  try {
    const caps = await runwayCapabilities({ refresh });
    if (caps.available) {
      return {
        verdict: 'available',
        ok: true,
        message: 'Audos native Runway generation is available for this workspace.',
      };
    }
    const reason = String(caps.reason || 'Audos native Runway generation is unavailable right now.');
    return {
      verdict: /generation[_ -]?disabled/i.test(reason) ? 'generation-disabled' : 'provider-unavailable',
      ok: false,
      message: reason,
    };
  } catch (error: any) {
    return {
      verdict: 'transient',
      ok: false,
      message: String(error?.message || error || 'The Audos Runway service could not be checked.'),
    };
  }
}

/** Backwards-compatible name; this checks the native platform, not BYOK. */
export type RunwayKeyVerdict = RunwayAvailabilityVerdict;
export const checkRunwayKey = checkRunwayNative;

export interface SubmitInput {
  jobId: string;
  recipeId: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
}

export interface SubmitResult {
  job: DurableJob;
  submitted: boolean;
  duplicate: boolean;
}

/** Submit once through Audos and persist the returned native task immediately. */
export async function submitRunwayJob(input: SubmitInput): Promise<SubmitResult> {
  const submission = await runwaySubmitRecipe(
    input.recipeId as NativeRunwayRecipeId,
    input.payload,
    { idempotencyKey: input.dedupeKey },
  );
  try {
    await attachRunwayTask({
      jobId: input.jobId,
      taskId: submission.taskId,
      recipeId: input.recipeId,
      payload: input.payload,
      dedupeKey: input.dedupeKey,
    });
  } catch (error) {
    console.warn('[vidverge] native Runway task metadata was not persisted', error);
  }
  const stored = await getJob(input.jobId).catch(() => null);
  const live = stored
    ? toDurable(stored)
    : {
      jobId: input.jobId,
      status: 'GENERATING_VISUALS',
      phase: 'generating' as JobPhase,
      stageDetail: null,
      masterVideoUrl: null,
      errorMessage: null,
      lastError: null,
      attempts: 1,
      maxAttempts: 1,
      providerTaskId: submission.taskId,
      sceneResults: null,
      cancelRequested: false,
    };
  return {
    job: {
      ...live,
      phase: 'generating',
      providerTaskId: submission.taskId,
      stageDetail: statusText(submission.status),
    },
    submitted: true,
    duplicate: false,
  };
}

export async function readRunwayJob(jobId: string): Promise<DurableJob | null> {
  const job = await getJob(jobId);
  return job ? toDurable(job) : null;
}

/** Audos exposes no cancel endpoint; this stops watching without killing work. */
export async function cancelRunwayJob(jobId: string): Promise<DurableJob | null> {
  const job = await readRunwayJob(jobId);
  return job ? { ...job, stageDetail: 'Stopped watching — the Audos task continues safely.' } : null;
}

export interface FollowOptions {
  onUpdate?: (job: DurableJob) => void;
  shouldStop?: () => boolean;
  intervalMs?: number;
  watchForMs?: number;
  /** Immediate submission state; recovery reads the same values from the job row. */
  taskId?: string;
  job?: DurableJob;
}

/** Poll the owned Audos task; media returned on success is already durable. */
export async function followRunwayJob(
  jobId: string,
  opts: FollowOptions = {},
): Promise<DurableJob | null> {
  const stored = await getJob(jobId).catch(() => null);
  if (!stored && !opts.job) return null;
  const base = stored ? toDurable(stored) : (opts.job as DurableJob);
  if (stored && (stored.status === 'COMPLETED' || stored.status === 'FAILED')) return base;
  const taskId = String(opts.taskId || base.providerTaskId || '');
  if (!taskId) throw new DurableJobError('This job has no Audos Runway task id to follow.', 'no_task');

  const signal = { cancelled: false };
  const stopTimer = window.setInterval(() => {
    if (opts.shouldStop?.()) signal.cancelled = true;
  }, Math.max(250, Math.min(1000, opts.intervalMs || 500)));

  try {
    const result = await runwayPoll(taskId, {
      signal,
      maxMs: opts.watchForMs ?? 45 * 60 * 1000,
      onStatus: (status) => {
        const phase: JobPhase = status === 'persisting' ? 'processing' : 'generating';
        const live = {
          ...base,
          status: status === 'persisting' ? 'RENDERING' : 'GENERATING_VISUALS',
          phase,
          providerTaskId: taskId,
          stageDetail: statusText(status),
        };
        opts.onUpdate?.(live);
        void tryStatus(jobId, status === 'persisting' ? 'RENDERING' : 'GENERATING_VISUALS');
      },
    });
    try {
      await completeRunwayJob(jobId, result.mediaUrls);
    } catch (error) {
      console.warn('[vidverge] native Runway completion was not mirrored to the job row', error);
    }
    const completed = await getJob(jobId).catch(() => null);
    const durableCompleted = completed ? toDurable(completed) : base;
    return {
      ...durableCompleted,
      status: 'COMPLETED',
      phase: 'completed',
      providerTaskId: taskId,
      masterVideoUrl: result.mediaUrls[0] || null,
      sceneResults: result.mediaUrls.map((url, index) => ({ index, status: 'completed', url })),
    };
  } catch (error: any) {
    if (signal.cancelled) {
      const live = await readRunwayJob(jobId);
      return live ? { ...live, stageDetail: 'Stopped watching — the Audos task continues safely.' } : null;
    }
    const code = String(error?.code || '');
    if (code === 'timeout' || code === 'network') {
      const live = await readRunwayJob(jobId);
      return live ? { ...live, stageDetail: String(error?.message || error) } : null;
    }
    await failJob(jobId, String(error?.message || error)).catch(() => undefined);
    throw error;
  } finally {
    window.clearInterval(stopTimer);
  }
}

export function dedupeKeyFor(jobId: string, payload: unknown): string {
  const text = JSON.stringify(payload ?? {});
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return `${jobId}:${(hash >>> 0).toString(36)}`;
}

export interface DurableRecipeInput {
  recipeId: RunwayRecipeId;
  payload: Record<string, unknown>;
  projectName: string;
  /** Reuse a row an enclosing pipeline already opened. */
  jobId?: string;
  rawPrompt?: string;
  sourceUrl?: string | null;
  aspectRatio?: string;
  targetDurationSec?: number;
  costEstimateUsd?: number;
  onUpdate?: (job: DurableJob) => void;
  isCancelled?: () => boolean;
}

export interface DurableRecipeResult {
  jobId: string;
  job: DurableJob;
  mediaUrls: string[];
}

function validateRecipeDuration(recipeId: RunwayRecipeId, payload: Record<string, unknown>): string {
  if (recipeId === 'multi_shot_video') {
    const shots = Array.isArray(payload.shots) ? payload.shots : [];
    if (!shots.length) return '';
    return validateSceneDurations(
      'gen4.5',
      shots.map((shot: any) => Number(shot?.duration)),
      {
        expectedTotalS: Number(payload.duration) || null,
        maxScenes: 5,
        limits: sceneDurationLimits('gen4.5'),
      },
    )[0] || '';
  }
  if (recipeId !== 'product_ad' && recipeId !== 'product_swap' && recipeId !== 'product_ugc') return '';
  const duration = Number(payload.duration);
  if (!duration) return '';
  const limits = sceneDurationLimitsFrom({
    modelId: recipeId,
    modelName: recipeId.replace(/_/g, ' '),
    minS: 4,
    maxS: 15,
    defaultS: recipeId === 'product_ugc' ? 15 : 8,
  });
  return validateSceneDurations(recipeId, [duration], { limits })[0] || '';
}

export async function runDurableRunwayRecipe(
  input: DurableRecipeInput,
): Promise<DurableRecipeResult> {
  const availability = await checkRunwayNative();
  if (!availability.ok) {
    throw new DurableJobError(availability.message, availability.verdict);
  }
  const durationProblem = validateRecipeDuration(input.recipeId, input.payload);
  if (durationProblem) throw new DurableJobError(durationProblem, 'validation');
  const quote = await runwayQuote({ recipeId: input.recipeId, ...input.payload });

  const duration = Math.max(1, Math.round(Number(input.targetDurationSec) || 1));
  const rawPrompt = String(input.rawPrompt || JSON.stringify(input.payload) || input.recipeId);
  const job = input.jobId
    ? await getJob(input.jobId)
    : await createJob({
      projectName: input.projectName,
      pipeline: 'RUNWAY_MULTI_SHOT',
      rawPrompt,
      sourceUrl: input.sourceUrl || null,
      aspectRatio: input.aspectRatio || '9:16',
      targetDurationSec: duration,
      costEstimateUsd: Math.max(0, Number(input.costEstimateUsd) || quote.usd || 0),
    });
  if (!job) throw new DurableJobError('The Runway job row could not be opened.', 'no_job');

  let submitted = false;
  try {
    const payloadKey = dedupeKeyFor(job.id, input.payload);
    const handoff = await submitRunwayJob({
      jobId: job.id,
      recipeId: input.recipeId,
      payload: input.payload,
      dedupeKey: payloadKey,
    });
    submitted = true;
    input.onUpdate?.(handoff.job);

    const final = await followRunwayJob(job.id, {
      onUpdate: input.onUpdate,
      shouldStop: input.isCancelled,
      taskId: handoff.job.providerTaskId || undefined,
      job: handoff.job,
    });
    if (!final || final.phase !== 'completed' || !final.masterVideoUrl) {
      throw new DurableJobError(
        final?.stageDetail || 'This Audos Runway task is still active. Check the job again rather than submitting a duplicate.',
        'pending',
      );
    }
    const mediaUrls = (final.sceneResults || [])
      .map((scene) => String(scene.url || ''))
      .filter((url) => /^https?:\/\//i.test(url));
    if (!mediaUrls.length && final.masterVideoUrl) mediaUrls.push(final.masterVideoUrl);
    return { jobId: job.id, job: final, mediaUrls };
  } catch (error) {
    if (!submitted) {
      await failJob(job.id, String((error as any)?.message || error)).catch(() => undefined);
    }
    throw error;
  }
}
