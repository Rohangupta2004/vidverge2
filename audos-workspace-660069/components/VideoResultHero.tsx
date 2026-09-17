/**
 * VideoResultHero — the finished-video moment, shared by every VidVerge surface.
 *
 * A finished render IS the product, so wherever one lands (the Create app's
 * delivery screen, a Long Video project, a series clip, Reel's chat) it is
 * presented the same way: a full-width player with the browser's native
 * controls, capped in height so it never pushes its own actions out of the
 * window, and one unmissable "Download Video" button directly underneath.
 *
 * Notes for future edits:
 *   - The download button saves through a blob so the MP4 actually lands in the
 *     visitor's Downloads folder: the `download` attribute is ignored on a
 *     cross-origin URL, which is why a plain link only opened another tab. If
 *     the fetch is blocked the click falls back to opening the URL.
 *   - The hero scrolls itself into view when a URL first arrives, because a
 *     render usually finishes while the visitor is looking at something else.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { CheckCircle2, Download, Loader2 } from 'lucide-react';

const FONT = "'Inter', 'Geist', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

const HERO_CSS = `
@keyframes vrhSpin { to { transform: rotate(360deg); } }
@keyframes vrhRise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
@keyframes vrhReward {
  0%, 100% { box-shadow: 0 0 0 1px rgba(59,130,246,0.45), 0 30px 90px -40px rgba(37,99,235,0.95); }
  50% { box-shadow: 0 0 0 1px rgba(94,234,212,0.5), 0 34px 100px -38px rgba(45,212,191,0.7); }
}
@keyframes vrhSweep { 0% { background-position: -320px 0; } 100% { background-position: 320px 0; } }
.vrh-root { animation: vrhRise .45s cubic-bezier(.16,1,.3,1) both; }
.vrh-cta { transition: filter .15s ease, transform .18s cubic-bezier(.16,1,.3,1), box-shadow .18s ease; }
.vrh-cta:hover { filter: brightness(1.08); transform: translateY(-2px); box-shadow: 0 18px 44px -14px rgba(37,99,235,0.85) !important; }
.vrh-cta:active { transform: translateY(0) scale(0.99); }
/* The finished render is the payoff, so its frame glows rather than sitting
   in the same quiet border every other card uses. */
