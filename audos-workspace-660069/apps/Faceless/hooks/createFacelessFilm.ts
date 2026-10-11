/**
 * createFacelessFilm — the entry point, and the only place the pipeline order
 * is written down.
 *
 * THE ORDER IS LOAD-BEARING. Narration is generated BEFORE the script is
 * analysed, because analyzeScript needs word-level timestamps and raw text
 * cannot give accurate timing. Every later stage inherits that spine: beats
 * are spans of real speech, not spans of time.
 *
 *   generateNarration
 *     → analyzeScript           (timed transcript, never raw text)
 *     → buildAssetIndex
 *     → createEditorialTimeline (Opus 5 FacelessEditorialDirector)
 *     → createVisualPlan        (match-cut DAG + novelty + cost, pre-dispatch)
 *     → selectAssets / generateAssets  (parallel per wave, sequential across)
 *     → prepareAssets
 *     → createMotionPlan
 *     → compileFilmSpec         (immutable v1)
 *     → validateFilmSpec
 *     → renderFilm              (HyperFrames via RenderAdapter)
 *     → finalizeFilm            (deliver the first successful render immediately)
 *
 * Post-render QA and revision are intentionally bypassed. A successful render
 * is the completed film; it is never held behind validation or a re-render loop.
 */

import {
  FacelessError,
  type DepthBackground,
  type FacelessFilmInput,
  type FilmRunState,
  type FinalFilm,
  type PipelineStageId,
  type RenderResult,
  type StageUpdate,
} from '../types/editorial';
import { generateNarration } from './generateNarration';
import { analyzeScript } from './analyzeScript';
import { buildAssetIndex } from './buildAssetIndex';
import { createEditorialTimeline } from './createEditorialTimeline';
import { applyPlanToTimeline, createVisualPlan } from './createVisualPlan';
import { generateAssets } from './generateAssets';
import { generateMusic } from './generateMusic';
import { generateAllSFX } from './generateSFX';
import { prepareAllAssets } from './prepareAssets';
import { createMotionPlan } from './createMotionPlan';
import { compileFilmSpec, describeSpec } from './compileFilmSpec';
import { describeValidation, validateFilmSpec } from './validateFilmSpec';
import { renderFilm } from './renderFilm';
import { finalizeFilm } from './finalizeFilm';
import { generateDepthBackground } from './generateDepthBackground';
import { resolveVoiceSettings } from '../lib/facelessOptions';
import type { RenderAdapter } from '../lib/renderAdapter';

export interface CreateFacelessFilmOptions {
  onStage?: (update: StageUpdate) => void;
  onState?: (state: FilmRunState) => void;
  /** Pre-created persistence row id. A new id is used when omitted. */
  filmId?: string;
  /** Injectable for tests; production always uses HyperFramesAdapter. */
  adapter?: RenderAdapter;
  /**
   * Fires only on documentary films, as the depth stage's background plate
   * resolves. It can fire twice: once with the still, once again if Seedance
   * motion lands after the preview budget.
   */
  onDepthBackground?: (background: DepthBackground) => void;
  /** Something optional degraded. The film is fine; say it once and move on. */
  onNotice?: (message: string, tone?: 'info' | 'warn') => void;
  /** Set when the app leaves the run, so background work stops. */
  signal?: AbortSignal;
}

