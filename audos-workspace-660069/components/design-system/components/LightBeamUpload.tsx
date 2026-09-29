/**
 * LightBeamUpload — the drop zone.
 *
 * The zone itself is still. Once a file is taken, a beam travels FROM the
 * drop zone TOWARD the processing core: downward in a vertical layout, left
 * to right in a horizontal one. When the upload lands, LightBeamSuccess
 * plays at the core.
 *
 * File handling stays with the caller — this component only reports the
 * picked File, so existing upload, validation and job-creation flows are
 * untouched.
 */
import { useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { colors, tint } from '../tokens/colors';
import { radii } from '../tokens/radii';
import { microLabel, typography } from '../tokens/typography';
import { beamGradient, beamGlow } from '../animations/beamKeyframes';
import { useBeamStyles, useRiveSlot } from '../animations/useBeamAnimation';
import LightBeamSuccess from './LightBeamSuccess';

export interface LightBeamUploadProps {
  riveSrc?: string;
  state?: 'idle' | 'processing' | 'complete' | 'error';
  progress?: number;
  label?: string;
  hint?: ReactNode;
  accept?: string;
  orientation?: 'vertical' | 'horizontal';
  /** Icon or badge rendered at the processing core the light travels toward. */
  coreIcon?: ReactNode;
  /** Extra content inside the zone (format chips, tool list). */
  children?: ReactNode;
  onFile?: (file: File) => void;
  disabled?: boolean;
  minHeight?: number;
  className?: string;
  style?: CSSProperties;
  testId?: string;
}

export default function LightBeamUpload({
  riveSrc, state = 'idle', label = 'Drop your footage here, or click to choose',
  hint, accept = 'video/mp4,video/webm,video/quicktime', orientation = 'vertical',
  coreIcon, children, onFile, disabled, minHeight = 340, className, style, testId,
}: LightBeamUploadProps) {
  useBeamStyles();
  const rive = useRiveSlot(riveSrc);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [over, setOver] = useState(false);
  const vertical = orientation === 'vertical';
  const travelling = state === 'processing';

  const take = (file: File | null | undefined) => { if (file && !disabled) onFile?.(file); };

  return (
    <div className={className} style={{ width: '100%', ...style }}>
      <div
        data-testid={testId}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files?.[0]); }}
        onClick={() => { if (!disabled) inputRef.current?.click(); }}
        role='button'
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); } }}
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 14, minHeight, padding: '36px 28px', textAlign: 'center',
          borderRadius: radii.xl,
          border: '1px dashed ' + (over ? colors.borderBeam : colors.borderSubtle),
          background: over ? tint(colors.beamPrimary, 5) : colors.bgGlass,
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'border-color 0.2s ease, background 0.2s ease',
        }}
      >
        <div style={{ ...microLabel, color: colors.beamPrimary }}>Source</div>
        <div style={{ fontFamily: typography.fontSans, fontSize: typography.lg, fontWeight: typography.semibold, letterSpacing: typography.tight, color: colors.textPrimary }}>
          {label}
        </div>
        {hint ? (
          <div style={{ fontSize: typography.sm, lineHeight: 1.55, color: colors.textSecondary, maxWidth: 480 }}>{hint}</div>
        ) : null}
        {children}
        <input
          ref={inputRef}
          type='file'
          accept={accept}
          style={{ display: 'none' }}
          onClick={(e) => { e.stopPropagation(); }}
          onChange={(e) => { take(e.target.files?.[0]); e.currentTarget.value = ''; }}
        />
      </div>

      {/* The path from the zone to the processing core. */}
      {state !== 'idle' ? (
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: vertical ? 'column' : 'row', gap: 12, marginTop: 14,
          }}
        >
          <div
            style={{
              position: 'relative', overflow: 'hidden',
              width: vertical ? 1 : '100%', height: vertical ? 56 : 1,
              flex: vertical ? undefined : 1,
              background: colors.bgSurface,
            }}
          >
            {rive.active ? (
              <rive.Rive src={riveSrc} style={{ position: 'absolute', inset: 0 }} />
            ) : travelling ? (
              <div
                data-lb-anim='upload-path'
                style={{
                  position: 'absolute', inset: 0,
                  background: beamGradient({ bodyWidth: 26, trailWidth: 12, angle: vertical ? 180 : 90 }),
                  boxShadow: beamGlow(colors.beamPrimary, 8),
                  animation: 'lb-beamTravel' + (vertical ? 'Y' : '') + ' 1.1s linear infinite',
                  willChange: 'transform, opacity',
                }}
              />
            ) : null}
          </div>

          {state === 'complete' ? (
            <LightBeamSuccess size={38} style={{ minHeight: 48 }} />
          ) : (
            <div
              style={{
                width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '1px solid ' + (state === 'error' ? tint(colors.error, 45) : colors.borderActive),
                background: state === 'error' ? tint(colors.error, 8) : tint(colors.beamPrimary, 8),
                color: state === 'error' ? colors.error : colors.beamPrimary,
              }}
            >
              {coreIcon}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
