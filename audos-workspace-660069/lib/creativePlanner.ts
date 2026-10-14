/**
 * CREATIVE PLANNER — one provider-neutral reasoning client for every browser
 * planning surface. A person is waiting for these calls, so the platform's
 * interactive tier is fixed here: gpt-6.1-sol, medium reasoning, 6,000 output
 * tokens. Reasoning tokens are spent before visible output; never lower this
 * cap for a JSON plan or an apparently successful response can contain no
 * parseable text.
 */

export const CREATIVE_PLANNER_MODEL = 'gpt-6.1-sol';
export const CREATIVE_PLANNER_REASONING = 'medium' as const;
export const CREATIVE_PLANNER_MAX_TOKENS = 6000;

export interface CreativePlannerCall {
  system: string;
  user: string;
  /** Public HTTPS images supplied as OpenAI image_url content parts. */
  images?: string[];
}

export interface CreativePlannerReply {
  text: string;
  /** True means the answer is incomplete and MUST NOT be parsed as JSON. */
  truncated: boolean;
  finishReason: string;
}

function workspaceToken(): string {
  if (typeof window === 'undefined') return '';
  return String((window as any).__workspaceDb?.token || '');
}

/** One non-streaming interactive planning call. */
export async function askCreativePlanner(call: CreativePlannerCall): Promise<CreativePlannerReply> {
  const token = workspaceToken();
  if (!token) throw new Error('Your workspace session is still loading — try again in a moment.');

  const images = (call.images || [])
    .filter((url) => typeof url === 'string' && url.startsWith('https://'))
    .slice(0, 10);
  const userContent: any = images.length
    ? [
        { type: 'text', text: call.user },
        ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
      ]
    : call.user;

  const res = await fetch('/proxy/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Workspace-DB-Token': token,
    },
    body: JSON.stringify({
      model: CREATIVE_PLANNER_MODEL,
      reasoning_effort: CREATIVE_PLANNER_REASONING,
      max_completion_tokens: CREATIVE_PLANNER_MAX_TOKENS,
      stream: false,
      messages: [
        { role: 'system', content: call.system },
        { role: 'user', content: userContent },
      ],
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.error) {
    const detail = String(data?.error?.message || data?.error || `The creative planner did not answer (HTTP ${res.status}).`);
    const code = data?.code ? ` [${data.code}]` : '';
    throw new Error(`${detail}${code}`);
  }

  const choice = data?.choices?.[0];
  const finishReason = String(choice?.finish_reason || '');
  const truncated = data?.truncated === true
    || choice?.truncated === true
    || choice?.message?.truncated === true
    || finishReason === 'length';
  const text = String(choice?.message?.content || '');

  // Check truncation BEFORE a caller gets a chance to repair/parse the JSON.
  // A repaired partial object is still an incomplete creative decision.
  if (truncated) {
    throw new Error('The creative planner ran out of output tokens before completing its plan. Shorten the input or split the planning pass, then try again.');
  }
  if (!text.trim()) {
    throw new Error('The creative planner returned no visible answer. Try again; reasoning may have consumed the response budget.');
  }
  return { text, truncated: false, finishReason };
}
