import { Clock3, Trash2 } from 'lucide-react';
import ComparisonCard from './ComparisonCard';
import type { Overlay, OverlayPosition, OverlayType } from '../types';

const typeLabels: Record<OverlayType, string> = {
  seedance_motion: 'Seedance motion',
  static_image: 'Static image',
  text_fact: 'Text fact',
  comparison_card: 'Comparison card',
};
const positions: OverlayPosition[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center', 'sidebar-left', 'sidebar-right'];

export default function OverlayCard({ overlay, onChange, onDelete }: { overlay: Overlay; onChange: (next: Overlay) => void; onDelete: () => void }) {
  const set = <K extends keyof Overlay>(key: K, value: Overlay[K]) => onChange({ ...overlay, [key]: value });
  return (
    <article className="rounded-2xl border border-[color-mix(in_srgb,#B4780A_14%,transparent)] bg-[color-mix(in_srgb,#B4780A_5%,transparent)] p-4 transition hover:border-[color-mix(in_srgb,#B4780A_26%,transparent)]">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-[color-mix(in_srgb,#D4920A_12%,transparent)] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-[#D4920A]">{typeLabels[overlay.type]}</span>
        <span className="flex items-center gap-1 text-xs text-[#9E8B55]"><Clock3 size={13} /> {overlay.startSec.toFixed(1)}s · {overlay.durationSec.toFixed(1)}s</span>
        <button onClick={onDelete} className="ml-auto text-[#9E8B55] transition hover:text-[#991B1B]"><Trash2 size={17} /></button>
      </div>
      <div className="mb-3 grid grid-cols-3 gap-2">
        <label className="text-[11px] uppercase tracking-wide text-[#9E8B55]">Start<input type="number" min={0} step={0.1} value={overlay.startSec} onChange={(event) => set('startSec', Math.max(0, Number(event.target.value)))} className="mt-1 w-full rounded-lg border border-[color-mix(in_srgb,#B4780A_14%,transparent)] bg-[#18150A] px-2 py-2 text-sm text-[#F5E9C8] outline-none focus:border-[color-mix(in_srgb,#D4920A_45%,transparent)]" /></label>
        <label className="text-[11px] uppercase tracking-wide text-[#9E8B55]">Duration<input type="number" min={0.5} step={0.1} value={overlay.durationSec} onChange={(event) => set('durationSec', Math.max(.5, Number(event.target.value)))} className="mt-1 w-full rounded-lg border border-[color-mix(in_srgb,#B4780A_14%,transparent)] bg-[#18150A] px-2 py-2 text-sm text-[#F5E9C8] outline-none focus:border-[color-mix(in_srgb,#D4920A_45%,transparent)]" /></label>
        <label className="text-[11px] uppercase tracking-wide text-[#9E8B55]">Position<select value={overlay.position} onChange={(event) => set('position', event.target.value as OverlayPosition)} className="mt-1 w-full rounded-lg border border-white/10 bg-[#18150A] px-2 py-2 text-sm text-[#F5E9C8] outline-none">{positions.map((position) => <option key={position}>{position}</option>)}</select></label>
      </div>
      {overlay.type === 'comparison_card' ? (
        <>
          <input value={overlay.textContent || ''} onChange={(event) => set('textContent', event.target.value)} placeholder="Comparison heading" className="mb-3 w-full rounded-xl border border-[color-mix(in_srgb,#B4780A_14%,transparent)] bg-[#18150A] px-3 py-2 text-sm text-[#F5E9C8] outline-none focus:border-[color-mix(in_srgb,#D4920A_45%,transparent)]" />
          <ComparisonCard items={overlay.items || []} onChange={(items) => set('items', items)} />
        </>
      ) : (
        <div className="space-y-2">
          {overlay.textContent !== null && <textarea value={overlay.textContent || ''} onChange={(event) => set('textContent', event.target.value)} placeholder="Editable on-screen text" rows={2} className="w-full resize-none rounded-xl border border-[color-mix(in_srgb,#B4780A_14%,transparent)] bg-[#18150A] px-3 py-2 text-sm text-[#F5E9C8] outline-none focus:border-[color-mix(in_srgb,#D4920A_45%,transparent)]" />}
          {overlay.imagePrompt !== null && <textarea value={overlay.imagePrompt || ''} onChange={(event) => set('imagePrompt', event.target.value)} placeholder="Image prompt" rows={2} className="w-full resize-none rounded-xl border border-[color-mix(in_srgb,#B4780A_14%,transparent)] bg-[#18150A] px-3 py-2 text-sm text-[#3D2800] outline-none focus:border-[color-mix(in_srgb,#D4920A_45%,transparent)]" />}
          {overlay.motionPrompt !== null && <textarea value={overlay.motionPrompt || ''} onChange={(event) => set('motionPrompt', event.target.value)} placeholder="Motion direction" rows={2} className="w-full resize-none rounded-xl border border-[color-mix(in_srgb,#B4780A_14%,transparent)] bg-[#18150A] px-3 py-2 text-sm text-[#3D2800] outline-none focus:border-[color-mix(in_srgb,#D4920A_45%,transparent)]" />}
        </div>
      )}
    </article>
  );
}
