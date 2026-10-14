/**
 * ThinkingSteps — a live, collapsible list of agent thinking steps.
 * Active step shows animated typing dots; done steps fade with a ✓ prefix;
 * error steps get a red ✗. Items stagger-fade in (80ms apart).
 * Collapses by default once every step is settled (unless still streaming).
 */
import { useState } from 'react';

export interface ThinkingStep {
  id: string;
  icon: string;
  text: string;
  status: 'pending' | 'active' | 'done' | 'error';
}

export interface ThinkingStepsProps {
  steps: ThinkingStep[];
  isStreaming?: boolean;
}

const STEPS_CSS = `
@keyframes vvStepIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
@keyframes vvDotBlink { 0%, 80%, 100% { opacity: 0.2; } 40% { opacity: 1; } }
.vv-think-list { animation: vvStepIn 0.28s ease both; }
.vv-think-item { display: flex; align-items: flex-start; gap: 8px; animation: vvStepIn 0.32s ease both; font-size: 12.5px; line-height: 1.5; }
.vv-think-dots i { display: inline-block; width: 4px; height: 4px; margin-left: 3px; border-radius: 50%; background: currentColor; animation: vvDotBlink 1.2s infinite; }
.vv-think-dots i:nth-child(2) { animation-delay: 0.2s; }
.vv-think-dots i:nth-child(3) { animation-delay: 0.4s; }
`;

export function ThinkingSteps({ steps, isStreaming = false }: ThinkingStepsProps) {
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  if (!steps.length) return null;
  const allSettled = steps.every((s) => s.status === 'done' || s.status === 'error');
  const open = userToggled ?? (isStreaming || !allSettled);

  return (
    <div style={{ borderRadius: 12, border: '1px solid rgba(148, 163, 184, 0.18)', background: 'rgba(184, 120, 8, 0.07)', overflow: 'hidden' }}>
      <style>{STEPS_CSS}</style>
      <button
        type="button"
        onClick={() => setUserToggled(!open)}
        style={{ display: 'flex', alignItems: 'center', gap: 7, width: '100%', padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', color: '#FFD168', fontSize: 11.5, fontWeight: 700, letterSpacing: 0.3, textAlign: 'left' }}
      >
        <span aria-hidden style={{ fontSize: 13 }}>{allSettled ? '💭' : '🤔'}</span>
        {allSettled ? `Thought for ${steps.length} steps` : `Thinking… (${steps.length} step${steps.length === 1 ? '' : 's'})`}
        <span style={{ marginLeft: 'auto', opacity: 0.7, fontSize: 10 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open ? (
        <div className="vv-think-list" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '2px 12px 10px' }}>
          {steps.map((step, i) => {
            const color = step.status === 'error' ? '#f87171' : step.status === 'done' ? 'rgba(203, 213, 225, 0.55)' : step.status === 'active' ? '#e2e8f0' : 'rgba(148, 163, 184, 0.5)';
            return (
              <div key={step.id} className="vv-think-item" style={{ color, animationDelay: `${i * 80}ms` }}>
                <span aria-hidden style={{ flexShrink: 0 }}>
                  {step.status === 'done' ? '✓' : step.status === 'error' ? '✗' : step.icon}
                </span>
                <span>
                  {step.status === 'done' ? `${step.icon} ` : ''}{step.text}
                  {step.status === 'active' ? (
                    <span className="vv-think-dots" aria-hidden><i /><i /><i /></span>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export default ThinkingSteps;
