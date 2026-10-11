// NARRATION — the HeyGen half of the pipeline.
//
// The narrator reads the WHOLE script in one take. That is deliberate: one
// continuous video means one continuous voice with no seams between scenes,
// and the Remotion composition can mount it once and simply move it around
// the frame as the visual plan asks.
//
// Two voice routes, both already supported by the studio's HeyGen layer:
//   * a HeyGen voice id, which synthesises the speech; or
//   * a CUSTOM AUDIO FILE the customer recorded, which HeyGen lip-syncs the
//     presenter to. Nothing is synthesised on that route — the voice on the
//     finished film is the customer's own.
import { createAvatarVideo, fetchVideoStatus, HeyGenError, type CreatedVideo, type HeyGenApiVersion } from './heygenStudio';
import { sleep, uploadFile } from './proxy';

/** HeyGen caps a single script; longer narration must be split by the customer. */
export const MAX_SCRIPT_CHARS = 4000;
/** Upload ceiling for a custom voice track. */
export const MAX_VOICE_BYTES = 50 * 1024 * 1024;
export const VOICE_MIME = ['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/m4a', 'audio/x-m4a'];

export interface CustomVoice {
  url: string;
  name: string;
  sizeBytes: number;
  contentType: string;
}

/**
 * Store the customer's recording somewhere HeyGen can fetch it. A `blob:` URL
 * made in this tab is invisible to HeyGen's servers, so the file has to land
 * on workspace storage before a render can reference it.
 */
export async function uploadCustomVoice(file: File): Promise<CustomVoice> {
  if (file.size > MAX_VOICE_BYTES) {
    throw new Error(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 50 MB — trim the recording or export it at a lower bitrate.`);
  }
  const type = String(file.type || '').toLowerCase();
  const named = /\.(wav|mp3|m4a|mp4a)$/i.test(file.name);
  if (type && !VOICE_MIME.includes(type) && !named) {
    throw new Error('Upload a WAV, MP3 or M4A recording — HeyGen cannot lip-sync to other formats.');
  }
  const stored = await uploadFile(file, 'sceneforge-director-voice');
  return { url: stored.url, name: file.name, sizeBytes: file.size, contentType: stored.contentType || type };
}

export interface NarrationRequest {
  avatarId: string;
  /** Ignored when `customVoiceUrl` is set — the recording carries the words. */
  voiceId: string;
  script: string;
  speed?: number;
  /** A public audio URL HeyGen should lip-sync the presenter to. */
  customVoiceUrl?: string;
  /** Background behind the narrator; matched to the film so the inset blends. */
  backgroundColor?: string;
}

export async function startNarration(request: NarrationRequest): Promise<CreatedVideo> {
  if (!request.avatarId) throw new HeyGenError('Choose a presenter before generating the narration.');
  const usingCustomVoice = Boolean(request.customVoiceUrl);
  const script = String(request.script || '').trim();
  if (!usingCustomVoice && !script) throw new HeyGenError('There is no script for the presenter to read.');
  if (!usingCustomVoice && !request.voiceId) throw new HeyGenError('Choose a voice before generating the narration.');
  if (script.length > MAX_SCRIPT_CHARS) {
    throw new HeyGenError(`This script is ${script.length} characters. HeyGen takes up to ${MAX_SCRIPT_CHARS} in one render — shorten it, or split the film in two.`);
  }
  return createAvatarVideo({
    avatarId: request.avatarId,
    voiceId: request.voiceId,
    // On the lip-sync route HeyGen never reads this; it is kept only as the
    // render's label, exactly as the Avatar Studio does.
    script: script || 'Custom narration',
    speed: Math.min(1.5, Math.max(0.5, Number(request.speed) || 1)),
    resolution: '1080p',
    aspectRatio: '16:9',
    backgroundMode: 'color',
    backgroundColor: request.backgroundColor || '#0D0D0D',
    backgroundImageUrl: '',
    ...(usingCustomVoice ? { audioUrl: request.customVoiceUrl } : {}),
  });
}

export interface NarrationResult {
  videoUrl: string;
  durationSec: number;
}

export interface WaitOptions {
  onStatus?: (status: string, elapsedSec: number) => void;
  timeoutMs?: number;
  isCancelled?: () => boolean;
}

/**
 * Follow the narration render to a finished MP4 and its REAL duration — which
 * is what the scene plan is then fitted to, so the graphics land on the words
 * instead of on the director's estimate of them.
 */
export async function waitForNarration(videoId: string, apiVersion: HeyGenApiVersion, options: WaitOptions = {}): Promise<NarrationResult> {
  const started = Date.now();
  const deadline = started + (options.timeoutMs || 20 * 60 * 1000);
  let misses = 0;
  while (Date.now() < deadline) {
    if (options.isCancelled?.()) throw new HeyGenError('The narration render was cancelled. HeyGen may still finish it.');
    let status;
    try {
      status = await fetchVideoStatus(videoId, apiVersion);
      misses = 0;
    } catch (e) {
      misses += 1;
      if (misses >= 6) throw e;
      await sleep(5000);
      continue;
    }
    const state = String(status.status || '').toLowerCase();
    options.onStatus?.(state, Math.round((Date.now() - started) / 1000));
    if (state === 'completed' && status.videoUrl) {
      return { videoUrl: status.videoUrl, durationSec: Number(status.duration) || 0 };
    }
    if (state === 'failed' || state === 'error') {
      throw new HeyGenError(status.error || 'HeyGen could not render this narration.');
    }
    await sleep(5000);
  }
  throw new HeyGenError('The narration render is taking unusually long. Check your HeyGen library before paying for another one.');
}

/**
 * Measure an audio file in the browser. Used for the custom-voice route,
 * where HeyGen's own duration is only known once the render finishes but the
 * scene plan can be fitted to the recording immediately.
 */
export function measureAudioSeconds(url: string): Promise<number> {
  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => resolve(Number.isFinite(audio.duration) ? audio.duration : 0);
    audio.onerror = () => resolve(0);
    audio.src = url;
  });
}
