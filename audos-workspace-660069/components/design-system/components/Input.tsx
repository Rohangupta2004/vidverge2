/**
 * Input — the shared LightBeam field.
 *
 * Dark glass on a hair-thin border. On focus the border goes gold, a soft
 * glow appears, and a single beam traces the field's border once. Nothing
 * animates while the field is idle.
 *
 * Renders a textarea when `rows` is set, so script boxes, ad briefs and URL
 * fields all share one component.
 */
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { colors, tint } from '../tokens/colors';
import { radii, radiiPx } from '../tokens/radii';
import { microLabel, typography } from '../tokens/typography';
import { useBeamStyles } from '../animations/useBeamAnimation';
import LightBeamBorder from './LightBeamBorder';

export interface InputProps {
  riveSrc?: string;
  value?: string;
  onChange?: (value: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  label?: string;
  hint?: ReactNode;
  error?: string;
  /** Set to render a textarea instead of a single-line input. */
  rows?: number;
  type?: 'text' | 'url' | 'email' | 'password' | 'number';
  mono?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  autoFocus?: boolean;
  /** Leading affordance (icon, prefix). */
  leading?: ReactNode;
  /** Trailing affordance (button, counter). */
  trailing?: ReactNode;
  className?: string;
  style?: CSSProperties;
  inputStyle?: CSSProperties;
  testId?: string;
  ariaLabel?: string;
}

export default function Input({
  riveSrc, value, onChange, onSubmit, placeholder, label, hint, error, rows, type = 'text',
  mono, disabled, readOnly, autoFocus, leading, trailing, className, style, inputStyle, testId, ariaLabel,
}: InputProps) {
  useBeamStyles();
  const [focused, setFocused] = useState(false);
  const [focusRun, setFocusRun] = useState(0);
  const multiline = typeof rows === 'number' && rows > 1;

  const fieldStyle: CSSProperties = {
    width: '100%', minWidth: 0, boxSizing: 'border-box',
    background: 'transparent', border: 'none', outline: 'none',
    color: colors.textPrimary,
    fontFamily: mono ? typography.fontMono : typography.fontSans,
    fontSize: typography.base,
    lineHeight: multiline ? 1.6 : 1.4,
    padding: 0,
    resize: multiline ? 'vertical' : undefined,
    ...inputStyle,
  };

  return (
    <div className={className} style={{ width: '100%', ...style }}>
      {label ? <span style={{ ...microLabel, color: focused ? colors.beamPrimary : colors.textSecondary, display: 'block', marginBottom: 7, transition: 'color 0.2s ease' }}>{label}</span> : null}

      <LightBeamBorder
        riveSrc={riveSrc}
        active={focused && !disabled}
        loop={false}
        runKey={focusRun}
        radius={radiiPx.md}
        state={error ? 'error' : undefined}
        showRestingBorder={false}
      >
        <div
          style={{
            display: 'flex', alignItems: multiline ? 'flex-start' : 'center', gap: 10,
            padding: multiline ? '12px 14px' : '10px 13px',
            borderRadius: radii.md,
            background: colors.bgGlass,
            border: '1px solid ' + (error ? tint(colors.error, 45) : focused ? colors.borderActive : colors.borderSubtle),
            boxShadow: focused && !error ? '0 0 0 3px ' + colors.beamGlow : 'none',
            opacity: disabled ? 0.5 : 1,
            transition: 'border-color 0.18s ease, box-shadow 0.18s ease',
          }}
        >
          {leading ? <span style={{ color: colors.textSecondary, display: 'flex', flexShrink: 0 }}>{leading}</span> : null}

          {multiline ? (
            <textarea
              data-testid={testId}
              aria-label={ariaLabel || label}
              rows={rows}
              value={value}
              placeholder={placeholder}
              disabled={disabled}
              readOnly={readOnly}
              autoFocus={autoFocus}
              onFocus={() => { setFocused(true); setFocusRun((n) => n + 1); }}
              onBlur={() => setFocused(false)}
              onChange={(e) => onChange?.(e.target.value)}
              style={fieldStyle}
            />
          ) : (
            <input
              data-testid={testId}
              aria-label={ariaLabel || label}
              type={type}
              value={value}
              placeholder={placeholder}
              disabled={disabled}
              readOnly={readOnly}
              autoFocus={autoFocus}
              onFocus={() => { setFocused(true); setFocusRun((n) => n + 1); }}
              onBlur={() => setFocused(false)}
              onChange={(e) => onChange?.(e.target.value)}
              onKeyDown={(e) => { if (onSubmit && e.key === 'Enter') { e.preventDefault(); onSubmit(); } }}
              style={fieldStyle}
            />
          )}

          {trailing ? <span style={{ display: 'flex', flexShrink: 0 }}>{trailing}</span> : null}
        </div>
      </LightBeamBorder>

      {error ? (
        <div style={{ fontSize: typography.xs, color: colors.error, marginTop: 6, lineHeight: 1.5 }}>{error}</div>
      ) : hint ? (
        <div style={{ fontSize: typography.xs, color: colors.textSecondary, marginTop: 6, lineHeight: 1.5 }}>{hint}</div>
      ) : null}
    </div>
  );
}
