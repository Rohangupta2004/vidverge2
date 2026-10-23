import { getSessionId, hookUrl } from '../../lib/workspace';
import { saveVidvergeHandoff } from '../../lib/vidvergeHandoff';
import { buildVergeyeVideoHandoff } from '../../lib/vergeyeVideoProduction';
import type { Competitor, Profile, ResearchFinding } from '../Phantom/store';
import { emptyCampaignProduction, type CampaignProductionState } from './campaignProduction';

export const CREATIVE_STRATEGY_SCHEMA_VERSION = 'vergeye.creative-strategy.v2';
const LEGACY_CREATIVE_STRATEGY_SCHEMA_VERSION = 'vergeye.creative-strategy.v1';
export const CREATIVE_BRIEF_SCHEMA_VERSION = 'vergeye.creative-brief.v1';

export const CREATIVE_ANGLE_TYPES = [
  'Problem > Solution',
  'Before > After',
  'Product Demo',
  'Competitive Differentiation',
  'Explainer',
  'Founder Story',
  'UGC-style',
  'Cinematic',
  'SaaS Launch',
  'Curiosity Hook',
  'Feature Highlight',
  'Customer Pain Point',
  'Social Trend Adaptation',
  'Benefit-focused',
] as const;

export type CreativeAngleType = typeof CREATIVE_ANGLE_TYPES[number];
export type ReasoningLabel = 'evidence-backed' | 'analysis' | 'hypothesis';
export type ProductionComplexity = 'low' | 'medium' | 'high';
export type ClaimReview = 'clear' | 'needs_human_review';

export interface ScoreBreakdown {
  brandFit: number;
  audienceRelevance: number;
  evidenceStrength: number;
  productionFeasibility: number;
  distinctiveness: number;
}

export interface AngleEvidence {
  label: string;
  sourceUrl: string;
  findingId?: string;
  observedAt?: string;
}

export interface CreativeAngle {
  id: string;
  type: CreativeAngleType;
  conceptName: string;
  marketingObjective: string;
  targetAudience: string;
  openingHook: string;
  coreMessage: string;
  suggestedVideoStyle: string;
  cta: string;
  recommendedDurationSec: number;
  recommendedPlatforms: string[];
  whyItMayWork: string;
  reasoningType: ReasoningLabel;
  strategicReasoning: string;
  evidence: AngleEvidence[];
  productionComplexity: ProductionComplexity;
  scoreBreakdown: ScoreBreakdown;
  totalScore: number;
  rank: number;
  compatibilityTags: string[];
  claimReview: ClaimReview;
  source: 'agent' | 'custom' | 'combined';
}

export type VideoSubtype =
  | 'UGC' | 'Talking head · Seedance 2.5' | 'Cinematic' | 'SaaS launch'
  | 'Demo' | 'Competitive differentiation' | 'Explainer' | 'Motion graphics'
  | 'Social short' | 'Custom';
export type ImageSubtype = 'Single image ad' | 'Carousel' | 'Product visual' | 'Feature-highlight post' | 'Campaign variation';
export type MarketingSubtype = 'Product article' | 'Educational article' | 'Product comparison' | 'Feature explanation' | 'Industry article' | 'FAQ' | 'SEO landing copy' | 'Answer-oriented AI-search content' | 'Captions' | 'Headlines / CTAs';
export type ContentSubtype = VideoSubtype | ImageSubtype | MarketingSubtype;
export type ContentKind = 'video' | 'image' | 'marketing';

export interface ContentSelection {
  id: string;
  kind: ContentKind;
  subtype: ContentSubtype;
  selected: boolean;
  quantity: number;
  format: string;
  aspectRatio: string;
  durationSec: number;
  notes: string;
}

