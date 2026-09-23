/**
 * ASSET LAYER — the existing Asset Generator, integrated as a sub-system of
 * the agentic Product Film pipeline.
 *
 * Generation goes through the SAME registered server function the standalone
 * Asset Generator app uses (asset-image-gen → Omni Flash image model via the
 * schema-validated /api/veo/generate/image proxy → durable GCS URL), so the
 * standalone app keeps working untouched and the film pipeline reuses its
 * exact engine.
 *
 * CACHE CONTRACT: every generated asset is keyed by a fingerprint of
 * (prompt, aspect) in product_film_assets. Identical asset requests across
 * scenes and films REUSE the cached image — never regenerate.
 */

import { FilmAsset, callHook, db, fingerprint } from './api';

export type AssetAspect = '9:16' | '16:9' | '1:1';

function assetFingerprint(prompt: string, aspect: AssetAspect): string {
  return fingerprint({ kind: 'asset', p: prompt.trim().toLowerCase(), a: aspect });
}

/** In-flight de-duplication: two scenes asking for the same asset at the same
 * moment share one generation. */
const inflight = new Map<string, Promise<string>>();

export async function generateOrReuseAsset(params: {
  filmId: number | null;
  name: string;
  prompt: string;
  aspect: AssetAspect;
  onNote?: (n: string) => void;
}): Promise<string> {
  const prompt = params.prompt.trim();
  if (!prompt) throw new Error('This asset scene has no generation brief.');
  const fp = assetFingerprint(prompt, params.aspect);

  // 1. Cache lookup — any of this session's assets with the same fingerprint.
  try {
    const cached = (await db.listAssets(null)).find((a) => a.fingerprint === fp && a.url);
    if (cached) {
      params.onNote?.(`Reusing the cached asset “${cached.name || params.name}” — no regeneration.`);
      return cached.url;
    }
  } catch { /* cache is best-effort; fall through to generation */ }

  // 2. Shared in-flight generation.
  const running = inflight.get(fp);
  if (running) return running;

  const work = (async () => {
    params.onNote?.(`Generating asset “${params.name}”…`);
    const data = await callHook('asset-image-gen', { op: 'generate', prompt, aspect: params.aspect });
    const url = data?.imageUrl;
    if (!url || typeof url !== 'string') throw new Error(String(data?.error || 'The asset engine returned no image.'));
    await db.addAsset({
      film_id: params.filmId,
      kind: 'generated',
      name: params.name.slice(0, 120),
      description: prompt.slice(0, 400),
      prompt,
      fingerprint: fp,
      url,
      aspect: params.aspect,
    });
    return url;
  })();
  inflight.set(fp, work);
  try {
    return await work;
  } finally {
    inflight.delete(fp);
  }
}

/** Register an uploaded screenshot/asset so Opus can reuse it across films. */
export async function registerUpload(filmId: number | null, url: string, description: string): Promise<FilmAsset | null> {
  return db.addAsset({
    film_id: filmId,
    kind: 'upload',
    name: 'Uploaded asset',
    description: description.slice(0, 400),
    fingerprint: fingerprint({ kind: 'upload', url }),
    url,
    aspect: null,
  });
}
