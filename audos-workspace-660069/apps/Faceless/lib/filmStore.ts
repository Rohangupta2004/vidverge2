import { waitForDbSession } from '../../../lib/reelioStudio';
import type {
  AssetTier,
  DepthBackground,
  FacelessBeat,
  FacelessFilmInput,
  FacelessMode,
  FilmRunState,
  FilmSettings,
  FinalFilm,
  ResolvedAsset,
  StageUpdate,
} from '../types/editorial';
import { normaliseSettings } from './facelessOptions';

export const FILMS_TABLE = 'faceless_films';
export const ASSETS_TABLE = 'faceless_assets';
const RESUME_WINDOW_MS = 3 * 60 * 60 * 1000;

export type FilmStatus = 'running' | 'completed' | 'failed';

export interface FacelessFilmRow {
  id: string;
  topic: string | null;
  mode: string | null;
  script: string | null;
  status: FilmStatus | null;
  stage: string | null;
  progress_log: StageUpdate[] | null;
  narration_url: string | null;
  narration_duration: number | string | null;
  narration_timestamps: unknown[] | null;
  analysis: any;
  timeline: any;
  visual_plan: any;
  resolved_assets: Record<string, ResolvedAsset> | null;
  prepared_assets: any[] | null;
  motion_plan: any;
  film_spec: any;
  spec_version: number | null;
  spec_history: any[] | null;
  mechanical_qa: any;
  creative_qa: any;
  revision_count: number | null;
  render_url: string | null;
  frames: any[] | null;
  final_url: string | null;
  cost_estimate: number | string | null;
  error_msg: string | null;
  /** The brief's delivery options, plus the documentary depth plate. */
  settings: StoredSettings | null;
  created_at?: string;
  updated_at?: string;
}

/**
 * One json column rather than seven scalar ones. These are presentation
 * choices the pipeline reads as a unit, and a resumed run wants them back
 * exactly as they were rather than merged column by column.
 */
export interface StoredSettings {
  options?: FilmSettings | null;
  depthBackground?: DepthBackground | null;
}

export interface FacelessAssetRow {
  id: string;
  film_id: string | null;
  beat_id: string | null;
  tier: number | null;
  kind: string | null;
  source: string | null;
  url: string;
  thumb_url: string | null;
  title: string | null;
  description: string | null;
  tags: string[] | null;
  width: number | null;
  height: number | null;
  duration: number | string | null;
  cost: number | string | null;
  prompt: string | null;
  query: string | null;
  created_at?: string;
}

function db(): any {
  if (typeof window === 'undefined') return null;
  return (window as any).__workspaceDb || null;
}

function clientOrThrow(): any {
  const client = db();
  if (!client || typeof client.from !== 'function') {
    throw new Error('The workspace database is not available in this context.');
  }
  return client;
}

export async function createFilmRow(id: string, input: FacelessFilmInput): Promise<void> {
  await waitForDbSession();
  await clientOrThrow().from(FILMS_TABLE).insert({
    id,
    topic: input.topic,
    mode: input.mode || 'auto',
    script: input.script,
    settings: { options: input.settings || null, depthBackground: null } as StoredSettings,
    status: 'running',
    stage: 'narration',
    progress_log: [],
    resolved_assets: {},
    prepared_assets: [],
    spec_history: [],
    revision_count: 0,
    cost_estimate: 0,
    error_msg: null,
  });
}

async function updateFilm(id: string, patch: Partial<FacelessFilmRow>): Promise<void> {
  await waitForDbSession();
  await clientOrThrow().from(FILMS_TABLE).update(id, {
    ...patch,
    updated_at: new Date().toISOString(),
  });
}

/**
 * Stage and state callbacks are intentionally fire-and-forget. Keep every DB
 * write in one chain so a slow earlier request cannot land after a later one
 * and rewind the stored stage or progress log.
 */
let filmWrites: Promise<unknown> = Promise.resolve();
const progressByFilm = new Map<string, StageUpdate[]>();

function queueFilmPatch(id: string, patch: Partial<FacelessFilmRow>): Promise<void> {
  filmWrites = filmWrites
    .catch(() => undefined)
    .then(() => updateFilm(id, patch))
    .catch((error) => {
      console.warn('[Faceless] persistence write failed:', error);
    });
  return filmWrites as Promise<void>;
}

