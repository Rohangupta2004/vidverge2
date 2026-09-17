/**
 * Saved Videos — the unified gallery. Every finished video the visitor owns,
 * from BOTH pipelines, in one list:
 *
 *   - styled runs (Clip Style, Cinematic Trailer, Text-to-Video, Documentary,
 *     Product Showcase) from the creation wizard
 *   - Product Launch HyperFrames films
 *
 * The saved-videos server function is the source of truth: its `list` op scans
 * both producing tables for finished videos and upserts anything the gallery
 * has not seen, so nothing has to be saved by hand and a render that landed
 * while the tab was shut still shows up. Rows live in the workspace database,
 * so the list persists across sessions and devices.
 *
 * Each card shows the first-frame preview, the title, the style it was made
 * in, when it was created, and a download button — plus the .SRT caption file
 * when captions were generated.
 */
import { useCallback, useEffect, useState } from 'react';
import { Clapperboard, Download, FileText, Film, Loader2, RefreshCw, Trash2, Volume2 } from 'lucide-react';
import { getWorkspaceToken, resolveSessionId } from '../../lib/trackB/api';
import { Tilt } from './fx';

const SAVED_VIDEOS_ENDPOINT = '/api/hooks/execute/workspace-660069/saved-videos';

const S = {
  text: 'var(--space-text-primary)',
  sub: 'var(--space-text-secondary)',
  muted: 'var(--space-text-muted)',
  brand: 'var(--space-text-brand)',
  border: 'var(--space-border-default)',
  borderStrong: 'var(--space-border-strong)',
  panel: 'var(--space-surface-panel)',
  panelStrong: 'var(--space-surface-panel-strong)',
  card: 'var(--space-surface-card)',
  danger: 'var(--space-semantic-danger-500)',
};

export interface SavedVideo {
  id: number;
  source: 'clipstyle' | 'product_launch';
  source_id: number;
  title: string | null;
  style: string | null;
  style_label: string | null;
  video_url: string | null;
  thumbnail_url: string | null;
  srt_text: string | null;
  duration_seconds: string | number | null;
  created_at: string | null;
}

export async function savedVideosCall<T>(payload: Record<string, unknown>): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getWorkspaceToken();
  const sessionId = resolveSessionId();
  if (!token || !sessionId) throw new Error('Your verified session is still loading.');
  headers['X-Workspace-DB-Token'] = token;
  headers['X-Session-Id'] = sessionId;
  const res = await fetch(SAVED_VIDEOS_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const raw = await res.json().catch(() => null);
  const data = raw && typeof raw === 'object' && ('success' in raw || 'error' in raw) ? raw : (raw?.response ?? raw);
  if (!res.ok || !data || data.success === false || data.error) {
    throw new Error(String(data?.error || `Saved Videos could not be reached (HTTP ${res.status}).`));
  }
  return data as T;
}

/** Register a finished video in the gallery. Safe to call more than once. */
export async function registerSavedVideo(fields: Record<string, unknown>): Promise<void> {
  await savedVideosCall({ op: 'upsert', ...fields });
}

function relativeTime(iso?: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (!isFinite(then)) return '';
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}

function runtimeLabel(v: SavedVideo): string {
  const n = Number(v.duration_seconds);
  if (!Number.isFinite(n) || n <= 0) return '';
  const m = Math.floor(n / 60);
  const s = Math.round(n % 60);
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}

function slug(s: string): string {
  return (s || 'video').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'video';
}

const actionBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 9,
  border: `1px solid ${S.border}`, background: S.card, color: S.sub, cursor: 'pointer',
  fontSize: 11.5, fontWeight: 700, textDecoration: 'none', lineHeight: 1.4,
};

