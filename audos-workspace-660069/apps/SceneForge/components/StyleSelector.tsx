import type { ImageStyle } from '../types';

const styles: ImageStyle[] = ['Cinematic', 'Minimalist', 'Bold', 'Neon', 'Corporate'];

export default function StyleSelector({ value, onChange, disabled }: { value: ImageStyle; onChange: (style: ImageStyle) => void; disabled?: boolean }) {
  return (
    <section className="rounded-3xl border border-[color-mix(in_srgb,#B4780A_14%,transparent)] bg-[#FFFFFF] p-6">
      <div className="mb-4"><h2 className="font-semibold text-[#1A1000]">Visual direction</h2><p className="text-sm text-[#7A6030]">Applied consistently to every generated visual</p></div>
      <div className="flex flex-wrap gap-2">
        {styles.map((style) => (
          <button key={style} disabled={disabled} onClick={() => onChange(style)} className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${value === style ? 'border-[#C8920A] bg-[#C8920A] text-white shadow-lg shadow-[rgba(200,146,10,0.2)]' : 'border-[color-mix(in_srgb,#B4780A_14%,transparent)] bg-[#FFFAEB] text-[#7A6030] hover:border-[color-mix(in_srgb,#C8920A_40%,transparent)] hover:text-[#1A1000]'} disabled:opacity-40`}>
            {style}
          </button>
        ))}
      </div>
    </section>
  );
}
