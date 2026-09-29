/**
 * AgentChatContext — per-app agentic chat state.
 *
 * Each app wraps its UI additions in <AgentChatProvider appContext={…}> so the
 * agent knows the app's current form inputs and can act on them through the
 * onFillField / onTriggerAction callbacks the app passes down (no coupling to
 * app internals). Responses stream from the platform OpenAI proxy
 * (POST /proxy/openai/v1/chat/completions, workspace-token authenticated) on
 * the fast approved model, and FILL_FIELD:/TRIGGER_ACTION: command lines are
 * parsed out of the stream, executed, and stripped from the displayed text.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ThinkingStep } from './ThinkingSteps';

export interface AppContext {
  appId: string;
  appName: string;
  /** Current form field values the agent can read. */
  currentInputs: Record<string, string>;
  /** Callback the app provides to set one of its own fields. */
  onFillField: (field: string, value: string) => void;
  /** Callback the app provides to run one of its own actions. */
  onTriggerAction: (action: string, params?: Record<string, unknown>) => void;
  /** App-specific capabilities appended to the system prompt. */
  promptHint?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinkingSteps?: ThinkingStep[];
  timestamp: Date;
}

interface AgentChatValue {
  isOpen: boolean;
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
  messages: ChatMessage[];
  thinkingSteps: ThinkingStep[];
  isThinking: boolean;
  appContext: AppContext;
  sendMessage: (text: string) => Promise<void>;
}

const AgentChatCtx = createContext<AgentChatValue | null>(null);

export function useAgentChat(): AgentChatValue {
  const value = useContext(AgentChatCtx);
  if (!value) throw new Error('useAgentChat must be used inside <AgentChatProvider>');
  return value;
}

