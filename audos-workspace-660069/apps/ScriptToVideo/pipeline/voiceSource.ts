/**
 * VOICE SOURCE — which engine, if any, speaks the film's narration.
 *
 * Narration is OPTIONAL. Three sources are offered on the voiceover step and
 * the pipeline continues on every one of them:
 *
 *   'none'       — no narration layer at all. The clips keep their own sound,
 *                  so the step is complete the moment it is chosen and Final
 *                  Assembly has nothing to wait for.
 *   'elevenlabs' — the platform ElevenLabs voiceover endpoints: one premium
 *                  voice for the whole film. Offered only while the platform
 *                  voice catalog actually answers.
 *   'openai'     — the platform speech proxy (tts-1) with its six built-in
 *                  voices. Needs no ElevenLabs connection.
 *
 * This is why a missing or unavailable voice provider can no longer strand a
 * film: 'none' is always selectable, and it is where a film starts until the
 * customer picks a voice.
 */

import { uploadBlob, wsToken } from '../api';
import type { VoiceSourceId } from '../api';
import { probeAudioDuration } from './sceneVoice';

export type { VoiceSourceId };

export interface VoiceSourceOption {
  id: VoiceSourceId;
  label: string;
  blurb: string;
}

export const VOICE_SOURCES: readonly VoiceSourceOption[] = [
  { id: 'none', label: 'No Voiceover', blurb: 'Skip narration — the film keeps the clips’ own sound.' },
  { id: 'elevenlabs', label: 'ElevenLabs', blurb: 'One premium ElevenLabs voice for the whole film.' },
  { id: 'openai', label: 'Built-in AI Voice', blurb: 'The platform’s own text-to-speech. No connection needed.' },
] as const;

/** The voices the platform speech proxy accepts on `tts-1`. */
export const OPENAI_VOICES = [
  { id: 'alloy', label: 'Alloy', blurb: 'neutral, even' },
  { id: 'echo', label: 'Echo', blurb: 'warm, male' },
  { id: 'fable', label: 'Fable', blurb: 'expressive, storytelling' },
  { id: 'onyx', label: 'Onyx', blurb: 'deep, authoritative' },
  { id: 'nova', label: 'Nova', blurb: 'bright, female' },
  { id: 'shimmer', label: 'Shimmer', blurb: 'soft, female' },
] as const;

export const DEFAULT_OPENAI_VOICE = 'alloy';
export const OPENAI_TTS_MODEL = 'tts-1';
/** The speech endpoint accepts at most 4,096 characters of `input`. A single
 * scene's line is a sentence or two, so this is a guard, not a limit. */
const OPENAI_TTS_MAX_CHARS = 4096;

export function openAiVoiceLabel(id: string): string {
  return OPENAI_VOICES.find((v) => v.id === id)?.label || id || DEFAULT_OPENAI_VOICE;
}

export function isOpenAiVoice(id: string): boolean {
  return OPENAI_VOICES.some((v) => v.id === id);
}

// ---------------------------------------------------------------------------
// Session preference — the last voice source the customer picked
// ---------------------------------------------------------------------------

const SOURCE_KEY = 's2v:voiceSource';
const VOICE_KEY = 's2v:openaiVoice';

export function loadVoiceSourcePref(): VoiceSourceId | null {
  try {
    const stored = window.sessionStorage.getItem(SOURCE_KEY);
    return stored === 'none' || stored === 'elevenlabs' || stored === 'openai' ? stored : null;
  } catch { return null; }
}

export function saveVoiceSourcePref(source: VoiceSourceId): void {
  try { window.sessionStorage.setItem(SOURCE_KEY, source); } catch { /* preference only */ }
}

export function loadOpenAiVoicePref(): string {
  try {
    const stored = String(window.sessionStorage.getItem(VOICE_KEY) || '');
    return isOpenAiVoice(stored) ? stored : DEFAULT_OPENAI_VOICE;
  } catch { return DEFAULT_OPENAI_VOICE; }
}

