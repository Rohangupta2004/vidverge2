import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowRight, Film, History, Loader2, Wand2 } from 'lucide-react';

import JobTracker from './components/JobTracker';
import MultiShotForm, {
  canSubmitMultiShot,
  emptyMultiShot,
  toRunInput,
} from './components/MultiShotForm';
import type { MultiShotFormValue } from './components/MultiShotForm';
import PipelineSelector from './components/PipelineSelector';
import ResultView from './components/ResultView';
import RunwayRecipes from './components/RunwayRecipes';
import { getJob, listJobs } from './lib/jobs';
import { PIPELINE_B, pipelineSpec, slaLabel } from './lib/pipelineSpecs';
import { multiShotBrief, runDocumentaryPipeline, runKineticPipeline, runMultiShotPipeline } from './lib/pipelines';
import { followPipelineJob } from './lib/pipelineJobs';
import { followRunwayJob } from './lib/runwayJobs';
import type { DurableJob } from './lib/runwayJobs';
import { formatUsd, hasWorkspaceToken, SESSION_NOT_READY } from './lib/runtime';
import type { JobStatus, PipelineId, PipelineReporter, VideoJob } from './types';
import { withBrandContext } from '../../components/BrandContextLayer';

/**
 * What a stopped job says when its row carries no reason.
 *
 * Rows written before orchestration moved server-side could reach FAILED with
 * `error_message` null, because the browser that failed them was already gone.
 * Showing "Stopped" with no explanation reads as a bug in the product, so the
 * absent reason is named for what it is.
 */
const NO_REASON_RECORDED =
  'This run stopped before it could record a reason \u2014 it was started by an older version of the engine that lost the job when the page closed. Start it again and it will now run to the end on the server.';

/** The brief's polling interval for the job row. */
const POLL_MS = 3000;

type Phase = 'setup' | 'running' | 'done';
/** The app has two faces: the tracked pipelines, and the one-off recipes. */
type View = 'pipelines' | 'recipes';

const UNTITLED: Record<PipelineId, string> = {
  CODE_ENGINEERED: 'Untitled reel',
  HYBRID_DOCUMENTARY: 'Untitled documentary',
  RUNWAY_MULTI_SHOT: 'Untitled ad',
};

