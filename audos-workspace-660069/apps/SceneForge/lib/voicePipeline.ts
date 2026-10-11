// THE VOICE PIPELINE — how SceneForge's presenter gets its voice.
//
// SceneForge renders its presenter with HeyGen, and HeyGen can speak a script
// two different ways:
//
//   elevenlabs_heygen (DEFAULT) — the script is narrated by ElevenLabs FIRST
//     and the finished track is handed to HeyGen's audio-driven render
//     (`POST v2/video/generate` with `voice: { type: 'audio' }`), so the
//     avatar's lips are driven by the ElevenLabs performance and HeyGen's own
//     text-to-speech is never invoked.
//   heygen_tts — the original single call (`POST v3/videos` with a HeyGen
//     `voice_id`). Kept as an explicit, opt-in debugging path and as the
//     automatic fallback when ElevenLabs cannot be reached.
//
// WHY THE DEFAULT MOVED. HeyGen's internal TTS is the one thing a prospect
// hears before they decide not to buy. The architecture for the better path
// already existed on both sides — this module is what makes it the road the
// pipeline actually takes, and `voicePipeline()` is the single switch that
// governs every SceneForge surface at once.
//
// SEGMENTED NARRATION. A script is narrated beat by beat through the
// `voiceover/segments` endpoint whenever it has more than one beat: one
// billed request returns one MP3 PER BEAT with its MEASURED length. Those
// clips are assembled in the browser into a single track, which gives two
// things one giant file cannot:
//   * the delivery is paced per paragraph rather than read as one long run-on,
//   * every beat's real start and end second is known, so the word timings the
//     scene planner builds its editorial timeline from are MEASURED rather
//     than spread evenly over a guessed duration.
// HeyGen fetches the voice track from its own servers, so the assembled audio
// is uploaded to workspace storage and HeyGen is handed that public URL — a
// `blob:` url made in this tab could never work.

// LANGUAGE. The film's language decides which ElevenLabs model narrates it
// (`getElevenLabsModel`): Hindi — and every other non-English language — needs
// the multilingual model, and a Hindi script read by the English model is
// unusable. The language is therefore carried on every narration request,
// including each segment of a segmented one.

import {
  MAX_SCRIPT_CHARS,
  MAX_SEGMENTS,
  MAX_SEGMENTS_CHARS,
  PRESENTER_VOICE_SETTINGS,
  clampSettings,
  fetchElevenVoices,
  getElevenLabsModel,
  measureAudioDuration,
  speak,
  speakSegments,
  type SpokenSegment,
  type VoiceSettings,
} from './elevenLabs';
import { uploadFile } from './proxy';
import { loadSettings, type WordTimestamp } from './supabase';

// ——— The switch ———

export type VoicePipelineMode = 'elevenlabs_heygen' | 'heygen_tts';

/** ElevenLabs drives the lips unless something is explicitly switched back. */
export const DEFAULT_VOICE_PIPELINE: VoicePipelineMode = 'elevenlabs_heygen';

const PIPELINE_KEY = 'sceneforge_voice_pipeline_v1';

function asMode(value: unknown): VoicePipelineMode | null {
  return value === 'elevenlabs_heygen' || value === 'heygen_tts' ? value : null;
}

/**
 * The pipeline every SceneForge surface renders with.
 *
 * `window.__sceneForgeVoicePipeline = 'heygen_tts'` in the console overrides
 * it for one session without touching the stored preference, which is the
 * quickest way to A/B the two voices on the same script.
 */
export function voicePipeline(): VoicePipelineMode {
  try {
    const session = asMode((window as any).__sceneForgeVoicePipeline);
    if (session) return session;
    const stored = asMode(window.localStorage.getItem(PIPELINE_KEY));
    if (stored) return stored;
  } catch { /* private mode — the default still applies */ }
  return DEFAULT_VOICE_PIPELINE;
}

export function setVoicePipeline(mode: VoicePipelineMode): VoicePipelineMode {
  try { window.localStorage.setItem(PIPELINE_KEY, mode); } catch { /* private mode — this session still honours it */ }
  try { (window as any).__sceneForgeVoicePipeline = mode; } catch { /* ignore */ }
  return mode;
}

/** Resolve a per-request engine choice against the workspace default. */
export function pipelineFor(engine?: 'elevenlabs' | 'heygen' | '' | null): VoicePipelineMode {
  if (engine === 'heygen') return 'heygen_tts';
  if (engine === 'elevenlabs') return 'elevenlabs_heygen';
  return voicePipeline();
}

export function usesElevenLabs(engine?: 'elevenlabs' | 'heygen' | '' | null): boolean {
  return pipelineFor(engine) === 'elevenlabs_heygen';
}

// ——— Which voice narrates ———

const VOICE_KEY = 'sceneforge_narration_voice_v1';

