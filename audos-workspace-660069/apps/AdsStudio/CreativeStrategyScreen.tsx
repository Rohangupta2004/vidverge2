import { useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  ArrowLeft, ArrowRight, Check, ChevronUp,
  Combine, ExternalLink, FileText, Image, Layers3, Pencil, Plus, RefreshCw,
  Route, ShieldCheck, Sparkles, Target, Video, Wand2, X,
} from 'lucide-react';
import type { Competitor, Insights, Profile } from '../Phantom/store';
import type {
  ContentSelection, CreativeAngle, CreativeAngleType, CreativeBrief, CreativeStrategyState,
} from './creativeStrategy';
import {
  CREATIVE_ANGLE_TYPES, CREATIVE_STRATEGY_SCHEMA_VERSION, applyStandardCampaignPack, buildCreativeBriefs, combineAngles, customAngle,
  estimateCreativeCost, generateCreativeAngles, saveBriefHandoff,
} from './creativeStrategy';
import CampaignProductionPanel from './CampaignProductionPanel';
import { CARD, INK_DEEP, LINE, LINE_HI, MONO, TEXT, TEXT_DIM, TEXT_MUTED, rgba } from '../Phantom/theme';
import { Button, Notice, Panel, Pill, Spinner, useAccent } from '../Phantom/ui';

interface Props {
  brand: Profile;
  competitors: Competitor[];
  insights: Insights | null;
  strategy: CreativeStrategyState;
  onChange: (next: CreativeStrategyState) => void;
  onBackToResearch: () => void;
  onOpenApp: (appId: string) => void;
}

type BusyState = '' | 'all' | string;

const scoreLabels: Array<[keyof CreativeAngle['scoreBreakdown'], string]> = [
  ['brandFit', 'Brand fit'],
  ['audienceRelevance', 'Audience'],
  ['evidenceStrength', 'Evidence'],
  ['productionFeasibility', 'Feasibility'],
  ['distinctiveness', 'Distinctiveness'],
];

function fieldStyle(): CSSProperties {
  return {
    width: '100%', minHeight: 44, padding: '10px 12px', borderRadius: 10,
    border: `1px solid ${LINE_HI}`, background: INK_DEEP, color: TEXT,
    fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5,
  };
}

function labelStyle(): CSSProperties {
  return { display: 'block', marginBottom: 6, color: TEXT_MUTED, fontSize: 10.5, fontFamily: MONO, letterSpacing: 0.6, textTransform: 'uppercase' };
}

function EditableField({ label, value, onChange, rows = 1 }: { label: string; value: string; onChange: (next: string) => void; rows?: number }) {
  return (
    <label>
      <span style={labelStyle()}>{label}</span>
      {rows > 1
        ? <textarea value={value} rows={rows} onChange={(event) => onChange(event.target.value)} style={{ ...fieldStyle(), resize: 'vertical' }} />
        : <input value={value} onChange={(event) => onChange(event.target.value)} style={fieldStyle()} />}
    </label>
  );
}

