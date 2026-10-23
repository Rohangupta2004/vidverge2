import React from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Info, X } from 'lucide-react';
import { COLORS, FONT, MOTION, RADIUS } from '../theme';

let nextId = 0;
function useStableId(prefix: string) {
  const ref = React.useRef('');
  if (!ref.current) ref.current = `${prefix}-${++nextId}`;
  return ref.current;
}

export function Field({ label, helper, error, required, children }: {
  label: string; helper?: string; error?: string; required?: boolean; children: React.ReactElement;
}) {
  const id = useStableId('vg-field');
  const descriptionId = `${id}-description`;
  return (
    <label htmlFor={id} style={{ display: 'flex', flexDirection: 'column', gap: 8, color: COLORS.text, fontFamily: FONT.body }}>
      <span style={{ fontSize: 14, lineHeight: '20px', fontWeight: 600 }}>
        {label}{required ? <span aria-hidden="true" style={{ color: COLORS.danger }}> *</span> : null}
      </span>
      {React.cloneElement(children, {
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': helper || error ? descriptionId : undefined,
        required,
      } as any)}
      {helper || error ? (
        <span id={descriptionId} style={{ fontSize: 12, lineHeight: '18px', color: error ? COLORS.danger : COLORS.muted }}>
          {error || helper}
        </span>
      ) : null}
    </label>
  );
}

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string; helper?: string; error?: string }>(
  function Select({ label, helper, error, style, children, id, ...props }, ref) {
    const generatedId = useStableId('vg-select');
    const selectId = id || generatedId;
    const descriptionId = `${selectId}-description`;
    const control = (
      <span style={{ position: 'relative', display: 'block' }}>
        <select ref={ref} id={selectId} aria-invalid={error ? true : undefined} aria-describedby={helper || error ? descriptionId : undefined} {...props} style={{ width: '100%', minHeight: 44, appearance: 'none', padding: '0 42px 0 12px', border: `1px solid ${error ? COLORS.danger : COLORS.controlBorder}`, borderRadius: RADIUS.sm, background: COLORS.bg, color: COLORS.text, font: `600 14px/20px ${FONT.body}`, ...style }}>
          {children}
        </select>
        <ChevronDown aria-hidden="true" size={16} style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: COLORS.muted, pointerEvents: 'none' }} />
      </span>
    );
    if (!label) return control;
    return <label htmlFor={selectId} style={{ display: 'flex', flexDirection: 'column', gap: 8, color: COLORS.text, fontFamily: FONT.body }}>
      <span style={{ fontSize: 14, lineHeight: '20px', fontWeight: 600 }}>{label}</span>
      {control}
      {helper || error ? <span id={descriptionId} style={{ fontSize: 12, lineHeight: '18px', color: error ? COLORS.danger : COLORS.muted }}>{error || helper}</span> : null}
    </label>;
  },
);

