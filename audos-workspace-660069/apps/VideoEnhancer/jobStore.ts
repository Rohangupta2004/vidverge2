/**
 * Account-scoped Video Enhancer job persistence.
 *
 * Every request uses the WorkspaceDB REST API with the injected workspace
 * token explicitly attached. Rows remain session-owned server-side, while
 * user_id lets the UI restore the same account's latest job after sign-out,
 * sign-in, or a fresh browser session.
 */
import { WORKSPACE_UUID, workspaceToken } from './enhancerCore';

export type EnhancerJobStatus = 'uploading' | 'processing' | 'done' | 'error';

export interface EnhancerJobRow {
  id: number;
  user_id: string;
  status: EnhancerJobStatus;
  video_url?: string | null;
  result_url?: string | null;
  caption_text?: string | null;
  session_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

const TABLE = 'video_enhancer_jobs';
const DATA_URL = '/api/workspaces/' + WORKSPACE_UUID + '/data/' + TABLE;

function rowsFrom(payload: any): EnhancerJobRow[] {
  const value = payload && payload.data != null
    ? payload.data
    : payload && payload.rows != null
      ? payload.rows
      : payload;
  if (Array.isArray(value)) return value as EnhancerJobRow[];
  return value && typeof value === 'object' ? [value as EnhancerJobRow] : [];
}

async function dbRequest(path: string, init: RequestInit = {}): Promise<any> {
  const token = workspaceToken();
  if (!token) throw new Error('Your workspace session is still loading — try again in a moment.');
  const res = await fetch(DATA_URL + path, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
      'X-Workspace-DB-Token': token,
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data && typeof data.error === 'string' ? data.error : '';
    throw new Error(detail || ('Could not save your Video Enhancer job (HTTP ' + res.status + ').'));
  }
  return data;
}

/** Latest row for this signed-in account. Shared scope includes verified sessions for the same account. */
export async function fetchLatestEnhancerJob(userId: string): Promise<EnhancerJobRow | null> {
  if (!userId) return null;
  const query = new URLSearchParams({
    _shared: '1',
    _limit: '1',
    _sort: 'updated_at',
    _order: 'desc',
    user_id: 'eq.' + userId,
  });
  const rows = rowsFrom(await dbRequest('?' + query.toString()));
  return rows[0] || null;
}

/** Create one row before upload starts so interrupted uploads remain visible. */
export async function createEnhancerJob(userId: string): Promise<EnhancerJobRow> {
  const rows = rowsFrom(await dbRequest('', {
    method: 'POST',
    body: JSON.stringify({
      rows: [{
        user_id: userId,
        status: 'uploading',
        video_url: null,
        result_url: null,
        caption_text: '',
      }],
    }),
  }));
  const row = rows[0];
  if (!row || !Number.isFinite(Number(row.id))) throw new Error('The upload started, but its workspace record could not be created.');
  return { ...row, id: Number(row.id) };
}

/** Update the existing row as upload, processing, captions, and results change. */
export async function updateEnhancerJob(
  rowId: number | null,
  patch: Partial<Pick<EnhancerJobRow, 'user_id' | 'status' | 'video_url' | 'result_url' | 'caption_text'>>,
): Promise<void> {
  if (!rowId) return;
  await dbRequest('/' + encodeURIComponent(String(rowId)), {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}
