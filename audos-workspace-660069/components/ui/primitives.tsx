import React from 'react';
import { COLORS, FONT, GRADIENT, RADIUS } from '../theme';

/**
 * Secondary Vidverge primitives shared by more than one app: pipeline
 * steppers, stat chips, status dots, the CSS waveform, the drag-and-drop
 * upload zone and the 9:16 phone frame.
 *
 * Everything here is presentational — no fetches, no app state.
 */

/* ---------------------------------------------------------------- Stepper */

export interface StepperStep {
  label: string;
  hint?: string;
}

export interface StepperProps {
  steps: Array<StepperStep | string>;
  /** Zero-based index of the active step. */
  current: number;
  onStepClick?: (index: number) => void;
  style?: React.CSSProperties;
}

export const Stepper: React.FC<StepperProps> = function Stepper({
  steps,
  current,
  onStepClick,
  style,
}) {
  return (
    <ol
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 0,
        listStyle: 'none',
        margin: 0,
        padding: 0,
        flexWrap: 'wrap',
        ...style,
      }}
    >
      {steps.map(function renderStep(raw, i) {
        const step = typeof raw === 'string' ? { label: raw } : raw;
        const done = i < current;
        const active = i === current;
        const tint = done ? COLORS.success : active ? COLORS.primary : COLORS.textFaint;
        return (
          <li
            key={step.label + i}
            style={{ display: 'flex', alignItems: 'flex-start', flex: '1 1 110px', minWidth: 100 }}
          >
            <div
              onClick={onStepClick ? function click() { onStepClick(i); } : undefined}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 7,
                flex: '1 1 auto',
                cursor: onStepClick ? 'pointer' : 'default',
                textAlign: 'center',
              }}
            >
              <span
                style={{
                  width: 26,
                  height: 26,
                  display: 'grid',
                  placeItems: 'center',
                  borderRadius: '50%',
                  fontSize: 11.5,
                  fontWeight: 700,
                  color: active || done ? '#fff' : COLORS.textFaint,
                  background: done
                    ? 'rgba(16,185,129,0.9)'
                    : active
                      ? GRADIENT.brand
                      : 'rgba(212,146,10,0.08)',
                  border: '1px solid ' + (active || done ? 'transparent' : COLORS.border),
                  boxShadow: active ? '0 0 16px rgba(212,146,10,0.45)' : 'none',
                  animation: active ? 'pulse 2.4s ease-in-out infinite' : undefined,
                }}
              >
                {done ? '\u2713' : i + 1}
              </span>
              <span
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  letterSpacing: 0.3,
                  color: active ? COLORS.text : tint,
                  lineHeight: 1.35,
                }}
              >
                {step.label}
              </span>
              {step.hint ? (
                <span style={{ fontSize: 10.5, color: COLORS.textFaint }}>{step.hint}</span>
              ) : null}
            </div>
            {i < steps.length - 1 ? (
              <span
                aria-hidden="true"
                style={{
                  flex: '0 0 auto',
                  width: 18,
                  height: 2,
                  marginTop: 12,
                  borderRadius: 2,
                  background: done ? 'rgba(16,185,129,0.6)' : COLORS.border,
                }}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
};

/* ------------------------------------------------------------ ProgressBar */

export const ProgressBar: React.FC<{
  value: number;
  label?: string;
  style?: React.CSSProperties;
}> = function ProgressBar({ value, label, style }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div style={{ width: '100%', ...style }}>
      {label ? (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 11.5,
            color: COLORS.textMuted,
            marginBottom: 6,
          }}
        >
          <span>{label}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.round(pct)}%</span>
        </div>
      ) : null}
      <div
        style={{
          height: 6,
          borderRadius: 999,
          background: 'rgba(212,146,10,0.12)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: pct + '%',
            height: '100%',
            borderRadius: 999,
            background: GRADIENT.brand,
            boxShadow: '0 0 12px rgba(212,146,10,0.5)',
            transition: 'width 420ms ease',
          }}
        />
      </div>
    </div>
  );
};

/* --------------------------------------------------------------- StatChip */

export const StatChip: React.FC<{
  label: string;
  value: React.ReactNode;
  tone?: 'brand' | 'cyan' | 'muted';
  icon?: React.ReactNode;
  style?: React.CSSProperties;
}> = function StatChip({ label, value, tone = 'brand', icon, style }) {
  const fg =
    tone === 'cyan' ? COLORS.accentGlow : tone === 'muted' ? COLORS.textMuted : COLORS.primaryGlow;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: '8px 12px',
        background: 'rgba(212,146,10,0.06)',
        border: '1px solid ' + COLORS.border,
        borderRadius: RADIUS.sm,
        minWidth: 92,
        ...style,
      }}
    >
      {icon ? <span style={{ color: fg, display: 'flex' }}>{icon}</span> : null}
      <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
        <span
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: COLORS.text,
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1.2,
          }}
        >
          {value}
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: 0.8,
            textTransform: 'uppercase',
            color: COLORS.textFaint,
          }}
        >
          {label}
        </span>
      </span>
    </div>
  );
};

/* -------------------------------------------------------------- StatusDot */

export const StatusDot: React.FC<{
  state?: 'idle' | 'working' | 'done' | 'error';
  label?: string;
  style?: React.CSSProperties;
}> = function StatusDot({ state = 'idle', label, style }) {
  const color =
    state === 'working'
      ? COLORS.primary
      : state === 'done'
        ? COLORS.success
        : state === 'error'
          ? COLORS.error
          : COLORS.textFaint;
  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: COLORS.textMuted, ...style }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: color,
          boxShadow: '0 0 10px ' + color,
          animation: state === 'working' ? 'pulse 1.2s ease-in-out infinite' : undefined,
          flex: '0 0 auto',
        }}
      />
      {label}
    </span>
  );
};

