/**
 * STAGE 4 — createEditorialTimeline.
 *
 * Opus 5 as the editorial director. This is the stage the whole product rests
 * on: it is not generating prompts for a video model, it is deciding cuts.
 *
 * WHY THIS IS TWO KINDS OF CALL AND NOT ONE. The Claude proxy caps a response
 * at 8,192 output tokens, and Opus 5 cannot disable thinking, so those tokens
 * are shared with its reasoning. A fully-populated FacelessBeat is 250-350
 * tokens; a 90-second film is 30 beats. One call physically cannot return the
 * timeline. So the director works the way a human director does:
 *
 *   1. SPINE   — one call that sets continuity, the asset mix, and where every
 *                cut falls against the narration. Cheap, and it is the
 *                decision that makes the film feel directed by one person.
 *   2. WINDOWS — successive calls that fully populate 6 beats at a time, each
 *                one shown the continuity guide and everything already
 *                directed, so novelty rules and match cuts hold across the
 *                boundary rather than resetting at it.
 *
 * Every call carries the FacelessEditorialDirector system prompt verbatim.
 */

import {
  FacelessError,
  type AssetDecision,
  type AssetIndex,
  type AssetMixTarget,
  type AssetTier,
  type CameraType,
  type EditorialTimeline,
  type FacelessBeat,
  type NarrativeAnalysis,
  type NarrativePurpose,
  type TextTreatment,
  type TransitionType,
  type VisualType,
  type WordTimestamp,
} from '../types/editorial';
import { callClaude, extractJson } from '../lib/platform';
import { FACELESS_EDITORIAL_DIRECTOR_PROMPT } from '../lib/editorialDirectorPrompt';
import { renderTimedTranscript } from './analyzeScript';
import { wordsBetween } from './generateNarration';
import { describeIndexForDirector } from './buildAssetIndex';

const STAGE = 'editorial' as const;

const VISUAL_TYPES: VisualType[] = [
  'broll_stock', 'broll_generated', 'image_generated', 'image_archive',
  'diagram', 'chart', 'ui_screenshot', 'map', 'timeline_graphic',
  'kinetic_type', 'mixed',
];

const CAMERA_TYPES: CameraType[] = [
  'establishing_push', 'statement_punch', 'emotional_slow',
  'reveal_pullback', 'data_static', 'transition_follow',
];

const TEXT_TREATMENTS: TextTreatment[] = [
  'massive_headline', 'kinetic_phrase', 'highlighted_word',
  'number_reveal', 'quote_card', 'lower_third',
];

const TRANSITIONS: TransitionType[] = ['cut', 'match_cut', 'dissolve', 'blur_reveal', 'freeze_punch'];

const PURPOSES: NarrativePurpose[] = [
  'hook', 'context', 'explanation', 'proof',
  'contrast', 'reveal', 'emotion', 'transition', 'cta',
];

/** The camera grammar is fixed. A move outside these bounds is clamped, not honoured. */
export const CAMERA_GRAMMAR: Record<CameraType, { startScale: number; endScale: number; minMs: number; maxMs: number }> = {
  establishing_push: { startScale: 1.0, endScale: 1.06, minMs: 2000, maxMs: 4000 },
  statement_punch: { startScale: 1.0, endScale: 1.15, minMs: 266, maxMs: 466 },
  emotional_slow: { startScale: 1.0, endScale: 1.04, minMs: 2500, maxMs: 8000 },
  reveal_pullback: { startScale: 1.22, endScale: 1.0, minMs: 1500, maxMs: 5000 },
  data_static: { startScale: 1.0, endScale: 1.0, minMs: 500, maxMs: 12000 },
  transition_follow: { startScale: 1.04, endScale: 1.1, minMs: 800, maxMs: 4000 },
};

const DEFAULT_MIX: AssetMixTarget = {
  stock: 0.35, imageGenerated: 0.2, videoGenerated: 0.15,
  graphics: 0.15, ui: 0.1, typography: 0.05,
};

const WINDOW_SIZE = 6;