export default function SavedVideos({ onAddSound }: {
  /** Open the sound + captions studio on a finished video. */
  onAddSound?: (target: { title: string; videoUrl: string; sourceId: number; source: 'clipstyle' | 'product_launch' }) => void;
}) {
  const [videos, setVideos] = useState<SavedVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await savedVideosCall<{ videos: SavedVideo[] }>({ op: 'list' });
      setVideos(res.videos || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Your saved videos could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const remove = useCallback(async (id: number) => {
    setRemoving(id);
    try {
      await savedVideosCall({ op: 'remove', id });
      setVideos((cur) => cur.filter((v) => v.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That video could not be removed from the list.');
    } finally {
      setRemoving(null);
    }
  }, []);

  const downloadSrt = useCallback((v: SavedVideo) => {
    if (!v.srt_text) return;
    const blob = new Blob([v.srt_text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = slug(v.title || 'captions') + '.srt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  }, []);

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto', padding: 'clamp(16px, 3vw, 30px)', color: S.text, boxSizing: 'border-box' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 'clamp(20px, 3vw, 26px)', fontWeight: 800 }}>
            <Film size={22} color="var(--space-text-brand)" /> Saved Videos
          </h1>
          <p style={{ margin: '5px 0 0', fontSize: 13, color: S.sub }}>
            Every finished video, from both flows, saved automatically and kept between visits.
          </p>
        </div>
        <button type="button" onClick={() => void load()} aria-label="Refresh" className="ps-btn" style={{ display: 'inline-flex', alignItems: 'center', padding: 9, borderRadius: 10, border: `1px solid ${S.border}`, background: S.card, color: S.sub, cursor: 'pointer' }} data-testid="button-saved-refresh">
          <RefreshCw size={14} className={loading ? 'rc-spin' : ''} />
        </button>
      </header>

      {error ? (
        <div role="alert" style={{ marginBottom: 14, padding: '9px 13px', borderRadius: 10, fontSize: 13, fontWeight: 600, color: S.danger, background: `color-mix(in srgb, ${S.danger} 10%, transparent)`, border: `1px solid color-mix(in srgb, ${S.danger} 30%, transparent)` }}>
          {error}
        </div>
      ) : null}

      {loading && videos.length === 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: S.muted, fontSize: 13, padding: 24 }}>
          <Loader2 size={14} className="rc-spin" /> Loading your saved videos…
        </div>
      ) : videos.length === 0 ? (
        <div className="ps-fade-up" style={{ borderRadius: 18, border: `1px solid ${S.border}`, background: S.panel, padding: 'clamp(32px, 6vw, 56px)', textAlign: 'center' }} data-testid="empty-saved">
          <Clapperboard size={30} color="var(--space-text-brand)" style={{ display: 'block', margin: '0 auto 14px' }} />
          <h2 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 800 }}>Nothing saved yet</h2>
          <p style={{ margin: '0 auto', fontSize: 13.5, color: S.sub, lineHeight: 1.6, maxWidth: 440 }}>
            Make a video in either flow and it lands here on its own — thumbnail, style, date and a download button, ready whenever you come back.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 290px), 1fr))', gap: 20 }}>
          {videos.map((v) => (
            <Tilt
              key={v.id}
              maxTilt={5}
              testId={`saved-card-${v.id}`}
              style={{ borderRadius: 16, border: `1px solid ${S.border}`, background: S.panel, overflow: 'hidden' }}
            >
              <div style={{ position: 'relative', aspectRatio: '16 / 9', background: '#000' }}>
                {v.thumbnail_url ? (
                  <img src={v.thumbnail_url} alt={`${v.title ?? 'Video'} first frame`} style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} data-testid={`saved-thumb-${v.id}`} />
                ) : v.video_url ? (
                  <video src={v.video_url} preload="metadata" muted playsInline style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} data-testid={`saved-video-${v.id}`} />
                ) : (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, var(--space-brand-primary-700), var(--space-brand-primary-500))' }} />
                )}
                <span style={{ position: 'absolute', top: 10, left: 10, padding: '3px 10px', borderRadius: 999, fontSize: 10.5, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#fff', background: 'rgba(4,8,18,0.72)', border: `1px solid ${S.borderStrong}` }} data-testid={`saved-style-${v.id}`}>
                  {v.style_label || 'Product video'}
                </span>
                {runtimeLabel(v) ? (
                  <span style={{ position: 'absolute', bottom: 10, right: 10, padding: '2px 8px', borderRadius: 7, fontSize: 10.5, fontWeight: 800, color: '#fff', background: 'rgba(4,8,18,0.72)', fontVariantNumeric: 'tabular-nums' }}>
                    {runtimeLabel(v)}
                  </span>
                ) : null}
              </div>
              <div style={{ padding: '12px 14px 14px' }}>
                <span style={{ display: 'block', fontSize: 14, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.title || 'Untitled video'}</span>
                <span style={{ display: 'block', marginTop: 3, fontSize: 11.5, color: S.muted }}>
                  {relativeTime(v.created_at)}
                </span>
                <div style={{ display: 'flex', gap: 7, marginTop: 11, flexWrap: 'wrap' }}>
                  {v.video_url ? (
                    <a href={v.video_url} download target="_blank" rel="noreferrer" className="ps-btn" style={{ ...actionBtn, border: 'none', background: 'var(--space-brand-primary-600)', color: 'var(--space-text-on-primary)' }} data-testid={`saved-download-${v.id}`}>
                      <Download size={11} /> Download
                    </a>
                  ) : null}
                  {v.srt_text ? (
                    <button type="button" onClick={() => downloadSrt(v)} className="ps-btn" style={actionBtn} data-testid={`saved-srt-${v.id}`}>
                      <FileText size={11} /> .srt
                    </button>
                  ) : null}
                  {onAddSound && v.video_url ? (
                    <button
                      type="button"
                      onClick={() => onAddSound({ title: v.title || 'Product video', videoUrl: v.video_url as string, sourceId: v.source_id, source: v.source })}
                      className="ps-btn"
                      style={actionBtn}
                      title="Add ElevenLabs music, sound effects and captions to this video"
                      data-testid={`saved-sound-${v.id}`}
                    >
                      <Volume2 size={11} /> Sound
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void remove(v.id)}
                    disabled={removing === v.id}
                    className="ps-btn"
                    style={{ ...actionBtn, marginLeft: 'auto', color: S.danger, borderColor: `color-mix(in srgb, ${S.danger} 35%, transparent)`, opacity: removing === v.id ? 0.6 : 1 }}
                    title="Remove from this list (the video file itself is not deleted)"
                    data-testid={`saved-remove-${v.id}`}
                  >
                    {removing === v.id ? <Loader2 size={11} className="rc-spin" /> : <Trash2 size={11} />} Remove
                  </button>
                </div>
              </div>
            </Tilt>
          ))}
        </div>
      )}
    </div>
  );
}
