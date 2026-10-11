import { useEffect, useState } from 'react';
import { AlertTriangle, Download, ExternalLink, Loader2, X } from 'lucide-react';

export type HeygenRenderPhase = 'creating' | 'processing' | 'completed' | 'failed';

export interface HeygenRenderState {
  phase: HeygenRenderPhase;
  videoId: string;
  api: 'v2' | 'v3';
  script: string;
  avatarName: string;
  voiceName: string;
  videoUrl: string;
  thumbnailUrl: string;
  error: string;
  startedAt: number;
}

const PANEL_CSS = `
.vv-render-bar {
  background: linear-gradient(90deg, transparent, var(--vv-gold, #C8920A), transparent);
  background-size: 50% 100%;
  animation: vv-render-sweep 1.6s linear infinite;
}
@keyframes vv-render-sweep {
  from { background-position: -60% 0; }
  to { background-position: 160% 0; }
}
@media (prefers-reduced-motion: reduce) {
  .vv-render-bar { animation: none; background: var(--vv-gold, #C8920A); }
}
`;

function elapsedLabel(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

export default function HeygenRenderPanel({
  render,
  onDismiss,
}: {
  render: HeygenRenderState;
  onDismiss: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  const running = render.phase === 'creating' || render.phase === 'processing';

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  const headline =
    render.phase === 'completed'
      ? 'HeyGen render ready'
      : render.phase === 'failed'
        ? 'HeyGen render stopped'
        : render.phase === 'creating'
          ? 'Sending the script to HeyGen…'
          : 'HeyGen is rendering your character';

  return (
    <div className="rounded-2xl border border-[var(--vv-border)] bg-[var(--vv-surface)] px-4 py-3.5">
      <style>{PANEL_CSS}</style>

      <div className="flex items-start gap-3">
        {render.thumbnailUrl ? (
          <img src={render.thumbnailUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
        ) : (
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[rgba(180,120,0,0.06)] text-[var(--vv-gold)]">
            {render.phase === 'failed'
              ? <AlertTriangle size={16} />
              : <Loader2 size={16} className={running ? 'animate-spin' : ''} />}
          </span>
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] text-[#1A1000]">{headline}</p>
          <p className="mt-0.5 truncate text-[11px] text-[var(--vv-text-dim)]">
            {render.avatarName}
            {render.voiceName ? ` · ${render.voiceName}` : ' · default voice'}
            {running ? ` · ${elapsedLabel(now - render.startedAt)}` : ''}
          </p>
        </div>

        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-[#7A6030] transition-colors hover:text-[#1A1000]"
          aria-label="Dismiss this render"
        >
          <X size={14} />
        </button>
      </div>

      {running && (
        <span className="mt-3 block h-[2px] w-full overflow-hidden rounded-full bg-[rgba(180,120,0,0.14)]">
          <span className="vv-render-bar block h-full w-full rounded-full" />
        </span>
      )}

      {render.phase === 'failed' && (
        <p className="mt-2.5 text-[12px] text-[var(--vv-error)]">
          {render.error || 'HeyGen could not finish this render.'}
        </p>
      )}

      {render.phase === 'completed' && render.videoUrl && (
        <div className="mt-3">
          <video
            src={render.videoUrl}
            poster={render.thumbnailUrl || undefined}
            controls
            playsInline
            className="max-h-[320px] w-full rounded-xl bg-black"
          />
          <div className="mt-2.5 flex flex-wrap gap-2">
            <a
              href={render.videoUrl}
              download
              className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-medium text-[#1a1203] transition-opacity hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, var(--vv-gold-light, #E8B737), var(--vv-gold, #C8920A))' }}
            >
              <Download size={13} />
              Download MP4
            </a>
            <a
              href={render.videoUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--vv-border)] px-3.5 py-1.5 text-[12px] text-[#3D2800] transition-colors hover:text-[#1A1000]"
            >
              <ExternalLink size={13} />
              Open
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
