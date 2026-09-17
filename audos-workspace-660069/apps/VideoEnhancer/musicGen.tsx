/**
 * Video Enhancer — optional ElevenLabs music generation.
 *
 * A purely additive post-render step: once a video exists, one click asks
 * claude-sonnet-5 (the Anthropic proxy) for a one-sentence music brief matching
 * the video script's tone, then generates the track through the ElevenLabs
 * sound-generation API via the workspace secrets proxy (secret:
 * ELEVENLABS_API_KEY). The MP3 comes back base64-encoded, is decoded to a
 * local blob and offered as playback + download. Failures never affect or
 * block the core video pipeline — this section is fully self-contained.
 */
import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Download, Loader2, Music } from 'lucide-react';
import { workspaceToken } from './enhancerCore';

function msg(e: unknown): string { return e instanceof Error ? e.message : String(e); }

export const MISSING_KEY_MESSAGE = 'Add ELEVENLABS_API_KEY in Settings to enable music generation';

/** ElevenLabs sound-generation accepts 0.5–22 second clips. */
function clampMusicSeconds(videoDurationSec: number | null): number {
  const d = videoDurationSec && videoDurationSec > 0 ? videoDurationSec : 15;
  return Math.max(0.5, Math.min(22, Math.round(d * 10) / 10));
}

/**
 * One short LLM pass: a single-sentence instrumental-music brief matching the
 * script's tone. Falls back to a sensible default so a proxy hiccup never
 * blocks music generation itself.
 */
async function generateMusicPrompt(script: string): Promise<string> {
  const fallback = 'Uplifting modern cinematic background music with a warm, steady beat.';
  const token = workspaceToken();
  if (!token || !script.trim()) return fallback;
  try {
    const res = await fetch('/proxy/anthropic/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 200,
        thinking: { type: 'disabled' },
        messages: [{
          role: 'user',
          content: 'Describe in ONE sentence (no quotes, no preamble) instrumental background music that matches the tone of this video script — name the genre, mood, tempo and instrumentation:\n\n' + script.slice(0, 2500),
        }],
      }),
    });
    const data: any = await res.json().catch(() => null);
    const text = res.ok && data && Array.isArray(data.content)
      ? data.content.map((b: any) => (b && typeof b.text === 'string' ? b.text : '')).join('').trim()
      : '';
    return text ? text.replace(/^["']+|["']+$/g, '').slice(0, 400) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Generate the track via the workspace secrets proxy. The proxy injects the
 * ELEVENLABS_API_KEY secret server-side; the browser never sees the key.
 * Returns a local blob URL for the decoded MP3.
 */
async function generateMusicTrack(musicPrompt: string, durationSecs: number): Promise<string> {
  const ws: any = typeof window !== 'undefined' ? (window as any).__workspaceDb : null;
  if (!ws || !ws.token || !ws.workspaceId) throw new Error('Your workspace session is still loading — try again in a moment.');
  const res = await fetch('/api/workspaces/' + ws.workspaceId + '/secrets/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': ws.token },
    body: JSON.stringify({
      method: 'POST',
      url: 'https://api.elevenlabs.io/v1/sound-generation',
      headers: { 'xi-api-key': '{{secrets.ELEVENLABS_API_KEY}}' },
      json: { text: musicPrompt, duration_seconds: durationSecs, prompt_influence: 0.3 },
      responseType: 'binary',
    }),
  });
  const data: any = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = String((data && (typeof data.error === 'string' ? data.error : data.error?.message || data.message)) || '');
    if (/ELEVENLABS_API_KEY|secret[^.]*not[^.]*(found|configured|set|defined)|unknown secret|missing secret/i.test(detail)) {
      throw new Error(MISSING_KEY_MESSAGE);
    }
    throw new Error(detail || ('Music generation failed (HTTP ' + res.status + ').'));
  }
  const upstreamStatus = Number(data?.status ?? data?.statusCode ?? 200);
  const body = typeof data?.body === 'string' ? data.body : (typeof data?.data === 'string' ? data.data : '');
  if (upstreamStatus >= 400) {
    let detail = '';
    if (data?.encoding === 'base64' && body) { try { detail = atob(body); } catch { detail = ''; } }
    else if (body) detail = body;
    if (upstreamStatus === 401 || upstreamStatus === 403) {
      throw new Error('ElevenLabs rejected the API key — double-check ELEVENLABS_API_KEY in Settings.');
    }
    throw new Error('ElevenLabs returned an error (HTTP ' + upstreamStatus + ')' + (detail ? ': ' + detail.slice(0, 200) : '.'));
  }
  if (data?.encoding !== 'base64' || !body) {
    throw new Error('The music service returned an unexpected response — try again.');
  }
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
}

