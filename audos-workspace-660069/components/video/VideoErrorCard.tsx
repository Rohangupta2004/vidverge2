import React from 'react';
import { COLORS, RADIUS, SHADOW, alpha } from '../theme';
import { describeVideoFailure, type VideoFailure } from '../../lib/videoErrors';

/**
 * The card every video studio shows when a generation fails.
 *
 * It exists so a failed render reads as a handled outcome with a way forward
 * rather than a raw error dump: a headline, one or two sentences of plain
 * English, the working models worth trying instead, and a Retry button when
 * retrying can actually help.
 *
 * Pass either a `failure` you already built with describeVideoFailure(), or
 * the raw `error` you caught and let the card describe it.
 */

export interface VideoErrorCardProps {
  /** Raw thing from the catch block. Ignored when `failure` is supplied. */
  error?: unknown;
  /** Pre-described failure, when the caller already needed the fields. */
  failure?: VideoFailure;
  /** Model id the failed request used — sharpens the message and the suggestions. */
  engineId?: string | null;
  /** What was being rendered, e.g. "scene 3". */
  subject?: string;
  onRetry?: () => void;
  /** Switch to one of the suggested working models. */
  onPickAlternative?: (engineId: string) => void;
  onDismiss?: () => void;
  compact?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

const VideoErrorCard: React.FC<VideoErrorCardProps> = function VideoErrorCard({
  error,
  failure,
  engineId,
  subject,
  onRetry,
  onPickAlternative,
  onDismiss,
  compact = false,
  className,
  style,
}) {
  const [showDetail, setShowDetail] = React.useState(false);
  const described = failure || describeVideoFailure(error, { engineId, subject });

  return (
    <div
      className={className}
      role="alert"
      style={{
        display: 'flex',
        gap: compact ? 12 : 16,
        alignItems: 'flex-start',
        padding: compact ? 16 : 24,
        borderRadius: RADIUS.md,
        background: COLORS.surface,
        border: '1px solid ' + alpha(COLORS.error, 0.35),
        boxShadow: SHADOW.card,
        fontFamily: "'Inter', system-ui, sans-serif",
        ...style,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          flex: '0 0 auto',
          width: compact ? 32 : 40,
          height: compact ? 32 : 40,
          borderRadius: RADIUS.sm,
          display: 'grid',
          placeItems: 'center',
          fontSize: compact ? 15 : 18,
          background: alpha(COLORS.error, 0.14),
        }}
      >
        {'\u274C'}
      </span>

      <div style={{ minWidth: 0, flex: 1 }}>
        <h3
          style={{
            margin: 0,
            fontSize: compact ? 14 : 16,
            fontWeight: 700,
            letterSpacing: '-0.01em',
            color: COLORS.text,
          }}
        >
          {described.title}
        </h3>

        <p
          style={{
            margin: '6px 0 0',
            fontSize: compact ? 12.5 : 13.5,
            lineHeight: 1.55,
            color: COLORS.textMuted,
          }}
        >
          {described.message}
        </p>

        {described.needsFounder && (
          <p
            style={{
              margin: '10px 0 0',
              fontSize: 12.5,
              lineHeight: 1.5,
              color: COLORS.warning,
            }}
          >
            This one needs the workspace owner — nothing here can clear it.
          </p>
        )}

        {/* Alternatives are offered as real buttons when the caller can switch
            model, and as plain text when it cannot. */}
        {described.alternatives.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14, alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.textFaint }}>
              Known working:
            </span>
            {described.alternatives.map((alt) =>
              onPickAlternative ? (
                <button
                  key={alt.id}
                  type="button"
                  onClick={() => onPickAlternative(alt.id)}
                  style={{
                    padding: '5px 11px',
                    borderRadius: RADIUS.sm,
                    border: '1px solid ' + alpha(COLORS.primary, 0.45),
                    background: alpha(COLORS.primary, 0.14),
                    color: COLORS.primaryGlow,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {alt.name}
                </button>
              ) : (
                <span
                  key={alt.id}
                  style={{
                    padding: '5px 11px',
                    borderRadius: RADIUS.sm,
                    border: '1px solid ' + COLORS.border,
                    background: COLORS.input,
                    color: COLORS.textMuted,
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  {alt.name}
                </span>
              ),
            )}
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16, alignItems: 'center' }}>
          {onRetry && described.canRetry && (
            <button
              type="button"
              onClick={onRetry}
              style={{
                padding: '9px 18px',
                borderRadius: RADIUS.sm,
                border: 'none',
                background: 'linear-gradient(135deg, ' + COLORS.primary + ' 0%, ' + COLORS.accentGlow + ' 100%)',
                color: '#ffffff',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {'\u21BB'} Retry
            </button>
          )}

          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              style={{
                padding: '9px 16px',
                borderRadius: RADIUS.sm,
                border: '1px solid ' + COLORS.border,
                background: COLORS.buttonSecondary,
                color: COLORS.text,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Dismiss
            </button>
          )}

          {described.detail && (
            <button
              type="button"
              onClick={() => setShowDetail((prev) => !prev)}
              style={{
                padding: '9px 4px',
                border: 'none',
                background: 'transparent',
                color: COLORS.textFaint,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
                textDecoration: 'underline',
              }}
            >
              {showDetail ? 'Hide technical details' : 'Technical details'}
            </button>
          )}
        </div>

        {showDetail && described.detail && (
          <pre
            style={{
              margin: '12px 0 0',
              padding: 12,
              borderRadius: RADIUS.sm,
              background: COLORS.bg,
              border: '1px solid ' + COLORS.border,
              color: COLORS.textMuted,
              fontSize: 11.5,
              lineHeight: 1.5,
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 180,
              overflow: 'auto',
            }}
          >
            {described.detail}
          </pre>
        )}
      </div>
    </div>
  );
};

export default VideoErrorCard;
