import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Download, ExternalLink, FileArchive, FileText, Image as ImageIcon,
  Layers3, ShieldCheck, Upload, Video, Wand2,
} from 'lucide-react';
import type { CreativeBrief } from './creativeStrategy';
import {
  activeRevision, addReadyRevision, briefForAsset, campaignQualityChecks, downloadTextFile, emptyCampaignProduction,
  exportComposedImage, generateCampaignContent, generateCampaignImage, patchActiveText,
  qualityState, reconcileCampaignAssets, usageByCategory,
  type AssetLayout, type CampaignAsset, type CampaignProductionState, type CampaignRevision,
} from './campaignProduction';
import { uploadUserFile } from './api';
import { CARD, INK_DEEP, LINE, LINE_HI, MONO, TEXT, TEXT_DIM, TEXT_MUTED, rgba } from '../Phantom/theme';
import { Button, Notice, Panel, Pill, useAccent } from '../Phantom/ui';

interface Props {
  briefs: CreativeBrief[];
  production?: CampaignProductionState;
  onChange: (next: CampaignProductionState) => void;
  onOpenApp: (appId: string) => void;
}

const field: CSSProperties = {
  width: '100%', minHeight: 44, padding: '10px 12px', borderRadius: 10,
  border: `1px solid ${LINE_HI}`, background: INK_DEEP, color: TEXT,
  fontFamily: 'inherit', fontSize: 12.5, lineHeight: 1.5,
};

const label: CSSProperties = {
  display: 'block', marginBottom: 5, color: TEXT_MUTED, fontSize: 9.8,
  fontFamily: MONO, letterSpacing: .5, textTransform: 'uppercase',
};

function safeName(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'campaign-asset';
}

function replaceRevision(asset: CampaignAsset, revision: CampaignRevision): CampaignAsset {
  return addReadyRevision(asset, revision);
}

function ImagePreview({ asset }: { asset: CampaignAsset }) {
  const revision = activeRevision(asset);
  return (
    <div style={{ position: 'relative', aspectRatio: asset.aspectRatio.replace(':', ' / '), overflow: 'hidden', borderRadius: 12, background: INK_DEEP, border: `1px solid ${LINE}` }}>
      {revision?.imageUrl ? <img src={revision.imageUrl} alt="Campaign visual" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: TEXT_MUTED }}><ImageIcon size={28} /></div>}
      <div style={{ position: 'absolute', inset: 0, background: asset.layout === 'minimal' ? 'linear-gradient(180deg, rgba(0,0,0,.28), transparent 50%, rgba(0,0,0,.58))' : 'linear-gradient(180deg, rgba(0,0,0,.72), rgba(0,0,0,.05) 52%, rgba(0,0,0,.78))', pointerEvents: 'none' }} />
      {asset.brandLogoUrl ? <img src={asset.brandLogoUrl} alt="" style={{ position: 'absolute', right: '7%', top: '7%', width: '18%', maxHeight: '12%', objectFit: 'contain', objectPosition: 'right top', filter: 'drop-shadow(0 2px 10px rgba(0,0,0,.55))' }} /> : null}
      <div style={{ position: 'absolute', inset: 0, padding: '7%', display: 'flex', flexDirection: 'column', pointerEvents: 'none' }}>
        <div style={{ color: '#fff', fontSize: 'clamp(15px, 4.5vw, 32px)', fontWeight: 850, lineHeight: 1.04, maxWidth: asset.layout === 'split' ? '72%' : '94%', textShadow: '0 2px 14px rgba(0,0,0,.6)' }}>{asset.exactText.headline}</div>
        <div style={{ marginTop: asset.layout === 'feature-stack' ? 14 : 'auto', color: '#fff', fontSize: 'clamp(9px, 1.8vw, 15px)', lineHeight: 1.35, maxWidth: '88%', textShadow: '0 2px 10px rgba(0,0,0,.7)' }}>{asset.exactText.body}</div>
        <span style={{ alignSelf: 'flex-start', marginTop: 11, padding: '7px 11px', borderRadius: 7, background: asset.brandAccent || 'var(--vg-accent)', color: '#1B1308', fontSize: 10, fontWeight: 850 }}>{asset.exactText.cta || 'Learn more'}</span>
      </div>
    </div>
  );
}

