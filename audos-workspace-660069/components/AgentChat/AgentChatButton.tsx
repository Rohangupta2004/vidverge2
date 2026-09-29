/**
 * AgentChatButton — the floating gradient-orb launcher, fixed bottom-right.
 * Morphs to a close (×) affordance while the panel is open, and shows a
 * "Chat with Vidverge Agent" tooltip on hover.
 */
import { GradientOrb } from './GradientOrb';
import { useAgentChat } from './AgentChatContext';

const BUTTON_CSS = `
.vv-agent-fab { transition: transform 0.2s ease; }
.vv-agent-fab:hover { transform: translateY(-2px); }
.vv-agent-fab .vv-agent-tip { position: absolute; right: calc(100% + 10px); top: 50%; transform: translateY(-50%) translateX(4px); background: #12141d; color: #e2e8f0; border: 1px solid rgba(148, 163, 184, 0.22); border-radius: 9px; padding: 6px 10px; font-size: 11.5px; font-weight: 600; white-space: nowrap; opacity: 0; pointer-events: none; transition: opacity 0.18s ease, transform 0.18s ease; }
.vv-agent-fab:hover .vv-agent-tip { opacity: 1; transform: translateY(-50%) translateX(0); }
.vv-agent-fab .vv-agent-x { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #ffffff; font-size: 22px; font-weight: 600; line-height: 1; text-shadow: 0 1px 6px rgba(0, 0, 0, 0.6); transition: opacity 0.22s ease, transform 0.22s ease; }
`;

export function AgentChatButton() {
  const { isOpen, togglePanel, isThinking } = useAgentChat();
  return (
    <button
      type="button"
      onClick={togglePanel}
      aria-label={isOpen ? 'Close Vidverge Agent' : 'Chat with Vidverge Agent'}
      className="vv-agent-fab"
      style={{ position: 'fixed', right: 24, bottom: 24, zIndex: 9999, width: 48, height: 48, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}
    >
      <style>{BUTTON_CSS}</style>
      <GradientOrb size="md" thinking={isThinking} idle={!isOpen && !isThinking} />
      <span
        aria-hidden
        className="vv-agent-x"
        style={{ opacity: isOpen ? 1 : 0, transform: isOpen ? 'rotate(0deg) scale(1)' : 'rotate(-90deg) scale(0.5)' }}
      >
        ×
      </span>
      {!isOpen ? <span aria-hidden className="vv-agent-tip">Chat with Vidverge Agent</span> : null}
    </button>
  );
}

export default AgentChatButton;
