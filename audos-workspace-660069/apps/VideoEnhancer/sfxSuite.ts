/**
 * Video Enhancer — sound-effects library for the editor's Sound FX panel.
 *
 * Same two-path generation strategy as musicSuite.ts:
 *   1. The founder's own ELEVENLABS_API_KEY via the workspace secrets proxy,
 *      calling ElevenLabs' generic sound-generation endpoint directly — the
 *      right tool for a one-shot effect (a whoosh, a ding, applause…).
 *   2. The platform's built-in ElevenLabs music endpoint as a fallback, so a
 *      sound effect can always be produced even with no founder key.
 *
 * A cue is placed at a moment on the SOURCE timeline (like a text overlay).
 * The live preview fires it as a one-shot Audio() the instant the playhead
 * crosses that moment; the export engine (editSuite.ts) schedules the same
 * one-shot into its Web Audio graph at the same crossing, so it always mixes
 * in with the original audio and any music bed in the final download.
 */
import { WORKSPACE_UUID, workspaceToken } from './enhancerCore';

function msg(e: unknown): string { return e instanceof Error ? e.message : String(e); }
function clampN(v: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, v)); }

export const BYOK_SFX_NOTE = 'Add an ELEVENLABS_API_KEY custom API key (allow-listed for api.elevenlabs.io) via Otto or the Integrations panel to generate sound effects on your own ElevenLabs account.';

export interface SfxPreset { id: string; label: string; prompt: string; hint: string }

/** A small preset library — ambient beds and punchy one-shots — so the panel is useful with zero typing. */
export const SFX_PRESETS: SfxPreset[] = [
  { id: 'applause', label: 'Applause', prompt: 'A warm crowd of people applauding and cheering, a short enthusiastic burst', hint: 'Reveals, wins, calls to action' },
  { id: 'whoosh', label: 'Whoosh', prompt: 'A fast cinematic whoosh transition sound, air moving quickly past the camera', hint: 'Cuts, swipes, transitions' },
  { id: 'ding', label: 'Notification', prompt: 'A short, clean, friendly notification ding, bright and simple', hint: 'Pop-ups, alerts, on-screen text' },
  { id: 'chime', label: 'Success chime', prompt: 'A cheerful two-note upward success chime, bright and satisfying', hint: 'Checkmarks, completions, wins' },
  { id: 'camera', label: 'Camera shutter', prompt: 'A single crisp camera shutter click with a soft mechanical snap', hint: 'Photo moments, screenshots' },
  { id: 'pop', label: 'Pop', prompt: 'A quick soft cartoon pop sound, bubbly and light', hint: 'Bullet reveals, playful beats' },
  { id: 'riser', label: 'Suspense riser', prompt: 'A tense rising synth riser building anticipation over about two seconds', hint: 'Build-ups, reveals, cliffhangers' },
  { id: 'drumhit', label: 'Drum hit', prompt: 'A single punchy cinematic drum impact hit with a deep boom', hint: 'Big statements, emphasis' },
  { id: 'sparkle', label: 'Magic sparkle', prompt: 'A light magical sparkle and twinkle sound, airy and delicate', hint: 'Highlights, before/after reveals' },
  { id: 'rain', label: 'Rain ambience', prompt: 'Gentle steady rain falling ambience, calm and continuous', hint: 'Mood, backgrounds, calm scenes' },
  { id: 'city', label: 'City ambience', prompt: 'Distant city street ambience with soft traffic and background chatter', hint: 'Urban b-roll, establishing shots' },
  { id: 'birds', label: 'Nature birds', prompt: 'Peaceful outdoor ambience with birds chirping softly', hint: 'Nature, outdoor, calm scenes' },
];

export type SfxStatus = 'generating' | 'ready' | 'error';

export interface SfxCue {
  id: string;
  label: string;
  prompt: string;
  /** Moment on the SOURCE timeline, in seconds. */
  at: number;
  /** Informational clip length in seconds. */
  duration: number;
  /** Playback gain 0..1. */
  volume: number;
  blob: Blob | null;
  /** Object URL for preview playback — revoke when the cue is removed. */
  url: string;
  status: SfxStatus;
  error?: string;
  source?: 'byok' | 'platform';
}

