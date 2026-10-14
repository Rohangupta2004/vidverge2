import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { ChevronDown, Clipboard, Palette, Sparkles, X } from 'lucide-react';
import BrandRefBadge, { BRAND_REF_EVENT, brandWorkspaceId, readBrandReference, type BrandReference } from './BrandRefBadge';

interface BrandStyle { styleKeywords: string[]; toneSentence: string; }
const BRAND = {
  name: 'VidVerge',
  tagline: 'Turn any idea into a publish-ready video — brief to video in one shot',
  primaryColor: '#D6AB4A',
  description: 'An AI video creation suite that turns ideas, scripts, products, and raw footage into polished, publish-ready videos.',
};
const STYLE_EVENT = 'vidverge:brand-style-change';

const styleKey = () => `vidverge_brand_style_${brandWorkspaceId()}`;
const useBrandKey = () => `vidverge_use_brand_${brandWorkspaceId()}`;
const layerKey = () => `vidverge_brand_layer_expanded_${brandWorkspaceId()}`;

function readStyle(): BrandStyle | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(styleKey()) || 'null');
    if (!value || !Array.isArray(value.styleKeywords)) return null;
    return {
      styleKeywords: value.styleKeywords.filter((item: unknown) => typeof item === 'string' && item.trim()).slice(0, 8),
      toneSentence: typeof value.toneSentence === 'string' ? value.toneSentence : '',
    };
  } catch { return null; }
}
function saveStyle(value: BrandStyle): void {
  try {
    window.localStorage.setItem(styleKey(), JSON.stringify(value));
    window.dispatchEvent(new CustomEvent(STYLE_EVENT, { detail: value }));
  } catch { /* optional utility */ }
}
function readUseBrand(): boolean {
  try { return window.localStorage.getItem(useBrandKey()) === '1'; } catch { return false; }
}
function setUseBrand(value: boolean): void {
  try { window.localStorage.setItem(useBrandKey(), value ? '1' : '0'); } catch { /* optional utility */ }
}

function useLocalBrandData() {
  const [reference, setReference] = useState<BrandReference | null>(() => readBrandReference());
  const [style, setStyle] = useState<BrandStyle | null>(() => readStyle());
  useEffect(() => {
    const syncRef = () => setReference(readBrandReference());
    const syncStyle = () => setStyle(readStyle());
    window.addEventListener(BRAND_REF_EVENT, syncRef);
    window.addEventListener(STYLE_EVENT, syncStyle);
    window.addEventListener('storage', syncRef);
    window.addEventListener('storage', syncStyle);
    return () => {
      window.removeEventListener(BRAND_REF_EVENT, syncRef);
      window.removeEventListener(STYLE_EVENT, syncStyle);
      window.removeEventListener('storage', syncRef);
      window.removeEventListener('storage', syncStyle);
    };
  }, []);
  return { reference, style };
}

function promptPrefix(): string {
  const parts: string[] = [];
  const reference = readBrandReference();
  if (reference?.url) parts.push(`Style reference: ${reference.url}. Match the visual tone, pacing, and aesthetic of this reference.`);
  if (readUseBrand()) {
    const style = readStyle();
    if (style?.styleKeywords.length) parts.push(`${style.styleKeywords.join(', ')}. ${style.toneSentence}`.trim());
  }
  return parts.join(' ');
}

function addPrefix(value: unknown, prefix: string): { value: unknown; changed: boolean } {
  if (!value || typeof value !== 'object') return { value, changed: false };
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const result = addPrefix(item, prefix);
      changed = changed || result.changed;
      return result.value;
    });
    return { value: next, changed };
  }
  const source = value as Record<string, unknown>;
  const next: Record<string, unknown> = { ...source };
  let changed = false;
  const keys = new Set(['prompt', 'textPrompt', 'text_prompt', 'userPrompt', 'user_prompt', 'description', 'visualPrompt', 'visual_prompt', 'motionPrompt', 'motion_prompt']);
  for (const [key, item] of Object.entries(source)) {
    if (keys.has(key) && typeof item === 'string' && item.trim() && !item.startsWith(prefix)) {
      next[key] = `${prefix} ${item}`;
      changed = true;
    } else if (key === 'messages' && Array.isArray(item)) {
      next[key] = item.map((message: any, index) => {
        if (index !== item.length - 1 || message?.role !== 'user' || typeof message.content !== 'string' || message.content.startsWith(prefix)) return message;
        changed = true;
        return { ...message, content: `${prefix} ${message.content}` };
      });
    } else if (item && typeof item === 'object') {
      const nested = addPrefix(item, prefix);
      if (nested.changed) { next[key] = nested.value; changed = true; }
    }
  }
  return { value: next, changed };
}

