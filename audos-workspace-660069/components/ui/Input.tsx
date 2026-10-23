import React from 'react';
import { COLORS, FONT, RADIUS } from '../theme';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  block?: boolean;
}

let inputSequence = 0;
const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, block = true, style, id, onFocus, onBlur, ...rest },
  ref,
) {
  const generated = React.useRef('');
  if (!generated.current) generated.current = `vg-input-${++inputSequence}`;
  const inputId = id || generated.current;
  const descriptionId = `${inputId}-description`;
  const [focus, setFocus] = React.useState(false);

  return (
    <label htmlFor={inputId} style={{ display: block ? 'block' : 'inline-block', width: block ? '100%' : undefined, fontFamily: FONT.body }}>
      {label ? <span style={{ display: 'block', marginBottom: 8, fontSize: 14, lineHeight: '20px', fontWeight: 600, color: COLORS.text }}>{label}</span> : null}
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? descriptionId : undefined}
        onFocus={(event) => { setFocus(true); onFocus?.(event); }}
        onBlur={(event) => { setFocus(false); onBlur?.(event); }}
        {...rest}
        style={{
          width: '100%', minHeight: 44, padding: '0 12px', background: COLORS.bg,
          color: COLORS.text, fontSize: 14, lineHeight: '20px', fontFamily: FONT.body,
          border: `1px solid ${error ? COLORS.danger : focus ? COLORS.focus : COLORS.controlBorder}`,
          borderRadius: RADIUS.sm, outline: 'none',
          boxShadow: focus ? `0 0 0 2px ${COLORS.bg}, 0 0 0 4px ${COLORS.focus}` : 'none',
          transition: 'border-color 120ms cubic-bezier(.2,0,0,1)', ...style,
        }}
      />
      {error || hint ? <span id={descriptionId} style={{ display: 'block', marginTop: 8, fontSize: 12, lineHeight: '18px', color: error ? COLORS.danger : COLORS.muted }}>{error || hint}</span> : null}
    </label>
  );
});

export default Input;
