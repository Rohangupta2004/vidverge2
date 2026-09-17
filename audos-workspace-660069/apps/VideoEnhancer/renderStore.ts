/**
 * Video Enhancer — shared render persistence + polling.
 *
 * Every Remotion render this app submits (main export, script graphics) is
 * persisted to the WorkspaceDB `video_enhancements` table through the browser
 * SDK (window.__workspaceDb): an account-owned row is inserted as 'processing'
 * the moment the render is submitted,
 * `progress` is patched while polling advances, and the final MP4 URL — or
 * the provider's actual failure reason — is written when the render ends.
 *
 * On mount, App.tsx reads the table back and RESUMES polling any row that is
 * still in progress, so a tab switch, app unmount or full page reload never
 * orphans a render: the operation id lives in the row, not in a closure.
 *
 * Polling distinguishes transient problems from terminal ones: a failed
 * status CALL is retried with growing backoff (a wobbly connection is not a
 * failed render), while an unbroken run of failures, a 'failed' status from
 * the render service, or the 15-minute budget running out are terminal and
 * are written to the row with a human-readable reason.
 */
import { checkRender } from './enhancerCore';

export interface EnhancementRow {
  id: number;
  status: string;
  op_id?: string | null;
  progress?: number | null;
  output_url?: string | null;
  error_message?: string | null;
  title?: string | null;
  user_id?: string | null;
  created_at?: string;
  input_params?: Record<string, unknown> | null;
}

const TABLE = 'video_enhancements';
export const RENDER_POLL_BUDGET_MS = 15 * 60 * 1000;
const POLL_INTERVAL_MS = 4000;
/** Consecutive failed status CALLS tolerated before the render is declared unreachable. */
const MAX_POLL_FAILURES = 5;

function msg(e: unknown): string { return e instanceof Error ? e.message : String(e); }
function sleep(ms: number): Promise<void> { return new Promise((r) => { setTimeout(r, ms); }); }

function wdb(): any {
  if (typeof window === 'undefined') return null;
  return (window as any).__workspaceDb || null;
}

/** The visitor session id — recorded on each row as user_id so a reload can find "my" renders. */
export function veSessionId(): string {
  if (typeof window === 'undefined') return '';
  const w = window as any;
  if (typeof w.__spaceSessionId === 'string' && w.__spaceSessionId) return w.__spaceSessionId;
  const client = w.__workspaceDb;
  return client && typeof client.sessionId === 'string' ? client.sessionId : '';
}

export function veWorkspaceId(): string {
  if (typeof window === 'undefined') return '';
  const w = window as any;
  const id = w.__SPACE_ID__ || w.__APP_ID__ || (w.__SPACE_CONFIG__ && w.__SPACE_CONFIG__.id) || '';
  return id ? (String(id).startsWith('workspace-') ? String(id) : 'workspace-' + id) : '';
}

/** Newest renders owned by the current signed-in visitor. Best-effort. */
export async function fetchRenderRows(): Promise<EnhancementRow[]> {
  const client = wdb();
  if (!client || typeof client.from !== 'function') return [];
  try {
    const res = await client
      .from(TABLE)
      .orderBy('created_at', 'desc')
      .limit(24)
      .get();
    return Array.isArray(res && res.data) ? (res.data as EnhancementRow[]) : [];
  } catch (e) {
    console.warn('[VideoEnhancer] could not read persisted renders:', e);
    return [];
  }
}

