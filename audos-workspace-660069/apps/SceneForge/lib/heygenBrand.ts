// Brand locking: the kit imported from the customer's own website, and the
// glossary of product names the presenter must pronounce correctly.
//
// Both are capability-gated (see lib/heygenApi) because neither endpoint is
// part of the documented platform HeyGen contract — they are reached through
// the same transparent proxy, so they work on an account whose plan exposes
// them and report themselves absent on one that does not.
import { CapabilityUnavailable, body, get, listOf, post, probe } from './heygenApi';
import type { BrandKitSummary } from './heygenSession';

function firstString(source: any, keys: string[]): string {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    // Some shapes nest the value, e.g. { primary: { hex: '#fff' } }.
    if (value && typeof value === 'object') {
      for (const inner of ['hex', 'value', 'color', 'url']) {
        if (typeof value[inner] === 'string' && value[inner].trim()) return String(value[inner]).trim();
      }
    }
  }
  return '';
}

function colorList(source: any): string[] {
  const raw = source?.colors ?? source?.palette ?? source?.brand_colors;
  if (Array.isArray(raw)) {
    return raw.map((entry) => (typeof entry === 'string' ? entry : firstString(entry, ['hex', 'value', 'color']))).filter(Boolean);
  }
  return [];
}

/**
 * Normalize whatever HeyGen returned into the one shape the UI renders. The
 * field names below are tried in order rather than assumed, so a kit that
 * reports `primary_color` and one that reports `colors: [...]` both land.
 */
export function brandKitView(payload: any, websiteUrl: string): BrandKitSummary {
  const kit = body(payload);
  const palette = colorList(kit);
  const fonts = (() => {
    const raw = kit.fonts ?? kit.typography ?? kit.font_family;
    if (Array.isArray(raw)) return raw.map((entry) => (typeof entry === 'string' ? entry : firstString(entry, ['name', 'family', 'font_family']))).filter(Boolean);
    const single = firstString(kit, ['font', 'font_family']);
    return single ? [single] : [];
  })();
  return {
    id: String(kit.brand_kit_id || kit.id || ''),
    name: firstString(kit, ['name', 'brand_name', 'title', 'company_name']) || hostOf(websiteUrl) || 'Your brand',
    primaryColor: firstString(kit, ['primary_color', 'primaryColor', 'primary']) || palette[0] || '',
    secondaryColor: firstString(kit, ['secondary_color', 'secondaryColor', 'accent_color', 'secondary']) || palette[1] || '',
    logoUrl: firstString(kit, ['logo_url', 'logoUrl', 'logo', 'icon_url']),
    websiteUrl,
    fonts,
  };
}

export function hostOf(url: string): string {
  try { return new URL(normalizeUrl(url)).hostname.replace(/^www\./, ''); } catch { return ''; }
}

/** Accept "acme.com" the way a customer actually types it. */
export function normalizeUrl(input: string): string {
  const trimmed = String(input || '').trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function looksLikeUrl(input: string): boolean {
  const normalized = normalizeUrl(input);
  if (!normalized) return false;
  try {
    const parsed = new URL(normalized);
    return Boolean(parsed.hostname && parsed.hostname.includes('.'));
  } catch { return false; }
}

/**
 * Import a brand kit from the customer's site. HeyGen crawls the URL itself,
 * so this is one POST and the returned kit id is what every later generation
 * call carries.
 */
export async function importBrandKit(websiteUrl: string): Promise<BrandKitSummary> {
  const url = normalizeUrl(websiteUrl);
  if (!looksLikeUrl(url)) throw new Error('That does not look like a website address. Try something like acme.com.');
  const created = await probe('brand-kits', 'Brand Kit import', () => post('v3/brand-kits', { website_url: url }));
  const view = brandKitView(created, url);
  if (!view.id) throw new Error('HeyGen imported the brand but returned no brand kit id, so it cannot be locked to your videos.');
  return view;
}

/** Previously imported kits, when the account lists them. */
export async function listBrandKits(): Promise<BrandKitSummary[]> {
  const payload = await probe('brand-kits', 'Brand Kit library', () => get('v3/brand-kits'));
  return listOf(payload)
    .map((entry) => brandKitView(entry, firstString(entry, ['website_url', 'url'])))
    .filter((kit) => kit.id);
}

/** Split the comma-separated field into clean, de-duplicated terms. */
export function parseTerms(input: string): string[] {
  const seen = new Set<string>();
  return String(input || '')
    .split(/[,\n]/)
    .map((term) => term.trim())
    .filter((term) => {
      if (!term) return false;
      const key = term.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export interface GlossaryResult { id: string; terms: string[] }

/**
 * Register the words the presenter keeps mispronouncing — product names,
 * acronyms, founder surnames. The returned id rides along on every
 * generation call so the pronunciation holds across every scene.
 */
export async function createGlossary(input: string): Promise<GlossaryResult> {
  const terms = parseTerms(input);
  if (!terms.length) throw new Error('Add at least one product name or term first.');
  const created = await probe('brand-glossaries', 'Brand Glossary', () => post('v3/brand-glossaries', {
    // Both shapes are sent because HeyGen's glossary payload is undocumented
    // here and the two spellings are the plausible ones; an endpoint that
    // rejects unknown fields tells us so loudly rather than silently
    // dropping the terms, which is the outcome we want to see.
    terms,
    name: `SceneForge glossary (${terms.length} term${terms.length === 1 ? '' : 's'})`,
  }));
  const id = String(body(created).brand_glossary_id || body(created).glossary_id || body(created).id || '');
  if (!id) throw new Error('HeyGen accepted the glossary but returned no glossary id.');
  return { id, terms };
}

/** True when the failure is simply "not on this plan". */
export function isUnavailable(error: unknown): boolean {
  return error instanceof CapabilityUnavailable;
}
