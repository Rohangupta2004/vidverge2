/**
 * Vidverge Pro — tempo measurement, in the browser.
 *
 * Beat sync needs two numbers: how fast the track is, and where the first
 * beat lands. Both are measured here from the decoded audio rather than
 * guessed, so "snap the cuts to the beat" moves a cut onto a real onset in
 * the footage instead of onto an arbitrary grid.
 *
 * The method is the standard one for this job and deliberately cheap: build a
 * 100 Hz energy envelope, half-wave rectify its derivative to get onsets,
 * autocorrelate that over the 60–180 BPM range, then sweep the phase.
 */

export interface Tempo {
  /** 0 when the clip has no usable audio — callers must check. */
  bpm: number;
  /** Seconds from the start of the clip to the first beat. */
  offset: number;
  /** Peak autocorrelation, 0..1. Below ~0.1 the reading is not trustworthy. */
  confidence: number;
  /** Non-empty when nothing could be measured, and says why. */
  note: string;
}

const HOP_HZ = 100;
const MIN_BPM = 60;
const MAX_BPM = 180;

export async function decodeMono(file: Blob, rate = 11025): Promise<Float32Array | null> {
  const Ctor = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext });
  const AudioCtor = Ctor.AudioContext || Ctor.webkitAudioContext;
  if (!AudioCtor) return null;
  const ctx = new AudioCtor();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData((await file.arrayBuffer()).slice(0));
  } catch {
    return null;
  } finally {
    try { await ctx.close(); } catch { /* already closed */ }
  }
  if (!decoded.duration) return null;
  const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * rate)), rate);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start(0);
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0).slice(0);
}

/** Half-wave-rectified energy flux at 100 Hz. */
function onsetEnvelope(samples: Float32Array, rate: number): Float32Array {
  const hop = Math.max(1, Math.round(rate / HOP_HZ));
  const frames = Math.floor(samples.length / hop);
  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f += 1) {
    let sum = 0;
    const base = f * hop;
    for (let i = 0; i < hop; i += 1) {
      const v = samples[base + i] || 0;
      sum += v * v;
    }
    energy[f] = Math.sqrt(sum / hop);
  }
  const flux = new Float32Array(frames);
  for (let f = 1; f < frames; f += 1) {
    const d = energy[f] - energy[f - 1];
    flux[f] = d > 0 ? d : 0;
  }
  // Remove the slow-moving floor so a loud passage does not swamp a quiet one.
  const window = 50;
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f += 1) {
    let sum = 0;
    let n = 0;
    for (let i = Math.max(0, f - window); i < Math.min(frames, f + window); i += 1) { sum += flux[i]; n += 1; }
    out[f] = Math.max(0, flux[f] - sum / Math.max(1, n));
  }
  return out;
}

export async function detectTempo(file: Blob): Promise<Tempo> {
  const samples = await decodeMono(file);
  if (!samples || samples.length < 11025) {
    return { bpm: 0, offset: 0, confidence: 0, note: 'This clip has no readable audio track, so there is no tempo to lock to.' };
  }
  const env = onsetEnvelope(samples, 11025);
  if (env.length < HOP_HZ * 2) {
    return { bpm: 0, offset: 0, confidence: 0, note: 'The clip is too short to measure a tempo from.' };
  }

  const minLag = Math.round((60 / MAX_BPM) * HOP_HZ);
  const maxLag = Math.min(env.length - 1, Math.round((60 / MIN_BPM) * HOP_HZ));
  let bestLag = 0;
  let bestScore = 0;
  let total = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let score = 0;
    for (let f = lag; f < env.length; f += 1) score += env[f] * env[f - lag];
    total += score;
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }
  if (!bestLag || bestScore <= 0) {
    return { bpm: 0, offset: 0, confidence: 0, note: 'No steady pulse could be measured in this clip.' };
  }

  const mean = total / Math.max(1, maxLag - minLag + 1);
  const confidence = Math.max(0, Math.min(1, (bestScore - mean) / Math.max(1e-9, bestScore)));

  // Sweep the phase across one beat period and keep the alignment that lands
  // the most onset energy on the beat.
  let bestPhase = 0;
  let bestPhaseScore = -1;
  for (let phase = 0; phase < bestLag; phase += 1) {
    let score = 0;
    for (let f = phase; f < env.length; f += bestLag) score += env[f];
    if (score > bestPhaseScore) { bestPhaseScore = score; bestPhase = phase; }
  }

  return {
    bpm: (60 * HOP_HZ) / bestLag,
    offset: bestPhase / HOP_HZ,
    confidence,
    note: '',
  };
}

/** Nearest beat to `t`, given a measured tempo. */
export function snapToBeat(t: number, bpm: number, offset: number): number {
  if (!bpm) return t;
  const period = 60 / bpm;
  const n = Math.round((t - offset) / period);
  return Math.max(0, offset + n * period);
}
