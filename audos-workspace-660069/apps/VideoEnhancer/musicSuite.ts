/**
 * Video Enhancer — ElevenLabs music generation for the editor's Music panel.
 *
 * Two paths, tried in order:
 *   1. The founder's own ELEVENLABS_API_KEY via the workspace secrets proxy
 *      (custom-api-keys integration). Stored secrets are NOT discoverable
 *      from code, so the key's presence is probed by simply using the
 *      {{secrets.ELEVENLABS_API_KEY}} placeholder once and latching the
 *      verdict for the rest of the session (per the BYOK integration docs).
 *   2. The platform's built-in ElevenLabs music endpoint
 *      (POST /api/workspaces/:id/audio/music/custom — elevenlabs-audio
 *      integration, platform-managed key, billed to the workspace wallet).
 *
 * Either way the caller receives a local MP3 blob it can preview and mix into
 * the burn-in export, plus a human note that says which engine produced it
 * and — when the founder key was missing/rejected — exactly what to configure.
 */
import { WORKSPACE_UUID, workspaceToken } from './enhancerCore';

function msg(e: unknown): string { return e instanceof Error ? e.message : String(e); }
function clampN(v: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, v)); }

export const BYOK_KEY_NOTE = 'Add an ELEVENLABS_API_KEY custom API key (allow-listed for api.elevenlabs.io) via Otto or the Integrations panel to generate music on your own ElevenLabs account.';

export interface MusicStylePreset { label: string; prompt: string }

export const MUSIC_PRESETS: MusicStylePreset[] = [
  { label: 'Upbeat lo-fi', prompt: 'Upbeat lo-fi hip hop with warm vinyl crackle, mellow electric piano and a relaxed head-nod drum groove' },
  { label: 'Cinematic dramatic', prompt: 'Cinematic dramatic orchestral score with swelling strings, deep brass hits and a slow epic build' },
  { label: 'Energetic pop', prompt: 'Energetic modern pop instrumental with driving drums, bright synth plucks and an uplifting hook' },
  { label: 'Calm ambient', prompt: 'Calm ambient soundscape with soft evolving pads, gentle piano notes and a slow relaxing pulse' },
  { label: 'Corporate uplifting', prompt: 'Uplifting corporate background music with acoustic guitar, light piano, claps and a warm optimistic feel' },
  { label: 'Hip-hop groove', prompt: 'Confident hip-hop instrumental with a punchy boom-bap beat, deep sub bass and sparse melodic keys' },
];

/**
 * Derive a fitting music mood from the AI analysis summary — used to
 * auto-suggest (and auto-apply) a track so music never requires a manual
 * pick. Deterministic keyword mapping onto the preset catalog.
 */
export function suggestMusicPrompt(summary: string): string {
  const s = String(summary || '').toLowerCase();
  if (/(sport|basketball|workout|training|drill|action|race|run|fast)/.test(s)) return MUSIC_PRESETS[2].prompt;
  if (/(tutorial|how to|demonstrat|lesson|explain|teach|step)/.test(s)) return MUSIC_PRESETS[4].prompt;
  if (/(product|app|screen|ui|demo|software|startup|website)/.test(s)) return MUSIC_PRESETS[0].prompt;
  if (/(nature|calm|slow|peaceful|meditat|relax|scenery|landscape|ocean)/.test(s)) return MUSIC_PRESETS[3].prompt;
  if (/(cinematic|film|drama|story|travel|epic|trailer)/.test(s)) return MUSIC_PRESETS[1].prompt;
  return MUSIC_PRESETS[0].prompt;
}

export type ByokVerdict = 'unknown' | 'usable' | 'missing' | 'rejected' | 'host-not-allowed';

// One latch for the whole session — probing is a real billable round trip.
let byokVerdict: ByokVerdict = 'unknown';
export function currentByokVerdict(): ByokVerdict { return byokVerdict; }

const BYOK_CONFIG_FAILURES = new Set(['unknown_secret', 'no_allowed_hosts', 'host_not_allowed']);

function base64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/**
 * Founder-key path: ElevenLabs sound-generation through the secrets proxy.
 * The API caps clips at 22 seconds — the export engine loops the bed, so a
 * short clip still covers a full video. Throws with `proxyCode` /
 * `upstreamAuth` markers so the caller can latch the right verdict.
 */
