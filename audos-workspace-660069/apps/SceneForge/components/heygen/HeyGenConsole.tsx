// The HeyGen suite, assembled.
//
// The panels below are deliberately ordered as the decisions a customer
// actually makes: lock the character, lock the brand, teach it your words, set
// the voice, write the brief, then finish the film. Each panel owns its own
// state and its own failures; this file owns only the order, the finished
// video, and the recent-jobs list that proves a render survived a reload.
import { useCallback, useEffect, useState } from 'react';
import { Clapperboard, History, RefreshCw, Video } from 'lucide-react';
import { allCapabilities, onCapabilityChange, resetCapabilities } from '../../lib/heygenApi';
import { lockSummary, useHeyGenSession } from '../../lib/heygenSession';
import { recentJobs, type JobRow } from '../../lib/sfJobs';
import AvatarPanel from './AvatarPanel';
import BrandPanel from './BrandPanel';
import ComposePanel, { type Generated } from './ComposePanel';
import HyperFramePanel from './HyperFramePanel';
import PostPanel from './PostPanel';
import VoicePanel from './VoicePanel';
import { Notice } from './ui';

function RecentJobs({ jobs, onOpen }: { jobs: JobRow[]; onOpen: (url: string) => void }) {
  if (!jobs.length) return null;
  return <section className="rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-5">
    <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--space-text-primary)]">
      <History className="h-4 w-4 text-[var(--space-text-muted)]" />Recent jobs
    </h2>
    <p className="mt-0.5 text-xs text-[var(--space-text-muted)]">
      Everything this studio has sent to HeyGen, including renders that finished after you closed the tab.
    </p>
    <div className="mt-3 space-y-2">
      {jobs.map((job) => <div key={job.videoId} className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-3 text-sm">
        <span className="min-w-0 flex-1 truncate font-medium text-[var(--space-text-primary)]">
          {String((job.metadata as any)?.prompt || job.jobType || 'HeyGen job').slice(0, 72)}
        </span>
        <span className="rounded-full bg-[var(--space-surface-muted)] px-2 py-0.5 text-[11px] uppercase tracking-wide text-[var(--space-text-muted)]">
          {(job.jobType || 'job').replace(/_/g, ' ')}
        </span>
        <span className={`text-[11px] font-semibold ${job.status === 'completed'
          ? 'text-[var(--space-semantic-success)]'
          : job.status === 'failed' ? 'text-[var(--space-semantic-danger)]' : 'text-[var(--space-text-muted)]'}`}>
          {job.status}
        </span>
        {job.videoUrl ? <button
          type="button"
          onClick={() => onOpen(job.videoUrl)}
          className="rounded-lg border border-[var(--space-border-default)] px-2.5 py-1 text-[11px] font-semibold text-[var(--space-text-secondary)] hover:border-[var(--space-border-strong)]"
        >
          Open
        </button> : null}
      </div>)}
    </div>
  </section>;
}

