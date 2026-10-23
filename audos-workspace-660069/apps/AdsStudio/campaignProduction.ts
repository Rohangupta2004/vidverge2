import type { CreativeBrief } from './creativeStrategy';
import { callHook } from './api';

export const CAMPAIGN_PRODUCTION_VERSION = 'vergeye.campaign-production.2026-10-21.v1';
export const OMNI_EDIT_CAPABILITY_VERSION = 'gemini-omni-1.1-flash-edit.2026-10-21.v1';

export type UsageCategory = 'research' | 'llm_planning' | 'image' | 'video' | 'editing' | 'rendering';
export type CampaignAssetStatus = 'planned' | 'generating' | 'ready' | 'failed';
export type AssetLayout = 'headline-top' | 'split' | 'minimal' | 'feature-stack';
export type QualityCheckStatus = 'pass' | 'review' | 'fail' | 'not-applicable';

export interface CampaignQualityCheck {
  id: string;
  label: string;
  status: QualityCheckStatus;
  automation: 'automatic' | 'human';
  evidence: string;
  blocking: boolean;
}

export interface OmniEditCapability {
  id: 'prompt-based-existing-video' | 'background-change' | 'object-change' | 'lighting-change' | 'appearance-change';
  label: string;
  verified: boolean;
  evidence: string;
}

/** The configured Audos proxy is authoritative. It verifies videoData plus a
 * prompt, not a menu of guaranteed semantic edit classes. Unverified shortcuts
 * stay disabled instead of being marketed as supported operations. */
export const OMNI_EDIT_CAPABILITIES: OmniEditCapability[] = [
  {
    id: 'prompt-based-existing-video',
    label: 'Prompt-based edit of an existing clip',
    verified: true,
    evidence: 'POST /api/veo/generate/video accepts videoData and optional videoMimeType only for gemini-omni-1.1-flash; output is limited to compatible clips up to 8 seconds.',
  },
  { id: 'background-change', label: 'Background change', verified: false, evidence: 'Not separately guaranteed by the configured proxy contract.' },
  { id: 'object-change', label: 'Object change', verified: false, evidence: 'Not separately guaranteed by the configured proxy contract.' },
  { id: 'lighting-change', label: 'Lighting change', verified: false, evidence: 'Not separately guaranteed by the configured proxy contract.' },
  { id: 'appearance-change', label: 'Appearance change', verified: false, evidence: 'Not separately guaranteed by the configured proxy contract.' },
];

export interface UsageRecord {
  id: string;
  campaignId: string;
  assetId?: string;
  category: UsageCategory;
  operation: string;
  provider: string;
  model: string;
  estimateUsd: number | null;
  actualUsd: number | null;
  credits: number | null;
  status: 'estimated' | 'complete' | 'failed';
  note: string;
  createdAt: string;
}

export interface CampaignRevision {
  id: string;
  version: number;
  status: 'ready' | 'failed';
  operationKey?: string;
  deduplicated?: boolean;
  prompt: string;
  imageUrl?: string;
  markdown?: string;
  html?: string;
  provider: string;
  model: string;
  createdAt: string;
}

