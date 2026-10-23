export const AGENT_CONTEXT_CHAR_BUDGET = 120_000;
export const AGENT_CONTEXT_BYTE_BUDGET = 220 * 1024;
export const TOOL_RESULT_CHAR_BUDGET = 12_000;

export interface AgentMessageLike { role: string; content: unknown }
export interface PreparedContext<T> {
  body: T;
  system: string;
  messages: AgentMessageLike[];
  compacted: boolean;
  notice?: string;
  runningSummary?: string;
  chars: number;
  bytes: number;
}

const DATA_URL = /data:[^;,\s]+(?:;[^,\s]+)*;base64,[A-Za-z0-9+/=_-]{64,}/gi;
const BASE64_BLOB = /(?:^|["'\s:])([A-Za-z0-9+/=_-]{1200,})(?=$|["'\s,}])/g;
const PRIORITY_KEYS = new Set([
  'id', 'job_id', 'operation_id', 'provider_operation_id', 'scene_id', 'scene_number',
  'status', 'provider_status', 'code', 'error', 'errorMessage', 'stored_error', 'message',
  'model', 'requested_model', 'actual_model', 'duration_s', 'requested_duration_s',
  'validation', 'prompt', 'references', 'references_sent', 'url', 'created_at', 'updated_at',
]);

export function stripBinaryText(value: string): string {
  return String(value || '')
    .replace(DATA_URL, '[binary data URL omitted; durable URL required]')
    .replace(BASE64_BLOB, (match, blob) => match.replace(blob, `[base64 payload omitted: ${blob.length} chars]`));
}

function clip(value: string, max: number): string {
  const clean = stripBinaryText(value);
  if (clean.length <= max) return clean;
  const half = Math.max(64, Math.floor((max - 90) / 2));
  return `${clean.slice(0, half)}\n… [${clean.length - half * 2} chars compacted] …\n${clean.slice(-half)}`;
}

export function compactValue(value: unknown, maxChars = TOOL_RESULT_CHAR_BUDGET, depth = 0): unknown {
  if (typeof value === 'string') return clip(value, maxChars);
  if (value == null || typeof value !== 'object') return value;
  if (depth >= 4) return `[nested ${Array.isArray(value) ? 'array' : 'object'} omitted]`;
  if (Array.isArray(value)) {
    const kept = value.slice(0, 16).map((item) => compactValue(item, Math.max(300, Math.floor(maxChars / 16)), depth + 1));
    if (value.length > kept.length) kept.push(`[${value.length - kept.length} more items omitted]`);
    return kept;
  }
  const input = value as Record<string, unknown>;
  const ordered = Object.keys(input).sort((a, b) => Number(PRIORITY_KEYS.has(b)) - Number(PRIORITY_KEYS.has(a)));
  const output: Record<string, unknown> = {};
  for (const key of ordered.slice(0, 32)) {
    output[key] = compactValue(input[key], Math.max(300, Math.floor(maxChars / Math.max(1, Math.min(ordered.length, 12)))), depth + 1);
  }
  if (ordered.length > 32) output._omitted_keys = ordered.length - 32;
  return output;
}

export function compactToolResult(value: unknown, maxChars = TOOL_RESULT_CHAR_BUDGET): string {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    const clean = stripBinaryText(value);
    try { parsed = JSON.parse(clean); } catch { return clip(clean, maxChars); }
  }
  return clip(JSON.stringify(compactValue(parsed, maxChars)), maxChars);
}

function sanitizeContent(content: unknown, toolBudget: number): unknown {
  if (typeof content === 'string') return stripBinaryText(content);
  if (!Array.isArray(content)) return compactValue(content, toolBudget);
  return content.map((block: any) => {
    if (!block || typeof block !== 'object') return block;
    if (block.type === 'image') {
      const url = String(block.source?.url || '');
      if (!/^https:\/\//.test(url)) return { type: 'text', text: '[inline image omitted; use a durable HTTPS URL]' };
      return { type: 'image', source: { type: 'url', url } };
    }
    if (block.type === 'tool_result') return { ...block, content: compactToolResult(block.content, toolBudget) };
    if (block.type === 'text') return { ...block, text: stripBinaryText(String(block.text || '')) };
    return compactValue(block, toolBudget);
  });
}

function messageText(message: AgentMessageLike): string {
  const content = message.content;
  if (typeof content === 'string') return content;
  return JSON.stringify(content);
}

export function summarizeOlderTurns(messages: AgentMessageLike[], prior = ''): string {
  const lines = messages.map((message) => `${message.role}: ${clip(messageText(message).replace(/\s+/g, ' '), 420)}`);
  return clip([prior, ...lines].filter(Boolean).join('\n'), 10_000);
}

function inputChars(system: string, messages: AgentMessageLike[]): number {
  return system.length + messages.reduce((sum, message) => sum + messageText(message).length, 0);
}

function measure<T>(system: string, messages: AgentMessageLike[], body: T) {
  return {
    chars: inputChars(system, messages),
    bytes: new TextEncoder().encode(JSON.stringify(body)).byteLength,
  };
}

export function isProxyLengthError(value: unknown): boolean {
  return /input exceeds|input_too_large|body_too_large|200000-character|request body.*large/i.test(String((value as any)?.message || value || ''));
}

export async function requestWithContextRetry<TBody, TResult>(options: {
  prepare: (aggressive: boolean) => PreparedContext<TBody>;
  send: (body: TBody) => Promise<TResult>;
}): Promise<{ result: TResult; prepared: PreparedContext<TBody>; retried: boolean }> {
  let prepared = options.prepare(false);
  try {
    return { result: await options.send(prepared.body), prepared, retried: false };
  } catch (error) {
    if (!isProxyLengthError(error)) throw error;
    prepared = options.prepare(true);
    return { result: await options.send(prepared.body), prepared, retried: true };
  }
}

export function prepareContextBody<T>(options: {
  system: string;
  messages: AgentMessageLike[];
  buildBody: (system: string, messages: AgentMessageLike[]) => T;
  priorSummary?: string;
  latestTurns?: number;
  aggressive?: boolean;
  charBudget?: number;
  byteBudget?: number;
}): PreparedContext<T> {
  const charBudget = options.charBudget || AGENT_CONTEXT_CHAR_BUDGET;
  const byteBudget = options.byteBudget || AGENT_CONTEXT_BYTE_BUDGET;
  const latestTurns = options.aggressive ? 2 : Math.max(2, options.latestTurns || 10);
  const toolBudget = options.aggressive ? 3_500 : TOOL_RESULT_CHAR_BUDGET;
  const sanitized = options.messages.map((message) => ({ ...message, content: sanitizeContent(message.content, toolBudget) }));
  const latest = sanitized.slice(-latestTurns);
  const older = sanitized.slice(0, Math.max(0, sanitized.length - latest.length));
  let runningSummary = older.length ? summarizeOlderTurns(older, options.priorSummary) : options.priorSummary;
  let system = stripBinaryText(options.system);
  let compacted = older.length > 0 || sanitized.some((message, index) => JSON.stringify(message.content) !== JSON.stringify(options.messages[index]?.content));
  if (runningSummary) system += `\n\nROLLING CONVERSATION SUMMARY (older turns; latest turns follow verbatim):\n${runningSummary}`;
  let messages = latest;
  let body = options.buildBody(system, messages);
  let measured = measure(system, messages, body);

  while ((measured.chars > charBudget || measured.bytes > byteBudget) && messages.length > 1) {
    const removed = messages.shift()!;
    runningSummary = summarizeOlderTurns([removed], runningSummary);
    system = stripBinaryText(options.system) + `\n\nROLLING CONVERSATION SUMMARY (older turns; latest turn preserved):\n${runningSummary}`;
    compacted = true;
    body = options.buildBody(system, messages);
    measured = measure(system, messages, body);
  }

  if (measured.chars > charBudget || measured.bytes > byteBudget) {
    throw new Error(`The compacted request is still too large (${measured.chars} chars / ${measured.bytes} bytes). The system prompt and latest turn were preserved.`);
  }
  return {
    body, system, messages, compacted,
    notice: compacted ? 'Context compacted: older turns and oversized tool evidence were summarized; the latest turn and system instructions were preserved.' : undefined,
    runningSummary,
    ...measured,
  };
}
