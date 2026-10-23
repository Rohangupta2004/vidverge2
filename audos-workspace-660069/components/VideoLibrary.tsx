import { useEffect, useState } from 'react';
import { Download, Film, Loader2, Play, RefreshCw } from 'lucide-react';
import { listVideoHistory, type VideoHistoryRow } from '../lib/videoHistory';

const APP_LABELS: Record<string, string> = {
  vidverge: 'Video Engine',
  'vidverge-agent': 'Verger',
  faceless: 'Faceless',
  'video-enhancer': 'Video Enhancer',
  'script-to-video': 'Script-to-Video',
  sceneforge: 'SceneForge',
  'ads-studio': 'Vergeye Ads Studio',
  cineagent: 'CineAgent',
  'cine-agent': 'CineAgent',
};

function appLabel(id: string): string {
  return APP_LABELS[id] || id.split(/[-_]/).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join(' ');
}

function dateLabel(value: string): string {
  const time = Date.parse(value);
  return Number.isFinite(time)
    ? new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : '';
}

export default function VideoLibrary() {
  const [rows, setRows] = useState<VideoHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const next = await listVideoHistory(100);
      setRows(next);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Your video library could not be loaded.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <main className="min-h-full bg-[radial-gradient(ellipse_70%_36%_at_50%_-8%,color-mix(in_srgb,var(--vg-accent)_10%,transparent),transparent_66%),var(--vg-bg)] px-4 py-6 sm:px-8 sm:py-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[var(--vg-accent)]">Every finished render</p>
            <h1 className="mt-2 font-['Space_Grotesk'] text-3xl font-semibold tracking-tight text-[var(--vg-text)]">Library</h1>
            <p className="mt-2 max-w-xl text-sm text-[var(--vg-secondary)]">Preview and download videos made across Verger and every specialist studio.</p>
          </div>
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={loading || refreshing}
            className="flex min-h-11 items-center gap-2 rounded-[10px] border border-[var(--vg-control-border)] bg-[var(--vg-surface)] px-4 text-sm font-semibold text-[var(--vg-text)] transition-colors hover:bg-[var(--vg-hover)] disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 text-[var(--vg-accent)] ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </header>

        {loading ? (
          <div className="flex min-h-64 items-center justify-center rounded-xl border border-[var(--vg-border)] bg-[var(--vg-surface)] text-sm text-[var(--vg-muted)]">
            <Loader2 className="mr-2 h-4 w-4 animate-spin text-[var(--vg-accent)]" /> Loading your library…
          </div>
        ) : error ? (
          <div className="rounded-xl border border-[color-mix(in_srgb,var(--vg-danger)_45%,transparent)] bg-[var(--vg-danger-bg)] p-5">
            <p className="font-semibold text-[var(--vg-danger)]">Library unavailable</p>
            <p className="mt-1 text-sm text-[var(--vg-secondary)]">{error}</p>
            <button type="button" onClick={() => void load()} className="mt-4 min-h-11 rounded-[10px] border border-[color-mix(in_srgb,var(--vg-danger)_45%,transparent)] px-4 text-sm font-semibold text-[var(--vg-danger)]">Retry</button>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-[var(--vg-control-border)] bg-[var(--vg-surface)] px-6 text-center">
            <Film className="h-7 w-7 text-[var(--vg-accent)]" />
            <h2 className="mt-3 font-['Space_Grotesk'] text-lg font-semibold text-[var(--vg-text)]">No finished videos yet</h2>
            <p className="mt-1 max-w-sm text-sm text-[var(--vg-secondary)]">Start from Create. Completed renders appear here automatically.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {rows.map((row) => (
              <article key={row.id} className="overflow-hidden rounded-xl border border-[var(--vg-border)] bg-[var(--vg-surface)] transition-colors hover:border-[var(--vg-control-border)]">
                <a href={row.video_url} target="_blank" rel="noreferrer" className="group relative block aspect-video bg-black">
                  {row.thumbnail_url ? (
                    <img src={row.thumbnail_url} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <video src={row.video_url} preload="metadata" muted playsInline className="h-full w-full object-cover" />
                  )}
                  <span className="absolute inset-0 grid place-items-center bg-black/20 opacity-0 transition-opacity group-hover:opacity-100">
                    <span className="grid h-11 w-11 place-items-center rounded-full bg-[var(--vg-accent)] text-[var(--vg-on-accent)]"><Play className="h-5 w-5" /></span>
                  </span>
                </a>
                <div className="p-4">
                  <h2 className="truncate text-sm font-semibold text-[var(--vg-text)]" title={row.title}>{row.title}</h2>
                  <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                    <span className="truncate text-[var(--vg-accent)]">{appLabel(row.app_id)}</span>
                    <span className="shrink-0 text-[var(--vg-muted)]">{dateLabel(row.created_at)}</span>
                  </div>
                  <a href={row.video_url} download target="_blank" rel="noreferrer" className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-[image:var(--vg-gradient-action)] px-4 text-sm font-semibold text-[var(--vg-on-accent)]">
                    <Download className="h-4 w-4" /> Download
                  </a>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
