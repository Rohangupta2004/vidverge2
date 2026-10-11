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
//   * `voiceSettings` accepts exactly four fields and carries no model. The
//     MODEL, however, is not optional for a non-English film: ElevenLabs'
//     English turbo model reads Hindi as mangled phonetics, so the model is
//     chosen from the language (`getElevenLabsModel`) and sent at the TOP
//     level of the body, where an unknown key is ordinarily ignored rather
//     than validated. `postSpeech` below negotiates that once: a rejection
//     that names the field retries WITHOUT it and the verdict is remembered,
//     so no customer pays twice to learn the same thing.
import { uploadFile } from './proxy';
import { WORKSPACE_ID } from './supabase';

export const MODEL_NOTE = 'Audos does not expose a model switch on this endpoint, so SceneForge chooses the ElevenLabs model from the language: Hindi \u2014 and every other non-English language \u2014 narrates on the multilingual model, English on the faster turbo model. The four settings below are the full set of delivery controls the endpoint honours.';

// ——— Which ElevenLabs model narrates ———

/** The only model that speaks Hindi (and every other non-English language) properly. */
export const ELEVEN_MULTILINGUAL_MODEL = 'eleven_multilingual_v2';
/** The fast English model, kept as the English default. */
export const ELEVEN_ENGLISH_MODEL = 'eleven_turbo_v2';

// The project's `language` column is free text, so it arrives as a code
// ('hi', 'en-IN'), a name ('Hindi') or the market shorthand ('Hinglish').
const LANGUAGE_NAMES: Record<string, string> = {
  english: 'en', hindi: 'hi', hinglish: 'hi', bengali: 'bn', bangla: 'bn', tamil: 'ta', telugu: 'te',
  marathi: 'mr', punjabi: 'pa', gujarati: 'gu', kannada: 'kn', malayalam: 'ml', urdu: 'ur',
  spanish: 'es', french: 'fr', german: 'de', portuguese: 'pt', italian: 'it', dutch: 'nl',
  arabic: 'ar', japanese: 'ja', korean: 'ko', chinese: 'zh', mandarin: 'zh', russian: 'ru',
  indonesian: 'id', turkish: 'tr', polish: 'pl', vietnamese: 'vi', thai: 'th', filipino: 'fil',
};

/** The two-letter code behind whatever the project calls its language. */
export function languageCode(language?: string | null): string {
  const raw = String(language || '').trim().toLowerCase();
  if (!raw) return '';
  const named = LANGUAGE_NAMES[raw];
  if (named) return named;
  // 'en-IN', 'hi_IN', 'pt-BR' — the region does not change the model.
  const code = raw.replace(/_/g, '-').split('-')[0];
  return /^[a-z]{2,3}$/.test(code) ? code : (LANGUAGE_NAMES[code] || '');
}

/**
 * The ElevenLabs model a script in this language must be narrated with.
 *
 * Hindi — and anything else that is not English — goes to the multilingual
 * model; English keeps the faster turbo model. An unknown or empty language is
 * treated as English, which is what the app defaulted to before this existed.
 */
export function getElevenLabsModel(language?: string | null): string {
  const code = languageCode(language);
  if (!code || code === 'en') return ELEVEN_ENGLISH_MODEL;
  return ELEVEN_MULTILINGUAL_MODEL;
}

// Whether this platform build accepts an explicit model on the voiceover
// routes. Learned from one real request and remembered for the browser.
const MODEL_FIELD_KEY = 'sceneforge_eleven_model_field_v1';

function modelFieldSupported(): boolean {
  try { return window.localStorage.getItem(MODEL_FIELD_KEY) !== 'no'; } catch { return true; }
}
function rememberModelFieldSupport(supported: boolean) {
  try { window.localStorage.setItem(MODEL_FIELD_KEY, supported ? 'yes' : 'no'); } catch { /* private mode — this session still honours it */ }
}
/** Forget the verdict, so a platform change is picked up without a reload. */
export function resetElevenModelFieldSupport() {
  try { window.localStorage.removeItem(MODEL_FIELD_KEY); } catch { /* ignore */ }
}

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

/**
 * The voice's own id, whatever the catalog called it.
 *
 * ElevenLabs returns `voice_id`; the platform catalog re-exposes it as `id`;
 * the clone-create response uses `voiceId`. Reading only one of them is how
 * every voice in the picker ended up with `id: undefined` — unselectable,
 * unpreviewable, and then silently filtered out of the list, which looked to
 * the customer like a catalog that had lost their voices.
 */
