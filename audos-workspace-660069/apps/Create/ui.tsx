/**
 * VidVerge Create — shared UI primitives.
 *
 * A minimal dark-mode design system (Linear / Vercel energy): one blue
 * accent, quiet hairline borders, generous spacing, no visual noise. Colors
 * read from the --space-* theme tokens (workspace-branding source of truth)
 * with the brand values as fallbacks, so a future rebrand at the source
 * flows through automatically.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { expandFieldText } from '../../lib/reelioStudio';
import { clearSeries, useFrameChain } from './frameChain';
import { DEFAULT_VIDEO_MODEL, getVideoModel } from './videoTypes';

export const FONT =
  "'Inter', 'Geist', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

export const T = {
  bg: 'var(--space-surface-bg, #0A0F1E)',
  card: 'var(--space-surface-card, #10182A)',
  panel: 'rgba(255,255,255,0.035)',
  panelHover: 'rgba(255,255,255,0.06)',
  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.18)',
  text: 'var(--space-text-primary, #f5f5f7)',
  sub: 'var(--space-text-secondary, #a1a1ab)',
  muted: 'var(--space-text-muted, #71717c)',
  accent: 'var(--space-brand-primary, #2563eb)',
  accentFg: '#93c5fd',
  accentSoft: 'rgba(37,99,235,0.12)',
  accentBorder: 'rgba(37,99,235,0.38)',
  success: 'var(--space-semantic-success, #4ade80)',
  danger: 'var(--space-semantic-danger, #f87171)',
} as const;

export const GLOBAL_CSS = `
@keyframes rcFadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
@keyframes rcFade { from { opacity: 0; } to { opacity: 1; } }
@keyframes rcSpin { to { transform: rotate(360deg); } }
@keyframes rcShimmer { 0% { background-position: -400px 0; } 100% { background-position: 400px 0; } }
@keyframes rcPulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
.rc-fade { animation: rcFadeUp 0.45s cubic-bezier(0.16, 1, 0.3, 1) both; }
.rc-spin { animation: rcSpin 0.9s linear infinite; }
.rc-pulse { animation: rcPulse 2.4s ease-in-out infinite; }
.rc-skeleton {
  background: linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.09) 50%, rgba(255,255,255,0.04) 75%);
  background-size: 800px 100%;
  animation: rcShimmer 1.4s linear infinite;
}
.rc-card { transition: border-color .18s ease, background .18s ease, transform .18s ease; }
.rc-card:hover { border-color: rgba(255,255,255,0.2) !important; background: rgba(255,255,255,0.055) !important; transform: translateY(-1px); }
.rc-btn { transition: filter .18s ease, transform .18s ease, opacity .18s ease, box-shadow .18s ease; }
.rc-btn:hover:not(:disabled) { filter: brightness(1.1); transform: translateY(-1px) scale(1.01); }
.rc-btn:disabled { cursor: not-allowed; }
.rc-ghost { transition: background .18s ease, color .18s ease, border-color .18s ease, transform .18s ease; }
.rc-ghost:hover:not(:disabled) { background: rgba(255,255,255,0.06); color: #fff; border-color: rgba(255,255,255,0.24); transform: translateY(-1px); }
.rc-input { transition: border-color .18s ease, background .18s ease, box-shadow .18s ease; }
.rc-input:focus { border-color: rgba(59,130,246,0.72) !important; background: rgba(255,255,255,0.05) !important; box-shadow: 0 0 0 3px rgba(59,130,246,0.18); }
.rc-input-error { border-color: rgba(248,113,113,0.72) !important; box-shadow: 0 0 0 3px rgba(248,113,113,0.10); }
.rc-iconbtn { transition: background .18s ease, color .18s ease, transform .18s ease; }
.rc-iconbtn:hover:not(:disabled) { background: rgba(255,255,255,0.1); color: #fff; transform: scale(1.04); }
.rc-iconbtn:active:not(:disabled), .rc-ghost:active:not(:disabled), .rc-quiet:active:not(:disabled) { transform: scale(0.98); }
.rc-result-enter { animation: rcFadeUp .26s ease both; }
.rc-interactive-row { transition: background .18s ease, border-color .18s ease; }
.rc-interactive-row:hover { background: rgba(255,255,255,0.052) !important; }
.rc-responsive-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); gap: 16px; }
.rc-mobile-scroll { display: grid; grid-template-columns: repeat(auto-fit, minmax(104px, 1fr)); gap: 12px; }
.rc-mobile-actions { display: flex; gap: 12px; flex-wrap: wrap; }
.rc-field-action input { padding-right: 52px !important; }
.rc-btn:focus-visible, .rc-ghost:focus-visible, .rc-iconbtn:focus-visible, .rc-quiet:focus-visible,
.rc-input:focus-visible, .rc-hero-input:focus-visible, .rc-sparkle:focus-visible, .rc-ring:focus-visible {
  outline: 2px solid rgba(96,165,250,0.95);
  outline-offset: 3px;
}
@media (max-width: 480px) { .rc-step-label { display: none; } .rc-step-label-active { display: inline; } }
.rc-drag-over { outline: 2px dashed rgba(37,99,235,0.6); outline-offset: 2px; }

/* ---- The redesigned studio: one hero input, generous air, no chrome ---- */
.rc-hero-input {
  transition: border-color .2s ease, background .2s ease, box-shadow .2s ease;
}
.rc-hero-input::placeholder { color: rgba(255,255,255,0.28); }
.rc-hero-input:focus {
  border-color: rgba(59,130,246,0.75) !important;
  background: rgba(255,255,255,0.055) !important;
  box-shadow: 0 0 0 4px rgba(37,99,235,0.16), 0 18px 50px -20px rgba(37,99,235,0.65) !important;
}
.rc-quiet {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 500;
  color: rgba(255,255,255,0.42);
  transition: color .15s ease;
}
.rc-quiet:hover { color: rgba(255,255,255,0.86); }
.rc-lift { transition: transform .18s ease, border-color .18s ease, background .18s ease; }
.rc-lift:hover { transform: translateY(-1px); border-color: rgba(255,255,255,0.18); }
.rc-bar-fill { transition: width .8s cubic-bezier(0.22, 1, 0.36, 1); }
.rc-sheen {
  background-image: linear-gradient(90deg, transparent, rgba(255,255,255,0.22), transparent);
  background-size: 220px 100%;
  background-repeat: no-repeat;
  animation: rcShimmer 1.8s linear infinite;
}
@media (max-width: 640px) {
  .rc-btn, .rc-ghost, .rc-iconbtn, .rc-quiet, .rc-sparkle, .rc-ring { min-height: 44px; }
  .rc-hero-row { flex-direction: column; }
  .rc-hero-row > * { width: 100%; }
  .rc-mobile-stack { flex-direction: column !important; align-items: stretch !important; }
  .rc-mobile-stack > * { width: 100%; min-width: 0 !important; }
  .rc-mobile-actions { flex-direction: column; }
  .rc-mobile-actions > * { width: 100% !important; }
  .rc-addon-row { flex-wrap: wrap; }
  .rc-addon-row > button:last-child { width: 100%; justify-content: center; }
  .rc-mobile-scroll {
    display: flex !important;
    overflow-x: auto;
    gap: 12px;
    margin-inline: -16px;
    padding: 2px 16px 12px;
    scroll-snap-type: x mandatory;
    scrollbar-width: none;
  }
  .rc-mobile-scroll::-webkit-scrollbar { display: none; }
  .rc-mobile-scroll > * { flex: 0 0 min(72vw, 220px); scroll-snap-align: start; }
  .rc-desktop-divider { display: none !important; }
}
@media (min-width: 641px) and (max-width: 1024px) {
  .rc-responsive-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (prefers-reduced-motion: reduce) {
  .rc-result-enter { animation: none !important; }
}

/* ---- The cinematic pass: glass, gradient, and motion with a purpose ---- */
@keyframes rcRise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
@keyframes rcGlowPulse {
  0%, 100% { box-shadow: 0 0 0 1px rgba(59,130,246,0.35), 0 18px 60px -24px rgba(37,99,235,0.75); }
  50% { box-shadow: 0 0 0 1px rgba(45,212,191,0.42), 0 22px 70px -22px rgba(45,212,191,0.55); }
}
@keyframes rcSlide { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }

/* Card reveals: staggered, and driven by --rc-i so a list needs no JS timers. */
.rc-reveal {
  animation: rcRise .42s cubic-bezier(0.16, 1, 0.3, 1) both;
  animation-delay: calc(var(--rc-i, 0) * 60ms);
}

/* Frosted panel: the base surface for everything that holds content. */
.rc-glass {
  background: linear-gradient(180deg, rgba(255,255,255,0.055) 0%, rgba(255,255,255,0.022) 100%);
  border: 1px solid rgba(255,255,255,0.09);
  backdrop-filter: blur(18px) saturate(140%);
  -webkit-backdrop-filter: blur(18px) saturate(140%);
  box-shadow: 0 24px 70px -40px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,255,255,0.06);
}