export interface CreateEditorialTimelineInput {
  filmId: string;
  analysis: NarrativeAnalysis;
  wordTimestamps: WordTimestamp[];
  assetIndex?: AssetIndex | null;
  topic?: string;
  onNote?: (note: string) => void;
}

interface SpineBeat {
  id: string;
  narrationStart: number;
  narrationEnd: number;
  narrativePurpose: NarrativePurpose;
  isHook: boolean;
}

export async function createEditorialTimeline(
  input: CreateEditorialTimelineInput,
): Promise<EditorialTimeline> {
  const { analysis, wordTimestamps } = input;
  const duration = analysis.duration;
  if (!(duration > 0)) {
    throw new FacelessError('The narration has no measurable duration to cut against.', STAGE, 'no_duration');
  }

  input.onNote?.('Opus 5 is laying out the cut structure…');
  const spine = await directSpine(input, duration);

  const beats: FacelessBeat[] = [];
  for (let offset = 0; offset < spine.beats.length; offset += WINDOW_SIZE) {
    const window = spine.beats.slice(offset, offset + WINDOW_SIZE);
    input.onNote?.(
      `Opus 5 is directing beats ${offset + 1}–${offset + window.length} of ${spine.beats.length}…`,
    );
    const directed = await directWindow(input, spine, window, beats, duration);
    beats.push(...directed);
  }

  const timeline: EditorialTimeline = {
    filmId: input.filmId,
    mode: analysis.mode,
    duration,
    narrativeArc: analysis.narrativeArc,
    musicArc: analysis.musicArc,
    continuityGuide: spine.continuityGuide,
    assetMixTarget: spine.assetMixTarget,
    beats,
  };

  return enforceTimelineInvariants(timeline, wordTimestamps);
}

// ---------------------------------------------------------------------------
// Pass 1 — the spine
// ---------------------------------------------------------------------------

/**
 * A faceless edit changes picture roughly every 2.5–4 seconds. The director is
 * free to move any individual boundary; this only sets how many it is asked
 * for, so a 20-second short does not come back with 3 shots and a 3-minute
 * film does not come back with 90.
 */
export function targetBeatCount(duration: number): number {
  return Math.max(4, Math.min(44, Math.round(duration / 3.1)));
}

async function directSpine(
  input: CreateEditorialTimelineInput,
  duration: number,
): Promise<{ beats: SpineBeat[]; continuityGuide: EditorialTimeline['continuityGuide']; assetMixTarget: AssetMixTarget }> {
  const { analysis } = input;
  const target = targetBeatCount(duration);

  const user = [
    'TASK: produce the SPINE of the EditorialTimeline only. Do not write visuals yet.',
    '',
    `MODE: ${analysis.mode} — ${analysis.modeRationale}`,
    `DURATION: ${duration.toFixed(2)}s`,
    `NARRATIVE ARC: hook ${fmtRange(analysis.narrativeArc.hook)}, body ${fmtRange(analysis.narrativeArc.body)}, resolution ${fmtRange(analysis.narrativeArc.resolution)}`,
    `MUSIC ARC: ${analysis.musicArc.map((s) => `${s.section} ${s.energy} ${fmtRange(s.timeRange)}`).join(' | ')}`,
    `SEED CONTINUITY: colour '${analysis.continuitySeed.colorStory}', motif '${analysis.continuitySeed.visualMotif}', camera '${analysis.continuitySeed.cameraGrammar}'`,
    analysis.continuitySeed.subject ? `SUBJECT: ${analysis.continuitySeed.subject}` : '',
    '',
    input.assetIndex ? describeIndexForDirector(input.assetIndex) : '',
    '',
    'TIMED TRANSCRIPT:',
    renderTimedTranscript(input.wordTimestamps),
    '',
    `Return approximately ${target} beats. Place every boundary on a real speech boundary from the transcript — never mid-phrase, never on an even time interval. Beat 0 starts at 0 and the last beat ends at ${duration.toFixed(2)}.`,
    '',
    'Return ONLY this JSON:',
    '{',
    '  "continuityGuide": { "colorStory": string, "visualMotif": string, "cameraGrammar": string, "timePeriod": string|null, "subject": string|null, "location": string|null },',
    '  "assetMixTarget": { "stock": number, "imageGenerated": number, "videoGenerated": number, "graphics": number, "ui": number, "typography": number },',
    '  "beats": [ { "id": string, "narrationStart": number, "narrationEnd": number, "narrativePurpose": string, "isHook": boolean } ]',
    '}',
    '',
    'assetMixTarget values are fractions that sum to 1 and should sit near the 35/20/15/15/10/5 shape unless the mode grammar demands otherwise.',
  ]
    .filter(Boolean)
    .join('\n');

  const raw = await callClaude({
    stage: STAGE,
    model: 'claude-opus-5',
    maxTokens: 8192,
    system: FACELESS_EDITORIAL_DIRECTOR_PROMPT,
    messages: [{ role: 'user', content: user }],
  });
  const parsed = extractJson<any>(raw, STAGE);

  const beats = normaliseSpine(parsed?.beats, duration, target);
  return {
    beats,
    continuityGuide: {
      colorStory: str(parsed?.continuityGuide?.colorStory, analysis.continuitySeed.colorStory, 200),
      visualMotif: str(parsed?.continuityGuide?.visualMotif, analysis.continuitySeed.visualMotif, 200),
      cameraGrammar: str(parsed?.continuityGuide?.cameraGrammar, analysis.continuitySeed.cameraGrammar, 200),
      timePeriod: optional(parsed?.continuityGuide?.timePeriod) || analysis.continuitySeed.timePeriod,
      subject: optional(parsed?.continuityGuide?.subject) || analysis.continuitySeed.subject,
      location: optional(parsed?.continuityGuide?.location) || analysis.continuitySeed.location,
    },
    assetMixTarget: normaliseMix(parsed?.assetMixTarget),
  };
}

