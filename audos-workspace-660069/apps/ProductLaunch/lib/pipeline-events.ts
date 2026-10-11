// pipeline-events — the one place the run's progress lives.
//
// The pipeline is a plain async function that cannot render. The UI is a React
// tree that must not own the pipeline's state, or a re-render mid-run loses
// it. So steps report into a tracker and the UI subscribes to it. Timings are
// MEASURED — every millisecond shown beside a step is the real elapsed time of
// a real awaited promise. There is no setTimeout anywhere in this app
// pretending to be work.

export type StepId =
  | 'extract'
  | 'concepts'
  | 'select'
  | 'plan'
  | 'codegen'
  | 'compile'
  | 'render'
  | 'qa'
  | 'critic'
  | 'output';

export type StepState = 'waiting' | 'running' | 'done' | 'failed' | 'skipped';

export interface PipelineStep {
  id: StepId;
  label: string;
  /** The running commentary under the label — replaced as the step learns things. */
  detail: string;
  state: StepState;
  ms: number;
  error: string;
  /** Set while a step is retrying itself, e.g. the compile fix loop. */
  attempt: number;
}

export const STEP_ORDER: Array<{ id: StepId; label: string }> = [
  { id: 'extract', label: 'Extracting product context' },
  { id: 'concepts', label: 'Generating film concepts' },
  { id: 'select', label: 'Selecting best concept' },
  { id: 'plan', label: 'Building component plan' },
  { id: 'codegen', label: 'Generating Film.tsx' },
  { id: 'compile', label: 'Compile check' },
  { id: 'render', label: 'Rendering' },
  { id: 'qa', label: 'Technical QA' },
  { id: 'critic', label: 'Critic evaluation' },
  { id: 'output', label: 'Final output' },
];

export function freshSteps(): PipelineStep[] {
  return STEP_ORDER.map((step) => ({
    id: step.id,
    label: step.label,
    detail: '',
    state: 'waiting' as StepState,
    ms: 0,
    error: '',
    attempt: 0,
  }));
}

export interface PipelineSnapshot {
  steps: PipelineStep[];
  /** Which iteration of the render/critique loop is running. 1-based. */
  iteration: number;
  startedAt: number;
}

type Listener = (snapshot: PipelineSnapshot) => void;

export class PipelineTracker {
  private steps: PipelineStep[] = freshSteps();

  private listeners: Listener[] = [];

  private startTimes: Partial<Record<StepId, number>> = {};

  private iteration = 1;

  private startedAt = 0;

  snapshot(): PipelineSnapshot {
    return { steps: this.steps.map((step) => ({ ...step })), iteration: this.iteration, startedAt: this.startedAt };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    listener(this.snapshot());
    return () => {
      this.listeners = this.listeners.filter((entry) => entry !== listener);
    };
  }

  private publish(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  private patch(id: StepId, changes: Partial<PipelineStep>): void {
    this.steps = this.steps.map((step) => (step.id === id ? { ...step, ...changes } : step));
    this.publish();
  }

  reset(): void {
    this.steps = freshSteps();
    this.startTimes = {};
    this.iteration = 1;
    this.startedAt = Date.now();
    this.publish();
  }

  /** Called when the loop goes round again: the render-and-after steps re-run. */
  beginIteration(iteration: number): void {
    this.iteration = iteration;
    const rerun: StepId[] = ['plan', 'codegen', 'compile', 'render', 'qa', 'critic', 'output'];
    this.steps = this.steps.map((step) => (rerun.indexOf(step.id) >= 0
      ? { ...step, state: 'waiting' as StepState, ms: 0, error: '', attempt: 0 }
      : step));
    this.publish();
  }

  start(id: StepId, detail = ''): void {
    this.startTimes[id] = Date.now();
    if (!this.startedAt) this.startedAt = Date.now();
    this.patch(id, { state: 'running', detail, error: '', ms: 0, attempt: 0 });
  }

  /** Update the commentary without ending the step. */
  note(id: StepId, detail: string, attempt?: number): void {
    const changes: Partial<PipelineStep> = { detail };
    if (attempt !== undefined) changes.attempt = attempt;
    this.patch(id, changes);
  }

  private elapsed(id: StepId): number {
    const began = this.startTimes[id];
    return began ? Date.now() - began : 0;
  }

  done(id: StepId, detail?: string): void {
    const changes: Partial<PipelineStep> = { state: 'done', ms: this.elapsed(id) };
    if (detail !== undefined) changes.detail = detail;
    this.patch(id, changes);
  }

  skip(id: StepId, detail: string): void {
    this.patch(id, { state: 'skipped', detail, ms: 0 });
  }

  fail(id: StepId, error: string): void {
    this.patch(id, { state: 'failed', error, ms: this.elapsed(id) });
  }

  /** The step a Retry button should restart, or null when nothing failed. */
  failedStep(): PipelineStep | null {
    return this.steps.find((step) => step.state === 'failed') || null;
  }
}

export function formatMs(ms: number): string {
  if (!ms) return '';
  if (ms < 1000) return String(ms) + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return String(minutes) + 'm ' + String(seconds) + 's';
}
