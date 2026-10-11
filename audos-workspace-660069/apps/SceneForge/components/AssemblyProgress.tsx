import { AlertTriangle, Clapperboard, Download, Layers, Music, RefreshCw, Sparkles, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { assemblyJobRunning, listScenes, type CheckResult, type Project, type Scene } from '../lib/supabase';
import { reviewAssembly, type AssemblyQcResult } from '../agents/orchestrator';
import { forgeApi } from '../lib/forge';
import { planOf } from '../lib/directorPlan';
import ChecksReport from './ChecksReport';
import CompositionPreview from './CompositionPreview';
import OverlayEditor from './OverlayEditor';
import VergeLoader from '../../../components/VergeLoader';

const ASSEMBLY_STATUS_LABELS: Record<string, string> = { preparing: 'Preparing', assembling: 'Assembling', checking: 'Checking', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled' };

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

type DisplayStepStatus = 'pending' | 'running' | 'done' | 'failed';
type DisplayStep = { key: string; label: string; status: DisplayStepStatus };

function measureVideoDuration(url?: string): Promise<number | null> {
  if (!url || !/\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const finish = (value: number | null) => { video.removeAttribute('src'); video.load(); resolve(value); };
    const timer = window.setTimeout(() => finish(null), 8000);
    video.preload = 'metadata'; video.onloadedmetadata = () => { window.clearTimeout(timer); finish(Number.isFinite(video.duration) ? video.duration : null); }; video.onerror = () => { window.clearTimeout(timer); finish(null); }; video.src = url;
  });
}

/**
 * Step 7. The film is watchable here before anything is downloaded, the music
 * bed has its own audio preview, and the download always points at the best
 * master available (music mix first, otherwise the assembled cut).
 */
export default function AssemblyProgress({ busy, note, failure, project, scenes = [], checks, musicBusy, musicNote, onRetry, onCancel, onContinue, onGenerateMusic, onMixMusic, onDraftEdited }: {
  busy: boolean;
  note: string;
  /** Why the last assembly attempt produced no film. Empty when it worked. */
  failure?: string;
  project: Project | null;
  /** The film's scenes — drive the draft preview and the overlay editor. */
  scenes?: Scene[];
  checks: CheckResult[];
  musicBusy?: boolean;
  musicNote?: string;
  onRetry: () => void;
  /** Stop the running assembly — nothing already produced is lost. */
  onCancel: () => void;
  onContinue: () => void;
  onGenerateMusic: (prompt: string) => void;
  onMixMusic: () => void;
  /** Called after a timeline-affecting edit lands (bumps the draft version). */
  onDraftEdited?: () => void;
}) {
  // The Director's music treatment prefills the brief — the user's own text
  // always wins once typed.
  const plan = planOf(project);
  const [prompt, setPrompt] = useState(String(plan?.music?.prompt || ''));
  const [previewOpen, setPreviewOpen] = useState(false);
  const [overlaysOpen, setOverlaysOpen] = useState(false);
  const lastGood = (project?.last_good_version || null) as Record<string, unknown> | null;
  const validationReport = (project?.timeline_report || null) as { warnings?: string[] } | null;
  const [qc, setQc] = useState<AssemblyQcResult | null>((project?.qc_report as AssemblyQcResult) || null);
  const [qcBusy, setQcBusy] = useState(false);
  const [qcError, setQcError] = useState('');
  const [retryingScene, setRetryingScene] = useState<number | null>(null);
  const reviewedUrl = useRef('');
  const assembled = project?.assembled_video_url;
  const final = project?.final_video_url;
  const playable = final || assembled;
  const portrait = project?.aspect_ratio === '9:16';
  // The live assembly job persisted on the project row: the panel below is
  // rebuilt from it after any reload, and a run driven by another tab feeds
  // it through the app's 4-second status poll.
  const job = project?.assembly_job || null;
  const jobRunning = busy || assemblyJobRunning(job);
  // The bed is mounted INSIDE the assembly render, so a cut only carries the
  // music when it was rendered with the bed the project holds now. Anything
  // else (no bed yet, a bed generated after this cut, a regenerated bed) still
  // needs one render before the film is scored.
  const bedInFilm = Boolean(project?.music_url && job?.music_url && job.music_url === project.music_url && assembled);
  const progressPct = Math.max(0, Math.min(100, Math.round(Number(job?.progress) || (busy ? 4 : 0))));
  const statusLabel = ASSEMBLY_STATUS_LABELS[job?.status || ''] || (busy ? 'Assembling' : '');
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => {
    if (!jobRunning) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [jobRunning]);
  const startedMs = job?.started_at ? Date.parse(job.started_at) : 0;
  const elapsedLabel = startedMs ? formatElapsed(nowMs - startedMs) : '0:00';
  const assemblySteps: DisplayStep[] = [
    { key: 'prepare', label: 'Prepare timeline and media', status: job?.status === 'preparing' ? 'running' : job ? 'done' : 'pending' },
    { key: 'render', label: 'Render the final film', status: job?.status === 'failed' ? 'failed' : job?.status === 'assembling' ? 'running' : playable || job?.status === 'checking' || job?.status === 'completed' ? 'done' : 'pending' },
    { key: 'checks', label: 'Validate output and delivery', status: job?.status === 'checking' ? 'running' : job?.status === 'completed' || Boolean(playable) ? 'done' : 'pending' },
  ];
  const stepTimings = useRef<Record<string, { status: DisplayStepStatus; startedAt?: number; elapsedMs?: number }>>({});
  const stepSignature = assemblySteps.map((step) => `${step.key}:${step.status}`).join('|');
  useEffect(() => {
    const now = Date.now();
    const reopenedAt = job?.updated_at ? Date.parse(String(job.updated_at)) : startedMs;
    const next = { ...stepTimings.current };
    assemblySteps.forEach((step) => {
      const previous = next[step.key];
      if (step.status === 'running' && previous?.status !== 'running') {
        next[step.key] = { status: step.status, startedAt: previous ? now : (Number.isFinite(reopenedAt) && reopenedAt > 0 ? reopenedAt : now) };
      } else if (step.status !== 'running' && previous?.status === 'running' && previous.startedAt) {
        next[step.key] = { status: step.status, elapsedMs: Math.max(0, now - previous.startedAt) };
      } else {
        next[step.key] = { ...previous, status: step.status };
      }
    });
    stepTimings.current = next;
    setNowMs(now);
  }, [stepSignature, project?.id]);
  const stepElapsed = (step: DisplayStep) => {
    const timing = stepTimings.current[step.key];
    if (step.status === 'running' && timing?.startedAt) return formatElapsed(nowMs - timing.startedAt);
    if ((step.status === 'done' || step.status === 'failed') && timing?.elapsedMs !== undefined) return formatElapsed(timing.elapsedMs);
    return '—';
  };

  useEffect(() => {
    if (!project?.id || !assembled || busy || reviewedUrl.current === assembled) return;
    const stored = project.qc_report as any;
    if (stored?.assembly_url === assembled && Array.isArray(stored.suggestions)) { setQc(stored); reviewedUrl.current = assembled; return; }
    reviewedUrl.current = assembled; setQcBusy(true); setQcError('');
    void (async () => {
      try {
        const scenes = await listScenes(project.id);
        const measured = await Promise.all(scenes.map((scene) => measureVideoDuration(scene.render_url)));
        const report = await reviewAssembly({
          durationSec: Number(project.avatar_duration_sec || project.target_length_sec || 0),
          assembledVideoUrl: assembled,
          editingPreset: project.editing_preset,
          scenes: scenes.map((scene, index) => ({ scene_id: scene.id, scene_index: scene.scene_index, start_sec: Number(scene.script_start_sec), end_sec: Number(scene.script_end_sec), planned_duration_sec: Number(scene.script_end_sec) - Number(scene.script_start_sec), media_duration_sec: measured[index], visual_kind: scene.visual_kind, status: scene.status, render_url: scene.render_url || null, over_avatar: scene.overlay_config?.overAvatar === true, description: scene.description })),
        });
        const persisted = { ...report, assembly_url: assembled };
        await Promise.all(scenes.map((scene) => {
          const suggestion = report.suggestions.find((item) => item.scene_id === scene.id || item.scene_index === scene.scene_index);
          return forgeApi.saveScene(project.id, scene.id, { qc_weak: suggestion?.weak === true, qc_suggestion: suggestion?.suggestion || null });
        }));
        await forgeApi.saveProject(project.id, { qc_report: persisted });
        setQc(report);
      } catch (error: any) { reviewedUrl.current = ''; setQcError(error.message || 'The Opus QC pass could not finish.'); }
      finally { setQcBusy(false); }
    })();
  }, [assembled, busy, project?.id]);

  const retryFlaggedScene = async (sceneIndex: number) => {
    if (!project?.id) return;
    setRetryingScene(sceneIndex);
    try {
      sessionStorage.setItem('sceneforge-auto-regenerate-scene', String(sceneIndex));
      await forgeApi.saveProject(project.id, { status: 'scene_review' });
      window.dispatchEvent(new CustomEvent('sceneforge:project-stage', { detail: { projectId: project.id, status: 'scene_review' } }));
    } catch (error: any) { sessionStorage.removeItem('sceneforge-auto-regenerate-scene'); setQcError(error.message || 'Could not open that isolated retry.'); setRetryingScene(null); }
  };

  return <div className="sf-step-shell mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
    <p className="text-xs font-bold uppercase tracking-[.2em] text-[var(--space-text-brand)]">Step 7 · Assembly, music and checks</p>
    <h1 className="mt-2 text-3xl font-bold text-[var(--space-text-primary)]">One continuous film</h1>
    <p className="mt-2 text-[var(--space-text-secondary)]">Supporting scenes replace the avatar picture. The original avatar audio remains the uninterrupted master track.</p>

    {/* LIVE ASSEMBLY PANEL. Status label, moving progress bar, the current
        operation in plain words, an elapsed-time counter, and Cancel — driven
        by the persisted assembly job, so a reload or a second tab shows the
        same live state instead of a static placeholder. */}
    {jobRunning ? <div className="mt-8 rounded-2xl border-2 border-[color-mix(in_srgb,var(--space-brand-primary-500)_45%,transparent)] bg-[var(--space-surface-panel)] p-5 shadow-[0_4px_24px_color-mix(in_srgb,var(--space-brand-primary-600)_25%,transparent)]">
      <div className="flex flex-wrap items-center gap-3">
        <VergeLoader size={64} label="Final assembly in progress" />
        <span className="rounded-full bg-[color-mix(in_srgb,var(--space-brand-primary-500)_14%,transparent)] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-[var(--space-text-brand)]">{statusLabel}</span>
        <span className="font-semibold text-[var(--space-text-primary)]">Final assembly in progress</span>
        <span className="ml-auto font-mono text-sm text-[var(--space-text-secondary)]">{progressPct}% · {elapsedLabel}</span>
      </div>
      <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-[var(--space-surface-muted)]"><div className="h-full rounded-full bg-[var(--space-brand-primary-500)] transition-all duration-700" style={{ width: `${progressPct}%` }} /></div>
      <p className="mt-3 text-sm text-[var(--space-text-secondary)]">{job?.message || note || project?.stage_note || 'Working…'}</p>
      <button onClick={onCancel} className="mt-4 flex items-center gap-2 rounded-xl border border-[var(--space-border-default)] px-4 py-2.5 text-sm font-semibold text-[var(--space-text-muted)] transition-colors hover:border-[var(--space-border-strong)] hover:text-[var(--space-text-primary)]"><XCircle className="h-4 w-4" />Cancel assembly</button>
    </div> : null}

    {job ? <div className="mt-4 rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-4">
      <p className="text-[10px] font-bold uppercase tracking-[.16em] text-[var(--space-text-muted)]">Assembly steps</p>
      <div className="mt-3 grid gap-2">
        {assemblySteps.map((step, index) => <div key={step.key} className="sf-fade-up flex flex-wrap items-center gap-2 rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] px-3 py-2.5" style={{ animationDelay: `${index * 55}ms` }}>
          {step.status === 'running' ? <VergeLoader size={32} label={step.label} /> : step.status === 'done' ? <span className="text-[var(--space-semantic-success)]">✓</span> : step.status === 'failed' ? <AlertTriangle className="h-4 w-4 text-[var(--space-semantic-danger)]" /> : <span className="text-[var(--space-text-muted)]">○</span>}
          <span className="min-w-[min(100%,180px)] flex-1 text-sm text-[var(--space-text-secondary)]">{step.label}</span>
          <span className={step.status === 'running' ? 'font-mono text-[10px] font-bold uppercase tracking-wide text-[var(--space-text-brand)]' : step.status === 'failed' ? 'font-mono text-[10px] font-bold uppercase tracking-wide text-[var(--space-semantic-danger)]' : 'font-mono text-[10px] font-bold uppercase tracking-wide text-[var(--space-text-muted)]'}>{step.status}</span>
          <span className="w-12 text-right font-mono text-[10px] tabular-nums text-[var(--space-text-muted)]">{stepElapsed(step)}</span>
        </div>)}
      </div>
    </div> : null}

    {/* A cancelled run is not a failure: everything already produced is kept
        and one button starts the composition again. */}
    {!jobRunning && job?.status === 'cancelled' && !playable ? <div className="mt-8 rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-5">
      <div className="flex items-center gap-2 font-semibold text-[var(--space-text-primary)]"><XCircle className="h-5 w-5 text-[var(--space-text-muted)]" />Assembly cancelled</div>
      <p className="mt-2 text-sm text-[var(--space-text-secondary)]">{job.message || 'Nothing was changed — every scene clip and audio track is kept.'}</p>
      <button onClick={onRetry} className="mt-4 flex items-center gap-2 rounded-xl bg-[var(--space-brand-primary-600)] px-4 py-3 text-sm font-semibold text-white"><RefreshCw className="h-4 w-4" />Start assembly again</button>
    </div> : null}

    {/* An assembly that produced no film says so here, with the reason and the
        one button that starts it again. The checks panel below is about a
        finished film, so it must not be read as the explanation. */}
    {!busy && failure && !playable ? <div className="mt-8 rounded-2xl border border-[color-mix(in_srgb,var(--space-semantic-danger-500)_40%,transparent)] bg-[color-mix(in_srgb,var(--space-semantic-danger-500)_10%,transparent)] p-5">
      <div className="flex items-center gap-2 font-semibold text-[var(--space-text-primary)]"><AlertTriangle className="h-5 w-5 text-[var(--space-semantic-danger)]" />Assembly did not finish</div>
      <p className="mt-2 text-sm text-[var(--space-text-secondary)]">{failure}</p>
      <p className="mt-2 text-sm text-[var(--space-text-secondary)]">Every scene picture and its code are kept, so retrying only redoes the join.</p>
      <button onClick={onRetry} className="mt-4 flex items-center gap-2 rounded-xl bg-[var(--space-brand-primary-600)] px-4 py-3 text-sm font-semibold text-white"><RefreshCw className="h-4 w-4" />Retry assembly</button>
    </div> : null}

    <div className="mt-7 grid gap-6 lg:grid-cols-2">
      <div>
        {playable
          ? <video key={playable} src={playable} controls playsInline className="max-h-[560px] w-full rounded-2xl bg-black" />
          : <div className="flex min-h-72 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[var(--space-border-default)] px-6 text-center text-sm text-[var(--space-text-muted)]">
            {jobRunning ? <>
              <VergeLoader size={140} caption={job?.message || 'Rendering the assembly'} />
              <span className="font-semibold text-[var(--space-text-primary)]">{statusLabel} · {progressPct}% · {elapsedLabel}</span>
            </> : job?.status === 'failed' || failure ? <span>Assembly did not finish — use Retry assembly to rebuild the film. Every scene clip is kept.</span>
              : job?.status === 'cancelled' ? <span>Assembly was cancelled — start it again to produce the film.</span>
                : <span>The final film loads here automatically the moment assembly completes.</span>}
          </div>}
        {playable ? <p className="mt-2 text-xs text-[var(--space-text-muted)]">{final ? 'Playing the final master with its music bed.' : bedInFilm ? 'Playing the assembled film with its music bed mixed under the narration.' : 'Playing the assembled cut. Add a music bed below and the next render lays it under the narration.'}</p> : null}
        {lastGood && lastGood.video_url && String(lastGood.video_url) !== playable ? <p className="mt-1 text-xs text-[var(--space-text-muted)]">The last known good version (promoted {String(lastGood.promoted_at || '').slice(0, 16).replace('T', ' ')}) is preserved separately — a failed render never replaces it.</p> : null}
      </div>
      <ChecksReport checks={checks} busy={busy} assembled={Boolean(playable)} onRetry={onRetry} />
    </div>

    {validationReport && Array.isArray(validationReport.warnings) && validationReport.warnings.length ? <div className="mt-4 rounded-xl border border-[color-mix(in_srgb,var(--space-semantic-warning-500)_35%,transparent)] bg-[color-mix(in_srgb,var(--space-semantic-warning-500)_8%,transparent)] p-3 text-xs leading-relaxed text-[var(--space-text-secondary)]"><strong className="text-[var(--space-text-primary)]">Timeline validation notes:</strong> {validationReport.warnings.slice(0, 4).join(' ')}</div> : null}

    {/* DRAFT PREVIEW — the complete composition in the browser (play, seek,
        scene navigation), driven by the SAME timeline and props the
        production Remotion render receives. The browser never records the
        final file — this is strictly a preview. */}
    {project && scenes.length ? <section className="mt-7 rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-5">
      <button aria-expanded={previewOpen} onClick={() => setPreviewOpen((open) => !open)} className="flex w-full items-center gap-2 text-left">
        <Clapperboard className="h-4 w-4 text-[var(--space-text-brand)]" />
        <h2 className="font-semibold text-[var(--space-text-primary)]">Draft preview</h2>
        <span className="ml-auto text-xs font-semibold text-[var(--space-text-brand)]">{previewOpen ? 'Hide' : 'Show'}</span>
      </button>
      <p className="mt-1 text-sm text-[var(--space-text-secondary)]">Play the current composition — presenter states, generated clips and stills, overlays, captions and the ducked music bed — before or after the production render. Preview and final render read the same timeline and assets.</p>
      {previewOpen ? <div className="mt-4"><CompositionPreview project={project} scenes={scenes} /></div> : null}
    </section> : null}

    {/* EDITABLE OVERLAYS — first-class timeline elements, editable AFTER
        generation. Applying an edit re-renders only the composition. */}
    {project && scenes.length ? <section className="mt-7 rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-5">
      <button aria-expanded={overlaysOpen} onClick={() => setOverlaysOpen((open) => !open)} className="flex w-full items-center gap-2 text-left">
        <Layers className="h-4 w-4 text-[var(--space-text-brand)]" />
        <h2 className="font-semibold text-[var(--space-text-primary)]">Overlays &amp; annotations</h2>
        <span className="ml-auto text-xs font-semibold text-[var(--space-text-brand)]">{overlaysOpen ? 'Hide' : 'Show'}</span>
      </button>
      <p className="mt-1 text-sm text-[var(--space-text-secondary)]">Add, move, resize, retime or delete text, labels, statistics, citations, arrows, circles and highlights. Edits re-render the composition only — no AI clip, image or HeyGen render is regenerated, and the previous film is preserved until the new render passes its checks.</p>
      {overlaysOpen ? <div className="mt-4"><OverlayEditor project={project} scenes={scenes} busy={busy} onSaved={() => onDraftEdited?.()} onReRender={onRetry} /></div> : null}
    </section> : null}

    {assembled ? <section className="mt-7 rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-5">
      <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-[var(--space-text-brand)]" /><h2 className="font-semibold text-[var(--space-text-primary)]">Opus assembly QC</h2>{qcBusy ? <VergeLoader size={32} label="Reviewing the assembly" /> : null}</div>
      <p className="mt-1 text-sm text-[var(--space-text-secondary)]">One review compares planned windows with the produced media list: duration fit, kinds, gaps, overlaps, and safe presenter visibility for small overlays. It never changes a scene on its own.</p>
      {qc ? <div className="mt-4 space-y-2">
        <p className="text-sm text-[var(--space-text-primary)]">{qc.summary}</p>
        {qc.suggestions.filter((item) => item.weak).map((item) => <div key={`${item.scene_index}-${item.suggestion}`} className="flex flex-wrap items-center gap-3 rounded-xl border border-[color-mix(in_srgb,var(--space-semantic-warning-500)_40%,transparent)] bg-[color-mix(in_srgb,var(--space-semantic-warning-500)_9%,transparent)] p-3"><div className="min-w-0 flex-1"><strong className="text-sm text-[var(--space-text-primary)]">Scene {item.scene_index}</strong><p className="mt-1 text-sm text-[var(--space-text-secondary)]">{item.suggestion}</p></div><button disabled={retryingScene !== null} onClick={() => void retryFlaggedScene(item.scene_index)} className="rounded-lg bg-[var(--space-brand-primary-600)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">{retryingScene === item.scene_index ? 'Starting isolated retry…' : `Regenerate only Scene ${item.scene_index}`}</button></div>)}
        {!qc.suggestions.some((item) => item.weak) ? <p className="rounded-xl bg-[color-mix(in_srgb,var(--space-semantic-success-500)_10%,transparent)] p-3 text-sm text-[var(--space-text-secondary)]">No weak scene elements were flagged.</p> : null}
      </div> : qcBusy ? <p className="mt-3 text-sm text-[var(--space-text-muted)]">Comparing the plan with every produced scene…</p> : null}
      {qcError ? <p className="mt-3 text-sm text-[var(--space-semantic-danger)]">{qcError}</p> : null}
    </section> : null}

    {assembled ? <section className="mt-7 rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-5">
      <div className="flex items-center gap-2"><Music className="h-4 w-4 text-[var(--space-text-brand)]" /><h2 className="font-semibold text-[var(--space-text-primary)]">Music and sound bed</h2></div>
      <p className="mt-1 text-sm text-[var(--space-text-secondary)]">ElevenLabs writes an instrumental bed for this film. Preview it here, then add it to the film: the assembly render mounts the bed under the picture and automatically ducks it while the presenter speaks, letting it return in the gaps.</p>
      {portrait ? <p className="mt-2 rounded-xl bg-[color-mix(in_srgb,var(--space-semantic-warning-500)_10%,transparent)] p-3 text-xs leading-relaxed text-[var(--space-text-secondary)]">This film is 9:16. The portrait compositor can only carry the presenter's own audio, so a bed generated here stays a separate track you can download and drop into an editor - it cannot be laid under a vertical master yet.</p> : null}
      {plan?.music ? <p className="mt-2 rounded-xl bg-[color-mix(in_srgb,var(--space-brand-primary-500)_8%,transparent)] p-3 text-xs leading-relaxed text-[var(--space-text-secondary)]"><strong className="text-[var(--space-text-primary)]">Director's call:</strong> {plan.music.required ? `music · ${plan.music.intensity || 'medium'} intensity · ${plan.music.mood || 'unobtrusive documentary bed'}` : 'this film works without a music bed — silence is a deliberate choice'}{plan.music.required && plan.music.prompt ? ' — the suggested brief is prefilled below.' : ''}</p> : null}
      <div className="mt-4 flex flex-wrap gap-3">
        <input value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="describe the bed — e.g. warm piano that builds, 90 BPM" className="min-w-0 flex-[1_1_16rem] rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-3 text-sm text-[var(--space-text-primary)]" />
        <button disabled={musicBusy} onClick={() => onGenerateMusic(prompt.trim())} className="flex items-center gap-2 rounded-xl bg-[var(--space-brand-primary-600)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">{musicBusy ? <VergeLoader size={32} tone="ink" label="Generating the music bed" /> : <Sparkles className="h-4 w-4" />}{project?.music_url ? 'Regenerate music' : 'Generate music'}</button>
      </div>
      {project?.music_url ? <div className="mt-4">
        <audio src={project.music_url} controls className="w-full" />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button disabled={musicBusy || jobRunning || portrait} onClick={onMixMusic} className="rounded-xl border border-[var(--space-border-default)] px-4 py-2.5 text-sm font-semibold text-[var(--space-text-primary)] disabled:opacity-40">{musicBusy ? <span className="flex items-center gap-2"><VergeLoader size={32} label="Adding the music bed" />Adding the music bed...</span> : bedInFilm ? 'Render again with this music bed' : 'Add the music bed to the film'}</button>
          {!portrait && bedInFilm ? <span className="text-xs text-[var(--space-semantic-success)]">This cut already carries the bed.</span> : null}
          {!portrait && !bedInFilm ? <span className="text-xs text-[var(--space-text-muted)]">The film is rendered again with the bed under the narration - every scene clip, overlay and caption is reused, so only the join is redone.</span> : null}
        </div>
      </div> : null}
      {musicNote ? <p className="mt-3 text-sm text-[var(--space-text-secondary)]">{musicNote}</p> : null}
    </section> : null}

    <div className="mt-7 flex flex-wrap gap-3">
      {playable ? <a href={playable} download target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-xl bg-[var(--space-brand-primary-600)] px-5 py-3 font-semibold text-white"><Download className="h-4 w-4" />Download {final || bedInFilm ? 'MP4 with music' : 'MP4'}</a> : null}
      {project?.music_url && !final ? <a href={project.music_url} download target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-xl border border-[var(--space-border-default)] px-5 py-3 font-semibold text-[var(--space-text-primary)]"><Music className="h-4 w-4" />Download music track</a> : null}
      {/* A finished film is editable even when a check wants attention — the
          checks are advice, not a gate on the customer's own footage. */}
      {playable ? <button onClick={onContinue} className="rounded-xl border border-[var(--space-border-default)] px-5 py-3 font-semibold text-[var(--space-text-primary)]">Open in Editor</button> : null}
    </div>
  </div>;
}