export interface CreativeBrief {
  schemaVersion: typeof CREATIVE_BRIEF_SCHEMA_VERSION;
  id: string;
  campaignId: string;
  angleId: string;
  contentSelectionId: string;
  contentKind: ContentKind;
  contentSubtype: ContentSubtype;
  quantity: number;
  brand: {
    name: string;
    url: string;
    audience: string;
    positioning: string;
    features: string[];
    logoUrl: string;
    accent: string;
  };
  campaignGoal: string;
  conceptName: string;
  objective: string;
  audience: string;
  hook: string;
  coreMessage: string;
  style: string;
  cta: string;
  durationSec: number;
  format: string;
  aspectRatio: string;
  platforms: string[];
  reasoning: {
    label: ReasoningLabel;
    whyItMayWork: string;
    strategicReasoning: string;
    evidence: AngleEvidence[];
  };
  production: {
    complexity: ProductionComplexity;
    route: 'ads-studio' | 'script-to-video' | 'product-launch' | 'image-composition' | 'marketing-content';
    imageTextPolicy: 'not_applicable' | 'compose_exact_text_after_generation';
    scenePlanningReady: true;
    requirements: string[];
  };
  claimReview: ClaimReview;
  createdAt: string;
}

export interface CreativeStrategyState {
  schemaVersion: typeof CREATIVE_STRATEGY_SCHEMA_VERSION;
  campaignId: string;
  campaignGoal: string;
  direction: string;
  profileApprovedAt: string;
  useCompetitorResearch: boolean;
  generatedAt: string;
  angles: CreativeAngle[];
  selectedAngleIds: string[];
  contentSelections: ContentSelection[];
  briefs: CreativeBrief[];
  /** Phase 4 remains inside the existing saved comparison/campaign row. */
  production?: CampaignProductionState;
}

export interface StrategyGenerationInput {
  brand: Profile;
  competitors: Competitor[];
  findings: ResearchFinding[];
  campaignGoal: string;
  direction: string;
  profileApprovedAt: string;
  useCompetitorResearch: boolean;
  regenerateType?: CreativeAngleType;
}

export interface CostEstimate {
  videoCredits: number;
  videoSeconds: number;
  imageRenders: number;
  marketingOutputs: number;
  summary: string;
}

const videoSubtypes: VideoSubtype[] = [
  'UGC', 'Talking head · Seedance 2.5', 'Cinematic', 'SaaS launch', 'Demo',
  'Competitive differentiation', 'Explainer', 'Motion graphics', 'Social short', 'Custom',
];
const imageSubtypes: ImageSubtype[] = [
  'Single image ad', 'Carousel', 'Product visual', 'Feature-highlight post', 'Campaign variation',
];
const marketingSubtypes: MarketingSubtype[] = [
  'Product article', 'Educational article', 'Product comparison', 'Feature explanation',
  'Industry article', 'FAQ', 'SEO landing copy', 'Answer-oriented AI-search content',
  'Captions', 'Headlines / CTAs',
];

