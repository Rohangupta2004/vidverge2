/**
 * VidVerge Studio — My Videos.
 *
 * Session-scoped gallery over the `video_jobs` WorkspaceDB table. STRICT
 * scoping: only rows whose session_id equals the current visitor's session
 * are shown — legacy NULL-session rows (old agent/E2E test invocations) are
 * deliberately excluded so nobody sees videos that aren't theirs.
 * Auto-refreshes while any of the visitor's renders is still processing.
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, Clapperboard, Download, Loader2, Play, RefreshCw } from 'lucide-react';
import { studioSessionId } from '../../lib/reelioStudio';

declare function useWorkspaceDB(
  table: string,
  options?: Record<string, unknown>,
): {
  data: any[];
  loading: boolean;
  error: Error | null;
  total: number;
  refresh: () => void;
};

function StatusBadge({ status }: { status: string }) {
  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    padding: '3px 9px',
    fontSize: 11,
    fontWeight: 600,
    lineHeight: 1,
  };
  if (status === 'completed' || status === 'partial') {
    return (
      <span style={{ ...base, background: 'color-mix(in srgb, var(--space-semantic-success-500) 14%, transparent)', color: 'var(--space-semantic-success)', border: '1px solid color-mix(in srgb, var(--space-semantic-success-500) 30%, transparent)' }}>
        Ready
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span style={{ ...base, background: 'color-mix(in srgb, var(--space-semantic-danger-500) 14%, transparent)', color: 'var(--space-semantic-danger)', border: '1px solid color-mix(in srgb, var(--space-semantic-danger-500) 30%, transparent)' }}>
        <AlertTriangle size={11} /> Failed
      </span>
    );
  }
  return (
    <span style={{ ...base, background: 'rgba(245,158,11,0.14)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.3)' }}>
      <Loader2 size={11} className="rst-spin" /> Rendering…
    </span>
  );
}

function VideoCard({ job }: { job: any }) {
  const [playing, setPlaying] = useState(false);
  const ready = (job.status === 'completed' || job.status === 'partial') && !!job.video_url;
  const portrait = job.aspect_ratio !== '16:9';
  const sceneCount = job.scene_count || (Array.isArray(job.script_json) ? job.script_json.length : 0);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 16,
        border: '1px solid var(--space-border-default)',
        background: 'var(--space-surface-card)',
        overflow: 'hidden',
      }}
      data-testid="my-video-card"
    >
      <div style={{ position: 'relative', aspectRatio: portrait ? '9 / 14' : '16 / 10', background: '#000' }}>
        {ready && playing ? (
          <video
            src={job.video_url}
            controls
            autoPlay
            playsInline
            preload="metadata"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
          />
        ) : (
          <>
            <div
              aria-hidden
              style={{
                position: 'absolute',
                inset: 0,
                background:
                  'radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--space-brand-primary-600) 28%, transparent), transparent 62%), linear-gradient(180deg, #101014 0%, #050507 100%)',
              }}
            />
            {ready ? (
              <button
                type="button"
                onClick={() => setPlaying(true)}
                aria-label="Play video"
                style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer' }}
              >
                <span style={{ width: 48, height: 48, borderRadius: 999, background: 'rgba(255,255,255,0.94)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                  <Play size={19} color="#0a0a0a" fill="#0a0a0a" style={{ marginLeft: 2 }} />
                </span>
              </button>
            ) : (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
                {job.status === 'failed' ? (
                  <AlertTriangle size={24} color="rgba(255,255,255,0.6)" />
                ) : (
                  <Loader2 size={24} color="rgba(255,255,255,0.8)" className="rst-spin" />
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 13px 13px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: 'var(--space-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {job.title || 'Untitled video'}
            </p>
            <p style={{ margin: '3px 0 0', fontSize: 11.5, color: 'var(--space-text-muted)' }}>
              {sceneCount ? `${sceneCount} scene${sceneCount === 1 ? '' : 's'}` : 'Video'}
              {job.created_at ? ` · ${new Date(job.created_at).toLocaleDateString()}` : ''}
            </p>
          </div>
          <StatusBadge status={job.status} />
        </div>

        {job.status === 'failed' && (
          <p style={{ margin: 0, fontSize: 12, color: 'var(--space-semantic-danger)' }}>
            This render failed — recreate it from the Create tab.
          </p>
        )}

        {ready && (
          <a
            href={job.video_url}
            download
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 7,
              padding: '8px 12px',
              borderRadius: 10,
              fontSize: 12.5,
              fontWeight: 600,
              color: 'var(--space-text-secondary)',
              textDecoration: 'none',
              border: '1px solid var(--space-border-default)',
              background: 'rgba(255,255,255,0.03)',
            }}
            data-testid="button-gallery-download"
          >
            <Download size={13} /> Download MP4
          </a>
        )}

        {job.status === 'processing' && (
          <p style={{ margin: 0, fontSize: 11.5, color: 'var(--space-text-muted)' }}>Usually ready in 2–6 minutes</p>
        )}
      </div>
    </div>
  );
}

export default function MyVideosGallery({ onCreate }: { onCreate: () => void }) {
  const { data, loading, error, refresh } = useWorkspaceDB('video_jobs', {
    orderBy: { column: 'created_at', direction: 'desc' },
    limit: 50,
  });
  const [refreshing, setRefreshing] = useState(false);

  // STRICT session scoping: only this visitor's rows, never NULL-session rows.
  const sid = studioSessionId();
  const own = sid ? data.filter((job: any) => job.session_id === sid) : [];

  // Keep the gallery live while a render is in flight.
  const hasProcessing = own.some((job: any) => job.status === 'processing');
  useEffect(() => {
    if (!hasProcessing) return;
    const id = window.setInterval(() => refresh(), 20000);
    return () => window.clearInterval(id);
  }, [hasProcessing, refresh]);

  const handleRefresh = () => {
    setRefreshing(true);
    refresh();
    window.setTimeout(() => setRefreshing(false), 600);
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 16 }}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--space-text-secondary)' }}>
          {own.length > 0 ? `${own.length} video${own.length === 1 ? '' : 's'} — yours, ready to post` : 'Every video you make lands here'}
        </p>
        <button
          type="button"
          onClick={handleRefresh}
          aria-label="Refresh"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 11px', borderRadius: 999, fontSize: 12.5, color: 'var(--space-text-secondary)', border: '1px solid var(--space-border-default)', background: 'transparent', cursor: 'pointer' }}
          data-testid="button-gallery-refresh"
        >
          <RefreshCw size={13} className={refreshing ? 'rst-spin' : ''} />
        </button>
      </div>

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '60px 0', color: 'var(--space-text-muted)' }}>
          <Loader2 size={18} className="rst-spin" />
          <span style={{ fontSize: 13.5 }}>Loading your videos…</span>
        </div>
      ) : error ? (
        <div style={{ borderRadius: 14, border: '1px solid var(--space-border-default)', background: 'var(--space-surface-panel)', padding: 24, textAlign: 'center', fontSize: 13.5, color: 'var(--space-text-secondary)' }}>
          Couldn't load your videos right now. Try refreshing in a moment.
        </div>
      ) : own.length === 0 ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            borderRadius: 18,
            border: '1px solid var(--space-border-default)',
            background: 'var(--space-surface-panel)',
            padding: '52px 22px',
          }}
          data-testid="gallery-empty-state"
        >
          <span style={{ width: 52, height: 52, borderRadius: 15, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--space-surface-accent-soft)', marginBottom: 14 }}>
            <Clapperboard size={24} color="var(--space-text-brand)" />
          </span>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--space-text-primary)' }}>No videos yet</h3>
          <p style={{ margin: '8px 0 0', maxWidth: 340, fontSize: 13, color: 'var(--space-text-secondary)', lineHeight: 1.55 }}>
            Pick a video type, fill in a couple of fields, and your first downloadable video lands here a few minutes later.
          </p>
          <button
            type="button"
            onClick={onCreate}
            style={{
              marginTop: 18,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '11px 20px',
              borderRadius: 999,
              fontSize: 13.5,
              fontWeight: 600,
              color: 'var(--space-text-on-primary)',
              border: 'none',
              cursor: 'pointer',
              background: 'var(--space-brand-primary)',
              boxShadow: '0 8px 24px rgba(124,58,237,0.35)',
            }}
            data-testid="button-empty-create"
          >
            Create your first video
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 16 }}>
          {own.map((job: any) => (
            <VideoCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}
