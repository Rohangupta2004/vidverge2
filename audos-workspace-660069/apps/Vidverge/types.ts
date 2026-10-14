/**
 * VIDVERGE ENGINE — the shapes the pipelines share.
 *
 * The field names mirror the WorkspaceDB columns (`vge_video_jobs`,
 * `vge_job_scenes`, `vge_audio_tokens`) on purpose: a row read back from the
 * database is already a valid object here, so nothing has to be renamed on the
 * way in or out.
 */

/** Stored in vge_video_jobs.pipeline. */
export type PipelineId = 'CODE_ENGINEERED' | 'HYBRID_DOCUMENTARY' | 'RUNWAY_MULTI_SHOT';

/** CHECK-enforced on vge_video_jobs.status. */
export type JobStatus =
  | 'QUEUED'
  | 'INGESTING'
  | 'AUDIO_SYNTHESIS'
  | 'GENERATING_VISUALS'
  | 'AUDITING'
  | 'RENDERING'
  | 'COMPLETED'
  | 'FAILED';

/** The run order the tracker walks. FAILED is terminal and not in the line. */
export const JOB_STAGES: JobStatus[] = [
  'QUEUED',
  'INGESTING',
  'AUDIO_SYNTHESIS',
  'GENERATING_VISUALS',
  'AUDITING',
  'RENDERING',
  'COMPLETED',
];

export const STAGE_LABELS: Record<JobStatus, string> = {
  QUEUED: 'Queued',
  INGESTING: 'Reading the brand',
  AUDIO_SYNTHESIS: 'Voicing the script',
  GENERATING_VISUALS: 'Making the pictures',
  AUDITING: 'Checking the cut',
  RENDERING: 'Rendering the master',
  COMPLETED: 'Done',
  FAILED: 'Failed',
};

/**
 * Multi-Shot hands the whole cut to Runway, so it has no separate voiceover
 * pass and nothing local to audit before paying for a render. Showing it the
 * seven-stage line would park two steps that never run.
 */
export const MULTI_SHOT_STAGES: JobStatus[] = [
  'QUEUED',
  'INGESTING',
  'GENERATING_VISUALS',
  'RENDERING',
  'COMPLETED',
];

export function stagesFor(pipeline: PipelineId): JobStatus[] {
  return pipeline === 'RUNWAY_MULTI_SHOT' ? MULTI_SHOT_STAGES : JOB_STAGES;
}

/** Multi-Shot reuses the status column but not its wording. */
const MULTI_SHOT_LABELS: Partial<Record<JobStatus, string>> = {
  INGESTING: 'Preparing the shots',
  GENERATING_VISUALS: 'Runway is generating',
  RENDERING: 'Finishing the cut',
};

export function stageLabel(status: JobStatus, pipeline?: PipelineId): string {
  if (pipeline === 'RUNWAY_MULTI_SHOT' && MULTI_SHOT_LABELS[status]) {
    return MULTI_SHOT_LABELS[status] as string;
  }
  return STAGE_LABELS[status];
}

export function stageIndex(status: JobStatus): number {
  const index = JOB_STAGES.indexOf(status);
  return index < 0 ? 0 : index;
}

/** Where a status sits inside one pipeline's own stage line. */
export function stageIndexIn(stages: JobStatus[], status: JobStatus): number {
  const index = stages.indexOf(status);
  if (index >= 0) return index;
  // A status this pipeline skips still has to resolve to a position, so the
  // tracker is mapped through the canonical order rather than snapping to 0.
  const canonical = stageIndex(status);
  let best = 0;
  stages.forEach((stage, position) => {
    if (stageIndex(stage) <= canonical) best = position;
  });
  return best;
}

export interface VideoJob {
  id: string;
  project_name: string;
  pipeline: PipelineId;
  status: JobStatus;
  aspect_ratio: string;
  target_duration_sec: number;
  raw_prompt: string;
  source_url: string | null;
  master_video_url: string | null;
  cost_estimate_usd: number | string | null;
  /** Native Audos Runway task metadata, persisted so a refresh can recover it. */
  provider_task_id?: string | null;
  recipe_id?: string | null;
  scene_results?: Array<{ index: number; status: string; url?: string; error?: string }> | null;
  /** Why the job FAILED, when the engine knows — shown under "Your videos". */
  error_message?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface JobScene {
  id?: string;
  job_id: string;
  scene_index: number;
  start_frame: number;
  end_frame: number;
  narration_text: string;
  visual_asset_url: string | null;
}

/** One spoken word with its place on the timeline, in milliseconds. */
export interface AudioToken {
  word: string;
  start_ms: number;
  end_ms: number;
}

/** What the Apify pass managed to read off the target site. */
export interface BrandKit {
  url: string;
  siteName: string;
  /** Hex colors ordered most-used first. Always at least two entries. */
  colors: string[];
  logoUrl: string | null;
  /** Inline `<svg>` markup when the site ships a vector logo. */
  logoSvg: string | null;
  /** The site's own social/viewport capture, when it publishes one. */
  captureUrl: string | null;
  headline: string;
  subheadline: string;
  /**
   * True when the scrape could not run and the palette below is the space's
   * own brand rather than the target's. The UI says so out loud — a guessed
   * palette presented as the customer's brand is worse than an honest note.
   */
  degraded: boolean;
  degradedReason?: string;
}

/** One 4-second beat of a Pipeline B documentary. */
export interface DocumentaryBeat {
  index: number;
  /** The line the narrator reads over this beat. */
  narration: string;
  /** Punched into the collage frame and locked by the stop-motion pass. */
  mainTitle: string;
  /** The secondary paper note in the collage. */
  subText: string;
  /** What the torn-paper border frames. */
  subject: string;
}

/** A finished Pipeline B beat: still, clip and timing, ready for the render. */
export interface DocumentaryShot extends DocumentaryBeat {
  frameUrl: string;
  videoUrl: string;
  startFrame: number;
  durationFrames: number;
}

/** Progress callbacks an orchestrator reports through while it runs. */
export interface PipelineReporter {
  onStage: (status: JobStatus) => void;
  /** A one-line human description of what is happening inside the stage. */
  onDetail: (detail: string) => void;
  /** A warning the run survived — a degraded scrape, an estimated timing. */
  onNotice: (notice: string) => void;
  isCancelled: () => boolean;
}

export interface PipelineResult {
  jobId: string;
  masterVideoUrl: string;
}
