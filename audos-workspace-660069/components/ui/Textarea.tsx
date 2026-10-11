import React from 'react';
import { COLORS, RADIUS } from '../theme';

/** Dark textarea with an amber focus ring and an optional character counter. */

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
  /** Show a `used / max` counter under the field. */
  showCount?: boolean;
  mono?: boolean;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    { label, hint, error, showCount = false, mono = false, style, onFocus, onBlur, ...rest },
    ref,
  ) {
    const [focus, setFocus] = React.useState(false);
    const length = String(rest.value == null ? '' : rest.value).length;

    return (
      <label style={{ display: 'block', width: '100%', fontFamily: "'Inter', system-ui, sans-serif" }}>
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
        <textarea
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
            minHeight: 120,
            padding: '12px 14px',
            background: COLORS.bg,
            color: COLORS.text,
            fontSize: 14,
            lineHeight: 1.6,
            fontFamily: mono
              ? "'JetBrains Mono', 'Fira Code', monospace"
              : "'Inter', system-ui, sans-serif",
            border:
              '1px solid ' +
              (error ? 'rgba(239,68,68,0.5)' : focus ? COLORS.borderHover : COLORS.border),
            borderRadius: RADIUS.md,
            outline: 'none',
            resize: 'vertical',
            boxShadow: focus ? '0 0 0 3px rgba(245,158,11,0.18)' : 'none',
            transition: 'border-color 150ms ease, box-shadow 180ms ease',
            ...style,
          }}
        />
        {error || hint || showCount ? (
          <span
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              marginTop: 6,
              fontSize: 12,
              color: error ? '#fca5a5' : COLORS.textFaint,
            }}
          >
            <span>{error || hint}</span>
            {showCount ? (
              <span style={{ fontVariantNumeric: 'tabular-nums', flex: '0 0 auto' }}>
                {length}
                {rest.maxLength ? ' / ' + rest.maxLength : ''} chars
              </span>
            ) : null}
          </span>
        ) : null}
      </label>
    );
  },
);

export default Textarea;
