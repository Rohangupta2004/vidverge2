/**
 * The app's AI model policy, in one place.
 *
 * Every AI text call made from app code goes to Claude through the platform's
 * Anthropic proxy. No call site names a model: it declares WHAT KIND of work it
 * is and `selectModel` picks the tier, so the fast/cheap work runs on Sonnet
 * and the reasoning work on Opus without a hardcoded string drifting out of
 * sync somewhere in the tree.
 *
 * The same mapping is implemented server-side in the `s2v-run`, `sceneforge-run`
 * and `trackb-orchestrator` server functions, so a task type means the same
 * thing wherever it is declared.
 */

export const CLAUDE_SONNET = 'claude-sonnet-5' as const;
export const CLAUDE_OPUS = 'claude-opus-5' as const;

export type ClaudeModel = typeof CLAUDE_SONNET | typeof CLAUDE_OPUS;

/** Work that needs the frontier model: reasoning, planning, long writing, judging. */
export type OpusTask = 'planning' | 'script' | 'quality_check' | 'multi_step';
/** Work the balanced model does just as well, for a fraction of the cost and latency. */
export type SonnetTask = 'prompt_writing' | 'classify' | 'summarise' | 'short_gen';
export type TaskType = OpusTask | SonnetTask;

const OPUS_TASKS: OpusTask[] = ['planning', 'script', 'quality_check', 'multi_step'];
const SONNET_TASKS: SonnetTask[] = ['prompt_writing', 'classify', 'summarise', 'short_gen'];

/**
 * The model for a kind of work.
 *
 * An unrecognised task type takes the cheaper tier deliberately: a wrong guess
 * then costs quality on one call instead of the frontier price on every call.
 */
export function selectModel(taskType: string): ClaudeModel {
  const task = String(taskType || '').toLowerCase();
  if ((OPUS_TASKS as string[]).includes(task)) return CLAUDE_OPUS;
  if ((SONNET_TASKS as string[]).includes(task)) return CLAUDE_SONNET;
  return CLAUDE_SONNET;
}

/** The workspace token every proxy call must carry — the proxy rejects anonymous calls. */
export function workspaceToken(): string {
  if (typeof window === 'undefined') return '';
  return String((window as any).__workspaceDb?.token || '');
}

export interface ClaudeTextRequest {
  /** What kind of work this is. Drives the model — see selectModel. */
  task: TaskType;
  system?: string;
  user: string;
  maxTokens?: number;
  /**
   * Pin a tier instead of deriving it. Use only where a model choice is a
   * product decision (a user-facing quality toggle), not a default.
   */
  model?: ClaudeModel;
}

/**
 * One Claude call through the Anthropic proxy.
 *
 * Thinking is explicitly disabled so the whole output budget goes to the answer
 * rather than to reasoning tokens — a long structured reply otherwise truncates
 * mid-JSON. The proxy caps output at 8,192 tokens.
 */
export async function claudeText({ task, system, user, maxTokens = 2048, model }: ClaudeTextRequest): Promise<string> {
  const token = workspaceToken();
  if (!token) throw new Error('Your workspace session is still loading — try again in a moment.');
  const res = await fetch('/proxy/anthropic/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
    body: JSON.stringify({
      model: model || selectModel(task),
      max_tokens: Math.min(8192, Math.max(256, maxTokens)),
      ...(system ? { system } : {}),
      thinking: { type: 'disabled' },
      messages: [{ role: 'user', content: user }],
    }),
  });
  const data: any = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(String(data?.error?.message || data?.error || 'The AI writer could not be reached (HTTP ' + res.status + ').'));
  }
  const text = Array.isArray(data?.content)
    ? data.content.map((b: any) => (b && typeof b.text === 'string' ? b.text : '')).join('')
    : '';
  if (!text.trim()) throw new Error('The AI writer returned an empty reply — try again.');
  return text;
}
