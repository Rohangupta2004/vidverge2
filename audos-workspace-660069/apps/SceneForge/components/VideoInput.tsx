import { Clipboard, Film, Link2 } from 'lucide-react';

interface Props {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  onError?: (message: string) => void;
}

export default function VideoInput({ value, onChange, disabled, onError }: Props) {
  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      onChange(text.trim());
    } catch {
      onError?.('Clipboard access was blocked. Paste the HeyGen URL into the field.');
    }
  };

  return (
    <section className="rounded-3xl border border-[color-mix(in_srgb,#B4780A_14%,transparent)] bg-[#15120A] p-6 shadow-2xl shadow-[rgba(0,0,0,0.4)]">
      <div className="mb-4 flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-[color-mix(in_srgb,#D4920A_12%,transparent)] text-[#D4920A]"><Film size={20} /></div>
        <div><h2 className="font-semibold text-[#F5E9C8]">HeyGen video</h2><p className="text-sm text-[#9E8B55]">Layer 1 · the presenter stays visible throughout</p></div>
      </div>
      <div className="flex gap-2 rounded-2xl border border-[color-mix(in_srgb,#B4780A_14%,transparent)] bg-[#18150A] p-2 focus-within:border-[color-mix(in_srgb,#D4920A_50%,transparent)]">
        <Link2 className="ml-2 mt-3 shrink-0 text-[#9E8B55]" size={20} />
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          placeholder="https://.../heygen-video.mp4"
          className="min-w-0 flex-1 bg-transparent px-2 py-3 text-base text-[#F5E9C8] outline-none placeholder:text-[#9E8B55]"
        />
        <button onClick={paste} disabled={disabled} className="flex items-center gap-2 rounded-xl border border-[color-mix(in_srgb,#B4780A_14%,transparent)] px-4 text-sm font-semibold text-[#3D2800] transition hover:border-[color-mix(in_srgb,#D4920A_40%,transparent)] hover:text-[#D4920A] disabled:opacity-40"><Clipboard size={16} /> Paste</button>
      </div>
      {value && (
        <div className="mt-5 overflow-hidden rounded-2xl border border-[color-mix(in_srgb,#B4780A_14%,transparent)] bg-black">
          <video src={value} controls preload="metadata" className="aspect-video w-full object-contain" onError={() => onError?.('This URL could not be previewed. Use a direct, publicly accessible MP4 URL.')} />
        </div>
      )}
    </section>
  );
}
