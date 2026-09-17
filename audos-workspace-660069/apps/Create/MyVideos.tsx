/**
 * My Videos — the workspace's renders, shown at the bottom of the type picker.
 *
 * PER-USER (Sep 12 2026, founder requirement): each visitor sees their OWN
 * renders — every session this browser has held, plus unowned workspace-seeded
 * rows; the founder's own view still sees the whole workspace (see
 * listOwnVideos in studioApi). It is fetched fresh on EVERY mount, so switching
 * apps and coming back always shows the previously generated videos, and while
 * any row is still rendering the list re-polls itself so status flips to Ready
 * in place.
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowUpRight, Download, Film, Loader2, Play, RefreshCw } from 'lucide-react';
import { listOwnVideos, type VideoJobRow } from './studioApi';
import { DownloadVideoButton } from '../../components/VideoResultHero';
import { GhostButton, T } from './ui';

function StatusPill({ status }: { status: string }) {
  const ready = status === 'completed' || status === 'partial';
  const failed = status === 'failed';
  const color = ready ? T.success : failed ? T.danger : '#fbbf24';
  const bg = ready ? 'rgba(74,222,128,0.1)' : failed ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)';
  const border = ready ? 'rgba(74,222,128,0.28)' : failed ? 'rgba(239,68,68,0.28)' : 'rgba(245,158,11,0.28)';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '3px 9px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        color,
        background: bg,
        border: `1px solid ${border}`,
      }}
    >
      {failed ? <AlertTriangle size={10} /> : ready ? null : <Loader2 size={10} className="rc-spin" />}
      {ready ? 'Ready' : failed ? 'Failed' : 'Rendering'}
    </span>
  );
}

export default function MyVideos({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<VideoJobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState<number | null>(null);

  const load = async (quiet = false) => {
    if (!quiet) setLoading(true);
    const data = await listOwnVideos();
    setRows(data);
    setLoading(false);
  };

  // Runs on every mount (and when a render finishes), so the list is never a
  // stale in-memory copy — the DB is the source of truth.
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // LIVE STATUS: while any row is still rendering (processing/queued/awaiting
  // approval/QA), quietly re-read the table every 12s so the row's status and
  // video URL update in place — including renders started by other users or
  // other surfaces (chat, server pipelines).
  useEffect(() => {
    const active = rows.some(
      (r) => r.status !== 'completed' && r.status !== 'partial' && r.status !== 'failed',
    );
    if (!active) return;
    const t = window.setTimeout(() => {
      void load(true);
    }, 12000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  if (loading && rows.length === 0) {
    return (
      <div className="rc-glass" style={{ marginTop: 32, padding: 'clamp(16px, 3vw, 24px)', borderRadius: 16 }} aria-label="Loading your videos">
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, color: T.sub, fontSize: 14, fontWeight: 600 }}>
          <Loader2 size={15} className="rc-spin" color={T.accentFg} /> Loading your videos…
        </div>
        <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
          <div className="rc-skeleton" style={{ width: '72%', height: 12, borderRadius: 999 }} />
          <div className="rc-skeleton" style={{ width: '48%', height: 10, borderRadius: 999 }} />
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div
        className="rc-glass rc-fade"
        style={{ marginTop: 32, padding: 'clamp(24px, 5vw, 40px)', borderRadius: 16, textAlign: 'center' }}
        data-testid="empty-videos"
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 52, height: 52, borderRadius: 16, color: T.accentFg, border: `1px solid ${T.accentBorder}`, background: T.accentSoft }}>
          <Film size={23} />
        </span>
        <h2 style={{ margin: '16px 0 6px', color: T.text, fontSize: 18, fontWeight: 700 }}>Your first video starts here</h2>
        <p style={{ maxWidth: 420, margin: '0 auto', color: T.sub, fontSize: 14, lineHeight: 1.6 }}>
          Paste a product URL above and VidVerge will turn it into a polished, ready-to-share video.
        </p>
      </div>
    );
  }

  return (
    <div className="rc-fade" style={{ marginTop: 44 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
        <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 600, color: T.text }}>
          <Film size={16} color={T.accentFg} /> My videos
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <GhostButton
            onClick={() => window.dispatchEvent(new CustomEvent('openApp', { detail: { appId: 'videos' } }))}
            style={{ padding: '7px 12px', fontSize: 12.5 }}
            testId="button-open-library"
          >
            Open library <ArrowUpRight size={13} />
          </GhostButton>
          <GhostButton onClick={() => void load()} style={{ padding: '7px 11px' }} testId="button-refresh-videos">
            <RefreshCw size={13} className={loading ? 'rc-spin' : ''} />
          </GhostButton>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((job) => {
          const ready = (job.status === 'completed' || job.status === 'partial') && !!job.video_url;
          const isPlaying = playing === job.id;
          return (
            <div
              key={job.id}
              style={{
                borderRadius: 12,
                border: `1px solid ${T.border}`,
                background: T.panel,
                overflow: 'hidden',
              }}
              data-testid={`video-row-${job.id}`}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', flexWrap: 'wrap' }}>
                {ready ? (
                  <button
                    type="button"
                    className="rc-ring rc-press"
                    onClick={() => setPlaying(isPlaying ? null : job.id)}
                    aria-label={isPlaying ? 'Hide player' : 'Play video'}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 44,
                      height: 44,
                      borderRadius: 999,
                      border: `1px solid ${T.accentBorder}`,
                      background: T.accentSoft,
                      color: T.accentFg,
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    <Play size={14} style={{ marginLeft: 2 }} />
                  </button>
                ) : (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 34,
                      height: 34,
                      borderRadius: 999,
                      border: `1px solid ${T.border}`,
                      background: 'rgba(255,255,255,0.03)',
                      flexShrink: 0,
                    }}
                  >
                    {job.status === 'failed' ? <AlertTriangle size={14} color={T.danger} /> : <Loader2 size={14} color={T.muted} className="rc-spin" />}
                  </span>
                )}

                <div style={{ flex: 1, minWidth: 160 }}>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {job.title || 'Untitled video'}
                  </span>
                  <span style={{ display: 'block', marginTop: 2, fontSize: 11.5, color: T.muted }}>
                    {job.created_at ? new Date(job.created_at).toLocaleDateString() : ''}
                    {job.scene_count ? ` · ${job.scene_count} scene${job.scene_count === 1 ? '' : 's'}` : ''}
                    {job.aspect_ratio ? ` · ${job.aspect_ratio}` : ''}
                  </span>
                </div>

                <StatusPill status={job.status} />

                {ready ? (
                  <a
                    href={job.video_url || '#'}
                    download
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rc-ghost"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '7px 12px',
                      borderRadius: 9,
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: T.sub,
                      textDecoration: 'none',
                      border: `1px solid ${T.border}`,
                      background: 'rgba(255,255,255,0.03)',
                    }}
                    data-testid={`link-download-${job.id}`}
                  >
                    <Download size={13} /> Download
                  </a>
                ) : null}
              </div>

              {ready && isPlaying ? (
                <div style={{ padding: '0 14px 14px' }}>
                  <video
                    src={job.video_url || undefined}
                    controls
                    autoPlay
                    playsInline
                    preload="metadata"
                    style={{
                      display: 'block',
                      width: '100%',
                      borderRadius: 12,
                      border: `1px solid ${T.borderStrong}`,
                      background: '#000',
                      aspectRatio: job.aspect_ratio === '9:16' ? '9 / 16' : '16 / 9',
                      maxHeight: 'min(560px, 52vh)',
                      objectFit: 'contain',
                    }}
                    data-testid={`video-player-${job.id}`}
                  />
                  <div style={{ marginTop: 10 }}>
                    <DownloadVideoButton
                      src={job.video_url || ''}
                      title={job.title || undefined}
                      testId={`button-download-open-${job.id}`}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
