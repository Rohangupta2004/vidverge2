// asset-registry — handle to URL.
//
// The whole pipeline speaks in handles ('homepage_hero'), never URLs: the
// FilmSpec names them, the ComponentPlan carries them verbatim, and the
// generated Film.tsx writes resolveAsset('homepage_hero'). URLs appear in
// exactly one place — here — which is what lets the compile gate prove every
// asset a film references actually exists before a frame is rendered.
//
// The module-level map is intentional: resolveAsset is called from generated
// code that has no way to receive a container.

import type { ProductContext } from '../types/product-context.types';

let registry: Map<string, string> = new Map();

export function buildAssetRegistry(ctx: ProductContext): void {
  registry = new Map();
  for (const asset of ctx.assets) {
    if (asset && asset.handle) registry.set(asset.handle, String(asset.source_url || ''));
  }
  if (ctx.brand.logo_handle && !registry.has(ctx.brand.logo_handle)) {
    // A logo named by the brand extraction but not captured as an asset still
    // has to be a known handle, or every scene that uses it fails validation
    // for the wrong reason. It resolves to nothing and draws as a missing
    // asset, which is the honest outcome.
    registry.set(ctx.brand.logo_handle, '');
  }
}

export function resolveAsset(handle: string): string {
  const url = registry.get(handle);
  if (url === undefined) throw new Error('Asset handle not found in registry: ' + handle);
  return url;
}

export function hasAsset(handle: string): boolean {
  return registry.has(handle);
}

/** Handles that are registered but resolved to no URL — they will draw as missing. */
export function emptyHandles(): string[] {
  const out: string[] = [];
  registry.forEach((url, handle) => { if (!url) out.push(handle); });
  return out;
}

/** The whole registry as a plain object, for inlining into a render bundle. */
export function registrySnapshot(): Record<string, string> {
  const out: Record<string, string> = {};
  registry.forEach((url, handle) => { out[handle] = url; });
  return out;
}

export function registeredHandles(): string[] {
  const out: string[] = [];
  registry.forEach((_url, handle) => { out.push(handle); });
  return out;
}

export function clearAssetRegistry(): void {
  registry = new Map();
}
