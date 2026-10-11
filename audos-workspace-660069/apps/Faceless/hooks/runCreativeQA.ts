/**
 * STAGE 13 — runCreativeQA (Stage 2 QA).
 *
 * Opus Vision, and only Opus Vision. It runs AFTER mechanical QA has passed,
 * so the thing it is looking at is known to be a complete, synced, non-black
 * film and every observation it makes is about the edit rather than the
 * encode.
 *
 * It reviews real frames pulled from the actual render, paired with the
 * narration spoken over each one. If the render adapter could not extract
 * frames, they are captured from the file in this browser and re-hosted, so
 * the review is never done against the plan instead of the output — reviewing
 * the plan would only ever tell you the plan is self-consistent.
 */

import {
  FacelessError,
  type CreativeQAIssue,
  type CreativeQAResult,
  type FilmSpec,
  type FrameRef,
} from '../types/editorial';
import { callClaude, extractJson, uploadDataUrl } from '../lib/platform';
import { FACELESS_CREATIVE_QA_PROMPT } from '../lib/editorialDirectorPrompt';

const STAGE = 'creative_qa' as const;

/** Enough coverage to judge repetition and the hook, few enough to stay inside the proxy's body ceiling. */
const MAX_FRAMES = 8;

const CATEGORIES: CreativeQAIssue['category'][] = [
  'visual_supports_narration', 'hook_strength', 'broll_overuse',
  'ai_video_overuse', 'repeated_composition', 'metaphor_too_literal',
  'match_cut_implausible', 'text_duplicates_narration', 'music_drowns_narration',
];

export interface CreativeQAInput {
  frames: FrameRef[];
  spec: FilmSpec;
  mp4Url?: string;
  onNote?: (note: string) => void;
}

export async function runCreativeQA(input: CreativeQAInput): Promise<CreativeQAResult> {
  let frames = (input.frames || []).filter((frame) => /^https?:\/\//i.test(frame.url));

  if (!frames.length && input.mp4Url) {
    input.onNote?.('The render service returned no frames — capturing them from the finished file…');
    frames = await captureFrames(input.mp4Url, input.spec);
  }
  if (!frames.length) {
    throw new FacelessError(
      'Creative QA needs frames from the finished film and none could be obtained, so the edit was not reviewed.',
      STAGE,
      'no_frames',
    );
  }

  const sampled = evenlySample(frames, MAX_FRAMES);
  input.onNote?.(`Opus Vision is reviewing ${sampled.length} frames from the finished cut…`);

  const content: any[] = [{ type: 'text', text: buildPlanSummary(input.spec, sampled) }];
  sampled.forEach((frame) => {
    const beat = input.spec.timeline.beats.find((candidate) => candidate.id === frame.beatId);
    content.push({
      type: 'text',
      text: `FRAME at ${frame.t.toFixed(2)}s${beat ? ` — beat ${beat.id}, narration: ${beat.narrationText}` : ''}`,
    });
    content.push({ type: 'image', source: { type: 'url', url: frame.url } });
  });

  const raw = await callClaude({
    stage: STAGE,
    model: 'claude-opus-5',
    maxTokens: 4000,
    system: FACELESS_CREATIVE_QA_PROMPT,
    messages: [{ role: 'user', content }],
  });

  return normalise(extractJson<any>(raw, STAGE), input.spec);
}

// ---------------------------------------------------------------------------

function buildPlanSummary(spec: FilmSpec, frames: FrameRef[]): string {
  const { timeline } = spec;
  const tierCounts = [1, 2, 3, 4, 5].map(
    (tier) => `T${tier}:${Object.values(spec.resolvedAssets).filter((asset) => asset.tier === tier).length}`,
  );

  const beatLines = timeline.beats.map((beat) => {
    const asset = spec.resolvedAssets[beat.id];
    const text = beat.textOverlay ? ` | text(${beat.textOverlay.type}): ${beat.textOverlay.content}` : '';
    const cut = beat.transition?.type === 'match_cut'
      ? ` | match_cut ${beat.transition.sourceElement} -> ${beat.transition.destinationElement}`
      : '';
    return `${beat.id} [${beat.narrationStart.toFixed(1)}-${beat.narrationEnd.toFixed(1)}s] ${beat.visualType}, camera ${beat.camera.type}, tier ${asset?.tier ?? 'unresolved'}, energy ${beat.soundDesign?.musicEnergy ?? '?'}\n  intent: ${beat.visualIntent}\n  narration: ${beat.narrationText}${text}${cut}`;
  });

  return [
    `FILM: ${timeline.mode} mode, ${timeline.duration.toFixed(1)}s, ${timeline.beats.length} beats, FilmSpec v${spec.version}.`,
    `CONTINUITY: ${timeline.continuityGuide.colorStory} | ${timeline.continuityGuide.visualMotif} | ${timeline.continuityGuide.cameraGrammar}`,
    `TIER MIX ACTUALLY USED: ${tierCounts.join(' ')} (target mix ${JSON.stringify(timeline.assetMixTarget)})`,
    `MUSIC ARC: ${timeline.musicArc.map((section) => `${section.section} ${section.energy}`).join(', ')}`,
    '',
    'THE PLAN, beat by beat:',
    ...beatLines,
    '',
    `${frames.length} frames from the FINISHED render follow. Judge the film, not the plan.`,
  ].join('\n');
}

/** Always keeps the first item, which is the hook — the beat with the strictest rules and the one a reviewer most needs to see. */
function evenlySample<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items;
  const step = (items.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, index) => items[Math.round(index * step)]);
}

