/**
 * BRAND REEL — the small set of primitives every step is built from.
 *
 * These deliberately take a BrandTheme rather than reading LightBeam tokens:
 * once a client's site has been scraped, the whole flow re-skins to THEIR
 * accent. Before that happens the caller passes the VidVerge default theme, so
 * the intake screen still looks like the rest of the studio.
 */
import type { CSSProperties, ReactNode } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { BrandTheme } from './types';

export const REEL_CSS = `
@keyframes br-spin { to { transform: rotate(360deg); } }
@keyframes br-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
@keyframes br-pulse { 0%, 100% { opacity: 0.45; } 50% { opacity: 1; } }
.br-spin { animation: br-spin 0.9s linear infinite; }
.br-rise { animation: br-rise 260ms ease both; }
.br-btn { transition: filter 140ms ease, background 140ms ease, border-color 140ms ease, opacity 140ms ease; cursor: pointer; }
.br-btn:hover:not(:disabled) { filter: brightness(1.12); }
.br-btn:disabled { opacity: 0.5; cursor: not-allowed; filter: none; }
.br-input { transition: border-color 140ms ease, box-shadow 140ms ease; outline: none; }
.br-card { transition: border-color 160ms ease, transform 160ms ease; }
.br-scroll::-webkit-scrollbar { width: 9px; height: 9px; }
.br-scroll::-webkit-scrollbar-track { background: transparent; }
.br-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.16); border-radius: 6px; }
.br-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.28); }
.br-columns { display: flex; gap: 16px; overflow-x: auto; padding-bottom: 14px; scroll-snap-type: x proximity; }
.br-columns > * { scroll-snap-align: start; }
.br-grid-2 { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 18px; }
@media (max-width: 860px) {
  .br-grid-2 { grid-template-columns: minmax(0, 1fr); }
  .br-columns > * { min-width: min(84vw, 320px) !important; }
  .br-mockup-row { flex-direction: column !important; }
  .br-mockup-row > * { width: 100% !important; }
}
@media (prefers-reduced-motion: reduce) {
  .br-rise, .br-spin, .br-pulse { animation: none !important; }
}
`;

export function Spinner({ color, size = 15 }: { color: string; size?: number }) {
  return <Loader2 className="br-spin" size={size} style={{ color, flexShrink: 0 }} />;
}

export function Card({
  theme, children, style, accentEdge = false, className,
}: {
  theme: BrandTheme;
  children: ReactNode;
  style?: CSSProperties;
  accentEdge?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`br-card ${className || ''}`}
      style={{
        background: theme.surface,
        border: accentEdge ? theme.borderStrong : theme.border,
        borderRadius: 16,
        padding: 18,
        boxSizing: 'border-box',
        minWidth: 0,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function SectionLabel({ theme, children }: { theme: BrandTheme; children: ReactNode }) {
  return (
    <div style={{ color: theme.textMuted, fontSize: 10.5, fontWeight: 800, letterSpacing: 1.1, textTransform: 'uppercase' }}>
      {children}
    </div>
  );
}

export function Pill({ theme, children, tone = 'accent' }: { theme: BrandTheme; children: ReactNode; tone?: 'accent' | 'quiet' }) {
  const accent = tone === 'accent';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        borderRadius: 999,
        padding: '3px 10px',
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: 'nowrap',
        color: accent ? theme.primary : theme.textMuted,
        background: accent ? theme.primarySoft : 'rgba(255,255,255,0.05)',
        border: accent ? theme.borderStrong : '1px solid rgba(255,255,255,0.1)',
      }}
    >
      {children}
    </span>
  );
}

export function PrimaryButton({
  theme, children, onClick, disabled, busy, style, testId, title,
}: {
  theme: BrandTheme;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  style?: CSSProperties;
  testId?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      className="br-btn"
      onClick={onClick}
      disabled={disabled || busy}
      data-testid={testId}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: '11px 22px',
        borderRadius: 11,
        border: 'none',
        background: theme.primary,
        color: theme.onPrimary,
        fontSize: 13.5,
        fontWeight: 800,
        ...style,
      }}
    >
      {busy ? <Spinner color={theme.onPrimary} /> : null}
      {children}
    </button>
  );
}

