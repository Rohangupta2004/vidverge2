import MotionWave from './MotionWave';
import AgentStatus from './AgentStatus';
import type { AgentState } from '../types';

interface AgentCanvasProps {
  agentState: AgentState;
  statusLabel: string;
  calm?: boolean;
}

export default function AgentCanvas({ agentState, statusLabel, calm = false }: AgentCanvasProps) {
  return (
    <section className="relative w-full">
      <div className="pointer-events-none absolute inset-x-0 -top-16 h-64 bg-[radial-gradient(ellipse_55%_100%_at_50%_0%,rgba(212,146,10,0.12),transparent_70%)]" />

      <div className="relative h-[clamp(210px,34vh,330px)] w-full">
        <MotionWave state={agentState} calm={calm} />
        <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2">
          <AgentStatus state={agentState} label={statusLabel} />
        </div>
      </div>
    </section>
  );
}
