/**
 * VERGEYE — the shared primitives every screen is built from.
 *
 * The accent lives in a context rather than being passed down through props,
 * because it changes once (when Screen 1 reads the customer's site) and then
 * has to reach every button, pill, ring and table header at once.
 */

import React, { createContext, useContext } from 'react';
import { AlertTriangle, Check, Info } from 'lucide-react';
import VergeLoader from '../../components/VergeLoader';
import {
  CARD, CARD_HI, DANGER, DEFAULT_ACCENT, INK_DEEP, LINE, LINE_HI, MONO, PANEL,
  SUCCESS, TEXT, TEXT_DIM, TEXT_MUTED, monogram, normalizeHex, readableOn, rgba, tileColor,
} from './theme';

const AccentContext = createContext(DEFAULT_ACCENT);

export function AccentProvider({ accent, children }: { accent: string; children: React.ReactNode }) {
  return <AccentContext.Provider value={normalizeHex(accent) || DEFAULT_ACCENT}>{children}</AccentContext.Provider>;
}

export function useAccent(): string {
  return useContext(AccentContext);
}

export function Spinner({
  size = 15, tone, label, caption,
}: { size?: number; tone?: 'amber' | 'ink'; label?: string; caption?: string }) {
  return <VergeLoader size={caption ? size : Math.round(size * 2.2)} tone={tone} label={label} caption={caption} />;
}

export function Panel({
  children, style, className, onClick,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div
      className={className}
      onClick={onClick}
      style={{
        background: CARD,
        border: `1px solid ${LINE}`,
        borderRadius: 18,
        cursor: onClick ? 'pointer' : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ children, hint, right }: { children: React.ReactNode; hint?: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, letterSpacing: 2.3, textTransform: 'uppercase', color: TEXT_MUTED, fontFamily: MONO }}>{children}</div>
        {hint ? <div style={{ fontSize: 13.2, color: TEXT_DIM, marginTop: 7, maxWidth: 760, lineHeight: 1.55 }}>{hint}</div> : null}
      </div>
      {right}
    </div>
  );
}

type ButtonVariant = 'primary' | 'ghost' | 'quiet' | 'danger';

export function Button({
  children, onClick, variant = 'ghost', busy, disabled, title, full, small, type = 'button',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  busy?: boolean;
  disabled?: boolean;
  title?: string;
  full?: boolean;
  small?: boolean;
  type?: 'button' | 'submit';
}) {
  const accent = useAccent();
  const inert = !!(disabled || busy);
  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: small ? '7px 13px' : '11px 19px',
    borderRadius: 12,
    fontSize: small ? 12.5 : 13.8,
    fontWeight: 650,
    fontFamily: 'inherit',
    cursor: inert ? 'not-allowed' : 'pointer',
    opacity: inert ? 0.55 : 1,
    width: full ? '100%' : undefined,
    whiteSpace: 'nowrap',
  };
  const skin: React.CSSProperties =
    variant === 'primary'
      ? { background: accent, color: readableOn(accent), border: `1px solid ${accent}` }
      : variant === 'danger'
        ? { background: rgba(DANGER, 0.12), color: DANGER, border: `1px solid ${rgba(DANGER, 0.34)}` }
        : variant === 'quiet'
          ? { background: 'transparent', color: TEXT_MUTED, border: '1px solid transparent' }
          : { background: CARD_HI, color: TEXT, border: `1px solid ${LINE_HI}` };

  return (
    <button type={type} title={title} onClick={inert ? undefined : onClick} disabled={inert} style={{ ...base, ...skin }}>
      {busy ? <Spinner size={14} tone={variant === 'primary' && !/^#?f{3}(f{3})?$/i.test(readableOn(accent)) ? 'ink' : 'amber'} /> : null}
      {children}
    </button>
  );
}

export function Field({
  label, value, onChange, placeholder, hint, rows, type = 'text', mono, onEnter,
}: {
  label?: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  hint?: string;
  rows?: number;
  type?: string;
  mono?: boolean;
  onEnter?: () => void;
}) {
  const accent = useAccent();
  const [focused, setFocused] = React.useState(false);
  const shared: React.CSSProperties = {
    width: '100%',
    background: INK_DEEP,
    border: `1px solid ${focused ? accent : LINE}`,
    boxShadow: focused ? `0 0 0 3px ${rgba(accent, 0.18)}` : 'none',
    borderRadius: 12,
    padding: '11px 14px',
    color: TEXT,
    fontSize: 13.6,
    fontFamily: mono ? MONO : 'inherit',
    lineHeight: 1.55,
    resize: 'vertical',
  };
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      {label ? <div style={{ fontSize: 11.5, color: TEXT_MUTED, marginBottom: 7, letterSpacing: 0.3 }}>{label}</div> : null}
      {rows ? (
        <textarea
          rows={rows}
          value={value}
          placeholder={placeholder}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => onChange(e.target.value)}
          style={shared}
        />
      ) : (
        <input
          type={type}
          value={value}
          placeholder={placeholder}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && onEnter) onEnter(); }}
          style={shared}
        />
      )}
      {hint ? <div style={{ fontSize: 11.5, color: TEXT_MUTED, marginTop: 6, lineHeight: 1.5 }}>{hint}</div> : null}
    </label>
  );
}

