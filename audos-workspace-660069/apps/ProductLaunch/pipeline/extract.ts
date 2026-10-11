// Step 1 — URL to ProductContext.
//
// Two halves, deliberately split:
//
//   READING is deterministic. ps-brand-scrape fetches each page server-side
//   and photographs it, and THIS FILE assigns every asset handle and every
//   source_url from what actually came back. The model never invents a URL,
//   because it is never the thing that produces one.
//
//   UNDERSTANDING is the model's. Opus receives the harvest plus the captured
//   asset list and writes the brief: what the product is, who it is for, what
//   each asset is good for in a film, and what is missing.
//
// The reconcile step at the end is what keeps those halves honest — an asset
// the model described that was never captured is dropped, and an asset that
// was captured but ignored is appended rather than silently lost.

import { callModelForJson, OPUS_MODEL } from '../lib/ai-client';
import { buildAssetRegistry } from '../lib/asset-registry';
import { callHook, hostOf, normalizeUrl, pageUrl, toHandle } from '../lib/platform';
import {
  EXTRACTION_EVIDENCE_CLAUSE,
  EXTRACTION_SYSTEM_PROMPT,
  PRODUCT_CONTEXT_JSON_SHAPE,
} from '../prompts/extraction.prompt';
import {
  ASSET_TYPES,
  DESIGN_MATURITIES,
  VISUAL_QUALITIES,
  type AssetType,
  type DesignMaturity,
  type ExtractedAsset,
  type ProductContext,
  type VisualQuality,
} from '../types/product-context.types';

/** Pages worth trying beyond the homepage, in the order they pay off. */
const CANDIDATE_PATHS = ['/features', '/product', '/how-it-works', '/pricing'];

/** Four page reads is the honest ceiling: each one is a headless browser crawl. */
const MAX_PAGES = 4;

export interface ScrapeResult {
  url: string;
  ok: boolean;
  title: string;
  description: string;
  headlines: string[];
  bullets: string[];
  ctas: string[];
  text: string;
  palette: string[];
  fonts: string[];
  screenshotUrl: string;
  imageUrls: string[];
  logoUrl: string;
}

interface RawScrape {
  success?: boolean;
  title?: string;
  description?: string;
  siteName?: string;
  headlines?: unknown;
  bullets?: unknown;
  ctas?: unknown;
  text?: unknown;
  readableText?: unknown;
  content?: unknown;
  palette?: unknown;
  themeColor?: unknown;
  fonts?: unknown;
  screenshotUrl?: unknown;
  images?: unknown;
  logoUrl?: unknown;
  logo?: unknown;
  ogImage?: unknown;
  error?: string;
}

function strings(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const text = typeof entry === 'string'
      ? entry
      : String((entry as { text?: unknown; hex?: unknown; url?: unknown })?.text
        || (entry as { hex?: unknown })?.hex
        || (entry as { url?: unknown })?.url
        || '');
    const trimmed = text.trim();
    if (trimmed && out.indexOf(trimmed) < 0) out.push(trimmed);
    if (out.length >= limit) break;
  }
  return out;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/**
 * ps-brand-scrape has grown field names over time (direct harvest vs the apify
 * rendered crawl report different shapes), so every read here is tolerant: a
 * renamed field costs a detail, never the whole run.
 */
