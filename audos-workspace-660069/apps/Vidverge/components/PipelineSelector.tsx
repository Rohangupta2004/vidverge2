import type { ReactNode } from 'react';
import { Clapperboard, Zap, Clock, Wallet, Check, Sparkles } from 'lucide-react';
import type { PipelineId } from '../types';
import { PIPELINE_SPECS, slaLabel } from '../lib/pipelineSpecs';
import { formatUsd } from '../lib/runtime';

/**
 * The engines, side by side. Cost and time are on the card rather than behind
 * a tooltip: the customer is about to spend real wallet money, and the choice
 * between them is mostly a choice between those two numbers.
 */

const ICONS = { CODE_ENGINEERED: Zap, HYBRID_DOCUMENTARY: Clapperboard, RUNWAY_MULTI_SHOT: Sparkles };
export default function PipelineSelector({
  selected,
  onSelect,
  disabled,
}: {
  selected: PipelineId | null;
  onSelect: (id: PipelineId) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {PIPELINE_SPECS.map((spec) => {
        const active = selected === spec.id;
        const Icon = ICONS[spec.id] || Zap;
        return (
          <button
            key={spec.id}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(spec.id)}
            className={[
              'group relative flex h-full flex-col gap-4 rounded-2xl border p-5 text-left transition-all duration-200',
              'disabled:cursor-not-allowed disabled:opacity-60',
              active
                ? 'border-[var(--space-brand-primary-500)] bg-[color-mix(in_srgb,var(--space-brand-primary-500)_10%,var(--space-surface-card))] shadow-[0_8px_40px_color-mix(in_srgb,var(--space-brand-primary-500)_22%,transparent)]'
                : 'border-[var(--space-border-default)] bg-[var(--space-surface-card)] hover:border-[color-mix(in_srgb,var(--space-brand-primary-500)_45%,transparent)]',
            ].join(' ')}
          >
            <div className="flex items-start gap-3">
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                style={{
                  background:
                    'color-mix(in srgb, var(--space-brand-primary-500) 16%, transparent)',
                  color: 'var(--space-brand-highlight)',
                }}
              >
                <Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-[17px] font-semibold tracking-[-0.02em] text-[var(--space-text-primary)]">
                    {spec.title}
                  </h3>
                  {active && (
                    <Check className="h-4 w-4 text-[var(--space-brand-highlight)]" />
                  )}
                </div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--space-text-secondary)]">
                  {spec.blurb}
                </p>
              </div>
            </div>

            <ul className="flex flex-col gap-1.5">
              {spec.steps.map((step) => (
                <li
                  key={step}
                  className="flex items-start gap-2 text-[12.5px] text-[var(--space-text-muted)]"
                >
                  <span
                    className="mt-[7px] h-1 w-1 shrink-0 rounded-full"
                    style={{ background: 'var(--space-brand-highlight)' }}
                  />
                  {step}
                </li>
              ))}
            </ul>

            <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
              <Stat icon={<Wallet className="h-3.5 w-3.5" />} label={`~${formatUsd(spec.costUsd)} / video`} />
              <Stat icon={<Clock className="h-3.5 w-3.5" />} label={slaLabel(spec)} />
              <Stat label={`${spec.aspectRatio} \u00b7 ${spec.durationSeconds}s`} />
            </div>
          </button>
        );
      })}
    </div>
  );
}

function Stat({ icon, label }: { icon?: ReactNode; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium text-[var(--space-text-secondary)]"
      style={{
        background: 'color-mix(in srgb, var(--space-text-primary) 7%, transparent)',
        border: '1px solid var(--space-border-default)',
      }}
    >
      {icon}
      {label}
    </span>
  );
}
