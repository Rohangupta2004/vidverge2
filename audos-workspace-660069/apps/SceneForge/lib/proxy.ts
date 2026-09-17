import { WORKSPACE_ID } from './supabase';

export function workspaceToken(): string {
  const token = (window as any).__workspaceDb?.token;
  if (!token) throw new Error('Workspace authentication is not ready. Refresh and try again.');
  return String(token);
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
    throw new Error(payload?.code ? `${detail} [${payload.code}]` : String(detail));
  }
  const text = (payload.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || text;
  try { return JSON.parse(fenced) as T; } catch { throw new Error('The agent returned an invalid JSON response. Try again.'); }
}
export async function uploadFile(file: File, folder = 'sceneforge-v2') {
  const form = new FormData(); form.append('file', file); form.append('workspaceId', WORKSPACE_ID); form.append('folder', folder);
  const response = await fetch('/api/upload/file', { method: 'POST', body: form });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.url) throw new Error(result.error || 'Upload failed');
  return { url: String(result.url), key: String(result.key || ''), contentType: String(result.contentType || file.type) };
}
export const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