export async function scrapePage(url: string): Promise<ScrapeResult> {
  const target = normalizeUrl(url);
  const empty: ScrapeResult = {
    url: target,
    ok: false,
    title: '',
    description: '',
    headlines: [],
    bullets: [],
    ctas: [],
    text: '',
    palette: [],
    fonts: [],
    screenshotUrl: '',
    imageUrls: [],
    logoUrl: '',
  };
  if (!target) return empty;

  let data: RawScrape | null = null;
  try {
    data = await callHook<RawScrape>('ps-brand-scrape', { url: target, screenshot: true, render: true });
  } catch {
    return empty;
  }
  if (!data || data.success === false) return empty;

  const palette = strings(data.palette, 8);
  const themeColor = firstString(data.themeColor);
  if (themeColor && palette.indexOf(themeColor) < 0) palette.unshift(themeColor);

  return {
    url: target,
    ok: true,
    title: firstString(data.title, data.siteName),
    description: firstString(data.description),
    headlines: strings(data.headlines, 14),
    bullets: strings(data.bullets, 20),
    ctas: strings(data.ctas, 8),
    text: firstString(data.readableText, data.text, data.content).slice(0, 7000),
    palette,
    fonts: strings(data.fonts, 5),
    screenshotUrl: firstString(data.screenshotUrl),
    imageUrls: strings(data.images, 10),
    logoUrl: firstString(data.logoUrl, data.logo, data.ogImage),
  };
}

export interface CapturedAsset {
  handle: string;
  url: string;
  type: AssetType;
  /** Where it came from, so the model can describe it without guessing. */
  origin: string;
}

function captureAssets(pages: ScrapeResult[]): CapturedAsset[] {
  const captured: CapturedAsset[] = [];
  const seenUrls: string[] = [];
  const push = (asset: CapturedAsset): void => {
    if (!asset.url || seenUrls.indexOf(asset.url) >= 0) return;
    seenUrls.push(asset.url);
    captured.push(asset);
  };

  pages.forEach((page, index) => {
    let slug = 'homepage_hero';
    if (index > 0) {
      try {
        slug = 'page_' + toHandle(new URL(page.url).pathname || ('page_' + String(index)));
      } catch {
        slug = 'page_' + String(index);
      }
    }
    push({
      handle: slug,
      url: page.screenshotUrl,
      type: 'screenshot',
      origin: 'full-page screenshot of ' + page.url + (page.title ? ' (' + page.title + ')' : ''),
    });
  });

  const home = pages[0];
  if (home) {
    push({ handle: 'logo_primary', url: home.logoUrl, type: 'logo', origin: 'logo / og image on the homepage' });
    home.imageUrls.slice(0, 6).forEach((url, index) => {
      push({
        handle: 'site_image_' + String(index + 1),
        url,
        type: 'hero_image',
        origin: 'image embedded on ' + home.url,
      });
    });
  }

  return captured;
}

function describePage(page: ScrapeResult, index: number): string {
  const lines: string[] = [];
  lines.push((index === 0 ? 'HOMEPAGE: ' : 'PAGE: ') + page.url);
  if (!page.ok) {
    lines.push('  COULD NOT BE READ — treat this page as unavailable.');
    return lines.join('\n');
  }
  if (page.title) lines.push('  title: ' + page.title);
  if (page.description) lines.push('  description: ' + page.description);
  if (page.headlines.length) lines.push('  headlines: ' + page.headlines.join(' | '));
  if (page.bullets.length) lines.push('  bullets: ' + page.bullets.join(' | '));
  if (page.ctas.length) lines.push('  calls to action: ' + page.ctas.join(' | '));
  if (page.palette.length) lines.push('  colours used on the page: ' + page.palette.join(', '));
  if (page.fonts.length) lines.push('  fonts declared: ' + page.fonts.join(', '));
  lines.push('  screenshot captured: ' + (page.screenshotUrl ? 'yes' : 'NO'));
  if (page.text) lines.push('  readable text:\n' + page.text);
  return lines.join('\n');
}

