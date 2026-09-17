/**
 * apps/Create/videoStore.ts — the studio's GLOBAL store.
 *
 * WHY THIS FILE EXISTS (the tab-switch bug):
 * The shell renders exactly one app at a time (Desktop.tsx swaps `CurrentApp`
 * and re-keys the error boundary), so opening another app — or switching the
 * studio's own mode tabs — UNMOUNTS this app's whole React tree. When the
 * render's job id, poll loop and result lived in component state, that unmount
 * killed the polling effect and threw the result away: the visitor came back
 * to a blank Create screen with no way to tell whether their video was still
 * coming. On mobile it was worse — the shell mounts a second, hidden copy of
 * the app, so component-owned polling ran twice.
 *
 * So none of it lives in React any more. The flow state, the render job, the
 * poll loop and the audio remux all live here in module scope: created once
 * when the app is first opened and alive for the rest of the page's life.
 * Components subscribe with useVideoStudio() and are pure projections of this
 * state — unmounting one drops a listener and nothing else. The render carries
 * on in the background, and re-mounting shows exactly where it got to.
 *
 * The backend pipeline is untouched: generate-video to start, check-video-status
 * to poll, lib/client-stitch for the audio-preserving remux.
 */
import { useEffect, useState } from 'react';
import { remuxAndAttachAudio } from '../../lib/client-stitch';
import {
  approveAndFinalizeJob,
  checkVideoStatus,
  contentBlockReason,
  fetchWebsiteBrief,
  fetchWebsiteImages,
  generateScript,
  isJobLostStatus,
  scopedSpaceId,
  sessionId,
  submitStudioVideo,
  type WebsiteBrief,
  type WebsiteImage,
} from './studioApi';
import { extractVideoFrames, getChainReference, isHttpUrl, noteCompletedFrame } from './frameChain';
import {
  DEFAULT_VIDEO_MODEL,
  getTone,
  getVideoType,
  renderClipSeconds,
  type AspectRatio,
  type BoardScene,
  type CharacterRef,
  type LengthId,
  type ScriptBrief,
} from './videoTypes';

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------
/** Which screen of the linear flow is showing. */
export type Screen = 'home' | 'brief' | 'storyboard' | 'render';

/**
 * The creation modes. Short is the redesigned main flow.
 *
 * 'episodes' is Long Series — N episodes, each one a 4-clip assembly — and it is
 * the one mode whose state does NOT live in this store: a series is forty
 * renders long, so it owns its own module-scope store and run loop in
 * apps/Create/seriesRunner.ts for exactly the reason described at the top of
 * this file. This store only remembers that the visitor is in that mode.
 *
 * 'agentic' is the same arrangement for the AGENTIC VIDEO SYSTEM — the AUTO /
 * Faceless / Avatar / UI Motion / Ad / Long Series pipeline whose director,
 * per-shot production router and persistent production memory live in
 * apps/Create/agenticRunner.ts. Again, this store only remembers the mode.
 */
export type Mode = 'short' | 'long' | 'series' | 'episodes' | 'product-ad' | 'agentic' | 'sports';

/** How this brief was started — a pasted link, an uploaded image, or typed. */
export type Source = 'url' | 'image' | 'idea';

/** An App Mockup the render should weave into the phone-in-hand beat. */
export interface MockupPick {
  id: number;
  name: string;
  imageUrl: string;
}

export type RenderPhase = 'scripting' | 'submitting' | 'rendering' | 'finishing' | 'ready' | 'failed';

/**
 * The one render this browser is watching. Persisted, so a reload (or a
 * visitor who wandered off to another app for ten minutes) picks the same job
 * back up instead of losing it.
 */
export interface RenderJob {
  /** Null only in the seconds between pressing Generate and the hook answering. */
  jobId: string | null;
  title: string;
  aspect: AspectRatio;
  startedAt: number;
  phase: RenderPhase;
  /** Customer-facing line for the current phase. */
  message: string;
  downloadUrl: string | null;
  error: string | null;
  /**
   * True when the video service refused the brief on content grounds rather
   * than stumbling on it — a different answer, so a different message.
   */
  blocked?: boolean;
  /**
   * Where the progress bar had got to when the job stopped. Set once, by
   * endJob(), so a finished-with-nothing render draws a FROZEN bar instead of
   * one that keeps creeping behind an error.
   */
  stoppedProgress?: number;
  /**
   * Whether this render has a soundtrack. Omni starts with native sound, then
   * this is replaced by whatever the hook reports.
   */
  audio?: 'silent' | 'ready' | 'pending' | 'none' | string;
  /** A calm, non-error informational line returned by the render hook. */
  notice?: string;
  /** The model the render actually started on, as the hook reported it. */
  modelUsed?: string;
  /** Still extracted ~0.1s into the finished video (frame chaining). */
  firstFrameUrl?: string;
  /** The finished video's final frame — it seeds the next render's character. */
  lastFrameUrl?: string;
  /**
   * True when this ready job was rebuilt from a previous visit's saved result
   * (vidverge_last_video, or a reloaded store snapshot) rather than generated
   * during this page load — the delivery screen labels it "Your last video"
   * and offers a Start over that also forgets the remembered result.
   */
  restored?: boolean;
}

export interface StudioState {
  mode: Mode;
  screen: Screen;
  source: Source;
  /** Product Ad ('product_ad') for a link/image, 'custom' for a typed idea. */
  typeId: string;

  // --- Step 1: the URL ---
  url: string;
  fetching: boolean;
  fetched: boolean;

  // --- Step 2: the brief we read back ---
  brief: WebsiteBrief | null;
  /** Anything the visitor wants the video to hit, or their typed idea. */
  idea: string;
  images: WebsiteImage[];
  selectedImages: string[];
  /** Vision read of an uploaded image — every scene is drawn to match it. */
  visualReference: string;

  // --- Step 3: optional add-ons ---
  character: CharacterRef | null;
  mockup: MockupPick | null;

  // --- Format ---
  toneId: string;
  lengthId: LengthId;
  aspect: AspectRatio;
  model: string;

  // --- Script / storyboard (optional review step) ---
  scenes: BoardScene[];
  sceneImages: Record<string, string>;
  title: string;
  characterDescription: string;
  scriptLoading: boolean;
  /** Fingerprint of the brief the current scenes were written from. */
  scriptKey: string;