/** Insert the row that lets a render survive an unmount. Best-effort. */
export async function insertRenderRow(fields: Record<string, unknown>): Promise<number | null> {
  const client = wdb();
  if (!client || typeof client.from !== 'function') return null;
  try {
    const res = await client.from(TABLE).insert(fields);
    const row = res && res.data ? (Array.isArray(res.data) ? res.data[0] : res.data) : res;
    const id = row && row.id != null ? Number(row.id) : NaN;
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch (e) {
    console.warn('[VideoEnhancer] could not persist the render row:', e);
    return null;
  }
}

export async function updateRenderRow(rowId: number | null, patch: Record<string, unknown>): Promise<void> {
  if (!rowId) return;
  const client = wdb();
  if (!client || typeof client.from !== 'function') return;
  try {
    await client.from(TABLE).update(rowId, patch);
  } catch (e) {
    console.warn('[VideoEnhancer] could not update the render row:', e);
  }
}

/** input_params can come back as a JSON string depending on the read path — always normalize before reading. */
export function renderParams(row: EnhancementRow): Record<string, unknown> {
  let p: unknown = row.input_params;
  if (typeof p === 'string') {
    try { p = JSON.parse(p); } catch { p = null; }
  }
  return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
}

/** Which flow produced a row ('enhanced' main export, 'script-graphics', …). */
export function renderKind(row: EnhancementRow): string {
  const kind = renderParams(row).kind;
  return typeof kind === 'string' && kind ? kind : 'enhanced';
}

export interface RenderPollHandlers {
  /** Return false once the caller unmounted — the loop stops without touching the row, and the next mount resumes it. */
  isAlive?: () => boolean;
  /** Fires on every successful status poll with a coarse synthetic progress (8–92). */
  onTick?: (info: { progress: number; status: 'pending' | 'rendering' }) => void;
}

export interface RenderOutcome { status: 'completed' | 'failed'; url?: string; error?: string }

/**
 * Poll one render operation to a terminal state, keeping its DB row in sync.
 * Used by fresh submissions AND by the on-mount resume, so both paths behave
 * identically. Returns null when the caller unmounted mid-poll (row is left
 * 'processing' for the next mount to pick up).
 */
export async function pollRenderToOutcome(
  opId: string,
  rowId: number | null,
  startedAt: number,
  handlers: RenderPollHandlers = {},
): Promise<RenderOutcome | null> {
  let progress = 8;
  let lastWrittenProgress = 0;
  let failures = 0;
  while (Date.now() - startedAt < RENDER_POLL_BUDGET_MS) {
    // Transient poll failures grow the wait (4s → 7s → 10s…) instead of hammering.
    await sleep(POLL_INTERVAL_MS + failures * 3000);
    if (handlers.isAlive && !handlers.isAlive()) return null;
    let st: Awaited<ReturnType<typeof checkRender>>;
    try {
      st = await checkRender(opId);
    } catch (e) {
      // A failed status CALL is not a failed render — but an unbroken run of
      // them means nothing is coming back, so surface it instead of spinning
      // silently until the budget runs out.
      failures += 1;
      if (failures >= MAX_POLL_FAILURES) {
        const reason = 'Lost contact with the render service (' + msg(e) + '). The render may still finish server-side — reload this app in a minute to reconnect.';
        await updateRenderRow(rowId, { status: 'failed', error_message: reason });
        return { status: 'failed', error: reason };
      }
      continue;
    }
    failures = 0;
    if (st.status === 'complete' && st.videoUrl) {
      await updateRenderRow(rowId, { status: 'completed', progress: 100, output_url: st.videoUrl });
      return { status: 'completed', url: st.videoUrl };
    }
    if (st.status === 'failed') {
      // Terminal: surface the provider's ACTUAL reason, not a generic error.
      const reason = st.error || 'The render service reported a failure without a reason.';
      await updateRenderRow(rowId, { status: 'failed', error_message: reason });
      return { status: 'failed', error: reason };
    }
    progress = Math.min(92, progress + 3);
    if (progress - lastWrittenProgress >= 9) {
      lastWrittenProgress = progress;
      void updateRenderRow(rowId, { progress });
    }
    if (handlers.onTick) handlers.onTick({ progress, status: st.status === 'rendering' ? 'rendering' : 'pending' });
  }
  const reason = 'The render timed out after 15 minutes — try the export again.';
  await updateRenderRow(rowId, { status: 'failed', error_message: reason });
  return { status: 'failed', error: reason };
}
