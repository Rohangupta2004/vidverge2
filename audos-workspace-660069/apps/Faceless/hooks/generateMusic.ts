/**
 * generateMusic.
 *
 * The brief that matters: NOT a single looping track. A bed that sits at one
 * energy for sixty seconds is the sound of a template, and it is the fastest
 * way to make a well-cut film feel generic.
 *
 * The arc is delivered in two layers, and both are necessary:
 *
 *   1. COMPOSITION — the prompt describes the piece section by section with
 *      real timings, so the generated music is written to rise and fall where
 *      the story does. The ElevenLabs music endpoint renders an exact length,
 *      so the bed matches the narration to the second with nothing to loop.
 *   2. MIX — the composition modulates music volume per beat from each beat's
 *      musicEnergy, so even where the generated piece is flatter than asked,
 *      the bed still breathes with the edit and always sits under the voice.
 */

import type { MusicArcSection, MusicMoodId } from '../types/editorial';
import { callHook } from '../lib/platform';
import { MUSIC_MOODS } from '../lib/facelessOptions';

const STAGE = 'assets' as const;

/** ElevenLabs music is roughly a cent a second. */
export const MUSIC_COST_PER_SECOND = 0.01;

export interface GenerateMusicOptions {
  durationSeconds: number;
  mode?: string;
  colorStory?: string;
  /**
   * The brief's mood preset. When set it decides the instrumentation outright;
   * when absent the mode grammar picks it, which is what every run did before
   * the preset existed.
   */
  mood?: MusicMoodId;
}

export async function generateMusic(
  musicArc: MusicArcSection[],
  options: GenerateMusicOptions,
): Promise<{ url: string | null; cost: number; reason?: string }> {
  const seconds = Math.max(3, Math.min(600, Math.round(options.durationSeconds)));
  const prompt = buildArcPrompt(musicArc, options);

  try {
    const out = await callHook<{ audioUrl?: string }>(
      'faceless-assets',
      { op: 'music', prompt, lengthMs: seconds * 1000, instrumental: true },
      STAGE,
    );
    const url = String(out.audioUrl || '');
    if (!/^https?:\/\//i.test(url)) {
      return { url: null, cost: 0, reason: 'The music model returned no usable file.' };
    }
    return { url, cost: Math.round(seconds * MUSIC_COST_PER_SECOND * 100) / 100 };
  } catch (error: any) {
    // Music is a layer, not the spine. A film with narration and no bed is a
    // worse film; a film that failed to render because the bed failed is no
    // film at all.
    return { url: null, cost: 0, reason: String(error?.message || error).slice(0, 200) };
  }
}

/** The mood (or, failing that, the mode) decides instrumentation; the arc decides shape. */
export function buildArcPrompt(musicArc: MusicArcSection[], options: GenerateMusicOptions): string {
  const preset = options.mood ? MUSIC_MOODS.find((entry) => entry.id === options.mood) : undefined;
  const palette = preset ? preset.instrumentation : instrumentationFor(options.mode);
  const sections = musicArc
    .map((section) => {
      const from = section.timeRange[0].toFixed(0);
      const to = section.timeRange[1].toFixed(0);
      return `${from}s-${to}s ${section.section.toLowerCase()}: ${energyWords(section.energy)}`;
    })
    .join('; ');

  return [
    `Instrumental score for a narrated documentary-style film, ${palette}.`,
    'It must sit UNDER a spoken voice at all times: no lead melody in the vocal range, no sudden transients, nothing that competes for attention.',
    `The piece is through-composed and must not loop. Follow this energy arc exactly — ${sections}.`,
    options.colorStory ? `Emotional colour: ${options.colorStory}.` : '',
    'No vocals, no lyrics, no spoken word.',
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, 4000);
}

function energyWords(energy: number): string {
  if (energy >= 0.85) return 'full weight, the loudest moment in the piece, driving';
  if (energy >= 0.65) return 'building, pulse arriving, forward motion';
  if (energy >= 0.45) return 'steady mid-level, warm but restrained';
  if (energy >= 0.25) return 'sparse and quiet, almost only texture';
  return 'near silence, a single held tone';
}

function instrumentationFor(mode?: string): string {
  switch (mode) {
    case 'explainer':
    case 'educational':
      return 'clean synth pads, soft mallets and a light pulse';
    case 'news':
      return 'tight percussive pulse, low strings, urgent but controlled';
    case 'business':
      return 'modern minimal electronics, clean piano, confident and uncluttered';
    case 'story':
      return 'cinematic strings and piano with real dynamic range';
    default:
      return 'cinematic strings, low brass swells and sub-bass texture';
  }
}
