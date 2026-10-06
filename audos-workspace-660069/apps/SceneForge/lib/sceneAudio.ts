// SCENE AUDIO — per-scene speech for the storyboard.
//
// The pipeline's native voice is the HeyGen presenter master: one continuous
// narration the scenes are composited against. This module adds the other
// way a film can be voiced, chosen per project in the studio's Audio tab:
//
//   Voiceover  — every scene speaks its own ElevenLabs line over its footage.
//   Lip-sync   — every scene's line also drives a HeyGen avatar clip, rendered
//                to the ElevenLabs MP3 (caller audio, never HeyGen's own TTS),
//                which stands in for the generated footage of that scene.
//
// Both end in the same place: the ONE Remotion assembly render. The clips are
// stamped onto the timeline segments (`stampTimelineAudio`) and the
// composition mounts them inside each scene's own Sequence, muting the
// presenter master for the window. Nothing is re-encoded afterwards — the
// platform's overlay/stitch routes carry only the base video's audio and
// cannot mux an MP3, so a per-scene voice can only reach the finished MP4
// through the composition itself.
//
// Every clip is kept on the project (`studio_config.audio.scenes`) with the
// text and voice it was made from, so a line that has not changed is never
// paid for twice and a reload loses nothing.

import type { Project, Scene } from './supabase';
import type { AudioConfig, SceneAudio } from './studioConfig';
import { MAX_SEGMENTS, speakSegments } from './elevenLabs';
import { HeyGenError, createAvatarVideo, fetchVideoStatus } from './heygenStudio';
import { registerAudioAsset } from './heygenApi';
import type { TimelineSegment } from '../remotion/AssemblyComp';

const sec = (value: unknown) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : 0; };
const MAX_LINE_CHARS = 2000;

// ——— What each scene says ———