function buildEvidence(url: string, pages: ScrapeResult[], captured: CapturedAsset[]): string {
  const blocks: string[] = [];
  blocks.push(EXTRACTION_EVIDENCE_CLAUSE);
  blocks.push('SUBMITTED URL: ' + url);
  blocks.push('PAGES READ (' + String(pages.filter((page) => page.ok).length) + ' of '
    + String(pages.length) + ' attempted)');
  blocks.push(pages.map(describePage).join('\n\n'));
  blocks.push('CAPTURED ASSETS — these handles exist and nothing else does:\n'
    + (captured.length
      ? captured.map((asset) => '  ' + asset.handle + '  [' + asset.type + ']  ' + asset.origin).join('\n')
      : '  none — no screenshot or image could be captured at all'));
  blocks.push(PRODUCT_CONTEXT_JSON_SHAPE);
  blocks.push(
    'Produce the ProductContext JSON now. Use EXACTLY these asset handles in assets[].handle, '
    + 'one entry per captured asset, and set source_url to the empty string — the production fills '
    + 'it in. Add nothing to assets[] that is not listed above. Anything you wish existed goes in '
    + 'extraction_gaps or manufacture_required. Answer with the JSON object and nothing else.',
  );
  return blocks.join('\n\n');
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function strList(value: unknown, limit = 12): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(str).filter(Boolean).slice(0, limit);
}

function oneOf<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  const candidate = str(value).toLowerCase() as T;
  return allowed.indexOf(candidate) >= 0 ? candidate : fallback;
}

function clamp01(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function normalizeAsset(raw: unknown, captured: CapturedAsset): ExtractedAsset {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    handle: captured.handle,
    type: oneOf<AssetType>(source.type, ASSET_TYPES, captured.type),
    source_url: captured.url,
    description: str(source.description) || captured.origin,
    visual_quality: oneOf<VisualQuality>(source.visual_quality, VISUAL_QUALITIES, 'medium'),
    film_usability: str(source.film_usability) || 'not assessed — use with care',
    suitable_for_roles: strList(source.suitable_for_roles, 6),
  };
}

/**
 * Marry what the model said to what was actually captured.
 *
 * Order follows the model's ranking (it was asked to sort by film usability),
 * and anything it skipped is appended rather than dropped — a captured asset
 * that nobody described is still a real asset the film may need.
 */
function reconcileAssets(raw: unknown, captured: CapturedAsset[]): ExtractedAsset[] {
  const described = Array.isArray(raw) ? raw : [];
  const byHandle = new Map<string, CapturedAsset>();
  for (const asset of captured) byHandle.set(asset.handle, asset);

  const out: ExtractedAsset[] = [];
  const used: string[] = [];
  for (const entry of described) {
    const handle = str((entry as { handle?: unknown })?.handle);
    const match = byHandle.get(handle);
    if (!match || used.indexOf(handle) >= 0) continue;
    used.push(handle);
    out.push(normalizeAsset(entry, match));
  }
  for (const asset of captured) {
    if (used.indexOf(asset.handle) >= 0) continue;
    out.push(normalizeAsset(null, asset));
  }
  return out;
}

