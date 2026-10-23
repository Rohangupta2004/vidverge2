/**
 * SCREEN 1 — YOUR BRAND.
 *
 * One URL in, an editable brand summary out. The extraction is deliberately
 * shown as something to CORRECT rather than something to accept: everything the
 * three later screens say about the customer is derived from this card, so a
 * wrong price or a vague audience here poisons the comparison, the insights and
 * the video script in turn.
 *
 * The accent swatches come from the site's own stylesheets. When a site paints
 * entirely in colour spaces the reader cannot resolve, no swatch appears and the
 * colour input is how the customer sets their brand colour by hand — the app
 * never pretends it found a colour it did not.
 */

import React, { useEffect, useState } from 'react';
import { ArrowRight, Brain, FastForward, Globe, Pencil, Plus, Search, ShieldCheck, Sparkles, X } from 'lucide-react';
import { Profile, analyzeBrand } from '../store';
import { DEFAULT_ACCENT, INK_DEEP, LINE, LINE_HI, MONO, TEXT, TEXT_DIM, TEXT_MUTED, normalizeHex, readableOn, rgba } from '../theme';
import { BrandMark, Button, Field, LogStream, Notice, Panel, Pill, SectionTitle, Spinner, useAccent } from '../ui';

interface Props {
  brand: Profile | null;
  brandUrl: string;
  accent: string;
  onUrlChange: (url: string) => void;
  onBrand: (brand: Profile, accent: string) => void;
  onAccent: (accent: string) => void;
  onContinue: () => void;
  onQuickStart: () => void;
  onApprove: (brand: Profile) => Promise<void>;
}

function FeatureList({ features, onChange }: { features: string[]; onChange: (next: string[]) => void }) {
  const accent = useAccent();
  const [draft, setDraft] = useState('');

  return (
    <div>
      <div style={{ fontSize: 11.5, color: TEXT_MUTED, marginBottom: 8, letterSpacing: 0.3 }}>Features we found on your site</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 10 }}>
        {features.map((feature, index) => (
          <span key={`${index}-${feature}`} style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            padding: '6px 10px 6px 12px', borderRadius: 999,
            fontSize: 12.3, color: TEXT_DIM,
            background: rgba(accent, 0.1), border: `1px solid ${rgba(accent, 0.28)}`,
          }}>
            {feature}
            <X
              size={12}
              style={{ cursor: 'pointer', color: TEXT_MUTED }}
              onClick={() => onChange(features.filter((_, i) => i !== index))}
            />
          </span>
        ))}
        {features.length === 0 ? <span style={{ fontSize: 12.3, color: TEXT_MUTED }}>None found — add the ones that matter.</span> : null}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={draft}
          placeholder="Add a feature"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || !draft.trim()) return;
            onChange(features.concat(draft.trim()).slice(0, 10));
            setDraft('');
          }}
          style={{
            flex: 1, minWidth: 0, background: INK_DEEP, border: `1px solid ${LINE}`, borderRadius: 11,
            padding: '9px 13px', color: TEXT, fontSize: 13, fontFamily: 'inherit',
          }}
        />
        <Button
          small
          disabled={!draft.trim()}
          onClick={() => { onChange(features.concat(draft.trim()).slice(0, 10)); setDraft(''); }}
        >
          <Plus size={13} /> Add
        </Button>
      </div>
    </div>
  );
}

