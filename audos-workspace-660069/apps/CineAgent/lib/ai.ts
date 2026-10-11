// CineAgent — the only model transport.
//
// POST /proxy/anthropic/v1/messages with the workspace token. Opus 5 is the
// creative director; Sonnet 5 handles mechanical repair turns. The proxy caps
// output at 8,192 tokens and rejects anonymous calls before Anthropic is
// contacted, so a missing token surfaces as a session problem, not a model one.

export const OPUS = 'claude-opus-5';
export const SONNET = 'claude-sonnet-5';
export const MAX_TOKENS = 8192;

export type ContentBlock = Record<string, unknown>;
export type AiContent = string | ContentBlock[];

export interface AiOptions {
  system?: string;
  model?: string;
  maxTokens?: number;
  signal?: AbortSignal;
}

interface AnthropicReply {
  content?: { type?: string; text?: string }[];
  error?: { message?: string };
  message?: string;
}

export function workspaceToken(): string {
  const bridge = (window as unknown as { __workspaceDb?: { token?: string } }).__workspaceDb;
  return String(bridge?.token || '');
}

export function aiHeaders(): Record<string, string> {
  const token = workspaceToken();
  if (!token) throw new Error('Workspace session is not ready — reload the page and try again.');
  return { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token };
}

// Opus 5 cannot disable thinking; the accepted request shape differs between
// deployments, so the first call walks a small ladder and remembers the answer.
type ThinkingShape = 'adaptive' | 'budget' | 'none';
let acceptedShape: ThinkingShape | null = null;

function thinkingFields(model: string, shape: ThinkingShape): Record<string, unknown> {
  if (model === SONNET) return { thinking: { type: 'disabled' } };
  if (shape === 'adaptive') return { thinking: { type: 'adaptive' }, output_config: { effort: 'medium' } };
  if (shape === 'budget') return { thinking: { type: 'enabled', budget_tokens: 3000 } };
  return {};
}

async function post(content: AiContent, options: AiOptions, shape: ThinkingShape) {
  const model = options.model || OPUS;
  const body: Record<string, unknown> = {
    model,
    max_tokens: Math.min(MAX_TOKENS, options.maxTokens || MAX_TOKENS),
    messages: [{ role: 'user', content }],
    ...thinkingFields(model, shape),
  };
  if (options.system) body.system = options.system;
  const response = await fetch('/proxy/anthropic/v1/messages', {
    method: 'POST',
    headers: aiHeaders(),
    body: JSON.stringify(body),
    signal: options.signal,
  });
  const data = (await response.json().catch(() => null)) as AnthropicReply | null;
  if (!response.ok) {
    const detail = data?.error?.message || data?.message || ('Claude answered HTTP ' + response.status);
    return { ok: false, status: response.status, text: '', error: String(detail) };
  }
  const text = (data?.content || [])
    .filter((b) => b && b.type === 'text')
    .map((b) => String(b.text || ''))
    .join('')
    .trim();
  return { ok: true, status: response.status, text, error: '' };
}

export async function callModel(content: AiContent, options: AiOptions = {}): Promise<string> {
  const model = options.model || OPUS;
  const ladder: ThinkingShape[] = model === SONNET
    ? ['none']
    : (acceptedShape ? [acceptedShape] : ['adaptive', 'budget', 'none']);
  let lastError = '';
  for (const shape of ladder) {
    const attempt = await post(content, options, shape);
    if (attempt.ok) {
      if (model !== SONNET) acceptedShape = shape;
      if (!attempt.text) throw new Error('The model returned an empty answer.');
      return attempt.text;
    }
    lastError = attempt.error;
    const reason = attempt.error.toLowerCase();
    const shapeProblem = attempt.status === 400 && (
      reason.indexOf('thinking') >= 0 || reason.indexOf('output_config') >= 0
      || reason.indexOf('unsupported_field') >= 0 || reason.indexOf('effort') >= 0);
    if (!shapeProblem) break;
  }
  throw new Error(lastError || 'The model could not be reached.');
}

// --- JSON helpers ------------------------------------------------------------

export function extractJsonText(raw: string): string {
  let text = String(raw || '').trim();
  const fence = text.indexOf('```');
  if (fence >= 0) {
    const afterOpen = text.slice(fence + 3).replace(/^json/i, '');
    const close = afterOpen.indexOf('```');
    text = (close >= 0 ? afterOpen.slice(0, close) : afterOpen).trim();
  }
  const firstBrace = text.indexOf('{');
  const firstBracket = text.indexOf('[');
  const start = firstBracket >= 0 && (firstBrace < 0 || firstBracket < firstBrace) ? firstBracket : firstBrace;
  if (start < 0) return '';
  const closer = text.charAt(start) === '[' ? ']' : '}';
  const end = text.lastIndexOf(closer);
  if (end <= start) return '';
  return text.slice(start, end + 1);
}

export function parseJson<T>(raw: string): T {
  const candidate = extractJsonText(raw);
  if (!candidate) throw new Error('The model did not answer with JSON.');
  return JSON.parse(candidate) as T;
}

/** A model turn that must answer with JSON; retries are repair turns. */
export async function callModelForJson<T>(
  content: AiContent,
  options: AiOptions & { attempts?: number } = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts || 2);
  let answer = '';
  let lastError: unknown = null;
  for (let i = 0; i < attempts; i += 1) {
    const turn: AiContent = i === 0 ? content : [{
      type: 'text',
      text: 'Your previous answer could not be parsed as JSON. The parser said: '
        + String(lastError instanceof Error ? lastError.message : lastError)
        + '\n\nHere is what you sent:\n' + answer.slice(0, 6000)
        + '\n\nSend the SAME content again as ONE valid JSON value and nothing else — '
        + 'no prose, no code fence. If it was cut off, send it complete and more compact this time.',
    }];
    answer = await callModel(turn, options);
    try {
      return parseJson<T>(answer);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error('The model could not produce valid JSON after ' + attempts + ' attempts: '
    + String(lastError instanceof Error ? lastError.message : lastError));
}

export function imageBlock(source: string): ContentBlock {
  const raw = String(source || '');
  if (raw.indexOf('data:') === 0) {
    const comma = raw.indexOf(',');
    const header = raw.slice(0, comma);
    const mediaType = header.indexOf('image/png') >= 0 ? 'image/png' : 'image/jpeg';
    return { type: 'image', source: { type: 'base64', media_type: mediaType, data: raw.slice(comma + 1) } };
  }
  return { type: 'image', source: { type: 'url', url: raw } };
}

export function textBlock(text: string): ContentBlock {
  return { type: 'text', text: String(text || '') };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
