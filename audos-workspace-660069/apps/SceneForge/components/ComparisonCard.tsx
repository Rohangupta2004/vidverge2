import { Plus, Trash2 } from 'lucide-react';
import type { ComparisonItem } from '../types';

interface Props {
  items: ComparisonItem[];
  onChange: (items: ComparisonItem[]) => void;
}

export default function ComparisonCard({ items, onChange }: Props) {
  const update = (id: string, patch: Partial<ComparisonItem>) => onChange(items.map((item) => item.id === id ? { ...item, ...patch } : item));
  const remove = (id: string) => onChange(items.filter((item) => item.id !== id));
  const add = () => onChange([...items, { id: `item_${Date.now()}`, label: 'New comparison', value: '✓', highlight: false }]);
  const twoColumn = items.length > 5 || items.some((item) => item.label.length > 30);

  return (
    <div className="rounded-2xl border border-[color-mix(in_srgb,#B4780A_16%,transparent)] bg-gradient-to-br from-[#FFFFFF] to-[#FFF3D6] p-4">
      <div className={`grid gap-2 ${twoColumn ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
        {items.map((item) => (
          <div key={item.id} className={`group flex items-center gap-2 rounded-xl border p-2 ${item.highlight ? 'border-[color-mix(in_srgb,#C8920A_34%,transparent)] bg-[color-mix(in_srgb,#C8920A_10%,transparent)] shadow-[0_0_18px_rgba(200,146,10,.14)]' : 'border-[color-mix(in_srgb,#B4780A_12%,transparent)] bg-[#FFFFFF]'}`}>
            <input aria-label="Comparison label" value={item.label} onChange={(event) => update(item.id, { label: event.target.value })} className="min-w-0 flex-1 bg-transparent px-2 py-1 text-sm font-medium text-[#1A1000] outline-none" />
            <input aria-label="Comparison value" value={item.value} onChange={(event) => update(item.id, { value: event.target.value })} className={`w-14 bg-transparent text-center text-lg font-black outline-none ${item.value.includes('✗') ? 'text-[#991B1B]' : 'text-[#C8920A]'}`} />
            <button title="Toggle highlight" onClick={() => update(item.id, { highlight: !item.highlight })} className={`h-6 w-6 rounded-full border text-[10px] ${item.highlight ? 'border-[#C8920A] bg-[#C8920A] text-white' : 'border-[color-mix(in_srgb,#B4780A_26%,transparent)] text-[#7A6030]'}`}>★</button>
            <button title="Delete row" onClick={() => remove(item.id)} className="text-[#7A6030] transition hover:text-[#991B1B]"><Trash2 size={15} /></button>
          </div>
        ))}
      </div>
      <button onClick={add} className="mt-3 flex items-center gap-2 text-xs font-semibold text-[#C8920A] transition hover:text-[#B4720A]"><Plus size={14} /> Add row</button>
    </div>
  );
}