  error: string | null;
  job: RenderJob | null;
  /**
   * How many times this brief has been re-sent to the render engine. Capped at
   * MAX_RETRIES: past that the screen stops offering Try again and offers Start
   * over instead, because a fourth identical attempt has never once produced a
   * different answer and the customer deserves to be told so rather than left
   * pressing a button.
   */
  retryCount: number;
}

const EMPTY_STATE: StudioState = {
  mode: 'short',
  screen: 'home',
  source: 'url',
  typeId: 'product_ad',
  url: '',
  fetching: false,
  fetched: false,
  brief: null,
  idea: '',
  images: [],
  selectedImages: [],
  visualReference: '',
  character: null,
  mockup: null,
  toneId: 'professional',
  lengthId: 'medium',
  aspect: '9:16',
  model: DEFAULT_VIDEO_MODEL,
  scenes: [],
  sceneImages: {},
  title: '',
  characterDescription: '',
  scriptLoading: false,
  scriptKey: '',
  error: null,
  job: null,
  retryCount: 0,
};

// ---------------------------------------------------------------------------
// Persistence — the flow survives a reload, not just a tab switch.
// ---------------------------------------------------------------------------
const STORE_KEY = 'vidverge.studio.v1';

/** Flags that describe work in flight are never restored — only its result. */
function persistable(s: StudioState): Partial<StudioState> {
  // Extracted frames persist only as https URLs: the base64 data-URL fallback
  // can be hundreds of KB and would eat the localStorage quota.
  const job = s.job
    ? {
        ...s.job,
        firstFrameUrl: isHttpUrl(s.job.firstFrameUrl) ? s.job.firstFrameUrl : undefined,
        lastFrameUrl: isHttpUrl(s.job.lastFrameUrl) ? s.job.lastFrameUrl : undefined,
      }
    : s.job;
  return {
    ...s,
    job,
    fetching: false,
    scriptLoading: false,
  };
}

function load(): StudioState {
  if (typeof window === 'undefined') return EMPTY_STATE;
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return withRestoredForm(EMPTY_STATE);
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return withRestoredForm(EMPTY_STATE);
    return {
      ...EMPTY_STATE,
      ...parsed,
      model: DEFAULT_VIDEO_MODEL,
      fetching: false,
      scriptLoading: false,
    };
  } catch {
    return withRestoredForm(EMPTY_STATE);
  }
}

function save(s: StudioState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(persistable(s)));
  } catch {
    /* storage disabled — the store still works, it just forgets on reload */
  }
}

// ---------------------------------------------------------------------------
// Two additional, independent keys layered on top of STORE_KEY:
//   - LAST_VIDEO_KEY   — the last SUCCESSFUL render, replaced on every new
//                        success and never touched by a failure.
//   - CREATE_STATE_KEY — the in-progress form session, mirrored (debounced)
//                        on every user change and cleared by a success so the
//                        next video starts from a fresh sheet.
// ---------------------------------------------------------------------------
const LAST_VIDEO_KEY = 'vidverge_last_video';
const CREATE_STATE_KEY = 'vidverge_create_state';

/** Everything the visitor fills in — the fields mirrored to CREATE_STATE_KEY. */
const FORM_KEYS = [
  'mode',
  'screen',
  'source',
  'typeId',
  'url',
  'idea',
  'brief',
  'images',
  'selectedImages',
  'visualReference',
  'character',
  'mockup',
  'toneId',
  'lengthId',
  'aspect',
  'model',
  'scenes',
  'sceneImages',
  'title',
  'characterDescription',
  'scriptKey',
] as const;

function formStateChanged(a: StudioState, b: StudioState): boolean {
  return FORM_KEYS.some((key) => a[key] !== b[key]);
}

function createStateOf(s: StudioState): Partial<StudioState> {
  const out: Partial<StudioState> = {};
  for (const key of FORM_KEYS) (out as any)[key] = s[key];
  return out;
}

let createStateTimer: number | null = null;

/**
 * Mirror the form fields to CREATE_STATE_KEY, debounced 300ms so a fast typer
 * costs one write per pause rather than one per keystroke. Called from set()
 * only when a form field actually changed — render-job patches never rewrite
 * it, so the clear that follows a successful generation sticks.
 */
function saveCreateStateDebounced(): void {
  if (typeof window === 'undefined') return;
  if (createStateTimer !== null) window.clearTimeout(createStateTimer);
  createStateTimer = window.setTimeout(() => {
    createStateTimer = null;
    try {
      window.localStorage.setItem(CREATE_STATE_KEY, JSON.stringify(createStateOf(state)));
    } catch {
      /* storage disabled — the mirror is best-effort */
    }
  }, 300);
}

/** A successful generation closes the saved form session. */
function clearCreateState(): void {
  if (typeof window === 'undefined') return;
  if (createStateTimer !== null) {
    window.clearTimeout(createStateTimer);
    createStateTimer = null;
  }
  try {
    window.localStorage.removeItem(CREATE_STATE_KEY);
  } catch {
    /* storage disabled */
  }
}

/** Read CREATE_STATE_KEY, silently treating bad JSON as nothing saved. */
function loadCreateState(): Partial<StudioState> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CREATE_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const out: Partial<StudioState> = {};
    for (const key of FORM_KEYS) {
      if (key in parsed && parsed[key] !== undefined) (out as any)[key] = parsed[key];
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * EMPTY_STATE with the saved form session laid over it — the fallback used
 * when the main STORE_KEY snapshot is missing or unreadable, so a half-filled
 * brief still comes back. Anything missing or invalid falls back to defaults.
 */
function withRestoredForm(base: StudioState): StudioState {
  const form = loadCreateState();
  if (!form) return base;
  return { ...base, ...form, model: DEFAULT_VIDEO_MODEL, fetching: false, scriptLoading: false };
}

/** The prompt text a video was generated from — stored with the last video. */
function briefTextOf(s: StudioState): string {
  const b = s.brief;
  const briefLine = b
    ? [b.name, b.tagline, b.features]
        .map((part) => (part || '').trim())
        .filter(Boolean)
        .join(' — ')
    : '';
  return s.idea.trim() || briefLine || (s.job ? s.job.title : '') || s.title || '';
}

interface LastVideoRecord {
  videoUrl: string;
  jobId: string | null;
  timestamp: number;
  brief: string;
}

function readLastVideo(): LastVideoRecord | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LAST_VIDEO_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.videoUrl !== 'string' || !parsed.videoUrl) return null;
    return {
      videoUrl: parsed.videoUrl,
      jobId: typeof parsed.jobId === 'string' && parsed.jobId ? parsed.jobId : null,
      timestamp: typeof parsed.timestamp === 'number' ? parsed.timestamp : Date.now(),
      brief: typeof parsed.brief === 'string' ? parsed.brief : '',
    };
  } catch {
    return null;
  }
}

