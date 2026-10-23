/**
 * AUDIO PIPELINE — the reliable narration / music / SFX layer of the
 * sequential Script-to-Video pipeline.
 *
 *   Original script → Opus 5 (voice plan + scene-level narration plan +
 *   music brief + sparse SFX) → ElevenLabs (voiceover segments) +
 *   ElevenLabs/Gemini (music) → per-scene audio attached to the timeline →
 *   FFmpeg final assembly.
 *
 * Policy (one authoritative voice per scene, never two):
 * - NARRATION IS OPTIONAL. The voiceover step offers three sources (see
 *   ./voiceSource): no voiceover, ElevenLabs, or the platform's built-in AI
 *   voice. 'No Voiceover' needs nothing generated, so the step is complete the
 *   moment it is chosen and an unavailable voice provider can never hold the
 *   pipeline up.
 * - The chosen TTS engine is the AUTHORITATIVE narration track for a narrated
 *   scene. On one, the clip's own generated audio is kept only as low ambience
 *   under the voice.
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
  FilmScene, SceneNarration, VoiceSourceId, db, fingerprint,
} from '../api';
import { PlannedFilmAudio, planFilmAudio, tightenNarrationLine } from './opus';
import { probeAudioDuration } from './sceneVoice';
import { VoiceOption, listVoices } from './finish';
import {
  DEFAULT_OPENAI_VOICE, loadOpenAiVoicePref, loadVoiceSourcePref,
  openAiVoiceLabel, recordOpenAiLine,
} from './voiceSource';
import {
  ElevenModelId, NARRATION_MODEL, elevenModelLabel, elevenVoiceSettings,
  isElevenModelRejection, narrationModelForChars, nextNarrationModel,
} from '../../../lib/elevenLabsModels';
import { WORKSPACE_ID, getWorkspaceToken } from '../../../lib/workspace';

/**
 * THE TTS MODEL IS EXPLICIT NOW. Narration records on ElevenLabs v4, falling
 * back to v3 and then the legacy turbo model. The settings travel WITH the
 * model (see lib/elevenLabsModels.ts): each model rejects the others' fields
 * with a 400 before anything is billed, so there is no single shared settings
 * object any more.
 */
let narrationModel: ElevenModelId = NARRATION_MODEL;

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

async function audioHeaders(): Promise<Record<string, string>> {
  const token = await getWorkspaceToken();
  if (!token) throw new Error('Your workspace session is still loading — try again in a moment.');
  return { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token };
}

