/**
 * Short Video Enhancer — shared panel primitives.
 *
 * These are the Phase 1 redesign's controls, lifted out of App.tsx so the new
 * Phase 2 panels use exactly the same ones. Class names are unchanged, so the
 * look is identical; the only additions are the pieces Phase 2 needs — inline
 * notes, a progress bar and the export pipeline's stage list.
 */

import type { CSSProperties, ReactNode } from 'react';
import { AlertTriangle, Check, ChevronDown, Info, Loader2 } from 'lucide-react';

export function PanelHeading({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle: string }) {
  return (
    <div className="sve-panel-heading">
      <span>{icon}</span>
      <div><strong>{title}</strong><small>{subtitle}</small></div>
    </div>
  );
}

export function Section({ id, title, open, onToggle, children }: {
  id: string; title: string; open: boolean; onToggle: () => void; children: ReactNode;
}) {
  return (
    <div className="sve-section">
      <button className="sve-section-head" onClick={onToggle} aria-expanded={open}>
        <span>{title}</span>
        <ChevronDown size={15} className={open ? 'open' : ''} />
      </button>
      {open && <div className="sve-section-body" data-section={id}>{children}</div>}
    </div>
  );
}

export function Slider({ label, value, onChange, min = 0, max = 100, step = 1, suffix = '' }: {
  label: string; value: number; onChange: (value: number) => void;
  min?: number; max?: number; step?: number; suffix?: string;
}) {
  const percent = ((value - min) / (max - min)) * 100;
  return (
    <label className="sve-slider">
      <span>{label}<b>{value}{suffix}</b></span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ '--range-progress': percent + '%' } as CSSProperties}
      />
    </label>
  );
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button className="sve-toggle-row" onClick={() => onChange(!checked)} role="switch" aria-checked={checked}>
      <span>{label}</span>
      <span className={'sve-toggle ' + (checked ? 'on' : '')}><i /></span>
    </button>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="sve-field"><span>{label}</span>{children}</label>;
}

export function Card({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return <section className="sve-card"><h3>{icon}{title}</h3>{children}</section>;
}

export function InfoRow({ label, value }: { label: string; value: string }) {
  return <div className="sve-info-row"><span>{label}</span><strong>{value}</strong></div>;
}

/**
 * An inline explanation. `tone` is the difference between "here is how this
 * works", "this did not do what you asked" and "this is broken" — which is
 * why every failure path in this app passes a real sentence through here
 * instead of a toast that says something went wrong.
 */
export function Note({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'bad' | 'good'; children: ReactNode }) {
  const Icon = tone === 'bad' || tone === 'warn' ? AlertTriangle : tone === 'good' ? Check : Info;
  return (
    <p className={'sve-note ' + (tone === 'info' ? '' : tone)}>
      <Icon size={12} />
      <span>{children}</span>
    </p>
  );
}

export function ProgressBar() {
  return <div className="sve-progress indeterminate"><i /></div>;
}

export type StageState = 'pending' | 'active' | 'done' | 'failed';

export function StageList({ stages }: { stages: { label: string; state: StageState }[] }) {
  return (
    <div className="sve-stage-list">
      {stages.map((stage) => (
        <div key={stage.label} className={'sve-stage-row ' + (stage.state === 'active' ? 'active' : stage.state === 'done' ? 'done' : '')}>
          {stage.state === 'active' ? <Loader2 size={11} className="spin" />
            : stage.state === 'done' ? <Check size={11} />
            : stage.state === 'failed' ? <AlertTriangle size={11} />
            : <span style={{ width: 11, height: 11, borderRadius: '50%', border: '1px solid currentColor', display: 'block' }} />}
          {stage.label}
        </div>
      ))}
    </div>
  );
}
