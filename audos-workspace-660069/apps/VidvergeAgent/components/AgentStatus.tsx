import { useEffect, useRef, useState } from 'react';
import type { AgentState } from '../types';

const DOT_COLOR: Record<AgentState, string> = {
  idle: 'var(--vv-success, #166534)',
  working: 'var(--vv-gold, #C8920A)',
  completed: 'var(--vv-success, #166534)',
  error: 'var(--vv-error, #991B1B)',
};

const STATUS_CSS = `
.vva-status-dot { animation: vva-status-pulse 2.8s ease-in-out infinite; }
.vva-status[data-state='working'] .vva-status-dot { animation-duration: 1.1s; }
@keyframes vva-status-pulse {
  0%, 100% { opacity: 0.45; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .vva-status-dot { animation: none; }
}
`;

interface AgentStatusProps {
  state: AgentState;
  label: string;
  name?: string;
  className?: string;
}

export default function AgentStatus({ state, label, name = 'VIDVERGE', className = '' }: AgentStatusProps) {
  const [shown, setShown] = useState(label);
  const [visible, setVisible] = useState(true);
  const timerRef = useRef<number | null>(null);

  // Cross-fade rather than swapping the text instantly.
  useEffect(() => {
    if (label === shown) return;
    setVisible(false);
    timerRef.current = window.setTimeout(() => {
      setShown(label);
      setVisible(true);
    }, 170);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [label, shown]);

  return (
    <div data-state={state} className={`vva-status select-none text-center ${className}`}>
      <style>{STATUS_CSS}</style>
      <div className="text-[10px] font-medium uppercase tracking-[0.42em] text-[var(--vv-text-dim)]">{name}</div>
      <div
        className="mt-2 flex items-center justify-center gap-2 transition-opacity duration-200"
        style={{ opacity: visible ? 1 : 0 }}
      >
        <span
          className="vva-status-dot h-1.5 w-1.5 rounded-full"
          style={{ background: DOT_COLOR[state], boxShadow: `0 0 10px ${DOT_COLOR[state]}` }}
        />
        <span className="text-[13px] text-[#3D2800]">{shown}</span>
      </div>
    </div>
  );
}