export function GhostButton({
  theme, children, onClick, disabled, style, testId, title,
}: {
  theme: BrandTheme;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  style?: CSSProperties;
  testId?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      className="br-btn"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        padding: '9px 16px',
        borderRadius: 11,
        border: '1px solid rgba(255,255,255,0.14)',
        background: 'rgba(255,255,255,0.05)',
        color: theme.textMuted,
        fontSize: 12.5,
        fontWeight: 700,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function TextField({
  theme, label, value, onChange, placeholder, multiline, rows = 3, maxLength, testId,
}: {
  theme: BrandTheme;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  maxLength?: number;
  testId?: string;
}) {
  const shared: CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    background: 'rgba(0,0,0,0.28)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 10,
    color: theme.text,
    fontSize: 13,
    lineHeight: 1.5,
    padding: '9px 12px',
    fontFamily: 'inherit',
  };
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', color: theme.textMuted, fontSize: 10.5, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>
        {label}
      </span>
      {multiline ? (
        <textarea
          className="br-input"
          value={value}
          rows={rows}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          data-testid={testId}
          style={{ ...shared, resize: 'vertical' }}
        />
      ) : (
        <input
          className="br-input"
          type="text"
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          data-testid={testId}
          style={shared}
        />
      )}
    </label>
  );
}

export function ErrorNote({ theme, message, onRetry }: { theme: BrandTheme; message: string; onRetry?: () => void }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="br-rise"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        border: '1px solid rgba(248,113,113,0.45)',
        background: 'rgba(248,113,113,0.1)',
        borderRadius: 12,
        padding: '11px 14px',
        color: '#fca5a5',
        fontSize: 12.5,
        lineHeight: 1.5,
      }}
    >
      <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
      <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>{message}</span>
      {onRetry ? (
        <button
          type="button"
          className="br-btn"
          onClick={onRetry}
          style={{ background: 'none', border: 'none', color: theme.primary, fontWeight: 800, fontSize: 12.5, padding: 0, whiteSpace: 'nowrap' }}
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function StepRail({
  theme, steps, current,
}: {
  theme: BrandTheme;
  steps: string[];
  current: number;
}) {
  return (
    <ol style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', listStyle: 'none', margin: 0, padding: 0 }}>
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                padding: '5px 12px',
                borderRadius: 999,
                fontSize: 11.5,
                fontWeight: 700,
                whiteSpace: 'nowrap',
                color: active ? theme.onPrimary : done ? theme.primary : theme.textMuted,
                background: active ? theme.primary : done ? theme.primarySoft : 'rgba(255,255,255,0.04)',
                border: active || done ? theme.borderStrong : '1px solid rgba(255,255,255,0.08)',
              }}
            >
              <span style={{ opacity: 0.75, fontVariantNumeric: 'tabular-nums' }}>{i + 1}</span>
              {label}
            </span>
            {i < steps.length - 1 ? <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 12 }}>→</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

/** A tiny swatch + hex, used wherever a scraped colour is shown or edited. */
export function ColourField({
  theme, label, value, onChange,
}: {
  theme: BrandTheme;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', color: theme.textMuted, fontSize: 10.5, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>
        {label}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#2563eb'}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} colour picker`}
          style={{ width: 38, height: 34, padding: 0, border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, background: 'transparent', cursor: 'pointer', flexShrink: 0 }}
        />
        <input
          className="br-input"
          type="text"
          value={value}
          maxLength={7}
          onChange={(e) => onChange(e.target.value)}
          style={{
            flex: 1,
            minWidth: 0,
            background: 'rgba(0,0,0,0.28)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 10,
            color: theme.text,
            fontSize: 12.5,
            padding: '9px 12px',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}
        />
      </span>
    </label>
  );
}
