/**
 * JOB STORE — the engine's WorkspaceDB layer.
 *
 * Three tables back a run:
 *   vge_video_jobs    one row per job: pipeline, status, master URL, cost
 *   vge_job_scenes    one row per scene: frame range, narration, asset URL
 *   vge_audio_tokens  one row per spoken word: start_ms / end_ms
 *
 * Reads are session-scoped (the default), so a visitor sees their own jobs and
 * nobody else's. `shared: true` is deliberately NOT used here: these rows carry
 * a customer's prompts and finished videos, and a shared read returns every
 * column of every shared row to every visitor.
 *
 * `pipeline` and `status` model enums as text. JobStatus and PipelineId in
 * ../types are the lists that must stay in step with them — a row carrying a
 * value those types do not know is read back as its nearest valid neighbour
 * rather than crashing the list.
 */

import type { AudioToken, JobScene, JobStatus, PipelineId, VideoJob } from '../types';
import { EngineStageError, SESSION_NOT_READY } from './runtime';

export const JOBS_TABLE = 'vge_video_jobs';
export const SCENES_TABLE = 'vge_job_scenes';
export const TOKENS_TABLE = 'vge_audio_tokens';

/** Writing every word of a long narration is pointless — the captions only
 * ever read the first couple of minutes' worth. */
const MAX_TOKEN_ROWS = 900;

function db(): any {
  const client = typeof window === 'undefined' ? null : (window as any).__workspaceDb;
  if (!client) throw new EngineStageError(SESSION_NOT_READY, 'database');
  return client;
}

/**
 * The row out of a write result. The client returns the inserted row in a
 * `data` field that is sometimes the row and sometimes a single-element array,
 * so both shapes are unwrapped rather than one being assumed.
 */
function rowFrom(result: any): any {
  const payload = result?.data ?? result;
  return Array.isArray(payload) ? payload[0] : payload;
}

const KNOWN_PIPELINES: PipelineId[] = ['CODE_ENGINEERED', 'HYBRID_DOCUMENTARY', 'RUNWAY_MULTI_SHOT'];

/**
 * The live CHECK on vge_video_jobs.pipeline is still the two-value list the
 * table was created with — `CHECK (pipeline = ANY (ARRAY['CODE_ENGINEERED',
 * 'HYBRID_DOCUMENTARY']))` — so Postgres refuses every RUNWAY_MULTI_SHOT row
 * no matter who writes it. Widening it takes an ALTER TABLE, which no app,
 * hook or agent surface in this workspace can run. Until it is widened the
 * refusal is matched here and answered in words a customer can act on; the
 * raw "violates check constraint" text is not.
 */
const PIPELINE_REFUSED_BY_DB = /check constraint "vge_video_jobs_pipeline_check"/i;

function toPipeline(raw: any): PipelineId {
  const value = String(raw || '');
  return KNOWN_PIPELINES.indexOf(value as PipelineId) >= 0
    ? (value as PipelineId)
    : 'CODE_ENGINEERED';
}

function toJob(raw: any): VideoJob {
  return {
    id: String(raw?.id || ''),
    project_name: String(raw?.project_name || 'Untitled'),
    pipeline: toPipeline(raw?.pipeline),
    status: String(raw?.status || 'QUEUED') as JobStatus,
    aspect_ratio: String(raw?.aspect_ratio || '9:16'),
    target_duration_sec: Number(raw?.target_duration_sec) || 60,
    raw_prompt: String(raw?.raw_prompt || ''),
    source_url: raw?.source_url ? String(raw.source_url) : null,
    master_video_url: raw?.master_video_url ? String(raw.master_video_url) : null,
    cost_estimate_usd: raw?.cost_estimate_usd ?? null,
    provider_task_id: raw?.provider_task_id
      ? String(raw.provider_task_id)
      : raw?.provider_request?.nativeTaskId
        ? String(raw.provider_request.nativeTaskId)
        : null,
    recipe_id: raw?.recipe_id ? String(raw.recipe_id) : null,
    scene_results: Array.isArray(raw?.scene_results) ? raw.scene_results : null,
    error_message: raw?.error_message ? String(raw.error_message) : null,
    created_at: raw?.created_at ? String(raw.created_at) : undefined,
    updated_at: raw?.updated_at ? String(raw.updated_at) : undefined,
  };
}