export function elevenVoiceId(voice: any): string {
  const candidates = [voice?.id, voice?.voice_id, voice?.voiceId, voice?.voice?.voice_id, voice?.voice?.id, voice?.voice?.voiceId];
  for (const candidate of candidates) {
    const value = String(candidate ?? '').trim();
    if (value && value !== 'undefined' && value !== 'null') return value;
  }
  return '';
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
    id: elevenVoiceId(voice),
    // ElevenLabs ships marketing names like "Sarah - Mature, Reassuring".
    // The full string stays searchable; the UI shows the part before the dash.
    name: String(voice?.name || elevenVoiceId(voice) || 'Voice'),
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
  const views = (Array.isArray(voices) ? voices : []).map(elevenVoiceView);
  const usable = views.filter((view) => view.id);
  // A voice with no resolvable id cannot be selected, previewed or narrated
  // with, so it has to go — but LOUDLY. Dropping them in silence is exactly how
  // a field-name mismatch emptied this picker without a single console line.
  if (usable.length < views.length) {
    console.warn(
      `[SceneForge] ${views.length - usable.length} of ${views.length} ElevenLabs voices arrived with no usable voice id and were left out of the picker.`,
      views.filter((view) => !view.id).map((view) => view.raw),
    );
  }
  return usable.sort((a, b) => Number(b.indian) - Number(a.indian)
    || Number(b.category === 'cloned') - Number(a.category === 'cloned')
    || shortVoiceName(a.name).localeCompare(shortVoiceName(b.name)));
}

// ——— Language grouping, for the picker's language filter ———

export type VoiceLanguageGroup = 'en' | 'hi' | 'other';

/** The labelled Hindi voice the platform catalog ships; it leads the Hindi list. */
export const HINDI_LEAD_VOICE = 'Suman';

const HINDI_WORDS = /(hindi|hinglish)/i;
const HINDI_LEAD_PATTERN = new RegExp(`\\b${HINDI_LEAD_VOICE}\\b`, 'i');

/** True when ElevenLabs itself labels this voice as a Hindi speaker. */
export function speaksHindi(voice: ElevenVoice): boolean {
  if (String(voice.language || '').trim().toLowerCase().startsWith('hi')) return true;
  if (HINDI_WORDS.test(`${voice.language} ${voice.accent} ${voice.descriptor} ${voice.useCase}`)) return true;
  return HINDI_LEAD_PATTERN.test(String(voice.name || ''));
}

/**
 * Which group the picker's language filter puts this voice in.
 *
 * An UNLABELLED voice counts as English: most of the premade catalog carries no
 * `labels.language` at all, so reading absence as "other" would hide half the
 * list behind a filter the customer never asked for. Only an explicitly
 * non-English, non-Hindi label reads as 'other'.
 *
 * This is a grouping for ORDERING and an optional filter — never a hard gate.
 * Every voice in the catalog can narrate Hindi through the multilingual model
 * (`getElevenLabsModel`), which is why the Hindi view ranks rather than hides.
 */
export function voiceLanguageGroup(voice: ElevenVoice): VoiceLanguageGroup {
  if (speaksHindi(voice)) return 'hi';
  const label = String(voice.language || '').trim();
  if (!label || /english/i.test(label) || label.toLowerCase().split(/[-_]/)[0] === 'en') return 'en';
  return 'other';
}

