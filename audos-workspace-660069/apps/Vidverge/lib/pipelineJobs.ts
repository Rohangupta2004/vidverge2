/**
 * DURABLE PIPELINE CLIENT — the browser's half of the server-owned Pipeline A
 * and Pipeline B runs.
 *
 * WHAT CHANGED AND WHY
 * Pipelines A and B used to execute their own stages from the tab: the browser
 * called image generation, per-beat clip generation and the Remotion render
 * itself. Closing the page therefore stranded the job, and `vge_video_jobs`
 * showed exactly that — three of five rows from 12 Oct 2026 sat abandoned
 * mid-pipeline (two at GENERATING_VISUALS, one at INGESTING) with no error
 * message and, crucially, no provider task id, so there was nothing to recover
 * them BY. The customer was left with a spinner that could never resolve.
 *
 * Now the `vidverge-orchestrator` server function owns every long, paid stage:
 * the hero stills, the per-beat clips, the pre-render audit and the Remotion
 * render. It checkpoints each beat into `scene_results` as it lands, persists
 * the render operation id the instant the submit returns, polls server-side on
 * a leased self-chaining tick, retries only what actually failed, honours a
 * cancel with no tab open, and is reclaimed by a sweep if its worker dies.
 *
 * WHAT THE BROWSER STILL DOES, AND WHY IT HAS TO. The platform voiceover and
 * word-timing endpoints answer `401 no_credentials` to a tokenless server
 * function (probed 25 Sep 2026; the verdict is recorded on `pv-story-probe`),
 * and the founder's ruling is no BYOK — so narration is prepared in the tab.
 * That window is seconds long, costs almost nothing to redo, and finishes
 * before any expensive work starts. A tab closed inside it no longer leaves a
 * spinner either: the orchestrator's sweep closes out a row that never reached
 * the server, with a sentence that says what happened.
 *
 * So this module does three things and no more: hand the brief over, READ the
 * row, and ask for a cancel. `follow()` giving up only stops WATCHING — the
 * generation keeps running and the next visit picks it up from the row.
 */

import { SPACE_ID } from './runtime';
import { DurableJobError, isTerminal } from './runwayJobs';
import type { DurableJob, FollowOptions } from './runwayJobs';

const HOOK = `/api/hooks/execute/${SPACE_ID}/vidverge-orchestrator`;

export type { DurableJob } from './runwayJobs';

/** Which pipeline shape the server is being asked to run. */
export type PipelineBriefKind = 'documentary' | 'kinetic';

/**
 * One beat of a documentary run, with its prompts ALREADY RESOLVED.
 *
 * The collage and stop-motion templates stay in `./documentary.ts` on purpose:
 * they are the product's look, and they belong where a person reviewing this
 * app can read them. The orchestrator is deliberately generic about what it is
 * filming, so it receives finished prompt strings rather than a template and a
 * set of slots.
 */
export interface PipelineBriefBeat {
  index: number;
  heroPrompt: string;
  motionPrompt: string;
  narration: string;
}

export interface PipelineBrief {
  kind: PipelineBriefKind;
  /** The standalone TSX the render service compiles. Never a module import. */
  compositionTsx: string;
  /**
   * Documentary: the props template whose `scenes` the server fills in from the
   * clips it generated. Kinetic: the finished props, used as they are.
   */
  props: Record<string, unknown>;
  /** Kinetic only — documentary length is derived from the beats that landed. */
  durationInFrames?: number;
  beats?: PipelineBriefBeat[];
  beatSeconds?: number;
  aspectRatio?: string;
  imageAspect?: string;
  motionModel?: string;
  crossfadeFrames?: number;
}