function normalizeContext(
  raw: unknown,
  url: string,
  pages: ScrapeResult[],
  captured: CapturedAsset[],
): ProductContext {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const brandRaw = (source.brand && typeof source.brand === 'object'
    ? source.brand
    : {}) as Record<string, unknown>;
  const home = pages[0];
  const assets = reconcileAssets(source.assets, captured);
  const handles = assets.map((asset) => asset.handle);

  const features = (Array.isArray(source.key_features) ? source.key_features : [])
    .map((entry) => {
      const feature = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
      const handle = str(feature.asset_handle);
      const known = handles.indexOf(handle) >= 0;
      return {
        name: str(feature.name),
        description: str(feature.description),
        has_visual: known && Boolean(feature.has_visual),
        asset_handle: known ? handle : undefined,
      };
    })
    .filter((feature) => feature.name)
    .slice(0, 8);

  const socialProof = (Array.isArray(source.social_proof) ? source.social_proof : [])
    .map((entry) => {
      const item = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
      return {
        type: oneOf<'testimonial' | 'customer_logo' | 'metric' | 'press_mention'>(
          item.type,
          ['testimonial', 'customer_logo', 'metric', 'press_mention'],
          'testimonial',
        ),
        content: str(item.content),
        film_usable: Boolean(item.film_usable),
      };
    })
    .filter((item) => item.content)
    .slice(0, 8);

  const logoHandle = str(brandRaw.logo_handle);
  const bestHook = str(source.best_hook_asset);

  return {
    url,
    extracted_at: new Date().toISOString(),
    pages_analyzed: pages.filter((page) => page.ok).map((page) => page.url),

    product_name: str(source.product_name) || str(home?.title) || hostOf(url),
    tagline: str(source.tagline) || str(home?.description),
    product_category: str(source.product_category) || 'software product',
    target_audience: str(source.target_audience) || 'unspecified — the site did not say',
    core_problem: str(source.core_problem),
    core_solution: str(source.core_solution),
    key_features: features,
    value_prop_in_one_line: str(source.value_prop_in_one_line) || str(source.tagline),

    pricing_model: str(source.pricing_model) || undefined,
    price_anchors: strList(source.price_anchors, 6),

    social_proof: socialProof,

    brand: {
      primary_colors: strList(brandRaw.primary_colors, 6),
      accent_colors: strList(brandRaw.accent_colors, 6),
      background_color: str(brandRaw.background_color) || '#05060A',
      text_color: str(brandRaw.text_color) || '#F3F6FB',
      logo_handle: handles.indexOf(logoHandle) >= 0 ? logoHandle : undefined,
      typography_feel: str(brandRaw.typography_feel),
      visual_style: str(brandRaw.visual_style),
      design_maturity: oneOf<DesignMaturity>(brandRaw.design_maturity, DESIGN_MATURITIES, 'functional'),
    },
    assets,

    best_hook_asset: handles.indexOf(bestHook) >= 0 ? bestHook : handles[0],
    ui_richness: oneOf<'high' | 'medium' | 'low'>(source.ui_richness, ['high', 'medium', 'low'], 'low'),
    ui_richness_rationale: str(source.ui_richness_rationale),
    extraction_confidence: clamp01(source.extraction_confidence, pages[0]?.ok ? 0.6 : 0.25),
    extraction_gaps: strList(source.extraction_gaps, 10),
    manufacture_required: strList(source.manufacture_required, 10),
  };
}

export interface ExtractOptions {
  onProgress?: (detail: string) => void;
  signal?: AbortSignal;
}

/**
 * Read the URL and build the brief. Throws only when the page could not be
 * read AND the model could not be reached — a partially readable site still
 * produces a ProductContext, with the holes named in extraction_gaps.
 */
export async function extractProductContext(
  url: string,
  options: ExtractOptions = {},
): Promise<ProductContext> {
  const target = normalizeUrl(url);
  if (!target) throw new Error('Enter a product URL to start.');
  const report = options.onProgress || (() => undefined);

  report('Reading the homepage…');
  const home = await scrapePage(target);
  const pages: ScrapeResult[] = [home];

  if (home.ok) {
    // Subpages are read one at a time on purpose: each is a headless-browser
    // crawl, and four in parallel is how a run gets itself rate-limited.
    for (const path of CANDIDATE_PATHS) {
      if (pages.length >= MAX_PAGES) break;
      const candidate = pageUrl(target, path);
      if (!candidate || candidate === home.url) continue;
      report('Reading ' + path + '…');
      const page = await scrapePage(candidate);
      if (page.ok && (page.headlines.length || page.text.length > 400)) pages.push(page);
    }
  }

  const captured = captureAssets(pages);
  report(
    String(pages.filter((page) => page.ok).length) + ' page(s) read, '
    + String(captured.length) + ' asset(s) captured — Opus is writing the brief…',
  );

  if (!home.ok && !captured.length) {
    throw new Error(
      'That URL could not be read — the page did not answer and no screenshot could be taken. '
      + 'Check the address and try again.',
    );
  }

  const context = normalizeContext(
    await callModelForJson<Record<string, unknown>>(
      buildEvidence(target, pages, captured),
      { system: EXTRACTION_SYSTEM_PROMPT, model: OPUS_MODEL, maxTokens: 8192, signal: options.signal },
    ),
    target,
    pages,
    captured,
  );

  // Every later step resolves handles through the registry, so it is built the
  // moment the context exists rather than at render time.
  buildAssetRegistry(context);
  return context;
}
