import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Trash2, X } from 'lucide-react';

export interface BrandReference {
  url: string;
  thumbnail: string;
  title: string;
  savedAt: string;
  sourceApp: string;
}

export const BRAND_REF_EVENT = 'vidverge:brand-ref-change';

export function brandWorkspaceId(): string {
  if (typeof window === 'undefined') return 'default';
  return String((window as any).__workspaceDb?.workspaceId || 'default');
}

export function brandReferenceKey(): string {
  return `vidverge_brand_ref_${brandWorkspaceId()}`;
}

export function readBrandReference(): BrandReference | null {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(brandReferenceKey()) || 'null');
    return parsed && typeof parsed.url === 'string' && parsed.url ? parsed as BrandReference : null;
  } catch {
    return null;
  }
}

export function saveBrandReference(reference: BrandReference): void {
  try {
    window.localStorage.setItem(brandReferenceKey(), JSON.stringify(reference));
    window.dispatchEvent(new CustomEvent(BRAND_REF_EVENT, { detail: reference }));
  } catch {
    // Brand context is optional; private browsing must never block creation.
  }
}

export function removeBrandReference(): void {
  try {
    window.localStorage.removeItem(brandReferenceKey());
    window.dispatchEvent(new CustomEvent(BRAND_REF_EVENT, { detail: null }));
  } catch {
    // Optional local utility only.
  }
}

