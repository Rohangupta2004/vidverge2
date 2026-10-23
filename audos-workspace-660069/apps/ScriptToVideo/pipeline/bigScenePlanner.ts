import { capabilityFor, type VideoCapability } from '../v2Contracts';

export type ContinuityInput = 'video-reference' | 'last-frame' | 'none';
export interface TimecodedBeat { start: number; end: number; text: string }
export interface BigScenePlan {
  index: number;
  start: number;
  end: number;
  duration: number;
  beats: TimecodedBeat[];
  continuityInput: ContinuityInput;
  attachCharacterReferences: true;
}

function sentences(script: string): string[] {
  const clean = String(script || '').replace(/\s+/g, ' ').trim();
  if (!clean) return ['Hold the approved subject and visual direction.'];
  return (clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [clean]).map((part) => part.trim()).filter(Boolean);
}

function legalDurations(total: number, capability: VideoCapability, preferred?: number): number[] {
  const max = Math.min(capability.maxDurationSec, preferred && preferred > 0 ? Math.round(preferred) : capability.maxDurationSec);
  const min = capability.minDurationSec;
  const allowed = capability.supportedDurations?.slice().sort((a, b) => b - a) || null;
  const memo = new Map<number, number[] | null>();
  const solve = (remaining: number): number[] | null => {
    if (remaining === 0) return [];
    if (remaining < min) return null;
    if (memo.has(remaining)) return memo.get(remaining)!;
    const choices = allowed
      ? allowed.filter((value) => value <= max && value <= remaining)
      : Array.from({ length: Math.max(0, max - min + 1) }, (_, index) => max - index).filter((value) => value <= remaining);
    for (const value of choices) {
      const rest = solve(remaining - value);
      if (rest) { const answer = [value, ...rest]; memo.set(remaining, answer); return answer; }
    }
    memo.set(remaining, null);
    return null;
  };
  const result = solve(total);
  if (!result) throw new Error(`${capability.label} cannot represent exactly ${total}s with its legal ${allowed ? allowed.join('/') : `${min}–${max}`}s clip lengths.`);
  return result;
}

function distributeBeats(duration: number, source: string[], cursor: { value: number }): TimecodedBeat[] {
  const target = Math.max(1, Math.min(source.length, Math.ceil(duration / 5)));
  const selected = Array.from({ length: target }, () => source[cursor.value++ % source.length]);
  const base = Math.floor(duration / target);
  let remainder = duration - base * target;
  let at = 0;
  return selected.map((text) => {
    const length = base + (remainder-- > 0 ? 1 : 0);
    const beat = { start: at, end: at + length, text };
    at += length;
    return beat;
  });
}

export function planBigScenes(input: {
  modelId: string;
  totalDurationSec: number;
  script: string;
  preferredSceneLengthSec?: number;
}): BigScenePlan[] {
  const capability = capabilityFor(input.modelId);
  if (!capability || capability.operation !== 'generate' || !capability.available) throw new Error(`No available generation capability for ${input.modelId}.`);
  const total = Math.round(Number(input.totalDurationSec));
  if (!Number.isFinite(total) || total <= 0) throw new Error('Total duration must be a positive whole number of seconds.');
  const durations = legalDurations(total, capability, input.preferredSceneLengthSec);
  const source = sentences(input.script);
  const cursor = { value: 0 };
  let start = 0;
  return durations.map((duration, index) => {
    const scene: BigScenePlan = {
      index,
      start,
      end: start + duration,
      duration,
      beats: distributeBeats(duration, source, cursor),
      continuityInput: index === 0 ? 'none' : capability.continuityMode,
      attachCharacterReferences: true,
    };
    start += duration;
    return scene;
  });
}

export function validateBigScenePlan(scenes: BigScenePlan[], expectedDuration: number): string[] {
  const errors: string[] = [];
  let projectCursor = 0;
  for (const scene of scenes) {
    if (scene.start !== projectCursor || scene.end - scene.start !== scene.duration) errors.push(`Scene ${scene.index + 1} is not contiguous.`);
    let beatCursor = 0;
    for (const beat of scene.beats) {
      if (beat.start !== beatCursor || beat.end <= beat.start) errors.push(`Scene ${scene.index + 1} has a non-contiguous beat.`);
      beatCursor = beat.end;
    }
    if (beatCursor !== scene.duration) errors.push(`Scene ${scene.index + 1} beats cover ${beatCursor}s, expected ${scene.duration}s.`);
    if (!scene.attachCharacterReferences) errors.push(`Scene ${scene.index + 1} does not attach character references.`);
    projectCursor = scene.end;
  }
  if (projectCursor !== expectedDuration) errors.push(`Plan totals ${projectCursor}s, expected ${expectedDuration}s.`);
  return errors;
}
