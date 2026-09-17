import { AlertTriangle, CheckCircle2, Clock, RefreshCw } from 'lucide-react';
import type { CheckResult } from '../lib/supabase';

/**
 * The six delivery checks. "Assembly needs attention" is reserved for checks
 * that actually ran and failed: an empty list means they have not run yet
 * (most often because the assembly render never produced a film), and saying
 * "needs attention" there pointed the customer at the checks instead of at the
 * real failure, which Step 7 reports on its own.
 */
export default function ChecksReport({ checks, busy, assembled, onRetry }: { checks: CheckResult[]; busy?: boolean; assembled?: boolean; onRetry: () => void }) {
  const ran = checks.length > 0;
  const pass = checks.length === 6 && checks.every((check) => check.pass);
  const failing = ran && !pass;
  const banner = pass
    ? 'border-[color-mix(in_srgb,var(--space-semantic-success-500)_40%,transparent)] bg-[color-mix(in_srgb,var(--space-semantic-success-500)_10%,transparent)]'
    : failing
      ? 'border-[color-mix(in_srgb,var(--space-semantic-danger-500)_40%,transparent)] bg-[color-mix(in_srgb,var(--space-semantic-danger-500)_10%,transparent)]'
      : 'border-[var(--space-border-default)] bg-[var(--space-surface-panel)]';

  return <div className="space-y-3">
    <div className={`rounded-xl border p-4 ${banner}`}>
      <div className="flex items-center gap-2 font-semibold text-[var(--space-text-primary)]">
        {pass ? <CheckCircle2 className="h-5 w-5 text-[var(--space-semantic-success)]" />
          : failing ? <AlertTriangle className="h-5 w-5 text-[var(--space-semantic-danger)]" />
            : <Clock className="h-5 w-5 text-[var(--space-text-muted)]" />}
        {pass ? 'All six checks passed' : failing ? 'Assembly needs attention' : busy ? 'Checks run as soon as the film is assembled' : assembled ? 'Checks have not been tallied for this cut yet' : 'The six checks run once the film is assembled'}
      </div>
    </div>
    {checks.map((check) => <div key={check.id} className="flex gap-3 rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-4">
      {check.pass ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-[var(--space-semantic-success)]" /> : <AlertTriangle className="mt-0.5 h-4 w-4 text-[var(--space-semantic-danger)]" />}
      <div>
        <div className="text-sm font-semibold text-[var(--space-text-primary)]">{check.label}</div>
        <p className="mt-1 text-sm text-[var(--space-text-secondary)]">{check.detail}</p>
      </div>
    </div>)}
    {failing || (assembled && !ran) ? <button disabled={busy} onClick={onRetry} className="flex items-center gap-2 rounded-xl border border-[var(--space-border-strong)] px-4 py-3 text-[var(--space-text-primary)] disabled:opacity-40"><RefreshCw className={busy ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /> {busy ? 'Reassembling…' : 'Fix and retry'}</button> : null}
  </div>;
}