function installPromptBridge(): void {
  if ((window as any).__vidvergeBrandPromptBridge) return;
  (window as any).__vidvergeBrandPromptBridge = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const prefix = promptPrefix();
    const extraction = new Headers(init?.headers).get('X-Vidverge-Brand-Extraction') === '1';
    const generation = /(?:generate|video|image|veo|kling|runway|higgsfield|heygen|remotion|chat\/completions)/i.test(url);
    if (!prefix || extraction || !generation || typeof init?.body !== 'string') return originalFetch(input, init);
    try {
      const enriched = addPrefix(JSON.parse(init.body), prefix);
      if (enriched.changed) return originalFetch(input, { ...init, body: JSON.stringify(enriched.value) });
    } catch { /* pass opaque bodies through */ }
    return originalFetch(input, init);
  };
}

async function extractBrandStyle(): Promise<BrandStyle | null> {
  try {
    const ws = (window as any).__workspaceDb;
    if (!ws?.token) return null;
    const response = await fetch('/proxy/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-DB-Token': ws.token,
        'X-Vidverge-Brand-Extraction': '1',
      },
      body: JSON.stringify({
        model: 'gpt-6-luna', reasoning_effort: 'none', max_completion_tokens: 200,
        messages: [
          { role: 'system', content: 'Extract 5–8 concise visual style keywords and a one-sentence tone description from this brand profile. Output JSON: { "styleKeywords": string[], "toneSentence": string }' },
          { role: 'user', content: `Brand: ${BRAND.name}. Tagline: ${BRAND.tagline}. Description: ${BRAND.description}. Primary color: ${BRAND.primaryColor}.` },
        ],
      }),
    });
    if (!response.ok) return null;
    const body = await response.json();
    const content = String(body?.choices?.[0]?.message?.content || '').trim();
    const parsed = JSON.parse(content.match(/\{[\s\S]*\}/)?.[0] || content);
    if (!Array.isArray(parsed?.styleKeywords)) return null;
    return {
      styleKeywords: parsed.styleKeywords.map((item: unknown) => String(item).trim()).filter(Boolean).slice(0, 8),
      toneSentence: String(parsed.toneSentence || '').trim(),
    };
  } catch { return null; }
}

