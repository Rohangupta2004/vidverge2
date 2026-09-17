/**
 * VidVerge — THE STYLE PREVIEW TILE.
 *
 * The one job: let someone SEE what a style produces before they spend a credit
 * on it. A row of words cannot do that, so every style-selection surface in
 * Create renders this instead of a label.
 *
 * TWO MODES, in preference order:
 *   1. A real looping clip (`clipUrl`). Muted, inline, autoplaying, `loop` — the
 *      honest preview, used the moment a template has one.
 *   2. A still with a MOTION TREATMENT. The still drifts (a slow ken-burns push,
 *      pull or pan) and, for the styles that are about motion rather than
 *      composition, a light band sweeps across it. That reads as "this style
 *      moves like this" rather than as a flat thumbnail.
 *
 * The still is always drawn over the template's gradient, so the tile is on
 * brand from the first paint and a slow image never leaves a grey hole.
 *
 * REDUCED MOTION IS HONOURED. `prefers-reduced-motion` stops the drift, the
 * sweep and clip autoplay — see GLOBAL_CSS in ./ui — so the tile degrades to a
 * clean still rather than being switched off.
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import { Play } from 'lucide-react';
import type { PreviewAsset } from './templateCatalog';
import { T } from './ui';

export default function PreviewTile({
  preview,
  aspect = '16 / 9',
  selected,
  radius = 12,
  badge,
  overlay,
  testId,
  style,
}: {
  preview: PreviewAsset;
  /** CSS aspect-ratio. Vertical styles pass '9 / 16'. */
  aspect?: string;
  selected?: boolean;
  radius?: number;
  /** A small pill in the top-left — the engine, the length, the structure. */
  badge?: string;
  /** Anything drawn over the bottom of the tile, e.g. the template title. */
  overlay?: ReactNode;
  testId?: string;
  style?: CSSProperties;
}) {
  const [loaded, setLoaded] = useState(false);
  const [clipFailed, setClipFailed] = useState(false);
  const useClip = !!preview.clipUrl && !clipFailed;

  return (
    <span
      className="rc-preview"
      data-testid={testId}
      data-selected={selected ? 'true' : 'false'}
      style={{
        position: 'relative',
        display: 'block',
        width: '100%',
        aspectRatio: aspect,
        overflow: 'hidden',
        borderRadius: radius,
        background: preview.gradient,
        ...style,
      }}
    >
      {/* The gradient wash sits under everything, so the tile is never grey. */}
      <span
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, background: preview.gradient, opacity: loaded ? 0.35 : 1 }}
      />

      {useClip ? (
        <video
          src={preview.clipUrl}
          poster={preview.stillUrl}
          muted
          loop
          autoPlay
          playsInline
          preload="metadata"
          aria-label={preview.alt}
          onError={() => setClipFailed(true)}
          onLoadedData={() => setLoaded(true)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <img
          src={preview.stillUrl}
          alt={preview.alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          className="rc-preview-drift"
          data-drift={preview.motion.drift}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: loaded ? 1 : 0,
            transition: 'opacity .35s ease',
            // The loop length is the template's own, so a fast ad and a
            // five-minute series do not drift at the same speed.
            animationDuration: `${preview.motion.speed}s`,
          }}
        />
      )}

      {/* The travelling light band — only for styles that are ABOUT motion. */}
      {!useClip && preview.motion.sweep ? (
        <span aria-hidden="true" className="rc-preview-sweep" style={{ animationDuration: `${preview.motion.speed}s` }} />
      ) : null}

      {/* A readable floor for whatever the overlay puts on top. */}
      {overlay ? (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(180deg, rgba(3,8,18,0) 38%, rgba(3,8,18,0.86) 100%)',
          }}
        />
      ) : null}

      {badge ? (
        <span
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            maxWidth: 'calc(100% - 16px)',
            padding: '3px 8px',
            borderRadius: 999,
            color: '#e0f2fe',
            background: 'rgba(3,8,18,0.68)',
            backdropFilter: 'blur(6px)',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 0.3,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {useClip ? <Play size={9} /> : null}
          {badge}
        </span>
      ) : null}

      {overlay ? (
        <span style={{ position: 'absolute', inset: 'auto 10px 9px 10px', display: 'block' }}>{overlay}</span>
      ) : null}

      {selected ? (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: radius,
            border: `2px solid ${T.accentFg}`,
            boxShadow: 'inset 0 0 32px -6px rgba(147,197,253,0.55)',
          }}
        />
      ) : null}
    </span>
  );
}
