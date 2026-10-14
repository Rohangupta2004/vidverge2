// Shared primitives for the HeyGen suite panels.
//
// Every panel in the suite is a card with a numbered step, a status line and
// honest failure copy, so those three things live here rather than being
// re-typed (and drifting) in nine components. The visual language — the
// amber/gold gradient on an active control, `--space-*` tokens for every
// surface and border — matches the Avatar Studio the suite sits inside, so the
// two surfaces read as one product.
import { AlertTriangle, Check, Info, Loader2, Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { capabilityState, type Capability } from '../../lib/heygenApi';

export const GRADIENT = 'linear-gradient(135deg,#D4920A,#F0B429)';

export function Panel(props: { title: string; hint?: string; step?: number; done?: boolean; action?: ReactNode; children: ReactNode }) {
  return <section className="st-rise rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-5">
    <div className="flex flex-wrap items-center gap-3">
      {props.step ? <span className={props.done
        ? 'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white'
        : 'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--space-border-strong)] bg-[var(--space-surface-panel)] text-xs font-bold text-[var(--space-text-muted)]'}
        style={props.done ? { backgroundImage: GRADIENT } : undefined}>
        {props.done ? <Check className="h-4 w-4" /> : props.step}
      </span> : null}
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-semibold tracking-tight text-[var(--space-text-primary)]">{props.title}</h2>
        {props.hint ? <p className="mt-0.5 text-xs leading-relaxed text-[var(--space-text-muted)]">{props.hint}</p> : null}
      </div>
      {props.action}
    </div>
    <div className="mt-4">{props.children}</div>
  </section>;
}

export function Notice(props: { tone: 'error' | 'info' | 'ok'; title?: string; children: ReactNode; action?: ReactNode }) {
  const error = props.tone === 'error';
  const ok = props.tone === 'ok';
  const className = error
    ? 'border-[color-mix(in_srgb,var(--space-semantic-danger-500)_38%,transparent)] bg-[color-mix(in_srgb,var(--space-semantic-danger-500)_12%,transparent)]'
    : ok
      ? 'border-[color-mix(in_srgb,var(--space-semantic-success-500)_38%,transparent)] bg-[color-mix(in_srgb,var(--space-semantic-success-500)_12%,transparent)]'
      : 'border-dashed border-[var(--space-border-strong)] bg-[var(--space-surface-panel)]';
  return <div role={error ? 'alert' : undefined} className={`st-rise flex flex-wrap items-start gap-3 rounded-xl border p-4 text-sm ${className}`}>
    {error ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--space-semantic-danger)]" />
      : ok ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--space-semantic-success)]" />
        : <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--space-text-muted)]" />}
    <div className="min-w-[min(100%,220px)] flex-1 leading-relaxed text-[var(--space-text-secondary)]">
      {props.title ? <strong className="block text-[var(--space-text-primary)]">{props.title}</strong> : null}
      {props.children}
    </div>
    {props.action}
  </div>;
}

/**
 * The one place a capability's absence is explained.
 *
 * A HeyGen capability this account's plan does not answer is NOT an app error,
 * so it gets a calm dashed note that names the feature and says the rest of
 * the suite is unaffected — never a red alert implying something broke.
 */
export function CapabilityNote({ capability, label, children }: { capability: Capability; label: string; children?: ReactNode }) {
  if (capabilityState(capability) !== 'unavailable') return null;
  return <Notice tone="info" title={`${label} is not on this HeyGen plan`}>
    {children || 'Everything else in the suite still works. If you have upgraded your HeyGen plan, reload the studio and SceneForge will check again.'}
  </Notice>;
}

/**
 * A labelled control.
 *
 * `error` is the important part: a validation failure belongs UNDER the input
 * that caused it, in red, next to the red border the control itself takes on
 * (`st-field--error`). A toast that disappears leaves the customer looking at a
 * form with no idea which field is wrong. The error replaces the hint rather
 * than stacking on it, so the field never grows two lines of small print.
 */
export function Field(props: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return <label className="block">
    <span className="st-field-label">{props.label}</span>
    {props.children}
    {props.error
      ? <span role="alert" className="st-field-error">{props.error}</span>
      : props.hint ? <span className="st-field-hint">{props.hint}</span> : null}
  </label>;
}

/** The class a control carries, with the error variant applied when it applies. */
export function fieldClassFor(base: 'st-field' | 'st-select' | 'st-textarea', invalid?: boolean): string {
  return invalid ? `${base} ${base}--error` : base;
}

