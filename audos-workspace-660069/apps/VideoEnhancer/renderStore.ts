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
import { poll } from '../../lib/poll';
import { getSessionId, spaceId } from '../../lib/workspace';
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

function msg(e: unknown): string { return e instanceof Error ? e.message : String(e); }

function wdb(): any {
  if (typeof window === 'undefined') return null;
  return (window as any).__workspaceDb || null;
}

/** Backward-compatible aliases for persisted render row identity. */
export const veSessionId = getSessionId;
export const veWorkspaceId = spaceId;

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
  const remainingMs = Math.max(1, RENDER_POLL_BUDGET_MS - (Date.now() - startedAt));
  try {
    const final = await poll(async () => {
      if (handlers.isAlive && !handlers.isAlive()) return { stopped: true as const, status: null };
      return { stopped: false as const, status: await checkRender(opId) };
    }, {
      interval: POLL_INTERVAL_MS,
      timeout: remainingMs,
      backoff: 1.15,
      maxInterval: 16_000,
      tolerateErrors: 5,
      until: (result) => Boolean(
        result.stopped
        || result.status?.status === 'complete'
        || result.status?.status === 'failed',
      ),
      onTick: (result) => {
        const st = result.status;
        if (!st || st.status === 'complete' || st.status === 'failed') return;
        progress = Math.min(92, progress + 3);
        if (progress - lastWrittenProgress >= 9) {
          lastWrittenProgress = progress;
          void updateRenderRow(rowId, { progress });
        }
        handlers.onTick?.({ progress, status: st.status === 'rendering' ? 'rendering' : 'pending' });
      },
    });
    if (final.stopped) return null;
    const st = final.status;
    if (st?.status === 'complete' && st.videoUrl) {
      await updateRenderRow(rowId, { status: 'completed', progress: 100, output_url: st.videoUrl });
      return { status: 'completed', url: st.videoUrl };
    }
    const reason = st?.error || 'The render service reported a failure without a reason.';
    await updateRenderRow(rowId, { status: 'failed', error_message: reason });
    return { status: 'failed', error: reason };
  } catch (e) {
    const timedOut = (e as any)?.name === 'PollTimeoutError';
    const reason = timedOut
      ? 'The render timed out after 15 minutes — try the export again.'
      : 'Lost contact with the render service (' + msg(e) + '). The render may still finish server-side — reload this app in a minute to reconnect.';
    await updateRenderRow(rowId, { status: 'failed', error_message: reason });
    return { status: 'failed', error: reason };
  }
}
