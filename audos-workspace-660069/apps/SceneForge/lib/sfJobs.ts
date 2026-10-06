// Durable job tracking for every HeyGen job the suite submits.
//
// WHY A DATABASE ROW AND NOT JUST POLLING. A render outlives the tab. A
// customer who submits a three-scene batch and closes the laptop should come
// back to finished videos, not a lost spinner. So every submission writes a
// row first, HeyGen's callback lands on the `sceneforge-heygen-webhook`
// server function, and the function writes the terminal status and URL onto
// that row. The app then watches the row.
//
// WHY IT STILL POLLS HEYGEN TOO. The callback can only arrive if HeyGen can
// reach this space's origin — which is not true of an unpublished draft
// preview, and not guaranteed on any given network. `trackJob` therefore
// races the row against a direct HeyGen status read and takes whichever
// answers first. The webhook makes completion instant when it works; the
// direct read means the job ALWAYS finishes either way. Neither path is
// presented to the customer as the special case.
//
// WHERE THE ROWS LIVE. `vv_heygen_renders` is already SceneForge's HeyGen
// render table — the Motion Graphics Editor keys its layer stack off the same
// unique `video_id`. Job rows join it rather than duplicating it, tagged with
// `app` and the `job_type` / `job_metadata` / `batch_id` columns added for the
// suite, so one render has ONE row no matter which surface opened it.
import { HeyGenError } from './heygenStudio';

export const JOB_TABLE = 'vv_heygen_renders';
export const JOB_APP = 'sceneforge-heygen-suite';

export type JobType =
  | 'video_agent'
  | 'avatar_video'
  | 'lipsync'
  | 'translation'
  | 'hyperframe'
  | 'clipping'
  | 'music'
  | 'sfx'
  | 'filler_removal';

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface JobRow {
  id: number | null;
  videoId: string;
  jobType: JobType | '';
  status: JobStatus;
  videoUrl: string;
  thumbnailUrl: string;
  error: string;
  batchId: string;
  metadata: Record<string, unknown>;
}

function client(): any {
  const db = (window as any).__workspaceDb;
  if (!db) throw new Error('SceneForge needs the workspace data runtime. Refresh and try again.');
  return db;
}

/** True when the workspace data runtime is present at all. */
export function jobsAvailable(): boolean {
  return Boolean((window as any).__workspaceDb);
}

function rowView(row: any): JobRow | null {
  if (!row) return null;
  return {
    id: Number(row.id) || null,
    videoId: String(row.video_id || ''),
    jobType: (row.job_type || '') as JobType | '',
    status: (String(row.status || 'pending') as JobStatus),
    videoUrl: String(row.video_url || ''),
    thumbnailUrl: String(row.thumbnail_url || ''),
    error: String(row.error_text || ''),
    batchId: String(row.batch_id || ''),
    metadata: (row.job_metadata && typeof row.job_metadata === 'object' ? row.job_metadata : {}) as Record<string, unknown>,
  };
}

export interface RecordJobInput {
  /** HeyGen's id for the job. Doubles as the row key. */
  videoId: string;
  jobType: JobType;
  metadata?: Record<string, unknown>;
  batchId?: string;
  /** Context the Motion Editor also reads off this row. */
  script?: string;
  avatarId?: string;
  avatarName?: string;
  voiceId?: string;
  voiceName?: string;
  aspectRatio?: string;
}

/**
 * Write the submission row.
 *
 * Never throws into the caller's generation flow: a failed bookkeeping write
 * must not lose a render the customer has already paid for. The failure is
 * logged and the caller falls back to direct polling, which is why `trackJob`
 * tolerates a missing row.
 */
export async function recordJob(input: RecordJobInput): Promise<JobRow | null> {
  if (!input.videoId || !jobsAvailable()) return null;
  try {
    const result = await client().from(JOB_TABLE).insert({
      video_id: input.videoId,
      // The NOT NULL columns this table has carried since the Avatar Studio
      // shipped. A job that has no script (a translation, a clipping pass)
      // still has to satisfy them, so they are written as empty strings
      // rather than left out.
      api_version: 'v3',
      script: input.script || '',
      avatar_id: input.avatarId || '',
      avatar_name: input.avatarName || '',
      voice_id: input.voiceId || null,
      voice_name: input.voiceName || null,
      app: JOB_APP,
      job_type: input.jobType,
      job_metadata: input.metadata || {},
      batch_id: input.batchId || null,
      aspect_ratio: input.aspectRatio || null,
      status: 'processing',
    });
    return rowView(result?.data?.[0] || result?.data || null);
  } catch (e) {
    console.warn('[SceneForge] The HeyGen job row could not be written; falling back to direct polling.', e);
    return null;
  }
}

/** Read one job row by its HeyGen id. */
export async function readJob(videoId: string): Promise<JobRow | null> {
  if (!videoId || !jobsAvailable()) return null;
  try {
    const result = await client().from(JOB_TABLE).eq('video_id', videoId).limit(1).get();
    return rowView(result?.data?.[0] || null);
  } catch { return null; }
}

