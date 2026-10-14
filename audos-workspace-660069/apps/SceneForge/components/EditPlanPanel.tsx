import { ArrowRight, Sparkles } from 'lucide-react';
import OverlayCard from './OverlayCard';
import type { EditPlan, Overlay } from '../types';

const colors: Record<string, string> = { seedance_motion: 'bg-[#D4920A]', static_image: 'bg-[#1D4ED8]', text_fact: 'bg-[#166534]', comparison_card: 'bg-[#BE185D]' };

export default function EditPlanPanel({ plan, duration, onChange, onGenerate }: { plan: EditPlan; duration: number; onChange: (plan: EditPlan) => void; onGenerate: () => void }) {
  const updateOverlay = (id: string, next: Overlay) => onChange({ ...plan, overlays: plan.overlays.map((overlay) => overlay.id === id ? next : overlay) });
  const removeOverlay = (id: string) => onChange({ ...plan, overlays: plan.overlays.filter((overlay) => overlay.id !== id) });
  const scale = Math.max(duration, 0.1);

  return (
    <section className="rounded-3xl border border-[color-mix(in_srgb,#B4780A_14%,transparent)] bg-[#15120A] p-6">
      <div className="mb-5 flex items-start justify-between gap-4"><div><div className="mb-2 flex items-center gap-2 text-[#D4920A]"><Sparkles size={18} /><span className="text-xs font-bold uppercase tracking-[.18em]">AI edit plan</span></div><h2 className="text-xl font-semibold text-[#F5E9C8]">Review every editorial decision</h2><p className="mt-1 text-sm text-[#9E8B55]">Text and comparison rows remain editable through final render.</p></div><span className="rounded-full border border-[color-mix(in_srgb,#B4780A_14%,transparent)] px-3 py-1 text-xs text-[#9E8B55]">{duration.toFixed(1)}s</span></div>
      <div className="mb-6 rounded-2xl border border-[color-mix(in_srgb,#B4780A_14%,transparent)] bg-[#18150A] p-4">
        <div className="relative h-16 overflow-hidden rounded-xl bg-[color-mix(in_srgb,#B4780A_6%,transparent)]">
          {plan.cuts.map((cut, index) => <div key={`${cut.label}_${index}`} className="absolute top-1 h-5 rounded-md border border-[color-mix(in_srgb,#B4780A_18%,transparent)] bg-[#15120A] px-2 text-[9px] leading-5 text-[#3D2800]" style={{ left: `${(cut.start / scale) * 100}%`, width: `${Math.max(2, ((cut.end - cut.start) / scale) * 100)}%` }}>{cut.label}</div>)}
          {plan.overlays.map((overlay) => <div key={overlay.id} title={`${overlay.type} · ${overlay.startSec.toFixed(1)}s`} className={`absolute bottom-2 h-6 rounded-md ${colors[overlay.type]} px-2 text-[9px] font-bold leading-6 text-white`} style={{ left: `${(overlay.startSec / scale) * 100}%`, width: `${Math.max(1.5, (overlay.durationSec / scale) * 100)}%` }}>{overlay.type.replace('_', ' ')}</div>)}
        </div>
      </div>
      <div className="space-y-3">{plan.overlays.map((overlay) => <OverlayCard key={overlay.id} overlay={overlay} onChange={(next) => updateOverlay(overlay.id, next)} onDelete={() => removeOverlay(overlay.id)} />)}</div>
      <button onClick={onGenerate} className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#D4920A] px-5 py-4 font-bold text-white transition hover:bg-[#B4720A]"><span>Looks good</span><ArrowRight size={18} /><span>Generate</span></button>
    </section>
  );
}
