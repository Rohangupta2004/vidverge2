import { useCallback, useEffect, useState } from 'react';

type QaJob = {
  id: number;
  job_id?: string | null;
  title?: string | null;
  status: string;
};

function workspaceDb(): any {
  return typeof window === 'undefined' ? null : (window as any).__workspaceDb;
}

async function latestQaJob(): Promise<QaJob | null> {
  const client = workspaceDb();
  if (!client?.from) return null;
  const result = await client
    .from('video_jobs', { shared: true })
    .orderBy('created_at', 'desc')
    .limit(20)
    .get();
  const rows = Array.isArray(result?.data) ? result.data as QaJob[] : [];
  return rows.find((row) => row.status === 'qa_review') || null;
}

async function saveDecision(job: QaJob, decision: 'deliver' | 'discard'): Promise<void> {
  const client = workspaceDb();
  if (!client?.from) throw new Error('The workspace session is still loading.');
  const patch = decision === 'deliver'
    ? { status: 'completed', error: null, updated_at: new Date().toISOString() }
    : { status: 'failed', error: 'Discarded during QA review.', updated_at: new Date().toISOString() };
  await client.from('video_jobs').update(job.id, patch);
  window.dispatchEvent(new CustomEvent('vidverge:data-changed', { detail: { table: 'video_jobs' } }));
}

export default function QaReviewNotice({ disabled = false }: { disabled?: boolean }) {
  const [job, setJob] = useState<QaJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (disabled) return;
    try {
      setJob(await latestQaJob());
    } catch {
      // Keep the last known job through a transient refresh failure.
    }
  }, [disabled]);

  useEffect(() => {
    if (disabled) {
      setJob(null);
      return;
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(timer);
  }, [disabled, refresh]);

  if (!job) return null;

  const decide = async (decision: 'deliver' | 'discard') => {
    setBusy(true);
    setError('');
    try {
      await saveDecision(job, decision);
      setJob(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That QA decision could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-2 rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-muted)] px-3 py-2 text-xs" data-testid="chat-qa-review">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-[var(--space-text-secondary)]">
          QA review · {job.title || job.job_id || `Video #${job.id}`}
        </span>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void decide('deliver')}
            className="rounded-lg bg-[var(--space-brand-primary-600)] px-2.5 py-1.5 font-semibold text-[var(--space-text-on-primary)] disabled:opacity-50"
          >
            ✅ Deliver
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void decide('discard')}
            className="rounded-lg border border-[var(--space-border-default)] px-2.5 py-1.5 font-semibold text-[var(--space-text-secondary)] disabled:opacity-50"
          >
            🗑️ Discard
          </button>
        </div>
      </div>
      {error ? <p className="mt-2 text-[var(--space-semantic-danger-500)]" role="alert">{error}</p> : null}
    </div>
  );
}
