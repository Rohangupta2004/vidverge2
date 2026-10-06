/**
 * OMNI FLASH FALLBACK — the engine a rejected model hands over to.
 *
 * Every model picker in the workspace now lists the FULL roster and lets the
 * customer choose any of it, because a greyed-out button tells them nothing
 * they can act on. The honesty that used to live in the disabled state lives
 * here instead: when the platform refuses the chosen model — the Runway proxy
 * still accepts only `gen4.5` and `gen4_turbo`, and answers
 * `400 model must be one of: gen4.5, gen4_turbo.` for everything else — the
 * request is re-run on Omni Flash and the surface says so out loud.
 *
 * Two rules keep this from hiding real problems:
 *   · Only a MODEL/INPUT rejection falls back. A wallet problem, a
 *     cancellation or a provider outage is surfaced as itself.
 *   · If the fallback also fails, the caller rethrows the ORIGINAL error —
 *     the customer reads why their model refused, not why the stand-in did.
 */

import { pollGroupA, submitGroupA } from './videoEngineClient';
import { KLING_MODELS, capPromptText, groupAModel, runwayModel } from './videoEngines';
import type { AppId } from './appIds';

/** The Group A model every fallback lands on.
 *
 * `gemini-omni-flash-preview` is the ONLY Omni Flash id the video proxy's
 * model enum accepts (integrations/image-and-video-generation/docs.md); a
 * versioned spelling such as `gemini-omni-flash-1.1` is not in the enum and
 * answers 400 invalid_enum_value. */
// TODO: upgrade to 1.1 when platform key is confirmed
export const OMNI_FALLBACK_MODEL = 'gemini-omni-flash-preview';

/** What the customer is told they got. */
export const OMNI_FALLBACK_LABEL = 'Omni Flash';

export function omniFallbackMessage(modelLabel: string): string {
  return `${modelLabel} not available — generated with ${OMNI_FALLBACK_LABEL} instead.`;
}

/** The customer-facing name of any engine id in the catalog. */
export function engineLabelOf(id: string | null | undefined): string {
  const key = String(id || '');
  return groupAModel(key)?.name
    || runwayModel(key)?.label
    || KLING_MODELS.filter((k) => k.id === key)[0]?.name
    || key
    || 'That engine';
}

/**
 * True when retrying the SAME request on the SAME model would refuse the same
 * way — the only case where switching engines is the right move.
 */
export function isModelRejection(e: unknown): boolean {
  const err = e as any;
  const status = Number(err?.status || 0);
  const code = String(err?.code || '').toLowerCase();
  const message = String(err?.message || e || '').toLowerCase();

  // Money, cancellation and outages are never a reason to spend again.
  if (status === 402 || status === 401 || status === 429) return false;
  if (/insufficient_funds|cancelled|canceled|unauthorized|rate_limited|timeout/.test(code)) return false;
  if (/insufficient|wallet|top up|cancelled|canceled|taking unusually long/.test(message)) return false;

  if (/unsupported_model|invalid_request|combining_rules|bad_request|invalid_enum_value/.test(code)) return true;
  if (/model must be one of|unsupported model|unknown model|is not a runway model|not available on this platform|is not listing|invalid_enum_value|image-to-video only|does not support/.test(message)) return true;

  // Any other 4xx from a submit is an input the provider will keep refusing.
  return status >= 400 && status < 500;
}

/** Runway speaks pixel pairs; the Group A proxy speaks shorthand. */
export function omniAspect(ratio: string | null | undefined): '16:9' | '9:16' | '1:1' {
  const raw = String(ratio || '').trim();
  if (raw === '16:9' || raw === '9:16' || raw === '1:1') return raw;
  const parts = raw.split(':').map(Number);
  if (parts.length === 2 && parts.every((n) => Number.isFinite(n) && n > 0)) {
    const [w, h] = parts;
    if (Math.abs(w - h) / Math.max(w, h) < 0.05) return '1:1';
    return h > w ? '9:16' : '16:9';
  }
  return '16:9';
}

const httpsOnly = (url?: string | null): string | null =>
  (typeof url === 'string' && /^https:\/\//i.test(url) ? url : null);

export interface OmniFallbackInput {
  prompt: string;
  /** '16:9' / '9:16' / '1:1' or a Runway pixel pair — both are understood. */
  aspect?: string | null;
  durationSeconds?: number;
  /** A still to animate, or the frame this shot continues out of. */
  seedImageUrl?: string | null;
  /** A locked presenter or product reference. Omni Flash takes it alongside the seed. */
  referenceImageUrl?: string | null;
  negativePrompt?: string;
  /** The calling app's registered id (lib/appIds) — the job is recorded against it. */
  appId?: AppId;
  onStatus?: (status: string) => void;
  isCancelled?: () => boolean;
}

export interface OmniFallbackResult {
  videoUrl: string;
  model: string;
  label: string;
}

/** Render one clip on Omni Flash through the standard Group A path. */
export async function generateWithOmniFlash(input: OmniFallbackInput): Promise<OmniFallbackResult> {
  const prompt = capPromptText(input.prompt, 1000);
  if (prompt.length < 10) {
    throw new Error(`${OMNI_FALLBACK_LABEL} needs a written description of the shot before it can stand in.`);
  }
  const spec = groupAModel(OMNI_FALLBACK_MODEL);
  const seed = httpsOnly(input.seedImageUrl);
  const reference = httpsOnly(input.referenceImageUrl);

  input.onStatus?.(`Generating on ${OMNI_FALLBACK_LABEL}…`);
  const kickoff = await submitGroupA({
    appId: input.appId,
    model: OMNI_FALLBACK_MODEL,
    prompt,
    negativePrompt: input.negativePrompt ? capPromptText(input.negativePrompt, 500) : undefined,
    aspectRatio: omniAspect(input.aspect),
    duration: Math.max(4, Math.min(spec?.maxDurationS || 8, Math.round(Number(input.durationSeconds) || 6))),
    generateAudio: true,
    imageData: seed || reference || undefined,
    referenceImages: seed && reference ? [{ imageData: reference, referenceType: 'asset' }] : undefined,
  });
  const videoUrl = await pollGroupA(kickoff.operationId, {
    creditKey: kickoff.creditKey,
    isCancelled: input.isCancelled,
    appId: input.appId,
  });
  return { videoUrl, model: OMNI_FALLBACK_MODEL, label: OMNI_FALLBACK_LABEL };
}
