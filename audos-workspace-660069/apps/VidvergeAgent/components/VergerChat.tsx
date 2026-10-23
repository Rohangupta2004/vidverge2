import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import {
  AlertCircle,
  ArrowUp,
  CheckCircle2,
  ChevronRight,
  Download,
  History,
  Loader2,
  MessageSquarePlus,
  Paperclip,
  PenLine,
  RotateCcw,
  Sparkles,
  Square,
  X,
} from 'lucide-react';
import {
  FALLBACK_CHIPS,
  planTurn,
  runDispatches,
  reportsAsContext,
  suggestChips,
} from '../lib/vergerPlanner';
import type { ChatTurn, VergerOpenStudio, VergerPlan, VergerQuestion } from '../lib/vergerPlanner';
import { subAgentById } from '../lib/subAgents';
import {
  appendEvent,
  appendRunSnapshot,
  conversationTitle,
  loadConversation,
  loadConversationIndex,
  loadRunHistory,
  newConversationKey,
  nextSeq,
} from '../lib/vergerStore';
import type { ConversationSummary, StoredRow, StoredRun, VergerEvent } from '../lib/vergerStore';
import { describeCost, getCachedCredits, refreshCredits } from '../../../lib/credits';
import type { VidvergeAttachment } from '../../../lib/vidvergeHandoff';
import type { QueueJob } from '../types';
import { listVideoHistory, type VideoHistoryRow } from '../../../lib/videoHistory';
import { appCapability } from '../lib/capabilities';

const MAX_PLAN_LOOPS = 3;
const CHIP_CACHE_KEY = 'verger_chips_v1';
const CHIP_CACHE_MS = 24 * 60 * 60 * 1000;
const HELP_CHIP = 'Help me';
const HELP_TURN = "Help me — I'm not sure what to make yet. Ask me what you need to know, with options.";

interface UiEvent extends Omit<StoredRow, 'createdAt' | 'conversationKey' | 'title'> {
  id: string;
}

interface RunUi {
  runId: string;
  agentType: string;
  name: string;
  task: string;
  status: 'running' | 'done' | 'failed';
  startedAt: number;
  resultText?: string;
}

interface VergerChatProps {
  jobs: QueueJob[];
  onRouteStudio: (route: { appId: string; brief: string }, attachment: VidvergeAttachment | null) => void;
  onSpeak: (text: string) => void;
  onUploadAttachment: (file: File) => Promise<VidvergeAttachment>;
  onProjectChange: (key: string, title: string) => void;
}

let uiId = 0;
function newId(): string {
  uiId += 1;
  return `ev-${Date.now()}-${uiId}`;
}

function eventToTurns(event: UiEvent): ChatTurn[] {
  const v = event.verger;
  if (!v) return [];
  if (v.kind === 'say') return [{ role: event.role, content: event.content }];
  if (v.kind === 'question' && v.question) {
    return [{ role: 'assistant', content: `${v.question.prompt}\nOptions: ${v.question.options.map((o, i) => `${i + 1}. ${o}`).join(' ')}` }];
  }
  if (v.kind === 'answer') return [{ role: 'user', content: event.content }];
  if (v.kind === 'results') return [{ role: 'user', content: event.content.slice(0, 16000) }];
  if (v.kind === 'notice') return [{ role: 'assistant', content: event.content }];
  return []; // Specialist reports reach the model through the persisted results event.
}

function restoreFromLog(
  rows: StoredRow[],
  storedRuns: StoredRun[],
): { events: UiEvent[]; runs: RunUi[]; question: VergerQuestion | null; pendingRoute: VergerOpenStudio | null } {
  const events: UiEvent[] = rows.map((row) => ({ id: newId(), role: row.role, content: row.content, verger: row.verger }));
  let question: VergerQuestion | null = null;
  let pendingRoute: VergerOpenStudio | null = null;
  for (const event of events) {
    const v = event.verger;
    if (!v) continue;
    if (v.kind === 'question' && v.question) {
      question = v.question;
      pendingRoute = v.pendingRoute || null;
    }
    if (v.kind === 'answer' || (v.kind === 'say' && event.role === 'user')) {
      question = null;
      pendingRoute = null;
    }
  }
  // A browser-only run cannot still be executing after reload. Keep it in the
  // history, but mark the interrupted snapshot failed instead of spinning forever.
  const runs: RunUi[] = storedRuns.map((run) => ({
    runId: run.runId,
    agentType: run.agentType,
    name: run.name,
    task: run.task,
    status: run.status === 'running' ? 'failed' : run.status,
    startedAt: Date.now(),
    resultText: run.resultText,
  }));
  return { events, runs, question, pendingRoute };
}

