/**
 * AUDIO PIPELINE — the reliable narration / music / SFX layer of the
 * sequential Script-to-Video pipeline.
 *
 *   Original script → Opus 5 (voice plan + scene-level narration plan +
 *   music brief + sparse SFX) → ElevenLabs (voiceover segments, music) →
 *   per-scene audio attached to the timeline → FFmpeg final assembly.
 *
 * Policy (one authoritative voice per scene, never two):
 * - ElevenLabs narration is the AUTHORITATIVE narration track for the
 *   standard workflow. On a narrated scene the clip's own generated audio is
 *   kept only as low ambience under the voice.
 * - A scene whose script has ON-CAMERA DIALOGUE keeps the video model's own
 *   voice (the dialogue block was in its generation prompt) and never gets
 *   narration on top.
 * - The same voiceId + settings are reused for every line and every
 *   regeneration, so a re-taken line never sounds like a different person.
 *
 * Every layer persists to films.audio via the caller, fails independently,
 * and can be retried or skipped without touching the generated video clips.
 */

import {
  AudioMusicPlan, AudioNarrationEntry, AudioSfxItem, Film, FilmAudio,
  FilmScene, SceneNarration, db, fingerprint, wsToken,
} from '../api';
import { planFilmAudio, tightenNarrationLine } from './opus';
import { probeAudioDuration } from './sceneVoice';
import { VoiceOption, listVoices } from './finish';

const WORKSPACE_ID = 'f24710e5-7c6d-4db4-92b4-c2c235877575';

/** How far a narration line may overrun its clip before we rewrite it. The
 * overrun that remains after a rewrite is absorbed at assembly by holding the
 * scene's last frame (never by speeding the voice up unnaturally). */
export const NARRATION_TOLERANCE_S = 0.8;
export const MAX_SCENE_EXTENSION_S = 2.5;

export type AudioLayer = 'narration' | 'music' | 'sfx' | 'assembly';

/** A layer-typed failure so the UI can offer the right recovery action
 * ([Retry Voice]/[Choose Voice], [Retry]/[Continue Without Music], …). */
export class AudioLayerError extends Error {
  layer: AudioLayer;
  constructor(layer: AudioLayer, message: string) {
    super(message);
    this.name = 'AudioLayerError';
    this.layer = layer;
  }
}

function audioHeaders(): Record<string, string> {
  const token = wsToken();
  if (!token) throw new Error('Your workspace session is still loading — try again in a moment.');
  return { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token };
}

