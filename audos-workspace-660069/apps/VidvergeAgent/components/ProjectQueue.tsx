import { AlertCircle, CheckCircle2, Clock3, Loader2, Play } from 'lucide-react';
import type { QueueJob } from '../types';

const MAX_VISIBLE = 5;
function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length > 1) return words.slice(0, 2).map((word) => word[0].toUpperCase()).join('');
  const capitals = name.replace(/[^A-Z]/g, '');
  return capitals.length >= 2 ? capitals.slice(0, 2) : name.slice(0, 2).toUpperCase();
}
function status(job: QueueJob) {
  if (job.state === 'completed') return { label: 'Ready', fg: 'var(--vg-success)', bg: 'var(--vg-success-bg)', icon: CheckCircle2 };
  if (job.state === 'failed') return { label: 'Failed', fg: 'var(--vg-danger)', bg: 'var(--vg-danger-bg)', icon: AlertCircle };
  if (job.state === 'active') return { label: 'Generating', fg: 'var(--vg-info)', bg: 'var(--vg-info-bg)', icon: Loader2 };
  return { label: 'Queued', fg: 'var(--vg-info)', bg: 'var(--vg-info-bg)', icon: Clock3 };
}

export default function ProjectQueue({ jobs, onOpen }: { jobs: QueueJob[]; onOpen: (job: QueueJob) => void }) {
  const visible = jobs.slice(0, MAX_VISIBLE);
  const activeCount = visible.filter((job) => job.state === 'active').length;
  return (
    <div className="w-full">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-medium text-[var(--vg-secondary)]">Recent jobs</h2>
        <span className="text-xs tabular-nums text-[var(--vg-muted)]">{activeCount} generating</span>
      </div>
      {visible.length === 0 ? (
        <div className="rounded-xl border border-[var(--vg-border)] bg-[var(--vg-surface)] p-6">
          <p className="text-sm font-semibold text-[var(--vg-text)]">No jobs yet</p>
          <p className="mt-1 text-sm text-[var(--vg-secondary)]">Create a brief above and its real backend phase will appear here.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {visible.map((job) => {
            const tone = status(job);
            const StatusIcon = tone.icon;
            return <li key={job.id}>
              <button type="button" onClick={() => onOpen(job)} className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-[var(--vg-border)] bg-[var(--vg-surface)] px-3 py-3 text-left transition-colors hover:border-[var(--vg-control-border)] hover:bg-[var(--vg-hover)]" title={`Open ${job.name} in ${job.app}`}>
                <span className="flex h-10 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-[var(--vg-border)] bg-[var(--vg-bg)] text-xs font-semibold text-[var(--vg-accent)]">
                  {job.state === 'completed' ? <Play size={15} aria-hidden="true" /> : initials(job.app)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-[var(--vg-text)]">{job.name}</span>
                  <span className="mt-1 block truncate text-xs text-[var(--vg-secondary)]">{job.app} · {job.stage}</span>
                </span>
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium" style={{ color: tone.fg, background: tone.bg }}>
                  <StatusIcon size={14} aria-hidden="true" className={job.state === 'active' ? 'animate-spin' : ''} />
                  {tone.label}
                </span>
              </button>
            </li>;
          })}
        </ul>
      )}
    </div>
  );
}
