/**
 * VERGER CONVERSATION & RUN STORAGE.
 *
 * Two dedicated, session-owned, append-only tables keep the agent resumable:
 * - verger_conversations: one row per visible/planner event, grouped by conversation_key
 * - verger_runs: one row per specialist status snapshot, grouped by run_key
 *
 * The earlier cap-era implementation wrote into video_chat_messages. Those rows
 * remain readable as one recovered thread; new work is written only to the two
 * Verger-owned tables. Append-only snapshots fit the browser write policy and
 * make interrupted runs explicit instead of leaving a mutable row half-written.
 */

const CONVERSATIONS_TABLE = 'verger_conversations';
const RUNS_TABLE = 'verger_runs';
const LEGACY_TABLE = 'video_chat_messages';
export const LEGACY_CONVERSATION_KEY = 'legacy-current';

export type VergerEventKind = 'say' | 'question' | 'answer' | 'results' | 'notice' | 'project';

export interface VergerSceneVersion {
  id: string;
  videoUrl: string;
  label: string;
  createdAt: string;
  sourceVersionId?: string;
  editPrompt?: string;
  editWindow?: { startSec: number; endSec: number; timestampSec: number };
}

export interface VergerScene {
  id: string;
  label: string;
  startSec: number;
  endSec: number;
  activeVersionId: string;
  versions: VergerSceneVersion[];
}

export interface VergerProject {
  id: string;
  title: string;
  script: string;
  scenes: VergerScene[];
  assets: Array<{ id: string; kind: string; url: string; name: string }>;
  renders: Array<{ id: string; url: string; label: string; createdAt: string }>;
  runLog: Array<{ id: string; agent: string; status: string; detail: string; createdAt: string }>;
  editHistory: Array<{ id: string; sceneId: string; fromVersionId: string; toVersionId: string; request: string; createdAt: string }>;
  pendingOperation?: {
    operationId: string;
    sceneId: string;
    sourceVersionId: string;
    prompt: string;
    prepared: {
      sourceUrl: string;
      sourceDuration: number;
      clipUrl: string;
      window: { startSec: number; endSec: number; timestampSec: number };
      frames: Array<{ timestamp: number; url: string }>;
      prompt: string;
      request: string;
    };
    startedAt: string;
  };
  updatedAt: string;
}

export interface VergerEvent {
  kind: VergerEventKind;
  /** Client sequence, for stable ordering inside one timestamp. */
  seq: number;
  question?: { prompt: string; options: string[]; allowOwn: boolean };
  /** Pending studio route attached to a credit confirmation question. */
  pendingRoute?: { appId: string; brief: string; estimatedSeconds: number };
  /** answer: which option index was clicked (-1 = wrote their own). */
  optionIndex?: number;
  /** Full append-only snapshot for the video project attached to this conversation. */
  project?: VergerProject;
}

export interface StoredRow {
  conversationKey: string;
  title: string;
  role: 'user' | 'assistant';
  content: string;
  verger: VergerEvent;
  createdAt: string;
}

export interface StoredRun {
  conversationKey: string;
  runId: string;
  agentType: string;
  name: string;
  task: string;
  status: 'running' | 'done' | 'failed';
  resultText: string;
  seq: number;
  createdAt: string;
}

