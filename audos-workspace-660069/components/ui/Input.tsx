import React from 'react';
import { COLORS, RADIUS } from '../theme';

/** Dark input with an amber focus ring. Optional label and hint. */

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  block?: boolean;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, block = true, style, onFocus, onBlur, ...rest },
  ref,
) {
  const [focus, setFocus] = React.useState(false);

  return (
    <label
      style={{
        display: block ? 'block' : 'inline-block',
        width: block ? '100%' : undefined,
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      {label ? (
        <span
          style={{
            display: 'block',
            marginBottom: 6,
            fontSize: 11.5,
            fontWeight: 600,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
            color: COLORS.textMuted,
          }}
        >
          {label}
        </span>
      ) : null}
      <input
        ref={ref}
        onFocus={function handleFocus(e) {
          setFocus(true);
          if (onFocus) onFocus(e);
        }}
        onBlur={function handleBlur(e) {
          setFocus(false);
          if (onBlur) onBlur(e);
        }}
        {...rest}
        style={{
          width: '100%',
          height: 42,
          padding: '0 14px',
          background: COLORS.bg,
          color: COLORS.text,
          fontSize: 14,
          fontFamily: "'Inter', system-ui, sans-serif",
          border:
            '1px solid ' +
            (error ? 'rgba(239,68,68,0.5)' : focus ? COLORS.borderHover : COLORS.border),
          borderRadius: RADIUS.md,
          outline: 'none',
          boxShadow: focus ? '0 0 0 3px rgba(245,158,11,0.18)' : 'none',
          transition: 'border-color 150ms ease, box-shadow 180ms ease',
          ...style,
        }}
      />
      {error || hint ? (
        <span
          style={{
            display: 'block',
            marginTop: 6,
            fontSize: 12,
            color: error ? '#fca5a5' : COLORS.textFaint,
          }}
        >
          {error || hint}
        </span>
      ) : null}
    </label>
  );
});

export default Input;
