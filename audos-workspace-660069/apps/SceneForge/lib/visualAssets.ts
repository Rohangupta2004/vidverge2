// IMAGE RESOLUTION for image_kenburns scenes.
//
// The director writes an imagePrompt; this module turns it into a real URL the
// composition can show. Stock photography is tried FIRST and on purpose: it is
// free, instant, and for the archival/real-place moments the director reaches
// for image_kenburns it is usually more truthful than a generated picture.
// Generation is the opt-in upgrade for shots no photo library has.
//
// A scene whose image cannot be resolved keeps an empty imageUrl, and
// ImageKenBurnsVisual degrades to a typographic plate. A missing photo must
// never cost the viewer a beat of the film.
import { WORKSPACE_ID } from './supabase';
import type { SceneSpec } from './sceneSpec';

export type ImageSource = 'stock' | 'generated' | 'none';

export interface ResolveOptions {
  /** 'stock' searches Unsplash; 'generated' calls the platform image model. */
  prefer?: ImageSource;
  onProgress?: (done: number, total: number, label: string) => void;
  isCancelled?: () => boolean;
}

export interface ResolveResult {
  specs: SceneSpec[];
  resolved: number;
  failures: string[];
}

function queryFor(spec: SceneSpec): string {
  const parts = [spec.visual.imagePrompt, spec.visual.label, ...spec.visual.elements].filter(Boolean);
  return String(parts[0] || spec.caption || spec.narration).slice(0, 180);
}

async function stockPhoto(query: string): Promise<{ url: string; credit: string } | null> {
  const params = new URLSearchParams({ query, perPage: '3', orientation: 'landscape', workspaceId: WORKSPACE_ID });
  const response = await fetch(`/api/stock-photos?${params.toString()}`);
  if (!response.ok) return null;
  const payload = await response.json().catch(() => ({} as any));
  const first = Array.isArray(payload?.results) ? payload.results[0] : null;
  const url = first?.urls?.regular || first?.urls?.full || first?.urls?.small || '';
  if (!url) return null;
  return { url: String(url), credit: 'Unsplash' };
}

async function generatedPhoto(prompt: string): Promise<string> {
  const response = await fetch('/api/generate/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: `${prompt}. Documentary photography, natural light, cinematic, no text, no watermark.`, aspectRatio: '16:9', quality: 'standard' }),
  });
  const payload = await response.json().catch(() => ({} as any));
  if (!response.ok || !payload?.imageUrl) {
    throw new Error(String(payload?.error || payload?.message || `image generation failed (HTTP ${response.status})`));
  }
  return String(payload.imageUrl);
}

/**
 * Fill in every image_kenburns scene's imageUrl. Scenes that already carry one
 * (from an earlier run, or because the customer pasted their own) are left
 * alone, so re-running the pipeline never re-buys a picture it already has.
 */
export async function resolveSceneImages(specs: SceneSpec[], options: ResolveOptions = {}): Promise<ResolveResult> {
  const pending = specs.filter((spec) => spec.visual.type === 'image_kenburns' && !spec.visual.imageUrl);
  if (!pending.length) return { specs, resolved: 0, failures: [] };

  const prefer = options.prefer || 'stock';
  const found = new Map<number, { url: string; credit: string }>();
  const failures: string[] = [];
  let done = 0;

  for (const spec of pending) {
    if (options.isCancelled?.()) break;
    const query = queryFor(spec);
    options.onProgress?.(done, pending.length, `Finding a picture for scene ${spec.scene}\u2026`);
    try {
      if (prefer === 'generated') {
        found.set(spec.scene, { url: await generatedPhoto(query), credit: '' });
      } else {
        const photo = await stockPhoto(query);
        if (photo) found.set(spec.scene, photo);
        else failures.push(`Scene ${spec.scene}: no stock photo matched “${query.slice(0, 60)}”.`);
      }
    } catch (e: any) {
      failures.push(`Scene ${spec.scene}: ${String(e?.message || e).slice(0, 140)}`);
    }
    done += 1;
    options.onProgress?.(done, pending.length, `Finding a picture for scene ${spec.scene}\u2026`);
  }

  const next = specs.map((spec) => {
    const photo = found.get(spec.scene);
    if (!photo) return spec;
    return { ...spec, visual: { ...spec.visual, imageUrl: photo.url, ...(photo.credit ? { imageCredit: photo.credit } : {}) } };
  });
  return { specs: next, resolved: found.size, failures };
}
