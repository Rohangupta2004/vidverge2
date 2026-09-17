/**
 * VidVerge Create — LONG SERIES mode: the run store and the run loop.
 *
 * WHY THIS IS NOT REACT STATE. The shell mounts exactly one app at a time, so
 * anything owned by a component dies the moment the visitor opens another app
 * (that is the whole reason apps/Create/videoStore.ts exists). A series is the
 * longest-running thing in this product — ten episodes is forty renders, hours
 * of wall clock — so its state and its loop live HERE, in module scope, with
 * their own persistence. apps/Create/EpisodeSeries.tsx is a pure projection of
 * this store: unmounting it stops nothing, and coming back shows exactly where
 * the run got to.
 *
 * THE LOOP, in one paragraph. Episodes run one at a time, in order. Each
 * episode is planned into exactly CLIPS_PER_EPISODE beats, then those clips
 * render ONE AT A TIME — sequential on purpose, because the tail frame of clip
 * N is what clip N+1 continues out of (see episodeApi's CLIP CHAIN note). When
 * all four have landed they are stitched into that episode's single MP4, a
 * one-line recap is kept, and the next episode is planned against it. The
 * character lock and the visual style are built once and reused verbatim for
 * the entire run.
 *
 * THE VISITOR IS IN CHARGE THROUGHOUT. pauseSeries() finishes the episode in
 * flight and stops; stopSeries() drops everything at its next tick; steerNext()
 * puts a note in front of the NEXT episode's planner, so the series can be
 * redirected between episodes without starting over. Every finished clip and
 * every finished episode is saved as it lands, so nothing already paid for is
 * ever re-rendered.
 */
import { useEffect, useState } from 'react';
import { isContentFilterError, stitchProject, waitForSceneRender } from './projectApi';
import {
  CLIPS_PER_EPISODE,
  clipSecondsFor,
  continuityModeFor,
  createSeriesRow,
  drawSeriesAnchorFrame,
  EMPTY_STYLE,
  episodeSeconds,
  MAX_EPISODES,
  MIN_EPISODES,
  planEpisodeClips,
  planSeries,
  recapFor,
  submitEpisodeClip,
  tailFrameOf,
  updateSeriesRow,
  withAnchorFrame,
  withoutLockImages,
  buildCharacterLock,
  type CharacterLock,
  type ClipStatus,
  type EpisodeClipPlan,
  type EpisodeStatus,
  type SeriesStyle,
} from './episodeApi';
import {
  clampText,
  DEFAULT_VIDEO_MODEL,
  getTone,
  type AspectRatio,
  type CharacterRef,
} from './videoTypes';
import { workspaceUuid } from '../../lib/reelioStudio';

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------
export interface ClipState {
  index: number;
  label: string;
  prompt: string;
  dialogue: string;
  status: ClipStatus;
  jobId?: string;
  url?: string;
  /** The still handed to the NEXT clip as its continuity reference. */
  tailFrameUrl?: string;
  /** Live line from the poller, e.g. "Rendering…". */
  message?: string;
  error?: string;
}

export interface EpisodeState {
  index: number;
  title: string;
  logline: string;
  /** What the visitor asked for before THIS episode was planned. */
  steer: string;
  status: EpisodeStatus;
  clips: ClipState[];
  /** The stitched episode. Absent when the four clips could not be joined. */
  videoUrl?: string;
  stitchMethod?: string;
  /** Whether the delivered cut kept any audio the clips carried. */
  audio?: string;
  /** One line on how it ended, carried into the next episode's plan. */
  recap: string;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
}

export type RunPhase = 'setup' | 'planning' | 'plan' | 'running' | 'paused' | 'done';

export interface SeriesRunState {
  phase: RunPhase;
  title: string;
  brief: string;
  episodeCount: number;
  /** The picker id. Passed through to every clip of every episode. */
  model: string;
  toneId: string;
  aspect: AspectRatio;
  /** Snapped to a length the chosen engine really cuts. */
  clipSeconds: number;
  /** Built once from the confirmed character, then never rebuilt. */
  lock: CharacterLock | null;
  style: SeriesStyle;
  episodes: EpisodeState[];
  /** 1-based episode being built right now, 0 when nothing is in flight. */
  cursor: number;
  /** A polite pause: the episode in flight finishes first. */
  pauseRequested: boolean;
  /** Queued steer for the next episode to be planned. */
  nextSteer: string;
  /** True when the planner could not be reached and the outlines are templated. */
  planFallback: boolean;
  /** Calm, non-error line about this run (today: the Kling fallback notice). */
  notice: string | null;
  error: string | null;
  rowId: number | null;
  /** Why the run could not be saved, in plain language. */
  saveNotice: string | null;
  startedAt: number;
  /** Set when a reload found a run mid-flight, so Continue is offered. */
  resumable: boolean;
  /** True once the character photo has been dropped from the lock. */
  photoDropped: boolean;
}

