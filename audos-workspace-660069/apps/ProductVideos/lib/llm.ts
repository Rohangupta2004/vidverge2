// Product Videos — LLM access through the platform's OpenAI proxy.
//
// GPT writes everything in this app now. The Claude "fable-5" path this file
// used to carry is gone: provider-neutral app text generation is GPT-first, so
// structured planning runs on the balanced tier (gpt-5.6-terra) and the
// Remotion code-generation call runs on the frontier tier (gpt-5.6-sol), each
// falling back to the other if a tier refuses or answers empty.
//
// Auth: the proxy rejects an anonymous call with 401 no_credentials before
// OpenAI is contacted, so every request carries X-Workspace-DB-Token.

const BALANCED_MODEL = 'gpt-5.6-terra';
const FRONTIER_MODEL = 'gpt-5.6-sol';
const MAX_OUTPUT_TOKENS = 8192;

function aiHeaders(): Record<string, string> {
  const token = (window as any).__workspaceDb?.token;
  if (!token) {
    throw new Error('Your workspace session is still loading. Wait a moment, then try again.');
  }
  return { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': String(token) };
}

async function callChat(model: string, system: string, userContent: string, maxTokens: number) {
  const response = await fetch('/proxy/openai/v1/chat/completions', {
    method: 'POST',
    headers: aiHeaders(),
    body: JSON.stringify({
      model,
      // GPT-5.6 defaults to medium reasoning effort, which is far too slow
      // behind an interactive Generate button. The balanced tier says 'none'
      // explicitly; the frontier tier is allowed a little thinking for code.
      reasoning_effort: model === FRONTIER_MODEL ? 'low' : 'none',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userContent },
      ],
      max_completion_tokens: Math.min(maxTokens, MAX_OUTPUT_TOKENS),
      stream: false,
    }),
  });
  const parsed = await response.json().catch(() => null);
  return { response, parsed };
}

export async function generateWithGpt(options: {
  system: string;
  user: string;
  maxTokens?: number;
  frontier?: boolean;
}): Promise<string> {
  const maxTokens = Math.min(options.maxTokens ?? 4096, MAX_OUTPUT_TOKENS);
  const models = options.frontier ? [FRONTIER_MODEL, BALANCED_MODEL] : [BALANCED_MODEL, FRONTIER_MODEL];
  let lastError = '';

  for (const model of models) {
    const { response, parsed } = await callChat(model, options.system, options.user, maxTokens);
    if (response.ok) {
      const text = String(parsed?.choices?.[0]?.message?.content || '');
      if (text.trim()) return text;
      // A reasoning model that spends its whole budget thinking answers with
      // an empty string rather than half a document — worth one more try on
      // the other tier.
      lastError = 'the model returned an empty response';
      continue;
    }
    const code = parsed?.code ? ` [${parsed.code}]` : '';
    const message =
      parsed?.error?.message || parsed?.error || `The AI call failed (${response.status}).`;
    lastError = `${message}${code}`;
    // A refused model is worth retrying on the other tier. Missing auth, a
    // rate limit or an oversized request will fail the same way twice.
    if (response.status === 401 || response.status === 403 || response.status === 429 || response.status === 413) {
      break;
    }
  }

  throw new Error(lastError || 'The AI call failed.');
}

export function extractJsonObject(text: string): any {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('The AI plan was not valid JSON. Please try again.');
  }
  return JSON.parse(text.slice(start, end + 1));
}

export function cleanTsx(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:tsx|typescript|jsx|ts)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}
