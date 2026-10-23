/**
 * NATIVE ELEVENLABS — the shared voice catalog and speech layer.
 *
 * Every call here goes to the platform's managed ElevenLabs endpoints and is
 * billed to the workspace wallet. There is NO ElevenLabs API key in this
 * bundle and none is needed; the only credential is the workspace token, and
 * an anonymous call is refused with 401 `no_credentials` before ElevenLabs is
 * contacted.
 *
 *   GET  /api/voices                                  public premade catalog
 *   GET  /api/workspaces/:id/audio/voices             clones + premade catalog
 *   POST /api/workspaces/:id/audio/voiceover          one script → one MP3
 *   POST /api/workspaces/:id/audio/voiceover/segments 1–100 lines in one call
 *
 * The two catalog reads are merged rather than chosen between. The workspace
 * route is the one that carries this workspace's own cloned voices, the public
 * route occasionally carries premades the workspace route has not picked up,
 * and the product promise is EVERY available voice — so both are read and the
 * union is de-duplicated by voice id. Nothing in this file slices the list.
 */

import {
  NARRATION_MODEL,
  NARRATION_MODEL_FAST,
  elevenVoiceSettings,
  isElevenModelRejection,
  narrationModelForChars,
  nextNarrationModel,
  type ElevenModelId,
} from './elevenLabsModels';

export interface Voice {
  id: string;
  name: string;
  /** 'cloned' is this workspace's own voice; 'premade' is the shared catalog. */
  category: string;
  accent?: string;
  gender?: string;
  age?: string;
  language?: string;
  useCase?: string;
  description?: string;
  /** ElevenLabs' own sample. Cloned voices have none — see sampleFor(). */
  previewUrl?: string;
}

export interface VoiceSettings {
  stability?: number;
  similarity_boost?: number;
  style?: number;
  use_speaker_boost?: boolean;
}

/** Expressive but steady — a reasonable default for narration and dialogue. */
export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  stability: 0.4,
  similarity_boost: 0.8,
  style: 0.4,
  use_speaker_boost: true,
};

/** ElevenLabs' own default voice, used when nothing has been chosen yet. */
export const FALLBACK_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL';

export function workspaceId(): string {
  if (typeof window === 'undefined') return 'workspace-660069';
  const w = window as any;
  return String(w.__workspaceDb?.workspaceId || w.__WORKSPACE_ID__ || 'workspace-660069');
}

function token(): string {
  if (typeof window === 'undefined') return '';
  return String((window as any).__workspaceDb?.token || '');
}