function AngleCard({
  angle, selected, expanded, busy, onToggle, onExpand, onPatch, onRegenerate,
}: {
  angle: CreativeAngle;
  selected: boolean;
  expanded: boolean;
  busy: boolean;
  onToggle: () => void;
  onExpand: () => void;
  onPatch: (patch: Partial<CreativeAngle>) => void;
  onRegenerate: () => void;
}) {
  const accent = useAccent();
  return (
    <Panel style={{ padding: 18, border: `1px solid ${selected ? rgba(accent, 0.58) : angle.claimReview === 'needs_human_review' ? 'var(--vg-warning)' : LINE}`, background: selected ? rgba(accent, 0.065) : CARD }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <button
          type="button"
          aria-label={selected ? 'Deselect angle' : 'Select angle'}
          onClick={onToggle}
          style={{ width: 26, height: 26, borderRadius: 8, display: 'grid', placeItems: 'center', flexShrink: 0, cursor: 'pointer', border: `1px solid ${selected ? accent : LINE_HI}`, background: selected ? accent : 'transparent', color: selected ? 'var(--vg-on-accent)' : TEXT_MUTED }}
        >
          {selected ? <Check size={15} /> : null}
        </button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
            <Pill tone="accent">#{angle.rank} · {angle.totalScore}/100</Pill>
            <Pill tone={angle.reasoningType === 'evidence-backed' ? 'good' : angle.reasoningType === 'analysis' ? 'accent' : 'warn'}>{angle.reasoningType}</Pill>
            <Pill>{angle.productionComplexity} complexity</Pill>
            {angle.claimReview === 'needs_human_review' ? <Pill tone="warn">Human review</Pill> : null}
          </div>
          <div style={{ marginTop: 10, color: TEXT, fontSize: 16, fontWeight: 760 }}>{angle.conceptName}</div>
          <div style={{ marginTop: 3, color: TEXT_MUTED, fontSize: 11.5, fontFamily: MONO }}>{angle.type}</div>
          <div style={{ marginTop: 10, color: TEXT_DIM, fontSize: 13.5, fontStyle: 'italic', lineHeight: 1.55 }}>“{angle.openingHook || 'Add an opening hook'}”</div>
          <div style={{ marginTop: 8, color: TEXT_DIM, fontSize: 12.5, lineHeight: 1.6 }}>{angle.coreMessage || 'Add the core message.'}</div>
        </div>
      </div>

      <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(5, minmax(64px, 1fr))', gap: 6 }} className="vg-score-grid">
        {scoreLabels.map(([key, label]) => (
          <div key={key} style={{ padding: '8px 6px', borderRadius: 8, background: INK_DEEP, border: `1px solid ${LINE}`, textAlign: 'center' }} title={`${label}: ${angle.scoreBreakdown[key]} of 20`}>
            <div style={{ color: angle.scoreBreakdown[key] >= 15 ? accent : TEXT_DIM, fontSize: 13, fontWeight: 800 }}>{angle.scoreBreakdown[key]}</div>
            <div style={{ marginTop: 2, color: TEXT_MUTED, fontSize: 8.5, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 12, padding: 11, borderRadius: 9, background: INK_DEEP, color: TEXT_DIM, fontSize: 11.8, lineHeight: 1.55 }}>
        <b style={{ color: TEXT }}>Why it may work:</b> {angle.whyItMayWork || 'Strategic hypothesis pending.'}
        <div style={{ marginTop: 5, color: TEXT_MUTED }}>{angle.strategicReasoning}</div>
      </div>

      {angle.evidence.length ? (
        <div style={{ marginTop: 9, display: 'grid', gap: 5 }}>
          {angle.evidence.slice(0, 3).map((item, index) => (
            <a key={`${item.sourceUrl}-${index}`} href={item.sourceUrl} target="_blank" rel="noreferrer" style={{ color: accent, fontSize: 11.4, display: 'inline-flex', gap: 5, alignItems: 'center', textDecoration: 'none' }}>
              Evidence: {item.label} <ExternalLink size={10} />
            </a>
          ))}
        </div>
      ) : (
        <div style={{ marginTop: 9, color: TEXT_MUTED, fontSize: 11.3 }}>Analysis / hypothesis only — no source is presented as evidence.</div>
      )}

      <div style={{ marginTop: 13, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button small onClick={onExpand}>{expanded ? <ChevronUp size={13} /> : <Pencil size={13} />} {expanded ? 'Close editor' : 'Edit every field'}</Button>
        <Button small busy={busy} onClick={onRegenerate}><RefreshCw size={13} /> Regenerate this angle</Button>
      </div>

      {expanded ? (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${LINE}`, display: 'grid', gap: 12 }}>
          <div className="vg-two" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <EditableField label="Concept name" value={angle.conceptName} onChange={(conceptName) => onPatch({ conceptName })} />
            <EditableField label="Marketing objective" value={angle.marketingObjective} onChange={(marketingObjective) => onPatch({ marketingObjective })} />
            <EditableField label="Target audience" value={angle.targetAudience} onChange={(targetAudience) => onPatch({ targetAudience })} rows={2} />
            <EditableField label="Opening hook" value={angle.openingHook} onChange={(openingHook) => onPatch({ openingHook })} rows={2} />
            <EditableField label="Suggested video style" value={angle.suggestedVideoStyle} onChange={(suggestedVideoStyle) => onPatch({ suggestedVideoStyle })} rows={2} />
            <EditableField label="CTA" value={angle.cta} onChange={(cta) => onPatch({ cta })} />
          </div>
          <EditableField label="Core message" value={angle.coreMessage} onChange={(coreMessage) => onPatch({ coreMessage })} rows={3} />
          <EditableField label="Why it may work" value={angle.whyItMayWork} onChange={(whyItMayWork) => onPatch({ whyItMayWork })} rows={3} />
          <EditableField label="Strategic reasoning" value={angle.strategicReasoning} onChange={(strategicReasoning) => onPatch({ strategicReasoning })} rows={3} />
          <div className="vg-two" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label><span style={labelStyle()}>Angle type</span><select value={angle.type} onChange={(event) => onPatch({ type: event.target.value as CreativeAngleType })} style={fieldStyle()}>{CREATIVE_ANGLE_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
            <label><span style={labelStyle()}>Reasoning label</span><select value={angle.reasoningType} onChange={(event) => onPatch({ reasoningType: event.target.value as CreativeAngle['reasoningType'] })} style={fieldStyle()}><option value="evidence-backed">Evidence-backed</option><option value="analysis">Analysis</option><option value="hypothesis">Hypothesis</option></select></label>
            <label><span style={labelStyle()}>Production complexity</span><select value={angle.productionComplexity} onChange={(event) => onPatch({ productionComplexity: event.target.value as CreativeAngle['productionComplexity'] })} style={fieldStyle()}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
            <label><span style={labelStyle()}>Claim review</span><select value={angle.claimReview} onChange={(event) => onPatch({ claimReview: event.target.value as CreativeAngle['claimReview'] })} style={fieldStyle()}><option value="clear">Clear</option><option value="needs_human_review">Needs human review</option></select></label>
            <label><span style={labelStyle()}>Duration (seconds)</span><input type="number" min={6} max={120} value={angle.recommendedDurationSec} onChange={(event) => onPatch({ recommendedDurationSec: Number(event.target.value) })} style={fieldStyle()} /></label>
            <EditableField label="Platforms · comma separated" value={angle.recommendedPlatforms.join(', ')} onChange={(value) => onPatch({ recommendedPlatforms: value.split(',').map((part) => part.trim()).filter(Boolean) })} />
            <EditableField label="Compatibility tags · comma separated" value={angle.compatibilityTags.join(', ')} onChange={(value) => onPatch({ compatibilityTags: value.split(',').map((part) => part.trim()).filter(Boolean) })} />
          </div>
          <label>
            <span style={labelStyle()}>Evidence · one “label | https://source” per line</span>
            <textarea
              rows={3}
              value={angle.evidence.map((item) => `${item.label} | ${item.sourceUrl}`).join('\n')}
              onChange={(event) => onPatch({ evidence: event.target.value.split('\n').map((line) => { const [label, sourceUrl] = line.split('|').map((part) => part.trim()); return { label, sourceUrl }; }).filter((item) => item.label && /^https?:\/\//i.test(item.sourceUrl)) })}
              style={{ ...fieldStyle(), resize: 'vertical' }}
            />
          </label>
          <div>
            <span style={labelStyle()}>Score breakdown · 0–20 each</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(70px, 1fr))', gap: 7 }} className="vg-score-grid">
              {scoreLabels.map(([key, label]) => (
                <label key={key}><span style={{ display: 'block', marginBottom: 4, color: TEXT_MUTED, fontSize: 9.5 }}>{label}</span><input type="number" min={0} max={20} value={angle.scoreBreakdown[key]} onChange={(event) => { const scoreBreakdown = { ...angle.scoreBreakdown, [key]: Math.max(0, Math.min(20, Number(event.target.value) || 0)) }; onPatch({ scoreBreakdown, totalScore: Object.values(scoreBreakdown).reduce((sum, value) => sum + value, 0) }); }} style={fieldStyle()} /></label>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

function ContentRow({ item, onChange }: { item: ContentSelection; onChange: (next: ContentSelection) => void }) {
  const accent = useAccent();
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 1.4fr) repeat(4, minmax(90px, .7fr))', gap: 9, alignItems: 'end', padding: 12, borderRadius: 11, border: `1px solid ${item.selected ? rgba(accent, 0.45) : LINE}`, background: item.selected ? rgba(accent, 0.055) : CARD }} className="vg-content-row">
      <label style={{ display: 'flex', alignItems: 'center', gap: 9, minHeight: 44, cursor: 'pointer' }}>
        <input type="checkbox" checked={item.selected} onChange={(event) => onChange({ ...item, selected: event.target.checked })} />
        <span><b style={{ color: TEXT, fontSize: 13 }}>{item.subtype}</b>{item.notes ? <span style={{ display: 'block', marginTop: 3, color: TEXT_MUTED, fontSize: 10.8, lineHeight: 1.35 }}>{item.notes}</span> : null}</span>
      </label>
      <label><span style={labelStyle()}>Quantity</span><input type="number" min={1} max={20} value={item.quantity} disabled={!item.selected} onChange={(event) => onChange({ ...item, quantity: Math.max(1, Number(event.target.value) || 1) })} style={fieldStyle()} /></label>
      <label><span style={labelStyle()}>Format</span><input value={item.format} disabled={!item.selected} onChange={(event) => onChange({ ...item, format: event.target.value })} style={fieldStyle()} /></label>
      <label><span style={labelStyle()}>Aspect ratio</span><select value={item.aspectRatio} disabled={!item.selected || item.kind === 'marketing'} onChange={(event) => onChange({ ...item, aspectRatio: event.target.value })} style={fieldStyle()}>{(item.kind === 'marketing' ? ['n/a'] : ['9:16', '16:9', '1:1', '4:5']).map((value) => <option key={value}>{value}</option>)}</select></label>
      <label><span style={labelStyle()}>{item.kind === 'video' ? 'Duration' : 'Duration'}</span><select value={item.durationSec} disabled={!item.selected || item.kind !== 'video'} onChange={(event) => onChange({ ...item, durationSec: Number(event.target.value) })} style={fieldStyle()}>{item.kind === 'video' ? [6, 8, 10, 15, 20, 30, 45, 60].map((value) => <option key={value} value={value}>{value}s</option>) : <option value={0}>n/a</option>}</select></label>
    </div>
  );
}

function BriefCard({ brief, onOpen }: { brief: CreativeBrief; onOpen: (appId: string) => void }) {
  const accent = useAccent();
  const routeLabel = brief.production.route === 'product-launch' ? 'Product Launch'
    : brief.production.route === 'script-to-video' ? 'Script-to-Video'
      : brief.production.route === 'ads-studio' ? 'Ads Studio Create'
        : brief.production.route === 'image-composition' ? 'Campaign Image Studio'
          : 'SEO/AEO Content Studio';
  const canOpen = !['image-composition', 'marketing-content'].includes(brief.production.route);
  return (
    <Panel style={{ padding: 16, border: `1px solid ${LINE}` }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Pill tone="accent">{brief.contentSubtype}</Pill>
        <Pill>{brief.aspectRatio}{brief.durationSec ? ` · ${brief.durationSec}s` : ''}</Pill>
        {brief.claimReview === 'needs_human_review' ? <Pill tone="warn">Claim review required</Pill> : null}
      </div>
      <div style={{ marginTop: 10, color: TEXT, fontWeight: 750 }}>{brief.conceptName}</div>
      <div style={{ marginTop: 5, color: TEXT_DIM, fontSize: 12.3, lineHeight: 1.55 }}>{brief.hook}</div>
      <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, background: INK_DEEP, color: TEXT_MUTED, fontSize: 11.3 }}><Route size={12} style={{ marginRight: 6, verticalAlign: -2, color: accent }} />{routeLabel}</div>
      {brief.production.imageTextPolicy === 'compose_exact_text_after_generation' ? <div style={{ marginTop: 8, color: TEXT_MUTED, fontSize: 11.2 }}>Exact text will be composed as an overlay after image generation — never rendered by the image model.</div> : null}
      <div style={{ marginTop: 11 }}>
        {canOpen ? <Button small variant="primary" onClick={() => onOpen(saveBriefHandoff(brief) || '')}>Send to {routeLabel} <ArrowRight size={13} /></Button>
          : <span style={{ color: TEXT_MUTED, fontSize: 11.5 }}>Managed below inside this saved campaign — no duplicate project or repeated research.</span>}
      </div>
    </Panel>
  );
}

export default function CreativeStrategyScreen({ brand, competitors, insights, strategy, onChange, onBackToResearch, onOpenApp }: Props) {
  const accent = useAccent();
  const [busy, setBusy] = useState<BusyState>('');
  const [error, setError] = useState('');
  const [retryGeneration, setRetryGeneration] = useState<{ regenerateType?: CreativeAngleType } | null>(null);
  const [note, setNote] = useState('');
  const [expanded, setExpanded] = useState<string>('');
  const [showCustom, setShowCustom] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customHook, setCustomHook] = useState('');
  const [customMessage, setCustomMessage] = useState('');

  const approvedFindings = useMemo(() => {
    const report = insights?.research;
    if (!strategy.useCompetitorResearch || !report?.approvedAt) return [];
    return report.findings.filter((item) => item.evidenceType !== 'unavailable');
  }, [insights, strategy.useCompetitorResearch]);
  const selectedAngles = strategy.angles.filter((item) => strategy.selectedAngleIds.includes(item.id));
  const cost = estimateCreativeCost(strategy.contentSelections, selectedAngles.length);
  const selectedContent = strategy.contentSelections.filter((item) => item.selected);

  const patch = (value: Partial<CreativeStrategyState>) => onChange({ ...strategy, ...value, schemaVersion: CREATIVE_STRATEGY_SCHEMA_VERSION });
  const patchAngle = (id: string, value: Partial<CreativeAngle>) => patch({ angles: strategy.angles.map((item) => item.id === id ? { ...item, ...value } : item), briefs: [] });

  const runAgent = async (regenerateType?: CreativeAngleType) => {
    if (!strategy.campaignGoal.trim()) { setRetryGeneration(null); setError('Add a campaign goal before generating angles.'); return; }
    if (!strategy.profileApprovedAt) { setRetryGeneration(null); setError('Approve the Brand Profile for this campaign first.'); return; }
    setBusy(regenerateType || 'all');
    setError('');
    setRetryGeneration(null);
    setNote('');
    try {
      const generated = await generateCreativeAngles({
        brand,
        competitors: competitors.filter((item) => item.included && item.fetched),
        findings: approvedFindings,
        campaignGoal: strategy.campaignGoal,
        direction: strategy.direction,
        profileApprovedAt: strategy.profileApprovedAt,
        useCompetitorResearch: strategy.useCompetitorResearch,
        regenerateType,
      });
      if (regenerateType) {
        const replacement = generated.find((item) => item.type === regenerateType);
        if (!replacement) throw new Error(`The strategy agent did not return a valid ${regenerateType} angle.`);
        patch({
          angles: strategy.angles.map((item) => item.type === regenerateType ? { ...replacement, id: item.id } : item).sort((a, b) => b.totalScore - a.totalScore).map((item, index) => ({ ...item, rank: index + 1 })),
          generatedAt: new Date().toISOString(), briefs: [],
        });
        setNote(`${regenerateType} regenerated and re-ranked. Scores are planning criteria, not a performance promise.`);
      } else {
        patch({ angles: generated, selectedAngleIds: [], generatedAt: new Date().toISOString(), briefs: [] });
        setNote(`${generated.length} angles generated and ranked from the approved profile${approvedFindings.length ? ' and approved findings' : ''}.`);
      }
    } catch (caught: any) {
      const message = String(caught?.message || caught || 'Creative strategy generation failed.');
      const validationFailure = /schema|validat|incompatible|response/i.test(message);
      setError(validationFailure
        ? `The strategy response could not be validated, so nothing was saved. No production credits were used. ${message}`
        : `${message} No production credits were used; retry when you are ready.`);
      setRetryGeneration({ regenerateType });
    } finally {
      setBusy('');
    }
  };

  const addCustom = () => {
    if (!customName.trim() || !customHook.trim()) { setError('A custom angle needs a name and opening hook.'); return; }
    const angle = customAngle({ conceptName: customName, openingHook: customHook, coreMessage: customMessage, targetAudience: brand.audience, marketingObjective: strategy.campaignGoal, cta: 'Learn more', recommendedDurationSec: 20, recommendedPlatforms: ['Instagram Reels', 'TikTok'], suggestedVideoStyle: 'Custom creator direction', type: 'Benefit-focused' });
    patch({ angles: [angle, ...strategy.angles].map((item, index) => ({ ...item, rank: index + 1 })), selectedAngleIds: [...strategy.selectedAngleIds, angle.id], briefs: [] });
    setCustomName(''); setCustomHook(''); setCustomMessage(''); setShowCustom(false); setError('');
  };

  const combine = () => {
    if (selectedAngles.length < 2 || selectedAngles.length > 3) { setError('Select two or three angles to combine.'); return; }
    const compatible = selectedAngles.some((item) => item.compatibilityTags.some((tag) => selectedAngles.every((candidate) => candidate.compatibilityTags.includes(tag))))
      || selectedAngles.every((item) => item.recommendedPlatforms.some((platform) => selectedAngles[0].recommendedPlatforms.includes(platform)));
    if (!compatible) { setError('These angles do not share a compatible platform or strategy tag. Pick a closer pair, or write a custom angle.'); return; }
    const merged = combineAngles(selectedAngles);
    patch({ angles: [merged, ...strategy.angles].map((item, index) => ({ ...item, rank: index + 1 })), selectedAngleIds: [merged.id], briefs: [] });
    setNote('Combined angle added as a hypothesis. Review every field before production.');
    setError('');
  };

  const buildBriefs = () => {
    if (!selectedAngles.length) { setError('Select at least one angle.'); return; }
    if (!selectedContent.length) { setError('Select at least one content type.'); return; }
    const briefs = buildCreativeBriefs(strategy, brand);
    patch({ briefs });
    setNote(`${briefs.length} scene-planning-ready CreativeBrief${briefs.length === 1 ? '' : 's'} saved with this campaign.`);
    setError('');
  };

  const contentGroups: Array<{ kind: ContentSelection['kind']; title: string; icon: ReactNode; description: string }> = [
    { kind: 'video', title: 'Video', icon: <Video size={18} />, description: 'Select several production paths at once. Video credits equal finished seconds × quantity × approved angles.' },
    { kind: 'image', title: 'Image ads', icon: <Image size={18} />, description: 'GPT Image produces imagery only. Exact copy is added later by the composition/overlay step.' },
    { kind: 'marketing', title: 'Marketing content', icon: <FileText size={18} />, description: 'SEO/AEO articles, comparisons, landing copy, captions and headline/CTA sets.' },
  ];

  return (
    <div className="vergeye-rise">
      <style>{`
        @media (max-width: 760px) {
          .vg-two { grid-template-columns: 1fr !important; }
          .vg-score-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .vg-content-row { grid-template-columns: 1fr 1fr !important; }
          .vg-content-row > :first-child { grid-column: 1 / -1; }
        }
        @media (max-width: 460px) { .vg-content-row { grid-template-columns: 1fr !important; } }
      `}</style>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <Pill tone="accent">Strategize · Creative Intelligence</Pill>
          <h2 style={{ margin: '12px 0 6px', color: TEXT, fontSize: 28, letterSpacing: -0.5 }}>Rank the idea before you fund production.</h2>
          <p style={{ margin: 0, maxWidth: 760, color: TEXT_DIM, fontSize: 13.5, lineHeight: 1.65 }}>One server-side strategy call turns the approved Brand Profile, optional approved findings, and campaign goal into editable angles. Scores explain strategic fit; they never promise performance.</p>
        </div>
        <Button onClick={onBackToResearch}><ArrowLeft size={14} /> Back to Research</Button>
      </div>

      {error ? (
        <Notice tone="bad">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <span style={{ flex: 1, minWidth: 240 }}>{error}</span>
            {retryGeneration ? (
              <Button small disabled={!!busy} onClick={() => runAgent(retryGeneration.regenerateType)}>
                <RefreshCw size={13} /> Retry
              </Button>
            ) : null}
          </div>
        </Notice>
      ) : null}
      {note ? <Notice tone="good">{note}</Notice> : null}

      <Panel style={{ padding: 20, marginBottom: 18, border: `1px solid ${rgba(accent, 0.24)}` }}>
        <div className="vg-two" style={{ display: 'grid', gridTemplateColumns: '1.2fr .8fr', gap: 16 }}>
          <div>
            <EditableField label="Campaign goal" value={strategy.campaignGoal} onChange={(campaignGoal) => patch({ campaignGoal, briefs: [] })} rows={3} />
            <div style={{ marginTop: 12 }}><EditableField label="Choose a different direction · optional" value={strategy.direction} onChange={(direction) => patch({ direction, briefs: [] })} rows={2} /></div>
          </div>
          <div style={{ padding: 15, borderRadius: 12, background: INK_DEEP, border: `1px solid ${LINE}` }}>
            <div style={{ color: TEXT, fontWeight: 720 }}>{brand.name || 'Approved Brand Profile'}</div>
            <div style={{ marginTop: 6, color: TEXT_DIM, fontSize: 12, lineHeight: 1.5 }}>{brand.audience || brand.positioning || 'Review the Brand Profile before strategy.'}</div>
            <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {strategy.profileApprovedAt
                ? <Pill tone="good"><ShieldCheck size={11} /> Approved for strategy</Pill>
                : <Button small variant="primary" onClick={() => patch({ profileApprovedAt: new Date().toISOString() })}><ShieldCheck size={13} /> Approve profile for strategy</Button>}
            </div>
            <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginTop: 14, color: TEXT_DIM, fontSize: 11.8, lineHeight: 1.5 }}>
              <input type="checkbox" checked={strategy.useCompetitorResearch} onChange={(event) => patch({ useCompetitorResearch: event.target.checked, briefs: [] })} />
              <span>Use selected competitors and approved findings when available. Turn this off to continue without competitor research.</span>
            </label>
            <div style={{ marginTop: 9, color: TEXT_MUTED, fontSize: 10.8 }}>
              {strategy.useCompetitorResearch
                ? approvedFindings.length ? `${approvedFindings.length} approved findings will be sent — not the full project history.` : 'No approved findings available. Strategy will continue from the Brand Profile only.'
                : 'Competitor research skipped by user.'}
            </div>
          </div>
        </div>
        <div style={{ marginTop: 16, display: 'flex', gap: 9, flexWrap: 'wrap' }}>
          <Button variant="primary" busy={busy === 'all'} disabled={!strategy.campaignGoal.trim() || !strategy.profileApprovedAt} onClick={() => runAgent()}><Wand2 size={15} /> {strategy.angles.length ? 'Regenerate all 14 angles' : 'Generate & rank 14 angles'}</Button>
          {strategy.direction.trim() && strategy.angles.length ? <Button disabled={!!busy} onClick={() => runAgent()}><Target size={14} /> Regenerate in this direction</Button> : null}
          <span style={{ alignSelf: 'center', color: TEXT_MUTED, fontSize: 11.3 }}>Free planning step · one AI call · deterministic schema validation</span>
        </div>
      </Panel>

      {busy === 'all' ? <Panel style={{ padding: '42px 24px', display: 'flex', justifyContent: 'center', marginBottom: 18 }}><Spinner size={120} caption="Building and validating creative angles" /></Panel> : null}

      {strategy.angles.length ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', marginBottom: 13 }}>
            <div style={{ color: TEXT, fontSize: 17, fontWeight: 760 }}>Creative angles</div>
            <Pill tone="accent">{selectedAngles.length} selected</Pill>
            <span style={{ color: TEXT_MUTED, fontSize: 11.4 }}>Ranked by five visible 0–20 criteria. No guaranteed performance claim.</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button small disabled={selectedAngles.length < 2 || selectedAngles.length > 3} onClick={combine}><Combine size={13} /> Combine selected</Button>
              <Button small onClick={() => setShowCustom(!showCustom)}><Plus size={13} /> Custom angle</Button>
            </div>
          </div>

          {showCustom ? (
            <Panel style={{ padding: 16, marginBottom: 14 }}>
              <div className="vg-two" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <EditableField label="Custom concept name" value={customName} onChange={setCustomName} />
                <EditableField label="Opening hook" value={customHook} onChange={setCustomHook} />
              </div>
              <div style={{ marginTop: 12 }}><EditableField label="Core message" value={customMessage} onChange={setCustomMessage} rows={3} /></div>
              <div style={{ marginTop: 10, display: 'flex', gap: 8 }}><Button variant="primary" small onClick={addCustom}>Add custom hypothesis</Button><Button small onClick={() => setShowCustom(false)}><X size={12} /> Cancel</Button></div>
            </Panel>
          ) : null}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(390px, 100%), 1fr))', gap: 13 }}>
            {strategy.angles.map((angle) => (
              <AngleCard
                key={angle.id}
                angle={angle}
                selected={strategy.selectedAngleIds.includes(angle.id)}
                expanded={expanded === angle.id}
                busy={busy === angle.type}
                onToggle={() => patch({ selectedAngleIds: strategy.selectedAngleIds.includes(angle.id) ? strategy.selectedAngleIds.filter((id) => id !== angle.id) : [...strategy.selectedAngleIds, angle.id], briefs: [] })}
                onExpand={() => setExpanded(expanded === angle.id ? '' : angle.id)}
                onPatch={(value) => patchAngle(angle.id, value)}
                onRegenerate={() => runAgent(angle.type)}
              />
            ))}
          </div>

          <div style={{ marginTop: 28, marginBottom: 13 }}>
            <Pill tone="accent">Content Type Selection</Pill>
            <h3 style={{ margin: '10px 0 5px', color: TEXT, fontSize: 22 }}>Build several deliverables from the same approved angle.</h3>
            <p style={{ margin: 0, color: TEXT_DIM, fontSize: 13, lineHeight: 1.6 }}>Multi-select types, tune quantity and format, then review the estimate before any paid production route opens.</p>
            <div style={{ marginTop: 10 }}><Button small onClick={() => patch({ contentSelections: applyStandardCampaignPack(strategy.contentSelections), briefs: [] })}><Layers3 size={13} /> Plan standard launch pack</Button><span style={{ marginLeft: 9, color: TEXT_MUTED, fontSize: 10.8 }}>1×30s hero · 3×15s variations · 5 statics · 3 alt hooks/CTAs · 1 article · 5 captions</span></div>
          </div>

          <div style={{ display: 'grid', gap: 15 }}>
            {contentGroups.map((group) => (
              <Panel key={group.kind} style={{ padding: 17 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 12 }}>
                  <span style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', color: accent, background: rgba(accent, 0.11), border: `1px solid ${rgba(accent, 0.25)}` }}>{group.icon}</span>
                  <div><div style={{ color: TEXT, fontWeight: 750 }}>{group.title}</div><div style={{ marginTop: 3, color: TEXT_MUTED, fontSize: 11.6, lineHeight: 1.45 }}>{group.description}</div></div>
                </div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {strategy.contentSelections.filter((item) => item.kind === group.kind).map((item) => (
                    <ContentRow key={item.id} item={item} onChange={(next) => patch({ contentSelections: strategy.contentSelections.map((candidate) => candidate.id === item.id ? next : candidate), briefs: [] })} />
                  ))}
                </div>
              </Panel>
            ))}
          </div>

          <Panel style={{ padding: 18, marginTop: 16, border: `1px solid ${rgba(accent, 0.38)}`, background: rgba(accent, 0.055) }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <Layers3 size={20} style={{ color: accent, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 230 }}>
                <div style={{ color: TEXT, fontWeight: 760 }}>Expected production estimate</div>
                <div style={{ marginTop: 5, color: TEXT_DIM, fontSize: 13 }}>{cost.summary}</div>
                <div style={{ marginTop: 5, color: TEXT_MUTED, fontSize: 11.3, lineHeight: 1.5 }}>Vidverge video billing is locked at 1 credit per finished second. Image generation uses a provider quote in the later production step; no image call starts here. Strategy, briefs, and marketing planning spend no video credits.</div>
              </div>
              <Button variant="primary" disabled={!selectedAngles.length || !selectedContent.length} onClick={buildBriefs}><Sparkles size={14} /> Emit CreativeBriefs</Button>
            </div>
          </Panel>

          {strategy.briefs.length ? (
            <div style={{ marginTop: 24 }}>
              <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
                <div style={{ color: TEXT, fontSize: 17, fontWeight: 760 }}>Production handoff</div>
                <Pill tone="good">{strategy.briefs.length} briefs saved</Pill>
                <span style={{ color: TEXT_MUTED, fontSize: 11.4 }}>Each contract is scene-planning-ready and stays with this campaign.</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))', gap: 11 }}>
                {strategy.briefs.map((brief) => <BriefCard key={brief.id} brief={brief} onOpen={(appId) => { if (appId) onOpenApp(appId); }} />)}
              </div>
              <CampaignProductionPanel
                briefs={strategy.briefs}
                production={strategy.production}
                onChange={(production) => patch({ production })}
                onOpenApp={onOpenApp}
              />
            </div>
          ) : null}
        </>
      ) : (
        !busy ? <Panel style={{ padding: '42px 24px', textAlign: 'center' }}><Sparkles size={28} style={{ color: accent }} /><div style={{ marginTop: 12, color: TEXT, fontWeight: 740 }}>No angles yet</div><div style={{ margin: '6px auto 0', maxWidth: 520, color: TEXT_MUTED, fontSize: 12.5, lineHeight: 1.6 }}>Approve the Brand Profile, set a campaign goal, then generate. Approved competitor findings are optional.</div></Panel> : null
      )}
    </div>
  );
}
