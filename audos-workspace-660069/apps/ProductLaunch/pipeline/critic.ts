// Step 9 — the critic.
//
// Brief-aware by construction: the sheet goes in alongside the FilmSpec that
// defined the intent and the ProductContext that defined what was available.
// A critic shown only frames can tell you a scene looks thin; a critic shown
// the brief can tell you whether the scene failed its own stated treatment,
// and a critic shown manufacture_required can tell you whether the fault is
// the execution or a concept that was never achievable. Those three verdicts
// lead to three different next moves, which is why all three inputs travel.

import {
  callModelForJson,
  imageBlock,
  OPUS_MODEL,
  textBlock,
  type ContentBlock,
} from '../lib/ai-client';
import { computeDelta } from '../lib/iteration-manager';
import { CRITIC_READING_CLAUSE, CRITIC_SYSTEM_PROMPT } from '../prompts/critic.prompt';
import {
  PRIORITIES,
  STOP_REASONS,
  type CriticOutput,
  type FilmLevelIssue,
  type Priority,
  type SceneAssessment,
  type StopReason,
} from '../types/critic.types';
import type { FilmSpec } from '../types/film-spec.types';
import type { ProductContext } from '../types/product-context.types';
import { describeProductContext } from './concepts';
import type { QAResult } from './qa';

/** Individual frames sent when the sheet could not be stitched. */
const FALLBACK_FRAME_LIMIT = 8;

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function strList(value: unknown, limit = 10): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(str).filter(Boolean).slice(0, limit);
}

function score01(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!isFinite(n)) return fallback;
  // A critic that answers on a 0-10 scale is answering the right question on
  // the wrong axis, so it is rescaled rather than rejected.
  const normalized = n > 1 && n <= 10 ? n / 10 : n;
  return Math.max(0, Math.min(1, normalized));
}

function priority(value: unknown, fallback: Priority): Priority {
  const candidate = str(value).toLowerCase() as Priority;
  return PRIORITIES.indexOf(candidate) >= 0 ? candidate : fallback;
}

/** The timeline the critic references findings against. */
function frameMap(qa: QAResult): string {
  return qa.frameNumbers
    .map((frame, index) => 'tile ' + String(index + 1) + ' = frame ' + String(frame)
      + ' (' + qa.frameTimestamps[index].toFixed(2) + 's)')
    .join(', ');
}

function describeFilmSpec(spec: FilmSpec): string {
  const lines: string[] = [];
  lines.push('FILM SPEC — what this film was supposed to be');
  lines.push('narrative_arc: ' + spec.narrative_arc);
  lines.push('visual_language: ' + spec.visual_language);
  lines.push('color_story: ' + spec.color_story);
  lines.push('typography: ' + spec.typography_system.scale + ' / ' + spec.typography_system.weight);
  lines.push('total_duration_frames: ' + String(spec.total_duration_frames) + ' at 30fps');
  lines.push('concept_rationale: ' + spec.concept_rationale);
  lines.push('risks the director already knew about: '
    + (spec.risks.join(' | ') || 'none stated'));
  lines.push('');
  lines.push('SCENES');
  let cursor = 0;
  for (const scene of spec.scenes) {
    lines.push('- ' + scene.id + ' [' + scene.role + '] frames ' + String(cursor) + '-'
      + String(cursor + scene.duration_frames)
      + '\n    intended treatment: ' + scene.visual_treatment
      + '\n    narration beat: ' + scene.narration_beat
      + (scene.narration_text ? '\n    narration line: "' + scene.narration_text + '"' : '')
      + '\n    components: ' + (scene.components.join(', ') || 'none named')
      + '\n    assets: ' + (scene.assets_needed.join(', ') || 'none')
      + '\n    motion: ' + scene.motion_intensity
      + (scene.notes ? '\n    director note: ' + scene.notes : ''));
    cursor += scene.duration_frames;
  }
  return lines.join('\n');
}

function describeAutomatedChecks(qa: QAResult): string {
  const lines: string[] = ['AUTOMATED CHECKS already run on these frames'];
  lines.push(qa.hasBlankFrames
    ? 'Blank or near-flat frames detected at: ' + qa.blankFrameNumbers.join(', ')
      + '. Confirm whether each is a deliberate hold or a scene that drew nothing.'
    : 'No blank frames detected.');
  lines.push(qa.hasTextOverflow
    ? 'Bright content touching the frame edge at: ' + qa.overflowFrameNumbers.join(', ')
      + '. Usually type outside the safe area — confirm against the tiles.'
    : 'No edge-bleeding content detected.');
  if (qa.blockedReason) {
    lines.push('Note: ' + qa.blockedReason
      + ' The individual frames are attached instead of the stitched sheet.');
  }
  return lines.join('\n');
}

