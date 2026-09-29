import { ChevronDown, ChevronUp, CheckCircle2, Clock3, GitBranch, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { assemblyJobRunning, type Project, type Scene } from '../lib/supabase';
import { sceneSettled } from '../lib/sceneState';
import { LightBeamProgress } from '../../../components/design-system/index';

const STATUS_LABELS: Record<string, string> = {
  queued: 'Queued', waiting_for_capacity: 'Waiting for capacity', running: 'Running', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled',
};

export default function BackgroundJobIndicator({ project, scenes, note }: { project: Project; scenes: Scene[]; note?: string }) {
  const [open, setOpen] = useState(false);
  const pipeline = project.pipeline_job || null;
  const assembly = project.assembly_job || null;
  const settled = scenes.filter(sceneSettled).length;
  const stage = pipeline && !['completed', 'cancelled'].includes(pipeline.status)
    ? pipeline.stage
    : assemblyJobRunning(assembly) ? 'assembly'
      : project.status === 'checks' ? 'finishing' : project.status === 'done' ? 'complete' : 'ready';
  const status = pipeline && !['completed', 'cancelled'].includes(pipeline.status)
    ? pipeline.status
    : assemblyJobRunning(assembly) ? 'running'
      : pipeline?.status === 'failed' || assembly?.status === 'failed' ? 'failed' : project.status === 'done' ? 'completed' : 'queued';
  const progress = pipeline && !['completed', 'cancelled'].includes(pipeline.status)
    ? Math.max(0, Math.min(100, Number(pipeline.progress) || 0))
    : assemblyJobRunning(assembly) ? Math.max(0, Math.min(100, Number(assembly?.progress) || 0))
      : scenes.length ? Math.round(settled / scenes.length * 100) : project.status === 'done' ? 100 : 0;
  const running = status === 'running' || status === 'queued' || status === 'waiting_for_capacity';
  const message = pipeline?.message || assembly?.message || note || project.stage_note || `${settled} of ${scenes.length} scenes settled`;
  const Icon = status === 'failed' ? TriangleAlert : status === 'completed' ? CheckCircle2 : status === 'waiting_for_capacity' || status === 'queued' ? Clock3 : GitBranch;

  return <div className="border-b border-[var(--space-border-default)] bg-[var(--space-surface-card)] px-4 py-2">
    <button onClick={() => setOpen((value) => !value)} className="flex w-full items-center gap-2 text-left">
      <Icon className={`h-3.5 w-3.5 shrink-0 ${status === 'failed' ? 'text-[var(--space-semantic-danger)]' : status === 'completed' ? 'text-[var(--space-semantic-success)]' : 'text-[var(--space-text-brand)]'}`} />
      <span className="text-xs font-semibold text-[var(--space-text-primary)]">{String(stage || 'pipeline').replace(/_/g, ' ')}</span>
      <span className="rounded-full bg-[color-mix(in_srgb,var(--space-text-primary)_6%,transparent)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--space-text-muted)]">{STATUS_LABELS[status] || status}</span>
      <span className="ml-auto font-mono text-[11px] text-[var(--space-text-secondary)]">{Math.round(progress)}%</span>
      {open ? <ChevronUp className="h-3.5 w-3.5 text-[var(--space-text-muted)]" /> : <ChevronDown className="h-3.5 w-3.5 text-[var(--space-text-muted)]" />}
    </button>
    <LightBeamProgress
      className="mt-1.5"
      progress={progress}
      showValue={false}
      state={status === 'failed' ? 'error' : status === 'completed' ? 'complete' : running ? 'processing' : 'idle'}
    />
    {open ? <div className="mt-2 grid gap-1 text-[11px] text-[var(--space-text-muted)] sm:grid-cols-[1fr_auto]">
      <p>{message}</p><span>{settled}/{scenes.length} scenes</span>
      {pipeline?.idempotency_key ? <p className="flex items-center gap-1"><ShieldCheck className="h-3 w-3" />One durable job · duplicate starts are ignored</p> : null}
      {pipeline?.error ? <p className="text-[var(--space-semantic-danger)]">{pipeline.error}</p> : null}
      {running && pipeline?.updated_at ? <span className="sm:text-right">Updated {new Date(pipeline.updated_at).toLocaleTimeString()}</span> : null}
    </div> : null}
  </div>;
}
