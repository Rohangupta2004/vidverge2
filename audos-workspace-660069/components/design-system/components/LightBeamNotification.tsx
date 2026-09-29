/**
 * LightBeamNotification — the toast.
 *
 * The light arrives before the message: a beam sweeps in from the right edge,
 * then the card follows it in. On dismiss the beam sweeps back out to the
 * right and the card follows. Info is gold, success green, error red.
 */
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { colors, beamVariants, tint } from '../tokens/colors';
import type { BeamVariant } from '../tokens/colors';
import { radii } from '../tokens/radii';
import { typography } from '../tokens/typography';
import { beamGradient, beamGlow } from '../animations/beamKeyframes';
import { useBeamStyles, useRiveSlot } from '../animations/useBeamAnimation';

export interface LightBeamNotificationProps {
  riveSrc?: string;
  open: boolean;
  variant?: BeamVariant;
  title?: string;
  message?: ReactNode;
  onClose?: () => void;
  /** Auto-dismiss after this many ms. 0 disables. */
  autoCloseMs?: number;
  /** Render in normal flow instead of pinned to the viewport corner. */
  inline?: boolean;
  className?: string;
  style?: CSSProperties;
}

const SWEEP_MS = 260;

export default function LightBeamNotification({
  riveSrc, open, variant = 'info', title, message, onClose,
  autoCloseMs = 0, inline, className, style,
}: LightBeamNotificationProps) {
  useBeamStyles();
  const rive = useRiveSlot(riveSrc);
  const [mounted, setMounted] = useState(open);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (open) { setLeaving(false); setMounted(true); return; }
    if (!mounted) return;
    setLeaving(true);
    const t = setTimeout(() => { setMounted(false); setLeaving(false); }, SWEEP_MS + 120);
    return () => clearTimeout(t);
  }, [open, mounted]);

  useEffect(() => {
    if (!open || !autoCloseMs || !onClose) return;
    const t = setTimeout(onClose, autoCloseMs);
    return () => clearTimeout(t);
  }, [open, autoCloseMs, onClose]);

  if (!mounted) return null;

  const v = beamVariants[variant];
  const accent = v.body;

  return (
    <div
      role='status'
      aria-live='polite'
      className={className}
      style={{
        position: inline ? 'relative' : 'fixed',
        right: inline ? undefined : 20,
        bottom: inline ? undefined : 20,
        zIndex: inline ? undefined : 90,
        width: inline ? '100%' : 'min(360px, calc(100vw - 40px))',
        ...style,
      }}
    >
      {/* The beam runs ahead of the card. */}
      <div style={{ position: 'relative', height: 2, overflow: 'hidden', borderRadius: 999, background: 'transparent' }}>
        {rive.active ? (
          <rive.Rive src={riveSrc} style={{ position: 'absolute', inset: 0 }} />
        ) : (
          <div
            data-lb-anim='toast-beam'
            style={{
              position: 'absolute', inset: 0,
              background: beamGradient({ core: v.core, body: v.body, trail: v.trail, bodyWidth: 90, trailWidth: 36, angle: leaving ? 90 : 270 }),
              boxShadow: beamGlow(accent, 12),
              animation: 'lb-beamTravel ' + SWEEP_MS + 'ms linear 1 both',
              transform: leaving ? undefined : 'scaleX(-1)',
              willChange: 'transform, opacity',
            }}
          />
        )}
      </div>

      <div
        data-lb-anim='toast-card'
        style={{
          marginTop: 6, padding: '12px 14px', borderRadius: radii.lg,
          background: colors.bgSurface,
          border: '1px solid ' + tint(accent, 34),
          borderLeft: '2px solid ' + accent,
          color: colors.textPrimary,
          fontFamily: typography.fontSans,
          display: 'flex', alignItems: 'flex-start', gap: 10,
          animation: (leaving ? 'lb-cardFollowOut' : 'lb-cardFollowIn') + ' 220ms ease-out ' + (leaving ? '0ms' : String(SWEEP_MS - 90) + 'ms') + ' 1 both',
          willChange: 'transform, opacity',
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          {title ? (
            <div style={{ fontSize: typography.sm, fontWeight: typography.semibold, letterSpacing: typography.tight, color: accent, marginBottom: message ? 3 : 0 }}>{title}</div>
          ) : null}
          {message ? (
            <div style={{ fontSize: typography.sm, lineHeight: 1.5, color: colors.textSecondary }}>{message}</div>
          ) : null}
        </div>
        {onClose ? (
          <button
            type='button'
            onClick={onClose}
            aria-label='Dismiss'
            style={{ background: 'none', border: 'none', color: colors.textDim, cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0 }}
          >
            ×
          </button>
        ) : null}
      </div>
    </div>
  );
}
