import { AlertTriangle, ArrowLeft, CheckCircle2, RefreshCw, Scissors, ShieldCheck } from 'lucide-react';
import type { CheckResult } from '../lib/supabase';
import type { FilmQaReport } from '../lib/filmQa';

function Sparkline({ values }: { values: number[] }) {
  const clean = values.filter(Number.isFinite);
  if (clean.length < 2) return <div className="h-20 rounded-lg bg-[var(--space-surface-panel)]" />;
  const points = clean.map((value, index) => `${(index / (clean.length - 1)) * 100},${100 - (Math.max(0, Math.min(255, value)) / 255) * 100}`).join(' ');
  return <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-20 w-full overflow-visible" aria-label="Luma sparkline">
    <path d="M0 95 H100" stroke="var(--space-border-default)" strokeWidth="1" />
    <polyline points={points} fill="none" stroke="var(--space-brand-primary-500)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
  </svg>;
}

export default function QcSheet({ videoUrl, report, checks, busy, onRun, onBack, onEdit }: {
  videoUrl: string;
  report: FilmQaReport | null;
  checks: CheckResult[];
  busy?: boolean;
  onRun: () => void;
  onBack: () => void;
  onEdit: () => void;
}) {
  const frames = Array.isArray(report?.frames) ? report!.frames : [];
  const cuts = Array.isArray(report?.cut_pairs) ? report!.cut_pairs : [];
  const luma = Array.isArray(report?.luma_sparkline) ? report!.luma_sparkline : [];
  const pass = report?.status === 'pass' && checks.every((check) => check.pass);
  return <div className="min-h-full bg-[var(--space-surface-bg)] p-4 text-[var(--space-text-primary)] sm:p-6">
    <div className="mx-auto max-w-7xl space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <button onClick={onBack} className="flex items-center gap-2 rounded-lg border border-[var(--space-border-default)] px-3 py-2 text-sm"><ArrowLeft className="h-4 w-4" />Studio</button>
        <div className="min-w-0 flex-1"><p className="text-[10px] font-bold uppercase tracking-[.2em] text-[var(--space-text-muted)]">Film QC gate</p><h1 className="text-xl font-bold">Temporal contact sheet</h1></div>
        <button onClick={onEdit} className="rounded-lg border border-[var(--space-border-default)] px-4 py-2 text-sm font-semibold">Edit layers</button>
        <button disabled={busy || !videoUrl} onClick={onRun} className="flex items-center gap-2 rounded-lg bg-[var(--space-brand-primary-600)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><RefreshCw className={busy ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />{busy ? 'Inspecting…' : 'Run QC again'}</button>
      </header>

      <section className={`rounded-xl border p-4 ${pass ? 'border-[color-mix(in_srgb,var(--space-semantic-success-500)_40%,transparent)] bg-[color-mix(in_srgb,var(--space-semantic-success-500)_10%,transparent)]' : 'border-[var(--space-border-default)] bg-[var(--space-surface-card)]'}`}>
        <div className="flex items-start gap-3">{pass ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-[var(--space-semantic-success)]" /> : <AlertTriangle className="mt-0.5 h-5 w-5 text-[var(--space-semantic-warning)]" />}<div><p className="font-semibold">{pass ? 'Film QC passed' : report?.status === 'flagged' ? 'Review the flagged frames' : 'QC sheet is ready to run'}</p><p className="mt-1 text-sm text-[var(--space-text-secondary)]">{report?.reason || 'SceneForge samples 11 points across the complete film and checks every declared cut pair.'}</p></div></div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(300px,.8fr)]">
        <section className="rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-4">
          <video src={videoUrl} controls playsInline className="aspect-video w-full rounded-lg bg-black object-contain" />
          <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-11">
            {frames.map((frame) => <figure key={frame.index} className="min-w-0">
              <div className="relative aspect-video overflow-hidden rounded-md bg-black"><img src={frame.thumbnail} alt={`Frame at ${frame.at_sec.toFixed(1)} seconds`} className="h-full w-full object-cover" /><span className="pointer-events-none absolute inset-[5%] border border-dashed border-white/60" /></div>
              <figcaption className="mt-1 text-center font-mono text-[9px] text-[var(--space-text-muted)]">{frame.at_sec.toFixed(1)}s</figcaption>
            </figure>)}
            {!frames.length ? Array.from({ length: 11 }, (_, index) => <div key={index} className="aspect-video animate-pulse rounded-md bg-[var(--space-surface-panel)]" />) : null}
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-4"><p className="text-xs font-bold uppercase tracking-wide text-[var(--space-text-muted)]">Luma across time</p><Sparkline values={luma} /><div className="flex justify-between font-mono text-[10px] text-[var(--space-text-muted)]"><span>0</span><span>255</span></div></section>
          <section className="rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-4"><div className="flex items-center gap-2"><Scissors className="h-4 w-4 text-[var(--space-text-brand)]" /><p className="font-semibold">Cut-pair integrity</p></div><p className="mt-1 text-xs text-[var(--space-text-muted)]">Frames 80 ms before and after each cut must both decode and differ.</p><div className="mt-3 max-h-44 space-y-2 overflow-y-auto">{cuts.length ? cuts.map((cut) => <div key={cut.cut_sec} className="flex items-center justify-between rounded-lg bg-[var(--space-surface-panel)] px-3 py-2 text-xs"><span className="font-mono">{cut.cut_sec.toFixed(2)}s</span><span className={cut.pass ? 'text-[var(--space-semantic-success)]' : 'text-[var(--space-semantic-danger)]'}>{cut.pass ? 'clean' : cut.reason}</span></div>) : <p className="text-xs text-[var(--space-text-muted)]">No declared cut pairs were available.</p>}</div></section>
          <section className="rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-4"><div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[var(--space-text-brand)]" /><p className="font-semibold">Title-safe band</p></div><p className="mt-2 text-sm text-[var(--space-text-secondary)]">{report?.safe_band_pass === false ? `${report.safe_band_issues?.length || 0} sampled frames carry repeated high-contrast detail in the outer 5%.` : 'The sampled frames keep critical high-contrast detail inside the 5% border.'}</p></section>
        </aside>
      </div>

      <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{checks.map((check) => <div key={check.id} className="rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-3"><div className="flex items-center gap-2 text-sm font-semibold">{check.pass ? <CheckCircle2 className="h-4 w-4 text-[var(--space-semantic-success)]" /> : <AlertTriangle className="h-4 w-4 text-[var(--space-semantic-danger)]" />}{check.label}</div><p className="mt-1 text-xs text-[var(--space-text-muted)]">{check.detail}</p></div>)}</section>
    </div>
  </div>;
}
