/**
 * STAGE 3 — buildAssetIndex.
 *
 * Tier 1 and Tier 3 of the cost hierarchy only mean something if the pipeline
 * actually knows what this workspace already owns. This stage reads the
 * workspace's own media — rendered films, uploaded footage, generated stills
 * from earlier sessions, product screenshots — and turns it into a queryable
 * index that selectAssets scores a beat's search query against.
 *
 * The read happens in the `faceless-assets` server function because the
 * catalog endpoints are workspace-authenticated. Catalogs that cannot be read
 * become warnings on the index rather than a thrown error: a film should still
 * be makeable on stock and generation alone, it just costs more, and the
 * warning is how the customer finds out why.
 */

import type { AssetIndex, IndexedAsset } from '../types/editorial';
import { callHook } from '../lib/platform';
import { listStoredAssets, type FacelessAssetRow } from '../lib/filmStore';

const STAGE = 'asset_index' as const;

interface RawIndexedAsset {
  id?: string;
  kind?: string;
  url?: string;
  thumbUrl?: string;
  title?: string;
  description?: string;
  tags?: string[];
  durationSeconds?: number;
  width?: number;
  height?: number;
  source?: string;
}

export async function buildAssetIndex(filmId: string): Promise<AssetIndex> {
  const warnings: string[] = [];
  let catalogAssets: RawIndexedAsset[] = [];
  try {
    const raw = await callHook('faceless-assets', { op: 'index' }, STAGE) as {
      assets?: RawIndexedAsset[];
      warnings?: string[];
    };
    catalogAssets = Array.isArray(raw.assets) ? raw.assets : [];
    warnings.push(...(Array.isArray(raw.warnings) ? raw.warnings.map(String) : []));
  } catch (error: any) {
    warnings.push(`The workspace media catalog could not be read: ${String(error?.message || error)}`);
  }

  let durableAssets: RawIndexedAsset[] = [];
  try {
    durableAssets = (await listStoredAssets()).map(storedAssetToRaw);
  } catch (error: any) {
    warnings.push(`The Faceless reusable asset index could not be read: ${String(error?.message || error)}`);
  }

  // Durable Faceless assets come first. Deduping by URL ensures an asset also
  // exposed by the platform catalog is still represented only once.
  const seen = new Set<string>();
  const assets = [...durableAssets, ...catalogAssets]
    .map(toIndexedAsset)
    .filter((asset): asset is IndexedAsset => {
      if (!asset || seen.has(asset.url)) return false;
      seen.add(asset.url);
      return true;
    });

  return {
    filmId,
    builtAt: new Date().toISOString(),
    assets,
    counts: {
      video: assets.filter((a) => a.kind === 'video').length,
      image: assets.filter((a) => a.kind === 'image').length,
      screenshot: assets.filter((a) => a.kind === 'screenshot').length,
      graphic: assets.filter((a) => a.kind === 'graphic').length,
    },
    warnings: warnings.slice(0, 8),
  };
}

function storedAssetToRaw(row: FacelessAssetRow): RawIndexedAsset {
  return {
    id: row.id,
    kind: row.kind || undefined,
    url: row.url,
    thumbUrl: row.thumb_url || undefined,
    title: row.title || undefined,
    description: row.description || undefined,
    tags: Array.isArray(row.tags) ? row.tags : [],
    durationSeconds: Number.isFinite(Number(row.duration)) ? Number(row.duration) : undefined,
    width: row.width || undefined,
    height: row.height || undefined,
    source: row.source || 'faceless-generated',
  };
}

function toIndexedAsset(raw: RawIndexedAsset): IndexedAsset | null {
  const url = String(raw?.url || '');
  if (!/^https?:\/\//i.test(url)) return null;

  const kind = normaliseKind(raw?.kind, url);
  const title = String(raw?.title || '').trim() || 'Untitled workspace asset';
  const haystack = [title, raw?.description, (raw?.tags || []).join(' '), raw?.source]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return {
    id: String(raw?.id || url).slice(0, 120),
    kind,
    url,
    thumbUrl: raw?.thumbUrl ? String(raw.thumbUrl) : undefined,
    title: title.slice(0, 160),
    haystack,
    durationSeconds: Number.isFinite(Number(raw?.durationSeconds)) ? Number(raw?.durationSeconds) : undefined,
    width: Number.isFinite(Number(raw?.width)) ? Number(raw?.width) : undefined,
    height: Number.isFinite(Number(raw?.height)) ? Number(raw?.height) : undefined,
    // Footage the workspace already owns is Tier 1; a still or screenshot it
    // already owns is Tier 3. Both are free, which is the point.
    tier: kind === 'video' ? 1 : 3,
    source: String(raw?.source || 'workspace'),
  };
}

function normaliseKind(kind: unknown, url: string): IndexedAsset['kind'] {
  const value = String(kind || '').toLowerCase();
  if (value === 'video' || value === 'image' || value === 'screenshot' || value === 'graphic') {
    return value as IndexedAsset['kind'];
  }
  if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(url)) return 'video';
  if (/screenshot|capture|ui-/i.test(url)) return 'screenshot';
  return 'image';
}

// ---------------------------------------------------------------------------
// Querying
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'at',
  'from', 'by', 'as', 'is', 'it', 'that', 'this', 'shot', 'footage', 'clip',
  'video', 'image', 'cinematic', 'broll', 'b-roll',
]);

export function tokenise(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

/**
 * A deliberately conservative matcher. Half the query's meaningful tokens must
 * appear before an existing asset is considered a match, because reusing a
 * nearly-right clip is worse for the film than paying for a right one — the
 * cost hierarchy is a tie-breaker, not a mandate to force a bad shot in.
 */
export function queryAssetIndex(
  index: AssetIndex,
  query: string,
  options: { kinds?: IndexedAsset['kind'][]; minScore?: number } = {},
): { asset: IndexedAsset; score: number }[] {
  const tokens = tokenise(query);
  if (!tokens.length) return [];
  const kinds = options.kinds;
  const minScore = options.minScore ?? 0.5;

  return index.assets
    .filter((asset) => !kinds || kinds.includes(asset.kind))
    .map((asset) => {
      const hits = tokens.filter((token) => asset.haystack.includes(token)).length;
      return { asset, score: hits / tokens.length };
    })
    .filter((entry) => entry.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

/** A compact catalog summary the editorial director is shown before it plans. */
export function describeIndexForDirector(index: AssetIndex, limit = 24): string {
  if (!index.assets.length) {
    return 'EXISTING WORKSPACE ASSETS: none available. Tier 1 and Tier 3 are not reachable for this film; plan from Tier 2 (stock), Tier 4 (generated stills) and graphics.';
  }
  const lines = index.assets
    .slice(0, limit)
    .map((asset) => `- [${asset.kind}] ${asset.title}${asset.durationSeconds ? ` (${asset.durationSeconds.toFixed(1)}s)` : ''}`);
  return [
    `EXISTING WORKSPACE ASSETS (${index.assets.length} total, ${lines.length} shown). Prefer these for Tier 1 and Tier 3 beats:`,
    ...lines,
  ].join('\n');
}
