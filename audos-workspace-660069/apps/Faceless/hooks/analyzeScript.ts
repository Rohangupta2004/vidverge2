/**
 * STAGE 2 — analyzeScript.
 *
 * Receives the TIMED transcript, never raw text. Everything it returns is
 * expressed in seconds against the recorded narration, so the editorial
 * director downstream is choosing cuts against real speech rather than
 * guessing at pacing from sentence length.
 *
 * It decides three things and nothing else: where the story turns (hook /
 * body / resolution), which mode grammar the film is shot in, and how the
 * music energy should move underneath it.
 */

import {
  FacelessError,
  type FacelessMode,
  type MusicArcSection,
  type NarrativeAnalysis,
  type NarrativePurpose,
  type NarrativeSection,
  type WordTimestamp,
} from '../types/editorial';
import { callClaude, extractJson } from '../lib/platform';

const STAGE = 'analysis' as const;

const MODES: FacelessMode[] = ['documentary', 'explainer', 'news', 'business', 'story', 'educational'];

const PURPOSES: NarrativePurpose[] = [
  'hook', 'context', 'explanation', 'proof',
  'contrast', 'reveal', 'emotion', 'transition', 'cta',
];

const ANALYST_PROMPT = [
  'You are the FacelessScriptAnalyst. You receive a narration transcript that has ALREADY BEEN RECORDED, with the exact second each phrase is spoken.',
  '',
  'You do not write visuals and you do not plan shots. You produce the structural read the editorial director will cut against.',
  '',
  'Rules:',
  '- Every boundary you return is a real second in the recording. Never invent a time past the end of the narration.',
  '- Sections follow MEANING, not even spacing. A hook can be 3 seconds and a body section 22.',
  '- The hook is where the viewer decides to stay. It is almost always the first sentence or two.',
  '- The resolution is where the argument lands: the payoff, the conclusion, or the call to action.',
  '- Choose the mode from the content itself, and say why in one sentence.',
  '    documentary: real-world subject, evidence, history, scale',
  '    explainer: a mechanism or concept being unpacked',
  '    news: a recent event, a claim, a development',
  '    business: a company, a product, a market, numbers',
  '    story: a narrative with people and consequence',
  '    educational: teaching a skill or body of knowledge',
  '- The music arc must move. Give 3 to 6 sections whose energy follows narrative tension. A flat 0.7 across the film is a failure.',
  '- continuitySeed is the look the whole film will hold to: one colour story, one visual motif, one camera grammar sentence.',
  '',
  'Return ONLY this JSON object:',
  '{',
  '  "mode": one of documentary|explainer|news|business|story|educational,',
  '  "modeRationale": string,',
  '  "narrativeArc": { "hook": [start,end], "body": [start,end], "resolution": [start,end] },',
  '  "sections": [ { "label": string, "purpose": one of hook|context|explanation|proof|contrast|reveal|emotion|transition|cta, "start": number, "end": number } ],',
  '  "musicArc": [ { "section": string, "energy": number, "timeRange": [start,end] } ],',
  '  "continuitySeed": { "colorStory": string, "visualMotif": string, "cameraGrammar": string, "timePeriod": string|null, "subject": string|null, "location": string|null },',
  '  "emphasisCandidates": [ string ]',
  '}',
  '',
  'emphasisCandidates are the numbers, proper nouns and key terms a viewer should SEE as well as hear. Do not include ordinary narration phrases. Do not explain outside the JSON.',
].join('\n');

export interface AnalyzeScriptInput {
  script: string;
  wordTimestamps: WordTimestamp[];
  /** When the customer pinned a mode, the analyst is told to honour it. */
  modeHint?: FacelessMode;
  topic?: string;
}

export async function analyzeScript(input: AnalyzeScriptInput): Promise<NarrativeAnalysis> {
  const words = input.wordTimestamps || [];
  if (!words.length) {
    throw new FacelessError(
      'analyzeScript was called without word timestamps. Narration must be generated before the script is analysed.',
      STAGE,
      'no_timestamps',
    );
  }
  const duration = words[words.length - 1].end;

  const raw = await callClaude({
    stage: STAGE,
    model: 'claude-opus-5',
    maxTokens: 4000,
    system: ANALYST_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          input.topic ? `TOPIC: ${input.topic}` : '',
          `NARRATION DURATION: ${duration.toFixed(2)} seconds`,
          input.modeHint ? `THE CUSTOMER PINNED THE MODE TO: ${input.modeHint}. Use it and justify it.` : '',
          '',
          'TIMED TRANSCRIPT (each line is "start-end  text"):',
          renderTimedTranscript(words),
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ],
  });

  const parsed = extractJson<any>(raw, STAGE);
  return normalise(parsed, duration, words, input.modeHint);
}

/**
 * Phrase-level lines rather than one line per word: the model reads pacing far
 * better from grouped speech, and a 900-word script would otherwise swamp the
 * proxy's input ceiling.
 */
