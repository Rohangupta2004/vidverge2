// The BYOK path. Voice Studio never holds an API key: every call to the
// founder's own ElevenLabs account goes through the workspace secrets proxy,
// which substitutes {{secrets.ELEVENLABS_API_KEY}} server-side. The key never
// reaches this bundle, the model, or a log line.
import { workspaceId, workspaceToken } from './runtime';

export const ELEVENLABS_SECRET = 'ELEVENLABS_API_KEY';
export const ELEVENLABS_HOST = 'api.elevenlabs.io';

/**
 * What we have learned about the founder's stored key. No API can tell us
 * whether a secret exists — the only way to find out is to make the real call
 * and read the answer — so the verdict is probed once and latched for the rest
 * of the session instead of re-probed per tab or per render.
 */
export type KeyVerdict = 'unknown' | 'usable' | 'missing' | 'host-not-allowed' | 'rejected';

/** Proxy refusals that mean the key is unusable as configured. Everything else is transient or our bug. */
const CONFIG_FAILURES = ['unknown_secret', 'no_allowed_hosts', 'host_not_allowed'];

let verdict: KeyVerdict = 'unknown';
const listeners = new Set<(next: KeyVerdict) => void>();

export function keyVerdict(): KeyVerdict {
  return verdict;
}

/** True once we know the founder's own ElevenLabs key cannot serve a request. */
export function keyUnusable(): boolean {
  return verdict === 'missing' || verdict === 'host-not-allowed' || verdict === 'rejected';
}

export function onKeyVerdictChange(listener: (next: KeyVerdict) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function latch(next: KeyVerdict) {
  if (verdict === next) return;
  verdict = next;
  listeners.forEach((listener) => listener(next));
}

/**
 * The three unusable verdicts need three different sentences, because they
 * need three different fixes. "API call failed" sends the founder to look at
 * the wrong thing — and telling someone to add a key they already added is the
 * worst of the three.
 */
export function keyVerdictMessage(value: KeyVerdict = verdict): string | null {
  if (value === 'missing') {
    return `No ${ELEVENLABS_SECRET} is stored for this workspace (or it is switched off). Ask Otto to add your ElevenLabs API key and allow it to call ${ELEVENLABS_HOST}.`;
  }
  if (value === 'host-not-allowed') {
    return `${ELEVENLABS_SECRET} is not allowed to call ${ELEVENLABS_HOST}. Ask Otto to add that host to the key.`;
  }
  if (value === 'rejected') {
    return `${ELEVENLABS_SECRET} was rejected by ${ELEVENLABS_HOST} (401/403). The key exists — check or rotate its value.`;
  }
  return null;
}

export class ProxyError extends Error {
  code: string;
  /** The proxy's own HTTP status, or the upstream status when the round trip completed. */
  status: number;
  transient: boolean;
  constructor(message: string, options: { code?: string; status?: number; transient?: boolean } = {}) {
    super(message);
    this.name = 'ProxyError';
    this.code = options.code || 'proxy_failed';
    this.status = options.status || 0;
    this.transient = Boolean(options.transient);
  }
}

/** Raised when the founder's key cannot serve the request at all, so a caller can take its fallback path. */
export class KeyUnusableError extends ProxyError {
  verdict: KeyVerdict;
  constructor(value: KeyVerdict) {
    super(keyVerdictMessage(value) || 'Your ElevenLabs API key is not usable.', { code: 'key_unusable' });
    this.name = 'KeyUnusableError';
    this.verdict = value;
  }
}

const TRANSIENT = ['rate_limited', 'concurrency_limited', 'signer_error', 'proxy_error', 'upstream_error'];

export interface ProxyRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  json?: unknown;
  body?: string;
  form?: Record<string, string>;
  formEncoding?: 'multipart';
  responseType?: 'json' | 'text' | 'binary';
}

export interface ProxyResponse<T = any> {
  status: number;
  headers: Record<string, string>;
  body: T;
  encoding?: 'base64';
}

/**
 * One call against the founder's ElevenLabs account. Resolves only when the
 * round trip completed AND the upstream answered 2xx; every other outcome is a
 * typed throw so callers never have to guess whether `body` is data.
 */
export async function elevenlabs<T = any>(request: ProxyRequest): Promise<ProxyResponse<T>> {
  if (keyUnusable()) throw new KeyUnusableError(verdict);

  const headers = { 'xi-api-key': `{{secrets.${ELEVENLABS_SECRET}}}`, ...(request.headers || {}) };

  let response: Response;
  try {
    response = await fetch(`/api/workspaces/${workspaceId()}/secrets/proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': workspaceToken() },
      body: JSON.stringify({ ...request, headers }),
    });
  } catch (e: any) {
    throw new ProxyError(String(e?.message || 'ElevenLabs could not be reached.'), { code: 'network', transient: true });
  }

  const data = await response.json().catch(() => ({} as any));

  if (!response.ok) {
    const code = String(data?.code || '');
    if (CONFIG_FAILURES.indexOf(code) >= 0) {
      latch(code === 'unknown_secret' ? 'missing' : 'host-not-allowed');
      throw new KeyUnusableError(verdict);
    }
    const transient = TRANSIENT.indexOf(code) >= 0 || response.status >= 500;
    throw new ProxyError(
      String(data?.error || data?.message || `ElevenLabs request failed (${code || response.status}).`),
      { code: code || String(response.status), status: response.status, transient },
    );
  }

  // The round trip completed. That is not the same as the API call working —
  // the upstream's own status decides.
  const status = Number(data?.status) || 0;
  if (status === 401 || status === 403) {
    latch('rejected');
    throw new KeyUnusableError('rejected');
  }
  if (status < 200 || status >= 300) {
    throw new ProxyError(upstreamMessage(data, status), {
      code: 'upstream_rejected',
      status,
      transient: status === 429 || status >= 500,
    });
  }

  latch('usable');
  return { status, headers: data?.headers || {}, body: data?.body as T, encoding: data?.encoding };
}

/** ElevenLabs reports problems as `detail.message`, `detail` as a string, or a validation array. */
function upstreamMessage(data: any, status: number): string {
  const body = data?.body;
  const detail = body?.detail ?? body?.error ?? body?.message;
  if (typeof detail === 'string' && detail.trim()) return `ElevenLabs: ${detail} (${status})`;
  if (detail?.message) return `ElevenLabs: ${detail.message} (${status})`;
  if (Array.isArray(detail) && detail.length) {
    const first = detail[0];
    const where = Array.isArray(first?.loc) ? ` [${first.loc.join('.')}]` : '';
    return `ElevenLabs: ${first?.msg || 'the request was rejected'}${where} (${status})`;
  }
  if (typeof body === 'string' && body.trim()) return `ElevenLabs: ${body.slice(0, 180)} (${status})`;
  return `ElevenLabs rejected the request (${status}).`;
}

/**
 * A proxy call whose answer is audio. The proxy base64-encodes bytes rather
 * than mangling them through a lossy UTF-8 decode, so the caller must branch
 * on `encoding` — re-reading a base64 body as text destroys it.
 */
export async function elevenlabsBytes(request: ProxyRequest): Promise<{ base64: string; contentType: string }> {
  const result = await elevenlabs<string>({ ...request, responseType: 'binary' });
  if (result.encoding !== 'base64' || typeof result.body !== 'string') {
    throw new ProxyError('ElevenLabs returned something that is not audio. Try again.', { code: 'not_binary' });
  }
  return { base64: result.body, contentType: String(result.headers?.['content-type'] || 'audio/mpeg').split(';')[0] };
}
