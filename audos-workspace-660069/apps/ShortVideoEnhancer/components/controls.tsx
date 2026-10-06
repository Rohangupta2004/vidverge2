/**
 * Short Video Enhancer — editor chrome and the small controls every panel uses.
 *
 * The palette is derived from the workspace theme tokens (--space-*) so the app
 * inherits VidVerge's brand without hardcoding a second palette; the track
 * colours are the only app-specific values, and they exist so the timeline is
 * readable at a glance.
 */

import { Eye, EyeOff, Lock, LockOpen, Trash2 } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';

export const P = {
  bg: 'var(--space-surface-bg, #06080E)',
  panel: 'var(--space-surface-panel, #0C1018)',
  panelSoft: 'var(--space-surface-muted, #11161F)',
  card: 'var(--space-surface-card, #0F141D)',
  strong: 'var(--space-surface-panel-strong, #161D2C)',
  border: 'var(--space-border-default, rgba(148,163,184,0.16))',
  borderStrong: 'var(--space-border-strong, rgba(148,163,184,0.28))',
  text: 'var(--space-text-primary, #EEF1F7)',
  sub: 'var(--space-text-secondary, #A8B2C6)',
  muted: 'var(--space-text-muted, #6E7892)',
  accent: 'var(--space-brand-primary-500, #F59E0B)',
  accentText: 'var(--space-text-on-primary, #180F02)',
  accentSoft: 'color-mix(in srgb, var(--space-brand-primary-500, #F59E0B) 15%, transparent)',
  accentEdge: 'color-mix(in srgb, var(--space-brand-primary-500, #F59E0B) 46%, transparent)',
  ok: 'var(--space-semantic-success-600, #4ADE80)',
  warn: '#FBBF24',
  bad: 'var(--space-semantic-danger-500, #EF4444)',
  // Track identities — the layer stack reads top to bottom in these colours.
  video: '#60A5FA',
  trans: '#F472B6',
  gfxBg: '#8B5CF6',
  gfxFg: '#A78BFA',
  caption: '#FBBF24',
  audio: '#34D399',
} as const;

export const MONO = "'JetBrains Mono', ui-monospace, monospace";

export function Panel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{
      background: P.panel,
      border: '1px solid ' + P.border,
      borderRadius: 14,
      overflow: 'hidden',
      ...style,
    }}>{children}</div>
  );
}

export function SectionHeader({ icon, label, color, right }: { icon?: ReactNode; label: string; color?: string; right?: ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '9px 12px',
      borderBottom: '1px solid ' + P.border,
      background: P.panelSoft,
      fontSize: 10.5, fontWeight: 800, letterSpacing: 1.1, textTransform: 'uppercase',
      color: color || P.sub,
    }}>
      {icon}
      <span style={{ flex: 1 }}>{label}</span>
      {right}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 11 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: P.muted }}>{label}</div>
      {children}
      {hint ? <div style={{ fontSize: 11, color: P.muted, lineHeight: 1.45 }}>{hint}</div> : null}
    </div>
  );
}

const inputStyle: CSSProperties = {
  width: '100%',
  background: P.card,
  border: '1px solid ' + P.border,
  borderRadius: 8,
  color: P.text,
  fontSize: 12.5,
  padding: '7px 9px',
  outline: 'none',
};

export function TextRow({ label, value, onChange, placeholder, hint }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <input style={inputStyle} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export function NumberRow({ label, value, min, max, step = 1, onChange, suffix, hint }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; suffix?: string; hint?: string;
}) {
  const safe = Number.isFinite(value) ? value : min;
  return (
    <Field label={label} hint={hint}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={safe}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ flex: 1, accentColor: 'var(--space-brand-primary-500, #F59E0B)' }}
        />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={safe}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ ...inputStyle, width: 74, fontFamily: MONO, fontSize: 11.5, padding: '5px 6px' }}
        />
        {suffix ? <span style={{ fontSize: 10.5, color: P.muted, width: 20 }}>{suffix}</span> : null}
      </div>
    </Field>
  );
}

export function RampRow({ label, from, to, min, max, step = 0.01, onChange, hint }: {
  label: string; from: number; to: number; min: number; max: number; step?: number;
  onChange: (ramp: { from: number; to: number }) => void; hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 10, color: P.muted, width: 26 }}>from</span>
        <input type="number" min={min} max={max} step={step} value={from}
          onChange={(e) => onChange({ from: Number(e.target.value), to })}
          style={{ ...inputStyle, fontFamily: MONO, fontSize: 11.5, padding: '5px 6px' }} />
        <span style={{ fontSize: 10, color: P.muted, width: 14 }}>to</span>
        <input type="number" min={min} max={max} step={step} value={to}
          onChange={(e) => onChange({ from, to: Number(e.target.value) })}
          style={{ ...inputStyle, fontFamily: MONO, fontSize: 11.5, padding: '5px 6px' }} />
      </div>
    </Field>
  );
}

