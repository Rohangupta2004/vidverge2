/**
 * BPM detection — deterministic DSP on the supplied music track. The model is
 * NEVER asked to guess tempo from a description (Phase 2 §6): tempo comes from
 * onset-interval analysis of the actual audio, and when no track is supplied
 * the caller uses impliedSync() (90–110bpm) from ./grid instead.
 *
 * Method: decode → mono → rectified energy envelope at ~200Hz → onset peaks
 * (positive envelope flux, minimum spacing) → histogram of pairwise onset
 * intervals folded into 85–170bpm → argmax bpm → grid phase (offsetMs) from
 * the mean onset phase against that period.
 */
import type { SyncSpec } from '../types';

export class BpmError extends Error {}

const ENVELOPE_HZ = 200;
const MIN_BPM = 85;
const MAX_BPM = 170;
const ANALYSIS_SECONDS = 60;

function foldBpm(bpm: number): number {
  let b = bpm;
  while (b < MIN_BPM) b *= 2;
  while (b > MAX_BPM) b /= 2;
  return b;
}

export async function detectBpm(buffer: ArrayBuffer): Promise<SyncSpec> {
  const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AC) throw new BpmError('This browser cannot decode audio for tempo detection.');
  const ctx = new AC();
  let audio: AudioBuffer;
  try {
    audio = await ctx.decodeAudioData(buffer.slice(0));
  } catch {
    await ctx.close?.();
    throw new BpmError('The music track could not be decoded — use an MP3, WAV, or M4A file.');
  }
  await ctx.close?.();

  const sr = audio.sampleRate;
  const data = audio.getChannelData(0);
  const start = Math.max(0, Math.floor((audio.duration - ANALYSIS_SECONDS) / 2) * sr);
  const end = Math.min(data.length, start + ANALYSIS_SECONDS * sr);

  // Rectified energy envelope at ~200Hz.
  const hop = Math.max(1, Math.round(sr / ENVELOPE_HZ));
  const envelope: number[] = [];
  for (let i = start; i + hop <= end; i += hop) {
    let sum = 0;
    for (let j = i; j < i + hop; j++) sum += Math.abs(data[j]);
    envelope.push(sum / hop);
  }
  if (envelope.length < ENVELOPE_HZ * 8) throw new BpmError('The music track is too short to detect a tempo — supply at least ~10 seconds.');

  // Onset strength = positive envelope flux; smooth over 3 bins.
  const flux: number[] = [0];
  for (let i = 1; i < envelope.length; i++) flux.push(Math.max(0, envelope[i] - envelope[i - 1]));
  const smooth = flux.map((_, i) => (flux[Math.max(0, i - 1)] + flux[i] + flux[Math.min(flux.length - 1, i + 1)]) / 3);
  const mean = smooth.reduce((a, b) => a + b, 0) / smooth.length;
  const sd = Math.sqrt(smooth.reduce((a, b) => a + (b - mean) * (b - mean), 0) / smooth.length);
  const threshold = mean + 1.5 * sd;
  const minGap = Math.round(ENVELOPE_HZ * 0.22); // >= 220ms between onsets

  const onsets: number[] = [];
  let last = -minGap;
  for (let i = 1; i < smooth.length - 1; i++) {
    if (smooth[i] >= threshold && smooth[i] >= smooth[i - 1] && smooth[i] >= smooth[i + 1] && i - last >= minGap) {
      onsets.push(i);
      last = i;
    }
  }
  if (onsets.length < 8) throw new BpmError('No clear rhythmic pulse was found in the music track.');

  // Pairwise onset intervals (up to 2.5s apart) → folded bpm histogram.
  const bins = new Map<number, number>();
  for (let a = 0; a < onsets.length; a++) {
    for (let b = a + 1; b < onsets.length && onsets[b] - onsets[a] <= ENVELOPE_HZ * 2.5; b++) {
      const seconds = (onsets[b] - onsets[a]) / ENVELOPE_HZ;
      const bpm = foldBpm(60 / seconds);
      const bin = Math.round(bpm * 2) / 2; // 0.5bpm bins
      bins.set(bin, (bins.get(bin) || 0) + 1);
    }
  }
  let bestBpm = 0, bestScore = -1;
  for (const [bin, count] of bins) {
    const score = count + (bins.get(bin - 0.5) || 0) * 0.5 + (bins.get(bin + 0.5) || 0) * 0.5;
    if (score > bestScore) { bestScore = score; bestBpm = bin; }
  }
  if (!bestBpm) throw new BpmError('Tempo detection failed on this track.');

  // Grid phase: mean onset position modulo the beat period (circular mean).
  const periodBins = (60 / bestBpm) * ENVELOPE_HZ;
  let sx = 0, sy = 0;
  for (const o of onsets) {
    const phase = ((o % periodBins) / periodBins) * Math.PI * 2;
    sx += Math.cos(phase);
    sy += Math.sin(phase);
  }
  const meanPhase = (Math.atan2(sy, sx) + Math.PI * 2) % (Math.PI * 2);
  const offsetMs = Math.round(((meanPhase / (Math.PI * 2)) * periodBins / ENVELOPE_HZ) * 1000);

  return { bpm: Math.round(bestBpm * 10) / 10, offsetMs, snap: 'beat', landOn: 'settle' };
}