function AssetMeta({ asset }: { asset: CampaignAsset }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <Pill tone={asset.status === 'ready' ? 'good' : asset.status === 'failed' ? 'bad' : asset.status === 'generating' ? 'accent' : undefined}>{asset.status}</Pill>
      <Pill>{asset.contentSubtype}</Pill>
      <Pill>{asset.aspectRatio} · {asset.format}</Pill>
      <Pill>v{Math.max(1, asset.revisions.length)}</Pill>
      <span style={{ marginLeft: 'auto', color: TEXT_MUTED, fontFamily: MONO, fontSize: 9.5 }}>{asset.dedupKey}</span>
    </div>
  );
}

function ImageAssetCard({
  asset, busy, armed, onArm, onPatch, onGenerate,
}: {
  asset: CampaignAsset; busy: boolean; armed: boolean; onArm: () => void;
  onPatch: (patch: Partial<CampaignAsset>) => void; onGenerate: () => void;
}) {
  const [error, setError] = useState('');
  const revision = activeRevision(asset);
  const replace = async (file: File) => {
    setError('');
    try {
      const uploaded = await uploadUserFile(file);
      const next: CampaignRevision = {
        id: `revision_upload_${Date.now()}`, version: asset.revisions.length + 1, status: 'ready', prompt: 'User replacement image',
        imageUrl: uploaded.url, provider: 'file-storage', model: 'user-upload', createdAt: new Date().toISOString(),
      };
      onPatch(replaceRevision(asset, next));
    } catch (caught: any) { setError(String(caught?.message || caught)); }
  };
  const exportPng = async () => {
    setError('');
    try { await exportComposedImage(asset); } catch (caught: any) { setError(String(caught?.message || caught)); }
  };
  return (
    <Panel style={{ padding: 16 }}>
      <AssetMeta asset={asset} />
      <div style={{ marginTop: 10, color: TEXT, fontWeight: 780 }}>{asset.title}</div>
      <div className="vg-p4-image-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(220px,.8fr) minmax(280px,1.2fr)', gap: 14, marginTop: 13 }}>
        <ImagePreview asset={asset} />
        <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
          <label><span style={label}>Image prompt · imagery only</span><textarea rows={4} value={asset.prompt} onChange={(event) => onPatch({ prompt: event.target.value })} style={{ ...field, resize: 'vertical' }} /></label>
          <div className="vg-two" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
            <label><span style={label}>Layout</span><select value={asset.layout} onChange={(event) => onPatch({ layout: event.target.value as AssetLayout })} style={field}><option value="headline-top">Headline top</option><option value="split">Split</option><option value="minimal">Minimal</option><option value="feature-stack">Feature stack</option></select></label>
            <label><span style={label}>Real product reference · optional URL</span><input value={asset.referenceUrl} onChange={(event) => onPatch({ referenceUrl: event.target.value })} placeholder="https://… durable product image" style={field} /></label>
          </div>
          <label><span style={label}>Exact headline overlay</span><input value={asset.exactText.headline} onChange={(event) => onPatch({ exactText: { ...asset.exactText, headline: event.target.value } })} style={field} /></label>
          <label><span style={label}>Exact supporting copy</span><textarea rows={2} value={asset.exactText.body} onChange={(event) => onPatch({ exactText: { ...asset.exactText, body: event.target.value } })} style={{ ...field, resize: 'vertical' }} /></label>
          <label><span style={label}>Exact CTA</span><input value={asset.exactText.cta} onChange={(event) => onPatch({ exactText: { ...asset.exactText, cta: event.target.value } })} style={field} /></label>
          <div style={{ padding: 10, borderRadius: 9, border: `1px solid ${armed ? 'var(--vg-accent)' : LINE}`, background: armed ? 'color-mix(in srgb,var(--vg-accent) 8%,transparent)' : INK_DEEP, color: TEXT_DIM, fontSize: 11.3, lineHeight: 1.5 }}>
            <b style={{ color: TEXT }}>Paid image gate:</b> standard-quality estimate <b>~$0.07</b> for this one asset. A real product reference uses the existing reference-edit path. Exact text is never sent to the image model.
          </div>
          {asset.revisions.length > 1 ? <label><span style={label}>Compare / restore version</span><select value={asset.activeRevisionId} onChange={(event) => onPatch({ activeRevisionId: event.target.value })} style={field}>{asset.revisions.map((item) => <option key={item.id} value={item.id}>Version {item.version} · {item.model} · {new Date(item.createdAt).toLocaleString()}</option>)}</select></label> : null}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {!armed ? <Button small onClick={onArm}><ShieldCheck size={13} /> Review $0.07 estimate</Button>
              : <Button small variant="primary" busy={busy} onClick={onGenerate}><Wand2 size={13} /> Approve &amp; {revision?.imageUrl ? 'regenerate' : 'generate'} image</Button>}
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minHeight: 36, padding: '7px 13px', borderRadius: 12, border: `1px solid ${LINE_HI}`, background: CARD, color: TEXT, cursor: 'pointer', fontSize: 12.5, fontWeight: 650 }}><Upload size={13} /> Replace image<input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={(event) => { const file = event.target.files?.[0]; if (file) void replace(file); event.target.value = ''; }} /></label>
            {revision?.imageUrl ? <Button small onClick={exportPng}><Download size={13} /> Export composed PNG</Button> : null}
          </div>
          {error ? <Notice tone="bad">{error}</Notice> : null}
          {asset.referenceUrl ? <div style={{ color: TEXT_MUTED, fontSize: 10.8 }}><ExternalLink size={10} style={{ verticalAlign: -1 }} /> Product identity is supplied to the shared image hook; logo and copy remain deterministic overlays.</div> : null}
        </div>
      </div>
    </Panel>
  );
}