export interface TabItem { id: string; label: string; panel: React.ReactNode; disabled?: boolean }
export function Tabs({ items, value, onChange, label = 'Sections' }: { items: TabItem[]; value: string; onChange: (id: string) => void; label?: string }) {
  const refs = React.useRef<Array<HTMLButtonElement | null>>([]);
  function move(from: number, direction: 1 | -1) {
    let index = from;
    for (let count = 0; count < items.length; count += 1) {
      index = (index + direction + items.length) % items.length;
      if (!items[index].disabled) { onChange(items[index].id); refs.current[index]?.focus(); return; }
    }
  }
  const active = items.find((item) => item.id === value) || items[0];
  return (
    <div>
      <div role="tablist" aria-label={label} style={{ display: 'flex', gap: 4, overflowX: 'auto', borderBottom: `1px solid ${COLORS.border}` }}>
        {items.map((item, index) => {
          const selected = item.id === active?.id;
          return <button key={item.id} ref={(node) => { refs.current[index] = node; }} role="tab" aria-selected={selected} aria-controls={`${item.id}-panel`} id={`${item.id}-tab`} disabled={item.disabled} tabIndex={selected ? 0 : -1} onClick={() => onChange(item.id)} onKeyDown={(event) => {
            if (event.key === 'ArrowRight') { event.preventDefault(); move(index, 1); }
            if (event.key === 'ArrowLeft') { event.preventDefault(); move(index, -1); }
            if (event.key === 'Home') { event.preventDefault(); const first = items.findIndex((entry) => !entry.disabled); if (first >= 0) { onChange(items[first].id); refs.current[first]?.focus(); } }
            if (event.key === 'End') { event.preventDefault(); const last = items.map((entry, i) => entry.disabled ? -1 : i).filter((i) => i >= 0).pop(); if (last != null) { onChange(items[last].id); refs.current[last]?.focus(); } }
          }} style={{ minHeight: 44, padding: '0 14px', border: 0, borderBottom: `2px solid ${selected ? COLORS.accent : 'transparent'}`, background: 'transparent', color: selected ? COLORS.text : COLORS.secondary, font: `600 14px/20px ${FONT.body}`, cursor: item.disabled ? 'not-allowed' : 'pointer' }}>{item.label}</button>;
        })}
      </div>
      {active ? <div role="tabpanel" id={`${active.id}-panel`} aria-labelledby={`${active.id}-tab`}>{active.panel}</div> : null}
    </div>
  );
}

export interface MenuItem { id: string; label: string; onSelect: () => void; destructive?: boolean; disabled?: boolean }
export function Menu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = React.useState(false);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const itemRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  React.useEffect(() => { if (open) requestAnimationFrame(() => itemRefs.current.find(Boolean)?.focus()); }, [open]);
  function close() { setOpen(false); requestAnimationFrame(() => buttonRef.current?.focus()); }
  return <div style={{ position: 'relative', display: 'inline-block' }}>
    <button ref={buttonRef} type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)} style={{ minHeight: 44, border: `1px solid ${COLORS.controlBorder}`, borderRadius: RADIUS.sm, background: COLORS.surface, color: COLORS.text, padding: '0 12px', fontWeight: 600 }}>{label}</button>
    {open ? <div role="menu" onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); close(); } }} style={{ position: 'absolute', zIndex: 40, top: 'calc(100% + 8px)', right: 0, minWidth: 200, padding: 6, border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.sm, background: COLORS.raised, boxShadow: '0 18px 48px rgba(0,0,0,.52)' }}>
      {items.map((item, index) => <button key={item.id} ref={(node) => { itemRefs.current[index] = node; }} role="menuitem" disabled={item.disabled} onClick={() => { item.onSelect(); close(); }} onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const direction = event.key === 'ArrowDown' ? 1 : -1; let next = index; do { next = (next + direction + items.length) % items.length; } while (items[next].disabled && next !== index); itemRefs.current[next]?.focus(); }
      }} style={{ display: 'block', width: '100%', minHeight: 44, padding: '8px 10px', border: 0, borderRadius: 8, background: 'transparent', color: item.destructive ? COLORS.danger : COLORS.text, textAlign: 'left', fontWeight: 600 }}>{item.label}</button>)}
    </div> : null}
  </div>;
}

