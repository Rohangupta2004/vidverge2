/**
 * PER-SCENE VOICEOVER — the master clock of the Ad Director pipeline.
 *
 * The script is written FIRST; then every scene's narration line is spoken
 * and MEASURED before any visual is generated, so visual durations are
 * DERIVED from the voice timing — never arbitrary fixed lengths.
 *
 * Engines (the workspace's existing TTS/voice systems, in order):
 *   1. ElevenLabs voiceover — POST /api/workspaces/:id/audio/voiceover
 *      (the same platform endpoint the other Vidverge flows use; supports the
 *      workspace voice catalogue from /api/voices).
 *   2. OpenAI tts-1 — POST /proxy/openai/v1/audio/speech with
 *      X-Workspace-DB-Token (returns raw audio bytes, parked on storage).
 *
 * Durations are measured from the real audio file with a hidden <audio>
 * element — the number every scene's visual length derives from.
 */

import { generateNarration, listVoices, VoiceOption } from '../audioSuite';
import { uploadBlob, wsToken } from './api';

export interface TtsVoice { id: string; label: string }
/** The tts-1 voices the platform speech proxy accepts (fallback engine). */
export const TTS_VOICES: TtsVoice[] = [
  { id: 'alloy', label: 'Alloy — balanced, neutral' },
  { id: 'echo', label: 'Echo — warm, male' },
  { id: 'fable', label: 'Fable — bright storyteller' },
  { id: 'onyx', label: 'Onyx — deep, authoritative' },
  { id: 'nova', label: 'Nova — friendly, female' },
  { id: 'shimmer', label: 'Shimmer — soft, calm' },
];
export const DEFAULT_TTS_VOICE = 'nova';
const TTS1_IDS = new Set(TTS_VOICES.map((v) => v.id));

/** The full voice picker: the ElevenLabs workspace catalogue (primary) plus
 * the tts-1 voices (always available). Best-effort — an empty catalogue read
 * still leaves the tts-1 voices. */
export async function listAllVoices(): Promise<{ elevenlabs: VoiceOption[]; tts1: TtsVoice[] }> {
  let eleven: VoiceOption[] = [];
  try { eleven = await listVoices(); } catch { /* catalogue read is optional */ }
  return { elevenlabs: eleven, tts1: TTS_VOICES };
}

/** Speak text with tts-1 on the platform speech proxy and park the audio. */
export async function generateNarrationAudio(text: string, voice: string): Promise<string> {
  const token = wsToken();
  if (!token) throw new Error('Your workspace session is still loading — try again in a moment.');
  const res = await fetch('/proxy/openai/v1/audio/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
    body: JSON.stringify({ model: 'tts-1', voice: TTS1_IDS.has(voice) ? voice : DEFAULT_TTS_VOICE, input: text.slice(0, 4000) }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(String(data?.error?.message || data?.error || data?.message || `The speech service answered HTTP ${res.status}.`));
  }
  const audio = await res.blob(); // audio bytes, not JSON
  if (!audio.size) throw new Error('The speech service returned no audio.');
  return uploadBlob(new Blob([audio], { type: 'audio/mpeg' }), `pf-voice-${Date.now()}.mp3`);
}

/** Measure an audio file's real duration in seconds. 0 = unreadable (never fatal). */
export function probeAudioDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') { resolve(0); return; }
    let settled = false;
    const audio = document.createElement('audio');
    const done = (v: number) => { if (settled) return; settled = true; try { audio.src = ''; } catch { /* released */ } resolve(v); };
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0);
    audio.onerror = () => done(0);
    setTimeout(() => done(0), 10000);
    audio.src = url;
  });
}

/** Words a narrator actually speaks — strips markdown chrome and stage labels. */
export function spokenText(line: string): string {
  return String(line || '')
    .replace(/^\s*(?:vo|voice[- ]?over|narrator)\s*:\s*/gim, '')
    .replace(/[*_#`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2500);
}

export interface SceneVoiceResult {
  url: string;
  /** Measured (preferred) or estimated duration in seconds. */
  seconds: number;
  engine: 'elevenlabs' | 'tts1';
}

/**
 * Speak ONE scene's narration line and measure it. `voice` may be an
 * ElevenLabs voice id from the workspace catalogue, a tts-1 voice id, or
 * empty (workspace default ElevenLabs voice). ElevenLabs failures fall back
 * to tts-1 so a voice outage never sinks the ad.
 */
export async function speakSceneLine(line: string, voice?: string | null): Promise<SceneVoiceResult> {
  const text = spokenText(line);
  if (text.length < 2) throw new Error('This scene has no narration to speak.');
  const v = String(voice || '').trim();

  let url = '';
  let engine: SceneVoiceResult['engine'] = 'elevenlabs';
  let estimated = 0;

  if (v && TTS1_IDS.has(v)) {
    url = await generateNarrationAudio(text, v);
    engine = 'tts1';
  } else {
    try {
      const out = await generateNarration(text, v || undefined);
      url = out.url;
      estimated = out.estimatedSeconds || 0;
    } catch {
      url = await generateNarrationAudio(text, DEFAULT_TTS_VOICE);
      engine = 'tts1';
    }
  }

  let seconds = await probeAudioDuration(url);
  if (!seconds) seconds = estimated || Math.max(1.2, text.split(/\s+/).length / 2.4);
  return { url, seconds: Math.round(seconds * 100) / 100, engine };
}
