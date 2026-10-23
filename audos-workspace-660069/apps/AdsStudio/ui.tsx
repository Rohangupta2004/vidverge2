/**
 * ADS STUDIO — the shared UI atoms.
 *
 * These were inline in App.tsx while the app was a single file. The Recipes
 * tab needs the same button, tag and card so its sub-sections look like the
 * eight-step workflow rather than a bolted-on second product, so they live
 * here and both surfaces import them.
 */
import { CSSProperties } from 'react';
import VergeLoader from '../../components/VergeLoader';
import { T } from './api';

export const card: CSSProperties = {
  background: T.card,
  border: `1px solid ${T.line}`,
  borderRadius: 12,
  padding: 24,
  boxShadow: 'none',
};

export const inputStyle: CSSProperties = {
  width: '100%',
  // The input well sits BELOW the card it is in, not level with it, so a
  // field still reads as a field on a dark ground.
  background: T.input,
  minHeight: 44,
  border: '1px solid var(--vg-control-border)',
  borderRadius: 10,
  padding: '10px 12px',
  color: T.ink,
  fontSize: 14,
  fontFamily: T.sans,
  outline: 'none',
  boxSizing: 'border-box',
};

export const labelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: T.muted,
  letterSpacing: 0,
  marginBottom: 6,
  display: 'block',
};

export function Btn(props: {
  onClick?: () => void;
  children: any;
  kind?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  small?: boolean;
  title?: string;
  className?: string;
}) {
  const { kind = 'ghost', small } = props;
  const bg =
    kind === 'primary'
      ? 'var(--vg-gradient-action)'
      : kind === 'danger'
        ? 'var(--vg-danger-bg)'
        : 'var(--space-surface-panel-strong)';
  const color = kind === 'primary' ? 'var(--vg-on-accent)' : kind === 'danger' ? T.bad : T.soft;
  return (
    <button
      type="button"
      className={`ads-btn${props.className ? ` ${props.className}` : ''}`}
      title={props.title}
      onClick={props.onClick}
      disabled={props.disabled}
      style={{
        background: bg, color, border: `1px solid ${kind === 'ghost' ? T.line : 'transparent'}`,
        minHeight: 44, borderRadius: 10, padding: small ? '8px 10px' : '10px 16px', fontSize: small ? 12 : 14,
        fontWeight: 600, fontFamily: T.sans, cursor: props.disabled ? 'not-allowed' : 'pointer',
        opacity: props.disabled ? 0.5 : 1, display: 'inline-flex', alignItems: 'center', gap: 7,
      }}
    >{props.children}</button>
  );
}

export function Tag(props: { children: any; tone?: 'ok' | 'warn' | 'bad' | 'info' }) {
  const toneColor = props.tone === 'ok' ? T.good : props.tone === 'warn' ? T.warn : props.tone === 'bad' ? T.bad : T.accent;
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color: toneColor, border: `1px solid ${toneColor}`, borderRadius: 6, padding: '2px 9px', opacity: 0.95, whiteSpace: 'nowrap' }}>
      {props.children}
    </span>
  );
}

export function Spin(props: { size?: number; label?: string; caption?: string } = {}) {
  return <VergeLoader size={props.size ?? 34} label={props.label} caption={props.caption} />;
}
