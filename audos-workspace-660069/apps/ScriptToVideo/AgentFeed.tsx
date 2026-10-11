/**
 * The live agent feed — the differentiator.
 *
 * Every step of the run is written out as it happens, the way a coding agent
 * writes to its terminal: a bullet with a spinner while it works, a checkmark
 * when it lands, a red cross when it does not, and one honest line underneath
 * saying what actually came back. The feed persists after the run, so the
 * customer can read back what the agent did.
 */
import { Check, Loader2, RotateCcw, X } from 'lucide-react';
import { T, fmtDuration } from './studio';

export type StepKey = 'plan' | 'compose' | 'validate' | 'narrate' | 'render';
export type StepState = 'idle' | 'running' | 'done' | 'failed';

export interface FeedStep {
  key: StepKey;
  label: string;
  state: StepState;
  lines: string[];
  error?: string;
  startedAt?: number;
  endedAt?: number;
}

export const FEED_CSS = `
@keyframes sv-spin { to { transform: rotate(360deg); } }
@keyframes sv-pulse { 0%, 100% { opacity: 0.45; } 50% { opacity: 1; } }
@keyframes sv-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
.sv-spin { animation: sv-spin 0.9s linear infinite; }
.sv-pulse { animation: sv-pulse 1.4s ease-in-out infinite; }
.sv-in { animation: sv-in 0.28s cubic-bezier(0.16, 1, 0.3, 1) both; }
.sv-retry:hover { background: ${T.amberSoft} !important; color: ${T.amber} !important; border-color: ${T.borderLit} !important; }
@media (prefers-reduced-motion: reduce) {
  .sv-spin, .sv-pulse, .sv-in { animation: none !important; }
}
`;

function bulletColor(state: StepState): string {
  if (state === 'running') return T.amber;
  if (state === 'done') return T.text;
  if (state === 'failed') return T.fail;
  return T.dim;
}

function StepBullet({ state }: { state: StepState }) {
  const color = bulletColor(state);
  if (state === 'done') return <Check size={13} color={color} strokeWidth={3} />;
  if (state === 'failed') return <X size={13} color={color} strokeWidth={3} />;
  return (
    <span
      className={state === 'running' ? 'sv-pulse' : undefined}
      style={{ width: 7, height: 7, borderRadius: 999, background: color, display: 'block' }}
    />
  );
}

function StepRow({ step, onRetry }: { step: FeedStep; onRetry?: (key: StepKey) => void }) {
  const color = bulletColor(step.state);
  const elapsed = step.startedAt && step.endedAt ? fmtDuration(step.endedAt - step.startedAt) : '';
  return (
    <div className="sv-in" style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 14, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
          <StepBullet state={step.state} />
        </span>
        <span style={{ color, fontSize: 13, fontWeight: step.state === 'running' ? 600 : 500, letterSpacing: -0.1 }}>
          {step.label}
        </span>
        {step.state === 'running' ? <Loader2 className="sv-spin" size={13} color={T.amber} /> : null}
        {elapsed ? <span style={{ color: T.dim, fontSize: 11 }}>{elapsed}</span> : null}
      </div>

      {step.lines.map((line, index) => (
        <div key={`${step.key}-line-${index}`} className="sv-in" style={{ display: 'flex', gap: 8, marginTop: 6, paddingLeft: 24 }}>
          <span style={{ color: T.dim, fontSize: 12, flexShrink: 0 }}>└─</span>
          <span style={{ color: T.muted, fontSize: 12, lineHeight: 1.55, wordBreak: 'break-word' }}>{line}</span>
        </div>
      ))}

      {step.error ? (
        <div className="sv-in" style={{ display: 'flex', gap: 8, marginTop: 6, paddingLeft: 24 }}>
          <span style={{ color: T.fail, fontSize: 12, flexShrink: 0 }}>└─</span>
          <span style={{ color: T.fail, fontSize: 12, lineHeight: 1.55, wordBreak: 'break-word' }}>{step.error}</span>
        </div>
      ) : null}

      {step.state === 'failed' && onRetry ? (
        <div style={{ paddingLeft: 24, marginTop: 9 }}>
          <button
            className="sv-retry"
            onClick={() => onRetry(step.key)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'transparent', border: `1px solid ${T.border}`, color: T.muted,
              borderRadius: 8, padding: '6px 11px', fontFamily: T.mono, fontSize: 11.5,
              cursor: 'pointer', transition: 'background 0.16s ease, color 0.16s ease, border-color 0.16s ease',
            }}
          >
            <RotateCcw size={11} /> Retry from here
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function AgentFeed({
  steps,
  onRetry,
  idle,
}: {
  steps: FeedStep[];
  onRetry?: (key: StepKey) => void;
  idle: boolean;
}) {
  return (
    <div
      style={{
        position: 'relative',
        borderRadius: 16,
        border: `1px solid ${T.border}`,
        background: `linear-gradient(160deg, ${T.cardStrong}, ${T.card})`,
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        padding: '18px 18px 8px',
        fontFamily: T.mono,
        minHeight: 260,
        boxShadow: '0 24px 60px -32px rgba(120,80,0,0.22)',
      }}
    >
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16,
          paddingBottom: 12, borderBottom: `1px solid ${T.border}`,
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: 999, background: T.amber }} />
        <span style={{ color: T.muted, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          Agent feed
        </span>
      </div>

      {idle ? (
        <div style={{ color: T.dim, fontSize: 12.5, lineHeight: 1.8, paddingBottom: 12 }}>
          <div>Waiting for a brief.</div>
          <div style={{ marginTop: 10, color: T.dim }}>The agent will:</div>
          <div style={{ paddingLeft: 12, marginTop: 4 }}>
            <div>└─ plan the scenes</div>
            <div>└─ write the Remotion composition</div>
            <div>└─ validate the code before it renders</div>
            <div>└─ film the background and composite the MP4</div>
          </div>
        </div>
      ) : (
        steps.map((step) => <StepRow key={step.key} step={step} onRetry={onRetry} />)
      )}
    </div>
  );
}