class AudioRequestError extends Error {
  status: number;
  code: string;
  retryable?: boolean;
  constructor(message: string, status: number, code = '', retryable?: boolean) {
    super(message);
    this.name = 'AudioRequestError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

async function audioPost(path: string, body: unknown): Promise<any> {
  const res = await fetch(path, { method: 'POST', headers: await audioHeaders(), body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.success === false) {
    throw new AudioRequestError(
      String(data?.error || data?.message || `Audio generation failed (HTTP ${res.status}).`),
      res.status,
      String(data?.code || ''),
      typeof data?.retryable === 'boolean' ? data.retryable : undefined,
    );
  }
  return data;
}

/**
 * POST one voiceover request on the current narration model, walking down the
 * model ladder when the platform refuses THAT MODEL rather than the request.
 *
 * The model that works is remembered for the rest of the film, so a long
 * narration does not re-walk (and re-spend on) the ladder for every batch.
 * Anything that is not a model rejection — a wallet, auth, rate-limit or
 * provider error — is rethrown untouched: it would mean the same thing on
 * every model.
 */
async function postVoiceover(
  path: string,
  body: Record<string, unknown>,
  longestChars: number,
  onNote?: (note: string) => void,
): Promise<any> {
  for (;;) {
    // A line too long for the current model starts on one that holds it,
    // rather than failing a paid request to discover the limit.
    const model = narrationModelForChars(longestChars, narrationModel);
    try {
      return await audioPost(path, {
        ...body,
        modelId: model,
        voiceSettings: elevenVoiceSettings(model),
      });
    } catch (e) {
      const refusedTheModel = e instanceof AudioRequestError
        && isElevenModelRejection({ status: e.status, code: e.code, message: e.message });
      const next = refusedTheModel ? nextNarrationModel(model) : null;
      if (!next) throw e;
      narrationModel = next;
      onNote?.(`${elevenModelLabel(model)} could not record this narration — recording on ${elevenModelLabel(next)} instead.`);
    }
  }
}

/** ElevenLabs accepts at most 100 segments / 20,000 characters per voiceover
 * request; a long film's narration is recorded in as many batches as it
 * needs instead of being limited to what one request holds. */
const NARRATION_BATCH_SEGMENTS = 100;
const NARRATION_BATCH_CHARS = 20000;

function narrationBatches(lines: AudioNarrationEntry[]): AudioNarrationEntry[][] {
  const batches: AudioNarrationEntry[][] = [];
  let batch: AudioNarrationEntry[] = [];
  let chars = 0;
  for (const n of lines) {
    const len = String(n.text || '').length;
    if (batch.length && (batch.length >= NARRATION_BATCH_SEGMENTS || chars + len > NARRATION_BATCH_CHARS)) {
      batches.push(batch);
      batch = [];
      chars = 0;
    }
    batch.push(n);
    chars += len;
  }
  if (batch.length) batches.push(batch);
  return batches;
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
// Voice source — narration is optional, and never a gate
// ---------------------------------------------------------------------------

/** True for a source that has to be RECORDED before assembly can use it. The
 * other two need nothing: 'video_native' is already inside the clip and
 * 'none' is silence, so neither can ever hold the pipeline up. */
export function isSpokenSource(source: string | undefined): boolean {
  return source === 'elevenlabs' || source === 'openai';
}

/** The film's narration engine: an explicit choice wins, then whatever is
 * selected on the voiceover step this session, then the film's own stored
 * plan. With nothing to go on it is NO voiceover — the one setting that cannot
 * wait on a voice provider, so a film always has a way through this step.
 *
 * The session preference outranks the stored plan ON PURPOSE: it is what the
 * selector is showing, and opening a film writes that film's own source into
 * it, so the two never drift apart. */
export function resolveVoiceSource(film: Film, override?: VoiceSourceId | null): VoiceSourceId {
  if (override) return override;
  if (film.audio?.voice_source) return film.audio.voice_source;
  // The saved Brief choice outranks stale browser preferences. Narration ON
  // starts with the managed premium voice; Narration OFF stays off.
  return film.plan?.narration_enabled === true ? 'elevenlabs' : 'none';
}

/** Is the film's audio plan current for these scenes AND for the voice source
 * now selected? A plan whose source moved under it is re-pointed at the new
 * engine before anything is generated or assembled. */
export function audioPlanCurrent(film: Film, scenes: FilmScene[]): boolean {
  const audio = film.audio;
  if (!audio) return false;
  if (audio.planned_fingerprint !== audioFingerprint(scenes)) return false;
  return (audio.voice_source || 'elevenlabs') === resolveVoiceSource(film);
}

/** The source ONE scene ends up with, given the film's choice. A scene with
 * on-camera dialogue always keeps the clip's own voice and a wordless beat
 * stays wordless, whichever source the film is on. */
function entrySource(
  planned: AudioNarrationEntry['planned_source'],
  choice: VoiceSourceId,
): AudioNarrationEntry['voice_source'] {
  if (planned === 'video_native') return 'video_native';
  if (planned !== 'elevenlabs') return 'none';
  return choice === 'none' ? 'none' : choice;
}

/** What the sound director decided for a line — reconstructed for entries
 * written before planned_source existed, where the voice source WAS the
 * decision (narration had no other setting then). */
function plannedSourceOf(entry: AudioNarrationEntry): AudioNarrationEntry['planned_source'] {
  if (entry.planned_source) return entry.planned_source;
  if (entry.voice_source === 'video_native') return 'video_native';
  return isSpokenSource(entry.voice_source) ? 'elevenlabs' : 'none';
}

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

export function narrationReady(audio: FilmAudio | null): boolean {
  if (!audio) return false;
  return audio.narration.every((n) => !isSpokenSource(n.voice_source) || (n.status === 'ready' && !!n.audioUrl));
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
  opts: {
    forceReplan?: boolean;
    voiceId?: string;
    voiceName?: string;
    /** Explicit voice source for this plan; omitted = the film's own choice. */
    voiceSource?: VoiceSourceId;
    openaiVoice?: string;
  } = {},
): Promise<FilmAudio> {
  const done = audioScenes(scenes);
  if (!done.length) throw new AudioLayerError('narration', 'No completed scenes to plan audio for yet.');
  const fp = audioFingerprint(scenes);
  const source = resolveVoiceSource(film, opts.voiceSource);
  const openaiVoice = opts.openaiVoice || film.audio?.openai_voice || loadOpenAiVoicePref();
  if (film.plan?.audio_enabled === false) {
    const planned = silentAudioPlan(done, false);
    return {
      version: 1,
      voice_plan: planned.voice_plan,
      narration: planned.narration.map((n) => ({ ...n, planned_source: 'none', status: 'ready' as const })),
      music: { required: false, preset: 'cinematic', status: 'skipped' },
      sfx: [], sfx_status: 'none', voice_source: 'none', openai_voice: openaiVoice,
      planned_fingerprint: fp, planned_at: new Date().toISOString(),
    };
  }

  if (film.audio && film.audio.planned_fingerprint === fp && !opts.forceReplan) {
    const sourceChanged = source !== (film.audio.voice_source || 'elevenlabs')
      || (source === 'openai' && openaiVoice !== film.audio.openai_voice);
    const current = sourceChanged ? withVoiceSource(film.audio, source, openaiVoice) : film.audio;
    if (opts.voiceId && current.voice_plan && opts.voiceId !== current.voice_plan.voiceId) {
      return withVoice(current, opts.voiceId, opts.voiceName);
    }
    return current;
  }

  onNote?.(source === 'none'
    ? 'Opus is planning the music and SFX for your scenes — no voiceover is selected…'
    : 'Opus is planning the voice, narration, music and SFX together with the scenes…');
  const voices = await fetchVoices();
  let planned: PlannedFilmAudio;
  try {
    planned = await planFilmAudio({ film, scenes: done, voices });
  } catch (e: any) {
    // With no voiceover the narration script is never spoken, so a planning
    // failure must not strand the film: carry on with a music-only plan.
    if (source !== 'none') throw e;
    onNote?.(`The audio plan could not be written (${String(e?.message || e).slice(0, 120)}) — continuing with no voiceover and a default music bed.`);
    planned = silentAudioPlan(done);
  }

  // Voice continuity: an explicit choice or the previous plan's voice wins.
  const keepVoice = opts.voiceId || film.audio?.voice_plan?.voiceId || '';
  if (keepVoice) {
    const known = voices.find((v) => v.id === keepVoice);
    if (known || !voices.length) {
      planned.voice_plan.voiceId = keepVoice;
      planned.voice_plan.voiceName = known?.name || opts.voiceName || film.audio?.voice_plan?.voiceName || planned.voice_plan.voiceName;
    } else {
      const replacement = voices[0];
      planned.voice_plan.voiceId = replacement.id;
      planned.voice_plan.voiceName = replacement.name;
      onNote?.(`${opts.voiceName || film.audio?.voice_plan?.voiceName || 'The saved ElevenLabs voice'} is no longer in the managed catalog — using ${replacement.name}.`);
    }
  }

  const prior = film.audio;
  const narration: AudioNarrationEntry[] = planned.narration.map((n) => {
    // The director's decision is kept verbatim; the film's voice source then
    // decides whether that line is spoken at all, and by which engine.
    const planned_source: AudioNarrationEntry['planned_source'] = n.voice_source === 'video_native'
      ? 'video_native'
      : n.voice_source === 'none' ? 'none' : 'elevenlabs';
    const voice_source = entrySource(planned_source, source);
    const wantedVoice = voice_source === 'openai' ? openaiVoice : planned.voice_plan.voiceId;
    const before = prior?.narration?.find((p) => p.scene_key === n.scene_key);
    const reusable = before && before.status === 'ready' && before.audioUrl
      && before.text === n.text && before.voice_source === voice_source
      && before.voiceId === wantedVoice;
    if (reusable) return { ...before!, planned_source };
    return {
      ...n,
      planned_source,
      voice_source,
      status: isSpokenSource(voice_source) ? 'pending' : 'ready',
    } as AudioNarrationEntry;
  });

  const music: AudioMusicPlan = { ...planned.music, status: planned.music.required ? 'pending' : 'skipped' };
  if (prior?.music?.status === 'skipped') {
    music.status = 'skipped';
    music.skip_reason = prior.music.skip_reason;
  } else if (prior?.music?.status === 'ready' && prior.music.audioUrl
    && prior.music.preset === music.preset && String(prior.music.customPrompt || '') === String(music.customPrompt || '')) {
    music.audioUrl = prior.music.audioUrl;
    music.duration_s = prior.music.duration_s;
    music.provider = prior.music.provider;
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
    voice_source: source,
    openai_voice: openaiVoice,
    planned_fingerprint: fp,
    planned_at: new Date().toISOString(),
  };
}

/** The plan a film falls back to when no voiceover is wanted and the sound
 * director could not be reached: nothing spoken, a default music bed, no SFX.
 * Music and SFX stay individually retryable and skippable from the UI. */
function silentAudioPlan(scenes: FilmScene[], audioEnabled = true): PlannedFilmAudio {
  return {
    voice_plan: {
      tone: 'neutral', energy: 'steady', pace: 'natural', emotion: 'grounded',
      language: 'English', accent: 'neutral', voiceId: '', voiceName: 'No voiceover',
    },
    narration: scenes.map((s) => ({
      scene_key: s.scene_key,
      text: '',
      voice_source: (s.dialogue && String((s.dialogue as any).line || '').trim() ? 'video_native' : 'none') as 'video_native' | 'none',
    })),
    music: { required: audioEnabled, preset: 'cinematic', volume: 0.22 },
    sfx: [],
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

/**
 * Switch the whole film's NARRATION ENGINE — No Voiceover / ElevenLabs /
 * built-in AI voice.
 *
 * Only the narration layer is re-shaped: music, SFX and every generated video
 * clip are untouched. A take already recorded on the engine being switched to
 * is kept even if the film was silent in between, so flipping the selector
 * back and forth never re-bills a line. Choosing 'none' leaves the layer
 * instantly complete, which is what makes the step skippable.
 */
export function withVoiceSource(audio: FilmAudio, source: VoiceSourceId, openaiVoice?: string): FilmAudio {
  const builtInVoice = openaiVoice || audio.openai_voice || DEFAULT_OPENAI_VOICE;
  return {
    ...audio,
    voice_source: source,
    openai_voice: builtInVoice,
    narration: audio.narration.map((n) => {
      const planned_source = plannedSourceOf(n);
      const next = entrySource(planned_source, source);
      const wantedVoice = next === 'openai' ? builtInVoice : (audio.voice_plan?.voiceId || n.voiceId);
      const recorded = n.status === 'ready' && !!n.audioUrl && !!n.voiceId;
      // Nothing to record: the line is silent or already inside the clip. The
      // audio of a previous take is kept so switching back can reuse it.
      if (!isSpokenSource(next)) {
        return { ...n, planned_source, voice_source: next, status: 'ready' as const, error: undefined };
      }
      if (recorded && n.voiceId === wantedVoice) {
        return { ...n, planned_source, voice_source: next, status: 'ready' as const, error: undefined };
      }
      return {
        ...n,
        planned_source,
        voice_source: next,
        voiceId: undefined,
        audioUrl: undefined,
        duration_s: undefined,
        status: 'pending' as const,
        error: undefined,
      };
    }),
  };
}

/** [Continue Without Voiceover] — drop the narration layer and assemble from
 * the clips' own sound. Nothing is regenerated. */
export function skipNarrationLayer(audio: FilmAudio): FilmAudio {
  return withVoiceSource(audio, 'none');
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
  return { ...audio, music: audio.music ? { ...audio.music, status: 'skipped', error: undefined, skip_reason: undefined } : { required: false, preset: 'cinematic', status: 'skipped' } };
}

export function skipSfxLayer(audio: FilmAudio): FilmAudio {
  return { ...audio, sfx_status: 'skipped' };
}

// ---------------------------------------------------------------------------
// Narration generation (ElevenLabs or the built-in AI voice) + timing
// ---------------------------------------------------------------------------

/** Re-record ONE line on the engine that already voices it (the timing pass).
 * Same engine, same voice — a re-take never changes who is speaking. */
async function reRecordLine(
  entry: AudioNarrationEntry,
  text: string,
  fallbackVoiceId?: string,
): Promise<{ audioUrl: string; duration_s?: number } | null> {
  if (entry.voice_source === 'openai') {
    const take = await recordOpenAiLine({
      text,
      voice: entry.voiceId || DEFAULT_OPENAI_VOICE,
      label: `narration-${entry.scene_key}`,
    });
    return { audioUrl: take.audioUrl, duration_s: take.durationS || undefined };
  }
  const single = await postVoiceover(
    `/api/workspaces/${WORKSPACE_ID}/audio/voiceover`,
    { script: text, voiceId: entry.voiceId || fallbackVoiceId },
    text.length,
  );
  if (!single?.audioUrl) return null;
  const audioUrl = String(single.audioUrl);
  const measured = await probeAudioDuration(audioUrl);
  return {
    audioUrl,
    duration_s: measured || Math.max(0.2, (Number(single.estimatedDurationMs) || 0) / 1000) || undefined,
  };
}

/** Explicit, per-scene fallback for dialogue rendered by a silent video
 * model. It uses the approved character's stored voice_id and does nothing
 * until the creator presses the scene button, so credits are never spent
 * silently. The returned take is mixed only for this scene at assembly. */
export async function generateCharacterDialogueFallback(
  film: Film,
  scene: FilmScene,
  onNote?: (note: string) => void,
): Promise<SceneNarration> {
  const dialogue = scene.dialogue;
  const line = String(dialogue?.line || '').trim();
  if (dialogue?.kind !== 'character' || !line) throw new AudioLayerError('narration', 'This scene has no character dialogue to record.');
  const speakerTokens = String(dialogue.speaker || '')
    .toLowerCase()
    .split(/\s*(?:\/|,|&|\band\b)\s*/)
    .map((value) => value.trim())
    .filter(Boolean);
  const characters = Array.isArray(film.plan?.characters) ? film.plan!.characters! : [];
  const matchedCharacters = characters.filter((item) => {
    const id = String(item.id || '').toLowerCase();
    const name = String(item.name || '').toLowerCase();
    return speakerTokens.includes(id) || speakerTokens.includes(name);
  });
  if (matchedCharacters.length > 1) {
    throw new AudioLayerError('narration', 'This block combines more than one speaking character. Split it into one dialogue block per character before adding a voice fallback, so each stored voice ID stays attached to the right line.');
  }
  const character = matchedCharacters[0] || (characters.length === 1 ? characters[0] : null);
  const voiceId = String(character?.voice?.voice_id || '').trim();
  if (!character || !voiceId) {
    throw new AudioLayerError('narration', `Add an ElevenLabs Voice ID to ${character?.name || dialogue.speaker || 'this character'} in Cast approval, then try this line again.`);
  }
  onNote?.(`Recording only Scene ${scene.idx + 1} with ${character.name}'s stored voice…`);
  try {
    const take = await reRecordLine({
      scene_key: scene.scene_key,
      text: line,
      voice_source: 'elevenlabs',
      planned_source: 'elevenlabs',
      voiceId,
      status: 'pending',
    }, line, voiceId);
    if (!take?.audioUrl) throw new Error('ElevenLabs returned no audio file for this line.');
    return { text: line, voiceId, audioUrl: take.audioUrl, duration_s: take.duration_s || 0 };
  } catch (error: any) {
    throw new AudioLayerError('narration', `This character line could not be generated: ${String(error?.message || error)}`);
  }
}

/** Record every missing narration line on the film's chosen engine — ElevenLabs
 * with the film's ONE voice, or the platform's built-in AI voice — then resolve
 * timing mismatches: a line that overruns its clip is rewritten tighter
 * (meaning preserved) and re-recorded once; a small remaining overrun is
 * absorbed at assembly by holding the scene's last frame. A film with no
 * voiceover has nothing pending here and returns untouched. Mutates and
 * returns `audio`. */
export async function generateNarrationAudio(
  audio: FilmAudio,
  scenes: FilmScene[],
  onNote?: (note: string) => void,
): Promise<FilmAudio> {
  const byKey = new Map(audioScenes(scenes).map((s) => [s.scene_key, s]));
  const voiceId = audio.voice_plan?.voiceId || undefined;
  const builtInVoice = audio.openai_voice || DEFAULT_OPENAI_VOICE;
  const needsTake = (n: AudioNarrationEntry) => n.status !== 'ready' || !n.audioUrl;
  const pending = audio.narration.filter((n) => n.voice_source === 'elevenlabs'
    && (needsTake(n) || (voiceId && n.voiceId !== voiceId)));
  const pendingBuiltIn = audio.narration.filter((n) => n.voice_source === 'openai'
    && (needsTake(n) || n.voiceId !== builtInVoice));

  if (pending.length) {
    onNote?.(`${elevenModelLabel(narrationModel)} is recording ${pending.length} narration line${pending.length === 1 ? '' : 's'} (${audio.voice_plan?.voiceName || 'default voice'})…`);
    const applySegment = (n: AudioNarrationEntry, seg: any) => {
      const url = String(seg?.audioUrl || '');
      if (!url) { n.status = 'failed'; n.error = 'ElevenLabs returned no audio file for this line.'; return; }
      n.audioUrl = url;
      n.voiceId = voiceId || String(seg?.voiceId || '');
      const ms = Number(seg?.durationMs) || 0;
      n.duration_s = ms > 0 ? ms / 1000 : undefined; // missing → probed below
      n.status = 'ready';
      n.error = undefined;
    };
    const batches = narrationBatches(pending);
    try {
      let b = 0;
      for (const batch of batches) {
        b += 1;
        if (batches.length > 1) onNote?.(`Recording narration batch ${b} of ${batches.length} (${batch.length} line${batch.length === 1 ? '' : 's'})…`);
        const requestBatch = () => postVoiceover(
          `/api/workspaces/${WORKSPACE_ID}/audio/voiceover/segments`,
          { segments: batch.map((n) => ({ text: n.text })), voiceId, fps: 30 },
          batch.reduce((longest, n) => Math.max(longest, String(n.text || '').length), 0),
          onNote,
        );
        let res: any;
        try {
          res = await requestBatch();
        } catch (firstError: any) {
          onNote?.(`ElevenLabs could not record this batch — retrying once (${String(firstError?.message || firstError).slice(0, 100)}).`);
          res = await requestBatch();
        }
        const segs: any[] = Array.isArray(res?.segments) ? res.segments : [];
        if (segs.length !== batch.length) throw new Error('ElevenLabs returned an incomplete set of narration segments.');
        batch.forEach((n, i) => applySegment(n, segs[i]));
      }
    } catch (e: any) {
      // The managed voice was tried once and retried once. Keep the film moving
      // on the platform speech proxy, and re-record every narration line there
      // so one film never changes narrator halfway through.
      const reason = String(e?.message || e).slice(0, 160);
      onNote?.(`ElevenLabs was unavailable after one retry — using the built-in ${openAiVoiceLabel(builtInVoice)} voice instead.`);
      let fallbackFailure: any = null;
      for (const n of pending) {
        try {
          const take = await recordOpenAiLine({ text: n.text, voice: builtInVoice, label: `narration-${n.scene_key}` });
          n.voice_source = 'openai';
          n.voiceId = builtInVoice;
          n.audioUrl = take.audioUrl;
          n.duration_s = take.durationS || undefined;
          n.status = 'ready';
          n.error = undefined;
        } catch (fallbackError: any) {
          n.status = 'failed';
          n.error = 'Neither managed narration voice was available.';
          fallbackFailure = fallbackFailure || fallbackError;
        }
      }
      audio.voice_used = fallbackFailure ? undefined : 'openai';
      audio.voice_fallback_reason = fallbackFailure ? undefined : `ElevenLabs failed after one retry: ${reason}`;
      if (fallbackFailure) throw new AudioLayerError('narration', 'Narration could not be generated on ElevenLabs or the built-in AI voice.');
    }
    const failed = pending.filter((n) => n.status === 'failed');
    if (failed.length) throw new AudioLayerError('narration', `${failed.length} narration line${failed.length === 1 ? '' : 's'} came back without audio.`);
    if (!audio.voice_used) audio.voice_used = 'elevenlabs';
  }

  // BUILT-IN AI VOICE — the platform speech proxy, one line per request. A
  // line that refuses is marked failed and the rest still get their audio, so
  // one bad line costs one line rather than the whole voiceover.
  if (pendingBuiltIn.length) {
    onNote?.(`The built-in ${openAiVoiceLabel(builtInVoice)} voice is recording ${pendingBuiltIn.length} narration line${pendingBuiltIn.length === 1 ? '' : 's'}…`);
    let firstFailure: any = null;
    for (const n of pendingBuiltIn) {
      try {
        const take = await recordOpenAiLine({ text: n.text, voice: builtInVoice, label: `narration-${n.scene_key}` });
        n.audioUrl = take.audioUrl;
        n.voiceId = builtInVoice;
        n.duration_s = take.durationS || undefined;
        n.status = 'ready';
        n.error = undefined;
      } catch (e: any) {
        n.status = 'failed';
        n.error = String(e?.message || e).slice(0, 200);
        firstFailure = firstFailure || e;
      }
    }
    if (firstFailure) {
      throw new AudioLayerError('narration', `The built-in voice could not record every line: ${String(firstFailure?.message || firstFailure)}`);
    }
    audio.voice_used = 'openai';
    if (audio.voice_source === 'openai') audio.voice_fallback_reason = undefined;
  }

  // TIMING — the voice drives the cut, but never by unnatural speed-up.
  for (const n of audio.narration) {
    if (!isSpokenSource(n.voice_source) || n.status !== 'ready' || !n.audioUrl) continue;
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
          const retake = await reRecordLine(n, tightened, voiceId);
          if (retake) {
            n.text = tightened;
            n.audioUrl = retake.audioUrl;
            n.duration_s = retake.duration_s || n.duration_s;
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
    const savedDialogueFallback = n.voice_source === 'video_native'
      && scene.dialogue?.kind === 'character'
      && !!scene.narration?.audioUrl
      ? scene.narration
      : null;
    const value: SceneNarration | null = savedDialogueFallback || ((isSpokenSource(n.voice_source) && n.status === 'ready' && n.audioUrl)
      ? { text: n.text, voiceId: n.voiceId || '', audioUrl: n.audioUrl, duration_s: n.duration_s || 0 }
      : null);
    if (JSON.stringify(scene.narration || null) === JSON.stringify(value)) continue;
    scene.narration = value;
    try { await db.updateScene(scene.id, { narration: value }); } catch { /* film.audio remains the source of truth */ }
  }
}

// ---------------------------------------------------------------------------
// Music generation (ElevenLabs first, Google Gemini/Lyria fallback)
// ---------------------------------------------------------------------------

type MusicProvider = NonNullable<AudioMusicPlan['provider']>;

class MusicProvidersUnavailableError extends Error {
  constructor() {
    super('ElevenLabs and Google Gemini music are both unavailable.');
    this.name = 'MusicProvidersUnavailableError';
  }
}

/** Only provider-side failures trigger a provider switch. Authentication,
 * wallet, validation and rate-limit errors belong to the original request and
 * must surface unchanged instead of spending again through another provider. */
function isMusicProviderFailure(error: unknown): boolean {
  if (!(error instanceof AudioRequestError)) return false;
  return error.code === 'provider_error'
    || error.code === 'provider_quota_exceeded'
    || error.code === 'gemini_music_not_configured';
}

async function postMusicWithFallback(
  path: string,
  body: Record<string, unknown>,
  onNote?: (note: string) => void,
): Promise<any> {
  const onProvider = async (provider: MusicProvider) => {
    const request = () => audioPost(path, { ...body, provider });
    try {
      return await request();
    } catch (firstError) {
      if (!isMusicProviderFailure(firstError)) throw firstError;
      onNote?.(`${provider === 'elevenlabs' ? 'ElevenLabs' : 'Google Gemini'} music did not answer — retrying once…`);
      return await request();
    }
  };
  try {
    const data = await onProvider('elevenlabs');
    return { ...data, provider: (data?.provider || 'elevenlabs') as MusicProvider };
  } catch (elevenError) {
    if (!isMusicProviderFailure(elevenError)) throw elevenError;
    onNote?.('ElevenLabs music is unavailable after one retry — using Google Gemini (Lyria)…');
    try {
      const data = await onProvider('gemini');
      return { ...data, provider: (data?.provider || 'gemini') as MusicProvider };
    } catch (geminiError) {
      if (isMusicProviderFailure(geminiError)) throw new MusicProvidersUnavailableError();
      throw geminiError;
    }
  }
}

export async function generateMusicAudio(
  audio: FilmAudio,
  totalDurationS: number,
  onNote?: (note: string) => void,
): Promise<FilmAudio> {
  const music = audio.music;
  if (!music || !music.required || music.status === 'skipped') return audio;
  if (music.status === 'ready' && music.audioUrl) return audio;
  // ElevenLabs honors 3–600 seconds exactly. Gemini is model-driven: short
  // requests render about 30 seconds and longer tracks clamp at 240 seconds.
  // Assembly loops either provider's measured clip to the film's exact length.
  const lengthMs = Math.min(600000, Math.max(3000, Math.ceil(totalDurationS * 1000)));
  const loops = totalDurationS * 1000 > lengthMs;
  onNote?.(`Composing the ${music.preset} music bed (${Math.round(lengthMs / 1000)}s${loops ? `, looped to cover the ${Math.round(totalDurationS)}s film at assembly` : ''})…`);
  try {
    let data: any = null;
    if (music.customPrompt && music.customPrompt.length >= 10) {
      try {
        data = await postMusicWithFallback(
          `/api/workspaces/${WORKSPACE_ID}/audio/music/custom`,
          { prompt: music.customPrompt, lengthMs, instrumental: true },
          onNote,
        );
      } catch (e) {
        if (e instanceof MusicProvidersUnavailableError) throw e;
        data = null; // an invalid custom brief may still use its preset fallback
      }
    }
    if (!data?.audioUrl) {
      data = await postMusicWithFallback(
        `/api/workspaces/${WORKSPACE_ID}/audio/music/preset`,
        { preset: music.preset, lengthMs },
        onNote,
      );
    }
    if (!data?.audioUrl) throw new Error('Music generation returned no audio file.');
    music.audioUrl = String(data.audioUrl);
    const measuredDurationMs = Number(data.durationMs);
    music.duration_s = Number.isFinite(measuredDurationMs) && measuredDurationMs > 0
      ? measuredDurationMs / 1000
      : undefined;
    music.provider = data.provider === 'gemini' ? 'gemini' : 'elevenlabs';
    music.status = 'ready';
    music.error = undefined;
    music.skip_reason = undefined;
  } catch (e: any) {
    if (e instanceof MusicProvidersUnavailableError) {
      // Use the same skip path as the explicit Continue Without Music action,
      // then record why it happened so the stage note and cards stay honest.
      audio.music = skipMusicLayer(audio).music;
      if (audio.music) audio.music.skip_reason = 'providers_unavailable';
      onNote?.('ElevenLabs and Google Gemini music are unavailable — continuing without music.');
      return audio;
    }
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
      const requestEffect = () => audioPost(`/api/workspaces/${WORKSPACE_ID}/audio/music/custom`, {
        prompt: `Sound effect only: ${f.prompt}. One single isolated sound effect with silence around it — no music, no melody, no rhythm, no drums, no voice.`,
        lengthMs: 3000,
        instrumental: true,
      });
      let data: any;
      try {
        data = await requestEffect();
      } catch (firstError) {
        onNote?.(`One sound effect did not answer — retrying it once…`);
        data = await requestEffect();
      }
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