/* --------------------------------------------------------------- Waveform */

export const Waveform: React.FC<{
  bars?: number;
  active?: boolean;
  height?: number;
  tone?: 'brand' | 'cyan';
  style?: React.CSSProperties;
}> = function Waveform({ bars = 40, active = true, height = 54, tone = 'brand', style }) {
  const items = [];
  for (let i = 0; i < bars; i += 1) items.push(i);
  const base = tone === 'cyan' ? COLORS.accentGlow : COLORS.primaryGlow;
  return (
    <div
      aria-hidden="true"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 3,
        height,
        ...style,
      }}
    >
      {items.map(function renderBar(i) {
        const seed = 0.35 + (Math.sin(i * 1.7) + 1) / 2 * 0.65;
        return (
          <span
            key={i}
            style={{
              width: 3,
              height: Math.round(height * seed),
              borderRadius: 2,
              background: 'linear-gradient(to top, ' + COLORS.primary + ', ' + base + ')',
              opacity: active ? 0.9 : 0.3,
              transformOrigin: 'center',
              animation: active
                ? 'vvWave ' + (0.7 + (i % 5) * 0.14).toFixed(2) + 's ease-in-out ' + (i * 0.045).toFixed(2) + 's infinite'
                : undefined,
            }}
          />
        );
      })}
    </div>
  );
};

/* ------------------------------------------------------------- UploadZone */

export interface UploadZoneProps {
  onFiles: (files: FileList) => void;
  accept?: string;
  multiple?: boolean;
  title?: string;
  hint?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

export const UploadZone: React.FC<UploadZoneProps> = function UploadZone({
  onFiles,
  accept,
  multiple = false,
  title = 'Drop a file here',
  hint = 'or click to browse',
  icon,
  disabled = false,
  style,
  children,
}) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [over, setOver] = React.useState(false);

  return (
    <div
      onClick={function openPicker() {
        if (!disabled && inputRef.current) inputRef.current.click();
      }}
      onDragOver={function dragOver(e) {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={function dragLeave() {
        setOver(false);
      }}
      onDrop={function drop(e) {
        e.preventDefault();
        setOver(false);
        if (disabled) return;
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
          onFiles(e.dataTransfer.files);
        }
      }}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        minHeight: 200,
        padding: 28,
        textAlign: 'center',
        borderRadius: RADIUS.lg,
        border: '2px dashed ' + (over ? COLORS.primaryGlow : COLORS.borderHover),
        background: over ? 'rgba(212,146,10,0.1)' : 'rgba(212,146,10,0.035)',
        boxShadow: over ? '0 0 32px rgba(212,146,10,0.3) inset' : 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        transition: 'border-color 160ms ease, background 160ms ease, box-shadow 200ms ease',
        ...style,
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        style={{ display: 'none' }}
        onChange={function change(e) {
          if (e.target.files && e.target.files.length) onFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <span style={{ color: COLORS.primaryGlow, display: 'flex' }}>
        {icon || (
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M4 15v2.5A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V15"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
          </svg>
        )}
      </span>
      <span style={{ fontFamily: FONT.heading, fontSize: 15, fontWeight: 600, color: COLORS.text }}>
        {title}
      </span>
      <span style={{ fontSize: 12.5, color: COLORS.textMuted }}>{hint}</span>
      {children}
    </div>
  );
};

/* ------------------------------------------------------------- PhoneFrame */

export const PhoneFrame: React.FC<{
  width?: number;
  label?: string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}> = function PhoneFrame({ width = 236, label, children, style }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, ...style }}>
      <div
        style={{
          position: 'relative',
          width,
          aspectRatio: '9 / 16',
          borderRadius: 28,
          border: '1px solid ' + COLORS.borderHover,
          background: COLORS.surface,
          boxShadow: '0 0 34px rgba(212,146,10,0.18), inset 0 0 40px rgba(6,182,212,0.05)',
          overflow: 'hidden',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 9,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 52,
            height: 4,
            borderRadius: 999,
            background: 'rgba(212,146,10,0.4)',
            zIndex: 2,
          }}
        />
        <div style={{ position: 'absolute', inset: 0 }}>{children}</div>
      </div>
      {label ? (
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            letterSpacing: 1,
            textTransform: 'uppercase',
            color: COLORS.textFaint,
          }}
        >
          {label}
        </span>
      ) : null}
    </div>
  );
};

/* ------------------------------------------------------------- EmptyState */

export const EmptyState: React.FC<{
  title: string;
  body?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  style?: React.CSSProperties;
}> = function EmptyState({ title, body, icon, action, style }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        padding: '42px 24px',
        textAlign: 'center',
        borderRadius: RADIUS.lg,
        border: '1px dashed ' + COLORS.border,
        background: 'rgba(212,146,10,0.03)',
        ...style,
      }}
    >
      {icon ? <span style={{ color: COLORS.primaryGlow, display: 'flex' }}>{icon}</span> : null}
      <span style={{ fontFamily: FONT.heading, fontSize: 15.5, fontWeight: 600, color: COLORS.text }}>
        {title}
      </span>
      {body ? (
        <span style={{ fontSize: 13, lineHeight: 1.6, color: COLORS.textMuted, maxWidth: 420 }}>
          {body}
        </span>
      ) : null}
      {action ? <span style={{ marginTop: 6 }}>{action}</span> : null}
    </div>
  );
};
