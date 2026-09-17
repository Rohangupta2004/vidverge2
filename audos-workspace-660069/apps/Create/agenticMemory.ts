/**
 * VidVerge — the agentic video system: PERSISTENT PRODUCTION MEMORY.
 *
 * WHY THIS EXISTS. A five-minute series is up to 38 renders and hours of wall
 * clock. Losing that is not an inconvenience, it is losing the production — and
 * the two ways to lose it are both mundane: the visitor opens another app (the
 * shell unmounts the whole React tree), or they reload. So every outcome is
 * written down the moment it lands:
 *
 *   MASTER REFERENCES  — character, environment, object, product
 *   SCENE REFERENCES   — the plate each chapter anchors to
 *   BEST FRAMES        — per shot, as chosen by the Frame Analyzer
 *   LAST FRAMES        — per shot, the clip's true tail
 *   VISUAL MEMORY      — per shot: world, objects, lighting, camera, motion, motif
 *   RUNNING STATE      — character, object, camera and narrative state
 *
 * THE PAYOFF IS PARTIAL REGENERATION. Because a finished shot carries its clip
 * URL, its approved frame and the decision that produced it, a run that loses 3
 * of 50 shots re-renders exactly those 3 and re-runs continuity around them.
 * Nothing already paid for is ever rendered twice.
 *
 * TWO TIERS, ON PURPOSE. WorkspaceDB is the durable copy; localStorage is the
 * instant one. A visitor with no verified session cannot write to the table
 * (that is platform hardening, not a fault here), so localStorage is what makes
 * the run survive an app switch for them too — and the UI says plainly when the
 * durable copy could not be made rather than pretending it was.
 */
import { sessionId } from './studioApi';
import { clampText, type CharacterRef } from './videoTypes';
import { waitForDbSession, writeFailureNotice } from '../../lib/reelioStudio';
import {
  EMPTY_MEMORY,
  type CharacterMaster,
  type EnvironmentMaster,
  type ObjectMaster,
  type ProductMaster,
  type ProductionMemory,
  type ShotState,
  type StoryPlan,
  type UIState,
  type VisualMemoryEntry,
} from './agenticTypes';

const PRODUCTIONS_TABLE = 'video_productions';

function db(): any {
  if (typeof window === 'undefined') return null;
  return (window as any).__workspaceDb || null;
}

function isHttpUrl(value: unknown): boolean {
  return typeof value === 'string' && /^https?:\/\//.test(value);
}

// ---------------------------------------------------------------------------
// Building the masters
// ---------------------------------------------------------------------------
/**
 * BUILD THE CHARACTER_MASTER — once per production, then never rebuilt. That is
 * the entire anti-drift mechanism: every shot with a person in it points back
 * at THIS object rather than at the shot before it, so shot 30 is still tied to
 * the same face as shot 1 instead of to 29 generations of drift.
 *
 * The written description is clamped BEFORE the "identical in every shot" note
 * is appended, so that note can never be the thing truncation removes.
 */
export function buildCharacterMaster(input: {
  name: string;
  description: string;
  faceReference?: string;
  fullBodyReference?: string;
  outfitReference?: string;
  hair?: string;
  age?: string;
  visualStyle?: string;
}): CharacterMaster {
  const name = clampText(input.name || 'The lead', 48);
  const description = clampText(input.description, 300);
  const tail = ' Identical face, hair, build and wardrobe in every shot.';
  const room = Math.max(80, 300 - tail.length - name.length - 2);
  const face = isHttpUrl(input.faceReference) ? String(input.faceReference) : '';
  const body = isHttpUrl(input.fullBodyReference) ? String(input.fullBodyReference) : '';
  return {
    id: `char_${Date.now().toString(36)}_master`,
    name,
    description: `${name}. ${clampText(description, room)}${tail}`,
    faceReference: face,
    fullBodyReference: body,
    outfitReference: isHttpUrl(input.outfitReference) ? String(input.outfitReference) : '',
    hair: clampText(input.hair || '', 120),
    age: clampText(input.age || '', 40),
    visualStyle: clampText(input.visualStyle || '', 160),
    seedLine: characterSeedLine(description, !!(face || body)),
  };
}