function normalise(parsed: any, spec: FilmSpec): CreativeQAResult {
  const beatIds = new Set(spec.timeline.beats.map((beat) => beat.id));
  const issues: CreativeQAIssue[] = (Array.isArray(parsed?.issues) ? parsed.issues : [])
    .map((entry: any): CreativeQAIssue => {
      const beatId = String(entry?.beatId || '');
      return {
        beatId: beatIds.has(beatId) ? beatId : null,
        category: CATEGORIES.includes(entry?.category) ? entry.category : 'visual_supports_narration',
        severity: entry?.severity === 'blocking' ? 'blocking' : 'minor',
        issue: String(entry?.issue || '').slice(0, 400),
        fix: String(entry?.fix || '').slice(0, 400),
      };
    })
    .filter((issue: CreativeQAIssue) => issue.issue)
    .slice(0, 8);

  const blocking = issues.some((issue) => issue.severity === 'blocking');
  const score = Math.max(0, Math.min(10, Number(parsed?.score)));

  return {
    // The verdict is derived from the issues rather than taken on trust: a
    // review that lists a blocking issue and still says pass is contradicting
    // itself, and the issues are the part with evidence behind them.
    pass: !blocking,
    score: Number.isFinite(score) ? score : blocking ? 5 : 8,
    issues,
    summary: String(parsed?.summary || '').slice(0, 800) || (blocking ? 'Blocking editorial issues found.' : 'No blocking editorial issues.'),
  };
}

// ---------------------------------------------------------------------------
// Browser frame capture, used only when the render service gave us nothing
// ---------------------------------------------------------------------------

async function captureFrames(mp4Url: string, spec: FilmSpec): Promise<FrameRef[]> {
  if (typeof document === 'undefined') return [];
  const stamps = evenlySample(
    spec.motionPlan.shots.map((shot) => ({
      beatId: shot.beatId,
      t: Math.max(0.05, (shot.startFrame + shot.durationFrames / 3) / spec.motionPlan.fps),
    })),
    MAX_FRAMES,
  );

  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.preload = 'auto';
  (video as any).playsInline = true;

  const ready = await new Promise<boolean>((resolve) => {
    const guard = setTimeout(() => resolve(false), 45000);
    video.onloadedmetadata = () => {
      clearTimeout(guard);
      resolve(true);
    };
    video.onerror = () => {
      clearTimeout(guard);
      resolve(false);
    };
    video.src = mp4Url;
  });
  if (!ready) return [];

  const canvas = document.createElement('canvas');
  canvas.width = 854;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];

  const out: FrameRef[] = [];
  try {
    for (const stamp of stamps) {
      const seeked = await new Promise<boolean>((resolve) => {
        const guard = setTimeout(() => resolve(false), 6000);
        const onSeeked = () => {
          clearTimeout(guard);
          video.removeEventListener('seeked', onSeeked);
          setTimeout(() => resolve(true), 40);
        };
        video.addEventListener('seeked', onSeeked);
        try {
          video.currentTime = Math.min(stamp.t, Math.max(0, video.duration - 0.05));
        } catch {
          clearTimeout(guard);
          resolve(false);
        }
      });
      if (!seeked) continue;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      let dataUrl: string;
      try {
        dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      } catch {
        // CORS-tainted canvas: no frames can be captured at all.
        break;
      }
      try {
        const url = await uploadDataUrl(dataUrl, `faceless-qa-${spec.filmId}-${Math.round(stamp.t * 100)}.jpg`, STAGE);
        out.push({ t: stamp.t, url, beatId: stamp.beatId });
      } catch {
        break;
      }
    }
  } finally {
    try {
      video.removeAttribute('src');
      video.load();
    } catch {
      /* released */
    }
  }
  return out;
}
