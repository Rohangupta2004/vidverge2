/**
 * ELEVENLABS NARRATION MODELS — the one place a TTS model id and its settings
 * are chosen.
 *
 * Until now nothing in this workspace sent `modelId` at all, so every take ran
 * on the platform's implicit default (`eleven_turbo_v2_5`) at $0.30 per 1,000
 * characters. The model is selectable now, so narration records on ElevenLabs
 * v4 — better delivery at $0.08 per 1,000 characters.
 *
 * THE SETTINGS ARE NOT INTERCHANGEABLE, which is why this is a module and not
 * a constant. The platform rejects an unsupported setting with HTTP 400 BEFORE
 * anything is billed, and it never substitutes a model silently:
 *
 *   eleven_v4          Text-to-Dialogue. `stability` 0–1 and `similarity_boost`
 *                      0–1. Rejects `style`, `speed`, `use_speaker_boost`.
 *                      2,000 characters per call.
 *   eleven_v3          `stability` ONLY, and only 0, 0.5 or 1. Rejects
 *                      `similarity_boost`. 5,000 characters per call.
 *   eleven_flash_v2_5  The fast/cheap legacy path, for anything a person is
 *                      waiting on live. Legacy four-field settings.
 *   eleven_turbo_v2_5  The old implicit default. Legacy settings, $0.30/1K.
 *
 * Sending the legacy four-field object to v4 fails the whole take, which is
 * exactly the kind of silent breakage this module exists to prevent.
 *
 * THE LADDER. A 503 `model_unavailable` means the platform account cannot use
 * that model at all, and the docs are explicit that there is no provider-side
 * fallback — "explicitly select another model". So a caller walks down:
 * v4 → v3 → fast. Neither v3 nor v4 supports SSML; expressive tags
 * like [excited] pass through unchanged and count toward billing.
 */

export type ElevenModelId =
  | 'eleven_v4'
  | 'eleven_v3'
  | 'eleven_flash_v2_5'
  | 'eleven_turbo_v2_5';

export const ELEVEN_V4: ElevenModelId = 'eleven_v4';
export const ELEVEN_V3: ElevenModelId = 'eleven_v3';
export const ELEVEN_FLASH: ElevenModelId = 'eleven_flash_v2_5';
export const ELEVEN_LEGACY_TURBO: ElevenModelId = 'eleven_turbo_v2_5';

/** The film narration default. */
export const NARRATION_MODEL: ElevenModelId = ELEVEN_V4;
/** What narration falls back to when v4 is unavailable for this account. */
export const NARRATION_MODEL_FALLBACK: ElevenModelId = ELEVEN_V3;
/** The fast option, for a line a person is waiting on (previews, one-off
 * auditions) rather than a finished film. */
export const NARRATION_MODEL_FAST: ElevenModelId = ELEVEN_FLASH;

/** Walked in order when a take is refused for being on the wrong model. */
export const NARRATION_MODEL_LADDER: ElevenModelId[] = [
  NARRATION_MODEL,
  NARRATION_MODEL_FALLBACK,
  NARRATION_MODEL_FAST,
];

const LABELS: Record<ElevenModelId, string> = {
  eleven_v4: 'ElevenLabs v4',
  eleven_v3: 'ElevenLabs v3',
  eleven_flash_v2_5: 'ElevenLabs Flash v2.5',
  eleven_turbo_v2_5: 'ElevenLabs Turbo v2.5',
};

export function elevenModelLabel(id: string | null | undefined): string {
  return LABELS[String(id || '') as ElevenModelId] || String(id || 'ElevenLabs');
}

/** Characters ONE call may carry on this model. Oversized input is rejected
 * with a 400 before billing, never truncated server-side. */
const MAX_CHARS: Record<ElevenModelId, number> = {
  eleven_v4: 2000,
  eleven_v3: 5000,
  eleven_flash_v2_5: 10000,
  eleven_turbo_v2_5: 10000,
};

