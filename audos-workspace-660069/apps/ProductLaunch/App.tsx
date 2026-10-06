// PRODUCT LAUNCH ENGINE
//
// Four screens, one direction of travel:
//
//   1 INTAKE       five empty fields — the only content this app ever has
//   2 GENERATION   Claude Opus 5 (extended thinking) writes the script
//   3 COMPOSITION  the Remotion Player runs that script at 60fps, then the
//                  SAME source and props are submitted for the MP4
//   4 REVIEW       the finished file, plus a contact-sheet verdict from a
//                  single Opus 5 vision call
//
// THERE IS NO TEMPLATE IN THIS APP. No sample product, no demo script, no
// preset scene list, no poster image, no mocked response and no setTimeout
// pretending to be work. Every run starts from the words the creator typed
// and, when they give a URL, from a live read of their own page. If the model
// cannot be reached the run stops and says so — there is nothing canned to
// fall back to, by design.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Rocket } from 'lucide-react';

import { filmSeconds, planTiming } from './lib/filmTiming';
import { LAUNCH_FILM_TSX } from './lib/filmSource';
import {
  EMPTY_LAUNCH_INPUT,
  LAUNCH_AUDIO_URL,
  PREVIEW_FPS,
  RENDER_FPS,
  type FilmProps,
  type LaunchInput,
  type LaunchScript,
} from './lib/launchTypes';
import { analyzeContactSheet, generateLaunchScript, type SiteEvidence } from './lib/opusClient';
import { buildPlayerFrame } from './lib/playerFrame';
import {
  buildContactSheet,
  extractFrames,
  pollRender,
  readSite,
  sampleTimestamps,
  submitRender,
  type RenderPhase,
} from './lib/renderPipeline';

import ComposeScreen from './components/ComposeScreen';
import GenerateScreen, { type GenerationPhase } from './components/GenerateScreen';
import IntakeScreen from './components/IntakeScreen';
import ReviewScreen, { type AnalysisProgress } from './components/ReviewScreen';
import { ACCENT, BORDER, LaunchKeyframes, MUTED, StepRail, TEXT } from './components/LaunchUi';

type Screen = 'intake' | 'generating' | 'composition' | 'review';

const RAIL = [
  { id: 'intake', label: 'Brief' },
  { id: 'generating', label: 'Script' },
  { id: 'composition', label: 'Composition' },
  { id: 'review', label: 'Review' },
];

const SCREEN_INDEX: Record<Screen, number> = {
  intake: 0,
  generating: 1,
  composition: 2,
  review: 3,
};