export interface CreateJobInput {
  projectName: string;
  pipeline: PipelineId;
  rawPrompt: string;
  sourceUrl?: string | null;
  aspectRatio: string;
  targetDurationSec: number;
  costEstimateUsd: number;
}

/**
 * Open a job row. Every NOT-NULL column without a default is written as a
 * literal key: the publish-time lint reads this object statically and blocks
 * the publish if one is missing, and the runtime endpoint answers
 * `400 missing_required_columns` for the same reason.
 */
export async function createJob(input: CreateJobInput): Promise<VideoJob> {
  let result: any;
  try {
    result = await db().from(JOBS_TABLE).insert({
      project_name: input.projectName.slice(0, 160),
      pipeline: input.pipeline,
      status: 'QUEUED',
      aspect_ratio: input.aspectRatio,
      target_duration_sec: Math.round(input.targetDurationSec),
      raw_prompt: input.rawPrompt,
      source_url: input.sourceUrl || null,
      master_video_url: null,
      cost_estimate_usd: input.costEstimateUsd,
    });
  } catch (error: any) {
    if (PIPELINE_REFUSED_BY_DB.test(String(error?.message || error))) {
      console.error('[vidverge] vge_video_jobs.pipeline CHECK does not include', input.pipeline, error);
      throw new EngineStageError(
        `This workspace cannot store ${input.pipeline} jobs yet, so the job was not opened — nothing was generated and nothing was charged. The vge_video_jobs pipeline constraint has to list ${input.pipeline} before these ads can run.`,
        'database',
      );
    }
    throw error;
  }
  const job = toJob(rowFrom(result));
  if (!job.id) {
    throw new EngineStageError('The job could not be opened in the database. Try again.', 'database');
  }
  return job;
}

export async function setJobStatus(jobId: string, status: JobStatus): Promise<void> {
  await db().from(JOBS_TABLE).update(jobId, { status });
}

export async function completeJob(jobId: string, masterVideoUrl: string): Promise<void> {
  await db().from(JOBS_TABLE).update(jobId, { status: 'COMPLETED', master_video_url: masterVideoUrl });
}

/** Persist the Audos-native task immediately after a paid submission returns. */
export async function attachRunwayTask(input: {
  jobId: string;
  taskId: string;
  recipeId: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
}): Promise<void> {
  await db().from(JOBS_TABLE).update(input.jobId, {
    provider: 'runway-native',
    recipe_id: input.recipeId,
    provider_request: {
      nativeTaskId: input.taskId,
      recipeId: input.recipeId,
      payload: input.payload,
      dedupeKey: input.dedupeKey,
    },
    status: 'GENERATING_VISUALS',
    stage_detail: 'Audos accepted the Runway task — generating…',
    error_message: null,
  });
}

/** Save every durable platform output, not only the first campaign image. */
export async function completeRunwayJob(jobId: string, mediaUrls: string[]): Promise<void> {
  const rows = mediaUrls.map((url, index) => ({ index, status: 'completed', url }));
  await db().from(JOBS_TABLE).update(jobId, {
    status: 'COMPLETED',
    provider: 'runway-native',
    master_video_url: mediaUrls[0] || null,
    scene_results: rows,
    stage_detail: null,
    error_message: null,
  });
}

/**
 * Mark the job FAILED, carrying WHY when the caller knows. The message is what
 * "Your videos" and a reopened tracker show instead of a spinner that never
 * resolves — a timeout, an abort or a provider rejection all land here.
 */