export function elevenMaxChars(id: string | null | undefined): number {
  return MAX_CHARS[String(id || '') as ElevenModelId] ?? MAX_CHARS.eleven_v4;
}

/** Platform price per 1,000 characters, for a cost line in the UI. */
export function elevenPricePer1kUsd(id: string | null | undefined): number {
  const model = String(id || '') as ElevenModelId;
  return model === ELEVEN_V4 || model === ELEVEN_V3 ? 0.08 : 0.30;
}

/** The narration voice character every take shares, expressed once in
 * model-neutral terms so each model can be given only the fields it accepts. */
export interface NarrationTone {
  /** 0 = expressive and varied, 1 = steady and flat. */
  stability: number;
  /** How closely the delivery matches the original voice. */
  similarity: number;
}

export const NARRATION_TONE: NarrationTone = { stability: 0.5, similarity: 0.85 };

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

/** v3 accepts ONLY 0, 0.5 or 1 — anything else is a 400. */
function v3Stability(value: number): number {
  const v = clamp01(value);
  if (v < 0.25) return 0;
  if (v > 0.75) return 1;
  return 0.5;
}

/**
 * The `voiceSettings` object for this model, and nothing more. An unknown or
 * extra field is rejected rather than discarded, so this returns the exact
 * allow-list per model.
 */
export function elevenVoiceSettings(
  id: string | null | undefined,
  tone: NarrationTone = NARRATION_TONE,
): Record<string, number | boolean> {
  const model = String(id || '') as ElevenModelId;
  if (model === ELEVEN_V4) {
    return { stability: clamp01(tone.stability), similarity_boost: clamp01(tone.similarity) };
  }
  if (model === ELEVEN_V3) {
    return { stability: v3Stability(tone.stability) };
  }
  return {
    stability: clamp01(tone.stability),
    similarity_boost: clamp01(tone.similarity),
    style: 0.4,
    use_speaker_boost: true,
  };
}

/**
 * Is this failure "wrong model for this request" rather than a real problem?
 *
 * Only these two are worth another rung. A 401, 402, 429 or provider outage
 * means the same thing on every model, and re-sending would spend again for
 * the same answer.
 */
export function isElevenModelRejection(error: {
  status?: number;
  code?: string;
  message?: string;
}): boolean {
  const status = Number(error?.status) || 0;
  const code = String(error?.code || '');
  if (status === 503 && code === 'model_unavailable') return true;
  if (status === 400 && code === 'invalid_voiceover_request') return true;
  return status === 400 && /model|setting|character|limit/i.test(String(error?.message || ''));
}

/** The next model to try after `current`, or null at the end of the ladder. */
export function nextNarrationModel(current: string | null | undefined): ElevenModelId | null {
  const index = NARRATION_MODEL_LADDER.indexOf(String(current || '') as ElevenModelId);
  if (index < 0) return NARRATION_MODEL_FALLBACK;
  return NARRATION_MODEL_LADDER[index + 1] || null;
}

/**
 * The first model at or after `from` in the ladder that can carry `chars` in
 * ONE call.
 *
 * This is a correctness guard, not an optimisation: v4's 2,000-character limit
 * is well under a long narration line, and an oversized input is refused with
 * a 400, so a line that does not fit starts on the model that holds it instead
 * of failing and then walking the ladder.
 */
export function narrationModelForChars(
  chars: number,
  from: ElevenModelId = NARRATION_MODEL,
): ElevenModelId {
  const start = Math.max(0, NARRATION_MODEL_LADDER.indexOf(from));
  const reachable = NARRATION_MODEL_LADDER.slice(start);
  const fits = reachable.find((id) => chars <= elevenMaxChars(id));
  if (fits) return fits;
  return [...reachable].sort((a, b) => elevenMaxChars(b) - elevenMaxChars(a))[0] || NARRATION_MODEL;
}
