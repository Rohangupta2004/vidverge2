/**
 * Director — a project-aware, tool-using film agent. It reads the complete
 * saved film every turn, shows every tool step, and stages every mutation for
 * explicit approval. Conversation memory is persisted inside the film's
 * existing plan JSON (the workspace is at its table limit).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronUp, CornerDownLeft, Eye, Loader2, Sparkles, Undo2, X } from 'lucide-react';
import { AssetRow, Film, FilmScene, T, db } from './api';
import {
  AgentMessage, AgentMetrics, AgentProposal, AgentStep, AgentUndo,
  FILM_DIRECTOR_MODEL, proactiveIssue, runFilmAgentTurn,
} from './assistantRuntime';

const EMPTY_METRICS: AgentMetrics = { model: FILM_DIRECTOR_MODEL, durationsMs: [] };

function nextMessage(role: AgentMessage['role'], text: string): AgentMessage {
  return { id: `director_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`, role, text, createdAt: new Date().toISOString() };
}

function StepRow({ step }: { step: AgentStep }) {
  const color = step.state === 'failed' ? T.fault : step.state === 'done' ? T.done : T.live;
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color, fontSize: 11.5, lineHeight: 1.45 }}>
      <span style={{ width: 15, height: 15, flexShrink: 0, display: 'grid', placeItems: 'center', marginTop: 1 }}>
        {step.state === 'running' ? <Loader2 size={12} className="animate-spin" /> : step.state === 'failed' ? <X size={12} /> : step.state === 'awaiting_approval' ? <Eye size={12} /> : <Check size={12} />}
      </span>
      <span><strong style={{ fontWeight: 750 }}>{step.label}</strong>{step.detail ? <span style={{ color: T.muted }}> · {step.detail}</span> : null}</span>
    </div>
  );
}

function ProposalCard(props: {
  proposal: AgentProposal;
  undo?: AgentUndo;
  disabled: boolean;
  onApprove: () => void;
  onDecline: () => void;
  onUndo: () => void;
}) {
  const { proposal } = props;
  const pending = proposal.status === 'pending';
  const applied = proposal.status === 'applied';
  const tone = proposal.status === 'failed' ? T.fault : applied ? T.done : proposal.status === 'declined' || proposal.status === 'undone' ? T.dim : T.live;
  return (
    <div style={{ marginTop: 9, border: `1px solid ${tone}`, borderRadius: 10, padding: 11, background: T.canvas }}>
      <div style={{ color: T.bone, fontSize: 12.5, fontWeight: 800 }}>{proposal.title}</div>
      <div style={{ color: T.muted, fontSize: 11.5, lineHeight: 1.5, marginTop: 4 }}>{proposal.summary}</div>
      {proposal.costNotice ? <div style={{ color: T.live, fontSize: 11, lineHeight: 1.45, marginTop: 6 }}>{proposal.costNotice}</div> : null}
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 9 }}>
        {pending ? <>
          <button disabled={props.disabled} onClick={props.onApprove} style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', gap: 6, background: T.live, color: '#1B1308', border: 'none', borderRadius: 8, padding: '9px 14px', fontSize: 11.5, fontWeight: 800, cursor: props.disabled ? 'default' : 'pointer' }}><Check size={12} />Apply fix</button>
          <button disabled={props.disabled} onClick={props.onDecline} style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', color: T.muted, border: `1px solid ${T.dim}`, borderRadius: 8, padding: '9px 14px', fontSize: 11.5, cursor: props.disabled ? 'default' : 'pointer' }}><X size={12} />Dismiss</button>
        </> : null}
        {applied && props.undo ? <button disabled={props.disabled} onClick={props.onUndo} style={{ minHeight: 36, display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', color: T.bone, border: `1px solid ${T.dim}`, borderRadius: 8, padding: '7px 12px', fontSize: 11.5, cursor: props.disabled ? 'default' : 'pointer' }}><Undo2 size={12} />Undo</button> : null}
        {!pending ? <span style={{ alignSelf: 'center', color: tone, fontSize: 11, fontWeight: 750 }}>{proposal.status.replace(/_/g, ' ')}</span> : null}
      </div>
    </div>
  );
}

export default function AgentPanel(props: {
  film: Film;
  scenes: FilmScene[];
  busy: boolean;
  onExecute: (proposal: AgentProposal) => Promise<{ message: string; undo?: AgentUndo }>;
  onUndo: (undo: AgentUndo) => Promise<string>;
  onPersist: (messages: AgentMessage[], metrics: AgentMetrics, trimNotice?: string) => Promise<void>;
}) {
  const memory = (props.film.plan as any)?.assistant || null;
  const [messages, setMessages] = useState<AgentMessage[]>(() => Array.isArray(memory?.messages) ? memory.messages : []);
  const [metrics, setMetrics] = useState<AgentMetrics>(() => memory?.metrics || EMPTY_METRICS);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [input, setInput] = useState('');
  const [working, setWorking] = useState(false);
  const [workingSteps, setWorkingSteps] = useState<AgentStep[]>([]);
  const [error, setError] = useState('');
  const [contextNotice, setContextNotice] = useState<string>(() => String(memory?.trimNotice || memory?.trim_notice || ''));
  const [open, setOpen] = useState(true);
  const bottom = useRef<HTMLDivElement | null>(null);
  const filmId = props.film.id;

  useEffect(() => {
    const next = (props.film.plan as any)?.assistant;
    setMessages(Array.isArray(next?.messages) ? next.messages : []);
    setMetrics(next?.metrics || EMPTY_METRICS);
    setError(''); setContextNotice(String(next?.trimNotice || next?.trim_notice || '')); setWorkingSteps([]); setInput('');
    void db.listAssets(filmId).then(setAssets).catch((caught) => setError(`Project assets could not be read: ${String(caught?.message || caught)}`));
  }, [filmId]);

  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest' }); }, [messages.length, workingSteps.length, open]);

  const issue = useMemo(() => proactiveIssue(props.film, props.scenes), [props.film.updated_at, props.film.status, props.scenes]);
  const disabled = working || props.busy;

  async function persist(nextMessages: AgentMessage[], nextMetrics = metrics, trimNotice?: string) {
    setMessages(nextMessages); setMetrics(nextMetrics);
    if (trimNotice) setContextNotice(trimNotice);
    await props.onPersist(nextMessages, nextMetrics, trimNotice);
  }

  async function send(explicit?: string) {
    const asked = String(explicit ?? input).trim();
    if (!asked || disabled) return;
    setWorking(true); setError(''); setWorkingSteps([]); setInput('');
    const user = nextMessage('user', asked);
    const withUser = [...messages, user];
    try {
      await persist(withUser);
      const result = await runFilmAgentTurn({
        film: props.film,
        scenes: props.scenes,
        assets,
        history: messages,
        userText: asked,
        metrics,
        onSteps: setWorkingSteps,
      });
      const assistant: AgentMessage = { ...nextMessage('assistant', result.text), steps: result.steps, proposal: result.proposal };
      await persist([...withUser, assistant], result.metrics, result.trimNotice);
      setWorkingSteps([]);
    } catch (caught: any) {
      const message = String(caught?.message || caught);
      const lengthFailure = /input exceeds|input_too_large|body_too_large|compacted request is still too large/i.test(message);
      const visible = lengthFailure ? 'The Director compacted this film’s context but still could not finish the diagnosis. Your saved chat is intact. Try the scene-only diagnosis again.' : message;
      setError(visible);
      if (lengthFailure) setContextNotice('Context compacted aggressively; the system prompt, latest turn and current-scene evidence were preserved.');
      const assistant = { ...nextMessage('assistant', lengthFailure ? visible : `I could not complete that turn: ${visible}`), steps: workingSteps };
      try { await persist([...withUser, assistant]); } catch { /* the visible error remains */ }
    } finally {
      setWorking(false);
    }
  }

  async function updateProposal(messageId: string, action: 'approve' | 'decline' | 'undo') {
    if (disabled) return;
    const target = messages.find((message) => message.id === messageId);
    if (!target?.proposal) return;
    setWorking(true); setError('');
    try {
      let nextProposal = { ...target.proposal };
      let undo = target.undo;
      let resultText = '';
      if (action === 'decline') {
        nextProposal.status = 'declined'; resultText = 'Declined. No project data changed.';
      } else if (action === 'approve') {
        const result = await props.onExecute(target.proposal);
        nextProposal.status = 'applied'; undo = result.undo; resultText = result.message;
      } else {
        if (!undo) throw new Error('This action has no reversible snapshot.');
        resultText = await props.onUndo(undo); nextProposal.status = 'undone'; undo = undefined;
      }
      const nextMessages = messages.map((message) => message.id === messageId ? { ...message, proposal: nextProposal, undo, text: `${message.text}\n\n${resultText}` } : message);
      await persist(nextMessages);
    } catch (caught: any) {
      const message = String(caught?.message || caught);
      setError(message);
      const nextMessages = messages.map((item) => item.id === messageId && item.proposal ? { ...item, proposal: { ...item.proposal, status: 'failed' as const }, text: `${item.text}\n\nAction failed: ${message}` } : item);
      try { await persist(nextMessages); } catch { /* visible error remains */ }
    } finally { setWorking(false); }
  }

  return (
    <section style={{ flexShrink: 0, borderTop: `1px solid ${T.line}`, background: T.canvas }}>
      <button type="button" onClick={() => setOpen((value) => !value)} style={{ width: '100%', minHeight: 44, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', background: T.raised, color: T.bone, border: 'none', borderBottom: open ? `1px solid ${T.line}` : 'none', cursor: 'pointer', textAlign: 'left' }}>
        <Sparkles size={14} color={T.live} />
        <span style={{ fontSize: 12.5, fontWeight: 800 }}>Director</span>
        <span style={{ color: T.dim, fontSize: 11 }}>Opus 5 · project tools · saved per film</span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 7, color: issue ? T.live : T.dim, fontSize: 10.5 }}>{issue ? <><AlertTriangle size={11} />needs review</> : null}{open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}</span>
      </button>

      {open ? <div className="s2v-director-layout" style={{ maxWidth: 980, margin: '0 auto', padding: '12px 16px 14px', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10 }}>
        {issue ? <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, background: 'color-mix(in srgb, var(--space-semantic-warning-500) 10%, var(--space-surface-bg))', border: `1px solid ${T.live}`, borderRadius: 10, padding: 10 }}>
          <AlertTriangle size={14} color={T.live} style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ minWidth: 0, flex: 1 }}><div style={{ color: T.bone, fontSize: 11.8, lineHeight: 1.45 }}>{issue.text}</div><button disabled={disabled} onClick={() => void send(issue.prompt)} style={{ marginTop: 7, minHeight: 44, display: 'inline-flex', alignItems: 'center', gap: 6, background: T.live, color: '#1B1308', border: 'none', borderRadius: 7, padding: '9px 12px', fontSize: 11, fontWeight: 800, cursor: disabled ? 'default' : 'pointer' }}>{working ? <Loader2 size={12} className="animate-spin" /> : <Eye size={11} />}{working ? 'Diagnosing this scene…' : 'Diagnose from evidence'}</button></div>
        </div> : null}

        <div style={{ maxHeight: 300, overflowY: 'auto', display: 'grid', gap: 8, paddingRight: 2 }}>
          {!messages.length ? <div style={{ color: T.muted, fontSize: 12, lineHeight: 1.55, padding: '3px 1px' }}>Ask about the saved brief, cast, plan, scene status or a failed clip. I can propose edits, regenerate one scene, approve the plan, or start and stop the durable render. Every tool step is visible; changes wait for your approval.</div> : null}
          {messages.map((message) => (
            <div key={message.id} style={{ justifySelf: message.role === 'user' ? 'end' : 'stretch', maxWidth: message.role === 'user' ? '82%' : '100%', background: message.role === 'user' ? T.live : T.raised, color: message.role === 'user' ? '#1B1308' : T.bone, border: message.role === 'user' ? 'none' : `1px solid ${T.line}`, borderRadius: 10, padding: '9px 11px' }}>
              <div style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.55 }}>{message.text}</div>
              {message.steps?.length ? <div style={{ display: 'grid', gap: 5, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${T.line}` }}>{message.steps.map((step) => <StepRow key={step.id} step={step} />)}</div> : null}
              {message.proposal ? <ProposalCard proposal={message.proposal} undo={message.undo} disabled={disabled} onApprove={() => void updateProposal(message.id, 'approve')} onDecline={() => void updateProposal(message.id, 'decline')} onUndo={() => void updateProposal(message.id, 'undo')} /> : null}
            </div>
          ))}
          {workingSteps.length ? <div style={{ background: T.raised, border: `1px solid ${T.line}`, borderRadius: 10, padding: 10, display: 'grid', gap: 5 }}>{workingSteps.map((step) => <StepRow key={step.id} step={step} />)}</div> : null}
          {working && !workingSteps.length ? <div style={{ color: T.live, display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5 }}><Loader2 size={13} className="animate-spin" />Reading the current film…</div> : null}
          <div ref={bottom} />
        </div>

        {contextNotice ? <div role="status" style={{ color: T.muted, fontSize: 11.5, lineHeight: 1.45, display: 'flex', alignItems: 'flex-start', gap: 7, background: 'color-mix(in srgb, var(--space-brand-primary-500) 8%, transparent)', border: `1px solid ${T.line}`, borderRadius: 9, padding: '8px 10px' }}><Check size={13} color={T.live} style={{ flexShrink: 0, marginTop: 2 }} /><span><b style={{ color: T.bone }}>Context compacted.</b> {contextNotice}</span></div> : null}
        {error ? <div role="alert" style={{ color: T.fault, fontSize: 11.5, lineHeight: 1.45, display: 'flex', alignItems: 'flex-start', gap: 7 }}><AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 2 }} />{error}</div> : null}

        <div style={{ position: 'sticky', bottom: 0, zIndex: 3, display: 'flex', gap: 8, alignItems: 'center', background: T.raised, border: `1px solid ${T.dim}`, borderRadius: 10, padding: '4px 5px 4px 10px', boxShadow: '0 -10px 24px color-mix(in srgb, var(--space-surface-bg) 82%, transparent)' }}>
          <Sparkles size={14} color={T.live} style={{ flexShrink: 0 }} />
          <input value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="Ask about this film or propose an action…" disabled={disabled} style={{ minWidth: 0, flex: 1, background: 'transparent', border: 'none', outline: 'none', color: T.bone, fontSize: 12.5, padding: '9px 0' }} />
          <button type="button" onClick={() => void send()} disabled={disabled || !input.trim()} aria-label="Send to Director" style={{ minWidth: 40, minHeight: 38, display: 'grid', placeItems: 'center', background: input.trim() && !disabled ? T.live : 'transparent', color: input.trim() && !disabled ? '#1B1308' : T.dim, border: 'none', borderRadius: 8, cursor: input.trim() && !disabled ? 'pointer' : 'default' }}>{working ? <Loader2 size={13} className="animate-spin" /> : <CornerDownLeft size={13} />}</button>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {['What is blocking this film?', 'Summarize the scene plan', 'Check cast consistency'].map((label) => <button key={label} disabled={disabled} onClick={() => void send(label)} style={{ background: 'transparent', color: T.muted, border: `1px solid ${T.line}`, borderRadius: 999, padding: '5px 9px', fontSize: 10.5, cursor: disabled ? 'default' : 'pointer' }}>{label}</button>)}
          {metrics.durationsMs.length ? <span title="Measured successful Anthropic proxy calls for this film" style={{ marginLeft: 'auto', alignSelf: 'center', color: T.dim, fontSize: 10 }}>measured {metrics.durationsMs.length} call{metrics.durationsMs.length === 1 ? '' : 's'}{metrics.contextCompactions ? ` · compacted ${metrics.contextCompactions}` : ''}</span> : null}
        </div>
      </div> : null}
    </section>
  );
}
