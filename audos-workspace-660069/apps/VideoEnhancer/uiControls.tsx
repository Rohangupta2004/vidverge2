/**
 * Video Enhancer — shared UI primitives for the control panels.
 *
 * Styled with --space-* tokens so the app inherits the VidVerge brand, and
 * sized so every interactive element clears a 44px thumb target.
 *
 * TOOLTIPS: each primitive can take an explicit `help` string, but it will
 * also look its own label up in the glossary below. That is deliberate — the
 * effects sidebar and the inspectors between them render several hundred
 * controls, and routing the plain-language explanation through the primitive
 * means every one of them gets a “?” without the call sites repeating copy.
 * Glossary entries are capped at twelve words on purpose.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

/** Minimum thumb target for anything you can tap. */
export const TAP = 44;

export const card: CSSProperties = {
  background: 'var(--space-surface-card)',
  border: '1px solid var(--space-border-default)',
  borderRadius: 16,
  padding: 16,
};

// ---------------------------------------------------------------------------
// Plain-language glossary
// ---------------------------------------------------------------------------

const GLOSSARY: [RegExp, string][] = [
  [/camera shake/i, 'Adds natural handheld movement to make your video feel alive'],
  [/speed ramp|ramp/i, 'Speeds up then slows down inside one shot for drama'],
  [/zoom (cut|punch)|match cut/i, 'Jumps the framing closer on a cut for emphasis'],
  [/start speed/i, 'How fast the shot plays when it begins'],
  [/mid speed/i, 'How fast the shot plays in the middle'],
  [/end speed/i, 'How fast the shot plays as it finishes'],
  [/frequency/i, 'How quickly the movement wobbles — subtle, medium or intense'],
  [/tolerance/i, 'How much of the screen colour counts as background'],
  [/softness/i, 'Softens the cut-out edge so it blends in naturally'],
  [/spill/i, 'Removes green light bouncing off your subject'],
  [/feather/i, 'Blurs the mask edge so the shape is not harsh'],
  [/invert/i, 'Flips the mask: hide the inside instead of the outside'],
  [/shape (left|top|right|bottom)/i, 'Moves one edge of the mask shape'],
  [/burn/i, 'Bakes captions into the video instead of a separate file'],
  [/words per line|max words/i, 'How many words appear on screen at once'],
  [/uppercase/i, 'Shows every caption in capital letters'],
  [/italic/i, 'Slants the caption text'],
  [/outline width|outline/i, 'Dark edge around text so it reads on any shot'],
  [/shadow/i, 'Soft dark glow behind text for readability'],
  [/background opacity/i, 'How solid the plate behind the caption looks'],
  [/duck/i, 'Quietens your main audio while the cutaway plays'],
  [/mute/i, 'Silences this clip but keeps the picture'],
  [/fade in/i, 'Eases the sound up instead of starting abruptly'],
  [/fade out/i, 'Eases the sound or picture away at the end'],
  [/reverse/i, 'Plays this clip backwards'],
  [/brightness/i, 'Makes the picture lighter or darker'],
  [/contrast/i, 'Separates darks from lights for more punch'],
  [/saturation/i, 'How vivid the colours look'],
  [/volume/i, 'How loud this sounds in the finished video'],
  [/opacity/i, 'How see-through this layer is'],
  [/radius|corner/i, 'Rounds the corners of the small inset picture'],
  [/crop/i, 'Trims the edges off the frame'],
  [/track|follow/i, 'Makes this layer follow your subject automatically'],
  [/glow|rays/i, 'Adds a soft light bloom around the text'],
  [/light leak|leak/i, 'Sweeps a warm film-style light across the frame'],
  [/vhs/i, 'Adds retro videotape noise and scanlines'],
  [/glitch/i, 'Tears and offsets the picture for a digital look'],
  [/displace|heat|underwater|liquid/i, 'Ripples the picture like heat haze or water'],
  [/grain/i, 'Adds fine film texture over the whole picture'],
  [/vignette/i, 'Darkens the corners to pull the eye inward'],
  [/bloom|halation/i, 'Softens the bright areas with a gentle halo'],
  [/flare/i, 'Adds a cinematic streak of light across the shot'],
  [/^in \(s\)|^start/i, 'The second this begins on your timeline'],
  [/^out \(s\)|^end/i, 'The second this stops on your timeline'],
  [/font/i, 'The typeface used for the words on screen'],
  [/position/i, 'Where it sits on the screen'],
  [/animation/i, 'How the words arrive on screen'],
  [/aspect|format/i, 'The shape of your video: tall, square or wide'],
  [/resolution/i, 'How many pixels the finished file has'],
  [/intensity|strength|amount/i, 'How strong the effect is — start low, build up'],
  [/speed/i, 'How fast this clip plays back'],
  [/scale|size/i, 'How big it appears on screen'],
  [/colou?r/i, 'The colour used for this element'],
];

