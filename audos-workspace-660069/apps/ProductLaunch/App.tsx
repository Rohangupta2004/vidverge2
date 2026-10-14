// PRODUCT LAUNCH — the autonomous film agent.
//
// The mental model is one sentence: OPUS DECIDES THE FILM, PRODUCTLAUNCH
// EXECUTES IT RELIABLY. Everything creative is a model decision recorded in a
// FilmSpec; everything mechanical is deterministic code that either succeeds
// or says exactly why it did not.
//
//   URL
//     -> web + screenshot extraction           ProductContext
//     -> Opus writes 2-3 competing concepts    FilmSpec[]
//     -> highest concept_score wins            FilmSpec   (creative truth)
//     -> typed primitives                      ComponentPlan
//     -> code generation                       Film.tsx
//     -> compile gate + fix loop               (free: no render spent)
//     -> render                                MP4
//     -> 24 frames -> contact sheet            QAResult
//     -> brief-aware critic                    CriticOutput
//     -> revise and re-render, or stop
//
// The gate before the render is the whole economic argument of this
// architecture: a fault found by the compiler costs one Sonnet turn, and the
// same fault found by the critic costs a render.
//
// This app ships NO content. There is no sample product, no demo concept and
// no placeholder film. Every word a viewer sees comes from the creator's own
// page or from a model reading it, and when a step cannot run the run stops
// and says so, because a canned film pretending to be theirs is worse than an
// error.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Rocket } from 'lucide-react';

import { errorMessage } from './lib/ai-client';
import { prepareAudio, type PreparedAudio } from './lib/audio';
import {
  bestIteration,
  MAX_ITERATIONS,
  shouldContinueIteration,
  type IterationDecision,
  type IterationRecord,
} from './lib/iteration-manager';
import { isLikelyUrl, normalizeUrl } from './lib/platform';
import { uploadLaunchAsset, type LaunchUpload } from './lib/uploads';
import {
  PipelineTracker,
  formatMs,
  freshSteps,
  type PipelineSnapshot,
} from './lib/pipeline-events';
import { generateComponentPlan } from './pipeline/component-plan';
import { compileFixLoop } from './pipeline/compile-check';
import { generateConcepts } from './pipeline/concepts';
import { emitFilmCodeFromPlan, generateFilmCode } from './pipeline/codegen';
import { runCritique } from './pipeline/critic';
import { extractProductContext } from './pipeline/extract';
import { runTechnicalQA } from './pipeline/qa';
import { filmThemeFrom, renderFilm } from './pipeline/render';
import { reviseFilmSpec } from './pipeline/revise';
import { auditConcepts, selectBestConcept, type ConceptAudit } from './pipeline/select-concept';
import { verifySchemaCoverage } from './sdk/component-schema';
import { planWarnings } from './types/component-plan.types';
import type { CriticOutput } from './types/critic.types';
import { filmSeconds, type FilmSpec } from './types/film-spec.types';
import type { ProductContext } from './types/product-context.types';

import AppShell from '../../components/ui/AppShell';
import Badge from '../../components/ui/Badge';
import { withBrandContext } from '../../components/BrandContextLayer';
import { ProgressBar, Stepper } from '../../components/ui/primitives';
import ConceptSelector from './components/ConceptSelector';
import CriticReport from './components/CriticReport';
import PipelineProgress from './components/PipelineProgress';
import VideoResult from './components/VideoResult';
import {
  ACCENT,
  BORDER,
  ErrorNote,
  INPUT_STYLE,
  LaunchKeyframes,
  MUTED,
  PrimaryButton,
  TEXT,
} from './components/LaunchUi';

type View = 'input' | 'running' | 'concepts' | 'critic' | 'result';

/** The launch stages the creator is walked through, in order. */
const LAUNCH_STAGES: Array<{ label: string; views: View[] }> = [
  { label: 'Product', views: ['input'] },
  { label: 'Concepts', views: ['concepts'] },
  { label: 'Build', views: ['running'] },
  { label: 'Critique', views: ['critic'] },
  { label: 'Launch film', views: ['result'] },
];

