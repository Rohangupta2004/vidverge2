// Post-production: everything that happens to a video AFTER it renders.
//
// The shared idea behind all five tools here is that none of them re-render
// the avatar. Re-voicing, translating, scoring, adding an effect and cutting
// shorts all operate on the finished MP4, which is why they are cheap enough
// to try more than once — and why the UI presents them as edits rather than
// as new generations.
import { body, get, jobIdOf, listOf, pollJob, post, probe, urlOf, type PollOptions } from './heygenApi';
import { HeyGenError } from './heygenStudio';

/** Speed trades quality for turnaround; Precision is the other way round. */
export type QualityMode = 'speed' | 'precision';

export const QUALITY_MODES: { value: QualityMode; label: string; blurb: string }[] = [
  { value: 'speed', label: 'Speed', blurb: 'Back in a couple of minutes. Good enough for a draft or a social cut.' },
  { value: 'precision', label: 'Precision', blurb: 'Slower, but context-aware and much closer to broadcast quality.' },
];

/**
 * Submit a job, then follow it to a URL.
 *
 * Every tool below shares this shape: POST once, take the URL if HeyGen
 * answered immediately, otherwise poll the per-job route. Centralising it
 * means one consistent progress story and one consistent failure story across
 * all five tools.
 */
async function runJob(
  capability: Parameters<typeof probe>[0],
  label: string,
  path: string,
  payload: unknown,
  statusPath: (jobId: string) => string,
  options: PollOptions = {},
): Promise<{ url: string; payload: any }> {
  const created = await probe(capability, label, () => post(path, payload));
  const immediate = urlOf(created);
  if (immediate) return { url: immediate, payload: created };
  const jobId = jobIdOf(created);
  if (!jobId) throw new HeyGenError(`HeyGen accepted the ${label.toLowerCase()} request but returned nothing to track it by.`);
  return pollJob(statusPath(jobId), { label, ...options });
}

// ——— Lipsync: new narration over the SAME render ———

/**
 * Replace a finished video's narration without paying for a new render.
 *
 * This is the cheapest fix in the whole app: the customer changed their mind
 * about the wording, and the avatar's mouth is re-timed to the new audio
 * instead of the scene being generated again.
 */
export function lipsyncVideo(videoUrl: string, audioUrl: string, mode: QualityMode, onTick?: PollOptions['onTick']) {
  if (!videoUrl) throw new Error('There is no finished video to re-voice yet.');
  if (!audioUrl) throw new Error('Upload the new narration, or paste a link to it, first.');
  return runJob('lipsync', 'Re-voicing', 'v3/lipsync', { video_url: videoUrl, audio_url: audioUrl, mode }, (id) => `v3/lipsync/${encodeURIComponent(id)}`, {
    intervalMs: 5000,
    timeoutMs: 20 * 60 * 1000,
    onTick,
  });
}

// ——— Translation ———

export interface Translation {
  language: string;
  label: string;
  mode: QualityMode;
  videoUrl: string;
}

/** Translate the finished film into one more language. */
export async function translateVideo(videoUrl: string, language: string, label: string, mode: QualityMode, onTick?: PollOptions['onTick']): Promise<Translation> {
  if (!videoUrl) throw new Error('There is no finished video to translate yet.');
  if (!language) throw new Error('Pick a language first.');
  const result = await runJob(
    'translation',
    `The ${label} translation`,
    'v3/video-translations',
    { video_url: videoUrl, target_language: language, mode },
    (id) => `v3/video-translations/${encodeURIComponent(id)}`,
    { intervalMs: 6000, timeoutMs: 30 * 60 * 1000, onTick },
  );
  return { language, label, mode, videoUrl: result.url };
}

// ——— Background music ———

export interface MusicTrack {
  id: string;
  title: string;
  previewUrl: string;
  durationSec: number;
  mood: string;
}

function trackFrom(entry: any, index: number): MusicTrack {
  return {
    id: String(entry?.id || entry?.track_id || entry?.audio_id || `track-${index + 1}`),
    title: String(entry?.title || entry?.name || `Track ${index + 1}`),
    previewUrl: String(entry?.preview_url || entry?.audio_url || entry?.url || ''),
    durationSec: Number(entry?.duration || entry?.duration_sec || 0) || 0,
    mood: String(entry?.mood || entry?.genre || entry?.style || ''),
  };
}

/**
 * Ask HeyGen for scoring options for this film.
 *
 * Returns candidates the customer auditions before committing — a score is
 * a taste decision, so applying one automatically would be wrong.
 */