export function lastNarrationVoice(): string {
  try { return String(window.localStorage.getItem(VOICE_KEY) || ''); } catch { return ''; }
}
export function rememberNarrationVoice(voiceId: string) {
  if (!voiceId) return;
  try { window.localStorage.setItem(VOICE_KEY, voiceId); } catch { /* ignore */ }
}

let discovery: Promise<string> | null = null;

async function discoverNarrationVoice(): Promise<string> {
  // The workspace's configured narration voice outranks everything: it is the
  // founder's own statement of what this product sounds like.
  try {
    const settings = await loadSettings();
    const configured = String(settings.eleven_labs_voice_id || '').trim();
    if (configured) return configured;
  } catch { /* the catalog below is a good enough answer on its own */ }
  const catalog = await fetchElevenVoices();
  const indian = catalog.voices.find((voice) => voice.indian);
  return (indian || catalog.voices[0])?.id || '';
}

/**
 * The ElevenLabs voice this render should use: the caller's explicit choice,
 * then the last voice this browser narrated with, then the workspace's
 * configured voice, then an Indian voice from the live catalog (the primary
 * market), then whatever the catalog returned first.
 */
export async function resolveNarrationVoiceId(preferred?: string): Promise<string> {
  const explicit = String(preferred || '').trim();
  if (explicit) return explicit;
  const remembered = lastNarrationVoice();
  if (remembered) return remembered;
  if (!discovery) {
    discovery = discoverNarrationVoice();
    // A failed lookup must not be cached as "there is no voice" forever.
    discovery.catch(() => { discovery = null; });
  }
  return discovery;
}

// ——— Beats ———

export interface NarrationBeat {
  text: string;
  /** Seconds into the finished narration track where this beat starts. */
  startSec: number;
  endSec: number;
}

/** Longer than this and a "paragraph" is really several beats glued together. */
const MAX_BEAT_CHARS = 520;
/** Below this a beat is a fragment; it is folded into the one before it. */
const MIN_BEAT_CHARS = 60;

function splitLongBeat(paragraph: string): string[] {
  const sentences = paragraph.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [paragraph];
  const out: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    const piece = sentence.trim();
    if (!piece) continue;
    if (current && current.length + piece.length + 1 > MAX_BEAT_CHARS) {
      out.push(current);
      current = piece;
    } else {
      current = current ? `${current} ${piece}` : piece;
    }
  }
  if (current) out.push(current);
  return out;
}

/**
 * Cut a script into the beats ElevenLabs narrates separately.
 *
 * The script's own paragraph breaks are the editorial beats — the orchestrator
 * writes them that way — so they lead; a paragraph long enough to read as
 * several beats is split again on sentence boundaries. Every word of the
 * script survives exactly once, in order, which is what makes the stitched
 * track and the word timings derived from it describe the same narration.
 */