/* Hover lift — the one interaction every card and button shares. */
.rc-lift-hover { transition: transform .2s cubic-bezier(0.16,1,0.3,1), box-shadow .2s ease, border-color .2s ease; }
.rc-lift-hover:hover { transform: translateY(-2px); box-shadow: 0 22px 44px -26px rgba(0,0,0,0.95); border-color: rgba(255,255,255,0.2); }
.rc-press:active:not(:disabled) { transform: translateY(0) scale(0.985); }
.rc-ring:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(59,130,246,0.35), 0 0 0 1px rgba(59,130,246,0.7); }

/* The two brand gradients: light→deep blue for action, teal→blue for accent. */
.rc-grad-action { background-image: linear-gradient(135deg, #3b82f6 0%, #2563eb 55%, #1d4ed8 100%); }
.rc-grad-accent { background-image: linear-gradient(135deg, #2dd4bf 0%, #60a5fa 60%, #3b82f6 100%); }
.rc-grad-text {
  background-image: linear-gradient(120deg, #ffffff 0%, #93c5fd 45%, #5eead4 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.rc-glow { animation: rcGlowPulse 4.2s ease-in-out infinite; }

/* Progress: a gradient that actually travels, so the bar reads as alive. */
.rc-bar-live {
  background-image: linear-gradient(90deg, #2563eb, #3b82f6, #2dd4bf, #2563eb);
  background-size: 200% 100%;
  animation: rcSlide 2.6s linear infinite;
}

/* Sparkle ✨ expand button, next to a text field. */
.rc-sparkle {
  display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  border-radius: 8px; border: 1px solid rgba(59,130,246,0.32);
  background: linear-gradient(180deg, rgba(59,130,246,0.20), rgba(59,130,246,0.10));
  color: #bfdbfe; cursor: pointer; font: inherit; font-size: 11.5px; font-weight: 600;
  padding: 5px 9px; transition: background .16s ease, border-color .16s ease, transform .16s ease, opacity .16s ease;
}
.rc-sparkle:hover:not(:disabled) { background: linear-gradient(180deg, rgba(59,130,246,0.34), rgba(59,130,246,0.18)); border-color: rgba(59,130,246,0.6); transform: translateY(-1px); }
.rc-sparkle:active:not(:disabled) { transform: scale(0.96); }
.rc-sparkle:disabled { opacity: 0.4; cursor: not-allowed; }

/* Someone who has asked for less motion gets less motion. */
@media (prefers-reduced-motion: reduce) {
  .rc-fade, .rc-reveal, .rc-glow, .rc-bar-live, .rc-sheen, .rc-skeleton, .rc-pulse { animation: none !important; }
  .rc-lift-hover:hover { transform: none; }
}
`;

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------
export function PrimaryButton({
  children,
  onClick,
  disabled,
  full,
  style,
  testId,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  full?: boolean;
  style?: CSSProperties;
  testId?: string;
}) {
  return (
    <button
      type="button"
      className="rc-btn rc-grad-action rc-press rc-ring"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        width: full ? '100%' : undefined,
        minHeight: 48,
        padding: '12px 20px',
        borderRadius: 14,
        fontSize: 16,
        fontWeight: 600,
        fontFamily: FONT,
        color: '#fff',
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        boxShadow: disabled ? 'none' : '0 10px 30px -12px rgba(37,99,235,0.75)',
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  onClick,
  disabled,
  full,
  style,
  testId,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  full?: boolean;
  style?: CSSProperties;
  testId?: string;
}) {
  return (
    <button
      type="button"
      className="rc-ghost rc-press rc-ring"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        width: full ? '100%' : undefined,
        minHeight: 44,
        padding: '11px 16px',
        borderRadius: 12,
        fontSize: 14,
        fontWeight: 500,
        fontFamily: FONT,
        color: T.sub,
        border: `1px solid ${T.border}`,
        background: 'transparent',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function IconButton({
  children,
  onClick,
  disabled,
  label,
  style,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  label: string;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      className="rc-iconbtn"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 44,
        height: 44,
        borderRadius: 12,
        border: `1px solid ${T.border}`,
        background: 'rgba(255,255,255,0.04)',
        color: T.sub,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Selection chip (aspect ratio, duration, mood)
// ---------------------------------------------------------------------------
export function Chip({
  children,
  selected,
  onClick,
  testId,
}: {
  children: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        minHeight: 44,
        padding: '9px 15px',
        borderRadius: 999,
        fontSize: 14,
        fontWeight: 500,
        fontFamily: FONT,
        cursor: 'pointer',
        color: selected ? '#fff' : T.sub,
        border: selected ? `1px solid ${T.accentBorder}` : `1px solid ${T.border}`,
        background: selected ? T.accentSoft : 'transparent',
        transition: 'all .15s ease',
      }}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------
export function FieldLabel({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: T.sub, letterSpacing: 0.1, lineHeight: 1.5 }}>
        {children}
      </span>
      {hint ? (
        <span style={{ display: 'block', marginTop: 3, fontSize: 12.5, lineHeight: 1.55, color: T.muted }}>{hint}</span>
      ) : null}
    </div>
  );
}

const inputBase: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  minHeight: 48,
  padding: '12px 14px',
  borderRadius: 12,
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.035)',
  color: '#f5f5f7',
  fontSize: 15,
  outline: 'none',
  fontFamily: FONT,
};

// ---------------------------------------------------------------------------
// ✨ AI EXPAND — on every text field in the studio
// ---------------------------------------------------------------------------
/**
 * What it is for: nobody wants to write a paragraph into a form. They type
 * "basketball player", press ✨, and get the rich description the video model
 * actually needs — in the field, editable, before anything is spent.
 *
 * The button lives on the field itself rather than in a toolbar, so every place
 * text is entered has the same affordance: brief, character, scene, product,
 * anywhere. Disabled while the field is empty (there is nothing to expand),
 * and it swaps to a spinner in place while it thinks, so the field never jumps.
 */
export interface ExpandSpec {
  /** The field's own name, so the expansion knows what it is writing. */
  field: string;
  /** Whatever makes it specific — the product, the tone, the scene. */
  context?: string;
  /** Roughly how long the answer should be. */
  words?: number;
  /** Label next to the sparkle. Defaults to "Expand". */
  label?: string;
}

export function SparkleExpand({
  value,
  onChange,
  spec,
  testId,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  spec: ExpandSpec;
  testId?: string;
  style?: CSSProperties;
}) {
  const [busy, setBusy] = useState(false);
  const empty = !value.trim();

  const run = async () => {
    if (busy || empty) return;
    setBusy(true);
    try {
      const expanded = await expandFieldText({
        field: spec.field,
        text: value,
        context: spec.context,
        words: spec.words,
      });
      // expandFieldText never throws and returns the original text when it
      // cannot do better, so this is always safe to apply.
      onChange(expanded);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className="rc-sparkle rc-ring"
      onClick={() => void run()}
      disabled={busy || empty}
      title={empty ? 'Type a few words first, then expand them with AI' : 'Expand this with AI'}
      aria-label={`Expand ${spec.field.toLowerCase()} with AI`}
      data-testid={testId || 'button-ai-expand'}
      data-busy={busy ? 'true' : 'false'}
      style={style}
    >
      {busy ? <Loader2 size={12} className="rc-spin" /> : <Sparkles size={12} />}
      {busy ? 'Expanding…' : spec.label || 'Expand'}
    </button>
  );
}

/** The shimmer a field wears while its expansion is on the way. */
function FieldShell({
  children,
  expand,
  value,
  onChange,
  testId,
}: {
  children: ReactNode;
  expand?: ExpandSpec;
  value: string;
  onChange: (v: string) => void;
  testId?: string;
}) {
  if (!expand) return <>{children}</>;
  return (
    <div style={{ position: 'relative' }}>
      {children}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
        <SparkleExpand
          value={value}
          onChange={onChange}
          spec={expand}
          testId={testId ? `${testId}-expand` : undefined}
        />
      </div>
    </div>
  );
}

export function TextInput(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onBlur?: () => void;
  onEnter?: () => void;
  testId?: string;
  type?: string;
  invalid?: boolean;
  /** Pass this and the field gets its own ✨ AI expand button. */
  expand?: ExpandSpec;
}) {
  return (
    <FieldShell
      expand={props.expand}
      value={props.value}
      onChange={props.onChange}
      testId={props.testId}
    >
      <input
        className={`rc-input rc-ring${props.invalid ? ' rc-input-error' : ''}`}
        type={props.type || 'text'}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        onBlur={props.onBlur}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && props.onEnter) props.onEnter();
        }}
        placeholder={props.placeholder}
        autoFocus={props.autoFocus}
        aria-invalid={props.invalid || undefined}
        data-testid={props.testId}
        style={inputBase}
      />
    </FieldShell>
  );
}

export function TextArea(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
  onBlur?: () => void;
  testId?: string;
  /** Pass this and the field gets its own ✨ AI expand button. */
  expand?: ExpandSpec;
}) {
  return (
    <FieldShell
      expand={props.expand}
      value={props.value}
      onChange={props.onChange}
      testId={props.testId}
    >
      <textarea
        className="rc-input rc-ring"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        onBlur={props.onBlur}
        placeholder={props.placeholder}
        rows={props.rows || 4}
        autoFocus={props.autoFocus}
        data-testid={props.testId}
        style={{ ...inputBase, resize: 'vertical', lineHeight: 1.55 }}
      />
    </FieldShell>
  );
}

// ---------------------------------------------------------------------------
// Render engine. The registered hook intentionally runs one engine, so this is
// status copy rather than a decorative selector. The existing component API is
// preserved for every Create surface that already renders it.
// ---------------------------------------------------------------------------
export function ModelPicker({
  value,
  onChange,
  compact,
}: {
  value: string;
  onChange: (id: string) => void;
  compact?: boolean;
}) {
  const current = getVideoModel(value);

  useEffect(() => {
    if (value !== current.id) onChange(DEFAULT_VIDEO_MODEL);
  }, [current.id, onChange, value]);

  return (
    <div
      aria-label="Video model"
      data-testid="video-model"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        padding: compact ? '9px 11px' : '12px 13px',
        borderRadius: 10,
        border: `1px solid ${T.border}`,
        background: 'rgba(255,255,255,0.025)',
      }}
    >
      <span style={{ fontSize: compact ? 11 : 11.5, fontWeight: 700, color: T.muted, letterSpacing: 0.2 }}>
        Video model
      </span>
      <span style={{ fontSize: compact ? 12 : 13.5, fontWeight: 600, color: T.text }}>
        Rendered with Google Omni Flash
      </span>
      {!compact ? (
        <span style={{ fontSize: 11.5, color: T.muted }}>Reference-consistent video with native sound</span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step chrome: back bar + heading
// ---------------------------------------------------------------------------
export function StepHeader({
  title,
  subtitle,
  onBack,
  backLabel,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  backLabel?: string;
}) {
  return (
    <div className="rc-fade" style={{ marginBottom: 26 }}>
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="rc-ghost"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            marginBottom: 18,
            padding: '7px 12px',
            borderRadius: 8,
            fontSize: 12.5,
            fontWeight: 500,
            fontFamily: FONT,
            color: T.muted,
            border: `1px solid ${T.border}`,
            background: 'transparent',
            cursor: 'pointer',
          }}
          data-testid="button-step-back"
        >
          ← {backLabel || 'Back'}
        </button>
      ) : null}
      <h1 style={{ margin: 0, fontSize: 'clamp(22px, 4vw, 28px)', fontWeight: 700, letterSpacing: -0.4, color: T.text }}>{title}</h1>
      {subtitle ? (
        <p style={{ margin: '8px 0 0', fontSize: 15, color: T.sub, lineHeight: 1.6, maxWidth: '42rem' }}>{subtitle}</p>
      ) : null}
    </div>
  );
}

export function Card({
  children,
  style,
  className,
  ...rest
}: {
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
} & Record<string, any>) {
  return (
    <div
      className={className}
      style={{
        borderRadius: 16,
        border: `1px solid ${T.border}`,
        background: 'linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.022))',
        boxShadow: '0 18px 48px -38px rgba(0,0,0,0.9)',
        padding: 'clamp(16px, 3vw, 24px)',
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step indicator — the small progress rail at the top of a flow. Defaults to
// the 5 short-video wizard steps; Long Video passes its own labels.
// ---------------------------------------------------------------------------
export const WIZARD_STEPS = ['Type', 'Details', 'Character', 'Storyboard', 'Video'] as const;

export function StepIndicator({
  current,
  steps = WIZARD_STEPS,
}: {
  current: number;
  steps?: readonly string[];
}) {
  return (
    <div
      aria-label={`Step ${current + 1} of ${steps.length}: ${steps[current]}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        marginBottom: 24,
        flexWrap: 'wrap',
      }}
    >
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: 0.2,
                whiteSpace: 'nowrap',
                color: active ? '#fff' : done ? T.accentFg : T.muted,
                border: active ? `1px solid ${T.accentBorder}` : `1px solid ${T.border}`,
                background: active ? T.accentSoft : 'transparent',
                transition: 'all .2s ease',
              }}
              data-testid={`step-pill-${i + 1}`}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 15,
                  height: 15,
                  borderRadius: 999,
                  fontSize: 9.5,
                  fontWeight: 700,
                  color: active || done ? '#fff' : T.muted,
                  background: active || done ? 'linear-gradient(135deg, #3b82f6, #2563eb)' : 'rgba(255,255,255,0.07)',
                }}
              >
                {done ? '✓' : i + 1}
              </span>
              <span className={active ? 'rc-step-label rc-step-label-active' : 'rc-step-label'}>{label}</span>
            </span>
            {i < steps.length - 1 ? (
              <span style={{ width: 12, height: 1, background: done ? T.accentBorder : T.border }} />
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Redesign primitives
// ---------------------------------------------------------------------------

/** A quiet inline text action — secondary paths never compete with the hero. */
export function TextLink({
  children,
  onClick,
  testId,
  style,
}: {
  children: ReactNode;
  onClick?: () => void;
  testId?: string;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      className="rc-quiet rc-ring"
      onClick={onClick}
      data-testid={testId}
      style={{ minHeight: 44, padding: '8px 4px', borderRadius: 10, ...style }}
    >
      {children}
    </button>
  );
}

/** Small uppercase section label — the only heading weight below the hero. */
export function SectionLabel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <span
      style={{
        display: 'block',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 0.7,
        textTransform: 'uppercase',
        color: T.muted,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/**
 * The render progress bar — determinate, because a spinner says nothing.
 *
 * `stopped` is for a render that is OVER (failed, or turned down on content):
 * the width transition is dropped and the fill goes grey, so the bar reads as
 * "this is where it stopped" instead of quietly animating along under an error
 * message as though something were still happening.
 */
export function ProgressBar({
  value,
  testId,
  stopped,
}: {
  value: number;
  testId?: string;
  stopped?: boolean;
}) {
  const pct = Math.max(4, Math.min(100, Math.round(value * 100)));
  // 8px reads as a bar rather than a hairline, which matters when it is the
  // only thing on screen for several minutes.
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      data-testid={testId}
      data-state={stopped ? 'stopped' : 'active'}
      style={{
        width: '100%',
        height: 8,
        borderRadius: 999,
        overflow: 'hidden',
        background: 'rgba(255,255,255,0.07)',
        boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.5)',
      }}
    >
      <div
        className={stopped ? undefined : 'rc-bar-fill rc-bar-live'}
        style={{
          width: `${pct}%`,
          height: '100%',
          borderRadius: 999,
          background: stopped
            ? 'linear-gradient(90deg, rgba(255,255,255,0.22), rgba(255,255,255,0.14))'
            : undefined,
        }}
      />
    </div>
  );
}

export function ErrorNotice({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '11px 14px',
        borderRadius: 10,
        fontSize: 13,
        lineHeight: 1.5,
        color: T.danger,
        border: '1px solid rgba(239,68,68,0.28)',
        background: 'rgba(239,68,68,0.08)',
      }}
      role="alert"
    >
      {children}
    </div>
  );
}

/**
 * The persistent SERIES ACTIVE badge (frame chaining): a small anchor-frame
 * thumbnail, the series copy, and the Clear series reset. Renders nothing when
 * no series is live, so surfaces can mount it unconditionally.
 */
export function SeriesBadge({ style }: { style?: CSSProperties }) {
  const chain = useFrameChain();
  if (!chain.seriesActive || !chain.seriesAnchor) return null;
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 11,
        padding: '8px 12px',
        borderRadius: 12,
        border: `1px solid ${T.accentBorder}`,
        background: T.accentSoft,
        maxWidth: '100%',
        ...style,
      }}
      data-testid="badge-series-active"
    >
      <img
        src={chain.seriesAnchor.url}
        alt="Series anchor frame"
        style={{
          width: 36,
          height: 36,
          borderRadius: 9,
          objectFit: 'cover',
          background: '#000',
          flexShrink: 0,
        }}
      />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: 'block',
            fontSize: 12,
            fontWeight: 750,
            letterSpacing: 0.3,
            color: T.accentFg,
          }}
        >
          Series active
        </span>
        <span
          style={{
            display: 'block',
            marginTop: 1,
            fontSize: 11.5,
            color: T.sub,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          Every new video continues this character — anchored to “{chain.seriesAnchor.title}”
        </span>
      </span>
      <button
        type="button"
        className="rc-quiet rc-ring"
        onClick={clearSeries}
        style={{ minHeight: 32, padding: '4px 8px', fontSize: 11.5, fontWeight: 700, color: T.sub, flexShrink: 0 }}
        data-testid="button-clear-series"
      >
        Clear series
      </button>
    </div>
  );
}