function characterSeedLine(description: string, hasImage: boolean): string {
  const short = clampText(description, 90).replace(/[.…]+$/, '');
  return hasImage
    ? `Same character as the reference image: ${short}.`
    : `Same character in every shot: ${short}.`;
}

/** Point an existing master at a newly drawn full-body reference. */
export function withFullBodyReference(master: CharacterMaster, url: string): CharacterMaster {
  if (!isHttpUrl(url)) return master;
  return {
    ...master,
    fullBodyReference: url,
    seedLine: characterSeedLine(master.description, true),
  };
}

/**
 * The master with its images removed and the written half intact — the escape
 * hatch when the video model's safety filter keeps refusing an uploaded photo.
 * Every remaining shot then renders on the description alone, which is how most
 * of this workspace's finished videos were made.
 */
export function withoutMasterImages(master: CharacterMaster): CharacterMaster {
  return {
    ...master,
    faceReference: '',
    fullBodyReference: '',
    outfitReference: '',
    seedLine: characterSeedLine(master.description, false),
  };
}

export function masterFromCharacterRef(character: CharacterRef): CharacterMaster {
  return buildCharacterMaster({
    name: character.name,
    description: character.description,
    faceReference: character.imageUrl,
  });
}

/** PRODUCT_MASTER — level 1 of the ad engine's reference hierarchy. */
export function buildProductMaster(input: {
  name: string;
  tagline?: string;
  logo?: string;
  screenshots?: string[];
  uiStates?: UIState[];
  colors?: string[];
  typography?: string;
  brandRules?: string;
}): ProductMaster {
  const uiStates: Record<string, string> = {};
  (input.uiStates || []).forEach((state) => {
    if (isHttpUrl(state.imageUrl)) uiStates[state.id] = state.imageUrl;
  });
  const shots = (input.screenshots || []).filter(isHttpUrl);
  return {
    name: clampText(input.name || 'the product', 80),
    tagline: clampText(input.tagline || '', 160),
    logo: isHttpUrl(input.logo) ? String(input.logo) : '',
    screenshots: shots,
    uiStates,
    renders: [],
    colors: (input.colors || []).slice(0, 6),
    typography: clampText(input.typography || '', 80),
    physicalReferences: [],
    brandRules: clampText(input.brandRules || '', 400),
  };
}

export function makeEnvironment(input: {
  id: string;
  label: string;
  description: string;
  referenceUrl?: string;
}): EnvironmentMaster {
  return {
    id: input.id,
    label: clampText(input.label, 60),
    description: clampText(input.description, 400),
    referenceUrl: isHttpUrl(input.referenceUrl) ? String(input.referenceUrl) : '',
  };
}

export function makeObject(input: { id: string; label: string; description: string; referenceUrl?: string }): ObjectMaster {
  return {
    id: input.id,
    label: clampText(input.label, 60),
    description: clampText(input.description, 400),
    referenceUrl: isHttpUrl(input.referenceUrl) ? String(input.referenceUrl) : '',
  };
}

// ---------------------------------------------------------------------------
// Recording what happened
// ---------------------------------------------------------------------------
/**
 * Fold one finished shot into memory. Pure: it returns the NEXT memory rather
 * than mutating, so the runner's store can treat memory like any other slice of
 * state and a re-render is always driven by a new object.
 */