export function splitScriptIntoBeats(script: string): string[] {
  const clean = String(script || '').replace(/\r\n?/g, '\n').trim();
  if (!clean) return [];
  const paragraphs = clean.split(/\n\s*\n+/).map((part) => part.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const source = paragraphs.length > 1 ? paragraphs : [clean.replace(/\s+/g, ' ').trim()];
  const beats: string[] = [];
  for (const paragraph of source) {
    for (const beat of (paragraph.length > MAX_BEAT_CHARS ? splitLongBeat(paragraph) : [paragraph])) {
      // A stray fragment ("And that is why.") is spoken as part of the beat
      // before it rather than as its own clip with its own pause around it.
      if (beats.length && beat.length < MIN_BEAT_CHARS && beats[beats.length - 1].length + beat.length < MAX_BEAT_CHARS) {
        beats[beats.length - 1] = `${beats[beats.length - 1]} ${beat}`;
      } else {
        beats.push(beat);
      }
    }
  }
  // The segments route refuses a batch over its own limits, so a script that
  // would exceed them is narrated as one track instead of failing outright.
  if (beats.length > MAX_SEGMENTS) return [];
  if (beats.reduce((total, beat) => total + beat.length, 0) > MAX_SEGMENTS_CHARS) return [];
  return beats;
}

/**
 * Word timings for a narration whose beats have MEASURED boundaries. Within a
 * beat the words are still spread evenly — only a transcription service can do
 * better than that — but every beat starts and ends where it really does, so
 * drift cannot accumulate across the film the way it does when one guessed
 * duration is spread over the whole script.
 */
export function wordTimestampsFromBeats(beats: NarrationBeat[], scaleToSec = 0): WordTimestamp[] {
  const spoken = beats.filter((beat) => String(beat.text || '').trim());
  if (!spoken.length) return [];
  const measured = spoken[spoken.length - 1].endSec;
  // HeyGen's finished master can run a little longer or shorter than the audio
  // it was given (lead-in, trailing frames); scaling keeps the timings honest
  // against the video the scene planner will actually cut against.
  const scale = scaleToSec > 0 && measured > 0 ? scaleToSec / measured : 1;
  const out: WordTimestamp[] = [];
  for (const beat of spoken) {
    const words = String(beat.text).trim().split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const start = beat.startSec * scale;
    const span = Math.max(0.2, (beat.endSec - beat.startSec) * scale);
    words.forEach((word, index) => out.push({
      word,
      start: start + (span * index) / words.length,
      end: start + (span * (index + 1)) / words.length,
    }));
  }
  return out;
}

// ——— Assembling the beats into one track ———

// 24 kHz mono is plenty for speech and keeps a five-minute narration inside
// the upload route's 50 MB ceiling (48 KB/s → ~20 MB at the cap below).
const TRACK_SAMPLE_RATE = 24000;
const MAX_TRACK_SEC = 420;
/** A breath between beats, so paragraphs do not run into each other. */
const BEAT_GAP_SEC = 0.26;

// Reading a finished clip back into the page needs a cross-origin read the
// browser may refuse. The verdict is remembered so the fallback below is paid
// for at most once per browser instead of on every render.
const STITCH_KEY = 'sceneforge_narration_stitch_v1';

function stitchSupported(): boolean {
  try { return window.localStorage.getItem(STITCH_KEY) !== 'no'; } catch { return true; }
}
function rememberStitchSupport(supported: boolean) {
  try { window.localStorage.setItem(STITCH_KEY, supported ? 'yes' : 'no'); } catch { /* ignore */ }
}

function decodeAudio(context: any, bytes: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    // Safari still implements only the callback form; Chrome and Firefox
    // return a promise from the same call.
    const pending = context.decodeAudioData(bytes, resolve, reject);
    if (pending && typeof pending.then === 'function') pending.then(resolve, reject);
  });
}

/** One mono channel at the track's sample rate, whatever the clip decoded as. */
function monoSamples(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels;
  let mixed: Float32Array;
  if (channels === 1) {
    mixed = buffer.getChannelData(0);
  } else {
    mixed = new Float32Array(buffer.length);
    for (let channel = 0; channel < channels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < mixed.length; i += 1) mixed[i] += data[i] / channels;
    }
  }
  if (buffer.sampleRate === TRACK_SAMPLE_RATE) return mixed;
  // decodeAudioData is specified to resample to the context's rate, but a
  // browser that does not is a silent pitch bug rather than a visible error,
  // so the rate is corrected here instead of trusted.
  const ratio = TRACK_SAMPLE_RATE / buffer.sampleRate;
  const out = new Float32Array(Math.max(1, Math.round(mixed.length * ratio)));
  for (let i = 0; i < out.length; i += 1) {
    const source = i / ratio;
    const left = Math.floor(source);
    const right = Math.min(mixed.length - 1, left + 1);
    const blend = source - left;
    out[i] = mixed[left] * (1 - blend) + mixed[right] * blend;
  }
  return out;
}

/** 16-bit PCM mono WAV — the one container every service decodes without a codec. */
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

interface StitchedTrack { url: string; durationMs: number; beats: NarrationBeat[] }