export type Tone = 'idle' | 'accent' | 'good' | 'bad' | 'warn';

function toneHex(tone: Tone, accent: string): string {
  if (tone === 'good') return SUCCESS;
  if (tone === 'bad') return DANGER;
  if (tone === 'warn') return '#B45309';
  if (tone === 'accent') return accent;
  return TEXT_MUTED;
}

export function Pill({ tone = 'idle', children }: { tone?: Tone; children: React.ReactNode }) {
  const color = toneHex(tone, useAccent());
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 11px', borderRadius: 999,
      fontSize: 11.2, fontWeight: 650, letterSpacing: 0.3,
      color, background: rgba(color, 0.13), border: `1px solid ${rgba(color, 0.34)}`,
      whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 999, background: color }} />
      {children}
    </span>
  );
}

export function Notice({ tone = 'idle', children }: { tone?: Tone; children: React.ReactNode }) {
  const color = toneHex(tone, useAccent());
  const Icon = tone === 'bad' ? AlertTriangle : tone === 'good' ? Check : Info;
  return (
    <div style={{
      display: 'flex', gap: 10, alignItems: 'flex-start',
      padding: '12px 15px', borderRadius: 13,
      background: rgba(color, 0.1), border: `1px solid ${rgba(color, 0.3)}`,
      color: TEXT_DIM, fontSize: 12.9, lineHeight: 1.58, marginBottom: 15,
    }}>
      <Icon size={15} style={{ color, flexShrink: 0, marginTop: 1 }} />
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: React.ReactNode; title: string; body: string; action?: React.ReactNode }) {
  const accent = useAccent();
  return (
    <Panel style={{ padding: '48px 32px', textAlign: 'center' }}>
      {icon ? <div style={{ color: accent, marginBottom: 15, display: 'flex', justifyContent: 'center' }}>{icon}</div> : null}
      <div style={{ fontSize: 17.5, fontWeight: 700, color: TEXT, marginBottom: 9 }}>{title}</div>
      <div style={{ fontSize: 13.4, color: TEXT_DIM, maxWidth: 520, margin: '0 auto 20px', lineHeight: 1.62 }}>{body}</div>
      {action}
    </Panel>
  );
}

