/**
 * FACELESS CONTENT — the pipeline.
 *
 * topic -> research + script -> one shot prompt per VISUAL line ->
 * scene clips rendered SEQUENTIALLY with last-frame seeding -> one stitched MP4.
 *
 * Sequential is not a simplification: scene N seeds from the final frame of
 * scene N-1, so the look carries across the cut. Rendering them in parallel
 * would be faster and would lose exactly the thing this app exists for.
 *
 * Every stage writes its state to fc_projects before moving on, so the
 * terminal view (which polls the row) stays truthful even across a reload.
 */

import {
  RunwayUnavailableError, VideoModel, extractLastFrame, groupAModelFor, isSkipPrompt,
  renderSceneOnGoogle, renderSceneWithIntegration, renderSceneWithRunway, researchAndScript, runwayFallbackMessage,
  stitchScenes, writeVideoPrompt, OMNI_MODEL, VEO_MODEL,
} from './api';
import type { VideoIntegrationId } from '../../lib/videoIntegrations';
import { integrationForEngineId } from '../../lib/videoIntegrations';
import { Niche, Orientation, parseScript, treatmentFor } from './prompts';
import {
  FcScene, LogLine, createProject, createScenes, listScenes, queueProjectUpdate,
  updateProject, updateScene,
} from './store';

/** Clip length per scene. The Google proxy normalises to its own steps;
 * Runway takes 5 or 10. */
export const VEO_SCENE_SECONDS = 8;
export const RUNWAY_SCENE_SECONDS = 10;

/**
 * A hard ceiling on scenes per film. Each scene is a paid render, and a long
 * script can legitimately come back with twenty blocks; rendering all of them
 * unasked would empty the wallet on one press of Generate.
 */
export const MAX_SCENES = 14;

export interface RunBrief {
  topic: string;
  niche: Niche;
  lengthTarget: number;
  orientation: Orientation;
  /** Legacy pill selection — ignored when videoIntegration is set. */
  videoModel: VideoModel;
  videoIntegration?: VideoIntegrationId;
  /** Platform model id (e.g. gemini-omni-flash-preview, kling-v2-master). */
  videoModelId?: string;
}

export interface RunHooks {
  /** Mirror of the log, so the terminal paints before the next poll lands. */
  onLog: (lines: LogLine[]) => void;
  onProjectId: (id: string) => void;
  onToast: (message: string) => void;
  isCancelled?: () => boolean;
}

class Log {
  lines: LogLine[] = [];

  constructor(private readonly hooks: RunHooks, private readonly projectId: () => string | null) {}

  private flush(stage?: string) {
    this.hooks.onLog(this.lines.slice());
    const id = this.projectId();
    // Queued, not fired in parallel: an out-of-order progress write is what
    // used to leave a stale counter frozen in the row the poll reads.
    if (id) void queueProjectUpdate(id, { progress_log: this.lines.slice(), ...(stage ? { stage } : {}) });
  }

  /** Open a line as the active step and return its index. */
  start(text: string): number {
    this.lines.push({ text, state: 'active' });
    this.flush(text);
    return this.lines.length - 1;
  }

  finish(index: number, text?: string) {
    if (!this.lines[index]) return;
    this.lines[index] = { text: text || this.lines[index].text, state: 'done' };
    this.flush();
  }

  fail(index: number, text?: string) {
    if (!this.lines[index]) return;
    this.lines[index] = { text: text || this.lines[index].text, state: 'failed' };
    this.flush();
  }

  /** Rewrite an in-flight line without closing it (scene counters). */
  update(index: number, text: string) {
    if (!this.lines[index]) return;
    this.lines[index] = { text, state: this.lines[index].state };
    this.flush(text);
  }

  note(text: string, state: LogLine['state'] = 'pending') {
    this.lines.push({ text, state });
    this.flush();
  }
}

export interface RunResult {
  projectId: string;
  finalVideoUrl: string;
}

