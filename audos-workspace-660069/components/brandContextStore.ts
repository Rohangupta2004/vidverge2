import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSpaceRuntime } from '../SpaceRuntimeContext';
import { callHook } from '../lib/workspace';
import { brandToContextText, getDefaultBrand, parseBrandKitDocument, type BrandKitDocument } from './brandKitStore';

export const BRAND_CONTEXT_EVENT = 'vidverge:brand-context-change';

// A missing customer kit must never masquerade as Vidverge's own brand. The
// neutral starter makes the gap explicit and contains no platform pricing.
export const DEFAULT_BRAND_NAME = 'Add your brand';
export const DEFAULT_BRAND_TAGLINE = 'Set your customer brand before generating';
export const DEFAULT_BRAND_CONTEXT = `You are helping me create content for my brand. Complete this profile before generating:

Brand Name:
Logo:
Colors:
Fonts:
Tone:
Audience:
Products:
Voice ID:
Competitors:
Call to action:
Languages:
Words to avoid:

Use only the customer details entered above. Do not substitute Vidverge's brand, product claims, or pricing.`;

export type BrandContextSaveLocation = 'database' | 'device';

interface BrandContextRow {
  id: number;
  context_text: string;
  owner_key: string | null;
  created_at: string;
}

interface BrandContextEventDetail {
  ownerKey: string;
  text: string;
}

let activeBrandContext = DEFAULT_BRAND_CONTEXT;

function cacheKey(ownerKey: string): string {
  return `vidverge_brand_context_${ownerKey}`;
}

function readCached(ownerKey: string): string | null {
  try {
    const value = window.localStorage.getItem(cacheKey(ownerKey));
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
}

function broadcast(ownerKey: string, text: string): void {
  activeBrandContext = text;
  try {
    window.localStorage.setItem(cacheKey(ownerKey), text);
  } catch {
    // WorkspaceDB remains the durable store when browser storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent<BrandContextEventDetail>(BRAND_CONTEXT_EVENT, {
    detail: { ownerKey, text },
  }));
}

export function readActiveBrandContext(): string {
  return activeBrandContext;
}

export function getBrandContextIdentity(text: string): { name: string; tagline: string } {
  const name = text.match(/^Brand Name:\s*(.+)$/im)?.[1]?.trim() || DEFAULT_BRAND_NAME;
  const tagline = text.match(/^Tagline:\s*(.+)$/im)?.[1]?.trim() || DEFAULT_BRAND_TAGLINE;
  return { name, tagline };
}

export function useBrandContext() {
  const { sessionId, subscription, subscriptionReady } = useSpaceRuntime();
  const ownerKey = subscriptionReady ? subscription?.contactId || sessionId || '' : '';
  const [text, setText] = useState(DEFAULT_BRAND_CONTEXT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);

  useEffect(() => {
    if (!ownerKey) {
      activeBrandContext = DEFAULT_BRAND_CONTEXT;
      setText(DEFAULT_BRAND_CONTEXT);
      setLoading(!subscriptionReady);
      return;
    }

    setLoading(true);
    const cached = readCached(ownerKey);
    if (cached) {
      activeBrandContext = cached;
      setText(cached);
    }

    let cancelled = false;
    async function load() {
      const db = (window as any).__workspaceDb;
      if (!db) {
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        try {
          const kitResult = await callHook<{ document: BrandKitDocument | null }>('brand-kit-store', { op: 'load' });
          const kit = parseBrandKitDocument(kitResult.document);
          const defaultBrand = kit ? getDefaultBrand(kit) : null;
          if (!cancelled && defaultBrand) {
            const structuredText = brandToContextText(defaultBrand);
            setText(structuredText);
            broadcast(ownerKey, structuredText);
            setStorageError(null);
            return;
          }
        } catch {
          // Legacy text and the local cache remain available if the structured store is unavailable.
        }
        const result = await db
          .from('brand_context_settings', { shared: true })
          .eq('owner_key', ownerKey)
          .orderBy('created_at', 'desc')
          .limit(1)
          .get();
        const row = result?.data?.[0] as BrandContextRow | undefined;
        if (!cancelled && row?.context_text?.trim()) {
          setText(row.context_text);
          broadcast(ownerKey, row.context_text);
        }
        if (!cancelled) setStorageError(null);
      } catch (error) {
        if (!cancelled) {
          setStorageError(error instanceof Error ? error.message : 'Could not load the saved brand context.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();

    const sync = (event: Event) => {
      const detail = (event as CustomEvent<BrandContextEventDetail>).detail;
      if (detail?.text && (detail.ownerKey === ownerKey || detail.ownerKey === sessionId)) setText(detail.text);
    };
    const syncStorage = (event: StorageEvent) => {
      if (event.key === cacheKey(ownerKey) && event.newValue?.trim()) {
        activeBrandContext = event.newValue;
        setText(event.newValue);
      }
    };
    window.addEventListener(BRAND_CONTEXT_EVENT, sync);
    window.addEventListener('storage', syncStorage);
    return () => {
      cancelled = true;
      window.removeEventListener(BRAND_CONTEXT_EVENT, sync);
      window.removeEventListener('storage', syncStorage);
    };
  }, [ownerKey, subscriptionReady]);

  const save = useCallback(async (nextText: string): Promise<BrandContextSaveLocation> => {
    const normalized = nextText.trim();
    if (!normalized) throw new Error('Brand context cannot be empty.');
    if (!ownerKey) throw new Error('Your session is still loading. Please try again.');

    setSaving(true);
    broadcast(ownerKey, normalized);
    setText(normalized);

    try {
      const db = (window as any).__workspaceDb;
      if (!db) throw new Error('Workspace storage is unavailable.');
      await db.from('brand_context_settings').insert({
        context_text: normalized,
        owner_key: ownerKey,
      });
      setStorageError(null);
      return 'database';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not sync this change across devices.';
      setStorageError(message);
      return 'device';
    } finally {
      setSaving(false);
    }
  }, [ownerKey]);

  return useMemo(() => ({ text, loading, saving, storageError, save }), [text, loading, saving, storageError, save]);
}