/** The brand tile: the site's own icon when it has one, a monogram when it does not. */
export function BrandMark({ name, logoUrl, size = 40, radius = 12 }: { name: string; logoUrl?: string; size?: number; radius?: number }) {
  const [broken, setBroken] = React.useState(false);
  const showImage = !!logoUrl && !broken;
  const tile = tileColor(name);
  return (
    <div style={{
      width: size, height: size, borderRadius: radius, flexShrink: 0,
      background: showImage ? '#ffffff' : rgba(tile, 0.18),
      border: `1px solid ${showImage ? LINE : rgba(tile, 0.42)}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden',
    }}>
      {showImage ? (
        <img
          src={logoUrl}
          alt=""
          onError={() => setBroken(true)}
          style={{ width: '100%', height: '100%', objectFit: 'contain', padding: Math.round(size * 0.14) }}
        />
      ) : (
        <span style={{ fontSize: size * 0.38, fontWeight: 800, color: tile, letterSpacing: 0.4 }}>{monogram(name)}</span>
      )}
    </div>
  );
}

/** The progress breadcrumb across the top of every screen. */
export function Breadcrumb<T extends string>({
  steps, current, reachable, onJump,
}: {
  steps: Array<{ id: T; label: string }>;
  current: T;
  reachable: (id: T) => boolean;
  onJump: (id: T) => void;
}) {
  const accent = useAccent();
  const currentIndex = steps.findIndex((s) => s.id === current);
  return (
    <div className="vergeye-crumbs vergeye-scroll" style={{ display: 'flex', alignItems: 'center', gap: 4, paddingBottom: 2 }}>
      {steps.map((step, index) => {
        const active = step.id === current;
        const done = index < currentIndex;
        const open = reachable(step.id);
        const color = active ? readableOn(accent) : done ? accent : open ? TEXT_DIM : TEXT_MUTED;
        return (
          <React.Fragment key={step.id}>
            {index > 0 ? (
              <span style={{ width: 22, height: 1, flexShrink: 0, background: done || active ? rgba(accent, 0.5) : LINE }} />
            ) : null}
            <button
              type="button"
              disabled={!open}
              onClick={() => open && onJump(step.id)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0,
                padding: '7px 14px', borderRadius: 999,
                fontSize: 12.4, fontWeight: 650, fontFamily: 'inherit',
                cursor: open ? 'pointer' : 'not-allowed',
                color,
                background: active ? accent : done ? rgba(accent, 0.12) : 'transparent',
                border: `1px solid ${active ? accent : done ? rgba(accent, 0.32) : LINE}`,
                opacity: open ? 1 : 0.5,
              }}
            >
              <span style={{
                width: 18, height: 18, borderRadius: 999, flexShrink: 0,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10.5, fontWeight: 800, fontFamily: MONO,
                background: active ? rgba('#000000', 0.18) : done ? rgba(accent, 0.22) : rgba('#b47800', 0.1),
              }}>
                {done ? <Check size={11} /> : index + 1}
              </span>
              {step.label}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}

/** A plain-English progress feed. Long research steps need words, not a spinner. */
export function LogStream({ lines, busy }: { lines: string[]; busy?: boolean }) {
  const accent = useAccent();
  if (lines.length === 0) return null;
  return (
    <div className="vergeye-scroll" style={{
      fontFamily: MONO, fontSize: 11.8, lineHeight: 1.8,
      background: INK_DEEP, border: `1px solid ${LINE}`, borderRadius: 13,
      padding: '13px 15px', maxHeight: 190, overflowY: 'auto', color: TEXT_MUTED,
    }}>
      {lines.map((line, i) => {
        const last = i === lines.length - 1;
        return (
          <div key={`${i}-${line}`} style={{ color: last ? accent : TEXT_MUTED }}>
            <span style={{ opacity: 0.45 }}>{'> '}</span>
            {line}
            {last && busy ? <span className="vergeye-pulse"> …</span> : null}
          </div>
        );
      })}
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: Tone }) {
  const accent = useAccent();
  const color = tone ? toneHex(tone, accent) : TEXT;
  return (
    <div>
      <div style={{ fontSize: 10.2, letterSpacing: 1.5, textTransform: 'uppercase', color: TEXT_MUTED, fontFamily: MONO }}>{label}</div>
      <div style={{ fontSize: 21, fontWeight: 800, color, marginTop: 5, lineHeight: 1.1 }}>{value}</div>
    </div>
  );
}

/** A horizontal meter, used for the Veo render's own progress number. */
export function Meter({ percent }: { percent: number }) {
  const accent = useAccent();
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div style={{ height: 7, borderRadius: 999, background: PANEL, overflow: 'hidden', border: `1px solid ${LINE}` }}>
      <div style={{ width: `${value}%`, height: '100%', background: accent, transition: 'width 400ms ease' }} />
    </div>
  );
}
