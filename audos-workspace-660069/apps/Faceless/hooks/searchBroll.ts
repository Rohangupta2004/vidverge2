/**
 * Tier 2 — searchBroll.
 *
 * Real footage comes from Pexels through the faceless-assets server function
 * and the founder-owned PEXELS_API_KEY; the secret never enters this browser
 * bundle. Unsplash remains the no-key still fallback, animated with the beat's
 * camera move, so a missing or unavailable Pexels credential never blocks a
 * film.
 *
 * The provider ordering is load-bearing: video providers run first, then still
 * providers. selectAssets already prefers clips that comfortably cover the
 * narration beat, and prepareAssets handles their playback without padding.
 */

import type { AspectId, StockClip } from '../types/editorial';
import { callHook } from '../lib/platform';
import { aspectOf } from '../lib/facelessOptions';

const STAGE = 'assets' as const;

export interface StockProvider {
  id: string;
  /** Clip providers return video; still providers return images to animate. */
  returns: 'video' | 'image';
  search(query: string, limit: number, orientation: 'landscape' | 'portrait'): Promise<StockClip[]>;
}

/** Pexels video, through faceless-assets and the secure BYOK secrets proxy. */
export const pexelsProvider: StockProvider = {
  id: 'pexels',
  returns: 'video',
  async search(query: string, limit: number, orientation: 'landscape' | 'portrait'): Promise<StockClip[]> {
    const out = await callHook<{ results?: StockClip[] }>(
      'faceless-assets',
      { op: 'stock_video', query, perPage: limit, orientation },
      STAGE,
    );
    return (Array.isArray(out.results) ? out.results : []).filter(
      (entry): entry is StockClip =>
        entry?.kind === 'video' &&
        entry.provider === 'pexels' &&
        /^https?:\/\//i.test(String(entry.url || '')),
    );
  },
};

/** Unsplash, through the platform stock-photos integration. */
export const unsplashProvider: StockProvider = {
  id: 'unsplash',
  returns: 'image',
  async search(query: string, limit: number, orientation: 'landscape' | 'portrait'): Promise<StockClip[]> {
    const out = await callHook<{ results?: any[] }>(
      'faceless-assets',
      { op: 'stock', query, perPage: limit, orientation },
      STAGE,
    );
    return (Array.isArray(out.results) ? out.results : [])
      .map((entry: any): StockClip | null => {
        const url = String(entry?.url || '');
        if (!/^https?:\/\//i.test(url)) return null;
        return {
          id: String(entry?.id || url).slice(0, 120),
          url,
          thumbUrl: String(entry?.thumbUrl || url),
          description: String(entry?.description || entry?.altDescription || query).slice(0, 240),
          width: Number(entry?.width) || 1920,
          height: Number(entry?.height) || 1080,
          kind: 'image',
          provider: 'unsplash',
          attribution: entry?.id ? `https://unsplash.com/photos/${entry.id}` : undefined,
        };
      })
      .filter((clip): clip is StockClip => clip !== null);
  },
};

const PROVIDERS: StockProvider[] = [pexelsProvider, unsplashProvider];

/**
 * Real clips are preferred over animated stills. An unavailable credential,
 * provider error or empty Pexels result falls through to Unsplash.
 */
export async function searchBroll(query: string, limit = 6, aspect?: AspectId): Promise<StockClip[]> {
  const text = String(query || '').trim();
  if (text.length < 3) return [];
  const orientation = aspectOf(aspect).stockOrientation;

  const ordered = [
    ...PROVIDERS.filter((provider) => provider.returns === 'video'),
    ...PROVIDERS.filter((provider) => provider.returns === 'image'),
  ];

  for (const provider of ordered) {
    try {
      const results = await provider.search(text, limit, orientation);
      if (results.length) return results;
    } catch {
      // A dead provider falls through to the next one rather than failing the
      // beat; selectAssets will hand it to generation if nothing is found.
    }
  }
  return [];
}

/**
 * Stock search rewards concrete nouns and punishes editorial language. The
 * director writes intent ("one point multiplying to forty points on a world
 * map"); the search index wants "world map network nodes".
 */
export function stockQueryFrom(searchQuery: string | undefined, visualIntent: string): string {
  const source = String(searchQuery || visualIntent || '');
  return source
    .toLowerCase()
    .replace(/\b(shot|footage|clip|b-?roll|cinematic|slow motion|close up|wide|camera|pushes?|pulls?)\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .join(' ')
    .trim();
}
