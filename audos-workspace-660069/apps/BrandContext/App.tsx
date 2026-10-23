import React from 'react';
import {
  AlertTriangle, Check, Globe2, Palette, Plus, RefreshCw, Save, Star, Trash2,
} from 'lucide-react';
import AppShell from '../../components/ui/AppShell';
import Button from '../../components/ui/Button';
import { COLORS, FONT, RADIUS, alpha } from '../../components/theme';
import {
  fetchBrandFromWebsite, getDefaultBrand, type BrandPage, type BrandRecord,
  makeBrandRecord, normalizeBrandUrl, useBrandKit,
} from '../../components/brandKitStore';
import { DEFAULT_BRAND_CONTEXT, getBrandContextIdentity, useBrandContext } from '../../components/brandContextStore';

const panel: React.CSSProperties = { background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.card };
const input: React.CSSProperties = { width: '100%', minHeight: 44, padding: '10px 12px', color: COLORS.text, background: COLORS.bg, border: `1px solid ${COLORS.controlBorder}`, borderRadius: RADIUS.sm, fontFamily: FONT.body, fontSize: 13, outline: 'none' };
const label: React.CSSProperties = { display: 'block', marginBottom: 6, color: COLORS.textMuted, fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' };

function lines(value: string): string[] { return value.split('\n').map((item) => item.trim()).filter(Boolean); }
function sourceLabel(brand: BrandRecord, key: string): string {
  const url = brand.sources[key] || brand.sources[`${key}.1`] || brand.websiteUrl;
  try { return new URL(url).pathname === '/' ? new URL(url).hostname : new URL(url).pathname; } catch { return url; }
}
function Field(props: { label: string; value: string; onChange: (value: string) => void; source: string; multiline?: boolean; missing?: boolean }) {
  return <div>
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
      <label style={label}>{props.label}</label>
      <span style={{ color: props.missing ? COLORS.warning : COLORS.textFaint, fontSize: 10 }}>{props.missing ? 'Not found' : `Source: ${props.source}`}</span>
    </div>
    {props.multiline
      ? <textarea value={props.value} onChange={(event) => props.onChange(event.target.value)} rows={3} style={{ ...input, resize: 'vertical' }} />
      : <input value={props.value} onChange={(event) => props.onChange(event.target.value)} style={input} />}
  </div>;
}
function ListField(props: { label: string; values: string[]; onChange: (value: string[]) => void; source: string }) {
  return <Field label={`${props.label} — one per line`} value={props.values.join('\n')} onChange={(value) => props.onChange(lines(value))} source={props.source} multiline missing={!props.values.length} />;
}
function Section(props: { title: string; count?: number; children: React.ReactNode; open?: boolean }) {
  return <details open={props.open} style={panel}>
    <summary style={{ minHeight: 48, padding: '14px 16px', cursor: 'pointer', color: COLORS.text, fontSize: 14, fontWeight: 750, listStylePosition: 'inside' }}>
      {props.title}{typeof props.count === 'number' ? <span style={{ marginLeft: 8, color: COLORS.textFaint, fontSize: 11, fontWeight: 500 }}>{props.count}</span> : null}
    </summary>
    <div style={{ display: 'grid', gap: 14, padding: '0 16px 16px' }}>{props.children}</div>
  </details>;
}
function StatusPill({ page }: { page: BrandPage }) {
  const color = page.status === 'read' ? COLORS.success : page.status === 'limited' ? COLORS.warning : COLORS.textFaint;
  return <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: 10, background: COLORS.bg, borderRadius: 9, border: `1px solid ${COLORS.border}` }}>
    <span style={{ marginTop: 4, width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
    <div style={{ minWidth: 0, flex: 1 }}><div style={{ color: COLORS.text, fontSize: 12.5, fontWeight: 700 }}>{page.label} · {page.status}</div><div style={{ overflow: 'hidden', textOverflow: 'ellipsis', color: COLORS.textMuted, fontSize: 11, whiteSpace: 'nowrap' }}>{page.url}</div>{page.note ? <div style={{ marginTop: 3, color, fontSize: 11 }}>{page.note}</div> : null}</div>
  </div>;
}
function changedGroups(before: BrandRecord, after: BrandRecord): string[] {
  return [
    ['Identity', before.identity, after.identity], ['Offer', before.offer, after.offer],
    ['Audience and tone', before.audienceTone, after.audienceTone], ['Visuals', before.visuals, after.visuals],
    ['Pages read', before.pages, after.pages], ['Gaps', before.gaps, after.gaps],
  ].filter(([, left, right]) => JSON.stringify(left) !== JSON.stringify(right)).map(([name]) => String(name));
}

export default function BrandKitApp() {
  const { document, loading, saving, error: storageError, save } = useBrandKit();
  const { text: legacyText } = useBrandContext();
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<BrandRecord | null>(null);
  const [url, setUrl] = React.useState('');
  const [fetching, setFetching] = React.useState(false);
  const [fetchError, setFetchError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [refreshBase, setRefreshBase] = React.useState<BrandRecord | null>(null);

  React.useEffect(() => {
    if (selectedId) return;
    const initial = getDefaultBrand(document);
    if (initial) { setSelectedId(initial.id); setDraft(initial); }
  }, [document, selectedId]);

  const selected = document.brands.find((brand) => brand.id === selectedId) || null;
  const update = <K extends keyof BrandRecord,>(key: K, value: BrandRecord[K]) => setDraft((current) => current ? { ...current, [key]: value, updatedAt: new Date().toISOString() } : current);
  const importLegacy = async () => {
    const identity = getBrandContextIdentity(legacyText);
    const website = legacyText.match(/https?:\/\/[^\s)]+/i)?.[0] || legacyText.match(/\b[a-z0-9.-]+\.[a-z]{2,}\b/i)?.[0] || '';
    const imported = makeBrandRecord({ websiteUrl: website, identity: { businessName: identity.name, tagline: identity.tagline === 'Set your customer brand before generating' ? '' : identity.tagline }, offer: { summary: legacyText, features: [], benefits: [], pricing: [], offersCtas: [] }, audienceTone: { audience: legacyText.match(/^Audience:\s*(.+)$/im)?.[1] || '', tone: legacyText.match(/^Tone:\s*(.+)$/im)?.[1] || '' }, visuals: { logoUrl: '', colors: [], fonts: [], images: [], socialLinks: [] }, pages: [], gaps: ['Imported from the previous free-form Brand Context. Add a website or edit the missing structured fields.'], sources: {}, fetchedAt: '', limited: true });
    setDraft(imported); setSelectedId(null); setRefreshBase(null); setNotice('Imported locally. Review the fields, then confirm once to save.');
  };
  const fetchWebsite = async (refreshing = false) => {
    const target = refreshing ? selected?.websiteUrl || '' : url;
    if (!target.trim()) { setFetchError('Enter a website address.'); return; }
    setFetching(true); setFetchError(''); setNotice('');
    try {
      const found = await fetchBrandFromWebsite(target);
      if (refreshing && selected) { found.id = selected.id; found.confirmedAt = selected.confirmedAt; setRefreshBase(selected); }
      else setRefreshBase(null);
      setDraft(found); setSelectedId(refreshing ? selected?.id || null : null);
      setNotice(found.limited ? 'Some pages were limited. Everything readable is shown below; missing fields are marked honestly.' : 'Website details found. Review or edit them, then confirm once.');
    } catch { setFetchError('We could not read that website after retrying once.'); }
    finally { setFetching(false); }
  };
  const confirm = async () => {
    if (!draft) return;
    const timestamp = new Date().toISOString();
    const confirmed = { ...draft, confirmedAt: draft.confirmedAt || timestamp, updatedAt: timestamp };
    const exists = document.brands.some((brand) => brand.id === confirmed.id);
    const brands = exists ? document.brands.map((brand) => brand.id === confirmed.id ? confirmed : brand) : [...document.brands, confirmed];
    const next = { ...document, brands, defaultBrandId: document.defaultBrandId || confirmed.id };
    try { await save(next); setSelectedId(confirmed.id); setDraft(confirmed); setRefreshBase(null); setNotice('Brand saved. Ad and video briefs can use it automatically.'); }
    catch { setNotice('Saved on this device. Cloud sync will retry when storage is available.'); }
  };
  const remove = async (brand: BrandRecord) => {
    if (!window.confirm(`Delete ${brand.identity.businessName || 'this brand'}? This removes its saved context, not any ads or films.`)) return;
    const brands = document.brands.filter((item) => item.id !== brand.id);
    const nextDefault = document.defaultBrandId === brand.id ? brands[0]?.id || null : document.defaultBrandId;
    await save({ ...document, brands, defaultBrandId: nextDefault });
    setSelectedId(nextDefault); setDraft(brands.find((item) => item.id === nextDefault) || null); setNotice('Brand deleted. Existing films and ads were not changed.');
  };
  const makeDefault = async (brand: BrandRecord) => { await save({ ...document, defaultBrandId: brand.id }); setNotice(`${brand.identity.businessName} is now the default brand.`); };
  const useDifferent = () => { setSelectedId(null); setDraft(null); setUrl(''); setRefreshBase(null); setFetchError(''); setNotice(''); };
  const legacyAvailable = !loading && !document.brands.length && legacyText.trim() && legacyText !== DEFAULT_BRAND_CONTEXT;

  return <AppShell title="Brand Kit" subtitle="Fetch once, confirm once, reuse in every ad and video brief" eyebrow="Saved brand context" icon={<span style={{ display: 'grid', placeItems: 'center', width: 46, height: 46, borderRadius: 12, background: alpha(COLORS.primary, .14), border: `1px solid ${alpha(COLORS.primary, .32)}` }}><Palette size={21} color={COLORS.primaryGlow} /></span>} maxWidth={1180}>
    <style>{`@media(max-width:760px){.brand-kit-grid{grid-template-columns:1fr!important}.brand-kit-sidebar{position:static!important}.brand-kit-actions{align-items:stretch!important;flex-direction:column!important}}`}</style>
    <div className="brand-kit-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 290px) minmax(0, 1fr)', gap: 18, alignItems: 'start' }}>
      <aside className="brand-kit-sidebar" style={{ ...panel, position: 'sticky', top: 12, padding: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 4px 10px' }}><strong style={{ color: COLORS.text, fontSize: 14 }}>Saved brands</strong><span style={{ color: COLORS.textFaint, fontSize: 11 }}>{document.brands.length}</span></div>
        {loading ? <div role="status" style={{ padding: 16, color: COLORS.textMuted, fontSize: 12 }}>Loading saved brands…</div> : document.brands.length ? document.brands.map((brand) => <button key={brand.id} type="button" onClick={() => { setSelectedId(brand.id); setDraft(brand); setRefreshBase(null); setNotice(''); }} style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 10, padding: 10, marginBottom: 6, textAlign: 'left', color: COLORS.text, background: selectedId === brand.id ? COLORS.accentSoft : 'transparent', border: `1px solid ${selectedId === brand.id ? COLORS.primary : 'transparent'}`, borderRadius: 10, cursor: 'pointer' }}>{brand.visuals.logoUrl ? <img src={brand.visuals.logoUrl} alt="" style={{ width: 34, height: 34, borderRadius: 8, objectFit: 'contain', background: '#fff' }} /> : <span style={{ display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 8, background: COLORS.raised }}><Globe2 size={15} /></span>}<span style={{ minWidth: 0, flex: 1 }}><span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 12.5, fontWeight: 750, whiteSpace: 'nowrap' }}>{brand.identity.businessName || normalizeBrandUrl(brand.websiteUrl)}</span><span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', color: COLORS.textFaint, fontSize: 10.5, whiteSpace: 'nowrap' }}>{normalizeBrandUrl(brand.websiteUrl) || 'No website'}</span></span>{document.defaultBrandId === brand.id ? <Star size={13} fill={COLORS.primary} color={COLORS.primary} aria-label="Default brand" /> : null}</button>) : <div style={{ padding: 16, color: COLORS.textMuted, fontSize: 12, lineHeight: 1.6 }}>No saved brands yet. Add a website and Brand Kit will collect what the page actually says.</div>}
        <Button block variant="secondary" size="sm" onClick={useDifferent} icon={<Plus size={14} />} style={{ marginTop: 8 }}>Add another brand</Button>
      </aside>

      <main style={{ minWidth: 0 }}>
        {!draft ? <div style={{ ...panel, padding: 20 }}><h2 style={{ margin: 0, color: COLORS.text, fontFamily: FONT.heading, fontSize: 20 }}>Add a website</h2><p style={{ margin: '7px 0 16px', color: COLORS.textMuted, fontSize: 13, lineHeight: 1.6 }}>Brand Kit reads the home page and same-site pricing, about and product pages it can reach. You do not need to retype details already on the site.</p><div className="brand-kit-actions" style={{ display: 'flex', gap: 8 }}><input value={url} onChange={(event) => setUrl(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void fetchWebsite(false); }} placeholder="https://yourbrand.com" aria-label="Brand website" style={{ ...input, flex: 1 }} /><Button variant="primary" onClick={() => void fetchWebsite(false)} loading={fetching} icon={<Globe2 size={15} />}>{fetching ? 'Reading website' : 'Fetch brand'}</Button></div>{fetchError ? <div role="alert" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 12, padding: 12, color: COLORS.danger, background: COLORS.dangerBg, borderRadius: 10 }}><span style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5 }}><AlertTriangle size={14} />{fetchError}</span><Button size="sm" variant="secondary" onClick={() => void fetchWebsite(false)} icon={<RefreshCw size={13} />}>Retry</Button></div> : null}{legacyAvailable ? <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${COLORS.border}` }}><p style={{ margin: '0 0 9px', color: COLORS.textMuted, fontSize: 12 }}>A previous free-form Brand Context is available.</p><Button size="sm" variant="secondary" onClick={() => void importLegacy()}>Import saved context</Button></div> : null}</div> : <>
          <div style={{ ...panel, padding: 16, marginBottom: 12 }}>
            <div className="brand-kit-actions" style={{ display: 'flex', alignItems: 'center', gap: 10 }}><div style={{ minWidth: 0, flex: 1 }}><div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}><h2 style={{ margin: 0, color: COLORS.text, fontFamily: FONT.heading, fontSize: 20 }}>{draft.identity.businessName || 'Untitled brand'}</h2>{draft.limited ? <span style={{ padding: '3px 7px', color: COLORS.warning, background: COLORS.warningBg, borderRadius: 6, fontSize: 10, fontWeight: 750 }}>Limited read</span> : null}</div><p style={{ margin: '5px 0 0', color: COLORS.textMuted, fontSize: 12 }}>{draft.websiteUrl || 'Imported context'}{draft.fetchedAt ? ` · fetched ${new Date(draft.fetchedAt).toLocaleString()}` : ''}</p></div><Button size="sm" variant="secondary" disabled={!draft.websiteUrl || fetching} loading={fetching} onClick={() => void fetchWebsite(true)} icon={<RefreshCw size={13} />}>Refresh</Button><Button size="sm" variant="secondary" onClick={useDifferent}>Use different</Button></div>
            {refreshBase ? <div style={{ marginTop: 12, padding: 11, color: COLORS.info, background: COLORS.infoBg, borderRadius: 9, fontSize: 12.5 }}>Refresh found changes in: {changedGroups(refreshBase, draft).join(', ') || 'none'}. Review the fields below; nothing replaces the saved brand until you confirm.</div> : null}
            {notice ? <div role="status" style={{ marginTop: 12, color: draft.limited ? COLORS.warning : COLORS.success, fontSize: 12.5 }}>{notice}</div> : null}
          </div>

          <div style={{ display: 'grid', gap: 10 }}>
            <Section title="Identity" open><Field label="Business / product name" value={draft.identity.businessName} onChange={(value) => update('identity', { ...draft.identity, businessName: value })} source={sourceLabel(draft, 'siteName')} missing={!draft.identity.businessName} /><Field label="Tagline" value={draft.identity.tagline} onChange={(value) => update('identity', { ...draft.identity, tagline: value })} source={sourceLabel(draft, 'description')} multiline missing={!draft.identity.tagline} /><Field label="Website" value={draft.websiteUrl} onChange={(value) => update('websiteUrl', value)} source="User / final URL" /></Section>
            <Section title="Offer" count={draft.offer.features.length + draft.offer.benefits.length}><Field label="What it offers" value={draft.offer.summary} onChange={(value) => update('offer', { ...draft.offer, summary: value })} source={sourceLabel(draft, 'description')} multiline missing={!draft.offer.summary} /><ListField label="Key features" values={draft.offer.features} onChange={(value) => update('offer', { ...draft.offer, features: value })} source={sourceLabel(draft, 'headlines')} /><ListField label="Benefits" values={draft.offer.benefits} onChange={(value) => update('offer', { ...draft.offer, benefits: value })} source={sourceLabel(draft, 'bullets')} /><ListField label="Pricing" values={draft.offer.pricing} onChange={(value) => update('offer', { ...draft.offer, pricing: value })} source={sourceLabel(draft, 'pricing')} /><ListField label="Offers / calls to action" values={draft.offer.offersCtas} onChange={(value) => update('offer', { ...draft.offer, offersCtas: value })} source={sourceLabel(draft, 'ctas')} /></Section>
            <Section title="Audience and tone"><Field label="Audience" value={draft.audienceTone.audience} onChange={(value) => update('audienceTone', { ...draft.audienceTone, audience: value })} source={sourceLabel(draft, 'audience')} multiline missing={!draft.audienceTone.audience} /><Field label="Tone of voice" value={draft.audienceTone.tone} onChange={(value) => update('audienceTone', { ...draft.audienceTone, tone: value })} source="Confirm manually if the site does not state it" multiline missing={!draft.audienceTone.tone} /></Section>
            <Section title="Visuals, colours and logo" count={draft.visuals.images.length}><Field label="Logo URL" value={draft.visuals.logoUrl} onChange={(value) => update('visuals', { ...draft.visuals, logoUrl: value })} source={sourceLabel(draft, 'logoUrl')} missing={!draft.visuals.logoUrl} /><ListField label="Colours" values={draft.visuals.colors} onChange={(value) => update('visuals', { ...draft.visuals, colors: value })} source={sourceLabel(draft, 'colors')} /><div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>{draft.visuals.colors.map((color) => <span key={color} title={color} style={{ width: 28, height: 28, borderRadius: 8, background: color, border: `1px solid ${COLORS.controlBorder}` }} />)}</div><ListField label="Fonts" values={draft.visuals.fonts} onChange={(value) => update('visuals', { ...draft.visuals, fonts: value })} source={sourceLabel(draft, 'fonts')} /><ListField label="Social links" values={draft.visuals.socialLinks} onChange={(value) => update('visuals', { ...draft.visuals, socialLinks: value })} source={sourceLabel(draft, 'socialLinks')} /><ListField label="Product / hero image URLs" values={draft.visuals.images.map((image) => image.url)} onChange={(value) => update('visuals', { ...draft.visuals, images: value.map((url) => draft.visuals.images.find((image) => image.url === url) || { url, alt: '', sourceUrl: draft.websiteUrl }) })} source={sourceLabel(draft, 'images')} />{draft.visuals.images.length ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 8 }}>{draft.visuals.images.map((image) => <a key={image.url} href={image.url} target="_blank" rel="noreferrer" style={{ color: COLORS.textMuted, textDecoration: 'none', fontSize: 10 }}><img src={image.url} alt={image.alt || 'Fetched brand visual'} style={{ width: '100%', aspectRatio: '16/10', objectFit: 'cover', borderRadius: 8, background: COLORS.bg }} /><span style={{ display: 'block', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{image.alt || sourceLabel(draft, 'images')}</span></a>)}</div> : <span style={{ color: COLORS.textFaint, fontSize: 12 }}>No product or hero images found.</span>}</Section>
            <Section title="Pages read" count={draft.pages.length}>{draft.pages.length ? draft.pages.map((page) => <StatusPill key={page.url} page={page} />) : <span style={{ color: COLORS.textFaint, fontSize: 12 }}>No website pages were attached to this imported context.</span>}</Section>
            <Section title="Gaps" count={draft.gaps.length}>{draft.gaps.length ? draft.gaps.map((gap) => <div key={gap} style={{ display: 'flex', gap: 8, color: COLORS.warning, fontSize: 12.5, lineHeight: 1.5 }}><AlertTriangle size={13} style={{ marginTop: 2, flexShrink: 0 }} />{gap}</div>) : <div style={{ display: 'flex', gap: 8, color: COLORS.success, fontSize: 12.5 }}><Check size={14} />No extraction gaps were detected. You can still edit any field.</div>}</Section>
          </div>

          <div className="brand-kit-actions" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, padding: 14, ...panel }}><Button variant="primary" loading={saving} onClick={() => void confirm()} icon={<Save size={14} />}>{refreshBase ? 'Save refreshed brand' : 'Confirm and save brand'}</Button>{selected ? <><Button variant="secondary" onClick={() => void makeDefault(selected)} disabled={document.defaultBrandId === selected.id} icon={<Star size={13} />}>{document.defaultBrandId === selected.id ? 'Default brand' : 'Make default'}</Button><Button variant="secondary" onClick={() => void remove(selected)} icon={<Trash2 size={13} />}>Delete</Button></> : null}{storageError ? <span style={{ marginLeft: 'auto', color: COLORS.warning, fontSize: 11.5 }}>{storageError}</span> : <span style={{ marginLeft: 'auto', color: COLORS.textFaint, fontSize: 11.5 }}>One confirm action; no extra required step</span>}</div>
        </>}
      </main>
    </div>
  </AppShell>;
}