function defaultProjectName(pipeline: PipelineId, source: string): string {
  const trimmed = source.trim().replace(/^https?:\/\//i, '').replace(/\/$/, '').replace(/\s+/g, ' ');
  if (!trimmed) return UNTITLED[pipeline];
  return trimmed.length > 60 ? trimmed.slice(0, 57) + '\u2026' : trimmed;
}

const BrandedVidvergeEngine = withBrandContext(VidvergeEngine, 'Video Engine', { useBrand: true });
export default BrandedVidvergeEngine;
function VidvergeEngine() {
  const [pipeline, setPipeline] = useState<PipelineId>('CODE_ENGINEERED');
  const [phase, setPhase] = useState<Phase>('setup');
  const [view, setView] = useState<View>('pipelines');

  const [sourceUrl, setSourceUrl] = useState('');
  const [direction, setDirection] = useState('');
  const [topic, setTopic] = useState('');
  const [multiShot, setMultiShot] = useState<MultiShotFormValue>(emptyMultiShot);

  const [job, setJob] = useState<VideoJob | null>(null);
  const [status, setStatus] = useState<JobStatus>('QUEUED');
  const [detail, setDetail] = useState('');
  const [notices, setNotices] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [recent, setRecent] = useState<VideoJob[]>([]);

  const cancelled = useRef(false);
  const spec = pipelineSpec(pipeline);

  // ---- recent jobs -------------------------------------------------------
  const refreshRecent = useCallback(() => {
    if (!hasWorkspaceToken()) return;
    listJobs(8)
      .then(setRecent)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshRecent();
  }, [refreshRecent]);

  // ---- elapsed clock -----------------------------------------------------
  useEffect(() => {
    if (phase !== 'running') return;
    const started = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  // ---- job row polling ---------------------------------------------------
  // The row is the truth now that the orchestrators own every long stage, so
  // this read is what finishes a job in the UI: the finished URL and a FAILED
  // outcome land here whether or not an in-tab callback was missed. A tab
  // closed mid-run no longer loses anything — the run belongs to the server,
  // so the job reappears under "Your videos" and `resume` below reattaches to
  // it, progress line and all.
  useEffect(() => {
    if (phase !== 'running' || !job?.id) return;
    const jobId = job.id;
    const timer = setInterval(async () => {
      try {
        const row = await getJob(jobId);
        if (!row) return;
        setJob(row);
        setStatus((local) => (row.status === 'FAILED' ? 'FAILED' : local));
        if (row.status === 'FAILED' && row.error_message) {
          // The row carries why it stopped (failJob wrote it) — show that
          // instead of leaving the tracker on a reasonless red state.
          setError((current) => current || row.error_message || null);
        }
        if (row.status === 'COMPLETED' && row.master_video_url) {
          setStatus('COMPLETED');
          setPhase('done');
          refreshRecent();
        }
      } catch {
        // A dropped read is not a dropped render.
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [phase, job?.id, refreshRecent]);

  const reporter: PipelineReporter = useMemo(
    () => ({
      onStage: setStatus,
      onDetail: setDetail,
      onNotice: (notice) => setNotices((list) => (list.includes(notice) ? list : [...list, notice])),
      isCancelled: () => cancelled.current,
    }),
    [],
  );

  /**
   * Reattach to a job the server is still running.
   *
   * This is only possible because the orchestrators own the run: before that,
   * a job's progress lived in the tab that started it and a reopened page
   * could do nothing but watch a status column. Now the stage detail, the
   * per-beat count and the retry notices all come off the row.
   */
  const resume = useCallback(
    async (entry: VideoJob) => {
      cancelled.current = false;
      setError(null);
      setNotices([]);
      setDetail('');
      setJob(entry);
      setPipeline(entry.pipeline);
      setStatus(entry.status);
      setPhase('running');

      const watch = entry.pipeline === 'RUNWAY_MULTI_SHOT' ? followRunwayJob : followPipelineJob;
      try {
        const final = await watch(entry.id, {
          onUpdate: (live: DurableJob) => {
            if (live.stageDetail) setDetail(live.stageDetail);
            if (live.lastError) {
              setNotices((list) => (list.includes(live.lastError!) ? list : [...list, live.lastError!]));
            }
            setStatus(live.status as JobStatus);
          },
          shouldStop: () => cancelled.current,
        });
        const row = await getJob(entry.id);
        if (row) setJob(row);
        if (final?.phase === 'completed' && final.masterVideoUrl) {
          setStatus('COMPLETED');
          setPhase('done');
        } else if (final && (final.phase === 'failed' || final.phase === 'cancelled')) {
          setStatus('FAILED');
          setError(final.errorMessage || NO_REASON_RECORDED);
        }
        refreshRecent();
      } catch (caught: any) {
        // Losing the watch is not losing the job, and saying otherwise would be
        // the exact lie this rework removes.
        setDetail('');
        setNotices((list) => [
          ...list,
          `This page stopped following the job (${String(caught?.message || caught)}), but the server is still making it \u2014 reopen it from "Your videos".`,
        ]);
      }
    },
    [refreshRecent],
  );

  const canSubmit =
    pipeline === 'CODE_ENGINEERED'
      ? sourceUrl.trim().length > 3 && direction.trim().length > 10
      : pipeline === 'RUNWAY_MULTI_SHOT'
        ? canSubmitMultiShot(multiShot)
        : topic.trim().length > 10;

  /** The brief, named from its own first line. */
  function multiShotInput() {
    const input = toRunInput(multiShot, UNTITLED.RUNWAY_MULTI_SHOT);
    return {
      ...input,
      projectName: defaultProjectName('RUNWAY_MULTI_SHOT', multiShotBrief(input).split('\n')[0] || ''),
    };
  }

  async function start() {
    if (!canSubmit || phase === 'running') return;
    if (!hasWorkspaceToken()) {
      setError(SESSION_NOT_READY);
      return;
    }

    cancelled.current = false;
    setError(null);
    setNotices([]);
    setDetail('');
    setStatus('QUEUED');
    setJob(null);
    setPhase('running');

    try {
      const result =
        pipeline === 'CODE_ENGINEERED'
          ? await runKineticPipeline(
              {
                projectName: defaultProjectName(pipeline, sourceUrl),
                sourceUrl: sourceUrl.trim(),
                direction: direction.trim(),
              },
              reporter,
              setJob,
            )
          : pipeline === 'RUNWAY_MULTI_SHOT'
            ? await runMultiShotPipeline(multiShotInput(), reporter, setJob)
            : await runDocumentaryPipeline(
                {
                  projectName: defaultProjectName(pipeline, topic),
                  topic: topic.trim(),
                },
                reporter,
                setJob,
              );

      const finished = await getJob(result.jobId);
      setJob(finished);
      setPhase('done');
      refreshRecent();
    } catch (caught: any) {
      setError(String(caught?.message || caught || 'The job stopped unexpectedly.'));
      setStatus('FAILED');
      refreshRecent();
    }
  }

  function reset() {
    cancelled.current = true;
    setPhase('setup');
    setJob(null);
    setStatus('QUEUED');
    setDetail('');
    setNotices([]);
    setError(null);
  }

  return (
    <div className="h-full overflow-y-auto bg-[radial-gradient(ellipse_76%_44%_at_50%_-8%,color-mix(in_srgb,var(--space-brand-primary-500)_12%,transparent),transparent_64%),var(--space-surface-bg)] text-[var(--space-text-primary)]">
      <div className="mx-auto w-full max-w-[940px] px-5 py-7 md:px-8 md:py-10">
        <header className="relative mb-7 overflow-hidden rounded-3xl border border-[var(--space-border-default)] bg-[color-mix(in_srgb,var(--space-surface-card)_90%,transparent)] p-6 shadow-[0_24px_64px_rgba(0,0,0,0.32)] md:p-7">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]"
            style={{
              background: 'color-mix(in srgb, var(--space-brand-primary-500) 14%, transparent)',
              color: 'var(--space-brand-highlight)',
            }}
          >
            <Film className="h-3 w-3" />
            Video engine
          </span>
          <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-24 h-52 w-52 rounded-full bg-[color-mix(in_srgb,var(--space-brand-highlight-500)_12%,transparent)] blur-3xl" />
          <h1 className="relative mt-3 text-[28px] font-bold leading-tight tracking-[-0.035em] md:text-[34px]">
            Brief in. Broadcast-ready MP4 out.
          </h1>
          <p className="relative mt-2 max-w-[62ch] text-[14px] leading-relaxed text-[var(--space-text-secondary)]">
            Three autonomous pipelines. Nothing to edit, nothing to assemble: pick the look, give it
            one input, and the engine writes, voices, illustrates, animates and renders the whole
            cut for you.
          </p>
        </header>

        <nav className="mb-5 flex items-center gap-1 rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-1">
          {([
            { id: 'pipelines' as View, label: 'Pipelines', icon: Film },
            { id: 'recipes' as View, label: 'Runway Recipes', icon: Wand2 },
          ]).map((tab) => {
            const active = view === tab.id;
            const TabIcon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                disabled={phase === 'running'}
                onClick={() => setView(tab.id)}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                style={{
                  background: active ? 'var(--space-brand-primary-500)' : 'transparent',
                  color: active ? 'var(--space-text-on-primary)' : 'var(--space-text-secondary)',
                }}
              >
                <TabIcon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
        </nav>

        {view === 'recipes' ? (
          <RunwayRecipes />
        ) : phase === 'done' && job?.master_video_url ? (
          <ResultView job={job} onStartAnother={reset} />
        ) : (
          <>
            <PipelineSelector
              selected={pipeline}
              onSelect={setPipeline}
              disabled={phase === 'running'}
            />

            <section className="mt-5 rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-5">
              {pipeline === 'CODE_ENGINEERED' ? (
                <div className="flex flex-col gap-4">
                  <Field label="Product URL" hint="The engine reads this page for your real colours, logo and copy.">
                    <input
                      type="url"
                      value={sourceUrl}
                      onChange={(event) => setSourceUrl(event.target.value)}
                      disabled={phase === 'running'}
                      placeholder="https://yourproduct.com"
                      className={inputClass}
                    />
                  </Field>
                  <Field label="What should this reel do?" hint="One or two sentences. The voiceover is written from this.">
                    <textarea
                      value={direction}
                      onChange={(event) => setDirection(event.target.value)}
                      disabled={phase === 'running'}
                      rows={4}
                      placeholder="Introduce the new scheduling view to busy ops managers. Lead on how little setup it needs."
                      className={inputClass + ' resize-y'}
                    />
                  </Field>
                </div>
              ) : pipeline === 'RUNWAY_MULTI_SHOT' ? (
                <MultiShotForm
                  value={multiShot}
                  onChange={setMultiShot}
                  disabled={phase === 'running'}
                />
              ) : (
                <Field
                  label="Documentary topic"
                  hint={`Fifteen four-second beats, ${PIPELINE_B.durationSeconds} seconds in total, cut to the narration.`}
                >
                  <textarea
                    value={topic}
                    onChange={(event) => setTopic(event.target.value)}
                    disabled={phase === 'running'}
                    rows={5}
                    placeholder="Why the shipping container changed global trade more than any ship ever did."
                    className={inputClass + ' resize-y'}
                  />
                </Field>
              )}

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <p className="text-[12.5px] text-[var(--space-text-muted)]">
                  {`Estimated ${formatUsd(spec.costUsd)}, usually ${slaLabel(spec)}.`}
                </p>
                <button
                  type="button"
                  onClick={start}
                  disabled={!canSubmit || phase === 'running'}
                  className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13.5px] font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-45 hover:opacity-90"
                  style={{
                    background: 'var(--space-brand-primary-500)',
                    color: 'var(--space-text-on-primary)',
                  }}
                >
                  {phase === 'running' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowRight className="h-4 w-4" />
                  )}
                  {phase === 'running' ? 'Working\u2026' : spec.cta}
                </button>
              </div>
            </section>

            {(phase === 'running' || error) && (
              <div className="mt-5">
                <JobTracker
                  status={status}
                  pipeline={pipeline}
                  detail={detail}
                  notices={notices}
                  elapsedSeconds={elapsed}
                  slaSeconds={spec.slaSeconds}
                  error={error}
                  onCancel={phase === 'running' ? reset : undefined}
                />
              </div>
            )}
          </>
        )}

        {view === 'pipelines' && recent.length > 0 && phase !== 'running' && (
          <section className="mt-7">
            <h2 className="mb-3 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.07em] text-[var(--space-text-muted)]">
              <History className="h-3.5 w-3.5" />
              Your videos
            </h2>
            <ul className="flex flex-col gap-2">
              {recent.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    disabled={entry.status === 'FAILED' && !entry.master_video_url}
                    onClick={() => {
                      if (entry.master_video_url) {
                        setJob(entry);
                        setPipeline(entry.pipeline);
                        setStatus(entry.status);
                        setPhase('done');
                        return;
                      }
                      void resume(entry);
                    }}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] px-4 py-3 text-left transition-colors disabled:cursor-default enabled:hover:border-[color-mix(in_srgb,var(--space-brand-primary-500)_45%,transparent)]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] font-medium text-[var(--space-text-primary)]">
                        {entry.project_name}
                      </span>
                      <span className="block truncate text-[11.5px] text-[var(--space-text-muted)]">
                        {entry.status === 'FAILED'
                          ? entry.error_message || NO_REASON_RECORDED
                          : pipelineSpec(entry.pipeline).title}
                      </span>
                    </span>
                    <StatusPill status={entry.status} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

const inputClass = [
  'w-full rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)]',
  'px-3.5 py-2.5 text-[13.5px] text-[var(--space-text-primary)]',
  'placeholder:text-[var(--space-text-muted)]',
  'outline-none transition-colors',
  'focus:border-[var(--space-brand-primary-500)]',
  'disabled:opacity-60',
].join(' ');

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-[var(--space-text-primary)]">{label}</span>
      {children}
      <span className="text-[11.5px] text-[var(--space-text-muted)]">{hint}</span>
    </label>
  );
}

function StatusPill({ status }: { status: JobStatus }) {
  const tone =
    status === 'COMPLETED'
      ? 'var(--space-semantic-success-500)'
      : status === 'FAILED'
        ? 'var(--space-semantic-danger-500)'
        : 'var(--space-brand-highlight-500)';
  return (
    <span
      className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold"
      style={{
        background: `color-mix(in srgb, ${tone} 15%, transparent)`,
        color: tone,
      }}
    >
      {status === 'COMPLETED' ? 'Ready' : status === 'FAILED' ? 'Stopped' : 'In progress'}
    </span>
  );
}
