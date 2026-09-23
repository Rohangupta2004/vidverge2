import type { Asset, Scene } from './supabase';

// ASSET REUSE — before any new still is generated for a scene, the project's
// existing library (Asset Studio generations, earlier scene images, user
// uploads) is searched for a matching picture. Reusing a match keeps a
// character, icon or product visual consistent across scenes AND costs
// nothing, so it always wins over regenerating. Matching is deliberately
// conservative: a weak overlap generates fresh rather than reusing a picture
// that does not fit the beat.

const STOPWORDS = new Set(['the', 'and', 'with', 'from', 'that', 'this', 'over', 'into', 'onto', 'them', 'then', 'than', 'have', 'their', 'there', 'about', 'against', 'while', 'where', 'when', 'what', 'scene', 'image', 'photo', 'shot', 'view', 'style', 'background', 'cinematic', 'quality', 'high', 'light', 'lighting']);

function tokens(text: string): string[] {
  return String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3 && !STOPWORDS.has(word));
}

export interface AssetMatch { asset: Asset; score: number; reason: 'same_scene' | 'subject_match' }

/**
 * The best existing project asset for this scene, or null when nothing fits:
 *  1. the scene's OWN earlier still (a kind switch may have replaced
 *     render_url with a clip, but the picture is still in the library),
 *  2. an asset whose prompt shares this scene's subject — at least three
 *     shared significant words, or two including one specific (6+ letter)
 *     word, so a recurring character/icon/product carries forward.
 */
export function findReusableAsset(assets: Asset[], scene: Scene): AssetMatch | null {
  const usable = (assets || []).filter((asset) => asset.public_url && (asset.asset_type === 'scene_image' || asset.asset_type === 'user_upload'));
  if (!usable.length) return null;
  const own = usable.find((asset) => asset.scene_id === scene.id);
  if (own) return { asset: own, score: 100, reason: 'same_scene' };
  const wanted = new Set(tokens(`${scene.description || ''} ${scene.image_prompts?.[0] || ''}`));
  if (!wanted.size) return null;
  let best: AssetMatch | null = null;
  for (const asset of usable) {
    const words = tokens(`${asset.prompt || ''} ${asset.element_name || ''}`);
    if (!words.length) continue;
    const seen = new Set<string>();
    let strong = false;
    for (const word of words) {
      if (wanted.has(word) && !seen.has(word)) { seen.add(word); if (word.length >= 6) strong = true; }
    }
    const overlap = seen.size;
    if (overlap >= 3 || (overlap >= 2 && strong)) {
      if (!best || overlap > best.score) best = { asset, score: overlap, reason: 'subject_match' };
    }
  }
  return best;
}
