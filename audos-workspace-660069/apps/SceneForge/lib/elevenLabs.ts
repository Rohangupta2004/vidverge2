// SceneForge's ElevenLabs layer — the voice half of the
// Script -> ElevenLabs -> HeyGen -> MP4 pipeline.
//
// It talks to the PLATFORM's native elevenlabs-audio capability, never to
// ElevenLabs directly and never with a founder-supplied key: the platform
// holds the credential and bills the workspace wallet server-side.
//
// THE CONTRACT, as the platform actually implements it (verified against the
// live endpoints on 5 Oct 2026, not assumed):
//   * `GET /api/voices` is a PUBLIC, free catalog read. No token. It answers
//     { success, voices: [{ id, name, category, labels, previewUrl }] }.
//   * `GET /api/workspaces/:id/audio/voices` needs the workspace token and
//     answers the same shape, with this workspace's CLONED voices first.
//     That is the one that returns everything, so it is tried first.
//   * `POST /api/workspaces/:id/audio/voiceover` answers
//     { success, audioUrl, estimatedDurationMs } — a PERMANENT public MP3 URL
//     on Google Cloud Storage. It does NOT return base64. `speak()` still
//     decodes a base64 body if one ever arrives, because a Blob the browser
//     made is useless to HeyGen and would have to be re-hosted; see
//     `toDurableAudio`.
//   * `POST /api/workspaces/:id/audio/voiceover/segments` takes
//     { segments: [{ text }], voiceId, voiceSettings } and answers
//     { success, segments: [{ text, audioUrl, durationMs }], totalDurationMs }
//     — one MP3 per segment, in order, each with its MEASURED length. That
//     is the per-scene primitive: a storyboard of N scenes is one request,
//     not N, and the durations come back without a browser decode.
//   * `voiceSettings` accepts exactly four fields. There is NO `model_id` on
//     this endpoint (only the speech-to-speech endpoint takes a `modelId`),
//     so none is sent — an undocumented field risks a 400 that costs the
//     customer a generation. MODEL_NOTE is what the UI tells them instead.
import { uploadFile } from './proxy';
import { WORKSPACE_ID } from './supabase';

export const MODEL_NOTE = 'Audos runs ElevenLabs\u2019 multilingual model for this endpoint and does not expose a model switch, so the four settings below are the full set of controls it honours.';

/** Thrown by every call here, carrying the platform's machine-readable code. */
export class ElevenLabsError extends Error {
  code: string;
  status: number;
  constructor(message: string, code = '', status = 0) {
    super(message);
    this.name = 'ElevenLabsError';
    this.code = code;
    this.status = status;
  }
}

function softToken(): string {
  const token = (window as any).__workspaceDb?.token;
  return token ? String(token) : '';
}
function workspace(): string {
  return String((window as any).__workspaceDb?.workspaceId || WORKSPACE_ID);
}

/**
 * Turn a rejection into a sentence the customer can act on. The platform
 * names the reason in `code`; `provider_quota_exceeded` is the one that reads
 * like the founder's problem and is not — it is the PLATFORM's shared
 * ElevenLabs account, so it must never be relayed as "add your API key".
 */