export function newFilmId(): string {
  return `fv_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export async function createFacelessFilm(
  input: FacelessFilmInput,
  options: CreateFacelessFilmOptions = {},
): Promise<FinalFilm> {
  const filmId = options.filmId || newFilmId();
  const state: FilmRunState = {
    filmId,
    input,
    narration: null,
    analysis: null,
    assetIndex: null,
    timeline: null,
    visualPlan: null,
    resolvedAssets: {},
    preparedAssets: [],
    motionPlan: null,
    specs: [],
    renders: [],
    mechanicalQA: null,
    creativeQA: null,
    revisionsUsed: 0,
    spend: 0,
    final: null,
  };

  const publish = () => options.onState?.({ ...state });
  const stage = (id: PipelineStageId, label: string, detail?: string, progress?: number) =>
    options.onStage?.({ stage: id, state: 'active', label, detail, progress });
  const done = (id: PipelineStageId, label: string, detail?: string) =>
    options.onStage?.({ stage: id, state: 'done', label, detail });
  try {
    // 1 — NARRATION. First, always.
    stage('narration', 'Recording the narration');
    state.narration = await generateNarration(input.script, {
      voiceId: input.voiceId,
      voiceSettings: input.settings
        ? resolveVoiceSettings(input.settings.voiceStyle, input.settings.voiceEffect)
        : undefined,
      onNote: (note) => stage('narration', 'Recording the narration', note),
    });
    publish();
    done(
      'narration',
      'Narration recorded',
      `${state.narration.duration.toFixed(1)}s, ${state.narration.wordTimestamps.length} words${state.narration.timestampsMeasured ? ' with measured word timing' : ' with estimated word timing — the edit will be less tightly anchored'}`,
    );

    // 2 — ANALYSIS, from the timed transcript.
    stage('analysis', 'Reading the story structure');
    state.analysis = await analyzeScript({
      script: input.script,
      wordTimestamps: state.narration.wordTimestamps,
      modeHint: input.mode,
      topic: input.topic,
    });
    publish();
    done('analysis', 'Story structure read', `${state.analysis.mode} — ${state.analysis.modeRationale}`);

    // VOX 3-LAYER SYSTEM — Documentary only. Do not enable for other styles
    // without founder approval. The depth stage is a presentation layer over
    // the run, so it is started here and never awaited: the film does not
    // wait on it, and it cannot fail the pipeline.
    if (state.analysis.mode === 'documentary') {
      startDepthBackground(input, options);
    }

    // 3 — WHAT THE WORKSPACE ALREADY OWNS.
    stage('asset_index', 'Indexing existing workspace media');
    state.assetIndex = await buildAssetIndex(filmId);
    publish();
    done(
      'asset_index',
      'Existing media indexed',
      `${state.assetIndex.assets.length} reusable asset(s)${state.assetIndex.warnings.length ? ` · ${state.assetIndex.warnings[0]}` : ''}`,
    );

    // 4 — THE EDIT.
    stage('editorial', 'Opus 5 is directing the edit');
    const directed = await createEditorialTimeline({
      filmId,
      analysis: state.analysis,
      wordTimestamps: state.narration.wordTimestamps,
      assetIndex: state.assetIndex,
      topic: input.topic,
      onNote: (note) => stage('editorial', 'Opus 5 is directing the edit', note),
    });
    publish();
    done('editorial', 'Edit directed', `${directed.beats.length} beats`);

    // 5 — THE PLAN. Last chance to change anything before money is spent.
    stage('visual_plan', 'Resolving match cuts and cost');
    state.visualPlan = createVisualPlan(directed);
    state.timeline = applyPlanToTimeline(directed, state.visualPlan);
    publish();
    done(
      'visual_plan',
      'Plan resolved',
      [
        `${state.visualPlan.waves.length} dispatch wave(s)`,
        state.visualPlan.downgrades.length ? `${state.visualPlan.downgrades.length} beat(s) downgraded for cost` : '',
        state.visualPlan.noveltyDeviations.length ? `${state.visualPlan.noveltyDeviations.length} novelty deviation(s)` : '',
        `est. $${state.visualPlan.estimatedCost.toFixed(2)}`,
      ]
        .filter(Boolean)
        .join(' · '),
    );

    // 6 — ASSETS. Waves in order; within a wave, in parallel.
    stage('assets', 'Sourcing and generating assets');
    const assets = await generateAssets({
      timeline: state.timeline,
      visualPlan: state.visualPlan,
      assetIndex: state.assetIndex,
      aspect: input.settings?.aspect,
      onNote: (note) => stage('assets', 'Sourcing and generating assets', note),
      onProgress: (completed, total) =>
        stage('assets', 'Sourcing and generating assets', `${completed} of ${total} beats`, completed / total),
    });
    state.resolvedAssets = assets.resolved;
    state.spend += assets.spend;
    publish();

    // Sound is a layer, and a layer never blocks the film.
    stage('assets', 'Scoring the film');
    const music = await generateMusic(state.timeline.musicArc, {
      durationSeconds: state.timeline.duration,
      mode: state.timeline.mode,
      colorStory: state.timeline.continuityGuide.colorStory,
      mood: input.settings?.musicMood,
    });
    if (!music.url && music.reason) {
      options.onNotice?.(`No music bed on this film — ${music.reason}`, 'warn');
    }
    state.spend += music.cost;
    const sfx = await generateAllSFX(state.timeline.beats);
    state.spend += sfx.spend;
    publish();
    done(
      'assets',
      'Assets ready',
      [
        `${Object.keys(state.resolvedAssets).length}/${state.timeline.beats.length} beats sourced`,
        music.url ? 'arc-following music bed' : `no music (${music.reason || 'unavailable'})`,
        sfx.cues.length ? `${sfx.cues.length} sound effect(s)` : '',
        `$${state.spend.toFixed(2)} spent`,
      ]
        .filter(Boolean)
        .join(' · '),
    );

    // 7 — PREPARATION, per asset type.
    stage('prepare', 'Preparing each asset for its beat');
    state.preparedAssets = prepareAllAssets(state.timeline.beats, state.resolvedAssets);
    publish();
    done('prepare', 'Assets prepared', `${state.preparedAssets.length} shot(s)`);

    // 8 — MOTION.
    stage('motion', 'Writing the motion plan');
    state.motionPlan = createMotionPlan({
      timeline: state.timeline,
      preparedAssets: state.preparedAssets,
      musicUrl: music.url,
      sfx: sfx.cues,
      aspect: input.settings?.aspect,
      musicVolume: input.settings?.musicVolume,
    });
    publish();
    done('motion', 'Motion plan written', `${state.motionPlan.durationInFrames} frames at ${state.motionPlan.fps}fps`);

    // 9/10 — COMPILE AND VALIDATE.
    stage('compile', 'Compiling the FilmSpec');
    const spec = compileFilmSpec({
      timeline: state.timeline,
      motionPlan: state.motionPlan,
      resolvedAssets: state.resolvedAssets,
      narrationUrl: state.narration.audioUrl,
      narrationTimestamps: state.narration.wordTimestamps,
    });
    state.specs.push(spec);
    publish();
    done('compile', 'FilmSpec compiled', describeSpec(spec));

    stage('validate', 'Validating before render');
    const validation = validateFilmSpec(spec);
    if (!validation.ok) {
      throw new FacelessError(describeValidation(validation), 'validate', 'invalid_spec');
    }
    done('validate', 'Spec validated', describeValidation(validation));

    // 11 — RENDER.
    stage('render', 'Rendering through HyperFrames');
    const render = await renderAndRecord(spec, state, options, (note) =>
      stage('render', 'Rendering through HyperFrames', note),
    );
    done('render', 'Render complete', `FilmSpec v${spec.version} · ${(render.durationMs / 1000).toFixed(0)}s`);

    // 12 — FINALISE. The first successful render is delivered immediately.
    stage('finalize', 'Finalising');
    state.final = finalizeFilm({
      mp4Url: render.mp4Url,
      spec,
      mechanicalQA: state.mechanicalQA,
      creativeQA: state.creativeQA,
      revisionsUsed: state.revisionsUsed,
      estimatedCost: state.spend,
    });
    publish();
    done('finalize', 'Film ready', `$${state.final.estimatedCost.toFixed(2)} · FilmSpec v${state.final.specVersion}`);

    return state.final;
  } catch (error: any) {
    const stageId: PipelineStageId = error instanceof FacelessError ? error.stage : 'finalize';
    options.onStage?.({
      stage: stageId,
      state: 'failed',
      label: 'Pipeline stopped',
      detail: String(error?.message || error),
    });
    publish();
    throw error;
  }
}

/**
 * Fire and forget. Every outcome is reported through a callback and nothing
 * here is allowed to reject into the pipeline's try block.
 */
function startDepthBackground(input: FacelessFilmInput, options: CreateFacelessFilmOptions): void {
  if (!options.onDepthBackground) return;
  // Held so a late motion clip is published as an upgrade of the plate the
  // stage is already showing, rather than as a bare url with no still behind it.
  let plate: DepthBackground | null = null;

  void generateDepthBackground({
    topic: input.topic,
    script: input.script,
    aspect: input.settings?.aspect || 'landscape',
    motion: input.settings?.depthMotion === true,
    signal: options.signal,
    onMotionReady: (videoUrl) => {
      if (!plate) return;
      options.onDepthBackground?.({ ...plate, videoUrl, degraded: false, reason: undefined });
    },
  })
    .then((background) => {
      if (!background) return;
      plate = background;
      options.onDepthBackground?.(background);
      if (background.degraded && background.reason === 'timeout') {
        options.onNotice?.('Motion generation timed out — using still image', 'warn');
      } else if (
        background.degraded
        && background.reason
        && background.reason !== 'cancelled'
        && background.reason !== 'motion_off'
      ) {
        options.onNotice?.(`Background motion unavailable — using still image (${background.reason})`, 'warn');
      }
    })
    .catch(() => {
      // The depth stage simply renders without a plate.
    });
}

async function renderAndRecord(
  spec: Parameters<typeof renderFilm>[0],
  state: FilmRunState,
  options: CreateFacelessFilmOptions,
  onNote: (note: string) => void,
): Promise<RenderResult> {
  const render = await renderFilm(spec, {
    adapter: options.adapter,
    onNote,
    onNotice: options.onNotice,
  });
  state.renders.push(render);
  options.onState?.({ ...state });
  return render;
}
