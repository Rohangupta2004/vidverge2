/**
 * Product Video — ElevenLabs audio for the creation flows.
 *
 * Three tracks, generated in the browser so the customer can preview and
 * approve them BEFORE any paid video render starts, and returned as durable
 * public URLs so the server-side pipeline can mix them into the finish render
 * long after the tab is closed:
 *
 *   1. NARRATION  — ElevenLabs text-to-speech of the approved script
 *                   (POST /api/workspaces/:id/audio/voiceover).
 *   2. MUSIC      — an AI background-music bed
 *                   (POST /api/workspaces/:id/audio/music/custom).
 *   3. SOUND FX   — a SEPARATE effects bed from the optional SFX field. The
 *                   real ElevenLabs sound-effects model lives at
 *                   /v1/sound-generation, which is only reachable with the
 *                   founder's own key through the workspace secrets proxy, so
 *                   that path is tried first and the platform music engine is
 *                   the fallback.
 *
 * KEY DISCOVERY: stored secrets are deliberately not discoverable from code —
 * there is no "does ELEVENLABS_API_KEY exist?" read (see the custom-api-keys
 * integration docs). So the founder key is probed by USING it once and the
 * verdict is latched for the rest of the session, and the UI reports which
 * engine produced each track plus exactly what to configure when the key is
 * missing, rejected, or not allow-listed for api.elevenlabs.io.
 */

export const ELEVENLABS_HOST = 'api.elevenlabs.io';

/** What to tell the founder when no usable ELEVENLABS_API_KEY is configured. */
export const BYOK_KEY_NOTE =
  'Add an ELEVENLABS_API_KEY custom API key (allow-listed for ' + ELEVENLABS_HOST + ') via Otto or the Integrations panel to generate audio on your own ElevenLabs account.';

/** ElevenLabs sound-generation caps a single clip at 22 seconds. */
const SFX_MAX_SECONDS = 22;

export type ByokVerdict = 'unknown' | 'usable' | 'missing' | 'rejected' | 'host-not-allowed';

// One latch for the whole session — every probe is a real billable round trip.
let byokVerdict: ByokVerdict = 'unknown';
export function currentByokVerdict(): ByokVerdict { return byokVerdict; }

/** The founder-facing sentence for the current key verdict, or '' when fine. */
export function byokVerdictNote(): string {
  if (byokVerdict === 'missing') return 'No ELEVENLABS_API_KEY is configured, so the built-in ElevenLabs engine was used. ' + BYOK_KEY_NOTE;
  if (byokVerdict === 'rejected') return 'Your ELEVENLABS_API_KEY was rejected by ElevenLabs, so the built-in engine was used — check or rotate the key.';
  if (byokVerdict === 'host-not-allowed') return 'Your ELEVENLABS_API_KEY is not allowed to call ' + ELEVENLABS_HOST + ', so the built-in engine was used — add that host to the key.';
  return '';
}

const BYOK_CONFIG_FAILURES = new Set(['unknown_secret', 'no_allowed_hosts', 'host_not_allowed']);

function msg(e: unknown): string { return e instanceof Error ? e.message : String(e); }
function clampN(v: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, v)); }

interface Ws { token: string; workspaceId: string }

function ws(): Ws {
  const w: any = typeof window !== 'undefined' ? (window as any).__workspaceDb : null;
  const token = String(w?.token || '');
  const workspaceId = String(w?.workspaceId || '');
  if (!token || !workspaceId) throw new Error('Your workspace session is still loading — try again in a moment.');
  return { token, workspaceId };
}