async function stitchBeats(segments: SpokenSegment[]): Promise<StitchedTrack> {
  const Offline = (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  if (!Offline) throw new Error('This browser cannot assemble audio in the page.');
  const estimatedSec = segments.reduce((total, segment) => total + segment.durationMs / 1000, 0) + BEAT_GAP_SEC * segments.length;
  if (estimatedSec > MAX_TRACK_SEC) throw new Error(`This narration is ${Math.round(estimatedSec)}s, past the ${MAX_TRACK_SEC}s one assembled track carries.`);

  const context = new Offline(1, TRACK_SAMPLE_RATE, TRACK_SAMPLE_RATE);
  const clips: Float32Array[] = [];
  for (const segment of segments) {
    let bytes: ArrayBuffer;
    try {
      const response = await fetch(segment.audioUrl);
      if (!response.ok) throw new Error(`the clip answered HTTP ${response.status}`);
      bytes = await response.arrayBuffer();
    } catch (e: any) {
      // A cross-origin read the browser refuses is a property of this browser,
      // not of this script — remember it so later renders go straight to the
      // single-track path instead of paying for the segments twice.
      rememberStitchSupport(false);
      throw new Error(`The narration clips could not be read back in this browser (${String(e?.message || e).slice(0, 120)}).`);
    }
    clips.push(monoSamples(await decodeAudio(context, bytes)));
  }

  const gap = Math.round(BEAT_GAP_SEC * TRACK_SAMPLE_RATE);
  const length = clips.reduce((total, clip) => total + clip.length, 0) + gap * Math.max(0, clips.length - 1);
  const track = new Float32Array(length);
  const beats: NarrationBeat[] = [];
  let cursor = 0;
  clips.forEach((clip, index) => {
    track.set(clip, cursor);
    beats.push({
      text: segments[index].text,
      startSec: cursor / TRACK_SAMPLE_RATE,
      endSec: (cursor + clip.length) / TRACK_SAMPLE_RATE,
    });
    cursor += clip.length + (index === clips.length - 1 ? 0 : gap);
  });

  const file = new File([encodeWav(track, TRACK_SAMPLE_RATE)], `narration-${Date.now()}.wav`, { type: 'audio/wav' });
  const stored = await uploadFile(file, 'sceneforge-v2/narration');
  rememberStitchSupport(true);
  return { url: stored.url, durationMs: Math.round((length / TRACK_SAMPLE_RATE) * 1000), beats };
}

// ——— The narration itself ———

export interface Narration {
  /** A PUBLIC url HeyGen can fetch from its own servers — never a blob: url. */
  audioUrl: string;
  contentType: string;
  durationMs: number;
  /** Measured beat windows when segmented; one whole-script beat otherwise. */
  beats: NarrationBeat[];
  segmented: boolean;
  voiceId: string;
  /** The ElevenLabs model this track was narrated with (language-derived). */
  modelId: string;
}

export interface NarrateOptions {
  script: string;
  /** Overrides the resolved workspace narration voice for this render. */
  voiceId?: string;
  settings?: VoiceSettings;
  /** Editorial beats to narrate around; derived from the script when absent. */
  beats?: string[];
  /**
   * The film's language (`project.language`). Chooses the ElevenLabs model, so
   * a Hindi film narrates on the multilingual model rather than the English one.
   */
  language?: string | null;
  /** Progress for the surface driving the render. */
  onStage?: (message: string) => void;
}

/** Trim to the endpoint's ceiling without cutting a word in half. */
function withinScriptLimit(script: string): string {
  if (script.length <= MAX_SCRIPT_CHARS) return script;
  const cut = script.slice(0, MAX_SCRIPT_CHARS);
  const boundary = cut.lastIndexOf(' ');
  return (boundary > MAX_SCRIPT_CHARS * 0.8 ? cut.slice(0, boundary) : cut).trim();
}

/**
 * Narrate a script into one track HeyGen's audio-driven render can speak.
 *
 * Throws when ElevenLabs cannot produce the track at all — the caller is
 * expected to catch that, log it, and fall back to HeyGen's own TTS rather
 * than failing the render.
 */
export async function narrateForAvatar(options: NarrateOptions): Promise<Narration> {
  const script = String(options.script || '').trim();
  if (!script) throw new Error('There is no script to narrate yet.');
  const voiceId = await resolveNarrationVoiceId(options.voiceId);
  if (!voiceId) throw new Error('No ElevenLabs voice is available for narration on this workspace.');
  const settings = clampSettings({ ...PRESENTER_VOICE_SETTINGS, ...(options.settings || {}) });

  const language = options.language || '';
  const modelId = getElevenLabsModel(language);

  const requested = (options.beats || []).map((beat) => String(beat || '').trim()).filter(Boolean);
  const beats = requested.length ? requested : splitScriptIntoBeats(script);

  if (beats.length > 1 && stitchSupported()) {
    try {
      options.onStage?.(`Narrating ${beats.length} beats with ElevenLabs`);
      const spoken = await speakSegments(beats, voiceId, settings, { language });
      options.onStage?.('Assembling the narration track');
      const track = await stitchBeats(spoken.segments);
      rememberNarrationVoice(voiceId);
      return { audioUrl: track.url, contentType: 'audio/wav', durationMs: track.durationMs, beats: track.beats, segmented: true, voiceId, modelId };
    } catch (e) {
      // The beats were narrated but could not be assembled here. One whole
      // track is still an ElevenLabs voice on the avatar's lips, which is the
      // point — so this degrades rather than failing.
      console.warn('[SceneForge] The beat-by-beat narration could not be assembled; narrating the script as one track instead.', e);
      options.onStage?.('Narrating the script with ElevenLabs');
    }
  }

  options.onStage?.('Narrating the script with ElevenLabs');
  const spoken = await speak(withinScriptLimit(script), voiceId, settings, { language });
  const durationMs = await measureAudioDuration(spoken.playbackUrl || spoken.url, spoken.estimatedDurationMs);
  rememberNarrationVoice(voiceId);
  return {
    audioUrl: spoken.url,
    contentType: 'audio/mpeg',
    durationMs,
    beats: [{ text: script, startSec: 0, endSec: Math.max(0.2, durationMs / 1000) }],
    segmented: false,
    voiceId,
    modelId,
  };
}
