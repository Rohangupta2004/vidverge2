import { classifyGenerationError, preserveTimecodesWhileSoftening, recoveryDecision } from './errorRecovery';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

export function runErrorRecoveryTests(): void {
  assert(classifyGenerationError('HTTP 401 no_credentials') === 'auth-credential', 'auth must classify');
  assert(classifyGenerationError({ code: 'workspace_service_credential_unavailable' }) === 'auth-credential', 'closed-tab credential failure must classify');
  assert(classifyGenerationError({ code: 'billing_http_401' }) === 'auth-credential', 'billing HTTP 401 must classify as auth');
  assert(classifyGenerationError({ code: 'billing_http_403' }) === 'auth-credential', 'billing HTTP 403 must classify as auth');
  assert(classifyGenerationError({ code: 'billing_not_confirmed' }) === 'auth-credential', 'generic billing authorization must not classify as balance');
  assert(classifyGenerationError({ code: 'cast_approval_required' }) === 'cast-approval', 'cast gate must classify');
  assert(classifyGenerationError('moderation blocked likeness') === 'content-policy', 'policy must classify');
  assert(classifyGenerationError('reference image invalid mime') === 'reference-image', 'reference must classify');
  assert(classifyGenerationError('429 quota') === 'rate-limit', 'rate limit must classify');
  assert(classifyGenerationError('provider timed out') === 'timeout', 'timeout must classify');
  assert(classifyGenerationError('503 upstream unavailable') === 'provider-outage', 'outage must classify');
  assert(classifyGenerationError({ code: 'insufficient_credits' }) === 'insufficient-credits', 'only the explicit insufficient-credit code is a balance failure');
  assert(recoveryDecision('503 unavailable', 3, false).action === 'stop', 'third attempt must stop without fallback consent');
  assert(recoveryDecision('503 unavailable', 3, true).action === 'switch-model', 'third attempt may switch only with consent');
  assert(recoveryDecision({ code: 'billing_http_401' }, 1, true).action === 'stop', 'billing auth failures must never suggest switching models');
  assert(recoveryDecision({ code: 'workspace_service_credential_unavailable' }, 1, true).action === 'stop', 'credential failures must never suggest switching models');
  const softened = preserveTimecodesWhileSoftening('0-4s: graphic injury.\n4-9s: camera tracks.');
  assert(softened.startsWith('0-4s:') && softened.includes('\n4-9s:'), 'safe rewrite must preserve timecode structure');
}
