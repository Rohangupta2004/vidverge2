import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AlertCircle, Check, CheckCircle2, Clapperboard, Clock, Download,
  Film, Image as ImageIcon, Loader2, Music2, Play, RefreshCw, Sparkles,
  Type, Upload, Video, Volume2, Wand2,
} from 'lucide-react';
import BeamBackground from '../../components/BeamBackground';
import GridOverlay from '../../components/GridOverlay';
import GlobalStyles from '../../components/ui/GlobalStyles';
import VoicePicker, { useVoiceCatalog } from '../../components/shared/VoicePicker';
import { FALLBACK_VOICE_ID } from '../../lib/elevenLabsVoices';
import { withBrandContext } from '../../components/BrandContextLayer';
import { consumeVidvergeHandoff } from '../../lib/vidvergeHandoff';
import { listVideoHistory, saveVideoToHistory, type VideoHistoryRow } from '../../lib/videoHistory';
import {
  type FacelessProject, type FacelessSettings, type PipelineStep, type StoryboardScene,
  replaceSceneClip, rerenderReview, retryFinishingOnly, retryScene, runFacelessPipeline,
} from './lib/pipeline';
import { createProject, findResumableProject, loadProject, newProjectId, saveProject, stepLabel } from './lib/projectStore';

const MODES = [
  ['documentary', 'Documentary'], ['explainer', 'Explainer'], ['news', 'News'],
  ['business', 'Business'], ['story', 'Story'], ['educational', 'Educational'],
] as const;
const DURATIONS = [30, 60, 90, 120];
const PIPELINE: PipelineStep[] = ['brief', 'script', 'voiceover', 'timing', 'storyboard', 'images', 'clips', 'finishing', 'review', 'export'];

const BrandedFaceless = withBrandContext(FacelessApp, 'Faceless');
export default BrandedFaceless;

