// Brand locking: import the kit from the customer's website, then register the
// words the presenter has to pronounce correctly.
//
// Both ids, once set, ride on EVERY generation call for the rest of the
// session (lib/heygenSession). That is the whole value of this panel, so the
// locked state is shown as a badge rather than left implicit in a form field.
import { useEffect, useState } from 'react';
import { Globe, Palette, SpellCheck } from 'lucide-react';
import { createGlossary, importBrandKit, listBrandKits, parseTerms } from '../../lib/heygenBrand';
import { describeError } from '../../lib/heygenApi';
import { setBrandKit, setGlossary, useHeyGenSession, type BrandKitSummary } from '../../lib/heygenSession';
import { Button, CapabilityNote, Field, LockBadge, Notice, Panel, Working } from './ui';

function Swatch({ color, label }: { color: string; label: string }) {
  if (!color) return null;
  return <span className="inline-flex items-center gap-2 rounded-lg border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] px-2.5 py-1.5 text-xs">
    <span className="h-4 w-4 rounded border border-[color-mix(in_srgb,#ffffff_18%,transparent)]" style={{ background: color }} />
    <span className="font-medium text-[var(--space-text-secondary)]">{label}</span>
    <code className="text-[11px] text-[var(--space-text-muted)]">{color}</code>
  </span>;
}

function BrandCard({ kit }: { kit: BrandKitSummary }) {
  return <div className="rounded-xl border border-[color-mix(in_srgb,#8b5cf6_34%,transparent)] bg-[color-mix(in_srgb,#8b5cf6_8%,transparent)] p-4">
    <div className="flex flex-wrap items-center gap-3">
      {kit.logoUrl
        ? <img src={kit.logoUrl} alt="" className="h-10 w-10 rounded-lg bg-white/90 object-contain p-1" />
        : <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--space-surface-muted)]"><Palette className="h-4 w-4 text-[var(--space-text-muted)]" /></span>}
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold text-[var(--space-text-primary)]">{kit.name}</div>
        <div className="truncate text-xs text-[var(--space-text-muted)]">{kit.websiteUrl}</div>
      </div>
    </div>
    <div className="mt-3 flex flex-wrap gap-2">
      <Swatch color={kit.primaryColor} label="Primary" />
      <Swatch color={kit.secondaryColor} label="Accent" />
      {kit.fonts.slice(0, 2).map((font) => <span key={font} className="inline-flex items-center rounded-lg border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] px-2.5 py-1.5 text-xs text-[var(--space-text-secondary)]">
        {font}
      </span>)}
    </div>
    {!kit.primaryColor && !kit.logoUrl
      ? <p className="mt-3 text-xs leading-relaxed text-[var(--space-text-muted)]">
        HeyGen imported this brand but did not report colours or a logo for it. The kit is still locked to your videos.
      </p>
      : null}
  </div>;
}

