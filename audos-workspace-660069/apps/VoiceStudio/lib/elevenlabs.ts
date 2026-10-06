// Every ElevenLabs feature Voice Studio offers, and the one decision that
// shapes this file: WHICH of the two routes to the provider each feature uses.
//
//   BYOK   — the founder's own key through the workspace secrets proxy
//            ({{secrets.ELEVENLABS_API_KEY}}). JSON in, audio bytes out.
//            Used for text-to-speech, sound effects and dubbing.
//
//   Audos  — the platform's managed ElevenLabs endpoints, billed to the
//            workspace wallet. Used for voice cloning, the voice changer and
//            music, because all three need a multipart body carrying real
//            FILE BYTES and the secrets proxy's multipart mode accepts
//            text-only fields. The managed endpoints take a browser FormData
//            directly, so this is the route that actually works.
//
// Text-to-speech falls back from BYOK to the managed endpoint when the
// founder's key is missing, disabled or not allow-listed, so the app keeps
// working either way instead of stalling on a key nobody can ask about.
import { base64ToBytes, blobFromBase64, pcmToWav, readLocal, workspaceId, workspaceToken, writeLocal } from './runtime';
import { KeyUnusableError, elevenlabs, elevenlabsBytes, keyUnusable } from './secretsProxy';

export type Engine = 'byok' | 'audos';

// ---------------------------------------------------------------- voices ----

export interface Voice {
  id: string;
  name: string;
  /** 'cloned' voices are this workspace's own; 'premade' are the shared catalog. */
  category: string;
  accent?: string;
  gender?: string;
  description?: string;
  previewUrl?: string;
  indian: boolean;
}

const OVERRIDE_KEY = 'voicestudio_indian_voice_overrides_v1';

/**
 * ElevenLabs does not tag a voice's region, so "is this an Indian voice?" is a
 * read of what the voice itself says: its accent / description labels first,
 * then its name against the catalog's actual Indian voices. Aria, Sarah and
 * the other American premades are deliberately absent — a wrong flag is worse
 * than no flag. Anything the heuristic misses can be pinned by hand.
 */
const INDIAN_VOICE_NAMES = [
  'meera', 'rishi', 'monika', 'niraj', 'kanika', 'devi', 'raju', 'aahir', 'muskaan',
  'priya', 'aditi', 'arjun', 'ananya', 'kavya', 'rohan', 'ishaan', 'neha', 'ravi',
  'anjali', 'vikram', 'sanjay', 'deepak', 'pooja', 'shruti', 'karan', 'tara',
  'aryan', 'diya', 'leela', 'nikhil', 'sana', 'zara', 'veena', 'gautam', 'bhavna',
];

const INDIAN_LABEL = /\b(indian|india|hindi|hinglish|urdu|tamil|telugu|bengali|marathi|punjabi|gujarati|kannada|malayalam|desi)\b/i;

/**
 * A hand-set verdict wins over the heuristic in BOTH directions: the flag
 * button has to be able to add a badge the match missed and remove one it got
 * wrong, so the store is an explicit true/false per voice rather than a list of
 * additions.
 */
export type IndianOverrides = Record<string, boolean>;

export function voiceOverrides(): IndianOverrides {
  return readLocal<IndianOverrides>(OVERRIDE_KEY, {});
}

export function setVoiceOverride(voiceId: string, indian: boolean): IndianOverrides {
  const overrides = voiceOverrides();
  overrides[voiceId] = indian;
  writeLocal(OVERRIDE_KEY, overrides);
  return overrides;
}

