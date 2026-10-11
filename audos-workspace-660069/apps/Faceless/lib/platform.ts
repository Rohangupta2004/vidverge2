/**
 * FACELESS — platform access layer.
 *
 * Every outbound call the pipeline makes goes through this file. It is new
 * code: the Faceless build deliberately does not import Track B's, Product
 * Launch's or SceneForge's clients, because sharing those would re-import
 * their pipeline assumptions along with their transport.
 *
 * Two routes exist and they are not interchangeable:
 *   - Direct platform endpoints for things the browser is allowed to call
 *     (ElevenLabs, Deepgram, the Anthropic proxy, the render service).
 *   - The `faceless-assets` / `faceless-render` server functions for things
 *     the browser must NOT call directly — the image proxy has a header quirk
 *     that corrupts its own bookkeeping when called with a space app id, and
 *     provider polling belongs server-side.
 *   - `faceless-portrait-export` for the best-effort 1080×1920 export pass after
 *     a portrait review render completes.
 */

import { FacelessError, type PipelineStageId } from '../types/editorial';

export const SPACE_ID = 'workspace-660069';
export const WORKSPACE_UUID = 'f24710e5-7c6d-4db4-92b4-c2c235877575';

const HOOK_BASE = `/api/hooks/execute/${SPACE_ID}`;

export function appId(): string {
  if (typeof window === 'undefined') return SPACE_ID;
  const w = window as any;
  return String(w.__APP_ID__ || w.__SPACE_ID__ || SPACE_ID);
}

/**
 * The workspace token. Read at call time — it is rotated, and a copy taken at
 * module load goes stale on a long run.
 */
export function workspaceToken(): string {
  if (typeof window === 'undefined') return '';
  return String((window as any).__workspaceDb?.token || '');
}

export function requireToken(stage: PipelineStageId): string {
  const token = workspaceToken();
  if (!token) {
    throw new FacelessError(
      'The workspace token is not available in this tab, so no paid platform call can be made. Reload the space and try again.',
      stage,
      'no_credentials',
    );
  }
  return token;
}

export function authHeaders(stage: PipelineStageId): Record<string, string> {
  return { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': requireToken(stage) };
}

export function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

function clip(value: unknown, max = 240): string {
  const text = value == null ? '' : String(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Pull the most useful message out of whatever shape an endpoint failed with. */
export function errorText(status: number, data: any, fallback: string): string {
  const raw =
    (data && (data.error?.message || data.error || data.errorMessage || data.message)) ||
    `${fallback} (HTTP ${status})`;
  const code = data && data.code ? ` [${data.code}]` : '';
  return `${clip(raw)}${code}`;
}

export async function readJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Server functions
// ---------------------------------------------------------------------------

/**
 * Call one of the Faceless server functions. They are the trusted half of the
 * pipeline: provider keys, the image-proxy header quirk and long polls live
 * there so the browser never has to know about any of it.
 */
export async function callHook<T = any>(
  name: 'faceless-assets' | 'faceless-render' | 'faceless-portrait-export',
  body: Record<string, unknown>,
  stage: PipelineStageId,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${HOOK_BASE}/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-App-Id': appId(),
        'X-Workspace-DB-Token': workspaceToken(),
      },
      body: JSON.stringify(body),
    });
  } catch (error: any) {
    throw new FacelessError(
      `${name} could not be reached: ${clip(error?.message || error, 160)}`,
      stage,
      'network',
    );
  }
  const data = await readJson(res);
  if (!res.ok || !data || data.error) {
    throw new FacelessError(errorText(res.status, data, `${name} failed`), stage, 'hook_failed');
  }
  return data as T;
}

// ---------------------------------------------------------------------------
// Claude (Opus 5) — the editorial brain
// ---------------------------------------------------------------------------

export type ClaudeModel = 'claude-opus-5' | 'claude-sonnet-5';

export interface ClaudeImageBlock {
  type: 'image';
  source: { type: 'url'; url: string };
}

export interface ClaudeTextBlock {
  type: 'text';
  text: string;
}

export type ClaudeContent = string | (ClaudeTextBlock | ClaudeImageBlock)[];

export interface ClaudeCallOptions {
  system: string;
  messages: { role: 'user' | 'assistant'; content: ClaudeContent }[];
  /** The proxy caps this at 8192 and rejects anything larger outright. */
  maxTokens?: number;
  model?: ClaudeModel;
  stage: PipelineStageId;
}

const CLAUDE_MAX_TOKENS = 8192;

/**
 * Opus 5 cannot disable thinking, so adaptive + medium effort is the only
 * legal configuration; Sonnet must disable it or it stalls before the first
 * token. Sampling parameters are never sent — Claude 5 rejects them with a 400.
 */
function thinkingFor(model: ClaudeModel): Record<string, unknown> {
  if (model === 'claude-opus-5') {
    return { thinking: { type: 'adaptive' }, output_config: { effort: 'medium' } };
  }
  return { thinking: { type: 'disabled' } };
}