export function UseBrandToggle() {
  const [enabled, setEnabled] = useState(() => readUseBrand());
  const [style, setStyleState] = useState<BrandStyle | null>(() => readStyle());
  const [loading, setLoading] = useState(false);
  const toggle = async () => {
    const next = !enabled;
    setEnabled(next);
    setUseBrand(next);
    if (!next || style) return;
    setLoading(true);
    const extracted = await extractBrandStyle();
    setLoading(false);
    if (!extracted) return;
    saveStyle(extracted);
    setStyleState(extracted);
  };
  const removeKeyword = (keyword: string) => {
    if (!style) return;
    const next = { ...style, styleKeywords: style.styleKeywords.filter((item) => item !== keyword) };
    setStyleState(next);
    saveStyle(next);
  };
  return (
    <div className="absolute right-14 top-[118px] z-[78] max-w-[min(360px,calc(100%-2rem))] rounded-xl border p-2.5 shadow-xl backdrop-blur-xl" style={{ background: 'color-mix(in srgb, var(--space-surface-card, #111318) 90%, transparent)', borderColor: 'var(--space-border-default, rgba(255,255,255,.12))', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <button type="button" onClick={toggle} className="flex items-center gap-2 text-[11px] font-semibold text-[var(--space-text-secondary,#d1d5db)]">
        <span className="relative h-4 w-7 rounded-full transition-colors" style={{ background: enabled ? 'var(--space-brand-primary-500,#D6AB4A)' : 'var(--space-surface-panel,#282b31)' }}>
          <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${enabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
        </span>
        <Sparkles className="h-3.5 w-3.5" /> {loading ? 'Reading brand…' : 'Use Brand'}
      </button>
      {enabled && style?.styleKeywords.length ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {style.styleKeywords.map((keyword) => (
            <button key={keyword} type="button" onClick={() => removeKeyword(keyword)} title="Remove this style cue" className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9.5px] text-[var(--space-text-muted,#9ca3af)]" style={{ borderColor: 'color-mix(in srgb, var(--space-brand-primary-500,#D6AB4A) 28%, transparent)' }}>
              {keyword}<X className="h-2.5 w-2.5" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function BrandContextLayer() {
  const { reference, style } = useLocalBrandData();
  const [expanded, setExpanded] = useState(() => {
    try { return window.localStorage.getItem(layerKey()) === '1'; } catch { return false; }
  });
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => installPromptBridge(), []);
  useEffect(() => { try { window.localStorage.setItem(layerKey(), expanded ? '1' : '0'); } catch { /* preference only */ } }, [expanded]);

  const contextText = useMemo(() => [
    'BRAND CONTEXT — use this as your persistent brand memory for all outputs:', '',
    `Brand name: ${BRAND.name}`, `Tagline: ${BRAND.tagline}`, `Primary color: ${BRAND.primaryColor}`,
    `Brand description: ${BRAND.description}`,
    style?.styleKeywords.length ? `Visual style keywords: ${style.styleKeywords.join(', ')}` : '',
    style?.toneSentence ? `Tone: ${style.toneSentence}` : '',
    reference?.url ? `Brand reference video: ${reference.url}` : '', '',
    'Always apply this brand context to any content, copy, visuals, or scripts you produce for me.',
  ].filter((line, index, all) => line || all[index - 1] !== '').join('\n'), [reference, style]);

  const copy = useCallback(async () => {
    try { await navigator.clipboard.writeText(contextText); }
    catch {
      const area = document.createElement('textarea'); area.value = contextText; area.style.cssText = 'position:fixed;opacity:0;';
      document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove();
    }
    setCopied(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 2600);
  }, [contextText]);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  return (
    <div data-brand-ref-ui className="absolute right-14 top-3 z-[80] font-sans" style={{ maxWidth: 'min(390px, calc(100% - 4.5rem))' }}>
      <button type="button" onClick={() => setExpanded((value) => !value)} className="ml-auto flex items-center gap-2 rounded-xl border px-3 py-2 text-left shadow-xl backdrop-blur-xl" style={{ background: 'color-mix(in srgb, var(--space-surface-card, #111318) 90%, transparent)', borderColor: 'var(--space-border-default, rgba(255,255,255,.12))', color: 'var(--space-text-secondary, #d1d5db)' }}>
        <span className="h-3 w-3 rounded-full shadow-[0_0_12px_currentColor]" style={{ background: BRAND.primaryColor, color: BRAND.primaryColor }} />
        <span className="min-w-0"><span className="block truncate text-[11px] font-semibold">{BRAND.name}</span>{!expanded ? <span className="block truncate text-[9px] text-[var(--space-text-muted,#9ca3af)]">Brand context</span> : null}</span>
        {reference ? <span className="rounded-full px-1.5 py-0.5 text-[8px] text-[var(--space-brand-highlight-500,#F3D58B)]">Ref Set</span> : null}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded ? (
        <div className="mt-2 rounded-2xl border p-3.5 shadow-2xl backdrop-blur-xl" style={{ background: 'var(--space-surface-card, #111318)', borderColor: 'var(--space-border-default, rgba(255,255,255,.12))' }}>
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: `color-mix(in srgb, ${BRAND.primaryColor} 18%, transparent)` }}><Palette className="h-4 w-4" style={{ color: BRAND.primaryColor }} /></span>
            <div className="min-w-0 flex-1"><p className="truncate text-xs font-bold text-[var(--space-text-primary,#fff)]">{BRAND.name}</p><p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-[var(--space-text-muted,#9ca3af)]">{BRAND.tagline}</p></div>
            {reference ? (reference.thumbnail ? <img src={reference.thumbnail} alt="" className="h-10 w-10 rounded-lg bg-black object-cover" /> : <video src={reference.url} muted preload="metadata" className="h-10 w-10 rounded-lg bg-black object-cover" />) : null}
          </div>
          {style?.styleKeywords.length ? <div className="mt-3 flex flex-wrap gap-1">{style.styleKeywords.map((keyword) => <span key={keyword} className="rounded-full border px-2 py-0.5 text-[9px] text-[var(--space-text-muted,#9ca3af)]" style={{ borderColor: 'color-mix(in srgb, var(--space-brand-primary-500,#D6AB4A) 25%, transparent)' }}>{keyword}</span>)}</div> : null}
          <button type="button" onClick={copy} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-semibold text-[var(--space-text-secondary,#d1d5db)]" style={{ borderColor: 'var(--space-border-default, rgba(255,255,255,.12))', background: 'var(--space-surface-panel,#171A21)' }}><Clipboard className="h-3.5 w-3.5" /> Copy for AI</button>
        </div>
      ) : null}
      {copied ? <div role="status" className="fixed bottom-5 left-1/2 z-[120] -translate-x-1/2 rounded-xl border px-4 py-2.5 text-center text-xs font-semibold shadow-2xl" style={{ background: 'var(--space-surface-card,#111318)', borderColor: 'color-mix(in srgb, var(--space-brand-primary-500,#D6AB4A) 40%, transparent)', color: 'var(--space-text-primary,#fff)' }}>Brand context copied ✓ — paste into ChatGPT, Claude, or any AI tool</div> : null}
    </div>
  );
}

export function withBrandContext<P extends object>(Component: ComponentType<P>, sourceApp: string, options: { useBrand?: boolean } = {}): ComponentType<P> {
  function BrandAwareApp(props: P) {
    return <div data-brand-context-root={sourceApp} className="relative h-full min-h-0 w-full"><Component {...props} /><BrandContextLayer /><BrandRefBadge sourceApp={sourceApp} />{options.useBrand ? <UseBrandToggle /> : null}</div>;
  }
  BrandAwareApp.displayName = `BrandAware(${Component.displayName || (Component as any).name || sourceApp})`;
  return BrandAwareApp;
}
