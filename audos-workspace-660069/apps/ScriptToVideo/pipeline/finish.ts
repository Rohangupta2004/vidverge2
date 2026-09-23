/**
 * OPTIONAL FINISHING LAYERS — ElevenLabs narration/music plus scene-timed SRT.
 *
 * These are generated only when the customer opts in on the Final screen.
 * The original script is always the narration source. Captions are built from
 * each stored script_segment and its measured scene duration, so no second AI
 * pass can rewrite the words or drift the timing.
 */

import { Film, FilmScene, fingerprint, wsToken } from '../api';

const WORKSPACE_ID = 'f24710e5-7c6d-4db4-92b4-c2c235877575';

export const MUSIC_PRESETS = ['corporate', 'tech', 'uplifting', 'calm', 'energetic', 'playful', 'cinematic', 'lofi'] as const;
export type MusicPreset = typeof MUSIC_PRESETS[number];

export interface FinishSettings {
  narration: boolean;
  voiceId?: string;
  music: boolean;
  musicPreset: MusicPreset;
  captions: boolean;
}

export interface VoiceOption {
  id: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
}

export interface FinishState {
  settings: FinishSettings;
  source_fingerprint: string;
  narration_urls?: string[];
  music_url?: string;
  captions_srt?: string;
  completed_at?: string;
}

export interface PreparedFinish {
  state: FinishState;
  durationS: number;
  narrationUrls: string[];
  musicUrl?: string;
  captionsSrt?: string;
}

function audioHeaders(): Record<string, string> {
  const token = wsToken();
  if (!token) throw new Error('Workspace session is still loading — audio generation cannot start yet.');
  return { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token };
}

async function audioPost(path: string, body: unknown): Promise<any> {
  const res = await fetch(path, { method: 'POST', headers: audioHeaders(), body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(String(data?.error || data?.message || `Audio generation failed (HTTP ${res.status}).`));
  return data;
}

export async function listVoices(): Promise<VoiceOption[]> {
  const res = await fetch('/api/voices');
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(String(data?.error || `Voice list failed (HTTP ${res.status}).`));
  return Array.isArray(data?.voices) ? data.voices : [];
}

function splitNarration(text: string, maxChars = 8000): string[] {
  const paragraphs = String(text || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      if (current) { chunks.push(current); current = ''; }
      for (let i = 0; i < paragraph.length; i += maxChars) chunks.push(paragraph.slice(i, i + maxChars));
    } else if (!current) current = paragraph;
    else if (current.length + paragraph.length + 2 <= maxChars) current += `\n\n${paragraph}`;
    else { chunks.push(current); current = paragraph; }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function generateNarration(script: string, voiceId?: string): Promise<string[]> {
  const chunks = splitNarration(script);
  if (!chunks.length) throw new Error('This film has no original script to narrate.');
  if (chunks.length === 1) {
    const data = await audioPost(`/api/workspaces/${WORKSPACE_ID}/audio/voiceover`, { script: chunks[0], voiceId: voiceId || undefined });
    if (!data?.audioUrl) throw new Error('Narration generation returned no audio file.');
    return [String(data.audioUrl)];
  }
  if (chunks.length > 100 || chunks.reduce((n, s) => n + s.length, 0) > 20000) {
    throw new Error('This script is too long for one narration pass. Shorten it below 20,000 characters.');
  }
  const data = await audioPost(`/api/workspaces/${WORKSPACE_ID}/audio/voiceover/segments`, {
    segments: chunks.map((text) => ({ text })),
    voiceId: voiceId || undefined,
    fps: 30,
  });
  const urls = (Array.isArray(data?.segments) ? data.segments : []).map((s: any) => String(s?.audioUrl || '')).filter(Boolean);
  if (urls.length !== chunks.length) throw new Error('Narration generation returned an incomplete set of audio segments.');
  return urls;
}

async function generateMusic(preset: MusicPreset, durationS: number): Promise<string> {
  const lengthMs = Math.min(600000, Math.max(3000, Math.ceil(durationS * 1000)));
  const data = await audioPost(`/api/workspaces/${WORKSPACE_ID}/audio/music/preset`, { preset, lengthMs, provider: 'elevenlabs' });
  if (!data?.audioUrl) throw new Error('Music generation returned no audio file.');
  return String(data.audioUrl);
}

function srtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const rest = ms % 1000;
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(h)}:${two(m)}:${two(s)},${String(rest).padStart(3, '0')}`;
}

function captionChunks(segment: string): string[] {
  const clean = String(segment || '')
    .replace(/^\s*(?:---+|```.*)$/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/[*_#`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return [];
  const words = clean.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (!line) line = word;
    else if (`${line} ${word}`.length <= 64) line += ` ${word}`;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

/** Build captions directly from ordered scene segments and measured durations. */
export function buildCaptions(scenes: FilmScene[]): { srt: string; durationS: number } {
  const ordered = [...scenes].filter((s) => (s.status === 'completed' || s.status === 'ready') && s.asset_url).sort((a, b) => a.idx - b.idx);
  let cursor = 0;
  let index = 1;
  const blocks: string[] = [];
  for (const scene of ordered) {
    const duration = Math.max(0.25, Number(scene.duration_s) || 0);
    const chunks = captionChunks(scene.script_segment);
    const slice = chunks.length ? duration / chunks.length : duration;
    chunks.forEach((text, i) => {
      const start = cursor + (i * slice);
      const end = Math.min(cursor + duration, start + slice);
      blocks.push(`${index}\n${srtTime(start)} --> ${srtTime(end)}\n${text}`);
      index += 1;
    });
    cursor += duration;
  }
  return { srt: blocks.join('\n\n'), durationS: cursor };
}

export async function prepareFinish(
  film: Film,
  scenes: FilmScene[],
  settings: FinishSettings,
  onNote?: (note: string) => void,
): Promise<PreparedFinish> {
  const captions = buildCaptions(scenes);
  const durationS = captions.durationS || Number(film.duration_s) || 3;
  const sourceFingerprint = fingerprint({ script: film.script || '', scenes: scenes.map((s) => [s.scene_key, s.script_segment, Number(s.duration_s) || 0, s.asset_url]) });
  const previous = film.finish && film.finish.source_fingerprint === sourceFingerprint ? film.finish : null;
  const sameVoice = previous?.settings?.narration && settings.narration && String(previous.settings.voiceId || '') === String(settings.voiceId || '');
  const sameMusic = previous?.settings?.music && settings.music && previous.settings.musicPreset === settings.musicPreset;

  let narrationUrls: string[] = [];
  if (settings.narration) {
    if (sameVoice && Array.isArray(previous?.narration_urls) && previous!.narration_urls!.length) narrationUrls = previous!.narration_urls!;
    else {
      onNote?.('ElevenLabs is recording narration from the original script…');
      narrationUrls = await generateNarration(String(film.script || ''), settings.voiceId);
    }
  }

  let musicUrl: string | undefined;
  if (settings.music) {
    if (sameMusic && previous?.music_url) musicUrl = previous.music_url;
    else {
      onNote?.(`ElevenLabs is composing a ${settings.musicPreset} music bed…`);
      musicUrl = await generateMusic(settings.musicPreset, durationS);
    }
  }

  const state: FinishState = {
    settings,
    source_fingerprint: sourceFingerprint,
    narration_urls: narrationUrls.length ? narrationUrls : undefined,
    music_url: musicUrl,
    captions_srt: settings.captions ? captions.srt : undefined,
  };
  return { state, durationS, narrationUrls, musicUrl, captionsSrt: settings.captions ? captions.srt : undefined };
}