/** The plain-language line for a control label, or '' when we have none. */
export function helpFor(label: string): string {
  const text = String(label || '').trim();
  if (!text) return '';
  for (const [pattern, copy] of GLOSSARY) {
    if (pattern.test(text)) return copy;
  }
  return '';
}

// ---------------------------------------------------------------------------
// The “?” tooltip
// ---------------------------------------------------------------------------

/**
 * A “?” that explains a control in plain language on hover, focus or tap.
 *
 * The bubble is rendered with position: fixed from the button's measured
 * rectangle rather than absolutely inside it, because several of the panels
 * that host these controls clip their overflow for the open/close transition
 * and would otherwise cut the tooltip in half.
 */
export function HelpTip({ text }: { text: string }) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);

  const show = useCallback(() => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setAt({ top: rect.top, left: rect.left + rect.width / 2 });
  }, []);
  const hide = useCallback(() => setAt(null), []);

  useEffect(() => {
    if (!at) return undefined;
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [at, hide]);

  if (!text) return null;

  const clampedLeft = at
    ? Math.min(Math.max(at.left, 130), (typeof window === 'undefined' ? 1200 : window.innerWidth) - 130)
    : 0;

  return (
    <span style={{ position: 'relative', display: 'inline-flex', width: 18, height: 18, flexShrink: 0, verticalAlign: 'middle' }}>
      <button
        ref={ref}
        type="button"
        aria-label={text}
        title={text}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (at) hide(); else show(); }}
        style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          width: TAP, height: TAP, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: 'transparent', border: 'none', padding: 0, cursor: 'help',
        }}
      >
        <span
          aria-hidden
          style={{
            width: 17, height: 17, borderRadius: 999, lineHeight: 1,
            border: '1px solid rgba(180,120,0,0.28)', color: '#7A6030',
            fontSize: 11, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          ?
        </span>
      </button>
      {at ? (
        <span
          role="tooltip"
          style={{
            position: 'fixed', top: at.top - 10, left: clampedLeft, transform: 'translate(-50%, -100%)',
            zIndex: 2000, maxWidth: 250, padding: '8px 11px', borderRadius: 10,
            background: '#FFFFFF', border: '1px solid rgba(180,120,0,0.14)', color: '#1A1000',
            fontSize: 12.5, lineHeight: 1.5, fontWeight: 500, pointerEvents: 'none',
            boxShadow: '0 12px 30px rgba(120,80,0,0.16)', textAlign: 'left',
            fontFamily: "'Inter', system-ui, sans-serif",
          }}
        >
          {text}
        </span>
      ) : null}
    </span>
  );
}

/** Label + its “?”, used by every primitive below. */
function LabelWithHelp({ label, help, style }: { label: ReactNode; help?: string; style?: CSSProperties }) {
  const copy = help === undefined ? helpFor(typeof label === 'string' ? label : '') : help;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 0, ...style }}>
      <span style={{ minWidth: 0 }}>{label}</span>
      {copy ? <HelpTip text={copy} /> : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

export function Toggle({ on, onChange, label, help }: {
  on: boolean; onChange: (v: boolean) => void; label: string; help?: string;
}) {
  const copy = help === undefined ? helpFor(label) : help;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <button
        onClick={() => onChange(!on)}
        className="ve-btn"
        role="switch"
        aria-checked={on}
        style={{
          display: 'flex', alignItems: 'center', gap: 9, background: 'transparent', border: 'none',
          cursor: 'pointer', padding: '2px 0', minHeight: TAP, textAlign: 'left',
          color: 'var(--space-text-secondary)', fontSize: 13,
        }}
      >
        <span style={{
          width: 38, height: 22, borderRadius: 999, position: 'relative', transition: 'background 0.15s',
          background: on ? 'var(--space-brand-primary-600)' : 'var(--space-surface-panel-strong)',
          border: '1px solid var(--space-border-default)', flexShrink: 0,
        }}>
          <span style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 16, height: 16, borderRadius: 999, background: on ? '#FFFFFF' : '#C8920A', transition: 'left 0.15s' }} />
        </span>
        {label}
      </button>
      {copy ? <HelpTip text={copy} /> : null}
    </span>
  );
}

