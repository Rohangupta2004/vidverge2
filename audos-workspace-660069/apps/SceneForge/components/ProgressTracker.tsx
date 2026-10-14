import { Check, Circle, LoaderCircle, RefreshCw, X } from 'lucide-react';
import type { PipelineStep } from '../types';

export default function ProgressTracker({ steps, error, onRetry }: { steps: PipelineStep[]; error?: string; onRetry?: () => void }) {
  return (
    <section className="rounded-3xl border border-[color-mix(in_srgb,#B4780A_14%,transparent)] bg-[#15120A] p-6">
      <h2 className="text-xl font-semibold text-[#F5E9C8]">Building your film</h2><p className="mt-1 text-sm text-[#9E8B55]">Each specialist hands off to the next automatically.</p>
      <div className="mt-6 space-y-2">
        {steps.map((step) => (
          <div key={step.id} className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${step.status === 'running' ? 'border-[color-mix(in_srgb,#D4920A_30%,transparent)] bg-[color-mix(in_srgb,#D4920A_8%,transparent)]' : step.status === 'failed' ? 'border-[color-mix(in_srgb,#991B1B_25%,transparent)] bg-[color-mix(in_srgb,#991B1B_7%,transparent)]' : 'border-[color-mix(in_srgb,#B4780A_12%,transparent)] bg-[color-mix(in_srgb,#B4780A_5%,transparent)]'}`}>
            <div className={`grid h-8 w-8 place-items-center rounded-full ${step.status === 'complete' ? 'bg-[#166534] text-white' : step.status === 'failed' ? 'bg-[#991B1B] text-white' : step.status === 'running' ? 'bg-[#D4920A] text-white' : 'bg-[color-mix(in_srgb,#B4780A_10%,transparent)] text-[#9E8B55]'}`}>
              {step.status === 'complete' ? <Check size={17} /> : step.status === 'failed' ? <X size={17} /> : step.status === 'running' ? <LoaderCircle className="animate-spin" size={17} /> : <Circle size={14} />}
            </div>
            <div><div className="text-sm font-semibold text-[#F5E9C8]">{step.label}</div>{step.detail && <div className="text-xs text-[#9E8B55]">{step.detail}</div>}</div>
          </div>
        ))}
      </div>
      {error && <div className="mt-5 rounded-2xl border border-[color-mix(in_srgb,#991B1B_24%,transparent)] bg-[color-mix(in_srgb,#991B1B_8%,transparent)] p-4 text-sm text-[#991B1B]"><div>{error}</div>{onRetry && <button onClick={onRetry} className="mt-3 flex items-center gap-2 font-bold text-[#F5E9C8]"><RefreshCw size={15} /> Retry failed step</button>}</div>}
    </section>
  );
}
