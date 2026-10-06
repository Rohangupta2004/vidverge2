/**
 * VERGEYE — the shapes the four screens pass between each other, and the thin
 * domain wrappers over vergeye-ops.
 *
 * One analysis is ONE object (`Analysis`) that each screen adds to: Screen 1
 * writes `brand`, Screen 2 writes `competitors`, Screen 3 writes `matrix` and
 * `insights`, Screen 4 writes `scriptPlan` and the video URLs. That is also
 * exactly the row shape of vergeye_comparisons, so saving is a single call and
 * reopening a saved comparison restores the whole flow rather than a snapshot
 * of one screen.
 */

import { ops } from './api';

export const MATRIX_ROWS = [
  'Pricing',
  'Key features',
  'Target audience',
  'USP',
  'Strengths',
  'Weaknesses',
  'Positioning',
] as const;

export interface Profile {
  id: string;
  url: string;
  name: string;
  tagline: string;
  category: string;
  audience: string;
  pricing: string;
  usp: string;
  positioning: string;
  features: string[];
  colors: string[];
  accent: string;
  logoUrl: string;
  fetched: boolean;
}

export interface Competitor extends Partial<Profile> {
  id: string;
  url: string;
  name: string;
  included: boolean;
  source: 'discovered' | 'manual';
  fetched: boolean;
  why?: string;
  error?: string;
}

export interface Matrix {
  rows: string[];
  columns: string[];
  cells: Record<string, string>;
}

export interface Insights {
  competitorsBetter: string[];
  yourAdvantages: string[];
  positioningGaps: string[];
  messagingImprovements: string[];
}

export interface Scene {
  beat: string;
  narration: string;
  prompt: string;
}

export interface Overlay {
  headline: string;
  stat: string;
  statLabel: string;
  lowerThirds: string[];
  cta: string;
}

export interface ScriptPlan {
  script: string;
  durationSec: number;
  scenes: Scene[];
  overlay: Overlay;
}

export interface VideoJob {
  veoJobId?: string;
  veoStatus?: string;
  veoProgress?: number;
  remotionOperationId?: string;
  remotionStatus?: string;
  model?: string;
  clips?: number;
  error?: string;
}

export type AnalysisStatus = 'brand' | 'competitors' | 'compared' | 'scripted' | 'rendering' | 'video' | 'failed';

export interface Analysis {
  id: number;
  name: string;
  brandUrl: string;
  brandName: string;
  accentColor: string;
  brand: Profile | null;
  competitors: Competitor[];
  matrix: Matrix | null;
  insights: Insights | null;
  script: string;
  scriptPlan: ScriptPlan | null;
  characterUrl: string;
  mockupUrl: string;
  rawVideoUrl: string;
  videoUrl: string;
  videoJob: VideoJob | null;
  status: AnalysisStatus;
  handoff: { app?: string; at?: string } | null;
}

export interface SavedSummary {
  id: number;
  name: string;
  brandName: string;
  brandUrl: string;
  accentColor: string;
  status: string;
  videoUrl: string;
  competitorCount: number;
  hasScript: boolean;
  createdAt: string;
  updatedAt: string;
}

export function emptyAnalysis(): Analysis {
  return {
    id: 0,
    name: '',
    brandUrl: '',
    brandName: '',
    accentColor: '',
    brand: null,
    competitors: [],
    matrix: null,
    insights: null,
    script: '',
    scriptPlan: null,
    characterUrl: '',
    mockupUrl: '',
    rawVideoUrl: '',
    videoUrl: '',
    videoJob: null,
    status: 'brand',
    handoff: null,
  };
}

/** "Pictory vs 6 competitors" — the auto-name the Saved tab lists rows under. */
export function autoName(brandName: string, competitors: Competitor[]): string {
  const included = competitors.filter((c) => c.included && c.fetched).length;
  const subject = (brandName || 'Your brand').slice(0, 60);
  if (included === 0) return subject;
  return `${subject} vs ${included} competitor${included === 1 ? '' : 's'}`;
}

export function includedCompetitors(analysis: Analysis): Competitor[] {
  return analysis.competitors.filter((c) => c.included && c.fetched);
}