function stageIndexFor(view: View): number {
  const found = LAUNCH_STAGES.findIndex((stage) => stage.views.indexOf(view) !== -1);
  return found === -1 ? 0 : found;
}

interface BuildOutcome {
  videoUrl: string;
  frameCount: number;
  filmCode: string;
  codeSource: 'model' | 'printed';
  critic: CriticOutput | null;
  stopReason: string;
}

const BrandedProductLaunch = withBrandContext(App, 'Product Launch');
export default BrandedProductLaunch;
function App() {
  const [view, setView] = useState<View>('input');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [productFile, setProductFile] = useState<File | null>(null);
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null);
  const [narrationEnabled, setNarrationEnabled] = useState(false);
  const [narrationFile, setNarrationFile] = useState<File | null>(null);

  const trackerRef = useRef<PipelineTracker | null>(null);
  if (!trackerRef.current) trackerRef.current = new PipelineTracker();
  const tracker = trackerRef.current;

  const [snapshot, setSnapshot] = useState<PipelineSnapshot>({
    steps: freshSteps(),
    iteration: 1,
    startedAt: 0,
  });
  useEffect(() => tracker.subscribe(setSnapshot), [tracker]);

  // The run's artefacts. Held in refs as well as state because the pipeline is
  // one long async function that must not read a stale closure after a
  // re-render.
  const [context, setContext] = useState<ProductContext | null>(null);
  const [audits, setAudits] = useState<ConceptAudit[]>([]);
  const [spec, setSpec] = useState<FilmSpec | null>(null);
  const [critic, setCritic] = useState<CriticOutput | null>(null);
  const [decision, setDecision] = useState<IterationDecision>({ shouldContinue: false, reason: '' });
  const [history, setHistory] = useState<IterationRecord[]>([]);
  const [outcome, setOutcome] = useState<BuildOutcome | null>(null);

  const contextRef = useRef<ProductContext | null>(null);
  const specRef = useRef<FilmSpec | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);
  const audioRef = useRef<PreparedAudio | null>(null);
  const narrationFileRef = useRef<File | null>(null);
  narrationFileRef.current = narrationFile;

  // A gate the pipeline awaits while the creator looks at a concept list or a
  // critique. Resolving it is what lets one async function span a decision
  // the UI has to make.
  const gateRef = useRef<((value: unknown) => void) | null>(null);
  const openGate = useCallback(<T, >(): Promise<T> => new Promise<T>((resolve) => {
    gateRef.current = resolve as unknown as (value: unknown) => void;
  }), []);
  const closeGate = useCallback((value: unknown): void => {
    const resolve = gateRef.current;
    gateRef.current = null;
    if (resolve) resolve(value);
  }, []);

  useEffect(() => () => { abortRef.current?.abort(); }, []);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [view]);

  const ready = useMemo(() => isLikelyUrl(url), [url]);

  // -------------------------------------------------------------------------
  // The build loop: plan -> code -> compile -> render -> QA -> critique
  // -------------------------------------------------------------------------

  const buildLoop = useCallback(async (
    startSpec: FilmSpec,
    ctx: ProductContext,
    startIteration: number,
    priorHistory: IterationRecord[],
  ): Promise<BuildOutcome> => {
    const signal = abortRef.current?.signal;
    const theme = filmThemeFrom(ctx);
    let current = startSpec;
    let records = priorHistory.slice();
    let iteration = startIteration;
    let lastScore: number | null = records.length
      ? records[records.length - 1].critic.overall_score
      : null;

    for (;;) {
      setSpec(current);
      specRef.current = current;
      if (iteration > 1) tracker.beginIteration(iteration);
      setView('running');

      // 4 — mandatory score + beat-aware component plan. Audio is generated
      // once and reused across critique iterations so a revision never buys a
      // second track or changes the rhythmic foundation under the edit.
      tracker.start('plan');
      let preparedAudio = audioRef.current;
      if (!preparedAudio) {
        tracker.note('plan', 'Generating the mandatory music bed and analysing its beats…');
        preparedAudio = await prepareAudio(current, narrationFileRef.current, signal);
        audioRef.current = preparedAudio;
        preparedAudio.warnings.forEach((warning) => tracker.note('plan', warning));
      }
      const builtPlan = await generateComponentPlan(current, ctx, {
        signal,
        beatMap: preparedAudio.beatMap,
        onProgress: (detail, attempt) => tracker.note('plan', detail, attempt),
      });
      const warnings = planWarnings(builtPlan);
      tracker.done('plan', String(builtPlan.scenes.length) + ' scenes, '
        + String(builtPlan.scenes.reduce((sum, scene) => sum + scene.layers.length, 0))
        + ' layers, ' + String(builtPlan.total_frames) + ' frames'
        + (warnings.length ? '  ·  ' + warnings.map((entry) => entry.warning).join(' ') : ''));

      // 5 — code generation
      tracker.start('codegen', 'Writing Film.tsx against the plan…');
      let codeSource: 'model' | 'printed' = 'model';
      let code = '';
      try {
        code = await generateFilmCode(builtPlan, { signal });
        tracker.done('codegen', String(code.split('\n').length) + ' lines');
      } catch (codeError) {
        code = emitFilmCodeFromPlan(builtPlan);
        codeSource = 'printed';
        tracker.done('codegen', 'The code model failed (' + errorMessage(codeError)
          + '), so the film was printed from the validated plan instead.');
      }

      // 6 — the compile gate. Free, and it runs before anything expensive.
      tracker.start('compile');
      const gate = await compileFixLoop(code, 3, {
        plan: builtPlan,
        signal,
        onProgress: (detail, attempt) => tracker.note('compile', detail, attempt),
      });
      if (gate.success) {
        code = gate.code;
        tracker.done('compile', gate.attempts
          ? 'Clean after ' + String(gate.attempts) + ' repair attempt(s).'
          : 'Clean on the first pass.');
      } else {
        // The plan is already validated, so printing it is strictly safer than
        // rendering source the gate just rejected.
        code = emitFilmCodeFromPlan(builtPlan);
        codeSource = 'printed';
        tracker.done('compile', 'The generated file could not be made valid ('
          + String(gate.errors.length) + ' error(s) left), so the film was printed '
          + 'directly from the validated component plan.');
      }

      // 7 — render
      tracker.start('render', 'Submitting to the render service…');
      const render = await renderFilm(code, {
        frameCount: builtPlan.total_frames,
        theme,
        audio: preparedAudio,
        onProgress: (phase, elapsedMs) => tracker.note(
          'render',
          phase === 'pending' ? 'Queued…' : 'Rendering 1920x1080 at 30fps — ' + formatMs(elapsedMs),
        ),
      });
      tracker.done('render', filmSeconds(current).toFixed(1) + 's of video in ' + formatMs(render.durationMs));

      // 8 — technical QA
      tracker.start('qa');
      const qa = await runTechnicalQA(render.videoUrl, {
        frameCount: builtPlan.total_frames,
        onProgress: (detail) => tracker.note('qa', detail),
      });
      tracker.done('qa', String(qa.frames.length) + ' frames'
        + (qa.hasBlankFrames ? '  ·  blank frames detected' : '')
        + (qa.hasTextOverflow ? '  ·  edge-bleeding content detected' : '')
        + (qa.blockedReason ? '  ·  ' + qa.blockedReason : ''));

      // 9 — the critic
      tracker.start('critic', 'Opus is reading the contact sheet against the brief…');
      const verdict = await runCritique(qa, current, ctx, lastScore, { iteration, signal });
      tracker.done('critic', 'Scored ' + verdict.overall_score.toFixed(2)
        + (verdict.shippable ? ' — shippable' : ' — not shippable yet'));

      const nextDecision = shouldContinueIteration(verdict, iteration);
      const record: IterationRecord = {
        iteration,
        videoUrl: render.videoUrl,
        critic: verdict,
        decision: nextDecision,
      };
      records = records.concat([record]);

      setCritic(verdict);
      setDecision(nextDecision);
      setHistory(records);
      setView('critic');

      const wantsAnother = await openGate<boolean>();
      const canIterate = iteration < MAX_ITERATIONS;

      if (!wantsAnother || !canIterate) {
        // The best cut wins, not necessarily the last one — a revision is
        // allowed to come back worse than the film it replaced.
        const best = bestIteration(records) || record;
        return {
          videoUrl: best.videoUrl,
          frameCount: builtPlan.total_frames,
          filmCode: code,
          codeSource,
          critic: best.critic,
          stopReason: !canIterate && wantsAnother ? 'max_iterations_reached' : nextDecision.reason,
        };
      }

      setView('running');
      tracker.note('critic', 'Scored ' + verdict.overall_score.toFixed(2)
        + ' — revising the spec from the critique…');
      const revised = await reviseFilmSpec(current, verdict, ctx, { iteration: iteration + 1, signal });
      current = { ...revised, narration_enabled: startSpec.narration_enabled };
      lastScore = verdict.overall_score;
      iteration += 1;
    }
  }, [openGate, tracker]);

  // -------------------------------------------------------------------------
  // The whole run
  // -------------------------------------------------------------------------

  const finish = useCallback((result: BuildOutcome) => {
    tracker.start('output');
    tracker.done('output', 'Done.');
    setOutcome(result);
    setView('result');
  }, [tracker]);

  const startRun = useCallback(async (target: string) => {
    if (runningRef.current) return;
    runningRef.current = true;

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    tracker.reset();
    setError('');
    setContext(null);
    setAudits([]);
    setSpec(null);
    setCritic(null);
    setHistory([]);
    setOutcome(null);
    audioRef.current = null;
    setView('running');

    try {
      // A schema that has drifted from the SDK types would let an invalid film
      // through the gate, so it is checked once before anything is spent.
      const drift = verifySchemaCoverage();
      if (drift.length) throw new Error('The SDK schema is out of sync: ' + drift.join(' '));

      // 1 — extraction
      tracker.start('extract', 'Reading ' + normalizeUrl(target) + '…');
      const uploads: LaunchUpload[] = [];
      const requestedUploads: Array<{ file: File | null; kind: LaunchUpload['kind'] }> = [
        { file: logoFile, kind: 'logo' },
        { file: productFile, kind: 'product_image' },
        { file: screenshotFile, kind: 'screenshot' },
      ];
      for (const requested of requestedUploads) {
        if (!requested.file) continue;
        tracker.note('extract', 'Uploading ' + requested.kind.replace('_', ' ') + ' without altering it…');
        uploads.push(await uploadLaunchAsset(requested.file, requested.kind, signal));
      }
      const ctx = await extractProductContext(target, {
        signal,
        uploads,
        onProgress: (detail) => tracker.note('extract', detail),
      });
      setContext(ctx);
      contextRef.current = ctx;
      tracker.done('extract', ctx.product_name + ' — ' + String(ctx.assets.length) + ' asset(s), '
        + String(ctx.pages_analyzed.length) + ' page(s), confidence '
        + ctx.extraction_confidence.toFixed(2)
        + (ctx.extraction_gaps.length ? '  ·  ' + String(ctx.extraction_gaps.length) + ' gap(s)' : ''));

      // 2 — competing concepts
      tracker.start('concepts', 'Opus is writing competing concepts…');
      const concepts = await generateConcepts(ctx, {
        signal,
        onProgress: (detail) => tracker.note('concepts', detail),
      });
      const audited = auditConcepts(concepts, ctx);
      setAudits(audited);
      tracker.done('concepts', String(concepts.length) + ' concepts, top score '
        + concepts[0].concept_score.toFixed(2));

      // 3 — selection. Auto-selects the highest score; the creator may overrule.
      tracker.start('select', 'Waiting on the concept choice…');
      setView('concepts');
      const chosen = await openGate<FilmSpec>();
      const selected = chosen || selectBestConcept(concepts, ctx);
      const winner: FilmSpec = { ...selected, narration_enabled: narrationEnabled };
      tracker.done('select', winner.narrative_arc + '  (score '
        + winner.concept_score.toFixed(2) + ')');

      finish(await buildLoop(winner, ctx, 1, []));
    } catch (runError) {
      const failed = tracker.failedStep();
      const message = errorMessage(runError);
      if (!failed) {
        const running = tracker.snapshot().steps.find((step) => step.state === 'running');
        if (running) tracker.fail(running.id, message);
      }
      setError(message);
      setView('running');
    } finally {
      runningRef.current = false;
    }
  }, [buildLoop, finish, logoFile, narrationEnabled, openGate, productFile, screenshotFile, tracker]);

  /**
   * Retry from where it broke rather than from the top.
   *
   * Extraction and concepts are the only steps whose inputs are the URL, so a
   * failure there restarts the run. Everything from the plan onwards already
   * has a ProductContext and a FilmSpec in hand, and re-reading the site to
   * retry a render would be both slow and pointless.
   */
  const retry = useCallback(async () => {
    if (runningRef.current) return;
    const failed = tracker.failedStep();
    const ctx = contextRef.current;
    const currentSpec = specRef.current;

    if (!failed || !ctx || !currentSpec || failed.id === 'extract' || failed.id === 'concepts') {
      startRun(url);
      return;
    }

    runningRef.current = true;
    setError('');
    tracker.beginIteration(snapshot.iteration);
    setView('running');
    try {
      finish(await buildLoop(currentSpec, ctx, snapshot.iteration, history));
    } catch (runError) {
      const message = errorMessage(runError);
      const running = tracker.snapshot().steps.find((step) => step.state === 'running');
      if (running) tracker.fail(running.id, message);
      setError(message);
    } finally {
      runningRef.current = false;
    }
  }, [buildLoop, finish, history, snapshot.iteration, startRun, tracker, url]);

  const restart = useCallback(() => {
    abortRef.current?.abort();
    gateRef.current = null;
    runningRef.current = false;
    tracker.reset();
    setView('input');
    setError('');
    setOutcome(null);
  }, [tracker]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const stageIndex = stageIndexFor(view);

  return (
    <AppShell
      title="Product Launch"
      eyebrow="Launch film agent"
      subtitle="Opus decides the film. This app executes it — reads your page, designs competing concepts, builds the winner, then watches it back and fixes what it got wrong."
      maxWidth={1040}
      beamIntensity={0.18}
      watermark={false}
      icon={(
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 38,
            height: 38,
            borderRadius: 12,
            background: 'linear-gradient(140deg, color-mix(in srgb, var(--space-brand-primary-500) 22%, transparent) 0%, color-mix(in srgb, var(--space-brand-highlight-500) 10%, transparent) 100%)',
            border: '1px solid ' + BORDER,
          }}
        >
          <Rocket size={19} style={{ color: ACCENT }} />
        </span>
      )}
      actions={context ? <Badge variant="cyan">{context.product_name}</Badge> : null}
      contentStyle={{ color: TEXT }}
    >
      <LaunchKeyframes />

      {/* Where the creator is in the launch, kept visible on every screen. */}
      <div style={{ marginBottom: 28 }}>
        <Stepper steps={LAUNCH_STAGES.map((stage) => stage.label)} current={stageIndex} />
        <ProgressBar
          value={(stageIndex / (LAUNCH_STAGES.length - 1)) * 100}
          style={{ marginTop: 16 }}
        />
      </div>

      {view === 'input' ? (
        <section style={{ maxWidth: 620, margin: '2vh auto 0', textAlign: 'center' }}>
          <h1
            style={{
              margin: 0,
              fontSize: 40,
              fontWeight: 900,
              letterSpacing: '-0.045em',
              lineHeight: 1.05,
              color: TEXT,
            }}
          >
            Paste a URL. Get a launch film.
          </h1>
          <p style={{ margin: '16px auto 34px', maxWidth: 480, fontSize: 14.5, lineHeight: 1.6, color: MUTED }}>
            The agent reads your product page, designs two or three competing films, builds the one
            it believes in, renders it, then watches it back and fixes what it got wrong.
          </p>

          <input
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && ready) startRun(url); }}
            placeholder="https://your-product.com"
            spellCheck={false}
            autoComplete="url"
            style={{ ...INPUT_STYLE, fontSize: 17, padding: '17px 20px', textAlign: 'center' }}
          />

          <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, textAlign: 'left' }}>
            {([
              ['Logo', logoFile, setLogoFile],
              ['Product image', productFile, setProductFile],
              ['UI screenshot', screenshotFile, setScreenshotFile],
            ] as const).map(([label, file, setter]) => (
              <label key={label} style={{ padding: '12px 13px', border: '1px solid ' + BORDER, borderRadius: 12, color: file ? TEXT : MUTED, fontSize: 12, cursor: 'pointer' }}>
                <span style={{ display: 'block', fontWeight: 700 }}>{label}</span>
                <span style={{ display: 'block', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file?.name || 'Optional'}</span>
                <input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={(event) => setter(event.target.files?.[0] || null)} />
              </label>
            ))}
          </div>

          <div style={{ marginTop: 12, padding: 14, border: '1px solid ' + BORDER, borderRadius: 12, textAlign: 'left' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 9, color: TEXT, fontSize: 13, fontWeight: 700 }}>
              <input type="checkbox" checked={narrationEnabled} onChange={(event) => setNarrationEnabled(event.target.checked)} />
              Add optional narration
            </label>
            {narrationEnabled ? (
              <label style={{ display: 'block', marginTop: 10, color: MUTED, fontSize: 12, cursor: 'pointer' }}>
                Fallback MP3/WAV: {narrationFile?.name || 'choose a file'}
                <input type="file" accept="audio/mpeg,audio/wav,audio/x-wav" style={{ display: 'none' }} onChange={(event) => setNarrationFile(event.target.files?.[0] || null)} />
              </label>
            ) : null}
          </div>

          <p style={{ margin: '12px 0 0', fontSize: 11.5, lineHeight: 1.5, color: MUTED, textAlign: 'left' }}>
            Screenshots guide a semantic React reconstruction; screenshot pixels are never embedded. Music is always generated and motion is aligned to its beat map.
          </p>

          <div style={{ marginTop: 18 }}>
            <PrimaryButton onClick={() => startRun(url)} disabled={!ready} width="100%">
              Generate SaaS Launch Film <ArrowRight size={16} />
            </PrimaryButton>
          </div>

          <p style={{ margin: '22px 0 0', fontSize: 12, lineHeight: 1.6, color: MUTED }}>
            {'1920x1080 · 30fps · 15-30 seconds · up to '
              + String(MAX_ITERATIONS) + ' critique-driven iterations'}
          </p>

          <ErrorNote>{error}</ErrorNote>
        </section>
      ) : null}

      {view === 'running' ? (
        <>
          <PipelineProgress
            steps={snapshot.steps}
            iteration={snapshot.iteration}
            startedAt={snapshot.startedAt}
            onRetry={retry}
          />
          {error ? (
            <div style={{ maxWidth: 760, margin: '14px auto 0' }}>
              <PrimaryButton onClick={restart}>Start over</PrimaryButton>
            </div>
          ) : null}
        </>
      ) : null}

      {view === 'concepts' ? (
        <ConceptSelector audits={audits} onConfirm={(chosen) => closeGate(chosen)} />
      ) : null}

      {view === 'critic' && critic ? (
        <CriticReport
          critic={critic}
          decision={decision}
          iteration={snapshot.iteration}
          maxIterations={MAX_ITERATIONS}
          onRevise={() => closeGate(true)}
          onShip={() => closeGate(false)}
        />
      ) : null}

      {view === 'result' && outcome && spec ? (
        <VideoResult
          videoUrl={outcome.videoUrl}
          spec={spec}
          critic={outcome.critic}
          frameCount={outcome.frameCount}
          stopReason={outcome.stopReason}
          history={history}
          filmCode={outcome.filmCode}
          codeSource={outcome.codeSource}
          onRestart={restart}
        />
      ) : null}
    </AppShell>
  );
}
