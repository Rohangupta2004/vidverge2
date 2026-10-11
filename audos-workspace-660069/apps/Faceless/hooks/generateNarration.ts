/**
 * STAGE 1 — generateNarration.
 *
 * This runs FIRST, before anything reads the script for meaning. That order is
 * the whole design: the editorial director cuts to what is being SAID at a
 * given second, and only the recorded audio knows when a word is spoken. Raw
 * text gives you a character count, not timing.
 *
 * ElevenLabs returns audio and an *estimated* duration — it does not return
 * word timestamps. So the real timing comes from a forced read of the audio we
 * just generated, through the platform's Deepgram nova-3 word-timestamp
 * endpoint. Those two calls together are what "ElevenLabs with word-level
 * timestamps" means on this platform.
 */

import {
  FacelessError,
  type NarrationResult,
  type VoiceSettings,
  type WordTimestamp,
} from '../types/editorial';
import { WORKSPACE_UUID, authHeaders, errorText, isHttpUrl, readJson, requireToken } from '../lib/platform';

const STAGE = 'narration' as const;

/** Sarah. Overridable per run; the app offers the live catalog. */
export const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL';

export const MAX_SCRIPT_CHARS = 8000;

/**
 * Lower stability reads as a human documentary delivery rather than a flat
 * announcer, which is what a faceless edit is cutting against. It is the
 * default the app had before voice styles existed, and it is still what a run
 * gets when no style is chosen.
 */
export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  stability: 0.38,
  similarity_boost: 0.8,
  style: 0.45,
  use_speaker_boost: true,
};

export interface NarrationOptions {
  voiceId?: string;
  /** From the brief's voice style + effect. Omitted means the default above. */
  voiceSettings?: VoiceSettings;
  onNote?: (note: string) => void;
}

export async function generateNarration(
  script: string,
  options: NarrationOptions = {},
): Promise<NarrationResult> {
  const text = String(script || '').trim();
  if (text.length < 40) {
    throw new FacelessError(
      'A narration script needs at least a couple of sentences before it can be voiced.',
      STAGE,
      'script_too_short',
    );
  }
  if (text.length > MAX_SCRIPT_CHARS) {
    throw new FacelessError(
      `This script is ${text.length} characters. Faceless caps a single film at ${MAX_SCRIPT_CHARS} so the edit stays tight — split it into two films.`,
      STAGE,
      'script_too_long',
    );
  }

  const voiceId = options.voiceId || DEFAULT_VOICE_ID;
  options.onNote?.('Recording the narration…');

  const res = await fetch(`/api/workspaces/${WORKSPACE_UUID}/audio/voiceover`, {
    method: 'POST',
    headers: authHeaders(STAGE),
    body: JSON.stringify({
      script: text,
      voiceId,
      voiceSettings: options.voiceSettings || DEFAULT_VOICE_SETTINGS,
    }),
  });
  const data = await readJson(res);
  if (!res.ok || !data || !isHttpUrl(data.audioUrl)) {
    throw new FacelessError(errorText(res.status, data, 'Narration could not be generated'), STAGE, 'tts_failed');
  }
  const audioUrl = String(data.audioUrl);

  options.onNote?.('Reading the recording back for word-level timing…');
  const audioBlob = await fetchAudio(audioUrl);
  const measuredDuration = await measureDuration(audioBlob, Number(data.estimatedDurationMs) / 1000);

  const transcribed = await transcribeWithTimestamps(audioBlob);
  if (transcribed && transcribed.words.length) {
    return {
      audioUrl,
      wordTimestamps: transcribed.words,
      duration: transcribed.duration || measuredDuration,
      voiceId,
      timestampsMeasured: true,
    };
  }

  // Deepgram is the only word-timing source on this platform. If it is not
  // configured the run continues on distributed timings, but it says so, and
  // every downstream stage can see that the spine is weaker than it should be.
  return {
    audioUrl,
    wordTimestamps: distributeWords(text, measuredDuration),
    duration: measuredDuration,
    voiceId,
    timestampsMeasured: false,
  };
}

