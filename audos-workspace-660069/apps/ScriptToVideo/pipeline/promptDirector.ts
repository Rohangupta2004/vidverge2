import { capabilityFor } from '../v2Contracts';
import type { TimecodedBeat } from './bigScenePlanner';

export interface PromptDirectorInput {
  modelId: string;
  duration: number;
  sceneIndex: number;
  anchor: string;
  beats: TimecodedBeat[];
  references: string[];
  previousFinalState?: string;
  dialogue?: Array<{ speaker: string; tone: string; line: string; start: number; end: number }>;
}
export interface PromptDirectorOutput {
  prompt: string;
  beats: TimecodedBeat[];
  references: string[];
  negative: string | null;
  notes: string[];
  why: string;
}

function beatLine(beat: TimecodedBeat, input: PromptDirectorInput): string {
  const dialogue = input.dialogue?.find((line) => line.start < beat.end && line.end > beat.start);
  const spoken = dialogue ? ` [${dialogue.speaker}: ${dialogue.tone}]: "${dialogue.line}"` : '';
  return `${beat.start}-${beat.end}s: ${input.anchor}. ${beat.text}${spoken}`;
}

export function directPrompt(input: PromptDirectorInput): PromptDirectorOutput {
  const capability = capabilityFor(input.modelId);
  if (!capability) throw new Error(`Unknown Prompt Director model: ${input.modelId}.`);
  const adapter = capability.promptFamily;
  const beats = adapter === 'kling-3' && input.beats.length > 6
    ? Array.from({ length: 6 }, (_, index) => {
        const startIndex = Math.floor(index * input.beats.length / 6);
        const endIndex = Math.floor((index + 1) * input.beats.length / 6);
        const group = input.beats.slice(startIndex, Math.max(startIndex + 1, endIndex));
        return { start: group[0].start, end: group[group.length - 1].end, text: group.map((beat) => beat.text).join(' Then ') };
      })
    : input.beats;
  const opening = input.sceneIndex > 0 && input.previousFinalState
    ? `CONTINUITY: Begin from ${input.previousFinalState}. Input: ${capability.continuityMode}.`
    : `ANCHOR: ${input.anchor}.`;
  const beatLines = beats.map((beat, index) => {
    const label = adapter === 'kling-3' ? `SHOT ${index + 1} — ` : '';
    return `${label}${beatLine(beat, input)} Framing and lens fit the emotion; one clear action; camera motion explicit; background and identity remain stable.`;
  });
  const referenceLine = input.references.length
    ? adapter === 'kling-3'
      ? `REFERENCES: ${input.references.map((reference, index) => `@image_${index + 1}=${reference}`).join('; ')}`
      : `REFERENCES: ${input.references.join('; ')}`
    : '';
  const audioLine = capability.nativeAudio ? 'AUDIO: preserve named dialogue; add only scene-appropriate ambience and restrained SFX/music.' : '';
  const negative = capability.supportsNegativePrompt ? 'identity drift, wardrobe changes, warped anatomy, unstable background, unreadable text, watermark' : null;
  const inlineAvoid = !capability.supportsNegativePrompt ? 'AVOID IN PROMPT: identity drift, wardrobe changes, warped anatomy, unstable background, unreadable text, watermark.' : '';
  const prompt = [opening, referenceLine, ...beatLines, audioLine, inlineAvoid].filter(Boolean).join('\n');
  const output: PromptDirectorOutput = {
    prompt,
    beats: beats.map((beat) => ({ ...beat })),
    references: input.references.slice(0, capability.maxReferences),
    negative,
    notes: [`${capability.label} adapter: ${adapter}.`, capability.continuityMode === 'video-reference' ? 'Carry the previous clip as video reference.' : capability.continuityMode === 'last-frame' ? 'Carry the previous clip final frame.' : 'No continuity media input.'],
    why: `${capability.label} gets one ${input.duration}s generation containing ${beats.length} timecoded beat${beats.length === 1 ? '' : 's'}; the anchor and continuity instruction reduce identity drift.`,
  };
  const errors = validatePromptDirectorOutput(output, input.duration);
  if (errors.length) throw new Error(errors.join(' '));
  return output;
}

export function validatePromptDirectorOutput(output: PromptDirectorOutput, duration: number): string[] {
  const errors: string[] = [];
  let cursor = 0;
  for (const beat of output.beats) {
    if (beat.start !== cursor || beat.end <= beat.start) errors.push(`Beat starting ${beat.start}s is not contiguous.`);
    cursor = beat.end;
    if (!output.prompt.includes(`${beat.start}-${beat.end}s:`)) errors.push(`Prompt is missing ${beat.start}-${beat.end}s timecode.`);
  }
  if (cursor !== duration) errors.push(`Prompt beats cover ${cursor}s, expected ${duration}s.`);
  if (!output.prompt.trim()) errors.push('Prompt is empty.');
  return errors;
}
