// Step 7 — render.
//
// The platform render service takes ONE self-contained source string that may
// import only 'react' and 'remotion'. The generated Film.tsx is not that: it
// imports the SDK, the types and the asset registry, because that is what
// makes it readable and what makes the compile gate meaningful.
//
// buildFilmBundle reconciles the two. It hoists the imports away, inlines the
// asset registry as a literal, prepends the SDK runtime source and hands the
// result over as one module. The SAME bundle string feeds the in-app Remotion
// Player, which is what makes the preview binding rather than decorative.

import { registrySnapshot } from '../lib/asset-registry';
import { WORKSPACE_ID } from '../lib/platform';
import { REMOTION_IMPORTS, SDK_RUNTIME_SOURCE } from '../sdk/runtime-source';
import { RENDER_CONSTRAINTS } from '../sdk/component-sdk.types';
import type { ProductContext } from '../types/product-context.types';

export interface FilmTheme {
  bg: string;
  text: string;
  muted: string;
  accent: string;
  onAccent: string;
  panel: string;
  border: string;
}

export const DEFAULT_FILM_THEME: FilmTheme = {
  bg: '#05060A',
  text: '#F3F6FB',
  muted: 'rgba(243,246,251,0.6)',
  accent: '#F59E0B',
  onAccent: '#140B01',
  panel: 'rgba(255,255,255,0.06)',
  border: 'rgba(255,255,255,0.12)',
};

function isHex(value: string): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(value || '').trim());
}

/** Relative luminance, to decide what colour sits legibly on the accent. */
function luminance(hex: string): number {
  const raw = hex.replace('#', '');
  const full = raw.length === 3 ? raw.split('').map((ch) => ch + ch).join('') : raw;
  const value = parseInt(full, 16);
  const r = ((value >> 16) & 255) / 255;
  const g = ((value >> 8) & 255) / 255;
  const b = (value & 255) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The film's palette comes from the product's own site. Where the extraction
 * read nothing usable the default dark grade is used, because an invented
 * brand colour is worse than an honest neutral one.
 */
export function filmThemeFrom(ctx: ProductContext): FilmTheme {
  const accent = [ctx.brand.accent_colors[0], ctx.brand.primary_colors[0]]
    .find((color) => color && isHex(color)) || DEFAULT_FILM_THEME.accent;
  const bg = isHex(ctx.brand.background_color) ? ctx.brand.background_color : DEFAULT_FILM_THEME.bg;
  const text = isHex(ctx.brand.text_color) ? ctx.brand.text_color : DEFAULT_FILM_THEME.text;
  const dark = luminance(bg) < 0.5;
  return {
    bg,
    text,
    muted: dark ? 'rgba(255,255,255,0.6)' : 'rgba(10,12,17,0.58)',
    accent,
    onAccent: luminance(accent) > 0.6 ? '#0A0C11' : '#FFFFFF',
    panel: dark ? 'rgba(255,255,255,0.06)' : 'rgba(10,12,17,0.05)',
    border: dark ? 'rgba(255,255,255,0.12)' : 'rgba(10,12,17,0.12)',
  };
}

// ---------------------------------------------------------------------------
// Bundling
// ---------------------------------------------------------------------------

/** Remove every import statement, including the multi-line form. */
export function stripImports(code: string): string {
  return String(code || '')
    .replace(/^[ \t]*import[\s\S]*?from[ \t]*['"][^'"]*['"][ \t]*;?[ \t]*$/gm, '')
    .replace(/^[ \t]*import[ \t]+['"][^'"]*['"][ \t]*;?[ \t]*$/gm, '');
}

/**
 * registerRoot is in the house rules because the brief asks for it and
 * because it proves the model produced a whole file rather than a fragment.
 * It cannot run here — the Player and the render service both mount the
 * default export — so it is dropped at bundle time.
 */
export function stripRegisterRoot(code: string): string {
  return String(code || '').replace(/^[ \t]*registerRoot[ \t]*\([^)]*\)[ \t]*;?[ \t]*$/gm, '');
}

export interface BundleOptions {
  theme?: FilmTheme;
  assets?: Record<string, string>;
}

