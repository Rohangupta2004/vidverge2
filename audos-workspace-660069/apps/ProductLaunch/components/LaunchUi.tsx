// LaunchUi — the engine's shared surface language.
//
// Everything is styled from the space's own --space-* tokens so the app, the
// launcher, the agent panel and Settings stay one product. Inline styles only:
// a Tailwind opacity modifier silently emits nothing when it is applied to a
// CSS variable, which is how a tint quietly disappears.

import { Loader2 } from 'lucide-react';

export const ACCENT = 'var(--space-brand-primary-500, #F59E0B)';
export const ACCENT_SOFT = 'var(--space-brand-primary-100, rgba(245,158,11,0.14))';
export const TEXT = 'var(--space-text-primary, #F1F5F9)';
export const MUTED = 'var(--space-text-muted, #94A3B8)';
export const BORDER = 'var(--space-border-default, rgba(148,163,184,0.14))';
export const PANEL_BG = 'var(--space-surface-panel, #101623)';
export const CARD_BG = 'var(--space-surface-card, #0E131F)';

export const PANEL: React.CSSProperties = {
  background: PANEL_BG,
  border: '1px solid ' + BORDER,
  borderRadius: 18,
};

export function PrimaryButton(props: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  width?: string;
}) {
  const disabled = Boolean(props.disabled || props.busy);
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        width: props.width,
        padding: '14px 26px',
        borderRadius: 12,
        border: 'none',
        background: disabled ? 'rgba(148,163,184,0.18)' : ACCENT,
        color: disabled ? MUTED : 'var(--space-text-on-primary, #180F02)',
        fontSize: 15,
        fontWeight: 700,
        letterSpacing: '-0.01em',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'transform 120ms ease, opacity 120ms ease',
      }}
    >
      {props.busy ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : null}
      {props.children}
    </button>
  );
}

export function GhostButton(props: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '12px 20px',
        borderRadius: 12,
        border: '1px solid ' + BORDER,
        background: 'transparent',
        color: TEXT,
        fontSize: 14,
        fontWeight: 600,
        cursor: props.disabled ? 'not-allowed' : 'pointer',
        opacity: props.disabled ? 0.5 : 1,
      }}
    >
      {props.children}
    </button>
  );
}

export function Field(props: {
  label: string;
  hint?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: 'block', marginBottom: 20 }}>
      <span
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          marginBottom: 8,
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: TEXT,
        }}
      >
        {props.label}
        {props.optional ? (
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.02em', textTransform: 'none', color: MUTED }}>
            optional
          </span>
        ) : null}
      </span>
      {props.children}
      {props.hint ? (
        <span style={{ display: 'block', marginTop: 7, fontSize: 12.5, lineHeight: 1.5, color: MUTED }}>
          {props.hint}
        </span>
      ) : null}
    </label>
  );
}

export const INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  padding: '13px 15px',
  borderRadius: 12,
  border: '1px solid ' + BORDER,
  background: 'var(--space-surface-muted, #0D1220)',
  color: TEXT,
  fontSize: 15,
  fontFamily: 'inherit',
  outline: 'none',
};

export function ErrorNote(props: { children: React.ReactNode }) {
  if (!props.children) return null;
  return (
    <div
      style={{
        marginTop: 16,
        padding: '13px 16px',
        borderRadius: 12,
        border: '1px solid rgba(248,113,113,0.35)',
        background: 'rgba(248,113,113,0.10)',
        color: 'var(--space-semantic-danger, #F87171)',
        fontSize: 13.5,
        lineHeight: 1.55,
      }}
    >
      {props.children}
    </div>
  );
}

export interface RailStep {
  id: string;
  label: string;
}

/** The four screens, always visible, so the creator knows where they are. */
export function StepRail(props: { steps: RailStep[]; activeIndex: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      {props.steps.map((step, index) => {
        const done = index < props.activeIndex;
        const active = index === props.activeIndex;
        return (
          <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '7px 13px',
                borderRadius: 999,
                border: '1px solid ' + (active ? ACCENT : BORDER),
                background: active ? ACCENT_SOFT : 'transparent',
                color: active ? TEXT : done ? TEXT : MUTED,
                fontSize: 12.5,
                fontWeight: 600,
              }}
            >
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontWeight: 800,
                  background: active || done ? ACCENT : 'rgba(148,163,184,0.2)',
                  color: active || done ? 'var(--space-text-on-primary, #180F02)' : MUTED,
                }}
              >
                {index + 1}
              </span>
              {step.label}
            </div>
            {index < props.steps.length - 1 ? (
              <span style={{ width: 16, height: 1, background: BORDER }} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function Spinner(props: { size?: number }) {
  return (
    <Loader2
      size={props.size || 16}
      style={{ animation: 'spin 1s linear infinite', color: ACCENT }}
    />
  );
}

/** One keyframes block for the whole app — mounted once by App.tsx. */
export function LaunchKeyframes() {
  return (
    <style>
      {'@keyframes spin{to{transform:rotate(360deg)}}'
        + '@keyframes plPulse{0%,100%{opacity:0.35}50%{opacity:1}}'
        + '@keyframes plSweep{0%{transform:translateX(-100%)}100%{transform:translateX(320%)}}'}
    </style>
  );
}