/** REPLACED on every new success (from finish()); never cleared on an error. */
function saveLastVideo(record: LastVideoRecord): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LAST_VIDEO_KEY, JSON.stringify(record));
  } catch {
    /* storage disabled */
  }
}

/** Forget the remembered last video (the restored screen's Start over). */
export function clearLastVideo(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LAST_VIDEO_KEY);
  } catch {
    /* storage disabled */
  }
}

// ---------------------------------------------------------------------------
// The store itself
// ---------------------------------------------------------------------------
let state: StudioState = load();
const listeners = new Set<() => void>();

export function getStudioState(): StudioState {
  return state;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function set(patch: Partial<StudioState>): void {
  const prev = state;
  state = { ...state, ...patch };
  save(state);
  if (formStateChanged(prev, state)) saveCreateStateDebounced();
  listeners.forEach((l) => {
    try {
      l();
    } catch (e) {
      console.warn('[Studio] listener failed:', e);
    }
  });
}

function patchJob(patch: Partial<RenderJob>): void {
  if (!state.job) return;
  set({ job: { ...state.job, ...patch } });
}

/**
 * Subscribe a component to the store. The whole state object is the snapshot,
 * so any change re-renders the subscriber — the trees here are small and this
 * keeps every surface honest about what the render is actually doing.
 */
export function useVideoStudio(): StudioState {
  const [snapshot, setSnapshot] = useState<StudioState>(getStudioState);
  useEffect(() => {
    // The store may have moved between this component's render and its
    // subscription (a poll tick landing mid-mount), so re-read once.
    setSnapshot(getStudioState());
    return subscribe(() => setSnapshot(getStudioState()));
  }, []);
  return snapshot;
}

// ---------------------------------------------------------------------------
// Render job helpers
// ---------------------------------------------------------------------------
export function isJobActive(job: RenderJob | null): boolean {
  return !!job && job.phase !== 'ready' && job.phase !== 'failed';
}

/** 0–1, for the progress bar. Deliberately coarse: the hook has no real %. */
export function jobProgress(job: RenderJob | null): number {
  if (!job) return 0;
  switch (job.phase) {
    case 'scripting':
      return 0.12;
    case 'submitting':
      return 0.24;
    case 'rendering':
      // Creeps toward 85% over ~5 minutes so a long render still feels alive.
      return Math.min(0.85, 0.34 + ((Date.now() - job.startedAt) / 300000) * 0.5);
    case 'finishing':
      return 0.92;
    case 'failed':
      // FROZEN, deliberately: the bar stays exactly where the render stopped.
      // It is time-independent, so nothing animates once a job is over.
      return typeof job.stoppedProgress === 'number' ? job.stoppedProgress : 0.34;
    default:
      return 1;
  }
}

/**
 * End a job for good — the ONE way anything in this store finishes badly.
 *
 * It stops the poll loop and freezes the progress bar in the same breath,
 * because those two used to drift apart: a render that was over still had a
 * creeping bar and a spinning stage row underneath its error.
 */
function endJob(outcome: { message: string; error: string; blocked?: boolean }): void {
  if (!state.job) return;
  const stoppedProgress = jobProgress(state.job);
  stopWatching();
  patchJob({
    phase: 'failed',
    message: outcome.message,
    error: outcome.error,
    blocked: outcome.blocked === true,
    stoppedProgress,
  });
}

// ---------------------------------------------------------------------------
// THE POLL LOOP — module-level, so no unmount can stop it.
// ---------------------------------------------------------------------------
/**
 * POLLING BACKS OFF EXPONENTIALLY — 1.5s right after the submit (when a fast
 * answer is genuinely likely), doubling to a 6s ceiling. The old 30s ceiling
 * meant a finished render could sit undetected for half a minute before the
 * screen said so; 6s keeps that latency low while still asking the status
 * hook only ~10 times a minute on a long render. Reset per watched job.
 */
const POLL_MIN_MS = 1500;
const POLL_MAX_MS = 6000;
let pollDelayMs = POLL_MIN_MS;

/**
 * NOTHING HERE RUNS FOREVER.
 *
 * Three ceilings, because "the UI is stuck" and "the UI is patient" look
 * identical from the outside and only one of them is acceptable:
 *   - MAX_RETRIES        — a brief is re-sent at most 3 times, with the waits
 *                          below between them, and then the screen says so.
 *   - MAX_POLL_MS        — a render nobody has heard from in 25 minutes is over.
 *                          Renders take 2-6; 25 is generous, not a guess.
 *   - MAX_POLL_FAILURES  — consecutive status calls that fail outright. A few
 *                          are a wobbly connection and the loop rides them out;
 *                          twelve in a row (three minutes) is not.
 * Every one of them ends on an actionable screen, never a spinner.
 */
export const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = [0, 2000, 4000, 8000];
const MAX_POLL_MS = 25 * 60 * 1000;
const MAX_POLL_FAILURES = 12;
/** After this long, the wait itself gets acknowledged — see stillWorkingLine. */
export const SLOW_RENDER_MS = 60000;

/** Consecutive failed status CALLS (not failed renders) for the watched job. */
let pollFailures = 0;

// --- Bounded automatic fallbacks (Part 1) --------------------------------
// Each fires AT MOST ONCE per brief, so no path here can loop. They are reset
// only when a genuinely new brief starts — see resetAutoFallbacks().
/** The one automatic "drop the flagged character photo and resubmit" retry. */
let likenessFallbackUsed = false;
/** True when the LAST submit actually carried a character/chain image. */
let lastSubmitCarriedCharacterImage = false;
/** Set by the likeness fallback: the next submit goes out without the photo. */
let suppressCharacterImageOnce = false;

function resetAutoFallbacks(): void {
  likenessFallbackUsed = false;
  lastSubmitCarriedCharacterImage = false;
  suppressCharacterImageOnce = false;
}

/**
 * A LIKENESS REFUSAL IS RECOVERABLE ONCE (never block on a flagged character
 * photo): when the video service refuses on people/likeness grounds and the
 * submit carried a character or chain image, drop the image and resubmit the
 * same brief automatically — the character still travels as text, and the
 * photo stays in app state for the UI and for frame chaining. Any other
 * refusal (or a second one) ends the job with the real reason, as before.
 */
function handleRefusal(reason: string): void {
  const likeness = /likeness|real people|real person|people's names|people’s names|famous|celebrit/i.test(reason);
  if (likeness && lastSubmitCarriedCharacterImage && !likenessFallbackUsed) {
    likenessFallbackUsed = true;
    suppressCharacterImageOnce = true;
    stopWatching();
    set({ job: null });
    void generateVideo();
    return;
  }
  endJob({ message: 'This render was turned down', error: reason, blocked: true });
}

/**
 * THE UI IS NEVER SILENT. Past a minute the stage line stops repeating itself
 * and starts acknowledging the wait, so a long render reads as a long render
 * rather than as a screen that has stopped talking.
 */
export function stillWorkingLine(job: RenderJob | null): string | null {
  if (!job || !isJobActive(job)) return null;
  const elapsed = Date.now() - job.startedAt;
  if (elapsed < SLOW_RENDER_MS) return null;
  if (elapsed > 10 * 60 * 1000) {
    return 'Still working — this one is taking longer than usual. It keeps going even if you leave.';
  }
  if (elapsed > 4 * 60 * 1000) {
    return 'Still working… most renders land between two and six minutes.';
  }
  return 'Still working… the engine has your scenes.';
}

let pollTimer: number | null = null;
/** The job the loop is currently watching; guards against double-starting. */
let watchedJobId: string | null = null;
/** One automatic audio remux attempt per job per page load. */
let remuxedJobId: string | null = null;
/** One automatic review-window approval per job per page load. */
let autoApprovedJobId: string | null = null;

function clearPollTimer(): void {
  if (pollTimer !== null && typeof window !== 'undefined') {
    window.clearTimeout(pollTimer);
  }
  pollTimer = null;
}

function stopWatching(): void {
  clearPollTimer();
  watchedJobId = null;
}

function schedule(jobId: string): void {
  if (typeof window === 'undefined') return;
  clearPollTimer();
  const wait = pollDelayMs;
  pollDelayMs = Math.min(POLL_MAX_MS, pollDelayMs * 2);
  pollTimer = window.setTimeout(() => {
    pollTimer = null;
    void tick(jobId).catch((e) => {
      // Never let a poll take the loop down with it — see watchJob.
      console.warn('[Studio] status poll threw, retrying on the next tick:', e);
      if (watchedJobId === jobId) schedule(jobId);
    });
  }, wait);
}

async function tick(jobId: string): Promise<void> {
  if (watchedJobId !== jobId) return;

  // A render that has outlived every reasonable estimate is over. Without this
  // the loop below would poll a lost job until the tab closed, and the screen
  // would keep saying "Generating your video…" hours after anything was.
  const job = state.job;
  if (job && job.jobId === jobId && Date.now() - job.startedAt > MAX_POLL_MS) {
    endJob({
      message: 'We lost track of this render',
      error:
        'The render engine stopped answering for this video. Your brief is safe — try it again, or start over with a new one.',
    });
    return;
  }

  const status = await checkVideoStatus(jobId);
  if (watchedJobId !== jobId) return;

  // A failed status CALL is not a failed render — but an unbroken run of them
  // means nothing is coming back, so it ends rather than spinning forever.
  if (!status.success) {
    // A refusal can arrive on an unsuccessful envelope too, and it is an
    // ENDING rather than a hiccup — checked first so it is never mistaken for
    // a connection problem and retried.
    const refusedEarly = contentBlockReason(status);
    if (refusedEarly) {
      handleRefusal(refusedEarly);
      return;
    }
    // HARD 404 / LOST-JOB FAILURE (Sep 12 2026): a job the render service no
    // longer knows (provider 404 / "not found") can never complete — end it
    // NOW with an actionable screen instead of burning through the
    // consecutive-failure budget re-asking an answer that cannot change.
    if (isJobLostStatus(status.error)) {
      endJob({
        message: 'The render was lost',
        error:
          'The render service no longer recognises this render job — it was lost provider-side. Your brief is safe — try it again.',
      });
      return;
    }
    pollFailures += 1;
    if (pollFailures >= MAX_POLL_FAILURES) {
      endJob({
        message: 'We lost contact with the render',
        error:
          'We could not reach the render service for several minutes. Your brief is safe — check My Videos in a moment, or try it again.',
      });
      return;
    }
    patchJob({
      message:
        pollFailures > 2
          ? 'Reconnecting to the render service…'
          : state.job?.message || 'Generating your video…',
    });
    schedule(jobId);
    return;
  }
  pollFailures = 0;

  // NO APPROVAL GATE: a render parked in the review window
  // ('awaiting_approval') is approved and finalized automatically — the
  // visitor can still regenerate any scene from My Videos afterwards, but the
  // pipeline never sits waiting for "Approve Video & Make Final".
  const approvalText = `${status.status || ''} ${status.stage || ''}`.toLowerCase();
  if (/approv|review/.test(approvalText) && autoApprovedJobId !== jobId) {
    autoApprovedJobId = jobId;
    void approveAndFinalizeJob(jobId).then((approval) => {
      if (!approval.success) {
        console.warn('[Studio] auto-approval call failed (the render still auto-finalizes):', approval.error);
      }
    });
  }

  // The hook is the authority on sound: it knows which engine rendered the job.
  if (typeof status.audio === 'string' && status.audio) patchJob({ audio: status.audio });

  const ready = status.success && (status.stage === 'ready' || status.status === 'completed' || status.status === 'partial');
  const failed = status.success && (status.stage === 'failed' || status.status === 'failed');

  if (ready) {
    // Multi-clip renders come back as a fast, video-only cut; rebuild it in
    // the browser with the clips' own audio before we call it finished.
    if (
      status.audio === 'pending' &&
      Array.isArray(status.clip_urls) &&
      status.clip_urls.length > 1 &&
      status.workspace_uuid &&
      remuxedJobId !== jobId
    ) {
      remuxedJobId = jobId;
      patchJob({ phase: 'finishing', message: 'Attaching the soundtrack…' });
      try {
        const url = await remuxAndAttachAudio({
          spaceId: scopedSpaceId(),
          workspaceUuid: status.workspace_uuid,
          jobId,
          clipUrls: status.clip_urls,
          sessionId: sessionId(),
          onStage: (stage: string) =>
            patchJob({
              message:
                stage === 'stitching'
                  ? 'Attaching the soundtrack…'
                  : stage === 'uploading'
                    ? 'Saving the final cut…'
                    : 'Almost there…',
            }),
        });
        if (watchedJobId !== jobId) return;
        finish(jobId, url);
        return;
      } catch (e) {
        console.warn('[Studio] audio remux failed, shipping the fast cut:', e);
        if (watchedJobId !== jobId) return;
      }
    }
    if (status.download_url) {
      finish(jobId, status.download_url);
      return;
    }
  }

  // A CONTENT REFUSAL IS AN ENDING, not a hiccup: this brief will never come
  // back as a video, so there is nothing left to poll for and nothing left to
  // animate. Checked before the generic failure so the customer gets the real
  // reason rather than "try generating it again".
  const refusal = contentBlockReason(status);
  if (refusal) {
    handleRefusal(refusal);
    return;
  }

  if (failed) {
    const failText = status.user_message || status.error || '';
    endJob({
      message: 'The render did not make it',
      error: failText || 'The render failed. Your brief is safe — try generating it again.',
    });
    return;
  }

  // Still going (or a transient status hiccup): keep the visitor informed and
  // come back on the next poll. A failed status CALL is never treated as a
  // failed job.
  patchJob({
    phase: status.stage === 'stitching' || status.audio === 'pending' ? 'finishing' : 'rendering',
    message: status.user_message || 'Generating your video…',
  });
  schedule(jobId);
}

function finish(jobId: string, downloadUrl: string): void {
  stopWatching();
  pollFailures = 0;
  // A render that worked hands its retries back: the next brief that stumbles
  // gets the full three attempts rather than whatever this one had left.
  set({ retryCount: 0 });
  patchJob({ phase: 'ready', message: 'Your video is ready', downloadUrl, error: null });
  // A NEW success replaces the remembered last video and closes the saved form
  // session (vidverge_create_state) — neither is ever touched by a failure.
  saveLastVideo({ videoUrl: downloadUrl, jobId, timestamp: Date.now(), brief: briefTextOf(state) });
  clearCreateState();
  // FRAME CHAINING: pull the first and last frame out of the finished video in
  // the background. The last frame seeds the next render's character (and the
  // series anchor while a series is live). Best-effort — a video host without
  // CORS simply yields no frames, never a failed job.
  void captureFramesForJob(jobId, downloadUrl);
}

async function captureFramesForJob(jobId: string, downloadUrl: string): Promise<void> {
  try {
    const frames = await extractVideoFrames(downloadUrl);
    if (!frames.firstFrameUrl && !frames.lastFrameUrl) return;
    if (state.job && state.job.jobId === jobId) {
      patchJob({
        firstFrameUrl: frames.firstFrameUrl || undefined,
        lastFrameUrl: frames.lastFrameUrl || undefined,
      });
    }
    if (frames.lastFrameUrl) {
      const title = state.job && state.job.jobId === jobId ? state.job.title : '';
      noteCompletedFrame({ url: frames.lastFrameUrl, title: title || 'Your last video', jobId });
    }
  } catch (e) {
    console.warn('[Studio] frame extraction skipped:', e);
  }
}

/**
 * Start (or resume) watching a render. Idempotent: calling it again for the
 * job already being watched is a no-op, which is what keeps the mobile shell's
 * second, hidden copy of this app from doubling every status request.
 */
export function watchJob(jobId: string): void {
  if (!jobId || watchedJobId === jobId) return;
  stopWatching();
  watchedJobId = jobId;
  pollFailures = 0;
  pollDelayMs = POLL_MIN_MS;
  // EVERY poll is caught here as well as inside tick(): an unhandled rejection
  // in the loop used to kill the watcher outright, which is what left the
  // progress screen frozen on its last message with no way forward.
  void tick(jobId).catch((e) => {
    console.warn('[Studio] status poll threw, retrying on the next tick:', e);
    if (watchedJobId === jobId) schedule(jobId);
  });
}

// ---------------------------------------------------------------------------
// Actions — step 1: the URL
// ---------------------------------------------------------------------------
export function setUrl(url: string): void {
  set({ url });
}

/**
 * The home hero's one big input, mirrored into the store so a tab switch, the
 * mobile shell's hidden second copy of the app, and a reload all keep a
 * half-typed draft. It lands in `idea` (and clears `url`) because the hero
 * seeds itself from `url || idea`; submitting re-parses the text either way.
 */
export function setHomeDraft(text: string): void {
  set({ idea: text, url: '' });
}

/**
 * Switching mode deliberately leaves `screen` alone: it is only read while
 * mode is 'short', so a visit to Long Video and back returns the visitor to
 * the brief — or the render — they were on rather than the home screen.
 */
export function setMode(mode: Mode): void {
  set({ mode });
}

export function setScreen(screen: Screen): void {
  set({ screen });
}

let fetchSeq = 0;

/**
 * The hero path: a pasted product URL is read for us (real page scrape first,
 * indexed-search guess second) and lands on the editable summary card. The
 * screen flips to 'brief' immediately so the fetch happens in front of the
 * visitor rather than behind a spinner on the home screen.
 */
export async function startFromUrl(rawUrl: string): Promise<void> {
  const url = (rawUrl || '').trim();
  if (!url) return;
  resetAutoFallbacks();
  const seq = ++fetchSeq;
  set({
    ...EMPTY_STATE,
    mode: state.mode,
    model: state.model,
    job: state.job,
    source: 'url',
    typeId: 'product_ad',
    url,
    screen: 'brief',
    fetching: true,
    fetched: false,
  });
  const [brief, images] = await Promise.all([fetchWebsiteBrief(url), fetchWebsiteImages(url)]);
  if (seq !== fetchSeq) return; // a newer URL took over
  set({
    fetching: false,
    fetched: true,
    brief: brief || { name: '', tagline: '', features: '', tone: 'confident, modern' },
    images,
    selectedImages: images.slice(0, 1).map((i) => i.url),
    error:
      !brief && images.length === 0
        ? "We couldn't read that page — fill the card in yourself and we'll take it from there."
        : null,
  });
}

/** The typed-idea path: same card, nothing fetched. */
export function startFromIdea(idea: string): void {
  const text = (idea || '').trim();
  resetAutoFallbacks();
  set({
    ...EMPTY_STATE,
    mode: state.mode,
    model: state.model,
    job: state.job,
    source: 'idea',
    typeId: 'custom',
    idea: text,
    screen: 'brief',
    fetched: true,
    aspect: '9:16',
    brief: { name: '', tagline: '', features: text, tone: 'confident, modern' },
  });
}

/**
 * The image path: an uploaded product shot, already read by vision. Lands on
 * the same card with the derived brief and the visual reference attached.
 */
export function startFromImage(input: {
  imageUrl: string;
  brief: WebsiteBrief;
  visualReference: string;
}): void {
  resetAutoFallbacks();
  set({
    ...EMPTY_STATE,
    mode: state.mode,
    model: state.model,
    job: state.job,
    source: 'image',
    typeId: 'product_ad',
    screen: 'brief',
    fetched: true,
    brief: input.brief,
    images: [{ url: input.imageUrl, alt: 'Uploaded product image' }],
    selectedImages: [input.imageUrl],
    visualReference: input.visualReference,
  });
}

/** Re-read the page behind the current URL (the card's Refetch action). */
export async function refetchBrief(): Promise<void> {
  if (!state.url.trim() || state.fetching) return;
  await startFromUrl(state.url);
}

// ---------------------------------------------------------------------------
// Actions — step 2: editing the brief
// ---------------------------------------------------------------------------
export function updateBrief(patch: Partial<WebsiteBrief>): void {
  const base: WebsiteBrief = state.brief || { name: '', tagline: '', features: '', tone: '' };
  set({ brief: { ...base, ...patch } });
}

export function setIdea(idea: string): void {
  set({ idea });
}

export function toggleImage(url: string): void {
  const selected = state.selectedImages.includes(url)
    ? state.selectedImages.filter((u) => u !== url)
    : state.selectedImages.length >= 4
      ? state.selectedImages
      : [...state.selectedImages, url];
  set({ selectedImages: selected });
}

/** An image uploaded on the brief screen joins the grid, selected. */
export function addUploadedImage(url: string, visualReference?: string): void {
  set({
    images: [{ url, alt: 'Uploaded image' }, ...state.images.filter((i) => i.url !== url)],
    selectedImages: [url, ...state.selectedImages.filter((u) => u !== url)].slice(0, 4),
    visualReference: visualReference || state.visualReference,
  });
}

// ---------------------------------------------------------------------------
// Actions — step 3: the optional add-ons and the format
// ---------------------------------------------------------------------------
export function setCharacter(character: CharacterRef | null): void {
  set({ character });
}

export function setMockup(mockup: MockupPick | null): void {
  set({ mockup });
}

export function setTone(toneId: string): void {
  set({ toneId });
}

export function setLength(lengthId: LengthId): void {
  set({ lengthId });
}

export function setAspect(aspect: AspectRatio): void {
  set({ aspect });
}

/** Normalize legacy model values and snap every scene to Omni's clip length. */
export function setModel(_model: string): void {
  const scenes = state.scenes.map((s) => ({
    ...s,
    durationSec: renderClipSeconds(s.durationSec, DEFAULT_VIDEO_MODEL),
  }));
  set({ model: DEFAULT_VIDEO_MODEL, scenes });
}

export function setScenes(scenes: BoardScene[]): void {
  set({ scenes });
}

export function setSceneImages(sceneImages: Record<string, string>): void {
  set({ sceneImages });
}

// ---------------------------------------------------------------------------
// Script + render
// ---------------------------------------------------------------------------
function scriptBriefOf(s: StudioState): ScriptBrief {
  return {
    typeId: s.typeId,
    topic: s.idea.trim(),
    // Kept in the brief contract; state is always normalized to Omni Flash.
    model: s.model,
    productBrief: s.brief,
    hasProductImages: s.selectedImages.length > 0,
    visualReference: s.visualReference,
    character: s.character,
    toneId: s.toneId,
    lengthId: s.lengthId,
    aspect: s.aspect,
  };
}

/** Everything that should invalidate an already-written script. */
function scriptKeyOf(s: StudioState): string {
  const b = s.brief;
  return [
    s.typeId,
    s.idea,
    b ? `${b.name}|${b.tagline}|${b.features}|${b.tone}` : '',
    s.visualReference,
    s.selectedImages.join(','),
    s.character ? `${s.character.name}|${s.character.description}` : 'none',
    s.toneId,
    s.lengthId,
    s.aspect,
  ].join('\u241f');
}

function fallbackTitle(s: StudioState): string {
  const name = (s.brief && s.brief.name.trim()) || '';
  if (name) return name;
  const idea = s.idea.trim();
  return idea ? idea.slice(0, 48) : 'Your video';
}

let scriptRun = 0;

/**
 * Write (or re-write) the script for the current brief. Runs in the store, so
 * navigating away mid-write does not cancel it — the scenes are simply there
 * when the visitor comes back.
 */
export async function ensureScript(force = false): Promise<BoardScene[]> {
  const key = scriptKeyOf(state);
  if (!force && state.scenes.length > 0 && key === state.scriptKey) return state.scenes;
  const run = ++scriptRun;
  set({ scriptLoading: true, scriptKey: key, sceneImages: {} });
  const built = await generateScript(scriptBriefOf(state));
  if (run !== scriptRun) return state.scenes; // superseded
  set({
    scenes: built.scenes,
    title: built.title,
    characterDescription: built.characterDescription,
    scriptLoading: false,
  });
  return built.scenes;
}

/** Open the optional storyboard review, writing the script if needed. */
export function openStoryboard(): void {
  set({ screen: 'storyboard', error: null });
  void ensureScript();
}

/** True while a Generate is mid-flight, so a double tap cannot double-spend. */
let generating = false;
/**
 * Bumped by cancelJob(). Every await inside generateVideo compares the run it
 * started with against this, so a cancelled generate cannot come back to life
 * when the reply it was waiting on finally lands.
 */
let generateRun = 0;
/** Renders this browser walked away from — never watched, never adopted. */
const abandonedJobIds = new Set<string>();
/**
 * Greater than zero while THIS store's own submit is in flight. The
 * video-submitted listener at the bottom of the file stands down while it is:
 * generateVideo attaches its own job, and a cancelled one must stay gone.
 */
let ownSubmitsInFlight = 0;

/**
 * THE render entry point. Writes the script if the visitor skipped the
 * storyboard, submits the job, then hands it to the module-level poll loop.
 * Everything after the first await is safe to lose the UI over — the store,
 * not the screen, owns the outcome.
 */
export async function generateVideo(): Promise<void> {
  if (generating) {
    set({ screen: 'render' });
    return;
  }
  if (isJobActive(state.job)) {
    // Already rendering something — show it rather than starting a second one.
    set({ screen: 'render' });
    return;
  }
  generating = true;
  const run = ++generateRun;
  remuxedJobId = null;
  pollFailures = 0;
  set({
    screen: 'render',
    error: null,
    job: {
      jobId: null,
      title: state.title || fallbackTitle(state),
      aspect: state.aspect,
      startedAt: Date.now(),
      phase: state.scenes.length > 0 ? 'submitting' : 'scripting',
      message: state.scenes.length > 0 ? 'Sending it to the render engine…' : 'Writing your script…',
      downloadUrl: null,
      error: null,
      audio: 'ready',
    },
  });

  try {
    const scenes = await ensureScript();
    if (run !== generateRun) return; // cancelled while the script was being written
    if (scenes.length === 0) {
      endJob({
        message: 'We could not write a script',
        error:
          'We could not write a script from that brief. Add a little more detail and try again.',
      });
      return;
    }
    patchJob({
      title: state.title || fallbackTitle(state),
      phase: 'submitting',
      message: 'Sending it to the render engine…',
    });

    // ONE automatic resubmit may strip the character photo (the likeness
    // refusal fallback) — the character still travels as a text description,
    // and the photo stays in state for chaining and the UI.
    const character =
      suppressCharacterImageOnce && state.character
        ? { ...state.character, imageUrl: undefined }
        : state.character;
    suppressCharacterImageOnce = false;

    // FRAME CHAINING: with no explicit character photo attached, the previous
    // render's last frame (or the live series anchor) seeds this one, so
    // back-to-back videos keep the same character automatically.
    const anchor = getChainReference();
    const chainReferenceUrl =
      !(character && character.imageUrl) && anchor && isHttpUrl(anchor.url) ? anchor.url : undefined;

    const characterDescription = state.characterDescription;

    // The approved scene-1 still (when the visitor reviewed the storyboard) is
    // the render's opening frame — see the OPENING-FRAME ANCHOR note in
    // studioApi.submitStudioVideo.
    const firstScene = scenes.find((s) => (s.description || '').trim().length > 0);
    lastSubmitCarriedCharacterImage =
      !!(character && character.imageUrl) || !!chainReferenceUrl;
    ownSubmitsInFlight += 1;
    const result = await submitStudioVideo({
      scenes,
      character,
      characterDescription,
      chainReferenceUrl,
      productImages: state.selectedImages,
      tone: getTone(state.toneId).prompt,
      aspectRatio: state.aspect,
      title: state.title || fallbackTitle(state),
      // The runtime the storyboard is SHOWING (the sum of its clip lengths) is
      // what the renderer is asked for, because it divides that figure by the
      // scene count to choose a clip length. Sending the length picker's label
      // instead is how a 60s pick used to come back as a fraction of it.
      targetDurationSeconds: scenes.reduce((sum, s) => sum + (s.durationSec || 0), 0),
      openingFrameUrl: firstScene ? state.sceneImages[firstScene.key] : undefined,
      mockupImageUrl: state.mockup ? state.mockup.imageUrl : undefined,
      model: state.model,
    }).finally(() => {
      ownSubmitsInFlight -= 1;
    });

    if (run !== generateRun) {
      // Cancelled while the engine was accepting it. We never watch it and
      // never adopt it — but the engine has it, so it may still finish and
      // turn up in My Videos. The cancel copy says exactly that.
      if (result.success && result.jobId) abandonedJobIds.add(result.jobId);
      return;
    }

    if (!result.success || !result.jobId) {
      endJob({
        message: 'The render could not be started',
        error: result.error || 'The render could not be started. Try again in a moment.',
      });
      return;
    }

    patchJob({
      jobId: result.jobId,
      phase: 'rendering',
      message: 'Generating your video…',
      // Informational hook copy, if any. It is not an error.
      notice: result.notice,
      modelUsed: result.modelUsed,
      audio: 'ready',
    });
    watchJob(result.jobId);
  } catch (e: any) {
    if (run !== generateRun) return;
    endJob({
      message: 'The render did not start',
      error: (e && e.message) || 'Something went wrong starting the render.',
    });
  } finally {
    // Only the run that still owns the flag may clear it — a cancelled run
    // must not unlock a generate that started after it.
    if (run === generateRun) generating = false;
  }
}

/**
 * CANCEL — the way out of a render the visitor no longer wants.
 *
 * Stops the poll loop, drops the job and its progress state, and puts them back
 * on the inputs they came from. Bumping generateRun is what makes it safe to
 * press mid-submit: the reply that was still in the air lands on a stale run
 * and is dropped instead of resurrecting the job.
 *
 * The honest limit: a render the engine has already accepted carries on at
 * their end — nothing in a browser can call it back — so it may still appear in
 * My Videos. Cancelling ends the wait, not the render.
 */
export function cancelJob(): void {
  generateRun += 1;
  generating = false;
  remuxedJobId = null;
  const jobId = state.job && state.job.jobId;
  if (jobId) abandonedJobIds.add(jobId);
  stopWatching();
  set({
    job: null,
    error: null,
    screen: state.brief || state.idea ? 'brief' : 'home',
  });
}

/** True while the brief still has retries left. The screen reads this. */
export function canRetry(): boolean {
  return state.retryCount < MAX_RETRIES;
}

/** The line shown once a brief has used every retry it gets. */
export const RETRIES_EXHAUSTED_MESSAGE =
  `We tried this render ${MAX_RETRIES} times and the engine turned it down every time. ` +
  'Something in this particular brief is not landing — start over and change what happens on ' +
  'screen, or make it shorter, and it will go through.';

/**
 * Retry a failed render from the same brief, without re-typing anything.
 *
 * BOUNDED AND SPACED. Each attempt waits longer than the last (2s, 4s, 8s),
 * because an engine that just refused a job refuses it again if you ask
 * immediately; and after MAX_RETRIES the button is gone and the screen says
 * plainly that this brief needs changing. There is no path here that can loop.
 */
export function retryRender(): void {
  if (!canRetry()) {
    if (state.job) patchJob({ error: RETRIES_EXHAUSTED_MESSAGE });
    return;
  }
  const attempt = state.retryCount + 1;
  const wait = RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)];
  set({
    retryCount: attempt,
    job: state.job
      ? {
          ...state.job,
          phase: 'submitting',
          message: `Trying again (attempt ${attempt + 1} of ${MAX_RETRIES + 1})…`,
          error: null,
          stoppedProgress: undefined,
        }
      : null,
  });
  window.setTimeout(() => {
    set({ job: null });
    void generateVideo();
  }, wait);
}