export function queueStageUpdate(id: string, update: StageUpdate): Promise<void> {
  const previous = progressByFilm.get(id) || [];
  const last = previous[previous.length - 1];
  const duplicate = last
    && last.stage === update.stage
    && last.state === update.state
    && last.label === update.label
    && last.detail === update.detail
    && last.progress === update.progress;
  const progress = duplicate ? previous : [...previous, update].slice(-120);
  progressByFilm.set(id, progress);

  const status: FilmStatus = update.state === 'failed'
    ? 'failed'
    : update.stage === 'finalize' && update.state === 'done'
      ? 'completed'
      : 'running';

  return queueFilmPatch(id, {
    stage: update.stage,
    status,
    progress_log: progress,
    ...(update.state === 'failed' ? { error_msg: update.detail || update.label } : {}),
  });
}

/**
 * The depth plate is written separately from the run state because it arrives
 * on its own schedule — often after the pipeline has moved several stages on
 * — and it belongs to the same json column as the options.
 */
export function queueDepthBackground(
  id: string,
  options: FilmSettings | null,
  depthBackground: DepthBackground | null,
): Promise<void> {
  return queueFilmPatch(id, { settings: { options, depthBackground } });
}

export function queueRunState(state: FilmRunState): Promise<void> {
  const latestSpec = state.specs[state.specs.length - 1] || null;
  const latestRender = state.renders[state.renders.length - 1] || null;
  return queueFilmPatch(state.filmId, {
    ...(state.final ? { status: 'completed' as const } : {}),
    narration_url: state.narration?.audioUrl || null,
    narration_duration: state.narration?.duration ?? null,
    narration_timestamps: state.narration?.wordTimestamps || null,
    analysis: state.analysis,
    timeline: state.timeline,
    visual_plan: state.visualPlan,
    resolved_assets: state.resolvedAssets,
    prepared_assets: state.preparedAssets,
    motion_plan: state.motionPlan,
    film_spec: latestSpec,
    spec_version: latestSpec?.version ?? null,
    spec_history: state.specs,
    mechanical_qa: state.mechanicalQA,
    creative_qa: state.creativeQA,
    revision_count: state.revisionsUsed,
    render_url: latestRender?.mp4Url || null,
    frames: latestRender?.frames || null,
    final_url: state.final?.mp4Url || null,
    cost_estimate: state.spend,
  });
}

export async function getFilm(id: string): Promise<FacelessFilmRow | null> {
  const client = db();
  if (!client || typeof client.from !== 'function') return null;
  try {
    const result = await client.from(FILMS_TABLE, { shared: true }).getById(id);
    return result?.data?.id ? result.data as FacelessFilmRow : null;
  } catch (error) {
    console.warn('[Faceless] film read failed:', error);
    return null;
  }
}

export async function findRecentUnfinishedFilm(): Promise<FacelessFilmRow | null> {
  const client = db();
  if (!client || typeof client.from !== 'function') return null;
  try {
    const result = await client.from(FILMS_TABLE, { shared: true })
      .eq('status', 'running')
      .orderBy('created_at', 'desc')
      .limit(20)
      .get();
    const rows: FacelessFilmRow[] = Array.isArray(result?.data) ? result.data : [];
    const cutoff = Date.now() - RESUME_WINDOW_MS;
    return rows.find((row) => {
      const created = row.created_at ? new Date(row.created_at).getTime() : NaN;
      return Number.isNaN(created) || created >= cutoff;
    }) || null;
  } catch (error) {
    console.warn('[Faceless] recent-film query failed:', error);
    return null;
  }
}

export function settingsFromRow(row: FacelessFilmRow): FilmSettings {
  return normaliseSettings(row.settings?.options);
}

export function depthFromRow(row: FacelessFilmRow): DepthBackground | null {
  const stored = row.settings?.depthBackground;
  return stored && typeof stored === 'object' && stored.stillUrl ? stored : null;
}