function ContentAssetCard({
  asset, busy, onPatch, onGenerate,
}: { asset: CampaignAsset; busy: boolean; onPatch: (patch: Partial<CampaignAsset>) => void; onGenerate: () => void }) {
  const revision = activeRevision(asset);
  const [format, setFormat] = useState<'markdown' | 'html'>('markdown');
  const value = format === 'markdown' ? revision?.markdown || '' : revision?.html || '';
  const exportFile = () => downloadTextFile(`${safeName(asset.title)}.${format === 'markdown' ? 'md' : 'html'}`, value, format === 'markdown' ? 'text/markdown' : 'text/html');
  return (
    <Panel style={{ padding: 16 }}>
      <AssetMeta asset={asset} />
      <div style={{ marginTop: 10, color: TEXT, fontWeight: 780 }}>{asset.title}</div>
      <div style={{ marginTop: 6, color: TEXT_MUTED, fontSize: 11.4, lineHeight: 1.5 }}>Includes suggested title, search intent, topic/keywords, structured headings, body, meta description, internal links, sources when needed, and CTA. Unsupported claims, invented stories, keyword stuffing and ranking guarantees are forbidden.</div>
      <label style={{ display: 'block', marginTop: 11 }}><span style={label}>Direction / prompt</span><textarea rows={2} value={asset.prompt} onChange={(event) => onPatch({ prompt: event.target.value })} placeholder="Optional emphasis for this deliverable" style={{ ...field, resize: 'vertical' }} /></label>
      {asset.revisions.length > 1 ? <label style={{ display: 'block', marginTop: 10 }}><span style={label}>Compare / restore version</span><select value={asset.activeRevisionId} onChange={(event) => onPatch({ activeRevisionId: event.target.value })} style={field}>{asset.revisions.map((item) => <option key={item.id} value={item.id}>Version {item.version} · {item.model} · {new Date(item.createdAt).toLocaleString()}</option>)}</select></label> : null}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        <Button small variant="primary" busy={busy} onClick={onGenerate}><Wand2 size={13} /> {revision ? 'Regenerate version' : 'Generate editable content'}</Button>
        {revision ? <><Button small variant={format === 'markdown' ? 'primary' : 'ghost'} onClick={() => setFormat('markdown')}>Markdown</Button><Button small variant={format === 'html' ? 'primary' : 'ghost'} onClick={() => setFormat('html')}>HTML</Button><Button small onClick={exportFile}><Download size={13} /> Export {format.toUpperCase()}</Button></> : null}
      </div>
      {revision ? (
        <textarea
          rows={14} value={value}
          onChange={(event) => onPatch(patchActiveText(asset, format === 'markdown' ? { markdown: event.target.value } : { html: event.target.value }))}
          style={{ ...field, marginTop: 11, resize: 'vertical', fontFamily: MONO, fontSize: 11.3 }}
        />
      ) : null}
    </Panel>
  );
}

