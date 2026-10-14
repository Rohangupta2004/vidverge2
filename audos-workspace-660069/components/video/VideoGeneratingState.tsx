import React from 'react';
import { COLORS, RADIUS, SHADOW, alpha } from '../theme';

/**
 * The loading state every video studio shows while a render is in flight.
 *
 * Two modes, picked by whether the caller actually knows how far along the
 * job is:
 *  · `progress` supplied → a real determinate bar.
 *  · `progress` omitted → an indeterminate sweep, because a fake percentage
 *    that stalls at 90% is worse than no percentage at all.
 *
 * The spinner and the sweep both run off keyframes injected by
 * components/ui/GlobalStyles.tsx (`spin`, `vvIndeterminate`), so nothing here
 * depends on a CSS pipeline.
 */

export interface VideoGeneratingStateProps {
  /** Headline, e.g. "Rendering scene 3". */
  label?: string;
  /** The step underway, e.g. "Veo 3.1 Fast · 8s clip". */
  detail?: string;
  /** 0–100. Omit for an indeterminate sweep. */
  progress?: number;
  /** Seconds elapsed, shown so a long render does not read as a hang. */
  elapsedSeconds?: number;
  onCancel?: () => void;
  compact?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

function formatElapsed(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return mins > 0 ? `${mins}m ${String(secs).padStart(2, '0')}s` : `${secs}s`;
}

const VideoGeneratingState: React.FC<VideoGeneratingStateProps> = function VideoGeneratingState({
  label = 'Generating your video',
  detail,
  progress,
  elapsedSeconds,
  onCancel,
  compact = false,
  className,
  style,
}) {
  const determinate = typeof progress === 'number' && Number.isFinite(progress);
  const pct = determinate ? Math.max(0, Math.min(100, progress as number)) : 0;

  return (
    <div
      className={className}
      role="status"
      aria-live="polite"
      style={{
        padding: compact ? 16 : 24,
        borderRadius: RADIUS.md,
        background: COLORS.surface,
        border: '1px solid ' + COLORS.border,
        boxShadow: SHADOW.card,
        fontFamily: "'Inter', system-ui, sans-serif",
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 12 : 16 }}>
        <span
          aria-hidden="true"
          style={{
            flex: '0 0 auto',
            width: compact ? 22 : 28,
            height: compact ? 22 : 28,
            borderRadius: '50%',
            border: '2.5px solid ' + alpha(COLORS.primary, 0.22),
            borderTopColor: COLORS.primary,
            animation: 'spin 0.85s linear infinite',
          }}
        />

        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: compact ? 13.5 : 15,
              fontWeight: 700,
              letterSpacing: '-0.01em',
              color: COLORS.text,
            }}
          >
            {label}
          </div>
          {(detail || typeof elapsedSeconds === 'number') && (
            <div
              style={{
                marginTop: 3,
                fontSize: 12.5,
                color: COLORS.textMuted,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {detail}
              {detail && typeof elapsedSeconds === 'number' ? '  ·  ' : ''}
              {typeof elapsedSeconds === 'number' ? formatElapsed(elapsedSeconds) : ''}
            </div>
          )}
        </div>

        {determinate && (
          <span
            style={{
              flex: '0 0 auto',
              fontSize: 13,
              fontWeight: 700,
              color: COLORS.primaryGlow,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {Math.round(pct)}%
          </span>
        )}

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            style={{
              flex: '0 0 auto',
              padding: '7px 14px',
              borderRadius: RADIUS.sm,
              border: '1px solid ' + COLORS.border,
              background: COLORS.buttonSecondary,
              color: COLORS.textMuted,
              fontSize: 12.5,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Cancel
          </button>
        )}
      </div>

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={determinate ? Math.round(pct) : undefined}
        style={{
          position: 'relative',
          marginTop: compact ? 12 : 16,
          height: 4,
          borderRadius: 2,
          background: alpha(COLORS.primary, 0.14),
          overflow: 'hidden',
        }}
      >
        {determinate ? (
          <div
            style={{
              height: '100%',
              width: pct + '%',
              borderRadius: 2,
              background: 'linear-gradient(90deg, ' + COLORS.primary + ' 0%, ' + COLORS.accentGlow + ' 100%)',
              transition: 'width 400ms ease-out',
            }}
          />
        ) : (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              width: '33%',
              borderRadius: 2,
              background: 'linear-gradient(90deg, ' + COLORS.primary + ' 0%, ' + COLORS.accentGlow + ' 100%)',
              animation: 'vvIndeterminate 1.4s ease-in-out infinite',
            }}
          />
        )}
      </div>
    </div>
  );
};

export default VideoGeneratingState;
