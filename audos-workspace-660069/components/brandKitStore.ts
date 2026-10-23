import { useCallback, useEffect, useMemo, useState } from 'react';
import { callHook, getSessionId } from '../lib/workspace';

export type BrandPageStatus = 'read' | 'limited' | 'not found';
export interface BrandPage { url: string; label: string; status: BrandPageStatus; title?: string; note?: string; durationMs?: number; readableChars?: number }
export interface BrandImage { url: string; alt: string; sourceUrl: string }
export interface BrandRecord {
  id: string;
  websiteUrl: string;
  identity: { businessName: string; tagline: string };
  offer: { summary: string; features: string[]; benefits: string[]; pricing: string[]; offersCtas: string[] };
  audienceTone: { audience: string; tone: string };
  visuals: { logoUrl: string; colors: string[]; fonts: string[]; images: BrandImage[]; socialLinks: string[] };
  pages: BrandPage[];
  gaps: string[];
  sources: Record<string, string>;
  fetchedAt: string;
  confirmedAt: string;
  updatedAt: string;
  limited: boolean;
}
export interface BrandKitDocument {
  kind: 'vidverge-brand-kit';
  version: 1;
  defaultBrandId: string | null;
  brands: BrandRecord[];
  updatedAt: string;
}

const BRAND_KIT_EVENT = 'vidverge:brand-kit-change';
const BRAND_CONTEXT_EVENT = 'vidverge:brand-context-change';
let activeDocument: BrandKitDocument = emptyBrandKit();

export function emptyBrandKit(): BrandKitDocument {
  return { kind: 'vidverge-brand-kit', version: 1, defaultBrandId: null, brands: [], updatedAt: new Date(0).toISOString() };
}

function cacheKey(): string | null {
  const sessionId = getSessionId();
  return sessionId ? `vidverge_brand_kit_v1_${sessionId}` : null;
}
function readCache(): BrandKitDocument | null {
  try { const key = cacheKey(); return key ? parseBrandKitDocument(window.localStorage.getItem(key) || '') : null; } catch { return null; }
}
function cache(document: BrandKitDocument): void {
  activeDocument = document;
  try { const key = cacheKey(); if (key) window.localStorage.setItem(key, JSON.stringify(document)); } catch { /* authenticated server storage remains canonical */ }
}
function publish(document: BrandKitDocument): void {
  cache(document);
  window.dispatchEvent(new CustomEvent(BRAND_KIT_EVENT, { detail: document }));
  const active = getDefaultBrand(document);
  if (active) window.dispatchEvent(new CustomEvent(BRAND_CONTEXT_EVENT, { detail: { ownerKey: getSessionId(), text: brandToContextText(active) } }));
}

