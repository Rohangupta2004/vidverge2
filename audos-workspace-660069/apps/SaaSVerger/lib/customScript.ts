/**
 * SAAS VERGER — the customer's OWN script.
 *
 * When somebody pastes a script into Advanced options it replaces the
 * auto-generated brief copy. Their words are never rewritten: this module only
 * SEGMENTS the text into the scene beats the Remotion compositor needs, and
 * times each beat from its own word count.
 *
 * No model call is involved on purpose — a rewrite would defeat the point of
 * pasting a script, and a network round trip would add a failure mode to a
 * step that is pure text work.
 */
import type { Script, ScriptAct, ScreenKey } from '../types';

/** Comfortable narration pace. 2.6 words a second is the rate ElevenLabs
 * turbo reads at, so a beat's length matches how long it takes to say. */
const WORDS_PER_SECOND = 2.6;
const MIN_BEAT_SECONDS = 4;
const MAX_BEAT_SECONDS = 24;
const TARGET_BEATS = 5;

/** The product-screen rotation a segmented script walks through before its
 * closing card, matching the three coded mockups the compositor ships. */
const SCREEN_ROTATION: ScreenKey[] = ['screen1', 'screen1', 'screen2', 'screen3'];

export function splitSentences(text: string): string[] {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    // A blank line is a deliberate beat break, so keep it as a sentence edge.
    .split(/\n{2,}/)
    // Matched rather than split on a lookbehind: older Safari builds still
    // reject lookbehind, and that would take the whole space bundle down.
    .flatMap((block) => block.match(/[^.!?…]+[.!?…]*/g) || [])
    .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function wordCount(text: string): number {
  return String(text || '').split(/\s+/).filter(Boolean).length;
}

function beatSeconds(text: string): number {
  const seconds = Math.round(wordCount(text) / WORDS_PER_SECOND);
  return Math.max(MIN_BEAT_SECONDS, Math.min(MAX_BEAT_SECONDS, seconds || MIN_BEAT_SECONDS));
}

/** Spread sentences over `count` beats as evenly as the sentence lengths allow,
 * keeping the original order and never dropping a sentence. */
function groupSentences(sentences: string[], count: number): string[] {
  if (count <= 1) return [sentences.join(' ')];
  const totalWords = sentences.reduce((sum, sentence) => sum + wordCount(sentence), 0);
  const perBeat = totalWords / count;
  const beats: string[][] = Array.from({ length: count }, () => []);
  let index = 0;
  let used = 0;
  sentences.forEach((sentence, position) => {
    const remaining = sentences.length - position;
    const slotsLeft = count - index;
    // Always leave at least one sentence for every remaining beat, so a long
    // opening sentence can never swallow the whole script.
    if (index < count - 1 && remaining > slotsLeft && used >= perBeat) {
      index += 1;
      used = 0;
    } else if (index < count - 1 && remaining <= slotsLeft) {
      index = count - remaining;
      used = 0;
    }
    beats[index].push(sentence);
    used += wordCount(sentence);
  });
  return beats.map((group) => group.join(' ')).filter(Boolean);
}

/** True when there is enough pasted text to build a script from. */
export function usableScriptText(text: string): boolean {
  return wordCount(text) >= 8;
}

/**
 * Turn pasted narration into the pipeline's Script shape, verbatim. The final
 * beat always lands on the closing CTA card, which is where the compositor
 * puts the product name, tagline and call to action.
 */
export function scriptFromText(text: string): Script {
  const sentences = splitSentences(text);
  if (!sentences.length) throw new Error('Your pasted script is empty — add a few lines, or clear it to let the pipeline write one.');

  const count = Math.max(2, Math.min(TARGET_BEATS, sentences.length));
  const groups = groupSentences(sentences, count);

  const acts: ScriptAct[] = groups.map((beat, index) => {
    const last = index === groups.length - 1;
    // The closing CTA card renders the product identity, not the act's words,
    // so a script short enough to be ONE beat stays on a product screen —
    // otherwise the customer's only line would never appear on screen.
    const screenKey: ScreenKey = groups.length === 1
      ? 'screen1'
      : last ? 'cta' : SCREEN_ROTATION[Math.min(index, SCREEN_ROTATION.length - 1)];
    return { text: beat, narration: beat, durationSeconds: beatSeconds(beat), screenKey, visual: null };
  });

  return {
    acts,
    fullText: acts.map((act) => act.text).join(' '),
    totalSeconds: acts.reduce((sum, act) => sum + act.durationSeconds, 0),
  };
}

/**
 * Stretch (or leave) a script so the whole film is at least as long as an
 * UPLOADED voiceover. Without this a 90-second narration would be cut off by a
 * 70-second render; scene lengths are scaled proportionally so the pacing the
 * script implies is kept.
 */
export function fitScriptToAudio(source: Script, audioSeconds: number): Script {
  const target = Math.ceil(Number(audioSeconds) || 0) + 1;
  if (!Number.isFinite(target) || target <= source.totalSeconds) return source;
  const scale = target / Math.max(1, source.totalSeconds);
  const acts = source.acts.map((act) => ({
    ...act,
    durationSeconds: Math.max(MIN_BEAT_SECONDS, Math.round(act.durationSeconds * scale)),
  }));
  return { ...source, acts, totalSeconds: acts.reduce((sum, act) => sum + act.durationSeconds, 0) };
}

/** A short, human description of what the pasted script will become. */
export function describeCustomScript(text: string): string {
  if (!usableScriptText(text)) return '';
  const script = scriptFromText(text);
  return `${script.acts.length} scene${script.acts.length === 1 ? '' : 's'} · about ${script.totalSeconds}s`;
}