const EMPTY_STATE: SeriesRunState = {
  phase: 'setup',
  title: '',
  brief: '',
  episodeCount: 3,
  model: DEFAULT_VIDEO_MODEL,
  toneId: 'professional',
  aspect: '9:16',
  clipSeconds: clipSecondsFor(DEFAULT_VIDEO_MODEL),
  lock: null,
  style: EMPTY_STYLE,
  episodes: [],
  cursor: 0,
  pauseRequested: false,
  nextSteer: '',
  planFallback: false,
  notice: null,
  error: null,
  rowId: null,
  saveNotice: null,
  startedAt: 0,
  resumable: false,
  photoDropped: false,
};

// ---------------------------------------------------------------------------
// Persistence — the run survives a reload, not just an app switch.
// ---------------------------------------------------------------------------
const STORE_KEY = 'vidverge.series.v1';

/**
 * A reload cannot be silently mid-render: nothing here spends money on its own
 * when the page comes back. A run that was going is offered as resumable, and
 * any clip that was mid-SUBMIT (so it has no job id to poll) goes back to
 * pending — while a clip that was already rendering keeps its job id and is
 * simply re-polled, which costs nothing.
 */
function rehydrate(saved: SeriesRunState): SeriesRunState {
  const episodes = (saved.episodes || []).map((ep) => ({
    ...ep,
    status: ep.status === 'rendering' || ep.status === 'stitching' || ep.status === 'planning'
      ? ('pending' as EpisodeStatus)
      : ep.status,
    clips: (ep.clips || []).map((clip) => ({
      ...clip,
      message: undefined,
      status:
        clip.status === 'done'
          ? clip.status
          : clip.status === 'rendering' && clip.jobId
            ? clip.status
            : clip.status === 'failed'
              ? clip.status
              : ('pending' as ClipStatus),
    })),
  }));
  const wasRunning = saved.phase === 'running';
  return {
    ...saved,
    episodes,
    cursor: 0,
    pauseRequested: false,
    phase: wasRunning ? 'paused' : saved.phase,
    resumable: wasRunning,
  };
}

function load(): SeriesRunState {
  if (typeof window === 'undefined') return EMPTY_STATE;
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return EMPTY_STATE;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return EMPTY_STATE;
    return rehydrate({ ...EMPTY_STATE, ...parsed });
  } catch {
    return EMPTY_STATE;
  }
}

function save(s: SeriesRunState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    /* storage disabled — the run still works, it just forgets on reload */
  }
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------
let state: SeriesRunState = load();
const listeners = new Set<() => void>();

export function getSeriesRun(): SeriesRunState {
  return state;
}

