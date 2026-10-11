// CineAgent — in-browser audio work.
//
// The Deepgram endpoint takes an AUDIO file, so the footage's track is decoded
// with WebAudio, downsampled to 16 kHz mono, and re-encoded as WAV. That keeps
// a 10-minute upload around ~19MB instead of shipping the whole video again,
// and the same decoded samples drive silence detection and the speech envelope
// used for music ducking.

export interface DecodedAudio {
  samples: Float32Array;
  sampleRate: number;
  duration: number;
}

export async function decodeAudioMono(file: File | Blob, targetRate = 16000): Promise<DecodedAudio> {
  const bytes = await file.arrayBuffer();
  const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
  const probe = new AC();
  let decoded: AudioBuffer;
  try {
    decoded = await probe.decodeAudioData(bytes.slice(0));
  } finally {
    probe.close().catch(() => undefined);
  }
  const duration = decoded.duration;
  const frames = Math.max(1, Math.ceil(duration * targetRate));
  const offline = new OfflineAudioContext(1, frames, targetRate);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start(0);
  const rendered = await offline.startRendering();
  return { samples: rendered.getChannelData(0), sampleRate: targetRate, duration };
}

/** PCM16 WAV encode — what the transcription endpoint receives. */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const length = samples.length;
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i += 1) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, length * 2, true);
  let offset = 44;
  for (let i = 0; i < length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export interface SilenceRange { start: number; end: number }

/**
 * Windowed RMS silence detection. thresholdDb around -38 and minDur ~0.45s
 * match what reads as a "dead air" pause rather than a breath.
 */
export function detectSilences(
  samples: Float32Array,
  sampleRate: number,
  thresholdDb = -38,
  minDur = 0.45,
): SilenceRange[] {
  const windowSize = Math.max(1, Math.floor(sampleRate * 0.05));
  const threshold = Math.pow(10, thresholdDb / 20);
  const quiet: boolean[] = [];
  for (let i = 0; i < samples.length; i += windowSize) {
    let sum = 0;
    const end = Math.min(samples.length, i + windowSize);
    for (let j = i; j < end; j += 1) sum += samples[j] * samples[j];
    const rms = Math.sqrt(sum / Math.max(1, end - i));
    quiet.push(rms < threshold);
  }
  const out: SilenceRange[] = [];
  const windowSec = windowSize / sampleRate;
  let runStart = -1;
  for (let i = 0; i <= quiet.length; i += 1) {
    const isQuiet = i < quiet.length ? quiet[i] : false;
    if (isQuiet && runStart < 0) runStart = i;
    if (!isQuiet && runStart >= 0) {
      const start = runStart * windowSec;
      const end = i * windowSec;
      if (end - start >= minDur) out.push({ start: round2(start), end: round2(end) });
      runStart = -1;
    }
  }
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Per-second speech presence (0..1) over a duration — for music ducking. */
export function speechEnvelope(
  silences: SilenceRange[],
  duration: number,
): number[] {
  const seconds = Math.max(1, Math.ceil(duration));
  const env = new Array(seconds).fill(1);
  silences.forEach((s) => {
    for (let sec = Math.floor(s.start); sec < Math.min(seconds, Math.ceil(s.end)); sec += 1) {
      const overlap = Math.min(sec + 1, s.end) - Math.max(sec, s.start);
      if (overlap > 0.6) env[sec] = 0;
    }
  });
  return env;
}