export function Button(props: { onClick?: () => void; disabled?: boolean; busy?: boolean; tone?: 'primary' | 'ghost'; children: ReactNode; type?: 'button' | 'submit' }) {
  const ghost = props.tone === 'ghost';
  return <button
    type={props.type || 'button'}
    onClick={props.onClick}
    disabled={props.disabled || props.busy}
    className={ghost
      ? 'inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--space-border-default)] px-3.5 py-2 text-xs font-semibold text-[var(--space-text-secondary)] hover:border-[var(--space-border-strong)] disabled:opacity-50'
      : 'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-[0_2px_12px_color-mix(in_srgb,#D4920A_40%,transparent)] disabled:opacity-50'}
    style={ghost ? undefined : { backgroundImage: GRADIENT }}>
    {props.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
    {props.children}
  </button>;
}

export function Toggle(props: { checked: boolean; onChange: (value: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm ${props.checked
    ? 'border-[color-mix(in_srgb,#D4920A_52%,transparent)] bg-[color-mix(in_srgb,#D4920A_12%,transparent)]'
    : 'border-[var(--space-border-default)] bg-[var(--space-surface-panel)]'} ${props.disabled ? 'cursor-not-allowed opacity-55' : ''}`}>
    <input
      type="checkbox"
      className="mt-0.5 h-4 w-4 shrink-0 accent-[#D4920A]"
      checked={props.checked}
      disabled={props.disabled}
      onChange={(event) => props.onChange(event.target.checked)}
    />
    <span className="min-w-0 flex-1">
      <span className="block font-medium text-[var(--space-text-primary)]">{props.label}</span>
      {props.hint ? <span className="mt-0.5 block text-xs leading-relaxed text-[var(--space-text-muted)]">{props.hint}</span> : null}
    </span>
  </label>;
}

export function Segmented<T extends string>(props: { value: T; options: { value: T; label: string; icon?: any }[]; onChange: (value: T) => void }) {
  return <div className="inline-flex flex-wrap gap-1 rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-1">
    {props.options.map((option) => {
      const Icon = option.icon;
      const active = option.value === props.value;
      return <button key={option.value} type="button" onClick={() => props.onChange(option.value)}
        className={active
          ? 'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white'
          : 'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--space-text-secondary)] hover:bg-[color-mix(in_srgb,#B4780A_8%,transparent)]'}
        style={active ? { backgroundImage: GRADIENT } : undefined}>
        {Icon ? <Icon className="h-3.5 w-3.5" /> : null}{option.label}
      </button>;
    })}
  </div>;
}

/**
 * An eased progress bar for a job whose real progress HeyGen never reports.
 *
 * It is driven by elapsed time against an expected duration and deliberately
 * stops at 95%: a bar that sits at 100% while the customer is still waiting is
 * a lie, and jumping 0 to 100 on the final poll tells them nothing meanwhile.
 */
export function Progress({ elapsedSec, expectedSec, label, done }: { elapsedSec: number; expectedSec: number; label: string; done?: boolean }) {
  const percent = done ? 100 : Math.min(95, Math.round(100 * (1 - Math.exp(-elapsedSec / Math.max(4, expectedSec / 2.4)))));
  return <div>
    <div className="flex items-center justify-between gap-3 text-xs text-[var(--space-text-muted)]">
      <span className="flex items-center gap-1.5 font-medium text-[var(--space-text-secondary)]">
        {done ? <Check className="h-3.5 w-3.5 text-[var(--space-semantic-success)]" /> : <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {label}
      </span>
      <span>{elapsedSec}s</span>
    </div>
    <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--space-surface-muted)]">
      <div className="h-full rounded-full transition-[width] duration-700 ease-out" style={{ width: `${percent}%`, backgroundImage: GRADIENT }} />
    </div>
  </div>;
}

/** The badge that says a presenter or brand is pinned for the whole session. */
export function LockBadge({ text, onChange }: { text: string; onChange?: () => void }) {
  return <span className="inline-flex items-center gap-2 rounded-full border border-[color-mix(in_srgb,#D4920A_48%,transparent)] bg-[color-mix(in_srgb,#D4920A_14%,transparent)] px-3 py-1.5 text-xs font-semibold text-[var(--space-text-primary)]">
    <Lock className="h-3.5 w-3.5 text-[#D4920A]" />
    {text}
    {onChange ? <button type="button" onClick={onChange} className="ml-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-[var(--space-text-muted)] underline decoration-dotted hover:text-[var(--space-text-primary)]">
      Change
    </button> : null}
  </span>;
}

/**
 * The confirmation a customer must pass to move a locked presenter mid-session.
 *
 * It exists because changing the avatar after some scenes are rendered is the
 * single most expensive mistake available in this app — the finished scenes
 * keep the old face and the film stops looking like one film. So the cost is
 * stated plainly instead of being hidden behind a quiet dropdown.
 */
export function ChangeLockModal(props: { open: boolean; currentName: string; nextName: string; onCancel: () => void; onConfirm: () => void }) {
  if (!props.open) return null;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,.58)] p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
    <div className="st-rise w-full max-w-md rounded-2xl border border-[var(--space-border-strong)] bg-[var(--space-surface-card)] p-6 shadow-2xl">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--space-semantic-danger-500)_16%,transparent)]">
          <AlertTriangle className="h-5 w-5 text-[var(--space-semantic-danger)]" />
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-[var(--space-text-primary)]">Change your locked presenter?</h3>
          <p className="mt-2 text-sm leading-relaxed text-[var(--space-text-secondary)]">
            This session is locked to <strong className="text-[var(--space-text-primary)]">{props.currentName}</strong>. Switching
            to <strong className="text-[var(--space-text-primary)]">{props.nextName}</strong> only affects scenes you generate from
            now on — anything already rendered keeps the old face, so a video built from both will not look like one film.
          </p>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button tone="ghost" onClick={props.onCancel}>Keep {props.currentName}</Button>
        <Button onClick={props.onConfirm}>Switch presenter</Button>
      </div>
    </div>
  </div>;
}

/** A tiny inline spinner-and-text line for a short-lived action. */
export function Working({ text }: { text: string }) {
  return <span className="inline-flex items-center gap-2 text-xs text-[var(--space-text-muted)]">
    <Loader2 className="h-3.5 w-3.5 animate-spin" />{text}
  </span>;
}
