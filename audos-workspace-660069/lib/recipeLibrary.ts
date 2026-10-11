/**
 * RECIPE LIBRARY — where a Runway Recipe generation goes once it succeeds.
 *
 * The platform video catalog (GET /api/workspaces/:id/videos, read through the
 * vv-workspace-videos server function) only ever hears about generations the
 * PLATFORM itself ran. A Runway Recipe returns durable media straight to the
 * browser, so nothing was ever registering it — which is why Ads Studio →
 * Recipes → Saved Videos showed every other provider and never Runway.
 *
 * Every successful generation is now normalised AT SAVE TIME into
 * `vv_recipe_videos` (one row per returned media URL, with an explicit
 * `provider`), and the server function merges those rows into the catalog list
 * it already returns. The Omni Flash stand-in is saved the same way, marked
 * `gemini`, so a clip is never lost just because Runway was switched off.
 *
 * Saving is best-effort on purpose: a library write must never fail a
 * generation the customer has already paid for.
 */

export const RECIPE_VIDEOS_TABLE = 'vv_recipe_videos';

/** The longest prompt any recipe submit may carry — Runway's own promptText ceiling. */
export const RECIPE_PROMPT_MAX = 1000;

export interface RecipeGeneration {
  mediaUrls: string[];
  /** 'runway' for the Runway proxy, 'gemini' for the Omni Flash stand-in. */
  provider: 'runway' | 'gemini';
  kind: 'video' | 'image';
  recipeId?: string;
  model?: string;
  prompt?: string;
  aspectRatio?: string;
  taskId?: string;
}

function workspaceDb(): any {
  return (window as any).__workspaceDb || null;
}

/**
 * Register one finished generation in the recipe library. Resolves with the
 * number of rows written; never throws.
 */
export async function saveRecipeGeneration(generation: RecipeGeneration): Promise<number> {
  const db = workspaceDb();
  const urls = (generation.mediaUrls || [])
    .map((url) => String(url || '').trim())
    .filter((url) => /^https:\/\//i.test(url));
  if (!db || !urls.length) return 0;

  let written = 0;
  for (const mediaUrl of urls) {
    try {
      await db.from(RECIPE_VIDEOS_TABLE).insert({
        media_url: mediaUrl,
        provider: generation.provider,
        kind: generation.kind,
        recipe_id: generation.recipeId || null,
        model: generation.model || null,
        prompt: String(generation.prompt || '').slice(0, 10000) || null,
        aspect_ratio: generation.aspectRatio || null,
        task_id: generation.taskId || null,
      });
      written += 1;
    } catch (error) {
      // A library write is bookkeeping. The customer already has the clip on
      // screen with a working Download, so a failed insert is logged and
      // dropped rather than surfaced as a generation failure.
      console.warn('[recipes] the generation could not be saved to the library:', error);
    }
  }
  return written;
}

/**
 * Build the ONE prompt string a recipe submit is allowed to carry.
 *
 * - control characters removed (a pasted brief routinely carries them, and
 *   they are what the proxies answer 400 to)
 * - runs of whitespace collapsed to a single space
 * - capped at RECIPE_PROMPT_MAX characters, cut on a word boundary so a
 *   trimmed prompt still reads as a sentence
 * - NEVER empty: it falls back to the scene/product description, and then to a
 *   generic direction, because an empty prompt is an automatic 400
 */
export function buildRecipePrompt(parts: Array<string | null | undefined>, fallback = ''): string {
  const clean = (value: string | null | undefined) => String(value || '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const joined = parts.map(clean).filter(Boolean).join(' ').trim();
  const text = joined || clean(fallback) || 'A clean, well-lit product shot with a premium commercial finish.';
  if (text.length <= RECIPE_PROMPT_MAX) return text;
  const cut = text.slice(0, RECIPE_PROMPT_MAX);
  const space = cut.lastIndexOf(' ');
  return (space > RECIPE_PROMPT_MAX * 0.6 ? cut.slice(0, space) : cut).trim();
}

/** Log the exact prompt a request is about to carry. Debugging a refused
 * generation starts with knowing what was actually sent. */
export function logRecipePrompt(label: string, prompt: string): void {
  console.log(`[recipes] ${label} prompt (${prompt.length} chars):`, prompt);
}