/** Every row of one batch, for the per-scene progress tracker. */
export async function readBatch(batchId: string): Promise<JobRow[]> {
  if (!batchId || !jobsAvailable()) return [];
  try {
    const result = await client().from(JOB_TABLE).eq('batch_id', batchId).get();
    return ((result?.data || []) as any[]).map(rowView).filter(Boolean) as JobRow[];
  } catch { return []; }
}

/** The suite's recent jobs, newest first. */
export async function recentJobs(limit = 20): Promise<JobRow[]> {
  if (!jobsAvailable()) return [];
  try {
    const result = await client().from(JOB_TABLE).eq('app', JOB_APP).orderBy('created_at', 'desc').limit(limit).get();
    return ((result?.data || []) as any[]).map(rowView).filter(Boolean) as JobRow[];
  } catch { return []; }
}

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export interface TrackOptions {
  /** Direct HeyGen read, used as the fallback when no callback arrives. */
  direct?: () => Promise<{ status: string; videoUrl: string; error: string }>;
  onTick?: (elapsedSec: number, source: 'webhook' | 'heygen') => void;
  intervalMs?: number;
  timeoutMs?: number;
  label?: string;
}

export interface TrackResult {
  videoUrl: string;
  /** Which path actually reported the finish — useful in the console. */
  source: 'webhook' | 'heygen';
}

const DONE = /^(completed|complete|success|succeeded|done|ready|finished)$/;
const FAILED = /^(failed|error|cancell?ed|rejected)$/;

/**
 * Follow a job to its finished URL.
 *
 * Each cycle reads the database row (cheap, and already carries the answer
 * when the webhook fired) and then, if the row has not resolved, asks HeyGen
 * directly. The direct read is what guarantees progress on a draft preview
 * origin HeyGen cannot call back into.
 */
export async function trackJob(videoId: string, options: TrackOptions = {}): Promise<TrackResult> {
  const interval = Math.max(2000, options.intervalMs || 5000);
  const timeout = Math.max(interval * 3, options.timeoutMs || 20 * 60 * 1000);
  const label = options.label || 'This job';
  const started = Date.now();
  let directMisses = 0;

  for (;;) {
    if (Date.now() - started > timeout) {
      throw new HeyGenError(`${label} did not finish within ${Math.round(timeout / 60000)} minutes. It may still complete in HeyGen — check Recent jobs.`);
    }

    const row = await readJob(videoId);
    if (row) {
      if (DONE.test(row.status) && row.videoUrl) return { videoUrl: row.videoUrl, source: 'webhook' };
      if (FAILED.test(row.status)) throw new HeyGenError(row.error || `${label} failed in HeyGen.`);
    }

    if (options.direct) {
      try {
        const status = await options.direct();
        directMisses = 0;
        if (DONE.test(String(status.status).toLowerCase()) && status.videoUrl) {
          // The callback never came (or came late). Reconcile the row so
          // Recent jobs and the Motion Editor agree with what the customer
          // is looking at.
          void reconcile(videoId, 'completed', status.videoUrl, '');
          return { videoUrl: status.videoUrl, source: 'heygen' };
        }
        if (FAILED.test(String(status.status).toLowerCase())) {
          void reconcile(videoId, 'failed', '', status.error);
          throw new HeyGenError(status.error || `${label} failed in HeyGen.`);
        }
      } catch (e) {
        if (e instanceof HeyGenError && /failed in HeyGen/.test(e.message)) throw e;
        directMisses += 1;
        // A dropped status read is a hiccup. The job is only abandoned when
        // the direct read has failed repeatedly AND the row never resolved.
        if (directMisses >= 6) throw e;
      }
    }

    options.onTick?.(Math.round((Date.now() - started) / 1000), row ? 'webhook' : 'heygen');
    await sleep(interval);
  }
}

/**
 * Write back a terminal state the app observed directly.
 *
 * `status` and `video_url` are browser-writable on this table (the Avatar
 * Studio has always written them), so this is a plain update. It is
 * best-effort: losing the reconcile costs a stale Recent-jobs entry, never
 * the video itself.
 */
async function reconcile(videoId: string, status: JobStatus, videoUrl: string, error: string) {
  const row = await readJob(videoId);
  if (!row?.id) return;
  try {
    await client().from(JOB_TABLE).update(row.id, {
      status,
      ...(videoUrl ? { video_url: videoUrl } : {}),
      ...(error ? { error_text: error.slice(0, 2000) } : {}),
      updated_at: new Date().toISOString(),
    });
  } catch { /* bookkeeping only */ }
}

/** Store the output of a post-production pass against its own job row. */
export async function finishJob(videoId: string, videoUrl: string) {
  await reconcile(videoId, 'completed', videoUrl, '');
}

/** A locally minted id for a job HeyGen answered without giving one. */
export function localJobId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
