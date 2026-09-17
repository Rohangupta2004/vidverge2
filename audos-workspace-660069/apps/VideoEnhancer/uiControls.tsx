/**
 * Video Enhancer — shared UI primitives for the control panels.
 * Styled entirely with --space-* tokens so the app inherits the VidVerge brand.
 */
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export const card: CSSProperties = {
  background: 'var(--space-surface-card)',
  border: '1px solid var(--space-border-default)',
  borderRadius: 16,
  padding: 16,
};

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      onClick={() => onChange(!on)}
      style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--space-text-secondary)', fontSize: 13 }}
    >
      <span style={{
        width: 34, height: 20, borderRadius: 999, position: 'relative', transition: 'background 0.15s',
        background: on ? 'var(--space-brand-primary-600)' : 'var(--space-surface-panel-strong)',
        border: '1px solid var(--space-border-default)', flexShrink: 0,
      }}>
        <span style={{ position: 'absolute', top: 2, left: on ? 16 : 2, width: 14, height: 14, borderRadius: 999, background: '#fff', transition: 'left 0.15s' }} />
      </span>
      {label}
    </button>
  );
}

/** Collapsible section with a smooth grid-rows transition (no janky re-renders). */
export function Section({ title, icon, right, defaultOpen = false, children }: {
  title: string; icon?: ReactNode; right?: ReactNode; defaultOpen?: boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ background: 'var(--space-surface-panel)', border: '1px solid var(--space-border-default)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px' }}>
        <button
          onClick={() => setOpen((o) => !o)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--space-text-primary)', textAlign: 'left' }}
        >
          <ChevronDown size={15} style={{ color: 'var(--space-text-muted)', transition: 'transform 0.18s', transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', flexShrink: 0 }} />
          {icon}
          <span style={{ fontSize: 13, fontWeight: 700 }}>{title}</span>
        </button>
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
export function Slider({ label, value, min, max, step = 1, unit = '', onBegin, onChange, format }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string;
  onBegin?: () => void; onChange: (v: number) => void; format?: (v: number) => string;
}) {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--space-text-secondary)' }}>{label}</span>
        <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', color: 'var(--space-text-brand)', fontWeight: 700 }}>
          {format ? format(value) : value + unit}
        </span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step} value={value}
        onPointerDown={() => onBegin?.()}
        onKeyDown={(e) => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) onBegin?.(); }}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--space-brand-primary-500)', cursor: 'pointer', marginTop: 4 }}
      />
    </div>
  );
}

export function ColorField({ label, value, onBegin, onChange }: {
  label: string; value: string; onBegin?: () => void; onChange: (v: string) => void;
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600, color: 'var(--space-text-secondary)', cursor: 'pointer' }}>
      <input
        type="color"
        value={value}
        onFocus={() => onBegin?.()}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: 30, height: 24, border: '1px solid var(--space-border-default)', borderRadius: 6, background: 'transparent', padding: 0, cursor: 'pointer' }}
      />
      {label}
    </label>
  );
}

export function SelectField({ label, value, options, onChange }: {
  label: string; value: string | number; options: { id: string | number; label: string }[]; onChange: (v: string) => void;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600, color: 'var(--space-text-secondary)', minWidth: 0 }}>
      {label}
      <select
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        className="ve-input"
        style={{ fontSize: 12.5, background: 'var(--space-surface-card)', border: '1px solid var(--space-border-default)', borderRadius: 8, padding: '6px 8px', color: 'var(--space-text-primary)', cursor: 'pointer', maxWidth: '100%' }}
      >
        {options.map((o) => <option key={String(o.id)} value={String(o.id)}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function Chip({ active, onClick, title, children }: {
  active: boolean; onClick: () => void; title?: string; children: ReactNode;
}) {
  return (
    <button onClick={onClick} title={title} className="ve-btn" style={{
      fontSize: 12, fontWeight: 600, padding: '6px 11px', borderRadius: 999, cursor: 'pointer',
      border: '1px solid ' + (active ? 'var(--space-brand-primary-500)' : 'var(--space-border-default)'),
      background: active ? 'color-mix(in srgb, var(--space-brand-primary-500) 18%, transparent)' : 'var(--space-surface-panel)',
      color: active ? 'var(--space-text-brand)' : 'var(--space-text-secondary)',
    }}>{children}</button>
  );
}

export function NumField({ label, value, min, max, step = 0.1, width = 64, onChange }: {
  label?: string; value: number; min?: number; max?: number; step?: number; width?: number; onChange: (v: number) => void;
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--space-text-secondary)' }}>
      {label}
      <input
        type="number" value={value} min={min} max={max} step={step}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="ve-input"
        style={{ width, fontSize: 12, background: 'var(--space-surface-card)', border: '1px solid var(--space-border-default)', borderRadius: 6, padding: '4px 6px', color: 'var(--space-text-primary)' }}
      />
    </label>
  );
}