export function runFromRow(row: FacelessFilmRow): FilmRunState {
  const specs = Array.isArray(row.spec_history)
    ? row.spec_history
    : row.film_spec ? [row.film_spec] : [];
  const renders = row.render_url ? [{
    mp4Url: row.render_url,
    frames: Array.isArray(row.frames) ? row.frames : [],
    adapter: 'persisted',
    durationMs: Number(row.narration_duration || 0) * 1000,
  }] : [];
  const narration = row.narration_url ? {
    audioUrl: row.narration_url,
    wordTimestamps: Array.isArray(row.narration_timestamps) ? row.narration_timestamps as any : [],
    duration: Number(row.narration_duration || 0),
    voiceId: 'persisted',
    timestampsMeasured: true,
  } : null;

  return {
    filmId: row.id,
    input: {
      topic: row.topic || 'Untitled film',
      script: row.script || '',
      mode: normaliseMode(row.mode),
      settings: settingsFromRow(row),
    },
    narration,
    analysis: row.analysis || null,
    assetIndex: null,
    timeline: row.timeline || null,
    visualPlan: row.visual_plan || null,
    resolvedAssets: row.resolved_assets || {},
    preparedAssets: Array.isArray(row.prepared_assets) ? row.prepared_assets : [],
    motionPlan: row.motion_plan || null,
    specs,
    renders,
    mechanicalQA: row.mechanical_qa || null,
    creativeQA: row.creative_qa || null,
    revisionsUsed: Number(row.revision_count || 0),
    spend: Number(row.cost_estimate || 0),
    final: finalFromRow(row),
  };
}

export function finalFromRow(row: FacelessFilmRow): FinalFilm | null {
  // Historical runs may have a finished render but no final_url because they
  // stopped in the removed QA/revision stages. The render is now the final.
  const outputUrl = row.final_url || row.render_url;
  if (!outputUrl) return null;
  const resolved = row.resolved_assets || {};
  const tierMix = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<AssetTier, number>;
  Object.values(resolved).forEach((asset) => {
    const tier = Number(asset?.tier) as AssetTier;
    if (tier >= 1 && tier <= 5) tierMix[tier] += 1;
  });
  return {
    filmId: row.id,
    mp4Url: outputUrl,
    durationSeconds: Number(row.narration_duration || row.timeline?.duration || 0),
    mode: normaliseMode(row.mode) || row.analysis?.mode || 'documentary',
    specVersion: Number(row.spec_version || row.film_spec?.version || 1),
    beatCount: Array.isArray(row.timeline?.beats) ? row.timeline.beats.length : Object.keys(resolved).length,
    tierMix,
    estimatedCost: Number(row.cost_estimate || 0),
    narrationUrl: row.narration_url || '',
    mechanicalQA: row.mechanical_qa || null,
    creativeQA: row.creative_qa || null,
    revisionsUsed: Number(row.revision_count || 0),
    finalizedAt: row.updated_at || row.created_at || new Date().toISOString(),
  };
}

function normaliseMode(value: unknown): FacelessMode | undefined {
  const mode = String(value || '');
  return ['documentary', 'explainer', 'news', 'business', 'story', 'educational'].includes(mode)
    ? mode as FacelessMode
    : undefined;
}

export async function listStoredAssets(): Promise<FacelessAssetRow[]> {
  const client = db();
  if (!client || typeof client.from !== 'function') return [];
  const result = await client.from(ASSETS_TABLE, { shared: true })
    .orderBy('created_at', 'desc')
    .limit(500)
    .get();
  return Array.isArray(result?.data) ? result.data as FacelessAssetRow[] : [];
}

export async function saveGeneratedAsset(input: {
  filmId: string;
  beat: FacelessBeat;
  asset: ResolvedAsset;
  prompt: string;
}): Promise<void> {
  await waitForDbSession();
  const { filmId, beat, asset, prompt } = input;
  const id = `fa_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  await clientOrThrow().from(ASSETS_TABLE).insert({
    id,
    film_id: filmId,
    beat_id: beat.id,
    tier: asset.tier,
    kind: asset.type,
    source: asset.provider || 'faceless-generated',
    url: asset.url,
    thumb_url: null,
    title: `${beat.visualType.replace(/_/g, ' ')} — ${beat.id}`,
    description: beat.visualIntent,
    tags: [beat.visualType, beat.narrativePurpose, ...(beat.emphasisWords || [])].slice(0, 16),
    width: asset.width || null,
    height: asset.height || null,
    duration: asset.duration || null,
    cost: asset.cost || 0,
    prompt,
    query: beat.assetDecision.searchQuery || null,
  });
}
