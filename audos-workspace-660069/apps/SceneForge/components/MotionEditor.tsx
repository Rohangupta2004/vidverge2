import { useMemo, useState } from 'react';
import { ArrowLeft, Clapperboard, Film, RefreshCw, Sparkles, WandSparkles } from 'lucide-react';
import StyleSelector from './StyleSelector';
import EditPlanPanel from './EditPlanPanel';
import ProgressTracker from './ProgressTracker';
import ResultScreen from './ResultScreen';
import { transcribeHeygenVideo } from '../pipeline/transcribe';
import { planEdits } from '../pipeline/planEdits';
import { generateOverlayImages } from '../pipeline/generateImages';
import { makeSeedanceClips } from '../pipeline/makeSeedanceClips';
import { renderWithRemotion } from '../pipeline/renderWithRemotion';
import type { EditPlan, ImageStyle, PipelineStep, PipelineStepId, TranscriptResult } from '../types';

export interface MotionEditorSource {
  videoId: string;
  videoUrl: string;
  posterUrl?: string;
  aspectRatio: '16:9' | '9:16';
  script?: string;
  avatarId?: string;
  avatarName?: string;
  voiceId?: string;
  voiceName?: string;
  title?: string;
  brief?: string;
}

type EditorView = 'setup' | 'analyzing' | 'review' | 'generating' | 'result';

const freshSteps = (): PipelineStep[] => [
  { id: 'transcribe', label: 'Transcribe generated video with Deepgram', status: 'pending' },
  { id: 'plan', label: 'Create edit plan with GPT-5.6-sol', status: 'pending' },
  { id: 'images', label: 'Generate planned overlay images', status: 'pending' },
  { id: 'motion', label: 'Create Seedance 2 motion clips', status: 'pending' },
  { id: 'render', label: 'Render final edit with Remotion', status: 'pending' },
];