export function renderTimedTranscript(words: WordTimestamp[], groupSize = 9): string {
  const lines: string[] = [];
  for (let i = 0; i < words.length; i += groupSize) {
    const group = words.slice(i, i + groupSize);
    const start = group[0].start.toFixed(2);
    const end = group[group.length - 1].end.toFixed(2);
    lines.push(`${start}-${end}  ${group.map((w) => w.word).join(' ')}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Normalisation — the model is good at structure and careless about edges
// ---------------------------------------------------------------------------

function clampTime(value: unknown, duration: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(duration, Math.round(n * 1000) / 1000));
}

function normalise(
  parsed: any,
  duration: number,
  words: WordTimestamp[],
  modeHint?: FacelessMode,
): NarrativeAnalysis {
  const mode: FacelessMode =
    modeHint && MODES.includes(modeHint)
      ? modeHint
      : MODES.includes(parsed?.mode) ? parsed.mode : 'documentary';

  const arcIn = parsed?.narrativeArc || {};
  const hookEnd = clampTime(arcIn.hook?.[1], duration, Math.min(5, duration * 0.12));
  const bodyEnd = clampTime(arcIn.body?.[1], duration, Math.max(hookEnd, duration * 0.82));
  const narrativeArc = {
    hook: [0, hookEnd] as [number, number],
    body: [hookEnd, Math.max(hookEnd, bodyEnd)] as [number, number],
    resolution: [Math.max(hookEnd, bodyEnd), duration] as [number, number],
  };

  const sections: NarrativeSection[] = (Array.isArray(parsed?.sections) ? parsed.sections : [])
    .map((section: any, index: number) => {
      const start = clampTime(section?.start, duration, 0);
      const end = clampTime(section?.end, duration, duration);
      return {
        label: String(section?.label || `Section ${index + 1}`).slice(0, 80),
        purpose: PURPOSES.includes(section?.purpose) ? section.purpose : 'explanation',
        start,
        end: Math.max(start + 0.4, end),
        text: textBetween(words, start, end),
      } as NarrativeSection;
    })
    .filter((section: NarrativeSection) => section.end > section.start)
    .sort((a: NarrativeSection, b: NarrativeSection) => a.start - b.start);

  if (!sections.length) {
    sections.push(
      { label: 'Hook', purpose: 'hook', start: 0, end: narrativeArc.hook[1], text: textBetween(words, 0, narrativeArc.hook[1]) },
      { label: 'Body', purpose: 'explanation', start: narrativeArc.body[0], end: narrativeArc.body[1], text: textBetween(words, narrativeArc.body[0], narrativeArc.body[1]) },
      { label: 'Resolution', purpose: 'cta', start: narrativeArc.resolution[0], end: duration, text: textBetween(words, narrativeArc.resolution[0], duration) },
    );
  }

  return {
    mode,
    modeRationale: String(parsed?.modeRationale || 'Chosen from the subject matter of the narration.').slice(0, 400),
    duration,
    narrativeArc,
    sections,
    musicArc: normaliseMusicArc(parsed?.musicArc, duration),
    continuitySeed: {
      colorStory: String(parsed?.continuitySeed?.colorStory || 'Cool desaturated base with one warm accent').slice(0, 200),
      visualMotif: String(parsed?.continuitySeed?.visualMotif || 'A single element multiplying across the frame').slice(0, 200),
      cameraGrammar: String(parsed?.continuitySeed?.cameraGrammar || 'Slow documentary push, no handheld').slice(0, 200),
      timePeriod: optionalText(parsed?.continuitySeed?.timePeriod),
      subject: optionalText(parsed?.continuitySeed?.subject),
      location: optionalText(parsed?.continuitySeed?.location),
    },
    emphasisCandidates: (Array.isArray(parsed?.emphasisCandidates) ? parsed.emphasisCandidates : [])
      .map((item: unknown) => String(item || '').trim())
      .filter(Boolean)
      .slice(0, 24),
  };
}

function optionalText(value: unknown): string | undefined {
  const text = value == null ? '' : String(value).trim();
  return text && text.toLowerCase() !== 'null' ? text.slice(0, 160) : undefined;
}

function textBetween(words: WordTimestamp[], start: number, end: number): string {
  return words
    .filter((word) => word.end > start + 0.001 && word.start < end - 0.001)
    .map((word) => word.word)
    .join(' ')
    .trim();
}

/**
 * A music arc that does not move is the single most common way a faceless
 * video sounds like a template, so a flat or missing arc is replaced with a
 * three-act shape rather than passed through.
 */
function normaliseMusicArc(raw: unknown, duration: number): MusicArcSection[] {
  const sections: MusicArcSection[] = (Array.isArray(raw) ? raw : [])
    .map((entry: any, index: number) => {
      const start = Math.max(0, Math.min(duration, Number(entry?.timeRange?.[0]) || 0));
      const end = Math.max(start + 0.5, Math.min(duration, Number(entry?.timeRange?.[1]) || duration));
      return {
        section: String(entry?.section || `Section ${index + 1}`).slice(0, 60),
        energy: Math.max(0, Math.min(1, Number(entry?.energy))) || 0.5,
        timeRange: [start, end] as [number, number],
      };
    })
    .filter((entry: MusicArcSection) => entry.timeRange[1] > entry.timeRange[0])
    .sort((a: MusicArcSection, b: MusicArcSection) => a.timeRange[0] - b.timeRange[0]);

  const spread = sections.length
    ? Math.max(...sections.map((s) => s.energy)) - Math.min(...sections.map((s) => s.energy))
    : 0;

  if (sections.length >= 3 && spread >= 0.15) return sections;

  return [
    { section: 'Hook', energy: 0.72, timeRange: [0, Math.min(duration, duration * 0.14)] },
    { section: 'Set-up', energy: 0.34, timeRange: [duration * 0.14, duration * 0.42] },
    { section: 'Build', energy: 0.58, timeRange: [duration * 0.42, duration * 0.78] },
    { section: 'Landing', energy: 0.86, timeRange: [duration * 0.78, duration] },
  ];
}