export function SelectRow<T extends string>({ label, value, options, onChange, hint }: {
  label: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <select style={{ ...inputStyle, cursor: 'pointer' }} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </Field>
  );
}

export function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)}
          style={{ width: 38, height: 30, border: '1px solid ' + P.border, borderRadius: 7, background: P.card, cursor: 'pointer', padding: 2 }} />
        <input style={{ ...inputStyle, fontFamily: MONO, fontSize: 11.5 }} value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </Field>
  );
}

export function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <div style={{ marginBottom: 11 }}>
      <button
        onClick={() => onChange(!value)}
        style={{
          display: 'flex', alignItems: 'center', gap: 9, width: '100%',
          background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{
          width: 34, height: 19, borderRadius: 999, flexShrink: 0,
          background: value ? P.accent : 'rgba(148,163,184,0.26)',
          position: 'relative', transition: 'background 140ms',
        }}>
          <span style={{
            position: 'absolute', top: 2.5, left: value ? 17 : 2.5,
            width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left 140ms',
          }} />
        </span>
        <span style={{ fontSize: 12.5, color: P.text, fontWeight: 600 }}>{label}</span>
      </button>
      {hint ? <div style={{ fontSize: 11, color: P.muted, marginTop: 4, lineHeight: 1.45 }}>{hint}</div> : null}
    </div>
  );
}

export function Btn({ children, onClick, tone = 'ghost', disabled, title, style }: {
  children: ReactNode; onClick?: () => void; tone?: 'ghost' | 'primary' | 'danger' | 'soft';
  disabled?: boolean; title?: string; style?: CSSProperties;
}) {
  const tones: Record<string, CSSProperties> = {
    primary: { background: P.accent, color: P.accentText, border: '1px solid transparent', fontWeight: 800 },
    soft: { background: P.accentSoft, color: P.text, border: '1px solid ' + P.accentEdge, fontWeight: 700 },
    danger: { background: 'color-mix(in srgb, #EF4444 14%, transparent)', color: '#FCA5A5', border: '1px solid color-mix(in srgb, #EF4444 40%, transparent)', fontWeight: 700 },
    ghost: { background: P.card, color: P.sub, border: '1px solid ' + P.border, fontWeight: 600 },
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        padding: '7px 12px', borderRadius: 9, fontSize: 12, cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1, whiteSpace: 'nowrap', lineHeight: 1.2,
        ...tones[tone],
        ...style,
      }}
    >{children}</button>
  );
}

export function Pill({ children, color }: { children: ReactNode; color?: string }) {
  const c = color || P.accent;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase',
      padding: '3px 8px', borderRadius: 999,
      color: c,
      background: 'color-mix(in srgb, ' + c + ' 14%, transparent)',
      border: '1px solid color-mix(in srgb, ' + c + ' 38%, transparent)',
    }}>{children}</span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div style={{ padding: '14px 12px', fontSize: 11.5, color: P.muted, lineHeight: 1.5 }}>{children}</div>;
}

/**
 * Lock / show / delete, the three controls every layer row carries.
 *
 * The lock is the one that matters: it is the contract a preset switch, the
 * pacing engine and a stray timeline drag all have to honour, so it sits next
 * to the layer it protects rather than in a menu.
 */
export function LayerControls({ locked, enabled, onLock, onToggle, onDelete }: {
  locked: boolean; enabled: boolean;
  onLock?: () => void; onToggle?: () => void; onDelete?: () => void;
}) {
  const btn: CSSProperties = { background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, display: 'flex' };
  return (
    <>
      {onLock ? (
        <button title={locked ? 'Unlock — presets and the pacing engine may rewrite it again' : 'Lock — presets and the pacing engine will leave it alone'}
          onClick={(e) => { e.stopPropagation(); onLock(); }} style={{ ...btn, color: locked ? P.accent : P.muted }}>
          {locked ? <Lock size={12} /> : <LockOpen size={12} />}
        </button>
      ) : null}
      {onToggle ? (
        <button title={enabled ? 'Hide this layer' : 'Show this layer'}
          onClick={(e) => { e.stopPropagation(); onToggle(); }} style={{ ...btn, color: enabled ? P.sub : P.muted }}>
          {enabled ? <Eye size={13} /> : <EyeOff size={13} />}
        </button>
      ) : null}
      {onDelete ? (
        <button title="Delete this layer" onClick={(e) => { e.stopPropagation(); onDelete(); }} style={{ ...btn, color: P.muted }}>
          <Trash2 size={13} />
        </button>
      ) : null}
    </>
  );
}