export async function suggestMusic(videoUrl: string, mood: string): Promise<MusicTrack[]> {
  const created = await probe('music', 'Background music', () => post('v3/tools/background-music', {
    ...(videoUrl ? { video_url: videoUrl } : {}),
    prompt: mood.trim() || 'Warm, modern, understated score for a short product film',
  }));
  const tracks = listOf(created).map(trackFrom).filter((track) => track.previewUrl);
  if (tracks.length) return tracks;
  // Some shapes answer with a single applied track rather than a list.
  const single = urlOf(created);
  return single ? [trackFrom({ ...body(created), audio_url: single }, 0)] : [];
}

/** Commit one audition to the film. */
export function applyMusic(videoUrl: string, track: MusicTrack, onTick?: PollOptions['onTick']) {
  if (!videoUrl) throw new Error('There is no finished video to score yet.');
  return runJob(
    'music',
    'The music mix',
    'v3/tools/background-music',
    { video_url: videoUrl, track_id: track.id, audio_url: track.previewUrl, apply: true },
    (id) => `v3/tools/background-music/${encodeURIComponent(id)}`,
    { intervalMs: 5000, timeoutMs: 15 * 60 * 1000, onTick },
  );
}

// ——— Sound effects ———

export interface SoundEffect {
  id: string;
  label: string;
  audioUrl: string;
  durationSec: number;
}

/** Options for a described sound — "product reveal whoosh", "UI click". */
export async function suggestSoundEffects(description: string): Promise<SoundEffect[]> {
  const prompt = description.trim();
  if (!prompt) throw new Error('Describe the sound you want first.');
  const created = await probe('sfx', 'Sound effects', () => post('v3/tools/sound-effects', { description: prompt }));
  const options = listOf(created).map((entry, index) => ({
    id: String(entry?.id || entry?.effect_id || `sfx-${index + 1}`),
    label: String(entry?.label || entry?.name || entry?.description || `${prompt} ${index + 1}`),
    audioUrl: String(entry?.audio_url || entry?.url || entry?.preview_url || ''),
    durationSec: Number(entry?.duration || entry?.duration_sec || 0) || 0,
  })).filter((effect) => effect.audioUrl);
  if (options.length) return options;
  const single = urlOf(created);
  return single ? [{ id: 'sfx-1', label: prompt, audioUrl: single, durationSec: 0 }] : [];
}

// ——— AI clipping ———

export interface Highlight {
  id: string;
  title: string;
  videoUrl: string;
  thumbnailUrl: string;
  startSec: number;
  endSec: number;
  /** HeyGen's own confidence that this is the strongest moment, 0–1. */
  score: number;
}

/**
 * Cut the long film into short-form highlights.
 *
 * HeyGen picks the moments and returns timestamps plus a clip per highlight,
 * which is what turns one landscape explainer into a week of Reels.
 */
export async function createClips(videoUrl: string, onTick?: PollOptions['onTick']): Promise<Highlight[]> {
  if (!videoUrl) throw new Error('There is no finished video to clip yet.');
  const created = await probe('clipping', 'Short-form clipping', () => post('v3/tools/clipping', { video_url: videoUrl }));
  const readClips = (payload: any): Highlight[] => listOf(payload).map((entry, index) => ({
    id: String(entry?.id || entry?.clip_id || `clip-${index + 1}`),
    title: String(entry?.title || entry?.name || entry?.caption || `Highlight ${index + 1}`),
    videoUrl: String(entry?.video_url || entry?.url || entry?.output_url || ''),
    thumbnailUrl: String(entry?.thumbnail_url || entry?.cover_url || ''),
    startSec: Number(entry?.start ?? entry?.start_time ?? entry?.start_sec ?? 0) || 0,
    endSec: Number(entry?.end ?? entry?.end_time ?? entry?.end_sec ?? 0) || 0,
    score: Number(entry?.score ?? entry?.confidence ?? 0) || 0,
  })).filter((clip) => clip.videoUrl);

  const immediate = readClips(created);
  if (immediate.length) return immediate;

  const jobId = jobIdOf(created);
  if (!jobId) throw new HeyGenError('HeyGen accepted the clipping request but returned nothing to track it by.');
  const statusPath = `v3/tools/clipping/${encodeURIComponent(jobId)}`;
  // Clipping finishes with a LIST rather than one URL, so pollJob's
  // single-URL terminal test does not apply; the list is waited for directly.
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 5000));
    const payload = await probe('clipping', 'Short-form clipping', () => get(statusPath));
    const clips = readClips(payload);
    if (clips.length) return clips;
    const status = String(body(payload).status || '').toLowerCase();
    if (/^(failed|error|cancell?ed)$/.test(status)) throw new HeyGenError('HeyGen could not cut clips from this video.');
    onTick?.(attempt * 5, status || 'processing');
  }
  throw new HeyGenError('The clipping job did not finish in time. It may still complete in HeyGen.');
}