function normalizeCritique(
  raw: unknown,
  spec: FilmSpec,
  previousScore: number | null,
): CriticOutput {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const knownScenes = spec.scenes.map((scene) => scene.id);

  const sceneAssessments: SceneAssessment[] = (Array.isArray(source.scene_assessments)
    ? source.scene_assessments
    : [])
    .map((entry) => {
      const item = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
      const id = str(item.scene_id);
      return {
        scene_id: knownScenes.indexOf(id) >= 0 ? id : (id || 'unknown_scene'),
        score: score01(item.score, 0.5),
        treatment_achieved: Boolean(item.treatment_achieved),
        issues: strList(item.issues, 6),
        fix_priority: priority(item.fix_priority, 'none'),
      };
    })
    .slice(0, 12);

  const filmIssues: FilmLevelIssue[] = (Array.isArray(source.film_level_issues)
    ? source.film_level_issues
    : [])
    .map((entry) => {
      const item = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
      return {
        dimension: str(item.dimension) || 'general',
        finding: str(item.finding),
        fix_instruction: str(item.fix_instruction),
        priority: priority(item.priority, 'low'),
      };
    })
    .filter((issue) => issue.finding || issue.fix_instruction)
    .slice(0, 12);

  const overall = score01(source.overall_score, 0.5);
  const delta = computeDelta(overall, previousScore);

  const stopReasonRaw = str(source.stop_reason).toLowerCase() as StopReason;
  const stopReason = STOP_REASONS.indexOf(stopReasonRaw) >= 0 ? stopReasonRaw : null;

  const hasCritical = sceneAssessments.some((scene) => scene.fix_priority === 'critical')
    || filmIssues.some((issue) => issue.priority === 'critical');

  return {
    overall_score: overall,
    // The calibration says shippable means 0.8 and nothing critical. A critic
    // that ticks shippable while reporting a critical issue is contradicting
    // itself, and the issue wins.
    shippable: Boolean(source.shippable) && overall >= 0.8 && !hasCritical,
    improvement_delta: delta,
    recommend_another_iteration: Boolean(source.recommend_another_iteration),
    stop_reason: stopReason,

    scene_assessments: sceneAssessments,
    film_level_issues: filmIssues,

    what_is_working: strList(source.what_is_working, 6),
    single_biggest_problem: str(source.single_biggest_problem)
      || (filmIssues[0]?.finding || 'The critic did not name one.'),
    director_note: str(source.director_note),
  };
}

export interface CritiqueOptions {
  iteration?: number;
  signal?: AbortSignal;
}

export async function runCritique(
  qa: QAResult,
  spec: FilmSpec,
  ctx: ProductContext,
  previousScore: number | null,
  options: CritiqueOptions = {},
): Promise<CriticOutput> {
  const blocks: ContentBlock[] = [];

  if (qa.contactSheetUrl) {
    blocks.push(imageBlock(qa.contactSheetUrl));
  } else {
    for (const url of qa.frames.slice(0, FALLBACK_FRAME_LIMIT)) blocks.push(imageBlock(url));
  }
  if (!blocks.length) throw new Error('There were no frames to critique.');

  blocks.push(textBlock([
    CRITIC_READING_CLAUSE,
    '',
    'SHEET LAYOUT: ' + String(qa.columns) + ' columns by ' + String(qa.rows) + ' rows, '
    + String(qa.frames.length) + ' tiles in time order.',
    'FRAME MAP: ' + frameMap(qa),
    '',
    describeAutomatedChecks(qa),
    '',
    describeFilmSpec(spec),
    '',
    describeProductContext(ctx),
    '',
    previousScore === null
      ? 'THIS IS THE FIRST ITERATION. Set improvement_delta to null.'
      : 'THIS IS ITERATION ' + String(options.iteration || 2)
        + '. The previous cut scored ' + previousScore.toFixed(2)
        + '. Judge this cut on its own merits; the production computes the delta.',
    '',
    'Answer with the CriticOutput JSON object and nothing else.',
  ].join('\n')));

  const raw = await callModelForJson<unknown>(blocks, {
    system: CRITIC_SYSTEM_PROMPT,
    model: OPUS_MODEL,
    maxTokens: 8192,
    thinkingBudget: 3000,
    signal: options.signal,
  });

  return normalizeCritique(raw, spec, previousScore);
}