export async function callClaude(options: ClaudeCallOptions): Promise<string> {
  const model: ClaudeModel = options.model || 'claude-opus-5';
  const maxTokens = Math.min(CLAUDE_MAX_TOKENS, Math.max(256, options.maxTokens || CLAUDE_MAX_TOKENS));

  let res: Response;
  try {
    res = await fetch('/proxy/anthropic/v1/messages', {
      method: 'POST',
      headers: authHeaders(options.stage),
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        ...thinkingFor(model),
        system: options.system,
        messages: options.messages,
      }),
    });
  } catch (error: any) {
    throw new FacelessError(
      `The Claude proxy could not be reached: ${clip(error?.message || error, 160)}`,
      options.stage,
      'network',
    );
  }

  const data = await readJson(res);
  if (!res.ok || !data || data.error) {
    throw new FacelessError(errorText(res.status, data, 'Claude request failed'), options.stage, 'claude_failed');
  }
  const text = (Array.isArray(data.content) ? data.content : [])
    .filter((block: any) => block && block.type === 'text')
    .map((block: any) => String(block.text || ''))
    .join('');
  if (!text.trim()) {
    throw new FacelessError('Claude returned an empty response.', options.stage, 'claude_empty');
  }
  return text;
}

// ---------------------------------------------------------------------------
// GPT, fast tier — the interactive calls that are not the edit
// ---------------------------------------------------------------------------

/**
 * Suggestions and prompt distillation only. The editorial decisions stay on
 * Opus 5; this tier exists because a control that keeps up with typing cannot
 * wait on a frontier model.
 */
export const FAST_TEXT_MODEL = 'gpt-5.6-luna';

export interface FastTextOptions {
  user: string;
  system?: string;
  maxTokens?: number;
  signal?: AbortSignal;
}

/**
 * Reasoning is switched off explicitly rather than left to default: GPT-5.6
 * defaults to medium effort, which is seconds of latency on a call whose whole
 * point is to be instant.
 *
 * This throws like everything else in this file, but every caller treats a
 * failure as "no suggestion" rather than as an error worth showing — none of
 * the features built on it are load-bearing.
 */
export async function callFastText(options: FastTextOptions): Promise<string> {
  const token = workspaceToken();
  if (!token) throw new Error('The workspace token is not available in this tab.');

  const messages: { role: 'system' | 'user'; content: string }[] = [];
  if (options.system) messages.push({ role: 'system', content: options.system });
  messages.push({ role: 'user', content: options.user });

  const response = await fetch('/proxy/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
    signal: options.signal,
    body: JSON.stringify({
      model: FAST_TEXT_MODEL,
      reasoning_effort: 'none',
      max_completion_tokens: Math.max(32, Math.min(2000, options.maxTokens || 200)),
      stream: false,
      messages,
    }),
  });

  const data = await readJson(response);
  if (!response.ok || !data || data.error) {
    throw new Error(errorText(response.status, data, 'The text proxy refused the request'));
  }
  return String(data.choices?.[0]?.message?.content || '');
}

/**
 * Models are told to return only JSON, and mostly do. When one wraps the object
 * in a fence or a sentence, recovering the outermost balanced braces is far
 * better than failing a paid run over punctuation.
 */
export function extractJson<T = any>(raw: string, stage: PipelineStageId): T {
  const text = String(raw || '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();

  const direct = tryParse<T>(candidate);
  if (direct !== undefined) return direct;

  const start = candidate.search(/[[{]/);
  if (start >= 0) {
    const opener = candidate[start];
    const closer = opener === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < candidate.length; i += 1) {
      const char = candidate[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === opener) depth += 1;
      else if (char === closer) {
        depth -= 1;
        if (depth === 0) {
          const sliced = tryParse<T>(candidate.slice(start, i + 1));
          if (sliced !== undefined) return sliced;
          break;
        }
      }
    }
  }

  throw new FacelessError(
    `The model returned something that is not JSON: ${clip(candidate, 180)}`,
    stage,
    'bad_json',
  );
}

function tryParse<T>(value: string): T | undefined {
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Durable storage for browser-produced bytes (QA frames)
// ---------------------------------------------------------------------------

/** Re-host a canvas data URL so Opus Vision can read it from a stable address. */
export async function uploadDataUrl(dataUrl: string, fileName: string, stage: PipelineStageId): Promise<string> {
  const res = await fetch('/api/upload/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-App-Id': appId() },
    body: JSON.stringify({ imageData: dataUrl, fileName }),
  });
  const data = await readJson(res);
  const url = data && (data.imageUrl || data.url);
  if (!res.ok || !isHttpUrl(url)) {
    throw new FacelessError(errorText(res.status, data, 'The frame could not be stored'), stage, 'upload_failed');
  }
  return String(url);
}