function id(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultContentSelections(): ContentSelection[] {
  return [
    ...videoSubtypes.map((subtype) => ({
      id: `video-${subtype.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      kind: 'video' as const,
      subtype,
      selected: false,
      quantity: 1,
      format: subtype === 'Social short' || subtype === 'UGC' ? 'MP4 · social-ready' : 'MP4',
      aspectRatio: subtype === 'Social short' || subtype === 'UGC' ? '9:16' : '16:9',
      durationSec: subtype === 'SaaS launch' ? 20 : subtype === 'Social short' || subtype === 'UGC' ? 15 : 30,
      notes: subtype === 'Custom'
        ? 'Compatible configuration blend: cinematic opening + approved product demo + talking-head close. Edit the selected angle style to change the blend.'
        : '',
    })),
    ...imageSubtypes.map((subtype) => ({
      id: `image-${subtype.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      kind: 'image' as const, subtype, selected: false,
      quantity: subtype === 'Carousel' ? 5 : subtype === 'Campaign variation' ? 3 : 1,
      format: 'PNG', aspectRatio: subtype === 'Feature-highlight post' ? '4:5' : '1:1', durationSec: 0,
      notes: 'The model creates imagery only. Exact copy and the approved logo are composed deterministically after generation.',
    })),
    ...marketingSubtypes.map((subtype) => ({
      id: `marketing-${subtype.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      kind: 'marketing' as const,
      subtype,
      selected: false,
      quantity: subtype === 'Captions' ? 5 : subtype === 'Headlines / CTAs' ? 3 : 1,
      format: ['Product article', 'Educational article', 'Product comparison', 'Feature explanation', 'Industry article', 'FAQ', 'SEO landing copy', 'Answer-oriented AI-search content'].includes(subtype) ? 'Markdown + HTML' : 'Short-form set',
      aspectRatio: 'n/a', durationSec: 0, notes: '',
    })),
  ];
}

export function emptyCreativeStrategy(): CreativeStrategyState {
  return {
    schemaVersion: CREATIVE_STRATEGY_SCHEMA_VERSION,
    campaignId: id('campaign'),
    campaignGoal: '',
    direction: '',
    profileApprovedAt: '',
    useCompetitorResearch: true,
    generatedAt: '',
    angles: [],
    selectedAngleIds: [],
    contentSelections: defaultContentSelections(),
    briefs: [],
    production: emptyCampaignProduction(),
  };
}

export function upgradeCreativeStrategy(state: unknown): CreativeStrategyState {
  const source = state && typeof state === 'object' ? state as any : {};
  const existing = Array.isArray(source.contentSelections)
    ? source.contentSelections.filter((item: any) => item && typeof item === 'object')
    : [];
  const byId = new Map<string, any>(existing.map((item: any) => [String(item.id || ''), item]));
  const legacyImage = byId.get('image-gpt-background');
  const legacyArticle = byId.get('marketing-seo-aeo-article');
  const legacyLanding = byId.get('marketing-landing-copy');
  const contentSelections = defaultContentSelections().map((item) => {
    const current = byId.get(item.id);
    if (current) return { ...item, ...current, id: item.id, kind: item.kind, subtype: item.subtype };
    if (item.id === 'image-single-image-ad' && legacyImage) return { ...item, selected: Boolean(legacyImage.selected), quantity: Math.max(1, Number(legacyImage.quantity) || 1), aspectRatio: text(legacyImage.aspectRatio, 20) || item.aspectRatio };
    if (item.id === 'marketing-product-article' && legacyArticle) return { ...item, selected: Boolean(legacyArticle.selected), quantity: Math.max(1, Number(legacyArticle.quantity) || 1) };
    if (item.id === 'marketing-seo-landing-copy' && legacyLanding) return { ...item, selected: Boolean(legacyLanding.selected), quantity: Math.max(1, Number(legacyLanding.quantity) || 1) };
    return item;
  });
  const angles = (Array.isArray(source.angles) ? source.angles : [])
    .filter((angle: any) => angle && typeof angle === 'object')
    .map((angle: any, index: number) => normalizeAngle(
      angle,
      isAngleType(angle.type) ? angle.type : CREATIVE_ANGLE_TYPES[index % CREATIVE_ANGLE_TYPES.length],
      index,
    ))
    .sort((a: CreativeAngle, b: CreativeAngle) => b.totalScore - a.totalScore)
    .map((angle: CreativeAngle, index: number) => ({ ...angle, rank: index + 1 }));
  const angleIds = new Set(angles.map((angle: CreativeAngle) => angle.id));
  const selectedAngleIds = (Array.isArray(source.selectedAngleIds) ? source.selectedAngleIds : [])
    .map((value: unknown) => text(value, 100))
    .filter((value: string) => value && angleIds.has(value));
  const briefs = (Array.isArray(source.briefs) ? source.briefs : []).filter((brief: any) => (
    brief && typeof brief === 'object'
    && brief.schemaVersion === CREATIVE_BRIEF_SCHEMA_VERSION
    && brief.reasoning && typeof brief.reasoning === 'object'
    && brief.production && typeof brief.production === 'object'
  ));
  return {
    schemaVersion: CREATIVE_STRATEGY_SCHEMA_VERSION,
    campaignId: text(source.campaignId, 120) || 'campaign_migrated',
    campaignGoal: text(source.campaignGoal, 500),
    direction: text(source.direction, 500),
    profileApprovedAt: text(source.profileApprovedAt, 80),
    useCompetitorResearch: source.useCompetitorResearch !== false,
    generatedAt: text(source.generatedAt, 80),
    angles,
    selectedAngleIds,
    contentSelections,
    briefs,
    production: source.production && typeof source.production === 'object' ? source.production : emptyCampaignProduction(),
  };
}

/** One click plans the requested launch pack without spending anything:
 * 30s hero, three 15s shorts, five static posts, three hook/CTA alternatives,
 * one product article and five captions. Existing selections remain editable. */
export function applyStandardCampaignPack(selections: ContentSelection[]): ContentSelection[] {
  return selections.map((item) => {
    if (item.kind === 'video' && item.subtype === 'Cinematic') return { ...item, selected: true, quantity: 1, durationSec: 30, aspectRatio: '16:9' };
    if (item.kind === 'video' && item.subtype === 'Social short') return { ...item, selected: true, quantity: 3, durationSec: 15, aspectRatio: '9:16' };
    if (item.kind === 'image' && item.subtype === 'Single image ad') return { ...item, selected: true, quantity: 5, aspectRatio: '1:1' };
    if (item.kind === 'marketing' && item.subtype === 'Product article') return { ...item, selected: true, quantity: 1 };
    if (item.kind === 'marketing' && item.subtype === 'Captions') return { ...item, selected: true, quantity: 5 };
    if (item.kind === 'marketing' && item.subtype === 'Headlines / CTAs') return { ...item, selected: true, quantity: 3 };
    return item;
  });
}

function clamp(value: unknown, min: number, max: number): number {
  const parsed = Number(value);
  return Math.min(max, Math.max(min, Number.isFinite(parsed) ? parsed : min));
}

function text(value: unknown, max = 800): string {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function list(value: unknown, maxItems = 8, maxChars = 100): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item, maxChars)).filter(Boolean).slice(0, maxItems);
}

function validUrl(value: unknown): string {
  const url = text(value, 500);
  return /^https?:\/\//i.test(url) ? url : '';
}

function scoreBreakdown(value: any): ScoreBreakdown {
  return {
    brandFit: Math.round(clamp(value?.brandFit, 0, 20)),
    audienceRelevance: Math.round(clamp(value?.audienceRelevance, 0, 20)),
    evidenceStrength: Math.round(clamp(value?.evidenceStrength, 0, 20)),
    productionFeasibility: Math.round(clamp(value?.productionFeasibility, 0, 20)),
    distinctiveness: Math.round(clamp(value?.distinctiveness, 0, 20)),
  };
}

function totalScore(score: ScoreBreakdown): number {
  return score.brandFit + score.audienceRelevance + score.evidenceStrength + score.productionFeasibility + score.distinctiveness;
}

function isAngleType(value: unknown): value is CreativeAngleType {
  return CREATIVE_ANGLE_TYPES.includes(value as CreativeAngleType);
}

function normalizeAngle(raw: any, fallbackType: CreativeAngleType, index: number): CreativeAngle {
  const score = scoreBreakdown(raw?.scoreBreakdown);
  const evidence: AngleEvidence[] = Array.isArray(raw?.evidence)
    ? raw.evidence.map((entry: any) => ({
      label: text(entry?.label, 240), sourceUrl: validUrl(entry?.sourceUrl),
      findingId: text(entry?.findingId, 120) || undefined,
      observedAt: text(entry?.observedAt, 80) || undefined,
    })).filter((entry: AngleEvidence) => entry.label && entry.sourceUrl).slice(0, 6)
    : [];
  const requestedLabel = text(raw?.reasoningType, 30) as ReasoningLabel;
  const reasoningType: ReasoningLabel = evidence.length
    ? 'evidence-backed'
    : requestedLabel === 'analysis' ? 'analysis' : 'hypothesis';
  const complexity = text(raw?.productionComplexity, 20);
  const type = isAngleType(raw?.type) ? raw.type : fallbackType;
  return {
    id: text(raw?.id, 100) || id('angle'),
    type,
    conceptName: text(raw?.conceptName, 120) || type,
    marketingObjective: text(raw?.marketingObjective, 280),
    targetAudience: text(raw?.targetAudience, 280),
    openingHook: text(raw?.openingHook, 320),
    coreMessage: text(raw?.coreMessage, 500),
    suggestedVideoStyle: text(raw?.suggestedVideoStyle, 260),
    cta: text(raw?.cta, 160),
    recommendedDurationSec: Math.round(clamp(raw?.recommendedDurationSec, 6, 120)),
    recommendedPlatforms: list(raw?.recommendedPlatforms, 6, 40),
    whyItMayWork: text(raw?.whyItMayWork, 500),
    reasoningType,
    strategicReasoning: text(raw?.strategicReasoning, 600),
    evidence,
    productionComplexity: complexity === 'low' || complexity === 'high' ? complexity : 'medium',
    scoreBreakdown: score,
    totalScore: totalScore(score),
    rank: index + 1,
    compatibilityTags: list(raw?.compatibilityTags, 8, 50),
    claimReview: text(raw?.claimReview, 40) === 'needs_human_review' ? 'needs_human_review' : 'clear',
    source: raw?.source === 'custom' || raw?.source === 'combined' ? raw.source : 'agent',
  };
}

export function validateAndRankAngles(value: unknown): CreativeAngle[] {
  const raw = Array.isArray(value) ? value : [];
  const byType = new Map<CreativeAngleType, any>();
  raw.forEach((entry) => { if (isAngleType(entry?.type) && !byType.has(entry.type)) byType.set(entry.type, entry); });
  const normalized = CREATIVE_ANGLE_TYPES.map((type, index) => normalizeAngle(byType.get(type) || {}, type, index));
  return normalized.sort((a, b) => b.totalScore - a.totalScore).map((angle, index) => ({ ...angle, rank: index + 1 }));
}

export async function generateCreativeAngles(input: StrategyGenerationInput): Promise<CreativeAngle[]> {
  const token = (window as any).__workspaceDb?.token;
  if (!token) throw new Error('Your workspace session is not ready. Refresh, then try again.');
  const session = getSessionId();
  if (!session) throw new Error('Sign in before generating a strategy so the campaign can be saved to your workspace.');
  const response = await fetch(hookUrl('vergeye-creative-strategy'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Id': session,
      'X-Workspace-DB-Token': token,
    },
    body: JSON.stringify({
      schemaVersion: CREATIVE_STRATEGY_SCHEMA_VERSION,
      brandProfile: input.brand,
      competitors: input.useCompetitorResearch ? input.competitors : [],
      approvedFindings: input.useCompetitorResearch ? input.findings : [],
      campaignGoal: input.campaignGoal,
      direction: input.direction,
      profileApprovedAt: input.profileApprovedAt,
      regenerateType: input.regenerateType || '',
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new Error(String(data?.error || `Creative strategy failed (HTTP ${response.status}).`));
  const responseVersion = text(data?.schemaVersion, 80);
  if (responseVersion && responseVersion !== CREATIVE_STRATEGY_SCHEMA_VERSION && responseVersion !== LEGACY_CREATIVE_STRATEGY_SCHEMA_VERSION) {
    throw new Error('The strategy service returned an incompatible response. Retry to generate a fresh set of angles.');
  }
  return validateAndRankAngles(data.angles);
}

export function combineAngles(angles: CreativeAngle[]): CreativeAngle {
  const chosen = angles.slice(0, 3);
  const mergedScore: ScoreBreakdown = {
    brandFit: Math.round(chosen.reduce((sum, item) => sum + item.scoreBreakdown.brandFit, 0) / chosen.length),
    audienceRelevance: Math.round(chosen.reduce((sum, item) => sum + item.scoreBreakdown.audienceRelevance, 0) / chosen.length),
    evidenceStrength: Math.round(chosen.reduce((sum, item) => sum + item.scoreBreakdown.evidenceStrength, 0) / chosen.length),
    productionFeasibility: Math.round(Math.max(0, chosen.reduce((sum, item) => sum + item.scoreBreakdown.productionFeasibility, 0) / chosen.length - 2)),
    distinctiveness: Math.round(chosen.reduce((sum, item) => sum + item.scoreBreakdown.distinctiveness, 0) / chosen.length),
  };
  const evidence = chosen.flatMap((item) => item.evidence).filter((item, index, all) => all.findIndex((candidate) => candidate.sourceUrl === item.sourceUrl && candidate.label === item.label) === index).slice(0, 6);
  return {
    ...chosen[0],
    id: id('combined'),
    type: chosen[0].type,
    conceptName: chosen.map((item) => item.conceptName).join(' × ').slice(0, 120),
    marketingObjective: chosen.map((item) => item.marketingObjective).filter(Boolean).join(' + ').slice(0, 280),
    openingHook: chosen.map((item) => item.openingHook).filter(Boolean).join(' Then: ').slice(0, 320),
    coreMessage: chosen.map((item) => item.coreMessage).filter(Boolean).join(' ').slice(0, 500),
    suggestedVideoStyle: chosen.map((item) => item.suggestedVideoStyle).filter(Boolean).join(' + ').slice(0, 260),
    whyItMayWork: `Combination hypothesis: ${chosen.map((item) => item.conceptName).join(', ')} may work together because their messages are complementary. Validate the combined hook before production.`.slice(0, 500),
    reasoningType: evidence.length ? 'evidence-backed' : 'hypothesis',
    strategicReasoning: 'Combined by the user from compatible selected directions. The blended score is a planning aid, not a performance prediction.',
    evidence,
    productionComplexity: chosen.some((item) => item.productionComplexity === 'high') ? 'high' : chosen.some((item) => item.productionComplexity === 'medium') ? 'medium' : 'low',
    scoreBreakdown: mergedScore,
    totalScore: totalScore(mergedScore),
    rank: 0,
    compatibilityTags: Array.from(new Set(chosen.flatMap((item) => item.compatibilityTags))).slice(0, 8),
    claimReview: chosen.some((item) => item.claimReview === 'needs_human_review') ? 'needs_human_review' : 'clear',
    source: 'combined',
  };
}

export function customAngle(partial: Partial<CreativeAngle>): CreativeAngle {
  return normalizeAngle({
    ...partial,
    id: id('custom'),
    type: partial.type || 'Benefit-focused',
    source: 'custom',
    reasoningType: 'hypothesis',
    strategicReasoning: partial.strategicReasoning || 'User-authored strategic hypothesis; validate before production.',
    scoreBreakdown: partial.scoreBreakdown || { brandFit: 14, audienceRelevance: 14, evidenceStrength: 6, productionFeasibility: 14, distinctiveness: 14 },
  }, isAngleType(partial.type) ? partial.type : 'Benefit-focused', 0);
}

export function estimateCreativeCost(selections: ContentSelection[], selectedAngleCount: number): CostEstimate {
  const multiplier = Math.max(1, selectedAngleCount);
  let videoSeconds = 0;
  let imageRenders = 0;
  let marketingOutputs = 0;
  selections.filter((item) => item.selected).forEach((item) => {
    const quantity = Math.max(1, Math.round(item.quantity || 1));
    if (item.kind === 'video') videoSeconds += quantity * Math.max(1, Math.round(item.durationSec || 1)) * multiplier;
    if (item.kind === 'image') imageRenders += quantity * multiplier;
    if (item.kind === 'marketing') marketingOutputs += quantity * multiplier;
  });
  const parts = [`${videoSeconds} video credit${videoSeconds === 1 ? '' : 's'}`];
  if (imageRenders) parts.push(`${imageRenders} image render${imageRenders === 1 ? '' : 's'} (provider quote required)`);
  if (marketingOutputs) parts.push(`${marketingOutputs} marketing output${marketingOutputs === 1 ? '' : 's'} (planning is free)`);
  return { videoCredits: videoSeconds, videoSeconds, imageRenders, marketingOutputs, summary: parts.join(' · ') };
}

function productionRoute(selection: ContentSelection): CreativeBrief['production']['route'] {
  if (selection.kind === 'image') return 'image-composition';
  if (selection.kind === 'marketing') return 'marketing-content';
  // Phase 3 invariant: every Vergeye video style is configuration over the
  // existing five-stage Script-to-Video engine. SaaS Launch still requests the
  // approved Product Launch component workflow inside that shared engine; it
  // is not a second video project, queue, storyboard or editor.
  return 'script-to-video';
}

export function buildCreativeBriefs(state: CreativeStrategyState, brand: Profile): CreativeBrief[] {
  const angles = state.angles.filter((angle) => state.selectedAngleIds.includes(angle.id));
  const selections = state.contentSelections.filter((item) => item.selected);
  const createdAt = new Date().toISOString();
  return angles.flatMap((angle) => selections.map((selection) => ({
    schemaVersion: CREATIVE_BRIEF_SCHEMA_VERSION,
    id: id('brief'),
    campaignId: state.campaignId,
    angleId: angle.id,
    contentSelectionId: selection.id,
    contentKind: selection.kind,
    contentSubtype: selection.subtype,
    quantity: Math.max(1, Math.round(selection.quantity || 1)),
    brand: {
      name: text(brand.name, 120), url: validUrl(brand.url), audience: text(brand.audience, 300),
      positioning: text(brand.positioning || brand.usp, 400), features: list(brand.features, 10, 120),
      logoUrl: validUrl(brand.logoUrl), accent: text(brand.accent, 30),
    },
    campaignGoal: text(state.campaignGoal, 500),
    conceptName: angle.conceptName,
    objective: angle.marketingObjective,
    audience: angle.targetAudience,
    hook: angle.openingHook,
    coreMessage: angle.coreMessage,
    style: angle.suggestedVideoStyle,
    cta: angle.cta,
    durationSec: selection.kind === 'video' ? Math.max(1, Math.round(selection.durationSec)) : 0,
    format: selection.format,
    aspectRatio: selection.aspectRatio,
    platforms: angle.recommendedPlatforms,
    reasoning: {
      label: angle.reasoningType,
      whyItMayWork: angle.whyItMayWork,
      strategicReasoning: angle.strategicReasoning,
      evidence: angle.evidence,
    },
    production: {
      complexity: angle.productionComplexity,
      route: productionRoute(selection),
      imageTextPolicy: selection.kind === 'image' ? 'compose_exact_text_after_generation' : 'not_applicable',
      scenePlanningReady: true,
      requirements: [
        selection.notes,
        angle.claimReview === 'needs_human_review' ? 'Human review required before using factual comparison claims.' : '',
        selection.kind === 'image' ? 'Generate imagery without exact ad copy; add exact text in the composition/overlay step.' : '',
        angle.type === 'UGC-style' ? 'Do not present this as a real customer testimonial or endorsement.' : '',
      ].filter(Boolean),
    },
    claimReview: angle.claimReview,
    createdAt,
  })));
}

export function saveBriefHandoff(brief: CreativeBrief): string | null {
  if (brief.production.route === 'image-composition' || brief.production.route === 'marketing-content') return null;
  const appId = 'script-to-video';
  const scriptToVideo = buildVergeyeVideoHandoff(brief);
  saveVidvergeHandoff({
    appId,
    prompt: scriptToVideo.generatedScript,
    videoIntegration: 'image-and-video-generation',
    videoModel: scriptToVideo.recommendedModel,
    scriptToVideo,
  });
  return appId;
}
