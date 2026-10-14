import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

const HEYGEN_CSS = `
.vv-skeleton {
  background: linear-gradient(90deg, rgba(212,146,10,0.07), rgba(212,146,10,0.16), rgba(212,146,10,0.07));
  background-size: 220% 100%;
  animation: vv-skeleton 1.4s ease-in-out infinite;
}
@keyframes vv-skeleton {
  from { background-position: 180% 0; }
  to { background-position: -40% 0; }
}
@media (prefers-reduced-motion: reduce) {
  .vv-skeleton { animation: none; }
}
`;

interface HeygenSectionProps {
  title: string;
  summary: string;
  icon: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

export default function HeygenSection({ title, summary, icon, open, onToggle, children }: HeygenSectionProps) {
  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--vv-border)] bg-[var(--vv-surface)]">
      <style>{HEYGEN_CSS}</style>

      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[rgba(212,146,10,0.07)]"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--vv-gold)_14%,transparent)] text-[var(--vv-gold)]">
          {icon}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[13px] text-[#F5E9C8]">{title}</span>
            <span className="shrink-0 rounded-full border border-[var(--vv-border)] px-1.5 py-[1px] text-[9px] uppercase tracking-[0.18em] text-[#9E8B55]">
              Optional
            </span>
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-[var(--vv-text-dim)]">{summary}</span>
        </span>

        <ChevronDown
          size={15}
          className={`shrink-0 text-[#9E8B55] transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && <div className="border-t border-[var(--vv-border)] px-4 py-3.5">{children}</div>}
    </section>
  );
}