async function call(payload: Record<string, unknown>): Promise<any> {
  let response: Response;
  try {
    response = await fetch(HOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (error: any) {
    throw new DurableJobError(
      `The job service could not be reached: ${String(error?.message || error)}`,
      'network',
    );
  }
  const data = await response.json().catch(() => null);
  // Hook responses are JSON-wrapped; the handler's own body is under `data`
  // on the wrapped shape and at the top level on the raw one.
  const node = data && typeof data === 'object' && 'data' in data ? (data as any).data : data;
  if (!response.ok) {
    throw new DurableJobError(
      String(node?.error || data?.error || `The job service answered HTTP ${response.status}.`),
      'http',
    );
  }
  return node || {};
}

function toJob(raw: any): DurableJob | null {
  if (!raw || !raw.jobId) return null;
  return {
    jobId: String(raw.jobId),
    status: String(raw.status || 'QUEUED'),
    phase: String(raw.phase || 'queued') as DurableJob['phase'],
    stageDetail: raw.stageDetail ? String(raw.stageDetail) : null,
    masterVideoUrl: raw.masterVideoUrl ? String(raw.masterVideoUrl) : null,
    errorMessage: raw.errorMessage ? String(raw.errorMessage) : null,
    lastError: raw.lastError ? String(raw.lastError) : null,
    attempts: Number(raw.attempts) || 0,
    maxAttempts: Number(raw.maxAttempts) || 3,
    providerTaskId: raw.providerTaskId ? String(raw.providerTaskId) : null,
    sceneResults: Array.isArray(raw.sceneResults) ? raw.sceneResults : null,
    cancelRequested: Boolean(raw.cancelRequested),
  };
}

export interface StartPipelineInput {
  /** The vge_video_jobs row this run belongs to. */
  jobId: string;
  brief: PipelineBrief;
  /**
   * Idempotency key. The same key never buys a second run: a repeat start
   * adopts the job that key already opened. Derive it from the brief, not from
   * a timestamp or a random value, or it guards nothing.
   */
  dedupeKey: string;
}

export interface StartPipelineResult {
  job: DurableJob;
  /** True when this call adopted work that was already in flight. */
  duplicate: boolean;
}

/**
 * Hand a prepared brief to the server and return immediately. Every stage from
 * here is the server's responsibility — this call does not wait for any of it.
 */
export async function startPipelineJob(input: StartPipelineInput): Promise<StartPipelineResult> {
  const out = await call({
    op: 'start',
    jobId: input.jobId,
    brief: input.brief,
    dedupeKey: input.dedupeKey,
  });
  const job = toJob(out?.job);
  if (!job) throw new DurableJobError('The job service did not return a job to follow.', 'no_job');
  return { job, duplicate: Boolean(out?.duplicate) };
}

/** One read of the persisted row. Cheap, and safe to call on an interval. */
export async function readPipelineJob(jobId: string): Promise<DurableJob | null> {
  try {
    const out = await call({ op: 'status', jobId });
    return toJob(out?.job);
  } catch (error) {
    if ((error as DurableJobError)?.code === 'http') return null;
    throw error;
  }
}

/**
 * Ask for a cancel. It is recorded on the row, so it takes effect whether or
 * not this tab is still open, and a job that had already finished is left
 * alone rather than having a finished video thrown away.
 */
export async function cancelPipelineJob(jobId: string): Promise<DurableJob | null> {
  const out = await call({ op: 'cancel', jobId });
  return toJob(out?.job);
}

/**
 * Watch a server-owned job by reading its row. There is deliberately no
 * provider call and no failure deadline in here: the only thing this loop can
 * do is stop looking.
 */
export async function followPipelineJob(
  jobId: string,
  opts: FollowOptions = {},
): Promise<DurableJob | null> {
  const interval = Math.max(2000, opts.intervalMs ?? 5000);
  const until = Date.now() + (opts.watchForMs ?? 60 * 60 * 1000);
  let last: DurableJob | null = null;
  let misses = 0;

  for (;;) {
    if (opts.shouldStop?.()) return last;

    let job: DurableJob | null = null;
    try {
      job = await readPipelineJob(jobId);
      misses = 0;
    } catch {
      // A dropped read is the network, not the job. Keep watching: the server
      // is still working regardless of what this tab can reach.
      misses += 1;
      if (misses >= 12) return last;
    }

    if (job) {
      last = job;
      opts.onUpdate?.(job);
      if (isTerminal(job.phase)) return job;
    }

    if (Date.now() >= until) return last;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

/**
 * How many of a documentary's beats have landed, read off the server's ledger.
 * Used for the progress line while the tab is watching, and for the honest
 * "this film is missing N beats" notice when a run finishes short.
 */
export function sceneProgress(job: DurableJob | null): { done: number; failed: number; total: number } {
  const scenes = job?.sceneResults || [];
  let done = 0;
  let failed = 0;
  scenes.forEach((scene: any) => {
    if (String(scene?.status) === 'completed' && scene?.url) done += 1;
    else if (String(scene?.status) === 'failed') failed += 1;
  });
  return { done, failed, total: scenes.length };
}