export function saveOpenAiVoicePref(voice: string): void {
  try { window.sessionStorage.setItem(VOICE_KEY, isOpenAiVoice(voice) ? voice : DEFAULT_OPENAI_VOICE); } catch { /* preference only */ }
}

// ---------------------------------------------------------------------------
// ElevenLabs availability — probed from the FREE public voice catalog
// ---------------------------------------------------------------------------

export type ElevenLabsState = 'unknown' | 'checking' | 'available' | 'unavailable';

let elState: ElevenLabsState = 'unknown';
let elProbe: Promise<boolean> | null = null;
const elListeners = new Set<() => void>();

function announce() {
  elListeners.forEach((fn) => { try { fn(); } catch { /* UI only */ } });
}

export function elevenLabsState(): ElevenLabsState {
  return elState;
}

/** Whether the ElevenLabs option is selectable. It is greyed out only once the
 * platform has actually refused — a probe that has not run yet must not lock a
 * working integration out of the picker. */
export function elevenLabsOffered(): boolean {
  return elState !== 'unavailable';
}

export function subscribeElevenLabs(fn: () => void): () => void {
  elListeners.add(fn);
  return () => { elListeners.delete(fn); };
}

/**
 * Is ElevenLabs narration actually available to this workspace?
 *
 * `GET /api/voices` is the platform's public voice catalog: it costs nothing,
 * needs no token, and answers with the voices the ElevenLabs key can reach. An
 * empty list or any failure means narration on that engine would fail too, so
 * the option is greyed out instead of being offered and then breaking.
 */
export function syncElevenLabsAvailability(): Promise<boolean> {
  if (elProbe) return elProbe;
  if (elState === 'available' || elState === 'unavailable') return Promise.resolve(elState === 'available');
  elState = 'checking';
  announce();
  elProbe = (async () => {
    try {
      const res = await fetch('/api/voices');
      const data = await res.json().catch(() => null);
      const voices = Array.isArray(data?.voices) ? data.voices : [];
      return res.ok && voices.length > 0;
    } catch {
      return false;
    }
  })().then((ok) => {
    elState = ok ? 'available' : 'unavailable';
    elProbe = null;
    announce();
    return ok;
  });
  return elProbe;
}

// ---------------------------------------------------------------------------
// Built-in AI voice — the platform speech proxy
// ---------------------------------------------------------------------------

/**
 * Record ONE narration line on the platform speech proxy and store it.
 *
 * The proxy answers with audio BYTES, not JSON, so the blob is uploaded to the
 * workspace's file storage and the film keeps a durable URL — exactly the
 * shape an ElevenLabs take has, which is what lets assembly, the timeline and
 * a reload after a tab close all treat the two engines identically.
 */
export async function recordOpenAiLine(params: {
  text: string;
  voice?: string;
  label?: string;
}): Promise<{ audioUrl: string; durationS: number }> {
  const text = String(params.text || '').trim();
  if (!text) throw new Error('That line has no words to speak.');
  const token = wsToken();
  if (!token) throw new Error('Your workspace session is still loading — try again in a moment.');
  const voice = isOpenAiVoice(String(params.voice || '')) ? String(params.voice) : DEFAULT_OPENAI_VOICE;

  const res = await fetch('/proxy/openai/v1/audio/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
    body: JSON.stringify({
      model: OPENAI_TTS_MODEL,
      voice,
      input: text.slice(0, OPENAI_TTS_MAX_CHARS),
      response_format: 'mp3',
    }),
  });
  // Only a rejection has a readable body — a success is the mp3 itself.
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const detail = String(data?.error?.message || data?.error || data?.message || `the built-in voice answered HTTP ${res.status}`);
    throw new Error(data?.code ? `${detail} [${data.code}]` : detail);
  }
  const blob = await res.blob();
  if (!blob.size) throw new Error('The built-in voice returned an empty audio file.');
  const audioUrl = await uploadBlob(blob, `${params.label || 'narration'}-${voice}.mp3`);
  const durationS = await probeAudioDuration(audioUrl);
  return { audioUrl, durationS };
}
