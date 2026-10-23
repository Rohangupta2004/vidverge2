import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Loader2, RotateCw, X } from 'lucide-react';

interface JobRow {
  id: string;
  appId: string;
  app: string;
  title: string;
  stage: string;
  progress: number;
  status: 'running' | 'failed' | 'complete' | 'waiting';
  updatedAt: string;
}

type Source = { table: string; appId: string; app: string };

const SOURCES: Source[] = [
  { table: 'vv_render_jobs', appId: 'vidverge-agent', app: 'Render' },
  { table: 'vge_video_jobs', appId: 'vidverge-engine', app: 'Video Engine' },
  { table: 's2v_films', appId: 'script-to-video', app: 'Script-to-Video' },
  { table: 'sceneforge_projects', appId: 'sceneforge', app: 'SceneForge' },
  { table: 'sf_director_films', appId: 'sceneforge', app: 'SceneForge Director' },
  { table: 'fc_projects', appId: 'faceless', app: 'Faceless' },
  { table: 'faceless_films', appId: 'faceless', app: 'Faceless' },
  { table: 'video_enhancements', appId: 'video-enhancer', app: 'Video Enhancer' },
  { table: 've_studio_projects', appId: 'video-enhancer', app: 'Video Enhancer' },
  { table: 'cine_projects', appId: 'cineagent', app: 'Studio' },
  { table: 'vergeye_comparisons', appId: 'phantom', app: 'Vergeye' },
  { table: 'pl_projects', appId: 'product-launch', app: 'Product Launch' },
  { table: 'ads_studio_jobs', appId: 'ads-studio', app: 'Ads Studio' },
  { table: 'vv_heygen_renders', appId: 'vidverge-agent', app: 'Verger' },
];

const RENDER_APP_IDS: Record<string, string> = {
  s2v: 'script-to-video',
  sceneforge: 'sceneforge',
  'product-launch': 'product-launch',
  'ads-studio': 'ads-studio',
  faceless: 'faceless',
  enhancer: 'video-enhancer',
  vergeye: 'phantom',
  studio: 'studio',
};

const COMPLETE = new Set(['complete', 'completed', 'done', 'ready', 'final_video', 'success', 'succeeded']);
const FAILED = new Set(['failed', 'error', 'cancelled', 'canceled']);
const WAITING = new Set(['draft', 'paused', 'waiting', 'prompt_ready', 'plan_ready']);
const PROGRESS: Record<string, number> = {
  queued: 4, pending: 6, draft: 4, planning: 14, researching: 18, analyzing: 20,
  scripting: 28, narrating: 36, audio_synthesis: 38, generating_visuals: 62,
  generating: 66, producing: 68, asset_gen: 70, rendering: 84, assembling: 91,
  finishing: 95, checking: 97, auditing: 97, complete: 100, completed: 100,
  done: 100, ready: 100, failed: 100, error: 100,
};

function text(value: unknown): string {
  return String(value || '').trim();
}

function normalizedStatus(row: Record<string, any>): string {
  return text(row.status || row.machine_state || row.phase || row.stage || row.assembly_status || 'queued').toLowerCase();
}

function titleOf(row: Record<string, any>, source: Source): string {
  return text(row.title || row.project_name || row.topic || row.name || row.product_name || row.script?.slice?.(0, 60)) || `${source.app} project`;
}

