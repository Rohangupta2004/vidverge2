import { useEffect, useState } from 'react';
import { ExternalLink, History } from 'lucide-react';

import { listVideoHistory, type VideoHistoryRow } from '../lib/videoHistory';

export interface VideoHistoryProps {
  /** Override title — defaults to "Your videos". */
  title?: string;
  /** Max rows to show — defaults to 8. */
  limit?: number;
  /** Called when the visitor clicks a row. Receives the video URL and its title. */
  onOpen?: (url: string, title: string) => void;
}

/**
 * SHARED "YOUR VIDEOS" HISTORY
 *
 * One list of everything the visitor has made, across every app in the suite.
 * It reads `vv_video_history` through the `vge-list-videos` server function
 * (see lib/videoHistory.ts) rather than the browser DB client, so a video made
 * in Faceless, SceneForge or Ads Studio shows up here exactly like a Vidverge
 * one. It used to read the Vidverge engine's own `vge_video_jobs` table, which
 * only ever held Vidverge's jobs.
 *
 * It renders nothing until there is something to show: null while the first
 * read is in flight, and null when the visitor has no videos yet. It styles
 * itself purely with --space-* tokens, so it inherits the host app's theme.
 */
export function VideoHistory({
  title = 'Your videos',
  limit = 8,
  onOpen,
}: VideoHistoryProps): JSX.Element | null {
  const [rows, setRows] = useState<VideoHistoryRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listVideoHistory(limit)
      .then((next) => {
        if (!cancelled) setRows(next);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [limit]);

  // Loading and empty states render nothing — the section only appears once
  // the visitor actually has videos to show.
  if (!loaded || rows.length === 0) return null;

  const open = (row: VideoHistoryRow) => {
    if (!row.video_url) return;
    if (onOpen) {
      onOpen(row.video_url, row.title);
      return;
    }
    if (typeof window !== 'undefined') {
      window.open(row.video_url, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.07em] text-[var(--space-text-muted)]">
        <History className="h-3.5 w-3.5" />
        {title}
      </h2>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              onClick={() => open(row)}
              aria-label={`Open ${row.title}`}
              title="Open video"
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] px-4 py-3 text-left transition-colors hover:border-[color-mix(in_srgb,var(--space-brand-primary-500)_45%,transparent)]"
            >
              <span className="min-w-0">
                <span className="block truncate text-[13.5px] font-medium text-[var(--space-text-primary)]">
                  {row.title}
                </span>
                {row.duration_sec ? (
                  <span className="mt-0.5 block text-[11.5px] text-[var(--space-text-muted)]">
                    {row.duration_sec}s
                  </span>
                ) : null}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <AppPill appId={row.app_id} />
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-[var(--space-text-secondary)]" />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Which app made the video. The stored value is the machine id the saving app
 * passed, so it is mapped to the product name the customer knows; an id with no
 * entry is title-cased rather than shown raw or hidden.
 */
const APP_LABELS: Record<string, string> = {
  vidverge: 'Video Engine',
  'vidverge-agent': 'Vidverge Agent',
  faceless: 'Faceless',
  'faceless-content': 'Faceless Content',
  vergeye: 'Vergeye',
  'video-enhancer': 'Video Enhancer',
  'script-to-video': 'Script to Video',
  sceneforge: 'SceneForge',
  'ads-studio': 'Ads Studio',
  'product-launch': 'Product Launch',
  'voice-studio': 'Voice Studio',
  'video-provider-lab': 'Provider Lab',
  'motion-type': 'Motion Type',
  'cine-agent': 'Cine Agent',
  'brand-context': 'Brand Context',
};

function appLabel(appId: string): string {
  const known = APP_LABELS[appId];
  if (known) return known;
  return appId
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function AppPill({ appId }: { appId: string }) {
  return (
    <span
      className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold text-[var(--space-text-secondary)]"
      style={{
        background: 'color-mix(in srgb, var(--space-text-muted) 12%, transparent)',
        border: '1px solid var(--space-border-default)',
      }}
    >
      {appLabel(appId)}
    </span>
  );
}

export default VideoHistory;