.vrh-frame { animation: vrhReward 5s ease-in-out infinite; }
.vrh-badge {
  background-image: linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent);
  background-size: 320px 100%;
  background-repeat: no-repeat;
  animation: vrhSweep 2.6s linear 3;
}
@media (prefers-reduced-motion: reduce) {
  .vrh-root, .vrh-frame, .vrh-badge { animation: none !important; }
  .vrh-cta:hover { transform: none; }
}
`;

/**
 * Tall enough to dominate the window, short enough that the badge, title and
 * the Download button below it still fit inside an app window (which is
 * calc(100vh - 8rem) minus its own header) without scrolling.
 */
export const HERO_PLAYER_MAX_HEIGHT = 'min(640px, 52vh)';

export function videoFileName(title?: string): string {
  const slug = (title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, 60);
  return `${slug || 'vidverge-video'}.mp4`;
}

/** Save the MP4 to disk. Resolves false when the browser blocked the fetch. */
export async function saveVideoFile(url: string, filename: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
    return true;
  } catch {
    return false;
  }
}

/**
 * The primary "Download Video" call to action. Stays a real anchor so
 * right-click / cmd-click keep working, but a plain click saves the file.
 */
export function DownloadVideoButton({
  src,
  title,
  label = 'Download Video',
  style,
  testId = 'button-download-video-hero',
}: {
  src: string;
  title?: string;
  label?: string;
  style?: CSSProperties;
  testId?: string;
}) {
  const [saving, setSaving] = useState(false);

  return (
    <a
      className="vrh-cta"
      href={src}
      download={videoFileName(title)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        if (saving) return;
        setSaving(true);
        void saveVideoFile(src, videoFileName(title)).then((ok) => {
          setSaving(false);
          if (!ok) window.open(src, '_blank', 'noopener,noreferrer');
        });
      }}
      data-testid={testId}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        width: '100%',
        boxSizing: 'border-box',
        padding: '16px 22px',
        borderRadius: 14,
        fontFamily: FONT,
        fontSize: 16,
        fontWeight: 700,
        letterSpacing: 0.1,
        color: '#fff',
        textDecoration: 'none',
        border: 'none',
        cursor: 'pointer',
        backgroundImage: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 55%, #1d4ed8 100%)',
        boxShadow: '0 14px 38px -12px rgba(37,99,235,0.75)',
        ...style,
      }}
    >
      <style>{HERO_CSS}</style>
      {saving ? (
        <Loader2 size={19} style={{ animation: 'vrhSpin 0.9s linear infinite' }} />
      ) : (
        <Download size={19} />
      )}
      {saving ? 'Saving your video…' : label}
    </a>
  );
}

export default function VideoResultHero({
  src,
  aspect,
  title,
  badge,
  note,
  downloadLabel,
  actions,
  stickyActions = false,
  surface = 'var(--space-surface-card, #0a0a0c)',
  autoPlay = true,
  autoScroll = true,
  testId = 'video-result-hero',
  playerTestId = 'video-player-hero',
  downloadTestId = 'button-download-video-hero',
}: {
  src: string;
  /** Known aspect of the render; the player re-measures from the file anyway. */
  aspect?: '16:9' | '9:16' | string;
  title?: string;
  /** Small success line above the title, e.g. "Your video is ready". */
  badge?: string;
  /** One-line hint under the player (sound, stitch method, …). */
  note?: ReactNode;
  downloadLabel?: string;
  /** Secondary actions, rendered under the download button. */
  actions?: ReactNode;
  /** Pin the download button to the bottom of a scrolling screen. */
  stickyActions?: boolean;
  /** Background the sticky action bar fades into. */
  surface?: string;
  /** Off for older deliveries in a scrollback, so several don't play at once. */
  autoPlay?: boolean;
  autoScroll?: boolean;
  testId?: string;
  playerTestId?: string;
  downloadTestId?: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [ratio, setRatio] = useState<number | null>(null);

  useEffect(() => {
    setRatio(null);
    if (!autoScroll) return;
    const node = rootRef.current;
    if (!node) return;
    const id = window.setTimeout(() => {
      try {
        node.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch {
        node.scrollIntoView();
      }
    }, 80);
    return () => window.clearTimeout(id);
  }, [src, autoScroll]);

  const aspectCss = ratio ? String(ratio) : aspect === '9:16' ? '9 / 16' : '16 / 9';

  return (
    <div ref={rootRef} className="vrh-root" style={{ width: '100%', fontFamily: FONT }} data-testid={testId}>
      <style>{HERO_CSS}</style>

      {badge ? (
        <div
          className="vrh-badge"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            marginBottom: 10,
            padding: '5px 12px',
            borderRadius: 999,
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--space-semantic-success, #4ade80)',
            border: '1px solid rgba(74,222,128,0.32)',
            backgroundColor: 'rgba(74,222,128,0.10)',
          }}
        >
          <CheckCircle2 size={15} /> {badge}
        </div>
      ) : null}

      {title ? (
        <h2
          style={{
            margin: '0 0 12px',
            fontSize: 20,
            fontWeight: 700,
            letterSpacing: -0.3,
            lineHeight: 1.25,
            color: 'var(--space-text-primary, #f5f5f7)',
          }}
        >
          {title}
        </h2>
      ) : null}

      {/* The player: full width, native controls, never cropped. */}
      <div
        className="vrh-frame"
        style={{
          width: '100%',
          borderRadius: 16,
          overflow: 'hidden',
          border: '1px solid rgba(59,130,246,0.35)',
          background: '#000',
        }}
      >
        <video
          key={src}
          src={src}
          controls
          autoPlay={autoPlay}
          muted
          playsInline
          preload="metadata"
          onLoadedMetadata={(e) => {
            const el = e.currentTarget;
            if (el.videoWidth > 0 && el.videoHeight > 0) setRatio(el.videoWidth / el.videoHeight);
          }}
          style={{
            display: 'block',
            width: '100%',
            aspectRatio: aspectCss,
            maxHeight: HERO_PLAYER_MAX_HEIGHT,
            objectFit: 'contain',
            background: '#000',
          }}
          data-testid={playerTestId}
        />
      </div>

      {note ? (
        <p style={{ margin: '10px 0 0', fontSize: 12, lineHeight: 1.55, color: 'var(--space-text-muted, #71717c)' }}>
          {note}
        </p>
      ) : null}

      {/* Download sits immediately below the player — nothing between them. */}
      <div
        style={
          stickyActions
            ? {
                position: 'sticky',
                bottom: 0,
                zIndex: 3,
                marginTop: 14,
                paddingBottom: 8,
                background: `linear-gradient(180deg, transparent 0%, ${surface} 38%, ${surface} 100%)`,
              }
            : { marginTop: 14 }
        }
      >
        <DownloadVideoButton src={src} title={title} label={downloadLabel} testId={downloadTestId} />
        {actions ? <div style={{ marginTop: 10 }}>{actions}</div> : null}
      </div>
    </div>
  );
}
