/**
 * STAGE 11 — renderFilm.
 *
 * A deliberately thin stage. All it does is hand the immutable FilmSpec to a
 * RenderAdapter; Faceless always uses HyperFramesAdapter. Keeping the
 * knowledge of HOW a film is rendered inside the adapter is what lets the
 * renderer be replaced without any pipeline stage noticing — and it is why
 * nothing in this file knows about compositions, polling or frame extraction.
 */

import { FacelessError, type FilmSpec, type RenderResult } from '../types/editorial';
import { facelessRenderAdapter, type RenderAdapter } from '../lib/renderAdapter';

export interface RenderFilmOptions {
  /** Injectable for tests. Production always gets HyperFramesAdapter. */
  adapter?: RenderAdapter;
  onNote?: (note: string) => void;
  onNotice?: (message: string, tone?: 'info' | 'warn') => void;
}

export async function renderFilm(spec: FilmSpec, options: RenderFilmOptions = {}): Promise<RenderResult> {
  const adapter = options.adapter || facelessRenderAdapter();
  const assets = Object.values(spec.resolvedAssets);
  const startedAt = Date.now();

  options.onNote?.(`Rendering FilmSpec v${spec.version} through the ${adapter.id} adapter…`);

  const out = await adapter.render(
    spec.motionPlan,
    assets,
    spec.narrationUrl,
    options.onNote,
    options.onNotice,
  );
  if (!out?.mp4Url) {
    throw new FacelessError('The render adapter returned no video URL.', 'render', 'no_output');
  }

  return {
    mp4Url: out.mp4Url,
    frames: out.frames || [],
    adapter: adapter.id,
    durationMs: Date.now() - startedAt,
  };
}