export function rememberShot(
  memory: ProductionMemory,
  input: {
    shot: ShotState;
    plan: StoryPlan | null;
    bestFrameUrl: string;
    lastFrameUrl: string;
  },
): ProductionMemory {
  const { shot, plan } = input;
  const chapter = plan ? plan.chapters.find((c) => c.index === shot.chapterIndex) : null;
  const entry: VisualMemoryEntry = {
    shot: shot.index,
    visualWorld: clampText((chapter && chapter.title) || (plan && plan.world) || '', 90),
    objects: memory.objects.map((o) => o.label).slice(0, 4),
    lighting: clampText(
      lightingOf(shot.prompt) || memory.visualBible?.lighting || (plan ? plan.look : ''),
      60,
    ),
    camera: clampText(
      [shot.cameraDistance, shot.cameraMovement, cameraOf(shot.prompt)].filter(Boolean).join(' · '),
      60,
    ),
    motion: clampText(shot.label, 40),
    visualMotif: clampText(memory.anchors.motifs[0] || '', 60),
    lastFrame: input.lastFrameUrl,
    bestReference: (chapter && chapter.environmentId) || '',
  };

  return {
    ...memory,
    bestFrames: isHttpUrl(input.bestFrameUrl)
      ? { ...memory.bestFrames, [shot.index]: input.bestFrameUrl }
      : memory.bestFrames,
    lastFrames: isHttpUrl(input.lastFrameUrl)
      ? { ...memory.lastFrames, [shot.index]: input.lastFrameUrl }
      : memory.lastFrames,
    // Replace rather than append, so a REGENERATED shot overwrites its old row
    // instead of leaving two conflicting memories of the same shot.
    visualMemory: [...memory.visualMemory.filter((v) => v.shot !== shot.index), entry].sort(
      (a, b) => a.shot - b.shot,
    ),
    characterState: memory.characterMasters.length > 0 ? clampText(shot.label, 90) : memory.characterState,
    cameraState: entry.camera,
    narrativeState: clampText(
      `${shot.index} of ${plan ? plan.beats.length : shot.index} — ${shot.label}`,
      120,
    ),
  };
}

/**
 * Drop everything downstream of a shot that is about to be re-rendered. The
 * frames and visual memory of LATER shots were derived from the take we are
 * replacing, so keeping them would chain the next shot out of a frame that no
 * longer exists in the cut.
 */
export function forgetFrom(memory: ProductionMemory, shotIndex: number): ProductionMemory {
  const keep = (record: Record<number, string>) => {
    const next: Record<number, string> = {};
    Object.keys(record).forEach((key) => {
      if (Number(key) < shotIndex) next[Number(key)] = record[Number(key)];
    });
    return next;
  };
  return {
    ...memory,
    bestFrames: keep(memory.bestFrames),
    lastFrames: keep(memory.lastFrames),
    visualMemory: memory.visualMemory.filter((v) => v.shot < shotIndex),
  };
}

/** Best-effort reads of the shot text, for the visual memory row. */
function lightingOf(prompt: string): string {
  const match = prompt.match(
    /\b(golden hour|warm evening|soft window light|harsh sunlight|overcast|neon|candlelit|studio lighting|moody lighting|bright even light|dusk|dawn|backlit)\b/i,
  );
  return match ? match[0] : '';
}

function cameraOf(prompt: string): string {
  const match = prompt.match(
    /\b(macro close-?up|close-?up|wide shot|medium shot|tracking shot|slow push|push-?in|pull-?back|handheld|crane|drone|overhead|low angle)\b/i,
  );
  return match ? match[0] : 'medium shot';
}

// ---------------------------------------------------------------------------
// WorkspaceDB — the durable copy
// ---------------------------------------------------------------------------
export interface PersistedProduction {
  /** The saved row id, or null when the row could not be saved. */
  id: number | null;
  /** Plain-language reason when `id` is null. Absent when it saved. */
  notice?: string;
}

/**
 * Persistence is BEST-EFFORT and never blocks a render. The table is
 * visitor-scoped, so a browser with no verified session may be refused the
 * write outright — that is deliberate platform hardening, not a pipeline fault.
 * Every shot still renders and still lands in My Videos; only Continue-after-a-
 * reload is lost, and the UI says exactly that.
 */
