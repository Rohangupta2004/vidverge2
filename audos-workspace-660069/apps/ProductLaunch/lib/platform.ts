// platform — the Audos endpoints this app actually talks to.
//
// Four, and no others:
//   ps-brand-scrape        reads a page server-side and photographs it
//   /api/render/remotion   submits a composition and polls for the MP4
//   /api/video/frames      pulls stills back out of the finished file
//   /proxy/anthropic/...   the model, via lib/ai-client.ts
//
// A browser cannot fetch a product's own site directly (no CORS, and the page
// is usually client-rendered anyway), which is why reading a URL is a server
// function call rather than a fetch.

export const WORKSPACE_ID = 'f24710e5-7c6d-4db4-92b4-c2c235877575';

export function normalizeUrl(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
}

export function isLikelyUrl(value: string): boolean {
  const raw = normalizeUrl(value);
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    return parsed.hostname.indexOf('.') > 0;
  } catch {
    return false;
  }
}

/** Same-origin path for one of this workspace's server functions. */
export function hookUrl(name: string): string {
  return '/api/hooks/execute/' + WORKSPACE_ID + '/' + name;
}

export async function callHook<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(hookUrl(name), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !data) {
    throw new Error(String(data?.error || (name + ' answered HTTP ' + response.status)));
  }
  return data as T;
}

/** Join a path onto an origin without doubling or dropping the slash. */
export function pageUrl(base: string, path: string): string {
  try {
    return new URL(path, normalizeUrl(base)).toString();
  } catch {
    return '';
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(normalizeUrl(url)).hostname.replace(/^www\./, '');
  } catch {
    return String(url || '');
  }
}

/** 'Feature Tour' -> 'feature_tour', for building asset handles from page names. */
export function toHandle(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || 'asset';
}