export interface CampaignAsset {
  id: string;
  dedupKey: string;
  campaignId: string;
  creativeBriefId: string;
  angleId: string;
  kind: 'video' | 'image' | 'article' | 'comparison' | 'landing-copy' | 'faq' | 'educational' | 'feature-explanation' | 'industry' | 'answer-content' | 'caption' | 'headline-cta';
  contentSubtype: string;
  variant: number;
  title: string;
  aspectRatio: string;
  format: string;
  status: CampaignAssetStatus;
  qaState: 'not-run' | 'pass' | 'needs-review' | 'fail';
  prompt: string;
  exactText: { headline: string; body: string; cta: string };
  layout: AssetLayout;
  referenceUrl: string;
  brandLogoUrl: string;
  brandAccent: string;
  revisions: CampaignRevision[];
  activeRevisionId: string;
  error: string;
  generationAttempt?: number;
  qualityApprovals?: Record<string, boolean>;
  qualityReviewedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignProductionState {
  schemaVersion: typeof CAMPAIGN_PRODUCTION_VERSION;
  assets: CampaignAsset[];
  usage: UsageRecord[];
  lastPackCreatedAt: string;
}

export function emptyCampaignProduction(): CampaignProductionState {
  return { schemaVersion: CAMPAIGN_PRODUCTION_VERSION, assets: [], usage: [], lastPackCreatedAt: '' };
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function clean(value: unknown, fallback = ''): string {
  return String(value || fallback).replace(/\s+/g, ' ').trim();
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function kindFor(brief: CreativeBrief): CampaignAsset['kind'] {
  const type = String(brief.contentSubtype).toLowerCase();
  if (brief.contentKind === 'video') return 'video';
  if (brief.contentKind === 'image') return 'image';
  if (type.includes('comparison')) return 'comparison';
  if (type.includes('landing')) return 'landing-copy';
  if (type.includes('faq')) return 'faq';
  if (type.includes('educational')) return 'educational';
  if (type.includes('feature explanation')) return 'feature-explanation';
  if (type.includes('industry')) return 'industry';
  if (type.includes('answer')) return 'answer-content';
  if (type.includes('caption')) return 'caption';
  if (type.includes('headline') || type.includes('cta')) return 'headline-cta';
  return 'article';
}

function defaultPrompt(brief: CreativeBrief, variant: number): string {
  const product = brief.brand.features.slice(0, 3).join(', ');
  return [
    `${brief.contentSubtype} campaign visual for ${brief.brand.name}.`,
    `Approved angle: ${brief.conceptName}. Audience: ${brief.audience}.`,
    `Show the real product or a faithful product-led scene${product ? ` featuring ${product}` : ''}.`,
    `Visual direction: ${brief.style}. Platform aspect ratio ${brief.aspectRatio}. Variation ${variant + 1}.`,
    `Use ${brief.brand.accent || 'the approved brand palette'} and leave deliberate negative space for a deterministic copy overlay.`,
    'Do not render letters, words, logos, UI labels, statistics, customer quotes, watermarks or calls to action inside the generated image. Exact text and the approved logo are composed later.',
  ].join(' ');
}

function defaultTitle(brief: CreativeBrief, variant: number): string {
  return `${brief.conceptName} · ${brief.contentSubtype}${brief.quantity > 1 ? ` · v${variant + 1}` : ''}`;
}

export function reconcileCampaignAssets(briefs: CreativeBrief[], previous: CampaignAsset[]): CampaignAsset[] {
  const byKey = new Map(previous.map((asset) => [asset.dedupKey, asset]));
  const now = new Date().toISOString();
  const planned: CampaignAsset[] = [];
  briefs.forEach((brief) => {
    for (let variant = 0; variant < Math.max(1, brief.quantity); variant += 1) {
      const keySource = [brief.campaignId, brief.angleId, brief.contentSelectionId, brief.contentSubtype, brief.aspectRatio, brief.format, variant].join('|');
      const dedupKey = stableHash(keySource);
      const existing = byKey.get(dedupKey);
      if (existing) {
        planned.push(existing);
        continue;
      }
      planned.push({
        id: uid('asset'), dedupKey, campaignId: brief.campaignId, creativeBriefId: brief.id,
        angleId: brief.angleId, kind: kindFor(brief), contentSubtype: String(brief.contentSubtype), variant,
        title: defaultTitle(brief, variant), aspectRatio: brief.aspectRatio, format: brief.format,
        status: 'planned', qaState: 'not-run', prompt: defaultPrompt(brief, variant),
        exactText: { headline: brief.hook, body: brief.coreMessage, cta: brief.cta },
        layout: variant % 2 ? 'split' : 'headline-top', referenceUrl: '',
        brandLogoUrl: brief.brand.logoUrl, brandAccent: brief.brand.accent,
        revisions: [], activeRevisionId: '', error: '', generationAttempt: 0,
        qualityApprovals: {}, qualityReviewedAt: '', createdAt: now, updatedAt: now,
      });
    }
  });
  // Keep completed historical assets from this saved campaign even when a new
  // selection no longer plans them; this is the campaign library, not a cache.
  previous.forEach((asset) => { if (!planned.some((item) => item.id === asset.id)) planned.push(asset); });
  return planned;
}

export function briefForAsset(asset: CampaignAsset, briefs: CreativeBrief[]): CreativeBrief | null {
  return briefs.find((brief) => brief.id === asset.creativeBriefId)
    || briefs.find((brief) => brief.campaignId === asset.campaignId && brief.angleId === asset.angleId && String(brief.contentSubtype) === asset.contentSubtype)
    || null;
}

export async function generateCampaignImage(asset: CampaignAsset, brief: CreativeBrief): Promise<{ revision: CampaignRevision; usage: UsageRecord }> {
  const requestFingerprint = stableHash(JSON.stringify({ prompt: asset.prompt, aspect: asset.aspectRatio, referenceUrl: asset.referenceUrl }));
  const operationKey = ['vg', 'image', asset.campaignId, asset.id, asset.revisions.length + 1, asset.generationAttempt || 0, requestFingerprint].join(':');
  const response = await callHook('vv-image-generate', {
    prompt: asset.prompt,
    aspect: asset.aspectRatio,
    model: 'auto',
    quality: 'standard',
    operationKey,
    referenceImages: asset.referenceUrl ? [{ data: asset.referenceUrl, label: 'REAL PRODUCT REFERENCE: preserve product identity, proportions, colours and visible details.' }] : [],
  });
  if (!response?.success || !response?.imageUrl) {
    const error: any = new Error(String(response?.error || 'The shared image hook returned no image.'));
    error.terminal = Boolean(response?.terminal);
    error.processing = Boolean(response?.processing);
    error.operationKey = String(response?.operationKey || operationKey);
    throw error;
  }
  const createdAt = new Date().toISOString();
  const revision: CampaignRevision = {
    id: uid('revision'), version: asset.revisions.length + 1, status: 'ready', prompt: asset.prompt,
    operationKey: String(response.operationKey || operationKey), deduplicated: Boolean(response.deduplicated),
    imageUrl: String(response.imageUrl), provider: String(response.endpoint || 'vv-image-generate'),
    model: String(response.modelUsed || 'platform-managed image model'), createdAt,
  };
  const usage: UsageRecord = {
    id: uid('usage'), campaignId: brief.campaignId, assetId: asset.id, category: 'image', operation: 'campaign image generation',
    provider: revision.provider, model: revision.model, estimateUsd: 0.07, actualUsd: null, credits: null, status: 'complete',
    note: 'Standard-quality planning estimate shown before generation; provider response did not include authoritative dollar usage. Exact text is composed separately.', createdAt,
  };
  return { revision, usage };
}

interface GeneratedContent {
  suggestedTitle: string;
  searchIntent: string;
  topicKeywords: string[];
  structuredHeadings: string[];
  bodyMarkdown: string;
  metaDescription: string;
  internalLinkSuggestions: string[];
  sourceReferences: Array<{ label: string; url: string }>;
  cta: string;
}

function parseJson(value: string): any {
  const stripped = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  return JSON.parse(stripped);
}

function markdownToHtml(markdown: string): string {
  const escaped = markdown.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped.split('\n').map((line) => {
    if (line.startsWith('### ')) return `<h3>${line.slice(4)}</h3>`;
    if (line.startsWith('## ')) return `<h2>${line.slice(3)}</h2>`;
    if (line.startsWith('# ')) return `<h1>${line.slice(2)}</h1>`;
    if (line.startsWith('- ')) return `<li>${line.slice(2)}</li>`;
    return line.trim() ? `<p>${line}</p>` : '';
  }).join('\n');
}

function contentMarkdown(content: GeneratedContent): string {
  const sources = (content.sourceReferences || []).filter((item) => /^https?:\/\//i.test(String(item.url || '')));
  return [
    `# ${clean(content.suggestedTitle, 'Campaign content')}`,
    '', `**Search intent:** ${clean(content.searchIntent, 'Informational')}`,
    '', `**Topic / keywords:** ${(content.topicKeywords || []).map((item) => clean(item)).filter(Boolean).join(', ')}`,
    '', '## Suggested structure', '', ...(content.structuredHeadings || []).map((item) => `- ${clean(item)}`),
    '', String(content.bodyMarkdown || '').trim(),
    '', '## Meta description', '', clean(content.metaDescription),
    '', '## Internal-link suggestions', '', ...(content.internalLinkSuggestions || []).map((item) => `- ${clean(item)}`),
    ...(sources.length ? ['', '## Sources', '', ...sources.map((item) => `- [${clean(item.label, item.url)}](${item.url})`)] : []),
    '', '## CTA', '', clean(content.cta),
  ].join('\n');
}

export async function generateCampaignContent(asset: CampaignAsset, brief: CreativeBrief): Promise<{ revision: CampaignRevision; usage: UsageRecord }> {
  const token = (window as any).__workspaceDb?.token;
  if (!token) throw new Error('Your workspace session is not ready. Refresh, then try again.');
  const evidence = brief.reasoning.evidence.filter((item) => /^https?:\/\//i.test(item.sourceUrl));
  const response = await fetch('/proxy/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': token },
    body: JSON.stringify({
      model: 'gpt-6.1-sol', reasoning_effort: 'medium', max_completion_tokens: 6000, stream: false,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You create truthful, useful SEO and answer-oriented campaign content. Return valid JSON only. Never invent customer stories, quotes, case studies, statistics, product facts or sources. Never promise rankings. Avoid keyword stuffing. Treat analysis and hypotheses as non-factual. Required keys: suggestedTitle, searchIntent, topicKeywords (array), structuredHeadings (array), bodyMarkdown, metaDescription, internalLinkSuggestions (array), sourceReferences (array of {label,url}), cta.' },
        { role: 'user', content: JSON.stringify({ deliverable: asset.contentSubtype, brand: brief.brand, campaignGoal: brief.campaignGoal, approvedAngle: { concept: brief.conceptName, objective: brief.objective, audience: brief.audience, hook: brief.hook, message: brief.coreMessage, cta: brief.cta }, approvedEvidence: evidence, requirements: brief.production.requirements, instruction: asset.prompt || 'Produce the requested deliverable with structured headings and editable Markdown.' }) },
      ],
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(String(data?.error?.message || data?.error || `Content generation failed (HTTP ${response.status}).`));
  const parsed = parseJson(String(data?.choices?.[0]?.message?.content || '')) as GeneratedContent;
  const markdown = contentMarkdown(parsed);
  const createdAt = new Date().toISOString();
  const revision: CampaignRevision = {
    id: uid('revision'), version: asset.revisions.length + 1, status: 'ready', prompt: asset.prompt,
    markdown, html: markdownToHtml(markdown), provider: 'openai-text-generation', model: 'gpt-6.1-sol', createdAt,
  };
  const usage: UsageRecord = {
    id: uid('usage'), campaignId: brief.campaignId, assetId: asset.id, category: 'llm_planning', operation: `generate ${asset.contentSubtype}`,
    provider: 'openai-text-generation', model: 'gpt-6.1-sol', estimateUsd: null, actualUsd: null, credits: null, status: 'complete',
    note: 'Interactive medium-reasoning text call. No fabricated sources or ranking guarantee allowed.', createdAt,
  };
  return { revision, usage };
}

export function addReadyRevision(asset: CampaignAsset, revision: CampaignRevision): CampaignAsset {
  return { ...asset, status: 'ready', qaState: 'needs-review', error: '', revisions: [...asset.revisions, revision], activeRevisionId: revision.id, updatedAt: revision.createdAt };
}

export function activeRevision(asset: CampaignAsset): CampaignRevision | null {
  return asset.revisions.find((item) => item.id === asset.activeRevisionId) || asset.revisions[asset.revisions.length - 1] || null;
}

export function patchActiveText(asset: CampaignAsset, value: { markdown?: string; html?: string }): CampaignAsset {
  const active = activeRevision(asset);
  if (!active) return asset;
  return { ...asset, revisions: asset.revisions.map((item) => item.id === active.id ? { ...item, ...value } : item), updatedAt: new Date().toISOString() };
}

export function downloadTextFile(fileName: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = fileName; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function dimensions(aspect: string): { width: number; height: number } {
  const [a, b] = aspect.split(':').map(Number);
  if (a > 0 && b > 0) {
    const long = 1600;
    return a >= b ? { width: long, height: Math.round(long * b / a) } : { width: Math.round(long * a / b), height: long };
  }
  return { width: 1600, height: 1600 };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The image could not be loaded for composition.'));
    image.src = url;
  });
}

function wrap(ctx: CanvasRenderingContext2D, value: string, maxWidth: number): string[] {
  const words = clean(value).split(' ');
  const lines: string[] = [];
  let line = '';
  words.forEach((word) => {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) { lines.push(line); line = word; } else line = next;
  });
  if (line) lines.push(line);
  return lines;
}

export async function exportComposedImage(asset: CampaignAsset, fileName?: string): Promise<void> {
  const revision = activeRevision(asset);
  if (!revision?.imageUrl) throw new Error('Generate or replace the image before exporting.');
  const { width, height } = dimensions(asset.aspectRatio);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas composition is unavailable in this browser.');
  const image = await loadImage(revision.imageUrl);
  const scale = Math.max(width / image.width, height / image.height);
  const iw = image.width * scale; const ih = image.height * scale;
  ctx.drawImage(image, (width - iw) / 2, (height - ih) / 2, iw, ih);
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, asset.layout === 'minimal' ? 'rgba(0,0,0,.22)' : 'rgba(0,0,0,.72)');
  gradient.addColorStop(.55, 'rgba(0,0,0,.08)'); gradient.addColorStop(1, 'rgba(0,0,0,.78)');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
  const pad = Math.round(width * .065); const max = width - pad * 2;
  ctx.fillStyle = '#F6F2E9'; ctx.font = `800 ${Math.round(width * .07)}px Manrope, sans-serif`;
  let y = pad + Math.round(width * .06);
  wrap(ctx, asset.exactText.headline, max).slice(0, 3).forEach((line) => { ctx.fillText(line, pad, y); y += Math.round(width * .083); });
  ctx.font = `500 ${Math.round(width * .026)}px Manrope, sans-serif`; ctx.fillStyle = '#F6F2E9';
  const bodyY = asset.layout === 'feature-stack' ? y + pad / 2 : height - pad * 2.35;
  let by = bodyY;
  wrap(ctx, asset.exactText.body, max).slice(0, 4).forEach((line) => { ctx.fillText(line, pad, by); by += Math.round(width * .035); });
  const cta = clean(asset.exactText.cta, 'Learn more');
  ctx.font = `800 ${Math.round(width * .024)}px Manrope, sans-serif`;
  const ctaW = ctx.measureText(cta).width + pad * .75; const ctaH = Math.round(width * .06);
  ctx.fillStyle = asset.brandAccent || '#F2B544'; ctx.fillRect(pad, height - pad - ctaH, ctaW, ctaH);
  ctx.fillStyle = '#1B1308'; ctx.fillText(cta, pad + pad * .35, height - pad - ctaH * .34);
  if (asset.brandLogoUrl) {
    try {
      const logo = await loadImage(asset.brandLogoUrl);
      const maxLogoW = width * .18; const maxLogoH = height * .1;
      const logoScale = Math.min(maxLogoW / logo.width, maxLogoH / logo.height);
      const logoW = logo.width * logoScale; const logoH = logo.height * logoScale;
      ctx.drawImage(logo, width - pad - logoW, pad, logoW, logoH);
    } catch { /* A cross-origin logo never blocks the composed campaign image. */ }
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png', 0.96));
  if (!blob) throw new Error('The composed PNG could not be encoded.');
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
  anchor.href = url; anchor.download = fileName || `${asset.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'campaign-image'}.png`; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function humanCheck(asset: CampaignAsset, id: string, label: string, evidence: string, blocking = true): CampaignQualityCheck {
  return { id, label, status: asset.qualityApprovals?.[id] ? 'pass' : 'review', automation: 'human', evidence, blocking };
}

export function campaignQualityChecks(asset: CampaignAsset, brief: CreativeBrief | null): CampaignQualityCheck[] {
  const revision = activeRevision(asset);
  const isVideo = asset.kind === 'video';
  const isImage = asset.kind === 'image';
  const checks: CampaignQualityCheck[] = [];
  checks.push({
    id: 'output', label: 'Output exists and is readable', automation: 'automatic', blocking: true,
    status: isVideo ? 'review' : asset.status === 'failed' ? 'fail' : revision ? 'pass' : 'review',
    evidence: isVideo ? 'The finished MP4 is validated in Script-to-Video Finish.' : revision ? `Ready revision ${revision.version} is present.` : asset.error || 'Generate the asset before final approval.',
  });
  checks.push({
    id: 'aspect', label: 'Aspect ratio', automation: 'automatic', blocking: true,
    status: asset.aspectRatio && asset.aspectRatio !== 'n/a' ? 'pass' : isVideo || isImage ? 'fail' : 'not-applicable',
    evidence: asset.aspectRatio && asset.aspectRatio !== 'n/a' ? `Planned at ${asset.aspectRatio}. Actual video dimensions are checked in Finish.` : 'No visual aspect ratio applies.',
  });
  checks.push(isVideo
    ? humanCheck(asset, 'duration', 'Output duration', `Confirm the finished runtime matches the approved ${brief?.durationSec || 0}s brief; planned duration alone is not proof.`)
    : { id: 'duration', label: 'Output duration', status: 'not-applicable', automation: 'automatic', evidence: 'Not a video asset.', blocking: false });
  checks.push(isVideo
    ? humanCheck(asset, 'av-sync', 'Audio / video sync', 'Play the finished cut and confirm dialogue, captions, music ducking and visual beats remain synchronized.')
    : { id: 'av-sync', label: 'Audio / video sync', status: 'not-applicable', automation: 'automatic', evidence: 'Not a video asset.', blocking: false });
  checks.push(isVideo
    ? humanCheck(asset, 'frames', 'Missing or damaged frames', 'Scrub every cut and confirm there are no black, frozen, corrupt or duplicated transition frames.')
    : { id: 'frames', label: 'Missing or damaged frames', status: 'not-applicable', automation: 'automatic', evidence: 'Not a video asset.', blocking: false });
  checks.push((isImage || isVideo)
    ? humanCheck(asset, 'product-accuracy', 'Product visual accuracy', asset.referenceUrl ? 'Compare against the supplied real-product reference.' : 'No product reference is attached; visual fidelity cannot be automatically substantiated.')
    : { id: 'product-accuracy', label: 'Product visual accuracy', status: 'not-applicable', automation: 'automatic', evidence: 'No generated product visual.', blocking: false });
  const presenterAsset = /ugc|talking head/i.test(asset.contentSubtype);
  checks.push(presenterAsset
    ? humanCheck(asset, 'presenter-consistency', 'Presenter consistency', 'Confirm identity, wardrobe, voice and appearance stay consistent across every shot.')
    : { id: 'presenter-consistency', label: 'Presenter consistency', status: 'not-applicable', automation: 'automatic', evidence: 'No recurring presenter is required.', blocking: false });
  checks.push((isImage || isVideo)
    ? humanCheck(asset, 'brand', 'Brand colours and logo', `${asset.brandAccent ? `Accent ${asset.brandAccent}.` : 'No accent supplied.'} ${asset.brandLogoUrl ? 'Approved logo attached.' : 'No approved logo attached.'}`)
    : { id: 'brand', label: 'Brand colours and logo', status: 'not-applicable', automation: 'automatic', evidence: 'Text deliverable; review brand voice instead.', blocking: false });
  checks.push(humanCheck(asset, 'text', 'Text and caption accuracy', isImage ? 'Headline, body and CTA are deterministic overlays; confirm spelling and line breaks.' : 'Confirm generated copy, dialogue and captions exactly match the approved wording.'));
  checks.push({
    id: 'cta-present', label: 'CTA is present', automation: 'automatic', blocking: true,
    status: clean(asset.exactText?.cta || brief?.cta) ? 'pass' : 'fail', evidence: clean(asset.exactText?.cta || brief?.cta) || 'Add an appropriate CTA before approval.',
  });
  checks.push(humanCheck(asset, 'cta-approved', 'CTA is appropriate and approved', 'Confirm the CTA matches the campaign objective and destination.'));
  checks.push(humanCheck(asset, 'claims', 'Claims are user-approved', brief?.claimReview === 'needs_human_review' || /competitive|comparison/i.test(asset.contentSubtype)
    ? 'Human review is mandatory: this asset includes unsubstantiated or competitor-sensitive claims.'
    : 'Automatic checks cannot substantiate marketing claims; confirm every factual claim against approved evidence.'));
  checks.push(presenterAsset
    ? humanCheck(asset, 'people-disclosure', 'Generated people are not presented as real customers', 'Confirm the presenter is framed as a dramatized/generated performer, never a real customer or endorser.')
    : { id: 'people-disclosure', label: 'Generated-people disclosure', status: 'not-applicable', automation: 'automatic', evidence: 'No generated presenter is required.', blocking: false });
  checks.push(humanCheck(asset, 'rights', 'Asset-use rights', 'Confirm permission or licence for every uploaded logo, product image, presenter reference, source clip, music track and external asset.'));
  return checks;
}

export function qualityState(checks: CampaignQualityCheck[]): CampaignAsset['qaState'] {
  if (checks.some((check) => check.blocking && check.status === 'fail')) return 'fail';
  if (checks.some((check) => check.blocking && check.status === 'review')) return 'needs-review';
  return checks.some((check) => check.status === 'pass') ? 'pass' : 'not-run';
}

export function usageByCategory(state: CampaignProductionState, briefs: CreativeBrief[]): Array<{ category: UsageCategory; estimate: string; actual: string; note: string }> {
  const videoCredits = briefs.filter((brief) => brief.contentKind === 'video').reduce((sum, brief) => sum + Math.max(1, brief.quantity) * Math.max(0, brief.durationSec), 0);
  const categories: UsageCategory[] = ['research', 'llm_planning', 'image', 'video', 'editing', 'rendering'];
  return categories.map((category) => {
    const rows = state.usage.filter((row) => row.category === category);
    const estimatedUsd = rows.reduce((sum, row) => sum + (row.estimateUsd || 0), 0);
    const actualKnown = rows.some((row) => row.actualUsd != null);
    const actualUsd = rows.reduce((sum, row) => sum + (row.actualUsd || 0), 0);
    if (category === 'video') return { category, estimate: `${videoCredits} credits planned`, actual: 'Recorded by Script-to-Video', note: 'One credit per approved finished second; provider receipt remains authoritative.' };
    if (category === 'research') return { category, estimate: '$0 incremental', actual: '$0 here', note: 'Reuses the saved campaign research and competitor intelligence.' };
    if (category === 'rendering') return { category, estimate: 'Quoted in Finish', actual: 'Recorded in renderer', note: 'Final assembly reuses approved clips; no duplicate generation.' };
    return { category, estimate: estimatedUsd ? `~$${estimatedUsd.toFixed(2)}` : 'No spend yet', actual: actualKnown ? `$${actualUsd.toFixed(2)}` : 'Provider receipt unavailable', note: `${rows.length} recorded operation${rows.length === 1 ? '' : 's'}.` };
  });
}