export default function CampaignProductionPanel({ briefs, production, onChange, onOpenApp }: Props) {
  const accent = useAccent();
  const state = production || emptyCampaignProduction();
  const stateRef = useRef(state);
  const busyRef = useRef('');
  const [busyId, setBusyId] = useState('');
  const [armedId, setArmedId] = useState('');
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'video' | 'image' | 'content'>('all');
  const [qualityAssetId, setQualityAssetId] = useState('');

  useEffect(() => { stateRef.current = state; }, [state]);
  const commit = (next: CampaignProductionState) => { stateRef.current = next; onChange(next); };

  useEffect(() => {
    const current = stateRef.current;
    const next = reconcileCampaignAssets(briefs, current.assets || []);
    const signature = next.map((item) => item.id).join('|');
    if (signature !== (current.assets || []).map((item) => item.id).join('|')) commit({ ...current, assets: next });
  }, [briefs.map((brief) => `${brief.id}:${brief.quantity}`).join('|')]);

  const assets = state.assets || [];
  useEffect(() => {
    if (!qualityAssetId || !assets.some((asset) => asset.id === qualityAssetId)) setQualityAssetId(assets[0]?.id || '');
  }, [assets.map((asset) => asset.id).join('|'), qualityAssetId]);
  const patchAsset = (id: string, patch: Partial<CampaignAsset> | CampaignAsset) => {
    const current = stateRef.current;
    commit({ ...current, assets: (current.assets || []).map((item) => item.id === id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item) });
  };
  const run = async (requestedAsset: CampaignAsset) => {
    if (busyRef.current) { setError('One campaign generation is already running. Wait for its durable checkpoint before starting another.'); return; }
    const asset = (stateRef.current.assets || []).find((item) => item.id === requestedAsset.id) || requestedAsset;
    const brief = briefForAsset(asset, briefs);
    if (!brief) { setError('This historical asset no longer has an active CreativeBrief. Re-emit briefs before regenerating it.'); return; }
    busyRef.current = asset.id; setBusyId(asset.id); setError('');
    patchAsset(asset.id, { status: 'generating', error: '' });
    try {
      const result = asset.kind === 'image' ? await generateCampaignImage(asset, brief) : await generateCampaignContent(asset, brief);
      const current = stateRef.current;
      const latest = (current.assets || []).find((item) => item.id === asset.id) || asset;
      commit({ ...current, assets: (current.assets || []).map((item) => item.id === asset.id ? addReadyRevision(latest, result.revision) : item), usage: [...(current.usage || []), result.usage] });
      setArmedId('');
    } catch (caught: any) {
      const message = String(caught?.message || caught);
      const current = stateRef.current;
      const latest = (current.assets || []).find((item) => item.id === asset.id) || asset;
      patchAsset(asset.id, {
        status: caught?.processing ? 'generating' : 'failed', error: message,
        generationAttempt: caught?.terminal ? Number(latest.generationAttempt || 0) + 1 : Number(latest.generationAttempt || 0),
      });
      setError(message);
    } finally { busyRef.current = ''; setBusyId(''); }
  };

  const visible = assets.filter((asset) => filter === 'all' || asset.kind === filter || (filter === 'content' && !['video', 'image'].includes(asset.kind)));
  const usage = usageByCategory(state, briefs);
  const ready = assets.filter((asset) => asset.status === 'ready');
  const qualityAsset = assets.find((asset) => asset.id === qualityAssetId) || null;
  const qualityBrief = qualityAsset ? briefForAsset(qualityAsset, briefs) : null;
  const qualityChecks = qualityAsset ? campaignQualityChecks(qualityAsset, qualityBrief) : [];
  const qualityCounts = {
    pass: qualityChecks.filter((check) => check.status === 'pass').length,
    review: qualityChecks.filter((check) => check.status === 'review').length,
    fail: qualityChecks.filter((check) => check.status === 'fail').length,
  };
  const setQualityApproval = (checkId: string, checked: boolean) => {
    if (!qualityAsset) return;
    const nextAsset = { ...qualityAsset, qualityApprovals: { ...(qualityAsset.qualityApprovals || {}), [checkId]: checked }, qualityReviewedAt: new Date().toISOString() };
    nextAsset.qaState = qualityState(campaignQualityChecks(nextAsset, qualityBrief));
    patchAsset(qualityAsset.id, nextAsset);
  };
  const manifest = () => {
    const payload = { schemaVersion: state.schemaVersion, campaignId: briefs[0]?.campaignId || '', exportedAt: new Date().toISOString(), assets, usage: state.usage };
    downloadTextFile(`vergeye-campaign-${briefs[0]?.campaignId || 'pack'}.json`, JSON.stringify(payload, null, 2), 'application/json');
  };
  const contentPack = () => {
    const text = assets.filter((asset) => !['video', 'image'].includes(asset.kind)).map((asset) => {
      const revision = activeRevision(asset); return revision?.markdown ? `<!-- ${asset.title} · version ${revision.version} -->\n\n${revision.markdown}` : '';
    }).filter(Boolean).join('\n\n---\n\n');
    downloadTextFile(`vergeye-campaign-${briefs[0]?.campaignId || 'content'}.md`, text || '# Campaign content\n\nNo generated content is ready yet.', 'text/markdown');
  };

  return (
    <section style={{ marginTop: 28 }}>
      <style>{`@media(max-width:760px){.vg-p4-image-grid{grid-template-columns:1fr!important}.vg-p4-usage{grid-template-columns:1fr 1fr!important}}`}</style>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <Pill tone="accent">Phase 4 · Campaign Asset Pack</Pill>
          <h3 style={{ margin: '10px 0 5px', color: TEXT, fontSize: 22 }}>One campaign, one source of truth, many deliverables.</h3>
          <p style={{ margin: 0, maxWidth: 760, color: TEXT_DIM, fontSize: 12.8, lineHeight: 1.6 }}>Every asset inherits this saved campaign’s Brand Profile, research, approved message, angle and Brand Kit. Identical briefs reuse the same dedup key instead of generating twice.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button small onClick={manifest}><FileArchive size={13} /> Export campaign manifest</Button>
          <Button small onClick={contentPack}><FileText size={13} /> Export content pack</Button>
        </div>
      </div>

      {error ? <div style={{ marginTop: 12 }}><Notice tone="bad">{error}</Notice></div> : null}

      <Panel style={{ marginTop: 15, padding: 16, border: `1px solid ${rgba(accent, .3)}` }}>
        <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap' }}>
          <Layers3 size={18} style={{ color: accent }} />
          <b style={{ color: TEXT }}>Campaign library</b>
          <Pill tone="good">{ready.length} ready</Pill><Pill>{assets.length} total</Pill>
          <span style={{ color: TEXT_MUTED, fontSize: 11 }}>Organised by campaign · angle · content type · version · status · date.</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {(['all', 'video', 'image', 'content'] as const).map((value) => <Button key={value} small variant={filter === value ? 'primary' : 'ghost'} onClick={() => setFilter(value)}>{value}</Button>)}
          </div>
        </div>
      </Panel>

      <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
        {visible.map((asset) => {
          if (asset.kind === 'video') return (
            <Panel key={asset.id} style={{ padding: 16 }}>
              <AssetMeta asset={asset} />
              <div style={{ marginTop: 10, color: TEXT, fontWeight: 780 }}>{asset.title}</div>
              <div style={{ marginTop: 6, color: TEXT_DIM, fontSize: 11.8, lineHeight: 1.55 }}>Video production stays in the existing Script-to-Video project, where preview, scene timeline, targeted scene regeneration, source-video revisions, voiceover, captions, music and export already preserve unaffected scenes.</div>
              <div style={{ marginTop: 10 }}><Button small variant="primary" onClick={() => onOpenApp('script-to-video')}><Video size={13} /> Open in Script-to-Video Finish</Button></div>
            </Panel>
          );
          if (asset.kind === 'image') return <ImageAssetCard key={asset.id} asset={asset} busy={Boolean(busyId)} armed={armedId === asset.id} onArm={() => setArmedId(asset.id)} onPatch={(patch) => patchAsset(asset.id, patch)} onGenerate={() => void run(asset)} />;
          return <ContentAssetCard key={asset.id} asset={asset} busy={Boolean(busyId)} onPatch={(patch) => patchAsset(asset.id, patch)} onGenerate={() => void run(asset)} />;
        })}
      </div>

      <Panel style={{ padding: 17, marginTop: 18 }}>
        <div style={{ color: TEXT, fontWeight: 780 }}>Quality validator · automatic checks + required human review</div>
        <div style={{ marginTop: 5, color: TEXT_MUTED, fontSize: 11.2, lineHeight: 1.5 }}>Automatic checks never claim that marketing or competitor statements are substantiated. Generated presenters must not be represented as real customers or endorsers, and every external asset requires a rights check.</div>
        {qualityAsset ? <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 11 }}>
            <label style={{ minWidth: 260, flex: 1 }}><span style={label}>Asset under review</span><select value={qualityAsset.id} onChange={(event) => setQualityAssetId(event.target.value)} style={field}>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.title} · {asset.status}</option>)}</select></label>
            <Pill tone="good">{qualityCounts.pass} pass</Pill><Pill tone={qualityCounts.review ? 'accent' : undefined}>{qualityCounts.review} review</Pill><Pill tone={qualityCounts.fail ? 'bad' : undefined}>{qualityCounts.fail} fail</Pill>
          </div>
          <div style={{ display: 'grid', gap: 7, marginTop: 11 }}>
            {qualityChecks.filter((check) => check.status !== 'not-applicable').map((check) => (
              <label key={check.id} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', padding: 10, borderRadius: 9, border: `1px solid ${check.status === 'fail' ? 'var(--vg-danger)' : check.status === 'review' ? 'color-mix(in srgb,var(--vg-accent) 42%,transparent)' : LINE}`, background: CARD, cursor: check.automation === 'human' ? 'pointer' : 'default' }}>
                {check.automation === 'human' ? <input type="checkbox" checked={check.status === 'pass'} onChange={(event) => setQualityApproval(check.id, event.target.checked)} style={{ marginTop: 2, accentColor: accent }} /> : <ShieldCheck size={15} color={check.status === 'pass' ? 'var(--vg-success)' : check.status === 'fail' ? 'var(--vg-danger)' : accent} />}
                <span style={{ minWidth: 0 }}><b style={{ color: TEXT, fontSize: 11.6 }}>{check.label} · {check.status === 'review' ? 'human review required' : check.status}</b><span style={{ display: 'block', marginTop: 2, color: TEXT_MUTED, fontSize: 10.5, lineHeight: 1.45 }}>{check.evidence}</span></span>
              </label>
            ))}
          </div>
        </> : <Notice>No campaign assets are planned yet.</Notice>}
      </Panel>

      <Panel style={{ padding: 17, marginTop: 18 }}>
        <div style={{ color: TEXT, fontWeight: 780 }}>Usage report · separate category records</div>
        <div className="vg-p4-usage" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(180px,1fr))', gap: 8, marginTop: 10 }}>
          {usage.map((row) => (
            <div key={row.category} style={{ padding: 11, borderRadius: 9, border: `1px solid ${LINE}`, background: CARD }}>
              <div style={{ color: accent, fontFamily: MONO, fontSize: 10, textTransform: 'uppercase' }}>{row.category}</div>
              <div style={{ marginTop: 5, color: TEXT, fontSize: 12.5, fontWeight: 750 }}>{row.estimate}</div>
              <div style={{ color: TEXT_DIM, fontSize: 10.8 }}>{row.actual}</div>
              <div style={{ marginTop: 5, color: TEXT_MUTED, fontSize: 10.2, lineHeight: 1.4 }}>{row.note}</div>
            </div>
          ))}
        </div>
      </Panel>
    </section>
  );
}
