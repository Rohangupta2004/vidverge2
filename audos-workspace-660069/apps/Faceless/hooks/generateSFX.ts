/**
 * generateSFX.
 *
 * Cardinal rule 10: sound effects mark something HAPPENING. They are not
 * transition decoration, which is why the director is limited to two per beat
 * and most beats carry none at all.
 *
 * The platform's ElevenLabs surface exposes speech and music, not a sound
 * effects endpoint, so an effect is rendered as a very short instrumental
 * music generation from the effect's own description. That is an honest
 * substitute for a hit, a whoosh or a rise; it is not a substitute for a
 * literal recording of a real-world event, and when the description reads
 * like one the cue is skipped with its reason recorded rather than filled
 * with something wrong.
 */

import type { SFXAsset } from '../types/editorial';
import { callHook } from '../lib/platform';

const STAGE = 'assets' as const;

/** ~$0.01 per second of ElevenLabs music; an effect is two seconds. */
export const SFX_COST = 0.02;
const SFX_LENGTH_MS = 3000;

/**
 * Descriptions that name a real recorded event rather than a designed sound.
 * A music model asked for one of these returns a short musical phrase, which
 * is worse than silence under a documentary beat.
 */
const LITERAL_EVENT = /\b(voice|speech|crowd chant|dialogue|siren|gunshot|animal|dog|bird song|engine|traffic|footsteps)\b/i;

export async function generateSFX(
  description: string,
  offsetMs: number,
  beatId = '',
): Promise<SFXAsset> {
  const text = String(description || '').trim();
  const base: SFXAsset = { beatId, description: text, offsetMs: Math.max(0, Math.round(offsetMs)), url: null };

  if (text.length < 4) {
    return { ...base, reason: 'The effect had no usable description.' };
  }
  if (LITERAL_EVENT.test(text)) {
    return {
      ...base,
      reason: 'This asks for a recording of a real event, which the platform has no sound-effects library for. The beat plays without it rather than with the wrong sound.',
    };
  }

  try {
    const out = await callHook<{ audioUrl?: string }>(
      'faceless-assets',
      {
        op: 'music',
        prompt: `A single designed sound-effect hit, isolated on silence: ${text}. No melody, no beat, no loop. One short transient with a natural tail.`,
        lengthMs: SFX_LENGTH_MS,
        instrumental: true,
      },
      STAGE,
    );
    const url = String(out.audioUrl || '');
    if (!/^https?:\/\//i.test(url)) {
      return { ...base, reason: 'The audio model returned no usable file for this effect.' };
    }
    return { ...base, url };
  } catch (error: any) {
    return { ...base, reason: String(error?.message || error).slice(0, 160) };
  }
}

/**
 * Every effect the timeline asked for, with its offset converted to an
 * absolute time in the film. Cues are capped: six is already more sound design
 * than a narration-led faceless video can carry without competing with speech.
 */
export async function generateAllSFX(
  beats: { id: string; narrationStart: number; soundDesign?: { sfx?: { description: string; offsetMs: number }[] } }[],
  limit = 6,
): Promise<{ cues: SFXAsset[]; skipped: SFXAsset[]; spend: number }> {
  const requested = beats.flatMap((beat) =>
    (beat.soundDesign?.sfx || []).map((entry) => ({
      beatId: beat.id,
      description: entry.description,
      absoluteMs: Math.round(beat.narrationStart * 1000 + entry.offsetMs),
    })),
  );

  const cues: SFXAsset[] = [];
  const skipped: SFXAsset[] = [];
  for (const entry of requested.slice(0, limit)) {
    const asset = await generateSFX(entry.description, entry.absoluteMs, entry.beatId);
    if (asset.url) cues.push(asset);
    else skipped.push(asset);
  }

  requested.slice(limit).forEach((entry) => {
    skipped.push({
      beatId: entry.beatId,
      description: entry.description,
      offsetMs: entry.absoluteMs,
      url: null,
      reason: `Over the ${limit}-effect ceiling for one film.`,
    });
  });

  return { cues, skipped, spend: Math.round(cues.length * SFX_COST * 100) / 100 };
}
