/**
 * Preview surface for the Product Editor. Wraps `@hyperframes/player`
 * (<hyperframes-player>) when the project has a published composition URL,
 * and falls back to the last rendered MP4 otherwise. It is deliberately NOT a
 * second composition engine: nothing here re-implements playback or rendering,
 * and edits made after the last render are flagged "pending re-render" instead
 * of being faked client-side.
 */
import { useEffect, useRef, useState } from 'react';
import { Clapperboard, Loader2, RefreshCw } from 'lucide-react';
import type { TrackBScene } from '../../lib/trackB/api';

function fmtSecs(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const PLAYER_MODULE_URL = 'https://esm.sh/@hyperframes/player@0.8.30';
let playerLoad: Promise<boolean> | null = null;

function ensurePlayerElement(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.customElements?.get('hyperframes-player')) return Promise.resolve(true);
  if (!playerLoad) {
    playerLoad = import(/* @vite-ignore */ PLAYER_MODULE_URL)
      .then(() => Boolean(window.customElements?.get('hyperframes-player')))
      .catch(() => false);
  }
  return playerLoad;
}

export default function PlayerPreview({
  playerSrcUrl,
  previewVideoUrl,
  pendingRerender,
  rendering = false,
  onRerender,
  status,
  scenes = [],
  brandTokens = {},
  selectedSceneId = null,
  onSelectScene,
}: {
  playerSrcUrl: string | null;
  previewVideoUrl: string | null;
  pendingRerender: boolean;
  /** True while a (re-)render is running — the pending badge becomes live progress. */
  rendering?: boolean;
  /** Queues the incremental re-render (the editor's export action). */
  onRerender?: () => void;
  status: string;
  /** Planned scenes — shown as a styled storyboard preview until a render exists. */
  scenes?: TrackBScene[];
  brandTokens?: Record<string, string>;
  selectedSceneId?: string | null;
  onSelectScene?: (id: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [playerReady, setPlayerReady] = useState<boolean | null>(playerSrcUrl ? null : false);
  // The rendered MP4's real length — read from its metadata so the UI can say
  // plainly when the preview is an older cut than the current scene plan.
  const [renderedDur, setRenderedDur] = useState(0);
  const plannedSecs = scenes.reduce((n, s) => n + (Number(s.duration_s) || 0), 0);

  useEffect(() => {
    let cancelled = false;
    if (!playerSrcUrl) { setPlayerReady(false); return; }
    void ensurePlayerElement().then((ok) => { if (!cancelled) setPlayerReady(ok); });
    return () => { cancelled = true; };
  }, [playerSrcUrl]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !playerReady || !playerSrcUrl) return;
    host.innerHTML = '';
    const el = document.createElement('hyperframes-player');
    el.setAttribute('src', playerSrcUrl);
    el.setAttribute('controls', '');
    el.style.display = 'block';
    el.style.width = '100%';
    host.appendChild(el);
    return () => { host.innerHTML = ''; };
  }, [playerReady, playerSrcUrl]);

  const frame: React.CSSProperties = {
    position: 'relative',
    borderRadius: 14,
    overflow: 'hidden',
    border: '1px solid var(--space-border-strong)',
    background: '#000',
    minHeight: 220,
  };

  // Never a static resting state: while a render runs it shows live progress,
  // and otherwise it is a button that queues the re-render right here.
  const badge = rendering ? (
    <span
      style={{
        position: 'absolute', top: 10, right: 10, zIndex: 3,
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '4px 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 700,
        color: 'var(--space-text-brand)',
        background: 'var(--space-brand-primary-50)',
        border: '1px solid var(--space-brand-primary-200)',
      }}
      data-testid="badge-rendering"
    >
      <Loader2 size={11} className="rc-spin" /> Rendering your latest edits…
    </span>
  ) : pendingRerender ? (
    <button
      type="button"
      onClick={() => onRerender?.()}
      title="Your saved edits are not in this video yet — click to render them now. The previous cut stays downloadable."
      style={{
        position: 'absolute', top: 10, right: 10, zIndex: 3,
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '4px 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 700,
        color: '#fbbf24',
        background: 'color-mix(in srgb, #fbbf24 14%, rgba(4,8,18,0.7))',
        border: '1px solid color-mix(in srgb, #fbbf24 40%, transparent)',
        cursor: onRerender ? 'pointer' : 'default',
      }}
      data-testid="badge-pending-rerender"
    >
      <RefreshCw size={11} /> Edits saved · Re-render now
    </button>
  ) : null;

  if (playerSrcUrl && playerReady !== false) {
    return (
      <div style={frame}>
        {badge}
        {playerReady === null ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 220, color: 'var(--space-text-muted)', fontSize: 13 }}>
            <Loader2 size={15} className="rc-spin" /> Loading player…
          </div>
        ) : null}
        <div ref={hostRef} />
      </div>
    );
  }

  if (previewVideoUrl) {
    // The preview MP4 is always the LAST render — when the current scene plan
    // totals a different length, say so explicitly instead of letting the
    // player timestamp silently contradict the scene list.
    const durationMismatch = pendingRerender && !rendering && scenes.length > 0 && renderedDur > 0 && Math.abs(plannedSecs - renderedDur) > 1.5;
    return (
      <div style={frame}>
        {badge}
        <video
          src={previewVideoUrl}
          controls
          playsInline
          preload="metadata"
          onLoadedMetadata={(e) => { const d = e.currentTarget.duration; if (Number.isFinite(d) && d > 0) setRenderedDur(d); }}
          style={{ display: 'block', width: '100%', maxHeight: 'min(480px, 48vh)', objectFit: 'contain', background: '#000' }}
          data-testid="video-preview"
        />
        {durationMismatch ? (
          <div style={{ padding: '8px 12px', fontSize: 11.5, lineHeight: 1.5, color: '#fbbf24', background: 'rgba(4,8,18,0.85)', borderTop: '1px solid color-mix(in srgb, #fbbf24 30%, transparent)' }} data-testid="duration-mismatch-note">
            This video is an earlier cut ({fmtSecs(renderedDur)}). Your current {scenes.length} scene{scenes.length === 1 ? '' : 's'} total {fmtSecs(plannedSecs)} — re-render to bring the video up to date. The previous cut stays downloadable.
          </div>
        ) : null}
      </div>
    );
  }

  // PLANNED-SCENE PREVIEW: no render output yet, but the plan exists — show the
  // selected scene's headline + caption on the project's own brand colours so
  // the scene is NEVER blank just because composition_file is null. This is a
  // static storyboard card, not a second composition engine: nothing here
  // re-implements motion or playback.
  if (scenes.length > 0) {
    const scene = scenes.find((s) => s.id === selectedSceneId) ?? scenes[0];
    const index = Math.max(0, scenes.findIndex((s) => s.id === scene.id));
    const bg = brandTokens.background || '#090b14';
    const text = brandTokens.text || '#f8fafc';
    const primary = brandTokens.primary || '#6d5efc';
    const accent = brandTokens.accent || '#22d3ee';
    const rendering = /render|build|compos|queue/.test(String(status || '').toLowerCase());
    return (
      <div style={{ ...frame, background: bg }} data-testid="planned-scene-preview">
        {badge}
        <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(70% 60% at 82% 18%, ${primary}22, transparent 65%), radial-gradient(55% 50% at 12% 88%, ${accent}1f, transparent 60%)` }} />
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: 220, padding: 'clamp(18px, 4vw, 34px)', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 10px', borderRadius: 999, border: `1px solid ${primary}66`, color: primary, fontSize: 10.5, fontWeight: 800, letterSpacing: '0.12em' }}>
              SCENE {index + 1} / {scenes.length}
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 999, border: `1px solid ${accent}55`, color: accent, fontSize: 10.5, fontWeight: 700 }}>
              {rendering ? <Loader2 size={10} className="rc-spin" /> : null}
              {rendering ? 'Rendering the full film\u2026' : 'Planned preview \u00b7 not rendered yet'}
            </span>
          </div>
          <h2 style={{ margin: 0, color: text, fontSize: 'clamp(20px, 3.4vw, 34px)', lineHeight: 1.1, fontWeight: 900, letterSpacing: '-0.02em' }}>
            {scene.headline || 'Untitled scene'}
          </h2>
          {scene.caption ? (
            <p style={{ margin: 0, color: text, opacity: 0.72, fontSize: 'clamp(12.5px, 1.6vw, 15.5px)', lineHeight: 1.5, maxWidth: 560 }}>{scene.caption}</p>
          ) : null}
          <div style={{ height: 5, width: 130, borderRadius: 999, background: `linear-gradient(90deg, ${primary}, ${accent})` }} />
          {scenes.length > 1 ? (
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              {scenes.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onSelectScene?.(s.id)}
                  aria-label={`Preview scene ${i + 1}`}
                  style={{ width: 9, height: 9, padding: 0, borderRadius: 999, border: 'none', cursor: 'pointer', background: s.id === scene.id ? primary : `${text}33` }}
                  data-testid={`preview-dot-${s.id}`}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...frame, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 28, background: 'var(--space-surface-panel)' }}>
      <span style={{ display: 'inline-flex', width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', color: 'var(--space-text-brand)', background: 'var(--space-surface-accent-soft)', border: '1px solid var(--space-border-default)' }}>
        <Clapperboard size={20} />
      </span>
      <p style={{ margin: 0, color: 'var(--space-text-secondary)', fontSize: 13.5, textAlign: 'center', maxWidth: 380, lineHeight: 1.55 }}>
        {status === 'draft'
          ? 'No preview yet — this project hasn\u2019t been rendered. Your edits are saved to the project and the first render will pick them up.'
          : 'The pipeline is working on this project. The preview appears here after the first successful render.'}
      </p>
    </div>
  );
}