function FacelessApp() {
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [settings, setSettings] = useState<FacelessSettings>({
    mode: 'documentary', aspect: '9:16', targetDuration: 60,
    voiceId: FALLBACK_VOICE_ID, captions: true, music: true, musicVolume: 0.28,
  });
  const [project, setProject] = useState<FacelessProject | null>(null);
  const [resume, setResume] = useState<FacelessProject | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<VideoHistoryRow[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const voices = useVoiceCatalog();

  useEffect(() => {
    const handoff = consumeVidvergeHandoff('faceless');
    if (handoff?.prompt?.trim()) {
      const value = handoff.prompt.trim();
      setBrief(value);
      setTitle(value.split(/\n|\.|\?|!/)[0].slice(0, 90));
    }
    void findResumableProject().then(setResume);
    void listVideoHistory(12).then(setHistory);
  }, []);

  useEffect(() => {
    if (!project?.finishing?.operationId || project.finishing.status !== 'rendering') return;
    let cancelled = false;
    const poll = async () => {
      try {
        const fresh = await loadProject(project.id);
        if (!cancelled && fresh) setProject(fresh);
      } catch (error) {
        if (!cancelled) console.warn('[Faceless] finishing status poll failed:', error);
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [project?.id, project?.finishing?.operationId, project?.finishing?.status]);

  const checkpoint = useCallback(async (next: FacelessProject) => {
    await saveProject(next);
    setProject(next);
  }, []);

  const run = useCallback(async (seed: FacelessProject) => {
    setBusy(true); setProject(seed); setNotice(null);
    try { await runFacelessPipeline(seed, checkpoint); }
    catch (error: any) { setNotice(String(error?.message || error)); }
    finally { setBusy(false); }
  }, [checkpoint]);

  const start = useCallback(async () => {
    const now = new Date().toISOString();
    const seed: FacelessProject = {
      pipelineVersion: 2,
      id: newProjectId(),
      title: title.trim() || brief.trim().split(/\n|\.|\?|!/)[0].slice(0, 80) || 'Untitled faceless film',
      brief: brief.trim(),
      script: '',
      settings: { ...settings },
      step: 'brief', status: 'running', notice: 'Brief saved.', scenes: [],
      music: undefined, sfx: undefined,
      review: { captions: settings.captions, music: settings.music, musicVolume: settings.musicVolume },
      createdAt: now, updatedAt: now,
    };
    try {
      await createProject(seed);
      await run(seed);
    } catch (error: any) {
      setNotice(String(error?.message || error || 'The project could not be created.'));
    }
  }, [title, brief, settings, run]);

  const resumeProject = useCallback(async (saved: FacelessProject) => {
    setResume(null);
    setTitle(saved.title); setBrief(saved.brief); setSettings(saved.settings);
    if (saved.status === 'error' || saved.finishing?.status === 'rendering') {
      setProject(saved);
      return;
    }
    await run(saved);
  }, [run]);

  const retryFinishing = useCallback(async () => {
    if (!project) return;
    setBusy(true); setNotice(null);
    try {
      await retryFinishingOnly(project);
      const fresh = await loadProject(project.id);
      if (fresh) setProject(fresh);
    } catch (error: any) {
      setNotice(String(error?.message || error || 'Finishing could not be retried.'));
    } finally {
      setBusy(false);
    }
  }, [project]);

  const retry = useCallback(async (scene: StoryboardScene, withImage: boolean) => {
    if (!project) return;
    setBusy(true); setNotice(null);
    try { await retryScene(project, scene.id, withImage, checkpoint); }
    catch (error: any) { setNotice(String(error?.message || error)); }
    finally { setBusy(false); }
  }, [project, checkpoint]);

  const swap = useCallback(async (scene: StoryboardScene, url: string) => {
    if (!project) return;
    setBusy(true); setNotice(null);
    try { await replaceSceneClip(project, scene.id, url, checkpoint); }
    catch (error: any) { setNotice(String(error?.message || error)); }
    finally { setBusy(false); }
  }, [project, checkpoint]);

  const applyReview = useCallback(async () => {
    if (!project) return;
    setBusy(true); setNotice(null);
    try { await rerenderReview(project, checkpoint); }
    catch (error: any) { setNotice(String(error?.message || error)); }
    finally { setBusy(false); }
  }, [project, checkpoint]);

  const exportFilm = useCallback(async () => {
    if (!project?.previewUrl) return;
    const next = { ...project, step: 'export' as const, finalUrl: project.previewUrl, status: 'ready' as const, notice: 'MP4 ready to download.', updatedAt: new Date().toISOString() };
    try {
      await checkpoint(next);
      void saveVideoToHistory({ appId: 'faceless', title: next.title, videoUrl: next.finalUrl, durationSec: next.voiceover?.duration || null })
        .then(() => listVideoHistory(12).then(setHistory));
    } catch (error: any) {
      setNotice(String(error?.message || error || 'The export could not be saved.'));
    }
  }, [project, checkpoint]);

  const newFilm = () => {
    setProject(null); setNotice(null); setTitle(''); setBrief('');
  };

  return (
    <div className="vv-app-shell h-full w-full overflow-y-auto" style={{ position: 'relative', isolation: 'isolate', background: 'var(--space-surface-bg, #0D0E10)', color: 'var(--space-text-primary, #F6F2E9)' }}>
      <GlobalStyles /><BeamBackground /><GridOverlay />
      <style>{`.studio-input{width:100%;min-height:44px;border:1px solid var(--space-border-default,#393E47);border-radius:10px;background:var(--space-surface-bg,#0D0E10);padding:10px 12px;color:var(--space-text-primary,#F6F2E9);outline:none}.studio-input:focus{border-color:var(--space-brand-primary-500,#F2B544);box-shadow:0 0 0 2px color-mix(in srgb,var(--space-brand-primary-500,#F2B544) 24%,transparent)}.studio-input::placeholder{color:var(--space-text-muted,#929AA7)}.muted{color:var(--space-text-muted,#929AA7)}`}</style>
      <main className="relative z-[1] mx-auto w-full max-w-6xl px-4 py-7 sm:px-7">
        <Header project={project} onNew={project ? newFilm : undefined} />
        {notice && <ErrorBanner message={notice} onClose={() => setNotice(null)} />}
        {!project ? (
          <BriefScreen
            title={title} setTitle={setTitle} brief={brief} setBrief={setBrief}
            settings={settings} setSettings={setSettings} voices={voices}
            resume={resume} onResume={resumeProject} onDismissResume={() => setResume(null)}
            onStart={start} history={history} busy={busy}
          />
        ) : (
          <Studio
            project={project} busy={busy} onContinue={() => run(project)} onRetryFinishing={retryFinishing} onRetry={retry}
            onSwap={swap} onReviewChange={(review) => setProject({ ...project, review })}
            onApplyReview={applyReview} onExport={exportFilm}
          />
        )}
        {project?.step === 'export' && project.finalUrl && <HistoryPanel rows={history} />}
      </main>
    </div>
  );
}

function Header({ project, onNew }: { project: FacelessProject | null; onNew?: () => void }) {
  return (
    <header className="mb-6 flex items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: 'color-mix(in srgb,var(--space-brand-primary-500) 16%,transparent)' }}>
          <Clapperboard className="h-5 w-5" style={{ color: 'var(--space-brand-primary-500, #F2B544)' }} />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Faceless</h1>
          <p className="mt-1 max-w-3xl text-sm" style={{ color: 'var(--space-text-secondary, #B7BBC4)' }}>
            Narration-first video production: every scene, cut, caption and sound lands against the words being spoken.
          </p>
          {project && <p className="mt-1 text-xs" style={{ color: 'var(--space-brand-primary-500, #F2B544)' }}>{project.title}</p>}
        </div>
      </div>
      {onNew && <button type="button" onClick={onNew} className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--space-border-default, #393E47)' }}>New film</button>}
    </header>
  );
}

function BriefScreen(props: {
  title: string; setTitle: (value: string) => void; brief: string; setBrief: (value: string) => void;
  settings: FacelessSettings; setSettings: (value: FacelessSettings) => void; voices: ReturnType<typeof useVoiceCatalog>;
  resume: FacelessProject | null; onResume: (project: FacelessProject) => void; onDismissResume: () => void;
  onStart: () => void; history: VideoHistoryRow[]; busy: boolean;
}) {
  const patch = (value: Partial<FacelessSettings>) => props.setSettings({ ...props.settings, ...value });
  const valid = props.brief.trim().length >= 30 && props.title.trim().length >= 3;
  return (
    <div className="space-y-4">
      {props.resume && (
        <Panel className="border-amber-400/40">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-semibold">
                {props.resume.status === 'error' && <AlertCircle className="h-4 w-4 shrink-0" style={{ color: 'var(--space-semantic-danger-500, #FF9A9A)' }} />}
                {props.resume.status === 'error' ? `Film failed at ${stepLabel(props.resume.step)}` : `Resume “${props.resume.title}”`}
              </div>
              <div className="mt-1 text-xs muted">{props.resume.status === 'error' ? props.resume.error : `Saved within the last 48 hours at ${stepLabel(props.resume.step)}. Completed paid work will not run again.`}</div>
            </div>
            <div className="flex gap-2"><SecondaryButton onClick={props.onDismissResume}>Dismiss</SecondaryButton><PrimaryButton onClick={() => props.onResume(props.resume)}>{props.resume.status === 'error' ? 'View failure & retry' : 'Resume project'}</PrimaryButton></div>
          </div>
        </Panel>
      )}

      <Panel>
        <Label>Title or topic</Label>
        <input value={props.title} onChange={(event) => props.setTitle(event.target.value)} placeholder="Why the internet lives under the ocean" className="studio-input" />
        <div className="mt-5"><Label>Creative brief</Label></div>
        <textarea value={props.brief} onChange={(event) => props.setBrief(event.target.value)} rows={8} placeholder="Describe the audience, key argument, must-include facts, tone, and desired call to action. GPT Sol will turn this into the narration script before anything is generated." className="studio-input resize-y leading-relaxed" />
        <p className="mt-2 text-xs muted">The script is generated from this brief with GPT Sol (medium reasoning), then ElevenLabs records it before visual planning begins.</p>
      </Panel>

      <Panel>
        <Label>Mode</Label>
        <div className="flex flex-wrap gap-2">{MODES.map(([id, label]) => <Pill key={id} active={props.settings.mode === id} onClick={() => patch({ mode: id })}>{label}</Pill>)}</div>
        <div className="mt-5"><Label>Target length</Label></div>
        <div className="flex flex-wrap gap-2">{DURATIONS.map((seconds) => <Pill key={seconds} active={props.settings.targetDuration === seconds} onClick={() => patch({ targetDuration: seconds })}>{seconds < 60 ? `${seconds}s` : `${seconds / 60} min`}</Pill>)}</div>
        <div className="mt-5"><Label>Format</Label></div>
        <div className="flex flex-wrap gap-2"><Pill active={props.settings.aspect === '9:16'} onClick={() => patch({ aspect: '9:16' })}>Portrait 9:16</Pill><Pill active={props.settings.aspect === '16:9'} onClick={() => patch({ aspect: '16:9' })}>Landscape 16:9</Pill></div>
      </Panel>

      <Panel>
        <Label>ElevenLabs voice</Label>
        <VoicePicker catalog={props.voices} value={props.settings.voiceId} onChange={(voiceId) => patch({ voiceId })} maxHeight={290} />
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <Toggle checked={props.settings.captions} onChange={(captions) => patch({ captions })} icon={<Type className="h-4 w-4" />} label="Word-timed captions" />
          <Toggle checked={props.settings.music} onChange={(music) => patch({ music })} icon={<Music2 className="h-4 w-4" />} label="Background music + SFX" />
        </div>
      </Panel>

      <Panel>
        <div className="flex items-end justify-between gap-3"><div><Label>Example videos</Label><p className="text-xs muted">Recent finished films show the final pacing and polish.</p></div></div>
        {props.history.length ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">{props.history.slice(0, 3).map((item) => <article key={item.id} className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--space-border-default, #393E47)' }}><video src={item.video_url} poster={item.thumbnail_url || undefined} controls muted playsInline preload="metadata" className="aspect-video w-full bg-black object-contain" /><div className="truncate p-3 text-xs font-medium">{item.title}</div></article>)}</div>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">{['Documentary cut', 'Motion explainer', 'Cinematic story'].map((label, index) => <div key={label} className="flex aspect-video items-center justify-center rounded-xl border" style={{ borderColor: 'var(--space-border-default, #393E47)', background: `linear-gradient(${120 + index * 15}deg,#17191D,#342716)` }}><div className="text-center"><Play className="mx-auto mb-2 h-6 w-6" style={{ color: 'var(--space-brand-primary-500, #F2B544)' }} /><div className="text-xs muted">{label}</div></div></div>)}</div>
        )}
      </Panel>

      <div className="rounded-xl border p-3 text-xs muted" style={{ borderColor: 'color-mix(in srgb,var(--space-brand-primary-500) 35%,transparent)', background: 'color-mix(in srgb,var(--space-brand-primary-500) 8%,transparent)' }}>
        Credit estimate: {props.settings.targetDuration} credits for approximately {props.settings.targetDuration}s of generated scene clips. Scripting and planning remain free; generation is guarded before providers run.
      </div>
      <PrimaryButton disabled={!valid || props.busy} onClick={props.onStart} className="w-full justify-center py-3.5"><Sparkles className="h-4 w-4" /> Build this film</PrimaryButton>
    </div>
  );
}

function Studio(props: {
  project: FacelessProject; busy: boolean; onContinue: () => void; onRetryFinishing: () => void;
  onRetry: (scene: StoryboardScene, withImage: boolean) => void; onSwap: (scene: StoryboardScene, url: string) => void;
  onReviewChange: (review: FacelessProject['review']) => void; onApplyReview: () => void; onExport: () => void;
}) {
  const { project } = props;
  const current = PIPELINE.indexOf(project.step);
  const failed = project.status === 'error';
  const finishingFailed = failed && project.step === 'finishing';
  const canContinue = !props.busy && !failed && project.step !== 'review' && project.step !== 'export';
  return (
    <div className="space-y-4">
      <Panel>
        <div className="overflow-x-auto pb-1"><div className="flex min-w-[780px] items-center">{PIPELINE.map((step, index) => { const done = index < current || project.step === 'export'; const active = step === project.step; const failedStep = failed && active; return <div key={step} className="flex min-w-0 flex-1 items-center"><div className="min-w-0 text-center"><div className="mx-auto flex h-7 w-7 items-center justify-center rounded-full border text-[11px]" style={{ borderColor: failedStep ? 'var(--space-semantic-danger-500, #FF9A9A)' : done || active ? 'var(--space-brand-primary-500, #F2B544)' : 'var(--space-border-default, #393E47)', background: done ? 'var(--space-brand-primary-500, #F2B544)' : failedStep ? 'color-mix(in srgb,var(--space-semantic-danger-500) 15%,transparent)' : active ? 'color-mix(in srgb,var(--space-brand-primary-500) 15%,transparent)' : 'transparent', color: done ? '#1B1308' : failedStep ? 'var(--space-semantic-danger-500, #FF9A9A)' : undefined }}>{done ? <Check className="h-3.5 w-3.5" /> : failedStep ? <AlertCircle className="h-3.5 w-3.5" /> : index + 1}</div><div className="mt-1 truncate text-[9px] muted">{stepLabel(step)}</div></div>{index < PIPELINE.length - 1 && <div className="mx-1 h-px flex-1" style={{ background: done ? 'var(--space-brand-primary-500, #F2B544)' : 'var(--space-border-default, #393E47)' }} />}</div>; })}</div></div>
        <div className="mt-4 flex items-center gap-2 text-sm"><StatusIcon status={project.status} busy={props.busy} /><span>{failed ? 'Film processing failed.' : project.notice}</span></div>
        {project.error && <div className="mt-3 rounded-lg border p-3 text-xs" style={{ borderColor: 'color-mix(in srgb,var(--space-semantic-danger-500) 45%,transparent)', background: 'color-mix(in srgb,var(--space-semantic-danger-500) 10%,transparent)', color: 'var(--space-semantic-danger-500, #FF9A9A)' }}><div className="font-semibold">{finishingFailed ? 'Finishing failed' : 'This film stopped'}</div><div className="mt-1">{project.error}</div>{finishingFailed && <div className="mt-3"><PrimaryButton disabled={props.busy} onClick={props.onRetryFinishing}><RefreshCw className="h-4 w-4" /> Retry finishing only</PrimaryButton><p className="mt-2 text-[11px] muted">Uses the saved clips, images and voiceover. No generation credits are charged.</p></div>}</div>}
        {canContinue && <div className="mt-3"><PrimaryButton onClick={props.onContinue}><RefreshCw className="h-4 w-4" /> Continue from saved checkpoint</PrimaryButton></div>}
      </Panel>

      {project.script && <Panel><Label>Generated script</Label><p className="whitespace-pre-wrap text-sm leading-7" style={{ color: 'var(--space-text-secondary, #B7BBC4)' }}>{project.script}</p>{project.voiceover?.audioUrl && <audio className="mt-4 w-full" src={project.voiceover.audioUrl} controls />}</Panel>}

      {project.scenes.length > 0 && (
        <Panel>
          <div className="flex items-end justify-between gap-3"><div><Label>Timed storyboard & scene production</Label><p className="text-xs muted">{project.scenes.length} scenes aligned to {project.voiceover?.words.length || 0} Deepgram word timestamps · bounded to 2 simultaneous Seedance jobs</p></div><div className="rounded-full border px-2.5 py-1 text-[10px]" style={{ borderColor: 'var(--space-border-default, #393E47)' }}>Seedance 2.0 Fast</div></div>
          {project.storyboard && <div className="mt-3 rounded-lg p-3 text-xs muted" style={{ background: 'var(--space-surface-muted, #21242A)' }}><strong className="text-white">Style lock:</strong> {project.storyboard.styleDescriptor}<br /><strong className="text-white">Character lock:</strong> {project.storyboard.characterDescriptor}</div>}
          <div className="mt-4 grid gap-3 md:grid-cols-2">{project.scenes.map((scene) => <SceneCard key={scene.id} scene={scene} busy={props.busy} onRetry={props.onRetry} onSwap={props.onSwap} />)}</div>
        </Panel>
      )}

      {project.previewUrl && (
        <ReviewPanel project={project} busy={props.busy} onChange={props.onReviewChange} onApply={props.onApplyReview} onExport={props.onExport} />
      )}
    </div>
  );
}

function SceneCard({ scene, busy, onRetry, onSwap }: { scene: StoryboardScene; busy: boolean; onRetry: (scene: StoryboardScene, withImage: boolean) => void; onSwap: (scene: StoryboardScene, url: string) => void }) {
  const [swapUrl, setSwapUrl] = useState('');
  const failed = scene.imageStatus === 'error' || scene.clipStatus === 'error';
  return (
    <article className="overflow-hidden rounded-xl border" style={{ borderColor: failed ? 'color-mix(in srgb,var(--space-semantic-danger-500) 55%,transparent)' : 'var(--space-border-default, #393E47)', background: 'var(--space-surface-muted, #17191D)' }}>
      <div className="relative aspect-video bg-black">{scene.clipUrl ? <video src={scene.clipUrl} controls muted playsInline preload="metadata" className="h-full w-full object-contain" /> : scene.imageUrl ? <img src={scene.imageUrl} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center"><ImageIcon className="h-7 w-7 muted" /></div>}<div className="absolute left-2 top-2 rounded-full px-2 py-1 text-[10px]" style={{ background: 'rgba(8,9,11,.78)', color: '#fff' }}>{scene.start.toFixed(1)}–{scene.end.toFixed(1)}s · {scene.visualType}</div></div>
      <div className="space-y-3 p-3">
        <p className="line-clamp-3 text-xs leading-5 muted">{scene.narration}</p>
        <div className="grid grid-cols-2 gap-2"><MiniStatus icon={<ImageIcon className="h-3.5 w-3.5" />} label="Image" status={scene.imageStatus} /><MiniStatus icon={<Video className="h-3.5 w-3.5" />} label={`Clip${scene.clipStatus === 'working' ? ` ${Math.round(scene.progress)}%` : ''}`} status={scene.clipStatus} /></div>
        {scene.clipStatus === 'working' && <div className="h-1 overflow-hidden rounded-full" style={{ background: '#2A2E35' }}><div className="h-full rounded-full transition-all" style={{ width: `${Math.max(4, scene.progress)}%`, background: 'var(--space-brand-primary-500, #F2B544)' }} /></div>}
        {scene.error && <div className="rounded-lg border p-2.5 text-xs" style={{ borderColor: 'color-mix(in srgb,var(--space-semantic-danger-500) 45%,transparent)', color: 'var(--space-semantic-danger-500, #FF9A9A)' }}><div className="flex gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{scene.error}</span></div><div className="mt-2 flex flex-wrap gap-2"><SecondaryButton disabled={busy} onClick={() => onRetry(scene, scene.imageStatus === 'error')}>Retry failed step</SecondaryButton><SecondaryButton disabled={busy} onClick={() => onRetry(scene, true)}>Regenerate image + clip</SecondaryButton></div></div>}
        {scene.clipStatus === 'ready' && <div className="flex gap-2"><SecondaryButton disabled={busy} onClick={() => onRetry(scene, false)}><RefreshCw className="h-3.5 w-3.5" /> Regenerate clip</SecondaryButton></div>}
        <details><summary className="cursor-pointer text-[11px] muted">Swap this clip</summary><div className="mt-2 flex gap-2"><input value={swapUrl} onChange={(event) => setSwapUrl(event.target.value)} placeholder="Paste public MP4 URL" className="studio-input !py-2 text-xs" /><SecondaryButton disabled={busy || !swapUrl.trim()} onClick={() => onSwap(scene, swapUrl.trim())}><Upload className="h-3.5 w-3.5" /> Swap</SecondaryButton></div></details>
      </div>
    </article>
  );
}

function ReviewPanel({ project, busy, onChange, onApply, onExport }: { project: FacelessProject; busy: boolean; onChange: (review: FacelessProject['review']) => void; onApply: () => void; onExport: () => void }) {
  const update = (patch: Partial<FacelessProject['review']>) => onChange({ ...project.review, ...patch });
  return (
    <Panel>
      <Label>Review</Label>
      <div className="mx-auto overflow-hidden rounded-xl bg-black" style={{ maxWidth: project.settings.aspect === '9:16' ? 440 : undefined }}><video src={project.previewUrl} controls playsInline className="w-full" /></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2"><Toggle checked={project.review.captions} onChange={(captions) => update({ captions })} icon={<Type className="h-4 w-4" />} label="Captions" /><Toggle checked={project.review.music} onChange={(music) => update({ music })} icon={<Music2 className="h-4 w-4" />} label="Music" /></div>
      <div className="mt-4 flex items-center gap-3"><Volume2 className="h-4 w-4 muted" /><input type="range" min={0} max={55} step={1} value={Math.round(project.review.musicVolume * 100)} onChange={(event) => update({ musicVolume: Number(event.target.value) / 100 })} disabled={!project.review.music} className="flex-1" style={{ accentColor: 'var(--space-brand-primary-500, #F2B544)' }} /><span className="w-10 text-right text-xs muted">{Math.round(project.review.musicVolume * 100)}%</span></div>
      {(project.music?.status === 'error' || project.sfx?.status === 'error') && <p className="mt-3 text-xs" style={{ color: 'var(--space-semantic-warning-500, #F1C778)' }}>The video is reviewable, but {project.music?.status === 'error' ? 'music' : 'SFX'} generation was unavailable. Remotion finished with the available audio layers.</p>}
      <div className="mt-4 flex flex-wrap gap-2"><SecondaryButton disabled={busy} onClick={onApply}><Wand2 className="h-4 w-4" /> Apply finishing changes</SecondaryButton><PrimaryButton disabled={busy} onClick={onExport}><Film className="h-4 w-4" /> Export MP4</PrimaryButton>{project.step === 'export' && project.finalUrl && <a href={project.finalUrl} download className="inline-flex min-h-11 items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold" style={{ background: 'var(--space-brand-primary-500, #F2B544)', color: '#1B1308' }}><Download className="h-4 w-4" /> Download MP4</a>}</div>
    </Panel>
  );
}

function HistoryPanel({ rows }: { rows: VideoHistoryRow[] }) {
  return <Panel className="mt-4"><Label>Unified video history</Label>{rows.length ? <div className="grid gap-3 sm:grid-cols-3">{rows.slice(0, 6).map((row) => <a key={row.id} href={row.video_url} target="_blank" rel="noreferrer" className="rounded-lg border p-3 text-xs" style={{ borderColor: 'var(--space-border-default, #393E47)' }}>{row.title}</a>)}</div> : <p className="text-sm muted">Your exported film is being added to history.</p>}</Panel>;
}

function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border p-5 ${className}`} style={{ background: 'var(--space-surface-panel, #17191D)', borderColor: 'var(--space-border-default, #393E47)' }}>{children}</section>;
}
function Label({ children }: { children: ReactNode }) {
  return <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--space-text-muted, #929AA7)' }}>{children}</span>;
}
function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" aria-pressed={active} onClick={onClick} className="min-h-9 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors" style={{ borderColor: active ? 'var(--space-brand-primary-500, #F2B544)' : 'var(--space-border-default, #393E47)', background: active ? 'color-mix(in srgb,var(--space-brand-primary-500) 14%,transparent)' : 'transparent', color: active ? 'var(--space-text-primary, #F6F2E9)' : 'var(--space-text-secondary, #B7BBC4)' }}>{children}</button>;
}
function Toggle({ checked, onChange, icon, label }: { checked: boolean; onChange: (value: boolean) => void; icon: ReactNode; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex min-h-11 items-center justify-between rounded-xl border px-3 py-2 text-sm" style={{ borderColor: checked ? 'var(--space-brand-primary-500, #F2B544)' : 'var(--space-border-default, #393E47)', background: checked ? 'color-mix(in srgb,var(--space-brand-primary-500) 10%,transparent)' : 'transparent' }}><span className="flex items-center gap-2">{icon}{label}</span><span className="relative h-5 w-9 rounded-full" style={{ background: checked ? 'var(--space-brand-primary-500, #F2B544)' : '#2A2E35' }}><span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform" style={{ left: 2, transform: checked ? 'translateX(16px)' : 'none' }} /></span></button>;
}
function PrimaryButton({ children, onClick, disabled, className = '' }: { children: ReactNode; onClick: () => void; disabled?: boolean; className?: string }) {
  return <button type="button" onClick={onClick} disabled={disabled} className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${className}`} style={{ background: 'linear-gradient(115deg,#E69A24,#F8C85C,#FFDF8F)', color: '#1B1308' }}>{children}</button>;
}
function SecondaryButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button type="button" onClick={onClick} disabled={disabled} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40" style={{ borderColor: 'var(--space-border-default, #393E47)' }}>{children}</button>;
}
function ErrorBanner({ message, onClose }: { message: string; onClose: () => void }) {
  return <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border p-3 text-sm" style={{ borderColor: 'color-mix(in srgb,var(--space-semantic-danger-500) 45%,transparent)', background: 'color-mix(in srgb,var(--space-semantic-danger-500) 10%,transparent)', color: 'var(--space-semantic-danger-500, #FF9A9A)' }}><span>{message}</span><button type="button" onClick={onClose}>×</button></div>;
}
function MiniStatus({ icon, label, status }: { icon: ReactNode; label: string; status: string }) {
  const color = status === 'ready' ? 'var(--space-semantic-success-500, #79D5A5)' : status === 'error' ? 'var(--space-semantic-danger-500, #FF9A9A)' : status === 'working' ? 'var(--space-brand-primary-500, #F2B544)' : 'var(--space-text-muted, #929AA7)';
  return <div className="flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px]" style={{ borderColor: 'var(--space-border-default, #393E47)', color }}>{status === 'working' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : status === 'ready' ? <CheckCircle2 className="h-3.5 w-3.5" /> : status === 'error' ? <AlertCircle className="h-3.5 w-3.5" /> : icon}<span>{label} · {status}</span></div>;
}
function StatusIcon({ status, busy }: { status: FacelessProject['status']; busy: boolean }) {
  if (busy) return <Loader2 className="h-4 w-4 animate-spin" style={{ color: 'var(--space-brand-primary-500, #F2B544)' }} />;
  if (status === 'ready') return <CheckCircle2 className="h-4 w-4" style={{ color: 'var(--space-semantic-success-500, #79D5A5)' }} />;
  if (status === 'error') return <AlertCircle className="h-4 w-4" style={{ color: 'var(--space-semantic-danger-500, #FF9A9A)' }} />;
  return <Clock className="h-4 w-4 muted" />;
}