export interface ConversationSummary {
  key: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

function db(): any | null {
  const handle = (window as any).__workspaceDb;
  return handle?.from ? handle : null;
}

/** The runtime injects __workspaceDb slightly after first paint — wait for it. */
async function dbReady(timeoutMs = 6000): Promise<any | null> {
  const deadline = Date.now() + timeoutMs;
  let handle = db();
  while (!handle && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    handle = db();
  }
  return handle;
}

function randomKey(prefix: string): string {
  const rand = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${rand}`;
}

export function newConversationKey(): string {
  return randomKey('verger-conversation');
}

export function conversationTitle(text: string): string {
  const clean = text
    .replace(/\[Attached file:[\s\S]*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return 'New conversation';
  return clean.length > 54 ? `${clean.slice(0, 51).trimEnd()}…` : clean;
}

let seqCounter = Date.now() % 1_000_000_000;

export function nextSeq(): number {
  seqCounter += 1;
  return seqCounter;
}

export async function appendEvent(
  conversationKey: string,
  title: string,
  role: 'user' | 'assistant',
  content: string,
  event: VergerEvent,
): Promise<boolean> {
  const handle = await dbReady();
  if (!handle) return false;
  try {
    await handle.from(CONVERSATIONS_TABLE).insert({
      conversation_key: conversationKey,
      message_key: randomKey('verger-message'),
      title: title || 'New conversation',
      role,
      content: content || '…',
      kind: event.kind,
      sequence: event.seq,
      event_data: event,
    });
    return true;
  } catch (error) {
    console.warn('[Verger] could not persist a conversation event.', error);
    return false;
  }
}

export async function appendRunSnapshot(
  conversationKey: string,
  run: {
    runId: string;
    agentType: string;
    name: string;
    task: string;
    status: 'running' | 'done' | 'failed';
    resultText?: string;
  },
): Promise<boolean> {
  const handle = await dbReady();
  if (!handle) return false;
  const seq = nextSeq();
  try {
    await handle.from(RUNS_TABLE).insert({
      conversation_key: conversationKey,
      run_key: run.runId,
      snapshot_key: randomKey('verger-run-snapshot'),
      agent_type: run.agentType,
      name: run.name,
      task: run.task,
      status: run.status,
      result_text: run.resultText || null,
      sequence: seq,
      run_data: { status: run.status },
    });
    return true;
  } catch (error) {
    console.warn('[Verger] could not persist a specialist run.', error);
    return false;
  }
}

function safeParse(value: unknown): any {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toEvent(value: unknown): VergerEvent | null {
  const event = safeParse(value);
  if (!event || typeof event !== 'object' || typeof event.kind !== 'string') return null;
  if (!['say', 'question', 'answer', 'results', 'notice', 'project'].includes(event.kind)) return null;
  return { ...event, seq: Number(event.seq || 0) } as VergerEvent;
}

function toStoredRow(row: any): StoredRow | null {
  const event = toEvent(row?.event_data);
  if (!event || !row?.conversation_key) return null;
  return {
    conversationKey: String(row.conversation_key),
    title: String(row.title || 'New conversation'),
    role: row.role === 'user' ? 'user' : 'assistant',
    content: String(row.content || ''),
    verger: event,
    createdAt: String(row.created_at || ''),
  };
}

function legacyEvent(row: any): any | null {
  const attachments = safeParse(row?.attachments);
  const event = attachments?.verger;
  return event && typeof event === 'object' && typeof event.kind === 'string' ? event : null;
}

async function loadLegacyRows(handle: any): Promise<any[]> {
  try {
    const response = await handle.from(LEGACY_TABLE).orderBy('created_at', 'asc').limit(500).get();
    const rows = Array.isArray(response?.data) ? response.data : [];
    return rows.filter((row: any) => legacyEvent(row));
  } catch {
    return [];
  }
}

function legacyTitle(rows: any[]): string {
  const firstUser = rows.find((row) => row.role === 'user' && ['say', 'answer'].includes(String(legacyEvent(row)?.kind || '')));
  return firstUser ? conversationTitle(String(firstUser.content || '')) : 'Recovered conversation';
}

function legacyConversationRows(rows: any[]): StoredRow[] {
  const title = legacyTitle(rows);
  return rows.flatMap((row): StoredRow[] => {
    const event = legacyEvent(row);
    const normalized = toEvent(event);
    if (!normalized) return [];
    return [{
      conversationKey: LEGACY_CONVERSATION_KEY,
      title,
      role: row.role === 'user' ? 'user' : 'assistant',
      content: String(row.content || ''),
      verger: normalized,
      createdAt: String(row.created_at || ''),
    }];
  });
}

function legacyRuns(rows: any[]): StoredRun[] {
  const latest = new Map<string, StoredRun>();
  for (const row of rows) {
    const event = legacyEvent(row);
    if (!event?.run?.runId || !['run', 'run_result'].includes(String(event.kind || ''))) continue;
    const run = event.run;
    const parsed: StoredRun = {
      conversationKey: LEGACY_CONVERSATION_KEY,
      runId: String(run.runId),
      agentType: String(run.agentType || run.name || 'specialist'),
      name: String(run.name || run.agentType || 'Specialist'),
      task: String(run.task || ''),
      status: run.status === 'done' ? 'done' : run.status === 'failed' ? 'failed' : 'running',
      resultText: '',
      seq: Number(event.seq || 0),
      createdAt: String(row.created_at || ''),
    };
    const previous = latest.get(parsed.runId);
    if (!previous || parsed.seq >= previous.seq) latest.set(parsed.runId, parsed);
  }
  return Array.from(latest.values());
}

function sortRows(rows: StoredRow[]): StoredRow[] {
  return rows.sort((a, b) => {
    const byTime = Date.parse(a.createdAt || '0') - Date.parse(b.createdAt || '0');
    return byTime !== 0 ? byTime : a.verger.seq - b.verger.seq;
  });
}

/** List this session's conversations, newest first. */
export async function loadConversationIndex(): Promise<ConversationSummary[]> {
  const handle = await dbReady();
  if (!handle) return [];
  const summaries = new Map<string, ConversationSummary>();
  try {
    const response = await handle.from(CONVERSATIONS_TABLE).orderBy('created_at', 'desc').limit(2000).get();
    const rows: any[] = Array.isArray(response?.data) ? response.data : [];
    for (const row of rows) {
      const key = String(row.conversation_key || '');
      if (!key) continue;
      const current = summaries.get(key);
      const updatedAt = String(row.created_at || '');
      if (!current) {
        summaries.set(key, { key, title: String(row.title || 'Conversation'), updatedAt, messageCount: 1 });
      } else {
        current.messageCount += 1;
        if (Date.parse(updatedAt || '0') > Date.parse(current.updatedAt || '0')) {
          current.updatedAt = updatedAt;
          current.title = String(row.title || current.title);
        }
      }
    }
  } catch (error) {
    console.warn('[Verger] could not list saved conversations.', error);
  }

  const legacy = await loadLegacyRows(handle);
  if (legacy.length) {
    const existing = summaries.get(LEGACY_CONVERSATION_KEY);
    const latestLegacy = String(legacy[legacy.length - 1]?.created_at || '');
    if (existing) {
      existing.messageCount += legacyConversationRows(legacy).length;
      if (Date.parse(latestLegacy || '0') > Date.parse(existing.updatedAt || '0')) existing.updatedAt = latestLegacy;
    } else {
      summaries.set(LEGACY_CONVERSATION_KEY, {
        key: LEGACY_CONVERSATION_KEY,
        title: legacyTitle(legacy),
        updatedAt: latestLegacy,
        messageCount: legacyConversationRows(legacy).length,
      });
    }
  }

  return Array.from(summaries.values())
    .sort((a, b) => Date.parse(b.updatedAt || '0') - Date.parse(a.updatedAt || '0'));
}

/** Load one conversation's transcript/planner events, oldest first. */
export async function loadConversation(conversationKey: string): Promise<StoredRow[]> {
  const handle = await dbReady();
  if (!handle) return [];
  let rows: StoredRow[] = [];
  try {
    const response = await handle.from(CONVERSATIONS_TABLE)
      .eq('conversation_key', conversationKey)
      .orderBy('created_at', 'asc')
      .limit(1000)
      .get();
    const data: any[] = Array.isArray(response?.data) ? response.data : [];
    rows = data.map(toStoredRow).filter((row): row is StoredRow => row !== null);
  } catch (error) {
    console.warn('[Verger] could not load the saved conversation.', error);
  }
  if (conversationKey === LEGACY_CONVERSATION_KEY) {
    rows = [...legacyConversationRows(await loadLegacyRows(handle)), ...rows];
  }
  return sortRows(rows);
}

/** Append a full project snapshot beside the transcript without creating another table. */
export async function appendProjectSnapshot(
  conversationKey: string,
  title: string,
  project: VergerProject,
): Promise<boolean> {
  return appendEvent(conversationKey, title, 'assistant', `Project updated: ${project.title}`, {
    kind: 'project',
    seq: nextSeq(),
    project,
  });
}

/** Recover the newest project snapshot for one conversation. */
export async function loadProjectSnapshot(conversationKey: string): Promise<VergerProject | null> {
  const rows = await loadConversation(conversationKey);
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const project = rows[index]?.verger?.project;
    if (project && typeof project === 'object' && project.id) return project;
  }
  return null;
}

/** Load the latest snapshot of every specialist run in one conversation. */
export async function loadRunHistory(conversationKey: string): Promise<StoredRun[]> {
  const handle = await dbReady();
  if (!handle) return [];
  const latest = new Map<string, StoredRun>();
  try {
    const response = await handle.from(RUNS_TABLE)
      .eq('conversation_key', conversationKey)
      .orderBy('created_at', 'asc')
      .limit(1000)
      .get();
    const rows: any[] = Array.isArray(response?.data) ? response.data : [];
    for (const row of rows) {
      const runId = String(row.run_key || '');
      if (!runId) continue;
      const parsed: StoredRun = {
        conversationKey,
        runId,
        agentType: String(row.agent_type || 'specialist'),
        name: String(row.name || row.agent_type || 'Specialist'),
        task: String(row.task || ''),
        status: row.status === 'done' ? 'done' : row.status === 'failed' ? 'failed' : 'running',
        resultText: String(row.result_text || ''),
        seq: Number(row.sequence || 0),
        createdAt: String(row.created_at || ''),
      };
      const previous = latest.get(runId);
      if (!previous || parsed.seq >= previous.seq) latest.set(runId, parsed);
    }
  } catch (error) {
    console.warn('[Verger] could not load specialist run history.', error);
  }
  if (conversationKey === LEGACY_CONVERSATION_KEY) {
    for (const run of legacyRuns(await loadLegacyRows(handle))) {
      if (!latest.has(run.runId)) latest.set(run.runId, run);
    }
  }
  return Array.from(latest.values())
    .sort((a, b) => Date.parse(a.createdAt || '0') - Date.parse(b.createdAt || '0'));
}
