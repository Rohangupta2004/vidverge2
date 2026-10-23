import React from 'react';
import { COLORS, FONT, RADIUS } from '../theme';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string; hint?: string; error?: string; showCount?: boolean; mono?: boolean;
}
let textareaSequence = 0;
const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, showCount = false, mono = false, style, id, onFocus, onBlur, ...rest }, ref,
) {
  const generated = React.useRef('');
  if (!generated.current) generated.current = `vg-textarea-${++textareaSequence}`;
  const textareaId = id || generated.current;
  const descriptionId = `${textareaId}-description`;
  const [focus, setFocus] = React.useState(false);
  const length = String(rest.value == null ? '' : rest.value).length;
  return <label htmlFor={textareaId} style={{ display: 'block', width: '100%', fontFamily: FONT.body }}>
    {label ? <span style={{ display: 'block', marginBottom: 8, fontSize: 14, lineHeight: '20px', fontWeight: 600, color: COLORS.text }}>{label}</span> : null}
    <textarea
      ref={ref} id={textareaId} aria-invalid={error ? true : undefined}
      aria-describedby={error || hint || showCount ? descriptionId : undefined}
      onFocus={(event) => { setFocus(true); onFocus?.(event); }}
      onBlur={(event) => { setFocus(false); onBlur?.(event); }}
      {...rest}
      style={{ width: '100%', minHeight: 120, padding: 12, background: COLORS.bg, color: COLORS.text,
        fontSize: 14, lineHeight: '20px', fontFamily: mono ? FONT.mono : FONT.body,
        border: `1px solid ${error ? COLORS.danger : focus ? COLORS.focus : COLORS.controlBorder}`,
        borderRadius: RADIUS.sm, outline: 'none', resize: 'vertical',
        boxShadow: focus ? `0 0 0 2px ${COLORS.bg}, 0 0 0 4px ${COLORS.focus}` : 'none',
        transition: 'border-color 120ms cubic-bezier(.2,0,0,1)', ...style }}
    />
    {error || hint || showCount ? <span id={descriptionId} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 8, fontSize: 12, lineHeight: '18px', color: error ? COLORS.danger : COLORS.muted }}>
      <span>{error || hint}</span>
      {showCount ? <span style={{ fontVariantNumeric: 'tabular-nums', flex: '0 0 auto' }}>{length}{rest.maxLength ? ` / ${rest.maxLength}` : ''} chars</span> : null}
    </span> : null}
  </label>;
});
export default Textarea;