export default function HeyGenConsole({ onBackToQuickRender }: { onBackToQuickRender?: () => void }) {
  const session = useHeyGenSession();
  const [video, setVideo] = useState('');
  const [jobs, setJobs] = useState<JobRow[]>([]);
  // Capability discovery happens as calls are made, so the console re-renders
  // when the registry learns something — that is what makes the "not on this
  // plan" notes appear without a reload.
  const [, bump] = useState(0);

  useEffect(() => onCapabilityChange(() => bump((current) => current + 1)), []);

  const refreshJobs = useCallback(() => {
    recentJobs(12).then(setJobs).catch(() => { /* the list is a convenience, not a requirement */ });
  }, []);

  useEffect(() => {
    refreshJobs();
    // Picks up rows the webhook settled while the customer was away, without
    // hammering the table — a job in flight is already polled by its own panel.
    const timer = window.setInterval(refreshJobs, 30000);
    return () => window.clearInterval(timer);
  }, [refreshJobs]);

  const onGenerated = useCallback((result: Generated) => {
    setVideo(result.videoUrl);
    refreshJobs();
  }, [refreshJobs]);

  const locks = lockSummary();
  const unavailable = Object.entries(allCapabilities()).filter(([, state]) => state === 'unavailable');

  return <div className="sfstudio relative flex h-full min-h-[560px] flex-col overflow-hidden bg-[var(--space-surface-bg)] text-[var(--space-text-primary)]"
    style={{ backgroundImage: 'radial-gradient(1100px 520px at 12% -8%, rgba(99,102,241,.20), transparent 62%), radial-gradient(900px 480px at 92% 4%, rgba(139,92,246,.17), transparent 58%), linear-gradient(165deg,#0f172a,#0b1022 52%,#140e2b)' }}>
    <style>{`
      @keyframes st-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
      @keyframes st-shimmer { 0%, 100% { opacity: .40; } 50% { opacity: .85; } }
      .sfstudio .st-rise { animation: st-rise .32s cubic-bezier(.22,.9,.3,1) both; }
      .sfstudio .st-shimmer { animation: st-shimmer 1.4s ease-in-out infinite; }
      .sfstudio button, .sfstudio a { transition: transform .16s cubic-bezier(.22,.9,.3,1), background-color .16s ease, border-color .16s ease, box-shadow .2s ease, opacity .16s ease; }
      .sfstudio button:active:not(:disabled) { transform: scale(.97); }
      .sfstudio .st-field { width: 100%; border-radius: .75rem; border: 1px solid var(--space-border-default); background: var(--space-surface-panel); padding: .6rem .75rem; font-size: .875rem; color: var(--space-text-primary); outline: none; transition: border-color .18s ease, box-shadow .18s ease; }
      .sfstudio .st-field::placeholder { color: var(--space-text-muted); }
      .sfstudio .st-field:focus { border-color: #8b5cf6; box-shadow: 0 0 0 4px rgba(139,92,246,.18); }
      .sfstudio .st-scroll::-webkit-scrollbar { width: 8px; }
      .sfstudio .st-scroll::-webkit-scrollbar-thumb { background: var(--space-border-strong); border-radius: 999px; }
      @media (prefers-reduced-motion: reduce) { .sfstudio *, .sfstudio *::before, .sfstudio *::after { animation: none !important; transition-duration: .01ms !important; } }
    `}</style>

    <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[color-mix(in_srgb,#ffffff_8%,transparent)] bg-[color-mix(in_srgb,#0b1022_72%,transparent)] px-4 py-3 backdrop-blur sm:px-6">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl shadow-[0_4px_16px_rgba(99,102,241,.45)]" style={{ backgroundImage: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
        <Clapperboard className="h-4 w-4 text-white" />
      </span>
      <div className="min-w-0">
        <h1 className="truncate text-base font-bold tracking-tight">SceneForge HeyGen Suite</h1>
        <p className="hidden text-xs text-[var(--space-text-muted)] sm:block">
          One character, one brand, every scene — brief to finished film.
        </p>
      </div>
      <div className="ml-auto flex items-center gap-2">
        {unavailable.length ? <button
          type="button"
          onClick={resetCapabilities}
          title="Check your HeyGen plan again"
          className="flex items-center gap-1.5 rounded-xl border border-[var(--space-border-default)] px-3 py-2 text-xs font-medium text-[var(--space-text-secondary)] hover:border-[var(--space-border-strong)]"
        >
          <RefreshCw className="h-3.5 w-3.5" /><span className="hidden sm:inline">Re-check plan</span>
        </button> : null}
        {onBackToQuickRender ? <button
          type="button"
          onClick={onBackToQuickRender}
          className="flex items-center gap-2 rounded-xl border border-[var(--space-border-default)] px-3 py-2 text-xs font-medium text-[var(--space-text-secondary)] hover:border-[var(--space-border-strong)]"
        >
          <Video className="h-4 w-4" /><span className="hidden sm:inline">Quick render</span>
        </button> : null}
      </div>
    </header>

    {locks.length ? <div className="shrink-0 border-b border-[color-mix(in_srgb,#ffffff_6%,transparent)] bg-[color-mix(in_srgb,#8b5cf6_8%,transparent)] px-4 py-2 sm:px-6">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--space-text-secondary)]">
        <span className="font-semibold uppercase tracking-wide text-[var(--space-text-muted)]">Locked for this session</span>
        {locks.map((entry) => <span key={entry}>{entry}</span>)}
      </div>
    </div> : null}

    <div className="st-scroll flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:px-6">
        <AvatarPanel step={1} />
        {/* BrandPanel renders two steps of its own (kit, then glossary),
            so the voice panel picks up at 4. */}
        <BrandPanel step={2} />
        <VoicePanel step={4} />
        <ComposePanel step={5} onGenerated={onGenerated} />
        <HyperFramePanel step={6} />

        {video
          ? <PostPanel step={7} videoUrl={video} onNewVideo={setVideo} />
          : <Notice tone="info" title="Post-production unlocks once you have a video">
            Re-voicing, translation, music, sound effects and short clips all work on a finished film, so they appear here
            as soon as your first render lands.
          </Notice>}

        <RecentJobs jobs={jobs} onOpen={setVideo} />

        {!session.avatarId ? <p className="pb-2 text-center text-xs text-[var(--space-text-muted)]">
          Start at the top: pick a presenter, and the rest of the suite follows.
        </p> : null}
      </div>
    </div>
  </div>;
}