function describe(payload: any, status: number): ElevenLabsError {
  const code = String(payload?.code || '');
  const detail = String(payload?.error || payload?.message || `The voice service answered ${status}.`);
  if (code === 'provider_quota_exceeded') {
    return new ElevenLabsError('The platform\u2019s shared ElevenLabs account is out of credits right now. This is not your workspace, your wallet or a limit in this app \u2014 try again shortly.', code, status);
  }
  if (code === 'invalid_voice_name') {
    return new ElevenLabsError('Name your voice using 1\u201380 characters.', code, status);
  }
  if (code === 'no_samples') {
    return new ElevenLabsError('Add at least one audio sample before cloning your voice.', code, status);
  }
  if (code === 'too_many_samples') {
    return new ElevenLabsError('Choose no more than five audio samples for one voice.', code, status);
  }
  if (code === 'sample_too_large') {
    return new ElevenLabsError('Each audio sample must be 10 MB or smaller.', code, status);
  }
  if (code === 'samples_too_large') {
    return new ElevenLabsError('Keep all audio samples together at 25 MB or less.', code, status);
  }
  if (code === 'unsupported_audio_type') {
    return new ElevenLabsError('Use MP3, WAV, WebM, OGG, M4A, AAC or FLAC audio samples.', code, status);
  }
  if (code === 'voice_limit_reached') {
    return new ElevenLabsError('The platform\u2019s shared ElevenLabs account has no free voice-cloning slots right now. This is not a problem with your workspace or API key, and retrying will not help until the platform frees capacity.', code, status);
  }
  if (code === 'voice_not_owned') {
    return new ElevenLabsError('This cloned voice does not belong to this workspace, so it cannot be changed here.', code, status);
  }
  if (code === 'voice_deleted') {
    return new ElevenLabsError('That cloned voice was deleted. Pick another voice.', code, status);
  }
  if (code === 'no_credentials' || status === 401) {
    return new ElevenLabsError('Your workspace session is not ready yet. Refresh the page and try again.', code || 'no_credentials', status);
  }
  if (code === 'insufficient_balance') {
    return new ElevenLabsError('The workspace wallet cannot cover this audio request. Top it up and try again.', code, status);
  }
  if (code === 'rate_limited') {
    const wait = Number(payload?.retryAfterSeconds) || 0;
    return new ElevenLabsError(`The voice service is busy.${wait ? ` Try again in ${wait}s.` : ' Try again in a moment.'}`, code, status);
  }
  return new ElevenLabsError(code ? `${detail} [${code}]` : detail, code, status);
}

// ——— The catalog ———

export interface ElevenVoice {
  id: string;
  name: string;
  /** 'premade' | 'professional' | 'cloned' — whatever ElevenLabs reported. */
  category: string;
  /** A readable 'Hindi · Bengali accent' style line built from the labels. */
  descriptor: string;
  language: string;
  accent: string;
  gender: string;
  useCase: string;
  previewUrl: string;
  indian: boolean;
  /** Why it was badged, so the badge can explain itself instead of asserting. */
  indianReason: string;
  raw: any;
}

// Indian-language ISO codes. Matched by EQUALITY against labels.language, not
// as substrings: 'or' (Odia) and 'as' (Assamese) appear inside ordinary words
// and a substring test would badge most of the catalog.
const INDIAN_LANGUAGE_CODES = new Set(['hi', 'ta', 'te', 'bn', 'mr', 'pa', 'gu', 'kn', 'ml', 'ur', 'or', 'as', 'ne', 'sd', 'kok']);

// Spelled-out languages and regional accents, matched anywhere in the labels.
const INDIAN_LANGUAGE_WORDS = /(hindi|hinglish|tamil|telugu|bengali|bangla|marathi|punjabi|panjabi|gujarati|kannada|malayalam|urdu|odia|oriya|assamese|konkani|bhojpuri|nepali)/i;

// The explicit markers Otto asked for, plus the locale forms HeyGen and
// ElevenLabs both use.
const INDIAN_MARKERS = /(\bindian?\b|\bindia\b|south[\s-]?asian|\bdesi\b|en[-_]in\b|hi[-_]in\b)/i;

// Name-only fallback for a voice whose labels carry no region at all. The
// four names Otto named lead; the rest are the same conservative list the
// HeyGen catalog already uses, so both pickers agree on what "Indian" means.
const INDIAN_NAMES = /\b(meera|mira|rishi|kavya|aarav|aditi|aisha|ajay|amit|ananya|anil|anjali|arjun|deepa|deepika|divya|farhan|gauri|isha|ishaan|kiran|krishna|lakshmi|manish|neha|nikhil|nisha|pooja|priya|rahul|raj|rajesh|rani|ravi|riya|rohan|sanjay|shreya|sneha|suman|sunita|tanvi|varun|vikram|zara)\b/i;

function labelBlob(voice: any): string {
  const labels = voice?.labels && typeof voice.labels === 'object' ? voice.labels : {};
  return Object.values(labels).filter(Boolean).map(String).join(' ');
}

/** Why this voice is Indian, or '' when it is not. Order = authority. */
export function indianReasonFor(voice: any): string {
  const labels = voice?.labels && typeof voice.labels === 'object' ? voice.labels : {};
  const name = String(voice?.name || '');
  const language = String(labels.language || '').trim().toLowerCase();
  const accent = String(labels.accent || '').trim().toLowerCase();
  const blob = `${labelBlob(voice)} ${name}`;

  if (language && INDIAN_LANGUAGE_CODES.has(language)) return `Speaks an Indian language (${language}).`;
  if (accent && (INDIAN_MARKERS.test(accent) || INDIAN_LANGUAGE_WORDS.test(accent))) return `Tagged with an Indian accent (${accent}).`;
  if (INDIAN_MARKERS.test(blob)) return 'Labelled Indian / South Asian by ElevenLabs.';
  if (INDIAN_LANGUAGE_WORDS.test(blob)) return 'Labelled with an Indian language.';
  if (INDIAN_NAMES.test(name)) return 'Matched on an Indian given name.';
  return '';
}