function authHeaders(): Record<string, string> {
  const value = token();
  if (!value) {
    throw new Error('Your workspace session is not ready yet. Refresh the page and try again.');
  }
  return { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': value };
}

export function hasWorkspaceToken(): boolean {
  return Boolean(token());
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

function toVoice(raw: any): Voice | null {
  const id = String(raw?.id || raw?.voice_id || raw?.voiceId || '');
  if (!id) return null;
  const labels = raw?.labels || {};
  return {
    id,
    name: String(raw?.name || 'Unnamed voice'),
    category: String(raw?.category || 'premade'),
    accent: labels.accent ? String(labels.accent) : undefined,
    gender: labels.gender ? String(labels.gender) : undefined,
    age: labels.age ? String(labels.age) : undefined,
    language: labels.language ? String(labels.language) : undefined,
    useCase: labels.use_case || labels.useCase || labels.usecase
      ? String(labels.use_case || labels.useCase || labels.usecase)
      : undefined,
    description: [labels.description, raw?.description].filter(Boolean).join(' ') || undefined,
    previewUrl: raw?.previewUrl || raw?.preview_url ? String(raw.previewUrl || raw.preview_url) : undefined,
  };
}

/** This workspace's clones first, then the shared catalog alphabetically. */
export function sortVoices(voices: Voice[]): Voice[] {
  return [...voices].sort(
    (a, b) =>
      Number(b.category === 'cloned') - Number(a.category === 'cloned') ||
      a.name.localeCompare(b.name),
  );
}

async function readCatalog(url: string, withToken: boolean): Promise<Voice[]> {
  const response = await fetch(url, { headers: withToken ? { 'X-Workspace-DB-Token': token() } : undefined });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(describeError(data, response.status, 'The voice catalog could not be loaded.'));
  const list = Array.isArray(data?.voices) ? data.voices : [];
  return list.map(toVoice).filter(Boolean) as Voice[];
}

/**
 * Every voice this workspace can speak with. Both catalog reads are attempted
 * and whichever answer arrives is used: the public route needs no token, so
 * the picker still fills if the session is not ready, and one route failing
 * never empties the list.
 */
export async function loadAllVoices(): Promise<Voice[]> {
  const [workspaceVoices, publicVoices] = await Promise.all([
    hasWorkspaceToken()
      ? readCatalog(`/api/workspaces/${encodeURIComponent(workspaceId())}/audio/voices`, true).catch((e) => e as Error)
      : Promise.resolve([] as Voice[]),
    readCatalog('/api/voices', false).catch((e) => e as Error),
  ]);

  const merged = new Map<string, Voice>();
  for (const result of [workspaceVoices, publicVoices]) {
    if (result instanceof Error || !Array.isArray(result)) continue;
    for (const voice of result) {
      // A workspace entry wins over a public one: it is the copy that knows
      // whether this voice is a clone.
      if (!merged.has(voice.id) || voice.category === 'cloned') merged.set(voice.id, voice);
    }
  }

  if (!merged.size) {
    const failure = [workspaceVoices, publicVoices].find((result) => result instanceof Error) as Error | undefined;
    throw failure || new Error('No ElevenLabs voices are available right now.');
  }
  return sortVoices([...merged.values()]);
}

/** The short labels shown beside a voice's name in the picker. */
export function voiceTags(voice: Voice): string[] {
  return [
    voice.category === 'cloned' ? 'Your clone' : 'Premade',
    voice.accent,
    voice.gender,
    voice.age,
    voice.language,
    voice.useCase,
  ].filter(Boolean) as string[];
}

/** Free-text search across everything a voice says about itself. */
export function filterVoices(voices: Voice[], query: string): Voice[] {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return voices;
  const terms = needle.split(/\s+/);
  return voices.filter((voice) => {
    const haystack = [voice.name, voice.category, ...voiceTags(voice), voice.description]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return terms.every((term) => haystack.indexOf(term) >= 0);
  });
}

// ---------------------------------------------------------------------------
// Speech
// ---------------------------------------------------------------------------

/** The platform rejects a longer script with 400 before anything is billed. */
export const MAX_SCRIPT_CHARS = 10_000;
export const MAX_SEGMENTS = 100;

export interface SpokenAudio {
  audioUrl: string;
  /** The platform's estimate; 0 when it did not report one. */
  durationMs: number;
}

export async function speak(options: {
  script: string;
  voiceId: string;
  voiceSettings?: VoiceSettings;
  /** Finished narration defaults to the quality ladder; previews explicitly use the fast option. */
  modelId?: ElevenModelId;
}): Promise<SpokenAudio> {
  const script = String(options.script || '').trim();
  if (!script) throw new Error('There is nothing to say yet — write the line first.');

  const requested = options.modelId || NARRATION_MODEL;
  let model = requested === NARRATION_MODEL_FAST
    ? requested
    : narrationModelForChars(script.length, requested);
  for (;;) {
    const source = options.voiceSettings || DEFAULT_VOICE_SETTINGS;
    const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId())}/audio/voiceover`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        script: script.slice(0, MAX_SCRIPT_CHARS),
        voiceId: options.voiceId || FALLBACK_VOICE_ID,
        modelId: model,
        voiceSettings: elevenVoiceSettings(model, {
          stability: Number(source.stability ?? DEFAULT_VOICE_SETTINGS.stability),
          similarity: Number(source.similarity_boost ?? DEFAULT_VOICE_SETTINGS.similarity_boost),
        }),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data?.audioUrl) {
      return { audioUrl: String(data.audioUrl), durationMs: Number(data.estimatedDurationMs) || 0 };
    }
    const failure = {
      status: response.status,
      code: String(data?.code || ''),
      message: describeError(data, response.status, 'The voiceover could not be generated.'),
    };
    const next = requested !== NARRATION_MODEL_FAST && isElevenModelRejection(failure)
      ? nextNarrationModel(model)
      : null;
    if (!next) throw new Error(failure.message);
    model = narrationModelForChars(script.length, next);
  }
}

export interface SpokenSegment extends SpokenAudio {
  text: string;
}

/**
 * One call for a whole storyboard. Cheaper and far faster than a request per
 * scene, and the per-segment `durationMs` is what a timeline needs to lay the
 * audio against the picture.
 */
export async function speakSegments(options: {
  segments: string[];
  voiceId: string;
  voiceSettings?: VoiceSettings;
}): Promise<SpokenSegment[]> {
  const lines = options.segments.map((line) => String(line || '').trim()).filter(Boolean);
  if (!lines.length) throw new Error('None of these scenes have a line to speak yet.');
  if (lines.length > MAX_SEGMENTS) {
    throw new Error(`This storyboard has ${lines.length} spoken scenes; ${MAX_SEGMENTS} is the most that can be voiced in one pass.`);
  }

  const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId())}/audio/voiceover/segments`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      segments: lines.map((text) => ({ text })),
      voiceId: options.voiceId || FALLBACK_VOICE_ID,
      voiceSettings: options.voiceSettings || DEFAULT_VOICE_SETTINGS,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(data?.segments)) {
    throw new Error(describeError(data, response.status, 'The scene audio could not be generated.'));
  }
  return data.segments.map((segment: any, index: number) => ({
    text: String(segment?.text || lines[index] || ''),
    audioUrl: String(segment?.audioUrl || ''),
    durationMs: Number(segment?.durationMs) || 0,
  }));
}

