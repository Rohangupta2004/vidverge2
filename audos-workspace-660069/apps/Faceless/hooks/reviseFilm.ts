/**
 * STAGE 14 — reviseFilm.
 *
 * TARGETED. It patches the beats creative QA named and nothing else, which is
 * what makes a revision affordable: every unaffected beat keeps the asset it
 * already paid for, and only beats whose visual actually changed are
 * re-sourced. A "revision" that regenerates the film is not a revision, it is
 * a second film.
 *
 * It produces FilmSpec v(n+1). The previous spec is left untouched so the two
 * versions can be compared, and the orchestrator — not this function — owns
 * the hard ceiling of two revision passes across the whole pipeline.
 */

import type {
  CreativeQAResult,
  EditorialTimeline,
  FacelessBeat,
  FilmSpec,
  ResolvedAsset,
} from '../types/editorial';
import { callClaude, extractJson } from '../lib/platform';
import { FACELESS_REVISION_PROMPT } from '../lib/editorialDirectorPrompt';
import { enforceTimelineInvariants } from './createEditorialTimeline';
import { generateImageAsset, styleSuffixFrom } from './generateImage';
import { prepareAllAssets } from './prepareAssets';
import { createMotionPlan } from './createMotionPlan';
import { compileFilmSpec } from './compileFilmSpec';

const STAGE = 'revision' as const;

export interface ReviseFilmInput {
  spec: FilmSpec;
  qaResult: CreativeQAResult;
  onNote?: (note: string) => void;
}

export async function reviseFilm(input: ReviseFilmInput): Promise<FilmSpec> {
  const { spec, qaResult } = input;

  const targetIds = Array.from(
    new Set(qaResult.issues.filter((issue) => issue.beatId).map((issue) => String(issue.beatId))),
  );
  const filmWideIssues = qaResult.issues.filter((issue) => !issue.beatId);

  if (!targetIds.length && !filmWideIssues.length) return spec;

  input.onNote?.(`Revising ${targetIds.length} beat(s) Opus flagged — everything else keeps its existing asset.`);

  const patched = await requestPatches(spec, qaResult, targetIds);
  const timeline = applyPatches(spec.timeline, patched);

  // Only beats whose visual actually changed are re-sourced. A camera or text
  // fix costs nothing but a re-render.
  const resolvedAssets: Record<string, ResolvedAsset> = { ...spec.resolvedAssets };
  const styleSuffix = styleSuffixFrom(timeline.continuityGuide);
  const resourced: string[] = [];

  for (const beatId of targetIds) {
    const before = spec.timeline.beats.find((beat) => beat.id === beatId);
    const after = timeline.beats.find((beat) => beat.id === beatId);
    if (!before || !after) continue;
    if (!visualChanged(before, after)) continue;

    try {
      resolvedAssets[beatId] = await generateImageAsset(
        beatId,
        after.assetDecision.generationPrompt || after.visualIntent,
        { styleSuffix },
      );
      resourced.push(beatId);
    } catch {
      // Keep the old asset rather than leaving the beat empty: a slightly
      // wrong shot beats a branded placeholder in a film that already exists.
    }
  }

  const preparedAssets = prepareAllAssets(timeline.beats, resolvedAssets);
  const motionPlan = createMotionPlan({
    timeline,
    preparedAssets,
    musicUrl: spec.motionPlan.music?.url || null,
    sfx: spec.motionPlan.sfx.map((cue) => ({
      beatId: '',
      description: cue.description,
      offsetMs: Math.round((cue.startFrame / spec.motionPlan.fps) * 1000),
      url: cue.url,
    })),
  });

  const notes = [
    `Patched beats: ${targetIds.join(', ') || 'none'}.`,
    resourced.length ? `Re-sourced assets for: ${resourced.join(', ')}.` : 'No asset was re-generated; the fixes were camera, text and intent only.',
    ...filmWideIssues.map((issue) => `Film-wide note carried forward: ${issue.issue}`),
  ];

  return compileFilmSpec({
    timeline,
    motionPlan,
    resolvedAssets,
    narrationUrl: spec.narrationUrl,
    narrationTimestamps: [...spec.narrationTimestamps],
    previous: spec,
    revisionNotes: notes,
  });
}