function normaliseSpine(raw: unknown, duration: number, target: number): SpineBeat[] {
  const entries = (Array.isArray(raw) ? raw : [])
    .map((entry: any, index: number) => ({
      id: String(entry?.id || `b${index}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || `b${index}`,
      narrationStart: Number(entry?.narrationStart),
      narrationEnd: Number(entry?.narrationEnd),
      narrativePurpose: PURPOSES.includes(entry?.narrativePurpose) ? entry.narrativePurpose : 'explanation',
      isHook: Boolean(entry?.isHook),
    }))
    .filter((entry) => Number.isFinite(entry.narrationStart) && Number.isFinite(entry.narrationEnd))
    .sort((a, b) => a.narrationStart - b.narrationStart);

  const beats = entries.length ? entries : evenSpine(duration, target);

  // Beats must tile [0, duration] exactly: a gap is a black frame and an
  // overlap is two shots fighting for the same second of narration.
  const out: SpineBeat[] = [];
  let cursor = 0;
  for (let i = 0; i < beats.length; i += 1) {
    const isLast = i === beats.length - 1;
    const end = isLast ? duration : Math.min(duration, Math.max(cursor + 0.6, beats[i].narrationEnd));
    if (end <= cursor + 0.2 && !isLast) continue;
    out.push({
      id: uniqueId(beats[i].id, out),
      narrationStart: round3(cursor),
      narrationEnd: round3(end),
      narrativePurpose: i === 0 ? 'hook' : beats[i].narrativePurpose,
      isHook: i === 0,
    });
    cursor = end;
    if (cursor >= duration - 0.05) break;
  }
  if (out.length && out[out.length - 1].narrationEnd < duration) {
    out[out.length - 1].narrationEnd = round3(duration);
  }
  return out.length ? out : evenSpine(duration, target);
}

function evenSpine(duration: number, target: number): SpineBeat[] {
  const span = duration / target;
  return Array.from({ length: target }, (_, index) => ({
    id: `b${index}`,
    narrationStart: round3(index * span),
    narrationEnd: round3(index === target - 1 ? duration : (index + 1) * span),
    narrativePurpose: (index === 0 ? 'hook' : index === target - 1 ? 'cta' : 'explanation') as NarrativePurpose,
    isHook: index === 0,
  }));
}

function uniqueId(candidate: string, existing: { id: string }[]): string {
  let id = candidate;
  let suffix = 2;
  while (existing.some((entry) => entry.id === id)) {
    id = `${candidate}_${suffix}`;
    suffix += 1;
  }
  return id;
}

// ---------------------------------------------------------------------------
// Pass 2 — directing a window of beats
// ---------------------------------------------------------------------------

async function directWindow(
  input: CreateEditorialTimelineInput,
  spine: { continuityGuide: EditorialTimeline['continuityGuide']; assetMixTarget: AssetMixTarget; beats: SpineBeat[] },
  window: SpineBeat[],
  alreadyDirected: FacelessBeat[],
  duration: number,
): Promise<FacelessBeat[]> {
  const { analysis, wordTimestamps } = input;
  const pendingMatchCut = lastPendingMatchCut(alreadyDirected);
  const guide = spine.continuityGuide;

  const user = [
    `TASK: fully populate beats ${window[0].id} to ${window[window.length - 1].id} of this film. Return those beats and no others.`,
    '',
    `MODE: ${analysis.mode}`,
    `CONTINUITY (hold to this exactly): colour '${guide.colorStory}' | motif '${guide.visualMotif}' | camera '${guide.cameraGrammar}'${guide.subject ? ` | subject '${guide.subject}'` : ''}`,
    `ASSET MIX TARGET across the whole film: ${JSON.stringify(spine.assetMixTarget)}`,
    `TIER MIX SO FAR: ${describeTierMix(alreadyDirected)}`,
    `VISUAL TYPES SO FAR (oldest to newest): ${alreadyDirected.slice(-8).map((b) => b.visualType).join(' → ') || 'none yet'}`,
    pendingMatchCut
      ? `MATCH CUT OWED: beat ${pendingMatchCut.id} ends on a match_cut from '${pendingMatchCut.transition?.sourceElement}' to '${pendingMatchCut.transition?.destinationElement}'. The FIRST beat you return must open on that destination element, and its assetDecision.matchCutDependencyBeatId must be ${pendingMatchCut.id}.`
      : '',
    '',
    input.assetIndex ? describeIndexForDirector(input.assetIndex, 14) : '',
    '',
    'BEATS TO DIRECT (narration is fixed — do not change these times or this text):',
    window.map((beat) => describeSpineBeat(beat, wordTimestamps)).join('\n'),
    '',
    analysis.emphasisCandidates.length
      ? `TERMS WORTH SHOWING AS TEXT (only where the narration does not already carry them): ${analysis.emphasisCandidates.join(', ')}`
      : '',
    `MUSIC ENERGY GUIDE: ${analysis.musicArc.map((s) => `${fmtRange(s.timeRange)} → ${s.energy}`).join('  ')}`,
    '',
    'Return ONLY this JSON:',
    '{ "beats": [ { "id": string, "visualIntent": string, "visualType": string, "emphasisWords": [string], "assetDecision": { "tier": 1|2|3|4|5, "rationale": string, "searchQuery": string|null, "generationPrompt": string|null, "matchCutDependencyBeatId": string|null }, "camera": { "type": string, "startScale": number, "endScale": number, "durationMs": number }, "textOverlay": { "type": string, "content": string, "offsetMs": number }|null, "transition": { "type": string, "sourceElement": string|null, "destinationElement": string|null }|null, "soundDesign": { "sfx": [ { "description": string, "offsetMs": number } ], "musicEnergy": number }|null } ] }',
    '',
    'The rules failed most often: state the visual METAPHOR in visualIntent rather than a literal scene; text only when it adds information the narration does not carry; no more than 4 consecutive beats of one visualType; tier 5 only when motion itself carries the meaning.',
  ]
    .filter(Boolean)
    .join('\n');

  const raw = await callClaude({
    stage: STAGE,
    model: 'claude-opus-5',
    maxTokens: 8192,
    system: FACELESS_EDITORIAL_DIRECTOR_PROMPT,
    messages: [{ role: 'user', content: user }],
  });
  const parsed = extractJson<any>(raw, STAGE);
  const directed = Array.isArray(parsed?.beats) ? parsed.beats : [];

  return window.map((spineBeat, index) => {
    const match = directed.find((entry: any) => String(entry?.id) === spineBeat.id) || directed[index] || {};
    return normaliseBeat(match, spineBeat, wordTimestamps, duration, analysis);
  });
}

function describeSpineBeat(beat: SpineBeat, words: WordTimestamp[]): string {
  const header = `- id ${beat.id} | ${beat.narrationStart.toFixed(2)}s–${beat.narrationEnd.toFixed(2)}s | purpose ${beat.narrativePurpose}${beat.isHook ? ' | THIS IS THE HOOK BEAT' : ''}`;
  const spoken = wordsBetween(words, beat.narrationStart, beat.narrationEnd);
  return `${header}\n  spoken: ${spoken}`;
}

function lastPendingMatchCut(beats: FacelessBeat[]): FacelessBeat | null {
  const last = beats[beats.length - 1];
  return last && last.transition?.type === 'match_cut' ? last : null;
}

function describeTierMix(beats: FacelessBeat[]): string {
  if (!beats.length) return 'nothing directed yet';
  return [1, 2, 3, 4, 5]
    .map((tier) => `T${tier}:${beats.filter((b) => b.assetDecision.tier === tier).length}`)
    .join(' ');
}

// ---------------------------------------------------------------------------
// Beat normalisation — the grammar is enforced here, not hoped for
// ---------------------------------------------------------------------------

function normaliseBeat(
  raw: any,
  spine: SpineBeat,
  words: WordTimestamp[],
  duration: number,
  analysis: NarrativeAnalysis,
): FacelessBeat {
  const beatMs = Math.max(200, (spine.narrationEnd - spine.narrationStart) * 1000);

  let visualType: VisualType = VISUAL_TYPES.includes(raw?.visualType) ? raw.visualType : 'image_generated';
  let cameraType: CameraType = CAMERA_TYPES.includes(raw?.camera?.type) ? raw.camera.type : 'establishing_push';

  // Cardinal rule 8: the hook has no discretion.
  if (spine.isHook) {
    if (cameraType !== 'statement_punch' && cameraType !== 'reveal_pullback') cameraType = 'statement_punch';
    if (visualType === 'broll_stock') visualType = 'broll_generated';
  }

  const grammar = CAMERA_GRAMMAR[cameraType];
  const requestedMs = Number(raw?.camera?.durationMs);
  const camera = {
    type: cameraType,
    startScale: grammar.startScale,
    endScale: grammar.endScale,
    durationMs: Math.round(
      Math.min(beatMs, Math.max(grammar.minMs, Math.min(grammar.maxMs, Number.isFinite(requestedMs) ? requestedMs : grammar.maxMs))),
    ),
  };

  const assetDecision = normaliseAssetDecision(raw?.assetDecision, visualType);
  const narrationText = wordsBetween(words, spine.narrationStart, spine.narrationEnd);

  return {
    id: spine.id,
    narrationStart: spine.narrationStart,
    narrationEnd: spine.narrationEnd,
    narrationText,
    narrativePurpose: spine.narrativePurpose,
    isHook: spine.isHook,
    visualIntent: str(raw?.visualIntent, `${analysis.continuitySeed.visualMotif} — ${narrationText.slice(0, 60)}`, 400),
    visualType,
    emphasisWords: (Array.isArray(raw?.emphasisWords) ? raw.emphasisWords : [])
      .map((w: unknown) => String(w || '').trim())
      .filter(Boolean)
      .slice(0, 6),
    assetDecision,
    camera,
    textOverlay: normaliseTextOverlay(raw?.textOverlay, narrationText, beatMs, spine.isHook),
    transition: normaliseTransition(raw?.transition, spine.narrationEnd >= duration - 0.01),
    soundDesign: normaliseSoundDesign(raw?.soundDesign, analysis, spine),
  };
}

function normaliseAssetDecision(raw: any, visualType: VisualType): AssetDecision {
  const tierRaw = Number(raw?.tier);
  const tier: AssetTier = ([1, 2, 3, 4, 5].includes(tierRaw) ? tierRaw : defaultTierFor(visualType)) as AssetTier;
  return {
    tier,
    rationale: str(raw?.rationale, 'No rationale supplied by the director.', 300),
    searchQuery: tier <= 3 ? optional(raw?.searchQuery) : undefined,
    generationPrompt: tier >= 4 ? optional(raw?.generationPrompt) : undefined,
    matchCutDependencyBeatId: optional(raw?.matchCutDependencyBeatId),
  };
}

/** Graphics and typography are drawn, not bought — they never need a tier 5. */
function defaultTierFor(visualType: VisualType): AssetTier {
  if (visualType === 'kinetic_type' || visualType === 'diagram' || visualType === 'chart' || visualType === 'timeline_graphic') return 4;
  if (visualType === 'broll_stock' || visualType === 'image_archive') return 2;
  if (visualType === 'ui_screenshot') return 3;
  return 4;
}

/**
 * Cardinal rule 5. A text overlay whose words are already in the narration is
 * a caption, and captions are not allowed, so it is dropped rather than shown.
 */
function normaliseTextOverlay(
  raw: any,
  narrationText: string,
  beatMs: number,
  isHook: boolean,
): FacelessBeat['textOverlay'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const content = String(raw.content || '').trim();
  if (!content) return undefined;
  if (duplicatesNarration(content, narrationText)) return undefined;

  const type: TextTreatment = TEXT_TREATMENTS.includes(raw.type) ? raw.type : 'kinetic_phrase';
  // Hook rule: text has to be on screen inside the first 1500ms.
  const requested = Number(raw.offsetMs);
  const offsetMs = isHook
    ? Math.min(1200, Number.isFinite(requested) ? Math.max(0, requested) : 400)
    : Math.max(0, Math.min(Math.max(0, beatMs - 300), Number.isFinite(requested) ? requested : 300));

  return { type, content: content.slice(0, 120), offsetMs: Math.round(offsetMs) };
}

export function duplicatesNarration(text: string, narration: string): boolean {
  const flatten = (value: string) => value.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const overlay = flatten(text);
  const spoken = flatten(narration);
  if (!overlay || !spoken) return false;
  if (spoken.includes(overlay)) return true;
  const overlayWords = overlay.split(' ').filter((w) => w.length > 2);
  if (overlayWords.length < 3) return false;
  const shared = overlayWords.filter((word) => spoken.includes(word)).length;
  return shared / overlayWords.length >= 0.8;
}

function normaliseTransition(raw: any, isLastBeat: boolean): FacelessBeat['transition'] {
  if (isLastBeat) return undefined;
  if (!raw || typeof raw !== 'object') return { type: 'cut' };
  const type: TransitionType = TRANSITIONS.includes(raw.type) ? raw.type : 'cut';
  if (type !== 'match_cut') return { type };
  const sourceElement = optional(raw.sourceElement);
  const destinationElement = optional(raw.destinationElement);
  // A match cut without both halves named is not a match cut; it is a cut.
  if (!sourceElement || !destinationElement) return { type: 'cut' };
  return { type, sourceElement, destinationElement };
}

function normaliseSoundDesign(
  raw: any,
  analysis: NarrativeAnalysis,
  spine: SpineBeat,
): FacelessBeat['soundDesign'] {
  const fromArc = energyAt(analysis, (spine.narrationStart + spine.narrationEnd) / 2);
  const energyRaw = Number(raw?.musicEnergy);
  const musicEnergy = Number.isFinite(energyRaw) ? Math.max(0, Math.min(1, energyRaw)) : fromArc;
  const sfx = (Array.isArray(raw?.sfx) ? raw.sfx : [])
    .map((entry: any) => ({
      description: String(entry?.description || '').trim().slice(0, 160),
      offsetMs: Math.max(0, Math.round(Number(entry?.offsetMs) || 0)),
    }))
    .filter((entry: { description: string }) => entry.description)
    // Cardinal rule 10: SFX when something happens, not on every transition.
    .slice(0, 2);
  return { sfx, musicEnergy };
}

export function energyAt(analysis: NarrativeAnalysis, seconds: number): number {
  const section = analysis.musicArc.find((s) => seconds >= s.timeRange[0] && seconds < s.timeRange[1]);
  return section ? section.energy : 0.5;
}

// ---------------------------------------------------------------------------
// Whole-timeline invariants
// ---------------------------------------------------------------------------

/**
 * Cross-window rules the director cannot enforce from inside a single window:
 * exactly one hook, a match cut always carrying its dependency forward onto
 * the next beat, and no run of more than four identical visual types.
 */
export function enforceTimelineInvariants(
  timeline: EditorialTimeline,
  words: WordTimestamp[],
): EditorialTimeline {
  const beats = timeline.beats.map((beat) => ({ ...beat }));
  if (!beats.length) {
    throw new FacelessError('The editorial director returned no beats.', STAGE, 'no_beats');
  }

  beats.forEach((beat, index) => {
    beat.isHook = index === 0;
    if (!beat.narrationText) {
      beat.narrationText = wordsBetween(words, beat.narrationStart, beat.narrationEnd);
    }

    // Rule 7: the beat AFTER a match cut owes the dependency, not the beat before.
    const previous = beats[index - 1];
    if (previous && previous.transition?.type === 'match_cut') {
      beat.assetDecision = { ...beat.assetDecision, matchCutDependencyBeatId: previous.id };
    } else if (beat.assetDecision.matchCutDependencyBeatId) {
      const target = beat.assetDecision.matchCutDependencyBeatId;
      const valid = beats.some((candidate, i) => candidate.id === target && i < index);
      if (!valid) beat.assetDecision = { ...beat.assetDecision, matchCutDependencyBeatId: undefined };
    }
  });

  // Rule 6: break any run of five or more identical visual types.
  let runType = beats[0].visualType;
  let runLength = 1;
  for (let i = 1; i < beats.length; i += 1) {
    if (beats[i].visualType === runType) {
      runLength += 1;
      if (runLength > 4) {
        beats[i].visualType = deviateFrom(runType, timeline.mode);
        runType = beats[i].visualType;
        runLength = 1;
      }
    } else {
      runType = beats[i].visualType;
      runLength = 1;
    }
  }

  return { ...timeline, beats };
}

/** The replacement is chosen by mode grammar, so a forced switch still fits the film. */
export function deviateFrom(current: VisualType, mode: EditorialTimeline['mode']): VisualType {
  const byMode: Record<EditorialTimeline['mode'], VisualType[]> = {
    documentary: ['map', 'image_archive', 'chart', 'timeline_graphic', 'broll_stock'],
    explainer: ['diagram', 'kinetic_type', 'chart', 'image_generated'],
    news: ['ui_screenshot', 'chart', 'kinetic_type', 'image_archive'],
    business: ['ui_screenshot', 'chart', 'diagram', 'kinetic_type'],
    story: ['image_generated', 'broll_generated', 'kinetic_type', 'image_archive'],
    educational: ['diagram', 'timeline_graphic', 'chart', 'kinetic_type'],
  };
  const options = byMode[mode] || ['diagram', 'kinetic_type', 'chart'];
  return options.find((option) => option !== current) || 'kinetic_type';
}

// ---------------------------------------------------------------------------

function fmtRange(range: [number, number]): string {
  return `${range[0].toFixed(1)}–${range[1].toFixed(1)}s`;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function str(value: unknown, fallback: string, max: number): string {
  const text = value == null ? '' : String(value).trim();
  return (text || fallback).slice(0, max);
}

function optional(value: unknown): string | undefined {
  const text = value == null ? '' : String(value).trim();
  return text && text.toLowerCase() !== 'null' ? text.slice(0, 400) : undefined;
}

function normaliseMix(raw: any): AssetMixTarget {
  if (!raw || typeof raw !== 'object') return DEFAULT_MIX;
  const keys: (keyof AssetMixTarget)[] = ['stock', 'imageGenerated', 'videoGenerated', 'graphics', 'ui', 'typography'];
  const values = keys.map((key) => Math.max(0, Number(raw[key]) || 0));
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return DEFAULT_MIX;
  const mix = {} as AssetMixTarget;
  keys.forEach((key, index) => {
    mix[key] = Math.round((values[index] / total) * 1000) / 1000;
  });
  return mix;
}
