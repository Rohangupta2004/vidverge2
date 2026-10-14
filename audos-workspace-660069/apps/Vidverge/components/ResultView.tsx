import { Download, RotateCcw } from 'lucide-react';
import type { VideoJob } from '../types';
import { pipelineSpec } from '../lib/pipelineSpecs';
import { downloadRemote, formatUsd } from '../lib/runtime';

function fileNameFor(job: VideoJob): string {
  const slug = job.project_name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return `${slug || 'vidverge'}.mp4`;
}

/** The finished master: play it, download it, or start another. */
export default function ResultView({
  job,
  onStartAnother,
}: {
  job: VideoJob;
  onStartAnother: () => void;
}) {
  const spec = pipelineSpec(job.pipeline);
  const url = job.master_video_url || '';
  const portrait = job.aspect_ratio === '9:16';

  return (
    <section className="rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-5">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[16px] font-semibold tracking-[-0.02em] text-[var(--space-text-primary)]">
            {job.project_name}
          </h3>
          <p className="mt-0.5 text-[12.5px] text-[var(--space-text-muted)]">
            {[spec.title, job.aspect_ratio, `estimated ${formatUsd(Number(job.cost_estimate_usd) || spec.costUsd)}`].join(' \u00b7 ')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => downloadRemote(url, fileNameFor(job))}
            className="inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-[13px] font-semibold transition-opacity hover:opacity-90"
            style={{
              background: 'var(--space-brand-primary-500)',
              color: 'var(--space-text-on-primary)',
            }}
          >
            <Download className="h-4 w-4" />
            Download MP4
          </button>
          <button
            type="button"
            onClick={onStartAnother}
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--space-border-default)] px-3.5 py-2 text-[13px] font-medium text-[var(--space-text-secondary)] transition-colors hover:text-[var(--space-text-primary)]"
          >
            <RotateCcw className="h-4 w-4" />
            Make another
          </button>
        </div>
      </header>

      <div
        className="mx-auto overflow-hidden rounded-xl border border-[var(--space-border-default)] bg-black"
        style={{ maxWidth: portrait ? 420 : '100%' }}
      >
        <video
          src={url}
          controls
          playsInline
          preload="metadata"
          className="block h-auto w-full"
        />
      </div>

      <p className="mt-3 break-all text-[11.5px] text-[var(--space-text-muted)]">{url}</p>
    </section>
  );
}
