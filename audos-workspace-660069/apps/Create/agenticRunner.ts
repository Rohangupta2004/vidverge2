/**
 * VidVerge — the agentic video system: THE STORE AND THE RUN LOOP.
 *
 * WHY THIS IS NOT REACT STATE. The shell mounts exactly one app at a time, so
 * anything a component owns dies the moment the visitor opens another app. A
 * five-minute production is up to 38 renders and hours of wall clock — the
 * longest-running thing in this product — so its state and its loop live HERE,
 * in module scope, with their own persistence. apps/Create/AgenticStudio.tsx is
 * a pure projection: unmounting it stops nothing, and coming back shows exactly
 * where the run got to.
 *
 * THE LOOP, in one paragraph. Shots run one at a time, in order, because each
 * one may need the frame the last one ended on. For every shot: the Continuity
 * Agent says what must persist, the Production Router picks the engine and
 * writes a generation decision, the engine renders it, the Frame Analyzer picks
 * the best usable still out of the clip, and the Continuity Check compares that
 * still against the masters. A pass saves it into production memory and moves
 * on. A fail re-seeds the SAME shot from a bridge frame — bounded at
 * MAX_SHOT_REGENERATIONS — rather than failing the run.
 *
 * PARTIAL REGENERATION IS THE WHOLE POINT OF THE PERSISTENCE. If 3 of 50 shots
 * fail, regenerateShots() re-renders exactly those 3 and then re-runs the
 * continuity CHECK (not the render) on their neighbours, so the run is repaired
 * rather than restarted. Nothing already paid for is ever rendered twice.
 *
 * THE VISITOR IS IN CHARGE THROUGHOUT. pauseProduction() finishes the shot in
 * flight and stops; stopProduction() drops everything at its next tick and puts
 * unfinished shots back to pending; every finished shot is saved as it lands.
 */
import { useEffect, useState } from 'react';
import { stitchProject, waitForSceneRender } from './projectApi';
import { clampText, DEFAULT_VIDEO_MODEL, getTone, getVideoModel, type AspectRatio } from './videoTypes';
import { scopedSpaceId, sessionId, workspaceDbToken } from './studioApi';
import { workspaceUuid } from '../../lib/reelioStudio';
import {
  briefImpliesPresenter,
  decideMode,
  planShots,
  runContinuityAgent,
  runDirectorAgent,
  runMotionAgent,
  runVisualMetaphorAgent,
} from './agenticAgents';
import {
  adoptRunningShot,
  analyzeClipFrames,
  HEYGEN_MODEL_ID,
  probeHeyGen,
  remotionUsable,
  renderRemotionShot,
  renderVeoShot,
  runContinuityCheck,
} from './agenticEngines';
import {
  buildProductMaster,
  createProductionRow,
  masterFromCharacterRef,
  readProductionRow,
  memoryFromRow,
  rememberShot,
  shotRows,
  shotsFromRows,
  updateProductionRow,
  withoutMasterImages,
} from './agenticMemory';
import { bridgeDecision, routeShot, uiTransitionFor, type RouterCapabilities } from './agenticRouter';
import {
  buildSelfReferences,
  readCharacterPhoto,
  readProductImage,
  readScreenshot,
  readUrl,
} from './agenticInput';
import {
  EMPTY_INPUTS,
  EMPTY_MEMORY,
  MAX_SHOT_REGENERATIONS,
  SHOT_SECONDS,
  getMode,
  type ContinuityNeed,
  type GenerationDecision,
  type ProductionInputs,
  type ProductionMemory,
  type ProductionState,
  type ResolvedMode,
  type ShotState,
  type UIState,
  type VideoMode,
} from './agenticTypes';

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------
const EMPTY_STATE: ProductionState = {
  phase: 'setup',
  requestedMode: 'auto',
  mode: 'ad_creative',
  modeReason: '',
  title: '',
  inputs: { ...EMPTY_INPUTS },
  aspect: '9:16',
  model: DEFAULT_VIDEO_MODEL,
  toneId: 'professional',
  targetSeconds: 30,
  plan: null,
  shots: [],
  memory: { ...EMPTY_MEMORY },
  cursor: 0,
  pauseRequested: false,
  finalVideoUrl: '',
  assembly: '',
  notice: null,
  error: null,
  rowId: null,
  saveNotice: null,
  startedAt: 0,
  resumable: false,
};

const STORE_KEY = 'vidverge.agentic.v1';

/**
 * A reload is never silently mid-render: nothing here spends money on its own
 * when the page comes back. A run that was going is offered as RESUMABLE, and
 * any shot that was mid-submit (so it has no job id to poll) goes back to
 * pending — while a shot that was already rendering keeps its job id and is
 * simply re-polled, which costs nothing.
 */
function rehydrate(saved: ProductionState): ProductionState {
  const shots = (saved.shots || []).map((shot) => ({
    ...shot,
    message: undefined,
    status:
      shot.status === 'done' && shot.clipUrl
        ? shot.status
        : shot.status === 'rendering' && (shot.jobId || shot.operationId)
          ? shot.status
          : shot.status === 'failed'
            ? shot.status
            : ('pending' as ShotState['status']),
  }));
  const wasRunning = saved.phase === 'running' || saved.phase === 'assembling';
  return {
    ...saved,
    shots,
    memory: memoryFromRow(
      saved.memory,
      saved.requestedMode === 'avatar' || briefImpliesPresenter(saved.inputs?.brief || ''),
    ),
    cursor: 0,
    pauseRequested: false,
    phase: wasRunning ? 'paused' : saved.phase,
    resumable: wasRunning,
  };
}

function load(): ProductionState {
  if (typeof window === 'undefined') return EMPTY_STATE;
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return EMPTY_STATE;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return EMPTY_STATE;
    return rehydrate({ ...EMPTY_STATE, ...parsed, inputs: { ...EMPTY_INPUTS, ...(parsed.inputs || {}) } });
  } catch {
    return EMPTY_STATE;
  }
}

function save(s: ProductionState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    /* storage disabled — the run still works, it just forgets on reload */
  }
}

let state: ProductionState = load();
const listeners = new Set<() => void>();

export function getProduction(): ProductionState {
  return state;
}

