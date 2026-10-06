import type { AgentState } from '../types';

const ACTIVITY_CSS = `
.vva-eq span {
  display: block;
  width: 2.5px;
  border-radius: 2px;
  background: var(--vv-gold, #F5A623);
  transform-origin: center bottom;
  animation: vva-eq 2.6s ease-in-out infinite;
}
.vva-eq span:nth-child(2) { animation-delay: 0.22s; }
.vva-eq span:nth-child(3) { animation-delay: 0.44s; }
.vva-eq span:nth-child(4) { animation-delay: 0.12s; }
.vva-activity[data-state='working'] .vva-eq span { animation-duration: 0.9s; }
.vva-activity[data-state='error'] .vva-eq span { background: var(--vv-error, #f97316); }
.vva-line { animation: vva-line-in 420ms ease-out both; }
@keyframes vva-eq {
  0%, 100% { transform: scaleY(0.3); opacity: 0.45; }
  50% { transform: scaleY(1); opacity: 1; }
}
@keyframes vva-line-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .vva-eq span, .vva-line { animation: none; }
}
`;

interface AgentActivityProps {
  state: AgentState;
  lines: string[];
}

export default function AgentActivity({ state, lines }: AgentActivityProps) {
  const headline =
    state === 'working'
      ? 'Working'
      : state === 'completed'
        ? 'Just finished'
        : state === 'error'
          ? 'Held up'
          : 'Listening';

  return (
    <div
      data-state={state}
      className="vva-activity rounded-xl border border-[var(--vv-border)] bg-[var(--vv-surface)] px-3.5 py-3"
    >
      <style>{ACTIVITY_CSS}</style>

      <div className="flex items-center gap-2.5">
        <span className="vva-eq flex h-4 items-end gap-[3px]">
          <span style={{ height: '100%' }} />
          <span style={{ height: '65%' }} />
          <span style={{ height: '85%' }} />
          <span style={{ height: '50%' }} />
        </span>
        <span className="text-[11px] uppercase tracking-[0.3em] text-[var(--vv-text-dim)]">{headline}</span>
      </div>

      <ul className="mt-3 space-y-1.5">
        {lines.slice(0, 3).map((line, index) => (
          <li
            key={`${line}-${index}`}
            className="vva-line flex items-start gap-2 text-[12px] leading-snug"
            style={{ color: index === 0 ? 'rgba(255,255,255,0.72)' : 'var(--vv-text-dim)' }}
          >
            <span
              className="mt-[6px] h-1 w-1 shrink-0 rounded-full"
              style={{ background: index === 0 ? 'var(--vv-gold, #F5A623)' : 'rgba(255,255,255,0.2)' }}
            />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