const IDLE_ANALYSIS: AnalysisProgress = {
  state: 'idle',
  framesDone: 0,
  framesTotal: 0,
  sheet: null,
  verdict: null,
  error: '',
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function basePhases(withSite: boolean): GenerationPhase[] {
  const phases: GenerationPhase[] = [];
  if (withSite) {
    phases.push({
      id: 'site',
      label: 'Reading your page',
      detail: 'Fetching the live page, harvesting its copy and palette, and photographing it.',
      state: 'waiting',
      ms: 0,
    });
  }
  phases.push({
    id: 'script',
    label: 'Claude Opus 5 writes the film',
    detail: 'Frontier model, extended thinking on: scenes, kinetic lines, cuts, colour and the closing line.',
    state: 'waiting',
    ms: 0,
  });
  phases.push({
    id: 'plan',
    label: 'Laying it on the timeline',
    detail: 'Every scene placed on a 60fps grid, with the overlap each transition needs.',
    state: 'waiting',
    ms: 0,
  });
  return phases;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('intake');

  // Screen 1 — the brief. Preserved across a Regenerate, cleared by nothing.
  const [input, setInput] = useState<LaunchInput>(EMPTY_LAUNCH_INPUT);

  // Screen 2 — generation.
  const [phases, setPhases] = useState<GenerationPhase[]>([]);
  const [startedAt, setStartedAt] = useState(0);
  const [script, setScript] = useState<LaunchScript | null>(null);
  const [evidence, setEvidence] = useState<SiteEvidence | null>(null);
  const [genError, setGenError] = useState('');
  const generating = useRef(false);

  // Screen 3 — render.
  const [renderPhase, setRenderPhase] = useState<RenderPhase | ''>('');
  const [renderElapsedMs, setRenderElapsedMs] = useState(0);
  const [renderError, setRenderError] = useState('');
  const [rendering, setRendering] = useState(false);
  const [videoUrl, setVideoUrl] = useState('');

  // Screen 4 — the contact-sheet review.
  const [analysis, setAnalysis] = useState<AnalysisProgress>(IDLE_ANALYSIS);

  useEffect(() => { window.scrollTo({ top: 0 }); }, [screen]);

  const screenshotUrl = evidence?.screenshotUrl || '';

  /** The film, assembled for one frame rate. Both mounts use this one builder. */
  const filmPropsFor = useCallback((fps: number): FilmProps | null => {
    if (!script) return null;
    return {
      ...script,
      productName: input.productName.trim(),
      tone: input.tone,
      audioUrl: LAUNCH_AUDIO_URL,
      screenshotUrl,
      timing: planTiming(script, fps),
    };
  }, [script, input.productName, input.tone, screenshotUrl]);

  const previewDoc = useMemo(() => {
    const props = filmPropsFor(PREVIEW_FPS);
    if (!props) return '';
    return buildPlayerFrame({
      compositionTsx: LAUNCH_FILM_TSX,
      props: props as unknown as Record<string, unknown>,
      durationInFrames: props.timing.totalFrames,
      fps: PREVIEW_FPS,
      accent: props.brandColor || '#F59E0B',
    });
  }, [filmPropsFor]);

  // -------------------------------------------------------------------------
  // Screen 2 — generation
  // -------------------------------------------------------------------------

  const runGeneration = useCallback(async (brief: LaunchInput) => {
    if (generating.current) return;
    generating.current = true;

    const withSite = Boolean(brief.websiteUrl.trim());
    const plan = basePhases(withSite);
    setPhases(plan);
    setScript(null);
    setEvidence(null);
    setGenError('');
    setVideoUrl('');
    setRenderPhase('');
    setRenderError('');
    setAnalysis(IDLE_ANALYSIS);
    setStartedAt(Date.now());
    setScreen('generating');

    const advance = (id: string, state: GenerationPhase['state'], ms: number) => {
      setPhases((current) => current.map((phase) => (
        phase.id === id ? { ...phase, state, ms: ms || phase.ms } : phase
      )));
    };

    let current = withSite ? 'site' : 'script';
    try {
      let siteEvidence: SiteEvidence | null = null;

      if (withSite) {
        const begun = Date.now();
        advance('site', 'running', 0);
        siteEvidence = await readSite(brief.websiteUrl);
        setEvidence(siteEvidence);
        setPhases((list) => list.map((phase) => (phase.id === 'site'
          ? {
            ...phase,
            state: 'done',
            ms: Date.now() - begun,
            detail: siteEvidence
              ? (siteEvidence.screenshotUrl
                ? 'Page read and photographed — the screenshot is composited into the film.'
                : 'Page read. No screenshot was available, so the film runs on type alone.')
              : 'That page could not be read, so the film is written from your words alone.',
          }
          : phase)));
      }

      current = 'script';
      const scriptBegun = Date.now();
      advance('script', 'running', 0);
      const written = await generateLaunchScript(brief, siteEvidence);
      advance('script', 'done', Date.now() - scriptBegun);

      current = 'plan';
      const planBegun = Date.now();
      advance('plan', 'running', 0);
      const timing = planTiming(written, PREVIEW_FPS);
      setScript(written);
      setPhases((list) => list.map((phase) => (phase.id === 'plan'
        ? {
          ...phase,
          state: 'done',
          ms: Math.max(1, Date.now() - planBegun),
          detail: written.scenes.length + ' scenes · ' + filmSeconds(timing).toFixed(1)
            + 's · ' + timing.totalFrames + ' frames at 60fps.',
        }
        : phase)));
    } catch (error) {
      advance(current, 'failed', 0);
      setGenError(message(error));
    } finally {
      generating.current = false;
    }
  }, []);

  // -------------------------------------------------------------------------
  // Screen 3 — render
  // -------------------------------------------------------------------------

  const runRender = useCallback(async () => {
    const props = filmPropsFor(RENDER_FPS);
    if (!props || rendering) return;
    setRendering(true);
    setRenderError('');
    setRenderPhase('pending');
    setRenderElapsedMs(0);
    try {
      const operationId = await submitRender({
        compositionTsx: LAUNCH_FILM_TSX,
        props: props as unknown as Record<string, unknown>,
        durationInFrames: props.timing.totalFrames,
      });
      const url = await pollRender(operationId, (phase, elapsedMs) => {
        setRenderPhase(phase);
        setRenderElapsedMs(elapsedMs);
      });
      setVideoUrl(url);
      setRenderPhase('complete');
      setScreen('review');
    } catch (error) {
      setRenderPhase('failed');
      setRenderError(message(error));
    } finally {
      setRendering(false);
    }
  }, [filmPropsFor, rendering]);

  // -------------------------------------------------------------------------
  // Screen 4 — contact-sheet review
  // -------------------------------------------------------------------------

  const runAnalysis = useCallback(async (url: string, cut: LaunchScript) => {
    const timing = planTiming(cut, RENDER_FPS);
    const stamps = sampleTimestamps(filmSeconds(timing));
    setAnalysis({ ...IDLE_ANALYSIS, state: 'sampling', framesTotal: stamps.length });
    try {
      const frames = await extractFrames(url, stamps, (done, total) => {
        setAnalysis((current) => ({ ...current, framesDone: done, framesTotal: total }));
      });
      setAnalysis((current) => ({ ...current, state: 'stitching' }));
      const sheet = await buildContactSheet(frames);
      setAnalysis((current) => ({ ...current, state: 'reading', sheet }));
      const verdict = await analyzeContactSheet({
        dataUrl: sheet.dataUrl,
        frameUrls: frames.map((frame) => frame.url),
      });
      setAnalysis((current) => ({ ...current, state: 'done', verdict }));
    } catch (error) {
      setAnalysis((current) => ({ ...current, state: 'failed', error: message(error) }));
    }
  }, []);

  // The review runs itself the moment a file exists, once per render.
  const analysedUrl = useRef('');
  useEffect(() => {
    if (!videoUrl || !script || analysedUrl.current === videoUrl) return;
    analysedUrl.current = videoUrl;
    runAnalysis(videoUrl, script);
  }, [videoUrl, script, runAnalysis]);

  const regenerate = useCallback(() => {
    // Screen 1, every field exactly as the creator left it.
    setScript(null);
    setVideoUrl('');
    setRenderPhase('');
    setRenderError('');
    setAnalysis(IDLE_ANALYSIS);
    analysedUrl.current = '';
    setScreen('intake');
  }, []);

  return (
    <div
      style={{
        minHeight: '100%',
        padding: '26px 28px 40px',
        color: TEXT,
        fontFamily: 'var(--space-font-body, Inter, system-ui, sans-serif)',
      }}
    >
      <LaunchKeyframes />

      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 18,
          flexWrap: 'wrap',
          paddingBottom: 20,
          marginBottom: 26,
          borderBottom: '1px solid ' + BORDER,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <Rocket size={19} style={{ color: ACCENT }} />
          <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-0.02em' }}>Product Launch</span>
          <span style={{ fontSize: 12.5, color: MUTED }}>Kinetic launch films, written by Claude Opus 5</span>
        </div>
        <StepRail steps={RAIL} activeIndex={SCREEN_INDEX[screen]} />
      </header>

      {screen === 'intake' ? (
        <IntakeScreen
          value={input}
          onChange={setInput}
          onGenerate={() => runGeneration(input)}
          error={genError}
        />
      ) : null}

      {screen === 'generating' ? (
        <GenerateScreen
          phases={phases}
          startedAt={startedAt}
          script={script}
          error={genError}
          onBack={() => setScreen('intake')}
          onRetry={() => runGeneration(input)}
          onContinue={() => setScreen('composition')}
        />
      ) : null}

      {screen === 'composition' && script ? (
        <ComposeScreen
          script={script}
          srcDoc={previewDoc}
          screenshotUrl={screenshotUrl}
          rendering={rendering}
          renderPhase={renderPhase}
          renderElapsedMs={renderElapsedMs}
          renderError={renderError}
          onRender={runRender}
          onBack={() => setScreen('generating')}
        />
      ) : null}

      {screen === 'review' && script && videoUrl ? (
        <ReviewScreen
          videoUrl={videoUrl}
          script={script}
          analysis={analysis}
          onRegenerate={regenerate}
          onBackToComposition={() => setScreen('composition')}
          onRetryAnalysis={() => runAnalysis(videoUrl, script)}
        />
      ) : null}
    </div>
  );
}