async function requestPatches(
  spec: FilmSpec,
  qaResult: CreativeQAResult,
  targetIds: string[],
): Promise<Record<string, any>> {
  if (!targetIds.length) return {};

  const beats = spec.timeline.beats.filter((beat) => targetIds.includes(beat.id));
  const guide = spec.timeline.continuityGuide;

  const user = [
    `MODE: ${spec.timeline.mode}`,
    `CONTINUITY (unchangeable): colour '${guide.colorStory}' | motif '${guide.visualMotif}' | camera '${guide.cameraGrammar}'`,
    '',
    'REVIEW VERDICT:',
    qaResult.summary,
    '',
    'ISSUES TO FIX:',
    ...qaResult.issues
      .filter((issue) => issue.beatId)
      .map((issue) => `- ${issue.beatId} [${issue.category}, ${issue.severity}]: ${issue.issue}\n  suggested fix: ${issue.fix}`),
    '',
    'THE BEATS AS THEY STAND:',
    JSON.stringify(beats, null, 1).slice(0, 60000),
  ].join('\n');

  const raw = await callClaude({
    stage: STAGE,
    model: 'claude-opus-5',
    maxTokens: 8192,
    system: FACELESS_REVISION_PROMPT,
    messages: [{ role: 'user', content: user }],
  });
  const parsed = extractJson<any>(raw, STAGE);

  const byId: Record<string, any> = {};
  (Array.isArray(parsed?.beats) ? parsed.beats : []).forEach((beat: any) => {
    const id = String(beat?.id || '');
    if (targetIds.includes(id)) byId[id] = beat;
  });
  return byId;
}

/**
 * The narration anchor is never taken from the model. The audio is already
 * recorded; moving a beat's start or its spoken text would desync the film
 * from the one thing that cannot be re-cut.
 */
function applyPatches(timeline: EditorialTimeline, patches: Record<string, any>): EditorialTimeline {
  const beats = timeline.beats.map((beat) => {
    const patch = patches[beat.id];
    if (!patch) return beat;
    return {
      ...beat,
      visualIntent: text(patch.visualIntent, beat.visualIntent, 400),
      visualType: patch.visualType || beat.visualType,
      emphasisWords: Array.isArray(patch.emphasisWords)
        ? patch.emphasisWords.map((word: unknown) => String(word)).slice(0, 6)
        : beat.emphasisWords,
      assetDecision: patch.assetDecision
        ? {
            ...beat.assetDecision,
            // A revision may never escalate to AI video: it is the most
            // expensive call in the pipeline and this is the second pass.
            tier: Math.min(4, Number(patch.assetDecision.tier) || beat.assetDecision.tier) as FacelessBeat['assetDecision']['tier'],
            rationale: text(patch.assetDecision.rationale, beat.assetDecision.rationale, 300),
            generationPrompt: text(patch.assetDecision.generationPrompt, beat.assetDecision.generationPrompt || '', 900) || undefined,
            searchQuery: text(patch.assetDecision.searchQuery, beat.assetDecision.searchQuery || '', 200) || undefined,
          }
        : beat.assetDecision,
      camera: patch.camera ? { ...beat.camera, ...sanitiseCamera(patch.camera, beat) } : beat.camera,
      textOverlay: patch.textOverlay === null ? undefined : patch.textOverlay ? { ...beat.textOverlay, ...patch.textOverlay } : beat.textOverlay,
      transition: patch.transition === null ? undefined : patch.transition || beat.transition,
      soundDesign: patch.soundDesign || beat.soundDesign,
      // Fixed, always.
      narrationStart: beat.narrationStart,
      narrationEnd: beat.narrationEnd,
      narrationText: beat.narrationText,
      isHook: beat.isHook,
    } as FacelessBeat;
  });

  return enforceTimelineInvariants({ ...timeline, beats }, []);
}

function sanitiseCamera(patch: any, beat: FacelessBeat): Partial<FacelessBeat['camera']> {
  const out: Partial<FacelessBeat['camera']> = {};
  if (patch.type) out.type = patch.type;
  if (Number.isFinite(Number(patch.startScale))) out.startScale = Number(patch.startScale);
  if (Number.isFinite(Number(patch.endScale))) out.endScale = Number(patch.endScale);
  const ms = Number(patch.durationMs);
  if (Number.isFinite(ms)) {
    out.durationMs = Math.max(200, Math.min((beat.narrationEnd - beat.narrationStart) * 1000, ms));
  }
  return out;
}

function visualChanged(before: FacelessBeat, after: FacelessBeat): boolean {
  return (
    before.visualType !== after.visualType ||
    before.visualIntent !== after.visualIntent ||
    before.assetDecision.generationPrompt !== after.assetDecision.generationPrompt
  );
}

function text(value: unknown, fallback: string, max: number): string {
  const out = value == null ? '' : String(value).trim();
  return (out || fallback).slice(0, max);
}