export default function MotionEditor(props: {
  source: MotionEditorSource;
  onClose: () => void;
  onRefreshLink?: (videoId: string, staleUrl: string) => Promise<string>;
}) {
  const { source, onClose, onRefreshLink } = props;
  const [view, setView] = useState<EditorView>('setup');
  const [baseUrl, setBaseUrl] = useState(source.videoUrl);
  const [style, setStyle] = useState<ImageStyle>('Cinematic');
  const [transcript, setTranscript] = useState<TranscriptResult | null>(null);
  const [plan, setPlan] = useState<EditPlan | null>(null);
  const [steps, setSteps] = useState<PipelineStep[]>(freshSteps);
  const [error, setError] = useState('');
  const [retryMode, setRetryMode] = useState<'analyze' | 'generate' | null>(null);
  const [resultUrl, setResultUrl] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const sourceLabel = useMemo(() => source.title || source.script?.slice(0, 64) || 'Generated avatar video', [source.title, source.script]);

  const setStep = (id: PipelineStepId, status: PipelineStep['status'], detail?: string) => {
    setSteps((current) => current.map((step) => step.id === id ? { ...step, status, detail } : step));
  };

  const fail = (id: PipelineStepId, cause: unknown, retry: 'analyze' | 'generate') => {
    const message = cause instanceof Error ? cause.message : 'This post-production step could not be completed.';
    setStep(id, 'failed', message);
    setError(message);
    setRetryMode(retry);
  };

  const refreshSource = async () => {
    if (!onRefreshLink || refreshing) return;
    setRefreshing(true);
    setError('');
    try {
      const fresh = await onRefreshLink(source.videoId, baseUrl);
      setBaseUrl(fresh);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The generated video link could not be refreshed.');
    } finally {
      setRefreshing(false);
    }
  };

  const analyze = async () => {
    setView('analyzing');
    setError('');
    setRetryMode(null);
    setSteps(freshSteps().map((step) => step.id === 'transcribe' ? { ...step, status: 'running' } : step));
    let nextTranscript: TranscriptResult;
    try {
      nextTranscript = await transcribeHeygenVideo(baseUrl);
      setTranscript(nextTranscript);
      setStep('transcribe', 'complete', `${nextTranscript.duration.toFixed(1)}s · ${nextTranscript.language}`);
    } catch (cause) {
      fail('transcribe', cause, 'analyze');
      return;
    }

    setStep('plan', 'running', 'Directing overlays against the spoken words');
    try {
      const nextPlan = await planEdits(nextTranscript, style);
      setPlan(nextPlan);
      setStep('plan', 'complete', `${nextPlan.overlays.length} overlays planned`);
      setView('review');
    } catch (cause) {
      fail('plan', cause, 'analyze');
    }
  };

  const generate = async () => {
    if (!plan || !transcript) return;
    setView('generating');
    setError('');
    setRetryMode(null);
    setSteps((current) => current.map((step) => step.id === 'transcribe' || step.id === 'plan' ? { ...step, status: 'complete' } : { ...step, status: 'pending', detail: undefined }));

    let workingPlan = plan;
    const imageCount = plan.overlays.filter((overlay) => overlay.type === 'seedance_motion' || overlay.type === 'static_image').length;
    setStep('images', 'running', imageCount ? `0/${imageCount}` : 'No images needed');
    try {
      const overlays = await generateOverlayImages(workingPlan.overlays, style, (complete, total) => setStep('images', 'running', `${complete}/${total}`));
      workingPlan = { ...workingPlan, overlays };
      setPlan(workingPlan);
      setStep('images', 'complete', `${imageCount}/${imageCount}`);
    } catch (cause) {
      fail('images', cause, 'generate');
      return;
    }

    const motionCount = workingPlan.overlays.filter((overlay) => overlay.type === 'seedance_motion').length;
    setStep('motion', 'running', motionCount ? `0/${motionCount}` : 'No motion clips needed');
    try {
      const overlays = await makeSeedanceClips(workingPlan.overlays, (complete, total) => setStep('motion', 'running', `${complete}/${total}`));
      workingPlan = { ...workingPlan, overlays };
      setPlan(workingPlan);
      setStep('motion', 'complete', `${motionCount}/${motionCount}`);
    } catch (cause) {
      fail('motion', cause, 'generate');
      return;
    }

    setStep('render', 'running', 'Keeping the generated presenter as Layer 1');
    try {
      const url = await renderWithRemotion({ heygenVideoUrl: baseUrl, aspectRatio: source.aspectRatio, duration: transcript.duration, overlays: workingPlan.overlays });
      setResultUrl(url);
      setStep('render', 'complete', 'Final MP4 ready');
      setView('result');
    } catch (cause) {
      fail('render', cause, 'generate');
    }
  };

  return (
    <div className="absolute inset-0 z-40 overflow-y-auto bg-[#FFFDF4] text-[#1A1000]">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(245,181,62,.09),transparent_34%),radial-gradient(circle_at_85%_15%,rgba(220,172,90,.07),transparent_28%)]" />
      <main className="relative mx-auto max-w-6xl px-5 py-7 sm:px-8 sm:py-10">
        <header className="mb-7 flex flex-wrap items-center gap-4">
          <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-xl border border-[color-mix(in_srgb,#B4780A_14%,transparent)] bg-[#FFFFFF] text-[#3D2800] transition hover:border-[color-mix(in_srgb,#B4780A_30%,transparent)] hover:text-[#1A1000]" aria-label="Back to Avatar Studio"><ArrowLeft size={19} /></button>
          <div className="min-w-0 flex-1"><div className="flex items-center gap-2 text-[#C8920A]"><Clapperboard size={17} /><span className="text-xs font-black uppercase tracking-[.2em]">SceneForge post-production</span></div><h1 className="mt-1 truncate text-xl font-semibold text-[#1A1000] sm:text-2xl">{sourceLabel}</h1></div>
          <span className="rounded-full border border-[color-mix(in_srgb,#B4780A_14%,transparent)] bg-[#FFFFFF] px-3 py-1.5 text-xs text-[#7A6030]">{source.aspectRatio} · generated video</span>
        </header>

        {view === 'setup' && (
          <div className="grid gap-5 lg:grid-cols-[1.35fr_.75fr]">
            <section className="rounded-3xl border border-[color-mix(in_srgb,#B4780A_14%,transparent)] bg-[#FFFFFF] p-5 shadow-2xl shadow-[rgba(120,80,0,0.12)]">
              <div className="mb-4 flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-[color-mix(in_srgb,#C8920A_12%,transparent)] text-[#C8920A]"><Film size={20} /></div><div><h2 className="font-semibold text-[#1A1000]">Your generated master</h2><p className="text-sm text-[#7A6030]">Used automatically as Layer 1 · never regenerated</p></div></div>
              <div className={`overflow-hidden rounded-2xl border border-[color-mix(in_srgb,#B4780A_14%,transparent)] bg-black ${source.aspectRatio === '9:16' ? 'mx-auto max-w-[320px]' : ''}`}><video key={baseUrl} src={baseUrl} poster={source.posterUrl} controls playsInline className={source.aspectRatio === '9:16' ? 'aspect-[9/16] w-full object-contain' : 'aspect-video w-full object-contain'} onError={() => void refreshSource()} /></div>
              {refreshing && <p className="mt-3 flex items-center justify-center gap-2 text-sm text-[#7A6030]"><RefreshCw className="animate-spin" size={15} />Refreshing the generated video link…</p>}
            </section>
            <div className="space-y-5">
              <StyleSelector value={style} onChange={setStyle} />
              <div className="rounded-2xl border border-[color-mix(in_srgb,#B4780A_14%,transparent)] bg-[color-mix(in_srgb,#B4780A_6%,transparent)] p-4 text-sm leading-6 text-[#3D2800]"><Sparkles className="mb-2 text-[#C8920A]" size={18} />Deepgram times the spoken words, GPT-5.6-sol directs the edit, Seedance creates only the motion moments that need it, and Remotion preserves the original presenter audio underneath.</div>
              {error && <div className="rounded-2xl border border-[color-mix(in_srgb,#991B1B_24%,transparent)] bg-[color-mix(in_srgb,#991B1B_8%,transparent)] p-4 text-sm text-[#991B1B]">{error}</div>}
              <button type="button" onClick={analyze} disabled={!baseUrl || refreshing} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#C8920A] px-5 py-4 font-bold text-white transition hover:bg-[#B4720A] disabled:opacity-40"><WandSparkles size={18} /> Analyze generated video</button>
            </div>
          </div>
        )}

        {view === 'analyzing' && <div className="grid gap-5 lg:grid-cols-[1.15fr_.85fr]"><div className="rounded-3xl border border-[color-mix(in_srgb,#B4780A_14%,transparent)] bg-[#FFFFFF] p-6"><div className="animate-pulse"><div className="h-5 w-36 rounded bg-[color-mix(in_srgb,#B4780A_14%,transparent)]" /><div className="mt-5 aspect-video rounded-2xl bg-[color-mix(in_srgb,#B4780A_8%,transparent)]" /><div className="mt-5 h-3 w-full rounded bg-[color-mix(in_srgb,#B4780A_10%,transparent)]" /><div className="mt-2 h-3 w-4/5 rounded bg-[color-mix(in_srgb,#B4780A_10%,transparent)]" /></div></div><ProgressTracker steps={steps} error={error} onRetry={retryMode === 'analyze' ? analyze : undefined} /></div>}
        {view === 'review' && plan && transcript && <EditPlanPanel plan={plan} duration={transcript.duration} onChange={setPlan} onGenerate={generate} />}
        {view === 'generating' && <div className="mx-auto max-w-2xl"><ProgressTracker steps={steps} error={error} onRetry={retryMode === 'generate' ? generate : undefined} /></div>}
        {view === 'result' && resultUrl && <ResultScreen videoUrl={resultUrl} onNew={onClose} />}
      </main>
    </div>
  );
}