/** Put the finished (or failed) job away and go back to the brief. */
export function dismissJob(): void {
  stopWatching();
  set({ job: null, screen: state.brief || state.idea ? 'brief' : 'home' });
}

/** Start a completely new video — keeps the render that is still in flight. */
export function startOver(): void {
  resetAutoFallbacks();
  set({
    ...EMPTY_STATE,
    mode: state.mode,
    model: state.model,
    job: state.job,
    screen: 'home',
  });
}

/**
 * Abandon a render that is over and go back to a blank hero input. The way out
 * of ANY dead end: it is on the failed screen, the finished screen, and the
 * progress screen, so no state of this app is ever a place you cannot leave.
 */
export function startOverFresh(): void {
  stopWatching();
  resetAutoFallbacks();
  set({ ...EMPTY_STATE, mode: state.mode, model: state.model, screen: 'home' });
}

/**
 * "Start over" from a RESTORED last video: forget the remembered result
 * (vidverge_last_video) as well, and hand back a blank studio.
 */
export function startOverFromLastVideo(): void {
  clearLastVideo();
  startOverFresh();
}

/**
 * Seed the flow from a failed render's brief (My Videos → Try again). Lands on
 * the summary card with everything pre-filled.
 */
export function seedFromRetryBrief(brief: {
  typeId: string;
  topic: string;
  toneId?: string;
  lengthId?: LengthId;
  aspect?: AspectRatio;
}): void {
  resetAutoFallbacks();
  set({
    ...EMPTY_STATE,
    mode: 'short',
    model: state.model,
    job: state.job,
    source: 'idea',
    typeId: getVideoType(brief.typeId) ? brief.typeId : 'custom',
    idea: brief.topic,
    brief: { name: '', tagline: '', features: brief.topic, tone: 'confident, modern' },
    toneId: brief.toneId || EMPTY_STATE.toneId,
    lengthId: brief.lengthId || EMPTY_STATE.lengthId,
    aspect: brief.aspect || EMPTY_STATE.aspect,
    fetched: true,
    screen: 'brief',
  });
}

