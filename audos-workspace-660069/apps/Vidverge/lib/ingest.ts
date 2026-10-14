/**
 * ASSET INGESTION — read a real brand off a real URL.
 *
 * Runs the Apify `web-scraper` actor through the platform proxy
 * (`POST /api/apify/run`) and pulls back the three things the motion engine
 * needs to look like the customer's product rather than a template: the
 * palette actually used on the page, the logo, and the words above the fold.
 *
 * `parseWithGPT` is switched OFF. The default is on, which would spend a
 * language-model pass re-describing a payload this page function has already
 * returned as clean structured JSON.
 *
 * DEGRADING IS ALLOWED, PRETENDING IS NOT. If the scrape cannot run — no Apify
 * token on the platform, a site that blocks automation, a timeout — the run
 * continues on the space's own palette and the result is flagged `degraded`
 * with the reason. The UI shows that notice, because a palette invented for a
 * customer and presented as theirs is worse than saying it could not be read.
 */

import type { BrandKit } from '../types';
import { authHeaders, describePlatformError, isAbortError, timeoutSignal } from './runtime';

/** Apify counts this in minutes. Two is already past the pipeline's target
 * latency, so a slower site degrades rather than holding the whole run. */
const SCRAPE_TIMEOUT_MINUTES = 2;

/** The fetch's own abort: the scrape may legitimately run the full two
 * minutes server-side, so the network deadline sits just past it — it only
 * fires when the connection itself hangs. */
const SCRAPE_FETCH_TIMEOUT_MS = SCRAPE_TIMEOUT_MINUTES * 60_000 + 30_000;

/** The space's own brand, used when the target's cannot be read. */
const FALLBACK_COLORS = ['#D4920A', '#F0B429', '#0D0B05'];

const PAGE_FUNCTION = `async function pageFunction(context) {
  const { window } = context;
  const doc = window.document;
  const text = (selector) => {
    const node = doc.querySelector(selector);
    return node ? String(node.textContent || '').trim().slice(0, 240) : '';
  };
  const attr = (selector, name) => {
    const node = doc.querySelector(selector);
    return node ? String(node.getAttribute(name) || '').trim() : '';
  };
  const toHex = (value) => {
    const match = String(value || '').match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/);
    if (!match) return '';
    if (match[4] !== undefined && Number(match[4]) < 0.25) return '';
    const hex = [match[1], match[2], match[3]]
      .map((part) => Number(part).toString(16).padStart(2, '0'))
      .join('');
    return '#' + hex;
  };
  const tally = {};
  const nodes = Array.prototype.slice.call(doc.querySelectorAll('body *'), 0, 1200);
  nodes.forEach((node) => {
    const style = window.getComputedStyle(node);
    [style.backgroundColor, style.color, style.borderTopColor].forEach((raw) => {
      const hex = toHex(raw);
      if (!hex) return;
      tally[hex] = (tally[hex] || 0) + 1;
    });
  });
  const colors = Object.keys(tally)
    .sort((a, b) => tally[b] - tally[a])
    .slice(0, 8);
  const logoNode =
    doc.querySelector('header img[src*="logo" i]') ||
    doc.querySelector('img[alt*="logo" i]') ||
    doc.querySelector('header img');
  const svgNode = doc.querySelector('header svg') || doc.querySelector('a[href="/"] svg');
  return {
    url: context.request.url,
    siteName: attr('meta[property="og:site_name"]', 'content') || String(doc.title || '').slice(0, 120),
    headline: text('h1') || attr('meta[property="og:title"]', 'content'),
    subheadline: text('h2') || attr('meta[name="description"]', 'content'),
    colors: colors,
    logoUrl: logoNode ? String(logoNode.src || '') : '',
    logoSvg: svgNode ? String(svgNode.outerHTML || '').slice(0, 6000) : '',
    captureUrl: attr('meta[property="og:image"]', 'content'),
  };
}`;

function normaliseUrl(input: string): string {
  const raw = String(input || '').trim();
  if (!raw) return '';
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Only usable brand colors: drop near-white and near-black, keep order. */
function usefulColors(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const entry of list) {
    const hex = String(entry || '').toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(hex) || seen.has(hex)) continue;
    seen.add(hex);
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const luminance = (r * 299 + g * 587 + b * 114) / 1000;
    const saturation = Math.max(r, g, b) - Math.min(r, g, b);
    if (luminance > 238 || luminance < 14) continue;
    if (saturation < 18 && kept.length >= 2) continue;
    kept.push(hex);
    if (kept.length >= 5) break;
  }
  return kept;
}

function fallbackKit(url: string, reason: string): BrandKit {
  const host = hostnameOf(url) || 'your product';
  return {
    url,
    siteName: host,
    colors: FALLBACK_COLORS,
    logoUrl: null,
    logoSvg: null,
    captureUrl: null,
    headline: host,
    subheadline: '',
    degraded: true,
    degradedReason: reason,
  };
}

/**
 * Read the brand behind a URL. Never throws: an unreadable site comes back as
 * a degraded kit so the rest of the pipeline can still run.
 */
export async function ingestBrand(targetUrl: string): Promise<BrandKit> {
  const url = normaliseUrl(targetUrl);
  if (!url) return fallbackKit(targetUrl, 'No URL was given to read.');

  let response: Response;
  try {
    response = await fetch('/api/apify/run', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        actorId: 'apify/web-scraper',
        timeout: SCRAPE_TIMEOUT_MINUTES,
        parseWithGPT: false,
        input: {
          runMode: 'PRODUCTION',
          startUrls: [{ url }],
          maxRequestsPerCrawl: 1,
          maxPagesPerCrawl: 1,
          pageFunction: PAGE_FUNCTION,
          proxyConfiguration: { useApifyProxy: true },
        },
      }),
      signal: timeoutSignal(SCRAPE_FETCH_TIMEOUT_MS),
    });
  } catch (error: any) {
    return fallbackKit(
      url,
      isAbortError(error)
        ? 'The site read timed out, so the reel runs on the VidVerge palette instead.'
        : `The scraper could not be reached (${String(error?.message || error)}).`,
    );
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    return fallbackKit(url, describePlatformError(data, response.status, 'The site could not be read'));
  }
  if (String(data?.status || '') === 'failed') {
    return fallbackKit(url, 'The scraper could not open that page — it may block automated visits.');
  }

  const first = Array.isArray(data?.results) ? data.results[0] : null;
  if (!first) return fallbackKit(url, 'The scraper returned nothing for that page.');

  const colors = usefulColors(first.colors);
  return {
    url,
    siteName: String(first.siteName || hostnameOf(url)).slice(0, 120),
    colors: colors.length >= 2 ? colors : [...colors, ...FALLBACK_COLORS].slice(0, 3),
    logoUrl: first.logoUrl ? String(first.logoUrl) : null,
    logoSvg: first.logoSvg ? String(first.logoSvg) : null,
    captureUrl: first.captureUrl ? String(first.captureUrl) : null,
    headline: String(first.headline || '').slice(0, 240),
    subheadline: String(first.subheadline || '').slice(0, 240),
    degraded: colors.length < 2,
    degradedReason:
      colors.length < 2 ? 'The page did not expose enough brand colour to read.' : undefined,
  };
}