export function subscribeProduction(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function set(patch: Partial<ProductionState>): void {
  state = { ...state, ...patch };
  save(state);
  listeners.forEach((l) => {
    try {
      l();
    } catch (e) {
      console.warn('[Agentic] listener failed:', e);
    }
  });
}

/** Subscribe a component to the run. The whole state is the snapshot. */
export function useProduction(): ProductionState {
  const [snapshot, setSnapshot] = useState<ProductionState>(getProduction);
  useEffect(() => {
    // The store may have moved between this component's render and its
    // subscription (a poll tick landing mid-mount), so re-read once.
    setSnapshot(getProduction());
    return subscribeProduction(() => setSnapshot(getProduction()));
  }, []);
  return snapshot;
}

function patchShot(index: number, patch: Partial<ShotState>): void {
  set({ shots: state.shots.map((shot) => (shot.index === index ? { ...shot, ...patch } : shot)) });
}

function shotOf(index: number): ShotState | undefined {
  return state.shots.find((shot) => shot.index === index);
}

// ---------------------------------------------------------------------------
// Derived values every surface reads
// ---------------------------------------------------------------------------
export function shotsDone(s: ProductionState = state): number {
  return s.shots.filter((shot) => shot.status === 'done' && !!shot.clipUrl).length;
}

export function shotsFailed(s: ProductionState = state): number {
  return s.shots.filter((shot) => shot.status === 'failed').length;
}

/** 0–1 across the whole production, counted in shots because that is the time. */
export function productionProgress(s: ProductionState = state): number {
  if (s.shots.length === 0) return 0;
  return Math.min(1, shotsDone(s) / s.shots.length);
}

export function plannedSeconds(s: ProductionState = state): number {
  return s.shots.reduce((sum, shot) => sum + (shot.seconds || SHOT_SECONDS), 0);
}

/** The shots a visitor can repair without touching anything already rendered. */
export function repairableShots(s: ProductionState = state): ShotState[] {
  return s.shots.filter((shot) => shot.status === 'failed' || (shot.continuityVerdict && !shot.continuityVerdict.passed));
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
export function resetProduction(): void {
  runToken += 1;
  planRun += 1;
  running = false;
  set({ ...EMPTY_STATE, inputs: { ...EMPTY_INPUTS }, memory: { ...EMPTY_MEMORY }, shots: [] });
}

export function setRequestedMode(mode: VideoMode): void {
  if (state.phase === 'running') return;
  // UI Motion can only be DELIVERED in landscape (the deterministic renderer
  // outputs 1920x1080 only), so picking it moves the aspect with it rather than
  // letting the visitor choose a combination that cannot be rendered.
  const aspect: AspectRatio = mode === 'ui_motion' ? '16:9' : state.aspect;
  set({ requestedMode: mode, aspect, error: null });
}

export function setProductionInputs(patch: Partial<ProductionInputs>): void {
  set({ inputs: { ...state.inputs, ...patch }, error: null });
}

export function setProductionAspect(aspect: AspectRatio): void {
  if (state.requestedMode === 'ui_motion') return;
  set({ aspect });
}

export function setProductionModel(model: string): void {
  set({ model });
}

export function setProductionTone(toneId: string): void {
  set({ toneId });
}

export function setTargetSeconds(seconds: number): void {
  const mode = state.requestedMode === 'auto' ? state.mode : (state.requestedMode as ResolvedMode);
  const capped = Math.max(SHOT_SECONDS * 2, Math.min(getMode(mode).maxSeconds, Math.round(seconds)));
  set({ targetSeconds: capped });
}

/** Edit one shot's beat before the run starts. */
export function updateShot(index: number, patch: { prompt?: string; dialogue?: string; label?: string }): void {
  if (state.phase === 'running') return;
  patchShot(index, patch);
}

export function backToSetup(): void {
  if (state.phase === 'running') return;
  set({ phase: 'setup', error: null });
}

// ---------------------------------------------------------------------------
// PLANNING — routing, reading the inputs, directing, drawing the references
// ---------------------------------------------------------------------------
let planRun = 0;

/**
 * Everything that happens before the first credit is spent, in order:
 *
 *   1. PROBE HeyGen once, so the mode router knows whether Avatar is real here.
 *   2. READ what the visitor gave us (URL, screenshot, character photo, image).
 *   3. ROUTE the mode — which is what AUTO means.
 *   4. DIRECT the piece into beats.
 *   5. PLAN the shots.
 *   6. DRAW the master references the shots will point at.
 *
 * Then it stops on the plan screen. Nothing renders until the visitor says so.
 */
export async function planProduction(): Promise<void> {
  const run = ++planRun;
  const stalePlan = () => run !== planRun;
  const presenterRequested = state.requestedMode === 'avatar' || briefImpliesPresenter(state.inputs.brief);

  set({ phase: 'routing', error: null, notice: null, plan: null, shots: [], finalVideoUrl: '', assembly: '' });

  // ---- 1. Is HeyGen real on this workspace? Asked ONCE, ever. ----
  const heygenAvailable = await probeHeyGen();
  if (stalePlan()) return;
  let memory: ProductionMemory = { ...EMPTY_MEMORY, heygenAvailable, presenterRequested };

  // ---- 2. Read the inputs ----
  let brief = state.inputs.brief.trim();
  let uiStates: UIState[] = [];
  let title = '';
  let visualReferences: string[] = [];
  let notice: string | null = null;

  if (state.inputs.characterPhotoUrl) {
    set({ phase: 'routing' });
    const master = await readCharacterPhoto(state.inputs.characterPhotoUrl);
    if (stalePlan()) return;
    if (master) memory = { ...memory, characterMasters: [master] };
  } else if (state.inputs.character) {
    memory = { ...memory, characterMasters: [masterFromCharacterRef(state.inputs.character)] };
  }

  if (state.inputs.screenshotUrl) {
    const read = await readScreenshot(state.inputs.screenshotUrl, 1);
    if (stalePlan()) return;
    if (read) uiStates = [read.state];
  }

  if (state.inputs.url.trim()) {
    const read = await readUrl(state.inputs.url.trim(), state.aspect);
    if (stalePlan()) return;
    if (read.failed) {
      notice =
        "We couldn't read that page, so this is planned from what you typed. Add a line about the product and it " +
        'will get sharper.';
    }
    if (read.brief) brief = brief ? `${brief}\n${read.brief}` : read.brief;
    if (read.productName) title = read.productName;
    // Screens found on the page join any the visitor uploaded, deduped by id.
    read.uiStates.forEach((uiState) => {
      if (!uiStates.some((existing) => existing.id === uiState.id)) uiStates.push(uiState);
    });
    if (read.productMaster) memory = { ...memory, productMaster: read.productMaster };
    if (read.productImageUrls.length > 0) {
      setProductionInputs({
        productImageUrls: [...state.inputs.productImageUrls, ...read.productImageUrls]
          .filter((url, index, all) => all.indexOf(url) === index)
          .slice(0, 10),
      });
    }
  }

  const uploadedReferences = state.inputs.productImageUrls
    .filter((url) => /^https?:\/\//i.test(url))
    .slice(0, 10);
  if (uploadedReferences.length > 0) {
    const reads = await Promise.all(
      uploadedReferences.map((url) =>
        readProductImage(url).catch(() => ({ brief: '', visualReference: '' })),
      ),
    );
    if (stalePlan()) return;
    visualReferences = reads.map((read, index) =>
      read.visualReference || `Reference ${index + 1}: preserve the product, palette, composition, and visual identity shown in this image.`,
    );
    const firstBrief = reads.find((read) => read.brief)?.brief || '';
    if (!state.inputs.url.trim() && firstBrief) brief = brief ? `${brief}\n${firstBrief}` : firstBrief;
    if (!memory.productMaster) {
      memory = {
        ...memory,
        productMaster: buildProductMaster({
          name: title || 'the referenced product',
          screenshots: uploadedReferences,
        }),
      };
    }
  }

  memory = {
    ...memory,
    uiStates,
    referenceImages: uploadedReferences,
    referenceDescriptions: visualReferences,
  };

  // ---- 3. AUTO: pick the mode ----
  const inputsForRouting: ProductionInputs = { ...state.inputs, brief };
  const decided = await decideMode({
    requested: state.requestedMode,
    inputs: inputsForRouting,
    heygenAvailable,
    presenterRequested,
  });
  if (stalePlan()) return;

  if (state.requestedMode === 'avatar' && !heygenAvailable) {
    notice =
      'HeyGen is not connected on this workspace, so the presenter is rendered on Veo instead — same script, the ' +
      'same person in every shot.';
  }

  const aspect: AspectRatio = decided.mode === 'ui_motion' ? '16:9' : state.aspect;
  set({
    mode: decided.mode,
    modeReason: decided.reason,
    aspect,
    targetSeconds: decided.targetSeconds,
    inputs: inputsForRouting,
    memory,
    notice,
    phase: 'planning',
  });

  // ---- 4. The director ----
  const plan = await runDirectorAgent({
    mode: decided.mode,
    inputs: inputsForRouting,
    toneId: state.toneId,
    aspect,
    targetSeconds: decided.targetSeconds,
    visualReferences,
    uiStates,
  });
  if (stalePlan()) return;
  // The visual bible is established once, before any reference or shot is generated,
  // then persisted as production memory so the background runner receives it too.
  memory = { ...memory, visualBible: plan.visualBible };

  // ---- 5. The shot planner ----
  const shots = planShots(plan);
  set({
    plan,
    shots,
    title: state.title.trim() || title || plan.title,
    notice:
      notice ||
      (plan.fallback
        ? 'The director could not be reached, so this plan is a template. Edit any shot before you run it.'
        : null),
  });

  // ---- 6. Draw the masters the shots will point at ----
  const built = await buildSelfReferences({
    plan,
    mode: decided.mode,
    memory,
    inputs: inputsForRouting,
    aspect,
    onProgress: (message) => {
      if (!stalePlan()) set({ assembly: message });
    },
    isAborted: stalePlan,
  });
  if (stalePlan()) return;

  set({ memory: built.memory, phase: 'plan', assembly: '' });
  // A row created by Verger already exists before planning begins. Save the
  // browser-built plan back into that row now, so a tab switch after this point
  // can restore the confirmed shot list without creating a duplicate row.
  await persist({
    status: 'planning',
    title: state.title,
    requested_mode: state.requestedMode,
    mode: state.mode,
    mode_reason: state.modeReason,
    brief: clampText(state.inputs.brief, 2000),
    source: state.inputs.source,
    source_url: state.inputs.url || null,
    aspect_ratio: state.aspect,
  });
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
/**
 * Pause AFTER the shot in flight. Deliberately polite: a shot that is half
 * rendered is real spend, so it is finished rather than abandoned. Use
 * stopProduction() to drop everything now.
 */
export function pauseProduction(): void {
  if (state.phase !== 'running') return;
  set({ pauseRequested: true });
  // Stop the server from launching the next shot while this one finishes.
  void persist({ status: 'paused' });
}

export function cancelPause(): void {
  if (!state.pauseRequested) return;
  set({ pauseRequested: false });
  void persist({ status: 'running' });
}

/**
 * STOP NOW — drop the loop at its next tick rather than waiting for the shot in
 * flight. Anything left mid-render goes back to pending, so nothing wears a
 * spinner for a render nobody is watching; finished shots are untouched and
 * Continue picks the run up from here.
 *
 * It ends the WAIT, not the spend: a shot the engine already took finishes at
 * their end and still lands in My Videos.
 */
export function stopProduction(): void {
  runToken += 1;
  running = false;
  set({
    phase: 'paused',
    cursor: 0,
    pauseRequested: false,
    resumable: false,
    shots: state.shots.map((shot) =>
      shot.status === 'done' && shot.clipUrl
        ? shot
        : { ...shot, status: 'pending' as ShotState['status'], message: undefined },
    ),
  });
  void persist({ status: 'paused' });
}

/**
 * PARTIAL REGENERATION — the reason all that memory is worth keeping.
 *
 * Re-render only the shots named, leaving every finished shot (and its clip,
 * and the money it cost) alone. Their own frames are dropped because the take
 * that produced them is being replaced; every OTHER shot's frames are kept,
 * which is what makes this a repair rather than a restart.
 *
 * Continuity around the repaired shots is re-checked afterwards — see
 * recheckNeighbours() — rather than re-rendered, because a neighbour that still
 * matches the masters does not need spending on again.
 */
export function regenerateShots(indexes: number[]): void {
  if (state.phase === 'running') return;
  const wanted = new Set(indexes);
  if (wanted.size === 0) return;
  const bestFrames = { ...state.memory.bestFrames };
  const lastFrames = { ...state.memory.lastFrames };
  wanted.forEach((index) => {
    delete bestFrames[index];
    delete lastFrames[index];
  });
  set({
    error: null,
    memory: {
      ...state.memory,
      bestFrames,
      lastFrames,
      visualMemory: state.memory.visualMemory.filter((v) => !wanted.has(v.shot)),
    },
    shots: state.shots.map((shot) =>
      wanted.has(shot.index)
        ? {
            ...shot,
            status: 'pending' as ShotState['status'],
            jobId: undefined,
            operationId: undefined,
            clipUrl: undefined,
            bestFrameUrl: undefined,
            lastFrameUrl: undefined,
            continuityVerdict: undefined,
            visualDescription: undefined,
            finalContinuityContext: undefined,
            finalRegenCount: 0,
            error: undefined,
            message: undefined,
            // The regeneration budget is reset for a repair the VISITOR asked
            // for: the automatic ceiling exists to stop a loop, not to stop a
            // person deciding a shot is worth another go.
            regenCount: 0,
          }
        : shot,
    ),
  });
  // This is an intentional visitor edit to the durable shot list, not a
  // runtime status write. Save it before the server is asked to continue, and
  // never let a late save start a different production the visitor selected.
  const repairRowId = state.rowId;
  void persist({ status: 'running' }, true).then(() => {
    if (state.rowId === repairRowId && state.phase !== 'running') void continueProduction();
  });
}

/** Repair every shot that failed or drifted, in one action. */
export function regenerateFailedShots(): void {
  regenerateShots(repairableShots().map((shot) => shot.index));
}

/**
 * The character photo keeps being refused by the video model's safety filter.
 * Drop the image half of the master, keep the written half, and put the failed
 * shots back to pending — finished shots are untouched.
 */
export function dropCharacterImages(): void {
  const master = state.memory.characterMasters[0];
  if (!master) return;
  set({
    memory: { ...state.memory, characterMasters: [withoutMasterImages(master)] },
    error: null,
    shots: state.shots.map((shot) =>
      shot.status === 'failed'
        ? { ...shot, status: 'pending' as ShotState['status'], jobId: undefined, error: undefined }
        : shot,
    ),
  });
  void persist({ status: 'paused' }, true);
}

// ---------------------------------------------------------------------------
// Persistence — best-effort, never blocking a render
// ---------------------------------------------------------------------------
async function persist(patch: Record<string, unknown> = {}, includeSnapshot = false): Promise<void> {
  const snapshot = includeSnapshot || patch.status === 'planning'
    ? {
        shots_json: shotRows(state.shots),
        memory_json: {
          ...state.memory,
          serverRuntime: {
            tonePrompt: getTone(state.toneId).prompt,
            provider: getVideoModel(state.model).provider,
            model: getVideoModel(state.model).model,
          },
        },
        story_plan: state.plan,
        shots_total: state.shots.length,
        shots_done: shotsDone(),
      }
    : {};
  await updateProductionRow(state.rowId, {
    ...snapshot,
    final_video_url: state.finalVideoUrl || null,
    notice: state.notice,
    error: state.error,
    ...patch,
  });
}

async function createRow(token: number): Promise<void> {
  const saved = await createProductionRow({
    title: state.title || 'Untitled production',
    requested_mode: state.requestedMode,
    mode: state.mode,
    mode_reason: state.modeReason,
    brief: clampText(state.inputs.brief, 2000),
    source: state.inputs.source,
    source_url: state.inputs.url || null,
    aspect_ratio: state.aspect,
    model: state.model,
    status: 'running',
    shots_total: state.shots.length,
    shots_done: 0,
    story_plan: state.plan,
    shots_json: shotRows(state.shots),
    memory_json: {
      ...state.memory,
      serverRuntime: {
        tonePrompt: getTone(state.toneId).prompt,
        provider: getVideoModel(state.model).provider,
        model: getVideoModel(state.model).model,
      },
    },
  });
  if (stale(token)) return;
  set({ rowId: saved.id, saveNotice: saved.notice || null });
}

// ---------------------------------------------------------------------------
// THE RUN LOOP — module-level, so no unmount can stop it
// ---------------------------------------------------------------------------
let running = false;
/**
 * Which run owns the loop. Stopping bumps it and every await checks it, so a
 * stopped run cannot wake back up and render alongside the one that replaced it
 * (an abort flag alone could not do that: the next start clears it while the old
 * awaits are still mid-poll).
 */
let runToken = 0;

function stale(token: number): boolean {
  return token !== runToken;
}

/**
 * Start the run from the confirmed plan.
 *
 * The `phase === 'running'` half of the guard is what makes a double-click
 * safe: `running` is only set once drive() begins, which is after the row
 * insert awaits, so a second press in that window would otherwise start a
 * second loop — and a second loop means every shot rendered twice. The phase is
 * set synchronously here, before any await, so the second press sees it.
 */
export async function startProduction(): Promise<void> {
  if (running || state.phase === 'running' || state.shots.length === 0) return;
  const token = ++runToken;
  set({ phase: 'running', error: null, resumable: false, startedAt: Date.now(), pauseRequested: false });
  if (!state.rowId) await createRow(token);
  if (stale(token) || state.phase !== 'running') return;
  void drive(token);
}

/** Carry on from wherever the run stopped — nothing finished is re-rendered. */
export async function continueProduction(): Promise<void> {
  if (running || state.phase === 'running' || state.shots.length === 0) return;
  const token = ++runToken;
  set({
    phase: 'running',
    error: null,
    resumable: false,
    pauseRequested: false,
    // The clock measures THIS stretch, not the wall time since a run that was
    // paused overnight first started.
    startedAt: Date.now(),
  });
  if (!state.rowId) await createRow(token);
  if (stale(token) || state.phase !== 'running') return;
  void drive(token);
}

function capabilities(): RouterCapabilities {
  return {
    heygenAvailable: state.memory.heygenAvailable === true,
    hasUIStates: state.memory.uiStates.length > 0,
    remotionAvailable: remotionUsable(state.aspect),
    mode: state.mode,
    requestedMode: state.requestedMode,
    presenterRequested: state.memory.presenterRequested === true,
  };
}

async function drive(token: number): Promise<void> {
  if (running || stale(token)) return;
  running = true;
  try {
    // Bounded for the original shot list plus targeted final-sequence repairs.
    // Individual shot retries remain bounded inside runShot().
    for (let guard = 0; guard <= state.shots.length * 4 + 4; guard++) {
      if (stale(token)) return;
      if (state.pauseRequested) {
        set({ phase: 'paused', pauseRequested: false, cursor: 0 });
        await persist({ status: 'paused' });
        return;
      }
      const next = state.shots.find((shot) => shot.status !== 'done' && shot.status !== 'skipped');
      if (!next) {
        await recheckNeighbours(token);
        if (stale(token)) return;
        const sequenceReady = await runFinalSequenceCheck(token);
        if (stale(token)) return;
        if (!sequenceReady) continue;
        await assemble(token);
        return;
      }
      const finished = await runShot(next.index, token);
      if (stale(token)) return;
      if (!finished) {
        // The shot stopped on something the visitor has to answer. The run
        // pauses on the board with the reason and the repair buttons rather
        // than burning through the rest of the shot list.
        set({ phase: 'paused', cursor: 0 });
        await persist({ status: 'partial' });
        return;
      }
    }
  } finally {
    // Only the run that still owns the loop may unlock it.
    if (token === runToken) running = false;
  }
}

/** The last shot before this one that actually produced a clip. */
function previousRenderedShot(index: number): ShotState | null {
  const earlier = state.shots.filter((shot) => shot.index < index && shot.clipUrl);
  return earlier.length > 0 ? earlier[earlier.length - 1] : null;
}

function productionVisualBible() {
  if (state.memory.visualBible) return state.memory.visualBible;
  if (!state.plan) return null;
  const look = state.plan.look || state.memory.anchors.style || 'cinematic, clean';
  return {
    colorGrade: look,
    lighting: look,
    cameraStyle: look,
    environment: state.plan.world || 'one coherent primary location',
    atmosphere: look,
  };
}

function visualDescriptionOf(shot: ShotState | null | undefined): string {
  if (!shot) return '';
  if (shot.visualDescription) return shot.visualDescription;
  const remembered = state.memory.visualMemory.find((entry) => entry.shot === shot.index);
  if (remembered) {
    return clampText(
      [remembered.visualWorld, remembered.objects.join(', '), remembered.lighting, remembered.camera, remembered.motion]
        .filter(Boolean)
        .join('; '),
      300,
    );
  }
  return clampText(shot.prompt, 300);
}

/**
 * Re-read the durable row before any submission. A server function may have
 * advanced this shot while the tab was closed (or between browser ticks); its
 * job id wins, and the browser adopts that render instead of paying twice.
 */
async function refreshShotFromServer(index: number, token: number): Promise<ShotState | null> {
  if (!state.rowId) return null;
  const row = await readProductionRow(state.rowId);
  if (stale(token) || !row) return null;
  const remote = shotsFromRows(row.shots_json).find((shot) => shot.index === index);
  const current = shotOf(index);
  if (!remote || !current) return null;

  patchShot(index, {
    continuity: remote.continuity || current.continuity,
    decision: remote.decision || current.decision,
    engine: remote.engine || current.engine,
    jobId: remote.jobId || current.jobId,
    operationId: remote.operationId || current.operationId,
    clipUrl: remote.clipUrl || current.clipUrl,
    bestFrameUrl: remote.bestFrameUrl || current.bestFrameUrl,
    lastFrameUrl: remote.lastFrameUrl || current.lastFrameUrl,
    continuityVerdict: remote.continuityVerdict || current.continuityVerdict,
    regenCount: Math.max(current.regenCount || 0, remote.regenCount || 0),
    status: remote.clipUrl ? 'done' : remote.jobId ? 'rendering' : current.status,
  });
  if (row.memory_json) {
    set({
      memory: memoryFromRow(
        row.memory_json,
        String(row.requested_mode || '') === 'avatar' || briefImpliesPresenter(String(row.brief || '')),
      ),
    });
  }
  return remote;
}

async function callAdvanceProduction(payload: Record<string, unknown>): Promise<any> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const sid = sessionId();
  if (sid) headers['X-Session-Id'] = sid;
  const token = workspaceDbToken();
  if (token) headers['X-Workspace-DB-Token'] = token;
  const response = await fetch(`/api/hooks/execute/${scopedSpaceId()}/advance-production`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || !data.success) {
    throw new Error((data && data.error) || `Background production returned HTTP ${response.status}.`);
  }
  return data;
}

/**
 * Durable rows are server-owned. The browser asks the server to start/adopt the
 * shot, waits through the one existing Veo poller, then asks the server to fold
 * the result into memory. It never writes a competing shot outcome.
 */
async function runServerOwnedShot(index: number, token: number): Promise<boolean> {
  set({ cursor: index });
  let remote = await refreshShotFromServer(index, token);
  if (stale(token)) return false;
  if (remote && remote.status === 'done' && remote.clipUrl) return true;

  if (!remote || !remote.jobId) {
    try {
      await callAdvanceProduction({ production_id: state.rowId });
    } catch (e: any) {
      patchShot(index, { status: 'failed', error: (e && e.message) || 'The background shot could not start.' });
      return false;
    }
    remote = await refreshShotFromServer(index, token);
    if (stale(token)) return false;
    if (remote && remote.status === 'done' && remote.clipUrl) return true;
  }

  const jobId = (remote && remote.jobId) || (shotOf(index) && shotOf(index)!.jobId);
  if (!jobId) {
    patchShot(index, { status: 'failed', error: 'The background orchestrator did not return a render job.' });
    return false;
  }

  patchShot(index, { status: 'rendering', jobId, message: 'Rendering in the background…', error: undefined });
  try {
    await waitForSceneRender(jobId, {
      onTick: (message) => {
        if (!stale(token)) patchShot(index, { status: 'rendering', message });
      },
      isAborted: () => stale(token),
    });
  } catch (e: any) {
    if (stale(token)) return false;
    // The watcher may already have finalized a job whose last browser status
    // request raced its database update. Give the server one idempotent pass.
    try {
      await callAdvanceProduction({ production_id: state.rowId, job_id: jobId });
    } catch { /* surfaced below if still unfinished */ }
    remote = await refreshShotFromServer(index, token);
    if (stale(token)) return false;
    if (remote && remote.status === 'done' && remote.clipUrl) return true;
    patchShot(index, { status: 'failed', error: (e && e.message) || 'This shot failed to render.', message: undefined });
    return false;
  }
  if (stale(token)) return false;
  // A polite pause finishes the paid render but deliberately leaves finalizing
  // and next-shot submission until Continue.
  if (state.pauseRequested) return true;

  try {
    await callAdvanceProduction({ production_id: state.rowId, job_id: jobId });
  } catch (e: any) {
    patchShot(index, { status: 'failed', error: (e && e.message) || 'The finished shot could not be saved.' });
    return false;
  }
  remote = await refreshShotFromServer(index, token);
  if (stale(token)) return false;
  if (remote && remote.status === 'done' && remote.clipUrl) return true;
  patchShot(index, { status: 'failed', error: 'The finished shot is still waiting to be adopted.', message: undefined });
  return false;
}

/**
 * RENDER ONE SHOT, conditionally. This is the router diagram in code:
 *
 *   continuity → route → generate → analyze frames → continuity check
 *                                                     ↙ pass      ↘ fail
 *                                          save best frame     regenerate
 *                                          update state        from a bridge
 *
 * Returns false only when the shot stopped on something the visitor has to
 * decide — an exhausted regeneration budget, or an engine that refused it.
 */
async function runShot(index: number, token: number): Promise<boolean> {
  const shot = shotOf(index);
  if (!shot) return false;
  if (shot.status === 'done' && shot.clipUrl) return true;
  const plan = state.plan;
  if (!plan) {
    // Unreachable in the normal flow (the plan screen is the only way in), but
    // a saved row from an older build could arrive without one — and the
    // Continuity Agent reads the plan's beats, so it must not be null here.
    set({ error: 'This production has no plan to render from. Start it again from the brief.' });
    return false;
  }
  if (state.rowId) return runServerOwnedShot(index, token);

  set({ cursor: index });
  const previousShot = previousRenderedShot(index);

  // ---- 1. What must persist? ----
  patchShot(index, {
    status: 'deciding',
    message: 'Working out what has to carry over…',
    error: undefined,
    startedAt: shot.startedAt || Date.now(),
  });
  const continuity: ContinuityNeed =
    shot.continuity ||
    (await runContinuityAgent({
      shot,
      previousShot,
      mode: state.mode,
      plan,
      memory: state.memory,
    }));
  if (stale(token)) return false;

  // ---- 2. Which engine, and with which references? ----
  const visualStrategy =
    state.mode === 'faceless' && !continuity.needsCharacter && !continuity.needsUI
      ? await runVisualMetaphorAgent({
          shot,
          previousShot,
          memory: state.memory,
          hasUI: state.memory.uiStates.length > 0,
        })
      : undefined;
  if (stale(token)) return false;

  let decision: GenerationDecision = routeShot({
    shot,
    previousShot,
    continuity,
    memory: state.memory,
    plan: state.plan,
    caps: capabilities(),
    visualStrategy,
  });
  patchShot(index, { continuity, decision, engine: decision.engine });

  // ---- 3–5. Generate, analyze, check — with one shared bounded retry budget ----
  const retryBase = Number(shot.regenCount || 0);
  const retriesLeft = Math.max(0, MAX_SHOT_REGENERATIONS - retryBase - Number(shot.finalRegenCount || 0));
  for (let attempt = 0; attempt <= retriesLeft; attempt++) {
    if (stale(token)) return false;
    const current = shotOf(index);
    if (!current) return false;

    patchShot(index, {
      status: attempt === 0 ? 'submitting' : 'regenerating',
      message: attempt === 0 ? 'Starting this shot…' : `Regenerating shot ${index} for continuity…`,
      decision,
      engine: decision.engine,
      error: undefined,
    });
    const serverShot = await refreshShotFromServer(index, token);
    if (stale(token)) return false;
    if (serverShot && serverShot.decision) decision = serverShot.decision;
    await persist();

    const rendered = await generateShot(index, decision, token);
    if (stale(token)) return false;
    if (!rendered.success || !rendered.clipUrl) {
      patchShot(index, {
        status: 'failed',
        error: rendered.error || 'This shot could not be rendered.',
        message: undefined,
      });
      await persist();
      return false;
    }
    if (rendered.notice && rendered.notice !== state.notice) set({ notice: rendered.notice });

    // ---- The Frame Analyzer ----
    patchShot(index, {
      status: 'analyzing',
      clipUrl: rendered.clipUrl,
      jobId: rendered.jobId || current.jobId,
      operationId: rendered.operationId || current.operationId,
      message: 'Picking the best frame to continue from…',
    });
    // Every shot, including the last, gets a representative frame: the visual
    // bible is a sequence-level contract, not merely a seed for the next render.
    const analysis = await analyzeClipFrames({
      clipUrl: rendered.clipUrl,
      seconds: current.seconds,
      quick: false,
    });
    if (stale(token)) return false;

    // ---- The Continuity Check ----
    const verdict = await runContinuityCheck({
      frameUrl: analysis.bestFrameUrl,
      master: state.memory.characterMasters[0] || null,
      productName: state.memory.productMaster ? state.memory.productMaster.name : '',
      mustPersist: continuity.mustPersist,
      visualBible: productionVisualBible(),
      previousVisualDescription: visualDescriptionOf(previousShot),
      cameraDistance: current.cameraDistance,
      cameraMovement: current.cameraMovement,
      deliberateBreak: continuity.deliberateBreak,
    });
    if (stale(token)) return false;

    if (verdict.passed || attempt >= retriesLeft) {
      // PASS — or the budget is spent, in which case the shot is KEPT rather
      // than thrown away. A slightly drifted shot the visitor can regenerate by
      // hand is worth more than a hole in their video, and the board flags it.
      patchShot(index, {
        status: 'done',
        bestFrameUrl: analysis.bestFrameUrl || undefined,
        lastFrameUrl: analysis.lastFrameUrl || undefined,
        continuityVerdict: verdict,
        visualDescription: verdict.visualDescription || visualDescriptionOf(current),
        finalContinuityContext: undefined,
        regenCount: retryBase + attempt,
        message: undefined,
        finishedAt: Date.now(),
      });
      set({
        memory: rememberShot(state.memory, {
          shot: shotOf(index) as ShotState,
          plan: state.plan,
          bestFrameUrl: analysis.bestFrameUrl,
          lastFrameUrl: analysis.lastFrameUrl,
        }),
      });
      await persist({ status: 'running' });
      return true;
    }

    // FAIL — re-seed from a bridge frame that still matches the masters, rather
    // than from the drifted frame that caused the failure.
    console.warn(`[Agentic] shot ${index} failed continuity (${verdict.score}): ${verdict.reason}`);
    patchShot(index, {
      continuityVerdict: verdict,
      regenCount: retryBase + attempt + 1,
      jobId: undefined,
      operationId: undefined,
      clipUrl: undefined,
    });
    decision = bridgeDecision({
      shot: shotOf(index) as ShotState,
      previousShot,
      continuity,
      memory: state.memory,
      plan: state.plan,
      caps: capabilities(),
    });
  }
  return false;
}

/**
 * Hand ONE shot to the engine its decision names.
 *
 * EVERY generative engine goes through the SAME render hook — an avatar shot is
 * just a submission carrying the HeyGen provider id, because the registered hook
 * already owns the avatar/voice pair, already re-routes to Omni when HeyGen
 * refuses a scene, and is already followed by the watcher. That is why there is
 * only one degradation left to handle here:
 *
 *   Remotion unavailable / failed → animate the same screenshot with Veo
 *                                   image-to-video, which is still the real
 *                                   product on screen.
 */
async function generateShot(index: number, decision: GenerationDecision, token: number) {
  const remote = await refreshShotFromServer(index, token);
  if (stale(token)) return { success: false, error: 'aborted' };
  const shot = shotOf(index) as ShotState;
  if (remote && remote.clipUrl) {
    return { success: true, clipUrl: remote.clipUrl, jobId: remote.jobId, operationId: remote.operationId };
  }
  if (shot.jobId) {
    const adopted = await adoptRunningShot(shot.jobId);
    if (stale(token)) return { success: false, error: 'aborted' };
    if (adopted.clipUrl) return { success: true, clipUrl: adopted.clipUrl, jobId: shot.jobId };
    if (adopted.failed) return { success: false, jobId: shot.jobId, error: 'This server-started shot failed to render.' };
  }
  const onTick = (message: string) => {
    if (!stale(token)) patchShot(index, { status: 'rendering', message });
  };
  const isAborted = () => stale(token);
  const submit = (override?: { decision?: GenerationDecision; model?: string; showsScreen?: boolean }) =>
    renderVeoShot({
      shot: shotOf(index) as ShotState,
      decision: override?.decision || {
        ...decision,
        engine: decision.engine === 'veo_t2v' ? 'veo_t2v' : 'veo_i2v',
      },
      memory: state.memory,
      plan: state.plan,
      shotTotal: state.shots.length,
      productionTitle: state.title,
      aspect: state.aspect,
      model: override?.model || state.model,
      toneId: state.toneId,
      showsScreen: override?.showsScreen ?? decision.visual_strategy === 'USE_UI',
      onSubmitted: async (jobId) => {
        if (stale(token)) return;
        patchShot(index, { jobId, status: 'rendering', message: 'Rendering…' });
        await persist({ status: 'running' });
      },
      onTick,
      isAborted,
    });

  if (decision.engine === 'remotion') {
    const { from, to } = uiTransitionFor(shot, state.memory.uiStates);
    patchShot(index, { status: 'rendering', message: 'Designing the motion for this screen…' });
    const motion = await runMotionAgent({ shot, fromState: from, toState: to });
    if (stale(token)) return { success: false, error: 'aborted' };
    const result = await renderRemotionShot({
      shot: shotOf(index) as ShotState,
      fromState: from,
      toState: to,
      motion,
      accentHex: '#3b82f6',
      backgroundHex: '#05080f',
      onTick,
      isAborted,
    });
    if (result.success || !result.degraded) return result;
    // The screens still exist, so the fallback keeps the REAL product on screen
    // and just lets Veo move the camera over it.
    const screen = (to && to.imageUrl) || (from && from.imageUrl) || '';
    const fallbackDecision: GenerationDecision = {
      ...decision,
      generation_strategy: 'image_to_video',
      engine: 'veo_i2v',
      environment_reference: screen || decision.environment_reference,
      visual_strategy: 'USE_UI',
      reason: 'The deterministic UI renderer was unavailable, so your screenshot is animated with a camera move.',
    };
    patchShot(index, { decision: fallbackDecision, engine: 'veo_i2v' });
    const fallback = await submit({ decision: fallbackDecision, showsScreen: true });
    return {
      ...fallback,
      notice: fallback.success
        ? 'One shot used your screenshot directly because the UI renderer was unavailable.'
        : fallback.notice,
    };
  }

  if (decision.engine === 'heygen') {
    // The hook owns the avatar, the voice and the silent Omni fallback, so this
    // is an ordinary submission with a different provider id — no second poller,
    // no HeyGen key anywhere near the browser, and the clip lands in My Videos
    // exactly like every other shot.
    return submit({ model: HEYGEN_MODEL_ID });
  }

  return submit();
}

/**
 * RE-RUN CONTINUITY AROUND A REPAIR, without re-rendering anything.
 *
 * After a partial regeneration the shots either side of the repaired one were
 * generated against a take that no longer exists. Most of them are still fine
 * — they were anchored on the MASTER, not on their neighbour — so this checks
 * rather than assumes: each neighbour's saved best frame is scored against the
 * masters again, and one that no longer holds up is FLAGGED for the visitor
 * instead of being silently re-rendered at their expense.
 */
async function recheckNeighbours(token: number): Promise<void> {
  const repaired = state.shots.filter((shot) => shot.regenCount > 0 && shot.status === 'done');
  if (repaired.length === 0) return;
  const master = state.memory.characterMasters[0] || null;
  const productName = state.memory.productMaster ? state.memory.productMaster.name : '';
  if (!master && !productName) return;

  const neighbours = new Set<number>();
  repaired.forEach((shot) => {
    if (shot.index + 1 <= state.shots.length) neighbours.add(shot.index + 1);
  });

  for (const index of Array.from(neighbours)) {
    if (stale(token)) return;
    const shot = shotOf(index);
    if (!shot || shot.status !== 'done' || !shot.bestFrameUrl || shot.regenCount > 0) continue;
    patchShot(index, { message: 'Re-checking continuity after the repair…' });
    const verdict = await runContinuityCheck({
      frameUrl: shot.bestFrameUrl,
      master,
      productName,
      mustPersist: (shot.continuity && shot.continuity.mustPersist) || [],
      visualBible: productionVisualBible(),
      previousVisualDescription: visualDescriptionOf(previousRenderedShot(index)),
      cameraDistance: shot.cameraDistance,
      cameraMovement: shot.cameraMovement,
      deliberateBreak: !!(shot.continuity && shot.continuity.deliberateBreak),
    });
    if (stale(token)) return;
    patchShot(index, { continuityVerdict: verdict, message: undefined });
  }
  await persist();
}

/**
 * One final editorial pass before stitching. Each shot is checked in sequence
 * against the visual bible and descriptions of both neighbours. Only the
 * disconnected shots are put back into the queue, with bounded retries; every
 * accepted clip stays untouched.
 */
async function runFinalSequenceCheck(token: number): Promise<boolean> {
  const failures = new Map<number, { verdict: any; context: string }>();
  const ordered = state.shots.slice().sort((a, b) => a.index - b.index);

  for (let i = 0; i < ordered.length; i++) {
    if (stale(token)) return false;
    const shot = ordered[i];
    if (shot.status !== 'done' || !shot.bestFrameUrl) continue;
    const previous = ordered[i - 1] || null;
    const next = ordered[i + 1] || null;
    const previousDescription = visualDescriptionOf(previous);
    const nextDescription = visualDescriptionOf(next);
    const verdict = await runContinuityCheck({
      frameUrl: shot.bestFrameUrl,
      master: state.memory.characterMasters[0] || null,
      productName: state.memory.productMaster ? state.memory.productMaster.name : '',
      mustPersist: (shot.continuity && shot.continuity.mustPersist) || [],
      visualBible: productionVisualBible(),
      previousVisualDescription: previousDescription,
      nextVisualDescription: nextDescription,
      cameraDistance: shot.cameraDistance,
      cameraMovement: shot.cameraMovement,
      deliberateBreak: !!(shot.continuity && shot.continuity.deliberateBreak),
    });
    if (stale(token)) return false;
    patchShot(shot.index, {
      continuityVerdict: verdict,
      visualDescription: verdict.visualDescription || shot.visualDescription,
      message: undefined,
    });
    if (
      !verdict.passed &&
      Number(shot.regenCount || 0) + Number(shot.finalRegenCount || 0) < MAX_SHOT_REGENERATIONS
    ) {
      failures.set(shot.index, {
        verdict,
        context: clampText(
          `The sequence check failed because ${verdict.reason}. Continue from ${previousDescription || 'the established opening style'}; ` +
            `lead naturally into ${nextDescription || 'the planned closing style'}. Keep the same environment, lighting, grade, camera language and atmosphere.`,
          500,
        ),
      });
    }
  }

  if (failures.size === 0) {
    await persist();
    return true;
  }

  const bestFrames = { ...state.memory.bestFrames };
  const lastFrames = { ...state.memory.lastFrames };
  failures.forEach((_failure, index) => {
    delete bestFrames[index];
    delete lastFrames[index];
  });
  set({
    memory: {
      ...state.memory,
      bestFrames,
      lastFrames,
      visualMemory: state.memory.visualMemory.filter((entry) => !failures.has(entry.shot)),
    },
    shots: state.shots.map((shot) => {
      const failure = failures.get(shot.index);
      return failure
        ? {
            ...shot,
            status: 'pending' as ShotState['status'],
            jobId: undefined,
            operationId: undefined,
            clipUrl: undefined,
            bestFrameUrl: undefined,
            lastFrameUrl: undefined,
            visualDescription: undefined,
            finalContinuityContext: failure.context,
            finalRegenCount: Number(shot.finalRegenCount || 0) + 1,
            continuityVerdict: failure.verdict,
          }
        : shot;
    }),
  });
  await persist({ status: 'running' }, true);
  return false;
}

/**
 * Assemble the finished shots into one MP4. Browser ffmpeg first (it keeps the
 * audio the clips carry), the platform's server-side merge second (always
 * works, always silent). If both are out the shots are delivered individually,
 * which is a real outcome rather than a failure — every clip still exists.
 */
async function assemble(token: number): Promise<void> {
  const clipUrls = state.shots
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((shot) => shot.clipUrl || '')
    .filter((url) => /^https?:\/\//.test(url));

  if (clipUrls.length === 0) {
    set({ phase: 'paused', error: 'No shot produced a clip, so there is nothing to assemble yet.' });
    await persist({ status: 'failed' });
    return;
  }

  set({ phase: 'assembling', assembly: 'Cutting your shots together…' });
  const outcome = await stitchProject(clipUrls, {
    workspaceUuid: workspaceUuid(),
    fileName: `vidverge-${state.mode}-${Date.now()}.mp4`,
    onStage: (stage) => {
      if (stale(token)) return;
      set({
        assembly:
          stage === 'uploading'
            ? 'Saving the final cut…'
            : stage === 'server'
              ? 'Finishing the cut on the server…'
              : 'Cutting your shots together…',
      });
    },
  });
  if (stale(token)) return;

  const failed = shotsFailed();
  set({
    phase: 'done',
    cursor: 0,
    finalVideoUrl: outcome.url || '',
    assembly:
      outcome.method === 'browser'
        ? 'Cut in your browser, with the sound the shots carry.'
        : outcome.method === 'server'
          ? 'Cut on the server — this version is picture only, and every shot below still has its own audio.'
          : outcome.method === 'single'
            ? 'One shot, delivered as it rendered.'
            : 'The shots could not be joined, so each one is below on its own.',
    error: outcome.url ? null : outcome.error || null,
  });
  await persist({ status: failed > 0 ? 'partial' : 'completed', final_video_url: outcome.url || null });
}

// ---------------------------------------------------------------------------
// Boot: a run left in flight by an earlier visit is offered back, not resumed.
// ---------------------------------------------------------------------------
if (typeof window !== 'undefined') {
  // A finished production is worth showing again for a few hours — after that
  // it is history and the visitor should get a blank brief back.
  if (state.phase === 'done' && state.startedAt && Date.now() - state.startedAt > 6 * 60 * 60 * 1000) {
    state = { ...EMPTY_STATE, inputs: { ...EMPTY_INPUTS }, memory: { ...EMPTY_MEMORY } };
    save(state);
  }
  // Deliberately NOT auto-continued: a reload must never quietly start
  // spending. `resumable` puts a Continue button on the board instead.
  if (state.shots.length === 0 && state.phase !== 'setup') {
    state = { ...state, phase: 'setup', resumable: false };
    save(state);
  }
}

/** Rebuild a saved production from a WorkspaceDB row (the library's Resume). */
export function adoptSavedProduction(row: any): void {
  if (!row) return;
  planRun += 1;
  const shots = shotsFromRows(row.shots_json);

  // A chat handoff is intentionally only an intake row: no plan and no shots.
  // Seed the ordinary setup screen from it and keep its row id, so the visitor
  // remains the person who starts planning and later confirms the shot list.
  if (shots.length === 0) {
    const requestedMode = getMode(String(row.requested_mode || 'auto')).id;
    const aspect: AspectRatio = row.aspect_ratio === '16:9' ? '16:9' : '9:16';
    const requestedSeconds = Math.round(
      Number(row.target_seconds || (row.memory_json && row.memory_json.intake && row.memory_json.intake.target_seconds)) || 60,
    );
    runToken += 1;
    running = false;
    set({
      ...EMPTY_STATE,
      phase: 'setup',
      rowId: Number(row.id) || null,
      // The intake row carries a temporary non-empty title for schema safety;
      // let the director replace it with the real planned title.
      title: '',
      requestedMode,
      mode: requestedMode === 'auto' ? 'ad_creative' : (requestedMode as ResolvedMode),
      aspect,
      targetSeconds: Math.max(
        SHOT_SECONDS * 2,
        Math.min(getMode(requestedMode === 'auto' ? 'long_series' : requestedMode).maxSeconds, requestedSeconds),
      ),
      model: String(row.model || DEFAULT_VIDEO_MODEL),
      inputs: {
        ...EMPTY_INPUTS,
        source: (row.source as ProductionInputs['source']) || 'idea',
        url: String(row.source_url || ''),
        brief: String(row.brief || ''),
        productImageUrls: Array.isArray(row.memory_json?.intake?.reference_images)
          ? row.memory_json.intake.reference_images.filter((url: unknown) => typeof url === 'string').slice(0, 10)
          : [],
      },
      toneId: state.toneId,
    });
    return;
  }

  runToken += 1;
  running = false;
  set({
    ...EMPTY_STATE,
    phase: 'paused',
    resumable: true,
    rowId: Number(row.id) || null,
    title: String(row.title || 'Untitled production'),
    requestedMode: (row.requested_mode as VideoMode) || 'auto',
    mode: (row.mode as ResolvedMode) || 'ad_creative',
    modeReason: String(row.mode_reason || ''),
    aspect: row.aspect_ratio === '16:9' ? '16:9' : '9:16',
    targetSeconds: Math.max(SHOT_SECONDS * 2, Math.min(300, Math.round(Number(row.target_seconds) || 60))),
    model: String(row.model || DEFAULT_VIDEO_MODEL),
    inputs: {
      ...EMPTY_INPUTS,
      source: (row.source as ProductionInputs['source']) || 'idea',
      url: String(row.source_url || ''),
      brief: String(row.brief || ''),
    },
    plan: row.story_plan || null,
    shots,
    memory: memoryFromRow(
      row.memory_json,
      String(row.requested_mode || '') === 'avatar' || briefImpliesPresenter(String(row.brief || '')),
    ),
    finalVideoUrl: String(row.final_video_url || ''),
    toneId: state.toneId,
  });
}

/** The tone words the plan screen shows, so it agrees with the render. */
export function toneLabel(): string {
  return getTone(state.toneId).label;
}
