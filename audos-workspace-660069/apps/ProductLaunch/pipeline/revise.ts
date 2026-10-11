// The revision pass — what happens between one critique and the next render.
//
// Deliberately narrow. The critic names specific scenes and specific fixes,
// and this step applies those and nothing else: scenes it scored well come
// back with their ids, treatments and durations untouched. A revision that is
// free to rethink the film produces a different film every iteration, the
// scores wander, and improvement_delta stops meaning anything — at which
// point the loop's stopping rule is measuring noise.

import { callModelForJson, OPUS_MODEL } from '../lib/ai-client';
import { SPEC_REVISION_SYSTEM_PROMPT } from '../prompts/concept-generation.prompt';
import { SDK_COMPONENTS } from '../sdk/component-sdk.types';
import { actionableIssues, scenesNeedingWork, type CriticOutput } from '../types/critic.types';
import type { FilmSpec } from '../types/film-spec.types';
import { assetHandles, type ProductContext } from '../types/product-context.types';
import { describeProductContext, normalizeFilmSpec } from './concepts';

function describeCritique(critic: CriticOutput): string {
  const lines: string[] = [];
  lines.push('CRITIQUE OF THE RENDER YOU ARE REVISING');
  lines.push('overall_score: ' + critic.overall_score.toFixed(2));
  lines.push('single_biggest_problem: ' + critic.single_biggest_problem);
  if (critic.director_note) lines.push('director_note: ' + critic.director_note);

  lines.push('', 'WHAT IS WORKING — do not touch these');
  lines.push(critic.what_is_working.length
    ? critic.what_is_working.map((entry) => '- ' + entry).join('\n')
    : '- nothing was called out, so change only what is named below');

  const scenes = scenesNeedingWork(critic);
  lines.push('', 'SCENES TO FIX — worst first');
  lines.push(scenes.length
    ? scenes.map((scene) => '- ' + scene.scene_id + ' (scored ' + scene.score.toFixed(2)
      + ', ' + scene.fix_priority + ', treatment '
      + (scene.treatment_achieved ? 'achieved' : 'NOT achieved') + ')\n    '
      + (scene.issues.join('\n    ') || 'no specific issue named')).join('\n')
    : '- none individually flagged');

  const issues = actionableIssues(critic);
  lines.push('', 'FILM-LEVEL FIXES');
  lines.push(issues.length
    ? issues.map((issue) => '- [' + issue.priority + '] ' + issue.dimension + '\n    finding: '
      + issue.finding + '\n    do this: ' + issue.fix_instruction).join('\n')
    : '- none at critical or high priority');

  const keep = critic.scene_assessments
    .filter((scene) => scene.fix_priority === 'none' || scene.fix_priority === 'low')
    .map((scene) => scene.scene_id);
  if (keep.length) {
    lines.push('', 'SCENES TO LEAVE EXACTLY AS THEY ARE: ' + keep.join(', '));
  }
  return lines.join('\n');
}

export interface ReviseOptions {
  iteration?: number;
  signal?: AbortSignal;
}

export async function reviseFilmSpec(
  spec: FilmSpec,
  critic: CriticOutput,
  ctx: ProductContext,
  options: ReviseOptions = {},
): Promise<FilmSpec> {
  const message = [
    'THE FILM SPEC YOU AUTHORED',
    JSON.stringify(spec, null, 2),
    '',
    describeCritique(critic),
    '',
    describeProductContext(ctx),
    '',
    'VALID SDK COMPONENT NAMES: ' + SDK_COMPONENTS.join(', '),
    'VALID ASSET HANDLES: ' + (assetHandles(ctx).join(', ') || 'none'),
    '',
    'This is revision ' + String(options.iteration || 2)
    + '. Return the complete revised FilmSpec and nothing else.',
  ].join('\n');

  const raw = await callModelForJson<unknown>(message, {
    system: SPEC_REVISION_SYSTEM_PROMPT,
    model: OPUS_MODEL,
    maxTokens: 8192,
    signal: options.signal,
  });

  const revised = normalizeFilmSpec(raw, ctx, 0);
  if (!revised) {
    throw new Error('The revision came back without usable scenes — keeping the previous cut.');
  }

  // The revision inherits its parent's identity. A model that renames the arc
  // or re-scores its own concept mid-loop makes the iteration history
  // unreadable, and the score it assigns itself is not the one that counts —
  // the critic's is.
  return {
    ...revised,
    narrative_arc: revised.narrative_arc || spec.narrative_arc,
    visual_language: revised.visual_language || spec.visual_language,
    concept_score: spec.concept_score,
    generated_at: new Date().toISOString(),
  };
}
