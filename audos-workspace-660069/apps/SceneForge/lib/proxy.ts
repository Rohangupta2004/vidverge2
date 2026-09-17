import { WORKSPACE_ID } from './supabase';

export function workspaceToken(): string {
  const token = (window as any).__workspaceDb?.token;
  if (!token) throw new Error('Workspace authentication is not ready. Refresh and try again.');
  return String(token);
}
// Thrown by claudeJson on a non-2xx or an unparsable reply. `code` and
// `retryAfterSeconds` mirror the proxy's machine-readable rejection fields
// (see the anthropic-text-generation integration docs) so a caller can tell a
// transient 429 rate_limited burst — safe to retry after the given delay —
// from a real 400/413 the request will never survive resending.
export class ClaudeRequestError extends Error {
  code?: string;
  status?: number;
  retryAfterSeconds?: number;
  constructor(message: string, options: { code?: string; status?: number; retryAfterSeconds?: number } = {}) {
    super(message);
    this.name = 'ClaudeRequestError';
    this.code = options.code;
    this.status = options.status;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export async function claudeJson<T>(system: string, input: unknown, model = 'claude-opus-5', maxTokens = 8192): Promise<T> {
  const frontier = model.includes('opus');
  const response = await fetch('/proxy/anthropic/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': workspaceToken() },
    body: JSON.stringify({ model, max_tokens: Math.min(8192, maxTokens), ...(frontier ? { thinking: { type: 'adaptive' }, output_config: { effort: 'medium' } } : { thinking: { type: 'disabled' } }), system, messages: [{ role: 'user', content: JSON.stringify(input) }] }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    // The proxy names the reason in `code` (body_too_large, input_too_large,
    // output_tokens_too_large, rate_limited…). Without it a rejection reads as
    // a bare status and the next person has to guess what the request did.
    const detail = payload?.error?.message || (typeof payload?.error === 'string' ? payload.error : '') || payload?.message || `Claude request failed (${response.status})`;
    const message = payload?.code ? `${detail} [${payload.code}]` : String(detail);
    throw new ClaudeRequestError(message, { code: payload?.code, status: response.status, retryAfterSeconds: Number(payload?.retryAfterSeconds) || undefined });
  }
  const text = (payload.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || text;
  try { return JSON.parse(fenced) as T; } catch { throw new ClaudeRequestError('The agent returned an invalid JSON response. Try again.', { code: 'invalid_json' }); }
}

/**
 * True for failures worth retrying automatically: the proxy's documented
 * per-workspace/per-caller burst limit (429 rate_limited — the exact failure
 * seen when several Claude calls fire back-to-back, as the per-scene coding
 * pass does), a truncated/invalid reply from a transient hiccup, or a
 * network-level drop. Real 400/413 rejections (bad model, oversized body) are
 * deterministic and are excluded so they fail fast instead of retrying
 * something that can never succeed.
 */
export function isTransientAiError(error: unknown): boolean {
  if (error instanceof ClaudeRequestError) {
    if (error.code === 'rate_limited' || error.code === 'invalid_json') return true;
    if (error.status && error.status >= 500) return true;
  }
  const message = String((error as any)?.message || error || '');
  return /rate.?limit|429|5\d\d|abort|timed?\s*out|timeout|network|fetch|did not answer/i.test(message);
}
export async function uploadFile(file: File, folder = 'sceneforge-v2') {
  const form = new FormData(); form.append('file', file); form.append('workspaceId', WORKSPACE_ID); form.append('folder', folder);
  const response = await fetch('/api/upload/file', { method: 'POST', body: form });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.url) throw new Error(result.error || 'Upload failed');
  return { url: String(result.url), key: String(result.key || ''), contentType: String(result.contentType || file.type) };
}
export const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