/** The words the presenter master speaks inside this scene's window. */
export function transcriptLine(scene: Scene, project: Project | null | undefined): string {
  const words = Array.isArray(project?.word_timestamps) ? project!.word_timestamps! : [];
  if (!words.length) return '';
  const start = sec(scene.script_start_sec);
  const end = Math.max(start, sec(scene.script_end_sec));
  if (end <= start) return '';
  // A word belongs to the window its START falls in, so a word spanning the
  // cut is spoken once, by the scene it begins in.
  return words
    .filter((word) => word && Number.isFinite(Number(word.start)) && Number(word.start) >= start - 0.05 && Number(word.start) < end)
    .map((word) => String(word.word || '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

/**
 * Without a transcript, the script is cut proportionally by time — rough,
 * but it hands the customer something in their own words to edit rather
 * than an empty box.
 */
function scriptSlice(scene: Scene, project: Project | null | undefined, scenes: Scene[]): string {
  const script = String(project?.script || '').replace(/\s+/g, ' ').trim();
  if (!script) return '';
  const lastEnd = scenes.reduce((longest, row) => Math.max(longest, sec(row.script_end_sec)), 0);
  const total = sec(project?.avatar_duration_sec) || sec(project?.estimated_duration_sec) || lastEnd || sec(project?.target_length_sec);
  if (!total) return '';
  const start = sec(scene.script_start_sec);
  const end = Math.max(start, sec(scene.script_end_sec));
  if (end <= start) return '';
  const from = Math.floor((start / total) * script.length);
  const to = Math.min(script.length, Math.ceil((end / total) * script.length));
  // Snap to word boundaries so a scene never opens or closes mid-word.
  const fromSnap = from <= 0 ? 0 : script.lastIndexOf(' ', from) + 1;
  const toSnap = to >= script.length ? script.length : (script.indexOf(' ', to) === -1 ? script.length : script.indexOf(' ', to));
  return script.slice(fromSnap, toSnap).trim();
}

/** The line this scene would speak if the customer wrote nothing for it. */
export function suggestedLine(scene: Scene, project: Project | null | undefined, scenes: Scene[]): string {
  return (transcriptLine(scene, project) || scriptSlice(scene, project, scenes) || String(scene.description || '').trim()).slice(0, MAX_LINE_CHARS);
}

/** The scenes that speak: everything still in the film, in story order. */
export function voicedScenes(scenes: Scene[]): Scene[] {
  return (Array.isArray(scenes) ? scenes : [])
    .filter((scene) => scene && scene.status !== 'skipped')
    .sort((a, b) => sec(a.script_start_sec) - sec(b.script_start_sec) || Number(a.scene_index) - Number(b.scene_index));
}

/** What a scene actually says: the customer's edit first, then the suggestion. */
export function lineFor(scene: Scene, project: Project | null | undefined, scenes: Scene[], audio: AudioConfig): string {
  const own = audio.scenes[scene.id]?.text;
  return (own && own.trim()) || suggestedLine(scene, project, scenes);
}

export function emptySceneAudio(text = ''): SceneAudio {
  return { text, voice_id: '', spoken_text: '', audio_url: '', duration_ms: 0, lipsync_url: '', lipsync_video_id: '', lipsync_avatar_id: '', lipsync_note: '', generated_at: '' };
}

// ——— Freshness ———

export type SpeechState = 'missing' | 'stale' | 'ready';

/** Is the stored clip the one THIS line in THIS voice would produce? */
export function voiceoverState(entry: SceneAudio | undefined, line: string, voiceId: string): SpeechState {
  if (!entry?.audio_url) return 'missing';
  return entry.spoken_text === line.trim() && entry.voice_id === voiceId ? 'ready' : 'stale';
}

/** The lip-sync clip is only current when the voiceover it was rendered from is. */
export function lipsyncState(entry: SceneAudio | undefined, line: string, voiceId: string, avatarId: string): SpeechState {
  if (voiceoverState(entry, line, voiceId) !== 'ready') return 'missing';
  if (!entry?.lipsync_url) return 'missing';
  return entry.lipsync_avatar_id === avatarId ? 'ready' : 'stale';
}

/** The scenes whose line has no current clip in the chosen voice. */
export function scenesNeedingVoice(scenes: Scene[], project: Project | null | undefined, audio: AudioConfig): Scene[] {
  const rows = voicedScenes(scenes);
  return rows.filter((scene) => {
    const line = lineFor(scene, project, rows, audio);
    return Boolean(line) && voiceoverState(audio.scenes[scene.id], line, audio.voice_id) !== 'ready';
  });
}

/** The scenes with a current voiceover but no current lip-sync clip of this avatar. */
export function scenesNeedingLipsync(scenes: Scene[], project: Project | null | undefined, audio: AudioConfig): Scene[] {
  const rows = voicedScenes(scenes);
  return rows.filter((scene) => {
    const line = lineFor(scene, project, rows, audio);
    const entry = audio.scenes[scene.id];
    return voiceoverState(entry, line, audio.voice_id) === 'ready' && lipsyncState(entry, line, audio.voice_id, audio.lipsync_avatar_id) !== 'ready';
  });
}

// ——— Voiceover: one request for the whole board ———

/**
 * Narrate every scene that needs it in ONE `voiceover/segments` call and
 * return the updated per-scene record. Scenes whose clip is already current
 * are untouched, so re-running after editing one line bills one line.
 */
export async function narrateScenes(scenes: Scene[], project: Project | null | undefined, audio: AudioConfig): Promise<Record<string, SceneAudio>> {
  const rows = voicedScenes(scenes);
  const pending = scenesNeedingVoice(scenes, project, audio).slice(0, MAX_SEGMENTS);
  if (!pending.length) return audio.scenes;
  const lines = pending.map((scene) => lineFor(scene, project, rows, audio).trim());
  const spoken = await speakSegments(lines, audio.voice_id, audio.voice_settings);
  const stamp = new Date().toISOString();
  const next: Record<string, SceneAudio> = { ...audio.scenes };
  pending.forEach((scene, index) => {
    const clip = spoken.segments[index];
    const previous = next[scene.id] || emptySceneAudio(lines[index]);
    next[scene.id] = {
      ...previous,
      text: previous.text || lines[index],
      voice_id: audio.voice_id,
      spoken_text: lines[index],
      audio_url: clip.audioUrl,
      duration_ms: clip.durationMs,
      // A new line means the old lips are wrong; the clip is dropped so the
      // scene falls back to plain voiceover until it is re-rendered.
      lipsync_url: '',
      lipsync_video_id: '',
      lipsync_avatar_id: '',
      lipsync_note: '',
      generated_at: stamp,
    };
  });
  return next;
}

// ——— Lip-sync: HeyGen renders the avatar to the ElevenLabs track ———

export const HEYGEN_UNCONFIGURED_NOTE = 'HeyGen credentials are not connected to this workspace. Ask Otto to add the HeyGen API key, then reopen this panel — no other step is needed.';

// HeyGen quotes 60–120 s for a short render; a scene clip is shorter than a
// whole master, but the queue is shared, so the ceiling is generous.
const LIPSYNC_POLL_MS = 8000;
const LIPSYNC_TIMEOUT_MS = 12 * 60 * 1000;
const LIPSYNC_LANES = 2;

export interface LipsyncOptions {
  aspectRatio: '9:16' | '16:9';
  /** The platform's own wording for a missing key, when the caller has it. */
  unconfiguredNote?: string;
  /** Called as each scene settles, so partial progress can be persisted. */
  onScene?: (sceneId: string, entry: SceneAudio) => void;
  signal?: AbortSignal;
}

export interface LipsyncOutcome {
  scenes: Record<string, SceneAudio>;
  /** Set when HeyGen refused for want of a key; every pending scene fell back to voiceover. */
  unavailable: string;
  rendered: number;
  failed: number;
}

async function renderOneLipsync(entry: SceneAudio, avatarId: string, options: LipsyncOptions): Promise<SceneAudio> {
  // Best effort, exactly as the Avatar Studio does it: an account with an
  // asset registry gets a real audio_asset_id, everyone else sends the
  // public URL. Both bypass HeyGen's TTS.
  const audioAssetId = await registerAudioAsset(entry.audio_url, 'audio/mpeg');
  const created = await createAvatarVideo({
    avatarId,
    voiceId: '',
    script: entry.spoken_text,
    speed: 1,
    resolution: '1080p',
    aspectRatio: options.aspectRatio,
    backgroundMode: 'color',
    // The composition's own backdrop colour, so the clip sits in the film
    // rather than on a card of its own.
    backgroundColor: '#0A0F1E',
    backgroundImageUrl: '',
    audioUrl: entry.audio_url,
    audioAssetId,
  });
  const startedAt = Date.now();
  let misses = 0;
  for (;;) {
    if (options.signal?.aborted) throw new Error('Lip-sync was cancelled.');
    await new Promise((resolve) => window.setTimeout(resolve, LIPSYNC_POLL_MS));
    let status: Awaited<ReturnType<typeof fetchVideoStatus>> | null = null;
    try {
      status = await fetchVideoStatus(created.videoId, created.apiVersion);
      misses = 0;
    } catch (e) {
      if (e instanceof HeyGenError && e.missingCredential) throw e;
      // A dropped status read is a hiccup, not a dead render.
      misses += 1;
      if (misses >= 5) throw e;
    }
    if (status?.status === 'completed' && status.videoUrl) {
      return { ...entry, lipsync_url: status.videoUrl, lipsync_video_id: created.videoId, lipsync_avatar_id: avatarId, lipsync_note: '' };
    }
    if (status?.status === 'failed') throw new HeyGenError(status.error || 'HeyGen could not finish this clip.');
    if (Date.now() - startedAt > LIPSYNC_TIMEOUT_MS) throw new Error('HeyGen did not finish this clip in time. It may still complete in your HeyGen library.');
  }
}

/**
 * Render a lip-synced avatar clip for every scene that has a current
 * voiceover and no current clip, two at a time. A scene HeyGen cannot
 * render is not a failure of the film: it keeps its voiceover and records
 * why in `lipsync_note`, and the composition plays the line over the
 * footage instead. A missing HeyGen key stops the run at once, because
 * every further request would fail the same way.
 */
export async function lipsyncScenes(scenes: Scene[], project: Project | null | undefined, audio: AudioConfig, options: LipsyncOptions): Promise<LipsyncOutcome> {
  const next: Record<string, SceneAudio> = { ...audio.scenes };
  const outcome: LipsyncOutcome = { scenes: next, unavailable: '', rendered: 0, failed: 0 };
  const avatarId = String(audio.lipsync_avatar_id || '').trim();
  const pending = scenesNeedingLipsync(scenes, project, audio);
  if (!avatarId || !pending.length) return outcome;
  const noKey = options.unconfiguredNote || HEYGEN_UNCONFIGURED_NOTE;
  const queue = [...pending];

  const settle = (sceneId: string, entry: SceneAudio) => {
    next[sceneId] = entry;
    options.onScene?.(sceneId, entry);
  };

  const lane = async () => {
    for (;;) {
      const scene = queue.shift();
      if (!scene || outcome.unavailable || options.signal?.aborted) return;
      const entry = next[scene.id];
      try {
        settle(scene.id, await renderOneLipsync(entry, avatarId, options));
        outcome.rendered += 1;
      } catch (e: any) {
        if (e instanceof HeyGenError && e.missingCredential) {
          outcome.unavailable = noKey;
          settle(scene.id, { ...entry, lipsync_url: '', lipsync_video_id: '', lipsync_avatar_id: '', lipsync_note: noKey });
          // Everything still queued gets the same note, so the panel can say
          // plainly why each scene is voiceover rather than leaving blanks.
          while (queue.length) {
            const rest = queue.shift()!;
            settle(rest.id, { ...next[rest.id], lipsync_url: '', lipsync_video_id: '', lipsync_avatar_id: '', lipsync_note: noKey });
          }
          return;
        }
        outcome.failed += 1;
        settle(scene.id, { ...entry, lipsync_url: '', lipsync_video_id: '', lipsync_avatar_id: '', lipsync_note: String(e?.message || 'HeyGen could not render this scene.').slice(0, 300) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(LIPSYNC_LANES, pending.length) }, lane));
  return outcome;
}

// ——— Into the render ———

/**
 * Put each scene's clip on its timeline segment for the assembly render. In
 * Lip-sync mode a scene without a HeyGen clip (no key, a failed render)
 * still speaks — it just does so over its own footage. 'off' stamps nothing,
 * so the presenter master narrates exactly as before.
 */
export function stampTimelineAudio(timeline: TimelineSegment[], audio: AudioConfig): TimelineSegment[] {
  if (audio.mode === 'off') return timeline;
  return timeline.map((segment) => {
    if (segment.type !== 'scene' || !segment.sceneId) return segment;
    const entry = audio.scenes[segment.sceneId];
    if (!entry?.audio_url) return segment;
    const lipsync = audio.mode === 'lipsync' && entry.lipsync_url ? entry.lipsync_url : '';
    return {
      ...segment,
      voiceoverUrl: entry.audio_url,
      voiceoverMs: entry.duration_ms,
      ...(lipsync ? { lipsyncUrl: lipsync } : {}),
    };
  });
}

/** The windows in which a scene speaks for itself, for ducking the music bed. */
export function sceneSpeechWindows(timeline: TimelineSegment[], fps = 30): [number, number][] {
  return timeline
    .filter((segment) => segment.type === 'scene' && (segment.voiceoverUrl || segment.lipsyncUrl))
    .map((segment) => {
      const start = sec(segment.startSec);
      const window = Math.max(1 / fps, Number(segment.frames) / fps);
      const spoken = Number(segment.voiceoverMs) > 0 ? Number(segment.voiceoverMs) / 1000 : window;
      return [start, start + Math.min(window, spoken)] as [number, number];
    });
}

/** Scenes whose line runs longer than the window it has to fit in. */
export function overrunningScenes(scenes: Scene[], audio: AudioConfig): { scene: Scene; overBySec: number }[] {
  return voicedScenes(scenes).flatMap((scene) => {
    const entry = audio.scenes[scene.id];
    if (!entry?.audio_url || !entry.duration_ms) return [];
    const window = Math.max(0, sec(scene.script_end_sec) - sec(scene.script_start_sec));
    const overBySec = entry.duration_ms / 1000 - window;
    return overBySec > 0.35 ? [{ scene, overBySec }] : [];
  });
}
