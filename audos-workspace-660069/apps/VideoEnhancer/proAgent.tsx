/**
 * Vidverge Pro — the agent drawer.
 *
 * Slides in over the left edge of the preview. Six jobs the agent can do to
 * the edit, each one reporting idle / working / done / failed and each one
 * reversible with the editor's own undo stack, plus a chat box that routes a
 * typed instruction to whichever of them it matches.
 *
 * The routing is deliberately keyword-based rather than a model call: a
 * creator typing "add captions" should get captions instantly, not a round
 * trip. Anything the keywords do not recognise is handed to the editing model
 * through the studio's existing chat, which can propose real cut cards.
 */
import { useState, type ReactNode } from 'react';
import {
  AudioLines, Captions, Clapperboard, Loader2, Scissors, Send, Sparkles,
  Undo2, Wand2, X,
} from 'lucide-react';
import { StatusBadge, type RunState } from './proUi';

export type AgentActionId = 'enhance' | 'caption' | 'beat' | 'trim' | 'preset' | 'scene';

export interface AgentJob {
  state: RunState;
  note: string;
}

export type AgentJobs = Record<AgentActionId, AgentJob>;

export function emptyJobs(): AgentJobs {
  const blank: AgentJob = { state: 'idle', note: '' };
  return { enhance: blank, caption: blank, beat: blank, trim: blank, preset: blank, scene: blank };
}

const ACTIONS: { id: AgentActionId; label: string; blurb: string; Icon: typeof Wand2 }[] = [
  { id: 'enhance', label: 'Auto-enhance', blurb: 'Read the footage, then grade and move it to suit the content', Icon: Wand2 },
  { id: 'caption', label: 'Auto-caption', blurb: 'Transcribe with word timing and build the caption track', Icon: Captions },
  { id: 'beat', label: 'Beat sync', blurb: 'Measure the tempo and snap every cut onto the nearest beat', Icon: AudioLines },
  { id: 'trim', label: 'Smart trim', blurb: 'Find the silent and low-energy stretches and cut them out', Icon: Scissors },
  { id: 'preset', label: 'Apply preset', blurb: 'Set grade, captions, music and motion from one named look', Icon: Sparkles },
  { id: 'scene', label: 'Generate scene', blurb: 'Film a matched cutaway from a prompt and drop it on the timeline', Icon: Clapperboard },
];

/** Map a typed instruction onto an action. Returns null when nothing matches. */
export function routeInstruction(text: string): AgentActionId | null {
  const t = text.toLowerCase();
  if (/caption|subtitle|transcri|text on screen/.test(t)) return 'caption';
  if (/beat|bpm|tempo|rhythm|sync to music/.test(t)) return 'beat';
  if (/trim|silence|silent|dead air|tighten|shorten|cut the pauses|filler/.test(t)) return 'trim';
  if (/preset|style|look like|make it look/.test(t)) return 'preset';
  if (/generate|b-?roll|cutaway|scene|film a|make a clip/.test(t)) return 'scene';
  if (/enhance|improve|colou?r|grade|fix|polish|better/.test(t)) return 'enhance';
  return null;
}

export interface AgentProps {
  jobs: AgentJobs;
  running: AgentActionId | '';
  hasFootage: boolean;
  canUndo: boolean;
  chatBusy: boolean;
  messages: { id: string; role: 'user' | 'assistant'; content: string }[];
  presets: { id: string; label: string }[];
  /** The agentic workbench — cut plan, transcript, B-roll slots, editing chat. */
  children?: ReactNode;
  onClose: () => void;
  onRun: (id: AgentActionId) => void;
  onPreset: (id: string) => void;
  onUndo: () => void;
  onSend: (text: string) => void;
}

export default function ProAgent(props: AgentProps) {
  const [draft, setDraft] = useState('');
  const [presetOpen, setPresetOpen] = useState(false);

  const send = () => {
    const text = draft.trim();
    if (!text || props.chatBusy) return;
    setDraft('');
    props.onSend(text);
  };

  return (
    <>
      <div className="vp-scrim" onClick={props.onClose} />
      <aside className="vp-agent" aria-label="AI agent">
        <header className="vp-agenthead">
          <Sparkles size={15} color="#A78BFA" />
          <b style={{ fontSize: 13, fontWeight: 800 }}>Agent</b>
          <button
            type="button"
            className="vp-ico sm vp-spread"
            title="Undo the agent's last change"
            disabled={!props.canUndo}
            onClick={props.onUndo}
          >
            <Undo2 size={12} />
          </button>
          <button type="button" className="vp-ico sm" aria-label="Close the agent" onClick={props.onClose}>
            <X size={12} />
          </button>
        </header>

        <div className="vp-agentscroll">
          {ACTIONS.map((a) => {
            const job = props.jobs[a.id];
            const active = props.running === a.id;
            return (
              <div key={a.id}>
                <button
                  type="button"
                  className="vp-act"
                  disabled={!props.hasFootage || Boolean(props.running)}
                  onClick={() => {
                    if (a.id === 'preset') { setPresetOpen((v) => !v); return; }
                    props.onRun(a.id);
                  }}
                >
                  <span className="vp-actico">
                    {active ? <Loader2 size={13} className="vp-spin" /> : <a.Icon size={13} />}
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <b>{a.label}</b>
                    <small>{a.blurb}</small>
                  </span>
                  <StatusBadge state={active ? 'running' : job.state} />
                </button>
                {job.note ? (
                  <p className={`vp-note${job.state === 'failed' ? ' bad' : job.state === 'done' ? ' good' : ''}`} style={{ padding: '4px 4px 0 40px' }}>
                    {job.note}
                  </p>
                ) : null}
                {a.id === 'preset' && presetOpen ? (
                  <div className="vp-pills" style={{ padding: '7px 4px 0 40px' }}>
                    {props.presets.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="vp-pill"
                        onClick={() => { setPresetOpen(false); props.onPreset(p.id); }}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}

          {props.messages.length ? (
            <div className="vp-chatlog" style={{ marginTop: 4 }}>
              {props.messages.slice(-8).map((m) => (
                <div key={m.id} className={`vp-msg ${m.role === 'user' ? 'me' : 'bot'}`}>{m.content}</div>
              ))}
              {props.chatBusy ? (
                <div className="vp-msg bot"><Loader2 size={11} className="vp-spin" /> Thinking…</div>
              ) : null}
            </div>
          ) : (
            <p className="vp-note" style={{ marginTop: 4 }}>
              Or just say what you want: “add captions”, “tighten the silences”, “make it look cinematic”.
            </p>
          )}

          {props.children ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 4 }}>
              <span className="vp-label" style={{ marginBottom: 0 }}>Workbench</span>
              {props.children}
            </div>
          ) : null}
        </div>

        <div className="vp-agentfoot">
          <input
            className="vp-input"
            placeholder="Tell the agent what to do…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } }}
          />
          <button type="button" className="vp-btn primary" disabled={!draft.trim() || props.chatBusy} onClick={send}>
            <Send size={13} />
          </button>
        </div>
      </aside>
    </>
  );
}