export function subscribeSeries(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function set(patch: Partial<SeriesRunState>): void {
  state = { ...state, ...patch };
  save(state);
  listeners.forEach((l) => {
    try {
      l();
    } catch (e) {
      console.warn('[Series] listener failed:', e);
    }
  });
}

/** Subscribe a component to the run. The whole state is the snapshot. */
export function useSeriesRun(): SeriesRunState {
  const [snapshot, setSnapshot] = useState<SeriesRunState>(getSeriesRun);
  useEffect(() => {
    // The store may have moved between this component's render and its
    // subscription (a poll tick landing mid-mount), so re-read once.
    setSnapshot(getSeriesRun());
    return subscribeSeries(() => setSnapshot(getSeriesRun()));
  }, []);
  return snapshot;
}

function patchEpisode(index: number, patch: Partial<EpisodeState>): void {
  set({
    episodes: state.episodes.map((ep) => (ep.index === index ? { ...ep, ...patch } : ep)),
  });
}

function patchClip(epIndex: number, clipIndex: number, patch: Partial<ClipState>): void {
  set({
    episodes: state.episodes.map((ep) =>
      ep.index === epIndex
        ? {
            ...ep,
            clips: ep.clips.map((clip) =>
              clip.index === clipIndex ? { ...clip, ...patch } : clip,
            ),
          }
        : ep,
    ),
  });
}

function episodeOf(index: number): EpisodeState | undefined {
  return state.episodes.find((ep) => ep.index === index);
}

function clipOf(epIndex: number, clipIndex: number): ClipState | undefined {
  const ep = episodeOf(epIndex);
  return ep ? ep.clips.find((clip) => clip.index === clipIndex) : undefined;
}

// ---------------------------------------------------------------------------
// Derived values every surface reads (rather than recomputing its own)
// ---------------------------------------------------------------------------
export function clipsDone(ep: EpisodeState): number {
  return ep.clips.filter((clip) => clip.status === 'done' && !!clip.url).length;
}

export function episodesDone(s: SeriesRunState = state): number {
  return s.episodes.filter((ep) => ep.status === 'done').length;
}

/** 0–1 across the whole run, counted in clips because that is what takes time. */
export function runProgress(s: SeriesRunState = state): number {
  const total = Math.max(1, s.episodes.length * CLIPS_PER_EPISODE);
  const done = s.episodes.reduce((sum, ep) => sum + clipsDone(ep), 0);
  return Math.min(1, done / total);
}

/** Honest total runtime of the run as planned. */
export function plannedRunSeconds(s: SeriesRunState = state): number {
  return s.episodes.length * episodeSeconds(s.model);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
/** Wipe the run and go back to a blank brief. */
export function resetSeries(): void {
  runToken += 1;
  running = false;
  set({ ...EMPTY_STATE, episodes: [] });
}

export function setSeriesInputs(patch: {
  brief?: string;
  title?: string;
  episodeCount?: number;
  model?: string;
  toneId?: string;
  aspect?: AspectRatio;
}): void {
  const next: Partial<SeriesRunState> = {};
  if (typeof patch.brief === 'string') next.brief = patch.brief;
  if (typeof patch.title === 'string') next.title = patch.title;
  if (typeof patch.episodeCount === 'number') {
    next.episodeCount = Math.max(
      MIN_EPISODES,
      Math.min(MAX_EPISODES, Math.round(patch.episodeCount) || MIN_EPISODES),
    );
  }
  if (typeof patch.model === 'string') {
    next.model = patch.model;
    // The clip length follows the engine, so switching model re-snaps it — a
    // 10s Kling beat is not a length a Veo clip can be cut to.
    next.clipSeconds = clipSecondsFor(patch.model);
  }
  if (typeof patch.toneId === 'string') next.toneId = patch.toneId;
  if (patch.aspect) next.aspect = patch.aspect;
  set(next);
}

/** Lock the character for the WHOLE series. Called once, from the picker. */
export function setSeriesCharacter(character: CharacterRef): void {
  set({ lock: buildCharacterLock(character), photoDropped: false });
}

/**
 * Ask the planner for the series: a title, the world / look / arc every episode
 * inherits, and one outline per episode. Lands on the editable plan.
 */
export async function planSeriesRun(): Promise<void> {
  const lock = state.lock;
  if (!lock) {
    set({ error: 'Pick the character first — they are locked for the whole series.' });
    return;
  }
  if (!state.brief.trim()) {
    set({ error: 'Describe the series first.' });
    return;
  }
  set({ phase: 'planning', error: null });
  const plan = await planSeries({
    brief: state.brief,
    episodeCount: state.episodeCount,
    character: { name: lock.name, description: lock.description, imageUrl: lock.portraitUrl, source: 'saved' },
    toneId: state.toneId,
    aspect: state.aspect,
    model: state.model,
  });
  set({
    phase: 'plan',
    title: state.title.trim() || plan.title,
    style: plan.style,
    planFallback: plan.fallback,
    episodes: plan.outlines.map((outline) => ({
      index: outline.index,
      title: outline.title,
      logline: outline.logline,
      steer: '',
      status: 'pending' as EpisodeStatus,
      clips: [],
      recap: '',
    })),
  });
}

/** Edit one episode's outline before the run starts. */
export function updateEpisodeOutline(
  index: number,
  patch: { title?: string; logline?: string },
): void {
  patchEpisode(index, patch);
}

/** Back to the plan screen without losing it. */
export function backToPlan(): void {
  if (state.phase === 'running') return;
  if (state.episodes.length === 0) {
    set({ phase: 'setup', error: null });
    return;
  }
  set({ phase: 'plan', error: null });
}

/**
 * Back to the brief. The plan is deliberately KEPT rather than cleared: a
 * visitor who changes the tone or the episode count and re-plans overwrites it,
 * and one who just wanted to look does not lose it.
 */
export function backToBrief(): void {
  if (state.phase === 'running') return;
  set({ phase: 'setup', error: null });
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
/**
 * Pause AFTER the episode in flight. Deliberately polite: an episode that is
 * half rendered is four clips of spend, so it is finished and stitched rather
 * than abandoned. Use stopSeries() to drop everything now.
 */
export function pauseSeries(): void {
  if (state.phase !== 'running') return;
  set({ pauseRequested: true });
}

/** Take the pause back while the current episode is still going. */
export function cancelPause(): void {
  if (!state.pauseRequested) return;
  set({ pauseRequested: false });
}

/**
 * STOP NOW — drop every lane at its next tick rather than waiting for the clip
 * in flight. Anything left mid-render goes back to pending, so nothing wears a
 * spinner for a render nobody is watching; finished clips and episodes are
 * untouched and Continue picks the run up from here.
 *
 * It ends the WAIT, not the spend: a clip the engine already took finishes at
 * their end and still lands in My Videos.
 */
export function stopSeries(): void {
  runToken += 1;
  running = false;
  set({
    phase: 'paused',
    cursor: 0,
    pauseRequested: false,
    resumable: false,
    episodes: state.episodes.map((ep) => ({
      ...ep,
      status: ep.status === 'done' ? ep.status : ('pending' as EpisodeStatus),
      clips: ep.clips.map((clip) =>
        clip.status === 'done' && clip.url
          ? clip
          : { ...clip, status: 'pending' as ClipStatus, message: undefined },
      ),
    })),
  });
  void persist({ status: 'paused' });
}

/**
 * Steer the series between episodes. The note goes in front of the NEXT
 * episode's planner, so "make the next one funnier" or "move it outdoors" is
 * honoured without re-planning what has already been rendered.
 */
export function steerNext(note: string): void {
  set({ nextSteer: clampText(note, 400) });
}

export function clearSteer(): void {
  set({ nextSteer: '' });
}

/**
 * The safety filter rejected the character photo and keeps rejecting it. Drop
 * the image half of the lock, keep the written description, and carry on —
 * finished episodes are untouched. (The rejection is not strictly
 * deterministic, so this is the reliable escape rather than the only one.)
 */
export function dropCharacterPhoto(): void {
  if (!state.lock) return;
  set({
    lock: withoutLockImages(state.lock),
    photoDropped: true,
    error: null,
    episodes: state.episodes.map((ep) => ({
      ...ep,
      clips: ep.clips.map((clip) =>
        clip.status === 'failed'
          ? { ...clip, status: 'pending' as ClipStatus, jobId: undefined, error: undefined }
          : clip,
      ),
      status: ep.status === 'done' ? ep.status : ('pending' as EpisodeStatus),
      error: ep.status === 'done' ? ep.error : undefined,
    })),
  });
}

/** Put one episode's unfinished clips back to pending so Continue re-runs them. */
export function retryEpisode(index: number): void {
  const ep = episodeOf(index);
  if (!ep) return;
  patchEpisode(index, {
    status: 'pending',
    error: undefined,
    clips: ep.clips.map((clip) =>
      clip.status === 'done' && clip.url
        ? clip
        : { ...clip, status: 'pending' as ClipStatus, jobId: undefined, error: undefined, message: undefined },
    ),
  });
  set({ error: null });
}

/** Re-plan one episode from scratch (its clips are rewritten, nothing rendered). */
export function replanEpisode(index: number, steer?: string): void {
  const ep = episodeOf(index);
  if (!ep || ep.status === 'done') return;
  patchEpisode(index, {
    clips: [],
    status: 'pending',
    error: undefined,
    steer: typeof steer === 'string' ? clampText(steer, 400) : ep.steer,
  });
}

// ---------------------------------------------------------------------------
// WorkspaceDB persistence — best-effort, never blocking a render
// ---------------------------------------------------------------------------
function episodeRows(): any[] {
  return state.episodes.map((ep) => ({
    index: ep.index,
    title: ep.title,
    logline: ep.logline,
    steer: ep.steer,
    status: ep.status,
    recap: ep.recap,
    videoUrl: ep.videoUrl,
    stitchMethod: ep.stitchMethod,
    error: ep.error,
    clips: ep.clips.map((clip) => ({
      index: clip.index,
      label: clip.label,
      prompt: clip.prompt,
      dialogue: clip.dialogue,
      status: clip.status,
      jobId: clip.jobId,
      url: clip.url,
      tailFrameUrl: clip.tailFrameUrl,
      error: clip.error,
    })),
  }));
}

async function persist(patch: Record<string, unknown> = {}): Promise<void> {
  await updateSeriesRow(state.rowId, {
    episodes_json: episodeRows(),
    episodes_done: episodesDone(),
    character_lock: state.lock,
    anchor_frame_url: (state.lock && state.lock.anchorFrameUrl) || null,
    character_image_url: (state.lock && state.lock.portraitUrl) || null,
    notice: state.notice,
    error: state.error,
    ...patch,
  });
}

async function createRow(): Promise<void> {
  const lock = state.lock;
  const saved = await createSeriesRow({
    title: state.title || 'Untitled series',
    brief: state.brief,
    episode_count: state.episodes.length,
    clips_per_episode: CLIPS_PER_EPISODE,
    episodes_done: 0,
    model: state.model,
    continuity_mode: continuityModeFor(state.model),
    tone: getTone(state.toneId).prompt,
    aspect_ratio: state.aspect,
    clip_seconds: state.clipSeconds,
    character_name: lock ? lock.name : null,
    character_description: lock ? lock.block : null,
    character_image_url: lock ? lock.portraitUrl || null : null,
    anchor_frame_url: lock ? lock.anchorFrameUrl || null : null,
    character_lock: lock,
    style_json: state.style,
    episodes_json: episodeRows(),
    status: 'running',
  });
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
 * Start the run from the confirmed plan. Saves the row, then drives.
 *
 * The `phase === 'running'` half of the guard is what makes a double-click
 * safe: `running` is only set once drive() actually begins, which is after the
 * row insert awaits, so a second press in that window would otherwise start a
 * second loop — and a second loop means every clip rendered twice. The phase is
 * set synchronously here, before any await, so the second press sees it.
 */
export async function startSeries(): Promise<void> {
  if (running || state.phase === 'running' || state.episodes.length === 0 || !state.lock) return;
  set({
    phase: 'running',
    error: null,
    resumable: false,
    startedAt: Date.now(),
    pauseRequested: false,
  });
  if (!state.rowId) await createRow();
  void drive();
}

/** Carry on from wherever the run stopped — nothing finished is re-rendered. */
export function continueSeries(): void {
  if (running || state.phase === 'running' || state.episodes.length === 0 || !state.lock) return;
  set({
    phase: 'running',
    error: null,
    resumable: false,
    pauseRequested: false,
    // The clock measures this stretch, not the wall time since a run that was
    // paused overnight first started.
    startedAt: Date.now(),
  });
  void drive();
}

async function drive(): Promise<void> {
  if (running) return;
  running = true;
  const token = ++runToken;
  try {
    // Bounded: one pass per episode at most, so nothing here can spin.
    for (let guard = 0; guard <= state.episodes.length; guard++) {
      if (stale(token)) return;
      if (state.pauseRequested) {
        set({ phase: 'paused', pauseRequested: false, cursor: 0 });
        await persist({ status: 'paused' });
        return;
      }
      const next = state.episodes.find((ep) => ep.status !== 'done');
      if (!next) {
        set({ phase: 'done', cursor: 0, error: null });
        await persist({ status: 'completed' });
        return;
      }
      const finished = await runEpisode(next.index, token);
      if (stale(token)) return;
      if (!finished) {
        // The episode stopped on something the visitor has to answer — a failed
        // clip, a rejected photo. The run pauses on the build view with the
        // reason and the retry buttons rather than burning through the rest.
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

/** The recap of the episode before this one, '' for the first. */
function previousRecap(index: number): string {
  const previous = state.episodes.filter((ep) => ep.index < index && ep.recap);
  return previous.length > 0 ? previous[previous.length - 1].recap : '';
}

/**
 * Build ONE episode: plan its four beats, draw the series anchor if this is the
 * first episode to need it, render the four clips in order, then stitch them
 * into the episode. Returns false when it stopped on something the visitor has
 * to decide.
 */
async function runEpisode(index: number, token: number): Promise<boolean> {
  const lockAtStart = state.lock;
  if (!lockAtStart) return false;
  set({ cursor: index });
  const existing = episodeOf(index);
  patchEpisode(index, {
    status: 'planning',
    error: undefined,
    startedAt: (existing && existing.startedAt) || Date.now(),
  });

  // ---- 1. The four beats ----
  let planned: EpisodeClipPlan[] = [];
  const already = episodeOf(index);
  if (already && already.clips.length > 0) {
    planned = already.clips.map((clip) => ({
      index: clip.index,
      label: clip.label,
      prompt: clip.prompt,
      dialogue: clip.dialogue,
    }));
  } else {
    const steer = (state.nextSteer || '').trim() || (already ? already.steer : '');
    const written = await planEpisodeClips({
      outline: { index, title: already ? already.title : `Episode ${index}`, logline: already ? already.logline : '' },
      episodeTotal: state.episodes.length,
      brief: state.brief,
      lock: lockAtStart,
      style: state.style,
      toneId: state.toneId,
      clipSeconds: state.clipSeconds,
      previously: previousRecap(index),
      steer,
    });
    if (stale(token)) return false;
    planned = written;
    patchEpisode(index, {
      steer,
      clips: written.map((clip) => ({ ...clip, status: 'pending' as ClipStatus })),
    });
    // The steer has been spent on this episode; the next one starts clean.
    if (state.nextSteer) set({ nextSteer: '' });
    await persist();
  }

  // ---- 2. The series anchor frame, once ----
  // With a single reference the engines animate out of it, so a plain studio
  // portrait would make an episode's first clip open on that headshot. One
  // in-situation still — drawn once for the whole series, cheaper than a clip —
  // is the anchor instead, and it doubles as the second reference that routes
  // Kling to its multi-image endpoint. It is drawn whether or not the character
  // has a portrait: without one it is the series' only visual reference, which
  // is worth more than nothing. The photoDropped guard is the exception — after
  // the safety filter rejected the character's image, drawing a fresh one would
  // walk straight back into it.
  if (state.lock && !state.lock.anchorFrameUrl && !state.photoDropped) {
    const frame = await drawSeriesAnchorFrame({
      lock: state.lock,
      openingPrompt: planned.length > 0 ? planned[0].prompt : state.brief,
      aspect: state.aspect,
      toneId: state.toneId,
      style: state.style,
    });
    if (stale(token)) return false;
    if (frame && state.lock) {
      set({ lock: withAnchorFrame(state.lock, frame) });
      await persist();
    }
  }

  // ---- 3. The four clips, one at a time so each can continue the last ----
  patchEpisode(index, { status: 'rendering' });
  await persist({ status: 'running' });
  let continuityFrame = '';
  for (let i = 1; i <= CLIPS_PER_EPISODE; i++) {
    if (stale(token)) return false;
    const outcome = await runClip(index, i, continuityFrame, token);
    if (stale(token)) return false;
    if (!outcome.ok) {
      patchEpisode(index, {
        status: 'failed',
        error:
          (clipOf(index, i) && clipOf(index, i)!.error) ||
          `Clip ${i} of ${CLIPS_PER_EPISODE} didn’t render.`,
      });
      await persist();
      return false;
    }
    continuityFrame = outcome.tail;
  }

  // ---- 4. Stitch the episode ----
  const clipUrls = (episodeOf(index) || { clips: [] as ClipState[] }).clips
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((clip) => clip.url || '')
    .filter((url) => /^https?:\/\//.test(url));
  patchEpisode(index, { status: 'stitching' });
  const outcome = await stitchProject(clipUrls, {
    workspaceUuid: workspaceUuid(),
    fileName: `vidverge-e${index}-${Date.now()}.mp4`,
  });
  if (stale(token)) return false;

  const episode = episodeOf(index);
  const recap = recapFor(
    { index, title: episode ? episode.title : `Episode ${index}`, logline: episode ? episode.logline : '' },
    planned,
  );
  // A stitch that could not run is not a failed episode: the four clips exist
  // and are handed over individually, which is exactly what Long Video does.
  patchEpisode(index, {
    status: 'done',
    videoUrl: outcome.url,
    stitchMethod: outcome.method,
    audio: outcome.audio,
    recap,
    error: outcome.url ? undefined : outcome.error,
    finishedAt: Date.now(),
  });
  await persist();
  return true;
}

/**
 * Render ONE clip and pull the still the next clip continues from. Returns the
 * tail frame so the caller can hand it straight to clip N+1.
 */
async function runClip(
  epIndex: number,
  clipIndex: number,
  continuityFrameUrl: string,
  token: number,
): Promise<{ ok: boolean; tail: string }> {
  const clip = clipOf(epIndex, clipIndex);
  const episode = episodeOf(epIndex);
  const lock = state.lock;
  if (!clip || !episode || !lock) return { ok: false, tail: '' };
  // Already paid for: keep it, and keep the chain going from its tail.
  if (clip.status === 'done' && clip.url) {
    return { ok: true, tail: clip.tailFrameUrl || continuityFrameUrl };
  }

  let jobId = clip.jobId;
  if (!jobId) {
    patchClip(epIndex, clipIndex, {
      status: 'submitting',
      message: 'Starting this clip…',
      error: undefined,
    });
    const submitted = await submitEpisodeClip({
      clip: { index: clip.index, label: clip.label, prompt: clip.prompt, dialogue: clip.dialogue },
      lock,
      style: state.style,
      continuityFrameUrl,
      seriesTitle: state.title,
      episodeTitle: episode.title,
      episodeIndex: epIndex,
      episodeTotal: state.episodes.length,
      model: state.model,
      seriesId: state.rowId,
      toneId: state.toneId,
      aspect: state.aspect,
      clipSeconds: state.clipSeconds,
    });
    if (stale(token)) return { ok: false, tail: '' };
    if (!submitted.success || !submitted.jobId) {
      patchClip(epIndex, clipIndex, {
        status: 'failed',
        error: submitted.error || 'This clip could not be started.',
        message: undefined,
      });
      await persist();
      return { ok: false, tail: '' };
    }
    if (submitted.notice) set({ notice: submitted.notice });
    jobId = submitted.jobId;
  }

  patchClip(epIndex, clipIndex, {
    status: 'rendering',
    jobId,
    message: 'Rendering…',
    error: undefined,
  });
  // Fire-and-forget: this snapshot only records "rendering", and awaiting the
  // DB round trip here delayed the first status poll of EVERY clip. The next
  // awaited persist (when the clip lands) always supersedes it, minutes later.
  void persist();

  try {
    const result = await waitForSceneRender(jobId, {
      // The stale check matters on the TICK too, not just the abort: the poller
      // reports one more time before it notices it was aborted, which would
      // print "Rendering…" back onto a clip that Stop had just put back to
      // pending — a spinner for a render nobody is watching any more.
      onTick: (message) => {
        if (!stale(token)) patchClip(epIndex, clipIndex, { message });
      },
      isAborted: () => stale(token),
    });
    if (stale(token)) return { ok: false, tail: '' };
    const url = result.clipUrls.length > 0 ? result.clipUrls[0] : '';
    if (!url) {
      patchClip(epIndex, clipIndex, {
        status: 'failed',
        error: 'The render finished without a clip file.',
        message: undefined,
      });
      await persist();
      return { ok: false, tail: '' };
    }
    // The chain: the last frame of this clip is what the next one continues
    // out of. Best-effort — the final clip needs none, and a frame that cannot
    // be pulled simply leaves the next clip on the series anchor.
    const tail =
      clipIndex < CLIPS_PER_EPISODE ? await tailFrameOf(url, state.clipSeconds) : '';
    if (stale(token)) return { ok: false, tail: '' };
    patchClip(epIndex, clipIndex, {
      status: 'done',
      url,
      tailFrameUrl: tail || undefined,
      message: undefined,
    });
    await persist();
    return { ok: true, tail };
  } catch (e: any) {
    if (stale(token)) return { ok: false, tail: '' };
    const message = (e && e.message) || 'This clip failed to render.';
    patchClip(epIndex, clipIndex, { status: 'failed', error: message, message: undefined });
    // A rejected character photo is a specific, fixable thing rather than a
    // generic failure, so the build view is told which it was.
    if (isContentFilterError(message) && state.lock && state.lock.portraitUrl) {
      set({
        error:
          'The video model’s safety filter turned the character photo down. Carry on without the photo — the written character still goes into every clip — or try that photo once more.',
      });
    }
    await persist();
    return { ok: false, tail: '' };
  }
}
