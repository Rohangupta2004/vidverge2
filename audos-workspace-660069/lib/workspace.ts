/**
 * One place for workspace identity, the workspace DB token, the visitor
 * session id, and the hook-call envelope every app shares.
 *
 * Before this file there were 34 hard-coded copies of the workspace UUID and
 * 29 separate token getters, each with its own idea of how long to wait and
 * what to do about a 401. Import from here instead of re-deriving any of it.
 */

/** Workspace UUID. The only copy. */
export const WORKSPACE_ID = 'f24710e5-7c6d-4db4-92b4-c2c235877575';

/** Space id used in the public hook execute path. The only copy. */
export const SPACE_ID = 'workspace-660069';

declare global {
  interface Window {
    __workspaceDb?: { token?: string };
    __APP_ID__?: string;
    __SPACE_ID__?: string;
    __SESSION_ID__?: string;
    /** The canonical validated `wses_…` session — published by SpaceRuntimeContext. */
    __spaceSessionId?: string;
  }
}

const TOKEN_WAIT_MS = 10_000;
const TOKEN_POLL_MS = 150;

/** Synchronous read. Empty string when the runtime has not injected it yet. */
export function workspaceTokenNow(): string {
  if (typeof window === 'undefined') return '';
  return String(window.__workspaceDb?.token || '');
}

/**
 * Wait up to 10 seconds for the runtime to inject the workspace DB token.
 *
 * The token arrives slightly after first paint, so a component that fetches in
 * its first effect used to race it and get an anonymous 401. Every app had its
 * own retry for that. This is the shared one.
 */
export async function getWorkspaceToken(timeoutMs = TOKEN_WAIT_MS): Promise<string> {
  if (typeof window === 'undefined') return '';
  const deadline = Date.now() + Math.max(0, timeoutMs);
  let token = workspaceTokenNow();
  while (!token && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, TOKEN_POLL_MS));
    token = workspaceTokenNow();
  }
  return token;
}

/** The space id this page is actually running under, falling back to the constant. */
export function spaceId(): string {
  if (typeof window === 'undefined') return SPACE_ID;
  return String(window.__APP_ID__ || window.__SPACE_ID__ || SPACE_ID);
}

/**
 * Canonical visitor session id (`wses_…` or its UUID form).
 *
 * THE FIRST SOURCE IS `window.__spaceSessionId` — the global the shell
 * (SpaceRuntimeContext) actually publishes the validated `wses_…` session on,
 * and the one `lib/plans.ts` already reads. This function used to read only
 * `__SESSION_ID__` and `audos:sessionId`, which nothing in this space sets, so
 * every call to a session-gated hook (`executeAuth: "workspace_session"` —
 * stv-scene-generate, vv-credits, …) went out with NO X-Session-Id and was
 * rejected with "Workspace session required" even for a signed-in customer.
 *
 * A session-gated hook rejects client-minted placeholders (`anon_…`,
 * `ephemeral_…`, `csess_…`, `space-<email>-<uuid>`), so those are filtered out
 * here rather than sent and refused.
 */
export function getSessionId(): string {
  if (typeof window === 'undefined') return '';
  let raw = '';
  try {
    raw =
      String(window.__spaceSessionId || '') ||
      String(window.__SESSION_ID__ || '') ||
      String(window.localStorage.getItem('audos:sessionId') || '') ||
      String(window.sessionStorage.getItem('audos:sessionId') || '');
  } catch {
    raw = String(window.__spaceSessionId || window.__SESSION_ID__ || '');
  }
  const id = raw.trim();
  if (!id) return '';
  if (/^(anon|ephemeral|csess|space)[-_]/i.test(id)) return '';
  return id;
}

/** Public execute URL for one of this workspace's server functions. */
export function hookUrl(hookName: string): string {
  return `/api/hooks/execute/${spaceId()}/${hookName}`;
}

export interface CallHookOptions {
  /** Wait for the workspace token before sending. Default true. */
  waitForToken?: boolean;
  /** Retry once after a 401, re-reading the token first. Default true. */
  retryOn401?: boolean;
  signal?: AbortSignal;
}

export class HookError extends Error {
  status: number;
  hookName: string;
  constructor(message: string, hookName: string, status: number) {
    super(message);
    this.name = 'HookError';
    this.hookName = hookName;
    this.status = status;
  }
}

function unwrap(payload: unknown): any {
  if (payload && typeof payload === 'object') {
    const envelope = payload as Record<string, unknown>;
    if ('response' in envelope && '_meta' in envelope) return envelope.response;
  }
  return payload;
}

/**
 * Call a server function with the full header set every gated hook expects:
 * the workspace DB token, the canonical session id, and the app id.
 *
 * A money-spending hook runs behind `executeAuth: "workspace_session"`, which
 * rejects a request with no `X-Session-Id` before any hook code runs. Routing
 * every call through here is what makes that gate safe to switch on.
 */
export async function callHook<T = any>(
  hookName: string,
  body: Record<string, unknown> = {},
  options: CallHookOptions = {},
): Promise<T> {
  const { waitForToken = true, retryOn401 = true, signal } = options;

  const send = async (token: string): Promise<Response> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['X-Workspace-DB-Token'] = token;
    const sid = getSessionId();
    if (sid) headers['X-Session-Id'] = sid;
    headers['X-App-Id'] = spaceId();
    return fetch(hookUrl(hookName), {
      method: 'POST',
      headers,
      body: JSON.stringify(sid ? { session_id: sid, ...body } : body),
      signal,
    });
  };

  let token = waitForToken ? await getWorkspaceToken() : workspaceTokenNow();
  let res = await send(token);

  if (res.status === 401 && retryOn401) {
    token = await getWorkspaceToken(3_000);
    res = await send(token);
  }

  const parsed = unwrap(await res.json().catch(() => null));

  if (!res.ok) {
    const message =
      (parsed && typeof parsed === 'object' && (parsed as any).error) ||
      (res.status === 401
        ? 'Please sign in again to continue.'
        : `The ${hookName} service did not answer (HTTP ${res.status}).`);
    throw new HookError(String(message), hookName, res.status);
  }

  return (parsed || {}) as T;
}
