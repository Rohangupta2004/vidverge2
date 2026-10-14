import { AlertTriangle, Check, Loader2, X } from 'lucide-react';
import type { JobStatus, PipelineId } from '../types';
import { stageIndexIn, stageLabel, stagesFor } from '../types';
import { formatClock } from '../lib/runtime';

/**
 * The run, as the customer sees it.
 *
 * The stage comes from the job row rather than from local state, so a reload
 * mid-render picks the tracker back up where it was. `detail` is the live line
 * underneath — which beat is rendering, how long the farm has been going — and
 * `notices` are the things the run survived but the customer should still know
 * about: a brand that could not be read, timings that were estimated.
 *
 * The stage line is the one belonging to `pipeline`, so a pipeline that skips
 * a step never shows a rung the run will not climb.
 */
export default function JobTracker({
  status,
  pipeline,
  detail,
  notices,
  elapsedSeconds,
  slaSeconds,
  error,
  onCancel,
}: {
  status: JobStatus;
  pipeline: PipelineId;
  detail: string;
  notices: string[];
  elapsedSeconds: number;
  slaSeconds: number;
  error: string | null;
  onCancel?: () => void;
}) {
  const stages = stagesFor(pipeline);
  const current = stageIndexIn(stages, status);
  const failed = status === 'FAILED';
  const done = status === 'COMPLETED';
  const overSla = elapsedSeconds > slaSeconds && !done && !failed;

  return (
    <section className="rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {failed ? (
            <X className="h-4 w-4 text-[var(--space-semantic-danger-500)]" />
          ) : done ? (
            <Check className="h-4 w-4 text-[var(--space-semantic-success-500)]" />
          ) : (
            <Loader2 className="h-4 w-4 animate-spin text-[var(--space-brand-highlight)]" />
          )}
          <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-[var(--space-text-primary)]">
            {failed ? 'The job stopped' : done ? 'Your video is ready' : stageLabel(status, pipeline)}
          </h3>
        </div>
        <div className="flex items-center gap-3">
          <span
            className="text-[12px] tabular-nums"
            style={{ color: overSla ? 'var(--space-text-secondary)' : 'var(--space-text-muted)' }}
          >
            {formatClock(elapsedSeconds)}
            {!done && !failed ? ` / ~${formatClock(slaSeconds)}` : ''}
          </span>
          {onCancel && !done && !failed && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-[var(--space-border-default)] px-2.5 py-1 text-[12px] font-medium text-[var(--space-text-secondary)] transition-colors hover:text-[var(--space-text-primary)]"
            >
              Stop
            </button>
          )}
        </div>
      </header>

      <ol className="mt-5 flex flex-col gap-0">
        {stages.map((stage, index) => {
          const reached = !failed && index <= current;
          const active = !failed && !done && index === current;
          const last = index === stages.length - 1;
          return (
            <li key={stage} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold transition-colors"
                  style={{
                    background: reached
                      ? 'var(--space-brand-primary-500)'
                      : 'color-mix(in srgb, var(--space-text-primary) 8%, transparent)',
                    color: reached ? 'var(--space-text-on-primary)' : 'var(--space-text-muted)',
                    boxShadow: active
                      ? '0 0 0 4px color-mix(in srgb, var(--space-brand-primary-500) 20%, transparent)'
                      : 'none',
                  }}
                >
                  {reached && index < current ? <Check className="h-3 w-3" /> : index + 1}
                </span>
                {!last && (
                  <span
                    className="w-px flex-1"
                    style={{
                      minHeight: 22,
                      background:
                        index < current
                          ? 'var(--space-brand-primary-500)'
                          : 'var(--space-border-default)',
                    }}
                  />
                )}
              </div>
              <div className={last ? 'pb-0' : 'pb-3'}>
                <div
                  className="text-[13px] font-medium"
                  style={{
                    color: active
                      ? 'var(--space-text-primary)'
                      : reached
                        ? 'var(--space-text-secondary)'
                        : 'var(--space-text-muted)',
                  }}
                >
                  {stageLabel(stage, pipeline)}
                </div>
                {active && detail && (
                  <div className="mt-0.5 text-[12px] leading-relaxed text-[var(--space-text-muted)]">
                    {detail}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {error && (
        <p
          className="mt-4 rounded-xl px-3.5 py-3 text-[13px] leading-relaxed"
          style={{
            background: 'color-mix(in srgb, var(--space-semantic-danger-500) 12%, transparent)',
            border: '1px solid color-mix(in srgb, var(--space-semantic-danger-500) 36%, transparent)',
            color: 'var(--space-text-primary)',
          }}
        >
          {error}
        </p>
      )}

      {notices.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {notices.map((notice, index) => (
            <li
              key={index}
              className="flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-[12.5px] leading-relaxed"
              style={{
                background: 'color-mix(in srgb, var(--space-brand-highlight-500) 10%, transparent)',
                border: '1px solid color-mix(in srgb, var(--space-brand-highlight-500) 28%, transparent)',
                color: 'var(--space-text-secondary)',
              }}
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--space-brand-highlight)]" />
              <span>{notice}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
