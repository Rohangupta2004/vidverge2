/**
 * Product context — the last product the customer told this workspace about.
 *
 * Brand Reel already scrapes a product's name, tagline and hero image from a
 * URL. Stashing that here lets any OTHER surface (notably the Runway panels)
 * open already knowing what the product is, instead of asking for the same
 * three facts again.
 *
 * Purely a convenience cache: every consumer must work fine with an empty
 * record, and nothing here is authoritative.
 */

const KEY = 'vv-product-context-v1';

export interface ProductContext {
  name: string;
  description: string;
  imageUrl: string;
  videoUrl: string;
  updatedAt: number;
}

export function emptyProductContext(): ProductContext {
  return { name: '', description: '', imageUrl: '', videoUrl: '', updatedAt: 0 };
}

export function readProductContext(): ProductContext {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
    if (!raw) return emptyProductContext();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return emptyProductContext();
    return {
      name: String(parsed.name || ''),
      description: String(parsed.description || ''),
      imageUrl: String(parsed.imageUrl || ''),
      videoUrl: String(parsed.videoUrl || ''),
      updatedAt: Number(parsed.updatedAt || 0),
    };
  } catch {
    return emptyProductContext();
  }
}

/** Merge-write. Empty strings never overwrite something already known. */
export function writeProductContext(patch: Partial<ProductContext>): ProductContext {
  const current = readProductContext();
  const next: ProductContext = {
    name: String(patch.name || '').trim() || current.name,
    description: String(patch.description || '').trim() || current.description,
    imageUrl: String(patch.imageUrl || '').trim() || current.imageUrl,
    videoUrl: String(patch.videoUrl || '').trim() || current.videoUrl,
    updatedAt: Date.now(),
  };
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode or quota — the cache is optional by design */
  }
  return next;
}