export async function createProductionRow(row: Record<string, unknown>): Promise<PersistedProduction> {
  const client = db();
  if (!client || typeof client.from !== 'function') return { id: null };
  const sid = (await waitForDbSession()) || sessionId();
  try {
    const res = await client.from(PRODUCTIONS_TABLE).insert(sid ? { ...row, session_id: sid } : { ...row });
    const data = (res && (res.data || res)) as any;
    const inserted = Array.isArray(data) ? data[0] : data;
    const id = inserted && Number(inserted.id);
    return { id: Number.isFinite(id) ? id : null };
  } catch (e) {
    console.warn('[Agentic] createProductionRow failed:', e);
    return { id: null, notice: writeFailureNotice(e, 'This production') };
  }
}

export async function updateProductionRow(
  id: number | null,
  patch: Record<string, unknown>,
): Promise<void> {
  if (!id) return;
  const client = db();
  if (!client || typeof client.from !== 'function') return;
  await waitForDbSession();
  try {
    await client.from(PRODUCTIONS_TABLE).update(id, { ...patch, updated_at: new Date().toISOString() });
  } catch (e) {
    console.warn('[Agentic] updateProductionRow failed:', e);
  }
}

export interface ProductionRow {
  id: number;
  title?: string | null;
  brief?: string | null;
  mode?: string | null;
  requested_mode?: string | null;
  status?: string | null;
  source?: string | null;
  source_url?: string | null;
  aspect_ratio?: string | null;
  target_seconds?: number | null;
  memory_json?: any;
  shots_json?: unknown;
  shots_total?: number | null;
  shots_done?: number | null;
  final_video_url?: string | null;
  session_id?: string | null;
  created_at?: string;
}

/** Read one current production before the browser submits its next shot. */
export async function readProductionRow(id: number | null): Promise<ProductionRow | null> {
  if (!id) return null;
  const client = db();
  if (!client || typeof client.from !== 'function') return null;
  try {
    const sid = (await waitForDbSession()) || sessionId();
    if (!sid) return null;
    const res = await client.from(PRODUCTIONS_TABLE).getById(id);
    const data = res && (res.data || res);
    const row = Array.isArray(data) ? data[0] : data;
    return row && row.session_id === sid ? (row as ProductionRow) : null;
  } catch (e) {
    console.warn('[Agentic] readProductionRow failed:', e);
    return null;
  }
}

