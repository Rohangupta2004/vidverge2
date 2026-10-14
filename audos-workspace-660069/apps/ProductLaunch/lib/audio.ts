import { workspaceToken } from './ai-client';
import { WORKSPACE_ID } from './platform';
import type { FilmSpec } from '../types/film-spec.types';

export interface BeatPoint {
  frame: number;
  strength: number;
  kind: 'beat' | 'downbeat' | 'drop' | 'section';
}

export interface BeatMap {
  bpm: number;
  beats: BeatPoint[];
  source: 'analyzed' | 'estimated';
}

export interface PreparedAudio {
  musicUrl: string;
  narrationUrl?: string;
  narrationSource: 'elevenlabs' | 'upload' | 'kinetic-text';
  beatMap: BeatMap;
  warnings: string[];
}

function audioHeaders(): Record<string, string> {
  const token = workspaceToken();
  if (!token) throw new Error('The workspace session is not ready for audio generation.');
  return { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token };
}

async function jsonReply<T>(response: Response, fallback: string): Promise<T> {
  const data = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !data) throw new Error(String(data?.error || fallback));
  return data;
}

function musicPrompt(spec: FilmSpec): string {
  const style = spec.music_style || 'momentum';
  return [
    'Instrumental product launch film score.',
    'Style: ' + style + '.',
    'Clear drums and measurable beat structure, strong downbeats every four beats,',
    'one energy lift near the midpoint and a clean final resolve.',
    'No vocals. Brand: ' + spec.product_name + '.',
  ].join(' ');
}

async function generateMusic(spec: FilmSpec, signal?: AbortSignal): Promise<string> {
  const lengthMs = Math.max(3000, Math.round(spec.total_duration_frames / 30 * 1000));
  const response = await fetch('/api/workspaces/' + WORKSPACE_ID + '/audio/music/custom', {
    method: 'POST',
    headers: audioHeaders(),
    body: JSON.stringify({
      prompt: musicPrompt(spec),
      lengthMs,
      instrumental: true,
      provider: 'elevenlabs',
    }),
    signal,
  });
  const data = await jsonReply<{ audioUrl?: string }>(response, 'Music generation failed.');
  if (!data.audioUrl) throw new Error('Music generation returned no audio file.');
  return data.audioUrl;
}

async function generateNarration(spec: FilmSpec, signal?: AbortSignal): Promise<string> {
  const script = spec.scenes.map((scene) => String(scene.narration_text || scene.narration_beat || '').trim()).filter(Boolean).join(' ');
  if (!script) throw new Error('This concept has no narration script.');
  const response = await fetch('/api/workspaces/' + WORKSPACE_ID + '/audio/voiceover', {
    method: 'POST',
    headers: audioHeaders(),
    body: JSON.stringify({ script, voiceId: spec.narration_voice || undefined }),
    signal,
  });
  const data = await jsonReply<{ audioUrl?: string }>(response, 'Narration generation failed.');
  if (!data.audioUrl) throw new Error('Narration generation returned no audio file.');
  return data.audioUrl;
}

async function uploadNarration(file: File, signal?: AbortSignal): Promise<string> {
  const token = workspaceToken();
  if (!token) throw new Error('The workspace session is not ready for narration upload.');
  const form = new FormData();
  form.append('file', file, file.name || 'narration.mp3');
  form.append('workspaceId', WORKSPACE_ID);
  form.append('folder', 'product-launch-narration');
  const response = await fetch('/api/upload/file', {
    method: 'POST',
    headers: { 'X-Workspace-DB-Token': token },
    body: form,
    signal,
  });
  const data = await jsonReply<{ url?: string }>(response, 'Narration upload failed.');
  if (!data.url) throw new Error('Narration upload returned no file URL.');
  return data.url;
}

function estimatedBeatMap(frameCount: number, bpm = 120, offsetFrames = 0): BeatMap {
  const beatFrames = 30 * 60 / bpm;
  const beats: BeatPoint[] = [];
  const first = Math.max(0, Math.min(beatFrames, offsetFrames));
  for (let frame = first, index = 0; frame < frameCount; frame += beatFrames, index += 1) {
    beats.push({
      frame: Math.round(frame),
      strength: index % 4 === 0 ? 1 : index % 2 === 0 ? 0.72 : 0.48,
      kind: index % 16 === 0 && index > 0 ? 'section' : index % 4 === 0 ? 'downbeat' : 'beat',
    });
  }
  return { bpm, beats, source: 'estimated' };
}