export async function runFacelessPipeline(brief: RunBrief, hooks: RunHooks): Promise<RunResult> {
  let projectId: string | null = null;
  const log = new Log(hooks, () => projectId);
  const cancelled = () => Boolean(hooks.isCancelled?.());

  projectId = await createProject({
    topic: brief.topic,
    niche: brief.niche,
    lengthTarget: brief.lengthTarget,
    orientation: brief.orientation,
    videoModel: brief.videoModel,
  });
  hooks.onProjectId(projectId);

  // A model fallback is worth saying once per run, not once per scene.
  const announced = new Set<string>();
  const announce = (message: string) => {
    if (announced.has(message)) return;
    announced.add(message);
    hooks.onToast(message);
    log.note(message, 'pending');
  };

  try {
    // --------------------------------------------------------- 1. script ----
    const researchLine = log.start('Researching topic...');
    const scriptLine = log.start('Writing script...');
    const raw = await researchAndScript(brief.topic, brief.niche, brief.lengthTarget, announce);
    const parsed = parseScript(raw);
    log.finish(researchLine, 'Researching topic...');

    const blocks = parsed.blocks.slice(0, MAX_SCENES);
    const trimmed = parsed.blocks.length - blocks.length;
    log.finish(scriptLine, `Writing script... ${parsed.blocks.length} blocks, ${parsed.titles.length} titles`);
    if (trimmed > 0) {
      log.note(`Rendering the first ${MAX_SCENES} blocks as scenes (${trimmed} more stay in the script only).`, 'done');
    }

    const useLegacyRunway = !brief.videoIntegration && brief.videoModel === 'runway_turbo';
    const sceneSeconds = useLegacyRunway ? RUNWAY_SCENE_SECONDS : VEO_SCENE_SECONDS;
    await updateProject(projectId, {
      titles_json: parsed.titles,
      thumbnail_line: parsed.thumbnailLine,
      script_json: parsed.blocks,
      fact_check_json: parsed.factCheck,
      status: 'prompting',
      stage: 'Generating video prompts',
    });
    const scenes = await createScenes(projectId, blocks, sceneSeconds);

    // -------------------------------------------------------- 2. prompts ----
    // The counter reports SHOTS WRITTEN, and every refusal is printed as its
    // own failed line. A prompt that cannot be written used to disappear into
    // the scene row, so nine silent failures read on screen as one stalled
    // step — that is the bug this stage is shaped around.
    const promptLine = log.start(`Generating video prompts... 0 of ${scenes.length}`);
    let written = 0;
    let promptFailure = '';
    for (let i = 0; i < scenes.length; i += 1) {
      if (cancelled()) throw new Error('This run was cancelled.');
      const scene = scenes[i];
      const block = blocks[i];
      try {
        const prompt = await writeVideoPrompt({
          visual: block.visual || block.vo,
          blockName: block.block,
          treatment: treatmentFor(block.block, block.visual),
          orientation: brief.orientation,
          durationSeconds: sceneSeconds,
          continuity: i > 0 ? blocks[i - 1].visual : null,
          onFallback: announce,
        });
        const skip = isSkipPrompt(prompt);
        scene.video_prompt = skip ? null : prompt;
        scene.status = skip ? 'skipped' : 'pending';
        await updateScene(scene.id, { video_prompt: scene.video_prompt, status: scene.status });
        written += 1;
        log.update(promptLine, `Generating video prompts... ${written} of ${scenes.length}`);
      } catch (e: any) {
        promptFailure = String(e?.message || e);
        scene.status = 'failed';
        scene.error_msg = promptFailure;
        await updateScene(scene.id, { status: 'failed', error_msg: promptFailure });
        log.note(`Shot ${i + 1} of ${scenes.length} could not be written — ${promptFailure}`, 'failed');
      }
    }
    const promptFailures = scenes.length - written;
    if (promptFailures > 0 && written > 0) {
      log.fail(promptLine, `Generating video prompts... ${written} of ${scenes.length} shots (${promptFailures} failed)`);
    } else if (written > 0) {
      log.finish(promptLine, `Generating video prompts... ${written} shots`);
    } else {
      log.fail(promptLine, `Generating video prompts... none of ${scenes.length} shots could be written`);
    }

    // --------------------------------------------------------- 3. scenes ----
    await updateProject(projectId, { status: 'generating', stage: 'Generating scenes' });

    const renderable = scenes.filter((s) => s.video_prompt && s.status !== 'skipped');
    if (!renderable.length) {
      throw new Error(
        promptFailure
          ? `No shot prompt could be written, so there is nothing to film — ${promptFailure}`
          : 'No scene could be prompted, so there is nothing to film.',
      );
    }

    // Latched once: if the founder's Runway key cannot be used, every
    // remaining scene goes to Veo rather than re-probing per scene.
    let engine: VideoModel = brief.videoModel;
    const integration = brief.videoIntegration || (brief.videoModelId
      ? integrationForEngineId(brief.videoModelId)
      : integrationForEngineId(brief.videoModel === 'veo3' ? VEO_MODEL : OMNI_MODEL));
    const platformModel = brief.videoModelId
      || (brief.videoModel === 'veo3' ? VEO_MODEL : brief.videoModel === 'runway_turbo' ? 'gen4_turbo' : OMNI_MODEL);
    let seedFrameUrl: string | null = null;
    const finished: FcScene[] = [];

    for (let i = 0; i < renderable.length; i += 1) {
      if (cancelled()) throw new Error('This run was cancelled.');
      const scene = renderable[i];
      const sceneLine = log.start(`Generating scene ${i + 1} of ${renderable.length}...`);
      await updateScene(scene.id, { status: 'generating', seed_frame_url: seedFrameUrl });

      try {
        let result;
        if (brief.videoIntegration || brief.videoModelId) {
          result = await renderSceneWithIntegration({
            integration,
            model: platformModel,
            prompt: scene.video_prompt as string,
            orientation: brief.orientation,
            durationSeconds: sceneSeconds,
            seedFrameUrl,
            isCancelled: cancelled,
          });
        } else if (engine === 'runway_turbo') {
          try {
            result = await renderSceneWithRunway({
              prompt: scene.video_prompt as string,
              orientation: brief.orientation,
              durationSeconds: sceneSeconds,
              seedFrameUrl,
              onNote: (note) => log.update(sceneLine, `Generating scene ${i + 1} of ${renderable.length}... ${note}`),
              isCancelled: cancelled,
            });
          } catch (e) {
            if (!(e instanceof RunwayUnavailableError)) throw e;
            engine = 'omni_flash';
            announce(runwayFallbackMessage(e.reason));
            log.update(sceneLine, `Generating scene ${i + 1} of ${renderable.length}... on Omni Flash`);
            result = await renderSceneOnGoogle({
              prompt: scene.video_prompt as string,
              orientation: brief.orientation,
              durationSeconds: sceneSeconds,
              seedFrameUrl,
              model: groupAModelFor(engine),
              isCancelled: cancelled,
            });
          }
        } else {
          result = await renderSceneOnGoogle({
            prompt: scene.video_prompt as string,
            orientation: brief.orientation,
            durationSeconds: sceneSeconds,
            seedFrameUrl,
            model: groupAModelFor(engine),
            isCancelled: cancelled,
          });
        }

        scene.video_url = result.videoUrl;
        scene.engine = result.engine;
        scene.status = 'done';
        await updateScene(scene.id, { video_url: result.videoUrl, engine: result.engine, status: 'done' });
        finished.push(scene);
        log.finish(sceneLine, `Generating scene ${i + 1} of ${renderable.length}...`);

        // The seed for the next scene. A failed extraction is not fatal — the
        // next scene simply renders from its prompt alone.
        if (i < renderable.length - 1) {
          seedFrameUrl = await extractLastFrame(result.videoUrl, sceneSeconds);
        }
      } catch (e: any) {
        const message = String(e?.message || e);
        scene.status = 'failed';
        await updateScene(scene.id, { status: 'failed', error_msg: message });
        log.fail(sceneLine, `Scene ${i + 1} of ${renderable.length} failed — ${message}`);
        if (/cancelled/i.test(message)) throw e;
      }
    }

    const clips = finished.map((s) => String(s.video_url)).filter(Boolean);
    if (!clips.length) throw new Error('Every scene failed to render, so there is no film to assemble.');

    // ---------------------------------------------------------- 4. stitch ----
    const stitchLine = log.start('Stitching final video...');
    await updateProject(projectId, { status: 'stitching', stage: 'Stitching final video' });
    const finalVideoUrl = await stitchScenes(clips);
    log.finish(stitchLine, `Stitching final video... ${clips.length} scenes`);

    await updateProject(projectId, {
      final_video_url: finalVideoUrl,
      duration_seconds: clips.length * sceneSeconds,
      status: 'done',
      stage: 'Done',
      progress_log: log.lines.slice(),
      error_msg: null,
    });
    return { projectId, finalVideoUrl };
  } catch (e: any) {
    const message = String(e?.message || e);
    log.note(message, 'failed');
    if (projectId) {
      await updateProject(projectId, {
        status: 'failed',
        stage: 'Failed',
        error_msg: message,
        progress_log: log.lines.slice(),
      });
    }
    throw e;
  }
}

/** Scenes of a finished project, for the result screen. */
export function loadScenes(projectId: string): Promise<FcScene[]> {
  return listScenes(projectId);
}
