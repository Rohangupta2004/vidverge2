/**
 * VIDEO FAILURE → PLAIN ENGLISH.
 *
 * Every video studio ends up showing the customer the same handful of
 * failures: the wallet ran dry, the provider is not connected, the model id
 * was refused, the prompt tripped moderation, the poll ran past its cap, the
 * network dropped. Left alone each app invents its own wording and most of
 * them end up dumping a raw error object on screen.
 *
 * `describeVideoFailure` is the one place that mapping lives. It takes
 * whatever the call site caught — an Error, a fetch Response, a string, a
 * provider payload — and returns something a customer can act on, plus the
 * working engines worth trying instead.
 *
 * Pair it with components/video/VideoErrorCard.tsx, which renders the result.
 */

import { engineHealth, suggestWorkingEngines } from './videoEngines';

export interface VideoFailure {
  /** Short headline, e.g. "That model is unavailable right now". */
  title: string;
  /** One or two sentences a non-technical customer can act on. */
  message: string;
  /** Working engines worth trying instead. Empty when swapping engine is not the fix. */
  alternatives: Array<{ id: string; name: string }>;
  /** False when retrying the identical request cannot possibly help. */
  canRetry: boolean;
  /** True when only the founder can clear it (top up, connect an account). */
  needsFounder: boolean;
  /** The raw text, kept for a collapsed "technical details" disclosure. */
  detail: string;
}

/** Pull something loggable out of anything a catch block might receive. */
export function rawVideoErrorText(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message || String(error);
  if (typeof error === 'object') {
    const obj = error as Record<string, any>;
    const candidate =
      obj.message ||
      obj.error?.message ||
      obj.error ||
      obj.detail ||
      obj.statusText ||
      '';
    if (typeof candidate === 'string' && candidate) return candidate;
    try {
      return JSON.stringify(obj);
    } catch {
      return String(obj);
    }
  }
  return String(error);
}

/** HTTP status, when the thing we caught carries one. */
function readStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const obj = error as Record<string, any>;
  const status = obj.status ?? obj.statusCode ?? obj.response?.status;
  return typeof status === 'number' ? status : null;
}

export interface DescribeVideoFailureOptions {
  /** The engine/model id the failed request was sent to, when known. */
  engineId?: string | null;
  /** Overrides the status sniffed off the error object. */
  status?: number | null;
  /** What the customer was waiting for, e.g. "scene 3". Used in the message. */
  subject?: string;
}

export function describeVideoFailure(
  error: unknown,
  options: DescribeVideoFailureOptions = {},
): VideoFailure {
  const detail = rawVideoErrorText(error);
  const text = detail.toLowerCase();
  const status = options.status ?? readStatus(error);
  const engineId = options.engineId || null;
  const subject = options.subject ? `${options.subject} ` : '';
  const alternatives = suggestWorkingEngines(engineId);
  const altNames = alternatives.map((a) => a.name).join(' or ');
  const tryInstead = altNames ? ` Try ${altNames} instead.` : '';

  const base = { alternatives, detail };

  // The wallet is the single most common hard stop, and only the founder can
  // clear it, so it is checked before anything else.
  if (status === 402 || text.includes('insufficient') || text.includes('wallet balance') || text.includes('not enough credit')) {
    return {
      ...base,
      title: 'Out of workspace credit',
      message:
        'The workspace wallet does not have enough balance to render this video. Top it up and the render will go through unchanged.',
      alternatives: [],
      canRetry: false,
      needsFounder: true,
    };
  }

  // A provider the platform has no key for. 503 from the generation proxies
  // means exactly this (Kling is the standing example).
  if (status === 503 || text.includes('not configured') || text.includes('api_key missing') || text.includes('api key missing')) {
    const health = engineHealth(engineId);
    return {
      ...base,
      title: 'That provider is not connected',
      message:
        (health?.note ? health.note + ' ' : 'This video provider is not set up on the platform yet. ') +
        (altNames ? `${altNames} ${alternatives.length > 1 ? 'are' : 'is'} available right now.` : ''),
      canRetry: false,
      needsFounder: false,
    };
  }

  if (status === 401 || status === 403 || text.includes('no_credentials') || text.includes('unauthor')) {
    return {
      ...base,
      title: 'The render was not authorised',
      message:
        'The request reached the video service without a valid workspace credential. Reloading the page usually re-issues it; if it keeps happening the workspace needs a look.',
      alternatives: [],
      canRetry: true,
      needsFounder: false,
    };
  }

  if (status === 429 || text.includes('rate limit') || text.includes('too many requests') || text.includes('quota')) {
    return {
      ...base,
      title: 'The video service is rate-limiting us',
      message:
        'Too many renders went out at once. Waiting a moment and retrying normally clears it — nothing was charged for the refused request.',
      canRetry: true,
      needsFounder: false,
    };
  }

  // A refused model id: either a typo against the proxy enum, or an id the
  // health sweep already caught failing.
  if (
    status === 400 ||
    text.includes('unsupported_model') ||
    text.includes('invalid_enum_value') ||
    text.includes('invalid model') ||
    text.includes('unknown model')
  ) {
    const health = engineHealth(engineId);
    return {
      ...base,
      title: 'That model is unavailable right now',
      message:
        (health?.note ? health.note + ' ' : 'The video service refused this model.') + tryInstead,
      canRetry: false,
      needsFounder: false,
    };
  }

  // The generation proxies answer 200 with a synthetic *_error_* operation id
  // rather than an HTTP error when a model is broken platform-side. Catching
  // that shape is the only way to tell it apart from a real failure.
  if (/(?:veo_video|veo|sora|openrouter|kling|higgsfield)_error_/.test(text)) {
    const health = engineHealth(engineId);
    return {
      ...base,
      title: 'The video service refused this model',
      message:
        (health?.note ? health.note + ' ' : 'This model is failing upstream, not in your brief.') + tryInstead,
      canRetry: false,
      needsFounder: false,
    };
  }

  if (text.includes('moderat') || text.includes('nsfw') || text.includes('safety') || text.includes('blocked')) {
    return {
      ...base,
      title: 'The prompt was blocked by content moderation',
      message:
        'The video model declined this prompt on safety grounds. Rewording the shot — especially named people, brands, or anything violent — usually clears it.',
      alternatives: [],
      canRetry: false,
      needsFounder: false,
    };
  }

  if (text.includes('timed out') || text.includes('timeout') || text.includes('took too long') || text.includes('still running')) {
    return {
      ...base,
      title: 'The render ran past its time limit',
      message:
        `We stopped waiting on ${subject || 'this render'}after the polling limit. The job may still finish upstream — retrying is safe, and a faster model usually lands inside the window.` +
        tryInstead,
      canRetry: true,
      needsFounder: false,
    };
  }

  if (text.includes('failed to fetch') || text.includes('networkerror') || text.includes('network error') || text.includes('load failed')) {
    return {
      ...base,
      title: 'The connection dropped mid-render',
      message:
        'The request never reached the video service. Check the connection and retry — nothing was charged.',
      alternatives: [],
      canRetry: true,
      needsFounder: false,
    };
  }

  return {
    ...base,
    title: `Could not generate ${subject.trim() || 'this video'}`,
    message:
      'The video service did not return a finished clip. Retrying often works, since most of these failures are transient.' +
      tryInstead,
    canRetry: true,
    needsFounder: false,
  };
}

export default describeVideoFailure;