export function parseBrandKitDocument(value: unknown): BrandKitDocument | null {
  try {
    const parsed: any = typeof value === 'string' ? JSON.parse(value) : value;
    if (!parsed || parsed.kind !== 'vidverge-brand-kit' || parsed.version !== 1 || !Array.isArray(parsed.brands)) return null;
    return parsed as BrandKitDocument;
  } catch { return null; }
}
export function getDefaultBrand(document: BrandKitDocument): BrandRecord | null {
  return document.brands.find((brand) => brand.id === document.defaultBrandId) || document.brands[0] || null;
}
export function readActiveBrandKit(): BrandKitDocument { return activeDocument; }
export function normalizeBrandUrl(value: string): string {
  try {
    const withProtocol = /^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`;
    return new URL(withProtocol).hostname.replace(/^www\./, '').toLowerCase();
  } catch { return value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0]; }
}
export function matchSavedBrand(document: BrandKitDocument, value: string): BrandRecord | null {
  const query = value.trim().toLowerCase();
  if (!query) return getDefaultBrand(document);
  const host = normalizeBrandUrl(value);
  return document.brands.find((brand) => normalizeBrandUrl(brand.websiteUrl) === host)
    || document.brands.find((brand) => brand.identity.businessName.trim().toLowerCase() === query)
    || document.brands.find((brand) => Boolean(brand.identity.businessName.trim()) && query.includes(brand.identity.businessName.trim().toLowerCase()))
    || null;
}
export function brandToContextText(brand: BrandRecord): string {
  const lines = [
    `Brand Name: ${brand.identity.businessName}`,
    `Website: ${brand.websiteUrl}`,
    `Tagline: ${brand.identity.tagline}`,
    `What it offers: ${brand.offer.summary}`,
    `Features: ${brand.offer.features.join('; ')}`,
    `Benefits: ${brand.offer.benefits.join('; ')}`,
    `Audience: ${brand.audienceTone.audience}`,
    `Tone: ${brand.audienceTone.tone}`,
    `Pricing: ${brand.offer.pricing.join('; ')}`,
    `Offers / CTA: ${brand.offer.offersCtas.join('; ')}`,
    `Logo: ${brand.visuals.logoUrl}`,
    `Colors: ${brand.visuals.colors.join(', ')}`,
    `Fonts: ${brand.visuals.fonts.join(', ')}`,
  ];
  return lines.filter((line) => !/:\s*$/.test(line)).join('\n');
}
export function makeBrandRecord(input: Omit<BrandRecord, 'id' | 'confirmedAt' | 'updatedAt'> & { id?: string; confirmedAt?: string; updatedAt?: string }): BrandRecord {
  const timestamp = new Date().toISOString();
  return { ...input, id: input.id || `brand_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`, confirmedAt: input.confirmedAt || '', updatedAt: input.updatedAt || timestamp };
}

async function loadRemote(): Promise<BrandKitDocument | null> {
  const response = await callHook<{ ok: boolean; document: BrandKitDocument | null }>('brand-kit-store', { op: 'load' });
  return response.document ? parseBrandKitDocument(response.document) : null;
}
export async function fetchBrandFromWebsite(url: string): Promise<BrandRecord> {
  let lastMessage = 'The website could not be read.';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await callHook<any>('brand-kit-fetch', { url });
      if (response?.ok && response.brand) return makeBrandRecord(response.brand);
      lastMessage = String(response?.error || lastMessage);
    } catch (error) { lastMessage = error instanceof Error ? error.message : lastMessage; }
  }
  throw new Error(lastMessage);
}

export function useBrandKit() {
  const [document, setDocument] = useState<BrandKitDocument>(() => readCache() || emptyBrandKit());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    loadRemote().then((remote) => {
      if (cancelled) return;
      const next = remote || readCache() || emptyBrandKit();
      setDocument(next); publish(next); setError('');
    }).catch(() => {
      if (!cancelled) setError('Cloud sync is unavailable. Changes remain on this device until you retry.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    const sync = (event: Event) => {
      const next = (event as CustomEvent<BrandKitDocument>).detail;
      if (next?.kind === 'vidverge-brand-kit') setDocument(next);
    };
    window.addEventListener(BRAND_KIT_EVENT, sync);
    return () => { cancelled = true; window.removeEventListener(BRAND_KIT_EVENT, sync); };
  }, []);

  const save = useCallback(async (next: BrandKitDocument) => {
    const prepared = { ...next, updatedAt: new Date().toISOString() };
    setSaving(true); setDocument(prepared); publish(prepared);
    try {
      const response = await callHook<{ ok: boolean; document: BrandKitDocument }>('brand-kit-store', { op: 'save', document: prepared });
      const stored = parseBrandKitDocument(response.document) || prepared;
      setDocument(stored); publish(stored); setError('');
      return stored;
    } catch (caught) {
      setError('Cloud sync is unavailable. Changes remain on this device until you retry.');
      throw caught;
    } finally { setSaving(false); }
  }, []);

  return useMemo(() => ({ document, loading, saving, error, save }), [document, loading, saving, error, save]);
}