function Overlay({ open, title, description, onClose, side, children, footer }: { open: boolean; title: string; description?: string; onClose: () => void; side?: boolean; children: React.ReactNode; footer?: React.ReactNode }) {
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const returnRef = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    if (!open) return;
    returnRef.current = document.activeElement as HTMLElement;
    const panel = panelRef.current;
    requestAnimationFrame(() => panel?.querySelector<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')?.focus());
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab' || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled),[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); returnRef.current?.focus(); };
  }, [open, onClose]);
  if (!open) return null;
  return <div role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} style={{ position: 'fixed', inset: 0, zIndex: 90, display: 'flex', alignItems: side ? 'stretch' : 'center', justifyContent: side ? 'flex-end' : 'center', padding: side ? 0 : 16, background: 'rgba(13,14,16,.76)' }}>
    <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="vg-overlay-title" aria-describedby={description ? 'vg-overlay-description' : undefined} style={{ width: side ? 'min(420px, 100vw)' : 'min(560px, 100%)', maxHeight: side ? '100%' : 'min(760px, calc(100vh - 32px))', overflowY: 'auto', padding: 24, border: `1px solid ${COLORS.border}`, borderRadius: side ? '16px 0 0 16px' : 16, background: COLORS.raised, boxShadow: '0 18px 48px rgba(0,0,0,.52)', animation: `fadeIn ${MOTION.overlay}` }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 24 }}><span><h2 id="vg-overlay-title" style={{ margin: 0, color: COLORS.text, font: `500 20px/28px ${FONT.heading}`, letterSpacing: '-.02em' }}>{title}</h2>{description ? <p id="vg-overlay-description" style={{ margin: '8px 0 0', color: COLORS.secondary, font: `400 14px/20px ${FONT.body}` }}>{description}</p> : null}</span><button type="button" onClick={onClose} aria-label={`Close ${title}`} title="Close" style={{ width: 44, height: 44, border: 0, borderRadius: 10, background: 'transparent', color: COLORS.secondary }}><X size={20} /></button></header>
      <div>{children}</div>{footer ? <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>{footer}</footer> : null}
    </div>
  </div>;
}
export function Dialog(props: Omit<React.ComponentProps<typeof Overlay>, 'side'>) { return <Overlay {...props} />; }
export function Drawer(props: Omit<React.ComponentProps<typeof Overlay>, 'side'>) { return <Overlay {...props} side />; }

export function Toast({ tone = 'info', children, onDismiss }: { tone?: 'success' | 'warning' | 'danger' | 'info'; children: React.ReactNode; onDismiss?: () => void }) {
  const colors = tone === 'success' ? [COLORS.success, COLORS.successBg] : tone === 'warning' ? [COLORS.warning, COLORS.warningBg] : tone === 'danger' ? [COLORS.danger, COLORS.dangerBg] : [COLORS.info, COLORS.infoBg];
  const ToneIcon = tone === 'success' ? CheckCircle2 : tone === 'info' ? Info : AlertTriangle;
  return <div role={tone === 'danger' ? 'alert' : 'status'} aria-live={tone === 'danger' ? 'assertive' : 'polite'} style={{ display: 'flex', alignItems: 'center', gap: 10, maxWidth: 420, padding: '12px 14px', border: `1px solid ${colors[0]}`, borderRadius: 10, background: colors[1], color: colors[0], boxShadow: '0 18px 48px rgba(0,0,0,.52)' }}><ToneIcon aria-hidden="true" size={16} /><span style={{ flex: 1, color: COLORS.text, font: `500 14px/20px ${FONT.body}` }}>{children}</span>{onDismiss ? <button type="button" onClick={onDismiss} aria-label="Dismiss notification" title="Dismiss" style={{ width: 44, height: 44, border: 0, background: 'transparent', color: colors[0] }}><X size={16} /></button> : null}</div>;
}

export function Skeleton({ width = '100%', height = 20, radius = 6, label = 'Loading' }: { width?: number | string; height?: number; radius?: number; label?: string }) {
  return <span role="status" aria-label={label} style={{ display: 'block', width, height, borderRadius: radius, background: `linear-gradient(90deg, ${COLORS.surface} 25%, ${COLORS.hover} 50%, ${COLORS.surface} 75%)`, backgroundSize: '200% 100%', animation: 'vgSkeleton 1.4s linear infinite' }}><style>{'@keyframes vgSkeleton{from{background-position:200% 0}to{background-position:-200% 0}}'}</style></span>;
}

export default { Field, Select, Tabs, Menu, Dialog, Drawer, Toast, Skeleton };
