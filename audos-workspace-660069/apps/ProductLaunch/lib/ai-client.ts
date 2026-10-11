// ai-client — every model call the pipeline makes goes through here.
//
// ONE transport: POST /proxy/anthropic/v1/messages with the workspace token in
// X-Workspace-DB-Token. The proxy rejects an anonymous call with 401 before
// Anthropic is contacted, so a missing token is reported as a session problem
// rather than as a model failure. There are no raw provider keys in the
// browser and no second provider to fail over to.
//
// TWO models, chosen per step rather than per call site:
//   claude-opus-5    extraction, concepts, component plan, critique
//   claude-sonnet-5  the compile-fix loop, which is mechanical and runs hot

export const OPUS_MODEL = 'claude-opus-5';
export const SONNET_MODEL = 'claude-sonnet-5';

/** The proxy caps output at 8,192 tokens whatever we ask for. */
export const MAX_OUTPUT_TOKENS = 8192;

export type AiModel = typeof OPUS_MODEL | typeof SONNET_MODEL;

export type ContentBlock = Record<string, unknown>;
export type AiContent = string | ContentBlock[];

export interface AiOptions {
  system?: string;
  model?: AiModel;
  maxTokens?: number;
  thinkingBudget?: number;
  signal?: AbortSignal;
}

interface AnthropicBlock { type?: string; text?: string }
interface AnthropicReply {
  content?: AnthropicBlock[];
  error?: { message?: string };
  code?: string;
  message?: string;
}

interface WorkspaceBridge { token?: string }

export function workspaceToken(): string {
  const bridge = (window as unknown as { __workspaceDb?: WorkspaceBridge }).__workspaceDb;
  return String(bridge?.token || '');
}

function headers(): Record<string, string> {
  const token = workspaceToken();
  if (!token) {
    throw new Error('The workspace session is not ready yet — reload the page and try again.');
  }
  return { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token };
}

/**
 * The thinking shape Opus 5 wants differs between the platform catalog
 * (adaptive thinking plus an effort hint) and the raw Anthropic contract (an
 * explicit token budget). Rather than pick one and lose a whole pipeline run
 * to a 400, the first call walks the ladder and the deployment's answer is
 * remembered for every call after it.
 */
type ThinkingShape = 'adaptive' | 'budget' | 'none';
let acceptedShape: ThinkingShape | null = null;

function thinkingFields(shape: ThinkingShape, budget: number): Record<string, unknown> {
  if (shape === 'adaptive') return { thinking: { type: 'adaptive' }, output_config: { effort: 'medium' } };
  if (shape === 'budget') return { thinking: { type: 'enabled', budget_tokens: budget } };
  return {};
}

async function post(
  content: AiContent,
  options: AiOptions,
  shape: ThinkingShape,
): Promise<{ ok: boolean; status: number; text: string; error: string }> {
  const body: Record<string, unknown> = {
    model: options.model || OPUS_MODEL,
    max_tokens: Math.min(MAX_OUTPUT_TOKENS, options.maxTokens || MAX_OUTPUT_TOKENS),
    messages: [{ role: 'user', content }],
    ...thinkingFields(shape, options.thinkingBudget || 2000),
  };
  if (options.system) body.system = options.system;

  const response = await fetch('/proxy/anthropic/v1/messages', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
    signal: options.signal,
  });
  const data = (await response.json().catch(() => null)) as AnthropicReply | null;
  if (!response.ok) {
    const detail = data?.error?.message || data?.message || ('Claude answered HTTP ' + response.status);
    return { ok: false, status: response.status, text: '', error: String(detail) };
  }
  const text = (data?.content || [])
    .filter((block) => block && block.type === 'text')
    .map((block) => String(block.text || ''))
    .join('')
    .trim();
  return { ok: true, status: response.status, text, error: '' };
}

/** One model turn. Throws with the proxy's own words when it cannot run. */
export async function callModel(content: AiContent, options: AiOptions = {}): Promise<string> {
  const ladder: ThinkingShape[] = acceptedShape ? [acceptedShape] : ['adaptive', 'budget', 'none'];
  let lastError = '';
  for (const shape of ladder) {
    const attempt = await post(content, options, shape);
    if (attempt.ok) {
      acceptedShape = shape;
      if (!attempt.text) throw new Error('The model returned an empty answer.');
      return attempt.text;
    }
    lastError = attempt.error;
    // Only a request-shape rejection is worth another rung: a 401, 402, 429 or
    // provider outage means the same thing on every shape.
    const reason = attempt.error.toLowerCase();
    const shapeProblem = attempt.status === 400
      && (reason.indexOf('thinking') >= 0
        || reason.indexOf('output_config') >= 0
        || reason.indexOf('unsupported_field') >= 0
        || reason.indexOf('effort') >= 0);
    if (!shapeProblem) break;
  }
  throw new Error(lastError || 'The model could not be reached.');
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

/** Strips a code fence and returns the span between the outermost brackets. */
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
  const start = firstBracket >= 0 && (firstBrace < 0 || firstBracket < firstBrace)
    ? firstBracket
    : firstBrace;
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

/**
 * A model turn that must answer with JSON.
 *
 * A parse failure is almost always truncation or a stray sentence before the
 * object, and both are fixed by showing the model its own broken output rather
 * than by asking the same question again — so the retry is a repair turn, not
 * a repeat.
 */
export async function callModelForJson<T>(
  content: AiContent,
  options: AiOptions & { attempts?: number } = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts || 2);
  let answer = '';
  let lastError: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const turn: AiContent = attempt === 0 ? content : [
      {
        type: 'text',
        text: 'Your previous answer could not be parsed as JSON. The parser said: '
          + String(lastError instanceof Error ? lastError.message : lastError)
          + '\n\nHere is what you sent:\n' + answer.slice(0, 6000)
          + '\n\nSend the SAME content again as one valid JSON value and nothing else '
          + '— no prose before it, no code fence, no trailing commentary. If it was cut off, '
          + 'send it complete this time.',
      },
    ];
    answer = await callModel(turn, options);
    try {
      return parseJson<T>(answer);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    'The model could not produce valid JSON after ' + String(attempts) + ' attempts: '
    + String(lastError instanceof Error ? lastError.message : lastError),
  );
}

/** A base64 data URL as an Anthropic image block, or a plain URL block. */
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