function loadCachedChips(): string[] | null {
  try {
    const raw = window.localStorage.getItem(CHIP_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.chips) || Date.now() - Number(parsed?.at || 0) > CHIP_CACHE_MS) return null;
    return parsed.chips.slice(0, 3);
  } catch {
    return null;
  }
}

export default function VergerChat({ jobs, onRouteStudio, onSpeak, onUploadAttachment, onProjectChange }: VergerChatProps) {
  const firstConversation = useRef({ key: newConversationKey(), title: 'New conversation' });
  const [events, setEvents] = useState<UiEvent[]>([]);
  const [runs, setRuns] = useState<RunUi[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationKey, setConversationKey] = useState(firstConversation.current.key);
  const [conversationName, setConversationName] = useState(firstConversation.current.title);
  const [question, setQuestion] = useState<VergerQuestion | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState<string>('');
  const [input, setInput] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);
  const [chips, setChips] = useState<string[]>(FALLBACK_CHIPS);
  const [storageWarned, setStorageWarned] = useState(false);
  const [queuedTurns, setQueuedTurns] = useState<string[]>([]);
  const [expandedRuns, setExpandedRuns] = useState<Set<string>>(() => new Set());
  const [now, setNow] = useState(() => Date.now());
  const [artifacts, setArtifacts] = useState<VideoHistoryRow[]>([]);

  const eventsRef = useRef<UiEvent[]>([]);
  const conversationKeyRef = useRef(conversationKey);
  const conversationNameRef = useRef(conversationName);
  const restoreTicket = useRef(0);
  const pendingRoute = useRef<VergerOpenStudio | null>(null);
  const lastAttachment = useRef<VidvergeAttachment | null>(null);
  const lastTurn = useRef<{ text: string; optionIndex?: number } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const jobsRef = useRef<QueueJob[]>(jobs);
  const abortRef = useRef<AbortController | null>(null);
  jobsRef.current = jobs;
  conversationKeyRef.current = conversationKey;
  conversationNameRef.current = conversationName;

  async function openConversation(summary: ConversationSummary): Promise<void> {
    const ticket = restoreTicket.current + 1;
    restoreTicket.current = ticket;
    setRestoring(true);
    setError('');
    try {
      const [rows, storedRuns] = await Promise.all([
        loadConversation(summary.key),
        loadRunHistory(summary.key),
      ]);
      if (restoreTicket.current !== ticket) return;
      const restored = restoreFromLog(rows, storedRuns);
      conversationKeyRef.current = summary.key;
      conversationNameRef.current = summary.title;
      eventsRef.current = restored.events;
      pendingRoute.current = restored.pendingRoute;
      setConversationKey(summary.key);
      setConversationName(summary.title);
      setEvents(restored.events);
      setRuns(restored.runs);
      setQuestion(restored.question);
      lastAttachment.current = null;
    } catch (loadError) {
      if (restoreTicket.current === ticket) {
        setError(loadError instanceof Error ? loadError.message : 'That conversation could not be restored.');
      }
    } finally {
      if (restoreTicket.current === ticket) setRestoring(false);
    }
  }

  function startNewConversation(): void {
    if (busy || restoring) return;
    restoreTicket.current += 1;
    const key = newConversationKey();
    conversationKeyRef.current = key;
    conversationNameRef.current = 'New conversation';
    eventsRef.current = [];
    pendingRoute.current = null;
    lastAttachment.current = null;
    setConversationKey(key);
    setConversationName('New conversation');
    setEvents([]);
    setRuns([]);
    setQuestion(null);
    setError('');
    setStorageWarned(false);
  }

  function switchConversation(key: string): void {
    const summary = conversations.find((item) => item.key === key);
    if (summary && summary.key !== conversationKeyRef.current && !busy && !restoring) void openConversation(summary);
  }

  useEffect(() => {
    let cancelled = false;
    void loadConversationIndex()
      .then((index) => {
        if (cancelled) return;
        setConversations(index);
        if (index.length) return openConversation(index[0]);
        setRestoring(false);
        return undefined;
      })
      .catch((loadError) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : 'Conversation history could not be loaded.');
        setRestoring(false);
      });
    const cached = loadCachedChips();
    if (cached) {
      setChips(cached);
    } else {
      void suggestChips()
        .then((fresh) => {
          if (cancelled) return;
          setChips(fresh);
          try {
            window.localStorage.setItem(CHIP_CACHE_KEY, JSON.stringify({ chips: fresh, at: Date.now() }));
          } catch { /* private mode */ }
        })
        .catch(() => { /* fallback chips already shown */ });
    }
    void refreshCredits().catch(() => null);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [events, runs, busy, question]);

  useEffect(() => {
    onProjectChange(conversationKey, conversationName);
  }, [conversationKey, conversationName, onProjectChange]);

  useEffect(() => {
    const useVideoContext = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      const scene = String(detail.sceneLabel || 'selected scene');
      const seconds = Number(detail.timestampSec || 0).toFixed(2);
      setInput((current) => current || `In ${scene} at ${seconds}s, `);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    };
    window.addEventListener('verger-video-context', useVideoContext);
    return () => window.removeEventListener('verger-video-context', useVideoContext);
  }, []);

  useEffect(() => {
    if (!runs.some((run) => run.status === 'running')) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [runs]);

  useEffect(() => {
    let cancelled = false;
    void listVideoHistory(3).then((rows) => {
      if (!cancelled) setArtifacts(rows);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [jobs.map((job) => `${job.id}:${job.state}`).join('|')]);

  useEffect(() => {
    if (busy || restoring || queuedTurns.length === 0) return;
    const [next, ...rest] = queuedTurns;
    setQueuedTurns(rest);
    void advance(next);
  }, [busy, restoring, queuedTurns]);

  async function push(role: 'user' | 'assistant', content: string, verger: VergerEvent): Promise<void> {
    const event: UiEvent = { id: newId(), role, content, verger };
    eventsRef.current = [...eventsRef.current, event];
    setEvents(eventsRef.current);
    const saved = await appendEvent(
      conversationKeyRef.current,
      conversationNameRef.current,
      role,
      content,
      verger,
    );
    if (!saved) {
      if (!storageWarned) setStorageWarned(true);
      return;
    }
    const updatedAt = new Date().toISOString();
    setConversations((previous) => {
      const existing = previous.find((item) => item.key === conversationKeyRef.current);
      const current: ConversationSummary = {
        key: conversationKeyRef.current,
        title: conversationNameRef.current,
        updatedAt,
        messageCount: (existing?.messageCount || 0) + 1,
      };
      return [current, ...previous.filter((item) => item.key !== current.key)];
    });
  }

  function historyForModel(): ChatTurn[] {
    return eventsRef.current.flatMap(eventToTurns);
  }

  function queueSummary(): string {
    return jobsRef.current
      .slice(0, 5)
      .map((job) => `${job.name} — ${job.app}: ${job.stage} (${job.state})`)
      .join('; ');
  }

  function contextDigest(): string {
    return historyForModel()
      .slice(-12)
      .map((turn) => `${turn.role}: ${turn.content.slice(0, 700)}`)
      .join('\n');
  }

  async function executeRoute(route: VergerOpenStudio): Promise<void> {
    const capability = appCapability(route.appId);
    onRouteStudio({ appId: route.appId, brief: route.brief }, lastAttachment.current);
    const message = capability?.routable
      ? 'Opening the studio with your brief prefilled — I’ll keep tracking it in Recent jobs here.'
      : `Opening ${capability?.name || 'the studio'} for hands-on work — your projects and finished videos stay in the shared library.`;
    await push('assistant', message, { kind: 'notice', seq: nextSeq() });
  }

  async function handlePlan(plan: VergerPlan): Promise<void> {
    if (plan.say) {
      await push('assistant', plan.say, { kind: 'say', seq: nextSeq() });
      onSpeak(plan.say);
    }
    if (plan.openStudio) {
      const route = plan.openStudio;
      if (route.estimatedSeconds > 0) {
        pendingRoute.current = route;
        const balance = getCachedCredits()?.balance;
        const prompt = `This step will generate about ${route.estimatedSeconds}s of video — ${describeCost(route.estimatedSeconds)}${typeof balance === 'number' ? ` (you have ${balance} credits)` : ''}. Start it?`;
        const confirm: VergerQuestion = {
          prompt,
          options: [`Yes — go ahead (${describeCost(route.estimatedSeconds)})`, 'Not yet — adjust the plan first'],
          allowOwn: true,
        };
        setQuestion(confirm);
        await push('assistant', prompt, { kind: 'question', seq: nextSeq(), question: confirm, pendingRoute: route });
        return;
      }
      await executeRoute(route);
    }
    if (plan.visualEdit) {
      window.dispatchEvent(new CustomEvent('verger-request-visual-edit', { detail: plan.visualEdit }));
      await push('assistant', 'I’ve sent that targeted change to the live project pane. I’m analysing only the selected 8-second window; you’ll see the detailed prompt before the 8-credit edit is submitted.', { kind: 'notice', seq: nextSeq() });
    }
    if (plan.askQuestion) {
      setQuestion(plan.askQuestion);
      await push('assistant', plan.askQuestion.prompt, { kind: 'question', seq: nextSeq(), question: plan.askQuestion });
    }
  }

  async function advance(text: string, optionIndex?: number): Promise<void> {
    if (busy || restoring) return;
    const controller = new AbortController();
    abortRef.current = controller;
    lastTurn.current = { text, optionIndex };
    setError('');
    setBusy(true);
    try {
      const answering = question !== null;
      setQuestion(null);
      if (!eventsRef.current.length && conversationNameRef.current === 'New conversation') {
        const nextTitle = conversationTitle(text);
        conversationNameRef.current = nextTitle;
        setConversationName(nextTitle);
      }
      await push('user', text, answering ? { kind: 'answer', seq: nextSeq(), optionIndex: optionIndex ?? -1 } : { kind: 'say', seq: nextSeq() });

      // Confirmed credit-spending route — execute without another model turn.
      if (answering && pendingRoute.current && optionIndex === 0) {
        const route = pendingRoute.current;
        pendingRoute.current = null;
        await executeRoute(route);
        return;
      }
      if (answering && pendingRoute.current) pendingRoute.current = null;

      for (let loop = 0; loop < MAX_PLAN_LOOPS; loop += 1) {
        const plan = await planTurn(historyForModel(), queueSummary(), controller.signal);
        if (!plan.dispatch.length) {
          await handlePlan(plan);
          return;
        }
        // Parallel specialists: show them running, persist each result, feed back.
        if (plan.say) {
          await push('assistant', plan.say, { kind: 'say', seq: nextSeq() });
          onSpeak(plan.say);
        }
        const started: RunUi[] = plan.dispatch.map((d, i) => ({
          runId: `${Date.now()}-${i}-${d.agentType}`,
          agentType: d.agentType,
          name: subAgentById(d.agentType)?.name || d.agentType,
          task: d.task,
          status: 'running' as const,
          startedAt: Date.now(),
        }));
        const runSaves = await Promise.all(started.map((run) => appendRunSnapshot(conversationKeyRef.current, run)));
        if (runSaves.some((saved) => !saved)) setStorageWarned(true);
        setRuns((previous) => [...previous, ...started]);
        const context = contextDigest();
        const reports = await runDispatches(plan.dispatch, context, (report) => {
          const match = started.find((run) => run.runId.endsWith(`-${report.agentType}`) && run.status === 'running');
          if (!match) return;
          match.status = report.ok ? 'done' : 'failed';
          match.name = report.name;
          match.resultText = report.text;
          setRuns((previous) => previous.map((r) => (r.runId === match.runId
            ? { ...r, status: match.status, name: report.name, resultText: report.text }
            : r)));
          void appendRunSnapshot(conversationKeyRef.current, {
            runId: match.runId,
            agentType: report.agentType,
            name: report.name,
            task: report.task,
            status: match.status,
            resultText: report.text,
          }).then((saved) => { if (!saved) setStorageWarned(true); });
        }, controller.signal);
        await push('user', reportsAsContext(reports), { kind: 'results', seq: nextSeq() });
      }
      // Loop budget exhausted — one final plan, dispatches ignored.
      const finalPlan = await planTurn(historyForModel(), queueSummary(), controller.signal);
      await handlePlan({ ...finalPlan, dispatch: [] });
    } catch (err) {
      if (controller.signal.aborted) {
        await push('assistant', 'Stopped. I kept the conversation and completed steps, so you can redirect me without starting over.', { kind: 'notice', seq: nextSeq() });
        setRuns((previous) => previous.map((run) => run.status === 'running' ? { ...run, status: 'failed', resultText: 'Interrupted by the user.' } : run));
      } else {
        setError(err instanceof Error ? err.message : 'Verger could not finish that turn.');
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  }

  function stopRun(): void {
    abortRef.current?.abort();
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const text = input.trim();
    if (!text || restoring) return;
    setInput('');
    if (busy) {
      setQueuedTurns((previous) => [...previous, text]);
      return;
    }
    let turn = text;
    if (attachment) {
      try {
        const uploaded = await onUploadAttachment(attachment);
        lastAttachment.current = uploaded;
        turn = `${text}\n[Attached file: ${uploaded.name} — ${uploaded.url}]`;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The attachment could not be uploaded.');
        return;
      } finally {
        setAttachment(null);
      }
    }
    await advance(turn, question ? -1 : undefined);
  }

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    setAttachment(event.target.files?.[0] || null);
    event.target.value = '';
  }

  const visible = useMemo(
    () => events.filter((e) => e.verger && (e.verger.kind === 'say' || e.verger.kind === 'answer' || e.verger.kind === 'question' || e.verger.kind === 'notice')),
    [events],
  );
  const activeRuns = runs.filter((r) => r.status === 'running');
  const recentRuns = runs.slice(-6);
  const empty = !restoring && visible.length === 0;
  const conversationOptions = conversations.some((item) => item.key === conversationKey)
    ? conversations
    : [{ key: conversationKey, title: conversationName, updatedAt: '', messageCount: events.length }, ...conversations];
  const elapsedLabel = (run: RunUi) => {
    const seconds = Math.max(0, Math.floor((now - run.startedAt) / 1000));
    return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  };

  return (
    <section className="mx-auto flex w-full max-w-[880px] flex-col">
      <div className="mb-2 flex items-center gap-2">
        <label className="relative min-w-0 flex-1">
          <History size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--vg-accent)]" />
          <span className="sr-only">Video project history</span>
          <select
            value={conversationKey}
            onChange={(event) => switchConversation(event.target.value)}
            disabled={busy || restoring}
            className="h-10 w-full appearance-none rounded-xl border border-[var(--vg-border)] bg-[var(--vg-surface)] pl-9 pr-8 text-[12px] text-[var(--vg-secondary)] outline-none transition-colors hover:border-[var(--vg-control-border)] disabled:opacity-60"
          >
            {conversationOptions.map((item) => (
              <option key={item.key} value={item.key}>
                {item.title} · {item.messageCount} {item.messageCount === 1 ? 'project event' : 'project events'}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={startNewConversation}
          disabled={busy || restoring || (events.length === 0 && conversationName === 'New conversation')}
          className="flex h-10 shrink-0 items-center gap-2 rounded-xl border border-[var(--vg-border)] bg-[var(--vg-surface)] px-3 text-[12px] font-medium text-[var(--vg-text)] transition-colors hover:border-[color-mix(in_srgb,var(--vg-accent)_45%,transparent)] hover:bg-[var(--vg-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <MessageSquarePlus size={14} className="text-[var(--vg-accent)]" /> New project
        </button>
      </div>

      {/* Transcript */}
      <div ref={scrollRef} className="flex max-h-[52vh] min-h-[220px] flex-col gap-3 overflow-y-auto rounded-2xl border border-[var(--vg-border)] bg-[color-mix(in_srgb,var(--vg-surface)_92%,transparent)] p-4">
        {restoring && (
          <p className="flex items-center gap-2 text-[13px] text-[var(--vg-muted)]">
            <Loader2 size={14} className="animate-spin" /> Restoring your conversation…
          </p>
        )}
        {empty && (
          <div className="py-6 text-center">
            <p className="text-[17px] font-semibold text-[var(--vg-text)]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              What do you want to make?
            </p>
            <p className="mx-auto mt-2 max-w-[460px] text-[13px] leading-relaxed text-[var(--vg-secondary)]">
              Describe the outcome, paste a URL, attach a script or drop in footage. I’ll plan the work, run specialists in parallel and ask only when a real decision is needed. You approve anything that spends credits.
            </p>
          </div>
        )}
        {visible.map((event) => {
          const isUser = event.role === 'user';
          const isNotice = event.verger?.kind === 'notice';
          return (
            <div key={event.id} className={isUser ? 'flex justify-end' : 'flex justify-start'}>
              <div
                className={
                  isNotice
                    ? 'rounded-xl border border-[color-mix(in_srgb,var(--vg-accent)_35%,transparent)] bg-[color-mix(in_srgb,var(--vg-accent)_10%,transparent)] px-3 py-2 text-[12px] text-[var(--vg-secondary)]'
                    : isUser
                      ? 'max-w-[82%] rounded-2xl rounded-br-md bg-[color-mix(in_srgb,var(--vg-accent)_16%,var(--vg-raised))] px-4 py-2.5 text-[14px] leading-relaxed text-[var(--vg-text)]'
                      : 'max-w-[82%] rounded-2xl rounded-bl-md border border-[var(--vg-border)] bg-[var(--vg-raised)] px-4 py-2.5 text-[14px] leading-relaxed text-[var(--vg-text)]'
                }
                style={{ whiteSpace: 'pre-wrap' }}
              >
                {event.content}
              </div>
            </div>
          );
        })}
        {recentRuns.length > 0 && (
          <div className="rounded-xl border border-[var(--vg-border)] bg-[var(--vg-surface)] p-3">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--vg-muted)]">
              <Sparkles size={12} className="text-[var(--vg-accent)]" />
              Task checklist {activeRuns.length > 0 ? `· ${activeRuns.length} working in parallel` : '· complete'}
            </p>
            <ul className="space-y-1.5">
              {recentRuns.map((run) => {
                const expanded = expandedRuns.has(run.runId);
                return (
                  <li key={run.runId} className="overflow-hidden rounded-lg border border-[var(--vg-border)] bg-[var(--vg-raised)]">
                    <button
                      type="button"
                      onClick={() => setExpandedRuns((previous) => {
                        const next = new Set(previous);
                        if (next.has(run.runId)) next.delete(run.runId);
                        else next.add(run.runId);
                        return next;
                      })}
                      className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-[var(--vg-secondary)]"
                    >
                      {run.status === 'running' && <Loader2 size={13} className="shrink-0 animate-spin text-[var(--vg-accent)]" />}
                      {run.status === 'done' && <CheckCircle2 size={13} className="shrink-0 text-[var(--vg-success)]" />}
                      {run.status === 'failed' && <AlertCircle size={13} className="shrink-0 text-[var(--vg-danger)]" />}
                      <span className="font-medium text-[var(--vg-text)]">{run.name}</span>
                      <span className="min-w-0 flex-1 truncate">{run.task}</span>
                      <span className="shrink-0 tabular-nums text-[10px] text-[var(--vg-muted)]">{elapsedLabel(run)}</span>
                      <ChevronRight size={13} className={`shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
                    </button>
                    {expanded && (
                      <div className="border-t border-[var(--vg-border)] px-3 py-2 text-[11px] leading-relaxed text-[var(--vg-secondary)]">
                        <p><span className="font-semibold text-[var(--vg-text)]">Status:</span> {run.status === 'running' ? 'Running' : run.status === 'done' ? 'Done' : 'Failed'}</p>
                        <p className="mt-1"><span className="font-semibold text-[var(--vg-text)]">Task:</span> {run.task}</p>
                        {run.resultText && <p className="mt-2 whitespace-pre-wrap rounded-lg bg-[var(--vg-surface)] p-2">{run.resultText}</p>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {artifacts.length > 0 && (
          <div className="rounded-xl border border-[var(--vg-border)] bg-[var(--vg-surface)] p-3">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--vg-muted)]">Finished artifacts</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {artifacts.map((artifact) => (
                <article key={artifact.id} className="overflow-hidden rounded-lg border border-[var(--vg-border)] bg-[var(--vg-raised)]">
                  <a href={artifact.video_url} target="_blank" rel="noreferrer" className="block aspect-video bg-black">
                    {artifact.thumbnail_url
                      ? <img src={artifact.thumbnail_url} alt="" className="h-full w-full object-cover" />
                      : <video src={artifact.video_url} muted playsInline preload="metadata" className="h-full w-full object-cover" />}
                  </a>
                  <div className="p-2">
                    <p className="truncate text-[11px] font-semibold text-[var(--vg-text)]">{artifact.title}</p>
                    <div className="mt-2 flex gap-1.5">
                      <a href={artifact.video_url} target="_blank" rel="noreferrer" className="flex min-h-8 flex-1 items-center justify-center rounded-lg border border-[var(--vg-border)] text-[10px] font-semibold text-[var(--vg-secondary)]">Preview</a>
                      <a href={artifact.video_url} download target="_blank" rel="noreferrer" className="flex min-h-8 flex-1 items-center justify-center gap-1 rounded-lg bg-[var(--vg-accent)] text-[10px] font-semibold text-[var(--vg-on-accent)]"><Download size={11} /> Download</a>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}
        {busy && (
          <p className="flex items-center gap-2 text-[13px] text-[var(--vg-muted)]">
            <Loader2 size={14} className="animate-spin text-[var(--vg-accent)]" /> Verger is planning and running the next real step…
          </p>
        )}
        {queuedTurns.length > 0 && (
          <p className="rounded-lg border border-[color-mix(in_srgb,var(--vg-accent)_30%,transparent)] bg-[color-mix(in_srgb,var(--vg-accent)_8%,transparent)] px-3 py-2 text-[12px] text-[var(--vg-secondary)]">
            {queuedTurns.length} follow-up{queuedTurns.length === 1 ? '' : 's'} queued. Verger will read {queuedTurns.length === 1 ? 'it' : 'them'} next.
          </p>
        )}
      </div>

      {storageWarned && (
        <p className="mt-2 text-center text-[11px] text-[var(--vg-warning)]">
          Heads up: this conversation could not be saved, so a reload will start fresh.
        </p>
      )}

      {error && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-[color-mix(in_srgb,var(--vg-danger)_45%,transparent)] bg-[var(--vg-danger-bg)] px-3 py-2">
          <p className="min-w-0 flex-1 text-[12px] text-[var(--vg-danger)]">{error} Your saved context and completed steps are intact; Retry will continue from them.</p>
          <button
            type="button"
            onClick={() => lastTurn.current && void advance(lastTurn.current.text, lastTurn.current.optionIndex)}
            className="flex shrink-0 items-center gap-1 rounded-full border border-[color-mix(in_srgb,var(--vg-danger)_45%,transparent)] px-3 py-1 text-[12px] text-[var(--vg-danger)] transition-colors hover:bg-[color-mix(in_srgb,var(--vg-danger)_12%,transparent)]"
          >
            <RotateCcw size={12} /> Retry
          </button>
        </div>
      )}

      {/* Question card with numbered options — sits ABOVE the input, per the founder's sketch */}
      {question && !busy && (
        <div className="mt-3 rounded-2xl border border-[color-mix(in_srgb,var(--vg-accent)_40%,transparent)] bg-[var(--vg-raised)] p-3">
          <p className="px-1 pb-2 text-[13px] font-medium text-[var(--vg-text)]">{question.prompt}</p>
          <div className="space-y-1.5">
            {question.options.map((option, index) => (
              <button
                key={`${index}-${option}`}
                type="button"
                onClick={() => void advance(option, index)}
                className="flex w-full items-center gap-3 rounded-xl border border-[var(--vg-border)] bg-[var(--vg-surface)] px-3 py-2.5 text-left transition-colors hover:border-[var(--vg-control-border)] hover:bg-[var(--vg-hover)]"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--vg-accent)_18%,transparent)] text-[12px] font-semibold text-[var(--vg-accent)]">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 text-[13px] text-[var(--vg-text)]">{option}</span>
                <ChevronRight size={15} className="shrink-0 text-[var(--vg-muted)]" />
              </button>
            ))}
            {question.allowOwn && (
              <button
                type="button"
                onClick={() => inputRef.current?.focus()}
                className="flex w-full items-center gap-3 rounded-xl border border-dashed border-[var(--vg-border)] px-3 py-2.5 text-left text-[13px] text-[var(--vg-secondary)] transition-colors hover:border-[var(--vg-control-border)] hover:text-[var(--vg-text)]"
              >
                <PenLine size={14} className="ml-1 shrink-0 text-[var(--vg-accent)]" />
                Write your own answer below
              </button>
            )}
          </div>
        </div>
      )}

      {/* Suggestion chips — three examples of what Verger can do, plus Help me */}
      {!question && !busy && (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          {[...chips, HELP_CHIP].map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => void advance(chip === HELP_CHIP ? HELP_TURN : chip)}
              className="rounded-full border border-[var(--vg-border)] bg-[var(--vg-surface)] px-3.5 py-1.5 text-[12px] text-[var(--vg-secondary)] transition-colors hover:border-[color-mix(in_srgb,var(--vg-accent)_40%,transparent)] hover:text-[var(--vg-text)]"
            >
              {chip}
            </button>
          ))}
        </div>
      )}

      {attachment && (
        <div className="mt-2 flex justify-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-[var(--vg-border)] bg-[var(--vg-surface)] px-3 py-1.5 text-[12px] text-[var(--vg-secondary)]">
            <Paperclip size={12} className="text-[var(--vg-accent)]" />
            <span className="max-w-[220px] truncate">{attachment.name}</span>
            <button type="button" onClick={() => setAttachment(null)} aria-label="Remove attachment" className="transition-colors hover:text-[var(--vg-text)]">
              <X size={12} />
            </button>
          </span>
        </div>
      )}

      {/* Main input bar */}
      <form
        onSubmit={(e) => void submit(e)}
        className="mt-3 flex items-center gap-2 rounded-[28px] border border-[var(--vg-border)] bg-[var(--vg-surface)] px-2 py-2 transition-colors focus-within:border-[var(--vg-control-border)]"
        style={{ boxShadow: '0 24px 60px -28px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)' }}
      >
        <input ref={fileRef} type="file" className="hidden" onChange={handleFile} />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--vg-muted)] transition-colors hover:bg-[var(--vg-hover)] hover:text-[var(--vg-text)]"
          aria-label="Attach a reference, script or clip"
          title="Attach a reference, script or clip"
        >
          <Paperclip size={16} />
        </button>
        {busy && (
          <button
            type="button"
            onClick={stopRun}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--vg-danger)_45%,transparent)] px-3 text-[12px] font-semibold text-[var(--vg-danger)] transition-colors hover:bg-[var(--vg-danger-bg)]"
            title="Stop this run"
          >
            <Square size={12} fill="currentColor" /> Stop
          </button>
        )}
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={busy ? 'Type a follow-up to queue…' : question ? 'Write your own answer…' : 'What do you want to make?'}
          className="min-w-0 flex-1 bg-transparent px-1 text-[15px] text-[var(--vg-text)] outline-none placeholder:text-[var(--vg-muted)]"
          aria-label="Tell Verger what you want to make"
        />
        <button
          type="submit"
          disabled={!input.trim() || restoring}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: 'var(--vg-gradient-action)', color: 'var(--vg-on-accent)' }}
        >
          <ArrowUp size={15} />
          {busy ? 'Queue' : ''}
        </button>
      </form>
      <p className="mt-2 text-right text-[10px] uppercase tracking-wide text-[var(--vg-muted)]">powered by smarter agent gpt-6.1-sol</p>
    </section>
  );
}