/**
 * "Generate Music" section shown under a finished video. Optional, additive,
 * and fully self-contained: its loading and error states never touch the
 * render result above it.
 */
export default function MusicSection({ script, durationSec }: {
  /** The video's script/transcript — the music brief derives from its tone. */
  script: string;
  /** Video length in seconds (clamped to ElevenLabs' 22s maximum). */
  durationSec: number | null;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [musicUrl, setMusicUrl] = useState('');
  const [musicPrompt, setMusicPrompt] = useState('');
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  // Revoke the previous blob when a new one replaces it, and on unmount.
  const urlRef = useRef('');
  useEffect(() => {
    const prev = urlRef.current;
    if (prev && prev !== musicUrl) { try { URL.revokeObjectURL(prev); } catch { /* no-op */ } }
    urlRef.current = musicUrl;
  }, [musicUrl]);
  useEffect(() => () => {
    if (urlRef.current) { try { URL.revokeObjectURL(urlRef.current); } catch { /* no-op */ } }
  }, []);

  const generate = async () => {
    if (busy) return;
    setBusy(true); setErr(''); setNote('Writing a music brief from your script…');
    try {
      const prompt = await generateMusicPrompt(script);
      if (!aliveRef.current) return;
      setMusicPrompt(prompt);
      setNote('Generating your track…');
      const url = await generateMusicTrack(prompt, clampMusicSeconds(durationSec));
      if (!aliveRef.current) return;
      setMusicUrl(url);
      setNote('');
    } catch (e) {
      if (aliveRef.current) { setErr(msg(e)); setNote(''); }
    }
    if (aliveRef.current) setBusy(false);
  };

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--space-border-default)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Music size={14} style={{ color: 'var(--space-text-brand)', flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontWeight: 700 }}>Soundtrack</span>
        <span style={{ fontSize: 11.5, color: 'var(--space-text-muted)' }}>Optional — AI-generated soundtrack</span>
        <button
          onClick={() => { void generate(); }}
          disabled={busy}
          className="ve-btn"
          style={{
            marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 12.5, fontWeight: 700, padding: '7px 13px', borderRadius: 10, border: 'none',
            cursor: busy ? 'not-allowed' : 'pointer',
            background: busy ? 'var(--space-surface-panel-strong)' : 'var(--space-brand-primary-600)',
            color: busy ? 'var(--space-text-muted)' : '#fff',
          }}
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Music size={13} />}
          {busy ? 'Generating…' : musicUrl ? 'Regenerate Music' : 'Generate Music'}
        </button>
      </div>
      {note && <div style={{ fontSize: 12, color: 'var(--space-text-brand)', marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}><Loader2 size={12} className="animate-spin" /> {note}</div>}
      {err && (
        <div style={{ fontSize: 12.5, color: 'var(--space-semantic-danger)', marginTop: 8, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <AlertCircle size={13} style={{ flexShrink: 0, marginTop: 2 }} /> {err}
        </div>
      )}
      {musicUrl && (
        <div style={{ marginTop: 10 }}>
          {musicPrompt && <div style={{ fontSize: 11.5, color: 'var(--space-text-muted)', fontStyle: 'italic', marginBottom: 6 }}>“{musicPrompt}”</div>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <audio src={musicUrl} controls style={{ flex: '1 1 220px', minWidth: 180, height: 34 }} />
            <a
              href={musicUrl}
              download="generated-music.mp3"
              className="ve-btn"
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--space-text-brand)', background: 'color-mix(in srgb, var(--space-brand-primary-500) 12%, transparent)', border: '1px solid var(--space-border-default)', borderRadius: 10, padding: '7px 12px', textDecoration: 'none' }}
            >
              <Download size={13} /> Download MP3
            </a>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--space-text-muted)', marginTop: 6 }}>
            Tip: add this track to your export via Enhance → Music layer (download it first, then import it there).
          </div>
        </div>
      )}
    </div>
  );
}
