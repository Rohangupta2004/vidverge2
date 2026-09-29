/**
 * VIDVERGE SHARED SEED — one numeric generation seed shared across the apps so
 * a character and visual style established in Script-to-Video (or SceneForge)
 * carry into an Ads Studio ad instead of coming back as a different person.
 *
 * The seed lives in localStorage rather than in a table on purpose: it is a
 * per-browser creative preference, every app that needs it runs inside the
 * same page, and adopting it costs no schema change.
 *
 *   vidverge_shared_seed  the cross-app seed — whichever app generates first wins
 *   stv_active_seed       Script-to-Video's own active seed
 *   ads_studio_seed       Ads Studio's own active seed
 *
 * WHERE THE SEED ACTUALLY LANDS (verified against the platform contracts,
 * 26 Sep 2026 — do not "upgrade" one of these without re-reading the docs):
 *
 *   Kling  — a real `seed` integer, accepted on text-to-video,
 *            image-to-video and multi-image/Elements.
 *   Veo / Omni Flash — POST /api/veo/generate/video exposes NO seed
 *            parameter, so the number travels as a `Seed: <n>` prompt suffix.
 *            That nudges the model toward a consistent look; it is NOT
 *            reproducibility, and nothing here pretends otherwise.
 *   HeyGen — has no seed concept. Consistency there comes from reusing the
 *            avatar_id + voice_id pair stored alongside the seed.
 */

export const SHARED_SEED_KEY = 'vidverge_shared_seed';
export const STV_SEED_KEY = 'stv_active_seed';
export const ADS_SEED_KEY = 'ads_studio_seed';

const MIN_SEED = 1;
const MAX_SEED = 999999999;

/** A fresh integer seed in the 1–999,999,999 range every engine accepts. */
export function randomSeed(): number {
  return Math.floor(Math.random() * (MAX_SEED - MIN_SEED + 1)) + MIN_SEED;
}

function coerce(raw: string | null): number | null {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= MIN_SEED && n <= MAX_SEED ? n : null;
}

function readKey(key: string): number | null {
  try {
    return typeof localStorage === 'undefined' ? null : coerce(localStorage.getItem(key));
  } catch {
    return null; // private mode / blocked storage — the caller generates one
  }
}

function writeKey(key: string, seed: number): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, String(seed));
  } catch { /* quota or private mode — the seed just does not survive reload */ }
}

/** The cross-app seed, or null when no app has established one yet. */
export function readSharedSeed(): number | null {
  return readKey(SHARED_SEED_KEY);
}

/** Publish a seed as the cross-app seed. */
export function writeSharedSeed(seed: number): void {
  writeKey(SHARED_SEED_KEY, seed);
}

/**
 * Script-to-Video's seed for the current project. Adopts the shared seed when
 * one already exists (so a film made after an ad matches that ad), otherwise
 * mints one and publishes it for the other apps.
 */
export function ensureScriptToVideoSeed(): number {
  const own = readKey(STV_SEED_KEY);
  const shared = readSharedSeed();
  const seed = own !== null ? own : (shared !== null ? shared : randomSeed());
  writeKey(STV_SEED_KEY, seed);
  writeSharedSeed(seed);
  return seed;
}

/** Start a deliberately different look in Script-to-Video. */
export function rerollScriptToVideoSeed(): number {
  const seed = randomSeed();
  writeKey(STV_SEED_KEY, seed);
  writeSharedSeed(seed);
  return seed;
}

export interface ResolvedSeed {
  seed: number;
  /** True when this seed came from Script-to-Video / SceneForge rather than
   * being minted here — drives the "Using seed from Script-to-Video" badge. */
  fromScriptToVideo: boolean;
}

/**
 * The seed Ads Studio should generate on. The shared key is consulted FIRST so
 * an ad inherits the character and style of the film the founder just made.
 * With nothing to inherit, a fresh seed is minted and published.
 */
export function resolveAdsSeed(): ResolvedSeed {
  const shared = readSharedSeed();
  const stv = readKey(STV_SEED_KEY);
  if (shared !== null) {
    writeKey(ADS_SEED_KEY, shared);
    return { seed: shared, fromScriptToVideo: stv === shared };
  }
  const existing = readKey(ADS_SEED_KEY);
  const own = existing !== null ? existing : randomSeed();
  writeKey(ADS_SEED_KEY, own);
  writeSharedSeed(own);
  return { seed: own, fromScriptToVideo: false };
}

/** Persist an explicit Ads Studio seed and share it with the other apps. */
export function setAdsSeed(seed: number): number {
  const cleaned = coerce(String(Math.floor(Number(seed))));
  const next = cleaned !== null ? cleaned : randomSeed();
  writeKey(ADS_SEED_KEY, next);
  writeSharedSeed(next);
  return next;
}

/** The re-roll button: a brand-new look, published to the other apps. */
export function rerollAdsSeed(): number {
  return setAdsSeed(randomSeed());
}

/**
 * The prompt-side carrier for engines with no seed parameter (every Group A
 * Veo / Omni Flash route). Appended verbatim to the generation prompt.
 */
export function seedPromptSuffix(seed: number | null | undefined): string {
  const n = Math.floor(Number(seed));
  return Number.isFinite(n) && n > 0 ? `Seed: ${n}` : '';
}