async function byokMusic(prompt: string, seconds: number): Promise<Blob> {
  const ws: any = typeof window !== 'undefined' ? (window as any).__workspaceDb : null;
  if (!ws || !ws.token || !ws.workspaceId) throw new Error('Your workspace session is still loading — try again in a moment.');
  const res = await fetch('/api/workspaces/' + ws.workspaceId + '/secrets/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': ws.token },
    body: JSON.stringify({
      method: 'POST',
      url: 'https://api.elevenlabs.io/v1/sound-generation',
      headers: { 'xi-api-key': '{{secrets.ELEVENLABS_API_KEY}}' },
      json: { text: prompt, duration_seconds: clampN(Math.round(seconds * 10) / 10, 0.5, 22), prompt_influence: 0.3 },
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
    throw new Error('The music service returned an unexpected response — try again.');
  }
  return base64ToBlob(data.body, 'audio/mpeg');
}

/** Built-in path: the platform's ElevenLabs music endpoint (workspace wallet). */
async function platformMusic(prompt: string, lengthMs: number): Promise<Blob> {
  const token = workspaceToken();
  if (!token) throw new Error('Your workspace session is still loading — try again in a moment.');
  const res = await fetch('/api/workspaces/' + WORKSPACE_UUID + '/audio/music/custom', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
    body: JSON.stringify({ prompt, lengthMs: clampN(Math.round(lengthMs), 5000, 180000), instrumental: true }),
  });
  const data: any = await res.json().catch(() => null);
  if (!res.ok || !data?.success || !data.audioUrl) {
    throw new Error(String(data?.error || ('Music generation failed (HTTP ' + res.status + ').')));
  }
  const audio = await fetch(String(data.audioUrl));
  if (!audio.ok) throw new Error('The generated track could not be downloaded (HTTP ' + audio.status + ').');
  return audio.blob();
}

export interface GeneratedMusic {
  blob: Blob;
  source: 'byok' | 'platform';
  /** Human note about which engine produced the track / what to configure. */
  note: string;
}

/**
 * Generate a music bed for the given prompt. Tries the founder's own
 * ELEVENLABS_API_KEY first (probe + latch), then falls back to the platform's
 * built-in ElevenLabs engine so music always works.
 */
export async function generateMusicBed(prompt: string, keptSeconds: number, onNote?: (n: string) => void): Promise<GeneratedMusic> {
  const cleaned = prompt.trim();
  if (!cleaned) throw new Error('Describe the music you want first (e.g. "upbeat lo-fi" or "cinematic dramatic").');
  const fullPrompt = cleaned.length >= 10 ? cleaned : cleaned + ' instrumental background music';
  const targetSec = clampN(Number.isFinite(keptSeconds) && keptSeconds > 0 ? keptSeconds : 30, 6, 180);

  if (byokVerdict === 'unknown' || byokVerdict === 'usable') {
    try {
      onNote?.('Generating with your ElevenLabs API key…');
      const blob = await byokMusic(fullPrompt, Math.min(22, targetSec));
      byokVerdict = 'usable';
      const looped = targetSec > 22 ? ' The 22s clip (ElevenLabs sound-generation cap) loops under the full video on export.' : '';
      return { blob, source: 'byok', note: 'Generated with your ELEVENLABS_API_KEY.' + looped };
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

  onNote?.('Generating with the built-in AI music engine…');
  const blob = await platformMusic(fullPrompt, targetSec * 1000);
  const why =
    byokVerdict === 'missing'
      ? 'No ELEVENLABS_API_KEY custom key is configured, so the built-in AI music engine was used. ' + BYOK_KEY_NOTE
      : byokVerdict === 'rejected'
        ? 'Your ELEVENLABS_API_KEY was rejected by ElevenLabs, so the built-in engine was used — check or rotate the key.'
        : byokVerdict === 'host-not-allowed'
          ? 'Your ELEVENLABS_API_KEY does not allow api.elevenlabs.io, so the built-in engine was used — add that host to the key.'
          : 'Generated with the built-in AI music engine.';
  return { blob, source: 'platform', note: why };
}
