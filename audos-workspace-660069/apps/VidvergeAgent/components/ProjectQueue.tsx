import { Play } from 'lucide-react';
import type { QueueJob } from '../types';

const QUEUE_CSS = `
.vvq-item {
  opacity: 0;
  transform: translateY(8px);
  animation: vvq-in 520ms cubic-bezier(0.22, 0.61, 0.36, 1) forwards;
}
@keyframes vvq-in {
  to { opacity: 1; transform: translateY(0); }
}
.vvq-fill { transition: width 320ms ease-out; }
@media (prefers-reduced-motion: reduce) {
  .vvq-item { animation: none; opacity: 1; transform: none; }
}
`;

const MAX_VISIBLE = 5;

function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length > 1) return words.slice(0, 2).map((word) => word[0].toUpperCase()).join('');
  // Single-word studio names (SceneForge, Script-to-Video) read better as their capitals.
  const capitals = name.replace(/[^A-Z]/g, '');
  if (capitals.length >= 2) return capitals.slice(0, 2);
  return name.slice(0, 2).toUpperCase();
}

export default function ProjectQueue({ jobs, onOpen }: { jobs: QueueJob[]; onOpen: (job: QueueJob) => void }) {
  const visible = jobs.slice(0, MAX_VISIBLE);
  const activeCount = visible.filter((job) => job.state === 'active').length;

  return (
    <div className="w-full">
      <style>{QUEUE_CSS}</style>

      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[11px] uppercase tracking-[0.3em] text-[var(--vv-text-dim)]">Recent jobs</h2>
        <span className="text-[11px] text-[#9E8B55]">{activeCount} active</span>
      </div>

      {visible.length === 0 ? (
        <p className="text-[13px] text-[var(--vv-text-dim)]">Nothing in the queue yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {visible.map((job, index) => {
            const done = job.state === 'completed';
            const failed = job.state === 'failed';
            return (
              <li key={job.id} className="vvq-item" style={{ animationDelay: `${index * 70}ms` }}>
                <button
                  type="button"
                  onClick={() => onOpen(job)}
                  className="flex w-full items-center gap-3 rounded-xl border border-[var(--vv-border)] bg-[var(--vv-surface)] px-3 py-2.5 text-left transition-colors hover:border-[color-mix(in_srgb,var(--vv-gold)_28%,transparent)] hover:bg-[rgba(255,255,255,0.04)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--vv-gold)]"
                  title={`Open ${job.name} in ${job.app}`}
                >
                <span
                  className="relative flex h-[34px] w-[52px] shrink-0 items-center justify-center overflow-hidden rounded-md text-[10px] font-semibold tracking-wide text-[var(--vv-gold)]"
                  style={{
                    background:
                      'linear-gradient(135deg, rgba(212,146,10,0.16), rgba(255,255,255,0.04) 60%, rgba(255,255,255,0.08))',
                    border: '1px solid rgba(255,255,255,0.07)',
                  }}
                >
                  {done ? <Play size={12} className="text-[var(--vv-gold)]" /> : initials(job.app)}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[13px] text-[#F5E9C8]">{job.name}</span>
                    <span className="shrink-0 text-[11px] tabular-nums text-[var(--vv-text-dim)]">{job.progress}%</span>
                  </span>
                  <span className="mt-1 flex items-center gap-2">
                    <span className="truncate text-[11px] text-[var(--vv-text-dim)]">
                      {job.app} · {job.stage}
                    </span>
                  </span>
                  <span className="mt-1.5 block h-[2px] w-full overflow-hidden rounded-full bg-[rgba(255,255,255,0.07)]">
                    <span
                      className="vvq-fill block h-full rounded-full"
                      style={{
                        width: `${Math.max(2, Math.min(100, job.progress))}%`,
                        background: done
                          ? 'var(--vv-success, #4ade80)'
                          : failed
                            ? 'var(--vv-error, #f87171)'
                            : 'linear-gradient(90deg, rgba(212,146,10,0.35), var(--vv-gold, #D4920A))',
                      }}
                    />
                  </span>
                </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