// ---------------------------------------------------------------------------
// Research
// ---------------------------------------------------------------------------
export async function analyzeBrand(url: string): Promise<{ brand: Profile | null; error: string }> {
  const res = await ops('brand.analyze', { url });
  if (res.ok === false) return { brand: null, error: String(res.error || 'That site could not be read.') };
  return { brand: res.brand as Profile, error: '' };
}

export async function discoverCompetitors(brand: Profile): Promise<{ competitors: Competitor[]; note: string }> {
  const res = await ops('competitors.discover', {
    brand: { name: brand.name, category: brand.category, url: brand.url },
  });
  return { competitors: (res.competitors || []) as Competitor[], note: String(res.note || '') };
}

export async function analyzeCompetitor(seed: Partial<Competitor>): Promise<Competitor> {
  const res = await ops('competitor.analyze', {
    url: seed.url,
    name: seed.name,
    why: seed.why,
    source: seed.source || 'discovered',
    included: seed.included !== false,
  });
  return res.competitor as Competitor;
}

export async function buildMatrix(brand: Profile, competitors: Competitor[]): Promise<Matrix> {
  const res = await ops('compare.build', { brand, competitors });
  return res.matrix as Matrix;
}

export async function buildInsights(brand: Profile, competitors: Competitor[], matrix: Matrix): Promise<Insights> {
  const res = await ops('compare.insights', { brand, competitors, matrix });
  return res.insights as Insights;
}

export async function writeScript(brand: Profile, competitors: Competitor[], insights: Insights, matrix: Matrix | null): Promise<ScriptPlan> {
  const res = await ops('script.write', { brand, competitors, insights, matrix });
  return res.plan as ScriptPlan;
}

// ---------------------------------------------------------------------------
// Video
// ---------------------------------------------------------------------------
export async function startVideo(plan: ScriptPlan, options: { model: string; characterUrl: string; mockupUrl: string }) {
  const res = await ops('video.start', { plan, ...options });
  return res.job as { jobId: string; model: string; clips: number };
}

export async function pollVideo(jobId: string) {
  const res = await ops('video.status', { jobId });
  return res.state as { status: string; progress: number; videoUrl: string; clips: number; error: string };
}

export async function finishVideo(input: {
  videoUrl: string;
  durationSec: number;
  accent: string;
  brandName: string;
  tagline: string;
  overlay: Overlay;
  logoUrl: string;
  mockupUrl: string;
}) {
  const res = await ops('video.finish', input);
  return res.render as { operationId: string; frames: number };
}

export async function pollFinish(operationId: string) {
  const res = await ops('video.finish_status', { operationId });
  return res.state as { status: string; videoUrl: string; error: string };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
export async function saveAnalysis(analysis: Analysis): Promise<number> {
  const res = await ops('save', {
    id: analysis.id || undefined,
    name: analysis.name || autoName(analysis.brandName, analysis.competitors),
    brandUrl: analysis.brandUrl,
    brandName: analysis.brandName,
    accentColor: analysis.accentColor,
    brand: analysis.brand,
    competitors: analysis.competitors,
    matrix: analysis.matrix,
    insights: analysis.insights,
    script: analysis.script,
    scriptPlan: analysis.scriptPlan,
    characterUrl: analysis.characterUrl,
    mockupUrl: analysis.mockupUrl,
    rawVideoUrl: analysis.rawVideoUrl,
    videoUrl: analysis.videoUrl,
    videoJob: analysis.videoJob,
    status: analysis.status,
  });
  return Number(res.id || 0);
}

export async function listSaved(): Promise<SavedSummary[]> {
  const res = await ops('list', { limit: 40 });
  return (res.comparisons || []) as SavedSummary[];
}

export async function loadAnalysis(id: number): Promise<Analysis> {
  const res = await ops('get', { id });
  const row = (res.comparison || {}) as any;
  return {
    ...emptyAnalysis(),
    ...row,
    competitors: Array.isArray(row.competitors) ? row.competitors : [],
    status: (row.status || 'brand') as AnalysisStatus,
  };
}

export async function removeAnalysis(id: number): Promise<void> {
  await ops('remove', { id });
}

export async function recordHandoff(id: number, app: string): Promise<void> {
  await ops('handoff', { id, app });
}