/** Collapsible section with a smooth grid-rows transition (no janky re-renders). */
export function Section({ title, icon, right, help, defaultOpen = false, children }: {
  title: string; icon?: ReactNode; right?: ReactNode; help?: string; defaultOpen?: boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ background: 'var(--space-surface-panel)', border: '1px solid var(--space-border-default)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px' }}>
        <button
          onClick={() => setOpen((o) => !o)}
          className="ve-btn"
          aria-expanded={open}
          style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, minHeight: TAP, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--space-text-primary)', textAlign: 'left' }}
        >
          <ChevronDown size={15} style={{ color: 'var(--space-text-muted)', transition: 'transform 0.18s', transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', flexShrink: 0 }} />
          {icon}
          <span style={{ fontSize: 13, fontWeight: 700 }}>{title}</span>
        </button>
        {help ? <HelpTip text={help} /> : null}
        {right}
      </div>
      <div style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', transition: 'grid-template-rows 0.22s ease' }}>
        <div style={{ overflow: 'hidden' }}>
          <div style={{ padding: '2px 12px 12px' }}>{children}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * Slider with its live value shown numerically. `onBegin` fires once at the
 * start of an interaction so the app can push ONE undo checkpoint per drag.
 */
export function Slider({ label, value, min, max, step = 1, unit = '', help, onBegin, onChange, format }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string; help?: string;
  onBegin?: () => void; onChange: (v: number) => void; format?: (v: number) => string;
}) {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <LabelWithHelp
          label={label}
          help={help}
          style={{ fontSize: 12, fontWeight: 600, color: 'var(--space-text-secondary)' }}
        />
        <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', color: 'var(--space-text-brand)', fontWeight: 700 }}>
          {format ? format(value) : value + unit}
        </span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step} value={value}
        aria-label={label}
        onPointerDown={() => onBegin?.()}
        onKeyDown={(e) => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) onBegin?.(); }}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', height: 32, accentColor: 'var(--space-brand-primary-500)', cursor: 'pointer', marginTop: 0 }}
      />
    </div>
  );
}

export function ColorField({ label, value, help, onBegin, onChange }: {
  label: string; value: string; help?: string; onBegin?: () => void; onChange: (v: string) => void;
}) {
  const copy = help === undefined ? helpFor(label) : help;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: TAP, fontSize: 12, fontWeight: 600, color: 'var(--space-text-secondary)', cursor: 'pointer' }}>
        <input
          type="color"
          value={value}
          aria-label={label}
          onFocus={() => onBegin?.()}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: 34, height: 28, border: '1px solid var(--space-border-default)', borderRadius: 6, background: 'transparent', padding: 0, cursor: 'pointer' }}
        />
        {label}
      </label>
      {copy ? <HelpTip text={copy} /> : null}
    </span>
  );
}

export function SelectField({ label, value, options, help, onChange }: {
  label: string; value: string | number; options: { id: string | number; label: string }[]; help?: string;
  onChange: (v: string) => void;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600, color: 'var(--space-text-secondary)', minWidth: 0 }}>
      <LabelWithHelp label={label} help={help} />
      <select
        value={String(value)}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        className="ve-input"
        style={{ fontSize: 13, minHeight: TAP, background: 'var(--space-surface-card)', border: '1px solid var(--space-border-default)', borderRadius: 8, padding: '6px 10px', color: 'var(--space-text-primary)', cursor: 'pointer', maxWidth: '100%' }}
      >
        {options.map((o) => <option key={String(o.id)} value={String(o.id)}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function Chip({ active, onClick, title, children }: {
  active: boolean; onClick: () => void; title?: string; children: ReactNode;
}) {
  const copy = title || (typeof children === 'string' ? helpFor(children) : '');
  return (
    <button onClick={onClick} title={copy || undefined} className="ve-btn" style={{
      fontSize: 12.5, fontWeight: 600, padding: '0 14px', minHeight: TAP, borderRadius: 999, cursor: 'pointer',
      border: '1px solid ' + (active ? 'var(--space-brand-primary-500)' : 'var(--space-border-default)'),
      background: active ? 'color-mix(in srgb, var(--space-brand-primary-500) 18%, transparent)' : 'var(--space-surface-panel)',
      color: active ? 'var(--space-text-brand)' : 'var(--space-text-secondary)',
    }}>{children}</button>
  );
}

export function NumField({ label, value, min, max, step = 0.1, width = 72, help, onChange }: {
  label?: string; value: number; min?: number; max?: number; step?: number; width?: number; help?: string;
  onChange: (v: number) => void;
}) {
  const copy = help === undefined ? helpFor(label || '') : help;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: TAP, fontSize: 12, fontWeight: 600, color: 'var(--space-text-secondary)' }}>
        {label}
        <input
          type="number" value={value} min={min} max={max} step={step}
          aria-label={label}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
          className="ve-input"
          style={{ width, minHeight: 36, fontSize: 13, background: 'var(--space-surface-card)', border: '1px solid var(--space-border-default)', borderRadius: 6, padding: '4px 8px', color: 'var(--space-text-primary)' }}
        />
      </label>
      {copy ? <HelpTip text={copy} /> : null}
    </span>
  );
}