export function elevenVoiceView(voice: any): ElevenVoice {
  const labels = voice?.labels && typeof voice.labels === 'object' ? voice.labels : {};
  const language = String(labels.language || '').trim();
  const accent = String(labels.accent || '').trim();
  const gender = String(labels.gender || '').trim();
  const useCase = String(labels.use_case || labels.descriptive || '').trim().replace(/_/g, ' ');
  const reason = indianReasonFor(voice);
  return {
    id: String(voice?.id ?? voice?.voice_id ?? ''),
    // ElevenLabs ships marketing names like "Sarah - Mature, Reassuring".
    // The full string stays searchable; the UI shows the part before the dash.
    name: String(voice?.name || voice?.id || 'Voice'),
    category: String(voice?.category || '').trim(),
    descriptor: [language, accent ? `${accent} accent` : '', gender, useCase].filter(Boolean).join(' \u00b7 '),
    language,
    accent,
    gender,
    useCase,
    previewUrl: String(voice?.previewUrl || voice?.preview_url || ''),
    indian: Boolean(reason),
    indianReason: reason,
    raw: voice,
  };
}

/** The short display name, with ElevenLabs' marketing tail removed. */
export function shortVoiceName(name: string): string {
  return String(name || '').split(' - ')[0].trim() || String(name || 'Voice');
}

/** Indian voices first, then this workspace's clones, then alphabetical. */
export function sortElevenVoices(voices: any[]): ElevenVoice[] {
  return voices
    .map(elevenVoiceView)
    .filter((view) => view.id)
    .sort((a, b) => Number(b.indian) - Number(a.indian)
      || Number(b.category === 'cloned') - Number(a.category === 'cloned')
      || shortVoiceName(a.name).localeCompare(shortVoiceName(b.name)));
}

export interface VoiceCatalog {
  voices: ElevenVoice[];
  /** True when the token-gated read ran, so cloned voices are included. */
  includesCloned: boolean;
}

/**
 * Every voice this workspace can use.
 *
 * The workspace-scoped read is tried first because it is the only one that
 * includes cloned voices; the public catalog is the fallback so a session
 * whose token has not landed yet still gets a usable picker instead of an
 * error.
 */