/** The line a voice reads when it has no ElevenLabs sample of its own. */
export const SAMPLE_LINE = 'Hey — this is how I sound. Ready when you are.';

const sampleCache = new Map<string, string>();

/**
 * A playable sample for one voice. Premade voices ship with a free preview;
 * a cloned voice has none, so the first preview synthesizes the sample line
 * (a real, billed generation) and every later preview replays the cached MP3.
 */
export async function sampleFor(voice: Voice): Promise<string> {
  if (voice.previewUrl) return voice.previewUrl;
  const cached = sampleCache.get(voice.id);
  if (cached) return cached;
  const { audioUrl } = await speak({ script: SAMPLE_LINE, voiceId: voice.id, modelId: NARRATION_MODEL_FAST });
  sampleCache.set(voice.id, audioUrl);
  return audioUrl;
}

/** True when previewing this voice spends wallet credit. */
export function previewCosts(voice: Voice): boolean {
  return !voice.previewUrl && !sampleCache.has(voice.id);
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * The managed endpoints answer with a machine-readable `code`. Several of
 * these are not the customer's problem — the platform's shared ElevenLabs
 * account running dry is the clearest example — and saying so stops someone
 * hunting for an API key or a top-up that would not help.
 */
export function describeError(data: any, status: number, fallback: string): string {
  const code = String(data?.code || '');
  const detail = String(data?.error || data?.message || '').trim();
  const map: Record<string, string> = {
    no_credentials: 'Your workspace session is not ready yet. Refresh the page and try again.',
    insufficient_balance: 'Your workspace wallet cannot cover this generation. Top it up and try again.',
    provider_quota_exceeded:
      'The Audos-managed ElevenLabs account is out of credits right now. This is not your wallet and not an API key you can add — try again shortly.',
    provider_rejected_text: 'ElevenLabs could not read that line. Try rewording it.',
    voice_not_found: 'ElevenLabs does not recognise that voice. Reload the voice list and pick again.',
    voice_not_owned: 'That cloned voice belongs to another workspace.',
    voice_deleted: 'That voice has been deleted. Pick another one.',
    rate_limited: 'Too many requests at once. Wait a moment and try again.',
    workspace_token_wrong_workspace: 'This session belongs to a different workspace. Reload the page.',
  };
  if (map[code]) return map[code];
  if (detail) return `${detail}${code ? ` [${code}]` : ''}`;
  return `${fallback} (${status})`;
}