/** This visitor's recent productions, newest first. Strictly session-scoped. */
export async function listProductionRows(): Promise<ProductionRow[]> {
  const client = db();
  if (!client || typeof client.from !== 'function') return [];
  try {
    const sid = (await waitForDbSession()) || sessionId();
    if (!sid) return [];
    const res = await client.from(PRODUCTIONS_TABLE).orderBy('created_at', 'desc').limit(25).get();
    const rows = Array.isArray(res && res.data) ? res.data : [];
    return rows.filter((r: any) => r.session_id === sid);
  } catch (e) {
    console.warn('[Agentic] listProductionRows failed:', e);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Shot rows, for the saved column
// ---------------------------------------------------------------------------
/**
 * The JSON written into `shots_json`. Deliberately the whole shot including its
 * decision: a support question about why shot 7 looks the way it does, and a
 * partial regeneration that has to replay the same intent, both need it.
 */
export function shotRows(shots: ShotState[]): any[] {
  return shots.map((shot) => ({
    index: shot.index,
    label: shot.label,
    kind: shot.kind,
    prompt: shot.prompt,
    dialogue: shot.dialogue,
    cameraDistance: shot.cameraDistance,
    cameraMovement: shot.cameraMovement,
    visualConnection: shot.visualConnection,
    chapterIndex: shot.chapterIndex,
    seconds: shot.seconds,
    status: shot.status,
    continuity: shot.continuity,
    decision: shot.decision,
    engine: shot.engine,
    jobId: shot.jobId,
    operationId: shot.operationId,
    clipUrl: shot.clipUrl,
    bestFrameUrl: shot.bestFrameUrl,
    lastFrameUrl: shot.lastFrameUrl,
    continuityVerdict: shot.continuityVerdict,
    visualDescription: shot.visualDescription,
    finalContinuityContext: shot.finalContinuityContext,
    finalRegenCount: shot.finalRegenCount,
    regenCount: shot.regenCount,
    error: shot.error,
  }));
}

/** Read a saved shot list back, tolerating rows written by an older build. */
export function shotsFromRows(rows: unknown): ShotState[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r: any) => r && typeof r.prompt === 'string')
    .map((r: any, i: number) => ({
      index: Number(r.index) || i + 1,
      label: String(r.label || `Shot ${i + 1}`),
      kind: r.kind || undefined,
      prompt: String(r.prompt),
      dialogue: String(r.dialogue || ''),
      cameraDistance: r.cameraDistance || undefined,
      cameraMovement: r.cameraMovement || undefined,
      visualConnection: typeof r.visualConnection === 'string' ? r.visualConnection : undefined,
      chapterIndex: Number(r.chapterIndex) || 1,
      seconds: Number(r.seconds) || 8,
      status: r.status === 'done' && isHttpUrl(r.clipUrl) ? 'done' : 'pending',
      continuity: r.continuity || null,
      decision: r.decision || null,
      engine: r.engine || null,
      jobId: typeof r.jobId === 'string' ? r.jobId : undefined,
      operationId: typeof r.operationId === 'string' ? r.operationId : undefined,
      clipUrl: isHttpUrl(r.clipUrl) ? String(r.clipUrl) : undefined,
      bestFrameUrl: isHttpUrl(r.bestFrameUrl) ? String(r.bestFrameUrl) : undefined,
      lastFrameUrl: isHttpUrl(r.lastFrameUrl) ? String(r.lastFrameUrl) : undefined,
      continuityVerdict: r.continuityVerdict || undefined,
      visualDescription: typeof r.visualDescription === 'string' ? r.visualDescription : undefined,
      finalContinuityContext: typeof r.finalContinuityContext === 'string' ? r.finalContinuityContext : undefined,
      finalRegenCount: Number(r.finalRegenCount) || 0,
      regenCount: Number(r.regenCount) || 0,
    })) as ShotState[];
}

/** Merge a saved memory object over the empty one, so new fields get defaults. */
export function memoryFromRow(value: unknown, presenterRequestedFallback = false): ProductionMemory {
  if (!value || typeof value !== 'object') return { ...EMPTY_MEMORY, presenterRequested: presenterRequestedFallback };
  const saved = value as Partial<ProductionMemory>;
  const presenterRequested = Object.prototype.hasOwnProperty.call(saved, 'presenterRequested')
    ? saved.presenterRequested === true
    : presenterRequestedFallback;
  return {
    ...EMPTY_MEMORY,
    ...saved,
    visualBible: saved.visualBible || null,
    anchors: { ...EMPTY_MEMORY.anchors, ...(saved.anchors || {}) },
    bestFrames: saved.bestFrames || {},
    lastFrames: saved.lastFrames || {},
    visualMemory: Array.isArray(saved.visualMemory) ? saved.visualMemory : [],
    characterMasters: Array.isArray(saved.characterMasters) ? saved.characterMasters : [],
    environments: Array.isArray(saved.environments) ? saved.environments : [],
    objects: Array.isArray(saved.objects) ? saved.objects : [],
    uiStates: Array.isArray(saved.uiStates) ? saved.uiStates : [],
    referenceImages: Array.isArray(saved.referenceImages)
      ? saved.referenceImages.filter(isHttpUrl).slice(0, 10)
      : [],
    referenceDescriptions: Array.isArray(saved.referenceDescriptions)
      ? saved.referenceDescriptions.map((value) => clampText(String(value), 500)).slice(0, 10)
      : [],
    presenterRequested,
  };
}