async function audioPost(path: string, body: unknown): Promise<any> {
  const res = await fetch(path, { method: 'POST', headers: audioHeaders(), body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.success === false) {
    throw new Error(String(data?.error || data?.message || `Audio generation failed (HTTP ${res.status}).`));
  }
  return data;
}

// ---------------------------------------------------------------------------
// Plan identity
// ---------------------------------------------------------------------------

/** The scenes the audio plan covers: completed clips, in film order. */
export function audioScenes(scenes: FilmScene[]): FilmScene[] {
  return [...scenes].filter((s) => s.status === 'completed' && s.asset_url).sort((a, b) => a.idx - b.idx);
}

export function audioFingerprint(scenes: FilmScene[]): string {
  return fingerprint(audioScenes(scenes).map((s) => [
    s.scene_key,
    String(s.script_segment || ''),
    Math.round((Number(s.duration_s) || 6) * 10) / 10,
    !!(s.dialogue && String((s.dialogue as any).line || '').trim()),
  ]));
}

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

export function narrationReady(audio: FilmAudio | null): boolean {
  if (!audio) return false;
  return audio.narration.every((n) => n.voice_source !== 'elevenlabs' || (n.status === 'ready' && !!n.audioUrl));
}

export function musicReady(audio: FilmAudio | null): boolean {
  if (!audio) return false;
  const m = audio.music;
  return !m || !m.required || m.status === 'skipped' || (m.status === 'ready' && !!m.audioUrl);
}

export function sfxReady(audio: FilmAudio | null): boolean {
  if (!audio) return false;
  return audio.sfx_status === 'none' || audio.sfx_status === 'skipped' || audio.sfx_status === 'ready';
}

export function audioReady(audio: FilmAudio | null): boolean {
  return !!audio && narrationReady(audio) && musicReady(audio) && sfxReady(audio);
}

// ---------------------------------------------------------------------------
// Planning (Opus) — reuses everything still valid from a previous plan
// ---------------------------------------------------------------------------

export async function fetchVoices(): Promise<VoiceOption[]> {
  try { return await listVoices(); } catch { return []; }
}

/** Ensure the film has a current audio plan (voice plan + narration plan +
 * music brief + SFX plan). Reuses a valid existing plan; on a re-plan, ready
 * audio whose text/voice did not change is carried over, and the film's voice
 * identity survives so regenerated lines keep the same voice. */
export async function ensureAudioPlan(
  film: Film,
  scenes: FilmScene[],
  onNote?: (note: string) => void,
  opts: { forceReplan?: boolean; voiceId?: string; voiceName?: string } = {},
): Promise<FilmAudio> {
  const done = audioScenes(scenes);
  if (!done.length) throw new AudioLayerError('narration', 'No completed scenes to plan audio for yet.');
  const fp = audioFingerprint(scenes);

  if (film.audio && film.audio.planned_fingerprint === fp && !opts.forceReplan) {
    if (opts.voiceId && film.audio.voice_plan && opts.voiceId !== film.audio.voice_plan.voiceId) {
      return withVoice(film.audio, opts.voiceId, opts.voiceName);
    }
    return film.audio;
  }

  onNote?.('Opus is planning the voice, narration, music and SFX together with the scenes…');
  const voices = await fetchVoices();
  const planned = await planFilmAudio({ film, scenes: done, voices });

  // Voice continuity: an explicit choice or the previous plan's voice wins.
  const keepVoice = opts.voiceId || film.audio?.voice_plan?.voiceId || '';
  if (keepVoice) {
    planned.voice_plan.voiceId = keepVoice;
    const known = voices.find((v) => v.id === keepVoice);
    planned.voice_plan.voiceName = known?.name || opts.voiceName || film.audio?.voice_plan?.voiceName || planned.voice_plan.voiceName;
  }

  const prior = film.audio;
  const narration: AudioNarrationEntry[] = planned.narration.map((n) => {
    const before = prior?.narration?.find((p) => p.scene_key === n.scene_key);
    const reusable = before && before.status === 'ready' && before.audioUrl
      && before.text === n.text && before.voice_source === n.voice_source
      && before.voiceId === planned.voice_plan.voiceId;
    if (reusable) return { ...before! };
    return { ...n, status: n.voice_source === 'elevenlabs' ? 'pending' : 'ready' } as AudioNarrationEntry;
  });

  const music: AudioMusicPlan = { ...planned.music, status: planned.music.required ? 'pending' : 'skipped' };
  if (prior?.music?.status === 'skipped') music.status = 'skipped';
  else if (prior?.music?.status === 'ready' && prior.music.audioUrl
    && prior.music.preset === music.preset && String(prior.music.customPrompt || '') === String(music.customPrompt || '')) {
    music.audioUrl = prior.music.audioUrl;
    music.duration_s = prior.music.duration_s;
    music.status = 'ready';
  }

  const sfx: AudioSfxItem[] = planned.sfx.map((f) => {
    const before = prior?.sfx?.find((p) => p.scene_key === f.scene_key && p.prompt === f.prompt);
    if (before && before.status === 'ready' && before.audioUrl) return { ...before, at_s: f.at_s, volume: f.volume };
    return { ...f, status: 'pending' } as AudioSfxItem;
  });

  return {
    version: 1,
    voice_plan: planned.voice_plan,
    narration,
    music,
    sfx,
    sfx_status: prior?.sfx_status === 'skipped' ? 'skipped' : (sfx.length ? 'pending' : 'none'),
    planned_fingerprint: fp,
    planned_at: new Date().toISOString(),
  };
}

/** Change the film's narration voice: same plan, same lines — every ElevenLabs
 * line is re-recorded with the new voice. Video clips are NOT regenerated. */
export function withVoice(audio: FilmAudio, voiceId: string, voiceName?: string): FilmAudio {
  if (!audio.voice_plan || voiceId === audio.voice_plan.voiceId) return audio;
  return {
    ...audio,
    voice_plan: { ...audio.voice_plan, voiceId, voiceName: voiceName || voiceId },
    narration: audio.narration.map((n) => (n.voice_source === 'elevenlabs'
      ? { ...n, voiceId: undefined, audioUrl: undefined, duration_s: undefined, status: 'pending' as const, error: undefined }
      : n)),
  };
}

/** Change the music direction: keeps everything else, re-composes music only. */
export function withMusicPreset(audio: FilmAudio, preset: string): FilmAudio {
  const music: AudioMusicPlan = {
    required: true,
    preset,
    customPrompt: undefined, // the preset IS the new direction
    mood: audio.music?.mood,
    volume: audio.music?.volume ?? 0.22,
    status: 'pending',
  };
  return { ...audio, music };
}

export function skipMusicLayer(audio: FilmAudio): FilmAudio {
  return { ...audio, music: audio.music ? { ...audio.music, status: 'skipped', error: undefined } : { required: false, preset: 'cinematic', status: 'skipped' } };
}

export function skipSfxLayer(audio: FilmAudio): FilmAudio {
  return { ...audio, sfx_status: 'skipped' };
}

// ---------------------------------------------------------------------------
// Narration generation (ElevenLabs) + timing resolution
// ---------------------------------------------------------------------------

/** Generate every missing ElevenLabs narration line with the film's ONE voice,
 * then resolve timing mismatches: a line that overruns its clip is rewritten
 * tighter (meaning preserved) and re-recorded once; a small remaining overrun
 * is absorbed at assembly by holding the scene's last frame. Mutates and
 * returns `audio`. */
export async function generateNarrationAudio(
  audio: FilmAudio,
  scenes: FilmScene[],
  onNote?: (note: string) => void,
): Promise<FilmAudio> {
  const byKey = new Map(audioScenes(scenes).map((s) => [s.scene_key, s]));
  const voiceId = audio.voice_plan?.voiceId || undefined;
  const pending = audio.narration.filter((n) => n.voice_source === 'elevenlabs'
    && (n.status !== 'ready' || !n.audioUrl || (voiceId && n.voiceId !== voiceId)));

  if (pending.length) {
    onNote?.(`ElevenLabs is recording ${pending.length} narration line${pending.length === 1 ? '' : 's'} (${audio.voice_plan?.voiceName || 'default voice'})…`);
    let segs: any[] = [];
    try {
      const res = await audioPost(`/api/workspaces/${WORKSPACE_ID}/audio/voiceover/segments`, {
        segments: pending.map((n) => ({ text: n.text })),
        voiceId,
        fps: 30,
      });
      segs = Array.isArray(res?.segments) ? res.segments : [];
      if (segs.length !== pending.length) throw new Error('ElevenLabs returned an incomplete set of narration segments.');
    } catch (e: any) {
      pending.forEach((n) => { n.status = 'failed'; n.error = String(e?.message || e).slice(0, 200); });
      throw new AudioLayerError('narration', `Narration generation failed: ${String(e?.message || e)}`);
    }
    pending.forEach((n, i) => {
      const url = String(segs[i]?.audioUrl || '');
      if (!url) { n.status = 'failed'; n.error = 'ElevenLabs returned no audio file for this line.'; return; }
      n.audioUrl = url;
      n.voiceId = voiceId || String(segs[i]?.voiceId || '');
      const ms = Number(segs[i]?.durationMs) || 0;
      n.duration_s = ms > 0 ? ms / 1000 : undefined; // missing → probed below
      n.status = 'ready';
      n.error = undefined;
    });
    const failed = pending.filter((n) => n.status === 'failed');
    if (failed.length) throw new AudioLayerError('narration', `${failed.length} narration line${failed.length === 1 ? '' : 's'} came back without audio.`);
  }

  // TIMING — the voice drives the cut, but never by unnatural speed-up.
  for (const n of audio.narration) {
    if (n.voice_source !== 'elevenlabs' || n.status !== 'ready' || !n.audioUrl) continue;
    const scene = byKey.get(n.scene_key);
    if (!scene) continue;
    const sceneDur = Number(scene.duration_s) || 6;
    if (!n.duration_s) n.duration_s = (await probeAudioDuration(n.audioUrl)) || undefined;
    const dur = n.duration_s || 0;
    if (dur && dur > sceneDur + NARRATION_TOLERANCE_S) {
      onNote?.(`Scene ${scene.idx + 1}: narration runs ${dur.toFixed(1)}s against a ${sceneDur.toFixed(1)}s clip — rewriting it tighter (same meaning, same voice)…`);
      try {
        const tightened = await tightenNarrationLine(n.text, sceneDur);
        if (tightened && tightened !== n.text) {
          const single = await audioPost(`/api/workspaces/${WORKSPACE_ID}/audio/voiceover`, { script: tightened, voiceId: n.voiceId || voiceId });
          if (single?.audioUrl) {
            n.text = tightened;
            n.audioUrl = String(single.audioUrl);
            const measured = await probeAudioDuration(n.audioUrl);
            n.duration_s = measured || Math.max(0.2, (Number(single.estimatedDurationMs) || 0) / 1000) || n.duration_s;
          }
        }
      } catch { /* the original take stands — assembly holds the last frame briefly */ }
    }
  }
  return audio;
}

/** Mirror the film-level narration entries onto the scene rows, so every scene
 * carries its own { text, voiceId, audioUrl, duration } (the scene data model
 * the timeline and assembly read). */
export async function persistSceneNarration(audio: FilmAudio, scenes: FilmScene[]): Promise<void> {
  for (const n of audio.narration) {
    const scene = scenes.find((s) => s.scene_key === n.scene_key);
    if (!scene) continue;
    const value: SceneNarration | null = (n.voice_source === 'elevenlabs' && n.status === 'ready' && n.audioUrl)
      ? { text: n.text, voiceId: n.voiceId || '', audioUrl: n.audioUrl, duration_s: n.duration_s || 0 }
      : null;
    if (JSON.stringify(scene.narration || null) === JSON.stringify(value)) continue;
    scene.narration = value;
    try { await db.updateScene(scene.id, { narration: value }); } catch { /* film.audio remains the source of truth */ }
  }
}

// ---------------------------------------------------------------------------
// Music generation (ElevenLabs / custom brief)
// ---------------------------------------------------------------------------

export async function generateMusicAudio(
  audio: FilmAudio,
  totalDurationS: number,
  onNote?: (note: string) => void,
): Promise<FilmAudio> {
  const music = audio.music;
  if (!music || !music.required || music.status === 'skipped') return audio;
  if (music.status === 'ready' && music.audioUrl) return audio;
  const lengthMs = Math.min(600000, Math.max(3000, Math.ceil(totalDurationS * 1000)));
  onNote?.(`Composing the ${music.preset} music bed (${Math.round(lengthMs / 1000)}s)…`);
  try {
    let data: any = null;
    if (music.customPrompt && music.customPrompt.length >= 10) {
      try {
        data = await audioPost(`/api/workspaces/${WORKSPACE_ID}/audio/music/custom`, { prompt: music.customPrompt, lengthMs, instrumental: true });
      } catch { data = null; /* the preset is the fallback for the same brief */ }
    }
    if (!data?.audioUrl) {
      data = await audioPost(`/api/workspaces/${WORKSPACE_ID}/audio/music/preset`, { preset: music.preset, lengthMs, provider: 'elevenlabs' });
    }
    if (!data?.audioUrl) throw new Error('Music generation returned no audio file.');
    music.audioUrl = String(data.audioUrl);
    music.duration_s = Math.max(0, (Number(data.durationMs) || lengthMs) / 1000);
    music.status = 'ready';
    music.error = undefined;
  } catch (e: any) {
    music.status = 'failed';
    music.error = String(e?.message || e).slice(0, 300);
    throw new AudioLayerError('music', `Music preparation failed: ${music.error}`);
  }
  return audio;
}

// ---------------------------------------------------------------------------
// SFX generation — short bespoke effect clips, mixed subtly at assembly
// ---------------------------------------------------------------------------

export async function generateSfxAudio(
  audio: FilmAudio,
  onNote?: (note: string) => void,
): Promise<FilmAudio> {
  if (audio.sfx_status === 'skipped') return audio;
  if (!audio.sfx.length) { audio.sfx_status = 'none'; return audio; }
  const pending = audio.sfx.filter((f) => f.status !== 'ready' || !f.audioUrl);
  if (!pending.length) { audio.sfx_status = 'ready'; return audio; }
  onNote?.(`Preparing ${pending.length} sound effect${pending.length === 1 ? '' : 's'}…`);
  let failures = 0;
  for (const f of pending) {
    try {
      const data = await audioPost(`/api/workspaces/${WORKSPACE_ID}/audio/music/custom`, {
        prompt: `Sound effect only: ${f.prompt}. One single isolated sound effect with silence around it — no music, no melody, no rhythm, no drums, no voice.`,
        lengthMs: 3000,
        instrumental: true,
      });
      if (!data?.audioUrl) throw new Error('No audio file returned.');
      f.audioUrl = String(data.audioUrl);
      f.duration_s = Math.max(0.2, (Number(data.durationMs) || 3000) / 1000);
      f.status = 'ready';
      f.error = undefined;
    } catch (e: any) {
      f.status = 'failed';
      f.error = String(e?.message || e).slice(0, 200);
      failures += 1;
    }
  }
  audio.sfx_status = failures ? 'failed' : 'ready';
  if (failures) throw new AudioLayerError('sfx', `${failures} of ${audio.sfx.length} sound effects could not be generated.`);
  return audio;
}
