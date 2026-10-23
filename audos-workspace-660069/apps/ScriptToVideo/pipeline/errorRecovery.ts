export type GenerationErrorClass = 'content-policy' | 'bad-prompt' | 'reference-image' | 'rate-limit' | 'timeout' | 'provider-outage' | 'auth-credential' | 'insufficient-credits' | 'cast-approval' | 'unknown';
export interface RecoveryDecision {
  category: GenerationErrorClass;
  retryable: boolean;
  action: 'soften-prompt' | 'simplify-scene' | 'adjust-references' | 'backoff' | 'switch-model' | 'stop';
  backoffMs: number;
  customerMessage: string;
  founderDiagnosis: string;
}

export function classifyGenerationError(raw: unknown): GenerationErrorClass {
  const text = JSON.stringify(raw || '').toLowerCase();
  if (/cast_approval_required|approve every retained character|confirm that this script needs no cast/.test(text)) return 'cast-approval';
  if (/billing_http_(?:401|403)|workspace_service_credential_unavailable|\b401\b|\b403\b|credential|token|unauth|api key|no_credentials/.test(text)) return 'auth-credential';
  if (/\binsufficient_credits\b/.test(text)) return 'insufficient-credits';
  if (/billing[_-]/.test(text)) return 'auth-credential';
  if (/moderation|content.policy|safety|likeness|blocked/.test(text)) return 'content-policy';
  if (/reference|image.*invalid|mime|dimension|face/.test(text)) return 'reference-image';
  if (/429|rate.?limit|quota/.test(text)) return 'rate-limit';
  if (/timeout|timed out|expired|took too long/.test(text)) return 'timeout';
  if (/500|502|503|504|outage|unavailable|upstream/.test(text)) return 'provider-outage';
  if (/prompt|unsupported field|invalid request|too long/.test(text)) return 'bad-prompt';
  return 'unknown';
}

export function recoveryDecision(raw: unknown, attempt: number, allowFallback: boolean): RecoveryDecision {
  const category = classifyGenerationError(raw);
  const rawText = typeof raw === 'string' ? raw : JSON.stringify(raw || 'Unknown provider error');
  const boundedAttempt = Math.max(1, Math.min(3, Math.round(attempt || 1)));
  const terminalCategories: GenerationErrorClass[] = ['auth-credential', 'insufficient-credits', 'cast-approval'];
  const terminal = boundedAttempt >= 3 || terminalCategories.includes(category);
  const action: RecoveryDecision['action'] = terminal
    ? allowFallback && boundedAttempt >= 3 && !terminalCategories.includes(category) ? 'switch-model' : 'stop'
    : category === 'content-policy' ? 'soften-prompt'
      : category === 'reference-image' ? 'adjust-references'
        : category === 'bad-prompt' ? 'simplify-scene'
          : 'backoff';
  return {
    category,
    retryable: action !== 'stop',
    action,
    backoffMs: action === 'backoff' ? [2_000, 8_000, 24_000][boundedAttempt - 1] : 0,
    customerMessage: category === 'insufficient-credits' ? 'You do not have enough Vidverge credits. Add credits, then retry.' : category === 'auth-credential' ? 'Sign-in session expired — refresh and retry.' : category === 'cast-approval' ? 'Approve every retained cast sheet, or confirm that no cast is needed, before Start.' : category === 'rate-limit' ? 'The provider is rate-limited. Wait briefly, then retry this scene or switch models.' : category === 'provider-outage' ? 'The provider is temporarily unavailable. Retry shortly or switch models.' : action === 'stop' ? 'This scene could not be repaired after three safe attempts. Your failed-attempt credits were returned.' : 'The provider refused this attempt. Review the technical details before another paid attempt.',
    founderDiagnosis: `class=${category}; attempt=${boundedAttempt}; action=${action}; raw_provider_error=${rawText}`,
  };
}

export function preserveTimecodesWhileSoftening(prompt: string): string {
  return String(prompt || '').split('\n').map((line) => {
    const match = line.match(/^(\s*(?:SHOT\s+\d+\s+—\s+)?\d+(?:\.\d+)?-\d+(?:\.\d+)?s:\s*)(.*)$/i);
    if (!match) return line;
    const softened = match[2]
      .replace(/\b(?:blood|gore|graphic injury|weapon|violent attack)\b/gi, 'non-graphic dramatic tension')
      .replace(/\b(?:celebrity|famous person)\b/gi, 'fictional adult performer');
    return match[1] + softened;
  }).join('\n');
}