const newId = () => `ac_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

// The platform OpenAI proxy accepts only approved text models; gpt-5.6-luna
// is the fast/low-latency tier — the compliant equivalent of "gpt-4o-mini".
const AGENT_MODEL = 'gpt-5.6-luna';

function buildSystemPrompt(app: AppContext): string {
  return [
    `You are the Vidverge AI agent, embedded inside the ${app.appName} app of VidVerge, an AI video-creation studio.`,
    'You help users create videos efficiently.',
    '',
    'Current app context:',
    `- App: ${app.appName} (id: ${app.appId})`,
    `- Current inputs: ${JSON.stringify(app.currentInputs)}`,
    '',
    'You can:',
    '1. Fill form fields — emit a line exactly like: FILL_FIELD:{fieldName}:{value}',
    '2. Trigger app actions — emit a line exactly like: TRIGGER_ACTION:{actionName}:{optionalJsonParams}',
    '3. Give friendly, concise guidance',
    '',
    app.promptHint ? `${app.promptHint}\n` : '',
    'When you decide to fill a field or trigger an action, first explain briefly what you are doing, then emit the command on its own line. Only use the field names and action names listed above for this app.',
    'Keep responses short — max 3 sentences + actions.',
  ].join('\n');
}

export function AgentChatProvider({ appContext, children }: { appContext: AppContext; children?: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [thinkingSteps, setThinkingSteps] = useState<ThinkingStep[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  // The app re-creates appContext every render (its inputs change); the
  // in-flight stream always reads the freshest one from this ref.
  const appRef = useRef(appContext);
  appRef.current = appContext;
  const busyRef = useRef(false);
  const stepsRef = useRef<ThinkingStep[]>([]);

  const setStep = useCallback((index: number, status: ThinkingStep['status']) => {
    stepsRef.current = stepsRef.current.map((s, i) => (i === index ? { ...s, status } : s));
    setThinkingSteps(stepsRef.current);
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busyRef.current) return;
    busyRef.current = true;
    const app = appRef.current;
    const assistantId = newId();
    const history = [...messages].slice(-10).map((m) => ({ role: m.role, content: m.content }));

    setMessages((all) => [
      ...all,
      { id: newId(), role: 'user', content: trimmed, timestamp: new Date() },
      { id: assistantId, role: 'assistant', content: '', timestamp: new Date() },
    ]);
    stepsRef.current = [
      { id: newId(), icon: '👁️', text: 'Reading your current inputs…', status: 'active' },
      { id: newId(), icon: '🧠', text: 'Planning the best approach…', status: 'pending' },
      { id: newId(), icon: '✍️', text: 'Crafting response…', status: 'pending' },
    ];
    setThinkingSteps(stepsRef.current);
    setIsThinking(true);

    let shown = '';
    let lineBuffer = '';
    let visibleChars = 0;
    const actionSteps: ThinkingStep[] = [];

    const applyCommand = (line: string): boolean => {
      const fill = line.match(/^FILL_FIELD:([^:]+):([\s\S]*)$/);
      if (fill) {
        const field = fill[1].trim();
        const value = fill[2].trim();
        try { appRef.current.onFillField(field, value); } catch (e) { console.warn('[AgentChat] onFillField failed:', e); }
        actionSteps.push({ id: newId(), icon: '💡', text: `Filled “${field}” for you`, status: 'done' });
        stepsRef.current = [...stepsRef.current, actionSteps[actionSteps.length - 1]];
        setThinkingSteps(stepsRef.current);
        return true;
      }
      const act = line.match(/^TRIGGER_ACTION:([^:\s]+):?([\s\S]*)$/);
      if (act) {
        const action = act[1].trim();
        const rawParams = act[2].trim();
        let params: Record<string, unknown> | undefined;
        if (rawParams) {
          try { params = JSON.parse(rawParams) as Record<string, unknown>; } catch { params = { value: rawParams }; }
        }
        try { appRef.current.onTriggerAction(action, params); } catch (e) { console.warn('[AgentChat] onTriggerAction failed:', e); }
        actionSteps.push({ id: newId(), icon: '⚡', text: `Triggered “${action}”`, status: 'done' });
        stepsRef.current = [...stepsRef.current, actionSteps[actionSteps.length - 1]];
        setThinkingSteps(stepsRef.current);
        return true;
      }
      return false;
    };

    const renderAssistant = () => {
      const partial = /^(FILL_FIELD:|TRIGGER_ACTION:)/.test(lineBuffer.trim()) ? '' : lineBuffer;
      const content = (shown + partial).replace(/^\s+/, '');
      setMessages((all) => all.map((m) => (m.id === assistantId ? { ...m, content } : m)));
    };

    const onChunk = (chunk: string) => {
      if (visibleChars === 0) { setStep(0, 'done'); setStep(1, 'active'); }
      visibleChars += chunk.length;
      if (visibleChars > 60 && stepsRef.current[1]?.status === 'active') { setStep(1, 'done'); setStep(2, 'active'); }
      lineBuffer += chunk;
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() || '';
      for (const line of lines) {
        if (!applyCommand(line.trim())) shown += `${line}\n`;
      }
      renderAssistant();
    };

    try {
      const token = (window as unknown as { __workspaceDb?: { token?: string } }).__workspaceDb?.token;
      if (!token) throw new Error('Your workspace session is still loading — try again in a moment.');
      const response = await fetch('/proxy/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
        body: JSON.stringify({
          model: AGENT_MODEL,
          reasoning_effort: 'none',
          max_completion_tokens: 700,
          stream: true,
          messages: [
            { role: 'system', content: buildSystemPrompt(app) },
            ...history,
            { role: 'user', content: trimmed },
          ],
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: { message?: string } | string; code?: string } | null;
        const errMsg = typeof data?.error === 'string' ? data.error : data?.error?.message;
        throw new Error(errMsg || `The agent request failed (${response.status}).`);
      }
      if (!response.body) throw new Error('The agent response has no stream body.');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = '';
      let done = false;
      const consumeSse = (line: string) => {
        if (!line.startsWith('data:')) return;
        const data = line.slice(5).trim();
        if (!data) return;
        if (data === '[DONE]') { done = true; return; }
        let event: { error?: { message?: string }; choices?: { delta?: { content?: string } }[] };
        try { event = JSON.parse(data); } catch { return; }
        if (event.error) throw new Error(event.error.message || 'The agent stream failed.');
        // The terminal usage chunk carries an empty choices array — read defensively.
        const content = event.choices?.[0]?.delta?.content;
        if (content) onChunk(content);
      };
      while (!done) {
        const { done: eof, value } = await reader.read();
        if (eof) break;
        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop() || '';
        for (const line of lines) { consumeSse(line); if (done) break; }
      }

      // Flush the last partial line (command or text).
      const tail = lineBuffer.trim();
      lineBuffer = '';
      if (tail && !applyCommand(tail)) shown += tail;
      stepsRef.current = stepsRef.current.map((s) => (s.status === 'done' || s.status === 'error' ? s : { ...s, status: 'done' as const }));
      setThinkingSteps(stepsRef.current);
      const finalSteps = stepsRef.current;
      const finalContent = shown.trim() || 'Done — I have made those changes for you.';
      setMessages((all) => all.map((m) => (m.id === assistantId ? { ...m, content: finalContent, thinkingSteps: finalSteps } : m)));
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      const activeIdx = stepsRef.current.findIndex((s) => s.status === 'active' || s.status === 'pending');
      if (activeIdx >= 0) setStep(activeIdx, 'error');
      const finalSteps = stepsRef.current;
      setMessages((all) => all.map((m) => (m.id === assistantId ? { ...m, content: shown.trim() || `Sorry — something went wrong: ${why}`, thinkingSteps: finalSteps } : m)));
    } finally {
      setIsThinking(false);
      busyRef.current = false;
    }
  }, [messages, setStep]);

  const value = useMemo<AgentChatValue>(() => ({
    isOpen,
    openPanel: () => setIsOpen(true),
    closePanel: () => setIsOpen(false),
    togglePanel: () => setIsOpen((v) => !v),
    messages,
    thinkingSteps,
    isThinking,
    appContext,
    sendMessage,
  }), [isOpen, messages, thinkingSteps, isThinking, appContext, sendMessage]);

  return <AgentChatCtx.Provider value={value}>{children}</AgentChatCtx.Provider>;
}