export default function BrandScreen({
  brand, brandUrl, accent, onUrlChange, onBrand, onAccent, onContinue, onQuickStart, onApprove,
}: Props) {
  const liveAccent = useAccent();
  const [url, setUrl] = useState(brandUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [approvalNote, setApprovalNote] = useState('');

  useEffect(() => { setUrl(brandUrl); }, [brandUrl]);

  const run = async () => {
    const target = url.trim();
    if (!target) { setError('Add one source or a short description, or choose Quick Start.'); return; }
    setBusy(true);
    setError('');
    const foundUrl = target.match(/https?:\/\/[^\s]+|(?:www\.)?[a-z0-9][a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s]*)?/i)?.[0] || '';
    if (!foundUrl) {
      const firstLine = target.split(/\n|\.|,/)[0].trim().slice(0, 80);
      const inferred: Profile = {
        id: `manual-${Date.now()}`,
        url: '',
        name: firstLine || 'Untitled brand',
        tagline: target.slice(0, 240),
        category: '', audience: '', pricing: '', usp: '', positioning: target.slice(0, 500),
        features: [], colors: [], accent: '', logoUrl: '', fetched: false,
      };
      setLog([]);
      onUrlChange('');
      onBrand(inferred, '');
      setBusy(false);
      return;
    }
    const normalizedUrl = /^https?:\/\//i.test(foundUrl) ? foundUrl : `https://${foundUrl}`;
    setLog([`Reading ${normalizedUrl.replace(/^https?:\/\//i, '')}\u2026`, 'Looking for product and pricing pages\u2026', 'Separating source-backed facts from AI interpretation\u2026']);
    try {
      const result = await analyzeBrand(normalizedUrl);
      if (!result.brand) {
        setError(result.error);
        setLog([]);
        return;
      }
      const found = normalizeHex(result.brand.accent);
      setLog([]);
      onUrlChange(result.brand.url);
      onBrand(result.brand, found);
    } catch (e: any) {
      setError(String(e?.message || e));
      setLog([]);
    } finally {
      setBusy(false);
    }
  };

  const patch = (next: Partial<Profile>) => {
    if (!brand) return;
    onBrand({ ...brand, ...next }, accent);
  };

  const swatches = (brand?.colors || []).filter(Boolean).slice(0, 6);

  return (
    <div className="vergeye-rise">
      {!brand ? (
        <Panel style={{ padding: '46px 36px', background: `linear-gradient(160deg, ${rgba(liveAccent, 0.11)} 0%, ${INK_DEEP} 58%)`, border: `1px solid ${rgba(liveAccent, 0.22)}` }}>
          <div style={{ maxWidth: 720 }}>
            <Pill tone="accent">Discover · Brand intelligence</Pill>
            <h2 style={{ margin: '18px 0 0', fontSize: 34, lineHeight: 1.1, letterSpacing: -0.9, color: TEXT }}>
              Start with anything you have.
            </h2>
            <p style={{ margin: '12px 0 26px', fontSize: 14.6, color: TEXT_DIM, lineHeight: 1.65, maxWidth: 680 }}>
              Paste one website, product URL, YouTube channel, Instagram, Facebook or LinkedIn page, a company name, or a manual description. No field is required. Vergeye keeps sourced facts separate from AI-inferred interpretation.
            </p>

            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ position: 'relative' }}>
                <Globe size={17} style={{ position: 'absolute', left: 16, top: 17, color: TEXT_MUTED }} />
                <textarea
                  value={url}
                  autoFocus
                  aria-label="Brand source or description"
                  placeholder="https://yourcompany.com — or describe the company, product and audience"
                  onChange={(e) => setUrl(e.target.value)}
                  style={{
                    width: '100%', minHeight: 96, resize: 'vertical', background: INK_DEEP, border: `1px solid ${LINE_HI}`, borderRadius: 14,
                    padding: '15px 18px 15px 44px', color: TEXT, fontSize: 15, lineHeight: 1.55, fontFamily: 'inherit',
                  }}
                />
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Button variant="primary" busy={busy} onClick={run}>
                  <Sparkles size={15} /> Build Brand Profile
                </Button>
                <Button onClick={onQuickStart}><FastForward size={14} /> Quick Start — go to Create</Button>
              </div>
              <div style={{ fontSize: 11.7, color: TEXT_MUTED }}>Research estimate: no video credits. Search and AI analysis use the workspace research allowance; you will review findings before creative work.</div>
            </div>

            {error ? <div style={{ marginTop: 18 }}><Notice tone="bad">{error}</Notice></div> : null}
            {busy ? <div style={{ marginTop: 22, display: 'flex', justifyContent: 'center' }}><Spinner size={120} caption="Reading your site" /></div> : null}
            {log.length > 0 ? <div style={{ marginTop: 18 }}><LogStream lines={log} busy={busy} /></div> : null}

            <div style={{ marginTop: 26, fontSize: 11.8, color: TEXT_MUTED, fontFamily: MONO, letterSpacing: 0.4 }}>
              Discover · Research · Strategize · Create · Edit
            </div>
          </div>
        </Panel>
      ) : (
        <>
          <SectionTitle
            hint="This is what your website says about you, and it is what every later screen argues from. Correct anything that reads wrong before you continue — especially the price."
            right={(
              <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
                <Button busy={busy} onClick={run}><Search size={14} /> Refresh sources</Button>
                <Button onClick={async () => { try { setApprovalNote('Saving approved profile…'); await onApprove(brand); setApprovalNote('Approved profile saved to Brand Kit.'); } catch (saveError: any) { setApprovalNote(`Brand Kit save failed: ${String(saveError?.message || saveError)}`); } }}><ShieldCheck size={14} /> Approve &amp; save to Brand Kit</Button>
                <Button variant="primary" onClick={onContinue}>Find my competitors <ArrowRight size={15} /></Button>
              </div>
            )}
          >
            Your brand summary
          </SectionTitle>

          {error ? <Notice tone="bad">{error}</Notice> : null}
          {approvalNote ? <Notice tone={approvalNote.startsWith('Approved') ? 'good' : approvalNote.startsWith('Brand Kit save failed') ? 'bad' : 'warn'}>{approvalNote}</Notice> : null}
          {busy ? <div style={{ marginBottom: 15, display: 'flex', justifyContent: 'center' }}><Spinner size={120} caption="Refreshing brand sources" /></div> : null}
          {log.length > 0 ? <div style={{ marginBottom: 15 }}><LogStream lines={log} busy={busy} /></div> : null}

          <Panel style={{ padding: 24, marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', marginBottom: 22 }}>
              <BrandMark name={brand.name} logoUrl={brand.logoUrl} size={54} radius={15} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 21, fontWeight: 760, color: TEXT, letterSpacing: -0.3 }}>{brand.name || 'Your brand'}</div>
                {brand.url ? (
                  <a
                    href={brand.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 12.3, color: liveAccent, fontFamily: MONO, textDecoration: 'none' }}
                  >
                    {brand.url.replace(/^https?:\/\//i, '')}
                  </a>
                ) : <div style={{ fontSize: 12.3, color: TEXT_MUTED, fontFamily: MONO }}>Manual description · no verified URL</div>}
              </div>
              <Pill tone={brand.fetched ? 'good' : 'accent'}>{brand.fetched ? 'VERIFIED source profile' : 'AI-INFERRED / manual profile'}</Pill>
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18, fontSize: 11.7, color: TEXT_MUTED }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><ShieldCheck size={13} /> VERIFIED = observed on the source URL</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Brain size={13} /> AI-INFERRED = interpretation to review</span>
            </div>
            <div className="vergeye-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              <div>
                <Field label="Product name" value={brand.name} onChange={(name) => patch({ name })} />
                <Field label="Tagline" value={brand.tagline} onChange={(tagline) => patch({ tagline })} rows={2} />
                <Field label="Category" value={brand.category} onChange={(category) => patch({ category })} hint="This is the phrase Vergeye searches with to find your competitors." />
              </div>
              <div>
                <Field label="Who you sell to" value={brand.audience} onChange={(audience) => patch({ audience })} rows={2} />
                <Field label="Pricing" value={brand.pricing} onChange={(pricing) => patch({ pricing })} rows={2} hint="Whatever your pricing page actually says. The comparison quotes this verbatim." />
                <Field label="What you do better" value={brand.usp} onChange={(usp) => patch({ usp })} rows={2} />
              </div>
            </div>

            <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: 20, marginTop: 6 }}>
              <FeatureList features={brand.features || []} onChange={(features) => patch({ features })} />
            </div>
          </Panel>

          <Panel style={{ padding: 22 }}>
            <div style={{ fontSize: 11.5, color: TEXT_MUTED, marginBottom: 12, letterSpacing: 0.3 }}>
              Your brand colour
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              {swatches.map((hex) => {
                const selected = normalizeHex(hex) === normalizeHex(accent);
                return (
                  <button
                    key={hex}
                    type="button"
                    title={hex}
                    onClick={() => onAccent(hex)}
                    style={{
                      width: 38, height: 38, borderRadius: 11, cursor: 'pointer',
                      background: hex,
                      border: `2px solid ${selected ? '#1A1000' : 'transparent'}`,
                      boxShadow: selected ? `0 0 0 3px ${rgba(hex, 0.45)}` : 'none',
                      color: readableOn(hex), fontSize: 11, fontWeight: 800,
                    }}
                  >
                    {selected ? '\u2713' : ''}
                  </button>
                );
              })}

              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
                <Pencil size={13} style={{ color: TEXT_MUTED }} />
                <span style={{ fontSize: 12.3, color: TEXT_DIM }}>Pick exactly</span>
                <input
                  type="color"
                  value={normalizeHex(accent) || DEFAULT_ACCENT}
                  onChange={(e) => onAccent(e.target.value)}
                  style={{ width: 38, height: 38, borderRadius: 11, border: `1px solid ${LINE_HI}`, background: 'transparent', cursor: 'pointer', padding: 2 }}
                />
                <span style={{ fontSize: 12, color: TEXT_MUTED, fontFamily: MONO }}>{normalizeHex(accent) || DEFAULT_ACCENT}</span>
              </label>
            </div>
            <div style={{ fontSize: 11.6, color: TEXT_MUTED, marginTop: 13, lineHeight: 1.5 }}>
              {swatches.length > 0
                ? 'Read off your own stylesheets. It highlights your column in the comparison and brands the generated video.'
                : 'Your site paints in a colour space Vergeye could not resolve, so nothing was detected — set it here and it will brand the comparison and the video.'}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