function useBrandReference(): BrandReference | null {
  const [reference, setReference] = useState<BrandReference | null>(() => readBrandReference());
  useEffect(() => {
    const sync = () => setReference(readBrandReference());
    window.addEventListener(BRAND_REF_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(BRAND_REF_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return reference;
}

function videoTitle(video: HTMLVideoElement, sourceApp: string): string {
  const labelled = video.getAttribute('aria-label') || video.getAttribute('title');
  if (labelled) return labelled;
  const card = video.closest('article, section, [role="article"], [data-video-result]');
  const heading = card?.querySelector('h1, h2, h3, [data-video-title]')?.textContent?.trim();
  return heading || `${sourceApp} video`;
}

function usableVideoUrl(video: HTMLVideoElement): string {
  const sourceUrl = video.querySelector('source')?.getAttribute('src') || '';
  const url = String(video.currentSrc || video.src || sourceUrl).trim();
  return /^(https?:)?\/\//i.test(url) ? url : '';
}

function styleAction(button: HTMLButtonElement): void {
  Object.assign(button.style, {
    display: 'inline-flex', alignItems: 'center', gap: '6px', marginTop: '8px',
    padding: '6px 10px', borderRadius: '9px', cursor: 'pointer', fontSize: '11px',
    fontWeight: '650', fontFamily: 'Inter, system-ui, sans-serif', transition: 'all 160ms ease',
  });
}

/** Adds a lightweight action directly beneath every durable generated video. */
function mountVideoActions(root: HTMLElement, sourceApp: string): () => void {
  let disposed = false;
  const scan = () => {
    if (disposed) return;
    root.querySelectorAll('video').forEach((node) => {
      const video = node as HTMLVideoElement;
      if (video.closest('[data-brand-ref-ui]')) return;
      const url = usableVideoUrl(video);
      if (!url || video.nextElementSibling?.hasAttribute('data-brand-ref-action')) return;

      const row = document.createElement('div');
      row.setAttribute('data-brand-ref-action', sourceApp);
      row.style.cssText = 'display:flex;align-items:center;min-height:28px;';
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', 'Save this video as the workspace brand reference');
      styleAction(button);

      const sync = () => {
        const active = readBrandReference()?.url === url;
        button.textContent = active ? '✓ Brand Ref Set' : '🔖 Save as Brand Ref';
        button.style.color = active ? 'var(--space-text-muted, #9ca3af)' : 'var(--space-text-secondary, #d1d5db)';
        button.style.background = active
          ? 'color-mix(in srgb, var(--space-brand-primary-500, #D6AB4A) 9%, transparent)'
          : 'color-mix(in srgb, var(--space-surface-panel, #171A21) 86%, transparent)';
        button.style.border = `1px solid ${active ? 'color-mix(in srgb, var(--space-brand-primary-500, #D6AB4A) 28%, transparent)' : 'var(--space-border-default, rgba(255,255,255,.12))'}`;
      };
      sync();
      button.onclick = () => {
        saveBrandReference({
          url,
          thumbnail: video.poster || '',
          title: videoTitle(video, sourceApp),
          savedAt: new Date().toISOString(),
          sourceApp,
        });
        sync();
      };
      row.appendChild(button);
      video.insertAdjacentElement('afterend', row);
    });
  };

  scan();
  const observer = new MutationObserver(scan);
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'poster'] });
  const onChange = () => scan();
  window.addEventListener(BRAND_REF_EVENT, onChange);
  return () => {
    disposed = true;
    observer.disconnect();
    window.removeEventListener(BRAND_REF_EVENT, onChange);
    root.querySelectorAll(`[data-brand-ref-action="${sourceApp}"]`).forEach((node) => node.remove());
  };
}

export default function BrandRefBadge({ sourceApp }: { sourceApp: string }) {
  const reference = useBrandReference();
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const root = document.querySelector(`[data-brand-context-root="${sourceApp}"]`) as HTMLElement | null;
    return root ? mountVideoActions(root, sourceApp) : undefined;
  }, [sourceApp]);

  useEffect(() => {
    const show = (event: Event) => {
      if (!(event as CustomEvent).detail) return;
      setToast(true);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setToast(false), 2200);
    };
    window.addEventListener(BRAND_REF_EVENT, show);
    return () => {
      window.removeEventListener(BRAND_REF_EVENT, show);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  const remove = useCallback(() => {
    removeBrandReference();
    setOpen(false);
  }, []);

  return (
    <>
      {reference ? (
        <div data-brand-ref-ui style={{ position: 'absolute', zIndex: 82, right: 14, top: 62, fontFamily: 'Inter, system-ui, sans-serif' }}>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="inline-flex items-center gap-2 rounded-xl border px-2 py-1.5 text-left shadow-lg backdrop-blur-xl"
            style={{
              background: 'color-mix(in srgb, var(--space-surface-card, #111318) 90%, transparent)',
              borderColor: 'var(--space-border-default, rgba(255,255,255,.12))',
              color: 'var(--space-text-muted, #9ca3af)',
            }}
          >
            {reference.thumbnail ? (
              <img src={reference.thumbnail} alt="" className="h-10 w-10 rounded-lg object-cover" />
            ) : (
              <video src={reference.url} muted preload="metadata" className="h-10 w-10 rounded-lg bg-black object-cover" />
            )}
            <span className="flex flex-col pr-1">
              <span className="text-[10px] font-medium uppercase tracking-[0.08em]">Brand Ref</span>
              <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-[var(--space-brand-highlight-500,#F3D58B)]"><Check className="h-3 w-3" /> Set</span>
            </span>
          </button>

          {open ? (
            <div
              className="absolute right-0 mt-2 w-64 rounded-2xl border p-3 shadow-2xl backdrop-blur-xl"
              style={{ background: 'var(--space-surface-card, #111318)', borderColor: 'var(--space-border-default, rgba(255,255,255,.12))' }}
            >
              <button type="button" onClick={() => setOpen(false)} className="absolute right-2 top-2 rounded-md p-1 text-[var(--space-text-muted,#9ca3af)]"><X className="h-3.5 w-3.5" /></button>
              {reference.thumbnail ? (
                <img src={reference.thumbnail} alt="Brand reference" className="mb-3 aspect-video w-full rounded-xl bg-black object-cover" />
              ) : (
                <video src={reference.url} muted controls preload="metadata" className="mb-3 aspect-video w-full rounded-xl bg-black object-cover" />
              )}
              <p className="truncate pr-5 text-xs font-semibold text-[var(--space-text-primary,#fff)]">{reference.title}</p>
              <p className="mt-1 text-[10px] text-[var(--space-text-muted,#9ca3af)]">
                Saved {new Date(reference.savedAt).toLocaleString()} · {reference.sourceApp}
              </p>
              <button type="button" onClick={remove} className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-[var(--space-semantic-danger-500,#f87171)]">
                <Trash2 className="h-3 w-3" /> Remove
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {toast ? (
        <div
          role="status"
          className="fixed bottom-5 left-1/2 z-[120] -translate-x-1/2 rounded-xl border px-4 py-2.5 text-xs font-semibold shadow-2xl backdrop-blur-xl"
          style={{
            background: 'var(--space-surface-card, #111318)',
            borderColor: 'color-mix(in srgb, var(--space-brand-primary-500, #D6AB4A) 40%, transparent)',
            color: 'var(--space-text-primary, #fff)',
          }}
        >
          Saved as Brand Reference ✓
        </div>
      ) : null}
    </>
  );
}