export function newSfxId(): string {
  return 'sfx-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

type ByokVerdict = 'unknown' | 'usable' | 'missing' | 'rejected' | 'host-not-allowed';
let byokVerdict: ByokVerdict = 'unknown';
const BYOK_CONFIG_FAILURES = new Set(['unknown_secret', 'no_allowed_hosts', 'host_not_allowed']);

function base64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** Founder-key path: ElevenLabs sound-generation — built for exactly this (one-shot effects, not just music). */
async function byokSfx(prompt: string, seconds: number): Promise<Blob> {
  const ws: any = typeof window !== 'undefined' ? (window as any).__workspaceDb : null;
  if (!ws || !ws.token || !ws.workspaceId) throw new Error('Your workspace session is still loading — try again in a moment.');
  const res = await fetch('/api/workspaces/' + ws.workspaceId + '/secrets/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': ws.token },
    body: JSON.stringify({
      method: 'POST',
      url: 'https://api.elevenlabs.io/v1/sound-generation',
      headers: { 'xi-api-key': '{{secrets.ELEVENLABS_API_KEY}}' },
      json: { text: prompt, duration_seconds: clampN(Math.round(seconds * 10) / 10, 0.5, 22), prompt_influence: 0.4 },
      responseType: 'binary',
    }),
  });
  const data: any = await res.json().catch(() => null);
  if (!res.ok) {
    const code = String(data?.code || '');
    const err: any = new Error(String(data?.error || data?.message || ('Secrets proxy call failed (HTTP ' + res.status + ').')));
    err.proxyCode = code;
    throw err;
  }
  const upstream = Number(data?.status ?? 200);
  if (upstream === 401 || upstream === 403) {
    const err: any = new Error('ElevenLabs rejected the stored ELEVENLABS_API_KEY (HTTP ' + upstream + ') — check or rotate the key.');
    err.upstreamAuth = true;
    throw err;
  }
  if (upstream >= 400) {
    let detail = '';
    if (data?.encoding === 'base64' && typeof data.body === 'string') { try { detail = atob(data.body); } catch { detail = ''; } }
    else if (typeof data?.body === 'string') detail = data.body;
    throw new Error('ElevenLabs returned an error (HTTP ' + upstream + ')' + (detail ? ': ' + detail.slice(0, 180) : '.'));
  }
  if (data?.encoding !== 'base64' || typeof data.body !== 'string' || !data.body) {
    throw new Error('The sound effect service returned an unexpected response — try again.');
  }
  return base64ToBlob(data.body, 'audio/mpeg');
}

/** Built-in fallback: the platform's ElevenLabs music endpoint, reused to render a short effect clip. */
async function platformSfx(prompt: string, lengthMs: number): Promise<Blob> {
  const token = workspaceToken();
  if (!token) throw new Error('Your workspace session is still loading — try again in a moment.');
  const res = await fetch('/api/workspaces/' + WORKSPACE_UUID + '/audio/music/custom', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
    body: JSON.stringify({ prompt, lengthMs: clampN(Math.round(lengthMs), 3000, 30000), instrumental: true }),
  });
  const data: any = await res.json().catch(() => null);
  if (!res.ok || !data?.success || !data.audioUrl) {
    throw new Error(String(data?.error || ('Sound effect generation failed (HTTP ' + res.status + ').')));
  }
  const audio = await fetch(String(data.audioUrl));
  if (!audio.ok) throw new Error('The generated clip could not be downloaded (HTTP ' + audio.status + ').');
  return audio.blob();
}

export interface GeneratedSfx { blob: Blob; source: 'byok' | 'platform'; note: string }

/** Generate one short sound-effect clip for the given prompt (0.5–22s, ElevenLabs' cap). */
export async function generateSfxClip(prompt: string, seconds: number, onNote?: (n: string) => void): Promise<GeneratedSfx> {
  const cleaned = prompt.trim();
  if (!cleaned) throw new Error('Describe the sound effect first (e.g. "applause" or "camera shutter click").');
  const fullPrompt = cleaned.length >= 10 ? cleaned : cleaned + ' sound effect';
  const targetSec = clampN(Number.isFinite(seconds) && seconds > 0 ? seconds : 2, 0.5, 22);

  if (byokVerdict === 'unknown' || byokVerdict === 'usable') {
    try {
      onNote?.('Generating with your ElevenLabs API key…');
      const blob = await byokSfx(fullPrompt, targetSec);
      byokVerdict = 'usable';
      return { blob, source: 'byok', note: 'Generated with your ELEVENLABS_API_KEY.' };
    } catch (e: any) {
      const code = String(e?.proxyCode || '');
      if (BYOK_CONFIG_FAILURES.has(code)) {
        byokVerdict = code === 'unknown_secret' ? 'missing' : 'host-not-allowed';
      } else if (e?.upstreamAuth) {
        byokVerdict = 'rejected';
      } else {
        // Transient proxy/upstream problem — surface it rather than silently
        // switching engines and double-billing.
        throw new Error(msg(e));
      }
    }
  }

  onNote?.('Generating with the built-in AI audio engine…');
  const blob = await platformSfx(fullPrompt, targetSec * 1000);
  const why =
    byokVerdict === 'missing'
      ? 'No ELEVENLABS_API_KEY custom key is configured, so the built-in AI audio engine was used. ' + BYOK_SFX_NOTE
      : byokVerdict === 'rejected'
        ? 'Your ELEVENLABS_API_KEY was rejected by ElevenLabs, so the built-in engine was used — check or rotate the key.'
        : byokVerdict === 'host-not-allowed'
          ? 'Your ELEVENLABS_API_KEY does not allow api.elevenlabs.io, so the built-in engine was used — add that host to the key.'
          : 'Generated with the built-in AI audio engine.';
  return { blob, source: 'platform', note: why };
}
