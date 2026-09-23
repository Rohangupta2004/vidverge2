/**
 * PER-SCENE NARRATION — ElevenLabs TTS for CAPTURED scenes only.
 *
 * Motion-graphic, product-mockup and asset-overlay scenes are recorded silent
 * by the browser capture, so the narrator reads each scene's script segment
 * aloud through the platform ElevenLabs voiceover endpoint (the same
 * workspace-proxied pattern finish.ts uses):
 *
 *   POST /api/workspaces/<id>/audio/voiceover  { script, voiceId? }
 *     → { audioUrl }   (auth: X-Workspace-DB-Token)
 *
 * VEO CINEMATIC SCENES NEVER GET ONE — they carry their own generated
 * dialogue/ambient audio, and a voice-over on top would double-talk the film.
 * The narration is mixed into the scene's own segment at assembly, padded or
 * trimmed to the scene duration so the voice stays in sync.
 */

import { wsToken } from '../api';

const WORKSPACE_ID = 'f24710e5-7c6d-4db4-92b4-c2c235877575';

/** Reduce a raw script segment to the words a narrator would actually speak:
 * markdown chrome, blockquote markers, stage labels ("VO:", "Scene 3 — …")
 * and screen directions add nothing aloud. */
export function narrationText(segment: string): string {
  return String(segment || '')
    .replace(/^\s*(?:---+|```.*)$/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*(?:vo|voice[- ]?over|narrator)\s*:\s*/gim, '')
    .replace(/^\s*scene\s+\d+[^\n]*$/gim, '')
    .replace(/[*_#`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2500);
}

/** Speak one captured scene's segment. Returns null when there is nothing to say. */
export async function generateSceneNarration(segment: string, voiceId?: string): Promise<string | null> {
  const text = narrationText(segment);
  if (text.length < 3) return null;
  const token = wsToken();
  if (!token) throw new Error('Your workspace session is still loading — try again in a moment.');
  const res = await fetch(`/api/workspaces/${WORKSPACE_ID}/audio/voiceover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
    body: JSON.stringify({ script: text, voiceId: voiceId || undefined }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.audioUrl) throw new Error(String(data?.error || data?.message || `Scene narration failed (HTTP ${res.status}).`));
  return String(data.audioUrl);
}

/** Measure an audio file's duration (seconds) so the scene can stretch to fit
 * the spoken line. 0 means the duration could not be read — never fatal. */
export function probeAudioDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: number) => { if (settled) return; settled = true; audio.src = ''; resolve(v); };
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) ? audio.duration : 0);
    audio.onerror = () => done(0);
    setTimeout(() => done(0), 8000);
    audio.src = url;
  });
}
