/**
 * VERGEYE — transport.
 *
 * There is exactly one server endpoint: the vergeye-ops server function. Every
 * website read, every Google search, every AI call, the Veo job, the Remotion
 * finish and every row of vergeye_comparisons go through it, for three reasons
 * that are worth writing down because they are what shaped the app:
 *
 *   1. A competitor's website cannot be fetched from a page. It is a different
 *      origin and sends no CORS headers, so URL intake is server-side or it does
 *      not exist.
 *   2. vergeye_comparisons is declared serverHooksOnly. The workspace DB token
 *      ships inside the published bundle, so a page that could write the table
 *      directly could be replayed by anyone holding that token.
 *   3. Nothing here spends against a provider key held in the browser.
 *
 * The only thing the browser does on its own is upload a file, because an
 * upload is a multipart POST of bytes the page already has.
 */

const SPACE_FALLBACK = 'workspace-660069';
const OWNER_STORAGE_KEY = 'vergeye_owner_key_v1';

function spaceRef(): string {
  if (typeof window === 'undefined') return SPACE_FALLBACK;
  const injected = (window as any).__SPACE_ID__ || (window as any).__APP_ID__;
  const id = String(injected || SPACE_FALLBACK);
  return id.indexOf('workspace-') === 0 ? id : `workspace-${id}`;
}

export function workspaceUuid(): string {
  if (typeof window === 'undefined') return '';
  const db = (window as any).__workspaceDb;
  return String((window as any).__WORKSPACE_ID__ || (db && db.workspaceId) || '');
}

function spaceSessionId(): string {
  if (typeof window === 'undefined') return '';
  return String((window as any).__spaceSessionId || '');
}

/**
 * Who a saved comparison belongs to. The space session id when the visitor has
 * one, otherwise a key kept in this browser — so Saved Comparisons works for a
 * visitor who has not signed in, and still never shows them anybody else's work.
 */
export function ownerKey(): string {
  const session = spaceSessionId();
  if (session) return session;
  if (typeof window === 'undefined') return '';
  try {
    const existing = window.localStorage.getItem(OWNER_STORAGE_KEY);
    if (existing) return existing;
    const minted = `vgk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(OWNER_STORAGE_KEY, minted);
    return minted;
  } catch {
    return 'vgk_ephemeral';
  }
}

export interface OpsResult {
  ok?: boolean;
  error?: string;
  [key: string]: any;
}

async function readJson(res: Response): Promise<any> {
  try { return await res.json(); } catch { return null; }
}

export async function ops(op: string, payload: Record<string, any> = {}): Promise<OpsResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const session = spaceSessionId();
  if (session) headers['X-Session-Id'] = session;

  let res: Response;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 120_000);
  try {
    res = await fetch(`/api/hooks/execute/${spaceRef()}/vergeye-ops`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ op, ownerKey: ownerKey(), ...payload }),
      signal: controller.signal,
    });
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      throw new Error('Vergeye stopped waiting after two minutes. The server may still finish this step; reopen the saved campaign before retrying so work is not duplicated.');
    }
    throw new Error(`Vergeye could not reach the server: ${String(e?.message || e)}`);
  } finally {
    window.clearTimeout(timeout);
  }

  const data = await readJson(res);
  if (!data) throw new Error(`Vergeye got an unreadable answer from the server (HTTP ${res.status}).`);
  // A step that failed for a reason the customer can act on (a site that blocks
  // readers, a competitor that cannot be parsed) answers 200 with ok:false and
  // its own message. That is data, not an exception.
  if (res.ok && data.ok === false && data.error) return data as OpsResult;
  if (!res.ok || data.error) throw new Error(String(data.error || `Vergeye answered HTTP ${res.status}.`));
  return data as OpsResult;
}

/** A durable public URL for a character photo or a product mockup. */
export async function uploadFile(file: File, folder = 'vergeye'): Promise<string> {
  const form = new FormData();
  form.append('file', file, file.name || 'upload.bin');
  const uuid = workspaceUuid();
  if (uuid) form.append('workspaceId', uuid);
  form.append('folder', folder);
  const res = await fetch('/api/upload/file', { method: 'POST', body: form });
  const data = await readJson(res);
  if (!res.ok || !data || !data.success || typeof data.url !== 'string') {
    throw new Error(String((data && data.error) || `The upload failed (HTTP ${res.status}).`));
  }
  return data.url as string;
}