export default function BrandPanel({ step }: { step: number }) {
  const session = useHeyGenSession();
  const [url, setUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<BrandKitSummary[]>([]);
  const [terms, setTerms] = useState('');
  const [glossaryBusy, setGlossaryBusy] = useState(false);
  const [glossaryError, setGlossaryError] = useState('');

  // Previously imported kits are offered so a returning customer does not pay
  // for a second crawl of the same site. A plan without a kit library simply
  // returns nothing here, which is why the failure is swallowed.
  useEffect(() => {
    let cancelled = false;
    listBrandKits()
      .then((kits) => { if (!cancelled) setSaved(kits); })
      .catch(() => { /* no kit library on this plan — the import field still works */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (session.glossaryTerms.length && !terms) setTerms(session.glossaryTerms.join(', '));
  }, [session.glossaryTerms, terms]);

  async function runImport() {
    if (importing || !url.trim()) return;
    setImporting(true);
    setError('');
    try {
      const kit = await importBrandKit(url);
      setBrandKit(kit);
      setSaved((current) => [kit, ...current.filter((entry) => entry.id !== kit.id)]);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setImporting(false);
    }
  }

  async function runGlossary() {
    if (glossaryBusy) return;
    setGlossaryBusy(true);
    setGlossaryError('');
    try {
      const result = await createGlossary(terms);
      setGlossary(result.id, result.terms);
    } catch (e) {
      setGlossaryError(describeError(e));
    } finally {
      setGlossaryBusy(false);
    }
  }

  const parsed = parseTerms(terms);
  const glossaryChanged = parsed.join('|').toLowerCase() !== session.glossaryTerms.join('|').toLowerCase();

  return <>
    <Panel
      step={step}
      done={Boolean(session.brandKitId)}
      title="Lock your brand"
      hint="Paste your site and HeyGen reads your colours, fonts and logo, then applies them to every scene it generates."
      action={session.brandKitId ? <LockBadge text="Brand locked" onChange={() => setBrandKit(null)} /> : undefined}
    >
      <CapabilityNote capability="brand-kits" label="Brand Kit import">
        Your videos will still use the brand colours set in SceneForge&rsquo;s own editor — only HeyGen&rsquo;s automatic
        import from your website is unavailable.
      </CapabilityNote>

      {session.brandKit ? <div className="space-y-3">
        <BrandCard kit={session.brandKit} />
      </div> : <div className="space-y-3">
        <Field label="Your product or website URL" hint="For example acme.com — HeyGen crawls it to find your brand.">
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Globe className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--space-text-muted)]" />
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') void runImport(); }}
                placeholder="acme.com"
                className="st-field pl-9"
                inputMode="url"
                autoComplete="url"
              />
            </div>
            <Button onClick={runImport} busy={importing} disabled={!url.trim()}>
              {importing ? 'Reading your site' : 'Import brand'}
            </Button>
          </div>
        </Field>

        {error ? <Notice tone="error" title="The brand could not be imported">{error}</Notice> : null}

        {saved.length ? <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--space-text-muted)]">Brands you have imported before</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {saved.map((kit) => <button
              key={kit.id}
              type="button"
              onClick={() => setBrandKit(kit)}
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] px-3 py-2 text-xs font-medium text-[var(--space-text-secondary)] hover:border-[var(--space-border-strong)]"
            >
              {kit.primaryColor ? <span className="h-3.5 w-3.5 rounded-full" style={{ background: kit.primaryColor }} /> : null}
              {kit.name}
            </button>)}
          </div>
        </div> : null}
      </div>}
    </Panel>

    <Panel
      step={step + 1}
      done={Boolean(session.brandGlossaryId)}
      title="Teach it your product names"
      hint="Names, acronyms and surnames an AI voice usually gets wrong. Every scene then says them the same way."
      action={session.brandGlossaryId && !glossaryChanged
        ? <LockBadge text={`${session.glossaryTerms.length} term${session.glossaryTerms.length === 1 ? '' : 's'} locked`} onChange={() => { setGlossary('', []); setTerms(''); }} />
        : undefined}
    >
      <CapabilityNote capability="brand-glossaries" label="Brand Glossary" />

      <div className="space-y-3">
        <Field label="Product names to pronounce correctly" hint="Separate them with commas — for example: SceneForge, Vidverge, Nair">
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-[200px] flex-1">
              <SpellCheck className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--space-text-muted)]" />
              <input
                value={terms}
                onChange={(event) => setTerms(event.target.value)}
                placeholder="SceneForge, Vidverge"
                className="st-field pl-9"
              />
            </div>
            <Button onClick={runGlossary} busy={glossaryBusy} disabled={!parsed.length || !glossaryChanged}>
              {session.brandGlossaryId ? 'Update glossary' : 'Save glossary'}
            </Button>
          </div>
        </Field>

        {parsed.length ? <div className="flex flex-wrap gap-1.5">
          {parsed.map((term) => <span key={term} className="rounded-full bg-[color-mix(in_srgb,#6366f1_14%,transparent)] px-2.5 py-1 text-xs font-medium text-[var(--space-text-secondary)]">
            {term}
          </span>)}
        </div> : null}

        {glossaryBusy ? <Working text="Registering your terms with HeyGen" /> : null}
        {glossaryError ? <Notice tone="error" title="The glossary could not be saved">{glossaryError}</Notice> : null}
      </div>
    </Panel>
  </>;
}