function stageOf(row: Record<string, any>, status: string): string {
  const raw = text(row.stage_detail || row.stage_note || row.current_stage || row.stage || row.machine_state || status);
  return raw.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function progressOf(row: Record<string, any>, status: string): number {
  const explicit = Number(row.progress ?? row.progress_percent ?? row.percent_complete);
  if (Number.isFinite(explicit)) return Math.max(0, Math.min(100, explicit <= 1 ? explicit * 100 : explicit));
  const assembly = Number(row.assembly_job?.progress);
  if (Number.isFinite(assembly)) return Math.max(0, Math.min(100, assembly));
  return PROGRESS[status] ?? 12;
}

function mapRow(source: Source, row: Record<string, any>): JobRow | null {
  if (source.table === 'vv_render_jobs' && text(row.app) === '_dispatcher') return null;
  const raw = normalizedStatus(row);
  const status: JobRow['status'] = FAILED.has(raw)
    ? 'failed'
    : COMPLETE.has(raw)
      ? 'complete'
      : WAITING.has(raw)
        ? 'waiting'
        : 'running';
  return {
    id: `${source.table}:${text(row.id)}`,
    appId: source.table === 'vv_render_jobs' && text(row.app) ? (RENDER_APP_IDS[text(row.app)] || source.appId) : source.appId,
    app: source.table === 'vv_render_jobs' && text(row.app) ? text(row.app).replace(/-/g, ' ') : source.app,
    title: titleOf(row, source),
    stage: stageOf(row, raw),
    progress: Math.round(progressOf(row, raw)),
    status,
    updatedAt: text(row.updated_at || row.progress_at || row.created_at),
  };
}

async function querySource(source: Source): Promise<JobRow[]> {
  const db = (window as any).__workspaceDb;
  if (!db?.from) return [];
  const read = async (orderBy: string) => db.from(source.table).orderBy(orderBy, 'desc').limit(8).get();
  let response: any;
  try { response = await read('updated_at'); }
  catch { response = await read('created_at'); }
  const rows = Array.isArray(response?.data) ? response.data : [];
  return rows.map((row: Record<string, any>) => mapRow(source, row)).filter(Boolean) as JobRow[];
}

async function loadJobs(): Promise<JobRow[]> {
  const settled = await Promise.allSettled(SOURCES.map(querySource));
  const rows = settled.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  const unique = new Map<string, JobRow>();
  rows.forEach((job) => unique.set(job.id, job));
  return [...unique.values()]
    .sort((a, b) => Date.parse(b.updatedAt || '0') - Date.parse(a.updatedAt || '0'))
    .slice(0, 16);
}

export default function BackgroundJobsTray({
  placement = 'top',
  variant = 'pill',
}: {
  placement?: 'top' | 'bottom';
  /**
   * 'pill' is the original floating chrome button. 'compact' is the quiet
   * header readout — same live count and the same disclosure panel, without
   * the raised pill treatment that reads as a badge next to the credits.
   */
  variant?: 'pill' | 'compact';
}) {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = async () => {
    try {
      const next = await loadJobs();
      setJobs(next);
      setError('');
    } catch (reason: any) {
      setError(text(reason?.message) || 'Jobs could not be refreshed.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let live = true;
    const run = async () => {
      if (!live) return;
      await refresh();
    };
    void run();
    const timer = window.setInterval(() => void run(), 5000);
    return () => { live = false; window.clearInterval(timer); };
  }, []);

  const visible = useMemo(() => jobs.filter((job) => job.status !== 'complete').slice(0, 8), [jobs]);
  const running = visible.filter((job) => job.status === 'running').length;
  const failed = visible.filter((job) => job.status === 'failed').length;

  const openJob = (job: JobRow) => {
    setOpen(false);
    window.dispatchEvent(new CustomEvent('openApp', { detail: { appId: job.appId } }));
  };

  return (
    <div className="relative" data-testid="background-jobs-tray">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={
          variant === 'compact'
            ? 'flex min-h-11 items-center gap-1.5 rounded-[10px] px-2 text-[13px] font-semibold text-[var(--space-text-primary)] transition-colors hover:bg-[var(--vg-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vg-focus)]'
            : 'flex min-h-11 items-center gap-2 rounded-full border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] px-3.5 text-xs font-semibold text-[var(--space-text-primary)] shadow-[0_12px_36px_rgba(0,0,0,0.38)]'
        }
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-[var(--space-text-brand)]" /> : failed ? <AlertTriangle className="h-4 w-4 text-[var(--space-semantic-danger-500)]" /> : running ? <Loader2 className="h-4 w-4 animate-spin text-[var(--space-text-brand)]" /> : <CheckCircle2 className="h-4 w-4 text-[var(--space-semantic-success-500)]" />}
        Jobs {running ? `· ${running}` : ''}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open ? (
        <section className={`absolute right-0 z-[90] w-[min(390px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] shadow-2xl ${placement === 'bottom' ? 'bottom-[calc(100%+8px)]' : 'top-[calc(100%+8px)]'}`}>
          <header className="flex items-center justify-between border-b border-[var(--space-border-default)] px-4 py-3">
            <div><h2 className="text-sm font-semibold text-[var(--space-text-primary)]">Background jobs</h2><p className="text-[11px] text-[var(--space-text-muted)]">Runs keep moving after you leave a studio.</p></div>
            <button type="button" onClick={() => setOpen(false)} className="grid h-11 w-11 place-items-center rounded-xl text-[var(--space-text-muted)] hover:bg-[var(--space-surface-muted)]" aria-label="Close jobs"><X className="h-4 w-4" /></button>
          </header>
          <div className="max-h-[min(520px,65vh)] overflow-y-auto p-2">
            {error ? <div className="m-2 rounded-xl border border-[color-mix(in_srgb,var(--space-semantic-danger-500)_35%,transparent)] bg-[color-mix(in_srgb,var(--space-semantic-danger-500)_10%,transparent)] p-3 text-xs text-[var(--space-text-secondary)]"><div>{error}</div><button type="button" onClick={() => void refresh()} className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-lg border border-[var(--space-border-strong)] px-3 font-semibold"><RotateCw className="h-3.5 w-3.5" />Try again</button></div> : null}
            {!loading && !visible.length && !error ? <p className="p-6 text-center text-sm text-[var(--space-text-muted)]">No running jobs.</p> : null}
            {visible.map((job) => (
              <button key={job.id} type="button" onClick={() => openJob(job)} className="mb-1 block min-h-11 w-full rounded-xl px-3 py-2.5 text-left hover:bg-[var(--space-surface-muted)]">
                <div className="flex items-center justify-between gap-3"><span className="truncate text-xs font-semibold text-[var(--space-text-primary)]">{job.title}</span><span className={`shrink-0 text-[10px] font-semibold ${job.status === 'failed' ? 'text-[var(--space-semantic-danger-500)]' : job.status === 'waiting' ? 'text-[var(--space-text-muted)]' : 'text-[var(--space-text-brand)]'}`}>{job.status === 'failed' ? 'Needs attention' : job.status === 'waiting' ? 'Waiting' : `${job.progress}%`}</span></div>
                <div className="mt-1 flex items-center justify-between gap-3 text-[10px] text-[var(--space-text-muted)]"><span className="truncate capitalize">{job.app}</span><span className="truncate">{job.stage}</span></div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--space-surface-panel-strong)]"><span className={`block h-full rounded-full ${job.status === 'failed' ? 'bg-[var(--space-semantic-danger-500)]' : 'bg-[var(--space-brand-primary-500)]'}`} style={{ width: `${job.progress}%` }} /></div>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