export async function failJob(jobId: string, errorMessage?: string): Promise<void> {
  const patch: Record<string, unknown> = { status: 'FAILED' };
  const message = String(errorMessage || '').trim();
  if (message) patch.error_message = message.slice(0, 500);
  await db().from(JOBS_TABLE).update(jobId, patch);
}

export async function getJob(jobId: string): Promise<VideoJob | null> {
  const result = await db().from(JOBS_TABLE).getById(jobId);
  const raw = rowFrom(result);
  return raw?.id ? toJob(raw) : null;
}

/** This visitor's jobs, newest first. */
export async function listJobs(limit = 12): Promise<VideoJob[]> {
  const result = await db()
    .from(JOBS_TABLE)
    .orderBy('created_at', 'desc')
    .limit(limit)
    .get();
  const rows = Array.isArray(result?.data) ? result.data : [];
  return rows.map(toJob).filter((job: VideoJob) => Boolean(job.id));
}

export interface SceneInput {
  sceneIndex: number;
  startFrame: number;
  endFrame: number;
  narrationText: string;
  visualAssetUrl?: string | null;
}

export async function saveScenes(jobId: string, scenes: SceneInput[]): Promise<void> {
  if (!scenes.length) return;
  await db()
    .from(SCENES_TABLE)
    .bulkInsert(
      scenes.map((scene) => ({
        job_id: jobId,
        scene_index: scene.sceneIndex,
        start_frame: scene.startFrame,
        end_frame: scene.endFrame,
        narration_text: scene.narrationText,
        visual_asset_url: scene.visualAssetUrl || null,
      })),
    );
}

export async function listScenes(jobId: string): Promise<JobScene[]> {
  const result = await db()
    .from(SCENES_TABLE)
    .eq('job_id', jobId)
    .orderBy('scene_index', 'asc')
    .limit(200)
    .get();
  const rows = Array.isArray(result?.data) ? result.data : [];
  return rows.map((raw: any) => ({
    id: raw?.id ? String(raw.id) : undefined,
    job_id: String(raw?.job_id || jobId),
    scene_index: Number(raw?.scene_index) || 0,
    start_frame: Number(raw?.start_frame) || 0,
    end_frame: Number(raw?.end_frame) || 0,
    narration_text: String(raw?.narration_text || ''),
    visual_asset_url: raw?.visual_asset_url ? String(raw.visual_asset_url) : null,
  }));
}

export async function saveAudioTokens(jobId: string, tokens: AudioToken[]): Promise<void> {
  const rows = tokens.slice(0, MAX_TOKEN_ROWS).map((token) => ({
    job_id: jobId,
    word: token.word.slice(0, 100),
    start_ms: Math.max(0, Math.round(token.start_ms)),
    end_ms: Math.max(0, Math.round(token.end_ms)),
  }));
  if (!rows.length) return;
  await db().from(TOKENS_TABLE).bulkInsert(rows);
}

export async function listAudioTokens(jobId: string): Promise<AudioToken[]> {
  const result = await db()
    .from(TOKENS_TABLE)
    .eq('job_id', jobId)
    .orderBy('start_ms', 'asc')
    .limit(MAX_TOKEN_ROWS)
    .get();
  const rows = Array.isArray(result?.data) ? result.data : [];
  return rows.map((raw: any) => ({
    word: String(raw?.word || ''),
    start_ms: Number(raw?.start_ms) || 0,
    end_ms: Number(raw?.end_ms) || 0,
  }));
}

/**
 * Persisting progress must never be the thing that kills a run. A status write
 * that fails leaves the tracker on its last known stage — the pipeline itself
 * keeps going, and the master URL write at the end is the one that matters.
 */
export async function tryStatus(jobId: string, status: JobStatus): Promise<void> {
  try {
    await setJobStatus(jobId, status);
  } catch (error) {
    console.warn('[vidverge] job status not persisted', status, error);
  }
}