function detectIndian(voice: { id: string; name: string; accent?: string; description?: string }, overrides: IndianOverrides): boolean {
  if (typeof overrides[voice.id] === 'boolean') return overrides[voice.id];
  if (INDIAN_LABEL.test(`${voice.accent || ''} ${voice.description || ''}`)) return true;
  const first = String(voice.name || '').trim().toLowerCase().split(/[\s(,\-]/)[0];
  return INDIAN_VOICE_NAMES.indexOf(first) >= 0;
}

/** Indian voices first, then this workspace's clones, then everything else alphabetically. */
export function sortVoices(voices: Voice[]): Voice[] {
  const rank = (voice: Voice) => (voice.indian ? 0 : voice.category === 'cloned' ? 1 : 2);
  return [...voices].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

export interface VoiceCatalog {
  voices: Voice[];
  engine: Engine;
}

async function byokVoices(): Promise<Voice[]> {
  const result = await elevenlabs<{ voices?: any[] }>({ method: 'GET', url: 'https://api.elevenlabs.io/v1/voices' });
  const overrides = voiceOverrides();
  return (result.body?.voices || []).map((raw) => {
    const base = {
      id: String(raw?.voice_id || ''),
      name: String(raw?.name || 'Unnamed voice'),
      accent: raw?.labels?.accent ? String(raw.labels.accent) : undefined,
      description: [raw?.labels?.description, raw?.labels?.language, raw?.description].filter(Boolean).join(' '),
    };
    return {
      ...base,
      category: String(raw?.category || 'premade'),
      gender: raw?.labels?.gender ? String(raw.labels.gender) : undefined,
      previewUrl: raw?.preview_url ? String(raw.preview_url) : undefined,
      indian: detectIndian(base, overrides),
    };
  }).filter((voice) => voice.id);
}

async function audosVoices(): Promise<Voice[]> {
  const response = await fetch(`/api/workspaces/${workspaceId()}/audio/voices`, {
    headers: { 'X-Workspace-DB-Token': workspaceToken() },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `The voice catalog could not be loaded (${response.status}).`);
  const overrides = voiceOverrides();
  return (data?.voices || []).map((raw: any) => {
    const base = {
      id: String(raw?.id || ''),
      name: String(raw?.name || 'Unnamed voice'),
      accent: raw?.labels?.accent ? String(raw.labels.accent) : undefined,
      description: [raw?.labels?.description, raw?.labels?.language].filter(Boolean).join(' '),
    };
    return {
      ...base,
      category: String(raw?.category || 'premade'),
      gender: raw?.labels?.gender ? String(raw.labels.gender) : undefined,
      previewUrl: raw?.previewUrl ? String(raw.previewUrl) : undefined,
      indian: detectIndian(base, overrides),
    };
  }).filter((voice: Voice) => voice.id);
}

/**
 * The voice dropdown every tab shares. The founder's own catalog wins when the
 * key works, because it carries the voices they actually pay for; otherwise
 * the managed catalog stands in (this workspace's clones first, then premades).
 */
export async function loadVoices(): Promise<VoiceCatalog> {
  if (!keyUnusable()) {
    try {
      return { voices: sortVoices(await byokVoices()), engine: 'byok' };
    } catch (e) {
      if (!(e instanceof KeyUnusableError)) throw e;
    }
  }
  return { voices: sortVoices(await audosVoices()), engine: 'audos' };
}

// ------------------------------------------------------------- settings ----

export interface VoiceSettings {
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  stability: 0.45,
  similarity_boost: 0.8,
  style: 0.35,
  use_speaker_boost: true,
};

export const TTS_MODELS = [
  { id: 'eleven_multilingual_v2', label: 'Multilingual v2', hint: 'Best quality — 29 languages, handles Hindi and Hinglish' },
  { id: 'eleven_turbo_v2_5', label: 'Turbo v2.5', hint: 'Fast, low latency, still multilingual' },
  { id: 'eleven_flash_v2_5', label: 'Flash v2.5', hint: 'Fastest and cheapest — best for drafts' },
];

/**
 * ElevenLabs names an output format rather than taking a container plus a rate,
 * so the picker lists real `output_format` values. FLAC is deliberately absent:
 * the API does not offer it, and offering a value the provider rejects is just
 * a 400 with extra steps. PCM is wrapped in a WAV header on the way out so it
 * plays and downloads.
 */
export const OUTPUT_FORMATS = [
  { id: 'mp3_44100_128', label: 'MP3 — 44.1kHz / 128kbps', extension: 'mp3', hint: 'Default. Smallest file, plays everywhere.' },
  { id: 'mp3_44100_192', label: 'MP3 — 44.1kHz / 192kbps', extension: 'mp3', hint: 'Higher bitrate MP3 (needs a paid ElevenLabs tier).' },
  { id: 'pcm_44100', label: 'PCM — 44.1kHz (saved as WAV)', extension: 'wav', hint: 'Uncompressed, for editing. Needs a paid ElevenLabs tier.' },
  { id: 'pcm_24000', label: 'PCM — 24kHz (saved as WAV)', extension: 'wav', hint: 'Uncompressed, smaller rate.' },
];

export interface GeneratedAudio {
  /** Playable in-browser. A blob: URL for BYOK bytes, a permanent https URL for the managed endpoint. */
  url: string;
  /** Present only on the BYOK path, where we hold the actual bytes. */
  blob?: Blob;
  extension: string;
  engine: Engine;
  /** Set when the managed endpoint stood in for an unusable founder key. */
  note?: string;
}

// -------------------------------------------------------- text to speech ----

export interface SpeakRequest {
  text: string;
  voiceId: string;
  modelId: string;
  outputFormat: string;
  settings: VoiceSettings;
}

export async function textToSpeech(request: SpeakRequest): Promise<GeneratedAudio> {
  if (!keyUnusable()) {
    try {
      return await byokSpeak(request);
    } catch (e) {
      if (!(e instanceof KeyUnusableError)) throw e;
    }
  }
  const audio = await audosSpeak(request);
  return { ...audio, note: 'Generated on the Audos-managed ElevenLabs account and billed to your workspace wallet.' };
}

async function byokSpeak(request: SpeakRequest): Promise<GeneratedAudio> {
  const format = OUTPUT_FORMATS.find((entry) => entry.id === request.outputFormat) || OUTPUT_FORMATS[0];
  const { base64, contentType } = await elevenlabsBytes({
    method: 'POST',
    url: `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(request.voiceId)}`,
    query: { output_format: format.id },
    json: {
      text: request.text,
      model_id: request.modelId,
      voice_settings: {
        stability: request.settings.stability,
        similarity_boost: request.settings.similarity_boost,
        style: request.settings.style,
        use_speaker_boost: request.settings.use_speaker_boost,
      },
    },
  });

  const blob = format.id.startsWith('pcm_')
    ? pcmToWav(base64ToBytes(base64), Number(format.id.split('_')[1]) || 44100)
    : blobFromBase64(base64, contentType || 'audio/mpeg');

  return { url: URL.createObjectURL(blob), blob, extension: format.extension, engine: 'byok' };
}

async function audosSpeak(request: SpeakRequest): Promise<GeneratedAudio> {
  const response = await fetch(`/api/workspaces/${workspaceId()}/audio/voiceover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': workspaceToken() },
    body: JSON.stringify({ script: request.text, voiceId: request.voiceId, voiceSettings: request.settings }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.audioUrl) throw new Error(describeAudosError(data, response.status, 'The voiceover could not be generated.'));
  return { url: String(data.audioUrl), extension: 'mp3', engine: 'audos' };
}

// ---------------------------------------------------------- voice cloning ----

export const CLONE_NOTE_KEY = 'voicestudio_clone_notes_v1';

export function cloneNotes(): Record<string, string> {
  return readLocal<Record<string, string>>(CLONE_NOTE_KEY, {});
}

export function saveCloneNote(voiceId: string, note: string) {
  const notes = cloneNotes();
  if (note.trim()) notes[voiceId] = note.trim();
  else delete notes[voiceId];
  writeLocal(CLONE_NOTE_KEY, notes);
}

export const CLONE_LIMITS = { files: 5, perFileBytes: 10 * 1024 * 1024, totalBytes: 25 * 1024 * 1024 };

/**
 * Instant voice clone. Multipart with real file bytes, so this runs on the
 * managed endpoint ($1.00 per voice, refunded if creation fails) rather than
 * through the secrets proxy, whose multipart mode carries text fields only.
 * The description is kept in this browser against the returned voice id — the
 * endpoint takes a name and the samples, and nothing else.
 */
export async function cloneVoice(name: string, description: string, files: File[]): Promise<Voice> {
  const form = new FormData();
  form.append('name', name.trim().slice(0, 80));
  files.forEach((file) => form.append('files', file, file.name || 'sample.mp3'));

  const response = await fetch(`/api/workspaces/${workspaceId()}/audio/voices`, {
    method: 'POST',
    headers: { 'X-Workspace-DB-Token': workspaceToken() },
    body: form,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.voice?.voiceId) {
    throw new Error(describeAudosError(data, response.status, 'The voice could not be cloned.'));
  }

  const voiceId = String(data.voice.voiceId);
  saveCloneNote(voiceId, description);
  const base = { id: voiceId, name: String(data.voice.name || name), description };
  return { ...base, category: 'cloned', indian: detectIndian(base, voiceOverrides()) };
}

export async function deleteClonedVoice(voiceId: string): Promise<void> {
  const response = await fetch(`/api/workspaces/${workspaceId()}/audio/voices/${encodeURIComponent(voiceId)}`, {
    method: 'DELETE',
    headers: { 'X-Workspace-DB-Token': workspaceToken() },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(describeAudosError(data, response.status, 'That voice could not be deleted.'));
  }
  saveCloneNote(voiceId, '');
}

// -------------------------------------------------------- speech to speech ----

export const S2S_MODELS = [
  { id: 'eleven_multilingual_sts_v2', label: 'Multilingual STS v2', hint: 'Default — 29 languages, usually best even for English' },
  { id: 'eleven_english_sts_v2', label: 'English STS v2', hint: 'English only' },
];

export const S2S_LIMITS = { bytes: 25 * 1024 * 1024, seconds: 300 };

/**
 * Voice changer: keep the words, timing and emotion of a recording and replace
 * the voice. Multipart file bytes again, so the managed endpoint ($0.30 per
 * minute of input, measured by decoding the upload) is the working route.
 */
export async function speechToSpeech(options: {
  file: File;
  voiceId: string;
  modelId: string;
  settings: VoiceSettings;
  removeBackgroundNoise: boolean;
}): Promise<{ url: string; durationMs: number }> {
  const form = new FormData();
  form.append('audio', options.file, options.file.name || 'recording.mp3');
  form.append('voiceId', options.voiceId);
  form.append('modelId', options.modelId);
  form.append('voiceSettings', JSON.stringify(options.settings));
  if (options.removeBackgroundNoise) form.append('removeBackgroundNoise', 'true');

  const response = await fetch(`/api/workspaces/${workspaceId()}/audio/speech-to-speech`, {
    method: 'POST',
    headers: { 'X-Workspace-DB-Token': workspaceToken() },
    body: form,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.audioUrl) {
    throw new Error(describeAudosError(data, response.status, 'The voice could not be converted.'));
  }
  return { url: String(data.audioUrl), durationMs: Number(data.durationMs) || 0 };
}

// ------------------------------------------------------------ sound effects ----

export const SFX_DURATION = { min: 0.5, max: 22 };

export async function soundEffect(options: {
  text: string;
  durationSeconds: number | null;
  promptInfluence: number;
}): Promise<GeneratedAudio> {
  const { base64, contentType } = await elevenlabsBytes({
    method: 'POST',
    url: 'https://api.elevenlabs.io/v1/sound-generation',
    json: {
      text: options.text,
      // null asks ElevenLabs to pick the length from the prompt itself.
      duration_seconds: options.durationSeconds,
      prompt_influence: options.promptInfluence,
    },
  });
  const blob = blobFromBase64(base64, contentType || 'audio/mpeg');
  return { url: URL.createObjectURL(blob), blob, extension: 'mp3', engine: 'byok' };
}

// -------------------------------------------------------------------- music ----

export const MUSIC_PROVIDERS = [
  { id: 'elevenlabs', label: 'ElevenLabs', hint: 'Exact length, 3s–10min. ~$0.01 per second.' },
  { id: 'gemini', label: 'Gemini (Lyria)', hint: 'Model-driven length. $0.04–$0.08 per track.' },
];

/**
 * Music runs on the managed endpoint rather than through the BYOK proxy: it is
 * a real music model (not a sound-effect prompt dressed up as one), it returns
 * a permanent URL instead of bytes, and it can render on either ElevenLabs or
 * Gemini's Lyria from the same request.
 */
export async function generateMusic(options: {
  prompt: string;
  lengthMs: number;
  provider: string;
  instrumental: boolean;
}): Promise<{ url: string; durationMs: number; provider: string; lengthClamped: boolean }> {
  const response = await fetch(`/api/workspaces/${workspaceId()}/audio/music/custom`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': workspaceToken() },
    body: JSON.stringify({
      prompt: options.prompt,
      lengthMs: options.lengthMs,
      instrumental: options.instrumental,
      provider: options.provider,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.audioUrl) {
    throw new Error(describeAudosError(data, response.status, 'The track could not be generated.'));
  }
  return {
    url: String(data.audioUrl),
    durationMs: Number(data.durationMs) || options.lengthMs,
    provider: String(data.provider || options.provider),
    lengthClamped: Boolean(data.lengthClamped),
  };
}

// ------------------------------------------------------------------ dubbing ----

export interface DubJob {
  dubbingId: string;
  expectedDurationSec: number;
}

export type DubStatus = 'dubbing' | 'dubbed' | 'failed';

/**
 * Dubbing reads its source from a URL rather than an uploaded file part: the
 * secrets proxy's multipart mode carries text fields only, so the file is put
 * in workspace storage first and ElevenLabs is handed the resulting public
 * `source_url`. Every other field is already text.
 */
export async function createDub(options: {
  sourceUrl: string;
  targetLang: string;
  sourceLang: string | null;
  numSpeakers: number | null;
  watermark: boolean;
  name: string;
}): Promise<DubJob> {
  const form: Record<string, string> = {
    source_url: options.sourceUrl,
    target_lang: options.targetLang,
    watermark: options.watermark ? 'true' : 'false',
  };
  if (options.sourceLang) form.source_lang = options.sourceLang;
  if (options.numSpeakers) form.num_speakers = String(options.numSpeakers);
  if (options.name.trim()) form.name = options.name.trim().slice(0, 120);

  const result = await elevenlabs<{ dubbing_id?: string; expected_duration_sec?: number }>({
    method: 'POST',
    url: 'https://api.elevenlabs.io/v1/dubbing',
    form,
    formEncoding: 'multipart',
  });
  const dubbingId = String(result.body?.dubbing_id || '');
  if (!dubbingId) throw new Error('ElevenLabs accepted the dub but returned no dubbing_id.');
  return { dubbingId, expectedDurationSec: Number(result.body?.expected_duration_sec) || 0 };
}

export async function dubStatus(dubbingId: string): Promise<{ status: DubStatus; error?: string; targetLanguages: string[] }> {
  const result = await elevenlabs<any>({
    method: 'GET',
    url: `https://api.elevenlabs.io/v1/dubbing/${encodeURIComponent(dubbingId)}`,
  });
  const raw = String(result.body?.status || 'dubbing').toLowerCase();
  const status: DubStatus = raw === 'dubbed' ? 'dubbed' : raw === 'failed' ? 'failed' : 'dubbing';
  return {
    status,
    error: result.body?.error ? String(result.body.error) : undefined,
    targetLanguages: Array.isArray(result.body?.target_languages) ? result.body.target_languages.map(String) : [],
  };
}

export async function dubbedTrack(dubbingId: string, languageCode: string): Promise<{ url: string; blob: Blob }> {
  const { base64, contentType } = await elevenlabsBytes({
    method: 'GET',
    url: `https://api.elevenlabs.io/v1/dubbing/${encodeURIComponent(dubbingId)}/audio/${encodeURIComponent(languageCode)}`,
  });
  const blob = blobFromBase64(base64, contentType || 'audio/mpeg');
  return { url: URL.createObjectURL(blob), blob };
}

// ------------------------------------------------------------------- errors ----

/**
 * The managed endpoints answer with a machine-readable `code`. A few of them
 * are not the founder's problem at all (the platform's shared ElevenLabs
 * account running out of credits, or having no free voice slot), and saying so
 * stops someone going to look for a key or a wallet top-up that would not help.
 */
function describeAudosError(data: any, status: number, fallback: string): string {
  const code = String(data?.code || '');
  const detail = String(data?.error || data?.message || '').trim();
  const map: Record<string, string> = {
    no_credentials: 'Your workspace session is not ready yet. Refresh the page and try again.',
    insufficient_balance: 'Your workspace wallet cannot cover this generation. Top it up and try again.',
    provider_quota_exceeded: 'The Audos-managed ElevenLabs account is out of credits right now. This is not your workspace wallet or your own API key — try again shortly.',
    voice_limit_reached: 'The Audos-managed ElevenLabs account has no free voice slots, so a new clone cannot be created right now.',
    voice_not_owned: 'That cloned voice belongs to another workspace.',
    voice_deleted: 'That voice has been deleted. Pick another one.',
    voice_not_found: 'ElevenLabs does not recognise that voice. Reload the voice list and pick again.',
    sample_too_large: 'One of those samples is over 10 MB. Trim it and try again.',
    samples_too_large: 'Those samples add up to more than 25 MB. Remove one and try again.',
    audio_too_large: 'That recording is over 25 MB. Split it and try again.',
    audio_too_long: 'That recording is longer than 5 minutes. Split it and try again.',
    unsupported_audio_type: 'That file type is not supported. Use MP3, WAV, M4A, AAC, FLAC, OGG or WEBM.',
    invalid_audio: 'That file could not be decoded as audio.',
    provider_rejected_text: 'ElevenLabs could not read that script. Try rewording it.',
    provider_rejected_audio: 'ElevenLabs could not process that audio.',
    gemini_music_not_configured: 'Gemini music is not configured on this platform. Switch the provider to ElevenLabs.',
    rate_limited: 'Too many requests at once. Wait a moment and try again.',
  };
  if (map[code]) return map[code];
  if (detail) return `${detail}${code ? ` [${code}]` : ''}`;
  return `${fallback} (${status})`;
}