function authHeaders(w: Ws): Record<string, string> {
  return { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': w.token };
}

function base64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/**
 * Park an audio blob on durable storage so the server-side finish render can
 * fetch it hours later. The founder-key path returns raw MP3 bytes, which are
 * useless to Remotion until they have a public address.
 */
async function uploadAudio(blob: Blob, filename: string): Promise<string> {
  const w = ws();
  const form = new FormData();
  form.append('file', new File([blob], filename, { type: blob.type || 'audio/mpeg' }));
  form.append('workspaceId', w.workspaceId);
  form.append('folder', 'product-video-audio');
  const headers: Record<string, string> = { 'X-Workspace-DB-Token': w.token };
  const appId = typeof window !== 'undefined' ? String((window as any).__APP_ID__ || (window as any).__SPACE_ID__ || '') : '';
  if (appId) headers['X-App-Id'] = appId;
  const res = await fetch('/api/upload/file', { method: 'POST', headers, body: form });
  const data: any = await res.json().catch(() => null);
  if (!res.ok || !data?.success || !data.url) {
    throw new Error(String(data?.error || 'The generated audio could not be saved (HTTP ' + res.status + ').'));
  }
  return String(data.url);
}

/**
 * The founder's own ElevenLabs account, through the workspace secrets proxy.
 * Used for sound effects, where /v1/sound-generation is the only real SFX
 * model. Throws with `proxyCode` / `upstreamAuth` markers so the caller can
 * latch the right verdict.
 */
async function byokSoundGeneration(prompt: string, seconds: number): Promise<Blob> {
  const w = ws();
  const res = await fetch('/api/workspaces/' + w.workspaceId + '/secrets/proxy', {
    method: 'POST',
    headers: authHeaders(w),
    body: JSON.stringify({
      method: 'POST',
      url: 'https://' + ELEVENLABS_HOST + '/v1/sound-generation',
      headers: { 'xi-api-key': '{{secrets.ELEVENLABS_API_KEY}}' },
      json: {
        text: prompt,
        duration_seconds: clampN(Math.round(seconds * 10) / 10, 0.5, SFX_MAX_SECONDS),
        prompt_influence: 0.45,
      },
      responseType: 'binary',
    }),
  });
  const data: any = await res.json().catch(() => null);
  if (!res.ok) {
    const err: any = new Error(String(data?.error || data?.message || 'Secrets proxy call failed (HTTP ' + res.status + ').'));
    err.proxyCode = String(data?.code || '');
    throw err;
  }
  // A successful proxy round trip is not a successful API call — read the
  // UPSTREAM status before trusting the body.
  const upstream = Number(data?.status ?? 200);
  if (upstream === 401 || upstream === 403) {
    const err: any = new Error('ElevenLabs rejected the stored ELEVENLABS_API_KEY (HTTP ' + upstream + ').');
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
    throw new Error('The sound-effects service returned an unexpected response — try again.');
  }
  return base64ToBlob(data.body, 'audio/mpeg');
}

/** Latch the key verdict from a failed BYOK attempt; rethrows transient faults. */
function latchByok(e: any): void {
  const code = String(e?.proxyCode || '');
  if (BYOK_CONFIG_FAILURES.has(code)) {
    byokVerdict = code === 'unknown_secret' ? 'missing' : 'host-not-allowed';
    return;
  }
  if (e?.upstreamAuth) { byokVerdict = 'rejected'; return; }
  // Transient proxy or upstream trouble — surface it instead of silently
  // switching engines and billing the workspace twice.
  throw new Error(msg(e));
}

/** The platform's built-in ElevenLabs music engine (durable URL, wallet-billed). */
async function platformMusic(prompt: string, lengthMs: number): Promise<string> {
  const w = ws();
  const res = await fetch('/api/workspaces/' + w.workspaceId + '/audio/music/custom', {
    method: 'POST',
    headers: authHeaders(w),
    body: JSON.stringify({
      prompt,
      lengthMs: clampN(Math.round(lengthMs), 5000, 300000),
      instrumental: true,
    }),
  });
  const data: any = await res.json().catch(() => null);
  if (!res.ok || !data?.success || !data.audioUrl) {
    throw new Error(String(data?.error || 'Audio generation failed (HTTP ' + res.status + ').'));
  }
  return String(data.audioUrl);
}

export interface GeneratedTrack {
  url: string;
  /** Which engine produced it. */
  source: 'byok' | 'platform';
  /** Human note about the engine used / what to configure. */
  note: string;
  /** The brief that produced it, for display. */
  prompt: string;
}

/**
 * The background-music bed. The platform music engine is the primary path
 * here: it is ElevenLabs' music model, it honours the requested length up to
 * ten minutes, and it returns a durable URL directly.
 */
export async function generateMusicBed(prompt: string, seconds: number, onNote?: (n: string) => void): Promise<GeneratedTrack> {
  const cleaned = prompt.trim();
  if (cleaned.length < 10) throw new Error('Describe the music in a few more words so ElevenLabs has something to work with.');
  const secs = clampN(Number.isFinite(seconds) && seconds > 0 ? seconds : 30, 6, 300);
  onNote?.('Composing your background music with ElevenLabs…');
  const url = await platformMusic(cleaned, secs * 1000);
  return {
    url,
    source: 'platform',
    prompt: cleaned,
    note: 'Background music generated with ElevenLabs.',
  };
}

/**
 * The sound-effects bed — a separate track from the music, driven by the
 * optional SFX field in the creation flow. The founder's own key reaches
 * ElevenLabs' dedicated sound-effects model; without one, the built-in engine
 * renders the same brief and the note says so.
 */
export async function generateSfxBed(prompt: string, seconds: number, onNote?: (n: string) => void): Promise<GeneratedTrack> {
  const cleaned = prompt.trim();
  if (cleaned.length < 3) throw new Error('Describe the sound effects you want, or leave the field empty to skip them.');
  const secs = clampN(Number.isFinite(seconds) && seconds > 0 ? seconds : 20, 1, 300);

  if (byokVerdict === 'unknown' || byokVerdict === 'usable') {
    try {
      onNote?.('Generating sound effects on your ElevenLabs account…');
      const blob = await byokSoundGeneration(cleaned, Math.min(SFX_MAX_SECONDS, secs));
      byokVerdict = 'usable';
      onNote?.('Saving the sound-effects track…');
      const url = await uploadAudio(blob, 'sfx-' + Date.now() + '.mp3');
      const looped = secs > SFX_MAX_SECONDS
        ? ' The ' + SFX_MAX_SECONDS + 's clip (the ElevenLabs sound-effects cap) loops under the full film.'
        : '';
      return {
        url,
        source: 'byok',
        prompt: cleaned,
        note: 'Sound effects generated with your ELEVENLABS_API_KEY.' + looped,
      };
    } catch (e) {
      latchByok(e);
    }
  }

  onNote?.('Generating sound effects with the built-in ElevenLabs engine…');
  const url = await platformMusic(
    'Sound effects only, no music, no melody, no instruments and no voices: ' + cleaned,
    secs * 1000,
  );
  return {
    url,
    source: 'platform',
    prompt: cleaned,
    note: (byokVerdictNote() || 'Sound effects generated with the built-in ElevenLabs engine.'),
  };
}

// ---------------------------------------------------------------------------
// Narration voiceover
// ---------------------------------------------------------------------------

export interface VoiceOption { id: string; name: string; labels?: Record<string, string> }

/**
 * The premade voice catalogue. A public, free read — voice availability
 * changes, so the picker always lists what the platform reports rather than
 * hard-coded IDs.
 */
export async function listVoices(): Promise<VoiceOption[]> {
  const res = await fetch('/api/voices');
  const data: any = await res.json().catch(() => null);
  if (!res.ok || !Array.isArray(data?.voices)) return [];
  return data.voices
    .filter((v: any) => v && typeof v.id === 'string' && typeof v.name === 'string')
    .map((v: any) => ({ id: String(v.id), name: String(v.name), labels: v.labels || undefined }));
}

export interface GeneratedNarration { url: string; estimatedSeconds: number }

/** ElevenLabs text-to-speech of the approved script. Returns a durable URL. */
export async function generateNarration(script: string, voiceId?: string | null, onNote?: (n: string) => void): Promise<GeneratedNarration> {
  const w = ws();
  const text = script.trim();
  if (!text) throw new Error('There is no script to narrate yet.');
  if (text.length > 10000) throw new Error('The script is over the ten thousand character narration limit — shorten it and try again.');
  onNote?.('Recording the narration with ElevenLabs…');
  const body: Record<string, unknown> = { script: text };
  if (voiceId) body.voiceId = voiceId;
  const res = await fetch('/api/workspaces/' + w.workspaceId + '/audio/voiceover', {
    method: 'POST',
    headers: authHeaders(w),
    body: JSON.stringify(body),
  });
  const data: any = await res.json().catch(() => null);
  if (!res.ok || !data?.success || !data.audioUrl) {
    throw new Error(String(data?.error || 'The narration could not be generated (HTTP ' + res.status + ').'));
  }
  return {
    url: String(data.audioUrl),
    estimatedSeconds: Number(data.estimatedDurationMs) > 0 ? Number(data.estimatedDurationMs) / 1000 : 0,
  };
}