export async function fetchElevenVoices(): Promise<VoiceCatalog> {
  const token = softToken();
  if (token) {
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspace())}/audio/voices`, {
        headers: { 'X-Workspace-DB-Token': token },
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && Array.isArray(payload?.voices) && payload.voices.length) {
        return { voices: sortElevenVoices(payload.voices), includesCloned: true };
      }
    } catch { /* fall through to the public catalog */ }
  }
  const response = await fetch('/api/voices');
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(payload?.voices)) throw describe(payload, response.status);
  return { voices: sortElevenVoices(payload.voices), includesCloned: false };
}

// ——— Workspace-private voice cloning ———

export const MAX_CLONE_SAMPLES = 5;
export const MAX_CLONE_SAMPLE_BYTES = 10 * 1024 * 1024;
export const MAX_CLONE_TOTAL_BYTES = 25 * 1024 * 1024;
export const CLONE_AUDIO_ACCEPT = '.mp3,.wav,.webm,.ogg,.m4a,.aac,.flac,audio/mpeg,audio/wav,audio/webm,audio/ogg,audio/mp4,audio/aac,audio/flac';

const CLONE_EXTENSIONS = new Set(['mp3', 'wav', 'webm', 'ogg', 'm4a', 'aac', 'flac']);
const CLONE_MIME_TYPES = new Set([
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/webm',
  'audio/ogg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/flac', 'audio/x-flac',
]);

function validateClone(name: string, files: File[]): { name: string; files: File[] } {
  const cleanName = String(name || '').trim();
  const samples = Array.from(files || []);
  if (!cleanName || cleanName.length > 80) throw new ElevenLabsError('Name your voice using 1\u201380 characters.', 'invalid_voice_name', 400);
  if (!samples.length) throw new ElevenLabsError('Add at least one audio sample before cloning your voice.', 'no_samples', 400);
  if (samples.length > MAX_CLONE_SAMPLES) throw new ElevenLabsError('Choose no more than five audio samples for one voice.', 'too_many_samples', 400);
  if (samples.some((file) => file.size > MAX_CLONE_SAMPLE_BYTES)) {
    throw new ElevenLabsError('Each audio sample must be 10 MB or smaller.', 'sample_too_large', 413);
  }
  if (samples.reduce((total, file) => total + file.size, 0) > MAX_CLONE_TOTAL_BYTES) {
    throw new ElevenLabsError('Keep all audio samples together at 25 MB or less.', 'samples_too_large', 413);
  }
  const unsupported = samples.some((file) => {
    const extension = String(file.name || '').split('.').pop()?.toLowerCase() || '';
    const mime = String(file.type || '').split(';')[0].toLowerCase();
    return !CLONE_EXTENSIONS.has(extension) && !CLONE_MIME_TYPES.has(mime);
  });
  if (unsupported) throw new ElevenLabsError('Use MP3, WAV, WebM, OGG, M4A, AAC or FLAC audio samples.', 'unsupported_audio_type', 415);
  return { name: cleanName, files: samples };
}

export interface ClonedVoiceResult {
  voiceId: string;
  name: string;
  createdAt: string;
}

/** Create one $1 workspace-private instant clone from 1\u20135 clean samples. */
export async function cloneElevenVoice(name: string, files: File[]): Promise<ClonedVoiceResult> {
  const input = validateClone(name, files);
  const token = softToken();
  if (!token) throw new ElevenLabsError('Your workspace session is not ready yet. Refresh the page and try again.', 'no_credentials', 401);

  const form = new FormData();
  form.append('name', input.name);
  input.files.forEach((file) => form.append('files', file, file.name || `voice-sample-${Date.now()}.webm`));
  const response = await fetch(`/api/workspaces/${encodeURIComponent(workspace())}/audio/voices`, {
    method: 'POST',
    // Deliberately ONLY the token: the browser must add the multipart boundary.
    headers: { 'X-Workspace-DB-Token': token },
    body: form,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) throw describe(payload, response.status);
  const voiceId = String(payload?.voice?.voiceId || '');
  if (!voiceId) throw new ElevenLabsError('The voice was created, but the service did not return its ID. Refresh the catalog before trying again.');
  return {
    voiceId,
    name: String(payload?.voice?.name || input.name),
    createdAt: String(payload?.voice?.createdAt || ''),
  };
}

/** Delete a cloned voice that belongs to this workspace. */
export async function deleteElevenVoice(voiceId: string): Promise<void> {
  const id = String(voiceId || '').trim();
  if (!id) throw new ElevenLabsError('Choose a cloned voice to delete.');
  const token = softToken();
  if (!token) throw new ElevenLabsError('Your workspace session is not ready yet. Refresh the page and try again.', 'no_credentials', 401);
  const response = await fetch(`/api/workspaces/${encodeURIComponent(workspace())}/audio/voices/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'X-Workspace-DB-Token': token },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) throw describe(payload, response.status);
}

// ——— Voice settings ———

export interface VoiceSettings {
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
}

/** The platform's own defaults, restated so the sliders open where it does. */
export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  stability: 0.3,
  similarity_boost: 0.75,
  style: 0.4,
  use_speaker_boost: true,
};

/** A presenter-ready preset: steadier than the default, still expressive. */
export const PRESENTER_VOICE_SETTINGS: VoiceSettings = {
  stability: 0.45,
  similarity_boost: 0.85,
  style: 0.35,
  use_speaker_boost: true,
};

/** Values outside 0–1 are a hard 400, so they are clamped before sending. */
export function clampSettings(settings: VoiceSettings): VoiceSettings {
  const unit = (value: number, fallback: number) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.min(1, Math.round(parsed * 100) / 100));
  };
  return {
    stability: unit(settings.stability, DEFAULT_VOICE_SETTINGS.stability),
    similarity_boost: unit(settings.similarity_boost, DEFAULT_VOICE_SETTINGS.similarity_boost),
    style: unit(settings.style, DEFAULT_VOICE_SETTINGS.style),
    use_speaker_boost: settings.use_speaker_boost !== false,
  };
}

/** The platform rejects a longer script with a 400 before anything is billed. */
export const MAX_SCRIPT_CHARS = 10000;

