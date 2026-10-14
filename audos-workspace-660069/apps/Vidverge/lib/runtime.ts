/**
 * ENGINE RUNTIME — workspace identity, timing and small browser chores.
 *
 * Every paid platform endpoint rejects an anonymous call with
 * `401 no_credentials` before the provider is contacted, so the token is read
 * at call time and a missing one fails loudly here rather than surfacing as an
 * unexplained 401 three stages into a run.
 */

export const WORKSPACE_ID = 'f24710e5-7c6d-4db4-92b4-c2c235877575';

/**
 * The SPACE id, which is a different identifier from the workspace UUID above.
 * Server-function execute URLs are addressed by space (`/api/hooks/execute/
 * <spaceId>/<hookName>`), while the platform's workspace-scoped REST endpoints
 * are addressed by the UUID. Using one where the other belongs answers 404.
 */
export const SPACE_ID = 'workspace-660069';

export function workspaceId(): string {
  if (typeof window === 'undefined') return WORKSPACE_ID;
  const w = window as any;
  return String(w.__workspaceDb?.workspaceId || w.__WORKSPACE_ID__ || WORKSPACE_ID);
}

export function workspaceToken(): string {
  if (typeof window === 'undefined') return '';
  return String((window as any).__workspaceDb?.token || '');
}

export function hasWorkspaceToken(): boolean {
  return Boolean(workspaceToken());
}

export const SESSION_NOT_READY =
  'Your workspace session is still loading. Refresh the page and start the job again.';

/**
 * A failure the customer is shown. `stage` names the step that broke so the
 * tracker can say "the voiceover failed" instead of "something failed".
 */
export class EngineStageError extends Error {
  stage: string;
  constructor(message: string, stage: string) {
    super(message);
    this.name = 'EngineStageError';
    this.stage = stage;
  }
}

/** JSON headers carrying the workspace token every proxy call must send. */
export function authHeaders(): Record<string, string> {
  const token = workspaceToken();
  if (!token) throw new EngineStageError(SESSION_NOT_READY, 'session');
  return { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token };
}

/** Multipart headers: the browser sets Content-Type so the boundary is right. */
export function uploadHeaders(): Record<string, string> {
  const token = workspaceToken();
  if (!token) throw new EngineStageError(SESSION_NOT_READY, 'session');
  return { 'X-Workspace-DB-Token': token };
}

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Generation POSTs carry a two-minute network timeout: a call that has not
 * answered by then never will, and an unanswered fetch would otherwise hang
 * its stage forever — past every polling deadline downstream. */
export const GENERATION_TIMEOUT_MS = 120_000;
/** Status reads are small GETs; 30s is generous. */
export const STATUS_TIMEOUT_MS = 30_000;

/** AbortSignal.timeout where the browser has it; undefined (the old
 * no-timeout behaviour) on engines that predate it, rather than crashing. */
export function timeoutSignal(ms: number): AbortSignal | undefined {
  try {
    const AS: any = typeof AbortSignal === 'undefined' ? null : AbortSignal;
    return AS && typeof AS.timeout === 'function' ? AS.timeout(ms) : undefined;
  } catch {
    return undefined;
  }
}

/** True when a fetch rejection is our AbortSignal firing, not the network dropping. */
export function isAbortError(e: unknown): boolean {
  const name = String((e as any)?.name || '');
  return name === 'TimeoutError' || name === 'AbortError';
}

/**
 * Turn a platform error body into one sentence worth showing. The managed
 * endpoints answer with a machine-readable `code`, and a few of those are not
 * something the customer can act on — saying so stops them hunting for an API
 * key or a top-up that would not help.
 */
export function describePlatformError(data: any, status: number, fallback: string): string {
  const code = String(data?.code || data?.error?.code || '');
  const detail = String(
    data?.error?.message || (typeof data?.error === 'string' ? data.error : '') || data?.message || '',
  ).trim();
  const known: Record<string, string> = {
    no_credentials: SESSION_NOT_READY,
    workspace_token_invalid: SESSION_NOT_READY,
    insufficient_balance:
      'The workspace wallet cannot cover this step. Top it up and run the job again.',
    provider_quota_exceeded:
      'The Audos-managed provider account is out of credits right now. This is not your wallet and not a key you can add — try again shortly.',
    rate_limited: 'The service is rate-limited right now. Wait a moment and run the job again.',
    unsupported_model: 'That model is not on the platform\u2019s approved list.',
  };
  if (known[code]) return known[code];
  if (status === 402) return known.insufficient_balance;
  if (detail) return `${detail}${code ? ` [${code}]` : ''}`;
  return `${fallback} (HTTP ${status})`;
}

/** Download a remote asset through a blob so the browser saves it. */
export async function downloadRemote(url: string, filename: string): Promise<void> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(String(response.status));
    const objectUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch {
    // A cross-origin asset that refuses a fetch can still be opened directly.
    window.open(url, '_blank', 'noopener');
  }
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function formatClock(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}