/** Hindi ordering: the labelled Hindi lead, then other Hindi labels, then the rest. */
export function hindiRank(voice: ElevenVoice): number {
  if (HINDI_LEAD_PATTERN.test(String(voice.name || ''))) return 0;
  if (speaksHindi(voice)) return 1;
  if (voice.indian) return 2;
  return 3;
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
        const voices = sortElevenVoices(payload.voices);
        // A response whose every entry lost its id is not a usable catalog:
        // fall through to the public route rather than paint an empty picker.
        if (voices.length) return { voices, includesCloned: true };
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
  const voiceId = elevenVoiceId(payload?.voice) || elevenVoiceId(payload);
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

/** Per-request narration choices that are not delivery settings. */
export interface SpeechOptions {
  /** The film's language. Chooses the model via `getElevenLabsModel`. */
  language?: string | null;
  /** Overrides the language-derived model outright (debugging, A/B). */
  modelId?: string;
}

/** The model THIS request narrates with: explicit choice, then the language. */
export function speechModelId(options: SpeechOptions = {}): string {
  return String(options.modelId || getElevenLabsModel(options.language) || '');
}

/**
 * True when a rejection is the endpoint saying "I do not take a model field"
 * rather than "this request was wrong". Quota, balance, rate-limit and
 * credential failures are explicitly NOT this — retrying those without the
 * model would bill a second attempt for nothing.
 */
function isModelFieldRejection(error: ElevenLabsError): boolean {
  if (error.status !== 400 && error.status !== 422) return false;
  if (/quota|balance|rate|credential|voice/i.test(error.code || '')) return false;
  return /model|unexpected|unknown\s+(?:field|key|propert)|additional\s+propert|not\s+allowed|invalid\s+(?:body|request|payload)/i.test(error.message);
}

/**
 * POST one voiceover request, negotiating the model field exactly once.
 *
 * `body(withModel)` is asked for the payload WITH the model first. A rejection
 * that names the field retries without it and the verdict is remembered for the
 * browser, so a platform build that ignores the field costs one extra request
 * ever rather than one per narration.
 */
async function postSpeech(path: string, body: (withModel: boolean) => unknown, token: string): Promise<any> {
  const wanted = modelFieldSupported();
  for (let attempt = 0; ; attempt += 1) {
    const withModel = wanted && attempt === 0;
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
      body: JSON.stringify(body(withModel)),
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok && payload?.success !== false) {
      if (withModel) rememberModelFieldSupport(true);
      return payload;
    }
    const error = describe(payload, response.status);
    if (!withModel || !isModelFieldRejection(error)) throw error;
    rememberModelFieldSupport(false);
    console.warn('[SceneForge] The voice endpoint refused an explicit ElevenLabs model, so narration falls back to the platform default. A non-English script may lose multilingual pronunciation.', error);
  }
}

/**
 * Narrate the script in the chosen voice.
 *
 * This is the step that replaces HeyGen's own TTS: the MP3 it returns becomes
 * HeyGen's voice source, so the avatar's lips are driven by the ElevenLabs
 * performance rather than by HeyGen re-reading the text.
 */
export async function speak(script: string, voiceId: string, settings: VoiceSettings, options: SpeechOptions = {}): Promise<Voiceover> {
  const text = String(script || '').trim();
  if (!text) throw new ElevenLabsError('Write the script before generating the voiceover.');
  if (text.length > MAX_SCRIPT_CHARS) {
    throw new ElevenLabsError(`The script is ${text.length} characters; ElevenLabs takes at most ${MAX_SCRIPT_CHARS} per request. Trim it and try again.`);
  }
  if (!voiceId) throw new ElevenLabsError('Pick a voice before generating the voiceover.');
  const token = softToken();
  if (!token) throw new ElevenLabsError('Your workspace session is not ready yet. Refresh the page and try again.', 'no_credentials', 401);

  const modelId = speechModelId(options);
  const payload = await postSpeech(
    `/api/workspaces/${encodeURIComponent(workspace())}/audio/voiceover`,
    (withModel) => ({
      script: text,
      voiceId,
      voiceSettings: clampSettings(settings),
      ...(withModel && modelId ? { modelId, model_id: modelId } : {}),
    }),
    token,
  );
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
export async function speakSegments(lines: string[], voiceId: string, settings: VoiceSettings, options: SpeechOptions = {}): Promise<SpokenSegments> {
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

  // The model is sent BOTH at the top level and on every segment. One batch is
  // one request, so there is no "first segment" to set it on — but a build that
  // reads the model per segment would otherwise narrate beat 1 in Hindi and the
  // rest in English, which is the exact bug this covers.
  const modelId = speechModelId(options);
  const payload = await postSpeech(
    `/api/workspaces/${encodeURIComponent(workspace())}/audio/voiceover/segments`,
    (withModel) => ({
      segments: texts.map((text) => ({ text, ...(withModel && modelId ? { modelId, model_id: modelId } : {}) })),
      voiceId,
      voiceSettings: clampSettings(settings),
      ...(withModel && modelId ? { modelId, model_id: modelId } : {}),
    }),
    token,
  );
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
export function previewVoiceSample(voice: Pick<ElevenVoice, 'id' | 'previewUrl'>, settings: VoiceSettings = DEFAULT_VOICE_SETTINGS, options: SpeechOptions = {}): Promise<string> {
  if (voice.previewUrl) return Promise.resolve(voice.previewUrl);
  const key = String(voice.id || '');
  const cached = sampleCache.get(key);
  if (cached) return cached;
  const pending = speak(PREVIEW_SAMPLE_LINE, key, settings, options).then((spoken) => spoken.url);
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
