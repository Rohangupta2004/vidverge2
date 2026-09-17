const MOTION_UI_LAYER_PREFIX = '[motion ui layer]';

export function isHiddenVideoSeries(_row: any): boolean {
  return false;
}

export function isHiddenVideoProject(_row: any): boolean {
  return false;
}

export function isHiddenVideoJob(job: any, _linkedSeriesName?: unknown): boolean {
  return (
    typeof job?.title === 'string' &&
    job.title.trim().toLowerCase().startsWith(MOTION_UI_LAYER_PREFIX)
  );
}