export function buildFilmBundle(filmTsx: string, options: BundleOptions = {}): string {
  const theme = options.theme || DEFAULT_FILM_THEME;
  const assets = options.assets || registrySnapshot();
  const body = stripRegisterRoot(stripImports(filmTsx)).trim();

  const preamble = [
    "import React from 'react';",
    'import { ' + REMOTION_IMPORTS.join(', ') + " } from 'remotion';",
    '',
    '// Asset registry, inlined. resolveAsset is the only way a handle becomes a URL.',
    'const ASSET_MAP = ' + JSON.stringify(assets, null, 2) + ';',
    '',
    'function resolveAsset(handle) {',
    '  var url = ASSET_MAP[handle];',
    '  return url === undefined ? \'\' : url;',
    '}',
    '',
    'function hasAsset(handle) {',
    '  return Object.prototype.hasOwnProperty.call(ASSET_MAP, handle);',
    '}',
    '',
    'const FILM_THEME = ' + JSON.stringify(theme, null, 2) + ';',
    '',
    'const RENDER_CONSTRAINTS = ' + JSON.stringify(RENDER_CONSTRAINTS, null, 2) + ';',
  ].join('\n');

  return [preamble, SDK_RUNTIME_SOURCE, '// ── generated film ──', body, ''].join('\n');
}

// ---------------------------------------------------------------------------
// Render service
// ---------------------------------------------------------------------------

export type RenderPhase = 'pending' | 'rendering' | 'complete' | 'failed';

export interface RenderResult {
  videoUrl: string;
  durationMs: number;
  frameCount: number;
  /** The exact source that produced this file, kept for the preview and for QA. */
  bundle: string;
}

interface SubmitReply { operationId?: string; error?: string; message?: string }
interface StatusReply { status?: RenderPhase; videoUrl?: string; error?: string }

export interface RenderOptions {
  frameCount?: number;
  theme?: FilmTheme;
  assets?: Record<string, string>;
  onProgress?: (phase: RenderPhase, elapsedMs: number) => void;
  intervalMs?: number;
  timeoutMs?: number;
}

export async function submitRender(bundle: string, frameCount: number): Promise<string> {
  const response = await fetch('/api/render/remotion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspaceId: WORKSPACE_ID,
      compositionTsx: bundle,
      props: {},
      durationInFrames: Math.min(
        RENDER_CONSTRAINTS.maxDurationFrames,
        Math.max(1, Math.round(frameCount)),
      ),
      fps: RENDER_CONSTRAINTS.fps,
      width: RENDER_CONSTRAINTS.width,
      height: RENDER_CONSTRAINTS.height,
    }),
  });
  const data = (await response.json().catch(() => null)) as SubmitReply | null;
  if (!response.ok || !data?.operationId) {
    throw new Error(String(
      data?.error || data?.message || ('The render service answered HTTP ' + response.status),
    ));
  }
  return String(data.operationId);
}

/** Poll until the file lands. Every tick is a real server answer. */
export async function pollRender(
  operationId: string,
  onTick: (phase: RenderPhase, elapsedMs: number) => void,
  options: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<string> {
  const intervalMs = options.intervalMs || 3000;
  const timeoutMs = options.timeoutMs || 900000;
  const started = Date.now();

  for (;;) {
    const response = await fetch('/api/render/remotion/' + operationId);
    const data = (await response.json().catch(() => null)) as StatusReply | null;
    const phase: RenderPhase = (data?.status as RenderPhase) || 'rendering';
    onTick(phase, Date.now() - started);

    if (phase === 'complete' && data?.videoUrl) return String(data.videoUrl);
    if (phase === 'failed') throw new Error(String(data?.error || 'The render failed.'));
    if (Date.now() - started > timeoutMs) {
      throw new Error('The render is taking longer than expected and was given up on.');
    }
    await new Promise((resolve) => { window.setTimeout(resolve, intervalMs); });
  }
}

/**
 * Bundle the film and render it at the pinned geometry.
 *
 * RENDER_CONSTRAINTS are applied here and nowhere else: the service is fixed
 * at 1920x1080 / 30fps and rejects anything else, so nothing upstream is
 * allowed to choose them.
 */
export async function renderFilm(
  filmTsx: string,
  options: RenderOptions = {},
): Promise<RenderResult> {
  const frameCount = Math.min(
    RENDER_CONSTRAINTS.maxDurationFrames,
    Math.max(1, Math.round(options.frameCount || RENDER_CONSTRAINTS.fps * 20)),
  );
  const bundle = buildFilmBundle(filmTsx, { theme: options.theme, assets: options.assets });
  const onProgress = options.onProgress || (() => undefined);

  const started = Date.now();
  const operationId = await submitRender(bundle, frameCount);
  const videoUrl = await pollRender(operationId, onProgress, {
    intervalMs: options.intervalMs,
    timeoutMs: options.timeoutMs,
  });

  return {
    videoUrl,
    durationMs: Date.now() - started,
    frameCount,
    bundle,
  };
}

/** Runtime seconds of a film, at the pinned frame rate. */
export function filmSecondsOf(frameCount: number): number {
  return Math.round((frameCount / RENDER_CONSTRAINTS.fps) * 10) / 10;
}
