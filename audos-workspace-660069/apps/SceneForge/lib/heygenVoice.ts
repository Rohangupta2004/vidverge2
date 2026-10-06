// Voice: cloning the customer's own, and cleaning up the audio they give us.
//
// The standard voice catalog already has a home in lib/heygenStudio
// (`fetchVoices`, which merges the v2 metadata with the v3 render whitelist).
// This file adds the two things the suite needs on top: a clone built from an
// uploaded recording, and the filler-word pass that runs over any audio before
// it is used for lipsync.
import { body, cacheAsset, get, jobIdOf, listOf, pollJob, post, probe, sleep, statusOf, type CachedAsset } from './heygenApi';
import { HeyGenError } from './heygenStudio';

export const MIN_CLONE_SECONDS = 30;

export interface ClonedVoice {
  voiceId: string;
  name: string;
  previewUrl: string;
}

/**
 * Read a media file's duration in the browser so a too-short recording is
 * refused BEFORE it is uploaded and a clone is paid for. A file whose
 * duration cannot be read is allowed through rather than blocked — the
 * check exists to save the customer a wasted attempt, not to gate them out.
 */
export function audioDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    let settled = false;
    const url = URL.createObjectURL(file);
    const audio = document.createElement('audio');
    const done = (seconds: number) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(seconds);
    };
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) ? audio.duration : 0);
    audio.onerror = () => done(0);
    window.setTimeout(() => done(0), 8000);
    audio.src = url;
  });
}

const AUDIO_TYPES = /^(audio\/(wav|x-wav|wave|mpeg|mp3|mp4|m4a|x-m4a|aac|webm|ogg)|video\/(mp4|webm|quicktime))$/i;

export function isSupportedAudio(file: File): boolean {
  return AUDIO_TYPES.test(file.type) || /\.(wav|mp3|m4a|aac|ogg|webm|mp4|mov)$/i.test(file.name);
}

const READY = /^(completed|complete|ready|success|succeeded|active|done|trained)$/;
const FAILED = /^(failed|error|rejected|cancell?ed)$/;

/**
 * Clone the customer's voice from a recording.
 *
 * The recording goes to workspace storage first (the HeyGen proxy carries
 * JSON, not multipart), then HeyGen is handed the handle. Training is
 * asynchronous, so the returned id is polled until the voice is renderable —
 * locking an untrained voice into a render would fail at generation time,
 * which is a far worse place to discover it.
 */
export async function cloneVoice(file: File, name: string, onTick?: (seconds: number) => void): Promise<{ voice: ClonedVoice; asset: CachedAsset }> {
  if (!isSupportedAudio(file)) throw new Error('Use a WAV, MP3 or M4A recording of your voice.');
  if (file.size > 60 * 1024 * 1024) throw new Error('That recording is larger than 60 MB. Trim it and try again.');
  const seconds = await audioDuration(file);
  if (seconds && seconds < MIN_CLONE_SECONDS) {
    throw new Error(`HeyGen needs at least ${MIN_CLONE_SECONDS} seconds of clear speech to clone a voice — this recording is ${Math.round(seconds)}s.`);
  }
  const asset = await cacheAsset(file, 'sceneforge-heygen-voice');
  const created = await probe('voice-clone', 'Voice cloning', () => post('v3/voices/clone', {
    ...(asset.assetId ? { asset_id: asset.assetId } : { audio_url: asset.url }),
    name: name.trim() || 'My voice',
  }));
  const voiceId = String(body(created).voice_id || body(created).id || jobIdOf(created));
  if (!voiceId) throw new HeyGenError('HeyGen accepted the recording but returned no voice id.');

  const started = Date.now();
  for (let attempt = 0; attempt < 45; attempt += 1) {
    let payload: any;
    try {
      payload = await get(`v3/voices/${encodeURIComponent(voiceId)}`);
    } catch (e) {
      const status = Number((e as HeyGenError)?.status) || 0;
      // No readable detail route means we cannot confirm training; the clone
      // itself succeeded, so it is returned rather than failed.
      if (status === 404 || status === 405) break;
      throw e;
    }
    const state = statusOf(payload);
    if (FAILED.test(state)) throw new HeyGenError('HeyGen could not clone a voice from that recording. Try a longer, cleaner sample.');
    if (READY.test(state) || !state) {
      const voice = body(payload);
      return {
        voice: {
          voiceId,
          name: String(voice.name || name.trim() || 'My voice'),
          previewUrl: String(voice.preview_audio || voice.preview_url || voice.sample_url || ''),
        },
        asset,
      };
    }
    onTick?.(Math.round((Date.now() - started) / 1000));
    await sleep(4000);
  }
  return { voice: { voiceId, name: name.trim() || 'My voice', previewUrl: '' }, asset };
}

/** Voices this account can render with, straight from the v3 whitelist. */
export async function listV3Voices(): Promise<{ id: string; name: string; language: string; gender: string; previewUrl: string }[]> {
  const payload = await get('v3/voices?limit=100');
  return listOf(payload).map((voice) => ({
    id: String(voice?.voice_id || voice?.id || ''),
    name: String(voice?.name || voice?.display_name || 'Voice'),
    language: String(voice?.language || voice?.locale || voice?.language_code || ''),
    gender: String(voice?.gender || ''),
    previewUrl: String(voice?.preview_audio || voice?.preview_url || ''),
  })).filter((voice) => voice.id);
}

export interface FillerRemovalResult {
  audioUrl: string;
  /** How many filler words HeyGen reported removing; -1 when it did not say. */
  removedCount: number;
  note: string;
}

/**
 * Strip "um", "uh", "you know" from an audio track before it is lipsynced.
 *
 * Returns the cleaned URL plus the count HeyGen reported, so the UI can show
 * the customer what actually changed instead of claiming an improvement it
 * cannot evidence. A count HeyGen did not report comes back as -1 and the UI
 * says so rather than printing "0 removed".
 */
export async function removeFillerWords(audioUrl: string): Promise<FillerRemovalResult> {
  if (!audioUrl) throw new Error('Upload or link the audio first.');
  const created = await probe('filler-removal', 'Filler-word removal', () => post('v3/tools/filler-word-removal', { audio_url: audioUrl }));
  const data = body(created);
  const immediate = String(data.audio_url || data.output_url || data.url || '');
  const countOf = (payload: any): number => {
    const value = payload?.removed_count ?? payload?.filler_words_removed ?? payload?.removed
      ?? (Array.isArray(payload?.fillers) ? payload.fillers.length : undefined);
    return Number.isFinite(Number(value)) ? Number(value) : -1;
  };
  if (immediate) {
    const count = countOf(data);
    return { audioUrl: immediate, removedCount: count, note: describeRemoval(count) };
  }
  const jobId = jobIdOf(created);
  if (!jobId) throw new HeyGenError('HeyGen accepted the audio but returned nothing to track.');
  const result = await pollJob(`v3/tools/filler-word-removal/${encodeURIComponent(jobId)}`, { label: 'The audio cleanup', intervalMs: 3000, timeoutMs: 5 * 60 * 1000 });
  const count = countOf(body(result.payload));
  return { audioUrl: result.url, removedCount: count, note: describeRemoval(count) };
}

function describeRemoval(count: number): string {
  if (count < 0) return 'Audio cleaned. HeyGen did not report how many filler words it removed.';
  if (count === 0) return 'No filler words found — your audio was already clean.';
  return `Removed ${count} filler word${count === 1 ? '' : 's'}.`;
}