async function analyzeMusic(url: string, frameCount: number): Promise<BeatMap> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error('audio fetch failed');
    const bytes = await response.arrayBuffer();
    const AudioCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) throw new Error('Web Audio unavailable');
    const context = new AudioCtor();
    const decoded = await context.decodeAudioData(bytes.slice(0));
    const channel = decoded.getChannelData(0);
    const samplesPerWindow = Math.max(1, Math.round(decoded.sampleRate * 0.025));
    const energy: number[] = [];
    for (let start = 0; start < channel.length; start += samplesPerWindow) {
      let sum = 0;
      const end = Math.min(channel.length, start + samplesPerWindow);
      for (let i = start; i < end; i += 1) sum += channel[i] * channel[i];
      energy.push(Math.sqrt(sum / Math.max(1, end - start)));
    }
    await context.close();

    const peaks: number[] = [];
    for (let i = 4; i < energy.length - 1; i += 1) {
      const local = (energy[i - 4] + energy[i - 3] + energy[i - 2] + energy[i - 1]) / 4;
      if (energy[i] > local * 1.45 && energy[i] > energy[i - 1] && energy[i] >= energy[i + 1]) peaks.push(i);
    }
    const intervals = peaks.slice(1).map((peak, index) => (peak - peaks[index]) * 0.025).filter((v) => v > 0.25 && v < 1.2);
    intervals.sort((a, b) => a - b);
    const median = intervals.length ? intervals[Math.floor(intervals.length / 2)] : 0.5;
    let bpm = Math.round(60 / median);
    while (bpm < 80) bpm *= 2;
    while (bpm > 180) bpm = Math.round(bpm / 2);
    const onsetFrame = peaks.length ? Math.round(peaks[0] * 0.025 * 30) : 0;
    const map = estimatedBeatMap(frameCount, bpm || 120, onsetFrame);
    const maxEnergy = Math.max.apply(null, energy.concat([0.001]));
    map.beats = map.beats.map((beat, index) => {
      const windowIndex = Math.min(energy.length - 1, Math.max(0, Math.round(beat.frame / 30 / 0.025)));
      const strength = Math.max(beat.strength, Math.min(1, energy[windowIndex] / maxEnergy));
      const previous = windowIndex > 8 ? energy[windowIndex - 8] : energy[0];
      const kind = strength > 0.88 && energy[windowIndex] > previous * 1.7
        ? 'drop'
        : beat.kind;
      return { ...beat, strength, kind: kind as BeatPoint['kind'] };
    });
    map.source = 'analyzed';
    return map;
  } catch {
    return estimatedBeatMap(frameCount);
  }
}

export async function prepareAudio(
  spec: FilmSpec,
  uploadedNarration?: File | null,
  signal?: AbortSignal,
): Promise<PreparedAudio> {
  const warnings: string[] = [];
  const musicUrl = await generateMusic(spec, signal);
  const beatMap = await analyzeMusic(musicUrl, spec.total_duration_frames);

  if (!spec.narration_enabled) {
    return { musicUrl, narrationSource: 'kinetic-text', beatMap, warnings };
  }

  try {
    const narrationUrl = await generateNarration(spec, signal);
    return { musicUrl, narrationUrl, narrationSource: 'elevenlabs', beatMap, warnings };
  } catch (error) {
    warnings.push('ElevenLabs narration unavailable: ' + (error instanceof Error ? error.message : String(error)));
  }

  if (uploadedNarration) {
    try {
      const narrationUrl = await uploadNarration(uploadedNarration, signal);
      return { musicUrl, narrationUrl, narrationSource: 'upload', beatMap, warnings };
    } catch (error) {
      warnings.push('Uploaded narration could not be used: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  warnings.push('Continuing without narration; kinetic text and beat-synchronised music carry the film.');
  return { musicUrl, narrationSource: 'kinetic-text', beatMap, warnings };
}