// ——— Speech ———

export interface Voiceover {
  /** Always a PUBLIC url HeyGen can fetch — never a blob: url. */
  url: string;
  /** A blob: url when the bytes are already local, for instant playback. */
  playbackUrl: string;
  estimatedDurationMs: number;
}

function base64ToBlob(base64: string, mime = 'audio/mpeg'): Blob {
  const clean = String(base64).replace(/^data:[^;]+;base64,/, '');
  const binary = window.atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * Normalise whatever the endpoint returned into something HeyGen can fetch.
 *
 * The documented answer is a public `audioUrl` and that is used as-is. A
 * base64 body is decoded for local playback AND uploaded to workspace
 * storage, because HeyGen pulls the audio from a URL on its own servers and
 * a `blob:` url only exists inside this tab.
 */
async function toDurableAudio(payload: any, estimatedDurationMs: number): Promise<Voiceover> {
  const direct = String(payload?.audioUrl || payload?.audio_url || payload?.url || '');
  if (direct) return { url: direct, playbackUrl: direct, estimatedDurationMs };

  const encoded = payload?.audioBase64 || payload?.audio_base64 || (payload?.encoding === 'base64' ? payload?.audio : '');
  if (!encoded) throw new ElevenLabsError('The voice service answered without any audio. Try again.');
  const blob = base64ToBlob(String(encoded), String(payload?.contentType || payload?.mimeType || 'audio/mpeg'));
  const playbackUrl = URL.createObjectURL(blob);
  const stored = await uploadFile(new File([blob], `voiceover-${Date.now()}.mp3`, { type: blob.type }), 'sceneforge-v2/elevenlabs');
  return { url: stored.url, playbackUrl, estimatedDurationMs };
}

/**
 * Narrate the script in the chosen voice.
 *
 * This is the step that replaces HeyGen's own TTS: the MP3 it returns becomes
 * HeyGen's voice source, so the avatar's lips are driven by the ElevenLabs
 * performance rather than by HeyGen re-reading the text.
 */
export async function speak(script: string, voiceId: string, settings: VoiceSettings): Promise<Voiceover> {
  const text = String(script || '').trim();
  if (!text) throw new ElevenLabsError('Write the script before generating the voiceover.');
  if (text.length > MAX_SCRIPT_CHARS) {
    throw new ElevenLabsError(`The script is ${text.length} characters; ElevenLabs takes at most ${MAX_SCRIPT_CHARS} per request. Trim it and try again.`);
  }
  if (!voiceId) throw new ElevenLabsError('Pick a voice before generating the voiceover.');
  const token = softToken();
  if (!token) throw new ElevenLabsError('Your workspace session is not ready yet. Refresh the page and try again.', 'no_credentials', 401);

  const response = await fetch(`/api/workspaces/${encodeURIComponent(workspace())}/audio/voiceover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
    body: JSON.stringify({ script: text, voiceId, voiceSettings: clampSettings(settings) }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) throw describe(payload, response.status);
  return toDurableAudio(payload, Number(payload?.estimatedDurationMs) || 0);
}

/** The segments route refuses more than this many lines in one request. */
export const MAX_SEGMENTS = 100;
/** …and more than this many characters across all of them combined. */
export const MAX_SEGMENTS_CHARS = 20000;

export interface SpokenSegment {
  text: string;
  /** A PUBLIC MP3 url, same storage as `speak()` returns. */
  audioUrl: string;
  /** The real length of this line's audio, measured server-side. */
  durationMs: number;
}

export interface SpokenSegments {
  segments: SpokenSegment[];
  totalDurationMs: number;
}

/**
 * Narrate several lines in ONE request — one MP3 per line, in the order they
 * were given, each with its measured duration.
 *
 * This is how a storyboard gets a voice: every scene's line goes in together,
 * so a ten-scene film is one billed call and one round trip rather than ten,
 * and each scene keeps its own clip so it can be re-timed, muted or lip-synced
 * on its own. Blank lines are rejected up front because the service would
 * refuse the whole batch over one empty entry.
 */
export async function speakSegments(lines: string[], voiceId: string, settings: VoiceSettings): Promise<SpokenSegments> {
  const texts = (lines || []).map((line) => String(line || '').trim());
  if (!texts.length) throw new ElevenLabsError('There are no lines to narrate yet.');
  const blank = texts.findIndex((text) => !text);
  if (blank >= 0) throw new ElevenLabsError(`Line ${blank + 1} is empty. Every segment needs text before the batch can be narrated.`);
  if (texts.length > MAX_SEGMENTS) {
    throw new ElevenLabsError(`That is ${texts.length} lines; ElevenLabs narrates at most ${MAX_SEGMENTS} per request. Narrate the film in parts.`);
  }
  const combined = texts.reduce((total, text) => total + text.length, 0);
  if (combined > MAX_SEGMENTS_CHARS) {
    throw new ElevenLabsError(`The lines add up to ${combined} characters; ElevenLabs takes at most ${MAX_SEGMENTS_CHARS} per batch. Trim them and try again.`);
  }
  if (!voiceId) throw new ElevenLabsError('Pick a voice before generating the voiceover.');
  const token = softToken();
  if (!token) throw new ElevenLabsError('Your workspace session is not ready yet. Refresh the page and try again.', 'no_credentials', 401);

  const response = await fetch(`/api/workspaces/${encodeURIComponent(workspace())}/audio/voiceover/segments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
    body: JSON.stringify({ segments: texts.map((text) => ({ text })), voiceId, voiceSettings: clampSettings(settings) }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) throw describe(payload, response.status);
  const rows: any[] = Array.isArray(payload?.segments) ? payload.segments : [];
  if (rows.length !== texts.length) {
    throw new ElevenLabsError(`The voice service returned ${rows.length} clips for ${texts.length} lines. Try again.`);
  }
  const segments: SpokenSegment[] = rows.map((row, index) => {
    const audioUrl = String(row?.audioUrl || row?.audio_url || row?.url || '');
    if (!audioUrl) throw new ElevenLabsError(`Line ${index + 1} came back without audio. Try again.`);
    return { text: String(row?.text || texts[index]), audioUrl, durationMs: Math.max(0, Number(row?.durationMs ?? row?.duration_ms) || 0) };
  });
  const total = Number(payload?.totalDurationMs) || segments.reduce((sum, segment) => sum + segment.durationMs, 0);
  return { segments, totalDurationMs: total };
}

// ——— Voice preview ———

/** The one line every billed preview speaks, so two voices are compared on equal footing. */
export const PREVIEW_SAMPLE_LINE = 'Hello! This is a quick sample of how I sound, so you can decide whether this is the voice for your film.';

// Premade voices ship a free previewUrl; a cloned voice has none, so hearing
// it means paying for one short generation. The result is kept for the rest
// of the session (keyed by voice only — the sample exists to compare voices,
// not settings) so pressing Preview twice never bills twice.
const sampleCache = new Map<string, Promise<string>>();

/** True when the voice already has a sample ready, so Preview will be free and instant. */
export function hasCachedSample(voiceId: string): boolean {
  return sampleCache.has(String(voiceId || ''));
}

/**
 * A playable sample URL for a voice: the catalog preview when ElevenLabs
 * provides one, otherwise one billed short generation, cached per session.
 */
export function previewVoiceSample(voice: Pick<ElevenVoice, 'id' | 'previewUrl'>, settings: VoiceSettings = DEFAULT_VOICE_SETTINGS): Promise<string> {
  if (voice.previewUrl) return Promise.resolve(voice.previewUrl);
  const key = String(voice.id || '');
  const cached = sampleCache.get(key);
  if (cached) return cached;
  const pending = speak(PREVIEW_SAMPLE_LINE, key, settings).then((spoken) => spoken.url);
  sampleCache.set(key, pending);
  // A failed generation must not poison the cache, or the voice could never be previewed again.
  pending.catch(() => { if (sampleCache.get(key) === pending) sampleCache.delete(key); });
  return pending;
}

/**
 * The real length of a finished track, read in the browser. The endpoint's
 * `estimatedDurationMs` is an estimate from the script, and the motion editor
 * times every overlay against the video, so the measured value is worth the
 * extra second it takes. Falls back to the estimate when metadata will not
 * load rather than blocking the pipeline.
 */
export function measureAudioDuration(url: string, fallbackMs = 0): Promise<number> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ms: number) => { if (!settled) { settled = true; resolve(ms); } };
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) && audio.duration > 0 ? Math.round(audio.duration * 1000) : fallbackMs);
    audio.onerror = () => done(fallbackMs);
    window.setTimeout(() => done(fallbackMs), 8000);
    audio.src = url;
  });
}
