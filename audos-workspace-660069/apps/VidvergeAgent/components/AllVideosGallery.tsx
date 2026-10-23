import { useEffect, useState } from 'react';
import { Download, Film } from 'lucide-react';
import { listVideoHistory, type VideoHistoryRow } from '../../../lib/videoHistory';

const POLL_MS = 15000;
const SKELETON_KEYS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

/**
 * Which app made the video — same mapping convention as the shared
 * components/VideoHistory.tsx list; an unknown id is title-cased, never raw.
 */
const APP_LABELS: Record<string, string> = {
  vidverge: 'Video Engine',
  'vidverge-agent': 'Agent Hub',
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

function dateLabel(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

interface AllVideosGalleryProps {
  /**
   * Bumped by the hub whenever a watched job or HeyGen render completes, so
   * the gallery refreshes immediately instead of waiting for its next poll.
   */
  refreshSignal: number;
}

/**
 * THE "ALL VIDEOS" TAB — every finished video the visitor has made, across all
 * studios, read from the shared vv_video_history infrastructure
 * (lib/videoHistory.ts). Polls while open and refreshes on completion events.
 */
export default function AllVideosGallery({ refreshSignal }: AllVideosGalleryProps) {
  const [rows, setRows] = useState<VideoHistoryRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const next = await listVideoHistory(60);
      if (cancelled) return;
      // listVideoHistory resolves [] on a transient hiccup — do not wipe a
      // gallery that already has rows over an empty error answer.
      setRows((previous) => (next.length || !previous.length ? next : previous));
      setLoaded(true);
    };
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refreshSignal]);

  if (!loaded) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {SKELETON_KEYS.map((key) => (
          <div key={key} className="vv-skeleton aspect-video rounded-2xl border border-[var(--vv-border)]" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-[var(--vv-border)] bg-[var(--vv-surface)] px-6 py-12 text-center">
        <Film size={20} className="text-[#6E5F38]" />
        <p className="text-[13px] text-[#F5E9C8]">Your finished videos will appear here</p>
        <p className="text-[11px] text-[var(--vv-text-dim)]">
          Finish a render in any studio and it lands in this gallery automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 items-start gap-3 sm:grid-cols-3 xl:grid-cols-4">
      {rows.map((row) => (
        <article
          key={row.id}
          className="overflow-hidden rounded-2xl border border-[var(--vv-border)] bg-[var(--vv-surface)] transition-colors hover:border-[var(--vv-border-hover)]"
        >
          <a
            href={row.video_url}
            target="_blank"
            rel="noreferrer"
            className="block aspect-video w-full bg-[rgba(0,0,0,0.4)]"
            title={`Open ${row.title}`}
          >
            {row.thumbnail_url ? (
              <img src={row.thumbnail_url} alt="" loading="lazy" className="h-full w-full object-cover" />
            ) : (
              <video src={row.video_url} preload="metadata" muted playsInline className="h-full w-full object-cover" />
            )}
          </a>

          <div className="p-3">
            <p className="truncate text-[12.5px] text-[#F5E9C8]" title={row.title}>
              {row.title}
            </p>
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <span className="truncate rounded-full border border-[color-mix(in_srgb,var(--vv-gold)_35%,transparent)] bg-[color-mix(in_srgb,var(--vv-gold)_10%,transparent)] px-2 py-[2px] text-[10px] font-medium text-[var(--vv-gold)]">
                {appLabel(row.app_id)}
              </span>
              <span className="shrink-0 text-[10.5px] text-[var(--vv-text-dim)]">{dateLabel(row.created_at)}</span>
            </div>
            <a
              href={row.video_url}
              download
              target="_blank"
              rel="noreferrer"
              className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold text-[#0A0905] transition-opacity hover:opacity-90"
              style={{
                background: 'linear-gradient(135deg, var(--vv-gold-light, #F0B429), var(--vv-gold, #D4920A))',
              }}
            >
              <Download size={12} />
              Download
            </a>
          </div>
        </article>
      ))}
    </div>
  );
}