async function fetchAudio(url: string): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (error: any) {
    throw new FacelessError(
      `The generated narration could not be read back: ${String(error?.message || error)}`,
      STAGE,
      'audio_unreadable',
    );
  }
  if (!res.ok) {
    throw new FacelessError(`The generated narration could not be read back (HTTP ${res.status}).`, STAGE, 'audio_unreadable');
  }
  return res.blob();
}

/**
 * Decoding the file is exact; the endpoint's `estimatedDurationMs` is not, and
 * every beat boundary in the film is measured against this number.
 */
async function measureDuration(blob: Blob, fallbackSeconds: number): Promise<number> {
  const fallback = Number.isFinite(fallbackSeconds) && fallbackSeconds > 0 ? fallbackSeconds : 30;
  if (typeof window === 'undefined') return fallback;
  const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (Ctor) {
    let ctx: any = null;
    try {
      ctx = new Ctor();
      const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
      const seconds = Number(buffer?.duration);
      if (Number.isFinite(seconds) && seconds > 0) return seconds;
    } catch {
      /* fall through to the element read */
    } finally {
      try { ctx?.close?.(); } catch { /* already closed */ }
    }
  }
  return measureViaElement(blob, fallback);
}

function measureViaElement(blob: Blob, fallback: number): Promise<number> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(blob);
    const audio = new Audio();
    const finish = (value: number) => {
      URL.revokeObjectURL(objectUrl);
      resolve(value);
    };
    const guard = setTimeout(() => finish(fallback), 15000);
    audio.onloadedmetadata = () => {
      clearTimeout(guard);
      const seconds = Number(audio.duration);
      finish(Number.isFinite(seconds) && seconds > 0 ? seconds : fallback);
    };
    audio.onerror = () => {
      clearTimeout(guard);
      finish(fallback);
    };
    audio.src = objectUrl;
  });
}

async function transcribeWithTimestamps(
  blob: Blob,
): Promise<{ words: WordTimestamp[]; duration: number } | null> {
  const token = requireToken(STAGE);
  const form = new FormData();
  form.append('audio', blob, 'narration.mp3');
  form.append('language', 'en');

  let res: Response;
  try {
    res = await fetch(`/api/workspaces/${WORKSPACE_UUID}/audio/transcribe-timestamped`, {
      method: 'POST',
      // No Content-Type: the browser has to set the multipart boundary.
      headers: { 'X-Workspace-DB-Token': token },
      body: form,
    });
  } catch {
    return null;
  }
  const data = await readJson(res);
  if (!res.ok || !data || !Array.isArray(data.words)) return null;

  const words: WordTimestamp[] = data.words
    .map((entry: any) => ({
      word: String(entry?.word || '').trim(),
      start: Number(entry?.start),
      end: Number(entry?.end),
    }))
    .filter((w: WordTimestamp) => w.word && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end >= w.start);

  if (!words.length) return null;
  const duration = Number(data.duration) || words[words.length - 1].end;
  return { words, duration };
}

/**
 * Last-resort timing when word-level transcription is unavailable: spread the
 * script across the measured duration, weighted by word length so longer words
 * occupy proportionally more of the track. Deterministic, and honest about
 * being an approximation — the caller flags it.
 */
export function distributeWords(script: string, durationSeconds: number): WordTimestamp[] {
  const words = String(script).split(/\s+/).filter(Boolean);
  if (!words.length || !(durationSeconds > 0)) return [];
  const weights = words.map((word) => Math.max(2, word.replace(/[^\p{L}\p{N}]+/gu, '').length) + 1.5);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const stamps: WordTimestamp[] = [];
  let cursor = 0;
  for (let i = 0; i < words.length; i += 1) {
    const span = (weights[i] / total) * durationSeconds;
    stamps.push({
      word: words[i],
      start: Math.round(cursor * 1000) / 1000,
      end: Math.round((cursor + span) * 1000) / 1000,
    });
    cursor += span;
  }
  return stamps;
}

/** The exact words spoken inside a time window — the beat's narrationText. */
export function wordsBetween(words: WordTimestamp[], start: number, end: number): string {
  return words
    .filter((word) => word.end > start + 0.001 && word.start < end - 0.001)
    .map((word) => word.word)
    .join(' ')
    .trim();
}
