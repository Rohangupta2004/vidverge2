/**
 * VERGER SPOKEN REPLIES — ElevenLabs PREMADE voices through the same managed
 * platform endpoints Voice Studio and SceneForge already use
 * (GET /audio/voices catalog, POST /audio/voiceover — ElevenLabs server-side).
 * Deliberately NOT cloned/library voices: the catalog is filtered to the
 * shared premade set. Default OFF; the preference persists per browser.
 *
 * Every spoken reply costs real ElevenLabs characters, so replies are capped
 * and run on the fast/cheap flash model.
 */
import { WORKSPACE_ID, getWorkspaceToken } from '../../../lib/workspace';
import { NARRATION_MODEL_FAST, elevenVoiceSettings } from '../../../lib/elevenLabsModels';

const PREF_KEY = 'verger_sound_pref_v1';
const MAX_SPOKEN_CHARS = 600;

export interface PremadeVoice {
  id: string;
  name: string;
}

export function soundPref(): boolean {
  try {
    return window.localStorage.getItem(PREF_KEY) === 'on';
  } catch {
    return false;
  }
}

export function setSoundPref(on: boolean): void {
  try {
    window.localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  } catch {
    /* private mode */
  }
}

let catalog: PremadeVoice[] | null = null;

/** Shared premade voices only — never this workspace's clones. */
export async function loadPremadeVoices(): Promise<PremadeVoice[]> {
  if (catalog) return catalog;
  const token = await getWorkspaceToken();
  const response = await fetch(`/api/workspaces/${WORKSPACE_ID}/audio/voices`, {
    headers: token ? { 'X-Workspace-DB-Token': token } : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(data?.error || `The voice catalog could not be loaded (${response.status}).`));
  const voices: PremadeVoice[] = (Array.isArray(data?.voices) ? data.voices : [])
    .filter((raw: any) => String(raw?.category || 'premade') === 'premade' && raw?.id)
    .map((raw: any) => ({ id: String(raw.id), name: String(raw.name || 'Voice') }));
  catalog = voices;
  return voices;
}

let activeAudio: HTMLAudioElement | null = null;

export function stopSpeaking(): void {
  if (activeAudio) {
    activeAudio.pause();
    activeAudio = null;
  }
}

/**
 * Read one reply aloud on a premade voice. Failures are quiet by design — a
 * missing voiceover must never break the conversation.
 */
export async function speakReply(text: string, voiceId: string): Promise<void> {
  const script = text.replace(/\s+/g, ' ').trim().slice(0, MAX_SPOKEN_CHARS);
  if (!script || !voiceId) return;
  const token = await getWorkspaceToken();
  if (!token) return;
  const response = await fetch(`/api/workspaces/${WORKSPACE_ID}/audio/voiceover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
    body: JSON.stringify({
      script,
      voiceId,
      modelId: NARRATION_MODEL_FAST,
      voiceSettings: elevenVoiceSettings(NARRATION_MODEL_FAST),
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.audioUrl) throw new Error(String(data?.error || 'The reply could not be voiced.'));
  stopSpeaking();
  const audio = new Audio(String(data.audioUrl));
  activeAudio = audio;
  await audio.play().catch(() => {
    /* autoplay blocked — the toggle click satisfies the gesture requirement next time */
  });
}
