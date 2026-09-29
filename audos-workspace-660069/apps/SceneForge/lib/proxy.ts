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

// No Claude call may hang the pipeline forever: every request is aborted
// after `timeoutMs` and surfaces as a retryable ClaudeRequestError, so a
// dropped proxy connection becomes an error the caller can recover from
// instead of a promise that never settles (the "spinner forever" failure).
export const CLAUDE_TIMEOUT_MS = 180_000;

// Every claudeMessages caller parses the reply as JSON, so the format demand
// is enforced ONCE here rather than trusted to each task prompt — preamble
// ("Here is the plan:") and markdown fences were breaking JSON.parse.
const STRICT_JSON_SUFFIX = ' OUTPUT FORMAT (hard): reply with PURE JSON only — the very first character of your reply is { or [. No preamble, no commentary, no markdown code fences.';

async function claudeMessages<T>(system: string, content: unknown, model: string, maxTokens: number, timeoutMs: number): Promise<T> {
  const frontier = model.includes('opus');
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  let response: Response;
  try {
    response = await fetch('/proxy/anthropic/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': workspaceToken() },
      body: JSON.stringify({ model, max_tokens: Math.min(8192, maxTokens), ...(frontier ? { thinking: { type: 'adaptive' }, output_config: { effort: 'medium' } } : { thinking: { type: 'disabled' } }), system: system + STRICT_JSON_SUFFIX, messages: [{ role: 'user', content }] }),
      signal: controller.signal,
    });
  } catch (e: any) {
    if (controller.signal.aborted) throw new ClaudeRequestError(`The agent did not answer within ${Math.round(timeoutMs / 1000)} seconds. Try again.`, { code: 'timeout' });
    throw e;
  } finally { window.clearTimeout(timer); }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    // The proxy names the reason in `code` (body_too_large, input_too_large,
    // output_tokens_too_large, rate_limited…). Without it a rejection reads as
    // a bare status and the next person has to guess what the request did.
    const detail = payload?.error?.message || (typeof payload?.error === 'string' ? payload.error : '') || payload?.message || `Claude request failed (${response.status})`;
    // PROVIDER-ACCOUNT FAILURES (exhausted credit, invalidated key) come back
    // verbatim from the provider and read like something the user must fix
    // ("go to Plans & Billing"). They are the PLATFORM's shared provider
    // account — not this workspace, the wallet, or any limit in this app —
    // so say that instead of relaying the misleading billing instruction.
    if (/credit balance is too low|api key is invalid|api key has been invalidated|authentication_error|token_invalidated/i.test(String(detail))) {
      throw new ClaudeRequestError(`The AI provider behind Audos is temporarily unavailable (provider answered: ${String(detail).slice(0, 120)}). This is a platform-side account issue — not your workspace, your wallet, or a usage limit in this app. Try again shortly.`, { code: 'provider_account_unavailable', status: response.status });
    }
    const message = payload?.code ? `${detail} [${payload.code}]` : String(detail);
    throw new ClaudeRequestError(message, { code: payload?.code, status: response.status, retryAfterSeconds: Number(payload?.retryAfterSeconds) || undefined });
  }
  const text = (payload.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim();
  const candidate = extractJsonPayload(text);
  try {
    if (!candidate) throw new Error('the reply contains no JSON object or array');
    return JSON.parse(candidate) as T;
  } catch (parseError) {
    // The raw reply is the evidence: log it so an unparsable response is
    // diagnosable from the console instead of hiding behind a generic line.
    const cutOff = payload?.stop_reason === 'max_tokens';
    console.error('[SceneForge] The agent reply could not be parsed as JSON', { model, stopReason: payload?.stop_reason || null, parseError: String((parseError as any)?.message || parseError), replyPreview: text.slice(0, 800) });
    throw new ClaudeRequestError(cutOff
      ? 'The agent reply was cut off before the JSON completed (output limit reached). Try again.'
      : 'The agent returned an invalid JSON response. Try again.', { code: 'invalid_json' });
  }
}

/**
 * Pull the JSON out of a model reply that may carry markdown fences, a prose
 * preamble ("Here is the plan:") or trailing commentary. A COMPLETE fenced
 * block wins; stray fence markers from a truncated reply are stripped (the
 * old regex required the closing fence, so a cut-off ```json reply fell
 * through to JSON.parse on raw markdown and always failed); then the FIRST
 * balanced {...} or [...] is extracted with a string-aware scan. Returns null
 * when the reply contains no JSON at all, and returns the unbalanced tail for
 * a cut-off reply so the parse error names the real cause.
 */
export function extractJsonPayload(raw: string): string | null {
  let text = String(raw || '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1].trim()) text = fenced[1].trim();
  text = text.replace(/```(?:json)?/gi, '').trim();
  const start = text.search(/[{[]/);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (inString) {
      if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}

export async function claudeJson<T>(system: string, input: unknown, model = 'claude-opus-5', maxTokens = 8192, timeoutMs = CLAUDE_TIMEOUT_MS): Promise<T> {
  return claudeMessages<T>(system, JSON.stringify(input), model, maxTokens, timeoutMs);
}

export interface VisionImage { data: string; mediaType?: string }

/**
 * Vision call through the same proxy: base64 frames as Anthropic image blocks
 * plus one text task. Used by the visual QA pipeline (lib/visualQa) to have
 * the SAME model that directed a scene inspect its rendered frames. The proxy
 * caps request bodies at 256 KB — callers must downscale frames before
 * sending (visualQa keeps each frame small and drops frames if needed).
 */
export async function claudeVisionJson<T>(system: string, textPrompt: string, images: VisionImage[], model = 'claude-opus-5', maxTokens = 2048, timeoutMs = CLAUDE_TIMEOUT_MS): Promise<T> {
  const content = [
    ...images.map((image) => ({ type: 'image', source: { type: 'base64', media_type: image.mediaType || 'image/jpeg', data: image.data } })),
    { type: 'text', text: textPrompt },
  ];
  return claudeMessages<T>(system, content, model, maxTokens, timeoutMs);
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