// ---------------------------------------------------------------------------
// Boot: a render left in flight by an earlier visit is picked straight back up.
// ---------------------------------------------------------------------------
if (typeof window !== 'undefined') {
  // A finished render is worth showing again for a couple of hours — after
  // that it is history, and the visitor should get the hero input back.
  const restored = state.job;
  if (restored && !isJobActive(restored) && Date.now() - restored.startedAt > 2 * 60 * 60 * 1000) {
    state = { ...state, job: null };
  }
  // Closed mid-submit: we never learned a job id, so there is nothing to poll.
  if (state.job && isJobActive(state.job) && !state.job.jobId) {
    state = {
      ...state,
      job: {
        ...state.job,
        phase: 'failed',
        error: 'That render was interrupted before it started. Press Generate to run it again.',
      },
    };
  }
  // A ready job that survived into this page load was not generated during
  // it — mark it restored so the delivery screen says "Your last video".
  if (state.job && state.job.phase === 'ready' && state.job.downloadUrl) {
    state = { ...state, job: { ...state.job, restored: true } };
  }
  // No job at all (or one the two-hour window just retired): bring the last
  // successful video back from LAST_VIDEO_KEY so the player shows it again.
  if (!state.job) {
    const lastVideo = readLastVideo();
    if (lastVideo) {
      state = {
        ...state,
        job: {
          jobId: lastVideo.jobId,
          title: lastVideo.brief ? lastVideo.brief.slice(0, 48) : 'Your last video',
          aspect: state.aspect,
          startedAt: lastVideo.timestamp,
          phase: 'ready',
          message: 'Your last video',
          downloadUrl: lastVideo.videoUrl,
          error: null,
          restored: true,
        },
      };
      // Show the player only when the visitor was not mid-brief: a saved form
      // session outranks re-showing an old result, which stays one tap away
      // on the render bar.
      const midFlow =
        state.screen === 'brief' ||
        state.screen === 'storyboard' ||
        !!state.brief ||
        !!state.idea.trim() ||
        !!state.url.trim();
      if (!midFlow && state.mode === 'short') {
        state = { ...state, screen: 'render' };
      }
    }
  }
  if (state.screen === 'render' && !state.job) {
    state = { ...state, screen: state.brief || state.idea ? 'brief' : 'home' };
  }
  save(state);
  if (state.job && state.job.jobId && isJobActive(state.job)) {
    watchJob(state.job.jobId);
  }
  // Any other surface that starts a render (the in-chat studio) announces it —
  // adopt the job so the studio shows the same progress the chat card does.
  window.addEventListener('vidverge:video-submitted', (event: Event) => {
    const detail = (event as CustomEvent).detail || {};
    const jobId = detail.jobId;
    if (!jobId || typeof jobId !== 'string') return;
    if (state.job && state.job.jobId === jobId) return;
    if (isJobActive(state.job)) return; // we are already watching our own
    if (ownSubmitsInFlight > 0) return; // our own submit — generateVideo attaches it
    if (abandonedJobIds.has(jobId)) return; // cancelled here: do not pick it back up
    // Long Video and Series submit one job PER SCENE and track them
    // themselves; adopting one of those would show a single clip as if it
    // were the whole video.
    if (state.mode !== 'short') return;
    set({
      job: {
        jobId,
        title: state.title || fallbackTitle(state),
        aspect: state.aspect,
        startedAt: Date.now(),
        phase: 'rendering',
        message: 'Generating your video…',
        downloadUrl: null,
        error: null,
      },
    });
    watchJob(jobId);
  });
}
